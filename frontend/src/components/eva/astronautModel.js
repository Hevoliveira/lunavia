/*
 * LUNAVIA — the astronaut's suit as geometry (built once, in metres, on the rig's segments:
 * data/astronautRig). A lunar surface suit after the Apollo A7L: white Beta-cloth outer layer
 * with bellows ("convolute") joints at the shoulders, elbows and knees, a hard helmet shell over
 * the bubble with the gold sun visor down, the life-support backpack with the oxygen purge unit on
 * top, the chest control unit with the camera on its bracket, the oxygen hoses round to the front,
 * metal-weave gloves and overboots with blue silicone soles — and LUNAVIA's orange commander bands.
 *
 * Every segment's parts are merged per material: a couple of dozen draw calls for the whole
 * astronaut, a few thousand triangles.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { BODY } from "@/data/astronautRig";

const lathe = (pts, seg = 18, sz = 1) => {
  const g = new THREE.LatheGeometry(
    pts.map(([r, y]) => new THREE.Vector2(r, y)),
    seg
  );
  if (sz !== 1) g.scale(1, 1, sz);
  return g;
};
const ring = (r, tube, y, seg = 18) => new THREE.TorusGeometry(r, tube, 6, seg).rotateX(Math.PI / 2).translate(0, y, 0);
const band = (r0, r1, h, y, seg = 18) => new THREE.CylinderGeometry(r1, r0, h, seg, 1, true).translate(0, y, 0);
const rbox = (w, h, d, r, x, y, z) => new RoundedBoxGeometry(w, h, d, 2, r).translate(x, y, z);
const cyl = (r, h, seg = 12) => new THREE.CylinderGeometry(r, r, h, seg);
const tube = (pts, r) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 18, r, 7, false);

/** Drop the attributes a merge cannot mix and merge (positions, normals, uvs). */
function merged(list) {
  const clean = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (!["position", "normal", "uv"].includes(k)) n.deleteAttribute(k);
    if (!n.attributes.uv) n.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((n.attributes.position.count * 2) | 0), 2));
    return n;
  });
  const out = mergeGeometries(clean, false);
  out.computeBoundingSphere();
  return out;
}

/* ---- each segment ---------------------------------------------------------------------------- */
function pelvis() {
  const suit = [
    lathe(
      [
        [0, 0.13],
        [0.19, 0.12],
        [0.205, 0.05],
        [0.2, -0.03],
        [0.17, -0.09],
        [0.11, -0.135],
        [0, -0.145],
      ],
      20,
      0.76
    ),
  ];
  // the sample bag on the left hip and the tether ring it hangs from
  const dark = [rbox(0.1, 0.13, 0.07, 0.02, 0.215, -0.01, 0.07)];
  const metal = [new THREE.TorusGeometry(0.022, 0.005, 5, 12).rotateY(Math.PI / 2).translate(0.215, 0.07, 0.07)];
  return { suit, dark, metal };
}

function torso() {
  const suit = [
    lathe(
      [
        [0, -0.06],
        [0.18, -0.055],
        [0.2, 0.05],
        [0.232, 0.2],
        [0.248, 0.34],
        [0.244, 0.43],
        [0.212, 0.5],
        [0.155, 0.545],
        [0.115, 0.555],
        [0, 0.556],
      ],
      22,
      0.68
    ),
    // the waist's bellows
    ring(0.19, 0.012, 0.0, 22).scale(1, 1, 0.72),
    ring(0.195, 0.012, 0.035, 22).scale(1, 1, 0.72),
  ];
  // the backpack (life support) and the oxygen purge unit on top, in their white covers
  const pack = [rbox(0.5, 0.62, 0.22, 0.045, 0, 0.3, -0.29), rbox(0.46, 0.16, 0.2, 0.04, 0, 0.7, -0.275)];
  const dark = [
    // the chest control unit's face, the camera's body and lens, the backpack's straps
    rbox(0.2, 0.11, 0.08, 0.012, 0, 0.42, 0.19),
    cyl(0.03, 0.035, 16).rotateX(Math.PI / 2).translate(0, 0.31, 0.27),
    rbox(0.05, 0.42, 0.02, 0.008, 0.17, 0.33, 0.135).rotateZ(0.0),
    rbox(0.05, 0.42, 0.02, 0.008, -0.17, 0.33, 0.135),
  ];
  const metal = [
    // camera body (silver), its bracket; the control unit's knobs; the hose connectors; the antenna
    rbox(0.09, 0.085, 0.07, 0.01, 0, 0.31, 0.225),
    cyl(0.012, 0.05).rotateX(Math.PI / 2).translate(0, 0.36, 0.2),
    cyl(0.014, 0.025).rotateX(Math.PI / 2).translate(0.06, 0.44, 0.235),
    cyl(0.014, 0.025).rotateX(Math.PI / 2).translate(-0.06, 0.44, 0.235),
    cyl(0.01, 0.02).rotateX(Math.PI / 2).translate(0.02, 0.44, 0.235),
    cyl(0.022, 0.04).rotateX(Math.PI / 2).translate(0.09, 0.14, 0.15),
    cyl(0.022, 0.04).rotateX(Math.PI / 2).translate(-0.09, 0.14, 0.15),
    cyl(0.022, 0.04).rotateX(Math.PI / 2).translate(0.14, 0.2, 0.14),
    cyl(0.022, 0.04).rotateX(Math.PI / 2).translate(-0.14, 0.2, 0.14),
    cyl(0.005, 0.28, 6).translate(0.19, 0.92, -0.32),
    // the purge unit's valve and the backpack's control box on its side
    cyl(0.03, 0.05).rotateZ(Math.PI / 2).translate(0.25, 0.7, -0.24),
  ];
  const blue = [
    tube(
      [
        [0.09, 0.14, 0.17],
        [0.2, 0.12, 0.13],
        [0.265, 0.1, -0.02],
        [0.235, 0.08, -0.17],
        [0.17, 0.06, -0.21],
      ],
      0.019
    ),
    tube(
      [
        [-0.14, 0.2, 0.16],
        [-0.24, 0.17, 0.11],
        [-0.275, 0.13, -0.03],
        [-0.24, 0.1, -0.18],
        [-0.17, 0.07, -0.21],
      ],
      0.019
    ),
  ];
  const red = [
    tube(
      [
        [-0.09, 0.14, 0.17],
        [-0.2, 0.12, 0.13],
        [-0.265, 0.1, -0.02],
        [-0.235, 0.08, -0.17],
        [-0.17, 0.06, -0.21],
      ],
      0.019
    ),
    tube(
      [
        [0.14, 0.2, 0.16],
        [0.24, 0.17, 0.11],
        [0.275, 0.13, -0.03],
        [0.24, 0.1, -0.18],
        [0.17, 0.07, -0.21],
      ],
      0.019
    ),
  ];
  // the helmet: the shell over the bubble, the gold visor down, the neck ring; the orange band
  const H = BODY.helmet;
  const R = BODY.helmetR;
  const front = Math.PI / 2; // three.js sphere: phi = π/2 faces +z
  const half = 1.22;
  const shellG = [
    new THREE.SphereGeometry(R, 26, 16, front + half, Math.PI * 2 - 2 * half, 0, 2.3),
    new THREE.SphereGeometry(R, 14, 4, front - half, 2 * half, 0, 0.62),
    new THREE.SphereGeometry(R, 14, 3, front - half, 2 * half, 1.86, 0.44),
  ].map((g) => g.translate(H[0], H[1], H[2]));
  const visor = [new THREE.SphereGeometry(R + 0.004, 22, 12, front - half - 0.02, 2 * half + 0.04, 0.6, 1.28).translate(H[0], H[1], H[2])];
  metal.push(ring(0.135, 0.022, H[1] - 0.125, 24).translate(0, 0, H[2]));
  // over the top from the back to the visor's upper edge
  const accent = [new THREE.TorusGeometry(R + 0.003, 0.012, 5, 24, Math.PI / 2 + 0.58).rotateY(Math.PI / 2).translate(H[0], H[1], H[2])];
  return { suit, pack, dark, metal, blue, red, shell: shellG, visor, accent };
}

function thigh() {
  return {
    suit: [
      lathe(
        [
          [0, 0.05],
          [0.1, 0.04],
          [0.112, -0.04],
          [0.103, -0.2],
          [0.09, -0.36],
          [0.084, -0.44],
          [0, -0.45],
        ],
        16
      ),
    ],
  };
}

function shin(dusty = true) {
  const key = dusty ? "dusty" : "suit";
  return {
    [key]: [
      lathe(
        [
          [0, 0.03],
          [0.085, 0.03],
          [0.086, -0.05],
          [0.077, -0.22],
          [0.07, -0.3],
          [0, -0.31],
        ],
        16
      ),
      // the knee's bellows
      ring(0.086, 0.013, 0.02, 16),
      ring(0.087, 0.013, -0.015, 16),
      ring(0.085, 0.012, -0.05, 16),
    ],
    // the overboot's shaft round the lower leg
    boot: [band(0.088, 0.083, 0.2, -0.36, 16), ring(0.086, 0.01, -0.26, 16)],
  };
}

function boot(side) {
  // the overboot: a side profile extruded across the foot, on a ribbed blue sole
  const prof = [
    [-0.095, -0.075],
    [0.235, -0.075],
    [0.262, -0.055],
    [0.25, -0.03],
    [0.19, -0.01],
    [0.07, 0.025],
    [0.035, 0.08],
    [-0.075, 0.085],
    [-0.105, 0.0],
  ];
  const shape = new THREE.Shape(prof.map(([z, y]) => new THREE.Vector2(z, y)));
  const body = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.014, bevelSegments: 2, curveSegments: 4 });
  body.rotateY(-Math.PI / 2).translate(0.06, 0, 0); // profile in ZY, across X
  body.translate(side * 0.005, 0, 0);
  const sole = [rbox(0.15, 0.03, 0.375, 0.008, side * 0.005, -0.085, 0.078)];
  for (let i = 0; i < 7; i++) sole.push(rbox(0.14, 0.008, 0.012, 0.003, side * 0.005, -0.1, -0.08 + i * 0.05));
  return { boot: [body], blue: sole, metal: [rbox(0.135, 0.02, 0.03, 0.006, side * 0.005, 0.02, -0.07)] };
}

function upperArm(side) {
  return {
    suit: [
      lathe(
        [
          [0, 0.06],
          [0.085, 0.05],
          [0.089, -0.02],
          [0.079, -0.15],
          [0.069, -0.29],
          [0, -0.3],
        ],
        16
      ),
      // the shoulder's bellows
      ring(0.09, 0.013, 0.02, 16),
      ring(0.09, 0.013, -0.015, 16),
    ],
    accent: [band(0.083, 0.08, 0.034, -0.11, 16)],
    _side: side,
  };
}

function forearm(side) {
  return {
    suit: [
      lathe(
        [
          [0, 0.03],
          [0.07, 0.03],
          [0.068, -0.05],
          [0.06, -0.2],
          [0.054, -0.25],
          [0, -0.255],
        ],
        14
      ),
      ring(0.07, 0.012, 0.015, 14),
      ring(0.07, 0.012, -0.018, 14),
    ],
    // the wrist disconnect (blue on the left, red on the right)
    metal: [ring(0.058, 0.012, -0.258, 14)],
    [side > 0 ? "blue" : "red"]: [band(0.062, 0.062, 0.016, -0.24, 14)],
  };
}

function hand(side) {
  // the gauntlet and the palm; the fingers are their own part (they curl with the grip)
  const palmN = -side; // the palm faces the body's midline: -x for the left hand, +x for the right
  return {
    glove: [band(0.066, 0.056, 0.07, -0.03, 14), rbox(0.05, 0.1, 0.09, 0.022, palmN * 0.004, -0.11, 0.0), rbox(0.03, 0.06, 0.025, 0.012, palmN * 0.012, -0.1, 0.05).rotateX(-0.4)],
  };
}
function fingers(side) {
  // four fingers from the knuckle line (the part's origin), blue silicone tips
  const palmN = -side;
  const glove = [];
  const blue = [];
  for (let i = 0; i < 4; i++) {
    const z = 0.03 - i * 0.02;
    const len = [0.06, 0.07, 0.066, 0.052][i];
    glove.push(new THREE.CapsuleGeometry(0.0105, len, 3, 7).translate(palmN * 0.004, -len / 2 - 0.006, z));
    blue.push(new THREE.SphereGeometry(0.0118, 7, 5).translate(palmN * 0.004, -len - 0.008, z));
  }
  return { glove, blue };
}

function scoop() {
  // the long-handled sample scoop: handle along -z from the grip (origin) to the pan
  const metal = [cyl(0.011, 0.86, 8).rotateX(Math.PI / 2).translate(0, 0, 0.43), rbox(0.075, 0.025, 0.09, 0.008, 0, -0.01, 0.89)];
  const dark = [cyl(0.016, 0.13, 8).rotateX(Math.PI / 2).translate(0, 0, 0.07)];
  return { metal, dark };
}

let GEO = null;
/** { segment: { material: BufferGeometry } } plus fingersL/R and the scoop. */
export function astronautGeometry() {
  if (GEO) return GEO;
  const build = (o) => {
    const out = {};
    for (const [k, list] of Object.entries(o)) if (Array.isArray(list)) out[k] = merged(list);
    return out;
  };
  GEO = {
    pelvis: build(pelvis()),
    torso: build(torso()),
    thighL: build(thigh()),
    thighR: build(thigh()),
    shinL: build(shin()),
    shinR: build(shin()),
    footL: build(boot(1)),
    footR: build(boot(-1)),
    upperArmL: build(upperArm(1)),
    upperArmR: build(upperArm(-1)),
    forearmL: build(forearm(1)),
    forearmR: build(forearm(-1)),
    handL: build(hand(1)),
    handR: build(hand(-1)),
    fingersL: build(fingers(1)),
    fingersR: build(fingers(-1)),
    scoop: build(scoop()),
  };
  return GEO;
}

/* ---- materials --------------------------------------------------------------------------------- */
let TEX = null;
function fabric() {
  if (TEX) return TEX;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#e9e6df";
  g.fillRect(0, 0, 128, 128);
  // a close weave, a few seams, faint scuffs
  for (let y = 0; y < 128; y += 2) {
    g.fillStyle = y % 4 ? "rgba(255,255,255,0.18)" : "rgba(120,115,105,0.12)";
    g.fillRect(0, y, 128, 1);
  }
  for (let x = 0; x < 128; x += 2) {
    g.fillStyle = x % 4 ? "rgba(255,255,255,0.12)" : "rgba(120,115,105,0.1)";
    g.fillRect(x, 0, 1, 128);
  }
  g.fillStyle = "rgba(90,86,78,0.35)";
  g.fillRect(0, 63, 128, 1.5);
  g.fillRect(31, 0, 1.2, 128);
  let s = 11;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(110,104,94,${0.04 + r() * 0.08})`;
    g.beginPath();
    g.arc(r() * 128, r() * 128, 1 + r() * 4, 0, Math.PI * 2);
    g.fill();
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(3, 3);
  map.anisotropy = 4;
  const bump = new THREE.CanvasTexture(c);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.repeat.set(3, 3);
  TEX = { map, bump };
  return TEX;
}

/** The suit's materials for a renderer's environment map (data/LanderModel lunarEnv). */
export function astronautMaterials(env) {
  const T = fabric();
  const std = (o) => new THREE.MeshStandardMaterial({ envMap: env, ...o });
  return {
    suit: std({ color: "#ece9e2", map: T.map, bumpMap: T.bump, bumpScale: 0.6, roughness: 0.92, metalness: 0, envMapIntensity: 0.32 }),
    pack: std({ color: "#e3e0d8", map: T.map, bumpMap: T.bump, bumpScale: 0.5, roughness: 0.9, metalness: 0, envMapIntensity: 0.3 }),
    // the lower legs and boots take the dust (data: the walk's distance darkens them)
    dusty: std({ color: "#e3ded4", map: T.map, bumpMap: T.bump, bumpScale: 0.6, roughness: 0.95, metalness: 0, envMapIntensity: 0.28 }),
    boot: std({ color: "#c9c8c2", map: T.map, bumpMap: T.bump, bumpScale: 0.8, roughness: 0.75, metalness: 0.35, envMapIntensity: 0.6 }),
    glove: std({ color: "#b9bcc0", map: T.map, bumpMap: T.bump, bumpScale: 0.8, roughness: 0.55, metalness: 0.6, envMapIntensity: 0.9 }),
    shell: std({ color: "#f3f1ec", roughness: 0.34, metalness: 0.02, envMapIntensity: 0.75 }),
    visor: new THREE.MeshPhysicalMaterial({ color: "#e6b452", metalness: 1, roughness: 0.05, envMap: env, envMapIntensity: 2.4, clearcoat: 1, clearcoatRoughness: 0.03 }),
    metal: std({ color: "#c9ccd2", roughness: 0.3, metalness: 0.9, envMapIntensity: 1 }),
    dark: std({ color: "#2b2c30", roughness: 0.6, metalness: 0.2, envMapIntensity: 0.4 }),
    blue: std({ color: "#3a62a0", roughness: 0.55, metalness: 0.05, envMapIntensity: 0.4 }),
    red: std({ color: "#b63a2c", roughness: 0.55, metalness: 0.05, envMapIntensity: 0.4 }),
    accent: std({ color: "#e24a1c", roughness: 0.6, metalness: 0.05, envMapIntensity: 0.4 }),
  };
}
