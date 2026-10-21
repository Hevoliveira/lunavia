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
export const WAVES = [
  { len: 96, amp: 0.42, dir: 0.5, steep: 0.55 },
  { len: 61, amp: 0.27, dir: 1.15, steep: 0.5 },
  { len: 33, amp: 0.13, dir: -0.25, steep: 0.45 },
  { len: 17, amp: 0.06, dir: 1.9, steep: 0.4 },
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
 * Fair-weather cumulus over a tropical recovery area (the references: scattered cumulus with flat
 * grey bases and bright cauliflower tops, a few towering ones, their shadows on the sea). Bases
 * 650–950 m, tops 1.2–2.6 km. The field is deterministic (seeded): the same clouds every flight.
 * Distances in units (3.9 m).
 *
 * Each cloud is built as a cumulus is: a wide, flattened body sitting on its condensation level
 * (one flat base for the whole cloud), one to three towers of rounded puffs narrowing upward, and
 * smaller cauliflower turrets on their upper surfaces. Every puff is a volume (an ellipsoid of
 * vapour, components/scenes/descent/CloudField), never a picture.
 *
 * The capsule comes down at the field's centre, between placed formations: a tall one behind it
 * as the descent camera looks, a lower one beside it, and two near towers either side of the
 * shot that the camera falls past under the main parachutes; a few thin wisps lie across the
 * camera's own path (it passes through them), none across the capsule's.
 */
// One condensation level for the whole field (bases within ±40 m of 820 m): flat bases in one plane, as a
// cumulus field has them.
export const CLOUD_FIELD = { radius: u(30000), count: 52, baseM: [780, 860], topM: [1200, 2600] };
// Ground positions: the capsule drifts 325 m (-X) under its drogues (the same on every flown
// entry: data/reentryPhysics, measured), then comes straight down under its mains. The placed
// clouds below are given relative to that final column (m), turned into field units here.
export const DROGUE_DRIFT_M = 325;
const col = (xM, zM) => ({ x: u(xM - DROGUE_DRIFT_M), z: u(zM) });
export const PLACED_CLOUDS = [
  { ...col(-640, -1250), r: u(600), baseM: 810, topM: 2300 }, // the tall formation behind the capsule
  { ...col(-40, -1200), r: u(420), baseM: 830, topM: 1750 },
  { ...col(-640, -380), r: u(400), baseM: 800, topM: 1700 }, // near cumulus, left of the shot
  { ...col(330, -980), r: u(470), baseM: 820, topM: 2150 }, // near cumulus, right of the shot
];
/** Thin wisps (fractus): none placed in this sky (the descent passes between the cumulus). */
export const WISPS = [];
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
let FIELD = null;
/**
 * The clouds and their puffs (units; y is the height above the sea):
 * { clouds: [{ x, z, base, top, r, dens, wisp }], puffs: [{ x, y, z, r, sy, dens, h01, seed, cloud }] }
 * sy: the puff's vertical squash (an ellipsoid r × r·sy × r); dens: its density (1 cumulus, < 1 a wisp);
 * h01: its height in its cloud (0 base .. 1 top).
 */
export function cloudField(seed = 20261021) {
  if (FIELD && seed === 20261021) return FIELD;
  const R = rng(seed);
  const F = CLOUD_FIELD;
  const clouds = PLACED_CLOUDS.map((c) => ({ x: c.x, z: c.z, r: c.r, base: u(c.baseM), top: u(c.topM), dens: 1, wisp: false }));
  while (clouds.length < F.count) {
    const i = clouds.length;
    const a = R() * Math.PI * 2;
    // a few more within a few kilometres (the layer is seen all round on the way down), the rest to 30 km
    const d = i < 10 ? u(1700 + R() * 3000) : F.radius * Math.sqrt(0.03 + 0.97 * R());
    const base = u(F.baseM[0] + R() * (F.baseM[1] - F.baseM[0]));
    const tall = Math.pow(R(), 2.2); // most clouds modest, a few towers (heavy-tailed)
    const r = u(380 + R() * 820) * (0.75 + 0.5 * tall);
    // cumulus are about as wide as they are tall; only a few tower above that
    const top = base + Math.min(1.5 * r, u(420 + tall * (F.topM[1] - F.baseM[0] - 420)));
    clouds.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, base, top, r, dens: 1, wisp: false });
  }
  const puffs = [];
  const column = { x: -u(DROGUE_DRIFT_M), z: 0 };
  clouds.forEach((c, ci) => {
    const H = c.top - c.base;
    // near clouds in full detail; far ones (a few pixels high) with fewer, larger puffs
    const near = Math.hypot(c.x - column.x, c.z - column.z) < u(9000);
    const add = (x, y, z, r, sy) => {
      // never above the cloud's top, never below its base
      const yy = Math.min(c.top - r * sy * 0.45, Math.max(c.base, y));
      puffs.push({ x, y: yy, z, r, sy, dens: 1, h01: Math.min(1, Math.max(0, (yy - c.base) / H)), seed: R(), cloud: ci });
      return { x, y: yy, z, r };
    };
    // 1. the base: wide, flattened puffs centred on the condensation level (cut flat by it)
    const nb = near ? 6 : 3;
    for (let i = 0; i < nb; i++) {
      const a = (i / nb) * Math.PI * 2 + R() * 0.8;
      const d = i === 0 ? 0 : c.r * (0.4 + 0.18 * R());
      add(c.x + Math.cos(a) * d, c.base, c.z + Math.sin(a) * d, c.r * (0.4 + 0.12 * R()), 0.75);
    }
    // 2. the body: overlapping columns rising from the base, narrowing upward and leaning a little
    //    downwind (+x), the tallest to the cloud's top, the others lower (a cumulus' several domes)
    const nCol = near ? 2 + (R() < 0.3 ? 1 : 0) : 2;
    const body = [];
    for (let k = 0; k < nCol; k++) {
      const a = R() * Math.PI * 2;
      const d = k === 0 ? c.r * 0.1 * R() : c.r * (0.25 + 0.2 * R());
      const top = k === 0 ? c.top : c.base + H * (0.4 + 0.4 * R());
      // a column is broad: a cumulus dome, not a stack of balls
      const r0 = Math.min(c.r * 0.62, Math.max(c.r * (k === 0 ? 0.45 : 0.36), H * (k === 0 ? 0.3 : 0.24))) * (0.9 + 0.2 * R()) * (near ? 1 : 1.2);
      // a broad, rounded top (a cumulus dome), not a narrowing stack of balls
      const r1 = Math.max(u(40), r0 * (0.62 + 0.14 * R()));
      const y0 = c.base + r0 * 0.35;
      const y1 = top - r1 * 0.55;
      const n = Math.max(1, Math.min(near ? 5 : 3, Math.ceil((y1 - y0) / (0.55 * (r0 + r1) * 0.5))));
      for (let j = 0; j <= n; j++) {
        const f = n === 0 ? 1 : j / n;
        const r = r0 + (r1 - r0) * f;
        const px = c.x + Math.cos(a) * d + c.r * 0.15 * f * f + (R() - 0.5) * r * 0.45;
        const pz = c.z + Math.sin(a) * d + (R() - 0.5) * r * 0.45;
        body.push({ ...add(px, y0 + (y1 - y0) * f, pz, r, 0.92), f });
      }
    }
    // 3. cauliflower turrets: rounded bulges half sunk into the upper body puffs, on their outer
    //    and upper sides (never floating free)
    body.forEach((b) => {
      const nT = b.f < 0.35 ? 0 : near ? 1 + (b.f > 0.7 ? 1 : 0) : b.f > 0.8 ? 1 : 0;
      for (let j = 0; j < nT; j++) {
        const ta = R() * Math.PI * 2;
        const el = (20 + R() * 60) * (Math.PI / 180);
        const tr = b.r * (0.34 + 0.2 * R());
        const off = b.r * (0.66 + 0.12 * R());
        add(b.x + Math.cos(ta) * Math.cos(el) * off, b.y + Math.sin(el) * off * 0.92, b.z + Math.sin(ta) * Math.cos(el) * off, tr, 1);
      }
    });
  });
  // the wisps: ragged, flattened, thin fragments
  WISPS.forEach((w) => {
    const ci = clouds.length;
    const y = u(w.yM);
    clouds.push({ x: w.x, z: w.z, r: w.r, base: y - w.r * 0.35, top: y + w.r * 0.35, dens: w.dens, wisp: true });
    for (let j = 0; j < 5; j++) {
      const a = (j / 5) * Math.PI * 2 + R();
      const r = w.r * (j === 0 ? 0.6 : 0.38 + 0.12 * R());
      const d = j === 0 ? 0 : w.r * (0.35 + 0.25 * R());
      puffs.push({ x: w.x + Math.cos(a) * d, y: y + (R() - 0.5) * w.r * 0.15, z: w.z + Math.sin(a) * d * 0.7, r, sy: 0.32, dens: w.dens, h01: 0.5, seed: R(), cloud: ci });
    }
  });
  const out = { clouds, puffs };
  if (seed === 20261021) FIELD = out;
  return out;
}

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
 * Where the released parachutes are, s seconds after splashdown: 0 hanging, then the wind carries
 * them down and away downwind, they settle on the sea, spread and crumpled, and slowly sink
 * (Apollo's mains had no flotation). { drop (0..1, of the way down), flat (0..1), drift (units),
 * sink (units below the surface) }.
 */
export function chuteRelease(s) {
  if (s <= 0.25) return { drop: 0, flat: 0, drift: 0, sink: 0 };
  const x = s - 0.25;
  const drop = smooth(x / 4.2);
  return { drop, flat: smooth((x - 1.6) / 1.8), drift: u(24) * (1 - Math.exp(-x / 3)) + u(0.5) * x, sink: u(1.4) * smooth((x - 3.6) / 5) };
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
/** Shot B (the water contact), relative to the point of contact: low over the waves, close beside it. */
const SHOT_B = { a: 0.65, d: 8.2, y: 0.8 }; // azimuth (rad, from +z towards +x), distance, height above the sea
/** Shot C (the recovery hero shot): closer, lower, round towards the Sun so the capsule's face is lit. */
const SHOT_C = { a: 0.12, d: 5.2, y: 0.5 };
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
    if (h < SHOT_A.until) {
      const q0 = smooth(Math.max(0, h) / SHOT_A.until); // 1 at 400 m .. 0 at the water
      const q = Math.sqrt(q0); // closing in mostly over the last 100 m: the canopies in frame till then
      const dA = Math.hypot(SHOT_A.x, SHOT_A.z);
      const aA = Math.atan2(SHOT_A.x, SHOT_A.z);
      // coming down with the capsule (never falling faster than it), ending just over the waves
      const yB = SHOT_B.y - HANG_LOW;
      pos = polar(SHOT_B.a + (aA - SHOT_B.a) * q, SHOT_B.d + (dA - SHOT_B.d) * q, yB + (SHOT_A.y - yB) * q);
      pos[0] += sway * 0.5 * q;
      look = [0, 0.3 + (SHOT_A.look - 0.3) * q, 0];
    }
  }
  pos[1] = Math.max(pos[1], sea + 0.7);
  return { pos, look };
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
  const a = SHOT_B.a + (SHOT_C.a - SHOT_B.a) * k - 0.006 * on;
  const d = SHOT_B.d + (SHOT_C.d - SHOT_B.d) * k + 0.6 * smooth(on / 40);
  const y = -HANG_LOW + SHOT_B.y + (SHOT_C.y - SHOT_B.y) * k;
  return { pos: polar(a, d, y), look: [0, 0.3 - 0.14 * k, 0] };
}

export const _test = { smooth, rng };
