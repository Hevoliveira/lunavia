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

/* ---- the static vehicle ------------------------------------------------------------ */
// The ascent engine (under the cabin, inside the interstage while the stages are joined).
export const ASC_ENGINE = { top: AS_Y, exitY: AS_Y - 0.085, throatR: 0.03, exitR: 0.062 };

/** The parts of both stages, per material: { descent, ascent } (lists of geometries). */
function collect() {
  const PD = Object.fromEntries(PARTS.map((k) => [k, []]));
  const PA = Object.fromEntries(PARTS.map((k) => [k, []]));
  let P = PD; // everything up to the interstage belongs to the descent stage
  const { a, c, y0, y1 } = DS;

  // Descent stage: foil body, silver top deck, black heat shield and engine skirt.
  P.foilGold.push(prism(octagon(a, c), y0 + 0.02, y1));
  P.metal.push(prism(octagon(a + 0.006, c), y1 - 0.022, y1 + 0.006)); // top rim band
  P.metal.push(prism(octagon(a - 0.02, c - 0.01), y1, y1 + 0.016)); // deck
  P.foilDark.push(prism(octagon(a - 0.008, c - 0.004), y0, y0 + 0.022)); // heat shield
  P.foilDark.push(new THREE.CylinderGeometry(0.3, 0.17, 0.05, 8, 1, true).rotateY(Math.PI / 8).translate(0, y0 - 0.024, 0));
  P.foilDark.push(new THREE.RingGeometry(0.075, 0.17, 8).rotateX(Math.PI / 2).rotateY(Math.PI / 8).translate(0, y0 - 0.049, 0));

  // Equipment bays on the four long faces: dark foil on the sides, gold-framed fore and aft.
  const bay = (w, h, rot, mat, y = 0.17) => P[mat].push(faceBox(w, h, 0.014, 0, y, a + 0.006, rot));
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
  // Front porch and its handrails, and the equipment box beside the ladder.
  P.metal.push(box(0.2, 0.014, 0.11, 0, y1 - 0.004, a + 0.055));
  P.metal.push(rod([-0.095, y1, a + 0.1], [-0.095, y1 + 0.09, a + 0.07], 0.005, 6));
  P.metal.push(rod([0.095, y1, a + 0.1], [0.095, y1 + 0.09, a + 0.07], 0.005, 6));
  P.metal.push(rod([-0.095, y1 + 0.09, a + 0.07], [0.095, y1 + 0.09, a + 0.07], 0.005, 6));
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
  P.engine.push(lathe(bell, 28));
  P.engineInner.push(lathe(bell.map(([r, y]) => [r * 0.965, y + 0.002]), 28));
  P.engine.push(new THREE.TorusGeometry(EXIT_R, 0.006, 6, 28).rotateX(Math.PI / 2).translate(0, EXIT_Y + 0.003, 0));

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
    P.paint.push(new THREE.CapsuleGeometry(0.095, 0.2, 4, 14).rotateX(Math.PI / 2).translate(s * 0.36, 0.5, -0.05));
    P.accent.push(new THREE.CylinderGeometry(0.098, 0.098, 0.022, 14, 1, true).rotateX(Math.PI / 2).translate(s * 0.36, 0.5, 0.03));
    P.black.push(box(0.05, 0.03, 0.2, s * 0.315, 0.5, -0.05)); // saddle to the cabin
  });
  // Aft equipment bay, with radiator ribs.
  P.paintDark.push(box(0.46, 0.27, 0.15, 0, 0.53, -0.31));
  [-0.15, -0.05, 0.05, 0.15].forEach((x) => P.metal.push(box(0.012, 0.25, 0.012, x, 0.53, -0.39)));
  // Docking tunnel and drogue ring on top.
  P.metal.push(new THREE.CylinderGeometry(0.09, 0.095, 0.07, 18).translate(0, 0.87, -0.03));
  P.black.push(new THREE.TorusGeometry(0.088, 0.01, 6, 18).rotateX(Math.PI / 2).translate(0, 0.905, -0.03));
  // Rendezvous radar (front right) and steerable S-band dish (aft left) on booms; two VHF whips.
  P.metal.push(rod([0.16, 0.84, 0.05], [0.18, 0.9, 0.07], 0.008, 6));
  P.metal.push(dish(0.055, 0.02, [0.18, 0.905, 0.075], [0.15, 0.7, 0.7]));
  P.metal.push(rod([-0.22, 0.84, -0.12], [-0.29, 0.97, -0.17], 0.007, 6));
  P.metal.push(dish(0.068, 0.024, [-0.29, 0.98, -0.17], [-0.3, 1, -0.2]));
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

/** The whole lunar module, stages joined: one merged geometry per material. */
export function buildBody() {
  const { descent, ascent } = collect();
  return Object.fromEntries(PARTS.map((k) => [k, merge(descent[k].concat(ascent[k]))]));
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

/** The footpad: a dished pad with a rolled rim and the ball joint the strut sits in. Origin at its bottom centre. */
export function buildPad() {
  const pad = lathe(
    [
      [0, PAD_H - 0.004],
      [0.05, PAD_H - 0.006],
      [0.094, PAD_H - 0.014],
      [PAD_SIZE, 0.018],
      [PAD_SIZE - 0.002, 0.006],
      [PAD_SIZE - 0.016, 0],
      [0, 0],
    ],
    22
  );
  const ball = new THREE.SphereGeometry(0.02, 10, 6).translate(0, PAD_H + 0.008, 0);
  return merge([pad, ball]);
}
