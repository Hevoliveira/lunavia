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
 * Fair-weather cumulus over a tropical recovery area (the references: scattered cumulus casting
 * shadows on the sea, a few taller towers). A field of formations, each a cluster of soft puffs
 * (impostors shaded per pixel by the scene's Sun), bases 650–950 m, tops 1.2–2.6 km. The field
 * is deterministic (seeded): the same clouds every flight. Distances in units (3.9 m).
 *
 * The capsule descends at the field's centre: one formation stands close beside the descent
 * column, so the capsule passes down between its towers under its main parachutes, and the rest
 * are spread round to 30 km (beyond that the sea shader paints the NASA cloud cover).
 */
export const CLOUD_FIELD = { radius: u(30000), count: 52, baseM: [650, 950], topM: [1200, 2600] };
/*
 * Two formations are placed, not drawn at random: as the descent camera sees it, a tall one behind
 * the capsule and a lower one beside it, so the capsule comes down between them under its main
 * parachutes (its own path stays clear: nothing passes through it).
 */
// Ground positions: the capsule drifts about 325 m (-X) under its drogues, then comes straight down.
export const DROGUE_DRIFT_M = 325;
export const PLACED_CLOUDS = [
  { x: u(-560 - DROGUE_DRIFT_M), z: u(-1020), r: u(620), baseM: 760, topM: 2250 },
  { x: u(-80 - DROGUE_DRIFT_M), z: u(-900), r: u(380), baseM: 900, topM: 1750 },
];
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
let FIELD = null;
/**
 * The formations and their puffs: { clouds: [{ x, z, base, top, r }], puffs: [{ x, y, z, r, h01, seed, cloud }] }
 * (units; y is the height above the sea; h01 the puff's height in its cloud, 0 base .. 1 top).
 */
export function cloudField(seed = 20261021) {
  if (FIELD && seed === 20261021) return FIELD;
  const R = rng(seed);
  const F = CLOUD_FIELD;
  const clouds = PLACED_CLOUDS.map((c) => ({ x: c.x, z: c.z, r: c.r, base: u(c.baseM), top: u(c.topM) }));
  while (clouds.length < F.count) {
    const i = clouds.length;
    const a = R() * Math.PI * 2;
    // a few more within a few kilometres (the layer is seen all round on the way down), the rest to 30 km
    const d = i < 8 ? u(1500 + R() * 3000) : F.radius * Math.sqrt(0.03 + 0.97 * R());
    const base = u(F.baseM[0] + R() * (F.baseM[1] - F.baseM[0]));
    const tall = Math.pow(R(), 2.2); // most clouds modest, a few towers (heavy-tailed)
    const top = base + u(420 + tall * (F.topM[1] - F.baseM[0] - 420));
    const r = u(380 + R() * 820) * (0.75 + 0.5 * tall);
    clouds.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, base, top, r });
  }
  const puffs = [];
  clouds.forEach((c, ci) => {
    const H = c.top - c.base;
    const n = Math.round(10 + Math.min(18, (c.r / u(130)) * (H / u(900))));
    for (let j = 0; j < n; j++) {
      const h01 = Math.pow(R(), 0.9);
      // a wide base, a narrowing dome; smaller turrets on top
      const spread = c.r * (1 - 0.6 * h01) * Math.sqrt(R());
      const a = R() * Math.PI * 2;
      const pr = c.r * (0.24 + 0.3 * R()) * (1 - 0.45 * h01) + u(45);
      puffs.push({
        x: c.x + Math.cos(a) * spread,
        z: c.z + Math.sin(a) * spread * (0.75 + 0.5 * R()),
        y: c.base + pr * 0.42 + h01 * Math.max(0, H - pr),
        r: pr,
        h01,
        seed: R(),
        cloud: ci,
      });
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
 * Where the released parachutes are, s seconds after splashdown: 0 hanging, then they come down
 * and lie spread on the sea downwind. { drop (0..1, of the way down), flat (0..1), drift (units) }.
 */
export function chuteRelease(s) {
  if (s <= 0.25) return { drop: 0, flat: 0, drift: 0 };
  const x = s - 0.25;
  const drop = smooth(x / 4.2);
  return { drop, flat: smooth((x - 2.6) / 2.4), drift: u(6) * x };
}

/** On-screen confirmation after contact, seconds after splashdown: SPLASHDOWN CONFIRMED, then CREW SAFE. */
export const CONFIRM = { splashdown: 0.6, crewSafe: 2.4, done: 6.5 };

/* ---- cameras (units, relative to the capsule) ------------------------------------------------- */
/**
 * The descent camera under the parachutes: beside the capsule, a little below it, looking up enough
 * to frame the canopies and down enough to keep the sea and the clouds below in shot. Near the sea
 * it keeps above the waves. Returns { pos, look }.
 */
export function chuteCamera(h, mains, t = 0) {
  const sway = Math.sin(t * 0.13) * 0.6;
  // under the drogues: already near the main-parachute framing, so the hand-over is a slow drift
  if (!mains) return { pos: [10.5 + sway, -0.4, 19], look: [0, 2.2, 0] };
  const sea = seaLevelY(h);
  // far out enough for the three canopies; nearer the sea, lower and closer, to see the contact
  const k = smooth((h - 40) / 260); // 1 high, 0 at the sea
  const pos = [13.5 + sway - 3.5 * (1 - k), -2.2 * k + 0.6 * (1 - k), 24.5 - 7.5 * (1 - k)];
  pos[1] = Math.max(pos[1], sea + 1.6);
  const look = [0, 4.5 * k + 1.2 * (1 - k), 0];
  return { pos, look };
}
/** The recovery shot after splashdown: from near the sea, slowly drawing back and round (s after contact). */
export function recoveryCamera(s) {
  const a = 0.62 + 0.012 * s;
  const d = 13 + 4 * smooth(s / 22);
  return { pos: [Math.sin(a) * d, 1.7 + 1.1 * smooth(s / 22), Math.cos(a) * d], look: [0, 0.9 - 0.5 * smooth(s / 6), 0] };
}

export const _test = { smooth, rng };
