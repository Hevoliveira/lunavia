/*
 * LUNAVIA — lunar-orbit docking: the physics (pure; unit-tested).
 *
 * The player flies the lunar module's ascent stage onto the command and
 * service module (CSM) waiting in lunar orbit. Everything here is the one
 * authoritative state: the HUD, the guidance displays, the 3D scene and the
 * docking verdict all read it, nothing is animated beside it.
 *
 * **Frame.** Metres, the CSM's own model frame (data/csmDesign): +Y along the
 * stack from the service module's engine to the command module's nose, the
 * docking ring at DOCK_Y and the probe tip PROBE_L beyond it. The CSM holds
 * its attitude in the local orbital frame (LVLH), its probe pointing back
 * along the orbit (−V-bar) at the approaching ascent stage, its +Z radially
 * out (away from the Moon) and its +X across the orbit. So, LVLH ↔ CSM frame:
 *   radial out x_l = +Z,  along-track y_l = −Y,  cross-track z_l = +X.
 *
 * **Relative motion.** The ascent stage's centre moves relative to the CSM
 * under the Clohessy–Wiltshire equations of a circular lunar orbit (110 km,
 * period ≈ 2 h): over a docking approach the coupling is small but real, a
 * drift the pilot has to keep nulling. Its own RCS adds what the pilot
 * commands, in its body axes.
 *
 * **Attitude.** A quaternion (body → CSM frame) and a body angular velocity:
 * RCS torques give angular accelerations, nothing damps them unless the
 * digital autopilot's attitude hold is on (CADET and ASTRONAUT) or the pilot
 * counters them (COMMANDER). Body axes are the lunar module's (data/lmDesign):
 * +Y up through the docking tunnel and drogue, +Z forward (the hatch), +X
 * to the right. Docked, the ascent stage sits upside down on the probe
 * (data/csmDesign dockedLmPose): its +Y along the CSM's −Y, its +Z along +Z.
 *
 * **Docking.** The probe tip meets the drogue in the ascent stage's tunnel.
 * At the instant the tip crosses the drogue's ring plane the contact is
 * judged on the real geometry: the tip's offset from the drogue's axis, the
 * angle between the two docking axes, the roll, the closing and lateral
 * speeds at the port and the angular rates. Inside the difficulty's
 * tolerances the probe latches (capture), then retracts to a hard dock.
 * Outside them the probe is deflected and the two vehicles push apart
 * (recoverable), unless the impact is too hard (structural damage). The
 * ascent stage's hull (cabin corners, RCS quads, propellant pods) striking
 * the CSM's hull is a collision.
 */

/* ---- geometry (metres) ----------------------------------------------------------- */
export const DOCK_Y = 0.765 * 3.9; // CSM docking ring (csmDesign CM_TOP)
export const PROBE_L = 0.78; // probe beyond the ring
export const PROBE_TIP = [0, DOCK_Y + PROBE_L, 0];
export const LM_UNIT = 4.8; // lunar module model units → metres
// The ascent stage's centre (the pivot of its rotation) in LM model units.
export const ASC_CENTRE_U = [0, 0.6, -0.03];
// The drogue ring, in the ascent stage's body frame (from the centre): straight up the tunnel.
export const PORT_B = [0, (0.905 - ASC_CENTRE_U[1]) * LM_UNIT, 0];
export const DROGUE_R = 0.088 * LM_UNIT; // the drogue cone's mouth (0.42 m): outside it the probe hits the deck
export const DOCKED_POS = [0, DOCK_Y + PORT_B[1], 0];
// Docked attitude: π about Z (body +Y → −Y, +X → −X, +Z → +Z).
export const DOCKED_Q = [0, 0, 1, 0]; // [x, y, z, w]

// The CSM's hull: radius at height y (command module cone, service module drum).
const CM = [
  [0.5, 0.06],
  [0.49, 0.075],
  [0.14, 0.62],
  [0.105, 0.64],
  [0.1, 0.75],
  [0.07, 0.765],
].map(([r, y]) => [r * 3.9, y * 3.9]);
const SM = { bottom: -4.85, top: CM[0][1], r: 1.95 };
export function csmRadiusAt(y) {
  if (y < SM.bottom || y > DOCK_Y) return 0;
  if (y <= CM[0][1]) return SM.r;
  for (let i = 1; i < CM.length; i++) {
    const [r1, y1] = CM[i];
    const [r0, y0] = CM[i - 1];
    if (y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return 0;
}

// The ascent stage's hull points (body frame, from its centre): the cabin's corners,
// the RCS quads, the propellant pods' ends and the top deck around the drogue.
const u = (x, y, z) => [x * LM_UNIT, (y - ASC_CENTRE_U[1]) * LM_UNIT, (z - ASC_CENTRE_U[2]) * LM_UNIT];
export const HULL_B = [
  ...[-0.3, 0.3].flatMap((x) => [u(x, 0.84, 0.1), u(x, 0.84, -0.18), u(x, 0.375, 0.2), u(x, 0.375, -0.24), u(x, 0.62, 0.29), u(x, 0.78, -0.24)]),
  ...[
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ].map(([sx, sz]) => u(sx * 0.43, 0.7, sz > 0 ? 0.17 : -0.21)),
  ...[-1, 1].flatMap((s) => [u(s * 0.455, 0.5, 0.1), u(s * 0.455, 0.5, -0.2)]),
  ...[0, 1, 2, 3, 4, 5].map((k) => u(0.16 * Math.cos((k * Math.PI) / 3), 0.86, -0.03 + 0.16 * Math.sin((k * Math.PI) / 3))),
];

/* ---- lunar orbit ----------------------------------------------------------------- */
export const MU_MOON = 4.9028e12; // m³/s²
export const ORBIT_R = (1737.4 + 110) * 1000; // the CSM's circular parking orbit
export const MEAN_MOTION = Math.sqrt(MU_MOON / ORBIT_R ** 3); // rad/s (≈ 8.8e-4: period ≈ 1 h 59 min)

/* ---- difficulty ------------------------------------------------------------------ */
const DEG = Math.PI / 180;
/**
 * Per pilot difficulty: RCS authority, propellant, the autopilot's help, the start of the
 * final approach and the capture tolerances. All three are flown to a capture by the
 * reference pilot in the tests, with input lag and pulse-only commands.
 *
 * `assists` are the docking aids the pilot may switch on (see "assists" below):
 *   - align: AUTO-ALIGN, the autopilot turns to and holds the docking attitude;
 *   - stabilize: STABILIZE, the RCS nulls the relative motion — "hold" keeps holding the
 *     velocity the pilot sets (CADET), "once" nulls it and hands back (ASTRONAUT);
 *   - speed: APPROACH SPEED ASSIST, the RCS keeps the closing speed under assistLimit;
 *   - default*: what is on at the start of an attempt.
 * CADET's tolerances are its soft-capture envelope: what the probe's capture latches take
 * in with the drogue's funnel (mouth DROGUE_R) guiding the probe tip in.
 */
export const DOCKING = {
  CADET: {
    accel: 0.1, // m/s² per axis (translation, full command)
    angAccel: 2.5 * DEG, // rad/s² per axis
    maxRate: 5 * DEG,
    prop: 30, // RCS budget, m/s of Δv equivalent
    attHold: true, // rates damp when the pilot lets go
    autoAlign: true, // the autopilot can hold the docking attitude (the pilot still translates)
    assists: { align: true, center: "hold", stabilize: "hold", speed: true, fine: "set", defaultAlign: false, defaultSpeed: true },
    // a calm final approach: on the probe's axis within a metre, barely drifting, a few degrees off
    start: { range: 22, offset: [0.7, -0.5], drift: [0.004, -0.003], closing: 0.03, att: [3, -2, 4], rate: [0, 0, 0] },
    tol: { lateral: 0.36, angle: 9 * DEG, roll: 18 * DEG, vMin: 0.01, vMax: 0.45, vLat: 0.13, rate: 2.5 * DEG },
  },
  ASTRONAUT: {
    accel: 0.08,
    angAccel: 2 * DEG,
    maxRate: 4 * DEG,
    prop: 18,
    attHold: true,
    autoAlign: false,
    assists: { align: false, center: "once", stabilize: "once", speed: false },
    start: { range: 34, offset: [2.6, -2.0], drift: [0.02, -0.018], closing: 0.05, att: [6, -5, 8], rate: [0, 0, 0] },
    tol: { lateral: 0.2, angle: 5 * DEG, roll: 10 * DEG, vMin: 0.025, vMax: 0.3, vLat: 0.07, rate: 1.0 * DEG },
  },
  COMMANDER: {
    accel: 0.07,
    angAccel: 1.6 * DEG,
    maxRate: 3.5 * DEG,
    prop: 12,
    attHold: false, // no rate damping: what the pilot starts, the pilot stops
    autoAlign: false,
    assists: { align: false, center: null, stabilize: null, speed: false }, // no automation
    start: { range: 38, offset: [3.4, -2.8], drift: [0.03, -0.025], closing: 0.06, att: [9, -8, 12], rate: [0.25, -0.2, 0.3] },
    tol: { lateral: 0.14, angle: 3.5 * DEG, roll: 6 * DEG, vMin: 0.03, vMax: 0.22, vLat: 0.05, rate: 0.7 * DEG },
  },
};
export const DIFFICULTY_KEYS = Object.keys(DOCKING);
// Recoverable contact up to this closing speed; above it the docking hardware or the hull is damaged.
export const DAMAGE_SPEED = 0.6;
export const LOST_RANGE = 180; // beyond this the target is lost: back to the rendezvous checkpoint
export const PULSE = 0.12; // a tap: one minimum-impulse RCS firing (s)
export const STEP = 1 / 120;

/* ---- the jet buttons: how a press becomes an RCS command --------------------------------- */
/**
 * The command a jet button gives after it has been held `held` seconds (0..1 of the
 * axis' authority). A tap is one minimum-impulse firing at full thrust (PULSE), as
 * before. Holding on gives a gentle 35 % for a moment, then builds to full thrust over
 * the next 1.4 s: a press that lasts a little longer than meant (the usual thumb on
 * glass) adds a little more, not a burst. FINE scales everything to 35 %: one fine tap
 * is about a third of a normal one, for the last metres.
 */
export const JET_SOFT = 0.35;
export const FINE_SCALE = 0.35;
export function jetCommand(held, fine = false) {
  const k = fine ? FINE_SCALE : 1;
  if (held < PULSE) return k;
  if (held < 0.6) return JET_SOFT * k;
  return Math.min(1, JET_SOFT + ((1 - JET_SOFT) * (held - 0.6)) / 1.4) * k;
}

/* ---- small vector / quaternion maths ---------------------------------------------- */
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.sqrt(dot(a, a));
export const vec = { add, sub, scale, dot, cross, len };

export function qMul(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}
export const qConj = (q) => [-q[0], -q[1], -q[2], q[3]];
export function qNorm(q) {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}
/** Rotate v by q (body → frame). */
export function qRot(q, v) {
  const p = qMul(qMul(q, [v[0], v[1], v[2], 0]), qConj(q));
  return [p[0], p[1], p[2]];
}
export function qAxisAngle(axis, angle) {
  const s = Math.sin(angle / 2);
  const n = len(axis) || 1;
  return [(axis[0] / n) * s, (axis[1] / n) * s, (axis[2] / n) * s, Math.cos(angle / 2)];
}
/** Small-angle rotation vector of q (body axes), shortest way round. */
export function qToRotVec(q) {
  let [x, y, z, w] = q;
  if (w < 0) {
    x = -x;
    y = -y;
    z = -z;
    w = -w;
  }
  const s = Math.sqrt(x * x + y * y + z * z);
  if (s < 1e-9) return [0, 0, 0];
  const ang = 2 * Math.atan2(s, w);
  return [(x / s) * ang, (y / s) * ang, (z / s) * ang];
}
/** Attitude error of q from the docked attitude, in body axes: [pitch about X, roll about Y, yaw about Z] (rad). */
export const attitudeError = (q) => qToRotVec(qMul(qConj(DOCKED_Q), q));

/* ---- relative motion: Clohessy–Wiltshire in the CSM frame --------------------------- */
const toL = (s) => [s[2], -s[1], s[0]]; // CSM frame → LVLH (radial, along-track, cross-track)
const fromL = (l) => [l[2], -l[1], l[0]];
export const frames = { toL, fromL };
/** Gravity-gradient and Coriolis acceleration of the relative motion (CSM frame), n the mean motion. */
export function cwAccel(pos, vel, n = MEAN_MOTION) {
  const [x, , z] = toL(pos);
  const [vx, vy] = toL(vel);
  return fromL([3 * n * n * x + 2 * n * vy, -2 * n * vx, -n * n * z]);
}

/* ---- the state ------------------------------------------------------------------- */
/**
 * The final-approach checkpoint (the rendezvous hands over here, and a retry
 * starts here): the ascent stage on the probe's axis `range` metres out, a little off
 * the axis, drifting slowly, its attitude a few degrees off the docking attitude.
 */
export function checkpointState(difficulty = "ASTRONAUT", over = {}) {
  const cfg = DOCKING[difficulty];
  const s = { ...cfg.start, ...over };
  const [ox, oz] = s.offset;
  const pos = [ox, PROBE_TIP[1] + PORT_B[1] + s.range, oz];
  const vel = [s.drift[0], -s.closing, s.drift[1]];
  const [p, r, y] = s.att.map((a) => a * DEG);
  const q = qNorm(qMul(DOCKED_Q, qMul(qAxisAngle([0, 0, 1], y), qMul(qAxisAngle([1, 0, 0], p), qAxisAngle([0, 1, 0], r)))));
  return {
    t: 0,
    pos,
    vel,
    q,
    w: s.rate.map((a) => a * DEG),
    prop: cfg.prop,
    status: "approach", // approach | captured | docked | failed
    phase: "ACQUIRE",
    contacts: 0, // deflected contacts so far (recoverable)
    lastContact: null, // { kind, ... } of the latest contact or failure
    failure: null,
    captureT: null,
    fired: { t: [0, 0, 0], r: [0, 0, 0] }, // what the RCS fired on the last step (for the plume puffs)
  };
}

/**
 * RESTART DOCKING (and the retry after a failure): put an existing state back on
 * the final-approach checkpoint, in place. Every docking field is rebuilt from
 * checkpointState — position, velocity, attitude, rates, the simulation clock,
 * the RCS budget (refilled, as the retry always has: each attempt starts with
 * the difficulty's full budget), the contact count, the capture and failure
 * state — and anything else the last attempt left on the object (capture pose,
 * propellant-out timer, tooling) is removed. Only the fields listed in `keep`
 * survive: the scene's own clocks and mode, not physics. There is no damage
 * carried between attempts: a damaging contact ends the attempt, and the next
 * one starts on an intact vehicle.
 */
export const RESTART_KEEP = ["mode", "missionT", "play", "checkpoint"];
export function restoreCheckpoint(s, difficulty = "ASTRONAUT", keep = RESTART_KEEP, over = null) {
  // `over`: a training scenario's own start (data/trainingScenarios DOCKING_SCENARIOS)
  const cp = checkpointState(difficulty, over || {});
  const kept = {};
  keep.forEach((k) => {
    if (k in s) kept[k] = s[k];
  });
  Object.keys(s).forEach((k) => delete s[k]);
  return Object.assign(s, cp, kept);
}

/** The drogue (ascent stage's port) and its axis, and the port's velocity, in the CSM frame. */
export function portState(s) {
  const pB = qRot(s.q, PORT_B);
  const port = add(s.pos, pB);
  const wF = qRot(s.q, s.w);
  const vPort = add(s.vel, cross(wF, pB));
  const axis = qRot(s.q, [0, 1, 0]);
  return { port, axis, vPort };
}

/**
 * Everything the HUD and the guidance show, from the state alone:
 * range from the drogue to the probe tip, closing speed along the docking axis,
 * the drogue's offset from the axis and its lateral speed (in the pilot's
 * screen terms: right = −X, up = +Z of the CSM frame, as seen from the docked
 * attitude), the attitude error and the line of sight to the probe tip.
 */
export function telemetry(s, difficulty = "ASTRONAUT") {
  const cfg = DOCKING[difficulty];
  const { port, axis, vPort } = portState(s);
  const toTip = sub(PROBE_TIP, port);
  const range = len(toTip);
  const axial = port[1] - PROBE_TIP[1]; // along the docking axis, from the tip
  const err = attitudeError(s.q);
  const tip = qRot(qConj(s.q), toTip); // the tip seen from the drogue (body axes)
  const lim = closingLimit(Math.max(0, axial), cfg);
  const angle = Math.acos(Math.max(-1, Math.min(1, -axis[1])));
  return {
    range,
    axial,
    closing: -vPort[1],
    offset: [-port[0], port[2]], // right, up (m)
    offsetR: Math.hypot(port[0], port[2]),
    vLat: [-vPort[0], vPort[2]], // right, up (m/s)
    vLatR: Math.hypot(vPort[0], vPort[2]),
    pitch: err[0],
    roll: err[1],
    yaw: err[2],
    angle, // between the drogue's axis and the probe's axis
    rate: len(s.w),
    los: [Math.atan2(tip[0], tip[1]), Math.atan2(tip[2], tip[1])], // tip right / up of the boresight (rad)
    prop: s.prop,
    propFrac: s.prop / cfg.prop,
    closingLimit: lim,
  };
}

/** Safe closing speed by axial distance: slower as the ports close (m/s). */
export function closingLimit(axial, cfg) {
  return Math.min(1.2, cfg.tol.vMax + 0.02 * axial);
}

/**
 * The HUD's status line and warnings, derived from the telemetry
 * (RENDEZVOUS COMPLETE is the handover message shown before the first step).
 */
export function dockingStatus(s, difficulty = "ASTRONAUT") {
  if (s.status === "docked") return { phase: "HARD DOCK CONFIRMED", warnings: [] };
  if (s.status === "captured") return { phase: "SOFT CAPTURE", warnings: [] };
  if (s.status === "failed") return { phase: s.failure ? s.failure.title : "DOCKING FAILED", warnings: [] };
  const cfg = DOCKING[difficulty];
  const m = telemetry(s, difficulty);
  const warnings = [];
  if (m.closing > m.closingLimit) warnings.push("REDUCE CLOSING VELOCITY");
  if (m.closing < -0.02 && m.axial < 20) warnings.push("OPENING");
  if (m.vLatR > cfg.tol.vLat * (m.axial < 4 ? 1 : 2)) warnings.push("LATERAL DRIFT");
  if (m.angle > cfg.tol.angle * (m.axial < 4 ? 1 : 2.5)) warnings.push("ALIGN ATTITUDE");
  if (m.offsetR > Math.max(cfg.tol.lateral, 0.12 * m.axial)) warnings.push("OFF AXIS");
  if (m.propFrac < 0.15) warnings.push(s.prop <= 0 ? "RCS PROPELLANT DEPLETED" : "RCS PROPELLANT LOW");
  let phase;
  if (m.axial > 15) phase = m.offsetR > 1 || m.angle > cfg.tol.angle * 2 ? "ACQUIRE DOCKING TARGET" : "ALIGN WITH DOCKING PORT";
  else if (m.closing > m.closingLimit) phase = "REDUCE CLOSING VELOCITY";
  else if (m.offsetR > cfg.tol.lateral * 2 || m.angle > cfg.tol.angle * 1.5) phase = "ALIGN WITH DOCKING PORT";
  else phase = "FINAL APPROACH";
  return { phase, warnings };
}

/* ---- assists: AUTO-ALIGN, STABILIZE, APPROACH SPEED ASSIST --------------------------------- */
/*
 * Every assist flies the same RCS as the pilot: its commands are added to the pilot's,
 * clipped to the same per-axis authority (accel, angAccel) and paid from the same
 * propellant. Nothing is set: velocities and attitude change only through thrust, so
 * the player sees each correction happen. None of them closes in: the forward push is
 * always the pilot's.
 *
 * AUTO-ALIGN (opts.align): the autopilot turns the ascent stage onto the docking
 * attitude (drogue axis along the probe's axis, no roll) and holds it. A held attitude
 * button overrides it while held. It does not move the vehicle sideways.
 *
 * STABILIZE (engageStabilize): the RCS drives the vehicle's velocity to a held value —
 * at first none relative to the CSM (no sideways motion, no closing: the pilot then sets
 * the approach) — and damps any rotation.
 *   - "hold" (CADET): once stable it keeps holding. The pilot's own translation still
 *     fires, and moves the held velocity by exactly what it adds, so a tap sets a new
 *     steady speed; what the assist cancels is the drift nobody commanded (the orbit's
 *     Coriolis and tidal pull, a leftover push).
 *   - "once" (ASTRONAUT): it nulls the motion, reports RELATIVE MOTION STABLE and hands
 *     back; any translation command by the pilot cancels it.
 *
 * On screen STABILIZE is called MATCH VELOCITY: it matches the ascent stage's velocity
 * to the CSM's in the CSM's own rotating orbital frame (the hold cancels the Clohessy–
 * Wiltshire Coriolis and tidal accelerations, which is what keeps "stable" stable). Both
 * vehicles stay in orbit; only the relative motion is managed.
 *
 * AUTO-CENTER (engageCenter): translation, not attitude. The RCS slides the ascent stage
 * sideways until its docking port (the drogue, through the current attitude) is on the
 * probe's approach axis, at a slide speed that falls as the port nears the axis (≤ 6 cm/s,
 * 3 cm/s in the last 3 m), and stops there.
 *   - "hold" (CADET): it then keeps the port on the centreline (the orbit's drift and a
 *     turning attitude would carry it off) until switched off; a sideways command from the
 *     pilot switches it off ("AUTO-CENTER OFF — MANUAL").
 *   - "once" (ASTRONAUT): it centres, says CENTERLINE ACQUIRED and hands back.
 * With MATCH VELOCITY on, AUTO-CENTER sets the held sideways velocity and the hold flies it;
 * on its own it fires the jets itself. It never moves the vehicle along the axis.
 *
 * FINE APPROACH (fineStep, CADET with MATCH VELOCITY holding): FWD and AFT no longer fire
 * a raw pulse each; each press sets the held closing speed 0.02 m/s higher or lower (never
 * below 0 or above the safe speed for the distance), and the hold reaches it with the
 * RCS. A predictable, readable closing speed; the pilot still commands every change.
 *
 * APPROACH SPEED ASSIST (opts.speed): a closing-speed limit that falls with the distance
 * to the probe (assistLimit). Above it the RCS brakes (aft thrust); at it, a forward
 * command is not fired. It never pushes forward.
 */
/** The assists available and switched on now: { align, center, stabilize, speed } (booleans / mode). */
export function assistsOf(difficulty, opts = {}) {
  const a = DOCKING[difficulty].assists || {};
  return { align: !!(a.align && opts.align), center: a.center || null, stabilize: a.stabilize || null, speed: !!(a.speed && opts.speed) };
}
/** Where the docking port is, sideways off the probe's axis (CSM frame X, Z; m). */
export const portOffset = (s) => {
  const p = add(s.pos, qRot(s.q, PORT_B));
  return [p[0], p[2]];
};
/** The port is centred on the approach axis: within this distance of it (the guidance's "lined up"). */
export function centerTolerance(difficulty, axial) {
  return Math.max(0.6 * DOCKING[difficulty].tol.lateral, 0.03 * Math.max(0, axial));
}
/** AUTO-CENTER pressed (see above). */
export function engageCenter(s, difficulty) {
  const mode = (DOCKING[difficulty].assists || {}).center;
  if (!mode || s.status !== "approach") return false;
  s.center = { mode, since: s.t, off0: Math.hypot(...portOffset(s)), centeredSince: null, progress: 0 };
  s.centerEnd = null;
  return true;
}
/** AUTO-CENTER switched off by the pilot. */
export function disengageCenter(s) {
  if (s.center) s.centerEnd = { t: s.t, kind: "off" };
  s.center = null;
}
export const FINE_STEP = 0.02; // m/s per FINE APPROACH press
/**
 * FINE APPROACH: one press of FWD (dir +1) or AFT (−1) moves the held closing speed by
 * FINE_STEP, within 0 … the safe speed for the distance. Returns the new set speed, or
 * null when it does not apply (no MATCH VELOCITY hold, or not CADET).
 */
export function fineStep(s, difficulty, dir, opts = {}) {
  const a = DOCKING[difficulty].assists || {};
  if (a.fine !== "set" || !s.stab || s.stab.mode !== "hold" || s.status !== "approach") return null;
  const ax = axialOf(s);
  const lim = opts.speed && a.speed ? assistLimit(ax) : closingLimit(Math.max(0, ax), DOCKING[difficulty]);
  const cur = -s.stab.v[1];
  const next = Math.max(0, Math.min(lim, Math.round((cur + dir * FINE_STEP) / FINE_STEP) * FINE_STEP));
  s.stab.v[1] = -next;
  s.stab.setT = s.t;
  return next;
}
/** The approach speed assist's closing-speed limit at an axial distance from the probe tip (m/s). */
export function assistLimit(axial) {
  return Math.min(0.45, 0.08 + 0.025 * Math.max(0, axial));
}
const axialOf = (s) => s.pos[1] + qRot(s.q, PORT_B)[1] - PROBE_TIP[1];
/**
 * MATCH VELOCITY (STABILIZE) pressed: match the CSM's velocity — no sideways motion and no
 * closing either (station-keeping on the approach axis), so the final approach always starts
 * with the pilot's own FWD command. Reached through the RCS, never set.
 */
export function engageStabilize(s, difficulty) {
  const mode = (DOCKING[difficulty].assists || {}).stabilize;
  if (!mode || s.status !== "approach") return false;
  s.stab = { mode, v: [0, 0, 0], since: s.t, stableSince: null };
  s.stabEnd = null;
  return true;
}
/** STABILIZE switched off by the pilot. */
export function disengageStabilize(s) {
  if (s.stab) s.stabEnd = { t: s.t, kind: "off" };
  s.stab = null;
}
const STAB_TIME = 1.2; // s: how fast the hold takes out a velocity error
const STAB_DEAD = 0.0005; // m/s: below this no jet fires (no chatter, no waste)
const STABLE_V = 0.004; // m/s and …
const STABLE_W = 0.25 * DEG; // … rad/s: RELATIVE MOTION STABLE
function translationAssists(s, tc, difficulty, as, h) {
  const cfg = DOCKING[difficulty];
  let out = tc.slice();
  const pilotT = tc.some((v) => Math.abs(v) > 0.01);
  const lim = as.speed ? assistLimit(axialOf(s)) : Infinity;
  const toBody = (aF) => qRot(qConj(s.q), aF).map((v) => v / cfg.accel);
  if (s.stab && s.stab.mode === "once" && pilotT) {
    s.stab = null;
    s.stabEnd = { t: s.t, kind: "override" };
  }
  // AUTO-CENTER: the sideways velocity that brings the port onto the axis
  let vCenter = null;
  if (s.center) {
    const aP = qRot(s.q, tc);
    if (Math.hypot(aP[0], aP[2]) > 0.01) {
      // a sideways command from the pilot: centring is theirs now
      s.center = null;
      s.centerEnd = { t: s.t, kind: "override" };
    }
  }
  if (s.center) {
    const off = portOffset(s);
    const r = Math.hypot(off[0], off[1]);
    const ax = axialOf(s);
    const sp = Math.min(ax < 3 ? 0.03 : 0.06, 0.1 * r);
    vCenter = r > 1e-6 ? [(-off[0] / r) * sp, (-off[1] / r) * sp] : [0, 0];
    const ok = r < Math.min(0.08, 0.4 * centerTolerance(difficulty, ax)) && Math.hypot(s.vel[0], s.vel[2]) < 0.01;
    s.center.centeredSince = ok ? (s.center.centeredSince == null ? s.t : s.center.centeredSince) : null;
    s.center.progress = Math.max(0, Math.min(1, 1 - r / Math.max(s.center.off0, 1e-3)));
    s.center.r = r;
    if (s.center.mode === "once" && s.center.centeredSince != null && s.t - s.center.centeredSince > 1) {
      s.center = null;
      s.centerEnd = { t: s.t, kind: "centered" };
      vCenter = null;
    } else if (!s.stab) {
      // on its own: fire the sideways jets towards that velocity (the axial velocity is left alone)
      const e = [s.vel[0] - vCenter[0], 0, s.vel[2] - vCenter[1]];
      const want = e.map((v) => (Math.abs(v) < STAB_DEAD ? 0 : -v / STAB_TIME));
      const c = toBody(want);
      out = out.map((v, i) => Math.max(-1, Math.min(1, v + c[i])));
    }
  }
  if (s.stab) {
    // the pilot's own Δv moves the held velocity ("hold"): what they command, they keep
    if (s.stab.mode === "hold") {
      s.stab.v = add(s.stab.v, scale(qRot(s.q, scale(tc, cfg.accel)), h));
      // a manageable slide: the hold keeps at most 6 cm/s sideways (3 cm/s in the last 3 m);
      // a longer push than that is taken back out instead of kept
      const ax = axialOf(s);
      const vmax = ax < 3 ? 0.03 : 0.06;
      const vl = Math.hypot(s.stab.v[0], s.stab.v[2]);
      if (vl > vmax) {
        s.stab.v[0] *= vmax / vl;
        s.stab.v[2] *= vmax / vl;
      }
    }
    if (vCenter) {
      // AUTO-CENTER sets the held sideways velocity; the hold flies it
      s.stab.v[0] = vCenter[0];
      s.stab.v[2] = vCenter[1];
    }
    if (as.speed) s.stab.v[1] = Math.max(s.stab.v[1], -lim); // never hold a closing speed above the limit
    const e = sub(s.vel, s.stab.v);
    const want = e.map((v) => (Math.abs(v) < STAB_DEAD ? 0 : -v / STAB_TIME));
    const c = toBody(want);
    out = out.map((v, i) => Math.max(-1, Math.min(1, v + c[i])));
    // stable: no sideways error and no rotation; along the axis, close to the held speed (the
    // speed assist lowering it as the ports close is the plan, not instability)
    const stable = Math.hypot(e[0], e[2]) < STABLE_V && Math.abs(e[1]) < 0.03 && len(s.w) < STABLE_W;
    s.stab.stableSince = stable ? (s.stab.stableSince == null ? s.t : s.stab.stableSince) : null;
    if (s.stab.mode === "once" && s.stab.stableSince != null && s.t - s.stab.stableSince > 1) {
      s.stab = null;
      s.stabEnd = { t: s.t, kind: "stable" };
    }
  }
  s.speedLimiting = false;
  if (as.speed) {
    // the axial component of what is about to fire (CSM frame: +Y is away from the probe)
    const aF = qRot(s.q, scale(out, cfg.accel));
    const closing = -s.vel[1];
    let wantY = aF[1];
    if (closing > lim) wantY = Math.max(aF[1], Math.min(cfg.accel, (closing - lim) / 0.8)); // brake
    else if (aF[1] < 0 && closing - aF[1] * h > lim) wantY = Math.min(0, (closing - lim) / h); // no push past the limit
    if (Math.abs(wantY - aF[1]) > 1e-9) {
      const c = toBody([0, wantY - aF[1], 0]);
      out = out.map((v, i) => Math.max(-1, Math.min(1, v + c[i])));
      s.speedLimiting = true;
    }
  }
  return out;
}
/**
 * What each assist is doing this step, for the HUD and the guidance:
 * { align: off|active|aligned|override, stabilize: off|active|stable|override|done,
 *   speed: off|ready|limiting }.
 */
function assistStatus(s, difficulty, as, { manualR }) {
  const t = DOCKING[difficulty].tol;
  const err = attitudeError(s.q);
  const angle = Math.acos(Math.max(-1, Math.min(1, -qRot(s.q, [0, 1, 0])[1])));
  const aligned = angle < 0.4 * t.angle && Math.abs(err[1]) < 0.4 * t.roll && len(s.w) < 0.2 * DEG;
  let stab = "off";
  if (s.stab) stab = s.stab.stableSince != null ? "stable" : "active";
  else if (s.stabEnd && s.t - s.stabEnd.t < 3) stab = s.stabEnd.kind === "stable" ? "done" : s.stabEnd.kind === "override" ? "override" : "off";
  let center = "off";
  if (s.center) center = s.center.centeredSince != null ? "centered" : "active";
  else if (s.centerEnd && s.t - s.centerEnd.t < 3) center = s.centerEnd.kind === "centered" ? "done" : s.centerEnd.kind === "override" ? "override" : "off";
  return {
    align: !as.align ? "off" : manualR ? "override" : aligned ? "aligned" : "active",
    center,
    centerProgress: s.center ? s.center.progress : null,
    centerOff: Math.hypot(...portOffset(s)),
    stabilize: stab,
    setClosing: s.stab && s.stab.mode === "hold" ? -s.stab.v[1] : null,
    speed: !as.speed ? "off" : s.speedLimiting ? "limiting" : "ready",
  };
}

/* ---- contact ----------------------------------------------------------------------- */
/** The CSM-frame point is inside the CSM's hull (with a margin for the HGA-less outline). */
const insideCsm = (p) => Math.hypot(p[0], p[2]) < csmRadiusAt(p[1]);

/**
 * Judge the probe tip's arrival at the drogue's ring plane: capture, or why not.
 * Returns { kind: "capture" } or { kind, title, detail, recoverable }.
 */
export function judgeContact(s, difficulty = "ASTRONAUT") {
  const cfg = DOCKING[difficulty];
  const t = cfg.tol;
  const { port, axis, vPort } = portState(s);
  const tipB = qRot(qConj(s.q), sub(PROBE_TIP, port));
  const lateral = Math.hypot(tipB[0], tipB[2]);
  const angle = Math.acos(Math.max(-1, Math.min(1, -axis[1])));
  const roll = Math.abs(attitudeError(s.q)[1]);
  const closing = -vPort[1];
  const vLat = Math.hypot(vPort[0], vPort[2]);
  const rate = len(s.w);
  const facts = { lateral, angle, roll, closing, vLat, rate };
  if (closing > DAMAGE_SPEED) return { kind: "damage", title: "HARD IMPACT — DOCKING MECHANISM DAMAGED", recoverable: false, facts };
  if (lateral > DROGUE_R) return { kind: "outside", title: "PROBE STRUCK OUTSIDE THE DROGUE", recoverable: true, facts };
  const reasons = [];
  if (lateral > t.lateral) reasons.push("OFF AXIS");
  if (angle > t.angle) reasons.push("MISALIGNED");
  if (roll > t.roll) reasons.push("ROLL");
  if (closing > t.vMax) reasons.push("TOO FAST");
  if (closing < t.vMin) reasons.push("TOO SLOW TO LATCH");
  if (vLat > t.vLat) reasons.push("LATERAL DRIFT");
  if (rate > t.rate) reasons.push("ROTATING");
  if (reasons.length) return { kind: "deflected", title: `NO CAPTURE — ${reasons[0]}`, reasons, recoverable: true, facts };
  return { kind: "capture", facts };
}

/** Push the two vehicles apart after a deflected contact: the axial speed reverses at a fraction. */
function rebound(s, restitution = 0.35) {
  const { vPort } = portState(s);
  const vn = vPort[1]; // < 0 when closing
  s.vel = add(s.vel, [0, -(1 + restitution) * vn, 0]);
  s.w = scale(s.w, 0.6);
}

/* ---- one step ---------------------------------------------------------------------- */
/**
 * Advance the state by dt (s). `input` = { t: [x, y, z], r: [x, y, z] } body
 * translation and rotation commands in −1..1 (t[1] > 0 forward, towards the
 * port; r[0] pitch, r[1] roll, r[2] yaw about the body axes), `align` asks the
 * autopilot to hold the docking attitude (CADET only). Returns the event of this
 * step, if any: { kind: "capture" | "deflected" | "outside" | "collision" |
 * "damage" | "lost" | "docked" }.
 */
export function stepDocking(s, input, difficulty = "ASTRONAUT", dt = STEP, opts = {}) {
  const cfg = DOCKING[difficulty];
  if (s.status === "failed" || s.status === "docked") return null;
  let event = null;
  const n = opts.meanMotion != null ? opts.meanMotion : MEAN_MOTION;
  const steps = Math.max(1, Math.ceil(dt / STEP));
  const h = dt / steps;
  for (let k = 0; k < steps && !event; k++) {
    s.t += h;
    if (s.status === "captured") {
      // Probe retraction: the latches hold; the ascent stage is drawn onto the ring and aligned.
      const u = Math.min(1, (s.t - s.captureT) / 6);
      const e = u * u * (3 - 2 * u);
      s.pos = s.capturePos.map((v, i) => v + (DOCKED_POS[i] - v) * e);
      s.q = qNorm(s.captureQ.map((v, i) => v + (DOCKED_Q[i] * Math.sign(dot4(s.captureQ, DOCKED_Q) || 1) - v) * e));
      s.vel = [0, 0, 0];
      s.w = [0, 0, 0];
      if (u >= 1) {
        s.status = "docked";
        s.phase = "HARD DOCK CONFIRMED";
        event = { kind: "docked" };
      }
      continue;
    }
    const inp = input || { t: [0, 0, 0], r: [0, 0, 0] };
    const hasProp = s.prop > 0;
    let tc = hasProp ? inp.t.map((v) => Math.max(-1, Math.min(1, v || 0))) : [0, 0, 0];
    let rc = hasProp ? inp.r.map((v) => Math.max(-1, Math.min(1, v || 0))) : [0, 0, 0];
    const as = assistsOf(difficulty, opts);
    // Autopilot: AUTO-ALIGN (the docking-attitude hold), or the rate damping of attitude hold.
    // The pilot's own attitude command always wins while it is held.
    const manual = rc.some((v) => Math.abs(v) > 0.01);
    if (hasProp && !manual && (cfg.attHold || as.align || s.stab)) {
      const err = as.align ? attitudeError(s.q) : [0, 0, 0];
      // PD towards the target attitude (or zero rate), within the RCS's authority.
      rc = [0, 1, 2].map((i) => Math.max(-1, Math.min(1, (-0.9 * err[i] - 1.6 * s.w[i]) / (cfg.angAccel * 1.0))));
      rc = rc.map((v) => (Math.abs(v) < 0.04 ? 0 : v));
    }
    // STABILIZE and the approach speed assist: RCS translation added to the pilot's, within
    // the same authority, from the same propellant.
    const pilotT = tc.slice();
    if (hasProp) tc = translationAssists(s, tc, difficulty, as, h);
    s.assistOut = assistStatus(s, difficulty, as, { manualR: manual, manualT: pilotT.some((v) => Math.abs(v) > 0.01), pilotT, tc });
    // Translation (body → CSM frame) and the orbit's own pull.
    const aB = scale(tc, cfg.accel);
    const a = add(qRot(s.q, aB), cwAccel(s.pos, s.vel, n));
    s.vel = add(s.vel, scale(a, h));
    s.pos = add(s.pos, scale(s.vel, h));
    // Rotation: body angular acceleration, rates limited by the autopilot's limit.
    s.w = s.w.map((w, i) => Math.max(-cfg.maxRate * 1.5, Math.min(cfg.maxRate * 1.5, w + rc[i] * cfg.angAccel * h)));
    const wn = len(s.w);
    if (wn > 1e-12) s.q = qNorm(qMul(s.q, qAxisAngle(s.w, wn * h)));
    // RCS propellant, as Δv equivalent (rotation costs a fraction of translation).
    const used = (Math.abs(tc[0]) + Math.abs(tc[1]) + Math.abs(tc[2])) * cfg.accel * h + (Math.abs(rc[0]) + Math.abs(rc[1]) + Math.abs(rc[2])) * 0.25 * cfg.accel * h;
    s.prop = Math.max(0, s.prop - used);
    s.fired = { t: tc, r: rc };

    // Contact: the probe tip reaching the drogue's ring plane, or the hulls meeting.
    const { port, axis } = portState(s);
    const tipB = qRot(qConj(s.q), sub(PROBE_TIP, port));
    const facing = -axis[1] > 0.5; // the drogue looks at the probe
    if (facing && tipB[1] >= -0.02 && tipB[1] <= 0.06 && Math.hypot(tipB[0], tipB[2]) < DROGUE_R * 2.2 && portState(s).vPort[1] < 0) {
      const j = judgeContact(s, difficulty);
      s.lastContact = { ...j, t: s.t };
      if (j.kind === "capture") {
        s.status = "captured";
        s.phase = "SOFT CAPTURE";
        s.captureT = s.t;
        s.capturePos = s.pos.slice();
        s.captureQ = s.q.slice();
        event = j;
      } else if (j.recoverable) {
        s.contacts += 1;
        rebound(s);
        event = j;
      } else {
        s.status = "failed";
        s.failure = j;
        event = j;
      }
      continue;
    }
    let touching = false;
    for (const hb of HULL_B) {
      const p = add(s.pos, qRot(s.q, hb));
      if (insideCsm(p)) {
        touching = true;
        const pv = add(s.vel, cross(qRot(s.q, s.w), qRot(s.q, hb)));
        const speed = len(pv);
        const j = { kind: "collision", title: "COLLISION WITH THE COMMAND MODULE", recoverable: speed < 0.12, facts: { speed } };
        // still in the same glancing touch: push out, but it is one contact, not one per step
        const same = j.recoverable && s.touching;
        if (!same) s.lastContact = { ...j, t: s.t };
        if (j.recoverable) {
          if (!same) s.contacts += 1;
          // Glancing touch: push the ascent stage back out along the hull's normal.
          const nrm = [p[0], 0, p[2]];
          const nl = len(nrm) || 1;
          const nn = [nrm[0] / nl, 0, nrm[2] / nl];
          const vn = dot(pv, nn);
          if (vn < 0) s.vel = sub(s.vel, scale(nn, 1.35 * vn));
          s.pos = add(s.pos, scale(nn, 0.05));
        } else {
          s.status = "failed";
          s.failure = j;
        }
        if (!same) event = j;
        break;
      }
    }
    s.touching = touching;
    if (!event && len(sub(s.pos, DOCKED_POS)) > LOST_RANGE) {
      s.status = "failed";
      s.failure = { kind: "lost", title: "TARGET LOST — OUT OF RANGE", recoverable: false };
      event = s.failure;
    }
    if (!event && s.prop <= 0 && !s.propOutAt) s.propOutAt = s.t;
    if (!event && s.propOutAt && s.t - s.propOutAt > 20 && telemetry(s, difficulty).closing <= 0.005) {
      s.status = "failed";
      s.failure = { kind: "propellant", title: "RCS PROPELLANT DEPLETED", recoverable: false };
      event = s.failure;
    }
  }
  if (s.status === "approach") s.phase = dockingStatus(s, difficulty).phase;
  return event;
}
const dot4 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];

/* ---- a reference pilot (tests, tooling) --------------------------------------------- */
/**
 * A careful pilot flying only what the HUD shows, with taps and holds:
 * attitude first, then the drogue onto the axis, then a slow closing. Lag
 * (s) delays what it reads. `bad` makes it fly in deliberately misaligned
 * (validation: a misaligned approach must not dock).
 */
export function referencePilot(difficulty = "ASTRONAUT", { bad = null, lag = 0.25 } = {}) {
  const cfg = DOCKING[difficulty];
  const deadband = (v, d) => (Math.abs(v) < d ? 0 : Math.sign(v));
  // Pulse, then wait to see what it did (the reaction time and one more pulse) before
  // pulsing that axis again: a human pilot's rhythm, not a bang-bang controller.
  const nextT = { t: [0, 0, 0], r: [0, 0, 0] };
  const wait = lag + 2 * PULSE;
  return (s) => {
    const m = telemetry(s, difficulty);
    const r = [0, 0, 0];
    const t = [0, 0, 0];
    const gate = (kind, i, v) => {
      if (!v || s.t < nextT[kind][i]) return 0;
      nextT[kind][i] = s.t + wait;
      return v;
    };
    // Attitude: CADET leaves it to the autopilot's docking-attitude hold; the others null
    // the error with rate-limited pulses, inside a deadband a pulse can't overshoot.
    if (!cfg.autoAlign) {
      const err = [m.pitch - (bad === "angle" ? 8 * DEG : 0), m.roll, m.yaw];
      const kick = cfg.angAccel * PULSE;
      for (let i = 0; i < 3; i++) {
        const e = Math.abs(err[i]) < 0.3 * DEG ? 0 : err[i];
        const wantRate = Math.max(-1.0 * DEG, Math.min(1.0 * DEG, -0.25 * e));
        r[i] = gate("r", i, deadband(wantRate - s.w[i], 0.75 * kick));
      }
    }
    // Translation in body axes: offsets read in the pilot's screen terms (right/up); near
    // the docking attitude body +X = screen right, +Z = up, +Y = forward.
    const tkick = cfg.accel * PULSE;
    const aligned = m.angle < 3 * cfg.tol.angle;
    const off = bad === "offset" ? [m.offset[0] - 0.9, m.offset[1]] : m.offset;
    const wantLat = [0, 1].map((i) => Math.max(-0.06, Math.min(0.06, -0.05 * off[i])));
    t[0] = gate("t", 0, deadband(wantLat[0] - m.vLat[0], 0.75 * tkick));
    t[2] = gate("t", 2, deadband(wantLat[1] - m.vLat[1], 0.75 * tkick));
    const lined = m.offsetR < Math.max(0.6 * cfg.tol.lateral, 0.03 * m.axial) && aligned;
    // Lined up: close at a speed that falls with the range (never below what latches).
    // Not lined up: hold the range, and back off if already close.
    const want = lined
      ? Math.max(cfg.tol.vMin * 1.6, Math.min(m.closingLimit * 0.6, 0.05 + 0.012 * m.axial, cfg.tol.vMax * 0.6))
      : m.axial < 3
        ? -0.04
        : Math.min(0.03, Math.max(0, m.closing));
    t[1] = gate("t", 1, deadband(want - m.closing, 0.75 * tkick));
    return { t, r };
  };
}

/** Fly a whole approach with a pilot function (tests and tooling). */
export function flyDocking(difficulty, pilot, { lag = 0.25, maxT = 900, state = null, pulse = PULSE, align = DOCKING[difficulty].autoAlign, speed = false } = {}) {
  const s = state || checkpointState(difficulty);
  const hist = [];
  let cmd = { t: [0, 0, 0], r: [0, 0, 0] };
  let held = 0;
  const events = [];
  const dt = 1 / 30;
  while (s.t < maxT && s.status !== "docked" && s.status !== "failed") {
    hist.push(JSON.parse(JSON.stringify({ pos: s.pos, vel: s.vel, q: s.q, w: s.w, prop: s.prop, t: s.t })));
    // decide on a lagged copy of the state, in pulses (held for at least `pulse`)
    if (held <= 0) {
      const back = Math.max(0, hist.length - 1 - Math.round(lag / dt));
      const seen = { ...s, ...hist[back], status: s.status };
      cmd = pilot(seen);
      held = pulse;
    }
    held -= dt;
    if (cmd && cmd.assist === "stabilize" && !s.stab) engageStabilize(s, difficulty);
    if (cmd && cmd.assist === "center" && !s.center) engageCenter(s, difficulty);
    if (cmd && cmd.fine) fineStep(s, difficulty, cmd.fine, { speed });
    if (cmd && cmd.assist === "align") align = true;
    const e = stepDocking(s, cmd, difficulty, dt, { align, speed });
    if (e) events.push({ ...e, t: s.t });
  }
  return { state: s, events, docked: s.status === "docked", t: s.t };
}
