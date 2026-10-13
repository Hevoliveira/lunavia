/*
 * LUNAVIA — lunar arrival and orbit presentation before the descent (pure, unit-tested).
 *
 * The rule: once the Moon is big on screen, the camera never moves AROUND it.
 * It stays on one fixed ray from the Moon's centre and only moves along that
 * ray (dolly) and tilts. The point of the surface under the camera therefore
 * never changes, so the Moon cannot appear to turn or its texture to slide;
 * features only grow as the camera approaches. The Moon itself has one fixed
 * orientation (MOON_ROTATION) in every shot.
 *
 * Arrival. The cruise ends close on the spacecraft (data/orbitSequence
 * CISLUNAR), the Moon behind it seen from this same CAMERA_RAY side; lunar orbit
 * opens close on the insertion burn (ORBIT_SEQ.loi), then the establishing shot.
 *
 * Orbit. The landing site (Mare Tranquillitatis, 0.67°N 23.47°E) is lit by a
 * low morning Sun from the east. The craft flies its orbit over the site, east
 * to west (left to right on screen): time-compressed on arrival, then easing
 * into a creep that leaves it at the powered-descent start point (PDI), where
 * GO FOR PDI lights. The camera opens wide on the whole Moon, makes one slow
 * dolly in with a gentle tilt, then holds a stable composition for as long
 * as the player reads.
 *
 * Vectors are plain [x, y, z] arrays in MissionScene units. Nothing here
 * touches the descent simulation: the descent starts from its own fixed state.
 */

import { ORBIT_RATE, ORBIT_SEQ } from "./orbitSequence";

const DEG = Math.PI / 180;

// Landing site, selenographic (texture is equirectangular, longitude 0 at its centre).
export const LZ_LAT = 0.67 * DEG;
export const LZ_LON = 23.47 * DEG;

// The scene's Sun (MissionScene directional light position, normalised).
const SUN = norm([30, 10, -20]);

export const ORBIT = {
  pdiAlpha: -12 * DEG, // PDI point, along-track angle from the site (negative = before it; Apollo ~15°)
  arrival: 22 * DEG, // arc covered during the time-compressed arrival
  arrivalT: 3.2, // s, time constant of that compression easing out
  creep: 1 * DEG, // then the craft creeps this far past PDI and holds (bounded, however long the player reads)
  creepT: 40, // s
  altitude: 0.16, // craft orbit radius above the surface, in Moon radii
  goMargin: 1 * DEG, // GO FOR PDI when the craft is within this of the PDI point
  settleStart: 3.5, // s: establishing shot holds until here
  settleEnd: 13.5, // s: camera fully settled
  r0: 3.6, // camera distance from the Moon's centre, establishing shot (Moon radii)
  r1: 1.5, // ... settled
};

/* ---- small vector helpers ---------------------------------------------- */
export function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const smoother = (x) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * c * (c * (c * 6 - 15) + 10);
};
/** Spherical interpolation between unit vectors (a gentle tilt, never a swing through the middle). */
export function slerp(a, b, u) {
  const c = Math.max(-1, Math.min(1, dot(a, b)));
  const th = Math.acos(c);
  if (th < 1e-6) return a.slice();
  const s = Math.sin(th);
  return add(scale(a, Math.sin((1 - u) * th) / s), scale(b, Math.sin(u * th) / s));
}
const fromAzEl = (az, el) => [Math.cos(el * DEG) * Math.cos(az * DEG), Math.sin(el * DEG), Math.cos(el * DEG) * Math.sin(az * DEG)];

/* ---- orbit geometry ----------------------------------------------------- */
const UP = [0, 1, 0];
/** The orbit camera's fixed ray from the Moon's centre (world). */
export const CAMERA_RAY = fromAzEl(-100, 30);
// Screen axes of that ray's view (camera up is always world +Y: no roll).
const RAY_X = norm(cross(scale(CAMERA_RAY, -1), UP)); // screen right
const RAY_Y = cross(RAY_X, scale(CAMERA_RAY, -1)); // screen up
// A point on the face the camera sees: gamma degrees from the ray, in screen
// direction beta (0 = up, positive = right).
const onFace = (gamma, beta) => {
  const side = add(scale(RAY_Y, Math.cos(beta * DEG)), scale(RAY_X, Math.sin(beta * DEG)));
  return norm(add(scale(CAMERA_RAY, Math.cos(gamma * DEG)), scale(side, Math.sin(gamma * DEG))));
};

/** Landing site direction from the Moon's centre (world): upper right of the face the camera sees. */
export const LZ_UP = onFace(16, 40);
/** Local east at the site points to the Sun's azimuth (morning); the craft flies west. */
export const EAST = norm(add(SUN, scale(LZ_UP, -dot(LZ_UP, SUN))));
export const WEST = scale(EAST, -1);
const NORTH = cross(LZ_UP, EAST);

// three.js SphereGeometry with an equirectangular map: longitude λ, latitude φ
// lands at local (cos φ cos λ, sin φ, -cos φ sin λ).
const lzLocal = [Math.cos(LZ_LAT) * Math.cos(LZ_LON), Math.sin(LZ_LAT), -Math.cos(LZ_LAT) * Math.sin(LZ_LON)];
const eastLocal = norm([-Math.sin(LZ_LON), 0, -Math.cos(LZ_LON)]);
const northLocal = cross(lzLocal, eastLocal);

/** Row-major 3x3 rotation taking Moon-local vectors to world: the real site lands at LZ_UP. */
export const MOON_ROTATION = (() => {
  // R = W · Lᵀ, W = [EAST NORTH LZ_UP] as columns, L = [east north up] (local) as columns.
  const W = [EAST, NORTH, LZ_UP];
  const L = [eastLocal, northLocal, lzLocal];
  const m = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m.push(W[0][i] * L[0][j] + W[1][i] * L[1][j] + W[2][i] * L[2][j]);
  return m;
})();

export const applyRotation = (m, v) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

/** Sun elevation at the landing site, degrees (for tests and docs). */
export const LZ_SUN_ELEVATION = Math.asin(dot(LZ_UP, SUN)) / DEG;

/* ---- the craft ---------------------------------------------------------- */
const arrivalAlpha = (t) => ORBIT.pdiAlpha + ORBIT.creep * (1 - Math.exp(-t / ORBIT.creepT)) - ORBIT.arrival * Math.exp(-t / ORBIT.arrivalT);

/**
 * Along-track angle from the site at time tau (s since lunar orbit began).
 * Time-compressed only in the wide establishing shot (ORBIT_SEQ.arrive to
 * .cut); before it, during the insertion burn, and from the cut to the
 * spacecraft on, it flies at its real orbital rate, so the surface under the
 * close shots drifts as it would.
 */
export function craftAlpha(tau) {
  const t = tau - ORBIT_SEQ.arrive;
  const cut = ORBIT_SEQ.cut - ORBIT_SEQ.arrive;
  if (t < 0) return arrivalAlpha(0) + ORBIT_RATE * DEG * t;
  if (t <= cut) return arrivalAlpha(t);
  return arrivalAlpha(cut) + ORBIT_RATE * DEG * (t - cut);
}

const radialAt = (alpha) => add(scale(LZ_UP, Math.cos(alpha)), scale(WEST, Math.sin(alpha)));
const forwardAt = (alpha) => add(scale(LZ_UP, -Math.sin(alpha)), scale(WEST, Math.cos(alpha)));

/** Craft position, direction of flight and local vertical. M = Moon centre, R = Moon radius. */
export function craftPose(tau, M, R) {
  const a = craftAlpha(tau);
  const radial = radialAt(a);
  return { pos: add(M, scale(radial, R * (1 + ORBIT.altitude))), fwd: forwardAt(a), up: radial, alpha: a };
}

/** Point on the orbit at along-track angle alpha (for drawing the orbit path). */
export const orbitPoint = (alpha, M, R) => add(M, scale(radialAt(alpha), R * (1 + ORBIT.altitude)));

/**
 * GO FOR PDI: once the lunar module has undocked and separated (the
 * undocking sequence, data/orbitSequence). The descent itself starts from its
 * own fixed state after a cut: descent orbit insertion and the coast down to
 * the powered-descent point are not flown on screen.
 */
export const goForPdi = (tau) => tau >= ORBIT_SEQ.goPdi;

/** Landing site on the surface (for the marker). */
export const landingSite = (M, R) => add(M, scale(LZ_UP, R));

/* ---- the orbit camera --------------------------------------------------- */
// View directions (unit, scale-free). Wide: the whole Moon, slightly low in
// the frame. Settled: solved for a landscape phone with the craft upper left
// above the horizon, the site ahead and below it, and the bottom-right corner
// left for the LUNAR DESCENT prompt.
const WIDE_DIR = norm(add(scale(RAY_Y, 0.25), scale(CAMERA_RAY, -ORBIT.r0)));
const SETTLED_DIR = norm(add(add(scale(CAMERA_RAY, 1.0785 - ORBIT.r1), scale(RAY_Y, 0.167)), scale(RAY_X, 0.1735)));

/**
 * Camera pose at tau: the camera is always on CAMERA_RAY (distance r), so the
 * surface never slides. It holds wide, then dollies in while tilting from the
 * Moon's centre up to the horizon. Up is always world +Y (no roll).
 */
export function orbitCamera(tau, M, R) {
  const t = tau - ORBIT_SEQ.arrive; // seconds into the establishing shot
  const u = smoother((t - ORBIT.settleStart) / (ORBIT.settleEnd - ORBIT.settleStart));
  // A barely perceptible push-in while the establishing shot holds.
  const r = ORBIT.r0 * (1 - 0.04 * smoother(t / ORBIT.settleStart)) * (1 - u) + ORBIT.r1 * u;
  const pos = add(M, scale(CAMERA_RAY, R * r));
  const dir = slerp(WIDE_DIR, SETTLED_DIR, u);
  return { pos, look: add(pos, scale(dir, R)), up: UP.slice(), settle: u };
}
