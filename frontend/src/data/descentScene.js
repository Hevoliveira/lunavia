/*
 * The descent's world below the capsule: the sea, the clouds, the parachutes, the splash and the
 * floating capsule (pure, unit-tested; drawn by components/scenes/descent and ReentryScene).
 * Presentation only: everything here reads the reentry simulation's state (altitude, downrange,
 * the parachutes' deployment times, the splashdown outcome) and changes none of it.
 *
 * ONE SCALE. The reentry scene draws the capsule 1 unit across (3.9 m). The sea, the clouds and
 * the parachutes are drawn at that same scale (1 unit = 3.9 m), so a 1 m swell, a 25 m canopy
 * and a 2 km cumulus keep their true sizes next to the capsule. (Before, the low world was drawn
 * at 25 m per unit and the capsule was 6.4× too big for its sea and its clouds.)
 */

export const M_PER_UNIT = 3.9; // metres per scene unit (the capsule's 3.9 m diameter = 1)
export const R_EARTH_M = 6371e3;
export const R_EARTH_U = R_EARTH_M / M_PER_UNIT;
export const u = (m) => m / M_PER_UNIT;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

/** The sea's mean surface below the capsule (scene y, units) at altitude h (m). */
export const seaLevelY = (h) => -Math.max(0, h) / M_PER_UNIT;
/** How far the sea's surface falls away with the Earth's curvature at horizontal distance d (units). */
export const curvatureDrop = (d) => (d * d) / (2 * R_EARTH_U);
/** Distance to the horizon (units) from height h (m) above the sea. */
export const horizonDistance = (h) => Math.sqrt(2 * R_EARTH_U * Math.max(0, h) / M_PER_UNIT);

/** When the low world (sea and clouds) is drawn, by altitude (m): fades in below 26 km, full below 15 km. */
export const lowWorldFade = (h) => smooth((26000 - h) / 11000);

/* ---- the sea --------------------------------------------------------------------------------- */
/*
 * A recovery sea state (Douglas 3, "slight"): a long swell and shorter wind waves, significant
 * height about 1 m. Gerstner waves in metres (shared by the ocean shader and the floating capsule,
 * so the capsule rides the very surface that is drawn). dir: heading of travel, radians.
 */
// A swell is never one train of identical crests: its energy is spread over a band of lengths and
// directions, so its crests are short and come in groups. Nine components, two swell systems
// (from about 0.5 rad and 1.2 rad) spread ±25° and 46-104 m long, and the wind sea's longest
// waves: summed, an irregular, short-crested swell with no long parallel stripes. (The shorter
// wind sea is data/oceanSpectrum's.)
export const WAVES = [
  { len: 104, amp: 0.18, dir: 0.42, steep: 0.5 },
  { len: 88, amp: 0.156, dir: 0.7, steep: 0.5 },
  { len: 97, amp: 0.139, dir: 0.18, steep: 0.5 },
  { len: 79, amp: 0.119, dir: 0.92, steep: 0.5 },
  { len: 71, amp: 0.09, dir: 0.33, steep: 0.45 },
  { len: 62, amp: 0.111, dir: 1.22, steep: 0.45 },
  { len: 54, amp: 0.078, dir: 1.48, steep: 0.45 },
  { len: 46, amp: 0.061, dir: 1.02, steep: 0.4 },
  { len: 33, amp: 0.057, dir: -0.1, steep: 0.4 },
];
const G = 9.81;
export const waveSpeed = (lenM) => Math.sqrt((G * lenM) / (2 * Math.PI)); // deep water, m/s
export const SIGNIFICANT_HEIGHT_M = 2 * Math.sqrt(WAVES.reduce((s, w) => s + 2 * w.amp * w.amp, 0));

/**
 * The sea surface's height (m above mean sea level) and slope at horizontal position (x, z) in
 * metres, time t (s). (The vertical part of the Gerstner sum; the shader adds the small
 * horizontal crowding of crests.) Returns { h, dx, dz } (dh/dx, dh/dz).
 */
export function seaSurface(xm, zm, t) {
  let h = 0;
  let dx = 0;
  let dz = 0;
  for (const w of WAVES) {
    const k = (2 * Math.PI) / w.len;
    const c = waveSpeed(w.len);
    const ax = Math.cos(w.dir);
    const az = Math.sin(w.dir);
    const ph = k * (ax * xm + az * zm - c * t);
    h += w.amp * Math.sin(ph);
    const g = w.amp * k * Math.cos(ph);
    dx += g * ax;
    dz += g * az;
  }
  return { h, dx, dz };
}

/* ---- the clouds ---------------------------------------------------------------------------- */
/*
 * The cumulus layer is data/cumulusField (a weather map of scattered cells) drawn by
 * components/scenes/descent/CumulusLayer (one ray-marched pass). Here only where the capsule comes
 * down: it drifts 325 m (-X) under its drogues (the same on every flown entry: data/reentryPhysics,
 * measured), then comes straight down under its mains.
 */
export const DROGUE_DRIFT_M = 325;

/* ---- the parachutes ------------------------------------------------------------------------- */
/*
 * Apollo's: two drogues (5 m), then three ringsail mains (25.4 m across), orange and white gores,
 * on suspension lines about twice the canopy's diameter, converging on the riser above the apex.
 * In capsule units, relative to the capsule's centre.
 */
export const MAIN = { radius: u(12.7), depth: u(7.5), gores: 32, lineLen: u(41), spread: 0.32, confluence: 1.15 };
export const DROGUE = { radius: u(2.5), depth: u(2.4), gores: 16, lineLen: u(14), spread: 0.24, confluence: 1.0 };
/** Where each of the three mains' canopy centres sits (units, relative to the riser confluence, before tilt), inflated u (0..1). */
export function mainCanopyCentres(inflation = 1) {
  const k = 0.25 + 0.75 * inflation;
  return [0, 1, 2].map((i) => {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const lateral = Math.sin(MAIN.spread) * MAIN.lineLen * k;
    const up = Math.cos(MAIN.spread) * MAIN.lineLen;
    return [Math.cos(a) * lateral, up, Math.sin(a) * lateral];
  });
}

/* ---- splashdown, flotation and the parachutes' release --------------------------------------- */
/*
 * The command module floats apex up (stable 1), the heat shield and the lower cone under water:
 * the waterline about 1.1 m above the heat shield's lowest point (the recovery photographs show the
 * sea just above the rim). The capsule's own frame: the heat shield's lowest point is y = -0.109,
 * the rim y ≈ 0.04, the apex y = 0.77 (data/csmDesign).
 */
export const FLOAT = { waterlineY: 0.17, shieldBottomY: -0.109, rimR: 0.515, tilt: 0.06 };
export const SPLASH = {
  dip: u(0.9), // how far the capsule plunges past its floating depth at impact (m → units)
  dipT: 0.55, // s to the bottom of the plunge
  settle: 2.2, // s for the bob to die down
  dropletLife: 1.6,
  crownH: u(4.5), // the spray's height
  ringSpeed: u(5.5), // the impact ring's speed over the sea (m/s → units/s)
};
/**
 * The capsule's vertical offset from its floating depth (units) t seconds after contact: the
 * plunge and a damped bob back. Starts at 0 (contact), goes down, comes back, settles.
 */
export function splashBob(t) {
  if (t <= 0) return 0;
  if (t < SPLASH.dipT) return -SPLASH.dip * Math.sin((Math.PI / 2) * (t / SPLASH.dipT));
  const x = t - SPLASH.dipT;
  return -SPLASH.dip * Math.exp(-x / (SPLASH.settle * 0.45)) * Math.cos(x * 2.6);
}
/**
 * Where the released parachutes are, s seconds after splashdown. They do not stop when the capsule
 * does: at contact they are still coming down at the descent rate (the lines go slack and the mains
 * are released), so they fall on, collapsing as they lose their load into streamers, a little faster
 * as they deflate, and reach the sea about three seconds later, downwind of the capsule; there they
 * lie bunched and crumpled on the swell, and slowly sink (Apollo's mains had no flotation).
 * { drop (0..1, of the way down), collapse (0 open .. 1 deflated), flat (0..1, lying on the sea),
 * drift (units), sink (0 on the surface .. 1 gone) }.
 */
export const RELEASE = { heightM: 46, speedMS: 8.5, accelMS2: 4 };
// when they reach the sea (s after contact)
const RELEASE_LAND = (-RELEASE.speedMS + Math.sqrt(RELEASE.speedMS ** 2 + 2 * RELEASE.accelMS2 * RELEASE.heightM)) / RELEASE.accelMS2;
export function chuteRelease(s) {
  if (s <= 0) return { drop: 0, collapse: 0, flat: 0, drift: 0, sink: 0 };
  const x = s;
  const fallen = RELEASE.speedMS * x + 0.5 * RELEASE.accelMS2 * x * x;
  const drop = Math.min(1, fallen / RELEASE.heightM);
  return {
    drop,
    collapse: smooth(x / 1.4),
    // they lie down on the sea as they reach it (not in the air), the fabric settling in a second
    flat: smooth((x - RELEASE_LAND + 0.45) / 0.8),
    drift: u(24) * (1 - Math.exp(-x / 3)) + u(0.5) * x,
    // the whole sheet goes under at once as it waterlogs (never the sea rising through it, which
    // would leave its folds as separate islands): still on the surface through the recovery shot
    sink: smooth((x - 6) / 16),
  };
}

/** On-screen confirmation after contact, seconds after splashdown: SPLASHDOWN CONFIRMED, then CREW SAFE. */
export const CONFIRM = { splashdown: 0.6, crewSafe: 2.4, done: 6.5 };

/* ---- cameras (units, relative to the capsule) ------------------------------------------------- */
const lerp3 = (a, b, k) => a.map((x, i) => x + (b[i] - x) * k);
/** The heat shield's lowest point below the capsule's centre while it hangs (units): the sea meets it there. */
const HANG_LOW = 0.11;
/** The entry camera's side view once the plasma is over (ReentryScene), where the descent camera starts. */
export const ENTRY_SIDE = { pos: [2.8, 0.4, 4.6], look: [0.3, 0.1, 0] };
/** Shot A (the final approach): well off to the side and a little below, the three canopies and the capsule under them in frame, the sea below; until 400 m. */
const SHOT_A = { x: 17, y: -2.0, z: 30, look: 4.5, until: 400 };
/**
 * Shot P (the final descent, as recovery photographs show it, from about 450 m to 150 m): above
 * the parachutes and off to the side, looking down, so the whole assembly is in frame (the three
 * canopies, their lines and the capsule) against the sea, with the horizon and the distant clouds
 * along the top of the frame. A 50° lens. (Framing all three 25 m canopies and the capsule 50 m
 * below them, the capsule cannot be much more than 6 % of the frame's height: the real photographs
 * show it so. It reads against the dark water.)
 */
const SHOT_P = { a: 0.17, d: 18, y: 12.5, look: 7.4, fov: 50, from: 450, to: 230, until: 150 };
/** Shot B (the water contact), relative to the point of contact: low over the waves, close beside it. */
const SHOT_B = { a: 0.65, d: 6.5, y: 0.7, fov: 42 }; // azimuth (rad, from +z towards +x), distance, height above the sea
/**
 * Shot C (the recovery): close and low over the water (about 13 m off, 1.6 m up, a 38° lens), round
 * towards the Sun so the capsule's face is lit; the capsule a quarter of the frame, the water
 * round it, the horizon and the distant clouds beyond.
 */
const SHOT_C = { a: -0.1, d: 3.3, y: 0.42, fov: 38 };
/** The descent and entry views' lens. */
export const FOV_DEFAULT = 45;
const polar = (a, d, y) => [Math.sin(a) * d, y, Math.cos(a) * d];
/**
 * The descent camera, one continuous move from the drogues to the water (h: altitude, m;
 * sinceMain: sim seconds since the mains deployed, or null; t: clock, for a slight sway;
 * sinceDrogue: sim seconds since the drogues deployed):
 * - under the drogues, above and behind the capsule, looking down past it at the cumulus below;
 * - as the mains inflate, round and down to the main-parachute shot: beside the capsule, a little
 *   below it, looking up at the three canopies, the cloud towers it falls between behind them;
 * - Shot A, the final approach (from 1.3 km): wider, off to the side and a little below, the whole
 *   parachute system and the capsule in frame, the sea below;
 * - Shot B, the last 400 m: round the capsule's column and closing in, coming down with it to the
 *   waves, to see it meet the water close by. It never goes below the waves. Returns { pos, look }.
 */
export function chuteCamera(h, sinceMain = null, t = 0, sinceDrogue = Infinity) {
  const sway = Math.sin(t * 0.13) * 0.6;
  const sea = seaLevelY(h) - HANG_LOW; // the sea's surface below the capsule's centre
  let fov = FOV_DEFAULT;
  // as the drogues open, an eased move up and back from the entry's side view (no jolt)
  const d0 = smooth(sinceDrogue / 7);
  let pos = lerp3(ENTRY_SIDE.pos, [8 + sway * 0.6, 4.5, 13], d0);
  let look = lerp3(ENTRY_SIDE.look, [0, 0.5, 0], d0);
  if (sinceMain !== null) {
    const w = smooth(sinceMain / 8);
    pos = lerp3(pos, [13.5 + sway, -2.2, 24.5], w);
    look = lerp3(look, [0, 3.2, 0], w);
    const a = smooth((1300 - h) / 850);
    pos = lerp3(pos, [SHOT_A.x + sway * 0.5, SHOT_A.y, SHOT_A.z], a);
    look = lerp3(look, [0, SHOT_A.look, 0], a);
    // shot P: up and over, round to the side, looking down on the whole assembly against the sea
    const p = smooth((SHOT_P.from - h) / (SHOT_P.from - SHOT_P.to));
    const P = [...polar(SHOT_P.a, SHOT_P.d, SHOT_P.y)];
    P[0] += sway * 0.3;
    pos = lerp3(pos, P, p);
    look = lerp3(look, [0, SHOT_P.look, 0], p);
    fov = FOV_DEFAULT + (SHOT_P.fov - FOV_DEFAULT) * p;
    if (h < SHOT_P.until) {
      // the last 150 m: down from shot P to the water beside the capsule (shot B at contact)
      const q = smooth(Math.max(0, h) / SHOT_P.until); // 1 at 150 m .. 0 at the water
      const yB = SHOT_B.y - HANG_LOW;
      const B = polar(SHOT_B.a, SHOT_B.d, yB);
      const k = 1 - q;
      // round and down: the angle and distance first, the height eased so it never drops past the capsule's line
      pos = lerp3(P, B, k);
      pos[1] = yB + (P[1] - yB) * Math.pow(q, 1.6);
      // the aim lowered steadily with the height left (no whip down at the end)
      look = [0, 0.3 + (SHOT_P.look - 0.3) * (Math.max(0, h) / SHOT_P.until), 0];
      fov = SHOT_P.fov + (SHOT_B.fov - SHOT_P.fov) * k;
    }
  }
  pos[1] = Math.max(pos[1], sea + 0.7);
  return { pos, look, fov };
}
/**
 * After splashdown (s seconds after contact; the scene's origin is the point of contact, the sea
 * HANG_LOW below it): Shot B held as the splash rises and falls back, then round and in to
 * Shot C, the hero shot, close and low over the water (the capsule large in frame, rocking on
 * the swell, the released canopies on the sea behind it), slowly circling on. The MISSION
 * COMPLETE backdrop runs on from here (from CONFIRM.done).
 */
export function recoveryCamera(s) {
  const k = smooth((s - 2.2) / 5);
  const on = Math.max(0, s - 7.2);
  const a = SHOT_B.a + (SHOT_C.a - SHOT_B.a) * k - 0.005 * on;
  const d = SHOT_B.d + (SHOT_C.d - SHOT_B.d) * k + 0.5 * smooth(on / 40);
  const y = -HANG_LOW + SHOT_B.y + (SHOT_C.y - SHOT_B.y) * k;
  return { pos: polar(a, d, y), look: [0, 0.3 - 0.12 * k, 0], fov: SHOT_B.fov + (SHOT_C.fov - SHOT_B.fov) * k };
}

export const _test = { smooth };
