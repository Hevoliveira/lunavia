import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import Astronaut from "@/components/eva/Astronaut";
import RecoveryFigure, { posed } from "@/components/scenes/recovery/RecoveryFigure";
import { solveRig, standSpec } from "@/data/astronautRig";
import { helmetAt, smooth } from "@/data/preLaunch";

/*
 * COUNTDOWN TO LAUNCH — the suit room (stage "suit"): the three crew in their pressure suits, the
 * suit technicians, the lounge chairs, the portable ventilators, the wall clock and the monitors.
 * SUIT CHECK lowers the helmets onto the crew one by one; COMMUNICATIONS CHECK moves in on the
 * commander; CREW READY and the briefing stand back for the room. Metres; the crew face +z.
 *
 * ctl.current: { step (id of the step playing | null), stepT (s), done: [], briefing, briefingT } —
 * the experience (PreLaunch) keeps the times; this scene only shows them.
 */
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const clean = (g) => {
  const o = g.index ? g.toNonIndexed() : g;
  if (!o.attributes.uv) o.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(o.attributes.position.count * 2), 2));
  for (const k of Object.keys(o.attributes)) if (!["position", "normal", "uv"].includes(k)) o.deleteAttribute(k);
  return o;
};
const merge = (list) => mergeGeometries(list.map(clean), false);
const lerp3 = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
const CREW_X = [-0.95, 0, 0.95];

function canvasTex(w, h, draw, repeat = null) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
}
function textures() {
  return {
    floor: canvasTex(
      256,
      256,
      (g, w, h) => {
        g.fillStyle = "#bdbab0";
        g.fillRect(0, 0, w, h);
        for (let y = 0; y < 4; y++)
          for (let x = 0; x < 4; x++) {
            g.fillStyle = (x + y) % 2 ? "#c7c4ba" : "#b3b0a6";
            g.fillRect(x * 64 + 1, y * 64 + 1, 62, 62);
          }
      },
      [6, 6]
    ),
    wall: canvasTex(
      256,
      256,
      (g, w, h) => {
        g.fillStyle = "#dcdcd6";
        g.fillRect(0, 0, w, h);
        g.fillStyle = "#5d6f86";
        g.fillRect(0, h * 0.74, w, h * 0.04);
        g.strokeStyle = "rgba(90,92,95,0.35)";
        g.lineWidth = 2;
        g.strokeRect(1, 1, w - 2, h - 2);
      },
      [4, 1]
    ),
    sign: canvasTex(1024, 256, (g, w, h) => {
      g.fillStyle = "#13161b";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#ff3b00";
      g.fillRect(40, 60, 12, 136);
      g.fillStyle = "#f2f0ea";
      g.font = "bold 74px Helvetica, Arial, sans-serif";
      g.fillText("LUNAVIA", 80, 128);
      g.font = "bold 30px Helvetica, Arial, sans-serif";
      g.fillStyle = "#9aa3ad";
      g.fillText("LV-001 · CREW QUARTERS · SUIT ROOM", 82, 186);
    }),
    clock: canvasTex(512, 160, (g, w, h) => {
      g.fillStyle = "#0b0c0d";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#ff5a1f";
      g.font = 'bold 84px "Courier New", monospace';
      g.fillText("T-02:41:07", 18, 104);
      g.fillStyle = "#8c939b";
      g.font = "bold 22px Helvetica, Arial, sans-serif";
      g.fillText("COUNTDOWN · HOLD RELEASED", 22, 146);
    }),
    monitor: canvasTex(512, 320, (g, w, h) => {
      g.fillStyle = "#0e1418";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#7fe0a0";
      g.font = 'bold 22px "Courier New", monospace';
      ["SUIT LOOP A   3.8 PSI   GO", "SUIT LOOP B   3.8 PSI   GO", "SUIT LOOP C   3.7 PSI   GO", "O2 PURGE      COMPLETE", "BIOMED        NOMINAL", "COMM CDR/CMP/LMP  LOOP 1"].forEach((l, i) => g.fillText(l, 22, 48 + i * 42));
    }),
  };
}
function roomGeometry() {
  const W = 8;
  const D = 7;
  const H = 3.0;
  const walls = [box(W, H, 0.1, 0, H / 2, -2.6), box(0.1, H, D, -W / 2, H / 2, 0.9), box(0.1, H, D, W / 2, H / 2, 0.9)];
  const floor = new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2).translate(0, 0, 0.9);
  const ceiling = box(W, 0.08, D, 0, H + 0.04, 0.9);
  const lamps = [];
  for (const x of [-2.2, 0, 2.2]) for (const z of [-1.2, 1.2]) lamps.push(box(1.2, 0.02, 0.5, x, H - 0.01, z));
  // the lounge chairs (reclined, for the suit-up), the suit-loop console, the ventilator cases
  const furn = [];
  const dark = [];
  for (const x of [-2.4, 2.4]) {
    furn.push(box(0.75, 0.32, 1.7, x, 0.42, -1.2));
    furn.push(box(0.75, 0.12, 0.9, 0, 0, 0).rotateX(-0.9).translate(x, 0.82, -1.95));
    dark.push(box(0.06, 0.42, 0.06, x - 0.3, 0.21, -0.6), box(0.06, 0.42, 0.06, x + 0.3, 0.21, -0.6), box(0.06, 0.42, 0.06, x - 0.3, 0.21, -1.9), box(0.06, 0.42, 0.06, x + 0.3, 0.21, -1.9));
  }
  dark.push(box(2.2, 0.95, 0.6, 0, 0.475, -2.25));
  furn.push(box(2.2, 0.05, 0.62, 0, 0.97, -2.25));
  // the portable ventilators, on the floor by each lounge chair and the console
  for (const [x, z] of [[-1.85, -0.9], [-1.55, -1.05], [1.75, -0.95]]) dark.push(box(0.36, 0.26, 0.2, x, 0.13, z));
  return {
    room: merge([...walls, ceiling]),
    floor,
    lamps: merge(lamps),
    furn: merge(furn),
    dark: merge(dark),
    sign: new THREE.PlaneGeometry(2.4, 0.6).translate(0, 2.35, -2.54),
    clock: new THREE.PlaneGeometry(1.1, 0.34).translate(-2.4, 2.4, -2.54),
    monitor: new THREE.PlaneGeometry(0.9, 0.56).translate(0, 1.42, -2.54),
  };
}

/** The camera for the moment: the room, the helmets going on, the commander for the comm check. */
function cameraFor(c) {
  const wide = { pos: [0.3, 1.62, 4.1], look: [0, 1.25, -0.3] };
  if (c.briefing) {
    // the crew in the left of the frame, the briefing card on the right
    const k = smooth(c.briefingT / 12);
    return { pos: lerp3([1.6, 1.62, 4.4], [1.3, 1.6, 3.8], k), look: [0.85, 1.25, -0.2] };
  }
  if (c.step === "suitCheck") {
    const k = smooth(c.stepT / 6);
    const x = -0.95 + 1.9 * smooth((c.stepT - 0.6) / 4.2);
    return { pos: lerp3([0.2, 1.75, 2.8], [x * 0.6 + 0.2, 1.72, 2.3], k), look: [x, 1.55, 0] };
  }
  if (c.step === "commCheck") return { pos: [-0.55, 1.68, 1.55], look: [-0.95, 1.6, 0] };
  if (c.step === "crewReady") return { pos: [0.6, 1.5, 3.0], look: [0, 1.4, 0] };
  return wide;
}

export default function SuitRoom({ ctl }) {
  const { gl, camera, scene } = useThree();
  const env = useMemo(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const rt = pm.fromScene(new RoomEnvironment(), 0.04);
    pm.dispose();
    return rt;
  }, [gl]);
  const G = useMemo(() => roomGeometry(), []);
  const T = useMemo(() => textures(), []);
  const M = useMemo(() => {
    const std = (o) => new THREE.MeshStandardMaterial(o);
    return {
      room: std({ map: T.wall, roughness: 0.85 }),
      floor: std({ map: T.floor, roughness: 0.6, metalness: 0.05 }),
      lamps: std({ color: "#fffaf0", emissive: "#fff6e6", emissiveIntensity: 1.3 }),
      furn: std({ color: "#8b8f8a", roughness: 0.75 }),
      dark: std({ color: "#3c4044", roughness: 0.55, metalness: 0.35 }),
      sign: new THREE.MeshBasicMaterial({ map: T.sign }),
      clock: new THREE.MeshBasicMaterial({ map: T.clock, toneMapped: false }),
      monitor: new THREE.MeshBasicMaterial({ map: T.monitor, toneMapped: false }),
    };
  }, [T]);
  const crew = [useRef(null), useRef(null), useRef(null)];
  // the technicians behind the crew (RecoveryFigure stateRefs, stable for the scene's life)
  const techRefs = useMemo(() => [0, 1, 2].map((i) => ({ current: { visible: true, pos: [CREW_X[i] - 0.1, 0.96, -0.65], yaw: 0.2, pitch: 0, roll: 0, pose: posed("stand"), scale: 1 } })), []);
  const cam = useRef(null);

  useEffect(() => {
    scene.environment = env.texture;
    camera.near = 0.05;
    camera.far = 60;
    camera.fov = 50;
    camera.updateProjectionMatrix();
    return () => {
      scene.environment = null;
    };
  }, [scene, env, camera]);
  useEffect(
    () => () => {
      env.dispose();
      Object.values(G).forEach((g) => g.dispose());
      Object.values(T).forEach((t) => t.dispose());
      Object.values(M).forEach((m) => m.dispose());
    },
    [env, G, T, M]
  );

  useFrame((state, dt0) => {
    const c = ctl.current;
    const dt = Math.min(0.1, dt0);
    const t = state.clock.elapsedTime;
    // the helmets: up (held by the technicians) until SUIT CHECK, then lowered one by one and locked
    const suitT = c.done.includes("suitCheck") ? 99 : c.step === "suitCheck" ? c.stepT : null;
    crew.forEach((r, i) => {
      r.current = { pos: [CREW_X[i], 0, 0], heading: i === 1 ? 0 : i === 0 ? 0.12 : -0.12, rig: solveRig(standSpec(t + i * 1.9)), helmetUp: 1 - helmetAt(i, suitT) };
    });
    techRefs.forEach(({ current: s }, i) => {
      // raising the helmet over the head, then stepping back
      const on = helmetAt(i, suitT);
      s.pose = posed("work", "stand", on);
      // beside and a little behind each crew member (seen past the shoulder), stepping back once done
      s.pos = [CREW_X[i] + 0.42 + 0.1 * on, 0.96, -0.35 - 0.35 * on];
      s.yaw = -0.5;
    });
    // the camera: eased towards the moment's framing
    const want = cameraFor(c);
    if (!cam.current) cam.current = { pos: [...want.pos], look: [...want.look] };
    const k = 1 - Math.exp(-dt * 1.8);
    cam.current.pos = lerp3(cam.current.pos, want.pos, k);
    cam.current.look = lerp3(cam.current.look, want.look, k);
    camera.position.set(...cam.current.pos);
    camera.lookAt(...cam.current.look);
    if (typeof window !== "undefined") {
      const w = window.__lvPrelaunch || (window.__lvPrelaunch = {});
      w.suit = { step: c.step, stepT: c.stepT, done: [...c.done], briefing: c.briefing, helmets: [0, 1, 2].map((i) => +(1 - helmetAt(i, suitT)).toFixed(2)), calls: gl.info.render.calls, tris: gl.info.render.triangles };
    }
  });

  return (
    <>
      <ambientLight intensity={0.25} />
      <hemisphereLight args={["#fbf7ee", "#7a776e", 0.55]} />
      <directionalLight position={[1.5, 2.9, 2.5]} intensity={1.4} color="#fff6ea" />
      <pointLight position={[0, 2.8, 1.2]} intensity={6} distance={9} decay={2} color="#fff3e2" />
      <pointLight position={[-2.2, 2.8, -1.2]} intensity={3} distance={7} decay={2} color="#fff3e2" />
      <pointLight position={[2.2, 2.8, -1.2]} intensity={3} distance={7} decay={2} color="#fff3e2" />
      <mesh geometry={G.room} material={M.room} />
      <mesh geometry={G.floor} material={M.floor} />
      <mesh geometry={G.lamps} material={M.lamps} />
      <mesh geometry={G.furn} material={M.furn} />
      <mesh geometry={G.dark} material={M.dark} />
      <mesh geometry={G.sign} material={M.sign} />
      <mesh geometry={G.clock} material={M.clock} />
      <mesh geometry={G.monitor} material={M.monitor} />
      {crew.map((r, i) => (
        <Astronaut key={`c${i}`} stateRef={r} variant="launch" env={env.texture} />
      ))}
      {techRefs.map((r, i) => (
        <RecoveryFigure key={`t${i}`} kind="tech" stateRef={r} />
      ))}
    </>
  );
}
