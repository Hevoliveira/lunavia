/*
 * LUNAVIA — OCEAN RECOVERY: the optional cinematic after a successful splashdown (pure; unit-tested).
 *
 * Apollo-inspired: a recovery helicopter (after the Sikorsky SH-3 Sea King) comes in from the
 * recovery ship, drops two swimmers, who fit the inflatable flotation collar round the command
 * module and a life raft beside its hatch; the hatch opens and the three crew climb out into the
 * raft; the helicopter hovers over the raft and lifts them one by one in a rescue basket, then
 * flies back to the carrier on the horizon. WELCOME HOME, and the mission's own results.
 *
 * Everything here is a function of the cinematic's clock t (s, 0 … RECOVERY.duration): where each
 * actor is and what it does, and each shot's camera. Positions in metres in the splashdown frame:
 * the floating capsule's centre at x = z = 0, y up from the mean sea surface (the scene adds the
 * waves under whatever floats). The capsule's hatch faces HATCH_DIR (the floating capsule's yaw).
 * Nothing here touches the mission: the results were recorded at splashdown.
 */

export const RECOVERY = { duration: 74.5 };

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const clamp01 = (x) => clamp(x, 0, 1);
const smooth = (x) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};
const lerp = (a, b, k) => a + (b - a) * k;
const lerp3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** A move at an even pace with short starts and stops (0..1 → 0..1; peak speed 1.25 × average). */
const glide = (x, e = 0.2) => {
  const u = clamp01(x);
  if (u < e) return (u * u) / (2 * e * (1 - e));
  if (u > 1 - e) return 1 - ((1 - u) * (1 - u)) / (2 * e * (1 - e));
  return (u - e / 2) / (1 - e);
};

/* ---- the site ------------------------------------------------------------------------------- */
// the floating capsule's yaw (components/scenes/ReentryScene: Euler(·, 0.2, ·)): its hatch faces
// +Z turned 0.2 rad towards +X
export const CAPSULE_YAW = 0.2;
export const HATCH_DIR = [Math.sin(CAPSULE_YAW), Math.cos(CAPSULE_YAW)]; // (x, z), unit
export const HATCH_SIDE = [Math.cos(CAPSULE_YAW), -Math.sin(CAPSULE_YAW)]; // along the hull, to the right of the hatch seen from outside
const along = (d, s = 0) => [HATCH_DIR[0] * d + HATCH_SIDE[0] * s, HATCH_DIR[1] * d + HATCH_SIDE[1] * s];

/** The command module afloat (m): its radius at the waterline, and where the collar rides. */
export const CAPSULE = { waterR: 1.67, apex: 2.4, hatchSill: 0.25 };
/** The flotation collar: a ring of inflatable tubes round the hull at the waterline. */
export const COLLAR = { ringR: 2.1, tubeR: 0.42, folded: 0.07, segments: 8 };
/** The life raft (m): an inflatable raft moored beside the hatch, its long side along the hull. */
export const RAFT = { centre: along(4.7), length: 3.6, width: 2.0, tubeR: 0.26 };
/** The raft's three places (m, x/z), from the hatch side's left to right. */
export const RAFT_SEATS = [-1.05, 0, 1.05].map((s) => along(4.55, s));
/** Where the basket comes down: in the water at the raft's outer side, by the first seat. */
export const BASKET_POINT = along(6.1, -0.3);

/** The recovery ship, far out (m): an aircraft carrier, about 270 m long, broadside to the scene. */
export const SHIP = { pos: [-2900, 0, -4700], heading: 0.35, length: 270 };

/** The helicopter's size (m), after the SH-3: fuselage about 16.7 m, main rotor 18.9 m across. */
export const HELI = { length: 16.7, rotorR: 9.45, tailRotorR: 1.6, mastH: 2.45, bodyMid: 0 };
/** The rescue hoist's hook in the helicopter's frame (m; +x forward, +y up, +z starboard). */
export const HOIST_LOCAL = [0.6, 1.25, 1.85];
/** The starboard cargo door (where swimmers jump and the crew is taken in). */
export const DOOR_LOCAL = [0.6, -0.25, 1.15];

/** The helicopter's heading so its nose points along (dx, dz) (nose = local +x; yaw about +y). */
export const yawFacing = (dx, dz) => Math.atan2(-dz, dx);
/** A point of the helicopter's frame in the world (m), body at pos with yaw. */
export function heliToWorld(pos, yaw, p) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [pos[0] + p[0] * c + p[2] * s, pos[1] + p[1], pos[2] - p[0] * s + p[2] * c];
}

/* ---- the timeline ----------------------------------------------------------------------------- */
/**
 * The shots (s): A the capsule afloat, B the helicopter's approach, C the swimmers and the collar,
 * D the hatch and the crew, E the hoist, F WELCOME HOME.
 */
export const SHOTS = [
  { id: "A", from: 0, to: 7 },
  { id: "B", from: 7, to: 19.5 },
  { id: "C", from: 19.5, to: 34.3 },
  { id: "D", from: 34.3, to: 47.3 },
  { id: "E", from: 47.3, to: 64.5 },
  { id: "F", from: 64.5, to: RECOVERY.duration },
];
export const shotAt = (t) => SHOTS.find((s) => t >= s.from && t < s.to) || SHOTS[SHOTS.length - 1];

export const T = {
  heliIn: 3, // the helicopter enters the scene, far out (a speck on the horizon)
  hoverDrop: 19, // in a low hover for the swimmers
  jump: [19.4, 20.2], // the swimmers leave the door
  station: [23.5, 30], // the helicopter backs off to its station
  atCapsule: [28.0, 29.0], // the swimmers reach the capsule
  collarWrap: [28.8, 31.8], // the collar taken round the hull
  collarFill: [31.5, 34.2], // and inflated
  raftFill: [34.4, 36.4],
  hatch: [36.7, 38.7], // the hatch swung open
  egress: [[38.9, 41.7], [41.9, 44.5], [44.7, 47.1]], // each crew member out into the raft
  toHoist: [40, 52.2], // round the capsule's side, never over it
  lower: [51.2, 55.2],
  boardBasket: [55.2, 56.7],
  lift: [56.7, 62.4],
  aboard: [62.4, 63.4],
  montage: [63.4, 64.8], // the other two lifted (a short dip to black)
  depart: 64.8,
  words: [[66.8, "crewRecovered"], [69, "welcomeHome"], [71.2, "accomplished"]],
  end: RECOVERY.duration,
};

/* ---- smooth paths ---------------------------------------------------------------------------- */
/**
 * A path through keys { t, p: [x, y, z], v?: [vx, vy, vz] } (cubic Hermite; a key without v takes
 * the Catmull-Rom tangent of its neighbours; hovers set v = [0, 0, 0]). Returns p(t) and v(t).
 */
function hermite(keys, t) {
  if (t <= keys[0].t) return { p: keys[0].p.slice(), v: keys[0].v ? keys[0].v.slice() : [0, 0, 0] };
  const last = keys[keys.length - 1];
  if (t >= last.t) return { p: last.p.slice(), v: [0, 0, 0] };
  let i = 0;
  while (keys[i + 1].t < t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const tan = (k, j) => {
    if (k.v) return k.v;
    const pa = keys[Math.max(0, j - 1)];
    const pb = keys[Math.min(keys.length - 1, j + 1)];
    const dt = pb.t - pa.t || 1;
    return [0, 1, 2].map((c) => (pb.p[c] - pa.p[c]) / dt);
  };
  const va = tan(a, i);
  const vb = tan(b, i + 1);
  const h = b.t - a.t;
  const u = (t - a.t) / h;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  const d00 = (6 * u2 - 6 * u) / h;
  const d10 = 3 * u2 - 4 * u + 1;
  const d01 = (-6 * u2 + 6 * u) / h;
  const d11 = 3 * u2 - 2 * u;
  const p = [0, 1, 2].map((c) => h00 * a.p[c] + h10 * h * va[c] + h01 * b.p[c] + h11 * h * vb[c]);
  const v = [0, 1, 2].map((c) => d00 * a.p[c] + d10 * va[c] + d01 * b.p[c] + d11 * vb[c]);
  return { p, v };
}
/** An angle through keys { t, a } (eased, shortest way round). */
function angleKeys(keys, t) {
  if (t <= keys[0].t) return keys[0].a;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t <= b.t) return a.a + wrapPi(b.a - a.a) * smooth((t - a.t) / (b.t - a.t));
  }
  return keys[keys.length - 1].a;
}

/* ---- the helicopter -------------------------------------------------------------------------- */
const DROP = [-8, 4.6, -11.5]; // a low hover for the swimmers, about 14 m from the capsule
const STATION = [-18, 15, -26]; // standing off while the swimmers work, about 32 m
// the run in: from the recovery ship's direction, about 400 m out at 45 m/s, slowing all the way
// to the hover (a flare at the end, nose up; at most about 0.37 g)
const APPROACH = { speed: 45, dur: 16 };
const APPROACH_DIR = (() => {
  const d = [DROP[0] - -1500, DROP[2] - -3700];
  const l = Math.hypot(d[0], d[1]);
  return [d[0] / l, d[1] / l];
})();
const APPROACH_LEN = 0.55 * APPROACH.speed * APPROACH.dur;
const APPROACH_FROM = [DROP[0] - APPROACH_DIR[0] * APPROACH_LEN, 60, DROP[2] - APPROACH_DIR[1] * APPROACH_LEN];
const HOIST_YAW = Math.atan2(HATCH_DIR[0], HATCH_DIR[1]) + Math.PI; // starboard (the hoist) towards the capsule
const HOIST_ALT = 13; // the body's height in the hoist hover (m)
// the body's place in the hoist hover: the hook right over the basket point
const HOIST_POS = (() => {
  const off = heliToWorld([0, 0, 0], HOIST_YAW, HOIST_LOCAL);
  return [BASKET_POINT[0] - off[0], HOIST_ALT, BASKET_POINT[1] - off[2]];
})();
// the way round to the hoist hover: out to the side of the capsule, away from it
const ROUND = (() => {
  const a = along(5, -21);
  return [a[0], 16, a[1]];
})();
const ROUND_V = (() => {
  const d = [HOIST_POS[0] - STATION[0], 0, HOIST_POS[2] - STATION[2]];
  const l = Math.hypot(d[0], d[2]);
  return [(d[0] / l) * 7.5, -0.3, (d[2] / l) * 7.5];
})();
// away: first out to the side and up (never back over the capsule), then towards the ship
const LEAVE = (() => {
  const a = along(12, -30);
  return [a[0], 28, a[1]];
})();
// through LEAVE turning from the way out onto the way to the ship
const LEAVE_V = (() => {
  const out = [LEAVE[0] - HOIST_POS[0], LEAVE[2] - HOIST_POS[2]];
  const lo = Math.hypot(out[0], out[1]);
  const d = [SHIP.pos[0] - LEAVE[0], SHIP.pos[2] - LEAVE[2]];
  const ld = Math.hypot(d[0], d[1]);
  const m = [out[0] / lo + d[0] / ld, out[1] / lo + d[1] / ld];
  const lm = Math.hypot(m[0], m[1]);
  return [(m[0] / lm) * 13, 2.4, (m[1] / lm) * 13];
})();
const DEPART_DIR = (() => {
  const d = [SHIP.pos[0] - LEAVE[0], SHIP.pos[2] - LEAVE[2]];
  const l = Math.hypot(d[0], d[1]);
  return [d[0] / l, d[1] / l];
})();
const toApproach = APPROACH_DIR;
const HELI_KEYS = [
  { t: T.heliIn, p: APPROACH_FROM, v: [toApproach[0] * APPROACH.speed, -5, toApproach[1] * APPROACH.speed] },
  { t: T.hoverDrop, p: DROP, v: [0, 0, 0] },
  { t: T.station[0], p: DROP, v: [0, 0, 0] },
  { t: T.station[1], p: STATION, v: [0, 0, 0] },
  { t: T.toHoist[0], p: STATION, v: [0, 0, 0] },
  { t: 46.6, p: ROUND, v: ROUND_V },
  { t: T.toHoist[1], p: HOIST_POS, v: [0, 0, 0] },
  { t: T.depart, p: HOIST_POS, v: [0, 0, 0] },
  // away: climbing and accelerating steadily (about 0.33 g, then 0.4 g) towards the ship
  { t: T.depart + 5.5, p: LEAVE, v: LEAVE_V },
  { t: T.end, p: [LEAVE[0] + DEPART_DIR[0] * 74, 36, LEAVE[2] + DEPART_DIR[1] * 74], v: [DEPART_DIR[0] * 22, 2, DEPART_DIR[1] * 22] },
];
const HELI_YAW = [
  { t: T.heliIn, a: yawFacing(toApproach[0], toApproach[1]) },
  { t: T.hoverDrop - 1.5, a: yawFacing(toApproach[0], toApproach[1]) },
  // the door (starboard) turned towards the capsule for the jump
  { t: T.hoverDrop + 0.6, a: Math.atan2(-DROP[0], -DROP[2]) + Math.PI },
  { t: T.station[0] + 0.5, a: Math.atan2(-DROP[0], -DROP[2]) + Math.PI },
  { t: T.station[1], a: Math.atan2(-STATION[0], -STATION[2]) + Math.PI },
  { t: T.toHoist[0], a: Math.atan2(-STATION[0], -STATION[2]) + Math.PI },
  { t: 46.6, a: (Math.atan2(-STATION[0], -STATION[2]) + Math.PI + HOIST_YAW) / 2 },
  { t: T.toHoist[1], a: HOIST_YAW },
  { t: T.depart + 0.8, a: HOIST_YAW },
  { t: T.depart + 4, a: yawFacing(LEAVE[0] - HOIST_POS[0], LEAVE[2] - HOIST_POS[2]) },
  { t: T.depart + 6.5, a: yawFacing(DEPART_DIR[0], DEPART_DIR[1]) },
];

/** The rotor's speed (rev/s; the SH-3's main rotor turns at about 3.4 rev/s), steady in flight. */
export const ROTOR_REV = 3.4;

/**
 * The helicopter at t: { visible, pos [m], vel [m/s], yaw, pitch, roll (rad; nose down
 * accelerating, up when slowing; banked into turns), door (0 shut .. 1 open) }.
 */
export function heliAt(t) {
  const visible = t >= T.heliIn - 0.01;
  const { p, v } = hermite(HELI_KEYS, Math.max(t, T.heliIn));
  const yaw = angleKeys(HELI_YAW, t);
  // attitude from the acceleration (finite difference of the path), in the body frame
  const e = 0.12;
  const v0 = hermite(HELI_KEYS, Math.max(T.heliIn, t - e)).v;
  const v1 = hermite(HELI_KEYS, Math.max(T.heliIn, t + e)).v;
  const acc = [(v1[0] - v0[0]) / (2 * e), (v1[1] - v0[1]) / (2 * e), (v1[2] - v0[2]) / (2 * e)];
  const fwd = [Math.cos(yaw), -Math.sin(yaw)];
  const right = [Math.sin(yaw), Math.cos(yaw)];
  const aF = acc[0] * fwd[0] + acc[2] * fwd[1];
  const aR = acc[0] * right[0] + acc[2] * right[1];
  // forward flight trims a little nose down; accelerating more, decelerating nose up
  const vF = v[0] * fwd[0] + v[2] * fwd[1];
  const pitch = clamp(-Math.atan2(aF, 9.81) - 0.0016 * vF, -0.24, 0.2);
  const roll = clamp(Math.atan2(aR, 9.81), -0.2, 0.2);
  const door = smooth((t - (T.hoverDrop - 2)) / 1.2);
  return { visible, pos: p, vel: v, yaw, pitch, roll, door };
}
export const HELI_PLACES = { APPROACH_FROM, DROP, STATION, HOIST_POS, HOIST_YAW, HOIST_ALT };

/* ---- the swimmers ------------------------------------------------------------------------------ */
// where each works at the capsule: either side of the hatch, against the collar
const SWIM_STATIONS = [along(0.6, -2.55), along(0.6, 2.55)];
// later, the first steadies the raft, the second stays at the hatch
const SWIM_LATE = [along(5.9, 1.6), along(2.75, 0.55)];
const FALL = 0.97; // s from the door to the water (about 4.6 m)
/**
 * A swimmer at t: { visible, mode: "aboard" | "fall" | "swim" | "work" | "steady", pos [m] (the
 * water surface at y = 0: a swimmer's root is his waterline), face (rad, heading as yawFacing),
 * stroke (phase, rad), splash (s since entering the water, or null) }.
 */
export function swimmerAt(i, t) {
  const jump = T.jump[i];
  if (t < jump) return { visible: false, mode: "aboard", pos: [0, 0, 0], face: 0, stroke: 0, splash: null };
  const hp = heliAt(jump);
  const door = heliToWorld(hp.pos, hp.yaw, DOOR_LOCAL);
  // the entry point: a step out and down from the door
  const out = [Math.sin(hp.yaw), Math.cos(hp.yaw)];
  const entry = [door[0] + out[0] * 1.1, 0, door[2] + out[1] * 1.1];
  if (t < jump + FALL) {
    const k = (t - jump) / FALL;
    const y = door[1] - 0.5 * 9.81 * (t - jump) * (t - jump);
    return { visible: true, mode: "fall", pos: [lerp(door[0], entry[0], k), Math.max(0, y) - 0.9 * k, lerp(door[2], entry[2], k)], face: hp.yaw + Math.PI / 2, stroke: 0, splash: null };
  }
  const st = SWIM_STATIONS[i];
  const arrive = T.atCapsule[i];
  const since = t - (jump + FALL);
  if (t < arrive) {
    const k = glide((t - jump - FALL) / (arrive - jump - FALL));
    const p = [lerp(entry[0], st[0], k), 0, lerp(entry[2], st[1], k)];
    return { visible: true, mode: "swim", pos: p, face: yawFacing(st[0] - entry[0], st[1] - entry[2]), stroke: since * 4.2, splash: since };
  }
  // at the collar: facing the hull
  const faceHull = yawFacing(-st[0], -st[1]);
  const lateFrom = T.raftFill[0] + i * 1.2;
  if (t < lateFrom) return { visible: true, mode: "work", pos: [st[0], 0, st[1]], face: faceHull, stroke: t * 1.3, splash: since };
  const lt = SWIM_LATE[i];
  const k = glide((t - lateFrom) / 3.6);
  const p = [lerp(st[0], lt[0], k), 0, lerp(st[1], lt[1], k)];
  const face = i === 0 ? yawFacing(-HATCH_DIR[0], -HATCH_DIR[1]) : yawFacing(-lt[0], -lt[1]);
  return { visible: true, mode: k < 1 ? "swim" : i === 0 ? "steady" : "work", pos: p, face: lerpAngle(faceHull, face, k), stroke: t * (k < 1 ? 4 : 1.3), splash: since };
}
const lerpAngle = (a, b, k) => a + wrapPi(b - a) * k;

/* ---- the collar, the raft and the hatch ----------------------------------------------------- */
/** The collar: { visible, wrap (0..1 of the way round), fill (0 folded .. 1 inflated) }. */
export function collarAt(t) {
  const visible = t >= T.collarWrap[0] - 0.4;
  return { visible, wrap: smooth((t - T.collarWrap[0]) / (T.collarWrap[1] - T.collarWrap[0])), fill: smooth((t - T.collarFill[0]) / (T.collarFill[1] - T.collarFill[0])) };
}
/** The raft: { visible, fill (0 a bundle .. 1 inflated) }. */
export function raftAt(t) {
  return { visible: t >= T.raftFill[0] - 0.2, fill: smooth((t - T.raftFill[0]) / (T.raftFill[1] - T.raftFill[0])) };
}
/** The hatch: 0 shut .. 1 swung fully open (about 100° out on its hinge). */
export const hatchAt = (t) => smooth((t - T.hatch[0]) / (T.hatch[1] - T.hatch[0]));
export const HATCH_SWING = (100 * Math.PI) / 180;

/* ---- the crew ------------------------------------------------------------------------------- */
/**
 * Crew member i (0..2) at t: { where: "inside" | "hatch" | "out" | "raft" | "basket" | "lift" |
 * "aboard", k (progress of the current move, 0..1), seat [x, z] (m) }.
 * "hatch": rising in the open hatch (capsule frame); "out": from the hatch sill to the seat;
 * "basket": from the seat into the basket; "lift": in the basket on the cable.
 */
export function crewAt(i, t) {
  const seat = RAFT_SEATS[i];
  const [e0, e1] = T.egress[i];
  if (t < e0) return { where: "inside", k: 0, seat };
  const rise = e0 + 0.9;
  if (t < rise) return { where: "hatch", k: smooth((t - e0) / 0.9), seat };
  if (t < e1) return { where: "out", k: smooth((t - rise) / (e1 - rise)), seat };
  if (i === 0) {
    if (t < T.boardBasket[0]) return { where: "raft", k: 1, seat };
    if (t < T.boardBasket[1]) return { where: "basket", k: smooth((t - T.boardBasket[0]) / (T.boardBasket[1] - T.boardBasket[0])), seat };
    if (t < T.aboard[1]) return { where: "lift", k: 1, seat };
    return { where: "aboard", k: 1, seat };
  }
  // the other two: lifted during the montage
  if (t < T.montage[0] + 0.7) return { where: "raft", k: 1, seat };
  return { where: "aboard", k: 1, seat };
}
/** How many are aboard the helicopter at t (the HUD's count). */
export const crewAboard = (t) => [0, 1, 2].filter((i) => crewAt(i, t).where === "aboard").length;

/* ---- the hoist ------------------------------------------------------------------------------ */
/** The bridle apex's height over the sea when the basket floats (rim 0.25 m out of the water). */
export const BASKET_APEX = 1.25;
/**
 * The rescue basket at t: { visible, hook [m] (world, on the helicopter), basket [m] (the apex of
 * its bridle, where the cable is made fast; the rim 1.0 m and the floor 1.5 m below it), cable (m
 * paid out), taut (bool), occupied (bool) }.
 */
export function hoistAt(t) {
  const h = heliAt(t);
  const hook = heliToWorld(h.pos, h.yaw, HOIST_LOCAL);
  // the basket hangs 1.25 m under its bridle's apex: paid out to the water, its rim just above it
  const full = hook[1] - BASKET_APEX;
  let cable = 0;
  if (t >= T.lower[0] && t < T.lower[1]) cable = full * glide((t - T.lower[0]) / (T.lower[1] - T.lower[0]));
  else if (t >= T.lower[1] && t < T.lift[0]) cable = full;
  else if (t >= T.lift[0] && t < T.lift[1]) {
    const k = glide((t - T.lift[0]) / (T.lift[1] - T.lift[0]));
    cable = full * (1 - k) + 0.9 * k;
  }
  else if (t >= T.lift[1] && t < T.aboard[1]) cable = 0.9 - 0.6 * smooth((t - T.lift[1]) / (T.aboard[1] - T.lift[1]));
  const visible = t >= T.lower[0] && t < T.aboard[1];
  // a slight pendulum while it hangs free (damped once it is in the water)
  const inWater = t >= T.lower[1] - 0.2 && t < T.lift[0] + 0.3;
  const sway = inWater ? 0 : 0.12 * Math.sin(t * 2.1) * smooth(cable / 4);
  const basket = [hook[0] + sway, hook[1] - cable, hook[2] + sway * 0.6];
  return { visible, hook, basket, cable, taut: visible && t >= T.lift[0], occupied: t >= T.boardBasket[1] - 0.3 && t < T.aboard[1], inWater };
}

/* ---- the camera ------------------------------------------------------------------------------- */
/**
 * Each shot's camera (m; pos, look, fov), moving gently within the shot; between shots an eased
 * move of 1.4 s from the last shot's frame to the next (no cut through the sea). The horizon stays
 * level (no roll). Never lower than 0.9 m over the mean sea (the scene keeps it over the waves).
 */
const SHOT_CAMERAS = {
  // A: low over the water close to the capsule, the hatch side lit, drifting slowly round
  A: (t) => ({ pos: [Math.sin(-0.1 + t * 0.008) * 13, 1.5, Math.cos(-0.1 + t * 0.008) * 13], look: [0, 1.0, 0], fov: 38 }),
  // B: wide, the capsule in the foreground, the helicopter coming in over its shoulder from afar
  B: (t) => {
    const h = heliAt(t);
    const k = smooth((t - 7) / 12);
    const look = lerp3([-60, 18, -150], [h.pos[0] * 0.55, Math.max(3, h.pos[1] * 0.55), h.pos[2] * 0.55], 0.35 + 0.65 * k);
    return { pos: [6.5 - 2 * k, 2.2 + 1.2 * k, 17 - 2 * k], look, fov: 46 };
  },
  // C: medium, from the sunlit side: the swimmers crossing the frame from under the helicopter to
  // the capsule, then the collar going round (closing in a little)
  C: (t) => {
    const k = smooth((t - 19.5) / 14.8);
    return { pos: [-12.5 + 2.5 * k, 2.4 - 0.4 * k, 5 + 4 * k], look: [-3 + 2.5 * k, 0.6 + 0.3 * k, -4.2 + 3.7 * k], fov: 44 - 4 * k };
  },
  // D: close on the hatch and the raft (from beside the raft, the Sun behind)
  D: (t) => {
    const k = smooth((t - 34.3) / 13);
    const c = along(9.4, -5.8 + 1.4 * k);
    const l = along(2.8, 0.2);
    return { pos: [c[0], 2.4, c[1]], look: [l[0], 0.75, l[1]], fov: 40 };
  },
  // E: the hoist: back and low, looking up the cable to the helicopter
  E: (t) => {
    const k = smooth((t - 47.3) / 17.2);
    const c = along(22 - 2 * k, -12);
    const hp = HOIST_POS;
    const look = [lerp(BASKET_POINT[0], hp[0], 0.5), lerp(4.5, 7.5, smooth((t - 47.3) / 6)), lerp(BASKET_POINT[1], hp[2], 0.5)];
    return { pos: [c[0], 3.0 + 1.5 * k, c[1]], look, fov: 52 };
  },
  // F: WELCOME HOME: wide, the collared capsule and its swimmers, the helicopter leaving for the
  // carrier on the horizon; slowly drawing back
  F: (t) => {
    const k = smooth((t - 64.5) / 10);
    const c = along(34 + 10 * k, 20 + 6 * k);
    // panning with the helicopter as it climbs away: the capsule low in frame, the helicopter
    // above it heading for the carrier on the horizon
    const h = heliAt(t).pos;
    const w = 0.5 + 0.1 * k;
    const look = [h[0] * w, 1.2 + (h[1] - 1.2) * w * 0.8, h[2] * w];
    return { pos: [c[0], 4.5 + 3 * k, c[1]], look, fov: 46 - 4 * k };
  },
};
const BLEND = 1.4;
const BLEND_OF = { C: 3, F: 4 }; // the finale draws back a long way: a slower move out
export function cameraAt(t) {
  const s = shotAt(t);
  const cur = SHOT_CAMERAS[s.id](t);
  const idx = SHOTS.indexOf(s);
  const blend = BLEND_OF[s.id] || BLEND;
  if (idx > 0 && t - s.from < blend) {
    const prev = SHOT_CAMERAS[SHOTS[idx - 1].id](s.from);
    const k = smooth((t - s.from) / blend);
    return { pos: lerp3(prev.pos, cur.pos, k), look: lerp3(prev.look, cur.look, k), fov: lerp(prev.fov, cur.fov, k), shot: s.id };
  }
  return { ...cur, shot: s.id };
}

/* ---- words on screen and on the air ------------------------------------------------------------ */
/** The lower-third caption of each stage (the sequence reads with the sound off). */
export const CAPTIONS = [
  { from: 1.0, to: 6.8, id: "afloat" },
  { from: 8.0, to: 19.0, id: "inbound" },
  { from: 19.8, to: 28.0, id: "swimmers" },
  { from: 28.6, to: 34.3, id: "collar" },
  { from: 34.5, to: 38.6, id: "raft" },
  { from: 38.8, to: 47.2, id: "egress" },
  { from: 47.5, to: 62.9, id: "hoist" },
  { from: 64.6, to: 66.3, id: "allAboard" },
];
export const captionAt = (t) => (CAPTIONS.find((c) => t >= c.from && t < c.to) || {}).id || null;
/** Dramatized LUNAVIA radio calls (synthetic voices; not archival audio), with when they are said. */
export const RECOVERY_CALLS = [
  { t: 2.4, id: "recovery.ready" },
  { t: 9.0, id: "recovery.visual" },
  { t: 16.0, id: "recovery.located" },
  { t: 20.2, id: "recovery.deploying" },
  { t: 33.6, id: "recovery.collar" },
  { t: 37.2, id: "recovery.hatch" },
  { t: 50.0, id: "recovery.hoist" },
  { t: 64.8, id: "recovery.allAboard" },
  { t: 68.9, id: "recovery.welcome" },
];
/**
 * The equipment's sounds (procedural, hooks/useMissionAudio recoveryCue), at their moments in the
 * picture: each swimmer entering the water, the collar's inflation, the hatch's latch, the hoist's
 * winch paying out and reeling in (dur: seconds).
 */
export const RECOVERY_CUES = [
  { t: T.jump[0] + FALL, id: "splash" },
  { t: T.jump[1] + FALL, id: "splash" },
  { t: T.collarFill[0], id: "inflate", dur: T.collarFill[1] - T.collarFill[0] },
  { t: T.hatch[0], id: "hatch" },
  { t: T.lower[0], id: "winch", dur: T.lower[1] - T.lower[0] },
  { t: T.lift[0], id: "winch", dur: T.lift[1] - T.lift[0] },
];
/** The finale's three lines (shown from their time to the end). */
export const finaleAt = (t) => T.words.filter(([at]) => t >= at).map(([, id]) => id);
/** The dip to black over the montage (0..1). */
export function dipAt(t) {
  const [a, b] = T.montage;
  if (t < a || t > b + 0.4) return 0;
  return Math.min(smooth((t - a) / 0.35), 1 - smooth((t - (b - 0.15)) / 0.55));
}

export const _test = { hermite, HELI_KEYS, SWIM_STATIONS, smooth };
