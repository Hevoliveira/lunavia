import { useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/*
 * LC-39-style launch complex for LV-001 (scene units; the vehicle stands at
 * the origin, scale 0.6, about 3.6 units tall).
 *
 * Built procedurally and merged by material, so the whole complex costs a
 * dozen draw calls: mobile launcher deck over a flame hole, umbilical tower
 * with braced bays, grated floors, swing arms with umbilical hoses and a crew
 * access arm, hammerhead crane, tail service masts, hold-down arms, deluge
 * ring, concrete hardstand, crawlerway, propellant spheres with pipe runs,
 * water tower, lightning masts with catenary wires, lights and scale cues.
 */

const DECK_TOP = 0.18;
const TOWER_X = 1.55;
const TOWER_HALF = 0.25;
const TOWER_TOP = 4.7;
const BAY = 0.32;
const HOLE_R = 0.36; // flame hole in the hardstand under the engines

function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

function box(w, h, d, x, y, z, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

function strut(a, b, r, seg = 4) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const d = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  const m = A.add(B).multiplyScalar(0.5);
  g.translate(m.x, m.y, m.z);
  return g;
}

function cyl(rt, rb, h, x, y, z, seg = 16) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  g.translate(x, y, z);
  return g;
}

// Sagging hose between two points.
function hose(a, b, sag, r = 0.012) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const M = A.clone().add(B).multiplyScalar(0.5);
  M.y -= sag;
  const curve = new THREE.CatmullRomCurve3([A, M, B]);
  return new THREE.TubeGeometry(curve, 12, r, 6, false);
}

const merge = (list) => {
  const clean = list.map((g) => (g.index ? g : g));
  return mergeGeometries(clean, false);
};

/* ----------------------------- textures ----------------------------- */

function canvasTex(w, h, draw, { srgb = true, repeat = null } = {}) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
}

function makeTextures() {
  const r = rng(71);
  // Concrete hardstand: poured slabs, joints, stains and flame scorch.
  const concrete = canvasTex(1024, 1024, (ctx, W, H) => {
    ctx.fillStyle = "#77746c";
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 2200; i++) {
      const v = 120 + Math.floor(r() * 40);
      ctx.fillStyle = `rgba(${v},${v - 2},${v - 6},0.12)`;
      ctx.fillRect(r() * W, r() * H, 2 + r() * 10, 2 + r() * 10);
    }
    // Large poured slabs with soft, low-contrast joints
    ctx.strokeStyle = "rgba(60,58,54,0.22)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i <= 6; i++) {
      ctx.beginPath();
      ctx.moveTo((i * W) / 6, 0);
      ctx.lineTo((i * W) / 6, H);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, (i * H) / 6);
      ctx.lineTo(W, (i * H) / 6);
      ctx.stroke();
    }
    for (let i = 0; i < 70; i++) {
      const g = ctx.createRadialGradient(r() * W, r() * H, 0, r() * W, r() * H, 20 + r() * 90);
      g.addColorStop(0, "rgba(70,64,56,0.16)");
      g.addColorStop(1, "rgba(70,64,56,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    // Exhaust scorch around the flame hole
    const sc = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W * 0.22);
    sc.addColorStop(0, "rgba(28,24,20,0.85)");
    sc.addColorStop(1, "rgba(28,24,20,0)");
    ctx.fillStyle = sc;
    ctx.fillRect(0, 0, W, H);
  });
  // Steel deck plate: plates, weld seams, tread and grime.
  const deck = canvasTex(512, 512, (ctx, W, H) => {
    ctx.fillStyle = "#5a5c5f";
    ctx.fillRect(0, 0, W, H);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const v = 82 + Math.floor(r() * 18);
        ctx.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
        ctx.fillRect(x * 64 + 1, y * 64 + 1, 62, 62);
      }
    }
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    for (let i = 0; i < 4000; i++) ctx.fillRect(r() * W, r() * H, 2, 1);
    for (let i = 0; i < 30; i++) {
      const g = ctx.createRadialGradient(r() * W, r() * H, 0, r() * W, r() * H, 30 + r() * 60);
      g.addColorStop(0, "rgba(30,28,26,0.25)");
      g.addColorStop(1, "rgba(30,28,26,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }, { repeat: [3, 3] });
  // Grated floor: alpha-free dark grid read as bar grating.
  const grate = canvasTex(128, 128, (ctx, W, H) => {
    ctx.fillStyle = "#2a2b2d";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#8b8f94";
    for (let x = 0; x < W; x += 8) ctx.fillRect(x, 0, 2, H);
    for (let y = 0; y < H; y += 32) ctx.fillRect(0, y, W, 2);
  }, { repeat: [2, 2] });
  // Painted structural steel: grey with rust/grime variation (roughness map).
  const steelRough = canvasTex(256, 256, (ctx, W, H) => {
    ctx.fillStyle = "#7a7a7a";
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 900; i++) {
      const v = 90 + Math.floor(r() * 120);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(r() * W, r() * H, 1 + r() * 6, 1 + r() * 18);
    }
  }, { srgb: false, repeat: [4, 4] });
  const gravel = canvasTex(256, 256, (ctx, W, H) => {
    ctx.fillStyle = "#6c675c";
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 5000; i++) {
      const v = 80 + Math.floor(r() * 90);
      ctx.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
      ctx.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2);
    }
  }, { repeat: [1, 12] });
  return { concrete, deck, grate, steelRough, gravel };
}

/* ----------------------------- geometry ----------------------------- */

function buildComplex() {
  const steel = [];
  const steelDark = [];
  const grate = [];
  const deck = [];
  const hoses = [];
  const orange = [];
  const white = [];
  const tank = [];
  const lamp = [];
  const trench = [];
  const gravel = [];

  /* Mobile launcher deck: frame around a flame hole, on pedestals */
  const HOLE = 0.36;
  const D0 = DECK_TOP - 0.14;
  deck.push(box(1.3 - HOLE, 0.14, 2.4, -(HOLE + (1.3 - HOLE) / 2), D0 + 0.07, 0));
  deck.push(box(2.1 - HOLE, 0.14, 2.4, HOLE + (2.1 - HOLE) / 2, D0 + 0.07, 0));
  deck.push(box(HOLE * 2, 0.14, 1.2 - HOLE, 0, D0 + 0.07, HOLE + (1.2 - HOLE) / 2));
  deck.push(box(HOLE * 2, 0.14, 1.2 - HOLE, 0, D0 + 0.07, -(HOLE + (1.2 - HOLE) / 2)));
  // Flame hole walls and the trench below
  // Flame pit under the hole: four walls and a floor facing inward, open at the top
  const PIT_D = 0.8;
  const wall = (ry, x, z) => {
    const g = new THREE.PlaneGeometry(HOLE * 2, PIT_D);
    g.rotateY(ry);
    g.translate(x, DECK_TOP - PIT_D / 2, z);
    return g;
  };
  trench.push(wall(0, 0, -HOLE), wall(Math.PI, 0, HOLE), wall(Math.PI / 2, -HOLE, 0), wall(-Math.PI / 2, HOLE, 0));
  const floor = new THREE.PlaneGeometry(HOLE * 2, HOLE * 2);
  floor.rotateX(-Math.PI / 2);
  floor.translate(0, DECK_TOP - PIT_D, 0);
  trench.push(floor);
  // Flame trench runs west (−X) from the pit, across the camera side of the pad
  trench.push(box(3.6, 0.02, 0.9, -2.2, 0.012, 0));
  // Pedestals and girder edge
  [[-1.2, -1.1], [-1.2, 1.1], [2.0, -1.1], [2.0, 1.1], [0.4, -1.1], [0.4, 1.1]].forEach(([x, z]) =>
    steelDark.push(box(0.22, D0, 0.22, x, D0 / 2, z))
  );
  steelDark.push(box(3.4, 0.05, 0.06, 0.4, D0 + 0.02, 1.2));
  steelDark.push(box(3.4, 0.05, 0.06, 0.4, D0 + 0.02, -1.2));
  // Deck handrails (posts + rail) on the long edges
  [1.18, -1.18].forEach((z) => {
    steel.push(box(3.3, 0.008, 0.008, 0.4, DECK_TOP + 0.09, z));
    steel.push(box(3.3, 0.008, 0.008, 0.4, DECK_TOP + 0.05, z));
    for (let x = -1.25; x <= 2.05; x += 0.22) steel.push(box(0.008, 0.09, 0.008, x, DECK_TOP + 0.045, z));
  });
  // Deluge ring around the engines + spray headers
  steel.push(new THREE.TorusGeometry(0.42, 0.016, 8, 40).rotateX(Math.PI / 2).translate(0, DECK_TOP + 0.02, 0));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    steel.push(cyl(0.012, 0.012, 0.04, Math.cos(a) * 0.42, DECK_TOP + 0.05, Math.sin(a) * 0.42, 6));
  }
  // Hold-down arms (4) gripping the aft skirt
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * 0.36;
    const z = Math.sin(a) * 0.36;
    steelDark.push(box(0.12, 0.1, 0.09, x * 1.12, DECK_TOP + 0.05, z * 1.12, -a));
    steel.push(box(0.05, 0.05, 0.06, x * 0.92, DECK_TOP + 0.11, z * 0.92, -a));
    orange.push(box(0.02, 0.1, 0.092, x * 1.29, DECK_TOP + 0.05, z * 1.29, -a));
  }
  // Tail service masts with umbilical carriers
  [[0.52, 0.5], [0.52, -0.5]].forEach(([x, z]) => {
    steelDark.push(box(0.14, 0.42, 0.14, x, DECK_TOP + 0.21, z));
    steel.push(box(0.2, 0.06, 0.1, x - 0.06, DECK_TOP + 0.4, z));
    hoses.push(hose([x - 0.12, DECK_TOP + 0.38, z], [0.25, DECK_TOP + 0.3, z * 0.4], 0.05, 0.01));
  });
  // Deck equipment cabinets, stairs and a scale-cue service cart
  steelDark.push(box(0.3, 0.16, 0.18, -0.9, DECK_TOP + 0.08, 0.85));
  steelDark.push(box(0.22, 0.12, 0.3, -0.95, DECK_TOP + 0.06, -0.8));
  white.push(box(0.16, 0.1, 0.3, 1.0, DECK_TOP + 0.05, -0.85));
  for (let i = 0; i < 6; i++) steel.push(box(0.16, 0.012, 0.05, -1.32 - i * 0.045, DECK_TOP - 0.03 - i * 0.03, 0.6));

  /* Umbilical tower: corner columns, girts, X-bracing, grated floors */
  const T0 = DECK_TOP;
  const corners = [
    [TOWER_X - TOWER_HALF, -TOWER_HALF],
    [TOWER_X + TOWER_HALF, -TOWER_HALF],
    [TOWER_X + TOWER_HALF, TOWER_HALF],
    [TOWER_X - TOWER_HALF, TOWER_HALF],
  ];
  corners.forEach(([x, z]) => steel.push(box(0.05, TOWER_TOP - T0, 0.05, x, (TOWER_TOP + T0) / 2, z)));
  const levels = [];
  for (let y = T0; y <= TOWER_TOP + 1e-6; y += BAY) levels.push(y);
  levels.forEach((y, li) => {
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = corners[i];
      const [x1, z1] = corners[(i + 1) % 4];
      steel.push(strut([x0, y, z0], [x1, y, z1], 0.012));
      if (li < levels.length - 1) {
        const y1 = levels[li + 1];
        steel.push(strut([x0, y, z0], [x1, y1, z1], 0.007));
        steel.push(strut([x1, y, z1], [x0, y1, z0], 0.007));
      }
    }
    if (li % 2 === 1) {
      grate.push(box(TOWER_HALF * 2 + 0.16, 0.015, TOWER_HALF * 2 + 0.16, TOWER_X, y, 0));
      // Handrail around each work floor
      [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dx, dz]) => {
        const L = TOWER_HALF * 2 + 0.16;
        steel.push(box(dx ? 0.006 : L, 0.006, dz ? 0.006 : L, TOWER_X + dx * (L / 2), y + 0.07, dz * (L / 2)));
      });
    }
  });
  // Elevator shaft + machine house, accent band, lightning mast
  steelDark.push(box(0.16, TOWER_TOP - T0, 0.16, TOWER_X + 0.1, (TOWER_TOP + T0) / 2, 0.08));
  steelDark.push(box(0.6, 0.22, 0.6, TOWER_X, TOWER_TOP + 0.11, 0));
  orange.push(box(0.62, 0.035, 0.62, TOWER_X, TOWER_TOP + 0.24, 0));
  steel.push(cyl(0.012, 0.022, 1.1, TOWER_X, TOWER_TOP + 0.8, 0, 6));
  // Hammerhead crane: boom over the vehicle, counter-jib, cab, counterweight, hook
  steel.push(box(1.7, 0.06, 0.08, TOWER_X - 0.55, TOWER_TOP + 0.3, 0));
  steel.push(strut([TOWER_X, TOWER_TOP + 0.56, 0], [TOWER_X - 1.35, TOWER_TOP + 0.33, 0], 0.008));
  steel.push(strut([TOWER_X, TOWER_TOP + 0.56, 0], [TOWER_X + 0.3, TOWER_TOP + 0.33, 0], 0.008));
  steel.push(box(0.04, 0.3, 0.04, TOWER_X, TOWER_TOP + 0.42, 0));
  steelDark.push(box(0.2, 0.16, 0.16, TOWER_X + 0.28, TOWER_TOP + 0.22, 0));
  white.push(box(0.12, 0.08, 0.1, TOWER_X - 0.25, TOWER_TOP + 0.22, 0.08));
  orange.push(box(0.1, 0.07, 0.1, TOWER_X - 1.35, TOWER_TOP + 0.3, 0));
  steel.push(cyl(0.003, 0.003, 0.45, TOWER_X - 1.2, TOWER_TOP + 0.05, 0, 4));

  /* Swing arms at the vehicle stations, each a small truss with hoses */
  const faceX = TOWER_X - TOWER_HALF;
  const arms = [
    { y: 0.63, reach: 0.28, hoses: 2 },
    { y: 1.48, reach: 0.27, hoses: 2 },
    { y: 1.78, reach: 0.25, hoses: 1 },
    { y: 2.27, reach: 0.22, hoses: 2 },
    { y: 2.86, reach: 0.2, hoses: 1 },
  ];
  arms.forEach(({ y, reach, hoses: n }) => {
    const x1 = reach + 0.06;
    [-0.045, 0.045].forEach((dz) => {
      steel.push(strut([faceX, y, dz], [x1, y, dz], 0.008));
      steel.push(strut([faceX, y + 0.07, dz], [x1, y + 0.07, dz], 0.008));
      const N = 5;
      for (let k = 0; k < N; k++) {
        const xa = faceX + ((x1 - faceX) * k) / N;
        const xb = faceX + ((x1 - faceX) * (k + 1)) / N;
        steel.push(strut([xa, y, dz], [xb, y + 0.07, dz], 0.004));
      }
    });
    orange.push(box(0.03, 0.08, 0.11, x1, y + 0.035, 0));
    for (let h = 0; h < n; h++) {
      const dz = n === 1 ? 0 : (h - 0.5) * 0.05;
      hoses.push(hose([faceX - 0.05, y - 0.01, dz], [reach + 0.01, y + 0.02, dz * 0.5], 0.09 + 0.03 * h, 0.011));
    }
  });
  // Crew access arm + white room at the spacecraft hatch
  const cy = 3.12;
  steel.push(box(faceX - 0.36, 0.015, 0.14, (faceX + 0.36) / 2, cy - 0.065, 0));
  white.push(box(faceX - 0.4, 0.11, 0.12, (faceX + 0.4) / 2 + 0.02, cy, 0));
  white.push(box(0.16, 0.16, 0.18, 0.3, cy + 0.01, 0));
  orange.push(box(0.008, 0.02, 0.122, 0.62, cy + 0.03, 0));

  /* Ground: hardstand, crawlerway, pipe runs, propellant farm, water tower */
  gravel.push(box(0.55, 0.01, 22, -0.55, 0.006, -11.2));
  gravel.push(box(0.55, 0.01, 22, 0.55, 0.006, -11.2));
  // Propellant spheres on leg supports + insulated pipe runs to the pad
  [[3.9, -3.4, 0.6], [4.8, -2.1, 0.48]].forEach(([x, z, rr]) => {
    const g = new THREE.SphereGeometry(rr, 28, 20);
    g.translate(x, rr + 0.32, z);
    tank.push(g);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      steelDark.push(strut([x + Math.cos(a) * rr * 0.92, rr * 0.75 + 0.32, z + Math.sin(a) * rr * 0.92], [x + Math.cos(a) * rr * 1.05, 0, z + Math.sin(a) * rr * 1.05], 0.018, 5));
    }
    steel.push(new THREE.TorusGeometry(rr * 0.96, 0.012, 6, 32).rotateX(Math.PI / 2).translate(x, rr * 0.75 + 0.32, z));
    steel.push(strut([x - rr, 0.08, z], [0.9, 0.08, -0.9], 0.03, 8));
  });
  // Water tower with braced legs
  const W = [-4.2, -3.6];
  const legs = [[0.38, 0.38], [-0.38, 0.38], [-0.38, -0.38], [0.38, -0.38]];
  legs.forEach(([dx, dz], i) => {
    steelDark.push(strut([W[0] + dx, 0, W[1] + dz], [W[0] + dx * 0.7, 1.45, W[1] + dz * 0.7], 0.03, 5));
    const [ex, ez] = legs[(i + 1) % 4];
    steel.push(strut([W[0] + dx * 0.9, 0.45, W[1] + dz * 0.9], [W[0] + ex * 0.8, 1.0, W[1] + ez * 0.8], 0.01));
    steel.push(strut([W[0] + ex * 0.9, 0.45, W[1] + ez * 0.9], [W[0] + dx * 0.8, 1.0, W[1] + dz * 0.8], 0.01));
  });
  const wt = new THREE.SphereGeometry(0.75, 28, 20);
  wt.scale(1, 0.8, 1);
  wt.translate(W[0], 1.95, W[1]);
  tank.push(wt);
  // Service buildings and vehicles (scale cues)
  steelDark.push(box(1.4, 0.45, 0.8, -3.6, 0.225, 2.6));
  white.push(box(1.42, 0.03, 0.82, -3.6, 0.46, 2.6));
  [[-2.4, 1.6, 0.3], [2.8, 1.4, -0.4]].forEach(([x, z, ry]) => {
    white.push(box(0.16, 0.13, 0.14, x, 0.085, z, ry));
    steelDark.push(box(0.36, 0.12, 0.15, x - Math.cos(ry) * 0.27, 0.08, z + Math.sin(ry) * 0.27, ry));
    orange.push(box(0.17, 0.015, 0.145, x, 0.155, z, ry));
  });
  // Lightning masts and catenary wires to the tower top
  const masts = [[-2.5, -1.5], [2.5, -2.0], [-1.5, 2.5]];
  masts.forEach(([x, z]) => {
    steel.push(cyl(0.025, 0.045, 4.4, x, 2.2, z, 8));
    steel.push(strut([x, 4.35, z], [TOWER_X, TOWER_TOP + 1.3, 0], 0.003, 3));
  });
  // Pad flood lights
  [[-2.0, 2.0], [3.0, 1.2], [2.6, -2.8]].forEach(([x, z]) => {
    steelDark.push(cyl(0.02, 0.03, 1.4, x, 0.7, z, 6));
    steelDark.push(box(0.18, 0.08, 0.06, x, 1.42, z));
    lamp.push(box(0.15, 0.05, 0.02, x, 1.42, z + 0.035));
  });

  return {
    steel: merge(steel),
    steelDark: merge(steelDark),
    grate: merge(grate),
    deck: merge(deck),
    hoses: merge(hoses),
    orange: merge(orange),
    white: merge(white),
    tank: merge(tank),
    lamp: merge(lamp),
    trench: merge(trench),
    gravel: merge(gravel),
  };
}

export default function LaunchComplex({ progRef, anisotropy = 1 }) {
  const rootRef = useRef();
  const groundRef = useRef();
  const res = useMemo(() => {
    const tex = makeTextures();
    const geo = buildComplex();
    const mat = {
      steel: new THREE.MeshStandardMaterial({ color: "#9aa0a6", roughness: 0.55, roughnessMap: tex.steelRough, metalness: 0.65 }),
      steelDark: new THREE.MeshStandardMaterial({ color: "#4d5257", roughness: 0.6, roughnessMap: tex.steelRough, metalness: 0.55 }),
      grate: new THREE.MeshStandardMaterial({ map: tex.grate, roughness: 0.6, metalness: 0.5 }),
      deck: new THREE.MeshStandardMaterial({ map: tex.deck, roughness: 0.7, metalness: 0.45 }),
      hoses: new THREE.MeshStandardMaterial({ color: "#151516", roughness: 0.75, metalness: 0.05 }),
      orange: new THREE.MeshStandardMaterial({ color: "#FF3B00", roughness: 0.5, metalness: 0.15 }),
      white: new THREE.MeshStandardMaterial({ color: "#e6e5e0", roughness: 0.55, metalness: 0.1 }),
      tank: new THREE.MeshStandardMaterial({ color: "#cfd2d4", roughness: 0.5, roughnessMap: tex.steelRough, metalness: 0.35 }),
      lamp: new THREE.MeshStandardMaterial({ color: "#fff6dc", emissive: "#fff2c8", emissiveIntensity: 1.4 }),
      trench: new THREE.MeshStandardMaterial({ color: "#100e0c", roughness: 1 }),
      gravel: new THREE.MeshStandardMaterial({ map: tex.gravel, roughness: 1 }),
      concrete: new THREE.MeshStandardMaterial({ map: tex.concrete, roughness: 0.92 }),
      ground: new THREE.MeshStandardMaterial({ color: "#3a3628", roughness: 1, transparent: true }),
    };
    return { tex, geo, mat };
  }, []);

  useEffect(() => {
    Object.values(res.tex).forEach((t) => {
      t.anisotropy = anisotropy;
      t.needsUpdate = true;
    });
  }, [res, anisotropy]);

  useEffect(
    () => () => {
      Object.values(res.geo).forEach((g) => g.dispose());
      Object.values(res.mat).forEach((m) => m.dispose());
      Object.values(res.tex).forEach((t) => t.dispose());
    },
    [res]
  );

  useFrame(() => {
    const p = progRef.current;
    // Pad structures stay behind once the vehicle is high — cut them so they
    // don't float over the planet limb.
    if (rootRef.current) rootRef.current.visible = p < 0.3;
    if (groundRef.current) groundRef.current.opacity = 1 - THREE.MathUtils.smoothstep(p, 0.05, 0.16);
  });

  const { geo, mat } = res;
  groundRef.current = mat.ground;
  const caster = (g, m) => <mesh geometry={g} material={m} castShadow receiveShadow />;
  return (
    <group ref={rootRef}>
      {/* Surrounding terrain (fades as the curved planet takes over) and hardstand */}
      {/* Both open over the flame hole, so the engine bells hang into the pit */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0, 0]} material={mat.ground} receiveShadow>
        <ringGeometry args={[HOLE_R, 26, 48, 1]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} material={mat.concrete} receiveShadow>
        <ringGeometry args={[HOLE_R, 6.2, 8, 1]} />
      </mesh>
      {caster(geo.deck, mat.deck)}
      {caster(geo.steel, mat.steel)}
      {caster(geo.steelDark, mat.steelDark)}
      {caster(geo.grate, mat.grate)}
      {caster(geo.hoses, mat.hoses)}
      {caster(geo.orange, mat.orange)}
      {caster(geo.white, mat.white)}
      {caster(geo.tank, mat.tank)}
      <mesh geometry={geo.lamp} material={mat.lamp} />
      <mesh geometry={geo.trench} material={mat.trench} />
      <mesh geometry={geo.gravel} material={mat.gravel} receiveShadow />
    </group>
  );
}
