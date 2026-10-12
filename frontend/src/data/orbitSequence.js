/*
 * LUNAVIA — the spacecraft at true scale in the mission's space shots (pure, unit-tested).
 *
 * MissionScene draws two layers, composited every frame (as LaunchCinematic does):
 *  1. the planets (Earth, Moon, stars) in scene units, 1 unit ≈ 1,922 km;
 *  2. the spacecraft (data/csmDesign + the lunar module) in metres.
 * Both layers share one view direction. The planet camera stands where the
 * spacecraft is (plus the vehicle camera's offset, a few millionths of a unit),
 * so the Moon below and the Earth behind are seen at the sizes they have from
 * the spacecraft, and the spacecraft at its own 17 m. Camera distance and
 * composition make it read, never an enlarged model.
 *
 * Vehicle frame (metres): X along the flight path, Y the local vertical (away
 * from the Moon; in the cruise, the orbit-plane normal), Z = X × Y. The docked
 * stack lies along +X, lunar module leading, hatch side towards +Z.
 *
 * Wide shots, where a 17 m spacecraft would be far below one pixel, show it as
 * a sunlit glint on its path (the shots' `glint`).
 */
import { MOON_RADIUS_KM } from "./missionPhases";
import { MOON_UNITS } from "./sceneTrack";

export const M_PER_UNIT = (MOON_RADIUS_KM * 1000) / MOON_UNITS; // metres per scene unit (planets drawn at 10x Earth-Moon scale)

const DEG = Math.PI / 180;
const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
export const smooth = (x) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};
const ease = (x) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * c * (c * (c * 6 - 15) + 10);
};

/**
 * The vehicle frame at a pose: { x, y, z } world unit vectors (columns of the
 * vehicle-to-world rotation). fwd need not be exactly perpendicular to up.
 */
export function vehicleFrame(fwd, up) {
  const y = norm(up);
  const x = norm(cross(cross(y, fwd), y)); // fwd with its vertical part removed
  return { x, y, z: cross(x, y) };
}
export const toWorld = (F, v) => [F.x[0] * v[0] + F.y[0] * v[1] + F.z[0] * v[2], F.x[1] * v[0] + F.y[1] * v[1] + F.z[1] * v[2], F.x[2] * v[0] + F.y[2] * v[1] + F.z[2] * v[2]];
export const toVehicle = (F, w) => [dot(F.x, w), dot(F.y, w), dot(F.z, w)];

/* ---- the stack in the vehicle frame ----------------------------------------------- */
// Stack axis (the CSM's +Y) along +X: rotate -90° about Z. Lengths in metres (data/csmDesign).
export const STACK_ROTATION = [0, 0, -Math.PI / 2];
export const STACK = { aft: -7.85, nose: 3.0, lmFar: 9.1, mid: 0.6 }; // along +X

/* ---- the lunar-orbit sequence (mission) ----------------------------------------------- */
/*
 * Real seconds since lunar orbit began (the mission's orbit clock).
 * 0–4.5   ESTABLISHING  the whole Moon, the orbit and the landing site; the spacecraft a glint
 * 4.5–11  THE SPACECRAFT medium tracking shot: CSM and LM docked above the lunar horizon
 * 11–16   PREPARATION   close on the docking tunnel: LM crew aboard, latches armed
 * 16      UNDOCKING     latches open; the CSM backs away on its RCS
 * 16–26   SEPARATION    the gap opens; the LM rolls to show its landing gear
 * 26–34   TWO SPACECRAFT wide: the CSM stays in orbit, the LM moves on; separation burn
 * 34–     the camera stays with the LM while the descent is set up (GO FOR PDI)
 */
export const ORBIT_SEQ = { cut: 4.5, undock: 16, goPdi: 33, end: 34 };

/** Real orbital motion after the establishing shot: about 1.56 km/s at 278 km (0.044°/s). */
export const ORBIT_RATE = (Math.sqrt(4902.8 / (MOON_RADIUS_KM * 1.16)) / (MOON_RADIUS_KM * 1.16)) / DEG; // deg/s

export const ORBIT_SHOTS = [
  {
    id: "establish",
    start: 0,
    wide: true,
    caption: "LUNAR ORBIT",
    sub: "LUNAR ORBIT INSERTION COMPLETE · CSM AND LM DOCKED",
  },
  {
    id: "stack",
    start: ORBIT_SEQ.cut,
    caption: "LV-001 IN LUNAR ORBIT",
    sub: "THE CSM AND LM FROM LV-001 · LM LANDING PROBES DEPLOYED",
    // A slow push along the stack from below its sunlit side, the horizon behind.
    cam: (u) => ({ pos: lerp([-9, 9.5, 26], [-4, 8.2, 21], ease(u)), look: lerp([1.2, -3.6, 0], [1.6, -3.2, 0], ease(u)) }),
    len: 6.5,
  },
  {
    id: "tunnel",
    start: 11,
    caption: "UNDOCKING PREPARATION",
    sub: "LM CREW ABOARD · TUNNEL CLOSED · LATCHES ARMED",
    cam: (u) => ({ pos: lerp([0.6, 4.8, 13], [1.4, 4.3, 11.2], ease(u)), look: [3.2, -1.3, 0] }),
    len: 5,
  },
  {
    id: "undock",
    start: ORBIT_SEQ.undock,
    caption: "UNDOCKING",
    sub: "LATCHES RELEASED · CSM BACKING AWAY ON RCS",
    cam: (u) => ({ pos: lerp([-2, 7.5, 21], [0, 8, 24], ease(u)), look: lerp([2.5, -2.6, 0], [3.6, -2.6, 0], ease(u)) }),
    len: 10,
  },
  {
    id: "pair",
    start: 26,
    caption: "TWO SPACECRAFT",
    sub: "THE CSM REMAINS IN LUNAR ORBIT · THE LUNAR MODULE PREPARES FOR DESCENT",
    cam: (u) => ({ pos: lerp([-9, 12.5, 33], [-6, 13, 37], ease(u)), look: lerp([4, -4.2, 0], [6.5, -4.2, 0], ease(u)) }),
    len: 8,
  },
  {
    id: "followLm",
    start: ORBIT_SEQ.end,
    follow: "lm",
    caption: null,
    // Behind the LM, the CSM receding beyond it; held while the descent is set up.
    cam: () => ({ pos: [-9, 6.5, 15], look: [1.5, -2.6, 0] }),
    len: Infinity,
  },
];

/** The shot at orbit time tau, with its own progress u (0..1). */
export function orbitShotAt(tau) {
  let s = ORBIT_SHOTS[0];
  for (const x of ORBIT_SHOTS) if (tau >= x.start) s = x;
  const u = s.len && isFinite(s.len) ? Math.min(1, (tau - s.start) / s.len) : 0;
  return { shot: s, u };
}

/** Undocking choreography time for orbit time tau (negative = still docked). */
export const undockTime = (tau) => tau - ORBIT_SEQ.undock;

/* ---- the cruise and the return: close on the spacecraft (mission time) ------------------ */
/*
 * After TLI the upper stage has been left behind: the crew has turned the CSM
 * round, docked with the LM and pulled it out of its adapter (not shown; the
 * caption says so). The first cruise shot is close on the docked stack, flying
 * broadside to the Earth (its thermal-control attitude), with the Earth behind
 * it at its true apparent size for the spacecraft's real distance. The return
 * opens the same way on the CSM alone, the Moon behind it.
 *
 * radialFrame: Z away from the planet behind the shot, Y the orbit-plane normal
 * (world +Y), X = Y × Z along the stack. The planet is at -Z, beyond the stack.
 */
export function radialFrame(awayFromPlanet) {
  const z = norm([awayFromPlanet[0], 0, awayFromPlanet[2]]);
  const y = [0, 1, 0];
  return { x: cross(y, z), y, z };
}
/** Where to stand so that a planet of drawn radius R appears as it does from distanceKm (radius radiusKm). */
export const trueSizeDistance = (R, distanceKm, radiusKm) => (R * distanceKm) / radiusKm;

/**
 * Distance from the Earth's centre (km) during the close cruise shot. The
 * scene's trajectory eases out of Earth orbit for its wide views; the close
 * shot uses an Apollo-like coast instead, which continues from the launch
 * cinematic's last shot (about 24,600 km at T+3:16): ~62,000 km three hours
 * after TLI, ~120,000 km at T+11 h.
 */
export const coastDistanceKm = (t) => Math.max(6556, 305 * Math.pow(Math.max(0, t - 9840), 0.577));
/** Distance from the Moon's centre (km) as the CSM leaves it after TEI (close return shot). */
export const returnDistanceKm = (t) => 1837 + 2.2 * Math.pow(Math.max(0, t - 504000), 0.95);

export const CRUISE = { closeEnd: 40000, slowRate: 7000 }; // mission s; time compression during the close shot (s per real s)
export const CRUISE_SHOT = {
  caption: "TRANSLUNAR COAST",
  sub: "THE CSM AND LM EXTRACTED FROM LV-001 · 3-DAY COAST TO THE MOON",
};
export function cruiseCamera(u) {
  return { pos: lerp([10, 4.5, 30], [5, 3.4, 24], ease(u)), look: lerp([STACK.mid + 1, -1.4, 0], [STACK.mid, -1.0, 0], ease(u)) };
}

/*
 * Lunar approach: the docked stack close up, the Moon behind it at its true
 * size, in the last hours before loss of signal (when the spacecraft passes
 * behind the Moon for lunar orbit insertion; data/lunarOrbitShot APPROACH.los).
 */
export const APPROACH_CLOSE = { start: 195000, rate: 3000 }; // mission s; time compression (s per real s)
export const APPROACH_SHOT = { caption: "LUNAR APPROACH", sub: "THE CSM AND LM FROM LV-001 · LUNAR ORBIT INSERTION BEHIND THE MOON" };
/** Distance from the Moon's centre (km) closing in towards loss of signal at `los` (mirror of the return). */
export const approachDistanceKm = (t, los) => 1837 + 2.2 * Math.pow(Math.max(0, los - t), 0.95);
export function approachCloseCamera(u) {
  return { pos: lerp([9, 4, 26], [6, 3.2, 21], ease(u)), look: lerp([STACK.mid + 1.5, -0.8, 0], [STACK.mid + 1, -0.4, 0], ease(u)) };
}

export const RETURN_CLOSE_END = 560000; // mission s
export const RETURN_SHOT = { caption: "TRANSEARTH COAST", sub: "THE CSM HEADS HOME · THE LUNAR MODULE STAYED BEHIND" };
export function returnCamera(u) {
  return { pos: lerp([5, 4, 22], [2.5, 3, 17], ease(u)), look: [-2.4, -0.8, 0] };
}

export const _test = { norm, cross, dot };
