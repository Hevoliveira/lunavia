/*
 * LUNAVIA — the sky over the recovery area: a field of scattered fair-weather cumulus (pure; tested).
 *
 * The clouds are not built from geometry. This module describes the weather; the renderer
 * (components/scenes/descent/CumulusLayer) traces each pixel's ray through the cloud layer and asks,
 * at each point, how much vapour is there:
 * - cumulusCells(): where the clouds are. Separate cells (dart-throwing, a minimum gap between
 *   them), mostly small and a few larger, larger cells growing taller, thinned in broad patches so
 *   the field is uneven, and none near the splashdown column: the last of the descent and the
 *   recovery are in clear air, with the clouds in the distance.
 * - weatherMap(): the cells drawn into a map the shader reads: R the coverage (how far inside a
 *   cell, with a ragged, wind-blown edge), G the cell's top (its height above the base).
 * - cloudNoise3D(): a small tileable 3D noise (R: billowing Perlin–Worley for the shape, G: a
 *   finer Worley for the eroded edges), so a cloud's outline is cauliflower, never a sphere.
 * Positions are metres in the descent's ground frame (the drogue anchor's frame of
 * data/descentScene: the capsule's final column at x = -DROGUE_DRIFT_M, z = 0).
 */
import { DROGUE_DRIFT_M } from "./descentScene";

export const CUMULUS = {
  baseM: 820, // one condensation level (marine fair-weather cumulus)
  topMinM: 1150,
  topMaxM: 2450,
  mapM: 160000, // the weather map's side (the cloud field), centred on the column
  mapN: 1024,
  clearM: 6000, // no cloud within this of the splashdown column (edge to centre): the recovery's sky is open overhead
  rMinM: 380,
  rMaxM: 1700,
  gapM: 700, // the least clear air between two clouds' edges
  coverTarget: 0.2, // about a fifth of the sky
};
export const COLUMN = { x: -DROGUE_DRIFT_M, z: 0 };

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
// a smooth 2D value noise (for the field's uneven patches and the cells' ragged outlines)
function valueNoise2(seed) {
  const R = rng(seed);
  const N = 64;
  const g = new Float32Array(N * N).map(() => R());
  const f = (x) => x * x * (3 - 2 * x);
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = f(x - xi);
    const fy = f(y - yi);
    const at = (i, j) => g[(((j % N) + N) % N) * N + (((i % N) + N) % N)];
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * fx;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * fx;
    return a + (b - a) * fy;
  };
}

let CELLS = null;
/** The cumulus cells: [{ x, z, r, top, seed }] (metres; top = the cell's top above the sea). */
export function cumulusCells(seed = 20261022) {
  if (CELLS && seed === 20261022) return CELLS;
  const C = CUMULUS;
  const R = rng(seed);
  const patch = valueNoise2(seed + 7);
  const half = C.mapM / 2;
  const cells = [];
  // a spatial hash for the gap test
  const bin = 4000;
  const grid = new Map();
  const key = (i, j) => i * 100003 + j;
  const near = (x, z, r) => {
    const i0 = Math.floor(x / bin);
    const j0 = Math.floor(z / bin);
    for (let i = i0 - 1; i <= i0 + 1; i++)
      for (let j = j0 - 1; j <= j0 + 1; j++) {
        const list = grid.get(key(i, j));
        if (!list) continue;
        for (const c of list) if (Math.hypot(c.x - x, c.z - z) < c.r + r + C.gapM) return true;
      }
    return false;
  };
  let area = 0;
  const target = C.coverTarget * C.mapM * C.mapM * 1.2; // the circles' area: their ragged edges and soft rims cover less
  let tries = 0;
  while (area < target && tries++ < 60000) {
    const x = COLUMN.x + (R() * 2 - 1) * half * 0.97;
    const z = COLUMN.z + (R() * 2 - 1) * half * 0.97;
    // mostly small clouds, a few larger (heavy-tailed)
    const r = C.rMinM + (C.rMaxM - C.rMinM) * Math.pow(R(), 1.7);
    const sd = R();
    const tall = R();
    // broad patches of more and fewer clouds: never a lattice
    if (patch(x / 22000, z / 22000) < 0.18 + 0.4 * R()) continue;
    if (Math.hypot(x - COLUMN.x, z - COLUMN.z) < C.clearM + r) continue;
    if (near(x, z, r)) continue;
    // larger cells have grown taller (a few towers), all from the one base
    const depth = Math.min(C.topMaxM - C.baseM, Math.max(C.topMinM - C.baseM, r * (0.95 + 0.9 * tall * tall)));
    const c = { x, z, r, top: C.baseM + depth, seed: sd };
    cells.push(c);
    const k = key(Math.floor(x / bin), Math.floor(z / bin));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(c);
    area += Math.PI * r * r;
  }
  if (seed === 20261022) CELLS = cells;
  return cells;
}

let MAP = null;
/**
 * The weather map: Uint8Array RGBA, mapN × mapN over mapM metres centred on the column (texel
 * (i, j) at x = COLUMN.x + (i + 0.5 - N/2) · mapM/N, likewise z with j). R: coverage 0..255
 * (1 at a cell's heart, falling to 0 at its ragged edge); G: the top's height in the layer
 * ((top - topMin) / (topMax - topMin)); B: the cell's seed (variety); A: 255.
 */
export function weatherMap(cells = cumulusCells(), N = CUMULUS.mapN) {
  if (MAP && N === CUMULUS.mapN && cells === CELLS) return MAP;
  const C = CUMULUS;
  const out = new Uint8Array(N * N * 4);
  const cov = new Float32Array(N * N);
  const px = C.mapM / N;
  const rough = valueNoise2(91);
  for (const c of cells) {
    const reach = c.r * 1.25;
    const i0 = Math.max(0, Math.floor((c.x - reach - COLUMN.x) / px + N / 2));
    const i1 = Math.min(N - 1, Math.ceil((c.x + reach - COLUMN.x) / px + N / 2));
    const j0 = Math.max(0, Math.floor((c.z - reach - COLUMN.z) / px + N / 2));
    const j1 = Math.min(N - 1, Math.ceil((c.z + reach - COLUMN.z) / px + N / 2));
    const topN = (c.top - C.topMinM) / (C.topMaxM - C.topMinM);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = COLUMN.x + (i + 0.5 - N / 2) * px;
        const z = COLUMN.z + (j + 0.5 - N / 2) * px;
        const dx = x - c.x;
        const dz = z - c.z;
        // a ragged, lobed outline (the noise on the angle and on the ground), stretched a little downwind (+x)
        const a = Math.atan2(dz, dx);
        const lobe = 1 + 0.22 * Math.sin(a * 3 + c.seed * 17) + 0.12 * Math.sin(a * 5 + c.seed * 31);
        const n = rough(x / 1400 + c.seed * 9, z / 1400) - 0.5;
        const d = Math.hypot(dx / 1.15, dz) / (c.r * (lobe + 0.45 * n));
        const v = Math.max(0, 1 - d * d);
        const k = j * N + i;
        if (v > cov[k]) {
          cov[k] = v;
          out[k * 4 + 1] = Math.round(Math.min(1, Math.max(0, topN)) * 255);
          out[k * 4 + 2] = Math.round(c.seed * 255);
        }
      }
  }
  for (let k = 0; k < N * N; k++) {
    out[k * 4] = Math.round(Math.min(1, cov[k]) * 255);
    out[k * 4 + 3] = 255;
  }
  if (N === CUMULUS.mapN && cells === CELLS) MAP = out;
  return out;
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
