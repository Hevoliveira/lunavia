/*
 * LUNAVIA — the four lunar landing missions' sites (pure, unit-tested).
 *
 * One description per site drives BOTH the physics and the drawing:
 *   height(x, z)  the terrain, metres above the site's datum (the centre of
 *                 the primary landing zone), built from compact analytic
 *                 features: craters, hills, ridges, a mountain front, a
 *                 rille, rolling swells and smoothed landing-zone patches;
 *   rocks         every boulder and every debris stone, generated once from
 *                 the site's seed, each sitting on that terrain;
 *   zones         the landing zones (the primary one always at x = 0).
 * The descent is flown in the vertical plane z = 0 along x (landerSim), so the
 * LM's four footpads always stand at (x ± 4.3 m, 0) and (x, ± 4.3 m). The
 * renderer draws the same terrain function and the same rock list, so what
 * the LM can touch is exactly what is on the screen.
 *
 * Touchdown on a site (evaluate):
 *   - the ground the LM meets first is the highest point under a footpad (or
 *     a boulder under the descent stage); landerSim's altitude is measured to
 *     it, and touchdown is still captured at 0.5 m;
 *   - a boulder (≥ 0.9 m) anywhere under the LM's footprint, ground sloping
 *     more than 12° across the footpads (the LM's design limit), or ground
 *     too uneven for the struts is UNSAFE TERRAIN, graded by landingPhysics
 *     exactly as the old hazard zones were. Debris stones (≤ 0.35 m) are
 *     harmless; no rock is generated between the two sizes.
 * These locations are visual and geographic references: the layouts are
 * stylised, not reconstructions of real topography.
 */
import { LM, WORLD_X, BAND_MIN, verticalScale } from "./touchdownFx";

const DEG = Math.PI / 180;

/* ---- the LM's footprint in metres (the drawn LanderModel, data/touchdownFx LM) ---- */
export const FOOT = {
  pad: LM.padRadius / WORLD_X, // 4.32 m: footpad centres from the axis
  padSize: LM.padSize / WORLD_X, // 0.55 m: footpad radius
  body: 2.4, // m: descent-stage half-width
  clearance: LM.nozzle / WORLD_X, // 0.88 m: engine skirt above the footpad plane
  stroke: LM.stroke / WORLD_X, // 0.36 m: unevenness the struts can take up
};
/** Radius of the LM's footprint (footpad centres plus a footpad), m. */
export const FOOT_RADIUS = FOOT.pad + FOOT.padSize;
/** Footpad centres [dx, dz] in metres, in LM.legAngles order (+X, +Z, -X, -Z). */
export const PADS = [
  [FOOT.pad, 0],
  [0, FOOT.pad],
  [-FOOT.pad, 0],
  [0, -FOOT.pad],
];
export const SLOPE_LIMIT = 12; // deg: the LM's design limit for the ground under it
export const PAD_SLOPE_LIMIT = 20; // deg: a footpad on anything steeper (a crater wall) slides
export const BOULDER_MIN = 0.9; // m: every rock at least this tall is a hazard
export const DEBRIS_MAX = 0.35; // m: stones no taller than this are harmless
export const CONTACT_ALT = 0.5; // m (landerSim captures touchdown here)

/* ---- small numeric helpers ------------------------------------------------------- */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
// Polynomial smooth minimum / maximum (k: blend width, metres).
const smin = (a, b, k) => {
  if (k <= 0) return Math.min(a, b);
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return b + (a - b) * h - k * h * (1 - h);
};
const smax = (a, b, k) => -smin(-a, -b, k);

/** Deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash-based value noise (deterministic, smooth), used for gentle undulation.
function hash2(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function valueNoise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz - 0.5;
}

/* ---- terrain features -------------------------------------------------------------- */
/*
 * Crater: a parabolic bowl through -depth at the centre and the rim crest at
 * r, an optional flat floor, a raised rim, and an ejecta apron falling off as
 * (r/d)^3 to nothing at `reach` radii. Fresh simple craters are ~0.15–0.2
 * deep per diameter with 30–40° upper walls; old mare craters are shallow
 * and soft.
 */
function makeCrater(c) {
  const r = c.r;
  const d = c.d;
  const rim = c.rim != null ? c.rim : 0.04 * 2 * r;
  const fl = clamp(c.floor || 0, 0, 0.85);
  // bowl depth below the rim-free surface such that the bowl meets the floor at fl·r
  const Dp = fl > 0 ? (d + rim * fl * fl) / (1 - fl * fl) : d;
  const reach = (c.reach || 2.4) * r;
  return {
    type: "crater",
    label: c.label || "CRATER",
    x: c.x,
    z: c.z || 0,
    reach,
    reach2: reach * reach,
    r,
    d,
    rim,
    Dp,
    A: rim + Dp,
    fl,
    kf: Math.max(0.05, 0.25 * d),
    kr: Math.max(0.02, (c.soft != null ? c.soft : 0.35) * rim),
    a0: 1.5,
    a1: reach / r,
  };
}
function craterH(f, x, z) {
  const dx = x - f.x;
  const dz = z - f.z;
  const d2 = dx * dx + dz * dz;
  if (d2 >= f.reach2) return 0;
  const rho = Math.max(0.05, Math.sqrt(d2) / f.r);
  let inner = f.A * rho * rho - f.Dp;
  if (f.fl > 0) inner = smax(inner, -f.d, f.kf);
  const outer = (f.rim / (rho * rho * rho)) * (1 - smoothstep(f.a0, f.a1, rho));
  return smin(inner, outer, f.kr);
}

/* Hill: an elliptical dome, (1 - q²)² inside q < 1 (compact, smooth). */
function makeHill(c) {
  const ang = (c.ang || 0) * DEG;
  return {
    type: "hill",
    label: c.label || "HILL",
    x: c.x,
    z: c.z || 0,
    rx: c.rx,
    rz: c.rz || c.rx,
    h: c.h,
    ca: Math.cos(ang),
    sa: Math.sin(ang),
    reach: Math.max(c.rx, c.rz || c.rx),
  };
}
function hillH(f, x, z) {
  const dx = x - f.x;
  const dz = z - f.z;
  const lx = (dx * f.ca + dz * f.sa) / f.rx;
  const lz = (-dx * f.sa + dz * f.ca) / f.rz;
  const q2 = lx * lx + lz * lz;
  if (q2 >= 1) return 0;
  const s = 1 - q2;
  return f.h * s * s;
}

/* Ridge: a dome stretched along a segment. */
function makeRidge(c) {
  const vx = c.x1 - c.x0;
  const vz = c.z1 - c.z0;
  return {
    type: "ridge",
    label: c.label || "RIDGE",
    x0: c.x0,
    z0: c.z0,
    vx,
    vz,
    l2: vx * vx + vz * vz,
    w: c.w,
    h: c.h,
    x: (c.x0 + c.x1) / 2,
    z: (c.z0 + c.z1) / 2,
    reach: Math.sqrt(vx * vx + vz * vz) / 2 + c.w,
  };
}
function ridgeH(f, x, z) {
  const px = x - f.x0;
  const pz = z - f.z0;
  const t = clamp((px * f.vx + pz * f.vz) / f.l2, 0, 1);
  const ex = px - t * f.vx;
  const ez = pz - t * f.vz;
  const q2 = (ex * ex + ez * ez) / (f.w * f.w);
  if (q2 >= 1) return 0;
  const s = 1 - q2;
  return f.h * s * s;
}

/*
 * Mountain front: the ground rises from x0 (h = 0) to x1 (h) with a smooth
 * ramp, for |z - zc| within zw (tapering beyond), with a gentle wobble along
 * the toe so it does not read as a ruler line.
 */
function makeFront(c) {
  return { type: "front", label: c.label || "MOUNTAIN FLANK", ...c, global: true };
}
function frontH(f, x, z) {
  const wob = f.wobble ? f.wobble * Math.sin(z / 37 + 1.3) + 0.5 * f.wobble * Math.sin(z / 13 + 0.4) : 0;
  const t = smoothstep(f.x0 + wob, f.x1 + wob, x);
  if (t <= 0) return 0;
  const lat = f.zw ? 1 - smoothstep(f.zw, f.zw * 1.6, Math.abs(z - (f.zc || 0))) : 1;
  return f.h * t * lat;
}

/*
 * Rille: a sinuous channel crossing the track. Centre x = x + amp·sin(2πz/wl
 * + ph); flat floor of half-width w0, walls out to w1, a low levee beyond.
 */
function makeRille(c) {
  return { type: "rille", label: c.label || "RILLE", ...c, global: true };
}
function rilleH(f, x, z) {
  const k = (2 * Math.PI) / f.wl;
  const xc = f.x + f.amp * Math.sin(k * z + f.ph);
  const slope = f.amp * k * Math.cos(k * z + f.ph);
  const dist = Math.abs(x - xc) / Math.sqrt(1 + slope * slope);
  if (dist > f.w1 + 14) return 0;
  const cut = -f.d * (1 - smoothstep(f.w0, f.w1, dist));
  const lev = f.levee ? f.levee * Math.exp(-(((dist - f.w1 - 4) / 5) ** 2)) : 0;
  return cut + lev;
}

/* Rolling swells: a sum of long waves, faded out towards the region's edges. */
function makeSwells(c) {
  return {
    type: "swells",
    label: c.label || "SWELL",
    global: true,
    waves: c.waves.map((w) => ({ a: w.a, k: (2 * Math.PI) / w.l, c: Math.cos(w.ang * DEG), s: Math.sin(w.ang * DEG), ph: w.ph || 0 })),
    corridor: c.corridor || 0, // fade to nothing within this |z| (keeps a track flat), 0 = no fade
  };
}
function swellsH(f, x, z) {
  let h = 0;
  for (const w of f.waves) h += w.a * Math.sin(w.k * (x * w.c + z * w.s) + w.ph);
  if (f.corridor) h *= smoothstep(f.corridor, f.corridor * 2.2, Math.abs(z));
  return h;
}

/* Gentle value-noise undulation (a few tenths of a metre). */
function makeNoise(c) {
  return { type: "noise", label: c.label || "UNDULATION", global: true, ...c };
}
function noiseH(f, x, z) {
  let h = 0;
  let amp = f.amp;
  let s = 1 / f.scale;
  for (let o = 0; o < (f.oct || 2); o++) {
    h += amp * valueNoise(x * s, z * s, f.seed + o * 101);
    amp *= 0.45;
    s *= 2.1;
  }
  if (f.corridor) h *= smoothstep(f.corridor, f.corridor * 2.2, Math.abs(z));
  return h;
}

const EVAL = { crater: craterH, hill: hillH, ridge: ridgeH, front: frontH, rille: rilleH, swells: swellsH, noise: noiseH };

/* ---- site compilation --------------------------------------------------------------- */
const CELL = 24; // m, spatial index cell for compact features and rocks

function buildIndex(items, reachOf) {
  const cells = new Map();
  items.forEach((it, i) => {
    const r = reachOf(it);
    const i0 = Math.floor((it.x - r) / CELL);
    const i1 = Math.floor((it.x + r) / CELL);
    const k0 = Math.floor((it.z - r) / CELL);
    const k1 = Math.floor((it.z + r) / CELL);
    for (let a = i0; a <= i1; a++) {
      for (let b = k0; b <= k1; b++) {
        const key = a * 100003 + b;
        let list = cells.get(key);
        if (!list) cells.set(key, (list = []));
        list.push(i);
      }
    }
  });
  return (x, z) => cells.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL)) || EMPTY;
}
const EMPTY = [];

function makeFeature(c) {
  switch (c.type) {
    case "crater":
      return makeCrater(c);
    case "hill":
      return makeHill(c);
    case "ridge":
      return makeRidge(c);
    case "front":
      return makeFront(c);
    case "rille":
      return makeRille(c);
    case "swells":
      return makeSwells(c);
    case "noise":
      return makeNoise(c);
    default:
      throw new Error(`unknown terrain feature ${c.type}`);
  }
}

/** Expand generators (crater fields) into plain features, deterministically. */
function expandFeatures(def) {
  const out = [];
  const rand = rng(def.seed * 7 + 3);
  for (const c of def.terrain) {
    if (c.type !== "craterField") {
      out.push(c);
      continue;
    }
    // A population of craters, rejecting any that would touch a keep-out
    // (landing zones and their surroundings) or overlap too much.
    const placed = [];
    let tries = 0;
    while (placed.length < c.n && tries < c.n * 60) {
      tries++;
      const x = c.x[0] + rand() * (c.x[1] - c.x[0]);
      const z = c.z[0] + rand() * (c.z[1] - c.z[0]);
      // power-law size distribution between rMin and rMax
      const u = rand();
      const r = c.r[0] * Math.pow(c.r[1] / c.r[0], Math.pow(u, c.sizeBias || 1.6));
      const reach = r * (c.reach || 2.2);
      if ((c.keepOut || []).some((k) => Math.hypot(x - k.x, z - (k.z || 0)) < k.r + reach)) continue;
      if (c.zMin && Math.abs(z) < c.zMin + reach) continue;
      if (placed.some((p) => Math.hypot(x - p.x, z - p.z) < (p.r + r) * (c.overlap != null ? c.overlap : 0.75))) continue;
      const depth = (c.depth[0] + rand() * (c.depth[1] - c.depth[0])) * 2 * r;
      placed.push({
        type: "crater",
        x,
        z,
        r,
        d: depth,
        rim: depth * (c.rim || 0.22),
        soft: c.soft,
        floor: c.floor || 0,
        reach: c.reach || 2.2,
        label: c.label || "CRATER",
        blocks: c.blocks && r >= (c.blocksMinR || 3) ? Math.round(c.blocks * r) : 0,
      });
    }
    out.push(...placed);
  }
  return out;
}

/**
 * Compile a site definition: the terrain function, the rocks, the footprint
 * evaluation and the landing zones. Deterministic: the same definition
 * always gives the same site.
 */
export function compileSite(def) {
  const specs = expandFeatures(def);
  const feats = specs.map(makeFeature);
  const global = feats.filter((f) => f.global);
  const local = feats.filter((f) => !f.global);
  const localAt = buildIndex(local, (f) => f.reach);
  const levels = (def.levels || []).map((l) => ({ ...l, z: l.z || 0 }));

  const raw = (x, z) => {
    let h = 0;
    for (let i = 0; i < global.length; i++) h += EVAL[global[i].type](global[i], x, z);
    const cand = localAt(x, z);
    for (let i = 0; i < cand.length; i++) {
      const f = local[cand[i]];
      h += EVAL[f.type](f, x, z);
    }
    return h;
  };
  // Landing-zone patches: the ground is smoothed towards a level around each
  // (landing sites are chosen on the smoothest ground there is).
  levels.forEach((l) => {
    if (l.h == null) l.h = raw(l.x, l.z);
  });
  const leveled = (x, z) => {
    let h = raw(x, z);
    for (const l of levels) {
      const w = 1 - smoothstep(l.r, l.r + l.edge, Math.hypot(x - l.x, z - l.z));
      if (w > 0) h += (l.h - h) * w;
    }
    return h;
  };
  const datum = leveled(0, 0);
  const height = (x, z) => leveled(x, z) - datum;

  /* -- rocks ------------------------------------------------------------------------- */
  const rand = rng(def.seed * 13 + 1);
  const rocks = [];
  const zones = def.zones;
  // A boulder never lands where it could touch the LM inside a landing zone.
  const clearOfZones = (x, z, r) =>
    !zones.some((zn) => Math.abs(z) < FOOT_RADIUS + r + 0.3 && Math.abs(x - zn.x) < zn.r + FOOT_RADIUS + r + 0.3);
  const addRock = (x, z, h, label, boulder) => {
    const r = h * (0.55 + 0.35 * rand());
    if (boulder && !clearOfZones(x, z, r)) return false;
    if (boulder && rocks.some((o) => o.boulder && Math.hypot(o.x - x, o.z - z) < (o.r + r) * 1.05)) return false;
    // sit on the lowest point under it, slightly buried
    const base = Math.min(height(x, z), height(x + r * 0.7, z), height(x - r * 0.7, z), height(x, z + r * 0.7), height(x, z - r * 0.7)) - 0.12 * h;
    rocks.push({
      x,
      z,
      r,
      h,
      base,
      top: base + h * 1.12,
      boulder,
      label,
      rot: [rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2],
      shape: rand(),
      tone: rand(),
    });
    return true;
  };
  const between = (lo, hi) => lo + (hi - lo) * rand();
  // boulder heights avoid the gap between debris and hazard sizes
  const boulderH = (lo, hi) => Math.max(BOULDER_MIN + 0.1, between(lo, hi));
  for (const f of def.rockFields || []) {
    let n = 0;
    let tries = 0;
    while (n < f.n && tries < f.n * 40) {
      tries++;
      const a = rand() * Math.PI * 2;
      const rr = f.r * Math.sqrt(rand());
      const x = f.x + Math.cos(a) * rr * (f.sx || 1);
      const z = (f.z || 0) + Math.sin(a) * rr * (f.sz || 1);
      if (addRock(x, z, boulderH(f.h[0], f.h[1]), f.label || "BOULDERS", true)) n++;
    }
  }
  for (const c of specs) {
    if (c.type !== "crater" || !c.blocks) continue;
    let n = 0;
    let tries = 0;
    while (n < c.blocks && tries < c.blocks * 40) {
      tries++;
      const a = rand() * Math.PI * 2;
      const rho = 0.8 + 0.8 * Math.pow(rand(), 1.5);
      const x = c.x + Math.cos(a) * rho * c.r;
      const z = (c.z || 0) + Math.sin(a) * rho * c.r;
      const hMax = Math.min(2.6, 1.0 + c.r * 0.08);
      if (addRock(x, z, boulderH(1.0, hMax), c.blockLabel || c.label || "BOULDERS", true)) n++;
    }
  }
  if (def.debris) {
    const dbr = def.debris;
    for (let i = 0; i < dbr.n; i++) {
      const x = dbr.x[0] + rand() * (dbr.x[1] - dbr.x[0]);
      const z = dbr.z[0] + rand() * (dbr.z[1] - dbr.z[0]);
      addRock(x, z, between(dbr.h[0], Math.min(DEBRIS_MAX / 1.12, dbr.h[1])), "DEBRIS", false);
    }
  }
  const boulders = rocks.filter((r) => r.boulder);
  const rockAt = buildIndex(boulders, (r) => r.r + FOOT_RADIUS + 1);

  /* -- the footprint ------------------------------------------------------------------- */
  const padHeights = (x) => PADS.map(([dx, dz]) => height(x + dx, dz));
  const footBoulders = (x) => rockAt(x, 0).map((i) => boulders[i]).filter((b) => Math.hypot(b.x - x, b.z) < FOOT_RADIUS + b.r);

  /**
   * Height (m) of the first thing the LM's footpads (or its descent stage)
   * would meet coming straight down at x: the highest ground under a footpad,
   * the top of a boulder under a footpad, or a boulder or mound high enough
   * to reach the engine skirt.
   */
  const contactGround = (x) => {
    const hp = padHeights(x);
    let g = Math.max(hp[0], hp[1], hp[2], hp[3]);
    g = Math.max(g, height(x, 0) - FOOT.clearance);
    const cand = rockAt(x, 0);
    for (let i = 0; i < cand.length; i++) {
      const b = boulders[cand[i]];
      for (let k = 0; k < 4; k++) {
        if (Math.hypot(b.x - x - PADS[k][0], b.z - PADS[k][1]) < FOOT.padSize + b.r) g = Math.max(g, b.top);
      }
      if (Math.hypot(b.x - x, b.z) < FOOT.body + b.r) g = Math.max(g, b.top - FOOT.clearance);
    }
    return g;
  };

  // Which terrain feature shapes the ground most under the footprint (for labels).
  const featureLabel = (x) => {
    let best = null;
    let range = 0.05;
    const pts = [...PADS, [0, 0]];
    for (const f of feats) {
      if (!f.global && Math.hypot(f.x - x, f.z) > f.reach + FOOT_RADIUS) continue;
      const v = pts.map(([dx, dz]) => EVAL[f.type](f, x + dx, dz));
      const r = Math.max(...v) - Math.min(...v);
      if (r > range) {
        range = r;
        best = f;
      }
    }
    return best ? best.label : "ROUGH TERRAIN";
  };

  /**
   * The ground under the LM's footprint at x: { hazard, safeZone, slope (deg),
   * sx, sz (rise per metre towards +X / +Z), pads (m), contact (m), boulders }.
   * hazard is { kind: "boulders" | "slope" | "rough", label } or null.
   */
  // Steepest ground under any one footpad (deg), over the pad's own width.
  const padSlope = (x) => {
    const e = FOOT.padSize;
    let worst = 0;
    for (const [dx, dz] of PADS) {
      const gx = (height(x + dx + e, dz) - height(x + dx - e, dz)) / (2 * e);
      const gz = (height(x + dx, dz + e) - height(x + dx, dz - e)) / (2 * e);
      worst = Math.max(worst, Math.atan(Math.hypot(gx, gz)) / DEG);
    }
    return worst;
  };

  const evaluate = (x) => {
    const hp = padHeights(x);
    const mean = (hp[0] + hp[1] + hp[2] + hp[3]) / 4;
    const sx = (hp[0] - hp[2]) / (2 * FOOT.pad);
    const sz = (hp[1] - hp[3]) / (2 * FOOT.pad);
    const slope = Math.atan(Math.hypot(sx, sz)) / DEG;
    const twist = Math.abs(hp[0] + hp[2] - hp[1] - hp[3]) / 2;
    const mound = height(x, 0) - mean;
    const footSlope = padSlope(x);
    const under = footBoulders(x);
    let hazard = null;
    if (under.length) hazard = { kind: "boulders", name: under[0].label, label: under[0].label };
    else if (slope > SLOPE_LIMIT || footSlope > PAD_SLOPE_LIMIT) {
      const name = featureLabel(x);
      hazard = { kind: "slope", name, label: `${name} · ${Math.round(Math.max(slope, footSlope))}°` };
    } else if (twist > FOOT.stroke || mound > FOOT.clearance) {
      const name = featureLabel(x);
      hazard = { kind: "rough", name, label: name };
    }
    const safeZone = hazard ? null : zones.find((zn) => Math.abs(x - zn.x) < zn.r) || null;
    return { hazard, safeZone, slope, footSlope, sx, sz, twist, pads: hp, contact: contactGround(x), boulders: under.length };
  };

  // Vertical scale: true scale up to the highest ground near the flight path.
  let top = BAND_MIN;
  for (let x = def.range[0]; x <= def.range[1]; x += 2) {
    top = Math.max(top, height(x, 0), height(x, 8), height(x, -8));
  }
  for (const b of boulders) if (Math.abs(b.z) < 12) top = Math.max(top, b.top);
  const scale = verticalScale(Math.ceil(top + 2));

  return {
    ...def,
    height,
    rocks,
    boulders,
    contactGround,
    evaluate,
    footBoulders,
    scale,
    primary: zones.find((z) => z.primary),
    features: feats,
  };
}

/* ---- hazard map and starts ---------------------------------------------------------------- */
/**
 * The unsafe stretches of the track, sampled every `step` m: [{ x0, x1, kind,
 * name }]. The same evaluation the touchdown is graded with.
 */
export function hazardMap(site, step = 0.25) {
  const out = [];
  let cur = null;
  for (let x = site.range[0]; x <= site.range[1] + 1e-9; x += step) {
    const h = site.evaluate(x).hazard;
    if (h) {
      if (cur && cur.name === h.name && x - cur.x1 <= step * 1.01) cur.x1 = x;
      else {
        if (cur) out.push(cur);
        cur = { x0: x, x1: x, kind: h.kind, name: h.name };
      }
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * The mission's start state for a difficulty at this site: the difficulty's
 * altitude above the landing-zone datum, descent rate and drift (unchanged),
 * coming in from the site's approach side at the site's approach offset.
 * `init` (training) overrides parts of it; an `alt` without `y` there means
 * height above the ground under the LM.
 */
export function siteStart(site, cfg, init = null) {
  const d = site.approach.dir;
  const p = {
    alt: cfg.initialAlt,
    y: cfg.initialAlt,
    vy: cfg.initialVy,
    vx: d * cfg.initialVx,
    xPos: -d * site.approach.offset * cfg.initialAlt,
    tilt: 0,
    throttle: 0,
    fuel: cfg.initialFuel,
    fuelDepletedInFlight: false,
    held: { l: 0, r: 0, sl: 0, sr: 0 },
    t: 0,
    ...(init || {}),
  };
  if (init && init.y == null && init.alt != null) p.y = init.alt + site.contactGround(p.xPos);
  p.alt = p.y - site.contactGround(p.xPos);
  return p;
}

/* ---- the sites ------------------------------------------------------------------------------ */
/*
 * Coordinates: x along the track (m), z across it (+z towards the chase
 * camera), heights in m above the primary landing zone's centre. approach.dir
 * is the direction of flight (+1: towards +x), approach.offset the start's
 * distance from the LZ per metre of start altitude (the mission's is 0.3).
 * Sun and Earth: elevation and azimuth (deg; azimuth 0 = +x, 90 = -z, the far
 * side of the track from the chase camera). earth null: below the horizon
 * (the far side), which also means no direct radio link (earthLink false).
 * Mission identity for the selector and briefings: name, kind, ref, blurb,
 * challenge, briefing; level 1–4 is the environment's difficulty.
 */
const TRANQUILLITATIS = {
  id: "tranquillitatis",
  name: "SEA OF TRANQUILITY",
  short: "TRANQUILITY",
  kind: "WIDE PLAIN",
  ref: "MARE TRANQUILLITATIS · APOLLO 11",
  coords: "0.67°N 23.47°E",
  level: 1,
  rating: "BEGINNER",
  blurb: "A broad basalt plain under a wide horizon: gentle swells, sparse old craters, scattered stones. Four marked hazards on the track: a blocky crater, a boulder field, a fresh crater and a rough patch.",
  challenge: "Throttle, descent rate and drift: the spacecraft is the challenge, not the ground",
  briefing: "Open landing terrain. Maintain a stable descent and aim for a precise touchdown.",
  terrainText: "Open mare plain · sparse craters · few boulders",
  approach: { dir: 1, offset: 0.3, text: "FROM THE EAST" },
  sun: { el: 14, az: -152 },
  earth: { el: 62, az: 168 },
  palette: { base: "#8d877c", dark: "#6f6a61", bright: "#a7a194", rock: "#7d776d", ray: 0 },
  seed: 11,
  range: [-260, 260],
  zones: [
    { x: 0, r: 6, primary: true, label: "PRIMARY LZ" },
    { x: -36.5, r: 4.5, label: "ALT LZ WEST" },
    { x: 41, r: 4, label: "ALT LZ EAST" },
    { x: 84, r: 6, label: "ALT LZ FAR EAST" },
  ],
  terrain: [
    // the four hazards on the track (as the mission has always had them)
    { type: "crater", x: -55, z: 0, r: 6.5, d: 1.7, rim: 0.4, label: "CRATER · ROUGH", blocks: 9, blockLabel: "CRATER · ROUGH" },
    { type: "crater", x: 25, z: 0.5, r: 5, d: 1.3, rim: 0.32, label: "CRATER" },
    { type: "crater", x: 57, z: -1.5, r: 2.6, d: 0.55, rim: 0.15, label: "ROUGH TERRAIN" },
    { type: "crater", x: 64, z: 2.5, r: 2.2, d: 0.45, rim: 0.12, label: "ROUGH TERRAIN" },
    // landmarks off the track: West crater (blocky rim) and Little West
    { type: "crater", x: -112, z: -58, r: 30, d: 7.5, rim: 1.6, floor: 0.3, reach: 1.8, label: "WEST CRATER" },
    { type: "crater", x: 62, z: -40, r: 14, d: 3.2, rim: 0.7, label: "LITTLE WEST" },
    { type: "crater", x: -20, z: 34, r: 9, d: 1.1, rim: 0.25, soft: 0.8, label: "CRATER" },
    { type: "crater", x: 118, z: 30, r: 16, d: 1.6, rim: 0.35, soft: 0.9, label: "CRATER" },
    // old mare craters, soft and shallow, away from the track
    {
      type: "craterField", n: 70, x: [-420, 420], z: [-300, 300], r: [2.5, 26], depth: [0.03, 0.07], rim: 0.15, soft: 0.9,
      zMin: 9, keepOut: [{ x: -112, z: -58, r: 30 }, { x: 62, z: -40, r: 14 }],
    },
    { type: "noise", amp: 0.5, scale: 60, oct: 2, seed: 5, corridor: 14 },
    // the plain's long, low swells (off the track: the mission's flight path is unchanged)
    { type: "swells", label: "MARE SWELL", corridor: 16, waves: [{ a: 1.1, l: 170, ang: 20, ph: 0.6 }, { a: 0.6, l: 95, ang: -35, ph: 2.2 }] },
  ],
  rockFields: [
    { x: -20, z: 0, r: 3.4, n: 7, h: [1.1, 2.0], label: "BOULDERS" },
    { x: -20, z: 9, r: 6, n: 6, h: [1.0, 1.8], label: "BOULDERS" },
    { x: 60, z: 0, r: 6.5, sx: 1.1, n: 11, h: [1.0, 1.9], label: "ROUGH TERRAIN" },
    { x: 60, z: -10, r: 7, n: 7, h: [1.0, 1.6], label: "ROUGH TERRAIN" },
    { x: -112, z: -58, r: 44, n: 34, h: [1.2, 2.6], label: "WEST CRATER BLOCKS" },
  ],
  debris: { n: 900, x: [-130, 130], z: [-45, 45], h: [0.06, 0.26] },
  horizon: [],
};

const HADLEY = {
  id: "hadley",
  name: "HADLEY–APENNINE",
  short: "HADLEY",
  kind: "MOUNTAIN VALLEY",
  ref: "APENNINE MOUNTAINS · APOLLO 15",
  coords: "26.13°N 3.63°E",
  level: 2,
  rating: "INTERMEDIATE",
  blurb: "A valley floor between Mons Hadley and Hadley Delta, under the Apennine front, with Hadley Rille just beyond the clearing. A steep approach over the mountain flank: overshoot and you are on the rille wall.",
  challenge: "A steep approach corridor over the mountain flank, into a small clearing short of the rille",
  briefing: "Mountainous landing region. Monitor your approach corridor and terrain clearance.",
  terrainText: "Mountain valley · rille · steep approach · small LZ",
  approach: { dir: 1, offset: 0.18, text: "STEEP, OVER THE APENNINES" },
  sun: { el: 17, az: -140 },
  earth: { el: 64, az: 95 },
  palette: { base: "#827c72", dark: "#68635b", bright: "#b7b0a3", rock: "#7a746a", ray: 0, highland: "#b9b2a5" },
  seed: 37,
  range: [-260, 260],
  zones: [
    { x: 0, r: 5, primary: true, label: "PRIMARY LZ" },
    { x: -26, r: 3, label: "ALT LZ BENCH" },
  ],
  levels: [{ x: 0, r: 11, edge: 16, h: 0 }],
  terrain: [
    // the Apennine front under the approach
    { type: "front", x0: -42, x1: -170, h: 46, zw: 260, wobble: 4, label: "APENNINE FLANK" },
    { type: "hill", x: -150, z: -150, rx: 140, rz: 120, h: 60, label: "APENNINE FRONT" },
    // Hadley Rille, beyond the LZ
    { type: "rille", x: 64, amp: 14, wl: 170, ph: -0.5, w0: 7, w1: 31, d: 12, levee: 0.6, label: "HADLEY RILLE" },
    // the mountains either side (landmarks)
    { type: "hill", x: 160, z: -330, rx: 300, rz: 260, h: 190, label: "MONS HADLEY" },
    { type: "hill", x: -60, z: 360, rx: 340, rz: 250, h: 140, label: "HADLEY DELTA" },
    { type: "crater", x: -80, z: 300, r: 40, d: 9, rim: 2, label: "ST. GEORGE CRATER" },
    // small fresh craters on the plain
    { type: "crater", x: -16, z: 0, r: 3.0, d: 0.75, rim: 0.2, label: "CRATER" },
    { type: "crater", x: 14, z: 9, r: 3.6, d: 0.9, rim: 0.22, label: "CRATER" },
    {
      type: "craterField", n: 45, x: [-60, 300], z: [-200, 200], r: [2, 14], depth: [0.05, 0.12], rim: 0.2, soft: 0.6,
      zMin: 10, keepOut: [{ x: 64, z: 0, r: 40 }],
    },
    { type: "noise", amp: 0.3, scale: 36, oct: 2, seed: 4, corridor: 9 },
  ],
  rockFields: [
    { x: 31, z: 0, r: 2.8, sz: 6, n: 8, h: [1.0, 2.2], label: "RILLE-EDGE BOULDERS" },
    { x: 30, z: 26, r: 10, n: 9, h: [1.0, 2.3], label: "RILLE-EDGE BOULDERS" },
    { x: 34, z: -28, r: 10, n: 9, h: [1.0, 2.3], label: "RILLE-EDGE BOULDERS" },
    { x: 64, z: 0, r: 7, sz: 4, n: 14, h: [1.2, 2.6], label: "RILLE FLOOR BLOCKS" },
    { x: -62, z: 2, r: 9, n: 10, h: [1.0, 2.3], label: "TALUS BOULDERS" },
  ],
  debris: { n: 950, x: [-130, 130], z: [-45, 45], h: [0.06, 0.28] },
  horizon: [
    { az: 35, el: 9, w: 46, kind: "massif", label: "MONS HADLEY" },
    { az: 90, el: 5, w: 70, kind: "front" },
    { az: 160, el: 11, w: 50, kind: "massif", label: "APENNINES" },
    { az: -110, el: 6, w: 60, kind: "massif", label: "HADLEY DELTA" },
    { az: 62, el: 3.2, w: 80, kind: "ridge" },
    { az: 125, el: 4.2, w: 60, kind: "ridge" },
    { az: -60, el: 3.5, w: 70, kind: "ridge" },
  ],
};

const TYCHO = {
  id: "tycho",
  name: "TYCHO HIGHLANDS",
  short: "TYCHO",
  kind: "CRATER REGION",
  ref: "TYCHO EJECTA · SURVEYOR 7",
  coords: "40.98°S 11.51°W",
  level: 3,
  rating: "ADVANCED",
  blurb: "Fresh, blocky ejecta north of Tycho's rim. Craters and boulders everywhere; the only safe ground is a few small impact-melt ponds.",
  challenge: "Pick a safe pond early, then divert and brake at the same time onto a 4 m zone",
  briefing: "Crater-rich terrain ahead. Identify a safe touchdown area and prepare for diversion.",
  terrainText: "Crater-dominated · boulder-strewn · melt-pond LZs",
  approach: { dir: -1, offset: 0.24, text: "FROM THE SOUTH, OVER EJECTA" },
  sun: { el: 22, az: -95 },
  earth: { el: 46, az: 100 },
  palette: { base: "#b4b1aa", dark: "#8b8882", bright: "#d6d3cb", rock: "#a19d95", ray: 1, pond: "#8f8b84" },
  seed: 53,
  range: [-260, 260],
  zones: [
    { x: 0, r: 4, primary: true, label: "PRIMARY LZ · MELT POND" },
    { x: 54, r: 3, label: "ALT LZ · NORTH POND" },
    { x: -47, r: 3, label: "ALT LZ · SOUTH POND" },
  ],
  levels: [
    { x: 3, r: 13, edge: 8, h: 0 },
    { x: 54, r: 8.5, edge: 7 },
    { x: -47, r: 8.5, edge: 7 },
  ],
  ponds: [
    { x: 3, z: 0, r: 13 },
    { x: 54, z: 0, r: 8.5 },
    { x: -47, z: 0, r: 8.5 },
  ],
  terrain: [
    {
      type: "craterField", n: 230, x: [-240, 240], z: [-150, 150], r: [2.2, 17], depth: [0.15, 0.2], rim: 0.25, soft: 0.25,
      overlap: 0.55, sizeBias: 2.2, blocks: 0.55, blocksMinR: 4, label: "CRATER",
      keepOut: [{ x: 3, z: 0, r: 22 }, { x: 54, z: 0, r: 16 }, { x: -47, z: 0, r: 16 }],
    },
    { type: "crater", x: 31, z: 1, r: 8, d: 2.6, rim: 0.7, label: "FRESH CRATER", blocks: 9 },
    { type: "crater", x: -24, z: -1, r: 6, d: 2.0, rim: 0.5, label: "FRESH CRATER", blocks: 7 },
    { type: "swells", label: "EJECTA LOBE", waves: [{ a: 1.6, l: 90, ang: 30, ph: 0.7 }, { a: 1.1, l: 52, ang: -40, ph: 2.1 }] },
    { type: "noise", amp: 0.45, scale: 18, oct: 2, seed: 17, corridor: 7 },
  ],
  rockFields: [
    { x: 21, z: 0, r: 3.2, n: 6, h: [1.0, 2.0], label: "BOULDERS" },
    { x: -15.5, z: 0, r: 3, n: 6, h: [1.0, 2.2], label: "BOULDERS" },
    { x: 80, z: 0, r: 9, n: 12, h: [1.0, 2.4], label: "BOULDERS" },
    { x: -80, z: 0, r: 9, n: 12, h: [1.0, 2.4], label: "BOULDERS" },
    { x: 0, z: -30, r: 20, n: 26, h: [1.0, 2.5], label: "BOULDERS" },
    { x: 20, z: 28, r: 16, n: 16, h: [1.0, 2.2], label: "BOULDERS" },
    { x: -140, z: 0, r: 60, n: 40, h: [1.0, 2.5], label: "BOULDERS" },
    { x: 140, z: 0, r: 60, n: 40, h: [1.0, 2.5], label: "BOULDERS" },
  ],
  debris: { n: 1000, x: [-130, 130], z: [-45, 45], h: [0.08, 0.3] },
  horizon: [
    { az: 70, el: 4.5, w: 120, kind: "rim", label: "TYCHO RIM" },
    { az: 95, el: 7.5, w: 9, kind: "peak", label: "CENTRAL PEAK" },
  ],
};


/*
 * Silent Horizon: the floor of an ancient crater inside the South Pole–Aitken
 * basin on the far side (inspired by the region of Von Kármán crater; the
 * layout is stylised). The Earth is always below the horizon here, so there
 * is no direct radio link: earthLink false (DescentGame, comms).
 */
const FAR_SIDE = {
  id: "far-side",
  name: "SILENT HORIZON",
  short: "FAR SIDE",
  kind: "FAR SIDE",
  ref: "SOUTH POLE–AITKEN BASIN · FAR SIDE",
  coords: "45.4°S 177.6°E",
  level: 4,
  rating: "EXPERT",
  blurb: "The floor of an ancient crater in the South Pole–Aitken basin, ringed by broken massifs. In over the crater wall, a wrinkle ridge and a boulder field beyond the clearing. No line of sight to the Earth: no Houston.",
  challenge: "No Earth link: read the rugged ground yourself and land on a 4 m clearing with onboard guidance only",
  briefing: "Far-side approach. Direct Earth communications will be unavailable during descent.",
  terrainText: "Ancient basin · crater wall · broken ridges · boulder fields",
  approach: { dir: -1, offset: 0.26, text: "OVER THE CRATER WALL" },
  sun: { el: 11, az: 28 },
  earth: null, // below the horizon
  earthLink: false,
  palette: { base: "#7d7e83", dark: "#5e5f65", bright: "#a5a6ac", rock: "#76777c", ray: 0, highland: "#a9a9ad" },
  seed: 71,
  range: [-260, 260],
  zones: [
    { x: 0, r: 4, primary: true, label: "PRIMARY LZ" },
    { x: 42, r: 3.5, label: "ALT LZ · WALL FOOT" },
    { x: -52, r: 3.5, label: "ALT LZ · BEYOND RIDGE" },
  ],
  levels: [
    { x: 0, r: 10, edge: 12, h: 0 },
    { x: 42, r: 7.5, edge: 7 },
    { x: -52, r: 7.5, edge: 7 },
  ],
  terrain: [
    // the crater wall the approach comes in over
    { type: "front", x0: 60, x1: 150, h: 16, zw: 320, wobble: 6, label: "CRATER WALL" },
    // a broken wrinkle ridge across the floor beyond the clearing
    { type: "ridge", x0: -36, z0: -82, x1: -29, z1: 16, w: 7, h: 2.8, label: "WRINKLE RIDGE" },
    { type: "ridge", x0: -25, z0: 28, x1: -40, z1: 96, w: 6, h: 2.4, label: "WRINKLE RIDGE" },
    // a blocky secondary crater on the approach side
    { type: "crater", x: 20, z: 1, r: 5, d: 1.5, rim: 0.4, label: "SECONDARY CRATER", blocks: 8 },
    // ancient crater formations and the rugged basin ring (landmarks)
    { type: "crater", x: -70, z: -160, r: 72, d: 15, rim: 3, floor: 0.45, soft: 0.6, reach: 1.7, label: "ANCIENT CRATER" },
    { type: "crater", x: 120, z: -64, r: 30, d: 6.5, rim: 1.4, soft: 0.6, label: "CRATER" },
    { type: "crater", x: -150, z: 70, r: 24, d: 5, rim: 1.2, soft: 0.7, label: "CRATER" },
    { type: "hill", x: -190, z: -290, rx: 230, rz: 170, h: 75, label: "BASIN RING MASSIF" },
    { type: "ridge", x0: -330, z0: -70, x1: -120, z1: -250, w: 60, h: 30, label: "BROKEN RIDGE" },
    { type: "hill", x: 90, z: 280, rx: 210, rz: 140, h: 50, label: "BASIN RING MASSIF" },
    {
      type: "craterField", n: 110, x: [-420, 420], z: [-300, 300], r: [2, 20], depth: [0.08, 0.15], rim: 0.2, soft: 0.5,
      zMin: 9, blocks: 0.35, blocksMinR: 6, label: "CRATER",
      keepOut: [{ x: -70, z: -160, r: 72 }, { x: 120, z: -64, r: 30 }, { x: -150, z: 70, r: 24 }],
    },
    { type: "noise", amp: 0.6, scale: 50, oct: 2, seed: 21, corridor: 9 },
  ],
  rockFields: [
    { x: -16, z: 0, r: 2.6, n: 6, h: [1.0, 2.0], label: "BOULDER FIELD" },
    { x: -16, z: 14, r: 7, n: 8, h: [1.0, 2.2], label: "BOULDER FIELD" },
    { x: 34, z: -24, r: 13, n: 14, h: [1.0, 2.4], label: "BOULDER FIELD" },
    { x: -30, z: -40, r: 12, n: 10, h: [1.0, 2.2], label: "BOULDER FIELD" },
    { x: -70, z: -160, r: 95, n: 44, h: [1.2, 2.6], label: "ANCIENT CRATER BLOCKS" },
    { x: 100, z: 0, r: 30, n: 18, h: [1.0, 2.4], label: "TALUS BOULDERS" },
  ],
  debris: { n: 1000, x: [-130, 130], z: [-45, 45], h: [0.06, 0.28] },
  horizon: [
    { az: 35, el: 5.5, w: 55, kind: "massif", label: "BASIN RING" },
    { az: 95, el: 8.5, w: 42, kind: "massif", label: "BASIN RING" },
    { az: 128, el: 4.5, w: 70, kind: "ridge" },
    { az: 165, el: 7, w: 46, kind: "massif" },
    { az: -150, el: 3.5, w: 80, kind: "ridge" },
    { az: -70, el: 6, w: 50, kind: "massif" },
  ],
};

export const SITE_DEFS = [TRANQUILLITATIS, HADLEY, TYCHO, FAR_SIDE];
export const SITE_IDS = SITE_DEFS.map((s) => s.id);
/** The full mission always lands here (its orbit cinematic, captions and PDI are Tranquillity's). */
export const MISSION_SITE_ID = "tranquillitatis";

const cache = new Map();
/** The compiled site for an id (cached; unknown ids fall back to the mission's site). */
export function getSite(id = MISSION_SITE_ID) {
  const key = SITE_IDS.includes(id) ? id : MISSION_SITE_ID;
  if (!cache.has(key)) cache.set(key, compileSite(SITE_DEFS.find((s) => s.id === key)));
  return cache.get(key);
}
