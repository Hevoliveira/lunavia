/*
 * LUNAVIA — lunar-orbit rendezvous: the automatic guidance from orbit
 * insertion to the docking checkpoint (pure; unit-tested).
 *
 * The ascent stage reaches a lower orbit a little behind the CSM (the same
 * CSM, still in its 110-km parking orbit). Being lower, it moves faster and
 * gains on the CSM. Relative to the CSM, in its local orbital frame (LVLH:
 * x radially out, y along the orbit, z across it), the two-body motion over
 * these distances is the Clohessy–Wiltshire solution, used here in closed
 * form:
 *
 *   1. INSERTION   ascent engine cutoff: 14 km below and ~45 km behind,
 *                  on a co-elliptic orbit (it closes at a constant ~18 m/s).
 *   2. TPI         terminal phase initiation: a burn that puts the ascent
 *                  stage on a 130° transfer arc to the final-approach
 *                  checkpoint (the CW targeting problem).
 *   3. MCC         a midcourse correction re-targets from the actual state
 *                  (the TPI burn is executed with a small, deterministic error).
 *   4. BRAKING     at arrival, the burn that leaves exactly the checkpoint's
 *                  slow closing speed: the guidance hands over to the pilot.
 *
 * The final docking (dockingSim) is the pilot's. The guidance never docks.
 */
import { MEAN_MOTION, checkpointState, frames } from "./dockingSim";

export const N = MEAN_MOTION;
export const PERIOD = (2 * Math.PI) / N;
export const INSERTION = { x: -14000, y: -46000 }; // m, LVLH relative to the CSM
export const COAST = 1500; // s from insertion to TPI
export const TRANSFER = (130 / 360) * PERIOD; // s, TPI to arrival
export const MCC_AT = 0.5; // share of the transfer
export const TPI_ERROR = [0.015, -0.01, 0.02]; // executed Δv error (fraction, per axis): deterministic

/** Closed-form CW propagation of an LVLH state [x, y, z, vx, vy, vz] over t. */
export function cwPropagate([x, y, z, vx, vy, vz], t, n = N) {
  const c = Math.cos(n * t);
  const s = Math.sin(n * t);
  return [
    (4 - 3 * c) * x + (s / n) * vx + (2 / n) * (1 - c) * vy,
    6 * (s - n * t) * x + y - (2 / n) * (1 - c) * vx + ((4 * s - 3 * n * t) / n) * vy,
    c * z + (s / n) * vz,
    3 * n * s * x + c * vx + 2 * s * vy,
    -6 * n * (1 - c) * x - 2 * s * vx + (4 * c - 3) * vy,
    -n * s * z + c * vz,
  ];
}

/** The velocity at r0 that reaches r1 after t (CW two-point boundary problem). */
export function cwTarget(r0, r1, t, n = N) {
  const c = Math.cos(n * t);
  const s = Math.sin(n * t);
  // In-plane: [x1 - (4-3c)x0, y1 - 6(s-nt)x0 - y0] = M [vx0, vy0]
  const a = s / n;
  const b = (2 / n) * (1 - c);
  const cc = -(2 / n) * (1 - c);
  const d = (4 * s - 3 * n * t) / n;
  const px = r1[0] - (4 - 3 * c) * r0[0];
  const py = r1[1] - 6 * (s - n * t) * r0[0] - r0[1];
  const det = a * d - b * cc;
  const vx = (px * d - b * py) / det;
  const vy = (a * py - cc * px) / det;
  const vz = (r1[2] - c * r0[2]) / a;
  return [vx, vy, vz];
}

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm3 = (a) => Math.hypot(a[0], a[1], a[2]);

/**
 * The whole automatic rendezvous for a difficulty, ending exactly on its
 * docking checkpoint (dockingSim checkpointState), as a timeline of coast
 * arcs between burns. sample(t) gives the LVLH state at any time from
 * insertion (t = 0) to handover (t = total).
 */
export function planRendezvous(difficulty = "ASTRONAUT") {
  const cp = checkpointState(difficulty);
  const rC = frames.toL(cp.pos);
  const vC = frames.toL(cp.vel);
  const n = N;
  const s0 = [INSERTION.x, INSERTION.y, 0, 0, -1.5 * n * INSERTION.x, 0]; // co-elliptic
  const burns = [];
  // coast to TPI
  const sTpi = cwPropagate(s0, COAST);
  // TPI: aim at the checkpoint after TRANSFER; executed with an error
  const vWant = cwTarget(sTpi.slice(0, 3), rC, TRANSFER);
  const dvTpi = sub3(vWant, sTpi.slice(3));
  const dvExec = dvTpi.map((v, i) => v * (1 + TPI_ERROR[i]));
  burns.push({ t: COAST, kind: "TPI", dv: dvExec, planned: dvTpi });
  const afterTpi = [...sTpi.slice(0, 3), ...sTpi.slice(3).map((v, i) => v + dvExec[i])];
  // MCC: re-target from the actual state
  const tm = TRANSFER * MCC_AT;
  const sMcc = cwPropagate(afterTpi, tm);
  const vMcc = cwTarget(sMcc.slice(0, 3), rC, TRANSFER - tm);
  const dvMcc = sub3(vMcc, sMcc.slice(3));
  burns.push({ t: COAST + tm, kind: "MCC", dv: dvMcc });
  const afterMcc = [...sMcc.slice(0, 3), ...vMcc];
  // braking at arrival: leave exactly the checkpoint's velocity
  const sArr = cwPropagate(afterMcc, TRANSFER - tm);
  const dvBrk = sub3(vC, sArr.slice(3));
  burns.push({ t: COAST + TRANSFER, kind: "BRAKING", dv: dvBrk });
  const total = COAST + TRANSFER;
  const arcs = [
    { t0: 0, s: s0 },
    { t0: COAST, s: afterTpi },
    { t0: COAST + tm, s: afterMcc },
  ];
  const sample = (t) => {
    const tt = Math.max(0, Math.min(total, t));
    let arc = arcs[0];
    for (const a of arcs) if (tt >= a.t0) arc = a;
    const st = cwPropagate(arc.s, tt - arc.t0);
    if (tt >= total) return [...rC, ...vC];
    return st;
  };
  const totalDv = burns.reduce((acc, b) => acc + norm3(b.dv), 0);
  return { difficulty, burns, total, sample, checkpoint: { r: rC, v: vC }, totalDv, insertion: s0 };
}

/** Range and range rate (m, m/s) of an LVLH state. */
export function rangeOf(st) {
  const r = norm3(st.slice(0, 3));
  const rr = (st[0] * st[3] + st[1] * st[4] + st[2] * st[5]) / (r || 1);
  return { range: r, rate: rr };
}

/**
 * Playback clock for the cinematic: the rendezvous' real time (≈ 1 h 10 min) as
 * a short film whose time compression falls as the CSM comes close, so the
 * final metres play at nearly real speed. play ∈ [0, PLAY_S] → mission seconds.
 */
export const PLAY_S = 34;
export function playToMission(play, plan) {
  const u = Math.max(0, Math.min(1, play / PLAY_S));
  // ease-out: fast through the long coast, slow over the last minutes
  const e = 1 - Math.pow(1 - u, 3);
  return e * plan.total;
}
