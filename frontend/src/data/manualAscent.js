/*
 * LUNAVIA — MANUAL LUNAR ASCENT: the ascent stage flown by the player from the
 * lunar surface into lunar orbit (pure; unit-tested).
 *
 * The flight is integrated in the orbit's plane around the Moon's centre
 * (polar coordinates: radius r, downrange angle θ from the landing site), with
 * the same Moon as the rest of the game (dockingSim MU_MOON, a 1737.4-km
 * sphere) and the same ascent stage as the guided liftoff (data/lunarAscent
 * ASCENT: 15.6 kN, Isp 311 s, 4.8 t at liftoff):
 *
 *   gravity   μ / r² towards the centre (falling off with height);
 *   engine    the ascent engine's fixed thrust (no throttle) along the stage's
 *             axis; its propellant flow lowers the mass as it burns; one burn
 *             (once cut off, the engine is not relit);
 *   attitude  the stage's pitch from the local vertical, turned only by its RCS
 *             (an angular acceleration; the engine does not gimbal). The RCS
 *             propellant it uses is counted;
 *   orbit     apoapsis and periapsis are the two-body conic of the current
 *             state (exact for a Keplerian orbit: what the burn has made so far).
 *
 * Each frame the player's commands step this one state at a fixed 20-ms step,
 * so the same inputs always fly the same trajectory, at any frame rate or time
 * acceleration. Nothing is scripted: the stage is wherever its integrated
 * motion has taken it.
 *
 * The target comes from the existing rendezvous (data/rendezvous): the guided
 * ascent ends on a co-elliptic orbit 14 km below the CSM's 110-km parking
 * orbit, so the insertion's apoapsis target is that orbit's height (96 km);
 * its periapsis must stay clear of the terrain (15 km, as Apollo's 17 km). Once
 * the engine stops, the orbit is judged: stable (periapsis ≥ 15 km), below the
 * CSM (apoapsis ≤ 106 km) and reachable by the rendezvous guidance with the
 * propellant left (rendezvous planRendezvous from this very state: the
 * co-elliptic burn at apoapsis, then TPI, midcourse, gate and braking).
 *
 * Simplifications (documented in HANDOFF): the Moon does not turn (its 4.6 m/s
 * at the equator is ignored), its gravity is a point mass and its surface a
 * sphere at the mean radius; the flight stays in the CSM's orbital plane
 * (cross-range is not flown); the landed tilt does not change the physics
 * (the stage starts vertical); the stage is rigid with a fixed RCS
 * authority; the engine starts and stops within one step.
 */
import { MU_MOON, ORBIT_R } from "./dockingSim";
import { ASCENT } from "./lunarAscent";
import { INSERTION, N as CSM_N, planRendezvous } from "./rendezvous";

export const R_MOON = 1737.4e3; // m, the mean radius (the same sphere as dockingSim's ORBIT_R)
export const MU = MU_MOON;
const G0 = 9.80665;
const DEG = Math.PI / 180;

/** The ascent stage: the guided liftoff's engine and mass, Apollo's ascent propellant load. */
export const STAGE = Object.freeze({
  thrust: ASCENT.thrust, // N, fixed (the ascent engine is not throttleable)
  isp: ASCENT.isp, // s
  mass0: ASCENT.mass0, // kg at liftoff (the ascent stage alone: the descent stage stays)
  prop: 2353, // kg of ascent propellant (Apollo 11's load)
  rcsProp: 120, // kg of RCS propellant available to the ascent (attitude) and the rendezvous
  rcsIsp: 290, // s
  rcsFlow: 0.31, // kg/s: two 445-N jets firing for full angular acceleration
});
export const MDOT = STAGE.thrust / (STAGE.isp * G0); // kg/s (≈ 5.1)
export const BURN_MAX = STAGE.prop / MDOT; // s of full burn (≈ 460)
export const VE = STAGE.isp * G0; // m/s

/** The insertion target (derived from the rendezvous design: 14 km below the CSM's orbit). */
export const CSM_ALT = ORBIT_R - R_MOON; // m, 110 km
export const TARGET = Object.freeze({
  apo: CSM_ALT + INSERTION.x, // m: 96 km, the co-elliptic orbit's height
  peri: 18000, // m: the guidance's insertion height (Apollo: ~18 km)
  safePeri: 15000, // m: a lower periapsis is not a stable orbit over the terrain
  apoLimit: CSM_ALT - 4000, // m: the rendezvous needs the ascent stage below the CSM
});
/** Speed at TARGET.peri, horizontal, for an orbit whose apoapsis is TARGET.apo (≈ 1689 m/s). */
export const INSERT_SPEED = (() => {
  const rp = R_MOON + TARGET.peri;
  const ra = R_MOON + TARGET.apo;
  return Math.sqrt(MU * (2 / rp - 2 / (rp + ra)));
})();
/** RCS Δv reserved for the rendezvous (the rest of the RCS stays the docking's own budget). */
export const RCS_RENDEZVOUS_DV = 30; // m/s

export const DT = 0.02; // s, the fixed integration step
export const VERTICAL_RISE = ASCENT.vertical; // s: clear of the descent stage before pitching over

/** RCS attitude control per pilot difficulty. */
export const ASCENT_DIFFICULTY = Object.freeze({
  // ASSISTED: attitude hold, the pitch program flown by the computer once the pilot starts it,
  // automatic cutoff on the target apoapsis, guidance cues and strong warnings
  CADET: { hold: true, rateMax: 5, accel: 10, cue: true, pitchAssist: true, autoCutoff: "on", warnings: "strong", confirmCutoff: true },
  // SEMI-MANUAL: attitude hold and the guidance's pitch cue; cutoff by hand or armed by the pilot
  ASTRONAUT: { hold: true, rateMax: 5, accel: 10, cue: true, pitchAssist: false, autoCutoff: "optional", warnings: "normal", confirmCutoff: false },
  // MANUAL: no attitude hold (a jet firing changes the rate; the pilot stops it), no cue,
  // no automatic cutoff; only the orbit's numbers and the critical warnings
  COMMANDER: { hold: false, rateMax: 8, accel: 6, cue: false, pitchAssist: false, autoCutoff: "none", warnings: "critical", confirmCutoff: false },
});
export const ASCENT_DIFFICULTIES = Object.keys(ASCENT_DIFFICULTY);

/* ---- orbits ------------------------------------------------------------------------------- */
/**
 * The two-body orbit of the in-plane state (r, vr, vt): semi-major axis, eccentricity,
 * apoapsis and periapsis radii and heights above the mean surface (m). An escape
 * trajectory has ra = Infinity.
 */
export function orbitOf(r, vr, vt) {
  const v2 = vr * vr + vt * vt;
  const energy = v2 / 2 - MU / r;
  const h = r * vt; // specific angular momentum
  const p = (h * h) / MU;
  const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (MU * MU)));
  const a = energy < 0 ? -MU / (2 * energy) : Infinity;
  // bound: from the semi-major axis (a straight-up, radial flight is the e = 1 limit: ra = 2a)
  const ra = energy < 0 ? a * (1 + Math.min(1, e)) : Infinity;
  const rp = energy < 0 ? a * (1 - Math.min(1, e)) : p / (1 + e);
  return { a, e, rp, ra, hp: rp - R_MOON, ha: ra - R_MOON, energy };
}

/** Circular speed at radius r. */
export const circularSpeed = (r) => Math.sqrt(MU / r);

/* ---- the state ---------------------------------------------------------------------------- */
/**
 * A new ascent on the pad: the ascent stage (4.8 t) on its descent stage, vertical,
 * engine off. `difficulty` sets the RCS control law and the assists.
 */
export function createAscent(difficulty = "ASTRONAUT") {
  const cfg = ASCENT_DIFFICULTY[difficulty] || ASCENT_DIFFICULTY.ASTRONAUT;
  return {
    difficulty: ASCENT_DIFFICULTY[difficulty] ? difficulty : "ASTRONAUT",
    cfg,
    t: 0, // s since ignition (0 until then)
    r: R_MOON,
    th: 0, // downrange angle (rad)
    vr: 0,
    vt: 0,
    pitch: 0, // rad from the local vertical, + towards downrange
    rate: 0, // rad/s, inertial pitch rate
    hold: 0, // rad: the local pitch the attitude hold keeps
    mass: STAGE.mass0,
    prop: STAGE.prop,
    rcs: STAGE.rcsProp,
    engine: "armed", // armed | on | cutoff | depleted
    lifted: false,
    landed: true,
    pitchProgram: false, // the pilot has begun the pitch program
    assist: false, // CADET's pitch assist engaged
    autoCutoff: cfg.autoCutoff === "on",
    rcsFiring: 0, // -1..1: the jets on the last step
    ignitedAt: null,
    cutoffAt: null,
    cutoffBy: null, // "pilot" | "auto" | "depleted"
    status: "pad", // pad | flight | orbit | failed
    failure: null, // { kind, ... } once failed
    maxAlt: 0,
    acc: 0, // a step's time left over (fixed-step accumulator)
  };
}

const altOf = (s) => s.r - R_MOON;

/**
 * The ascent guidance (the computer's pitch program; Apollo's LM ascent guidance was an
 * explicit "E-guidance" of this kind): after the vertical rise, the pitch that brings the
 * stage to the insertion height with zero vertical speed exactly when its horizontal speed
 * reaches INSERT_SPEED, the radial acceleration being linear in time over the time to go.
 * Returns the commanded local pitch (rad) and the time to go (s).
 */
export function guidancePitch(s) {
  if (s.t < VERTICAL_RISE || s.engine !== "on") return { pitch: 0, tgo: null };
  const a = STAGE.thrust / s.mass;
  const dvGo = Math.hypot(INSERT_SPEED - s.vt, s.vr);
  const tgo = Math.max(1, (s.mass / MDOT) * (1 - Math.exp(-dvGo / VE)));
  const T = Math.max(tgo, 8);
  const dh = R_MOON + TARGET.peri - s.r - s.vr * T;
  const dv = -s.vr;
  const B = (6 * dv * T - 12 * dh) / (T * T * T);
  const A = dv / T - (B * T) / 2;
  // the thrust's radial share: the wanted radial acceleration, plus gravity, less the centrifugal term
  const ar = A + MU / (s.r * s.r) - (s.vt * s.vt) / s.r;
  const c = Math.max(-0.35, Math.min(1, ar / a));
  return { pitch: Math.acos(c), tgo };
}

/**
 * True when the engine should stop (the cutoff the guidance calls for, and CADET's automatic
 * cutoff): the predicted apoapsis has reached the target and the periapsis is already safe. With
 * the apoapsis there but the periapsis still low the burn must go on, pitched towards the horizon.
 */
export const cutoffDue = (s) => {
  if (s.engine !== "on") return false;
  const o = orbitOf(s.r, s.vr, s.vt);
  return o.ha >= TARGET.apo && o.hp >= TARGET.safePeri;
};

/* ---- one step --------------------------------------------------------------------------------- */
function deriv(r, vr, vt, accR, accT) {
  return [vr, vt / r, (vt * vt) / r - MU / (r * r) + accR, (-vr * vt) / r + accT];
}

function rk4(s, accR, accT, h) {
  const k1 = deriv(s.r, s.vr, s.vt, accR, accT);
  const k2 = deriv(s.r + (h / 2) * k1[0], s.vr + (h / 2) * k1[2], s.vt + (h / 2) * k1[3], accR, accT);
  const k3 = deriv(s.r + (h / 2) * k2[0], s.vr + (h / 2) * k2[2], s.vt + (h / 2) * k2[3], accR, accT);
  const k4 = deriv(s.r + h * k3[0], s.vr + h * k3[2], s.vt + h * k3[3], accR, accT);
  const f = (i) => (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  s.r += f(0);
  s.th += f(1);
  s.vr += f(2);
  s.vt += f(3);
}

/**
 * The pilot's commands for one step:
 *   pitch     -1..1 on the RCS pitch control (+ towards the horizon, − back towards vertical)
 *   ignite    ENGINE IGNITION (once, on the pad)
 *   cutoff    ENGINE CUTOFF (the burn ends; the engine is not relit)
 *   assist    CADET: pitch assist wanted (the computer steers the pitch program)
 *   autoCutoff  the automatic cutoff armed (CADET by default, ASTRONAUT by choice)
 */
function step(s, inp, h) {
  const cfg = s.cfg;
  if (s.status === "failed") return;
  // ignition: the ascent stage's engine and the separation (the descent stage stays)
  if (inp.ignite && s.engine === "armed") {
    s.engine = "on";
    s.ignitedAt = 0;
    s.status = "flight";
  }
  if (inp.cutoff && s.engine === "on") {
    s.engine = "cutoff";
    s.cutoffAt = s.t;
    s.cutoffBy = "pilot";
  }
  if (s.engine === "armed") return; // on the pad: nothing moves
  if (typeof inp.autoCutoff === "boolean" && cfg.autoCutoff !== "none") s.autoCutoff = inp.autoCutoff;

  // -- attitude (RCS) --
  const thDot = s.vt / s.r; // the local vertical turns with the downrange angle
  let pilot = Math.max(-1, Math.min(1, inp.pitch || 0));
  if (s.t < 1.5) pilot = 0; // still on the descent stage's deck: the RCS waits for separation
  if (pilot !== 0 && s.t >= VERTICAL_RISE - 2) s.pitchProgram = true;
  const assistOn = cfg.pitchAssist && !!inp.assist && s.pitchProgram && s.engine === "on";
  s.assist = assistOn;
  const acc = cfg.accel * DEG;
  let alpha = 0; // the RCS angular acceleration commanded this step
  if (cfg.hold) {
    // rate command, attitude hold: a held control turns the stage at up to rateMax; released,
    // the RCS keeps the local pitch where it was left (turning with the local vertical)
    let wantRel;
    if (pilot !== 0) {
      wantRel = pilot * cfg.rateMax * DEG;
      s.hold = s.pitch;
    } else if (assistOn) {
      const g = guidancePitch(s);
      s.hold = g.pitch;
      wantRel = Math.max(-cfg.rateMax * DEG, Math.min(cfg.rateMax * DEG, (g.pitch - s.pitch) * 0.8));
    } else {
      wantRel = Math.max(-cfg.rateMax * DEG, Math.min(cfg.rateMax * DEG, (s.hold - s.pitch) * 1.2));
    }
    const want = wantRel + thDot; // inertial rate
    const err = want - s.rate;
    alpha = Math.max(-acc, Math.min(acc, err / h));
    if (Math.abs(err) < 1e-5) alpha = 0;
  } else {
    // direct: the jets accelerate the rotation; nothing stops it but the opposite jets
    alpha = pilot * acc;
  }
  if (s.rcs <= 0) alpha = 0;
  const fire = alpha / acc;
  s.rcsFiring = fire;
  s.rcs = Math.max(0, s.rcs - Math.abs(fire) * STAGE.rcsFlow * h);
  s.rate += alpha * h;
  s.pitch += (s.rate - thDot) * h;
  if (s.pitch > Math.PI) s.pitch -= 2 * Math.PI;
  if (s.pitch < -Math.PI) s.pitch += 2 * Math.PI;

  // -- engine --
  let a = 0;
  if (s.engine === "on") {
    const burn = Math.min(h, s.prop / MDOT);
    a = (STAGE.thrust / s.mass) * (burn / h);
    s.prop -= MDOT * burn;
    s.mass -= MDOT * burn;
    if (s.prop <= 1e-6) {
      s.prop = 0;
      s.engine = "depleted";
      s.cutoffAt = s.t + burn;
      s.cutoffBy = "depleted";
    }
  }
  const accR = a * Math.cos(s.pitch);
  const accT = a * Math.sin(s.pitch);

  // -- motion --
  if (s.landed) {
    // on the deck until the thrust lifts it
    const net = accR - MU / (s.r * s.r);
    if (net > 0) {
      s.landed = false;
      s.lifted = true;
    } else {
      s.t += h;
      return;
    }
  }
  rk4(s, accR, accT, h);
  s.t += h;
  const alt = altOf(s);
  if (alt > s.maxAlt) s.maxAlt = alt;

  // automatic cutoff (CADET, or armed by the ASTRONAUT): the target apoapsis reached
  if (s.engine === "on" && s.autoCutoff && cfg.autoCutoff !== "none" && cutoffDue(s)) {
    s.engine = "cutoff";
    s.cutoffAt = s.t;
    s.cutoffBy = "auto";
  }

  // the surface
  if (alt <= 0 && s.lifted) {
    s.r = R_MOON;
    fail(s, "impact", { speed: Math.hypot(s.vr, s.vt) });
  }
}

function fail(s, kind, extra = {}) {
  if (s.status === "failed") return;
  s.status = "failed";
  s.failure = { kind, t: s.t, alt: altOf(s), ...extra };
  if (s.engine === "on") {
    s.engine = "cutoff";
    s.cutoffAt = s.t;
  }
}

/** Δv the stage still has (m/s): the ascent engine's propellant left (rocket equation). */
export const dvLeft = (s) => VE * Math.log(s.mass / (s.mass - s.prop));

/**
 * The least speed the stage could have here and be in a stable orbit: of all the orbits through
 * radius r with a periapsis at TARGET.safePeri or higher, the slowest there is the one whose
 * apoapsis is r itself (vis-viva). Below that height, the circular speed at TARGET.safePeri.
 */
export function minOrbitSpeed(r) {
  const rp = R_MOON + TARGET.safePeri;
  const ra = Math.max(r, rp);
  return Math.sqrt(MU * (2 / ra - 2 / (ra + rp)));
}

/**
 * True when no use of the propellant left can make a stable orbit any more: the speed still
 * missing (at least minOrbitSpeed less the speed the stage has, whatever its direction) is more
 * than the engine has left. A strict lower bound — gravity losses, steering and the vertical
 * speed to be turned would only make it worse — so a flight that could still reach orbit is
 * never called lost.
 */
export function unrecoverable(s) {
  if (s.status !== "flight") return false;
  const o = orbitOf(s.r, s.vr, s.vt);
  if (o.hp >= TARGET.safePeri) return false;
  const have = s.engine === "on" ? dvLeft(s) : 0;
  return minOrbitSpeed(s.r) - Math.hypot(s.vr, s.vt) > have;
}

/**
 * A warning, not a verdict: the Δv a circular orbit here would take (turning all of the vertical
 * speed into it) is more than is left. The flight is in trouble unless the pilot pitches over.
 */
export function marginal(s) {
  if (s.engine !== "on") return false;
  const o = orbitOf(s.r, s.vr, s.vt);
  if (o.hp >= TARGET.safePeri) return false;
  return Math.hypot(circularSpeed(s.r) - s.vt, s.vr) > dvLeft(s);
}

/**
 * Advance the ascent by `dt` seconds of mission time (any frame time: it is flown in fixed
 * DT steps, so the trajectory does not depend on the frame rate). Returns the state.
 */
export function advance(s, inp, dt) {
  if (s.status === "failed" || s.status === "orbit") return s;
  // whole steps only (counted with a tolerance, so 0.1 s is always exactly five steps)
  s.acc += Math.max(0, Math.min(dt, 1));
  const n = Math.floor(s.acc / DT + 1e-6);
  s.acc = Math.max(0, s.acc - n * DT);
  for (let i = 0; i < n; i++) {
    // ignition and cutoff are edges: applied on the first step of the frame only
    step(s, i === 0 ? inp : { ...inp, ignite: false, cutoff: false }, DT);
    if (s.status === "failed") break;
    if (s.engine === "cutoff" || s.engine === "depleted") {
      settle(s);
      break;
    }
  }
  if (s.status === "flight" && unrecoverable(s)) fail(s, "unrecoverable", { dvNeed: minOrbitSpeed(s.r) - Math.hypot(s.vr, s.vt), dvLeft: s.engine === "on" ? dvLeft(s) : 0 });
  return s;
}

/** The engine has stopped: the orbit it left is judged at once (a conic: nothing changes it). */
function settle(s) {
  if (s.status !== "flight") return;
  const ev = evaluateInsertion(s);
  s.evaluation = ev;
  if (ev.ok) s.status = "orbit";
  else fail(s, ev.failure, { apo: ev.apo, peri: ev.peri });
}

/* ---- the CSM, and the handoff to the rendezvous ------------------------------------------------ */
/**
 * The CSM's angle on its orbit at time t after ignition (rad, from the landing site), chosen
 * so that the guidance's own ascent (`referenceFlight`) is, at the rendezvous's co-elliptic
 * burn, 14 km below and CSI_BEHIND behind it.
 */
export function csmAngle(t) {
  if (CSM_PHASE === null) solvePhase();
  return CSM_PHASE + CSM_N * t;
}

/**
 * The ascent stage's state relative to the CSM, in the rendezvous's LVLH frame (x radially out,
 * y along the orbit, z across it; curvilinear: y is the arc between them at the CSM's radius).
 */
export function lvlhOf(r, th, vr, vt, csmTh) {
  return [r - ORBIT_R, ORBIT_R * (th - csmTh), 0, vr, ORBIT_R * (vt / r - CSM_N), 0];
}
export const toLvlh = (s, csmTh = csmAngle(s.t)) => lvlhOf(s.r, s.th, s.vr, s.vt, csmTh);

/**
 * What the rendezvous needs from the engine cutoff (and what the mission save keeps): the
 * stage's in-plane state, the time since ignition and the propellant left. Pure numbers.
 */
export const cutoffRecord = (s) => ({ t: s.t, r: s.r, th: s.th, vr: s.vr, vt: s.vt, mass: s.mass, prop: s.prop });

export const COAST_DT = 2; // s, the coast's integration step (and its table's spacing)
/**
 * The coast from cutoff to the orbit's next apoapsis, flown exactly (two-body, RK4) rather than
 * with the rendezvous's linear relative motion, which is only accurate close to the CSM's orbit
 * (the stage is inserted ~90 km below it). At the apoapsis the stage is ~14 km below the CSM and
 * the rendezvous guidance takes over with its co-elliptic burn. Returns { csiAt, csi (LVLH state
 * then), table (LVLH every COAST_DT s), coast(t) (LVLH at t, interpolated) }.
 */
export function coastToApoapsis(cut) {
  const st = { r: cut.r, th: cut.th, vr: cut.vr, vt: cut.vt };
  const csm0 = csmAngle(cut.t);
  const o = orbitOf(st.r, st.vr, st.vt);
  const period = Number.isFinite(o.a) ? 2 * Math.PI * Math.sqrt((o.a * o.a * o.a) / MU) : 0;
  const table = [lvlhOf(st.r, st.th, st.vr, st.vt, csm0)];
  let t = 0;
  let csiAt = null;
  let csi = null;
  // an apoapsis just behind (vr already falling): the next one, a period on
  let armed = st.vr > 0;
  while (t < period * 1.05 + COAST_DT) {
    const prev = { ...st };
    rk4(st, 0, 0, COAST_DT);
    t += COAST_DT;
    if (armed && prev.vr > 0 && st.vr <= 0) {
      const f = prev.vr / (prev.vr - st.vr);
      const ex = { ...prev };
      rk4(ex, 0, 0, f * COAST_DT);
      csiAt = t - COAST_DT + f * COAST_DT;
      csi = lvlhOf(ex.r, ex.th, ex.vr, ex.vt, csm0 + CSM_N * csiAt);
      break;
    }
    if (!armed && st.vr > 0) armed = true;
    table.push(lvlhOf(st.r, st.th, st.vr, st.vt, csm0 + CSM_N * t));
  }
  if (csiAt == null) {
    csiAt = t;
    csi = lvlhOf(st.r, st.th, st.vr, st.vt, csm0 + CSM_N * t);
  }
  const coast = (tt) => {
    if (tt >= csiAt) return csi.slice();
    const i = Math.max(0, Math.min(table.length - 1, Math.floor(tt / COAST_DT)));
    const a = table[i];
    const b = i + 1 < table.length ? table[i + 1] : csi;
    const span = i + 1 < table.length ? COAST_DT : Math.max(1e-6, csiAt - i * COAST_DT);
    const u = Math.max(0, Math.min(1, (tt - i * COAST_DT) / span));
    return a.map((v, k) => v + (b[k] - v) * u);
  };
  return { csiAt, csi, table, coast };
}

/** The rendezvous guidance's plan from an engine cutoff (data/rendezvous planRendezvous). */
export function rendezvousFromCutoff(difficulty, cut) {
  const c = coastToApoapsis(cut);
  return planRendezvous(difficulty, { insertion: { csiAt: c.csiAt, csi: c.csi, coast: c.coast } });
}

/** Δv the stage can still make for the rendezvous: the ascent engine's propellant left, plus the RCS reserve. */
export const rendezvousBudget = (cut) => (cut.prop > 0 ? VE * Math.log(cut.mass / (cut.mass - cut.prop)) : 0) + RCS_RENDEZVOUS_DV;

/**
 * The orbit the engine left, judged (pure): { ok, failure, apo, peri (m above the surface),
 * apoError (m from the target), fuelKg, fuelPct, rendezvous: { dv, budget, feasible }, cut }.
 *   failure  "premature"    cut off below a stable orbit (the stage falls back)
 *            "depleted"     propellant exhausted below a stable orbit
 *            "apoHigh"      a stable orbit, but reaching above the CSM's (the rendezvous needs it below)
 *            "rendezvous"   a stable orbit the rendezvous cannot fly with the propellant left
 *            "phasing"      a stable orbit, but not below and behind the CSM when the
 *                           rendezvous would start (rendezvous.reason "ahead": too low, it has
 *                           passed the CSM), or too slow to close within five orbits ("slow")
 */
export function evaluateInsertion(s) {
  const o = orbitOf(s.r, s.vr, s.vt);
  const cut = cutoffRecord(s);
  const base = {
    apo: o.ha,
    peri: o.hp,
    ecc: o.e,
    apoError: o.ha - TARGET.apo,
    fuelKg: s.prop,
    fuelPct: (100 * s.prop) / STAGE.prop,
    burn: s.cutoffAt,
    cutoffBy: s.cutoffBy,
    cut,
  };
  if (!(o.hp >= TARGET.safePeri)) return { ...base, ok: false, failure: s.engine === "depleted" ? "depleted" : "premature" };
  if (!(o.ha <= TARGET.apoLimit)) return { ...base, ok: false, failure: "apoHigh" };
  const plan = rendezvousFromCutoff(s.difficulty, cut);
  const budget = rendezvousBudget(cut);
  const rv = { dv: plan.totalDv, budget, feasible: plan.feasible, reason: plan.reason || null, csiAt: plan.csiAt, tpiAt: plan.tpiAt, total: plan.total };
  if (!plan.feasible) return { ...base, ok: false, failure: "phasing", rendezvous: rv };
  if (plan.totalDv > budget) return { ...base, ok: false, failure: "rendezvous", rendezvous: rv };
  return { ...base, ok: true, failure: null, rendezvous: rv, accuracy: accuracyOf(o.ha, o.hp) };
}

/**
 * How close the insertion came to the target orbit (apoapsis 96 km, periapsis 18 km or more):
 * the apoapsis miss and any periapsis shortfall, in km, and a grade.
 */
export function accuracyOf(ha, hp) {
  const miss = Math.abs(ha - TARGET.apo) / 1000 + Math.max(0, TARGET.peri - hp) / 1000;
  const grade = miss <= 2 ? "PRECISE" : miss <= 6 ? "GOOD" : miss <= 15 ? "FAIR" : "WIDE";
  return { miss: +miss.toFixed(2), grade };
}

/**
 * Time to go to the cutoff (s): how long the engine must still burn, along the stage's present
 * thrust direction, for the apoapsis to reach the target (Apollo's ascent program displayed such a
 * TGO). The extra speed is found on the conic (bisection), the time from the rocket equation.
 * Null when not burning, already there, or the target cannot be reached this way.
 */
export function cutoffTgo(s) {
  if (s.engine !== "on") return null;
  const o = orbitOf(s.r, s.vr, s.vt);
  if (o.ha >= TARGET.apo) return 0;
  const cr = Math.cos(s.pitch);
  const ct = Math.sin(s.pitch);
  const haAt = (k) => orbitOf(s.r, s.vr + k * cr, s.vt + k * ct).ha;
  const kMax = dvLeft(s);
  if (!(haAt(kMax) >= TARGET.apo)) return null;
  let lo = 0;
  let hi = kMax;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (haAt(mid) >= TARGET.apo) hi = mid;
    else lo = mid;
  }
  return (s.mass / MDOT) * (1 - Math.exp(-hi / VE));
}

/* ---- telemetry (what the HUD shows: all of it read from the state) ---------------------------- */
/** The ascent's messages, in flight order. */
export const ASCENT_STEPS = ["IGNITION", "VERTICAL", "PITCH", "HORIZONTAL", "INSERTION", "CUTOFF", "ORBIT", "RENDEZVOUS"];

/** The flight's step now (ASCENT_STEPS), from the state. */
export function stepOf(s) {
  if (s.status === "orbit") return "ORBIT";
  if (s.engine === "armed") return "IGNITION";
  if (s.engine !== "on") return "CUTOFF";
  const o = orbitOf(s.r, s.vr, s.vt);
  if (s.t < VERTICAL_RISE) return "VERTICAL";
  if (s.pitch < 30 * DEG && s.vt < 300) return "PITCH";
  if (o.ha < TARGET.apo * 0.75) return "HORIZONTAL";
  return "INSERTION";
}

export function telemetry(s) {
  const o = orbitOf(s.r, s.vr, s.vt);
  const g = guidancePitch(s);
  const alt = altOf(s);
  // the flight path angle (above the local horizontal)
  const fpa = Math.atan2(s.vr, Math.max(1e-6, s.vt));
  const lvlh = toLvlh(s);
  return {
    t: s.t,
    alt,
    vr: s.vr,
    vt: s.vt,
    v: Math.hypot(s.vr, s.vt),
    pitch: s.pitch / DEG,
    rate: (s.rate - s.vt / s.r) / DEG, // the pitch rate the pilot sees (relative to the local vertical)
    fpa: s.lifted ? fpa / DEG : 90,
    downrange: s.th * R_MOON,
    fuelKg: s.prop,
    fuelPct: (100 * s.prop) / STAGE.prop,
    burnLeft: s.prop / MDOT,
    dvLeft: s.prop > 0 ? dvLeft(s) : 0,
    rcsKg: s.rcs,
    rcsPct: (100 * s.rcs) / STAGE.rcsProp,
    rcsFiring: s.rcsFiring,
    engine: s.engine,
    apo: o.ha,
    peri: o.hp,
    ecc: o.e,
    orbital: o.hp >= TARGET.safePeri,
    marginal: marginal(s),
    guidance: s.cfg.cue && s.engine === "on" ? { pitch: s.t < VERTICAL_RISE ? 0 : g.pitch / DEG, tgo: g.tgo, cutoff: cutoffDue(s), cutoffIn: o.ha > 0.5 * TARGET.apo ? cutoffTgo(s) : null } : null,
    step: stepOf(s),
    status: s.status,
    failure: s.failure,
    assist: s.assist,
    autoCutoff: s.autoCutoff,
    pitchProgram: s.pitchProgram,
    csmRange: Math.hypot(lvlh[0], lvlh[1]),
    csmX: lvlh[0],
    csmY: lvlh[1],
    mass: s.mass,
  };
}

/* ---- the reference flight, the CSM's phase, deterministic runs --------------------------------- */
/**
 * Fly an ascent from the pad with `program(state, telemetry) → input` called every step (20 ms of
 * mission time), until the orbit is judged or the flight is lost (or `maxT`). Pure and
 * deterministic: the same program always gives the same flight. Returns { state, log }.
 */
export function simulate(program, { difficulty = "ASTRONAUT", maxT = 900, every = 1 } = {}) {
  const s = createAscent(difficulty);
  const log = [];
  let n = 0;
  advance(s, { ignite: true }, DT);
  while (s.status === "flight" && s.t < maxT) {
    const inp = program(s, telemetry(s)) || {};
    advance(s, inp, DT);
    if (n++ % Math.max(1, Math.round(every / DT)) === 0) log.push(telemetry(s));
  }
  log.push(telemetry(s));
  return { state: s, log };
}

/**
 * The guidance flown perfectly (attitude hold on the computed pitch, cutoff on the target
 * apoapsis): the profile the cues show and the CSM's phase is set from. The pilot's commands
 * here are the same RCS inputs a player has (a pitch control towards the guidance's pitch).
 */
export function guidanceProgram(s) {
  const g = guidancePitch(s);
  const err = g.pitch - s.pitch;
  return { pitch: s.t < VERTICAL_RISE ? 0 : Math.max(-1, Math.min(1, err * 4)), cutoff: cutoffDue(s) };
}

let CSM_PHASE = null; // solved on first use (the reference flight is flown once, ~20k steps)
/**
 * How far behind the CSM the reference flight is at the co-elliptic burn (m, LVLH y). A lower
 * insertion gains on the CSM faster on the way to its apoapsis, a higher one slower: 150 km
 * leaves room for both (apoapsis ~78–105 km), about one orbit of catching up, as on Apollo.
 */
export const CSI_BEHIND = -150000;
const referenceOnce = (() => {
  let ref = null;
  return () => {
    if (ref) return ref;
    const run = simulate(guidanceProgram, { difficulty: "ASTRONAUT" });
    ref = run.state;
    return ref;
  };
})();
/**
 * The CSM's phase: from the reference flight's cutoff the stage coasts to its apoapsis, where
 * the rendezvous's co-elliptic burn comes; the CSM is placed so that the stage is then
 * CSI_BEHIND behind it, 14 km below (the guided rendezvous's co-elliptic height).
 */
function solvePhase() {
  CSM_PHASE = 0; // while the reference is flown (its own judgement is not used)
  const s = referenceOnce();
  const c = coastToApoapsis(cutoffRecord(s));
  // with phase 0, y at the burn is c.csi[1]; moving the CSM ahead by Δ lowers it by ORBIT_R Δ
  CSM_PHASE = (c.csi[1] - CSI_BEHIND) / ORBIT_R;
}

export const csmPhase = () => {
  if (CSM_PHASE === null) solvePhase();
  return CSM_PHASE;
};
/** The reference flight (the guidance flown perfectly): cutoff time, orbit, propellant left. */
export function referenceFlight() {
  const s = referenceOnce();
  return { cutoffAt: s.cutoffAt, apo: orbitOf(s.r, s.vr, s.vt).ha, peri: orbitOf(s.r, s.vr, s.vt).hp, fuelKg: s.prop, downrange: s.th * R_MOON };
}

/* ---- the NAV display's trajectory (pure) ------------------------------------------------------ */
/**
 * The stage's position in the orbit's plane, Moon-centred (m): x downrange, y up through the
 * landing site (the site is at [0, R_MOON]).
 */
export const planePos = (r, th) => [r * Math.sin(th), r * Math.cos(th)];

/**
 * The conic the stage is on now, as points in planePos coordinates from its present position
 * forwards (`n` points over one revolution, or until it meets the surface): what the NAV display
 * draws as the predicted trajectory. Pure two-body: no thrust is assumed after this instant.
 */
export function orbitPath(r, th, vr, vt, n = 180) {
  const p = planePos(r, th);
  const rhat = [Math.sin(th), Math.cos(th)];
  const that = [Math.cos(th), -Math.sin(th)]; // downrange
  const v = [vr * rhat[0] + vt * that[0], vr * rhat[1] + vt * that[1]];
  const h = p[0] * v[1] - p[1] * v[0]; // z of p × v (negative: clockwise, downrange)
  const v2 = v[0] * v[0] + v[1] * v[1];
  const rv = p[0] * v[0] + p[1] * v[1];
  const ev = [((v2 - MU / r) * p[0] - rv * v[0]) / MU, ((v2 - MU / r) * p[1] - rv * v[1]) / MU];
  const e = Math.hypot(ev[0], ev[1]);
  const semi = (h * h) / MU;
  const out = [p];
  if (Math.abs(h) < 1e-3) return out; // a straight-up flight: no conic to draw
  const dir = h < 0 ? -1 : 1; // the sense of motion (angles grow anticlockwise with h > 0)
  const ang0 = Math.atan2(p[1], p[0]);
  const peri = e > 1e-6 ? Math.atan2(ev[1], ev[0]) : ang0;
  const span = e < 1 ? 2 * Math.PI : Math.acos(Math.max(-1, -1 / e)) * 2 * 0.98;
  for (let i = 1; i <= n; i++) {
    const ang = ang0 + (dir * span * i) / n;
    const nu = ang - peri;
    const den = 1 + e * Math.cos(nu);
    if (den <= 1e-6) break;
    const rr = semi / den;
    if (!Number.isFinite(rr) || rr > 50 * R_MOON) break;
    const q = [rr * Math.cos(ang), rr * Math.sin(ang)];
    out.push(q);
    if (rr <= R_MOON) break; // meets the surface
  }
  return out;
}

/**
 * After the engine has stopped and the orbit is judged, the stage coasts on along its conic for
 * the display (two-body, engine off, the attitude held; never below the surface). The judgement
 * (state.evaluation, its cutoff record) is not touched.
 */
export function drift(s, dt) {
  const coasting = s.status === "orbit" || (s.status === "failed" && s.failure && s.failure.kind !== "impact" && s.engine !== "on");
  if (!coasting || s.r <= R_MOON) return s;
  s.acc += Math.max(0, Math.min(dt, 1));
  const n = Math.floor(s.acc / DT + 1e-6);
  s.acc = Math.max(0, s.acc - n * DT);
  for (let i = 0; i < n; i++) {
    const thDot = s.vt / s.r;
    rk4(s, 0, 0, DT);
    s.rate = thDot;
    s.t += DT;
    if (s.r <= R_MOON) {
      s.r = R_MOON;
      s.vr = 0;
      s.vt = 0;
      break;
    }
  }
  return s;
}
