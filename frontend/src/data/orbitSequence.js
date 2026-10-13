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
import { undocking } from "./undocking";

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
 * 0–5.6    LUNAR ORBIT INSERTION  close: the stack, engine first, fires its SPS
 *          engine retrograde over the Moon (behind it, out of contact with Earth)
 * 5.6–10.1 ESTABLISHING  the whole Moon, the orbit and the landing site; the spacecraft a glint
 * 10.1–    THE SPACECRAFT medium tracking shot: CSM and LM docked above the lunar horizon
 * 16.6–    PREPARATION   close on the docking tunnel: LM crew aboard, latches armed
 * 21.6     UNDOCKING     latches open; the CSM backs away on its RCS
 * 21.6–    SEPARATION    the gap opens; the LM rolls to show its landing gear
 * 31.6–    TWO SPACECRAFT wide: the CSM stays in orbit, the LM moves on; separation burn;
 *          FLIGHT: "we're go for powered descent"
 * 36–      TITLE         the camera eases in behind the LM as it moves away:
 *          LUNAVIA, then A LAJU PRODUCTIONS GAME (data/titleReveal)
 * 46.4–    the camera stays with the LM while the descent is set up
 */
export const ORBIT_SEQ = {
  loi: 0,
  ignition: 0.9, // SPS on
  cutoff: 4.7, // SPS off (a 6-minute burn, condensed)
  arrive: 5.6, // establishing shot; the time-compressed arrival starts here
  cut: 10.1, // to the spacecraft
  tunnel: 16.6,
  undock: 21.6,
  pair: 31.6,
  goPdi: 34.8,
  title: 36,
  end: 46.4,
};

/** Real orbital motion after the establishing shot: about 1.56 km/s at 278 km (0.044°/s). */
export const ORBIT_RATE = (Math.sqrt(4902.8 / (MOON_RADIUS_KM * 1.16)) / (MOON_RADIUS_KM * 1.16)) / DEG; // deg/s

// The docked LM's centre along the stack (vehicle +X, metres), for shots that follow it.
export const LM_CENTRE_X = 7.0;

// The two framings either side of the title shot, LM-relative (metres): where the
// TWO SPACECRAFT shot leaves the camera, and where it settles behind the LM with
// the LM in the right third and room for the title on the left.
const PAIR_END = { pos: [-6, 13, 37], look: [2.5, -4.2, 0] };
const TITLE_LM_X = LM_CENTRE_X + undocking(ORBIT_SEQ.title - ORBIT_SEQ.undock).lmY;
const TITLE_FROM = { pos: [PAIR_END.pos[0] - TITLE_LM_X, PAIR_END.pos[1], PAIR_END.pos[2]], look: [PAIR_END.look[0] - TITLE_LM_X, PAIR_END.look[1], PAIR_END.look[2]] };
export const TITLE_HOLD = { pos: [-11, 6, 19], look: [-6, -3, -4] };

export const ORBIT_SHOTS = [
  {
    id: "loi",
    start: ORBIT_SEQ.loi,
    len: ORBIT_SEQ.arrive - ORBIT_SEQ.loi,
    kicker: "BEHIND THE MOON",
    caption: "LUNAR ORBIT INSERTION",
    sub: "SPS ENGINE · RETROGRADE BURN · OUT OF CONTACT WITH EARTH",
    // Engine first (the stack turned round on the approach): from behind its sunlit
    // side, the plume ahead, the lunar horizon below.
    yaw: Math.PI,
    cam: (u) => ({ pos: lerp([-15, 8.5, 24], [-12, 7.5, 21], ease(u)), look: lerp([3, -4, 0], [4, -3.5, 0], ease(u)) }),
  },
  {
    id: "establish",
    start: ORBIT_SEQ.arrive,
    len: ORBIT_SEQ.cut - ORBIT_SEQ.arrive,
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
    len: ORBIT_SEQ.tunnel - ORBIT_SEQ.cut,
  },
  {
    id: "tunnel",
    start: ORBIT_SEQ.tunnel,
    caption: "UNDOCKING PREPARATION",
    sub: "LM CREW ABOARD · TUNNEL CLOSED · LATCHES ARMED",
    cam: (u) => ({ pos: lerp([0.6, 4.8, 13], [1.4, 4.3, 11.2], ease(u)), look: [3.2, -1.3, 0] }),
    len: ORBIT_SEQ.undock - ORBIT_SEQ.tunnel,
  },
  {
    id: "undock",
    start: ORBIT_SEQ.undock,
    caption: "UNDOCKING",
    sub: "LATCHES RELEASED · CSM BACKING AWAY ON RCS",
    cam: (u) => ({ pos: lerp([-2, 7.5, 21], [0, 8, 24], ease(u)), look: lerp([2.5, -2.6, 0], [3.6, -2.6, 0], ease(u)) }),
    len: ORBIT_SEQ.pair - ORBIT_SEQ.undock,
  },
  {
    id: "pair",
    start: ORBIT_SEQ.pair,
    caption: "TWO SPACECRAFT",
    sub: "THE CSM REMAINS IN LUNAR ORBIT · THE LUNAR MODULE PREPARES FOR DESCENT",
    cam: (u) => ({ pos: lerp([-9, 12.5, 33], PAIR_END.pos, ease(u)), look: lerp([4, -4.2, 0], PAIR_END.look, ease(u)) }),
    len: ORBIT_SEQ.title - ORBIT_SEQ.pair,
  },
  {
    id: "title",
    start: ORBIT_SEQ.title,
    follow: "lm",
    caption: null,
    // No cut: from where the two-spacecraft shot stopped, the camera eases in behind
    // the LM as it moves away, the CSM receding beyond it (data/titleReveal).
    cam: (u) => ({ pos: lerp(TITLE_FROM.pos, TITLE_HOLD.pos, ease(u)), look: lerp(TITLE_FROM.look, TITLE_HOLD.look, ease(u)) }),
    len: ORBIT_SEQ.end - ORBIT_SEQ.title,
  },
  {
    id: "followLm",
    start: ORBIT_SEQ.end,
    follow: "lm",
    caption: null,
    // Held where the title shot settled while the descent is set up.
    cam: () => TITLE_HOLD,
    len: Infinity,
  },
];

/**
 * The orbit shot's vehicle-frame camera at tau, for the LM's displacement lmY
 * (data/undocking): shots that follow the LM are offset to it.
 */
export function orbitShotCamera(shot, u, lmY) {
  const c = shot.cam(u);
  if (shot.follow !== "lm") return c;
  const x = LM_CENTRE_X + lmY;
  return { pos: [c.pos[0] + x, c.pos[1], c.pos[2]], look: [c.look[0] + x, c.look[1], c.look[2]] };
}

/** The SPS engine during lunar orbit insertion, 0..1 (soft start and shutdown). */
export const spsLevel = (tau) => Math.min(smooth((tau - ORBIT_SEQ.ignition) / 0.35), 1 - smooth((tau - ORBIT_SEQ.cutoff) / 0.5));

/** The shot at orbit time tau, with its own progress u (0..1). */
export function orbitShotAt(tau) {
  let s = ORBIT_SHOTS[0];
  for (const x of ORBIT_SHOTS) if (tau >= x.start) s = x;
  const u = s.len && isFinite(s.len) ? Math.min(1, (tau - s.start) / s.len) : 0;
  return { shot: s, u };
}

/** Undocking choreography time for orbit time tau (negative = still docked). */
export const undockTime = (tau) => tau - ORBIT_SEQ.undock;

/* ---- the cislunar coast and the return: close on the spacecraft (mission time) ---------- */
/*
 * Every shot from TLI to lunar orbit is close on the docked stack, the planet
 * behind it at its true apparent size for the spacecraft's real distance: the
 * Earth's apparent size only shrinks and the Moon's only grows, with no jump
 * between shots. (The scene's map-scale planets, 10x oversized for the
 * Earth-Moon views, are never seen from close by.) The return opens the same
 * way on the CSM alone, the Moon behind it.
 *
 * After TLI the CSM has turned round, docked with the LM and pulled it out of
 * its adapter (the launch cinematic). The stack flies broadside to the planet
 * behind (its thermal-control attitude), LM leading.
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
 * Distance from the Earth's centre (km) on the way out. It continues from the
 * launch cinematic's last shot (about 24,600 km at T+3:16): ~62,000 km three
 * hours after TLI, ~120,000 km at T+11 h, ~285,000 km at T+42 h.
 */
export const coastDistanceKm = (t) => Math.max(6556, 305 * Math.pow(Math.max(0, t - 9840), 0.577));
/** Distance from the Moon's centre (km) as the CSM leaves it after TEI (close return shot). */
export const returnDistanceKm = (t) => 1837 + 2.2 * Math.pow(Math.max(0, t - 504000), 0.95);

/**
 * The coast from TLI to lunar orbit, in mission time t (s) and in real seconds
 * s since it began (the mission's cruise clock):
 *   DEPARTURE  close, the Earth behind receding         t 12,000 → 40,000    s 0 → 4
 *   DEEP SPACE medium tracking, the Earth small behind   t 40,000 → 150,000   s 4 → 8.2
 *   APPROACH   close, the Moon behind growing; the stack
 *              turns engine first for the insertion burn t 150,000 → 207,000  s 8.2 → 15
 * then lunar orbit opens on the insertion burn (ORBIT_SEQ.loi), with no fade.
 */
export const CISLUNAR = {
  start: 12000,
  departEnd: 40000,
  deepEnd: 150000,
  los: 207000, // the stack nears the Moon's limb; it passes behind for the burn (loss of signal)
  s: { depart: 4, deep: 8.2, end: 15 },
  moonKm: [64000, 4600], // the approach: distance from the Moon's centre (km), first and last frame
  turn: [0.22, 0.9], // the approach's progress over which the stack turns engine first
};

/** Mission time at s real seconds into the coast. */
export function cruiseTime(s) {
  const S = CISLUNAR.s;
  if (s <= S.depart) return CISLUNAR.start + (CISLUNAR.departEnd - CISLUNAR.start) * (Math.max(0, s) / S.depart);
  if (s <= S.deep) return CISLUNAR.departEnd + (CISLUNAR.deepEnd - CISLUNAR.departEnd) * ((s - S.depart) / (S.deep - S.depart));
  return CISLUNAR.deepEnd + (CISLUNAR.los - CISLUNAR.deepEnd) * Math.min(1, (s - S.deep) / (S.end - S.deep));
}

/** The coast shot at mission time t: { id: "depart" | "deep" | "approach", u (0..1) }. */
export function coastShotAt(t) {
  const c = (x) => Math.min(1, Math.max(0, x));
  if (t < CISLUNAR.departEnd) return { id: "depart", u: c((t - CISLUNAR.start) / (CISLUNAR.departEnd - CISLUNAR.start)) };
  if (t < CISLUNAR.deepEnd) return { id: "deep", u: c((t - CISLUNAR.departEnd) / (CISLUNAR.deepEnd - CISLUNAR.departEnd)) };
  return { id: "approach", u: c((t - CISLUNAR.deepEnd) / (CISLUNAR.los - CISLUNAR.deepEnd)) };
}

/** Distance from the Moon's centre (km) at approach progress u: a steady zoom (the Moon's size grows at a constant rate). */
export const approachMoonKm = (u) => CISLUNAR.moonKm[0] * Math.pow(CISLUNAR.moonKm[1] / CISLUNAR.moonKm[0], Math.min(1, Math.max(0, u)));

/**
 * The approach is seen from the side of the Moon the lunar-orbit shots look at
 * (data/lunarOrbitShot CAMERA_RAY, azimuth -100°): the same sunlit face, lit the
 * same way, from the first frame of the approach to the establishing shot.
 */
export const APPROACH_RAY = [Math.cos(-100 * DEG), 0, Math.sin(-100 * DEG)];

/**
 * The stack's turn, engine first, during the approach (about the vehicle's
 * local vertical, through the stack's middle): { yaw (rad), rcs (-1..1) },
 * rcs the turning couple's level (+: speeding the turn up, -: stopping it).
 */
export function approachYaw(u) {
  const [a, b] = CISLUNAR.turn;
  const f = (x) => Math.PI * ease((x - a) / (b - a));
  const h = 0.004;
  const acc = (f(u + h) - 2 * f(u) + f(u - h)) / (h * h);
  const peak = (Math.PI * 5.77) / ((b - a) * (b - a)); // the quintic's largest acceleration
  return { yaw: f(u), rcs: Math.max(-1, Math.min(1, acc / (peak * 0.5))) };
}

export const CRUISE_SHOT = {
  caption: "TRANSLUNAR COAST",
  sub: "THE CSM AND LM EXTRACTED FROM LV-001 · 3-DAY COAST TO THE MOON",
};
export function cruiseCamera(u) {
  return { pos: lerp([10, 4.5, 30], [5, 3.4, 24], ease(u)), look: lerp([STACK.mid + 1, -1.4, 0], [STACK.mid, -1.0, 0], ease(u)) };
}

export const DEEP_SHOT = { caption: "DEEP SPACE", sub: "DAY 2 · THE EARTH 280,000 KM BEHIND · PASSIVE THERMAL CONTROL" };
/** Deep space: further back, from the LM's end, the Earth small in the upper right. */
export function deepCamera(u) {
  return { pos: lerp([22, 8.5, 38], [15, 7, 44], ease(u)), look: lerp([0.5, 1.0, 0], [0, 0.8, 0], ease(u)) };
}

export const APPROACH_SHOT = { caption: "LUNAR APPROACH", sub: "THE CSM AND LM FROM LV-001 · TURNING ENGINE FIRST FOR LUNAR ORBIT INSERTION" };
/** The approach: from the stack's sunlit side, the Moon behind it in the upper left. */
export function approachCloseCamera(u) {
  return { pos: lerp([-10, 4.5, 26], [-7, 3.6, 21], ease(u)), look: lerp([-0.5, -0.8, 0], [0, -0.4, 0], ease(u)) };
}

export const RETURN_CLOSE_END = 560000; // mission s
export const RETURN_SHOT = { caption: "TRANSEARTH COAST", sub: "THE CSM HEADS HOME · THE LUNAR MODULE STAYED BEHIND" };
export function returnCamera(u) {
  return { pos: lerp([5, 4, 22], [2.5, 3, 17], ease(u)), look: [-2.4, -0.8, 0] };
}

export const _test = { norm, cross, dot };
