/*
 * LUNAVIA — the sky over the recovery area: scattered fair-weather cumulus over the open sea
 * (pure; tested).
 *
 * The clouds are not built from geometry. This module describes the weather; the renderer
 * (components/scenes/descent/CumulusLayer) traces each pixel's ray through the cloud layer and asks,
 * at each point, how much vapour is there:
 * - cumulusCells(): where the clouds are and what they are. Mostly cumulus humilis: broad, low
 *   clouds 2.5 to 4.5 times wider than they are tall (a rounded, bumpy top over a flat base), in
 *   irregular groups with clear sky between them, mostly small and a few larger; a few thin,
 *   broken stratocumulus sheets; the rare taller cumulus (still wider than tall) only far off.
 *   No cloud near the splashdown column, and the larger ones and the sheets farther still: the
 *   last of the descent and the recovery are under open sky, the clouds around and beyond.
 * - weatherMap(): the cells drawn into a map the shader reads, each footprint the union of a few
 *   overlapping blobs with a ragged, wind-blown edge (never a disc): R the coverage, G the cloud's
 *   top, B its seed, A its kind (cumulus 255, stratocumulus 64). The map is a seamless 80 km tile:
 *   beyond it the sky repeats, by then deep in the haze.
 * - cloudNoise3D(): a small tileable 3D noise (R: billowing Perlin–Worley for the shape, G: smooth
 *   billows for the eroded edges, B: Worley cells), so a cloud's outline is cauliflower, never a
 *   sphere.
 * Positions are metres in the descent's ground frame (the drogue anchor's frame of
 * data/descentScene: the capsule's final column at x = -DROGUE_DRIFT_M, z = 0).
 */
import { DROGUE_DRIFT_M } from "./descentScene";

export const CUMULUS = {
  baseM: 820, // one condensation level (marine fair-weather cumulus), each cloud within ±45 m of it
  topMinM: 880, // the lowest puffs' tops
  topMaxM: 1650, // the rare taller cumulus, far off
  mapM: 80000, // the weather map's tile (m), centred on the column; it repeats beyond
  mapN: 1024, // 78 m a texel
  clearM: 3500, // no cloud's edge within this of the splashdown column
  bigClearM: 7000, // the larger clouds (radius over 650 m) and the sheets keep farther off
  rMinM: 300,
  rMaxM: 1100,
  gapM: 200, // the least clear air between two clouds' main bodies
  coverTarget: 0.22, // about a fifth of the sky
};
export const COLUMN = { x: -DROGUE_DRIFT_M, z: 0 };
/** Cloud kinds. */
export const CU = 0;
export const SC = 1;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
// a smooth 2D value noise, periodic with period P (its grid's size)
function valueNoise2(seed, P = 64) {
  const R = rng(seed);
  const g = new Float32Array(P * P).map(() => R());
  const f = (x) => x * x * (3 - 2 * x);
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = f(x - xi);
    const fy = f(y - yi);
    const at = (i, j) => g[(((j % P) + P) % P) * P + (((i % P) + P) % P)];
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * fx;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * fx;
    return a + (b - a) * fy;
  };
}
const T = () => CUMULUS.mapM;
/** The shortest offset from a to b on the tile (it wraps). */
export function wrapDelta(d) {
  const t = T();
  return d - t * Math.round(d / t);
}
/** Distance on the tile from the column (the nearest of its repeats). */
export function fromColumn(x, z) {
  return Math.hypot(wrapDelta(x - COLUMN.x), wrapDelta(z - COLUMN.z));
}

/** How far a cloud's footprint can reach from its centre (m): its puffs, their lobes and ragged edge. */
export function extent(c) {
  return c.r * c.elong * (c.kind === SC ? 1.5 : 1.75);
}

let CELLS = null;
/**
 * The clouds: [{ x, z, r, top, seed, kind, ang, elong, blobs: [{ dx, dz, r }] }] (metres; top = the
 * cloud's top above the sea; blobs relative to x, z before the cloud's rotation ang and its
 * stretch elong along it).
 */
export function cumulusCells(seed = 20261023) {
  if (CELLS && seed === 20261023) return CELLS;
  const C = CUMULUS;
  const R = rng(seed);
  const t = C.mapM;
  // broad patches of more and fewer clouds (periodic over the tile: 4 patches across)
  const patch = valueNoise2(seed + 7, 4);
  const patchAt = (x, z) => patch(((x - COLUMN.x) / t) * 4, ((z - COLUMN.z) / t) * 4);
  const cells = [];
  // a spatial hash for the gap test (on the tile)
  const bin = 2500;
  const nb = Math.ceil(t / bin);
  const grid = new Map();
  const key = (i, j) => (((i % nb) + nb) % nb) * 100003 + (((j % nb) + nb) % nb);
  // spacing by a cloud's typical footprint (its heap's main body): within a group, puffs of two
  // neighbours may touch, as real cumulus groups do; the sheets are checked by their full reach
  const reach = (c) => c.r * c.elong * 1.1;
  const sheetList = [];
  let widest = 0; // the largest cumulus reach placed so far (the search must cover it)
  const clash = (x, z, r, gap) => {
    for (const c of sheetList) if (Math.hypot(wrapDelta(c.x - x), wrapDelta(c.z - z)) < extent(c) + r + gap) return true;
    const i0 = Math.floor(x / bin);
    const j0 = Math.floor(z / bin);
    const span = Math.ceil((r + widest + gap) / bin);
    for (let i = i0 - span; i <= i0 + span; i++)
      for (let j = j0 - span; j <= j0 + span; j++) {
        const list = grid.get(key(i, j));
        if (!list) continue;
        for (const c of list) if (Math.hypot(wrapDelta(c.x - x), wrapDelta(c.z - z)) < reach(c) + r + gap) return true;
      }
    return false;
  };
  const add = (c) => {
    cells.push(c);
    if (c.kind === SC) {
      sheetList.push(c);
      return;
    }
    widest = Math.max(widest, reach(c));
    const k = key(Math.floor(c.x / bin), Math.floor(c.z / bin));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(c);
  };
  const blobsFor = (kind) => {
    if (kind === SC) {
      // a sheet: several broad, low patches strung along its length
      const n = 4 + Math.floor(R() * 3);
      const out = [{ dx: 0, dz: 0, r: 0.7, h: 1 }];
      for (let i = 0; i < n; i++) {
        const a = R() * Math.PI * 2;
        const d = 0.3 + 0.55 * R();
        out.push({ dx: Math.cos(a) * d, dz: Math.sin(a) * d * 0.55, r: 0.45 + 0.3 * R(), h: 0.75 + 0.25 * R() });
      }
      return out;
    }
    // a cumulus is a heap of puffs: a central one, the tallest, and several smaller and lower
    // round it, each its own rounded dome (a lumpy outline and a heaped top, never one disc)
    const n = 3 + Math.floor(R() * 5);
    const out = [{ dx: 0, dz: 0, r: 0.58 + 0.12 * R(), h: 1 }];
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2;
      const d = 0.25 + 0.5 * R();
      out.push({ dx: Math.cos(a) * d, dz: Math.sin(a) * d, r: 0.3 + 0.25 * R(), h: 0.5 + 0.45 * R() });
    }
    return out;
  };
  let area = 0;
  const target = C.coverTarget * t * t;
  // 1. a few broken stratocumulus sheets, thin and long, well away from the splashdown
  let sheets = 0;
  for (let tries = 0; sheets < 7 && tries < 400; tries++) {
    const x = COLUMN.x + (R() - 0.5) * t;
    const z = COLUMN.z + (R() - 0.5) * t;
    const r = 1500 + 1500 * R();
    const elong = 1.6 + 0.8 * R();
    if (fromColumn(x, z) < C.bigClearM + 3000 + extent({ r, elong, kind: SC })) continue;
    if (clash(x, z, extent({ r, elong, kind: SC }), 1500)) continue;
    const depth = 130 + 110 * R();
    add({ x, z, r, top: C.baseM + depth, seed: R(), kind: SC, ang: R() * Math.PI, elong, blobs: blobsFor(SC) });
    area += Math.PI * r * r * elong * 0.55;
    sheets++;
  }
  // 2. cumulus in irregular groups: a group's centre, then its clouds round it
  let tries = 0; // a bounded amount of work (the field is made on the device as the scene opens)
  for (let g = 0; g < 12000 && area < target && tries < 50000; g++) {
    const gx = COLUMN.x + (R() - 0.5) * t;
    const gz = COLUMN.z + (R() - 0.5) * t;
    // fewer groups in the thin patches: never a lattice
    if (patchAt(gx, gz) < 0.15 + 0.45 * R()) continue;
    const k = 1 + Math.floor(Math.pow(R(), 1.3) * 7);
    const spread = 500 + 2200 * R();
    let added = 0;
    for (let i = 0; i < k * 5 && i < 40 && added < k; i++, tries++) {
      const a = R() * Math.PI * 2;
      const d = i === 0 ? 0 : spread * Math.sqrt(R());
      const x = gx + Math.cos(a) * d;
      const z = gz + Math.sin(a) * d * 0.7;
      // mostly small clouds, a few larger (heavy-tailed); a group's first one the larger
      let r = C.rMinM + (C.rMaxM - C.rMinM) * Math.pow(R(), 1.8);
      if (i === 0) r = Math.min(C.rMaxM, r * 1.35);
      const elong = 1.05 + 0.3 * R();
      const ext = extent({ r, elong, kind: CU });
      const dc = fromColumn(x, z);
      if (dc < C.clearM + ext) continue;
      if (r > 650 && dc < C.bigClearM + ext) continue;
      if (clash(x, z, r * elong * 1.1, C.gapM)) continue;
      // broad, low cumulus (2.5 to 4.5 times wider than tall); the rare taller one only far off
      const tallOne = dc > 14000 && R() < 0.1;
      let depth = r * (tallOne ? 0.72 + 0.22 * R() : 0.44 + 0.3 * Math.pow(R(), 2));
      depth = Math.min(C.topMaxM - C.baseM, Math.max(C.topMinM - C.baseM, depth));
      add({ x, z, r, top: C.baseM + depth, seed: R(), kind: CU, ang: R() * Math.PI, elong, blobs: blobsFor(CU) });
      area += Math.PI * r * r * 0.95;
      added++;
    }
  }
  if (seed === 20261023) CELLS = cells;
  return cells;
}

// painting one cloud into the map: its blobs' union, on the tile (wrapping)
function painter(N) {
  const C = CUMULUS;
  const out = new Uint8Array(N * N * 4);
  const cov = new Float32Array(N * N);
  const px = C.mapM / N;
  // the ragged edge's noise, periodic over the tile (128 across: 625 m), made once per texel
  const rough = valueNoise2(91, 128);
  const rn = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) rn[j * N + i] = rough((i / N) * 128, (j / N) * 128) - 0.5;
  const paint = (c) => {
    const ca = Math.cos(c.ang);
    const sa = Math.sin(c.ang);
    const kindA = c.kind === SC ? 64 : 255;
    // the outline's lobes: sin(3a + p3) and sin(5a + p5), from the direction's cosine and sine
    const p3c = Math.cos(c.seed * 17);
    const p3s = Math.sin(c.seed * 17);
    const p5c = Math.cos(c.seed * 31);
    const p5s = Math.sin(c.seed * 31);
    // each cloud reads the edge noise at its own offset (texels)
    const off = Math.floor(c.seed * 997);
    for (const b of c.blobs) {
      // this puff's own top (the heap's heart the tallest)
      const top = C.baseM + (c.top - C.baseM) * b.h;
      const topN = Math.min(1, Math.max(0, (top - C.topMinM) / (C.topMaxM - C.topMinM)));
      const bx0 = b.dx * c.r * c.elong;
      const bz0 = b.dz * c.r;
      const bx = c.x + bx0 * ca - bz0 * sa;
      const bz = c.z + bx0 * sa + bz0 * ca;
      const br = b.r * c.r;
      const reach = br * c.elong * 1.55;
      const rmax2 = (br * 1.55) * (br * 1.55);
      const i0 = Math.floor((bx - reach - COLUMN.x) / px + N / 2);
      const i1 = Math.ceil((bx + reach - COLUMN.x) / px + N / 2);
      const j0 = Math.floor((bz - reach - COLUMN.z) / px + N / 2);
      const j1 = Math.ceil((bz + reach - COLUMN.z) / px + N / 2);
      for (let j = j0; j <= j1; j++) {
        const z = COLUMN.z + (j + 0.5 - N / 2) * px;
        const dz = z - bz;
        const jj = ((j % N) + N) % N;
        const jr = ((((j + off) % N) + N) % N) * N;
        for (let i = i0; i <= i1; i++) {
          const dx = COLUMN.x + (i + 0.5 - N / 2) * px - bx;
          // into the cloud's own axes: stretched along ang, the edge ragged
          const u = (dx * ca + dz * sa) / c.elong;
          const v = -dx * sa + dz * ca;
          const q2 = u * u + v * v;
          if (q2 >= rmax2) continue;
          const q = Math.sqrt(q2) || 1;
          const co = u / q;
          const si = v / q;
          const s3 = 3 * si - 4 * si * si * si;
          const c3 = 4 * co * co * co - 3 * co;
          const si2 = si * si;
          const co2 = co * co;
          const s5 = si * (16 * si2 * si2 - 20 * si2 + 5);
          const c5 = co * (16 * co2 * co2 - 20 * co2 + 5);
          const lobe = 1 + 0.16 * (s3 * p3c + c3 * p3s) + 0.1 * (s5 * p5c + c5 * p5s);
          const ii = ((i % N) + N) % N;
          const n = rn[jr + ((((i + off) % N) + N) % N)];
          const d = q / (br * (lobe + 0.5 * n));
          const val = 1 - d * d;
          if (val <= 0) continue;
          const k = jj * N + ii;
          // the union of the blobs (each keeps its own rounded profile: the cloud is highest over
          // a blob's heart, never a flat plateau); the stronger one's top, seed and kind
          if (val > cov[k]) {
            cov[k] = val;
            out[k * 4 + 1] = Math.round(topN * 255);
            out[k * 4 + 2] = Math.round(c.seed * 255);
            out[k * 4 + 3] = kindA;
          }
        }
      }
    }
  };
  const finish = () => {
    for (let k = 0; k < N * N; k++) {
      out[k * 4] = Math.round(Math.min(1, cov[k]) * 255);
      if (cov[k] <= 0) out[k * 4 + 3] = 255;
    }
    return out;
  };
  return { paint, finish };
}

let MAP = null;
/**
 * The weather map: Uint8Array RGBA, mapN × mapN over the mapM tile centred on the column (texel
 * (i, j) at x = COLUMN.x + (i + 0.5 - N/2) · mapM/N, likewise z with j), seamless when repeated.
 * R: coverage 0..255 (1 at a cloud's heart, 0 at its ragged edge); G: the top's height in the
 * layer ((top - topMin) / (topMax - topMin)); B: the cloud's seed; A: its kind (255 cumulus,
 * 64 a stratocumulus sheet).
 */
export function weatherMap(cells = cumulusCells(), N = CUMULUS.mapN) {
  if (MAP && N === CUMULUS.mapN && cells === CELLS) return MAP;
  const { paint, finish } = painter(N);
  cells.forEach(paint);
  const out = finish();
  if (N === CUMULUS.mapN && cells === CELLS) MAP = out;
  return out;
}
/** The same map made in steps (a few hundred clouds each), so the scene never stalls on it. */
export function weatherMapSteps(per = 350) {
  const holder = { map: null };
  if (MAP) {
    holder.map = MAP;
    return { steps: [], holder };
  }
  const steps = [];
  let p = null;
  let cells = null;
  steps.push(() => {
    cells = cumulusCells();
    p = painter(CUMULUS.mapN);
  });
  const n = Math.ceil(cumulusCells().length / per);
  for (let s = 0; s < n; s++) steps.push(() => cells.slice(s * per, (s + 1) * per).forEach(p.paint));
  steps.push(() => {
    MAP = p.finish();
    holder.map = MAP;
  });
  return { steps, holder };
}

/** The field's share of the sky inside a radius of the column (from the map), for the tests. */
export function coverFraction(map, N, radiusM) {
  const px = CUMULUS.mapM / N;
  let n = 0;
  let c = 0;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5 - N / 2) * px;
      const z = (j + 0.5 - N / 2) * px;
      if (x * x + z * z > radiusM * radiusM) continue;
      n++;
      if (map[(j * N + i) * 4] > 40) c++;
    }
  return c / n;
}

let NOISE = null;
/**
 * A tileable 3D noise, N³ (default 32), Uint8Array RGBA: R a billowing Perlin–Worley (low
 * frequencies: a cloud's lobes), G a smooth Perlin fbm (the eroded, billowing edge: smooth, so the
 * texture's grid never shows), B a low Worley octave (variety), A 255. It wraps on every axis.
 */
export function cloudNoise3D(N = 32) {
  if (NOISE && N === 32) return NOISE;
  const R = rng(4242);
  // Worley: a feature point per cell of a periodic grid of `cells` per side
  const worley = (cells) => {
    const pts = new Float32Array(cells * cells * cells * 3).map(() => R());
    return (x, y, z) => {
      // x, y, z in 0..1 (the tile)
      const fx = x * cells;
      const fy = y * cells;
      const fz = z * cells;
      const xi = Math.floor(fx);
      const yi = Math.floor(fy);
      const zi = Math.floor(fz);
      let best = 9;
      for (let k = -1; k <= 1; k++)
        for (let j = -1; j <= 1; j++)
          for (let i = -1; i <= 1; i++) {
            const cx = xi + i;
            const cy = yi + j;
            const cz = zi + k;
            const w = (v) => ((v % cells) + cells) % cells;
            const o = (w(cz) * cells * cells + w(cy) * cells + w(cx)) * 3;
            const dx = cx + pts[o] - fx;
            const dy = cy + pts[o + 1] - fy;
            const dz = cz + pts[o + 2] - fz;
            const d = dx * dx + dy * dy + dz * dz;
            if (d < best) best = d;
          }
      return Math.min(1, Math.sqrt(best));
    };
  };
  // periodic gradient (Perlin) noise
  const perlin = (period) => {
    const g = new Float32Array(period * period * period * 3);
    for (let i = 0; i < g.length; i += 3) {
      const t = R() * Math.PI * 2;
      const u = R() * 2 - 1;
      const s = Math.sqrt(1 - u * u);
      g[i] = s * Math.cos(t);
      g[i + 1] = s * Math.sin(t);
      g[i + 2] = u;
    }
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    return (x, y, z) => {
      const fx = x * period;
      const fy = y * period;
      const fz = z * period;
      const xi = Math.floor(fx);
      const yi = Math.floor(fy);
      const zi = Math.floor(fz);
      const tx = fx - xi;
      const ty = fy - yi;
      const tz = fz - zi;
      const w = (v) => ((v % period) + period) % period;
      const dot = (i, j, k) => {
        const o = (w(zi + k) * period * period + w(yi + j) * period + w(xi + i)) * 3;
        return g[o] * (tx - i) + g[o + 1] * (ty - j) + g[o + 2] * (tz - k);
      };
      const u = fade(tx);
      const v = fade(ty);
      const s = fade(tz);
      const l = (a, b, t) => a + (b - a) * t;
      return l(l(l(dot(0, 0, 0), dot(1, 0, 0), u), l(dot(0, 1, 0), dot(1, 1, 0), u), v), l(l(dot(0, 0, 1), dot(1, 0, 1), u), l(dot(0, 1, 1), dot(1, 1, 1), u), v), s);
    };
  };
  const p1 = perlin(4);
  const p2 = perlin(8);
  const p3 = perlin(16);
  const w2 = worley(4);
  const w3 = worley(8);
  const w4 = worley(16);
  const remap = (v, a, b, c, d) => c + ((v - a) / (b - a)) * (d - c);
  const ch = [new Float32Array(N * N * N), new Float32Array(N * N * N), new Float32Array(N * N * N)];
  for (let z = 0; z < N; z++)
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const X = x / N;
        const Y = y / N;
        const Z = z / N;
        const a2 = w2(X, Y, Z);
        const a3 = w3(X, Y, Z);
        const a4 = w4(X, Y, Z);
        const perl = 0.5 + 0.5 * (p1(X, Y, Z) + p2(X, Y, Z) * 0.5 + p3(X, Y, Z) * 0.25);
        const wor = 1 - (a2 * 0.625 + a3 * 0.25 + a4 * 0.125);
        const k = (z * N + y) * N + x;
        // Perlin–Worley: the Perlin's billows, cut by the Worley's cells (rounded lobes)
        ch[0][k] = remap(perl, wor - 1, 1, 0, 1);
        // smooth (Perlin) billows for the edges: a sharp cellular noise would show the grid's cubes
        ch[1][k] = p2(X, Y, Z) * 0.55 + p3(X, Y, Z) * 0.3 + p1(X, Y, Z) * 0.15;
        ch[2][k] = 1 - a2;
      }
  const out = new Uint8Array(N * N * N * 4);
  ch.forEach((c, i) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of c) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    for (let k = 0; k < c.length; k++) out[k * 4 + i] = Math.round(((c[k] - lo) / (hi - lo)) * 255);
  });
  for (let k = 0; k < N * N * N; k++) out[k * 4 + 3] = 255;
  if (N === 32) NOISE = out;
  return out;
}
