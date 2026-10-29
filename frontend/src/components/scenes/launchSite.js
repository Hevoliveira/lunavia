import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/*
 * The ground of LV-001's launch complex (scene units, 1 unit = 30 m; the vehicle stands at the
 * origin, the tower on +x; +x is east, +z south). After Launch Complex 39A (NASA references in
 * docs/visual-references/nasa-countdown 07-launch-complex): the pad is a raised concrete
 * hardstand about 15 m above the surrounding land, with the flame trench cut through it and
 * open at the foot of its slope; the crawlerway climbs a ramp on the north side; propellant
 * spheres, a water tower and support buildings stand at grade around it; flat coastal scrub
 * runs to the beach a kilometre east, the assembly building far to the north.
 *
 * The hardstand's top is y = 0, where the complex always stood, so the vehicle, the tower and
 * every camera path keep their coordinates; only the land around it is lower (GRADE).
 */

export const GRADE = -0.5; // the land around the pad: 15 m below the hardstand
export const PAD = { x0: -5.4, x1: 6.0, z0: -5.0, z1: 6.8, ch: 1.6 }; // the hardstand's top
export const SLOPE = 1.4; // horizontal run of the hardstand's sides
export const TRENCH = { w: 0.36, floor: -0.6, apron: 2.0 }; // half width; floor; exit apron length
export const RAMPS = [
  { edge: "north", c: 0, half: 1.4, len: 9 }, // the crawlerway ramp (about 5 %)
  { edge: "south", c: -3.0, half: 0.32, len: 3.4 }, // the service road, down to the perimeter road
];
const R_PLAIN = 150; // opaque land; it fades out by R_FADE into the planet beyond
const R_FADE = 215;
export const coastX = (z) => 37 + 2.6 * Math.sin(z / 23) + 1.2 * Math.sin(z / 7.3 + 1.0);
const DEG = Math.PI / 180;

function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/* ------------------------------------------------------------------------------------------ */
/* geometry helpers                                                                           */

// Triangles from a list of [x, y, z] points, each turned to face `want` (a direction).
function tris(list, want) {
  const pos = [];
  const w = new THREE.Vector3(...want);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const [p, q, r] of list) {
    a.set(...p);
    b.set(...q);
    c.set(...r);
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    if (n.dot(w) < 0) pos.push(...p, ...r, ...q);
    else pos.push(...p, ...q, ...r);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
const quad = (a, b, c, d) => [
  [a, b, c],
  [a, c, d],
];

// World-space UVs (x, z) / scale, so textures keep one size across separate meshes.
function worldUv(g, scale, axis = "xz") {
  const p = g.attributes.position;
  const uv = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    if (axis === "xz") uv.push(x / scale, -z / scale);
    else if (axis === "xy") uv.push(x / scale, y / scale);
    else uv.push(z / scale, y / scale);
  }
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

function box(w, h, d, x, y, z, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}
function cyl(rt, rb, h, x, y, z, seg = 12) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  g.translate(x, y, z);
  return g;
}
function strut(a, b, r, seg = 6) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const d = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  const m = A.add(B).multiplyScalar(0.5);
  g.translate(m.x, m.y, m.z);
  return g;
}
// Strip every attribute but position/normal/uv so differently built geometries merge.
function clean(g) {
  const out = g.index ? g.toNonIndexed() : g;
  ["color", "uv1", "uv2", "tangent"].forEach((k) => {
    if (out.attributes[k]) out.deleteAttribute(k);
  });
  if (!out.attributes.uv) out.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  if (!out.attributes.normal) out.computeVertexNormals();
  return out;
}
const merge = (list) => (list.length ? mergeGeometries(list.map(clean), false) : null);

/* ------------------------------------------------------------------------------------------ */
/* the hardstand's outline                                                                    */

/**
 * The hardstand's top outline (x, z), clockwise seen from above, with the points where the
 * trench and the ramps leave it tagged. Each point carries its outward offset direction
 * (a miter at the corners), so the foot of the slope is `p + dir * SLOPE`.
 */
export function padOutline() {
  const { x0, x1, z0, z1, ch } = PAD;
  const w = TRENCH.w;
  const pts = [];
  const add = (x, z, tag = null) => pts.push({ p: [x, z], tag });
  // north edge (z = z0), west to east, with the crawlerway ramp
  add(x0 + ch, z0);
  RAMPS.filter((r) => r.edge === "north").forEach((r) => {
    add(r.c - r.half, z0, "rampN0");
    add(r.c + r.half, z0, "rampN1");
  });
  add(x1 - ch, z0);
  add(x1, z0 + ch);
  add(x1, z1 - ch);
  add(x1 - ch, z1);
  // south edge (z = z1), east to west, with the service road
  RAMPS.filter((r) => r.edge === "south").forEach((r) => {
    add(r.c + r.half, z1, "rampS0");
    add(r.c - r.half, z1, "rampS1");
  });
  add(x0 + ch, z1);
  add(x0, z1 - ch);
  // west edge (x = x0), south to north, with the flame trench
  add(x0, w, "trench0");
  add(x0, -w, "trench1");
  add(x0, z0 + ch);
  // outward directions
  const n = pts.length;
  const edgeN = (a, b) => {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = Math.hypot(dx, dz);
    // clockwise from above (x right, z down): the outward normal is (dz, -dx)… check against the centroid side
    let nx = -dz / l;
    let nz = dx / l;
    const mx = (a[0] + b[0]) / 2;
    const mz = (a[1] + b[1]) / 2;
    if (nx * (mx - 0.3) + nz * (mz - 0.9) < 0) {
      nx = -nx;
      nz = -nz;
    }
    return [nx, nz];
  };
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n].p;
    const cur = pts[i].p;
    const next = pts[(i + 1) % n].p;
    const a = edgeN(prev, cur);
    const b = edgeN(cur, next);
    let dx = a[0] + b[0];
    let dz = a[1] + b[1];
    const l = Math.hypot(dx, dz);
    dx /= l;
    dz /= l;
    const k = 1 / Math.max(0.5, dx * a[0] + dz * a[1]); // miter length
    pts[i].dir = [dx * k, dz * k];
    pts[i].foot = [cur[0] + dx * k * SLOPE, cur[1] + dz * k * SLOPE];
  }
  return pts;
}

const rampFor = (edge) => RAMPS.find((r) => r.edge === edge);

/* ------------------------------------------------------------------------------------------ */
/* textures                                                                                   */

function canvasTex(w, h, draw, { srgb = true, repeat = null } = {}) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(...repeat);
  return t;
}

function blobs(ctx, r, n, W, H, cols, rMin, rMax, alpha) {
  for (let i = 0; i < n; i++) {
    const x = r() * W;
    const y = r() * H;
    const rad = rMin + r() * (rMax - rMin);
    const col = cols[Math.floor(r() * cols.length)];
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${col},${alpha})`);
    g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}

// The land from the pad to the horizon, seen from above: scrub, dry sand, marsh, ponds, the
// beach and the sea to the east (world x, z in ±R_FADE across the canvas).
function siteMapTexture() {
  const r = rng(907);
  const N = 1024;
  const S = R_FADE * 2;
  return canvasTex(N, N, (ctx, W, H) => {
    ctx.fillStyle = "#5f6246";
    ctx.fillRect(0, 0, W, H);
    blobs(ctx, r, 520, W, H, ["72,80,54", "88,90,62", "108,104,76", "126,118,90", "64,72,52", "96,96,68"], 6, 46, 0.55);
    blobs(ctx, r, 900, W, H, ["60,68,46", "100,98,70", "132,124,96", "78,84,58"], 2, 10, 0.5);
    // ponds and marsh (the lagoons west of the pads)
    blobs(ctx, r, 40, W * 0.45, H, ["48,70,66", "40,58,52"], 4, 22, 0.75);
    // scorched, mown ground inside the pad's perimeter road
    const cx = W / 2;
    const cy = H / 2;
    const k = W / S;
    const mown = ctx.createRadialGradient(cx, cy, 8 * k, cx, cy, 14 * k);
    mown.addColorStop(0, "rgba(118,116,86,0.9)");
    mown.addColorStop(1, "rgba(118,116,86,0)");
    ctx.fillStyle = mown;
    ctx.fillRect(0, 0, W, H);
    // scorched ground fanning out west of the trench mouth
    const tx = ((-8.8 + R_FADE) / S) * W;
    const sc = ctx.createRadialGradient(tx, cy, 0, tx, cy, 9 * k);
    sc.addColorStop(0, "rgba(52,46,38,0.85)");
    sc.addColorStop(0.5, "rgba(70,64,52,0.45)");
    sc.addColorStop(1, "rgba(70,64,52,0)");
    ctx.fillStyle = sc;
    ctx.beginPath();
    ctx.moveTo(tx, cy);
    ctx.arc(tx, cy, 9 * k, Math.PI - 0.55, Math.PI + 0.55);
    ctx.closePath();
    ctx.fill();
    // the beach and the sea, row by row along the coastline
    for (let y = 0; y < H; y++) {
      const z = (y / H) * S - R_FADE;
      const xc = ((coastX(z) + R_FADE) / S) * W;
      const g = ctx.createLinearGradient(xc - 9 * k, 0, xc + 2 * k, 0);
      g.addColorStop(0, "rgba(112,110,80,0)");
      g.addColorStop(0.45, "rgba(170,160,124,0.9)");
      g.addColorStop(0.82, "rgba(206,196,164,1)");
      g.addColorStop(1, "rgba(40,78,96,1)");
      ctx.fillStyle = g;
      ctx.fillRect(xc - 9 * k, y, 11 * k, 1);
      ctx.fillStyle = "#284d60";
      ctx.fillRect(xc + 2 * k, y, W, 1);
    }
  });
}

// Fine ground detail, tiled (grey around 0.5: multiplies the site map).
function groundDetailTexture() {
  const r = rng(311);
  return canvasTex(256, 256, (ctx, W, H) => {
    ctx.fillStyle = "rgb(128,128,128)";
    ctx.fillRect(0, 0, W, H);
    blobs(ctx, r, 160, W, H, ["90,90,90", "170,170,170", "110,110,110"], 3, 18, 0.45);
    for (let i = 0; i < 7000; i++) {
      const v = 70 + Math.floor(r() * 120);
      ctx.fillStyle = `rgba(${v},${v},${v},0.5)`;
      ctx.fillRect(r() * W, r() * H, 1 + r() * 1.5, 1 + r() * 1.5);
    }
  }, { srgb: false });
}

// Mown grass on the hardstand's embankments, with a few eroded runnels.
function bermTexture() {
  const r = rng(53);
  return canvasTex(256, 256, (ctx, W, H) => {
    ctx.fillStyle = "#6a6d48";
    ctx.fillRect(0, 0, W, H);
    blobs(ctx, r, 140, W, H, ["88,96,58", "120,116,82", "76,84,50"], 4, 20, 0.5);
    for (let i = 0; i < 6000; i++) {
      const v = r();
      ctx.fillStyle = v < 0.5 ? "rgba(70,80,44,0.5)" : "rgba(140,136,96,0.45)";
      ctx.fillRect(r() * W, r() * H, 1, 1 + r() * 2);
    }
  });
}

// Refractory concrete in the trench: cast panels, streaks running with the exhaust, soot.
function trenchTexture() {
  const r = rng(77);
  return canvasTex(512, 256, (ctx, W, H) => {
    ctx.fillStyle = "#6f6b64";
    ctx.fillRect(0, 0, W, H);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 8; x++) {
        const v = 96 + Math.floor(r() * 26);
        ctx.fillStyle = `rgb(${v},${v - 3},${v - 8})`;
        ctx.fillRect(x * 64 + 1, y * 64 + 1, 62, 62);
      }
    }
    ctx.strokeStyle = "rgba(40,36,32,0.6)";
    ctx.lineWidth = 2;
    for (let x = 0; x <= 8; x++) {
      ctx.beginPath();
      ctx.moveTo(x * 64, 0);
      ctx.lineTo(x * 64, H);
      ctx.stroke();
    }
    for (let y = 0; y <= 4; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * 64);
      ctx.lineTo(W, y * 64);
      ctx.stroke();
    }
    // exhaust streaks (horizontal: along the trench) and soot pooling low
    for (let i = 0; i < 220; i++) {
      const y = r() * H;
      const len = 40 + r() * 260;
      ctx.fillStyle = `rgba(30,26,22,${0.06 + r() * 0.12})`;
      ctx.fillRect(r() * W, y, len, 1 + r() * 3);
    }
    const g = ctx.createLinearGradient(0, H, 0, 0);
    g.addColorStop(0, "rgba(24,20,18,0.75)");
    g.addColorStop(0.6, "rgba(24,20,18,0.15)");
    g.addColorStop(1, "rgba(24,20,18,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  });
}

function asphaltTexture() {
  const r = rng(13);
  return canvasTex(128, 128, (ctx, W, H) => {
    ctx.fillStyle = "#4b4b48";
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 3000; i++) {
      const v = 55 + Math.floor(r() * 50);
      ctx.fillStyle = `rgba(${v},${v},${v - 2},0.6)`;
      ctx.fillRect(r() * W, r() * H, 1, 1);
    }
    // a faded centre line
    ctx.fillStyle = "rgba(210,196,120,0.45)";
    for (let y = 0; y < H; y += 32) ctx.fillRect(W / 2 - 1, y, 2, 18);
  });
}

// Support buildings: insulated wall panels, a band of windows, a roll-up door.
function buildingTexture() {
  const r = rng(29);
  return canvasTex(256, 128, (ctx, W, H) => {
    ctx.fillStyle = "#d8d4c8";
    ctx.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 8) {
      const v = 200 + Math.floor(r() * 22);
      ctx.fillStyle = `rgb(${v},${v - 3},${v - 10})`;
      ctx.fillRect(x, 0, 7, H);
    }
    ctx.fillStyle = "#3a4048";
    for (let x = 14; x < W - 20; x += 22) ctx.fillRect(x, H * 0.3, 14, H * 0.16);
    ctx.fillStyle = "#8d8a82";
    ctx.fillRect(W * 0.7, H * 0.52, W * 0.18, H * 0.48);
    ctx.fillStyle = "rgba(60,58,54,0.35)";
    for (let y = H * 0.52; y < H; y += 5) ctx.fillRect(W * 0.7, y, W * 0.18, 1);
    const g = ctx.createLinearGradient(0, H * 0.8, 0, H);
    g.addColorStop(0, "rgba(90,84,70,0)");
    g.addColorStop(1, "rgba(90,84,70,0.4)");
    ctx.fillStyle = g;
    ctx.fillRect(0, H * 0.8, W, H * 0.2);
  });
}

// The assembly building's skin: ribbed panels and the tall door slot.
function vabTexture() {
  const r = rng(5);
  return canvasTex(256, 256, (ctx, W, H) => {
    ctx.fillStyle = "#c9cbc8";
    ctx.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 4) {
      const v = 186 + Math.floor(r() * 26);
      ctx.fillStyle = `rgb(${v},${v + 1},${v - 1})`;
      ctx.fillRect(x, 0, 3, H);
    }
    // the high-bay door: stacked leaves, darker
    ctx.fillStyle = "#8e918f";
    ctx.fillRect(W * 0.38, H * 0.12, W * 0.24, H * 0.88);
    ctx.fillStyle = "rgba(60,62,62,0.5)";
    for (let y = H * 0.12; y < H; y += 14) ctx.fillRect(W * 0.38, y, W * 0.24, 2);
    ctx.fillStyle = "#6f7271";
    ctx.fillRect(0, 0, W, 6);
  });
}

/* ------------------------------------------------------------------------------------------ */
/* the site                                                                                   */

/**
 * Geometries, textures and materials of the ground: { geo, tex, mat, inst }. `geo` keys pair
 * with `mat` keys of the same name (one draw call each); `inst` holds the instanced scrub.
 */
export function buildSite() {
  const out = {};
  const pts = padOutline();
  const n = pts.length;
  const G = GRADE;
  const { x0 } = PAD;
  const w = TRENCH.w;
  const F = TRENCH.floor;

  /* the hardstand's top: one concave shape with the trench cut into its west side */
  const shape = new THREE.Shape();
  // walk the outline, replacing the trench gap by the notch to the flame pit
  pts.forEach((pt, i) => {
    const [x, z] = pt.p;
    if (i === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
    if (pt.tag === "trench0") {
      shape.lineTo(w, -w);
      shape.lineTo(w, w);
    }
  });
  const top = new THREE.ShapeGeometry(shape);
  top.rotateX(-Math.PI / 2);
  worldUv(top, 12);
  // centre the concrete texture's scorch on the pit (uv 0.5 at the origin)
  const uvA = top.attributes.uv;
  for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i) + 0.5, uvA.getY(i) + 0.5);

  /* its embankments, the ramps and their retaining walls */
  const slope = [];
  const walls = [];
  const ramp = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    if (a.tag === "trench0" || a.tag === "rampN0" || a.tag === "rampS0") continue; // the gaps
    slope.push(...quad([a.p[0], 0, a.p[1]], [b.p[0], 0, b.p[1]], [b.foot[0], G, b.foot[1]], [a.foot[0], G, a.foot[1]]));
  }
  RAMPS.forEach((rp) => {
    const s = rp.edge === "north" ? -1 : 1;
    const ze = rp.edge === "north" ? PAD.z0 : PAD.z1;
    const zEnd = ze + s * rp.len;
    const xa = rp.c - rp.half;
    const xb = rp.c + rp.half;
    ramp.push(...quad([xa, 0, ze], [xb, 0, ze], [xb, G + 0.003, zEnd], [xa, G + 0.003, zEnd]));
    // retaining walls down the ramp's sides, to the land
    [xa, xb].forEach((x, k) => {
      walls.push(tris([[[x, 0, ze], [x, G, zEnd], [x, G, ze + s * SLOPE]]], [k ? 1 : -1, 0, 0]));
    });
    // the curb on each side
    [xa - 0.03, xb + 0.03].forEach((x) => {
      const L = Math.hypot(rp.len, G);
      const g = new THREE.BoxGeometry(0.05, 0.035, L);
      g.rotateX(-s * Math.atan(G / rp.len));
      g.translate(x, G / 2 + 0.017, (ze + zEnd) / 2);
      walls.push(g);
    });
  });
  out.top = top;
  out.slope = worldUv(tris(slope, [0, 1, 0]), 2.5);
  out.ramp = worldUv(tris(ramp, [0, 1, 0]), 1.2);
  out.retain = worldUv(merge(walls), 1.5, "zy");

  /* the flame trench: pit, walls, floor and the exit apron, and the deflector */
  const t0 = pts.find((p) => p.tag === "trench0");
  const xFoot = t0.foot[0]; // the foot of the slope where the trench leaves the hardstand
  const xEnd = xFoot - TRENCH.apron;
  const trench = [];
  [w, -w].forEach((z) => {
    const toward = [0, 0, -Math.sign(z)];
    const topY = (x) => (x >= x0 ? 0 : x >= xFoot ? ((x - x0) / (xFoot - x0)) * G : G);
    const xs = [w, x0, xFoot, xEnd];
    for (let k = 0; k < xs.length - 1; k++) {
      const xa = xs[k];
      const xb = xs[k + 1];
      const fa = xa > xFoot ? F : F + ((xFoot - xa) / (xFoot - xEnd)) * (G - F);
      const fb = xb > xFoot ? F : F + ((xFoot - xb) / (xFoot - xEnd)) * (G - F);
      trench.push(...quad([xa, topY(xa), z], [xb, topY(xb), z], [xb, fb, z], [xa, fa, z]).map((t) => ({ t, toward })));
    }
  });
  // the pit's east wall under the engines
  trench.push(...quad([w, 0, -w], [w, 0, w], [w, F, w], [w, F, -w]).map((t) => ({ t, toward: [-1, 0, 0] })));
  const trenchWalls = [];
  trench.forEach(({ t, toward }) => trenchWalls.push(tris([t], toward)));
  out.trench = worldUv(merge(trenchWalls), 1.6, "xy");
  const floor = [];
  floor.push(...quad([w, F, -w], [w, F, w], [xFoot, F, w], [xFoot, F, -w]));
  floor.push(...quad([xFoot, F, -w], [xFoot, F, w], [xEnd, G + 0.002, w], [xEnd, G + 0.002, -w]));
  out.trenchFloor = worldUv(tris(floor, [0, 1, 0]), 1.6);

  // Deflector: a one-sided curved steel ramp under the engines, steep beneath the vehicle and
  // turning level towards the west, so the exhaust leaves along the trench.
  const prof = [[w, -0.25], [0.16, -0.25]];
  const R = 0.7;
  const cx = -0.45;
  const cy = F + R;
  for (let k = 0; k <= 12; k++) {
    const a = (-30 - (60 * k) / 12) * DEG;
    prof.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  prof.push([-0.75, F + 0.004]);
  const dTris = [];
  const zw = w - 0.015;
  for (let k = 0; k < prof.length - 1; k++) {
    const [xa, ya] = prof[k];
    const [xb, yb] = prof[k + 1];
    dTris.push(...quad([xa, ya, -zw], [xa, ya, zw], [xb, yb, zw], [xb, yb, -zw]));
  }
  const defl = [tris(dTris, [-0.5, 1, 0])];
  // the ribs along its face (cooling-water headers)
  for (let k = 1; k < 4; k++) defl.push(strut([0.15, -0.245, -zw + (k * 2 * zw) / 4], [-0.6, F + 0.02, -zw + (k * 2 * zw) / 4], 0.008));
  out.deflector = worldUv(merge(defl), 0.8, "zy");

  /* the land at grade: opaque to R_PLAIN, open over the hardstand and the trench mouth */
  const plain = new THREE.Shape();
  for (let k = 0; k <= 160; k++) {
    const a = (k / 160) * Math.PI * 2;
    if (k === 0) plain.moveTo(R_PLAIN * Math.cos(a), R_PLAIN * Math.sin(a));
    else plain.lineTo(R_PLAIN * Math.cos(a), R_PLAIN * Math.sin(a));
  }
  const hole = new THREE.Path();
  const holePts = [];
  pts.forEach((pt) => {
    holePts.push(pt.foot);
    if (pt.tag === "trench0") holePts.push([xEnd, w], [xEnd, -w]);
  });
  holePts.forEach(([x, z], i) => (i === 0 ? hole.moveTo(x, -z) : hole.lineTo(x, -z)));
  plain.holes.push(hole);
  const land = new THREE.ShapeGeometry(plain, 8);
  land.rotateX(-Math.PI / 2);
  land.translate(0, G, 0);
  const siteUv = (g) => {
    const p = g.attributes.position;
    const uv = [];
    for (let i = 0; i < p.count; i++) uv.push((p.getX(i) + R_FADE) / (2 * R_FADE), 1 - (p.getZ(i) + R_FADE) / (2 * R_FADE));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    return g;
  };
  out.land = siteUv(land);
  // the outer ring, fading into the planet beyond (vertex alpha)
  const ring = new THREE.RingGeometry(R_PLAIN, R_FADE, 128, 3);
  ring.rotateX(-Math.PI / 2);
  ring.translate(0, G, 0);
  siteUv(ring);
  const rp = ring.attributes.position;
  const col = new Float32Array(rp.count * 4);
  for (let i = 0; i < rp.count; i++) {
    const rr = Math.hypot(rp.getX(i), rp.getZ(i));
    const u = (rr - R_PLAIN) / (R_FADE - R_PLAIN);
    col.set([1, 1, 1, Math.pow(1 - u, 1.6)], i * 4);
  }
  ring.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
  out.landFade = ring;

  /* the sea east of the beach, with the surf line */
  const sea = new THREE.Shape();
  const zc = 140;
  for (let z = -zc; z <= zc; z += 2) (z === -zc ? sea.moveTo : sea.lineTo).call(sea, coastX(z) + 1.4, -z);
  const a1 = Math.atan2(zc, coastX(zc));
  for (let k = 0; k <= 40; k++) {
    const a = a1 - (k / 40) * 2 * a1;
    sea.lineTo(R_PLAIN * Math.cos(a), -R_PLAIN * Math.sin(a));
  }
  const seaG = new THREE.ShapeGeometry(sea);
  seaG.rotateX(-Math.PI / 2);
  seaG.translate(0, G + 0.004, 0);
  out.sea = worldUv(seaG, 6);
  const surf = [];
  for (let z = -zc; z < zc; z += 2) {
    const xa = coastX(z) + 1.4;
    const xb = coastX(z + 2) + 1.4;
    surf.push(...quad([xa - 0.05, G + 0.006, z], [xb - 0.05, G + 0.006, z + 2], [xb + 0.25, G + 0.006, z + 2], [xa + 0.25, G + 0.006, z]));
  }
  out.surf = worldUv(tris(surf, [0, 1, 0]), 1);

  /* roads: the crawlerway's two lanes, the perimeter road, the service and beach roads */
  const lanes = [];
  const north = rampFor("north");
  const ramPy = (z) => (z >= PAD.z0 ? 0 : z >= PAD.z0 - north.len ? ((PAD.z0 - z) / north.len) * G : G);
  const laneStations = [-0.6, PAD.z0, PAD.z0 - north.len, -168];
  [-0.62, 0.62].forEach((xc) => {
    for (let k = 0; k < laneStations.length - 1; k++) {
      const za = laneStations[k];
      const zb = laneStations[k + 1];
      const ya = ramPy(za) + 0.006;
      const yb = ramPy(zb) + 0.006;
      lanes.push(...quad([xc - 0.2, ya, za], [xc + 0.2, ya, za], [xc + 0.2, yb, zb], [xc - 0.2, yb, zb]));
    }
  });
  out.crawlerway = worldUv(tris(lanes, [0, 1, 0]), 0.8);
  const roads = [];
  const ringR = 10.7;
  const RW = 0.13;
  for (let k = 0; k < 120; k++) {
    const a = (k / 120) * Math.PI * 2;
    const b = ((k + 1) / 120) * Math.PI * 2;
    const p = (r, t) => [r * Math.cos(t), G + 0.005, r * Math.sin(t)];
    if (Math.abs(ringR * Math.cos(a)) < 2.0 && Math.sin(a) < 0) continue; // the crawlerway ramp crosses here
    roads.push(...quad(p(ringR - RW, a), p(ringR + RW, a), p(ringR + RW, b), p(ringR - RW, b)));
  }
  const straight = (xa, za, xb, zb) => {
    const d = Math.hypot(xb - xa, zb - za);
    const nx = (-(zb - za) / d) * RW;
    const nz = ((xb - xa) / d) * RW;
    roads.push(...quad([xa + nx, G + 0.005, za + nz], [xa - nx, G + 0.005, za - nz], [xb - nx, G + 0.005, zb - nz], [xb + nx, G + 0.005, zb + nz]));
  };
  straight(-3.0, ringR + 0.1, -9, 150); // the access road, south-west towards the causeway
  straight(ringR, 0, coastX(0) - 6, 0); // to the beach road
  for (let z = -140; z < 140; z += 4) straight(coastX(z) - 6, z, coastX(z + 4) - 6, z + 4); // beach road
  straight(-9.5, -7.5, -6.9, -6.0); // to the oxygen farm
  straight(10.5, -7.0, 7.6, -5.6); // to the hydrogen farm
  out.roads = worldUv(tris(roads, [0, 1, 0]), 1);

  /* propellant farms, water tower, piping, support buildings, lights (at grade) */
  const tank = [];
  const steelDark = [];
  const steel = [];
  const white = [];
  const roof = [];
  const lamp = [];
  const pipes = [];
  const sphere = (x, z, rr, legH) => {
    const g = new THREE.SphereGeometry(rr, 28, 18);
    g.translate(x, G + legH + rr, z);
    tank.push(g);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      steelDark.push(strut([x + Math.cos(a) * rr * 0.97, G + legH + rr * 0.95, z + Math.sin(a) * rr * 0.97], [x + Math.cos(a) * rr * 1.04, G, z + Math.sin(a) * rr * 1.04], 0.016, 5));
    }
    steel.push(new THREE.TorusGeometry(rr * 0.99, 0.01, 6, 36).rotateX(Math.PI / 2).translate(x, G + legH + rr * 0.95, z));
    // the stair up the side and the top platform
    steel.push(strut([x + rr * 1.15, G, z], [x + rr * 0.2, G + legH + rr * 2.02, z], 0.008));
    steel.push(cyl(rr * 0.25, rr * 0.25, 0.012, x, G + legH + rr * 2.0, z, 12));
    // vaporizers / pump house beside it
    steelDark.push(box(0.5, 0.16, 0.3, x + (x > 0 ? -1.0 : 1.0), G + 0.08, z + 0.6));
    for (let k = 0; k < 6; k++) steel.push(cyl(0.025, 0.025, 0.3, x + (x > 0 ? -0.6 : 0.6) + (k % 3) * 0.08 * (x > 0 ? -1 : 1), G + 0.15, z - 0.5 + Math.floor(k / 3) * 0.1, 6));
  };
  sphere(-9.5, -7.5, 0.4, 0.22); // liquid oxygen, north-west
  sphere(10.5, -7.0, 0.37, 0.24); // liquid hydrogen, north-east
  // RP-1 fuel tanks: three horizontal cylinders on saddles, south-east
  for (let k = 0; k < 3; k++) {
    const g = new THREE.CylinderGeometry(0.11, 0.11, 0.9, 16);
    g.rotateX(Math.PI / 2);
    g.translate(13.2 + k * 0.3, G + 0.16, 3.6);
    tank.push(g);
    [-0.3, 0.3].forEach((dz) => steelDark.push(box(0.16, 0.08, 0.05, 13.2 + k * 0.3, G + 0.04, 3.6 + dz)));
  }
  // Water tower (sound suppression / deluge), at grade south-west
  const W = [-11.5, 4.6];
  const legs = [[0.36, 0.36], [-0.36, 0.36], [-0.36, -0.36], [0.36, -0.36]];
  legs.forEach(([dx, dz], i) => {
    steelDark.push(strut([W[0] + dx, G, W[1] + dz], [W[0] + dx * 0.62, 1.55, W[1] + dz * 0.62], 0.028, 6));
    const [ex, ez] = legs[(i + 1) % 4];
    [[G + 0.1, 0.55], [0.55, 1.2]].forEach(([ya, yb]) => {
      const fa = 1 - ((ya - G) / (1.55 - G)) * 0.38;
      const fb = 1 - ((yb - G) / (1.55 - G)) * 0.38;
      steel.push(strut([W[0] + dx * fa, ya, W[1] + dz * fa], [W[0] + ex * fb, yb, W[1] + ez * fb], 0.009));
      steel.push(strut([W[0] + ex * fa, ya, W[1] + ez * fa], [W[0] + dx * fb, yb, W[1] + dz * fb], 0.009));
    });
  });
  steelDark.push(cyl(0.05, 0.05, 1.55 - G, W[0], (1.55 + G) / 2, W[1], 8)); // riser
  const wt = new THREE.SphereGeometry(0.62, 28, 18);
  wt.scale(1, 0.78, 1);
  wt.translate(W[0], 2.0, W[1]);
  tank.push(wt);
  // the deluge main from the water tower to the pad
  pipes.push(strut([W[0], G + 0.05, W[1]], [-7.2, G + 0.05, 3.2], 0.024, 8));
  for (let u = 0.1; u < 1; u += 0.15) steelDark.push(box(0.06, 0.03, 0.06, W[0] + (-7.2 - W[0]) * u, G + 0.015, W[1] + (3.2 - W[1]) * u));
  // Cryogenic and fuel lines: on sleepers across the land, up the embankment, to the launcher
  const lineTo = (from, viaFoot, viaTop, to, offs) => {
    offs.forEach((o) => {
      const sh = (p) => [p[0] + o[0], p[1], p[2] + o[1]];
      const seq = [sh(from), sh(viaFoot), sh(viaTop), sh(to)];
      for (let k = 0; k < seq.length - 1; k++) pipes.push(strut(seq[k], seq[k + 1], 0.022, 8));
      for (let k = 0; k < seq.length - 1; k++) {
        const [a, b] = [seq[k], seq[k + 1]];
        const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
        for (let s = 0.4; s < L; s += 0.6) {
          const u = s / L;
          steelDark.push(box(0.05, 0.04, 0.05, a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u - 0.035, a[2] + (b[2] - a[2]) * u));
        }
      }
    });
  };
  const nw = pts.find((p) => p.p[0] === PAD.x0 + PAD.ch && p.p[1] === PAD.z0);
  const ne = pts.find((p) => p.p[0] === PAD.x1 - PAD.ch && p.p[1] === PAD.z0);
  lineTo([-9.1, G + 0.05, -7.1], [nw.foot[0], G + 0.05, nw.foot[1]], [nw.p[0], 0.05, nw.p[1]], [-1.2, 0.05, -1.25], [[0, 0], [0.09, 0.06]]);
  lineTo([10.1, G + 0.05, -6.6], [ne.foot[0], G + 0.05, ne.foot[1]], [ne.p[0], 0.05, ne.p[1]], [2.0, 0.05, -1.25], [[0, 0], [-0.09, 0.06]]);
  lineTo([13.0, G + 0.05, 3.6], [PAD.x1 + SLOPE, G + 0.05, 2.0], [PAD.x1, 0.05, 2.0], [2.1, 0.05, 0.9], [[0, 0]]);
  // Support buildings at grade: [x, z, w, d, h]
  const bldgs = [
    [-11.6, -9.8, 1.1, 0.7, 0.3], // oxygen facility
    [12.6, -9.3, 1.0, 0.7, 0.28], // hydrogen facility
    [-14.5, 8.8, 2.2, 1.1, 0.42], // operations support building
    [-8.8, 14.2, 1.5, 0.9, 0.34], // compressor / converter station
    [8.6, 13.4, 0.8, 0.6, 0.22], // camera / utility building
    [15.2, 6.4, 0.9, 0.5, 0.2], // fuel area building
    [-17.5, -2.0, 1.2, 0.8, 0.26], // environmental control
  ];
  bldgs.forEach(([x, z, bw, bd, bh]) => {
    white.push(box(bw, bh, bd, x, G + bh / 2, z));
    roof.push(box(bw + 0.04, 0.025, bd + 0.04, x, G + bh + 0.012, z));
    // rooftop units
    roof.push(box(bw * 0.18, 0.05, bd * 0.22, x + bw * 0.25, G + bh + 0.05, z - bd * 0.15));
  });
  // Light towers around the pad, at grade
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.3;
    const x = 9.2 * Math.cos(a);
    const z = 9.2 * Math.sin(a);
    if (Math.abs(x) < 2.2 && z < 0) continue; // clear of the crawlerway
    steelDark.push(cyl(0.022, 0.035, 1.5, x, G + 0.75, z, 6));
    steelDark.push(box(0.26, 0.12, 0.04, x, G + 1.5, z));
    const fx = -Math.cos(a);
    const fz = -Math.sin(a);
    const lg = new THREE.BoxGeometry(0.22, 0.09, 0.012);
    lg.rotateY(Math.atan2(fx, fz));
    lg.translate(x + fx * 0.03, G + 1.5, z + fz * 0.03);
    lamp.push(lg);
  }
  out.gTank = merge(tank);
  out.gSteelDark = merge(steelDark);
  out.gSteel = merge(steel);
  out.gWhite = merge(white);
  out.gRoof = merge(roof);
  out.gLamp = merge(lamp);
  out.gPipes = merge(pipes);

  /* far facilities to the north, along the crawlerway: the assembly building and its neighbours */
  const vab = [];
  vab.push(box(7.3, 5.33, 5.3, -2.0, G + 2.665, -172));
  vab.push(box(4.4, 2.1, 4.6, -7.9, G + 1.05, -172.4)); // low bay
  vab.push(box(3.4, 0.8, 1.3, 9.2, G + 0.4, -166.6)); // control centre
  vab.push(box(2.0, 0.6, 1.6, 14.5, G + 0.3, -171)); // shops
  out.vab = merge(vab);

  /* textures and materials */
  const tex = {
    site: siteMapTexture(),
    detail: groundDetailTexture(),
    berm: bermTexture(),
    trench: trenchTexture(),
    asphalt: asphaltTexture(),
    vab: vabTexture(),
    building: buildingTexture(),
  };
  const detailed = (m, scale) => {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uDetail = { value: tex.detail };
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform sampler2D uDetail;")
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
          float dA = texture2D(uDetail, vMapUv * ${scale.toFixed(1)}).r;
          float dB = texture2D(uDetail, vMapUv * ${(scale * 0.17).toFixed(1)}).r;
          vec2 q = vMapUv * ${(scale * 1.9).toFixed(1)};
          vec2 iq = floor(q); vec2 fq = fract(q); fq = fq * fq * (3.0 - 2.0 * fq);
          float h00 = fract(sin(dot(iq, vec2(127.1, 311.7))) * 43758.5453);
          float h10 = fract(sin(dot(iq + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
          float h01 = fract(sin(dot(iq + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
          float h11 = fract(sin(dot(iq + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
          float mott = mix(mix(h00, h10, fq.x), mix(h01, h11, fq.x), fq.y);
          diffuseColor.rgb *= (0.55 + 0.9 * (dA * 0.55 + dB * 0.45)) * (0.82 + 0.36 * mott);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.08, 1.02, 0.86), smoothstep(0.55, 0.9, mott));`
        );
    };
    m.customProgramCacheKey = () => `lvSiteDetail${scale}`;
    return m;
  };
  // Ramps, retaining walls and curbs, the surf line and the crawlerway lanes: one mesh, one
  // material, their tones as vertex colours
  const tint = (g, hex) => {
    const col = new THREE.Color(hex); // set from hex: already in the linear working space
    const n = g.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3);
    g.setAttribute("color", new THREE.Float32BufferAttribute(a, 3));
    return g;
  };
  const keepColor = (g) => (g.index ? g.toNonIndexed() : g);
  out.misc = mergeGeometries(
    [
      tint(keepColor(out.ramp), "#9b978c"),
      tint(keepColor(out.retain), "#8f8b82"),
      tint(keepColor(out.surf), "#dfe6e4"),
      tint(keepColor(out.crawlerway), "#b3ab98"),
    ].map((g) => {
      ["uv1", "uv2", "tangent"].forEach((k) => g.attributes[k] && g.deleteAttribute(k));
      return g;
    }),
    false
  );
  // the trench's walls and floor, one mesh (the floor a shade darker)
  out.trench = mergeGeometries([tint(keepColor(out.trench), "#ffffff"), tint(keepColor(out.trenchFloor), "#8a857c")], false);
  ["ramp", "retain", "surf", "crawlerway", "trenchFloor"].forEach((k) => {
    out[k].dispose();
    delete out[k];
  });
  const mat = {
    land: detailed(new THREE.MeshStandardMaterial({ map: tex.site, roughness: 1, metalness: 0 }), 520),
    landFade: detailed(new THREE.MeshStandardMaterial({ map: tex.site, roughness: 1, metalness: 0, transparent: true, vertexColors: true, depthWrite: false }), 520),
    slope: new THREE.MeshStandardMaterial({ map: tex.berm, roughness: 1 }),
    misc: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
    trench: new THREE.MeshStandardMaterial({ map: tex.trench, vertexColors: true, roughness: 0.95 }),
    sea: new THREE.MeshStandardMaterial({ color: "#1f4d61", roughness: 0.16, metalness: 0.0 }),
    roads: new THREE.MeshStandardMaterial({ map: tex.asphalt, roughness: 0.9 }),
    gTank: new THREE.MeshStandardMaterial({ color: "#e4e5e2", roughness: 0.45, metalness: 0.25 }),
    gWhite: new THREE.MeshStandardMaterial({ map: tex.building, roughness: 0.8 }),
    vab: new THREE.MeshStandardMaterial({ map: tex.vab, roughness: 0.85 }),
  };
  tex.trench.repeat.set(1, 1);

  /* scrub and trees: one instanced mesh */
  const r = rng(4242);
  // 20 triangles a clump, smooth-shaded (shared vertices) so it reads as foliage, not a stone
  const clumpGeo = mergeVertices(new THREE.IcosahedronGeometry(1, 0).deleteAttribute("normal").deleteAttribute("uv"));
  {
    // lumpy, flat-bottomed
    const rj = rng(99);
    const p = clumpGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
      v.multiplyScalar(0.85 + 0.3 * rj());
      if (v.y < -0.35) v.y = -0.35;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    clumpGeo.computeVertexNormals();
  }
  // Near clumps (to 1.3 km) keep the 20-triangle shape; far ones, a few pixels across, an
  // 8-triangle one. One shared material; two draw calls.
  const farGeo = new THREE.OctahedronGeometry(1, 0).deleteAttribute("uv");
  farGeo.scale(1, 0.7, 1);
  farGeo.translate(0, -0.05, 0);
  const scrubMat = new THREE.MeshStandardMaterial({ roughness: 1 });
  const NEAR = 1000;
  const FAR = 800;
  const R_NEAR = 45;
  const near = new THREE.InstancedMesh(clumpGeo, scrubMat, NEAR);
  const far = new THREE.InstancedMesh(farGeo, scrubMat, FAR);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const c = new THREE.Color();
  const palette = ["#3d4a2c", "#4a5632", "#56603b", "#353f28", "#5d6040", "#44502f"];
  const clear = (x, z) => {
    const rr = Math.hypot(x, z);
    if (rr < 12.5) return false; // the pad's mown perimeter
    if (Math.abs(rr - ringR) < 0.6) return false;
    if (Math.abs(x) < 2.4 && z < 0) return false; // the crawlerway
    if (x > coastX(z) - 7.5) return false; // beach road, beach and sea
    if (Math.abs(z + 170) < 8 && Math.abs(x - 2) < 20) return false; // the assembly area
    if (Math.abs(x + 3.0 + ((z - 10) / 140) * 6) < 1.2 && z > 10) return false; // access road
    if (Math.abs(z) < 0.8 && x > 10) return false;
    return true;
  };
  const fill = (mesh, n, r0, r1, pw) => {
    let k = 0;
    let guard = 0;
    while (k < n && guard++ < n * 30) {
      const rr = r0 + Math.pow(r(), pw) * (r1 - r0);
      const a = r() * Math.PI * 2;
      const x = rr * Math.cos(a);
      const z = rr * Math.sin(a);
      if (!clear(x, z)) continue;
      const tree = r() < 0.18;
      const sxz = tree ? 0.1 + r() * 0.1 : 0.05 + r() * 0.08;
      const sy = tree ? 0.12 + r() * 0.14 : 0.03 + r() * 0.05;
      e.set(0, r() * Math.PI, 0);
      q.setFromEuler(e);
      m4.compose(new THREE.Vector3(x, G + sy * 0.55, z), q, new THREE.Vector3(sxz * (0.8 + r() * 0.5), sy, sxz));
      mesh.setMatrixAt(k, m4);
      mesh.setColorAt(k, c.set(palette[Math.floor(r() * palette.length)]).multiplyScalar(0.85 + r() * 0.3));
      k++;
    }
    mesh.count = k;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
  };
  fill(near, NEAR, 12.5, R_NEAR, 1.3);
  fill(far, FAR, R_NEAR, 140, 1.2);

  return { geo: out, tex, mat, scrub: [near, far] };
}

/** The hardstand's height (y) at (x, z): 0 on top, GRADE beyond the foot of its slope (approx.). */
export function groundHeight(x, z) {
  const { x0, x1, z0, z1 } = PAD;
  const dx = Math.max(x0 - x, x - x1, 0);
  const dz = Math.max(z0 - z, z - z1, 0);
  const d = Math.hypot(dx, dz);
  return d <= 0 ? 0 : d >= SLOPE ? GRADE : (d / SLOPE) * GRADE;
}
