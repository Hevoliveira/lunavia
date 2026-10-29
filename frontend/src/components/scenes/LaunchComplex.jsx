import { useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildSite } from "./launchSite";

/*
 * LC-39-style launch complex for LV-001 (scene units; the vehicle stands at
 * the origin, scale 0.6, about 3.6 units tall).
 *
 * Built procedurally and merged by material, so the whole complex costs a
 * dozen draw calls: mobile launcher deck over a flame hole, umbilical tower
 * with braced bays, grated floors, swing arms with umbilical hoses and a crew
 * access arm, hammerhead crane, tail service masts, hold-down arms, deluge
 * ring, lightning masts with catenary wires, lights and scale cues. The ground
 * around it (the raised hardstand, the flame trench and deflector, the land,
 * roads, propellant farms, buildings and the coast) is launchSite.js.
 */

const DECK_TOP = 0.18;
const TOWER_X = 1.55;
const TOWER_HALF = 0.25;
const TOWER_TOP = 4.7;
const BAY = 0.32;

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
    // Poured slabs (about 7 m) with sawn joints, a few slabs a shade darker
    for (let i = 0; i < 160; i++) {
      const sx = Math.floor(r() * 52);
      const sy = Math.floor(r() * 52);
      ctx.fillStyle = `rgba(${r() < 0.5 ? "60,58,52" : "150,146,138"},0.07)`;
      ctx.fillRect((sx * W) / 52, (sy * H) / 52, W / 52, H / 52);
    }
    ctx.strokeStyle = "rgba(52,50,46,0.28)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 52; i++) {
      ctx.beginPath();
      ctx.moveTo((i * W) / 52, 0);
      ctx.lineTo((i * W) / 52, H);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, (i * H) / 52);
      ctx.lineTo(W, (i * H) / 52);
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
  return { concrete, deck, grate, steelRough };
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
  const lamp = [];

  /* Mobile launcher deck: frame around a flame hole, on pedestals */
  const HOLE = 0.36;
  const D0 = DECK_TOP - 0.14;
  deck.push(box(1.3 - HOLE, 0.14, 2.4, -(HOLE + (1.3 - HOLE) / 2), D0 + 0.07, 0));
  deck.push(box(2.1 - HOLE, 0.14, 2.4, HOLE + (2.1 - HOLE) / 2, D0 + 0.07, 0));
  deck.push(box(HOLE * 2, 0.14, 1.2 - HOLE, 0, D0 + 0.07, HOLE + (1.2 - HOLE) / 2));
  deck.push(box(HOLE * 2, 0.14, 1.2 - HOLE, 0, D0 + 0.07, -(HOLE + (1.2 - HOLE) / 2)));
  // Pedestals and girder edge
  [[-1.2, -1.1], [-1.2, 1.1], [2.0, -1.1], [2.0, 1.1], [0.4, -1.1], [0.4, 1.1]].forEach(([x, z]) => {
    steelDark.push(box(0.22, D0, 0.22, x, D0 / 2, z));
    white.push(box(0.34, 0.012, 0.34, x, 0.006, z)); // the pad's mount footing
  });
  // The launcher's base seen from the side: two storeys of plated girders, doors and vents
  [1.2, -1.2].forEach((z) => {
    for (let x = -1.2; x <= 2.0; x += 0.2) steelDark.push(box(0.016, 0.13, 0.01, x, D0 + 0.07, z + Math.sign(z) * 0.004));
    steelDark.push(box(3.4, 0.012, 0.012, 0.4, D0 + 0.072, z + Math.sign(z) * 0.006));
    [-0.7, 0.9, 1.6].forEach((x) => white.push(box(0.07, 0.045, 0.006, x, D0 + 0.035, z + Math.sign(z) * 0.006)));
  });
  [-1.3, 2.1].forEach((x) => {
    for (let z = -1.0; z <= 1.0; z += 0.25) steelDark.push(box(0.01, 0.13, 0.016, x + Math.sign(x - 0.4) * 0.004, D0 + 0.07, z));
  });
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
    const c = Math.cos(a);
    const s = Math.sin(a);
    const at = (r, y) => [c * r, DECK_TOP + y, s * r];
    // base casting bolted to the deck, the hinged arm leaning in, and the clamp over the skirt
    steelDark.push(box(0.15, 0.045, 0.12, c * 0.45, DECK_TOP + 0.022, s * 0.45, -a));
    steelDark.push(box(0.1, 0.07, 0.085, c * 0.42, DECK_TOP + 0.08, s * 0.42, -a));
    steel.push(strut(at(0.46, 0.05), at(0.35, 0.13), 0.022, 6));
    steel.push(strut(at(0.47, 0.06), at(0.38, 0.15), 0.01, 5));
    steelDark.push(box(0.06, 0.04, 0.07, c * 0.335, DECK_TOP + 0.135, s * 0.335, -a));
    steelDark.push(box(0.016, 0.06, 0.088, c * 0.505, DECK_TOP + 0.05, s * 0.505, -a));
    hoses.push(hose([c * 0.5, DECK_TOP + 0.02, s * 0.5 + 0.03], [c * 0.4, DECK_TOP + 0.1, s * 0.4 + 0.03], 0.02, 0.006));
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
  const ARM_Y = 3.12; // the crew access arm's level (below)
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
  // Service piping up the tower's back corner (away from the vehicle), clamped at every floor
  const PX = TOWER_X + TOWER_HALF + 0.035;
  [[0, 0.018], [0.045, 0.014], [0.085, 0.012]].forEach(([dz, r]) => {
    steel.push(cyl(r, r, TOWER_TOP - 0.3 - T0, PX, (TOWER_TOP - 0.3 + T0) / 2, -TOWER_HALF + 0.02 + dz, 8));
  });
  levels.forEach((y) => steelDark.push(box(0.05, 0.012, 0.13, PX - 0.01, y + 0.05, -TOWER_HALF + 0.065)));
  // the cable tray up the other back corner
  steelDark.push(box(0.012, TOWER_TOP - T0 - 0.2, 0.06, PX - 0.02, (TOWER_TOP - 0.2 + T0) / 2, TOWER_HALF - 0.02));
  // equipment rooms on some floors (back half of the floor, clear of the swing arms' face)
  [3, 5, 7, 11].forEach((li) => {
    const y = levels[li];
    if (y === undefined) return;
    white.push(box(0.2, 0.16, 0.26, TOWER_X + 0.12, y + 0.09, -0.06));
    steelDark.push(box(0.21, 0.012, 0.27, TOWER_X + 0.12, y + 0.176, -0.06));
  });
  // stair flights zig-zagging up the north face
  for (let li = 0; li < levels.length - 1; li++) {
    const y = levels[li];
    const dir = li % 2 ? 1 : -1;
    steel.push(strut([TOWER_X - dir * 0.18, y + 0.01, -TOWER_HALF - 0.045], [TOWER_X + dir * 0.18, y + BAY - 0.01, -TOWER_HALF - 0.045], 0.012, 4));
    steel.push(strut([TOWER_X - dir * 0.18, y + 0.06, -TOWER_HALF - 0.075], [TOWER_X + dir * 0.18, y + BAY + 0.05, -TOWER_HALF - 0.075], 0.003, 3));
  }
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
  const cy = ARM_Y;
  steel.push(box(faceX - 0.36, 0.015, 0.14, (faceX + 0.36) / 2, cy - 0.065, 0));
  white.push(box(faceX - 0.4, 0.11, 0.12, (faceX + 0.4) / 2 + 0.02, cy, 0));
  white.push(box(0.16, 0.16, 0.18, 0.3, cy + 0.01, 0));
  orange.push(box(0.008, 0.02, 0.122, 0.62, cy + 0.03, 0));

  /* On the hardstand: service vehicles (scale cues). Everything at grade is launchSite.js. */
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
    lamp: merge(lamp),
  };
}

export default function LaunchComplex({ progRef, anisotropy = 1 }) {
  const rootRef = useRef();
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
      lamp: new THREE.MeshStandardMaterial({ color: "#fff6dc", emissive: "#fff2c8", emissiveIntensity: 1.4 }),
      concrete: new THREE.MeshStandardMaterial({ map: tex.concrete, roughness: 0.92 }),
    };
    tex.concrete.wrapS = tex.concrete.wrapT = THREE.RepeatWrapping;
    const site = buildSite();
    // The site's steelwork, roofs, deflector, lamps and pipes share the complex's own materials:
    // one draw call per material for the whole installation
    const fold = (key, ...parts) => {
      const list = [geo[key], ...parts.map((k) => site.geo[k])].map((g) => {
        const n = g.index ? g.toNonIndexed() : g;
        ["color", "uv1", "uv2", "tangent"].forEach((a) => n.attributes[a] && n.deleteAttribute(a));
        return n;
      });
      const merged = mergeGeometries(list, false);
      [geo[key], ...parts.map((k) => site.geo[k])].forEach((g) => g.dispose());
      parts.forEach((k) => delete site.geo[k]);
      geo[key] = merged;
    };
    fold("steel", "gSteel");
    fold("steelDark", "gSteelDark", "gRoof", "deflector");
    fold("lamp", "gLamp");
    fold("white", "gPipes");
    Object.entries(site.tex).forEach(([k, t]) => (tex[`site_${k}`] = t));
    Object.entries(site.geo).forEach(([k, g]) => (geo[`site_${k}`] = g));
    Object.entries(site.mat).forEach(([k, m]) => (mat[`site_${k}`] = m));
    return { tex, geo, mat, scrub: site.scrub };
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
      res.scrub.forEach((m) => {
        m.geometry.dispose();
        m.dispose();
      });
      res.scrub[0].material.dispose();
    },
    [res]
  );

  useFrame(() => {
    const p = progRef.current;
    // Pad structures stay behind once the vehicle is high — cut them so they
    // don't float over the planet limb.
    if (rootRef.current) rootRef.current.visible = p < 0.3;
  });

  const { geo, mat } = res;
  const caster = (g, m) => <mesh geometry={g} material={m} castShadow receiveShadow />;
  const ground = (k, extra = {}) => <mesh geometry={geo[`site_${k}`]} material={mat[`site_${k}`]} receiveShadow {...extra} />;
  return (
    <group ref={rootRef}>
      {/* The raised hardstand (the flame trench cut through it, open under the engines), its
          embankments and ramps, the land, roads, coast and support facilities: launchSite.js */}
      <mesh geometry={geo.site_top} material={mat.concrete} receiveShadow />
      {ground("slope")}
      {ground("misc")}
      {ground("trench")}
      {ground("land")}
      {ground("landFade", { renderOrder: -2, receiveShadow: false })}
      {ground("sea", { receiveShadow: false })}
      {ground("roads")}
      {/* at grade, far outside the shadow camera: they receive, but cast no shadow */}
      {ground("gTank")}
      {ground("gWhite")}
      <mesh geometry={geo.site_vab} material={mat.site_vab} />
      {res.scrub.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
      {caster(geo.deck, mat.deck)}
      {caster(geo.steel, mat.steel)}
      {caster(geo.steelDark, mat.steelDark)}
      {caster(geo.grate, mat.grate)}
      {caster(geo.hoses, mat.hoses)}
      {caster(geo.orange, mat.orange)}
      {caster(geo.white, mat.white)}
      <mesh geometry={geo.lamp} material={mat.lamp} />
    </group>
  );
}
