/*
 * LUNAVIA lunar module: the shape (pure; core three.js only, unit-tested).
 *
 * A two-stage lander inspired by Apollo-era engineering, LUNAVIA's own:
 *
 * - **Ascent stage.** A faceted crew cabin (angled window facets, a slightly
 *   raked front with the hatch), side propellant pods with orange LUNAVIA
 *   bands, an aft equipment bay, four RCS quads on short booms, a docking
 *   tunnel, a rendezvous radar, a steerable S-band dish and two VHF whips.
 * - **Descent stage.** An octagonal, foil-wrapped body with equipment bays,
 *   leg outriggers, the front porch and an equipment box. Underneath sit the
 *   heat shield, the engine skirt and a real bell nozzle on its gimbal ring.
 * - **Landing gear** (built per frame by LanderModel from legFrames): a
 *   primary strut (foil sleeve, shock-absorber collar, piston), two secondary
 *   struts, a V downlock truss, a dished footpad on a ball joint, and the
 *   contact probes. The front leg carries the ladder instead of a probe.
 *
 * Everything is in model units: LanderModel's group is scaled by LM.scale in
 * the descent scene (1 unit = 4.8 m). The contact contract with the physics
 * is the one data/touchdownFx states, and the tests hold it:
 *
 * - footpad bottoms at -LM.foot / LM.scale;
 * - footpad centres LM.padRadius / LM.scale from the axis;
 * - footpad radius LM.padSize / LM.scale;
 * - nozzle exit LM.nozzle / LM.scale above the footpad plane;
 * - nothing higher than LM.height / LM.scale above the footpads.
 *
 * Static parts are merged into one geometry per material (a handful of draw
 * calls for the whole vehicle).
 */
import * as THREE from "three";
import { LM, PROBE_LENGTH } from "./touchdownFx";

const S = LM.scale;
export const GROUND = -LM.foot / S; // footpad bottoms
export const PAD_R = LM.padRadius / S; // footpad centres from the axis
export const PAD_SIZE = LM.padSize / S; // footpad radius
export const PAD_H = 0.042; // footpad height (to the top of its dish)
export const EXIT_Y = GROUND + LM.nozzle / S; // nozzle exit plane
export const EXIT_R = 0.11; // nozzle exit radius (1.06 m)
export const TOP = GROUND + LM.height / S; // highest point allowed (antenna tips)
export const PROBE_L = PROBE_LENGTH / S;

// Descent stage: an octagon, long faces on the leg axes.
const DS = { a: 0.43, c: 0.14, y0: 0.0, y1: 0.34 };
// Ascent stage base.
const AS_Y = 0.375;

/** Materials the shape is split into (LanderModel gives each its look). */
export const PARTS = ["paint", "paintDark", "foilGold", "foilDark", "metal", "engine", "engineInner", "glass", "black", "accent"];

/* ---- small builders --------------------------------------------------------------- */
function octagon(a, c) {
  return [
    [a, a - c],
    [a - c, a],
    [-(a - c), a],
    [-a, a - c],
    [-a, -(a - c)],
    [-(a - c), -a],
    [a - c, -a],
    [a, -(a - c)],
  ];
}

/** A vertical prism of an XZ polygon from y0 to y1. */
function prism(points, y0, y1) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

const box = (w, h, d, x, y, z, rx = 0, ry = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  return g.translate(x, y, z);
};

/** A box on the +Z face at (x, y, z), then turned about the vertical axis by rotY. */
const faceBox = (w, h, d, x, y, z, rotY) => new THREE.BoxGeometry(w, h, d).translate(x, y, z).rotateY(rotY);

/** A cylinder of radius r between points a and b (arrays or Vector3). */
function rod(a, b, r, seg = 8) {
  const A = new THREE.Vector3(...(Array.isArray(a) ? a : a.toArray()));
  const B = new THREE.Vector3(...(Array.isArray(b) ? b : b.toArray()));
  const d = new THREE.Vector3().subVectors(B, A);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  return g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
}

/** An open bell / dish from a lathe profile [[r, y], ...]. */
const lathe = (profile, seg = 24) => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);

/** A shallow parabolic dish of radius r and depth h, its axis along `axis`, rim centre at c. */
function dish(r, h, c, axis, seg = 18) {
  const pts = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    pts.push([Math.max(0.002, r * t), h * t * t]);
  }
  const g = lathe(pts, seg);
  g.translate(0, -h, 0); // rim at the origin, the dish's back below it
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...axis).normalize()));
  return g.translate(...c);
}

/** A repeatable hash of a grid point, 0..1. */
function hash2(i, j, seed) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/**
 * A thermal blanket over a flat vertical face from p0 to p1 ([x, z]) between heights y0 and y1:
 * puffed outward (away from the vehicle's axis) by up to `amp` between its edges, and crinkled.
 * Its edges stay on the face, so neighbouring blankets meet. UVs in model units (the foil repeats).
 */
function pillow(p0, p1, y0, y1, { nu = 12, nv = 8, amp = 0.005, crinkle = 0.0016, seed = 1, uv0 = 0 } = {}) {
  const dx = p1[0] - p0[0];
  const dz = p1[1] - p0[1];
  const w = Math.hypot(dx, dz);
  let nx = dz / w;
  let nz = -dx / w;
  if (nx * (p0[0] + p1[0]) + nz * (p0[1] + p1[1]) < 0) {
    nx = -nx;
    nz = -nz;
  }
  const pos = [];
  const uv = [];
  const idx = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const v = j / nv;
      const env = Math.pow(Math.sin(Math.PI * u), 0.7) * Math.pow(Math.sin(Math.PI * v), 0.7);
      const n = env * (amp + crinkle * (hash2(i, j, seed) * 2 - 1));
      pos.push(p0[0] + dx * u + nx * n, y0 + (y1 - y0) * v, p0[1] + dz * u + nz * n);
      uv.push(uv0 + w * u, y0 + (y1 - y0) * v);
    }
  }
  // wind the quads to face outward: (along the face) × (up) points one way or the other
  const flip = -dz * nx + dx * nz < 0;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const q = j * (nu + 1) + i;
      const [A, B, C, D] = [q, q + 1, q + nu + 1, q + nu + 2];
      if (flip) idx.push(A, D, B, A, C, D);
      else idx.push(A, B, D, A, D, C);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Merge geometries into one non-indexed geometry with position, normal and uv. */
export function merge(list) {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  parts.forEach((g) => (n += g.attributes.position.count));
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  let o = 0;
  parts.forEach((g) => {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, c * 3), o * 3);
    nor.set(g.attributes.normal.array.subarray(0, c * 3), o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array.subarray(0, c * 2), o * 2);
    o += c;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/* ---- the ascent stage's window facet -------------------------------------------- */
// The upper front facet runs from (z 0.22, y 0.76) back up to (z 0.10, y 0.84).
const SLOPE = { c: [0, 0.8, 0.16], v: [0, 0.555, -0.832], n: [0, 0.832, 0.555] };
function onSlope(tri, lift, grow = 1) {
  const cu = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
  const cv = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
  const p = tri.map(([u, v]) => {
    const uu = cu + (u - cu) * grow;
    const vv = cv + (v - cv) * grow;
    return [
      SLOPE.c[0] + uu + SLOPE.n[0] * lift,
      SLOPE.c[1] + vv * SLOPE.v[1] + SLOPE.n[1] * lift,
      SLOPE.c[2] + vv * SLOPE.v[2] + SLOPE.n[2] * lift,
    ];
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p.flat(), 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute([...SLOPE.n, ...SLOPE.n, ...SLOPE.n], 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  return g;
}
const WINDOWS = [
  [
    [-0.035, -0.04],
    [-0.035, 0.045],
    [-0.21, -0.04],
  ],
  [
    [0.035, -0.04],
    [0.21, -0.04],
    [0.035, 0.045],
  ],
];

/* ---- the porch handrails (model units; the EVA's hands hold them, data/evaSim) ---------- */
export const PORCH_RAILS = [-0.1, 0.1].map((x) => ({
  x,
  front: [x, DS.y1, DS.a + 0.1], // the post at the porch's outer corner
  top: [x, 0.55, DS.a + 0.085], // the rail's front end, about 1 m above the porch
  back: [x, 0.55, 0.37], // the rail's back end, above the deck in front of the hatch
  deck: [x, DS.y1 + 0.016, 0.37], // the rear post's foot on the deck
}));

/* ---- the static vehicle ------------------------------------------------------------ */
// The ascent engine (under the cabin, inside the interstage while the stages are joined).
export const ASC_ENGINE = { top: AS_Y, exitY: AS_Y - 0.085, throatR: 0.03, exitR: 0.062 };

/** The parts of both stages, per material: { descent, ascent } (lists of geometries). */
function collect({ close = false } = {}) {
  const PD = Object.fromEntries(PARTS.map((k) => [k, []]));
  const PA = Object.fromEntries(PARTS.map((k) => [k, []]));
  let P = PD; // everything up to the interstage belongs to the descent stage
  const { a, c, y0, y1 } = DS;

  // Descent stage: foil body, silver top deck, black heat shield and engine skirt. At close range
  // the blanket on each of the eight faces puffs out between its edges and crinkles, and bare
  // metal trims the corners and the bottom edge.
  if (close) {
    const oct = octagon(a, c);
    let run = 0;
    oct.forEach((p0, i) => {
      const p1 = oct[(i + 1) % 8];
      const w = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      P.foilGold.push(pillow(p0, p1, y0 + 0.02, y1, { nu: w > 0.4 ? 14 : 6, nv: 8, amp: 0.0045, crinkle: 0.0016, seed: 11 + i, uv0: run }));
      run += w;
    });
    oct.forEach(([x, z]) => P.metal.push(box(0.014, y1 - y0 - 0.03, 0.014, x * 1.006, (y0 + y1) / 2 + 0.005, z * 1.006, 0, Math.atan2(x, z))));
    P.metal.push(prism(octagon(a + 0.004, c), y0 + 0.019, y0 + 0.03)); // bottom band
  } else P.foilGold.push(prism(octagon(a, c), y0 + 0.02, y1));
  P.metal.push(prism(octagon(a + 0.006, c), y1 - 0.022, y1 + 0.006)); // top rim band
  P.metal.push(prism(octagon(a - 0.02, c - 0.01), y1, y1 + 0.016)); // deck
  P.foilDark.push(prism(octagon(a - 0.008, c - 0.004), y0, y0 + 0.022)); // heat shield
  P.foilDark.push(new THREE.CylinderGeometry(0.3, 0.17, 0.05, 8, 1, true).rotateY(Math.PI / 8).translate(0, y0 - 0.024, 0));
  P.foilDark.push(new THREE.RingGeometry(0.075, 0.17, 8).rotateX(Math.PI / 2).rotateY(Math.PI / 8).translate(0, y0 - 0.049, 0));

  // Equipment bays on the four long faces: dark foil on the sides, gold-framed fore and aft.
  const bay = (w, h, rot, mat, y = 0.17) => {
    P[mat].push(faceBox(w, h, 0.014, 0, y, a + 0.006, rot));
    // close range: the bay's blanket bulges between its frame
    if (close) P[mat].push(pillow([-w / 2 + 0.004, a + 0.0132], [w / 2 - 0.004, a + 0.0132], y - h / 2 + 0.004, y + h / 2 - 0.004, { nu: 14, nv: 7, amp: 0.005, crinkle: 0.0018, seed: 31 + Math.round(rot * 10) }).rotateY(rot));
  };
  bay(0.5, 0.2, 0, "foilGold", 0.16); // front (+Z), under the porch
  bay(0.5, 0.22, Math.PI, "foilGold"); // aft
  bay(0.5, 0.22, Math.PI / 2, "foilDark"); // +X side
  bay(0.5, 0.22, -Math.PI / 2, "foilDark"); // -X side
  // Panel ribs across each bay: the foil reads as stretched over a frame.
  [0, Math.PI / 2, Math.PI, -Math.PI / 2].forEach((rot) => {
    [-0.13, 0.13].forEach((s) => P.metal.push(faceBox(0.012, 0.25, 0.01, s, 0.17, a + 0.016, rot)));
    P.metal.push(faceBox(0.56, 0.012, 0.01, 0, 0.055, a + 0.016, rot));
  });
  // Leg outriggers: the fittings the primary struts hang from.
  LM.legAngles.forEach((deg) => {
    const r = -(deg * Math.PI) / 180 + Math.PI / 2; // rotation that turns +Z onto the leg axis
    P.metal.push(faceBox(0.1, 0.08, 0.08, 0, 0.3, a + 0.03, r));
    P.black.push(faceBox(0.06, 0.05, 0.03, 0, 0.3, a + 0.075, r));
  });
  // Front porch and its handrails, and the equipment box beside the ladder. The rails run along
  // both sides of the porch at about waist height (the front stays open onto the ladder): a front
  // post at the porch's outer corner, the rail back towards the hatch and a post down to the deck.
  P.metal.push(box(0.2, 0.014, 0.11, 0, y1 - 0.004, a + 0.055));
  PORCH_RAILS.forEach(({ front, top, back, deck }) => {
    P.metal.push(rod(front, top, 0.005, 6));
    P.metal.push(rod(top, back, 0.005, 6));
    P.metal.push(rod(back, deck, 0.005, 6));
  });
  P.metal.push(box(0.15, 0.11, 0.045, -0.24, 0.13, a + 0.024));
  P.black.push(box(0.13, 0.008, 0.047, -0.24, 0.16, a + 0.025));

  // Descent engine: gimbal ring, combustion chamber and a bell nozzle.
  P.engine.push(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 16).translate(0, -0.005, 0));
  P.engine.push(new THREE.TorusGeometry(0.066, 0.008, 6, 20).rotateX(Math.PI / 2).translate(0, -0.012, 0));
  const throat = { r: 0.045, y: -0.03 };
  const bell = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    bell.push([throat.r + (EXIT_R - throat.r) * (1 - Math.pow(1 - t, 2.2)), throat.y + (EXIT_Y - throat.y) * t]);
  }
  const bs = close ? 44 : 28;
  P.engine.push(lathe(bell, bs));
  P.engineInner.push(lathe(bell.map(([r, y]) => [r * 0.965, y + 0.002]), bs));
  P.engine.push(new THREE.TorusGeometry(EXIT_R, 0.006, 6, bs).rotateX(Math.PI / 2).translate(0, EXIT_Y + 0.003, 0));

  // The interstage (the descent stage's top fittings), then the ascent stage: faceted cabin with bevelled edges.
  P.black.push(prism(octagon(0.31, 0.1), y1 + 0.016, AS_Y + 0.006));
  P = PA;
  const profile = [
    [-0.24, AS_Y],
    [0.2, AS_Y],
    [0.27, 0.46],
    [0.29, 0.62],
    [0.22, 0.76],
    [0.1, 0.84],
    [-0.18, 0.84],
    [-0.24, 0.78],
  ];
  const cabin = new THREE.ExtrudeGeometry(new THREE.Shape(profile.map(([z, y]) => new THREE.Vector2(z, y))), {
    depth: 0.6,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelOffset: -0.012, // the walls stay on the profile; only the edges are cut
    bevelSegments: 1,
    curveSegments: 1,
  });
  cabin.rotateY(-Math.PI / 2).translate(0.3, 0, 0); // profile in the ZY plane, extruded across X
  P.paint.push(cabin);
  // Front hatch on the raked lower face, and its frame.
  P.paintDark.push(box(0.17, 0.15, 0.012, 0, 0.545, 0.288, 0.124));
  P.black.push(box(0.19, 0.17, 0.008, 0, 0.545, 0.284, 0.124));
  // The window facet is a dark anodised panel: the windows sit in it, the craft gets a face.
  P.paintDark.push(
    onSlope(
      [
        [-0.285, -0.066],
        [0.285, -0.066],
        [0.285, 0.066],
      ],
      0.002
    ),
    onSlope(
      [
        [-0.285, -0.066],
        [0.285, 0.066],
        [-0.285, 0.066],
      ],
      0.002
    )
  );
  // Darker panels on both sides of the cabin, above the pods.
  [-1, 1].forEach((s) => P.paintDark.push(box(0.008, 0.15, 0.3, s * 0.316, 0.71, -0.05)));
  // Windows on the upper facet: dark glass in black frames.
  WINDOWS.forEach((tri) => {
    P.black.push(onSlope(tri, 0.004, 1.3));
    P.glass.push(onSlope(tri, 0.008));
  });
  // Side propellant pods with orange LUNAVIA bands.
  [-1, 1].forEach((s) => {
    P.paint.push(new THREE.CapsuleGeometry(0.095, 0.2, close ? 8 : 4, close ? 28 : 14).rotateX(Math.PI / 2).translate(s * 0.36, 0.5, -0.05));
    P.accent.push(new THREE.CylinderGeometry(0.098, 0.098, 0.022, close ? 28 : 14, 1, true).rotateX(Math.PI / 2).translate(s * 0.36, 0.5, 0.03));
    P.black.push(box(0.05, 0.03, 0.2, s * 0.315, 0.5, -0.05)); // saddle to the cabin
  });
  // Aft equipment bay, with radiator ribs.
  P.paintDark.push(box(0.46, 0.27, 0.15, 0, 0.53, -0.31));
  [-0.15, -0.05, 0.05, 0.15].forEach((x) => P.metal.push(box(0.012, 0.25, 0.012, x, 0.53, -0.39)));
  // Docking tunnel and drogue ring on top.
  P.metal.push(new THREE.CylinderGeometry(0.09, 0.095, 0.07, close ? 32 : 18).translate(0, 0.87, -0.03));
  P.black.push(new THREE.TorusGeometry(0.088, 0.01, 6, close ? 32 : 18).rotateX(Math.PI / 2).translate(0, 0.905, -0.03));
  // Rendezvous radar (front right) and steerable S-band dish (aft left) on booms; two VHF whips.
  P.metal.push(rod([0.16, 0.84, 0.05], [0.18, 0.9, 0.07], 0.008, 6));
  P.metal.push(dish(0.055, 0.02, [0.18, 0.905, 0.075], [0.15, 0.7, 0.7], close ? 28 : 18));
  P.metal.push(rod([-0.22, 0.84, -0.12], [-0.29, 0.97, -0.17], 0.007, 6));
  P.metal.push(dish(0.068, 0.024, [-0.29, 0.98, -0.17], [-0.3, 1, -0.2], close ? 28 : 18));
  P.metal.push(rod([0.22, 0.84, -0.2], [0.26, TOP - 0.012, -0.23], 0.004, 5));
  P.metal.push(rod([-0.08, 0.84, -0.22], [-0.1, 1.04, -0.26], 0.004, 5));
  // RCS quads: a housing on a boom at each corner, four thrusters (up, down, outboard, fore or aft).
  [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ].forEach(([sx, sz]) => {
    const q = [sx * 0.41, 0.7, sz > 0 ? 0.17 : -0.21];
    P.paintDark.push(box(0.1, 0.022, 0.026, sx * 0.355, q[1], q[2]));
    P.paintDark.push(box(0.05, 0.065, 0.055, ...q));
    const nozzle = (dir, off) => {
      const g = new THREE.CylinderGeometry(0.007, 0.013, 0.03, 10, 1, true);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(...dir)));
      P.engine.push(g.translate(q[0] + dir[0] * off, q[1] + dir[1] * off, q[2] + dir[2] * off));
    };
    nozzle([0, 1, 0], 0.045);
    nozzle([0, -1, 0], 0.045);
    nozzle([sx, 0, 0], 0.04);
    nozzle([0, 0, sz], 0.042);
  });

  return { descent: PD, ascent: PA };
}

/**
 * The whole lunar module, stages joined: one merged geometry per material. `close` builds the
 * close-range body (the EVA): the same shape, with puffed and crinkled foil blankets and metal
 * corner trims (buildCloseDetail adds the hardware).
 */
export function buildBody({ close = false } = {}) {
  const { descent, ascent } = collect({ close });
  return Object.fromEntries(
    PARTS.map((k) => {
      const g = merge(descent[k].concat(ascent[k]));
      // close range: paint and foil textures at one scale everywhere (UVs in model units)
      if (close && ["paint", "paintDark", "foilGold", "foilDark"].includes(k)) boxUV(g);
      return [k, g];
    })
  );
}

/** UVs projected onto each triangle's main plane, in model units (a non-indexed geometry). */
function boxUV(g) {
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const C = new THREE.Vector3();
  for (let t = 0; t + 2 < p.count; t += 3) {
    A.fromBufferAttribute(p, t);
    B.fromBufferAttribute(p, t + 1);
    C.fromBufferAttribute(p, t + 2);
    const f = B.clone().sub(A).cross(C.clone().sub(A));
    const ax = Math.abs(f.x);
    const ay = Math.abs(f.y);
    const az = Math.abs(f.z);
    for (let k = 0; k < 3; k++) {
      const x = p.getX(t + k);
      const y = p.getY(t + k);
      const z = p.getZ(t + k);
      if (ax >= ay && ax >= az) uv.setXY(t + k, z, y);
      else if (ay >= az) uv.setXY(t + k, x, z);
      else uv.setXY(t + k, x, y);
    }
  }
}

/**
 * The two stages apart (lunar liftoff): { descent, ascent }, each one merged
 * geometry per material (materials a stage does not use are left out). The
 * ascent stage adds its own engine under the cabin, hidden by the interstage
 * while the stages are joined. Same model units and origin as buildBody.
 */
export function buildStages() {
  const { descent, ascent } = collect();
  const bell = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    bell.push([ASC_ENGINE.throatR + (ASC_ENGINE.exitR - ASC_ENGINE.throatR) * (1 - Math.pow(1 - t, 2)), ASC_ENGINE.top - 0.012 - (ASC_ENGINE.top - 0.012 - ASC_ENGINE.exitY) * t]);
  }
  ascent.engine.push(lathe(bell, 20).translate(0, 0, -0.03));
  ascent.engineInner.push(lathe(bell.map(([r, y]) => [r * 0.94, y + 0.002]), 20).translate(0, 0, -0.03));
  ascent.engine.push(new THREE.CylinderGeometry(0.05, 0.05, 0.014, 16).translate(0, ASC_ENGINE.top - 0.007, -0.03));
  const pack = (P) => Object.fromEntries(PARTS.filter((k) => P[k].length).map((k) => [k, merge(P[k])]));
  return { descent: pack(descent), ascent: pack(ascent) };
}

/**
 * The RCS thrusters the body above draws, model units: { pos, dir, roll }.
 * dir is where the exhaust goes; roll is +1 / -1 for the fore-aft thrusters that
 * turn the LM about its vertical axis (+1: counter-clockwise seen from above), else 0.
 */
export const RCS_THRUSTERS = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
].flatMap(([sx, sz]) => {
  const q = [sx * 0.41, 0.7, sz > 0 ? 0.17 : -0.21];
  const at = (dir, off) => ({ pos: [q[0] + dir[0] * off, q[1] + dir[1] * off, q[2] + dir[2] * off], dir });
  return [
    { ...at([0, 1, 0], 0.06), roll: 0 },
    { ...at([0, -1, 0], 0.06), roll: 0 },
    { ...at([sx, 0, 0], 0.055), roll: 0 },
    { ...at([0, 0, sz], 0.057), roll: sx * sz },
  ];
});

/* ---- landing gear ---------------------------------------------------------------------- */
const UPPER ={ r: 0.47, y: 0.3 }; // primary strut top, at the outrigger
const SEC = { r: 0.44, y: 0.05, side: 0.17 }; // secondary struts at the descent stage's lower corners
const LOCK = { r: 0.44, y: 0.2, side: 0.11, at: 0.38 }; // downlock V: body points, and how far down the sleeve it meets
export const SLEEVE = 0.55; // share of the primary strut that is the (fixed) sleeve

/** Rest geometry of each leg, model units. */
export function legFrames() {
  return LM.legAngles.map((deg, i) => {
    const t = (deg * Math.PI) / 180;
    const dir = new THREE.Vector3(Math.cos(t), 0, Math.sin(t));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const at = (r, y, s = 0) => new THREE.Vector3(dir.x * r + side.x * s, y, dir.z * r + side.z * s);
    const upper = at(UPPER.r, UPPER.y);
    const padTop = at(PAD_R, GROUND + PAD_H);
    const axis = new THREE.Vector3().subVectors(upper, padTop).normalize();
    const len = upper.distanceTo(padTop);
    return {
      dir,
      side,
      upper,
      padTop,
      axis,
      len,
      sec: [at(SEC.r, SEC.y, SEC.side), at(SEC.r, SEC.y, -SEC.side)],
      lock: [at(LOCK.r, LOCK.y, LOCK.side), at(LOCK.r, LOCK.y, -LOCK.side)],
      lockAt: upper.clone().addScaledVector(axis, -len * LOCK.at),
      probe: LM.probes[i],
      ladder: i === 1,
    };
  });
}

/**
 * The footpad: a dished pad with a rolled rim and the ball joint the strut sits in. Origin at its
 * bottom centre. `close` (the EVA): a finer dish, the rolled lip, radial stiffeners across its top
 * and the socket round the ball.
 */
const PAD_TOP = [
  [0, PAD_H - 0.004],
  [0.05, PAD_H - 0.006],
  [0.094, PAD_H - 0.014],
  [PAD_SIZE, 0.018],
];
export function buildPad({ close = false } = {}) {
  const pad = lathe([...PAD_TOP, [PAD_SIZE - 0.002, 0.006], [PAD_SIZE - 0.016, 0], [0, 0]], close ? 40 : 22);
  const ball = new THREE.SphereGeometry(0.02, close ? 14 : 10, close ? 8 : 6).translate(0, PAD_H + 0.008, 0);
  if (!close) return merge([pad, ball]);
  const parts = [pad, ball];
  parts.push(new THREE.TorusGeometry(PAD_SIZE - 0.004, 0.0055, 6, 40).rotateX(Math.PI / 2).translate(0, 0.013, 0));
  parts.push(new THREE.CylinderGeometry(0.025, 0.03, 0.016, 16).translate(0, PAD_H + 0.002, 0));
  const topAt = (r) => {
    for (let i = 1; i < PAD_TOP.length; i++) {
      const [r0, y0] = PAD_TOP[i - 1];
      const [r1, y1] = PAD_TOP[i];
      if (r <= r1) return y0 + ((y1 - y0) * (r - r0)) / (r1 - r0);
    }
    return PAD_TOP[PAD_TOP.length - 1][1];
  };
  for (let k = 0; k < 8; k++) {
    const r0 = 0.032;
    const r1 = PAD_SIZE - 0.012;
    const yA = topAt(r0);
    const yB = topAt(r1);
    const len = Math.hypot(r1 - r0, yB - yA);
    const rib = new THREE.BoxGeometry(0.005, 0.005, len)
      .rotateX(Math.atan2(yA - yB, r1 - r0))
      .translate(0, (yA + yB) / 2 + 0.002, (r0 + r1) / 2)
      .rotateY((k * Math.PI) / 4 + Math.PI / 8);
    parts.push(rib);
  }
  return merge(parts);
}

/**
 * The ladder on the front leg's sleeve (model units): its two rails and seven rungs as [a, b]
 * pairs of Vector3. It hangs on the sleeve, so it does not move with the piston; data/evaSim puts
 * the boots on these rungs and the gloves on these rails.
 */
export function ladderParts() {
  const L = legFrames().find((l) => l.ladder);
  const off = (s) => L.side.clone().multiplyScalar(s).addScaledVector(L.dir, 0.035);
  const top = L.upper.clone().addScaledVector(L.axis, -0.05);
  const bottom = L.padTop.clone().addScaledVector(L.axis, 0.14);
  const rails = [-1, 1].map((s) => [top.clone().add(off(s * 0.045)), bottom.clone().add(off(s * 0.045))]);
  const rungs = [];
  for (let i = 1; i <= 7; i++) {
    const c = top.clone().lerp(bottom, i / 8);
    rungs.push([c.clone().add(off(-0.045)), c.clone().add(off(0.045))]);
  }
  return { rails, rungs, leg: L };
}

/* ---- close range (the EVA): the hardware a camera a few metres away reads ---------------------- */
/** Where the LM's decals sit in their atlas (LanderModel draws it): [x, y, w, h] px of 512 × 256. */
export const LM_DECALS = {
  plaque: [0, 0, 256, 168],
  mesa: [264, 0, 248, 56],
  wordmark: [264, 64, 248, 56],
  emblem: [264, 128, 128, 128],
};
const decalPlane = (w, h, [x, y, pw, ph]) => {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (x + uv.getX(i) * pw) / 512, 1 - (y + (1 - uv.getY(i)) * ph) / 256);
  return g;
};
/** A box `w` across (along `side`), `len` long from a to b, `d` deep (along side × the run). */
function beam(a, b, w, d, side) {
  const Y = new THREE.Vector3().subVectors(b, a);
  const len = Y.length();
  Y.normalize();
  const X = side.clone().addScaledVector(Y, -side.dot(Y)).normalize();
  const Z = new THREE.Vector3().crossVectors(X, Y);
  const g = new THREE.BoxGeometry(w, len, d);
  g.applyMatrix4(new THREE.Matrix4().makeBasis(X, Y, Z));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}
/** A cylinder of radius r and height h centred at c, its axis along n. */
function disc(r, h, c, n, seg = 14) {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.clone().normalize()));
  return g.translate(c.x, c.y, c.z);
}

/**
 * The close-range hardware, merged per material ({ metal, black, paintDark, decal }): the ladder's
 * channel rails and flat treads (on the very rungs evaSim climbs), the strut sleeves' bands, end
 * fittings and cable runs, the porch's anti-slip strips and lip, the equipment box's handle,
 * latches, hinge and stencil, side equipment boxes, the commemorative plaque on the ladder strut,
 * the antenna feeds, and the LUNAVIA marks. Static: none of it moves with the struts' pistons.
 */
export function buildCloseDetail() {
  const P = { metal: [], black: [], paintDark: [], decal: [] };
  const { a, y1 } = DS;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const legs = legFrames();
  // the ladder: channel rails and flat treads with a grip strip, on the same rungs
  const { rails, rungs, leg: LL } = ladderParts();
  const up = V(0, 1, 0);
  rails.forEach(([p, q]) => {
    P.metal.push(beam(p, q, 0.009, 0.02, LL.side));
    P.metal.push(beam(p.clone().addScaledVector(LL.dir, 0.009), q.clone().addScaledVector(LL.dir, 0.009), 0.016, 0.003, LL.side));
  });
  rungs.forEach(([p, q]) => {
    const cdir = LL.dir.clone().setY(0).normalize();
    const m = p.clone().lerp(q, 0.5);
    const tread = new THREE.BoxGeometry(0.098, 0.007, 0.026);
    tread.applyMatrix4(new THREE.Matrix4().makeBasis(LL.side.clone().normalize(), up, new THREE.Vector3().crossVectors(LL.side.clone().normalize(), up)));
    P.metal.push(tread.translate(m.x, m.y, m.z));
    const grip = new THREE.BoxGeometry(0.088, 0.0015, 0.016);
    grip.applyMatrix4(new THREE.Matrix4().makeBasis(LL.side.clone().normalize(), up, new THREE.Vector3().crossVectors(LL.side.clone().normalize(), up)));
    P.black.push(grip.translate(m.x + cdir.x * 0.001, m.y + 0.0042, m.z + cdir.z * 0.001));
  });
  // the struts: tape bands round the foil sleeve, the fitting at the outrigger, the collar's bolt
  // rings, a cable run down the back of the sleeve, the secondary struts' end fittings
  legs.forEach((L) => {
    const at = (t) => L.upper.clone().addScaledVector(L.axis, -L.len * t);
    [0.1, 0.25, 0.4].forEach((t) => P.black.push(disc(0.0362, 0.007, at(t), L.axis, 16)));
    P.metal.push(disc(0.04, 0.03, at(0.01), L.axis, 16));
    const collar = at(SLEEVE);
    P.metal.push(new THREE.TorusGeometry(0.044, 0.0035, 5, 18).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), L.axis)).translate(collar.x + L.axis.x * 0.012, collar.y + L.axis.y * 0.012, collar.z + L.axis.z * 0.012));
    const back = L.dir.clone().multiplyScalar(-0.036).addScaledVector(L.side, 0.016);
    const c0 = at(0.03).add(back);
    const c1 = at(SLEEVE - 0.02).add(back);
    P.black.push(beam(c0, c1, 0.006, 0.006, L.side));
    L.sec.forEach((s) => P.metal.push(new THREE.SphereGeometry(0.017, 10, 6).translate(s.x, s.y, s.z)));
  });
  // the porch: anti-slip strips across its deck, a lip at its edge
  for (let k = 0; k < 5; k++) P.black.push(box(0.18, 0.002, 0.009, 0, y1 + 0.0035, a + 0.012 + k * 0.021));
  P.metal.push(box(0.2, 0.018, 0.005, 0, y1 - 0.004, a + 0.11));
  // the equipment box beside the ladder: handle, latches, hinge, stencil
  const mz = a + 0.0465;
  P.metal.push(box(0.064, 0.006, 0.006, -0.24, 0.172, mz + 0.012));
  [-1, 1].forEach((s) => P.metal.push(box(0.006, 0.006, 0.014, -0.24 + s * 0.029, 0.172, mz + 0.006)));
  [-1, 1].forEach((s) => P.black.push(box(0.012, 0.016, 0.006, -0.24 + s * 0.055, 0.1, mz + 0.003)));
  P.metal.push(new THREE.CylinderGeometry(0.004, 0.004, 0.14, 8).rotateZ(Math.PI / 2).translate(-0.24, 0.077, mz));
  P.decal.push(decalPlane(0.11, 0.025, LM_DECALS.mesa).translate(-0.24, 0.13, mz + 0.0012));
  // equipment boxes on the side and aft bays, strapped down
  [
    [Math.PI / 2, -0.07, 0.09],
    [-Math.PI / 2, 0.07, 0.1],
    [Math.PI, -0.06, 0.1],
  ].forEach(([rot, s, y]) => {
    P.paintDark.push(faceBox(0.14, 0.07, 0.034, s, y, a + 0.03, rot));
    [-0.045, 0.045].forEach((o) => P.metal.push(faceBox(0.008, 0.074, 0.036, s + o, y, a + 0.031, rot)));
  });
  // the plaque on the ladder strut, between the second and third rungs, facing out
  {
    // a right-handed frame on the strut: X across it, Y up it, Z out of it (towards the ladder)
    const Y = LL.axis.clone();
    let X = LL.side.clone().normalize();
    let Z = new THREE.Vector3().crossVectors(X, Y).normalize();
    if (Z.dot(LL.dir) < 0) {
      X = X.negate();
      Z = new THREE.Vector3().crossVectors(X, Y).normalize();
    }
    const basis = new THREE.Matrix4().makeBasis(X, Y, Z);
    const onAxis = rungs[1][0].clone().lerp(rungs[2][1], 0.5).addScaledVector(LL.dir, -0.035);
    const m = onAxis.addScaledVector(Z, 0.0375);
    P.metal.push(new THREE.BoxGeometry(0.054, 0.04, 0.003).applyMatrix4(basis).translate(m.x, m.y, m.z));
    P.decal.push(decalPlane(0.05, 0.036, LM_DECALS.plaque).applyMatrix4(basis).translate(m.x + Z.x * 0.0018, m.y + Z.y * 0.0018, m.z + Z.z * 0.0018));
  }
  // the antenna feeds: a horn on a mast from each dish's centre, held by three thin struts
  [
    [0.055, [0.18, 0.905, 0.075], [0.15, 0.7, 0.7]],
    [0.068, [-0.29, 0.98, -0.17], [-0.3, 1, -0.2]],
  ].forEach(([r, c, ax]) => {
    const n = V(...ax).normalize();
    const C = V(...c);
    const tip = C.clone().addScaledVector(n, r * 0.62);
    P.metal.push(beam(C.clone().addScaledVector(n, -r * 0.3), tip, 0.004, 0.004, n.clone().cross(V(0, 0, 1)).normalize()));
    P.black.push(disc(0.008, 0.012, tip, n, 10));
    const u = new THREE.Vector3().crossVectors(n, V(0, 1, 0.3)).normalize();
    const w = new THREE.Vector3().crossVectors(n, u);
    for (let k = 0; k < 3; k++) {
      const ang = (k * Math.PI * 2) / 3;
      const rim = C.clone().addScaledVector(u, Math.cos(ang) * r * 0.92).addScaledVector(w, Math.sin(ang) * r * 0.92);
      P.metal.push(beam(rim, tip, 0.002, 0.002, n));
    }
  });
  // the VHF whips' base insulators
  [
    [0.22, 0.84, -0.2],
    [-0.08, 0.84, -0.22],
  ].forEach(([x, y, z]) => P.black.push(new THREE.CylinderGeometry(0.009, 0.011, 0.018, 10).translate(x, y + 0.009, z)));
  // the LUNAVIA marks: the wordmark on the cabin's front beside the hatch, the emblem on the
  // descent stage's front bay
  P.decal.push(decalPlane(0.15, 0.034, LM_DECALS.wordmark).rotateX(0.124).translate(0.207, 0.505, 0.2795));
  P.decal.push(decalPlane(0.07, 0.07, LM_DECALS.emblem).translate(0.19, 0.18, a + 0.0205));
  return Object.fromEntries(Object.entries(P).map(([k, list]) => [k, merge(list)]));
}
