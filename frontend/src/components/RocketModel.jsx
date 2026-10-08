import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/*
 * LV-001 ARTEMIS-CLASS — two-stage lunar vehicle (Fidelity II).
 * Procedural geometry with shared materials/geometries. Proportions,
 * stage stations and the separation choreography are unchanged from the
 * approved Visual Fidelity Pass; this pass deepens the hardware itself.
 * Apollo-era hardware is engineering inspiration only — LUNAVIA white,
 * orange bands and black intertank remain the vehicle's own identity.
 */

/* ------------------------- procedural textures ------------------------- */

function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

// Painted tank skin: panel seams, weld lines and subtle tonal variation.
function makePanelTextures(seed, { rows, cols, label, soot = 0 }) {
  const W = 512;
  const H = 1024;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  const r = rng(seed);
  ctx.fillStyle = "#f2f1ec";
  ctx.fillRect(0, 0, W, H);
  // Panel tone variation
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = 236 + Math.floor(r() * 14);
      ctx.fillStyle = `rgb(${v},${v},${v - 3})`;
      ctx.fillRect((x * W) / cols + 1, (y * H) / rows + 1, W / cols - 2, H / rows - 2);
    }
  }
  // Seams
  ctx.strokeStyle = "rgba(120,120,118,0.55)";
  ctx.lineWidth = 1.5;
  for (let x = 0; x <= cols; x++) {
    ctx.beginPath();
    ctx.moveTo((x * W) / cols, 0);
    ctx.lineTo((x * W) / cols, H);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(110,110,108,0.7)";
  ctx.lineWidth = 2.5;
  for (let y = 0; y <= rows; y++) {
    ctx.beginPath();
    ctx.moveTo(0, (y * H) / rows);
    ctx.lineTo(W, (y * H) / rows);
    ctx.stroke();
  }
  // Faint vertical weathering streaks and, on the booster, engine soot that
  // creeps up from the aft end.
  for (let i = 0; i < 70; i++) {
    const x = r() * W;
    const y0 = r() * H;
    const len = 40 + r() * 210;
    const sg = ctx.createLinearGradient(0, y0, 0, y0 + len);
    sg.addColorStop(0, "rgba(90,86,78,0)");
    sg.addColorStop(0.5, `rgba(90,86,78,${0.04 + r() * 0.05})`);
    sg.addColorStop(1, "rgba(90,86,78,0)");
    ctx.fillStyle = sg;
    ctx.fillRect(x, y0, 1 + r() * 2, len);
  }
  if (soot > 0) {
    const sg = ctx.createLinearGradient(0, H * (1 - 0.22 * soot), 0, H);
    sg.addColorStop(0, "rgba(40,36,32,0)");
    sg.addColorStop(1, `rgba(40,36,32,${0.38 * soot})`);
    ctx.fillStyle = sg;
    ctx.fillRect(0, H * (1 - 0.22 * soot), W, H * 0.22 * soot);
    for (let i = 0; i < 90; i++) {
      const x = r() * W;
      const len = H * (0.05 + r() * 0.16) * soot;
      const g2 = ctx.createLinearGradient(0, H - len, 0, H);
      g2.addColorStop(0, "rgba(35,32,28,0)");
      g2.addColorStop(1, `rgba(35,32,28,${0.12 + r() * 0.2})`);
      ctx.fillStyle = g2;
      ctx.fillRect(x, H - len, 1 + r() * 3, len);
    }
  }
  if (label) {
    ctx.save();
    ctx.translate(W * 0.25, H * 0.5);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = "#1b1c1f";
    ctx.font = "bold 58px Arial, Helvetica, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;

  // Roughness: seams slightly rougher, panels vary
  const rc = document.createElement("canvas");
  rc.width = 128;
  rc.height = 256;
  const rctx = rc.getContext("2d");
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = 120 + Math.floor(r() * 50);
      rctx.fillStyle = `rgb(${v},${v},${v})`;
      rctx.fillRect((x * 128) / cols, (y * 256) / rows, 128 / cols, 256 / rows);
    }
  }
  const rough = new THREE.CanvasTexture(rc);

  // Bump: recessed panel seams so the skin breaks up under raking light.
  const bc = document.createElement("canvas");
  bc.width = 512;
  bc.height = 1024;
  const bctx = bc.getContext("2d");
  bctx.fillStyle = "#b0b0b0";
  bctx.fillRect(0, 0, 512, 1024);
  bctx.strokeStyle = "#404040";
  bctx.lineWidth = 2;
  for (let x = 0; x <= cols; x++) {
    bctx.beginPath();
    bctx.moveTo((x * 512) / cols, 0);
    bctx.lineTo((x * 512) / cols, 1024);
    bctx.stroke();
  }
  bctx.lineWidth = 3;
  for (let y = 0; y <= rows; y++) {
    bctx.beginPath();
    bctx.moveTo(0, (y * 1024) / rows);
    bctx.lineTo(512, (y * 1024) / rows);
    bctx.stroke();
  }
  // Rivet rows either side of the circumferential welds
  bctx.fillStyle = "#e8e8e8";
  for (let y = 0; y <= rows; y++) {
    for (let x = 0; x < 512; x += 8) {
      bctx.fillRect(x, (y * 1024) / rows - 6, 2, 2);
      bctx.fillRect(x + 4, (y * 1024) / rows + 5, 2, 2);
    }
  }
  const bump = new THREE.CanvasTexture(bc);
  return { map, rough, bump };
}

// Vertical stripe bump map: intertank corrugation / interstage stringers.
function makeStripeBump(count) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 8;
  const ctx = c.getContext("2d");
  for (let i = 0; i < count; i++) {
    const g = ctx.createLinearGradient((i * 512) / count, 0, ((i + 1) * 512) / count, 0);
    g.addColorStop(0, "#000");
    g.addColorStop(0.5, "#fff");
    g.addColorStop(1, "#000");
    ctx.fillStyle = g;
    ctx.fillRect((i * 512) / count, 0, 512 / count, 8);
  }
  return new THREE.CanvasTexture(c);
}

// Service-module radiator panels: alternating silver/white with dark gaps.
function makeRadiator() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 64;
  const ctx = c.getContext("2d");
  for (let i = 0; i < 24; i++) {
    ctx.fillStyle = i % 6 === 0 ? "#2a2e33" : i % 2 === 0 ? "#d4d7dc" : "#b9bec5";
    ctx.fillRect((i * 512) / 24, 0, 512 / 24 - 2, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Engine bell skin. flipY=false: canvas top = chamber, bottom = nozzle exit
// (matches LatheGeometry v order). Chamber, turbine-exhaust manifold band,
// regeneratively cooled tube section, then the smoother extension that
// heat-tints toward the rim.
function makeBellTextures({ tubes = 96 } = {}) {
  const W = 512;
  const H = 256;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#26272a");
  g.addColorStop(0.11, "#2a2b2e");
  g.addColorStop(0.12, "#55575b");
  g.addColorStop(0.16, "#4a4c50");
  g.addColorStop(0.17, "#2f3033");
  g.addColorStop(0.64, "#323335");
  g.addColorStop(0.66, "#45464a");
  g.addColorStop(0.68, "#3a3a3b");
  g.addColorStop(0.9, "#43403b");
  g.addColorStop(1, "#57493c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Cooling tubes: fine vertical lines over the tube section only
  const b = document.createElement("canvas");
  b.width = W;
  b.height = H;
  const bx = b.getContext("2d");
  bx.fillStyle = "#808080";
  bx.fillRect(0, 0, W, H);
  for (let i = 0; i < tubes; i++) {
    const x = (i * W) / tubes;
    const w = W / tubes;
    const tg = bx.createLinearGradient(x, 0, x + w, 0);
    tg.addColorStop(0, "#3a3a3a");
    tg.addColorStop(0.5, "#e0e0e0");
    tg.addColorStop(1, "#3a3a3a");
    bx.fillStyle = tg;
    bx.fillRect(x, H * 0.17, w, H * 0.47);
    ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.06)";
    ctx.fillRect(x, H * 0.17, w * 0.5, H * 0.47);
  }
  // Stiffener / hat bands
  [0.4, 0.62].forEach((y) => {
    bx.fillStyle = "#f0f0f0";
    bx.fillRect(0, H * y, W, 3);
  });
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.flipY = false;
  const bump = new THREE.CanvasTexture(b);
  bump.flipY = false;
  // Inner bell: black at the throat, sooted grey toward the exit
  const ic = document.createElement("canvas");
  ic.width = 8;
  ic.height = 128;
  const ix = ic.getContext("2d");
  const ig = ix.createLinearGradient(0, 0, 0, 128);
  ig.addColorStop(0, "#050505");
  ig.addColorStop(0.35, "#0d0d0e");
  ig.addColorStop(1, "#2a2827");
  ix.fillStyle = ig;
  ix.fillRect(0, 0, 8, 128);
  const inner = new THREE.CanvasTexture(ic);
  inner.colorSpace = THREE.SRGBColorSpace;
  inner.flipY = false;
  return { map, bump, inner };
}

// Base heat shield: quilted insulation blankets.
function makeQuiltBump() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#909090";
  ctx.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const g = ctx.createRadialGradient(x * 16 + 8, y * 16 + 8, 1, x * 16 + 8, y * 16 + 8, 9);
      g.addColorStop(0, "#d8d8d8");
      g.addColorStop(1, "#5a5a5a");
      ctx.fillStyle = g;
      ctx.fillRect(x * 16 + 1, y * 16 + 1, 14, 14);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

/* ------------------------- shared geometry ------------------------- */

// Cylinder strut between two points (structural members, actuators, lines).
function strut(a, b, r, seg = 6) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const d = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  const m = A.add(B).multiplyScalar(0.5);
  g.translate(m.x, m.y, m.z);
  return g;
}

// Bell radius at fraction u along the expansion (matches bellGeometry).
const bellR = (throat, exit, u) => throat + (exit - throat) * (1 - Math.pow(1 - u, 1.9));

// Bell nozzle: throat → curved (parabolic-like) expansion → rolled rim lip.
function bellGeometry({ throat, exit, length, segments = 20 }) {
  const pts = [];
  const n = 10;
  pts.push(new THREE.Vector2(throat * 1.25, length + 0.05 * length)); // chamber
  pts.push(new THREE.Vector2(throat, length)); // throat
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    const r = throat + (exit - throat) * (1 - Math.pow(1 - u, 1.9));
    pts.push(new THREE.Vector2(r, length * (1 - u)));
  }
  pts.push(new THREE.Vector2(exit * 1.035, -0.004 * length)); // rim lip
  pts.push(new THREE.Vector2(exit * 1.04, 0.02 * length));
  return new THREE.LatheGeometry(pts, segments);
}

// CM-shaped boost protective cover (slightly bulged 33° cone).
function coverGeometry() {
  const pts = [
    new THREE.Vector2(0.262, 0),
    new THREE.Vector2(0.255, 0.03),
    new THREE.Vector2(0.19, 0.16),
    new THREE.Vector2(0.11, 0.3),
    new THREE.Vector2(0.06, 0.37),
    new THREE.Vector2(0.045, 0.4),
    new THREE.Vector2(0.0001, 0.405),
  ];
  return new THREE.LatheGeometry(pts, 40);
}

// Swept trapezoid fin.
function finGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0.5, 0);
  s.lineTo(0.42, 0.14);
  s.lineTo(0.2, 0.14);
  s.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 });
  g.translate(0, 0, -0.011);
  return g;
}

// Plume shader: bright at the nozzle, fading downstream, flickering.
function plumeMaterial({ color, core, opacity, falloff, noise }) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: opacity },
      uColor: { value: new THREE.Color(color) },
      uCore: { value: new THREE.Color(core) },
      uFalloff: { value: falloff },
      uNoise: { value: noise },
      uGain: { value: 1 },
    },
    vertexShader: `
      varying vec2 vUv; varying vec3 vN; varying vec3 vView;
      void main() {
        vUv = uv; vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0); vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uTime; uniform float uOpacity; uniform vec3 uColor; uniform vec3 uCore;
      uniform float uFalloff; uniform float uNoise; uniform float uGain;
      varying vec2 vUv; varying vec3 vN; varying vec3 vView;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
        return mix(mix(h(i),h(i+vec2(1,0)),u.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x),u.y); }
      void main() {
        float along = vUv.y;                      // 1 at the nozzle exit
        float facing = pow(abs(dot(vN, vView)), 1.2);
        float streak = 1.0 - uNoise + uNoise * n(vec2(vUv.x * 22.0, along * 7.0 - uTime * 11.0));
        float a = pow(along, uFalloff) * facing * streak * uOpacity * uGain;
        vec3 col = mix(uColor, uCore, pow(along, 3.0));
        gl_FragColor = vec4(col * a, a);
      }`,
  });
}

/* ---- batching: static parts sharing a material are merged into one draw call ---- */

function m4(p = [0, 0, 0], r = [0, 0, 0], s = 1) {
  const sc = Array.isArray(s) ? s : [s, s, s];
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...p),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)),
    new THREE.Vector3(...sc)
  );
}
// Clone geo and apply matrices in order (local part transform first, then parents).
function put(geo, ...mats) {
  const g = geo.clone();
  mats.forEach((m) => g.applyMatrix4(m));
  return g;
}
const merge = (list) => mergeGeometries(list, false);

const OUTBOARD = [0, 1, 2, 3].map((i) => {
  const a = Math.PI / 4 + (i / 4) * Math.PI * 2;
  return [Math.cos(a) * 0.235, Math.sin(a) * 0.235];
});
const ENGINES = [m4([0, -0.06, 0], [0, 0, 0], 1.03), ...OUTBOARD.map(([x, z]) => m4([x, -0.06, z]))];
const QUAD = [0, 1, 2, 3].map((i) => (i / 4) * Math.PI * 2);

function buildBatches(geo) {
  const pipe = geo.pipe;
  const gimbal = new THREE.CylinderGeometry(0.035, 0.045, 0.06, 12);
  const pump = new THREE.CylinderGeometry(0.018, 0.018, 0.08, 10);
  const hw1 = [];
  const bells1 = [];
  const inner1 = [];
  ENGINES.forEach((E) => {
    bells1.push(put(geo.bell1, E));
    inner1.push(put(geo.bell1Inner, m4([0, 0.004, 0]), E));
    hw1.push(put(gimbal, m4([0, 0.34, 0]), E));
    hw1.push(put(pump, m4([0.05, 0.3, 0.02]), E));
    hw1.push(put(pipe, m4([0.07, 0.2, 0.02], [0, 0, 0.35], [1, 0.18, 1]), E));
    hw1.push(put(pipe, m4([-0.045, 0.3, -0.03], [0.3, 0, -0.25], [1, 0.12, 1]), E));
  });
  // Stiffener / hat bands on every bell, at the stations painted on the bell skin
  [0.4, 0.62].forEach((u) => {
    const ring = new THREE.TorusGeometry(bellR(0.034, 0.108, u) + 0.002, 0.0035, 6, 28);
    ENGINES.forEach((E) => hw1.push(put(ring, m4([0, 0.3 * (1 - u), 0], [Math.PI / 2, 0, 0]), E)));
  });
  // Turbine-exhaust manifold ring at the top of each bell + exhaust duct
  const manifold = new THREE.TorusGeometry(0.046, 0.007, 6, 20);
  ENGINES.forEach((E) => {
    hw1.push(put(manifold, m4([0, 0.262, 0], [Math.PI / 2, 0, 0]), E));
    hw1.push(put(strut([0.05, 0.3, 0.02], [0.05, 0.26, 0.04], 0.007), E));
  });
  // Gimbal actuators: two per outboard engine, bell collar → thrust structure
  OUTBOARD.forEach(([x, z]) => {
    const a = Math.atan2(z, x);
    [-0.6, 0.6].forEach((o) => {
      const bx = x + Math.cos(a + o * 2.2) * 0.05;
      const bz = z + Math.sin(a + o * 2.2) * 0.05;
      const tx = x * 0.72 + Math.cos(a + o) * 0.06;
      const tz = z * 0.72 + Math.sin(a + o) * 0.06;
      hw1.push(strut([bx, 0.17, bz], [tx, 0.4, tz], 0.006));
      hw1.push(put(new THREE.CylinderGeometry(0.01, 0.01, 0.05, 8), m4([(bx + tx) / 2, 0.285, (bz + tz) / 2])));
    });
  });
  // Thrust structure: ring + outriggers to the skirt
  hw1.push(put(new THREE.TorusGeometry(0.3, 0.012, 6, 32), m4([0, 0.41, 0], [Math.PI / 2, 0, 0])));
  QUAD.forEach((q) => {
    const a = q + Math.PI / 4;
    hw1.push(strut([Math.cos(a) * 0.3, 0.41, Math.sin(a) * 0.3], [Math.cos(a) * 0.375, 0.47, Math.sin(a) * 0.375], 0.011, 4));
    hw1.push(strut([Math.cos(a) * 0.3, 0.41, Math.sin(a) * 0.3], [Math.cos(a + 0.5) * 0.37, 0.33, Math.sin(a + 0.5) * 0.37], 0.008, 4));
  });
  // Base heat shield (quilted) with a hole per engine, and flexible boots
  const hs = new THREE.Shape();
  hs.absarc(0, 0, 0.405, 0, Math.PI * 2, false);
  [[0, 0], ...OUTBOARD].forEach(([x, z]) => {
    const h = new THREE.Path();
    h.absarc(x, -z, 0.066, 0, Math.PI * 2, true);
    hs.holes.push(h);
  });
  const heat1 = [put(new THREE.ShapeGeometry(hs, 24), m4([0, 0.245, 0], [-Math.PI / 2, 0, 0]))];
  [[0, 0, 1.03], ...OUTBOARD.map(([x, z]) => [x, z, 1])].forEach(([x, z, k]) => {
    heat1.push(put(new THREE.CylinderGeometry(0.066, 0.05 * k, 0.05, 16, 1, true), m4([x, 0.222, z])));
  });
  const beam = new THREE.BoxGeometry(0.72, 0.04, 0.035);
  [0, Math.PI / 2].forEach((r) => hw1.push(put(beam, m4([0, 0.33, 0], [0, r + Math.PI / 4, 0]))));
  OUTBOARD.forEach(([x, z]) => hw1.push(put(pipe, m4([x * 0.55, 0.4, z * 0.55], [0, 0, 0], [2.2, 0.14, 2.2]))));
  hw1.push(put(new THREE.TorusGeometry(0.448, 0.012, 8, 32), m4([0, 0.045, 0], [Math.PI / 2, 0, 0])));
  hw1.push(put(new THREE.TorusGeometry(0.352, 0.01, 8, 32), m4([0, 2.855, 0], [Math.PI / 2, 0, 0])));
  hw1.push(put(new THREE.TorusGeometry(0.381, 0.009, 8, 32), m4([0, 2.49, 0], [Math.PI / 2, 0, 0])));
  const white1 = [];
  const retroBody = new THREE.CylinderGeometry(0.022, 0.022, 0.16, 10);
  const retroNozzle = new THREE.ConeGeometry(0.018, 0.04, 10, 1, true);
  QUAD.forEach((q) => {
    const a = q + Math.PI / 4;
    const G = m4([Math.cos(a) * 0.37, 2.6, Math.sin(a) * 0.37], [0, -a, 0]);
    white1.push(put(retroBody, G));
    hw1.push(put(retroNozzle, m4([0, 0.1, 0], [0, 0, -0.35]), G));
  });
  [0.9, 1.5, 2.1].forEach((y) => white1.push(put(new THREE.CylinderGeometry(0.384, 0.384, 0.022, 32), m4([0, y, 0]))));
  // Systems raceway (cable tunnel) up the booster with clamp straps
  const RW = Math.PI / 6;
  white1.push(put(new THREE.BoxGeometry(0.05, 1.66, 0.028), m4([Math.cos(RW) * 0.392, 1.47, Math.sin(RW) * 0.392], [0, -RW, 0])));
  for (let y = 0.7; y < 2.3; y += 0.2) {
    hw1.push(put(new THREE.BoxGeometry(0.062, 0.012, 0.034), m4([Math.cos(RW) * 0.393, y, Math.sin(RW) * 0.393], [0, -RW, 0])));
  }
  // Umbilical carrier plates facing the tower (+x)
  [0.78, 2.2].forEach((y) => hw1.push(put(new THREE.BoxGeometry(0.012, 0.07, 0.09), m4([0.384, y, 0]))));
  // Interstage: frangible separation joint, vent ports, access hatches
  const cavity1Extra = [put(new THREE.CylinderGeometry(0.356, 0.356, 0.012, 40, 1, true), m4([0, 2.848, 0]))];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    cavity1Extra.push(put(new THREE.BoxGeometry(0.004, 0.03, 0.05), m4([Math.cos(a) * 0.371, 2.74, Math.sin(a) * 0.371], [0, -a, 0])));
  }
  [0.4, 3.5].forEach((a) => hw1.push(put(new THREE.BoxGeometry(0.006, 0.1, 0.085), m4([Math.cos(a) * 0.37, 2.6, Math.sin(a) * 0.37], [0, -a, 0]))));
  const orange1 = [
    put(new THREE.CylinderGeometry(0.385, 0.385, 0.1, 32), m4([0, 2.3, 0])),
    put(new THREE.CylinderGeometry(0.385, 0.385, 0.06, 32), m4([0, 0.62, 0])),
  ];
  const cavity1 = [
    put(new THREE.CylinderGeometry(0.39, 0.39, 0.03, 32), m4([0, 0.3, 0])),
    put(new THREE.CylinderGeometry(0.346, 0.374, 0.38, 32, 1, true), m4([0, 2.67, 0])),
    ...cavity1Extra,
  ];

  // Stage 2 + spacecraft
  const hw2 = [
    put(new THREE.CylinderGeometry(0.06, 0.08, 0.1, 16), m4([0, 2.95, 0])),
    put(new THREE.TorusGeometry(0.339, 0.01, 8, 32), m4([0, 2.88, 0], [Math.PI / 2, 0, 0])),
  ];
  [0, 1].forEach((i) => hw2.push(put(pipe, m4([i ? 0.14 : -0.14, 2.9, 0.1], [0.2, 0, i ? -0.4 : 0.4], [1.4, 0.16, 1.4]))));
  // Upper-stage engine: LOX + fuel turbopumps, gas generator, ducts, bell bands
  hw2.push(put(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 12), m4([0.1, 2.84, 0.05], [0, 0, 0.25])));
  hw2.push(put(new THREE.CylinderGeometry(0.026, 0.026, 0.09, 12), m4([-0.1, 2.84, -0.04], [0, 0, -0.25])));
  hw2.push(put(new THREE.SphereGeometry(0.022, 10, 8), m4([0.02, 2.8, -0.1])));
  hw2.push(strut([0.1, 2.8, 0.05], [0.07, 2.74, 0.08], 0.009));
  hw2.push(strut([-0.1, 2.8, -0.04], [-0.06, 2.74, -0.08], 0.009));
  hw2.push(strut([0.02, 2.8, -0.1], [0.09, 2.7, -0.05], 0.007));
  [0.42, 0.66].forEach((u) => hw2.push(put(new THREE.TorusGeometry(bellR(0.05, 0.2, u) + 0.002, 0.004, 6, 32), m4([0, 2.5 + 0.36 * (1 - u), 0], [Math.PI / 2, 0, 0]))));
  hw2.push(put(new THREE.TorusGeometry(0.064, 0.008, 6, 20), m4([0, 2.82, 0], [Math.PI / 2, 0, 0])));
  // Thrust-cone struts
  QUAD.forEach((q) => hw2.push(strut([Math.cos(q) * 0.07, 2.93, Math.sin(q) * 0.07], [Math.cos(q) * 0.29, 2.88, Math.sin(q) * 0.29], 0.008, 4)));
  const cav2 = [
    put(new THREE.CylinderGeometry(0.33, 0.12, 0.12, 32), m4([0, 2.92, 0])),
    put(new THREE.CylinderGeometry(0.268, 0.268, 0.05, 32), m4([0, 4.37, 0])),
  ];
  const rcsBox = new THREE.BoxGeometry(0.06, 0.08, 0.06);
  const rcsCone = new THREE.ConeGeometry(0.009, 0.02, 8, 1, true);
  QUAD.forEach((q) => {
    const a = q + Math.PI / 4;
    const G = m4([Math.cos(a) * 0.31, 3.95, Math.sin(a) * 0.31], [0, -a, 0]);
    hw2.push(put(rcsBox, G));
    [-0.03, 0.03].forEach((y) => cav2.push(put(rcsCone, m4([0.035, y, 0], [0, 0, Math.PI / 2]), G)));
  });
  const smRcs = new THREE.BoxGeometry(0.035, 0.05, 0.035);
  QUAD.forEach((a) => hw2.push(put(smRcs, m4([Math.cos(a) * 0.272, 4.58, Math.sin(a) * 0.272]))));
  // Spacecraft adapter: separation-bolt fittings
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    hw2.push(put(new THREE.BoxGeometry(0.014, 0.018, 0.01), m4([Math.cos(a) * 0.3, 4.235, Math.sin(a) * 0.3], [0, -a, 0])));
  }
  const lesNozzle = new THREE.ConeGeometry(0.012, 0.03, 8, 1, true);
  QUAD.forEach((a) => hw2.push(put(lesNozzle, m4([Math.cos(a) * 0.03, 5.39, Math.sin(a) * 0.03], [Math.sin(a) * -0.5, 0, Math.cos(a) * 0.5]))));
  const les = [put(geo.cover, m4([0, 4.72, 0]))];
  // Escape tower: four tapering legs with ring frames and X-bracing per bay
  const LEG = (a, y) => {
    const r = 0.062 - ((y - 5.1) / 0.3) * 0.03;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  };
  const legAngles = QUAD.map((q) => q + Math.PI / 4);
  legAngles.forEach((a) => les.push(strut(LEG(a, 5.1), LEG(a, 5.4), 0.0045, 5)));
  [5.1, 5.2, 5.3, 5.4].forEach((y) =>
    legAngles.forEach((a, i) => les.push(strut(LEG(a, y), LEG(legAngles[(i + 1) % 4], y), 0.0028, 4)))
  );
  [[5.1, 5.2], [5.2, 5.3], [5.3, 5.4]].forEach(([y0, y1]) =>
    legAngles.forEach((a, i) => {
      const b = legAngles[(i + 1) % 4];
      les.push(strut(LEG(a, y0), LEG(b, y1), 0.0022, 4));
      les.push(strut(LEG(b, y0), LEG(a, y1), 0.0022, 4));
    })
  );
  les.push(put(new THREE.TorusGeometry(0.034, 0.004, 6, 16), m4([0, 5.405, 0], [Math.PI / 2, 0, 0])));
  les.push(put(new THREE.CylinderGeometry(0.028, 0.034, 0.24, 16), m4([0, 5.52, 0])));
  les.push(put(new THREE.ConeGeometry(0.028, 0.09, 16), m4([0, 5.68, 0])));
  [0, 1].forEach((i) => les.push(put(new THREE.BoxGeometry(0.07, 0.018, 0.003), m4([0, 5.66, 0], [0, i * Math.PI, 0]))));
  const orange2 = [
    put(new THREE.CylinderGeometry(0.305, 0.305, 0.07, 32), m4([0, 4.1, 0])),
    put(new THREE.CylinderGeometry(0.0285, 0.0285, 0.02, 16), m4([0, 5.6, 0])),
  ];
  const silver2 = [
    put(new THREE.CylinderGeometry(0.265, 0.3, 0.08, 32), m4([0, 4.26, 0])),
    put(new THREE.SphereGeometry(0.012, 10, 10), m4([0, 5.735, 0])),
  ];
  return {
    bells1: merge(bells1),
    inner1: merge(inner1),
    hw1: merge(hw1),
    white1: merge(white1),
    orange1: merge(orange1),
    cavity1: merge(cavity1),
    heat1: merge(heat1),
    hw2: merge(hw2),
    cav2: merge(cav2),
    les: merge(les),
    orange2: merge(orange2),
    silver2: merge(silver2),
  };
}

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const s1 = makePanelTextures(3, { rows: 8, cols: 12, label: "LUNAVIA", soot: 1 });
  s1.map.wrapS = THREE.RepeatWrapping;
  const s2 = makePanelTextures(9, { rows: 6, cols: 10, label: null });
  const corrugation = makeStripeBump(64);
  corrugation.wrapS = THREE.RepeatWrapping;
  const stringers = makeStripeBump(40);
  const bellTex = makeBellTextures({ tubes: 96 });
  const bell2Tex = makeBellTextures({ tubes: 128 });
  SHARED = {
    tex: { bell1: bellTex, bell2: bell2Tex },
    geo: {
      bell1: bellGeometry({ throat: 0.034, exit: 0.108, length: 0.3 }),
      bell1Inner: bellGeometry({ throat: 0.03, exit: 0.1, length: 0.29 }),
      bell2: bellGeometry({ throat: 0.05, exit: 0.2, length: 0.36, segments: 28 }),
      bell2Inner: bellGeometry({ throat: 0.045, exit: 0.19, length: 0.35, segments: 28 }),
      cover: coverGeometry(),
      fin: finGeometry(),
      pipe: new THREE.CylinderGeometry(0.008, 0.008, 1, 6),
    },
    batch: null,
    mat: {
      paint1: new THREE.MeshStandardMaterial({ map: s1.map, roughnessMap: s1.rough, bumpMap: s1.bump, bumpScale: 0.6, roughness: 0.62, metalness: 0.08 }),
      paint2: new THREE.MeshStandardMaterial({ map: s2.map, roughnessMap: s2.rough, bumpMap: s2.bump, bumpScale: 0.6, roughness: 0.6, metalness: 0.08 }),
      heat: new THREE.MeshStandardMaterial({ color: "#4a4744", roughness: 0.92, metalness: 0.05, bumpMap: makeQuiltBump(), bumpScale: 1.5, side: THREE.DoubleSide }),
      white: new THREE.MeshStandardMaterial({ color: "#eeede8", roughness: 0.5, metalness: 0.12 }),
      orange: new THREE.MeshStandardMaterial({ color: "#FF3B00", roughness: 0.52, metalness: 0.1 }),
      black: new THREE.MeshStandardMaterial({ color: "#16171a", roughness: 0.62, metalness: 0.25, bumpMap: corrugation, bumpScale: 1.2 }),
      structure: new THREE.MeshStandardMaterial({ color: "#8e939a", roughness: 0.42, metalness: 0.72, bumpMap: stringers, bumpScale: 0.8 }),
      skirt: new THREE.MeshStandardMaterial({ color: "#3a3c40", roughness: 0.5, metalness: 0.65, side: THREE.DoubleSide, bumpMap: stringers, bumpScale: 0.6 }),
      cavity: new THREE.MeshStandardMaterial({ color: "#0e0e10", roughness: 0.92, metalness: 0.1 }),
      hardware: new THREE.MeshStandardMaterial({ color: "#5d6269", roughness: 0.36, metalness: 0.85 }),
      bellInner: new THREE.MeshStandardMaterial({ color: "#09090a", roughness: 0.72, metalness: 0.3, side: THREE.BackSide }),
      silver: new THREE.MeshStandardMaterial({ color: "#c7cbd1", roughness: 0.3, metalness: 0.85 }),
      radiator: new THREE.MeshStandardMaterial({ map: makeRadiator(), roughness: 0.35, metalness: 0.7 }),
      les: new THREE.MeshStandardMaterial({ color: "#e4e4e1", roughness: 0.45, metalness: 0.35 }),
    },
  };
  SHARED.batch = buildBatches(SHARED.geo);
  SHARED.textures = [s1.map, s1.rough, s1.bump, s2.map, s2.rough, s2.bump, corrugation, stringers,
    bellTex.map, bellTex.bump, bell2Tex.map, bell2Tex.bump];
  return SHARED;
}

// Anisotropic filtering keeps panel seams and bell tubes crisp at the grazing
// angles a cylinder always presents; set once the renderer is known.
export function setRocketTextureAnisotropy(n) {
  const S = shared();
  S.textures.forEach((t) => {
    if (t.anisotropy !== n) {
      t.anisotropy = n;
      t.needsUpdate = true;
    }
  });
}

export default function RocketModel({ separated = false, thrust = 1, sepRef = null, scale = 1, rigRef = null }) {
  const S = shared();
  const rootRef = useRef();
  const stage1Ref = useRef();
  const plume1Ref = useRef();
  const plume2Ref = useRef();
  const retroRef = useRef();
  const light1Ref = useRef();
  const light2Ref = useRef();
  const localSep = useRef(0);

  const bellMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#ffffff",
        map: S.tex.bell1.map,
        bumpMap: S.tex.bell1.bump,
        bumpScale: 1.4,
        metalness: 0.82,
        roughness: 0.36,
        emissive: new THREE.Color("#ff7a1e"),
        emissiveIntensity: 0,
        side: THREE.DoubleSide,
      }),
    [S]
  );
  const bellInner1 = useMemo(() => {
    const m = S.mat.bellInner.clone();
    m.color = new THREE.Color("#ffffff");
    m.map = S.tex.bell1.inner;
    m.emissive = new THREE.Color("#ff9a3c");
    return m;
  }, [S]);
  const bell2Mat = useMemo(() => {
    const m = bellMat.clone();
    m.color = new THREE.Color("#e8eaee");
    m.map = S.tex.bell2.map;
    m.bumpMap = S.tex.bell2.bump;
    m.emissive = new THREE.Color("#a8461c");
    return m;
  }, [bellMat, S]);
  const bellInner2 = useMemo(() => {
    const m = S.mat.bellInner.clone();
    m.color = new THREE.Color("#ffffff");
    m.map = S.tex.bell2.inner;
    m.emissive = new THREE.Color("#b9d2ff");
    return m;
  }, [S]);

  const plumeMats = useMemo(
    () => ({
      core: plumeMaterial({ color: "#ff8a3a", core: "#fff6e0", opacity: 1.0, falloff: 1.4, noise: 0.25 }),
      mid: plumeMaterial({ color: "#ff6a1c", core: "#ffd7a0", opacity: 0.55, falloff: 1.1, noise: 0.35 }),
      outer: plumeMaterial({ color: "#ff4a10", core: "#ffb070", opacity: 0.22, falloff: 0.9, noise: 0.45 }),
      vacCore: plumeMaterial({ color: "#aac4ff", core: "#f4f8ff", opacity: 0.8, falloff: 2.2, noise: 0.2 }),
      vacExpand: plumeMaterial({ color: "#7d97d8", core: "#dfe8ff", opacity: 0.2, falloff: 1.3, noise: 0.5 }),
      vacHaze: plumeMaterial({ color: "#5d74b8", core: "#b8c8f0", opacity: 0.07, falloff: 0.8, noise: 0.3 }),
      retro: plumeMaterial({ color: "#d7d2c8", core: "#ffffff", opacity: 0.55, falloff: 1.5, noise: 0.4 }),
    }),
    []
  );

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    // Hand the stage objects to camera framing (stable refs, published per frame)
    if (rigRef && rootRef.current && stage1Ref.current) {
      if (!rigRef.current) rigRef.current = {};
      rigRef.current.root = rootRef.current;
      rigRef.current.stage1 = stage1Ref.current;
    }
    if (separated) {
      // Development-only: hold the separation at a given progress for stills
      // (compiled out of production builds).
      const hold = process.env.NODE_ENV !== "production" ? window.__lvSepHold : undefined;
      if (hold != null) {
        if (sepRef) sepRef.current = hold;
        else localSep.current = hold;
      } else if (sepRef) sepRef.current = Math.min(1, sepRef.current + delta / 3.6);
      else localSep.current = Math.min(1, localSep.current + delta / 3.6);
    }
    const s = sepRef ? sepRef.current : localSep.current;
    const e = 1 - (1 - s) * (1 - s);

    // Stage 1 keeps the shared trajectory and falls back slowly relative to
    // the still-accelerating upper stage, picking up a gentle tumble from the
    // separation impulse. It never just drops vertically.
    if (stage1Ref.current) {
      stage1Ref.current.position.set(e * 0.55, -e * 2.3, 0);
      stage1Ref.current.rotation.z = s * 0.42;
      stage1Ref.current.rotation.x = s * 0.16;
    }

    Object.values(plumeMats).forEach((m) => (m.uniforms.uTime.value = t));
    const flick = 1 + Math.sin(t * 47) * 0.05 + Math.sin(t * 29) * 0.04;

    const s1On = thrust > 0.25 && !separated;
    if (plume1Ref.current) {
      plume1Ref.current.visible = s1On;
      if (s1On) plume1Ref.current.scale.set(1, (0.55 + 0.45 * thrust) * flick, 1);
    }
    bellMat.emissiveIntensity = s1On ? 0.55 : 0;
    bellInner1.emissiveIntensity = s1On ? 1.4 : 0;
    if (light1Ref.current) light1Ref.current.intensity = s1On ? 4.5 * thrust : 0;

    // Retro motors on the interstage fire briefly at the separation impulse
    const retro = separated ? clamp01(1 - Math.abs(s - 0.07) / 0.07) : 0;
    if (retroRef.current) {
      retroRef.current.visible = retro > 0.02;
      plumeMats.retro.uniforms.uGain.value = retro;
    }

    // Upper-stage ignition once the separation gap is clearly open
    const ig = separated ? clamp01((s - 0.42) / 0.22) : 0;
    if (plume2Ref.current) {
      plume2Ref.current.visible = ig > 0.02;
      if (ig > 0.02) plume2Ref.current.scale.set(1, Math.max(0.05, ig) * (1 + Math.sin(t * 31) * 0.02), 1);
    }
    plumeMats.vacCore.uniforms.uGain.value = ig;
    plumeMats.vacExpand.uniforms.uGain.value = ig;
    plumeMats.vacHaze.uniforms.uGain.value = ig;
    bell2Mat.emissiveIntensity = ig * 0.12;
    bellInner2.emissiveIntensity = ig * 1.2;
    if (light2Ref.current) light2Ref.current.intensity = ig * 2.2;
  });

  return (
    <group scale={scale} ref={rootRef}>
      {/* ============ STAGE 1 (booster + interstage, jettisoned together) ============ */}
      <group ref={stage1Ref}>
        {/* Engine cluster (1 centre + 4 outboard) with gimbals, turbopumps, feed lines,
            thrust beams, frame rings and retro motors — batched by material */}
        <mesh geometry={S.batch.bells1} material={bellMat} />
        <mesh geometry={S.batch.inner1} material={bellInner1} />
        <mesh geometry={S.batch.hw1} material={S.mat.hardware} />
        <mesh geometry={S.batch.cavity1} material={S.mat.cavity} />
        <mesh geometry={S.batch.heat1} material={S.mat.heat} />
        <mesh geometry={S.batch.white1} material={S.mat.white} />
        <mesh geometry={S.batch.orange1} material={S.mat.orange} />

        {/* Thrust-section skirt (flared, ribbed, open aft) */}
        <mesh position={[0, 0.26, 0]} material={S.mat.skirt}>
          <cylinderGeometry args={[0.38, 0.45, 0.44, 40, 1, true]} />
        </mesh>

        {/* Fins, placed between the outboard engines */}
        {[0, 1, 2, 3].map((i) => {
          const a = (i / 4) * Math.PI * 2;
          return (
            <mesh key={i} geometry={S.geo.fin} material={S.mat.white} position={[Math.cos(a) * 0.405, 0.5, Math.sin(a) * 0.405]} rotation={[0, -a, -Math.PI / 2]} />
          );
        })}

        {/* Booster tank — painted skin with seams */}
        <mesh position={[0, 1.48, 0]} material={S.mat.paint1}>
          <cylinderGeometry args={[0.38, 0.38, 2.0, 32, 1, true]} />
        </mesh>

        {/* Black corrugated intertank */}
        <mesh position={[0, 1.16, 0]} material={S.mat.black}>
          <cylinderGeometry args={[0.386, 0.386, 0.13, 32]} />
        </mesh>

        {/* Interstage — solid ribbed structure, stays with stage 1 */}
        <mesh position={[0, 2.67, 0]} material={S.mat.structure}>
          <cylinderGeometry args={[0.352, 0.38, 0.38, 32, 1, true]} />
        </mesh>
        {/* Retro-motor plumes (motors themselves are in the batched hardware) */}
        <group ref={retroRef} visible={false}>
          {[0, 1, 2, 3].map((i) => {
            const a = Math.PI / 4 + (i / 4) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.cos(a) * 0.4, 2.88, Math.sin(a) * 0.4]} rotation={[Math.PI, 0, Math.cos(a) * 0.3]} material={plumeMats.retro}>
                <cylinderGeometry args={[0.015, 0.07, 0.36, 12, 1, true]} />
              </mesh>
            );
          })}
        </group>

        {/* Sea-level plume — individual engine cores inside a merged outer plume */}
        <group ref={plume1Ref} position={[0, -0.06, 0]}>
          {[[0, 0], ...OUTBOARD].map(([x, z], i) => (
            <mesh key={i} position={[x, -0.38, z]} material={plumeMats.core}>
              <cylinderGeometry args={[0.1, 0.07, 0.76, 12, 1, true]} />
            </mesh>
          ))}
          <mesh position={[0, -0.8, 0]} material={plumeMats.mid}>
            <cylinderGeometry args={[0.36, 0.3, 1.6, 24, 1, true]} />
          </mesh>
          <mesh position={[0, -1.2, 0]} material={plumeMats.outer}>
            <cylinderGeometry args={[0.44, 0.62, 2.4, 24, 1, true]} />
          </mesh>
          {[-0.28, -0.5, -0.72].map((y) => (
            <mesh key={y} position={[0, y, 0]}>
              <sphereGeometry args={[0.04, 10, 10]} />
              <meshBasicMaterial color="#fff0d0" transparent opacity={0.7} blending={THREE.AdditiveBlending} depthWrite={false} />
            </mesh>
          ))}
          <pointLight ref={light1Ref} color="#FF8A45" intensity={4.5} distance={9} position={[0, -0.6, 0]} />
        </group>
      </group>

      {/* ============ STAGE 2 + SPACECRAFT (continues the mission) ============ */}
      {/* Aft thrust cone + vacuum engine (hidden inside the interstage until separation) */}
      <mesh geometry={S.batch.hw2} material={S.mat.hardware} />
      <mesh geometry={S.batch.cav2} material={S.mat.cavity} />
      <mesh geometry={S.batch.les} material={S.mat.les} />
      <mesh geometry={S.batch.orange2} material={S.mat.orange} />
      <mesh geometry={S.batch.silver2} material={S.mat.silver} />
      <group position={[0, 2.5, 0]}>
        <mesh geometry={S.geo.bell2} material={bell2Mat} />
        <mesh geometry={S.geo.bell2Inner} material={bellInner2} position={[0, 0.004, 0]} />
      </group>

      {/* Vacuum plume — structured near the nozzle, wide and diffuse downstream */}
      <group ref={plume2Ref} position={[0, 2.5, 0]}>
        <mesh position={[0, -0.45, 0]} material={plumeMats.vacCore}>
          <cylinderGeometry args={[0.18, 0.3, 0.9, 24, 1, true]} />
        </mesh>
        <mesh position={[0, -1.3, 0]} material={plumeMats.vacExpand}>
          <cylinderGeometry args={[0.2, 1.1, 2.6, 28, 1, true]} />
        </mesh>
        <mesh position={[0, -1.5, 0]} material={plumeMats.vacHaze}>
          <cylinderGeometry args={[0.22, 1.5, 3.0, 20, 1, true]} />
        </mesh>
        <pointLight ref={light2Ref} color="#9fbaff" intensity={0} distance={5} position={[0, -0.5, 0]} />
      </group>

      {/* Stage 2 body */}
      <mesh position={[0, 3.54, 0]} material={S.mat.paint2}>
        <cylinderGeometry args={[0.3, 0.34, 1.36, 32, 1, true]} />
      </mesh>
      <mesh position={[0, 3.2, 0]} material={S.mat.white}>
        <cylinderGeometry args={[0.328, 0.328, 0.022, 32]} />
      </mesh>
      <mesh position={[0, 4.19, 0]} material={S.mat.black}>
        <cylinderGeometry args={[0.302, 0.302, 0.06, 32]} />
      </mesh>

      {/* Service module — radiator panels + dark band + RCS */}
      <mesh position={[0, 4.51, 0]} material={S.mat.radiator}>
        <cylinderGeometry args={[0.26, 0.265, 0.42, 32]} />
      </mesh>
      {/* Beacon */}
      <mesh position={[0, 5.62, 0.031]}>
        <sphereGeometry args={[0.008, 8, 8]} />
        <meshBasicMaterial color="#FF3B00" />
      </mesh>
    </group>
  );
}
