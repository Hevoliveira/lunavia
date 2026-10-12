/*
 * LUNAVIA — drawable data for a landing site (pure, unit-tested).
 *
 * Built from the SAME site the physics flies (data/landingSites): the
 * terrain mesh samples site.height at its vertices, every rock instance is a
 * rock of site.rocks, and the hazard strip marks exactly the stretches that
 * site.evaluate grades unsafe. Positions are scene units: x and z at WORLD_X
 * (0.5 unit/m), heights through the site's vertical scale.
 *
 * Built once per site and cached; on an iPhone this takes a few tenths of a
 * second the first time a site is shown.
 */
import { WORLD_X } from "./touchdownFx";
import { FOOT_RADIUS, hazardMap } from "./landingSites";

const DEG = Math.PI / 180;

/* ---- grid --------------------------------------------------------------------------- */
// A fine patch (1 m cells) where the LM flies and lands, and a coarse far
// field round it (8 m cells growing outwards to the horizon) with a hole
// where the fine patch is; a skirt along the patch's edge hides any crack.
// About 18k vertices, one draw call.
export const GRID = { fineX: 104, fineZ: 34, step: 1, coarse: 8, growth: 1.18, far: 2000, skirt: 1.5 };

/** The fine patch's axis: uniform 1 m steps over ±fineHalf. */
export function fineAxis(fineHalf) {
  const out = [];
  for (let v = -fineHalf; v <= fineHalf + 1e-9; v += GRID.step) out.push(v);
  return out;
}

/** The far field's axis: coarse steps inside ±fineHalf (ending exactly on it), then growing to ±far. */
export function farAxis(fineHalf) {
  const half = [];
  const n = Math.max(1, Math.ceil(fineHalf / GRID.coarse));
  for (let i = 0; i <= n; i++) half.push((fineHalf * i) / n);
  let v = fineHalf;
  let d = fineHalf / n;
  while (v < GRID.far) {
    d *= GRID.growth;
    v = Math.min(GRID.far, v + d);
    half.push(v);
  }
  const out = [];
  for (let i = half.length - 1; i > 0; i--) out.push(-half[i]);
  return out.concat(half);
}

/** Unit vector (scene) towards a sky direction { el, az } (deg; az 0 = +x, 90 = -z). */
export function skyDirection({ el, az }) {
  const ce = Math.cos(el * DEG);
  return [ce * Math.cos(az * DEG), Math.sin(el * DEG), -ce * Math.sin(az * DEG)];
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  // sRGB -> linear (vertex colours are linear)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.pow(c / 255, 2.2));
};
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function hash(ix, iz, s) {
  let h = (ix * 374761393 + iz * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z, s) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, s);
  const b = hash(ix + 1, iz, s);
  const c = hash(ix, iz + 1, s);
  const d = hash(ix + 1, iz + 1, s);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/* ---- albedo ------------------------------------------------------------------------------ */
/**
 * Surface albedo (linear RGB) at (x, z) m, height h m and ground slope (deg):
 * the site's palette, mottled; fresh craters ringed by brighter ejecta; steep
 * slopes brighter (fresh material); highlands brighter than mare (Hadley);
 * melt ponds darker and Tycho's rays bright.
 */
const palettes = new Map();
function paletteOf(site) {
  if (!palettes.has(site.id)) {
    const p = site.palette;
    palettes.set(site.id, {
      base: hex(p.base),
      dark: hex(p.dark),
      bright: hex(p.bright),
      highland: p.highland ? hex(p.highland) : null,
      pond: p.pond ? hex(p.pond) : null,
      ray: !!p.ray,
    });
  }
  return palettes.get(site.id);
}

export function albedo(site, x, z, h, slope, cratersAt) {
  const { base, dark, bright, highland, pond, ray: rays } = paletteOf(site);
  const m = 0.5 + 0.55 * (vnoise(x / 47, z / 47, site.seed) - 0.5) + 0.35 * (vnoise(x / 11, z / 11, site.seed + 9) - 0.5);
  let c = m < 0.5 ? mix3(dark, base, m * 2) : mix3(base, bright, (m - 0.5) * 2);
  let lift = 0.09 * smoothstep(16, 34, slope);
  for (const f of cratersAt(x, z)) {
    const d = Math.hypot(x - f.x, z - f.z);
    if (d > f.r * 2.3) continue;
    const rho = d / f.r;
    const fresh = f.kr < 0.5 * f.rim ? 1 : 0.25;
    lift += fresh * 0.11 * smoothstep(2.3, 1.05, rho) * smoothstep(0.55, 0.95, rho);
  }
  if (highland) c = mix3(c, highland, smoothstep(6, 26, h));
  if (rays) {
    // bright rays radiating from Tycho, far beyond the horizon
    const th = Math.atan2(z + 5200, x - 1900);
    const ray = Math.pow(vnoise(th * 260, 0.5, 77), 3) * smoothstep(0.2, 0.9, vnoise(x / 90, z / 90, 13));
    lift += 0.12 * ray;
  }
  if (pond && site.ponds) {
    for (const pd of site.ponds) {
      const w = 1 - smoothstep(pd.r - 3, pd.r + 4, Math.hypot(x - pd.x, z - pd.z));
      if (w > 0) c = mix3(c, pond, 0.75 * w);
    }
  }
  return [c[0] * (1 + lift * 3), c[1] * (1 + lift * 3), c[2] * (1 + lift * 3)];
}

/* ---- the terrain mesh ----------------------------------------------------------------------- */
const cache = new Map();

// Index of the grid cell containing v on a sorted axis (binary search).
function cell(axis, v) {
  let lo = 0;
  let hi = axis.length - 1;
  if (v <= axis[0]) return 0;
  if (v >= axis[hi]) return hi - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (axis[mid] <= v) lo = mid;
    else hi = mid;
  }
  return lo;
}

// A height grid over two axes, with the DRAWN surface's height inside a cell
// (each cell is split along its shorter diagonal, as the mesh is).
function heightGrid(site, xs, zs) {
  const nx = xs.length;
  const nz = zs.length;
  const heights = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) heights[j * nx + i] = site.height(xs[i], zs[j]);
  const at = (i, j, tx, tz) => {
    const a = heights[j * nx + i];
    const b = heights[j * nx + i + 1];
    const c = heights[(j + 1) * nx + i];
    const d = heights[(j + 1) * nx + i + 1];
    if (Math.abs(a - d) < Math.abs(b - c)) return tz > tx ? a + (d - c) * tx + (c - a) * tz : a + (b - a) * tx + (d - b) * tz;
    return tx + tz <= 1 ? a + (b - a) * tx + (c - a) * tz : d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  };
  return { xs, zs, nx, nz, heights, at };
}

function cellIndex(grid, skip) {
  const { nx, nz, heights } = grid;
  const out = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      if (skip && skip(i, j)) continue;
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      if (Math.abs(heights[a] - heights[d]) < Math.abs(heights[b] - heights[c])) out.push(a, c, d, a, d, b);
      else out.push(a, c, b, b, c, d);
    }
  }
  return out;
}

/**
 * Drawable terrain for a site: { near, far (height grids: xs, zs, heights
 * m), positions, normals (scene), colors (linear), sunVis (0..1 direct
 * sunlight reaching each vertex, from the terrain's own shadows), index,
 * lookup(x, z) (m: the drawn surface) }.
 */
export function buildTerrain(site) {
  if (cache.has(site.id)) return cache.get(site.id);
  const FX = GRID.fineX;
  const FZ = GRID.fineZ;
  const near = heightGrid(site, fineAxis(FX), fineAxis(FZ));
  const far = heightGrid(site, farAxis(FX), farAxis(FZ));
  const inNear = (x, z) => x >= -FX && x <= FX && z >= -FZ && z <= FZ;

  // Height of the DRAWN surface (m) at (x, z).
  const lookup = (x, z) => {
    if (inNear(x, z)) {
      const i = Math.min(near.nx - 2, Math.floor(x + FX));
      const j = Math.min(near.nz - 2, Math.floor(z + FZ));
      return near.at(i, j, clamp(x + FX - i, 0, 1), clamp(z + FZ - j, 0, 1));
    }
    const i = cell(far.xs, x);
    const j = cell(far.zs, z);
    return far.at(i, j, clamp((x - far.xs[i]) / (far.xs[i + 1] - far.xs[i]), 0, 1), clamp((z - far.zs[j]) / (far.zs[j + 1] - far.zs[j]), 0, 1));
  };

  // Vertices: the fine patch, its skirt, then the far field.
  const verts = []; // [x, z, h (m), normal source grid, i, j]
  near.zs.forEach((z, j) => near.xs.forEach((x, i) => verts.push([x, z, near.heights[j * near.nx + i], near, i, j])));
  const nNear = verts.length;
  // the patch's edge, in order round it
  const ring = [];
  for (let i = 0; i < near.nx; i++) ring.push([i, 0]);
  for (let j = 1; j < near.nz; j++) ring.push([near.nx - 1, j]);
  for (let i = near.nx - 2; i >= 0; i--) ring.push([i, near.nz - 1]);
  for (let j = near.nz - 2; j > 0; j--) ring.push([0, j]);
  ring.forEach(([i, j]) => verts.push([near.xs[i], near.zs[j], near.heights[j * near.nx + i] - GRID.skirt, near, i, j]));
  const nSkirt = ring.length;
  far.zs.forEach((z, j) => far.xs.forEach((x, i) => verts.push([x, z, far.heights[j * far.nx + i], far, i, j])));
  const n = verts.length;

  const sy = site.scale.y;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  verts.forEach(([x, z, h, g, i, j], k) => {
    positions[k * 3] = x * WORLD_X;
    positions[k * 3 + 1] = sy(h);
    positions[k * 3 + 2] = z * WORLD_X;
    // normal of the drawn surface (scene units), from the vertex's own grid
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(g.nx - 1, i + 1);
    const j0 = Math.max(0, j - 1);
    const j1 = Math.min(g.nz - 1, j + 1);
    const dx = (sy(g.heights[j * g.nx + i1]) - sy(g.heights[j * g.nx + i0])) / ((g.xs[i1] - g.xs[i0]) * WORLD_X);
    const dz = (sy(g.heights[j1 * g.nx + i]) - sy(g.heights[j0 * g.nx + i])) / ((g.zs[j1] - g.zs[j0]) * WORLD_X);
    const l = Math.hypot(dx, 1, dz);
    normals[k * 3] = -dx / l;
    normals[k * 3 + 1] = 1 / l;
    normals[k * 3 + 2] = -dz / l;
  });

  // Shadows of the terrain itself, for the site's low Sun (a horizon march in
  // scene space, soft over ±1.2° of the Sun's elevation).
  const sun = skyDirection(site.sun);
  const hl = Math.hypot(sun[0], sun[2]);
  const ux = sun[0] / hl;
  const uz = sun[2] / hl;
  const tanEl = Math.tan(site.sun.el * DEG);
  const soft = Math.tan(1.2 * DEG);
  const sunVis = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const [x, z] = verts[k];
    if (Math.abs(x) > 1300 || Math.abs(z) > 1300) {
      sunVis[k] = 1; // the far ring: shading only
      continue;
    }
    const y0 = positions[k * 3 + 1] + 0.02;
    let horizon = -1;
    for (let d = 1; d < 800; d *= 1.24) {
      const t = (sy(lookup(x + ux * d, z + uz * d)) - y0) / (d * WORLD_X);
      if (t > horizon) {
        horizon = t;
        if (horizon > tanEl + soft) break;
      }
    }
    sunVis[k] = smoothstep(-soft, soft, tanEl - horizon);
  }

  // Albedo; craters looked up by 40 m cell.
  const CELL = 40;
  const cells = new Map();
  site.features
    .filter((f) => f.type === "crater")
    .forEach((f) => {
      const R = f.r * 2.3;
      for (let a = Math.floor((f.x - R) / CELL); a <= Math.floor((f.x + R) / CELL); a++) {
        for (let b = Math.floor((f.z - R) / CELL); b <= Math.floor((f.z + R) / CELL); b++) {
          const key = a * 9973 + b;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(f);
        }
      }
    });
  const none = [];
  const cratersAt = (x, z) => cells.get(Math.floor(x / CELL) * 9973 + Math.floor(z / CELL)) || none;
  const colors = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    const [x, z, h] = verts[k];
    const slope = Math.acos(clamp(normals[k * 3 + 1], -1, 1)) / DEG;
    const c = albedo(site, x, z, k >= nNear && k < nNear + nSkirt ? h + GRID.skirt : h, slope, cratersAt);
    colors[k * 3] = c[0];
    colors[k * 3 + 1] = c[1];
    colors[k * 3 + 2] = c[2];
  }

  // Triangles: the fine patch; the skirt (both faces); the far field less the hole.
  const index = cellIndex(near);
  for (let r = 0; r < nSkirt; r++) {
    const [i0, j0] = ring[r];
    const [i1, j1] = ring[(r + 1) % nSkirt];
    const a = j0 * near.nx + i0;
    const b = j1 * near.nx + i1;
    const sa = nNear + r;
    const sb = nNear + ((r + 1) % nSkirt);
    index.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa);
  }
  const off = nNear + nSkirt;
  const hole = (i, j) => far.xs[i] >= -FX - 1e-9 && far.xs[i + 1] <= FX + 1e-9 && far.zs[j] >= -FZ - 1e-9 && far.zs[j + 1] <= FZ + 1e-9;
  cellIndex(far, hole).forEach((v) => index.push(v + off));

  const out = { near, far, positions, normals, colors, sunVis, index: new Uint32Array(index), lookup, sun, count: n };
  cache.set(site.id, out);
  return out;
}

/** Direct sunlight reaching (x, z) m on the terrain (0..1), from the baked shadows (fine patch; 1 elsewhere). */
export function sunVisAt(terrain, x, z) {
  const { near, sunVis } = terrain;
  const FX = GRID.fineX;
  const FZ = GRID.fineZ;
  if (x < -FX || x > FX || z < -FZ || z > FZ) return 1;
  const i = Math.min(near.nx - 2, Math.floor(x + FX));
  const j = Math.min(near.nz - 2, Math.floor(z + FZ));
  const tx = clamp(x + FX - i, 0, 1);
  const tz = clamp(z + FZ - j, 0, 1);
  const v = (ii, jj) => sunVis[jj * near.nx + ii];
  const a = v(i, j);
  const b = v(i + 1, j);
  const c = v(i, j + 1);
  const d = v(i + 1, j + 1);
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

/* ---- rocks ---------------------------------------------------------------------------------- */
/**
 * Instance data for the site's rocks (boulders or debris): one rock of
 * site.rocks per instance, at its position and size. The unit rock mesh
 * spans y 0..1 and a radius of 1, so each rock is drawn exactly as tall
 * (scene) and as wide as the rock the physics knows.
 */
export function rockInstances(site, boulders) {
  const terrain = buildTerrain(site);
  const list = site.rocks.filter((r) => r.boulder === boulders);
  const sy = site.scale.y;
  return list.map((r) => {
    const y0 = sy(r.base);
    return {
      rock: r,
      position: [r.x * WORLD_X, y0, r.z * WORLD_X],
      scale: [r.r * WORLD_X, sy(r.top) - y0, r.r * WORLD_X * (0.8 + 0.4 * r.shape)],
      rotationY: r.rot[0],
      tilt: (r.rot[1] - Math.PI) * 0.06,
      sunVis: sunVisAt(terrain, r.x, r.z),
      tone: r.tone,
    };
  });
}

/* ---- the hazard strip --------------------------------------------------------------------- */
/**
 * The unsafe stretches of the track, as drawn: the same intervals hazardMap
 * reports (the touchdown evaluation), widened to the LM's footprint across.
 */
export function hazardStrip(site, step = 0.25) {
  return hazardMap(site, step).map((h) => ({ ...h, halfWidth: FOOT_RADIUS }));
}
