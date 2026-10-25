import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { lunarEnv } from "@/components/LanderModel";
import { foilTextures } from "./evaTextures";
import { DEPLOY_PHASES } from "@/data/astronautRig";
import { DEPLOY_TIME, currentTarget } from "@/data/evaMissions";

/**
 * The expeditions' science on the ground (metres, inside the EVA's 0.5-units-per-metre group):
 * the sample stones (each rock type its own shape and tone), the rings that mark the current
 * targets, and the instruments the crew deploys (a seismometer, a gnomon, a low-frequency radio
 * antenna), each folded in the hands, set down and unfolding. A few small meshes each (repeated
 * parts instanced: the antenna's elements and tips, the gnomon's legs, the seismometer's panels).
 */
const smooth = (x) => {
  const u = Math.max(0, Math.min(1, x));
  return u * u * (3 - 2 * u);
};
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

/* ---- sample stones ------------------------------------------------------------------------------ */
// mare: the Sea of Tranquility's stone exactly as phase 1 drew it
const STONES = {
  mare: { seed: 5, size: 0.065, detail: 1, s: [1.15, 0.7, 1], jag: 0.5, color: "#5f5a53", roughness: 0.95, metalness: 0, lift: 0.035 },
  basalt: { seed: 11, size: 0.07, detail: 1, s: [1.2, 0.72, 1], jag: 0.6, color: "#4a4642", roughness: 0.9, metalness: 0, lift: 0.04 },
  breccia: { seed: 17, size: 0.075, detail: 0, s: [1.1, 0.8, 1.05], jag: 0.7, color: "#8e877c", roughness: 0.95, metalness: 0, lift: 0.045, flat: true },
  melt: { seed: 23, size: 0.062, detail: 1, s: [1.25, 0.6, 1], jag: 0.45, color: "#2e2b28", roughness: 0.42, metalness: 0.08, lift: 0.03 },
  ejecta: { seed: 29, size: 0.08, detail: 0, s: [1.15, 0.85, 0.95], jag: 0.8, color: "#a39d92", roughness: 0.95, metalness: 0, lift: 0.05, flat: true },
  basin: { seed: 31, size: 0.07, detail: 1, s: [1.15, 0.7, 1], jag: 0.55, color: "#65656a", roughness: 0.92, metalness: 0, lift: 0.04 },
  // Apollo Legacy (Apollo 15): pale highland material from the Apennine talus
  anorthosite: { seed: 37, size: 0.072, detail: 0, s: [1.1, 0.78, 1], jag: 0.65, color: "#c9c4b8", roughness: 0.9, metalness: 0, lift: 0.045, flat: true },
};
export function stoneGeometry(type = "mare") {
  const k = STONES[type] || STONES.mare;
  const g = new THREE.IcosahedronGeometry(k.size, k.detail);
  const p = g.attributes.position;
  let s = k.seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    if (!seen.has(key)) seen.set(key, 1 - k.jag / 2 + r() * k.jag);
    const m = seen.get(key);
    p.setXYZ(i, p.getX(i) * m * k.s[0], p.getY(i) * m * k.s[1], p.getZ(i) * m * k.s[2]);
  }
  g.computeVertexNormals();
  return g;
}
export const stoneLift = (type) => (STONES[type] || STONES.mare).lift;

function Stone({ sim, s }) {
  const ref = useRef();
  const geo = useMemo(() => stoneGeometry(s.type), [s.type]);
  const k = STONES[s.type] || STONES.mare;
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const active = sim.sample && sim.sample.id === s.id;
    const bagged = !active && (sim.samples.some((x) => x.id === s.id) || sim.sampleObjectiveDone);
    const where = active ? sim.sample.stoneIn : bagged ? "bag" : "ground";
    m.visible = where !== "bag";
    if (where === "scoop" && sim.sample.head) m.position.set(...sim.sample.head);
    else m.position.set(s.x, s.y + k.lift, s.z);
  });
  return (
    <mesh ref={ref} geometry={geo} castShadow receiveShadow>
      <meshStandardMaterial color={k.color} roughness={k.roughness} metalness={k.metalness} flatShading={!!k.flat} />
    </mesh>
  );
}

export function SampleStones({ sim }) {
  return (
    <>
      {sim.plan.samples.map((s) => (
        <Stone key={s.id} sim={sim} s={s} />
      ))}
    </>
  );
}

/* ---- the rings on the ground: the current target(s) ------------------------------------------------ */
export const RING = { sample: "#FF3B00", photo: "#4fd1c5", board: "#f5c451", survey: "#b5e06b", instrument: "#6aa8ff", data: "#6aa8ff", retrieve: "#e7a6ff" };
function Ring({ at, color, r, refOut }) {
  return (
    <mesh ref={refOut} position={[at.x, at.y + 0.03, at.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3} visible={false}>
      <ringGeometry args={[r * 0.86, r, 48]} />
      <meshBasicMaterial color={color} transparent opacity={0.8} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

export function ScienceMarkers({ sim }) {
  const plan = sim.plan;
  const samples = useRef(plan.samples.map(() => null));
  const photo = useRef();
  const ladder = useRef();
  const survey = useRef();
  const site = useRef();
  const data = useRef();
  const retrieve = useRef();
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const pulse = 0.75 + 0.25 * Math.sin(t * 3);
    const egress = sim.mode === "egress";
    const cur = egress ? null : currentTarget(plan, sim, sim.walker);
    const kind = cur ? cur.kind : null;
    const set = (m, on, op) => {
      if (!m) return;
      m.visible = on;
      m.material.opacity = op * pulse;
    };
    plan.samples.forEach((s, i) => set(samples.current[i], kind === "sample" && !sim.samples.some((x) => x.id === s.id) && !sim.sampleObjectiveDone, 0.8));
    set(photo.current, kind === "photo", 0.75);
    set(ladder.current, kind === "board" && sim.mode === "explore", 0.75);
    set(survey.current, kind === "survey", 0.75);
    set(site.current, kind === "instrument", 0.75);
    set(data.current, kind === "data", 0.7);
    set(retrieve.current, kind === "retrieve", 0.8);
  });
  const lm = sim.lm;
  return (
    <>
      {plan.samples.map((s, i) => (
        <Ring key={s.id} at={s} color={RING.sample} r={0.55} refOut={(m) => (samples.current[i] = m)} />
      ))}
      <Ring at={plan.photo} color={RING.photo} r={0.8} refOut={photo} />
      <Ring at={{ x: lm.board[0], y: lm.board[1], z: lm.board[2] }} color={RING.board} r={0.7} refOut={ladder} />
      {plan.survey && <Ring at={plan.survey} color={RING.survey} r={0.75} refOut={survey} />}
      {plan.instrument && <Ring at={plan.instrument} color={RING.instrument} r={0.75} refOut={site} />}
      {plan.instrument && <Ring at={plan.instrument} color={RING.data} r={1.15} refOut={data} />}
      {plan.retrieve && <Ring at={plan.retrieve} color={RING.retrieve} r={0.5} refOut={retrieve} />}
    </>
  );
}

/* ---- the instruments ---------------------------------------------------------------------------- */
function useMaterials() {
  const gl = useThree((s) => s.gl);
  const M = useMemo(() => {
    const env = lunarEnv(gl);
    const F = foilTextures();
    return {
      gold: new THREE.MeshStandardMaterial({ color: "#d4ac58", metalness: 0.85, roughness: 0.32, map: F.map, normalMap: F.normalMap, roughnessMap: F.roughnessMap, envMap: env, envMapIntensity: 1.1 }),
      mylar: new THREE.MeshStandardMaterial({ color: "#c9ccd1", metalness: 0.88, roughness: 0.28, normalMap: F.normalMap, envMap: env, envMapIntensity: 1.2, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }),
      white: new THREE.MeshStandardMaterial({ color: "#e6e3dc", metalness: 0.05, roughness: 0.55, envMap: env, envMapIntensity: 0.4 }),
      dark: new THREE.MeshStandardMaterial({ color: "#26272b", metalness: 0.3, roughness: 0.5 }),
      cell: new THREE.MeshStandardMaterial({ color: "#1b2340", metalness: 0.6, roughness: 0.3, envMap: env, envMapIntensity: 0.9 }),
      metal: new THREE.MeshStandardMaterial({ color: "#c4c7cc", metalness: 0.9, roughness: 0.3, envMap: env, envMapIntensity: 1 }),
      led: new THREE.MeshBasicMaterial({ color: "#f5c451", toneMapped: false }),
      chart: new THREE.MeshBasicMaterial({ map: chartTexture(), toneMapped: true }),
    };
  }, [gl]);
  useEffect(() => () => Object.values(M).forEach((m) => m.dispose()), [M]);
  return M;
}

function chartTexture() {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 64;
  const g = c.getContext("2d");
  ["#f2f2f2", "#9a9a9a", "#2a2a2a", "#c23b2a", "#2f7d3a", "#2b4fa8"].forEach((col, i) => {
    g.fillStyle = col;
    g.fillRect(0, (i * 64) / 6, 32, 64 / 6);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The passive seismometer: a foil-wrapped sensor on three feet, its thermal skirt and two small panels. */
function Seismometer({ M, unfold }) {
  const geo = useMemo(
    () => ({
      body: mergeGeometries([new THREE.CylinderGeometry(0.12, 0.12, 0.26, 20).translate(0, 0.17, 0), new THREE.CylinderGeometry(0.128, 0.128, 0.022, 20).translate(0, 0.31, 0)]),
      feet: mergeGeometries([0, 1, 2].map((i) => new THREE.CylinderGeometry(0.012, 0.016, 0.05, 6).translate(Math.cos((i * 2 * Math.PI) / 3) * 0.09, 0.025, Math.sin((i * 2 * Math.PI) / 3) * 0.09))),
      skirt: new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2),
      panel: new THREE.BoxGeometry(0.3, 0.01, 0.2).translate(0.15, 0, 0),
    }),
    []
  );
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);
  const skirt = useRef();
  const panels = useRef();
  useFrame(() => {
    const u = unfold.current;
    if (skirt.current) skirt.current.scale.setScalar(0.14 + 0.66 * smooth(u / 0.7));
    const a = 1.5 - 1.05 * smooth((u - 0.35) / 0.65);
    const im = panels.current;
    if (!im) return;
    [
      [0.12, -a],
      [-0.12, Math.PI + a],
    ].forEach(([x, rz], i) => {
      _q.setFromEuler(_e.set(0, 0, rz));
      im.setMatrixAt(i, _m.compose(_p.set(x, 0.3, 0), _q, _s.set(1, 1, 1)));
    });
    im.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <mesh geometry={geo.body} material={M.gold} castShadow receiveShadow />
      <mesh geometry={geo.feet} material={M.metal} />
      <mesh ref={skirt} geometry={geo.skirt} material={M.mylar} position={[0, 0.012, 0]} receiveShadow />
      <instancedMesh ref={panels} args={[geo.panel, M.cell, 2]} castShadow frustumCulled={false} />
    </>
  );
}

/** The corner-cube face of the laser retroreflector: a 10 × 10 grid of round apertures. */
function cubesTexture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#b8bcc2";
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 10; i++)
    for (let j = 0; j < 10; j++) {
      g.fillStyle = "#151a24";
      g.beginPath();
      g.arc(7 + i * 12.6, 7 + j * 12.6, 5.2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(170,200,255,0.35)";
      g.beginPath();
      g.arc(5.6 + i * 12.6, 5.6 + j * 12.6, 1.6, 0, Math.PI * 2);
      g.fill();
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Apollo 11's Laser Ranging Retroreflector (APOLLO LEGACY): a square panel of 100 corner cubes on
 * its pallet, tilted up towards the Earth on a rear support once it is set down.
 */
function Lrrr({ M, unfold }) {
  const face = useMemo(() => new THREE.MeshStandardMaterial({ map: cubesTexture(), metalness: 0.7, roughness: 0.25 }), []);
  const geo = useMemo(
    () => ({
      pallet: mergeGeometries([new THREE.BoxGeometry(0.5, 0.05, 0.5).translate(0, 0.025, 0), new THREE.BoxGeometry(0.52, 0.012, 0.06).translate(0, 0.056, 0.22)]),
      panel: new THREE.BoxGeometry(0.46, 0.035, 0.46).translate(0, 0.0175, -0.23),
      face: new THREE.PlaneGeometry(0.44, 0.44).rotateX(-Math.PI / 2).translate(0, 0.036, -0.23),
      strut: new THREE.CylinderGeometry(0.01, 0.01, 0.24, 6).translate(0, -0.12, 0),
    }),
    []
  );
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);
  useEffect(() => () => face.dispose(), [face]);
  const hinge = useRef();
  const strut = useRef();
  useFrame(() => {
    const u = smooth(unfold.current);
    // the panel hinges up at its front edge (towards the Earth, about 20° from flat)
    if (hinge.current) hinge.current.rotation.x = -0.36 * u;
    if (strut.current) {
      strut.current.visible = u > 0.05;
      strut.current.rotation.x = 0.4 - 0.4 * u;
    }
  });
  return (
    <>
      <mesh geometry={geo.pallet} material={M.metal} castShadow receiveShadow />
      <group ref={hinge} position={[0, 0.06, 0.23]}>
        <mesh geometry={geo.panel} material={M.metal} castShadow />
        <mesh geometry={geo.face} material={face} />
        <group ref={strut} position={[0, 0, -0.42]}>
          <mesh geometry={geo.strut} material={M.metal} />
        </group>
      </group>
    </>
  );
}

/** The gnomon: a tripod, a weighted rod hanging true vertical from its gimbal, a colour chart. */
function Gnomon({ M, unfold }) {
  const L = 0.5;
  const geo = useMemo(
    () => ({
      leg: new THREE.CylinderGeometry(0.007, 0.007, L, 6).translate(0, -L / 2, 0),
      hub: new THREE.CylinderGeometry(0.022, 0.022, 0.03, 10),
      rod: mergeGeometries([new THREE.CylinderGeometry(0.005, 0.005, 0.36, 6).translate(0, -0.18, 0), new THREE.SphereGeometry(0.018, 8, 6).translate(0, -0.37, 0)]),
      chart: new THREE.PlaneGeometry(0.06, 0.11),
    }),
    []
  );
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);
  const hub = useRef();
  const legs = useRef();
  const rod = useRef();
  const swing = useRef({ a: 0.7, v: 0 });
  useFrame((state, dt) => {
    const u = unfold.current;
    const spread = 0.06 + 0.36 * smooth(u / 0.6);
    const top = L * Math.cos(spread);
    if (hub.current) hub.current.position.y = top;
    const im = legs.current;
    if (im) {
      for (let i = 0; i < 3; i++) {
        _q.setFromEuler(_e.set(0, (-i * 2 * Math.PI) / 3, spread, "YXZ"));
        im.setMatrixAt(i, _m.compose(_p.set(0, top, 0), _q, _s.set(1, 1, 1)));
      }
      im.instanceMatrix.needsUpdate = true;
    }
    // the rod: a damped pendulum once the tripod stands (it settles to the true vertical)
    const s = swing.current;
    if (u < 0.6) {
      s.a = 0.7;
      s.v = 0;
    } else {
      const k = Math.min(dt, 1 / 20);
      s.v += (-(1.62 / 0.36) * Math.sin(s.a) - 1.4 * s.v) * k;
      s.a += s.v * k;
    }
    if (rod.current) {
      rod.current.position.set(0, top - 0.015, 0);
      rod.current.rotation.set(0, 0, u < 0.6 ? 0.7 * (1 - smooth(u / 0.6)) : s.a);
    }
  });
  return (
    <>
      <mesh ref={hub} geometry={geo.hub} material={M.metal} castShadow />
      <instancedMesh ref={legs} args={[geo.leg, M.metal, 3]} castShadow frustumCulled={false} />
      <mesh ref={rod} geometry={geo.rod} material={M.dark} castShadow />
      <mesh geometry={geo.chart} material={M.chart} position={[0.0, 0.22, 0.06]} rotation={[-0.25, 0, 0]} />
    </>
  );
}

/** The low-frequency radio antenna: a receiver box and four elements unrolling across the ground. */
const ELEMENT = 2.4; // m, each of the four elements
function Antenna({ M, unfold, sim }) {
  const geo = useMemo(
    () => ({
      box: mergeGeometries([new THREE.BoxGeometry(0.34, 0.16, 0.26).translate(0, 0.09, 0)]),
      panel: new THREE.BoxGeometry(0.3, 0.008, 0.22).translate(0, 0.175, 0),
      led: new THREE.SphereGeometry(0.012, 8, 6).translate(0.12, 0.18, 0.1),
      element: new THREE.CylinderGeometry(0.011, 0.011, 1, 6).rotateZ(Math.PI / 2).translate(0.5, 0, 0),
      tip: new THREE.SphereGeometry(0.03, 8, 6),
    }),
    []
  );
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);
  const els = useRef();
  const tips = useRef();
  const led = useRef();
  useFrame((state) => {
    const u = unfold.current;
    const len = 0.02 + ELEMENT * smooth((u - 0.1) / 0.9);
    const E = els.current;
    const P = tips.current;
    if (E && P) {
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i * Math.PI) / 2;
        _q.setFromEuler(_e.set(0, -a, 0));
        E.setMatrixAt(i, _m.compose(_p.set(Math.cos(a) * 0.12, 0.05, Math.sin(a) * 0.12), _q, _s.set(len, 1, 1)));
        P.setMatrixAt(i, _m.compose(_p.set(Math.cos(a) * (0.12 + len), 0.04, Math.sin(a) * (0.12 + len)), _q.identity(), _s.set(1, 1, 1)));
      }
      E.instanceMatrix.needsUpdate = true;
      P.instanceMatrix.needsUpdate = true;
      E.visible = u > 0.05;
      P.visible = u > 0.05;
    }
    // the receiver's light: amber while it records its first data block, green once it is stored
    if (led.current) {
      const ready = sim.progress.data || (sim.dataReadyAt != null && sim.clock >= sim.dataReadyAt);
      led.current.visible = u > 0.95;
      M.led.color.set(ready ? "#5be37a" : "#f5c451");
      M.led.opacity = 1;
      if (!ready) led.current.visible = led.current.visible && Math.sin(state.clock.elapsedTime * 5) > -0.2;
    }
  });
  return (
    <>
      <mesh geometry={geo.box} material={M.white} castShadow receiveShadow />
      <mesh geometry={geo.panel} material={M.cell} />
      <mesh ref={led} geometry={geo.led} material={M.led} />
      <instancedMesh ref={els} args={[geo.element, M.metal, 4]} castShadow frustumCulled={false} />
      <instancedMesh ref={tips} args={[geo.tip, M.metal, 4]} frustumCulled={false} />
    </>
  );
}

/**
 * The destination's instrument: hidden until the deployment starts; in the gloves while it is
 * lowered (sim.deploy.pack, world m), set down on its site and unfolding; deployed for good after.
 */
export function Instrument({ sim }) {
  const M = useMaterials();
  const group = useRef();
  const unfold = useRef(0);
  const I = sim.plan.instrument;
  const done = useRef(false);
  useFrame(() => {
    const g = group.current;
    if (!g || !I) return;
    const D = sim.deploy;
    const deployed = !!sim.progress[sim.instrumentObjective];
    if (D) {
      const u = D.t / DEPLOY_TIME;
      const R = DEPLOY_PHASES.release;
      g.visible = true;
      g.rotation.set(0, D.heading, 0);
      if (u < R && D.pack) {
        // from the gloves down onto the site
        const k = smooth((u - 0.18) / (R - 0.18));
        g.position.set(D.pack[0] + (I.x - D.pack[0]) * k, D.pack[1] - 0.16 + (I.y - (D.pack[1] - 0.16)) * k, D.pack[2] + (I.z - D.pack[2]) * k);
        unfold.current = 0;
      } else {
        g.position.set(I.x, I.y, I.z);
        unfold.current = smooth((u - DEPLOY_PHASES.unfold[0]) / (DEPLOY_PHASES.unfold[1] - DEPLOY_PHASES.unfold[0]));
      }
      done.current = false;
    } else if (deployed) {
      g.visible = true;
      if (!done.current) {
        g.position.set(I.x, I.y, I.z);
        g.rotation.set(0, sim.instrumentHeading != null ? sim.instrumentHeading : I.heading, 0);
        unfold.current = 1;
        done.current = true;
      }
    } else g.visible = false;
  });
  if (!I) return null;
  return (
    <group ref={group} visible={false}>
      {I.kind === "seismometer" && <Seismometer M={M} unfold={unfold} />}
      {I.kind === "gnomon" && <Gnomon M={M} unfold={unfold} />}
      {I.kind === "antenna" && <Antenna M={M} unfold={unfold} sim={sim} />}
      {I.kind === "lrrr" && <Lrrr M={M} unfold={unfold} />}
    </group>
  );
}
