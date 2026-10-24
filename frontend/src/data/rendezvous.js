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
 *                  stage on a 130° transfer arc to the braking gate, 1.2 km
 *                  behind and 150 m below the CSM (the CW targeting problem).
 *   3. MCC         a midcourse correction re-targets from the actual state
 *                  (the TPI burn is executed with a small, deterministic error).
 *   4. GATE        at the gate, the burn onto the final approach: a short,
 *                  nearly straight arc from behind, up the docking axis.
 *   5. BRAKING     at the checkpoint, the burn that leaves exactly its slow
 *                  closing speed: the guidance hands over to the pilot.
 * The path never comes closer to the CSM than the checkpoint, and the last
 * kilometre is flown from behind (tested).
 *
 * The final docking (dockingSim) is the pilot's. The guidance never docks.
 */
import { MEAN_MOTION, checkpointState, frames } from "./dockingSim";

export const N = MEAN_MOTION;
export const PERIOD = (2 * Math.PI) / N;
export const INSERTION = { x: -14000, y: -46000 }; // m, LVLH relative to the CSM
// TPI when the CSM stands 27° above the ascent stage's local horizon (as on Apollo)
export const TPI_ELEVATION = 27;
export const COAST = (INSERTION.x / Math.tan((TPI_ELEVATION * Math.PI) / 180) - INSERTION.y) / (1.5 * MEAN_MOTION * -INSERTION.x); // s, ≈ 1000
export const TRANSFER = (130 / 360) * PERIOD; // s, TPI to arrival
export const MCC_AT = 0.5; // share of the transfer
export const GATE = [-150, -1200, 0]; // LVLH m: behind and below the CSM
export const FINAL = 840; // s, gate to checkpoint (≈ 1.4 m/s, slowing)
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
export function planRendezvous(difficulty = "ASTRONAUT", opts = {}) {
  if (opts && opts.insertion) return planFromInsertion(difficulty, opts.insertion);
  const cp = checkpointState(difficulty);
  const rC = frames.toL(cp.pos);
  const vC = frames.toL(cp.vel);
  const n = N;
  const s0 = [INSERTION.x, INSERTION.y, 0, 0, -1.5 * n * INSERTION.x, 0]; // co-elliptic
  const burns = [];
  // coast to TPI
  const sTpi = cwPropagate(s0, COAST);
  // TPI: aim at the braking gate after TRANSFER; executed with an error
  const vWant = cwTarget(sTpi.slice(0, 3), GATE, TRANSFER);
  const dvTpi = sub3(vWant, sTpi.slice(3));
  const dvExec = dvTpi.map((v, i) => v * (1 + TPI_ERROR[i]));
  burns.push({ t: COAST, kind: "TPI", dv: dvExec, planned: dvTpi });
  const afterTpi = [...sTpi.slice(0, 3), ...sTpi.slice(3).map((v, i) => v + dvExec[i])];
  // MCC: re-target the gate from the actual state
  const tm = TRANSFER * MCC_AT;
  const sMcc = cwPropagate(afterTpi, tm);
  const vMcc = cwTarget(sMcc.slice(0, 3), GATE, TRANSFER - tm);
  const dvMcc = sub3(vMcc, sMcc.slice(3));
  burns.push({ t: COAST + tm, kind: "MCC", dv: dvMcc });
  const afterMcc = [...sMcc.slice(0, 3), ...vMcc];
  // at the gate: onto the final approach to the checkpoint, from behind
  const sGate = cwPropagate(afterMcc, TRANSFER - tm);
  const vFinal = cwTarget(sGate.slice(0, 3), rC, FINAL);
  const dvGate = sub3(vFinal, sGate.slice(3));
  burns.push({ t: COAST + TRANSFER, kind: "GATE", dv: dvGate });
  const afterGate = [...sGate.slice(0, 3), ...vFinal];
  // braking at the checkpoint: leave exactly its velocity
  const sArr = cwPropagate(afterGate, FINAL);
  const dvBrk = sub3(vC, sArr.slice(3));
  burns.push({ t: COAST + TRANSFER + FINAL, kind: "BRAKING", dv: dvBrk });
  const total = COAST + TRANSFER + FINAL;
  const arcs = [
    { t0: 0, s: s0 },
    { t0: COAST, s: afterTpi },
    { t0: COAST + tm, s: afterMcc },
    { t0: COAST + TRANSFER, s: afterGate },
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
  return { difficulty, burns, total, sample, checkpoint: { r: rC, v: vC }, totalDv, insertion: s0, csiAt: null, tpiAt: COAST, manual: false, feasible: true };
}

/** The co-elliptic burn's time from an LVLH state: the relative orbit's next highest point (vx → 0 from above). */
export function csiTime(st, n = N) {
  const P = (2 * Math.PI) / n;
  let prev = cwPropagate(st, 60, n);
  for (let t = 90; t <= 60 + P; t += 30) {
    const cur = cwPropagate(st, t, n);
    if (prev[3] > 0 && cur[3] <= 0) {
      let lo = t - 30;
      let hi = t;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (cwPropagate(st, mid, n)[3] > 0) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    }
    prev = cur;
  }
  return 60; // no apoapsis ahead (an almost circular relative orbit): the burn comes at once
}
export const CSI_MAX_COAST = 5 * PERIOD; // s: a CSM the stage cannot catch within five orbits is out of reach
export const RDV_MIN_RANGE = 1000; // m: before the gate the transfer never comes closer to the CSM

/**
 * The rendezvous from an insertion the pilot flew (MANUAL ASCENT, data/manualAscent): the
 * stage's actual LVLH state at engine cutoff, `s0`. At the relative orbit's next apoapsis the
 * guidance's co-elliptic burn (CSI, Apollo's CSI and CDH in one) leaves it on a co-elliptic
 * orbit; it coasts until the CSM stands TPI_ELEVATION above its horizon, then the same TPI,
 * midcourse, gate and braking as the guided rendezvous, ending on the same docking checkpoint.
 * `feasible` is false when, after CSI, the stage is not below and behind the CSM, it would take
 * more than five orbits to close, or the transfer would pass closer than RDV_MIN_RANGE; `reason`
 * says which ("ahead": a low orbit has already passed the CSM; "above": not below it; "slow": too
 * close below it to catch it in time; "close": the transfer passes too near).
 */
function planFromInsertion(difficulty, insertion) {
  const cp = checkpointState(difficulty);
  const rC = frames.toL(cp.pos);
  const vC = frames.toL(cp.vel);
  const n = N;
  // an LVLH state at insertion (coasted with the linear relative motion), or the exact coast
  // the ascent flew: { csiAt, csi (LVLH at the burn), coast(t) (LVLH before it) }
  const exact = !Array.isArray(insertion);
  const s0 = exact ? insertion.coast(0) : insertion.slice(0, 6);
  const burns = [];
  const csiAt = exact ? insertion.csiAt : csiTime(s0);
  const sCsi = exact ? insertion.csi.slice(0, 6) : cwPropagate(s0, csiAt);
  const x = sCsi[0];
  const y = sCsi[1];
  const vCo = [0, -1.5 * n * x, 0];
  burns.push({ t: csiAt, kind: "CSI", dv: sub3(vCo, sCsi.slice(3)) });
  const afterCsi = [x, y, 0, ...vCo];
  let feasible = x < -2000 && y < -2000;
  let reason = null;
  if (!(x < -2000)) reason = "above";
  else if (!(y < -2000)) reason = "ahead";
  // coast on the co-elliptic orbit until the CSM is TPI_ELEVATION above the local horizon
  let coast = feasible ? (x / Math.tan((TPI_ELEVATION * Math.PI) / 180) - y) / (1.5 * n * -x) : 120;
  if (!(coast >= 120)) coast = 120;
  if (coast > CSI_MAX_COAST) {
    feasible = false;
    reason = reason || "slow";
  }
  const tpiAt = csiAt + Math.min(coast, CSI_MAX_COAST);
  const sTpi = cwPropagate(afterCsi, tpiAt - csiAt);
  const vWant = cwTarget(sTpi.slice(0, 3), GATE, TRANSFER);
  const dvTpi = sub3(vWant, sTpi.slice(3));
  const dvExec = dvTpi.map((v, i) => v * (1 + TPI_ERROR[i]));
  burns.push({ t: tpiAt, kind: "TPI", dv: dvExec, planned: dvTpi });
  const afterTpi = [...sTpi.slice(0, 3), ...sTpi.slice(3).map((v, i) => v + dvExec[i])];
  const tm = TRANSFER * MCC_AT;
  const sMcc = cwPropagate(afterTpi, tm);
  const vMcc = cwTarget(sMcc.slice(0, 3), GATE, TRANSFER - tm);
  burns.push({ t: tpiAt + tm, kind: "MCC", dv: sub3(vMcc, sMcc.slice(3)) });
  const afterMcc = [...sMcc.slice(0, 3), ...vMcc];
  const sGate = cwPropagate(afterMcc, TRANSFER - tm);
  const vFinal = cwTarget(sGate.slice(0, 3), rC, FINAL);
  burns.push({ t: tpiAt + TRANSFER, kind: "GATE", dv: sub3(vFinal, sGate.slice(3)) });
  const afterGate = [...sGate.slice(0, 3), ...vFinal];
  const sArr = cwPropagate(afterGate, FINAL);
  burns.push({ t: tpiAt + TRANSFER + FINAL, kind: "BRAKING", dv: sub3(vC, sArr.slice(3)) });
  const total = tpiAt + TRANSFER + FINAL;
  const arcs = [
    { t0: 0, s: s0 },
    { t0: csiAt, s: afterCsi },
    { t0: tpiAt, s: afterTpi },
    { t0: tpiAt + tm, s: afterMcc },
    { t0: tpiAt + TRANSFER, s: afterGate },
  ];
  const sample = (t) => {
    const tt = Math.max(0, Math.min(total, t));
    let arc = arcs[0];
    for (const a of arcs) if (tt >= a.t0) arc = a;
    if (tt >= total) return [...rC, ...vC];
    if (exact && tt < csiAt) return insertion.coast(tt);
    return cwPropagate(arc.s, tt - arc.t0);
  };
  // the path before the gate never comes close to the CSM
  let minRange = Infinity;
  for (let t = 0; t <= tpiAt + TRANSFER; t += 20) minRange = Math.min(minRange, norm3(sample(t).slice(0, 3)));
  if (minRange < RDV_MIN_RANGE) {
    feasible = false;
    reason = reason || "close";
  }
  const totalDv = burns.reduce((acc, b) => acc + norm3(b.dv), 0);
  return { difficulty, burns, total, sample, checkpoint: { r: rC, v: vC }, totalDv, insertion: s0, csiAt, tpiAt, manual: true, feasible, reason: feasible ? null : reason, minRange };
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
