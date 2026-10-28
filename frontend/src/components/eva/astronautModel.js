/*
 * LUNAVIA — the astronaut's suit as geometry, built once in metres on the rig's segments
 * (data/astronautRig). A lunar surface suit after the Apollo A7L-B, drawn for close range:
 *
 *   helmet   the white LEVA shell round the bubble, the gold visor down under a retracted
 *            eyeshade, the visor's rim and pivot bosses, the neck ring with its lock ring, the
 *            commander's orange stripe over the top
 *   torso    Beta-cloth layer with quilted seams and folds, the waist convolutes, the chest
 *            control unit (knobs, labelled face) on its straps over the shoulders, the camera on
 *            its bracket, ribbed oxygen hoses (blue and red) round to the backpack, the LUNAVIA
 *            emblem and name tag
 *   pack     the life-support backpack with edge bumpers, an access panel, tie-down bands, the
 *            oxygen purge unit on top with its handle, purge valve and antenna
 *   arms     shoulder and elbow convolutes, the commander's bands, the emblem on the left
 *            shoulder, the wrist disconnects (blue left, red right), the cuff checklist and watch
 *   gloves   metal-weave gauntlets and hands, pre-curled fingers with blue silicone tips
 *   legs     knee convolutes, thigh pockets, the overshoes: metal-weave uppers, a Beta tongue,
 *            heel straps with buckles, blue silicone soles with a chevron tread and a toe bumper
 *
 * The whole suit is drawn as ONE skinned mesh per material (8 meshes, ~15 draw calls with the
 * shadow pass, against 84 for a mesh per part): every vertex is bound rigidly to its segment's
 * bone, and the bone sits where the rig puts the segment. Fabric parts carry projected UVs for an
 * even weave everywhere, vertex tints (one white material covers the suit, the pack and the
 * pockets) and a "dirt" weight the dust shader uses (boots and shins grey as the walk goes on).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { BODY, SEGMENTS } from "@/data/astronautRig";
import { drawEmblem, suitTextures } from "./evaTextures";

const TAU = Math.PI * 2;
/** The skeleton's bones: the rig's segments, the two finger sets (children of the hands) and the scoop. */
// "helmet" (a child of the torso) carries the launch suit's pressure bubble so it can be lowered on;
// the lunar suit binds nothing to it (its helmet is fixed to the suit)
export const BONES = [...SEGMENTS, "fingersL", "fingersR", "scoop", "helmet"];
export const FINGER_ROOT = [0, -0.158, 0]; // the knuckle line, in the hand's frame

/* ---- primitives (metres, in a segment's frame) --------------------------------------------------- */
const lathe = (pts, seg = 20, sz = 1) => {
  const g = new THREE.LatheGeometry(
    pts.map(([r, y]) => new THREE.Vector2(r, y)),
    seg
  );
  if (sz !== 1) g.scale(1, 1, sz);
  return g;
};
const ring = (r, tube, y, seg = 20, rs = 6, sz = 1) => {
  const g = new THREE.TorusGeometry(r, tube, rs, seg).rotateX(Math.PI / 2).translate(0, y, 0);
  if (sz !== 1) g.scale(1, 1, sz);
  return g;
};
const band = (r0, r1, h, y, seg = 20) => new THREE.CylinderGeometry(r1, r0, h, seg, 1, true).translate(0, y, 0);
// rounded boxes: 1 segment (108 triangles) unless a big part seen close asks for 2 (300) or 3 (588)
const rbox = (w, h, d, r, x = 0, y = 0, z = 0, s = 1) => new RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)).translate(x, y, z);
// small hardware: plain boxes (12 triangles)
const bx = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cyl = (r, h, seg = 12) => new THREE.CylinderGeometry(r, r, h, seg);
/** A cylinder whose axis runs along `dir` (unit), centred at `at`. */
const cylAlong = (r, h, at, dir, seg = 12) => {
  const g = cyl(r, h, seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir).normalize()));
  return g.translate(at[0], at[1], at[2]);
};
const curve = (pts, closed = false) => new THREE.CatmullRomCurve3(
  pts.map((p) => new THREE.Vector3(...p)),
  closed
);

/** A hose: a tube along the points with alternating rings (the convolutions). */
function ribbedTube(pts, r, depth = 0.22, tubular = 44, radial = 8) {
  const c = curve(pts);
  const g = new THREE.TubeGeometry(c, tubular, r, radial, false);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const ctr = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    c.getPointAt(i / tubular, ctr);
    const k = 1 + depth * (i % 2 ? -0.5 : 0.5);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, idx).sub(ctr).multiplyScalar(k).add(ctr);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return { g, c };
}

/** A flat strap along a path: `w` wide, `t` thick, its broad face turned away from `centre`. */
function ribbon(pts, w, t, centre, n = 18) {
  const c = curve(pts);
  const C = new THREE.Vector3(...centre);
  const secs = [];
  for (let i = 0; i <= n; i++) {
    const p = c.getPointAt(i / n);
    const T = c.getTangentAt(i / n);
    const O = p.clone().sub(C);
    O.addScaledVector(T, -O.dot(T)).normalize();
    const S = new THREE.Vector3().crossVectors(T, O).normalize();
    secs.push({ p, O, S });
  }
  const pos = [];
  const nrm = [];
  const uv = [];
  const corner = (s, a, b) => s.p.clone().addScaledVector(s.S, (a * w) / 2).addScaledVector(s.O, (b * t) / 2);
  const faces = [
    [[-1, 1], [1, 1], (s) => s.O],
    [[1, -1], [-1, -1], (s) => s.O.clone().negate()],
    [[1, 1], [1, -1], (s) => s.S],
    [[-1, -1], [-1, 1], (s) => s.S.clone().negate()],
  ];
  for (let i = 0; i < n; i++) {
    const s0 = secs[i];
    const s1 = secs[i + 1];
    for (const [[a0, b0], [a1, b1], nf] of faces) {
      quad(pos, nrm, uv, corner(s0, a0, b0), corner(s0, a1, b1), corner(s1, a1, b1), corner(s1, a0, b0), nf(s0), [i / n, (i + 1) / n]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
/** Two triangles a b c, a c d, wound to face n. */
function quad(pos, nrm, uv, a, b, c, d, n, [u0, u1] = [0, 1]) {
  _e1.subVectors(b, a);
  _e2.subVectors(c, a);
  const flip = _e1.cross(_e2).dot(n) < 0;
  const tri = flip
    ? [
        [a, u0, 0],
        [c, u1, 1],
        [b, u0, 1],
        [a, u0, 0],
        [d, u1, 0],
        [c, u1, 1],
      ]
    : [
        [a, u0, 0],
        [b, u0, 1],
        [c, u1, 1],
        [a, u0, 0],
        [c, u1, 1],
        [d, u1, 0],
      ];
  for (const [p, u, v] of tri) {
    pos.push(p.x, p.y, p.z);
    nrm.push(n.x, n.y, n.z);
    uv.push(u, v);
  }
}

/* ---- the decal atlas: emblem, name tag, the control unit's face, the cuff checklist ------------- */
const ATLAS_W = 512;
const ATLAS_H = 256;
const RECT = {
  emblem: [0, 0, 128, 128],
  name: [136, 0, 240, 44],
  rcu: [136, 56, 200, 100],
  checklist: [384, 0, 128, 168],
};
/** A plane (facing +z) whose UVs cover an atlas rectangle. */
function decal(w, h, rect) {
  return atlasUV(new THREE.PlaneGeometry(w, h), rect);
}
/** A patch on a cylinder of radius r about the segment's axis, centred at angle th (0 = +z). */
function cylDecal(r, h, y, th, w, rect) {
  const len = w / r;
  return atlasUV(new THREE.CylinderGeometry(r, r, h, 8, 1, true, th - len / 2, len), rect).translate(0, y, 0);
}
function atlasUV(g, [x, y, w, h]) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (x + uv.getX(i) * w) / ATLAS_W, 1 - (y + (1 - uv.getY(i)) * h) / ATLAS_H);
  return g;
}

let ATLAS = null;
export function suitDecalTexture() {
  if (ATLAS) return ATLAS;
  const c = document.createElement("canvas");
  c.width = ATLAS_W;
  c.height = ATLAS_H;
  const g = c.getContext("2d");
  g.clearRect(0, 0, ATLAS_W, ATLAS_H);
  const font = (px, w = "bold") => `${w} ${px}px Helvetica, Arial, sans-serif`;
  // the LUNAVIA emblem
  drawEmblem(g, 64, 64);
  // the name tag
  {
    const [x, y, w, h] = RECT.name;
    g.fillStyle = "#20242c";
    g.fillRect(x, y, w, h);
    g.strokeStyle = "#9aa0aa";
    g.lineWidth = 2;
    g.strokeRect(x + 2, y + 2, w - 4, h - 4);
    g.font = font(26);
    g.textBaseline = "middle";
    g.textAlign = "left";
    g.fillStyle = "#f4f2ec";
    g.fillText("LUNAVIA", x + 14, y + h / 2 + 1);
    g.fillStyle = "#e2531f";
    g.textAlign = "right";
    g.fillText("CDR", x + w - 14, y + h / 2 + 1);
  }
  // the chest control unit's face: labels, the oxygen gauge, the push-to-talk
  {
    const [x, y, w, h] = RECT.rcu;
    g.fillStyle = "#2c2e33";
    g.fillRect(x, y, w, h);
    g.strokeStyle = "#7d828b";
    g.lineWidth = 3;
    g.strokeRect(x + 3, y + 3, w - 6, h - 6);
    g.fillStyle = "#e9e7e1";
    g.font = font(13);
    g.textAlign = "center";
    g.textBaseline = "middle";
    [
      ["FAN", 30],
      ["PUMP", 30 + 44],
      ["O2", w - 44],
    ].forEach(([t, px]) => g.fillText(t, x + px, y + 18));
    // the gauge
    g.fillStyle = "#f2f0ea";
    g.beginPath();
    g.arc(x + w - 44, y + 58, 26, 0, TAU);
    g.fill();
    g.strokeStyle = "#1b1c20";
    g.lineWidth = 2;
    for (let k = 0; k <= 10; k++) {
      const a = Math.PI * 0.8 + (k / 10) * Math.PI * 1.4;
      g.beginPath();
      g.moveTo(x + w - 44 + Math.cos(a) * 18, y + 58 + Math.sin(a) * 18);
      g.lineTo(x + w - 44 + Math.cos(a) * 24, y + 58 + Math.sin(a) * 24);
      g.stroke();
    }
    g.strokeStyle = "#d23a24";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x + w - 44, y + 58);
    g.lineTo(x + w - 44 + Math.cos(-0.5) * 20, y + 58 + Math.sin(-0.5) * 20);
    g.stroke();
    // switches and the push-to-talk
    g.fillStyle = "#9aa0aa";
    for (let k = 0; k < 3; k++) g.fillRect(x + 18 + k * 30, y + 40, 16, 22);
    g.fillStyle = "#c8382a";
    g.fillRect(x + 18, y + 72, 60, 16);
    g.fillStyle = "#ffffff";
    g.font = font(11);
    g.fillText("PTT", x + 48, y + 80);
  }
  // the cuff checklist: a page of procedures under an orange header
  {
    const [x, y, w, h] = RECT.checklist;
    g.fillStyle = "#f1efe8";
    g.fillRect(x, y, w, h);
    g.fillStyle = "#e2531f";
    g.fillRect(x, y, w, 24);
    g.fillStyle = "#ffffff";
    g.font = font(15);
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText("EVA-1", x + 8, y + 12);
    g.fillStyle = "#4b4e55";
    for (let k = 0; k < 11; k++) {
      g.fillRect(x + 8, y + 34 + k * 12, 8, 6);
      g.fillRect(x + 22, y + 35 + k * 12, 30 + ((k * 29) % 70), 3);
    }
    g.strokeStyle = "#8b8f97";
    g.lineWidth = 3;
    g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  ATLAS = t;
  return t;
}

/* ---- each segment: add(material, geometry, { c: tint, uv: "cyl" | "box" | "keep", tile }) ------- */
function collector() {
  const items = [];
  const add = (m, g, o = {}) => {
    items.push({ m, g, ...o });
    return g;
  };
  return { items, add };
}
const WHITE = "#eeebe4";
const PACK = "#e3e0d8";
const SEAM = "#d8d4cb";
const WEAVE_BOOT = "#c6c5bf";
const WEAVE_GLOVE = "#a9afb8";
const STRAP = "#4d4f55";
const ORANGE = "#e2531f";
const BLUE = "#3d64a6";
const RED = "#b5392b";
const HOSE_BLUE = "#4b6897";
const HOSE_RED = "#a5463a";

function pelvis() {
  const { items, add } = collector();
  add(
    "suit",
    lathe(
      [
        [0, 0.13],
        [0.19, 0.12],
        [0.205, 0.05],
        [0.2, -0.03],
        [0.172, -0.09],
        [0.112, -0.135],
        [0, -0.145],
      ],
      26,
      0.76
    ),
    { c: WHITE }
  );
  // the belt line and the hip seams
  add("suit", ring(0.198, 0.009, 0.098, 28, 6, 0.76), { c: SEAM });
  // the sample bag on the left hip: a Beta-cloth bag on a metal frame, the tether ring above it
  add("suit", rbox(0.1, 0.13, 0.072, 0.02, 0.218, -0.012, 0.07), { c: "#d6d2c8", uv: "box", tile: 0.22 });
  add("suit", rbox(0.104, 0.03, 0.076, 0.01, 0.218, 0.04, 0.07), { c: "#c9c5bb", uv: "box", tile: 0.22 });
  add("metal", bx(0.108, 0.01, 0.08, 0.218, 0.058, 0.07));
  add("metal", new THREE.TorusGeometry(0.022, 0.005, 5, 12).rotateY(Math.PI / 2).translate(0.218, 0.085, 0.07));
  return items;
}

function torso(variant = "eva") {
  const eva = variant !== "launch";
  const { items, add } = collector();
  const SZ = 0.68;
  add(
    "suit",
    lathe(
      [
        [0, -0.06],
        [0.18, -0.055],
        [0.198, 0.0],
        [0.205, 0.06],
        [0.232, 0.2],
        [0.25, 0.33],
        [0.248, 0.42],
        [0.222, 0.49],
        [0.17, 0.535],
        [0.12, 0.552],
        [0, 0.556],
      ],
      30,
      SZ
    ),
    { c: WHITE, tile: 0.5 }
  );
  // the waist's convolutes
  [
    [0.197, -0.014],
    [0.201, 0.018],
    [0.205, 0.05],
  ].forEach(([r, y]) => add("suit", ring(r - 0.002, 0.0105, y, 28, 5, 0.72), { c: "#e4e1d9" }));

  /* the launch suit: no backpack, no chest unit or camera; the oxygen inlets and outlets on the
     chest, capped until the hoses are plugged in aboard, and the zip's cover flap */
  if (!eva) {
    for (const [col, at] of [
      [HOSE_BLUE, [0.09, 0.14, 0.17]],
      [HOSE_BLUE, [-0.14, 0.2, 0.16]],
      [HOSE_RED, [-0.09, 0.14, 0.17]],
      [HOSE_RED, [0.14, 0.2, 0.16]],
    ]) {
      add("metal", cylAlong(0.023, 0.042, [at[0], at[1], at[2] - 0.02], [0, 0, 1], 14));
      add("color", new THREE.TorusGeometry(0.0235, 0.0055, 5, 14).translate(at[0], at[1], at[2] - 0.005), { c: col });
      add("dark", cylAlong(0.019, 0.012, [at[0], at[1], at[2] + 0.004], [0, 0, 1], 12), { c: "#2b2c30" });
    }
    add("suit", rbox(0.05, 0.42, 0.02, 0.008, 0, 0.27, 0.205), { c: "#e1ddd4", uv: "box", tile: 0.3 });
  }
  if (eva) {
    /* the backpack (life support), its edge bumpers, access panel and tie-down bands */
    add("suit", rbox(0.48, 0.6, 0.2, 0.04, 0, 0.3, -0.285, 2), { c: PACK, uv: "box", tile: 0.42 });
    for (const sx of [1, -1]) add("suit", rbox(0.032, 0.58, 0.214, 0.012, sx * 0.238, 0.3, -0.285), { c: "#d3cfc5", uv: "box", tile: 0.3 });
    add("suit", rbox(0.34, 0.36, 0.022, 0.01, 0, 0.33, -0.39), { c: "#ebe8e1", uv: "box", tile: 0.42 });
    for (const y of [0.11, 0.53]) add("suit", bx(0.49, 0.026, 0.208, 0, y, -0.285), { c: "#c4c0b6", uv: "box", tile: 0.3 });
    // the panel's fasteners
    for (const [x, y] of [
      [-0.15, 0.49],
      [0.15, 0.49],
      [-0.15, 0.17],
      [0.15, 0.17],
    ])
      add("metal", cyl(0.009, 0.008, 8).rotateX(Math.PI / 2).translate(x, y, -0.403));
    // the oxygen purge unit on top, the gap under it, its handle, the purge valve, the antenna
    add("suit", rbox(0.44, 0.15, 0.19, 0.035, 0, 0.695, -0.275, 2), { c: "#e8e5de", uv: "box", tile: 0.42 });
    add("dark", bx(0.43, 0.024, 0.18, 0, 0.612, -0.278), { c: "#3a3c41" });
    add("metal", new THREE.TorusGeometry(0.04, 0.007, 5, 12, Math.PI).translate(-0.1, 0.77, -0.275));
    add("metal", cylAlong(0.03, 0.05, [0.245, 0.7, -0.24], [1, 0, 0], 14));
    add("color", new THREE.TorusGeometry(0.02, 0.005, 5, 12).rotateY(Math.PI / 2).translate(0.275, 0.7, -0.24), { c: RED });
    add("metal", cyl(0.013, 0.03, 10).translate(0.18, 0.785, -0.32));
    add("metal", cyl(0.0045, 0.26, 6).translate(0.18, 0.92, -0.32));
    add("dark", bx(0.016, 0.03, 0.016, 0.18, 1.05, -0.32), { c: "#3a3c41" });
    // the water and oxygen fittings under the pack
    for (const x of [-0.12, 0.05, 0.12]) add("metal", cyl(0.016, 0.03, 10).translate(x, -0.01, -0.3));
  
    /* the chest control unit: its body, the labelled face, the knobs on top */
    add("shell", rbox(0.215, 0.125, 0.085, 0.014, 0, 0.43, 0.19, 2), { c: "#cfcdc6" });
    add("decal", decal(0.19, 0.095, RECT.rcu).translate(0, 0.43, 0.2335));
    for (const [x, r] of [
      [-0.07, 0.015],
      [-0.025, 0.012],
      [0.025, 0.012],
      [0.07, 0.009],
    ])
      add("metal", cyl(r, 0.024, 12).translate(x, 0.502, 0.19));
    // the camera on its bracket: body, film magazine, lens barrel and ring
    add("metal", cylAlong(0.012, 0.05, [0, 0.36, 0.2], [0, 0, 1], 8));
    add("metal", rbox(0.095, 0.088, 0.072, 0.01, 0, 0.31, 0.226, 2));
    add("dark", bx(0.09, 0.03, 0.064, 0, 0.365, 0.222), { c: "#232428" });
    add("dark", cylAlong(0.031, 0.036, [0, 0.31, 0.276], [0, 0, 1], 20), { c: "#1d1e22" });
    add("metal", new THREE.TorusGeometry(0.029, 0.0045, 5, 20).translate(0, 0.31, 0.294));
    // the straps: the control unit hangs from them, over the shoulders to the pack
    for (const s of [1, -1]) {
      add(
        "dark",
        ribbon(
          [
            [s * 0.088, 0.49, 0.172],
            [s * 0.135, 0.515, 0.104],
            [s * 0.163, 0.537, 0.048],
            [s * 0.173, 0.545, -0.03],
            [s * 0.176, 0.541, -0.11],
            [s * 0.176, 0.53, -0.19],
          ],
          0.034,
          0.007,
          [0, 0.3, 0]
        ),
        { c: STRAP }
      );
      add("metal", bx(0.04, 0.012, 0.03, s * 0.088, 0.494, 0.18));
    }
    // the hose connectors (anodised collars) and the ribbed hoses round to the pack
    const hoses = [
      [HOSE_BLUE, [0.09, 0.14, 0.17], [[0.2, 0.12, 0.13], [0.265, 0.1, -0.02], [0.235, 0.08, -0.17], [0.17, 0.06, -0.21]]],
      [HOSE_BLUE, [-0.14, 0.2, 0.16], [[-0.24, 0.17, 0.11], [-0.275, 0.13, -0.03], [-0.24, 0.1, -0.18], [-0.17, 0.07, -0.21]]],
      [HOSE_RED, [-0.09, 0.14, 0.17], [[-0.2, 0.12, 0.13], [-0.265, 0.1, -0.02], [-0.235, 0.08, -0.17], [-0.17, 0.06, -0.21]]],
      [HOSE_RED, [0.14, 0.2, 0.16], [[0.24, 0.17, 0.11], [0.275, 0.13, -0.03], [0.24, 0.1, -0.18], [0.17, 0.07, -0.21]]],
    ];
    for (const [col, at, path] of hoses) {
      const { g, c } = ribbedTube([at, ...path], 0.0178, 0.13, 48, 7);
      add("color", g, { c: col });
      add("metal", cylAlong(0.023, 0.042, [at[0], at[1], at[2] - 0.02], [0, 0, 1], 14));
      add("color", new THREE.TorusGeometry(0.0235, 0.0055, 5, 14).translate(at[0], at[1], at[2] - 0.005), { c: col });
      const end = c.getPointAt(1);
      const tan = c.getTangentAt(1);
      add("metal", cylAlong(0.024, 0.03, [end.x, end.y, end.z], [tan.x, tan.y, tan.z], 12));
    }
  }
  // the emblem (right chest) and the name tag (left chest), lying on the chest's curve
  const onChest = (x, y, w, h, rect) => {
    const t = (y - 0.2) / 0.13;
    const r = 0.232 + 0.018 * Math.min(1, Math.max(0, t));
    const z = SZ * Math.sqrt(Math.max(0, r * r - x * x));
    const yaw = Math.atan2(x / (r * r), z / (SZ * SZ * r * r));
    const n = [Math.sin(yaw), 0, Math.cos(yaw)];
    return decal(w, h, rect)
      .rotateY(yaw)
      .translate(x + n[0] * 0.004, y, z + n[2] * 0.004);
  };
  add("decal", onChest(-0.162, 0.325, 0.078, 0.078, RECT.emblem));
  add("decal", onChest(0.163, 0.36, 0.092, 0.017, RECT.name));
  const H = BODY.helmet;
  const R = BODY.helmetR;
  if (eva) {
    // the helmet: the LEVA shell over the bubble, the gold visor down, the eyeshade drawn up
    const front = Math.PI / 2; // three.js sphere: phi = π/2 faces +z
    const half = 1.22;
    const th0 = 0.62;
    const th1 = 1.86;
    const sp = (th, ph, r) => new THREE.Vector3(-r * Math.cos(ph) * Math.sin(th), r * Math.cos(th), r * Math.sin(ph) * Math.sin(th)).add(new THREE.Vector3(...H));
    [
      new THREE.SphereGeometry(R, 40, 22, front + half, TAU - 2 * half, 0, 2.3),
      new THREE.SphereGeometry(R, 20, 6, front - half, 2 * half, 0, th0),
      new THREE.SphereGeometry(R, 20, 4, front - half, 2 * half, th1, 2.3 - th1),
    ].forEach((g) => add("shell", g.translate(H[0], H[1], H[2]), { c: "#f4f2ed" }));
    add("visor", new THREE.SphereGeometry(R + 0.004, 30, 16, front - half - 0.02, 2 * half + 0.04, th0 - 0.02, th1 - th0 + 0.04).translate(H[0], H[1], H[2]));
    add("dark", new THREE.SphereGeometry(R + 0.0058, 22, 2, front - half + 0.01, 2 * half - 0.02, th0 - 0.005, 0.1).translate(H[0], H[1], H[2]), { c: "#39424f" });
    // the visor's rim round the opening, and its pivot bosses
    const rim = [];
    const N = 14;
    for (let k = 0; k < N; k++) rim.push(sp(th0, front - half + (2 * half * k) / N, R + 0.006));
    for (let k = 0; k < N / 2; k++) rim.push(sp(th0 + ((th1 - th0) * k) / (N / 2), front + half, R + 0.006));
    for (let k = 0; k < N; k++) rim.push(sp(th1, front + half - (2 * half * k) / N, R + 0.006));
    for (let k = 0; k < N / 2; k++) rim.push(sp(th1 - ((th1 - th0) * k) / (N / 2), front - half, R + 0.006));
    add("shell", new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rim, true, "catmullrom", 0.2), 96, 0.0075, 6, true), { c: "#dedcd6" });
    for (const s of [1, -1]) {
      const n = sp(1.22, front + s * (half + 0.07), 1).sub(new THREE.Vector3(...H)).normalize();
      const at = new THREE.Vector3(...H).addScaledVector(n, R + 0.004);
      add("metal", cylAlong(0.024, 0.014, [at.x, at.y, at.z], [n.x, n.y, n.z], 16));
      add("shell", cylAlong(0.032, 0.008, [at.x - n.x * 0.004, at.y - n.y * 0.004, at.z - n.z * 0.004], [n.x, n.y, n.z], 16), { c: "#e6e4de" });
    }
  }
  // the neck ring, its lock ring and latches
  add("metal", ring(0.135, 0.022, H[1] - 0.125, 32, 8).translate(0, 0, H[2]));
  add("color", ring(0.14, 0.0085, H[1] - 0.106, 32, 6).translate(0, 0, H[2]), { c: "#2c3f6a" });
  for (const s of [1, -1]) add("metal", bx(0.018, 0.03, 0.03, s * 0.158, H[1] - 0.122, H[2]));
  if (eva) {
    // the commander's stripe, over the top from the back to the visor's rim
    add("color", new THREE.TorusGeometry(R + 0.003, 0.012, 6, 30, Math.PI / 2 + 0.56).rotateY(Math.PI / 2).translate(H[0], H[1], H[2]), { c: ORANGE });
  } else {
    // inside the launch helmet: the face, the neck, and the communications carrier ("Snoopy cap")
    add("skin", new THREE.CylinderGeometry(0.052, 0.058, 0.12, 14).translate(H[0], H[1] - 0.11, H[2] - 0.005));
    add("skin", new THREE.SphereGeometry(0.094, 22, 16).scale(0.9, 1.1, 1.0).translate(H[0], H[1] - 0.005, H[2] + 0.008));
    // the face: chin and jaw, a modest nose, brow ridge, eyes under brows, the mouth
    add("skin", new THREE.SphereGeometry(0.058, 16, 10).scale(1, 0.72, 0.9).translate(H[0], H[1] - 0.068, H[2] + 0.03));
    add("skin", new THREE.SphereGeometry(0.013, 10, 8).scale(0.75, 1.5, 1.0).translate(H[0], H[1] - 0.008, H[2] + 0.097)); // nose
    add("skin", new THREE.SphereGeometry(0.06, 14, 6, 0, TAU, 0, 1.1).scale(1.05, 0.35, 0.6).rotateX(-0.2).translate(H[0], H[1] + 0.022, H[2] + 0.06)); // brow ridge
    for (const sx of [1, -1]) {
      add("color", new THREE.SphereGeometry(0.0105, 10, 8).scale(1.1, 0.75, 0.6).translate(H[0] + sx * 0.031, H[1] + 0.012, H[2] + 0.087), { c: "#ece6dc" });
      add("dark", new THREE.SphereGeometry(0.0062, 8, 6).translate(H[0] + sx * 0.031, H[1] + 0.012, H[2] + 0.092), { c: "#2a2420" });
      add("dark", new THREE.BoxGeometry(0.028, 0.0045, 0.006).rotateZ(sx * -0.12).translate(H[0] + sx * 0.032, H[1] + 0.031, H[2] + 0.089), { c: "#3b2c22" });
    }
    add("dark", new THREE.BoxGeometry(0.028, 0.0035, 0.004).translate(H[0], H[1] - 0.046, H[2] + 0.084), { c: "#7a4a3c" }); // mouth
    // the cap: a white crown and back, brown sides, the earcups, the two microphone booms
    add("color", new THREE.SphereGeometry(0.1, 22, 12, Math.PI * 0.62, Math.PI * 1.76, 0, Math.PI * 0.62).scale(0.93, 1.12, 1.03).translate(H[0], H[1] - 0.004, H[2] + 0.004), { c: "#f1efe9" });
    add("color", new THREE.SphereGeometry(0.101, 18, 8, Math.PI * 0.62, Math.PI * 1.76, Math.PI * 0.62, Math.PI * 0.2).scale(0.93, 1.12, 1.03).translate(H[0], H[1] - 0.004, H[2] + 0.004), { c: "#5a4433" });
    for (const sx of [1, -1]) {
      add("color", cylAlong(0.034, 0.022, [H[0] + sx * 0.092, H[1] - 0.012, H[2] - 0.002], [1, 0, 0], 16), { c: "#3d2e24" });
      add("dark", cylAlong(0.005, 0.07, [H[0] + sx * 0.07, H[1] - 0.05, H[2] + 0.062], [-sx * 0.55, -0.15, 0.82], 6), { c: "#1f1f22" });
      add("dark", new THREE.SphereGeometry(0.009, 8, 6).translate(H[0] + sx * 0.035, H[1] - 0.058, H[2] + 0.1), { c: "#1f1f22" });
    }
  }
  return items;
}

function thigh(side) {
  const { items, add } = collector();
  add(
    "suit",
    lathe(
      [
        [0, 0.05],
        [0.1, 0.04],
        [0.112, -0.04],
        [0.104, -0.2],
        [0.092, -0.36],
        [0.085, -0.44],
        [0, -0.45],
      ],
      22
    ),
    { c: WHITE }
  );
  // the utility pocket on the outside of the thigh, its flap
  add("suit", rbox(0.032, 0.13, 0.11, 0.012, side * 0.1, -0.2, 0.004), { c: "#e6e3db", uv: "box", tile: 0.25 });
  add("suit", rbox(0.036, 0.034, 0.114, 0.01, side * 0.104, -0.14, 0.004), { c: SEAM, uv: "box", tile: 0.25 });
  // the commander's band above the knee
  add("color", band(0.0925, 0.0945, 0.034, -0.34, 22), { c: ORANGE });
  return items;
}

function shin(side) {
  const { items, add } = collector();
  add(
    "suit",
    lathe(
      [
        [0, 0.03],
        [0.086, 0.03],
        [0.087, -0.05],
        [0.079, -0.2],
        [0.074, -0.28],
        [0.072, -0.3],
        [0, -0.31],
      ],
      22
    ),
    { c: WHITE }
  );
  // the knee's convolutes
  [0.03, 0.004, -0.022, -0.048].forEach((y, i) => add("suit", ring(0.0855 - i * 0.0008, 0.0102, y, 20, 5), { c: "#e4e1d9" }));
  // the overshoe's shaft: metal-weave upper, its cuff, the Beta tongue, two straps with buckles
  add("weave", band(0.09, 0.085, 0.2, -0.355, 22), { c: WEAVE_BOOT, tile: 0.2 });
  add("weave", ring(0.088, 0.0095, -0.255, 22), { c: "#b9b8b2" });
  add("suit", rbox(0.052, 0.17, 0.02, 0.008, 0, -0.35, 0.087), { c: "#e6e3dc", uv: "box", tile: 0.2 });
  for (const y of [-0.3, -0.39]) {
    add("dark", ring(0.0915, 0.0055, y, 22, 4).scale(1, 1.6, 1).translate(0, y * -0.6, 0), { c: STRAP });
    add("metal", bx(0.012, 0.022, 0.026, side * 0.093, y, 0.02));
  }
  return items;
}

function boot(side) {
  const { items, add } = collector();
  // the upper: a side profile extruded across the foot, rounded at every edge
  const prof = [
    [-0.1, -0.07],
    [0.226, -0.07],
    [0.252, -0.062],
    [0.264, -0.046],
    [0.26, -0.026],
    [0.238, -0.009],
    [0.19, 0.007],
    [0.12, 0.022],
    [0.072, 0.036],
    [0.044, 0.078],
    [0.032, 0.1],
    [-0.068, 0.1],
    [-0.098, 0.072],
    [-0.108, 0.0],
    [-0.106, -0.045],
  ];
  const shape = new THREE.Shape(prof.map(([z, y]) => new THREE.Vector2(z, y)));
  const body = new THREE.ExtrudeGeometry(shape, { depth: 0.118, bevelEnabled: true, bevelThickness: 0.016, bevelSize: 0.014, bevelSegments: 3, curveSegments: 6 });
  body.rotateY(-Math.PI / 2).translate(0.059 + side * 0.004, 0, 0);
  add("weave", body, { c: WEAVE_BOOT, uv: "box", tile: 0.2 });
  // the Beta tongue down the instep, the heel strap and its buckles, the heel latch
  add("suit", rbox(0.062, 0.012, 0.17, 0.005).rotateX(0.453).translate(side * 0.004, 0.056, 0.118), { c: "#e8e5de", uv: "box", tile: 0.2 });
  add("dark", new THREE.TorusGeometry(0.078, 0.0055, 4, 16, Math.PI).rotateX(-Math.PI / 2).scale(1, 1, 1.25).translate(side * 0.004, 0.035, 0.0), { c: STRAP });
  for (const s of [1, -1]) add("metal", bx(0.01, 0.024, 0.03, side * 0.004 + s * 0.08, 0.035, 0.0));
  add("metal", rbox(0.13, 0.02, 0.03, 0.006, side * 0.004, 0.02, -0.078));
  // the sole: blue silicone, wider at the ball, its toe bumper and a chevron tread underneath
  const outline = [
    [0, -0.118],
    [0.05, -0.112],
    [0.068, -0.08],
    [0.072, 0.02],
    [0.08, 0.15],
    [0.078, 0.215],
    [0.06, 0.258],
    [0.026, 0.275],
    [-0.026, 0.275],
    [-0.06, 0.258],
    [-0.078, 0.215],
    [-0.08, 0.15],
    [-0.072, 0.02],
    [-0.068, -0.08],
    [-0.05, -0.112],
  ];
  const so = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, z)));
  const sole = new THREE.ExtrudeGeometry(so, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.005, bevelSegments: 2, curveSegments: 6 });
  sole.rotateX(Math.PI / 2).translate(side * 0.004, -0.073, 0);
  add("color", sole, { c: BLUE });
  add("color", rbox(0.14, 0.034, 0.034, 0.014, side * 0.004, -0.06, 0.252), { c: BLUE });
  for (let i = 0; i < 9; i++) {
    const z = -0.09 + i * 0.042;
    for (const s of [1, -1]) add("color", bx(0.07, 0.008, 0.012).rotateY(s * 0.42).translate(side * 0.004 + s * 0.033, -0.1015, z), { c: "#35589a" });
  }
  return items;
}

function upperArm(side) {
  const { items, add } = collector();
  add(
    "suit",
    lathe(
      [
        [0, 0.06],
        [0.087, 0.05],
        [0.091, -0.02],
        [0.083, -0.15],
        [0.072, -0.29],
        [0, -0.3],
      ],
      22
    ),
    { c: WHITE }
  );
  // the shoulder's convolutes
  [0.036, 0.011, -0.014].forEach((y) => add("suit", ring(0.0885, 0.0102, y, 20, 5), { c: "#e4e1d9" }));
  // the commander's band, the emblem on the left shoulder, a pen-light pocket on the right
  add("color", band(0.0835, 0.0865, 0.034, -0.16, 22), { c: ORANGE });
  if (side > 0) add("decal", cylDecal(0.0905, 0.066, -0.075, Math.PI / 2, 0.066, RECT.emblem));
  else add("suit", rbox(0.024, 0.09, 0.05, 0.008, -0.088, -0.08, 0.0), { c: "#e6e3db", uv: "box", tile: 0.2 });
  return items;
}

function forearm(side) {
  const { items, add } = collector();
  add(
    "suit",
    lathe(
      [
        [0, 0.03],
        [0.071, 0.03],
        [0.069, -0.05],
        [0.061, -0.2],
        [0.056, -0.25],
        [0, -0.255],
      ],
      20
    ),
    { c: WHITE }
  );
  // the elbow's convolutes
  [0.028, 0.006, -0.016, -0.038].forEach((y) => add("suit", ring(0.0688, 0.0092, y, 18, 5), { c: "#e4e1d9" }));
  // the wrist disconnect (its anodised band: blue on the left, red on the right)
  add("metal", ring(0.06, 0.013, -0.258, 22, 8));
  add("color", band(0.0625, 0.0625, 0.018, -0.238, 20), { c: side > 0 ? BLUE : RED });
  if (side > 0) {
    // the cuff checklist on the left wrist
    add("suit", rbox(0.074, 0.1, 0.018, 0.006, 0, -0.15, 0.064), { c: "#d9d5cc", uv: "box", tile: 0.2 });
    add("decal", decal(0.064, 0.088, RECT.checklist).translate(0, -0.15, 0.0742));
    add("metal", bx(0.07, 0.008, 0.02, 0, -0.096, 0.064));
  } else {
    // the watch over the right sleeve
    add("dark", ring(0.064, 0.006, -0.205, 20, 4), { c: "#2a2b2f" });
    add("metal", cylAlong(0.017, 0.012, [0, -0.205, 0.067], [0, 0, 1], 16));
  }
  return items;
}

function hand(side) {
  const { items, add } = collector();
  const palmN = -side; // the palm faces the body's midline: -x for the left hand, +x for the right
  // the gauntlet flaring up over the wrist disconnect, its rim
  add("weave", band(0.057, 0.069, 0.085, 0.012, 20), { c: WEAVE_GLOVE, tile: 0.16 });
  add("weave", ring(0.069, 0.0055, 0.054, 20), { c: "#9aa1ab" });
  // the hand: palm, the restraint across its back, the thumb with its blue tip
  add("weave", rbox(0.054, 0.104, 0.094, 0.025, palmN * 0.004, -0.11, 0.0, 2), { c: WEAVE_GLOVE, uv: "box", tile: 0.16 });
  add("weave", rbox(0.014, 0.062, 0.08, 0.006, -palmN * 0.027, -0.115, 0.0), { c: "#959ca6", uv: "box", tile: 0.16 });
  const thumb = new THREE.CapsuleGeometry(0.0125, 0.046, 3, 8).rotateX(-0.5).translate(palmN * 0.014, -0.112, 0.058);
  add("weave", thumb, { c: WEAVE_GLOVE });
  add("color", new THREE.SphereGeometry(0.013, 8, 6).translate(palmN * 0.014, -0.112 - 0.034 * Math.cos(0.5), 0.058 + 0.034 * Math.sin(0.5)), { c: BLUE });
  return items;
}
function fingers(side) {
  // four fingers from the knuckle line (the bone's origin), curled a little at rest, blue tips
  const { items, add } = collector();
  const palmN = -side;
  for (let i = 0; i < 4; i++) {
    const z = 0.03 - i * 0.02;
    const len = [0.062, 0.072, 0.068, 0.054][i];
    const pts = [
      [palmN * 0.004, 0.006, z],
      [palmN * 0.006, -len * 0.45, z],
      [palmN * 0.016, -len * 0.8, z],
      [palmN * 0.03, -len, z],
    ];
    const c = curve(pts);
    add("weave", new THREE.TubeGeometry(c, 8, 0.0105, 7, false), { c: WEAVE_GLOVE, tile: 0.16 });
    const end = c.getPointAt(1);
    add("color", new THREE.SphereGeometry(0.0118, 8, 6).translate(end.x, end.y, end.z), { c: BLUE });
  }
  return items;
}

/** The launch suit's pressure helmet: a clear bubble on its neck ring (the "helmet" bone; torso frame). */
function launchHelmet() {
  const { items, add } = collector();
  const H = BODY.helmet;
  const R = BODY.helmetR;
  add("bubble", new THREE.SphereGeometry(R + 0.002, 40, 24, 0, TAU, 0, 2.32).translate(H[0], H[1], H[2]));
  // the bubble's own ring, the feed port at the back, and the vent pad inside the crown
  add("metal", ring(0.138, 0.016, H[1] - 0.128, 32, 8).translate(0, 0, H[2]));
  add("color", ring(0.146, 0.011, H[1] - 0.146, 32, 8).translate(0, 0, H[2]), { c: "#2d5aa6" });
  add("metal", cylAlong(0.02, 0.03, [H[0], H[1] - 0.06, H[2] - R + 0.005], [0, 0, 1], 12));
  add("shell", new THREE.SphereGeometry(R - 0.012, 18, 6, 0, TAU, 0, 0.42).translate(H[0], H[1], H[2]), { c: "#dcd9d2" });
  return items;
}

function scoop() {
  // the long-handled sample scoop: handle along +z from the grip (origin) to the pan
  const { items, add } = collector();
  add("metal", cylAlong(0.011, 0.86, [0, 0, 0.43], [0, 0, 1], 8));
  add("dark", cylAlong(0.016, 0.13, [0, 0, 0.07], [0, 0, 1], 10), { c: "#2b2c30" });
  add("metal", rbox(0.075, 0.025, 0.09, 0.008, 0, -0.01, 0.89));
  add("metal", cylAlong(0.016, 0.03, [0, 0, 0.84], [1, 0, 0], 10));
  return items;
}

/* ---- assembly ------------------------------------------------------------------------------------- */
const smooth = (x) => {
  const u = Math.max(0, Math.min(1, x));
  return u * u * (3 - 2 * u);
};
/** How much dust each segment takes, by position in its frame (0 clean .. 1 grey). */
const DIRT = {
  footL: () => 1,
  footR: () => 1,
  shinL: (x, y) => smooth((-y - 0.06) / 0.32),
  shinR: (x, y) => smooth((-y - 0.06) / 0.32),
  thighL: (x, y) => 0.2 * smooth((-y - 0.3) / 0.14),
  thighR: (x, y) => 0.2 * smooth((-y - 0.3) / 0.14),
  handL: () => 0.32,
  handR: () => 0.32,
  fingersL: () => 0.38,
  fingersR: () => 0.38,
  pelvis: (x, y) => (x > 0.15 ? 0.25 : 0.05),
};
const TINT_DEFAULT = { suit: WHITE, weave: WEAVE_BOOT, shell: "#f4f2ed", dark: "#2b2c30", color: "#ffffff" };
const FABRIC = new Set(["suit", "weave"]);

/** Fabric UVs projected about the segment's axis ("cyl") or onto its planes ("box"), `tile` m per repeat. */
function projectUV(g, mode, tile) {
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  const n = p.count;
  if (mode === "cyl") {
    let rs = 0;
    for (let i = 0; i < n; i++) rs += Math.hypot(p.getX(i), p.getZ(i));
    const rRef = Math.max(0.02, rs / n);
    for (let t = 0; t + 2 < n; t += 3) {
      const a = [0, 1, 2].map((k) => Math.atan2(p.getX(t + k), p.getZ(t + k)));
      if (Math.max(...a) - Math.min(...a) > Math.PI) for (let k = 0; k < 3; k++) if (a[k] < 0) a[k] += TAU;
      for (let k = 0; k < 3; k++) uv.setXY(t + k, (a[k] * rRef) / tile, p.getY(t + k) / tile);
    }
  } else {
    const A = new THREE.Vector3();
    const B = new THREE.Vector3();
    const C = new THREE.Vector3();
    for (let t = 0; t + 2 < n; t += 3) {
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
        if (ax >= ay && ax >= az) uv.setXY(t + k, z / tile, y / tile);
        else if (ay >= az) uv.setXY(t + k, x / tile, z / tile);
        else uv.setXY(t + k, x / tile, y / tile);
      }
    }
  }
}

function prepare(item, bone, dirtFn) {
  let g = item.g.index ? item.g.toNonIndexed() : item.g;
  for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  if (FABRIC.has(item.m) && item.uv !== "keep") projectUV(g, item.uv || "cyl", item.tile || 0.5);
  const col = new THREE.Color(item.c || TINT_DEFAULT[item.m] || "#ffffff");
  const colors = new Float32Array(n * 3);
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  const dirt = new Float32Array(n);
  const p = g.attributes.position;
  for (let i = 0; i < n; i++) {
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
    si[i * 4] = bone;
    sw[i * 4] = 1;
    dirt[i] = dirtFn ? dirtFn(p.getX(i), p.getY(i), p.getZ(i)) : 0;
  }
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
  g.setAttribute("dirt", new THREE.Float32BufferAttribute(dirt, 1));
  return g;
}

const GEO = {};
/**
 * { material: BufferGeometry } for the whole suit, each vertex bound to one bone of BONES.
 * variant "eva" (the lunar surface suit, the default) or "launch" (the pressure suit worn for
 * launch: no backpack, no scoop, a clear bubble over the communications cap).
 */
export function astronautGeometry(variant = "eva") {
  if (GEO[variant]) return GEO[variant];
  const launch = variant === "launch";
  const parts = {
    pelvis: pelvis(),
    torso: torso(variant),
    thighL: thigh(1),
    thighR: thigh(-1),
    shinL: shin(1),
    shinR: shin(-1),
    footL: boot(1),
    footR: boot(-1),
    upperArmL: upperArm(1),
    upperArmR: upperArm(-1),
    forearmL: forearm(1),
    forearmR: forearm(-1),
    handL: hand(1),
    handR: hand(-1),
    fingersL: fingers(1),
    fingersR: fingers(-1),
    ...(launch ? { helmet: launchHelmet() } : { scoop: scoop() }),
  };
  const byMat = {};
  for (const [name, items] of Object.entries(parts)) {
    const bone = BONES.indexOf(name);
    for (const it of items) (byMat[it.m] = byMat[it.m] || []).push(prepare(it, bone, DIRT[name]));
  }
  const out = {};
  for (const [m, list] of Object.entries(byMat)) {
    const g = mergeGeometries(list, false);
    g.computeBoundingSphere();
    out[m] = g;
  }
  GEO[variant] = out;
  return out;
}

/* ---- materials --------------------------------------------------------------------------------- */
/**
 * The suit's materials for a renderer's environment map (LanderModel lunarEnv); the visor takes
 * its own (the helmet's surroundings, components/eva/Astronaut). `dust` is the shared uniform the
 * walk raises (0 clean .. 1 well dusted): it greys each vertex by its dirt weight.
 */
/**
 * The launch helmet's clear polycarbonate bubble: nearly clear face-on (the face behind it), more
 * reflective toward its edges (Fresnel), so it reads as a glass dome over the head.
 */
function bubbleMaterial(env) {
  const m = new THREE.MeshPhysicalMaterial({ color: "#f2f7fb", metalness: 0, roughness: 0.03, transparent: true, envMap: env, envMapIntensity: 2.4, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, depthWrite: false });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <opaque_fragment>",
      "float lvFr = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.0);\ndiffuseColor.a = clamp(0.1 + 0.8 * lvFr, 0.0, 0.88);\n#include <opaque_fragment>"
    );
  };
  m.customProgramCacheKey = () => "lv-launch-bubble";
  return m;
}

export function astronautMaterials(env, visorEnv = env) {
  const T = suitTextures();
  const dust = { value: 0 };
  const dustCol = { value: new THREE.Color("#8b8376") };
  const dirty = (m) => {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uDust = dust;
      sh.uniforms.uDustCol = dustCol;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float dirt;\nvarying float vDirt;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvDirt = dirt;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uDust;\nuniform vec3 uDustCol;\nvarying float vDirt;")
        .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uDustCol, clamp(uDust * vDirt, 0.0, 0.78));");
    };
    m.customProgramCacheKey = () => "lv-suit-dirt";
    return m;
  };
  const std = (o) => new THREE.MeshStandardMaterial({ envMap: env, ...o });
  return {
    dust,
    suit: dirty(std({ color: "#ffffff", vertexColors: true, map: T.map, normalMap: T.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.9, metalness: 0, envMapIntensity: 0.5 })),
    weave: dirty(std({ color: "#ffffff", vertexColors: true, map: T.map, normalMap: T.normalMap, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.52, metalness: 0.55, envMapIntensity: 0.95 })),
    shell: std({ color: "#ffffff", vertexColors: true, roughness: 0.26, metalness: 0.02, envMapIntensity: 0.85 }),
    visor: new THREE.MeshPhysicalMaterial({ color: "#e9b54d", metalness: 1, roughness: 0.06, envMap: visorEnv, envMapIntensity: 1.9, clearcoat: 0.35, clearcoatRoughness: 0.04 }),
    metal: std({ color: "#cfd2d8", roughness: 0.28, metalness: 0.92, envMapIntensity: 1.1 }),
    dark: std({ color: "#ffffff", vertexColors: true, roughness: 0.62, metalness: 0.15, envMapIntensity: 0.45 }),
    color: dirty(std({ color: "#ffffff", vertexColors: true, roughness: 0.5, metalness: 0.05, envMapIntensity: 0.45 })),
    // the launch suit's: the clear pressure bubble (a thin reflection, the face seen through it), skin
    bubble: bubbleMaterial(env),
    skin: std({ color: "#c99a7c", roughness: 0.62, metalness: 0, envMapIntensity: 0.25 }),
    decal: std({ map: suitDecalTexture(), alphaTest: 0.5, roughness: 0.72, metalness: 0, envMapIntensity: 0.35, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };
}
