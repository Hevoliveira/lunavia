import { useRef, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { LM } from "@/data/touchdownFx";
import { EXIT_R, EXIT_Y, PAD_H, PROBE_L, SLEEVE, buildBody, buildPad, legFrames } from "@/data/lmDesign";

/**
 * LUNAVIA's lunar module (shape: data/lmDesign.js).
 *
 * **Materials.** They read under the Moon's hard, low sun:
 * - matte light-grey paint on the ascent stage, with panel seams and a little wear;
 * - darker painted equipment;
 * - crinkled gold and black thermal foil on the descent stage;
 * - bare metal on the structure, antennas and engine;
 * - dark glass windows;
 * - LUNAVIA's orange bands on the pods.
 *
 * A small environment of black sky over bright grey regolith lights the metal
 * and foil from below, as the sunlit ground does, without softening the
 * shadows.
 *
 * **Props.** `fx` (optional, a ref's current object) drives the model every
 * frame without React renders: { thrust 0..1, comp: [4] strut compression
 * (scene units), probe: [4] probe bend (radians) }. Without it the LM stands
 * at rest and `thrust` sets the engine.
 *
 * **iPhone cost.** About 15 draw calls:
 * - the body is one merged geometry per material (10);
 * - every strut, probe and ladder part is one instance of a single
 *   InstancedMesh, and the four footpads are another (2);
 * - the plume is two additive cones (2).
 */

const S = LM.scale;

/* ---- shared textures (procedural, made once) ------------------------------------- */
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
function textures() {
  if (TEX) return TEX;
  const r = rand(7);
  // Thermal foil: crinkled facets catching the light differently, and a few creases.
  const foil = canvas(256, 256, (g, W, H) => {
    g.fillStyle = "#c8c8c8";
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 700; i++) {
      const x = r() * W;
      const y = r() * H;
      const s = 5 + r() * 16;
      const v = Math.floor(172 + r() * 70);
      g.fillStyle = `rgba(${v},${v},${v},0.8)`;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * s * 2, y + (r() - 0.5) * s);
      g.lineTo(x + (r() - 0.5) * s, y + (r() - 0.5) * s * 2);
      g.closePath();
      g.fill();
    }
    g.strokeStyle = "rgba(90,90,90,0.4)";
    for (let i = 0; i < 26; i++) {
      g.lineWidth = 0.6 + r() * 1.2;
      g.beginPath();
      let x = r() * W;
      let y = r() * H;
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (r() - 0.5) * 50;
        y += (r() - 0.5) * 50;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });
  // Painted skin: panels in slightly different shades, seams, fasteners, light wear.
  const panel = canvas(256, 256, (g, W, H) => {
    g.fillStyle = "#e8e8e8";
    g.fillRect(0, 0, W, H);
    const cols = [0, 70, 150, 256];
    const rows = [0, 96, 180, 256];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const v = Math.floor(218 + r() * 30);
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(cols[i] + 1, rows[j] + 1, cols[i + 1] - cols[i] - 2, rows[j + 1] - rows[j] - 2);
      }
    }
    g.fillStyle = "#6e6e6e";
    cols.forEach((x) => g.fillRect(x - 1, 0, 2, H));
    rows.forEach((y) => g.fillRect(0, y - 1, W, 2));
    g.fillStyle = "#9a9a9a";
    rows.forEach((y) => {
      for (let x = 4; x < W; x += 9) g.fillRect(x, y + 4, 2, 2);
    });
    for (let i = 0; i < 60; i++) {
      const v = Math.floor(170 + r() * 40);
      g.fillStyle = `rgba(${v},${v},${v},0.18)`;
      g.fillRect(r() * W, r() * H, 1 + r() * 3, 10 + r() * 60);
    }
  });
  // Engine bell lining: hot at the throat, dark at the exit.
  const glow = canvas(4, 64, (g, W, H) => {
    const gr = g.createLinearGradient(0, H, 0, 0);
    gr.addColorStop(0, "#ffffff");
    gr.addColorStop(0.35, "#6a6a6a");
    gr.addColorStop(1, "#000000");
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
  });
  const tex = (c, srgb, repeat) => {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 4;
    return t;
  };
  TEX = {
    foil: tex(foil, true, 3.2),
    foilData: tex(foil, false, 3.2),
    panel: tex(panel, true, 2.4),
    panelData: tex(panel, false, 2.4),
    glow: tex(glow, true, 1),
  };
  return TEX;
}

/* ---- lunar environment: black sky over sunlit regolith (one per renderer) -------- */
const ENVS = new WeakMap();
export function lunarEnv(gl) {
  if (ENVS.has(gl)) return ENVS.get(gl);
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec3 vP; void main(){
        vec3 d = normalize(vP);
        float ground = smoothstep(0.04, -0.3, d.y);
        vec3 c = mix(vec3(0.004, 0.005, 0.008), vec3(0.4, 0.38, 0.35), ground);
        c += vec3(0.12, 0.115, 0.105) * exp(-abs(d.y) * 16.0); // bright horizon band
        gl_FragColor = vec4(c, 1.0);
      }`,
    })
  );
  scene.add(mesh);
  const pm = new THREE.PMREMGenerator(gl);
  const env = pm.fromScene(scene, 0.04).texture;
  pm.dispose();
  mesh.geometry.dispose();
  mesh.material.dispose();
  ENVS.set(gl, env);
  return env;
}

function materials(env) {
  const T = textures();
  const std = (o) => new THREE.MeshStandardMaterial({ envMap: env, ...o });
  return {
    paint: std({ color: "#cbc8bf", map: T.panel, bumpMap: T.panelData, bumpScale: 0.5, roughness: 0.68, metalness: 0.05, envMapIntensity: 0.32 }),
    paintDark: std({ color: "#46484e", map: T.panel, bumpMap: T.panelData, bumpScale: 0.4, roughness: 0.58, metalness: 0.15, envMapIntensity: 0.4 }),
    foilGold: std({ color: "#d9a546", map: T.foil, roughnessMap: T.foilData, bumpMap: T.foilData, bumpScale: 1.6, roughness: 0.55, metalness: 0.8, envMapIntensity: 1.15 }),
    foilDark: std({ color: "#3b342c", map: T.foil, roughnessMap: T.foilData, bumpMap: T.foilData, bumpScale: 1.6, roughness: 0.6, metalness: 0.6, envMapIntensity: 0.9 }),
    metal: std({ color: "#c6c9cf", roughness: 0.36, metalness: 0.78, envMapIntensity: 1 }),
    engine: std({ color: "#5c5f66", roughness: 0.4, metalness: 0.72, envMapIntensity: 0.85 }),
    engineInner: std({ color: "#121214", roughness: 0.85, metalness: 0.2, side: THREE.BackSide, emissive: "#ff7a2c", emissiveMap: T.glow, emissiveIntensity: 0 }),
    glass: std({ color: "#0b0e13", roughness: 0.06, metalness: 0.9, envMapIntensity: 1.7, side: THREE.DoubleSide }),
    black: std({ color: "#1a1a1c", roughness: 0.78, metalness: 0.12, envMapIntensity: 0.4 }),
    accent: std({ color: "#e24a1c", roughness: 0.6, metalness: 0.05, envMapIntensity: 0.4 }),
  };
}

/* ---- shared geometry (made once) --------------------------------------------------- */
let GEO = null;
const LEGS = legFrames();
const ROD_COUNT = LEGS.length * 7 + LM.probes.filter(Boolean).length + 2 + 7;
function geometry() {
  if (GEO) return GEO;
  const plume = (r0, r1) => new THREE.CylinderGeometry(r0, r1, 1, 28, 1, true).translate(0, -0.5, 0);
  GEO = {
    body: buildBody(),
    pad: buildPad(),
    rod: new THREE.CylinderGeometry(1, 1, 1, 10),
    plume: plume(EXIT_R * 0.96, 0.36),
    core: plume(EXIT_R * 0.72, 0.03),
  };
  return GEO;
}

/* ---- plume: in vacuum it is short, faint and widens fast; it starts at the exit ---- */
const PLUME_VERT = /* glsl */ `
  varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const PLUME_FRAG = /* glsl */ `
  uniform float uThrust, uTime, uGain, uAdd;
  uniform vec3 uHot, uCool;
  varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  void main() {
    float s = 1.0 - vUv.y; // 0 at the nozzle exit, 1 at the tail
    float fall = pow(1.0 - s, 1.7);
    float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    float flick = 0.88 + 0.12 * sin(uTime * 47.0 + vUv.x * 31.4) * sin(uTime * 29.0 + s * 9.0);
    float a = clamp(uGain * uThrust * fall * (0.3 + 0.7 * rim * rim) * flick, 0.0, 1.0);
    gl_FragColor = vec4(mix(uHot, uCool, s) * (uAdd > 0.5 ? a : 1.0), a);
  }`;
function plumeMaterial(gain, hot, cool, additive) {
  return new THREE.ShaderMaterial({
    vertexShader: PLUME_VERT,
    fragmentShader: PLUME_FRAG,
    uniforms: { uThrust: { value: 0 }, uTime: { value: 0 }, uGain: { value: gain }, uAdd: { value: additive ? 1 : 0 }, uHot: { value: new THREE.Color(hot) }, uCool: { value: new THREE.Color(cool) } },
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
}

/* ---- landing gear, rebuilt only when a strut or probe moves -------------------------- */
const COLOR = {
  sleeve: new THREE.Color("#c4973f"), // foil-wrapped primary strut
  collar: new THREE.Color("#2b2b2f"), // shock-absorber housing
  piston: new THREE.Color("#e6e7ea"),
  secondary: new THREE.Color("#9c7a3c"),
  lock: new THREE.Color("#b9bcc2"),
  probe: new THREE.Color("#dcdde1"),
  ladder: new THREE.Color("#b3b6bc"),
};
const RAD = { sleeve: 0.034, collar: 0.043, piston: 0.021, secondary: 0.014, lock: 0.009, probe: 0.007, rail: 0.007, rung: 0.005 };
const _d = new THREE.Vector3();
const _m = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _M = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _P = new THREE.Vector3();
const _A = new THREE.Vector3();
const _B = new THREE.Vector3();

/** Instance matrix of a unit cylinder (radius 1, height 1) laid between a and b with radius r. */
function rodMatrix(a, b, r) {
  _d.subVectors(b, a);
  const len = _d.length() || 1e-6;
  _m.addVectors(a, b).multiplyScalar(0.5);
  _q.setFromUnitVectors(_up, _d.multiplyScalar(1 / len));
  _s.set(r, len, r);
  return _M.compose(_m, _q, _s);
}

// The ladder hangs on the front strut's sleeve, so it does not move with the piston.
const LADDER = (() => {
  const L = LEGS.find((l) => l.ladder);
  const off = (s) => L.side.clone().multiplyScalar(s).addScaledVector(L.dir, 0.035);
  const top = L.upper.clone().addScaledVector(L.axis, -0.05);
  const bottom = L.padTop.clone().addScaledVector(L.axis, 0.14);
  const rails = [-1, 1].map((s) => [top.clone().add(off(s * 0.045)), bottom.clone().add(off(s * 0.045))]);
  const rungs = [];
  for (let i = 1; i <= 7; i++) {
    const c = top.clone().lerp(bottom, i / 8);
    rungs.push([c.clone().add(off(-0.045)), c.clone().add(off(0.045))]);
  }
  return { rails, rungs };
})();

export default function LanderModel({ thrust = 0, scale = 1, fx = null }) {
  const gl = useThree((s) => s.gl);
  const G = geometry();
  const M = useMemo(() => materials(lunarEnv(gl)), [gl]);
  const plumeMat = useMemo(() => plumeMaterial(0.62, "#fff3dc", "#ffb07a", false), []);
  const coreMat = useMemo(() => plumeMaterial(1.5, "#ffffff", "#ffc27a", true), []);
  const plumeRef = useRef();
  const coreRef = useRef();
  const lightRef = useRef();
  const rodsRef = useRef();
  const padsRef = useRef();
  const last = useRef(null);

  useFrame((state) => {
    const f = fx || {};
    const k = Math.max(0, f.thrust != null ? f.thrust : thrust);
    const t = state.clock.elapsedTime;
    // Engine: the plume starts at the exit plane, and the bell lining glows from the throat.
    const on = k > 0.03;
    if (plumeRef.current) {
      plumeRef.current.visible = on;
      plumeRef.current.scale.set(0.8 + 0.3 * k, (0.18 + 0.7 * k) * (1 + 0.06 * Math.sin(t * 53)), 0.8 + 0.3 * k);
      coreRef.current.visible = on;
      coreRef.current.scale.set(1, 0.08 + 0.3 * k, 1);
      plumeMat.uniforms.uThrust.value = k;
      plumeMat.uniforms.uTime.value = t;
      coreMat.uniforms.uThrust.value = k;
      coreMat.uniforms.uTime.value = t;
    }
    M.engineInner.emissiveIntensity = 1.8 * k;
    if (lightRef.current) lightRef.current.intensity = 2.6 * k;

    // Legs.
    const comp = f.comp || [0, 0, 0, 0];
    const probe = f.probe || [0, 0, 0, 0];
    const key = comp.map((v) => v.toFixed(4)).join() + probe.map((v) => v.toFixed(3)).join();
    const rods = rodsRef.current;
    const pads = padsRef.current;
    if (!rods || !pads || last.current === key) return;
    last.current = key;
    let n = 0;
    const put = (a, b, r, color) => {
      rods.setMatrixAt(n, rodMatrix(a, b, r));
      rods.setColorAt(n, color);
      n++;
    };
    LEGS.forEach((L, i) => {
      // The pad strokes up along the strut so that it rises comp/scale vertically.
      _P.copy(L.padTop).addScaledVector(L.axis, comp[i] / S / L.axis.y);
      pads.setMatrixAt(i, _M.makeTranslation(_P.x, _P.y - PAD_H, _P.z));
      const sleeveEnd = _A.copy(L.upper).addScaledVector(L.axis, -L.len * SLEEVE);
      put(L.upper, sleeveEnd, RAD.sleeve, COLOR.sleeve);
      put(_B.copy(sleeveEnd).addScaledVector(L.axis, 0.012), sleeveEnd.clone().addScaledVector(L.axis, -0.032), RAD.collar, COLOR.collar);
      put(sleeveEnd.clone().addScaledVector(L.axis, -0.02), _P, RAD.piston, COLOR.piston);
      const low = _B.copy(_P).addScaledVector(L.axis, 0.07);
      L.sec.forEach((s) => put(s, low, RAD.secondary, COLOR.secondary));
      L.lock.forEach((s) => put(s, L.lockAt, RAD.lock, COLOR.lock));
      if (L.probe) {
        // The probe hangs from under the pad and folds outward as it meets the ground.
        const root = _B.copy(_P).setY(_P.y - PAD_H);
        const b = probe[i];
        _d.set(L.dir.x * Math.sin(b), -Math.cos(b), L.dir.z * Math.sin(b)).multiplyScalar(PROBE_L).add(root);
        put(root.clone(), _d.clone(), RAD.probe, COLOR.probe);
      }
    });
    LADDER.rails.forEach(([a, b]) => put(a, b, RAD.rail, COLOR.ladder));
    LADDER.rungs.forEach(([a, b]) => put(a, b, RAD.rung, COLOR.ladder));
    rods.count = n;
    rods.instanceMatrix.needsUpdate = true;
    if (rods.instanceColor) rods.instanceColor.needsUpdate = true;
    pads.instanceMatrix.needsUpdate = true;
  });

  return (
    <group scale={scale} name="LM">
      {Object.entries(G.body).map(([part, geo]) => (
        <mesh key={part} geometry={geo} material={M[part]} castShadow={part !== "glass"} receiveShadow />
      ))}
      <instancedMesh ref={rodsRef} args={[G.rod, undefined, ROD_COUNT]} frustumCulled={false} castShadow receiveShadow>
        <meshStandardMaterial color="#ffffff" roughness={0.42} metalness={0.55} envMap={M.metal.envMap} envMapIntensity={0.9} />
      </instancedMesh>
      <instancedMesh ref={padsRef} args={[G.pad, undefined, 4]} frustumCulled={false} castShadow receiveShadow>
        <meshStandardMaterial color="#aeb1b7" roughness={0.42} metalness={0.65} envMap={M.metal.envMap} envMapIntensity={0.9} />
      </instancedMesh>
      <mesh ref={plumeRef} geometry={G.plume} material={plumeMat} position={[0, EXIT_Y, 0]} visible={false} renderOrder={2} />
      <mesh ref={coreRef} geometry={G.core} material={coreMat} position={[0, EXIT_Y, 0]} visible={false} renderOrder={2} />
      <pointLight ref={lightRef} position={[0, EXIT_Y - 0.25, 0]} color="#FF8A4B" intensity={fx ? 0 : 2.5 * thrust} distance={3} />
    </group>
  );
}
