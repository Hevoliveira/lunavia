import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { buildCM, buildHGA, buildSM, hgaRotation, HGA, PARTS, RCS_THRUSTERS, SM_MARK_U, SM_RADIATORS } from "@/data/csmDesign";

/**
 * LUNAVIA's command and service module (shape: data/csmDesign.js, metres).
 *
 * The one spacecraft of the expedition: RocketModel carries it to orbit,
 * SpacecraftStack docks the lunar module to it, the lunar-orbit shots and the
 * opening fly it, and ReentryScene's capsule is its command module.
 *
 * **Materials.**
 * - Service module: white paint in six panel sectors, two radiator panels,
 *   the fine radiator band under the fairing, LUNAVIA's orange band, a black
 *   aft band and the LUNAVIA · LV-001 marking (one procedural texture).
 * - Command module: silver thermal skin with its panel seams, and the orange
 *   band above the shoulder.
 * - Bare metal, dark engine, white RCS panels and antenna dishes, dark glass.
 *
 * No material carries its own environment map: they take the host scene's
 * (`scene.environment`), so the same model reads correctly over the Earth at
 * launch and over the Moon in lunar orbit.
 *
 * **Props.** `cm`, `sm`: draw either module (the reentry draws the CM alone).
 * `rcsRef` (optional, a ref holding an array, one 0..1 per RCS_THRUSTERS entry)
 * fires the service module's thrusters every frame without React renders.
 *
 * **iPhone cost.** About 11 draw calls for the static body (one merged
 * geometry per material) and one instanced mesh for the RCS puffs.
 */

/* ---- textures (procedural, made once) --------------------------------------------- */
let TEX = null;
function rand(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}
function canvas(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  return c;
}
const tex = (c, srgb = true) => {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

function textures() {
  if (TEX) return TEX;
  const r = rand(11);
  // Service module skin. u runs round the drum from the hatch side (+Z) towards +X;
  // the canvas top is the drum's top.
  const W = 2048;
  const H = 512;
  const RAD = SM_RADIATORS; // radiator panels, as u ranges
  const sm = canvas(W, H, (g) => {
    g.fillStyle = "#e9e8e2";
    g.fillRect(0, 0, W, H);
    // Six sectors, each a little different in tone, three panels high.
    for (let s = 0; s < 6; s++) {
      for (let p = 0; p < 3; p++) {
        const v = 226 + Math.floor(r() * 16);
        g.fillStyle = `rgb(${v},${v},${v - 4})`;
        g.fillRect((s * W) / 6 + 2, H * (0.16 + p * 0.25) + 2, W / 6 - 4, H * 0.25 - 4);
      }
    }
    // Radiator band under the fairing: fine silver fins.
    for (let x = 0; x < W; x += 6) {
      g.fillStyle = x % 12 ? "#b9bcc2" : "#8d9198";
      g.fillRect(x, H * 0.045, 5, H * 0.075);
    }
    // LUNAVIA orange band.
    g.fillStyle = "#ff3b00";
    g.fillRect(0, H * 0.125, W, H * 0.03);
    // Radiator panels: silver strips with dark gaps.
    RAD.forEach(([u0, u1]) => {
      const x0 = u0 * W;
      const x1 = u1 * W;
      g.fillStyle = "#2b2f35";
      g.fillRect(x0 - 3, H * 0.24, x1 - x0 + 6, H * 0.52);
      const n = 26;
      for (let i = 0; i < n; i++) {
        g.fillStyle = i % 2 ? "#c9ccd2" : "#dadde2";
        g.fillRect(x0 + ((x1 - x0) * i) / n + 1, H * 0.245, (x1 - x0) / n - 2, H * 0.51);
      }
    });
    // Panel seams and fasteners.
    g.strokeStyle = "rgba(80,80,78,0.55)";
    g.lineWidth = 2;
    for (let s = 0; s <= 6; s++) {
      g.beginPath();
      g.moveTo((s * W) / 6, H * 0.155);
      g.lineTo((s * W) / 6, H * 0.94);
      g.stroke();
    }
    [0.155, 0.41, 0.66, 0.91].forEach((v) => {
      g.beginPath();
      g.moveTo(0, H * v);
      g.lineTo(W, H * v);
      g.stroke();
    });
    g.fillStyle = "rgba(70,70,70,0.35)";
    for (let s = 0; s < 6; s++) for (let i = 0; i < 40; i++) g.fillRect((s * W) / 6 + 5, H * (0.17 + i * 0.019), 2, 2);
    // Aft black band.
    g.fillStyle = "#17181b";
    g.fillRect(0, H * 0.94, W, H * 0.06);
    // Marking between the radiators, on the side the cameras favour: LUNAVIA along the
    // drum's axis (it reads level when the spacecraft flies horizontally, as in every
    // space shot), with LV-001 and an orange rule beside it. The texture has 167 px/m
    // round the drum and 119 px/m along it; the lettering is drawn to true proportions.
    const mark = (u) => {
      const k = 119 / 167;
      const along = (text, size, dx, color, track) => {
        g.save();
        g.translate(u * W + dx, H * 0.53);
        g.scale(1, k);
        g.rotate(-Math.PI / 2);
        g.fillStyle = color;
        g.font = `bold ${size}px Helvetica, Arial, sans-serif`;
        g.textBaseline = "middle";
        const chars = text.split("");
        const widths = chars.map((c) => g.measureText(c).width);
        const total = widths.reduce((a, b) => a + b, 0) + track * (chars.length - 1);
        let x = -total / 2;
        chars.forEach((c, i) => {
          g.fillText(c, x, 0);
          x += widths[i] + track;
        });
        g.restore();
      };
      along("LUNAVIA", 74, 0, "#16171a", 26);
      along("LV-001", 30, 58, "#3a3c40", 10);
      g.fillStyle = "#ff3b00";
      g.fillRect(u * W - 52, H * 0.53 - (H * 0.62) / 2, 7, H * 0.62);
    };
    mark(SM_MARK_U);
    // Light wear near the aft end.
    for (let i = 0; i < 160; i++) {
      g.fillStyle = `rgba(80,74,66,${0.03 + r() * 0.05})`;
      g.fillRect(r() * W, H * (0.8 + r() * 0.13), 1 + r() * 3, 2 + r() * 10);
    }
  });
  const smBump = canvas(512, 128, (g, w, h) => {
    g.fillStyle = "#808080";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#5a5a5a";
    for (let s = 0; s <= 6; s++) g.fillRect((s * w) / 6 - 1, 0, 2, h);
    [0.155, 0.41, 0.66, 0.91].forEach((v) => g.fillRect(0, h * v - 1, w, 2));
    for (let x = 0; x < w; x += 2) {
      g.fillStyle = x % 4 ? "#9a9a9a" : "#707070";
      g.fillRect(x, h * 0.045, 1, h * 0.075);
    }
  });
  // Command module skin: silver panels with seams (lathe uv: u round, v along the profile).
  const cm = canvas(1024, 256, (g, w, h) => {
    g.fillStyle = "#cfd1d5";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 16; i++) {
      for (let j = 0; j < 4; j++) {
        const v = 196 + Math.floor(r() * 26);
        g.fillStyle = `rgb(${v},${v + 1},${v + 4})`;
        g.fillRect((i * w) / 16 + 1, (j * h) / 4 + 1, w / 16 - 2, h / 4 - 2);
      }
    }
    g.strokeStyle = "rgba(60,62,66,0.6)";
    g.lineWidth = 2;
    for (let i = 0; i <= 16; i++) {
      g.beginPath();
      g.moveTo((i * w) / 16, 0);
      g.lineTo((i * w) / 16, h);
      g.stroke();
    }
  });
  const cmBump = canvas(512, 128, (g, w, h) => {
    g.fillStyle = "#808080";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#4e4e4e";
    for (let i = 0; i <= 16; i++) g.fillRect((i * w) / 16 - 1, 0, 2, h);
    for (let j = 0; j <= 4; j++) g.fillRect(0, (j * h) / 4 - 1, w, 2);
  });
  // Heat shield: ablator, darker towards the rim.
  const shield = canvas(256, 64, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, "#5f564c");
    gr.addColorStop(1, "#3a332d");
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(30,26,22,${0.1 + r() * 0.2})`;
      g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
    }
  });
  TEX = {
    sm: tex(sm),
    smBump: tex(smBump, false),
    cm: tex(cm),
    cmBump: tex(cmBump, false),
    shield: tex(shield),
  };
  return TEX;
}

let MATS = null;
export function csmMaterials() {
  if (MATS) return MATS;
  const T = textures();
  const std = (o) => new THREE.MeshStandardMaterial(o);
  MATS = {
    smSkin: std({ map: T.sm, bumpMap: T.smBump, bumpScale: 0.6, roughness: 0.5, metalness: 0.12, envMapIntensity: 0.45 }),
    fairing: std({ color: "#dedfe0", roughness: 0.42, metalness: 0.3, envMapIntensity: 0.6 }),
    cmSkin: std({ map: T.cm, bumpMap: T.cmBump, bumpScale: 0.8, roughness: 0.34, metalness: 0.72, envMapIntensity: 1.0 }),
    shield: std({ map: T.shield, roughness: 0.9, metalness: 0.05, envMapIntensity: 0.3 }),
    metal: std({ color: "#b9bdc4", roughness: 0.38, metalness: 0.75, envMapIntensity: 0.9 }),
    black: std({ color: "#17181b", roughness: 0.7, metalness: 0.2, envMapIntensity: 0.4 }),
    white: std({ color: "#ecebe6", roughness: 0.5, metalness: 0.1, envMapIntensity: 0.45 }),
    accent: std({ color: "#ff3b00", roughness: 0.55, metalness: 0.08, envMapIntensity: 0.4 }),
    glass: std({ color: "#0a0d12", roughness: 0.08, metalness: 0.9, envMapIntensity: 1.6, side: THREE.DoubleSide }),
    engine: std({ color: "#4d5057", roughness: 0.42, metalness: 0.7, envMapIntensity: 0.8, side: THREE.DoubleSide }),
    engineInner: std({ color: "#111113", roughness: 0.85, metalness: 0.2, side: THREE.BackSide, emissive: "#ff7a2c", emissiveIntensity: 0 }),
  };
  return MATS;
}

let GEO = null;
function geometry() {
  if (GEO) return GEO;
  GEO = { cm: buildCM(), sm: buildSM(), hga: buildHGA() };
  return GEO;
}

/* ---- RCS puffs: short, faint, fast-widening jets (vacuum) --------------------------- */
const PUFF_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }
`;
const PUFF_FRAG = /* glsl */ `
  varying vec2 vUv;
  void main() {
    float along = 1.0 - vUv.y;         // 0 at the nozzle, 1 at the end
    float a = pow(1.0 - along, 1.8) * 0.62;
    gl_FragColor = vec4(vec3(0.92, 0.95, 1.0) * a, a);
  }
`;
let PUFF_GEO = null;
function puffGeometry() {
  if (PUFF_GEO) return PUFF_GEO;
  // A cone along +Y from the nozzle (y = 0) out to 1 (scaled per instance).
  PUFF_GEO = new THREE.CylinderGeometry(0.5, 0.05, 1, 12, 1, true).translate(0, 0.5, 0);
  return PUFF_GEO;
}
export function makePuffMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: PUFF_VERT,
    fragmentShader: PUFF_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();

/**
 * Thruster puffs for a list of thrusters ({ pos, dir }, metres in the parent's
 * frame): `levelsRef.current[i]` 0..1 sets each one's length every frame.
 */
export function RcsPuffs({ thrusters, levelsRef, length = 2.0 }) {
  const ref = useRef();
  const mat = useMemo(makePuffMaterial, []);
  const zero = useMemo(() => new THREE.Matrix4().makeScale(0, 0, 0), []);
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const lv = (levelsRef && levelsRef.current) || [];
    let any = false;
    thrusters.forEach((th, i) => {
      const k = lv[i] || 0;
      if (k < 0.02) {
        mesh.setMatrixAt(i, zero);
        return;
      }
      any = true;
      _d.set(th.dir[0], th.dir[1], th.dir[2]).normalize();
      _q.setFromUnitVectors(_up, _d);
      const L = length * (0.4 + 0.6 * k);
      _s.set(L * 0.34, L, L * 0.34);
      _p.set(th.pos[0], th.pos[1], th.pos[2]);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
    });
    mesh.visible = any;
    mesh.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[puffGeometry(), mat, thrusters.length]} frustumCulled={false} renderOrder={3} visible={false} />;
}

/**
 * The high-gain antenna on its hinge. `hgaRef.current` (0 folded for launch .. 1
 * deployed) is read every frame; without it the antenna is deployed.
 */
function HighGainAntenna({ hgaRef, castShadow, receiveShadow }) {
  const G = geometry();
  const M = csmMaterials();
  const ref = useRef();
  const last = useRef(null);
  const set = (k) => {
    if (!ref.current || last.current === k) return;
    last.current = k;
    ref.current.quaternion.set(...hgaRotation(k));
  };
  useFrame(() => set(hgaRef && hgaRef.current != null ? hgaRef.current : 1));
  return (
    <group ref={ref} position={HGA.root} quaternion={hgaRotation(hgaRef && hgaRef.current != null ? hgaRef.current : 1)}>
      {["metal", "white", "black"].map((p) => (
        <mesh key={p} geometry={G.hga[p]} material={M[p]} castShadow={castShadow} receiveShadow={receiveShadow} />
      ))}
    </group>
  );
}

export default function CsmModel({ cm = true, sm = true, rcsRef = null, hgaRef = null, castShadow = false, receiveShadow = false }) {
  const G = geometry();
  const M = csmMaterials();
  const parts = (set) =>
    PARTS.filter((p) => set[p]).map((p) => (
      <mesh key={p} geometry={set[p]} material={M[p]} castShadow={castShadow && p !== "glass"} receiveShadow={receiveShadow} />
    ));
  return (
    <group name="CSM">
      {cm && <group name="CM">{parts(G.cm)}</group>}
      {sm && (
        <group name="SM">
          {parts(G.sm)}
          <HighGainAntenna hgaRef={hgaRef} castShadow={castShadow} receiveShadow={receiveShadow} />
          {rcsRef && <RcsPuffs thrusters={RCS_THRUSTERS} levelsRef={rcsRef} />}
        </group>
      )}
    </group>
  );
}
