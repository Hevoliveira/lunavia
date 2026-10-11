/*
 * LUNAVIA — lunar orbit presentation before the descent (pure, unit-tested).
 *
 * Everything is defined in a Moon-fixed frame, so the Moon never spins: the
 * only thing that moves over the surface is the spacecraft, and the camera
 * moves with purpose (an establishing shot, one slow push-in, then a stable
 * composition). Vectors are plain [x, y, z] arrays in MissionScene units.
 *
 * Orientation. The Moon is turned so that the landing site (Mare
 * Tranquillitatis, 0.67°N 23.47°E) sits at the "top" of the globe (world +Y)
 * with the scene's Sun low in its east, as for Apollo's early-morning
 * landings. The camera keeps world +Y as its up vector throughout, so the
 * transition from the cruise shots never rolls the picture.
 *
 * Orbit. The spacecraft flies a near-equatorial great circle over the site,
 * east to west. Arrival is time-compressed, then the compression eases out
 * as the craft reaches the powered-descent start point (PDI), from where it
 * drifts at a gentle, almost real-time pace. GO FOR PDI lights at that point.
 *
 * Nothing here touches the descent simulation: the descent game starts from
 * its own fixed initial state, as before.
 */

const DEG = Math.PI / 180;

// Landing site, selenographic (texture is equirectangular, longitude 0 at its centre).
export const LZ_LAT = 0.67 * DEG;
export const LZ_LON = 23.47 * DEG;

// The scene's Sun (MissionScene directional light position, normalised).
const SUN = norm([30, 10, -20]);

export const ORBIT = {
  pdiAlpha: -12 * DEG, // PDI point, along-track angle from the site (negative = before it; Apollo ~15°)
  arrival: 22 * DEG, // extra arc covered during the time-compressed arrival
  arrivalT: 3.2, // s, time constant of the compression easing out
  drift: 0.1 * DEG, // rad per real second once settled (~2x real time)
  altitude: 0.16, // craft orbit radius above the surface, in Moon radii
  goMargin: 1 * DEG, // GO FOR PDI when the craft is within this of the PDI point
  settleStart: 3.5, // s: establishing shot holds until here
  settleEnd: 12.5, // s: camera fully settled
  handover: 4, // s: blend from wherever the cruise camera and craft were
  // Settled framing, in Moon radii relative to the craft's track point.
  // Solved for a landscape phone: craft upper left with room ahead, the site
  // ahead below it, the bottom-right corner left for the LUNAR DESCENT prompt.
  shot: { side: 0.35, rise: 0.05, back: -0.2, lookAhead: 0.15, lookDrop: 0.1 },
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
const lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
export const smoother = (x) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * c * (c * (c * 6 - 15) + 10);
};

/* ---- Moon orientation --------------------------------------------------- */
// three.js SphereGeometry with an equirectangular map: longitude λ, latitude φ
// lands at local (cos φ cos λ, sin φ, -cos φ sin λ).
const lzLocal = [Math.cos(LZ_LAT) * Math.cos(LZ_LON), Math.sin(LZ_LAT), -Math.cos(LZ_LAT) * Math.sin(LZ_LON)];
const eastLocal = norm([-Math.sin(LZ_LON), 0, -Math.cos(LZ_LON)]);
const northLocal = cross(lzLocal, eastLocal);

// World frame at the site: up = +Y, east = towards the Sun's azimuth (morning).
const UP = [0, 1, 0];
const EAST = norm([SUN[0], 0, SUN[2]]);
const NORTH = cross(UP, EAST);
/** Along-track direction over the site (the craft flies west) and the cross-track side. */
export const WEST = scale(EAST, -1);
export const SIDE = cross(WEST, UP); // camera side: the craft then moves left to right on screen

/** Row-major 3x3 rotation taking Moon-local vectors to world (columns: east, north, up mapping). */
export const MOON_ROTATION = (() => {
  // R = W · Lᵀ, W = [EAST NORTH UP] as columns, L = [east north up] (local) as columns.
  const W = [EAST, NORTH, UP];
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
export const LZ_SUN_ELEVATION = Math.asin(dot(UP, SUN)) / DEG;

/* ---- the craft ---------------------------------------------------------- */
/** Along-track angle from the site at time tau (s since lunar orbit began). */
export function craftAlpha(tau) {
  const t = Math.max(0, tau);
  return ORBIT.pdiAlpha + ORBIT.drift * t - ORBIT.arrival * Math.exp(-t / ORBIT.arrivalT);
}

/** Slow "track" angle the settled camera follows (the craft converges onto it). */
export const trackAlpha = (tau) => ORBIT.pdiAlpha + ORBIT.drift * Math.max(0, tau);

const radialAt = (alpha) => add(scale(UP, Math.cos(alpha)), scale(WEST, Math.sin(alpha)));
const forwardAt = (alpha) => add(scale(UP, -Math.sin(alpha)), scale(WEST, Math.cos(alpha)));

/** Craft position, direction of flight and local vertical. M = Moon centre, R = Moon radius. */
export function craftPose(tau, M, R) {
  const a = craftAlpha(tau);
  const radial = radialAt(a);
  return { pos: add(M, scale(radial, R * (1 + ORBIT.altitude))), fwd: forwardAt(a), up: radial, alpha: a };
}

/** True once the craft has reached the powered-descent start point. */
export const goForPdi = (tau) => craftAlpha(tau) >= ORBIT.pdiAlpha - ORBIT.goMargin;

/** Landing site on the surface (for the marker). */
export const landingSite = (M, R) => add(M, scale(UP, R));

/* ---- the camera --------------------------------------------------------- */
// Settled composition, relative to the slow track point: beside and above the
// flight path, the craft in the upper part of the frame moving left to right,
// the curved surface and the site ahead below it.
function settledPose(tau, M, R) {
  const a = trackAlpha(tau);
  const radial = radialAt(a);
  const fwd = forwardAt(a);
  const craft = add(M, scale(radial, R * (1 + ORBIT.altitude)));
  const k = ORBIT.shot;
  const pos = add(add(add(craft, scale(SIDE, R * k.side)), scale(radial, R * k.rise)), scale(fwd, -R * k.back));
  const look = add(add(craft, scale(fwd, R * k.lookAhead)), scale(radial, -R * k.lookDrop));
  return { pos, look };
}

// Establishing shot: the whole Moon from the same side, the site near its top.
function widePose(M, R) {
  const dir = norm(add(scale(SIDE, Math.cos(32 * DEG)), scale(UP, Math.sin(32 * DEG))));
  return { pos: add(M, scale(dir, R * 3.6)), look: add(M, scale(UP, R * 0.25)) };
}

/**
 * Camera pose at tau: the establishing shot with a very slow push-in, then one
 * eased move into the settled composition. Up is always world +Y (no roll).
 */
export function orbitCamera(tau, M, R) {
  const w = widePose(M, R);
  const s = settledPose(tau, M, R);
  // A barely perceptible push-in while the establishing shot holds.
  const push = 1 - 0.06 * smoother(tau / ORBIT.settleStart);
  const wide = { pos: add(M, scale(add(w.pos, scale(M, -1)), push)), look: w.look };
  const u = smoother((tau - ORBIT.settleStart) / (ORBIT.settleEnd - ORBIT.settleStart));
  return { pos: lerp(wide.pos, s.pos, u), look: lerp(wide.look, s.look, u), up: UP.slice(), settle: u };
}
