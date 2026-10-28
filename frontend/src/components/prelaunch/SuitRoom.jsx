import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import Astronaut from "@/components/eva/Astronaut";
import { solveRig, standSpec } from "@/data/astronautRig";
import { helmetAt, smooth, HELMET } from "@/data/preLaunch";
import PadTech, { techPose } from "./PadTech";

/*
 * COUNTDOWN TO LAUNCH — the suit room (stage "suit"): the three crew in their pressure suits, each
 * on the hoses of a portable ventilator, a suit technician behind each of them, the suit lockers
 * with the crew's name plates, the lounge chairs, the suit-loop console, the wall clock, the door.
 *
 * Before SUIT CHECK each technician holds the clear helmet over his astronaut's head; SUIT CHECK
 * has them lower the helmets onto the neck rings one by one and lock them (the call "Helmets are
 * locked" comes after the last one); then each technician steps aside and checks the ring.
 * COMMUNICATIONS CHECK moves in on the commander; CREW READY and the briefing stand back for the
 * room. Metres; the crew face +z.
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
const CREW_HEADING = [0.12, 0, -0.12];
const NAMES = ["CDR", "CMP", "LMP"];

/* ---- the crew's stances: each its own, all at ease in a pressurised suit ------------------------- */
function crewSpec(i, t) {
  const s = standSpec(t + i * 1.9);
  if (i === 0) {
    // the commander: the left glove up at the hose connectors, the right hand easy at the side
    s.hands[0] = [0.2 + 0.01 * Math.sin(t * 0.5), 1.12, 0.3];
    s.grip[0] = 0.75;
    s.torsoRot[1] += 0.05;
  } else if (i === 2) {
    // the lunar module pilot: hands loosely together in front
    s.hands[0] = [0.12, 1.0, 0.32 + 0.01 * Math.sin(t * 0.4)];
    s.hands[1] = [-0.12, 0.99, 0.32];
    s.grip = [0.55, 0.55];
  }
  return s;
}

/* ---- textures -------------------------------------------------------------------------------- */
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
function noise(g, w, h, n, a, seed = 7) {
  let x = seed;
  const r = () => (x = (x * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(0,0,0,${r() * a})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}
function textures() {
  return {
    // vinyl tiles, a little worn
    floor: canvasTex(
      512,
      512,
      (g, w, h) => {
        for (let y = 0; y < 4; y++)
          for (let x = 0; x < 4; x++) {
            g.fillStyle = (x * 3 + y) % 4 === 0 ? "#b4b2a9" : (x + y) % 2 ? "#c3c1b8" : "#bbb9b0";
            g.fillRect(x * 128, y * 128, 128, 128);
          }
        noise(g, w, h, 5000, 0.06);
        g.strokeStyle = "rgba(60,60,58,0.35)";
        g.lineWidth = 1.5;
        for (let i = 0; i <= 4; i++) {
          g.beginPath();
          g.moveTo(i * 128, 0);
          g.lineTo(i * 128, h);
          g.moveTo(0, i * 128);
          g.lineTo(w, i * 128);
          g.stroke();
        }
      },
      [5, 5]
    ),
    // painted wall panels: seams, a blue band, a grey kick plate, an outlet
    wall: canvasTex(
      512,
      512,
      (g, w, h) => {
        g.fillStyle = "#d3d2cb";
        g.fillRect(0, 0, w, h);
        noise(g, w, h, 2500, 0.035, 11);
        g.fillStyle = "#4f6584";
        g.fillRect(0, h * 0.7, w, h * 0.035);
        g.fillStyle = "#8f9290";
        g.fillRect(0, h * 0.92, w, h * 0.08);
        g.strokeStyle = "rgba(70,72,74,0.45)";
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(1, 0);
        g.lineTo(1, h * 0.92);
        g.moveTo(w / 2, 0);
        g.lineTo(w / 2, h * 0.92);
        g.stroke();
        g.fillStyle = "#e8e7e1";
        g.fillRect(w * 0.3, h * 0.8, 26, 34);
        g.strokeStyle = "#7a7c7c";
        g.strokeRect(w * 0.3, h * 0.8, 26, 34);
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
    clock: canvasTex(512, 160, (g) => {
      g.fillStyle = "#0b0c0d";
      g.fillRect(0, 0, 512, 160);
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
    // the suit lockers: louvres, a handle
    locker: canvasTex(256, 512, (g, w, h) => {
      g.fillStyle = "#9aa3a8";
      g.fillRect(0, 0, w, h);
      noise(g, w, h, 1500, 0.05, 3);
      g.strokeStyle = "#6c7479";
      g.lineWidth = 4;
      g.strokeRect(6, 6, w - 12, h - 12);
      g.fillStyle = "#5f676c";
      for (let i = 0; i < 6; i++) g.fillRect(60, 40 + i * 16, w - 120, 6);
      for (let i = 0; i < 6; i++) g.fillRect(60, h - 140 + i * 16, w - 120, 6);
      g.fillStyle = "#c9cdd0";
      g.fillRect(w - 50, h * 0.48, 14, 60);
    }),
    plates: NAMES.map((n) =>
      canvasTex(256, 96, (g, w) => {
        g.fillStyle = "#1a1d22";
        g.fillRect(0, 0, w, 96);
        g.fillStyle = "#f2f0ea";
        g.font = "bold 46px Helvetica, Arial, sans-serif";
        g.fillText(n, 22, 62);
        g.fillStyle = "#ff3b00";
        g.fillRect(w - 46, 24, 22, 48);
      })
    ),
    // the suit-loop panel on the right wall: gauges and switches
    panel: canvasTex(512, 320, (g, w, h) => {
      g.fillStyle = "#3a4046";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#e8e6e0";
      g.font = "bold 22px Helvetica, Arial, sans-serif";
      g.fillText("SUIT LOOP SUPPLY", 20, 34);
      for (let i = 0; i < 3; i++) {
        const cx = 90 + i * 165;
        g.fillStyle = "#111315";
        g.beginPath();
        g.arc(cx, 130, 52, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = "#d8d8d2";
        g.lineWidth = 3;
        g.stroke();
        g.beginPath();
        g.moveTo(cx, 130);
        g.lineTo(cx + 34 * Math.cos(-0.6 - i * 0.3), 130 + 34 * Math.sin(-0.6 - i * 0.3));
        g.stroke();
        g.fillStyle = "#e8e6e0";
        g.font = "bold 18px Helvetica, Arial, sans-serif";
        g.fillText(NAMES[i], cx - 20, 215);
        g.fillStyle = "#7fe0a0";
        g.fillRect(cx - 8, 240, 16, 16);
        g.fillStyle = "#c9ccc8";
        g.fillRect(cx - 4, 270, 8, 26);
      }
    }),
    // a soft round shadow for the feet
    shadow: canvasTex(128, 128, (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
      grd.addColorStop(0, "rgba(0,0,0,0.55)");
      grd.addColorStop(0.55, "rgba(0,0,0,0.25)");
      grd.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    }),
  };
}

/* ---- the room ---------------------------------------------------------------------------------- */
function roomGeometry() {
  const W = 8;
  const D = 7;
  const H = 3.0;
  const walls = [box(W, H, 0.1, 0, H / 2, -2.6), box(0.1, H, D, -W / 2, H / 2, 0.9), box(0.1, H, D, W / 2, H / 2, 0.9)];
  const floor = new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2).translate(0, 0, 0.9);
  const ceiling = box(W, 0.08, D, 0, H + 0.04, 0.9);
  // recessed light panels with their frames
  const lamps = [];
  const trim = [];
  for (const x of [-2.2, 0, 2.2])
    for (const z of [-1.2, 1.2]) {
      lamps.push(box(1.1, 0.02, 0.46, x, H - 0.012, z));
      trim.push(box(1.2, 0.03, 0.04, x, H - 0.02, z - 0.25), box(1.2, 0.03, 0.04, x, H - 0.02, z + 0.25), box(0.04, 0.03, 0.5, x - 0.6, H - 0.02, z), box(0.04, 0.03, 0.5, x + 0.6, H - 0.02, z));
    }
  // the lounge chairs (reclined, for the suit-up), the suit-loop console
  const furn = [];
  const dark = [];
  for (const x of [-2.4, 2.4]) {
    furn.push(box(0.75, 0.16, 1.7, x, 0.5, -1.2));
    furn.push(box(0.75, 0.12, 0.9, 0, 0, 0).rotateX(-0.9).translate(x, 0.86, -1.95));
    dark.push(box(0.7, 0.06, 1.6, x, 0.4, -1.2));
    for (const [dx, dz] of [[-0.3, -0.5], [0.3, -0.5], [-0.3, -1.9], [0.3, -1.9]]) dark.push(box(0.05, 0.4, 0.05, x + dx, 0.2, dz));
  }
  dark.push(box(2.2, 0.95, 0.6, 0, 0.475, -2.25));
  furn.push(box(2.24, 0.05, 0.64, 0, 0.975, -2.25));
  for (let i = 0; i < 6; i++) furn.push(box(0.05, 0.02, 0.02, -0.75 + i * 0.3, 0.9, -1.94)); // console switches
  // a cable tray along the back wall
  dark.push(box(6.2, 0.06, 0.18, 0, 2.62, -2.46));
  for (let i = 0; i < 9; i++) dark.push(box(0.03, 0.12, 0.2, -3 + i * 0.75, 2.58, -2.46));
  // the door in the right wall: leaf, frame, its small window, handle
  const door = [box(0.06, 2.15, 1.05, 3.94, 1.075, 1.6)];
  dark.push(box(0.08, 2.25, 0.08, 3.93, 1.125, 1.04), box(0.08, 2.25, 0.08, 3.93, 1.125, 2.16), box(0.08, 0.08, 1.2, 3.93, 2.21, 1.6));
  dark.push(box(0.02, 0.35, 0.25, 3.9, 1.6, 1.6));
  dark.push(box(0.04, 0.04, 0.16, 3.88, 1.05, 1.22));
  // the suit lockers along the left wall (one per crew member), their plinth, top and dividers
  const lockers = [];
  for (let i = 0; i < 3; i++) lockers.push(new THREE.PlaneGeometry(0.7, 1.9).rotateY(Math.PI / 2).translate(-3.9, 1.05, -1.3 + i * 0.75));
  dark.push(box(0.5, 0.1, 2.3, -3.72, 0.05, -0.55), box(0.52, 0.05, 2.3, -3.72, 2.02, -0.55));
  for (let i = 0; i < 4; i++) dark.push(box(0.5, 1.95, 0.03, -3.72, 1.05, -1.66 + i * 0.75));
  const plates = [0, 1, 2].map((i) => new THREE.PlaneGeometry(0.34, 0.13).rotateY(Math.PI / 2).translate(-3.89, 1.72, -1.3 + i * 0.75));
  // a bench in front of the lockers
  furn.push(box(0.4, 0.06, 1.8, -3.25, 0.45, -0.55));
  dark.push(box(0.05, 0.44, 0.05, -3.25, 0.22, -1.3), box(0.05, 0.44, 0.05, -3.25, 0.22, 0.2));
  return {
    room: merge([...walls, ceiling]),
    floor,
    lamps: merge(lamps),
    trim: merge(trim),
    furn: merge(furn),
    dark: merge(dark),
    door: merge(door),
    lockers: merge(lockers),
    plates,
    sign: new THREE.PlaneGeometry(2.4, 0.6).translate(0, 2.25, -2.54),
    clock: new THREE.PlaneGeometry(1.1, 0.34).translate(-2.4, 2.3, -2.54),
    monitor: new THREE.PlaneGeometry(0.9, 0.56).translate(0, 1.45, -2.54),
    panel: new THREE.PlaneGeometry(0.9, 0.56).rotateY(-Math.PI / 2).translate(3.94, 1.5, -0.6),
    shadow: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  };
}

/* ---- the ventilators and their hoses, to each suit's chest connectors --------------------------- */
const CONNECTORS = [
  [0.09, 0.14, 0.17], // blue (inlet), the astronaut's left
  [-0.09, 0.14, 0.17], // red (outlet), the astronaut's right
];
function hoseGeometry() {
  const tubes = [];
  const cases = [];
  const handles = [];
  for (let i = 0; i < 3; i++) {
    const rig = solveRig(crewSpec(i, 0));
    const T = rig.torso;
    const head = CREW_HEADING[i];
    const c = Math.cos(head);
    const s = Math.sin(head);
    const toWorld = (p) => [CREW_X[i] + p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
    // the ventilator case on the floor, in front of and beside the left boot
    const caseLocal = [0.34, 0.15, 0.42];
    const cw = toWorld(caseLocal);
    cases.push(box(0.34, 0.26, 0.2, 0, 0, 0).rotateY(head).translate(cw[0], 0.13, cw[2]));
    handles.push(box(0.2, 0.03, 0.03, 0, 0, 0).rotateY(head).translate(cw[0], 0.3, cw[2]));
    CONNECTORS.forEach((k, j) => {
      const local = new THREE.Vector3(...k).applyQuaternion(T.q).add(T.p);
      const a = toWorld([local.x, local.y, local.z + 0.03]);
      const out = toWorld([local.x * 1.2, local.y - 0.12, local.z + 0.2]);
      const mid = toWorld([0.3 + j * 0.03, 0.55, 0.5]);
      const end = toWorld([caseLocal[0] + (j ? -0.06 : 0.06), 0.27, caseLocal[2]]);
      const curve = new THREE.CatmullRomCurve3([a, out, mid, end].map((p) => new THREE.Vector3(...p)));
      tubes.push(new THREE.TubeGeometry(curve, 40, 0.017, 8, false));
    });
  }
  return { tubes: merge(tubes), cases: merge(cases), handles: merge(handles) };
}

/** The camera for the moment: the room, the helmets going on, the commander for the comm check. */
function cameraFor(c) {
  const wide = { pos: [0.3, 1.62, 4.1], look: [0, 1.3, -0.3] };
  if (c.briefing) {
    // the crew in the left of the frame, the briefing card on the right
    const k = smooth(c.briefingT / 12);
    return { pos: lerp3([1.6, 1.62, 4.4], [1.3, 1.6, 3.8], k), look: [0.85, 1.3, -0.2] };
  }
  if (c.step === "suitCheck") {
    const k = smooth(c.stepT / 6);
    const x = -0.95 + 1.9 * smooth((c.stepT - HELMET.from) / (2 * HELMET.every + HELMET.dur));
    return { pos: lerp3([0.2, 1.8, 2.9], [x * 0.6 + 0.2, 1.78, 2.4], k), look: [x, 1.6, 0] };
  }
  if (c.step === "commCheck") return { pos: [-0.5, 1.7, 1.6], look: [-0.95, 1.62, 0] };
  if (c.step === "crewReady") return { pos: [0.6, 1.5, 3.1], look: [0, 1.35, 0] };
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
  const G = useMemo(() => ({ ...roomGeometry(), ...hoseGeometry() }), []);
  const T = useMemo(() => textures(), []);
  const M = useMemo(() => {
    const std = (o) => new THREE.MeshStandardMaterial(o);
    return {
      room: std({ map: T.wall, roughness: 0.82, envMapIntensity: 0.35 }),
      floor: std({ map: T.floor, roughness: 0.42, metalness: 0.02, envMapIntensity: 0.6 }),
      lamps: std({ color: "#fffaf0", emissive: "#fff4e2", emissiveIntensity: 1.2 }),
      trim: std({ color: "#cfd1cf", roughness: 0.5, metalness: 0.4 }),
      furn: std({ color: "#7f8a8c", roughness: 0.7, envMapIntensity: 0.4 }),
      dark: std({ color: "#3a3f44", roughness: 0.5, metalness: 0.4, envMapIntensity: 0.5 }),
      door: std({ color: "#b9bec0", roughness: 0.55, metalness: 0.3 }),
      lockers: std({ map: T.locker, roughness: 0.45, metalness: 0.55, envMapIntensity: 0.7 }),
      plates: T.plates.map((map) => new THREE.MeshBasicMaterial({ map })),
      sign: new THREE.MeshBasicMaterial({ map: T.sign }),
      clock: new THREE.MeshBasicMaterial({ map: T.clock, toneMapped: false }),
      monitor: new THREE.MeshBasicMaterial({ map: T.monitor, toneMapped: false }),
      panel: std({ map: T.panel, roughness: 0.5, metalness: 0.3, emissive: "#ffffff", emissiveMap: T.panel, emissiveIntensity: 0.12 }),
      hose: std({ color: "#c9cbc7", roughness: 0.45, metalness: 0.35, envMapIntensity: 0.9 }),
      cases: std({ color: "#5b6168", roughness: 0.4, metalness: 0.6, envMapIntensity: 0.8 }),
      handles: std({ color: "#c7cacc", roughness: 0.3, metalness: 0.9 }),
      shadow: new THREE.MeshBasicMaterial({ map: T.shadow, transparent: true, depthWrite: false, toneMapped: false }),
    };
  }, [T]);
  const crew = [useRef(null), useRef(null), useRef(null)];
  // the technicians, one behind each astronaut (PadTech stateRefs, stable for the scene's life)
  const techRefs = useMemo(() => [0, 1, 2].map((i) => ({ current: { visible: true, pos: [CREW_X[i], 0.935, -0.42], yaw: 0, pose: techPose("hold") } })), []);
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
      for (const g of Object.values(G)) (Array.isArray(g) ? g : [g]).forEach((x) => x.dispose());
      for (const t of Object.values(T)) (Array.isArray(t) ? t : [t]).forEach((x) => x.dispose());
      for (const m of Object.values(M)) (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
    },
    [env, G, T, M]
  );

  useFrame((state, dt0) => {
    const c = ctl.current;
    const dt = Math.min(0.1, dt0);
    const t = state.clock.elapsedTime;
    // the helmets: held over the heads until SUIT CHECK, then lowered one by one and locked
    const suitT = c.done.includes("suitCheck") ? 99 : c.step === "suitCheck" ? c.stepT : null;
    crew.forEach((r, i) => {
      r.current = { pos: [CREW_X[i], 0, 0], heading: CREW_HEADING[i], rig: solveRig(crewSpec(i, t)), helmetUp: 1 - helmetAt(i, suitT) };
    });
    techRefs.forEach(({ current: s }, i) => {
      const on = helmetAt(i, suitT);
      // after the lock: a beat at the ring, then a step back and aside
      const after = suitT == null ? 0 : smooth((suitT - (HELMET.from + i * HELMET.every + HELMET.dur + 0.1)) / 1.4);
      const side = i === 2 ? -1 : 1;
      s.pose = after > 0 ? techPose("check", "stand", after) : on > 0 ? techPose("hold", "lower", on) : techPose("hold");
      if (after <= 0 && on <= 0) s.pose.arms.forEach((a) => (a[0] += 0.02 * Math.sin(t * 1.3 + i)));
      s.pos = [CREW_X[i] + side * 0.42 * after, 0.935, -0.42 - 0.3 * after];
      s.yaw = -side * 0.45 * after;
    });
    // the camera: eased towards the moment's framing (validation tooling may hold it)
    const hold = typeof window !== "undefined" ? window.__lvPrelaunchCam : null;
    const want = hold || cameraFor(c);
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
      <ambientLight intensity={0.14} />
      <hemisphereLight args={["#f8f4ea", "#6d6a62", 0.42]} />
      {/* the key from the ceiling panels over the crew, a cooler fill from the door side */}
      <directionalLight position={[0.8, 2.9, 2.2]} intensity={1.15} color="#fff3e4" />
      <directionalLight position={[3.5, 1.6, 1.5]} intensity={0.35} color="#dfe9f5" />
      <pointLight position={[0, 2.8, 1.2]} intensity={5} distance={8} decay={2} color="#fff1dd" />
      <pointLight position={[-2.2, 2.8, -1.2]} intensity={2.4} distance={6} decay={2} color="#fff1dd" />
      <pointLight position={[2.2, 2.8, -1.2]} intensity={2.4} distance={6} decay={2} color="#fff1dd" />
      <mesh geometry={G.room} material={M.room} />
      <mesh geometry={G.floor} material={M.floor} />
      <mesh geometry={G.lamps} material={M.lamps} />
      <mesh geometry={G.trim} material={M.trim} />
      <mesh geometry={G.furn} material={M.furn} />
      <mesh geometry={G.dark} material={M.dark} />
      <mesh geometry={G.door} material={M.door} />
      <mesh geometry={G.lockers} material={M.lockers} />
      {G.plates.map((g, i) => (
        <mesh key={`p${i}`} geometry={g} material={M.plates[i]} />
      ))}
      <mesh geometry={G.sign} material={M.sign} />
      <mesh geometry={G.clock} material={M.clock} />
      <mesh geometry={G.monitor} material={M.monitor} />
      <mesh geometry={G.panel} material={M.panel} />
      <mesh geometry={G.tubes} material={M.hose} />
      <mesh geometry={G.cases} material={M.cases} />
      <mesh geometry={G.handles} material={M.handles} />
      {/* soft contact shadows under the crew and the technicians */}
      {CREW_X.map((x, i) => (
        <mesh key={`s${i}`} geometry={G.shadow} material={M.shadow} position={[x, 0.004, 0.02]} scale={[0.85, 1, 0.7]} />
      ))}
      {techRefs.map((r, i) => (
        <TechShadow key={`ts${i}`} stateRef={r} geometry={G.shadow} material={M.shadow} />
      ))}
      {crew.map((r, i) => (
        <Astronaut key={`c${i}`} stateRef={r} variant="launch" env={env.texture} />
      ))}
      {techRefs.map((r, i) => (
        <PadTech key={`t${i}`} stateRef={r} variant={i} />
      ))}
    </>
  );
}

function TechShadow({ stateRef, geometry, material }) {
  const ref = useRef();
  useFrame(() => {
    const s = stateRef.current;
    if (ref.current && s) ref.current.position.set(s.pos[0], 0.003, s.pos[2] + 0.03);
  });
  return <mesh ref={ref} geometry={geometry} material={material} scale={[0.6, 1, 0.5]} />;
}
