import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Stars, useTexture } from "@react-three/drei";
import * as THREE from "three";
import CsmModel, { RcsPuffs } from "@/components/spacecraft/CsmModel";
import LanderModel from "@/components/LanderModel";
import AdaptiveResolution from "@/components/scenes/AdaptiveResolution";
import { RCS_THRUSTERS as LM_RCS } from "@/data/lmDesign";
import {
  ASC_CENTRE_U,
  DOCKED_POS,
  DOCKED_Q,
  DOCKING,
  DOCK_Y,
  LM_UNIT,
  MEAN_MOTION,
  PROBE_TIP,
  PULSE,
  checkpointState,
  dockingStatus,
  frames,
  portState,
  qMul,
  qNorm,
  qRot,
  referencePilot,
  stepDocking,
  telemetry,
} from "@/data/dockingSim";
import { COAST, FINAL, PLAY_S, TRANSFER, planRendezvous, playToMission, rangeOf } from "@/data/rendezvous";

/**
 * LUNAR ORBITAL RENDEZVOUS → LUNAVIA — DOCKING OPERATIONS → HARD DOCK →
 * CREW TRANSFER → ASCENT STAGE JETTISON.
 *
 * One scene in the CSM's frame (metres; data/dockingSim): the same CSM that
 * stayed in lunar orbit holds its attitude, probe pointing back along the
 * orbit; the Moon turns slowly below. The ascent stage arrives from orbit
 * insertion on the automatic rendezvous (data/rendezvous: the guidance's own
 * trajectory, played as a film whose clock slows as the range closes), and
 * is handed to the player at the final-approach checkpoint, station-keeping
 * on the docking axis. From there everything is the docking simulation:
 * every frame the player's RCS commands step the one authoritative state,
 * the 3D vehicles, the HUD and the alignment display are drawn from it, and
 * only its contact judgement can dock. A failed attempt restarts from the
 * same checkpoint; the landing and the launch are never replayed.
 *
 * Controls (iPhone landscape): a cross pad and a FWD/AFT pair, in TRANSLATION
 * or ATTITUDE mode (the pad becomes pitch/yaw, the pair roll). A tap is one
 * minimum-impulse firing; holding keeps the jets on; buttons combine
 * (multi-touch). Keyboard (desktop): W/S up/down, A/D left/right, R/F
 * forward/aft, arrows pitch/yaw, Q/E roll.
 */

const MOON_MAP = process.env.PUBLIC_URL + "/textures/planets/moon_1024.jpg";
const MOON_SCALE = 1 / 1000; // the Moon drawn at 1/1000 around the camera: same angular size, no far-plane trouble
const MOON_R = 1737.4;
const MOON_D = 1737.4 + 110;
const SUN_DIR = new THREE.Vector3(0.55, -0.35, 0.76).normalize();
const LM_CENTRE_M = ASC_CENTRE_U.map((v) => v * LM_UNIT); // the ascent stage's centre in the LM model, metres

/* ---- helpers ------------------------------------------------------------------------- */
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
/** A quaternion turning the ascent stage's +Y (its docking tunnel) towards `dir`, its +Z towards the radial (+Z). */
function pointingQ(dir) {
  const y = _v.set(dir[0], dir[1], dir[2]).normalize();
  const zRef = Math.abs(y.z) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const x = new THREE.Vector3().crossVectors(y, zRef).normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  _m.makeBasis(x, y, z);
  _q.setFromRotationMatrix(_m);
  return [_q.x, _q.y, _q.z, _q.w];
}
function slerpQ(a, b, u) {
  const qa = new THREE.Quaternion(...a);
  const qb = new THREE.Quaternion(...b);
  qa.slerp(qb, u);
  return [qa.x, qa.y, qa.z, qa.w];
}
const smooth = (x) => {
  const u = Math.max(0, Math.min(1, x));
  return u * u * (3 - 2 * u);
};

/** Which LM RCS jets fire for a body command (translation t, rotation r), as puff levels. */
function rcsLevels(t, r) {
  return LM_RCS.map((th) => {
    const push = [-th.dir[0], -th.dir[1], -th.dir[2]]; // the jet pushes the vehicle against its exhaust
    let k = 0;
    const tl = Math.hypot(t[0], t[1], t[2]);
    if (tl > 0.01) k = Math.max(k, (push[0] * t[0] + push[1] * t[1] + push[2] * t[2]) / tl > 0.7 ? Math.min(1, tl) : 0);
    const rl = Math.hypot(r[0], r[1], r[2]);
    if (rl > 0.01) {
      // torque about the ascent stage's centre (model units)
      const p = [th.pos[0] - ASC_CENTRE_U[0], th.pos[1] - ASC_CENTRE_U[1], th.pos[2] - ASC_CENTRE_U[2]];
      const tq = [p[1] * push[2] - p[2] * push[1], p[2] * push[0] - p[0] * push[2], p[0] * push[1] - p[1] * push[0]];
      const tn = Math.hypot(...tq) || 1;
      if ((tq[0] * r[0] + tq[1] * r[1] + tq[2] * r[2]) / (tn * rl) > 0.6) k = Math.max(k, Math.min(1, rl));
    }
    return k;
  });
}

/* ---- the Moon below (camera-relative, turning with the orbit) -------------------------------- */
// Fine relief (procedural, made once): craterlets and grain the 1k map cannot carry from 110 km.
let RELIEF = null;
function reliefTexture() {
  if (RELIEF) return RELIEF;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#808080";
  g.fillRect(0, 0, 256, 256);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 1400; i++) {
    const v = Math.floor(90 + rnd() * 80);
    g.fillStyle = `rgba(${v},${v},${v},0.5)`;
    g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  for (let i = 0; i < 90; i++) {
    const x = rnd() * 256;
    const y = rnd() * 256;
    const r = 2 + rnd() * 9;
    const gr = g.createRadialGradient(x, y, r * 0.2, x, y, r);
    gr.addColorStop(0, "rgba(40,40,40,0.55)");
    gr.addColorStop(0.75, "rgba(110,110,110,0.2)");
    gr.addColorStop(0.9, "rgba(200,200,200,0.45)");
    gr.addColorStop(1, "rgba(128,128,128,0)");
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(260, 130);
  t.anisotropy = 4;
  RELIEF = t;
  return t;
}

function MoonBelow({ clockRef }) {
  const map = useTexture(MOON_MAP);
  const relief = useMemo(() => reliefTexture(), []);
  const ref = useRef();
  const spin = useRef();
  const { camera } = useThree();
  useMemo(() => {
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
  }, [map]);
  useFrame(() => {
    if (!ref.current) return;
    ref.current.position.set(camera.position.x, camera.position.y, camera.position.z - MOON_D * MOON_SCALE * 1000);
    // the surface turns under the orbit (about the orbit normal, the CSM frame's X)
    spin.current.rotation.x = -MEAN_MOTION * (clockRef.current || 0) + 0.6;
  });
  return (
    <group ref={ref}>
      <group ref={spin}>
        <mesh scale={MOON_R * MOON_SCALE * 1000}>
          <sphereGeometry args={[1, 96, 64]} />
          <meshStandardMaterial map={map} bumpMap={relief} bumpScale={1.2} roughness={1} metalness={0} color="#b9b6b0" />
        </mesh>
      </group>
    </group>
  );
}

/* ---- the vehicles --------------------------------------------------------------------------- */
function Vehicles({ simRef, viewRef }) {
  const lm = useRef();
  const lmLevels = useRef(LM_RCS.map(() => 0));
  useFrame(() => {
    const s = simRef.current;
    if (!s || !lm.current) return;
    lm.current.position.set(s.pos[0], s.pos[1], s.pos[2]);
    lm.current.quaternion.set(s.q[0], s.q[1], s.q[2], s.q[3]);
    lm.current.visible = !(viewRef.current === "COAS" && s.status !== "docked" && s.mode === "docking");
    const f = s.fired || { t: [0, 0, 0], r: [0, 0, 0] };
    const lv = rcsLevels(f.t, f.r);
    lmLevels.current = lv;
  });
  return (
    <>
      <group name="CSM-lunar-orbit">
        <CsmModel castShadow receiveShadow />
      </group>
      <group ref={lm} name="LM-ascent-stage">
        <group position={[-LM_CENTRE_M[0], -LM_CENTRE_M[1], -LM_CENTRE_M[2]]} scale={LM_UNIT}>
          <LanderModel parts="ascent" />
          <RcsPuffs thrusters={LM_RCS} levelsRef={lmLevels} length={0.32} />
        </group>
      </group>
    </>
  );
}

/** The docking corridor drawn in space in the external view: the probe's axis and the ascent stage's port axis. */
function Corridor({ simRef, viewRef }) {
  const probeAxis = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...PROBE_TIP), new THREE.Vector3(PROBE_TIP[0], PROBE_TIP[1] + 60, PROBE_TIP[2])]);
    return g;
  }, []);
  const lmAxisGeo = useMemo(() => new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]), []);
  const lmAxis = useRef();
  const grp = useRef();
  useFrame(() => {
    const s = simRef.current;
    if (!grp.current || !s) return;
    grp.current.visible = viewRef.current === "CHASE" && s.mode === "docking" && s.status === "approach";
    const { port, axis } = portState(s);
    const pos = lmAxisGeo.attributes.position;
    pos.setXYZ(0, port[0], port[1], port[2]);
    pos.setXYZ(1, port[0] + axis[0] * 12, port[1] + axis[1] * 12, port[2] + axis[2] * 12);
    pos.needsUpdate = true;
    lmAxisGeo.computeBoundingSphere();
  });
  return (
    <group ref={grp} visible={false}>
      <line geometry={probeAxis}>
        <lineDashedMaterial color="#4fd1c5" transparent opacity={0.55} dashSize={0.6} gapSize={0.4} />
      </line>
      <line ref={lmAxis} geometry={lmAxisGeo}>
        <lineBasicMaterial color="#FF3B00" transparent opacity={0.7} />
      </line>
    </group>
  );
}

/* ---- camera and the screen-space markers ------------------------------------------------------ */
const FAR_AXIS = [0, DOCK_Y - 7, 0]; // a point on the probe's axis inside the CSM (the far mark of the alignment display)
function Director({ simRef, viewRef, phaseRef, markRef, sizeRef, clockRef }) {
  const { camera, size } = useThree();
  const pos = useRef(new THREE.Vector3(0, 60, 20));
  const look = useRef(new THREE.Vector3());
  const up = useRef(new THREE.Vector3(0, 0, 1));
  const first = useRef(true);
  const proj = (p) => {
    _w.set(p[0], p[1], p[2]).project(camera);
    return { x: (_w.x * 0.5 + 0.5) * size.width, y: (-_w.y * 0.5 + 0.5) * size.height, front: _w.z < 1 };
  };
  useFrame((state, delta) => {
    const s = simRef.current;
    if (!s) return;
    const ph = phaseRef.current;
    const now = state.clock.elapsedTime;
    const C = [s.pos[0], s.pos[1], s.pos[2]];
    const R = (v) => qRot(s.q, v);
    let P;
    let L;
    let U = [0, 0, 1];
    let snap = false;
    if (ph === "docked" || ph === "transfer" || ph === "jettison") {
      // the joined vehicles above the Moon: a slow orbit of the stack
      const a = 0.9 + now * 0.06;
      const mid = [0, DOCK_Y - 1.5, 0];
      P = [mid[0] + Math.cos(a) * 26, mid[1] + 4, mid[2] + 9 + Math.sin(a) * 6];
      L = ph === "jettison" ? [C[0] * 0.5, (C[1] + mid[1]) * 0.5, C[2] * 0.5] : mid;
    } else if (viewRef.current === "COAS" && (ph === "docking" || ph === "handover" || ph === "captured")) {
      // the crew's docking window: looking up the tunnel's axis, +Z up
      const { port, axis } = portState(s);
      const zb = R([0, 0, 1]);
      P = [port[0] - axis[0] * 0.25, port[1] - axis[1] * 0.25, port[2] - axis[2] * 0.25];
      L = [port[0] + axis[0] * 10, port[1] + axis[1] * 10, port[2] + axis[2] * 10];
      U = zb;
      snap = true;
    } else {
      // behind and above the ascent stage, looking along its docking axis at the CSM
      const axis = R([0, 1, 0]);
      const zb = R([0, 0, 1]);
      const xb = R([1, 0, 0]);
      const back = ph === "rendezvous" ? 18 : 9;
      const side = ph === "rendezvous" ? 0 : 6;
      const lift = ph === "rendezvous" ? 3.2 : 5.5;
      P = [0, 1, 2].map((i) => C[i] - axis[i] * back + zb[i] * lift + xb[i] * side);
      // look between the ascent stage and the probe, so both vehicles stay in frame
      const gap = Math.hypot(C[0] - PROBE_TIP[0], C[1] - PROBE_TIP[1], C[2] - PROBE_TIP[2]);
      const k = Math.min(0.5, 6 / Math.max(6, gap));
      L = ph === "rendezvous" ? [0, DOCK_Y, 0] : [0, 1, 2].map((i) => C[i] + (PROBE_TIP[i] - C[i]) * Math.max(k, 0.35));
      U = zb;
      if (ph === "rendezvous") {
        // far out the camera looks at the CSM's direction from the ascent stage
        const d = [0 - C[0], DOCK_Y - C[1], 0 - C[2]];
        const dl = Math.hypot(...d) || 1;
        L = [C[0] + (d[0] / dl) * 40, C[1] + (d[1] / dl) * 40, C[2] + (d[2] / dl) * 40];
      }
    }
    if (first.current || snap) {
      pos.current.set(...P);
      look.current.set(...L);
      up.current.set(...U);
      first.current = false;
    } else {
      const k = Math.min(1, delta * 3);
      pos.current.lerp(_v.set(...P), k);
      look.current.lerp(_v.set(...L), Math.min(1, delta * 4));
      up.current.lerp(_v.set(...U), k).normalize();
    }
    camera.up.copy(up.current);
    camera.position.copy(pos.current);
    camera.lookAt(look.current);
    camera.updateMatrixWorld();
    // markers: the CSM far out (rendezvous), the probe tip and the far axis mark (alignment)
    const m = markRef.current;
    if (m) {
      const csm = proj([0, DOCK_Y - 3, 0]);
      const tip = proj(PROBE_TIP);
      const far = proj(FAR_AXIS);
      m.csm = csm;
      m.tip = tip;
      m.far = far;
    }
    sizeRef.current = { w: size.width, h: size.height };
    clockRef.current = s.missionT || 0;
  });
  return null;
}

/* ---- the simulation loop (fixed steps, inside the render loop) --------------------------------- */
function SimLoop({ simRef, inputRef, phaseRef, difficulty, alignRef, pausedRef, onEvent, plan }) {
  const acc = useRef(0);
  useFrame((_, rawDelta) => {
    const s = simRef.current;
    if (!s || pausedRef.current) return;
    const delta = Math.min(0.1, rawDelta);
    const ph = phaseRef.current;
    if (ph === "rendezvous") {
      s.play = (s.play || 0) + delta;
      const tm = playToMission(s.play, plan);
      s.missionT = tm;
      const st = plan.sample(tm);
      const pos = frames.fromL(st.slice(0, 3));
      // the ascent stage's centre is where the guidance's state is (its docking port leads)
      s.pos = pos;
      s.vel = frames.fromL(st.slice(3));
      const toCsm = [0 - pos[0], PROBE_TIP[1] - pos[1], 0 - pos[2]];
      const cp = s.checkpoint;
      const u = smooth((s.play - (PLAY_S - 4)) / 4);
      s.q = u > 0 ? slerpQ(pointingQ(toCsm), cp.q, u) : pointingQ(toCsm);
      s.fired = { t: [0, 0, 0], r: [0, 0, 0] };
      if (s.play >= PLAY_S) onEvent({ kind: "handover" });
      return;
    }
    if (ph !== "docking" && ph !== "captured") return;
    // Validation tooling only: a time scale and an autopilot deciding on the simulation's own
    // clock (as the unit tests' reference pilot). The game never sets either.
    const tool = typeof window !== "undefined" ? window : {};
    acc.current += delta * Math.min(16, Math.max(1, tool.__lvTimeScale || 1));
    const dt = 1 / 60;
    while (acc.current >= dt) {
      acc.current -= dt;
      s.missionT = (s.missionT || 0) + dt;
      let inp = tool.__lvDockInput || inputRef.current();
      if (tool.__lvDockAutopilot && s.status === "approach") {
        if (s._apNext == null || s.t >= s._apNext) {
          s._apCmd = tool.__lvDockAutopilot(s);
          s._apNext = s.t + PULSE;
        }
        inp = s._apCmd;
      }
      const e = stepDocking(s, inp, difficulty, dt, { align: alignRef.current });
      if (e) onEvent(e);
      if (s.status === "docked" || s.status === "failed") break;
    }
  });
  return null;
}

/* ---- touch controls ----------------------------------------------------------------------------- */
function JetButton({ label, sub, onDown, onUp, testId, className = "" }) {
  const down = (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    onDown();
  };
  const up = (e) => {
    e.preventDefault();
    onUp();
  };
  return (
    <button
      type="button"
      data-testid={testId}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={(e) => e.buttons && up(e)}
      onContextMenu={(e) => e.preventDefault()}
      className={`select-none touch-none flex flex-col items-center justify-center w-[52px] h-[52px] short:w-[46px] short:h-[46px] bg-black/55 border border-white/25 active:bg-[#FF3B00]/40 active:border-[#FF3B00] text-white font-mono text-[10px] tracking-[0.1em] backdrop-blur-sm ${className}`}
    >
      <span className="text-[15px] leading-none">{label}</span>
      {sub && <span className="text-[7px] tracking-[0.15em] text-zinc-400 mt-0.5">{sub}</span>}
    </button>
  );
}

/**
 * CADET's instructions: the next thing to do, read from the same telemetry as the HUD
 * (the pilot still flies every metre).
 */
export function cadetHint(tel, cfg, align = true) {
  if (!tel) return null;
  if (tel.closing > tel.closingLimit) return "TOO FAST: TAP AFT TO SLOW THE CLOSING RATE";
  if (tel.closing < -0.01) return "OPENING: TAP FWD TO CLOSE AGAIN";
  if (tel.vLatR > cfg.tol.vLat * 1.5) return "DRIFTING: TAP AGAINST THE DRIFT (◀ ▶ ▲ ▼) TO STOP IT";
  if (tel.offsetR > Math.max(cfg.tol.lateral * 0.8, 0.04 * tel.axial)) return "MOVE THE CYAN DOT TO THE CENTRE: TAP ◀ ▶ ▲ ▼, THEN WAIT";
  if (tel.angle > cfg.tol.angle) return align ? "AUTO ALIGN IS TURNING YOU ONTO THE PORT: WAIT" : "TURN AUTO ALIGN ON, OR LEVEL THE + IN ATT MODE";
  if (tel.closing < 0.03) return "LINED UP: TAP FWD ONCE OR TWICE TO CLOSE SLOWLY";
  return `IN THE CORRIDOR: KEEP UNDER ${tel.closingLimit.toFixed(2)} m/s AND LET IT DRIFT IN`;
}

/* ---- the component -------------------------------------------------------------------------------- */
export default function DockingOps({ difficulty = "ASTRONAUT", farSide = false, audio = null, onComplete, onAbort, onResult }) {
  const cfg = DOCKING[difficulty];
  const plan = useMemo(() => planRendezvous(difficulty), [difficulty]);
  const makeCheckpoint = useCallback(() => checkpointState(difficulty), [difficulty]);
  const simRef = useRef(null);
  if (!simRef.current) {
    const cp = makeCheckpoint();
    const st = plan.sample(0);
    simRef.current = { ...cp, pos: frames.fromL(st.slice(0, 3)), vel: frames.fromL(st.slice(3)), mode: "rendezvous", play: 0, missionT: 0, checkpoint: cp };
  }
  const phaseRef = useRef("insertion");
  const [phase, setPhaseState] = useState("insertion"); // insertion | rendezvous | handover | docking | captured | docked | transfer | jettison | failed
  const setPhase = (p) => {
    phaseRef.current = p;
    setPhaseState(p);
  };
  const [view, setViewState] = useState("COAS");
  const viewRef = useRef("COAS");
  const setView = (v) => {
    viewRef.current = v;
    setViewState(v);
  };
  const [mode, setMode] = useState("TRANSLATION");
  const modeRef = useRef("TRANSLATION");
  const [align, setAlignState] = useState(!!cfg.autoAlign);
  const alignRef = useRef(!!cfg.autoAlign);
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const [hud, setHud] = useState(null);
  const [failure, setFailure] = useState(null);
  const [toast, setToast] = useState(null);
  const [linkUp, setLinkUp] = useState(!farSide);
  const markRef = useRef({});
  const sizeRef = useRef({ w: 1, h: 1 });
  const clockRef = useRef(0);
  const attemptsRef = useRef(1);
  const startedAtRef = useRef(null);
  const contactsRef = useRef(0);
  const transferRef = useRef(0);
  const doneRef = useRef(false);

  /* -- input: held buttons and keys, with a minimum impulse per tap -- */
  const held = useRef(new Map()); // key → { axis: "t"|"r", i, v, until }
  const press = (key, axis, i, v) => held.current.set(key, { axis, i, v, until: performance.now() + PULSE * 1000, down: true });
  const release = (key) => {
    const h = held.current.get(key);
    if (!h) return;
    h.down = false;
    if (performance.now() >= h.until) held.current.delete(key);
  };
  const readInput = useCallback(() => {
    const t = [0, 0, 0];
    const r = [0, 0, 0];
    const now = performance.now();
    for (const [k, h] of held.current) {
      if (!h.down && now >= h.until) {
        held.current.delete(k);
        continue;
      }
      (h.axis === "t" ? t : r)[h.i] = Math.max(-1, Math.min(1, (h.axis === "t" ? t : r)[h.i] + h.v));
    }
    return { t, r };
  }, []);
  const inputRef = useRef(readInput);

  // keyboard (desktop): translation and attitude at once
  useEffect(() => {
    const MAP = {
      KeyW: ["t", 2, 1],
      KeyS: ["t", 2, -1],
      KeyA: ["t", 0, -1],
      KeyD: ["t", 0, 1],
      KeyR: ["t", 1, 1],
      KeyF: ["t", 1, -1],
      ArrowUp: ["r", 0, 1],
      ArrowDown: ["r", 0, -1],
      ArrowLeft: ["r", 2, 1],
      ArrowRight: ["r", 2, -1],
      KeyQ: ["r", 1, -1],
      KeyE: ["r", 1, 1],
    };
    const dn = (e) => {
      const m = MAP[e.code];
      if (!m || phaseRef.current !== "docking") return;
      e.preventDefault();
      if (!held.current.has("k" + e.code) || !held.current.get("k" + e.code).down) press("k" + e.code, ...m);
    };
    const upk = (e) => {
      if (MAP[e.code]) release("k" + e.code);
    };
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", upk);
    return () => {
      window.removeEventListener("keydown", dn);
      window.removeEventListener("keyup", upk);
    };
  }, []);

  /* -- phases and comms -- */
  const say = (id, o) => audio && audio.say(id, o);
  useEffect(() => {
    // orbit insertion: the end of the ascent burn, told as a title over the scene
    if (farSide) audio && audio.setEarthLink(false);
    say(farSide ? "ascent.insertionCrew" : "ascent.insertion", { delay: 0.6 });
    const t = setTimeout(() => setPhase("rendezvous"), 3200);
    return () => {
      clearTimeout(t);
      if (audio) audio.setEarthLink(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // rendezvous milestones on the guidance's own clock
  const said = useRef(new Set());
  useEffect(() => {
    if (phase !== "rendezvous") return undefined;
    const id = setInterval(() => {
      const tm = simRef.current.missionT || 0;
      const once = (k, cond, fn) => {
        if (cond && !said.current.has(k)) {
          said.current.add(k);
          fn();
        }
      };
      once("aos", farSide && tm >= COAST + 0.3 * TRANSFER, () => {
        setLinkUp(true);
        audio && audio.setEarthLink(true);
        say("rdv.aos");
      });
      once("tpi", tm >= COAST, () => (farSide && tm < COAST + 0.3 * TRANSFER ? null : say("rdv.tpi")));
      once("mcc", tm >= COAST + 0.5 * TRANSFER, () => say("rdv.mcc"));
      once("brk", tm >= COAST + TRANSFER + 0.85 * FINAL, () => say("rdv.braking"));
    }, 120);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const startDocking = () => {
    const cp = makeCheckpoint();
    Object.assign(simRef.current, cp, { mode: "docking", checkpoint: cp, _apNext: null, _apCmd: null, propOutAt: null, capturePos: null, captureQ: null });
    held.current.clear();
    startedAtRef.current = performance.now();
    setFailure(null);
    setPhase("docking");
  };

  const onEvent = useCallback(
    (e) => {
      const s = simRef.current;
      if (e.kind === "handover" && phaseRef.current === "rendezvous") {
        // by the end of the rendezvous the orbit has carried both vehicles back into view of the
        // Earth (also when the film was skipped past the acquisition of signal)
        if (farSide && !said.current.has("aos")) {
          said.current.add("aos");
          setLinkUp(true);
          audio && audio.setEarthLink(true);
          say("rdv.aos");
        }
        setPhase("handover");
        say("rdv.handover");
        say("rdv.handoverCrew", { delay: 3.4 });
        setTimeout(() => startDocking(), 3800);
        return;
      }
      if (e.kind === "capture") {
        setPhase("captured");
        say("dock.contact");
        say("dock.capture", { delay: 0.9 });
        audio && audio.clank(0.55);
        audio && audio.thud && audio.thud(0.4);
        setTimeout(() => audio && audio.clank(0.35), 2600);
        setTimeout(() => audio && audio.clank(0.3), 4800);
        return;
      }
      if (e.kind === "docked") {
        setPhase("docked");
        // the twelve capture latches fire around the ring (structure-borne)
        for (let k = 0; k < 4; k++) setTimeout(() => audio && audio.clank(0.4 + 0.1 * (k % 2)), 120 * k);
        say("dock.hardCrew", { delay: 0.6 });
        if (!farSide || linkUp) say("dock.hard", { delay: 3.2 });
        const result = { success: true, attempts: attemptsRef.current, contacts: contactsRef.current + (s.contacts || 0), propLeft: +s.prop.toFixed(2), time: +(((performance.now() - (startedAtRef.current || performance.now())) / 1000).toFixed(1)) };
        onResult && onResult(result);
        setTimeout(() => setPhase("transfer"), 4200);
        return;
      }
      if (e.kind === "deflected" || e.kind === "outside" || (e.kind === "collision" && e.recoverable)) {
        setToast({ text: e.title, at: performance.now(), tone: "warn" });
        audio && audio.thud && audio.thud(0.35);
        say(e.kind === "collision" ? "dock.collision" : "dock.deflected");
        return;
      }
      if (s.status === "failed") {
        audio && audio.thud && audio.thud(0.6);
        if (e.kind === "collision" || e.kind === "damage") say("dock.collision");
        contactsRef.current += s.contacts || 0;
        setFailure(e);
        setPhase("failed");
        onResult && onResult({ success: false, failure: e.kind, attempts: attemptsRef.current });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [audio, farSide, linkUp]
  );

  // crew transfer and the ascent stage's jettison (the CSM keeps on for home)
  const [transferStep, setTransferStep] = useState(0);
  const TRANSFER_STEPS = ["TUNNEL PRESSURE EQUALIZED", "HATCHES OPEN", "CREW TRANSFER", "SAMPLES STOWED IN THE COMMAND MODULE", "HATCHES CLOSED"];
  useEffect(() => {
    if (phase !== "transfer") return undefined;
    const ts = TRANSFER_STEPS.map((_, i) => setTimeout(() => setTransferStep(i + 1), 900 + i * 1300));
    ts.push(setTimeout(() => say("dock.transfer"), 900 + TRANSFER_STEPS.length * 1300 - 600));
    ts.push(setTimeout(() => setPhase("jettison"), 900 + TRANSFER_STEPS.length * 1300 + 1600));
    return () => ts.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);
  useEffect(() => {
    if (phase !== "jettison") return undefined;
    const s = simRef.current;
    const t0 = performance.now();
    audio && audio.thud && audio.thud(0.45);
    audio && audio.hiss(0.8, 0.08);
    let raf;
    const tick = () => {
      const u = (performance.now() - t0) / 1000;
      // the spent ascent stage drifts away from the probe at ~0.3 m/s, slowly tumbling
      s.pos = [DOCKED_POS[0] + 0.02 * u, DOCKED_POS[1] + 0.3 * u + 0.02 * u * u, DOCKED_POS[2] + 0.03 * u];
      s.q = qNorm(qMul(DOCKED_Q, [Math.sin(0.04 * u) * 0.7, 0, Math.sin(0.04 * u) * 0.7, Math.cos(0.04 * u)]));
      if (u < 9) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const t1 = setTimeout(() => say("dock.jettison"), 1500);
    const t2 = setTimeout(() => {
      if (doneRef.current) return;
      doneRef.current = true;
      onComplete && onComplete();
    }, 8500);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // HUD at 10 Hz, from the simulation state
  useEffect(() => {
    const id = setInterval(() => {
      const s = simRef.current;
      if (!s) return;
      const tel = telemetry(s, difficulty);
      const st = phaseRef.current === "docking" ? dockingStatus(s, difficulty) : null;
      setHud({ tel, st, status: s.status, m: { ...markRef.current }, size: { ...sizeRef.current }, missionT: s.missionT || 0 });
      if (typeof window !== "undefined") {
        window.__lvDock = { phase: phaseRef.current, status: s.status, difficulty, tel, st, contacts: s.contacts, prop: s.prop, attempts: attemptsRef.current, view: viewRef.current, mode: modeRef.current, align: alignRef.current, pos: s.pos.slice(), q: s.q.slice() };
        window.__lvDockState = s; // validation tooling (read-only)
      }
      // the closing-rate warning, said once per breach
      if (st && st.warnings.includes("REDUCE CLOSING VELOCITY")) say("dock.closing");
    }, 100);
    if (typeof window !== "undefined") window.__lvDockingTools = { referencePilot, telemetry };
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [difficulty]);

  const retry = () => {
    attemptsRef.current += 1;
    startDocking();
  };
  const skipRendezvous = () => {
    if (phaseRef.current !== "rendezvous") return;
    simRef.current.play = PLAY_S - 0.01;
  };
  const togglePause = () => {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
    if (pausedRef.current) held.current.clear();
  };

  /* -- control pad (TRANSLATION / ATTITUDE) -- */
  const pad = (axisKey, label, sub, axis, i, v, cls) => (
    <JetButton key={axisKey} testId={`dock-${axisKey}`} label={label} sub={sub} className={cls} onDown={() => press(axisKey, axis, i, v)} onUp={() => release(axisKey)} />
  );
  const tMode = mode === "TRANSLATION";
  const controls = (
    <div className="absolute inset-x-0 bottom-0 z-30 pointer-events-none flex items-end justify-between px-4 pb-4 short:px-3 short:pb-2 safe-ml safe-mr safe-mb" data-testid="dock-controls">
      {/* left: the cross pad */}
      <div className="pointer-events-auto grid grid-cols-3 gap-1.5" data-testid="dock-pad">
        <span />
        {tMode ? pad("up", "▲", "UP", "t", 2, 1) : pad("pitch-up", "⤒", "PITCH", "r", 0, 1)}
        <span />
        {tMode ? pad("left", "◀", "LEFT", "t", 0, -1) : pad("yaw-left", "↺", "YAW", "r", 2, 1)}
        <button
          type="button"
          data-testid="dock-mode"
          onClick={() => {
            const m = tMode ? "ATTITUDE" : "TRANSLATION";
            modeRef.current = m;
            setMode(m);
            held.current.clear();
          }}
          className={`w-[52px] h-[52px] short:w-[46px] short:h-[46px] font-mono text-[7px] tracking-[0.12em] border ${tMode ? "border-[#4fd1c5]/70 text-[#4fd1c5]" : "border-[#f5c451]/70 text-[#f5c451]"} bg-black/60 touch-manipulation`}
        >
          {tMode ? "TRANS" : "ATT"}
          <br />
          MODE
        </button>
        {tMode ? pad("right", "▶", "RIGHT", "t", 0, 1) : pad("yaw-right", "↻", "YAW", "r", 2, -1)}
        <span />
        {tMode ? pad("down", "▼", "DOWN", "t", 2, -1) : pad("pitch-down", "⤓", "PITCH", "r", 0, -1)}
        <span />
      </div>
      {/* right: closing (forward / aft) or roll */}
      <div className="pointer-events-auto flex flex-col gap-1.5 items-end">
        {cfg.autoAlign && (
          <button
            type="button"
            data-testid="dock-align"
            onClick={() => {
              alignRef.current = !alignRef.current;
              setAlignState(alignRef.current);
            }}
            className={`min-h-[36px] px-2 font-mono text-[8px] tracking-[0.15em] border bg-black/60 ${align ? "border-[#4fd1c5] text-[#4fd1c5]" : "border-white/30 text-zinc-400"}`}
          >
            AUTO ALIGN {align ? "ON" : "OFF"}
          </button>
        )}
        {tMode ? pad("fwd", "▲", "FWD", "t", 1, 1, "!w-[60px]") : pad("roll-left", "⟲", "ROLL", "r", 1, -1, "!w-[60px]")}
        {tMode ? pad("aft", "▼", "AFT", "t", 1, -1, "!w-[60px]") : pad("roll-right", "⟳", "ROLL", "r", 1, 1, "!w-[60px]")}
      </div>
    </div>
  );

  /* -- HUD -- */
  const tel = hud && hud.tel;
  const warnColor = (bad) => (bad ? "text-[#FF3B00]" : "text-white");
  const deg = (r) => (r * 180) / Math.PI;
  const st = hud && hud.st;
  const docking = phase === "docking" || phase === "captured";
  const rendezvousRange = phase === "rendezvous" || phase === "insertion" ? rangeOf(plan.sample(simRef.current.missionT || 0)) : null;
  // alignment display: the drogue's offset from the probe's axis (dot, ±1 m full scale) and the
  // pointing error (cross: pitch/yaw, ±10° full scale), both from the simulation state
  const box = 84;
  const offDot = tel ? [Math.max(-1, Math.min(1, tel.offset[0])) * (box / 2 - 6), -Math.max(-1, Math.min(1, tel.offset[1])) * (box / 2 - 6)] : [0, 0];
  const attCross = tel ? [Math.max(-1, Math.min(1, -deg(tel.yaw) / 10)) * (box / 2 - 6), -Math.max(-1, Math.min(1, deg(tel.pitch) / 10)) * (box / 2 - 6)] : [0, 0];
  const tolLat = cfg.tol.lateral;
  const ok = tel && tel.offsetR < tolLat && tel.angle < cfg.tol.angle && tel.closing <= tel.closingLimit && tel.vLatR < cfg.tol.vLat;

  return (
    <div className="absolute inset-0 bg-black" data-testid="docking-ops" data-phase={phase}>
      <div className="absolute inset-0 canvas-host">
        <Canvas
          camera={{ position: [0, 60, 20], fov: 50, near: 0.05, far: 6000 }}
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: false, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }}
          onCreated={({ gl }) => {
            gl.setClearColor("#000000");
            window.__lvDockGl = gl; // validation tooling: renderer.info
          }}
        >
          <ambientLight intensity={0.05} />
          <directionalLight position={SUN_DIR.clone().multiplyScalar(100).toArray()} intensity={3.2} color="#fff6ea" />
          <hemisphereLight args={["#1a1d24", "#6d6a64", 0.35]} />
          <Stars radius={2500} depth={300} count={4000} factor={60} saturation={0} fade speed={0} />
          <Suspense fallback={null}>
            <MoonBelow clockRef={clockRef} />
            <Vehicles simRef={simRef} viewRef={viewRef} />
            <Corridor simRef={simRef} viewRef={viewRef} />
          </Suspense>
          <Director simRef={simRef} viewRef={viewRef} phaseRef={phaseRef} markRef={markRef} sizeRef={sizeRef} clockRef={clockRef} />
          <SimLoop simRef={simRef} inputRef={inputRef} phaseRef={phaseRef} difficulty={difficulty} alignRef={alignRef} pausedRef={pausedRef} onEvent={onEvent} plan={plan} />
          <AdaptiveResolution />
        </Canvas>
      </div>

      {/* Orbit insertion and the rendezvous: the guidance's own numbers */}
      {(phase === "insertion" || phase === "rendezvous") && (
        <>
          <div className="absolute left-6 md:left-10 bottom-10 short:bottom-3 safe-ml safe-mb z-30 pointer-events-none bg-black/45 backdrop-blur-sm border-l-2 border-[#FF3B00] px-3 py-2 scan-in" data-testid="rendezvous-caption">
            <div className="font-mono text-[9px] tracking-[0.4em] text-[#FF3B00]">● {phase === "insertion" ? "ORBIT INSERTION" : "LUNAR ORBITAL RENDEZVOUS"}</div>
            <div className="font-display font-black text-white text-2xl short:text-lg tracking-tight mt-0.5">
              {phase === "insertion" ? "ASCENT STAGE IN LUNAR ORBIT" : "CLOSING ON THE CSM"}
            </div>
            <div className="font-mono text-[10px] short:text-[9px] tracking-[0.18em] text-zinc-300 mt-0.5">
              {phase === "insertion" ? "14 KM BELOW AND 46 KM BEHIND THE CSM · CO-ELLIPTIC" : "AUTOMATIC GUIDANCE · TPI → MIDCOURSE → GATE → BRAKING · FINAL DOCKING BY THE CREW"}
            </div>
          </div>
          {rendezvousRange && (
            <div className="absolute top-16 short:top-[var(--hud-top)] right-6 md:right-10 safe-mr z-30 pointer-events-none bg-black/45 backdrop-blur-sm border border-white/10 px-3 py-2 font-mono text-[10px] tracking-[0.15em] tabular" data-testid="rendezvous-radar">
              <div className="text-[9px] tracking-[0.35em] text-zinc-400">RENDEZVOUS RADAR</div>
              <div className="text-white mt-0.5">
                RANGE <span data-testid="rdv-range">{rendezvousRange.range >= 1000 ? `${(rendezvousRange.range / 1000).toFixed(2)} km` : `${rendezvousRange.range.toFixed(0)} m`}</span>
              </div>
              <div className="text-white">RATE {rendezvousRange.rate.toFixed(1)} m/s</div>
              <div className="text-zinc-400 mt-0.5">
                {(() => {
                  const tm = simRef.current.missionT || 0;
                  return tm < COAST ? "CO-ELLIPTIC COAST" : tm < COAST + 0.5 * TRANSFER ? "TPI · TRANSFER" : tm < COAST + TRANSFER ? "MIDCOURSE · TRANSFER" : tm < COAST + TRANSFER + 0.85 * FINAL ? "GATE · FINAL APPROACH" : "BRAKING";
                })()}
              </div>
              <div className="text-zinc-500">MET +{Math.floor((simRef.current.missionT || 0) / 60)} min</div>
            </div>
          )}
          {/* the CSM far out: a marker on its projected position */}
          {hud && hud.m.csm && hud.m.csm.front && phase === "rendezvous" && rendezvousRange && rendezvousRange.range > 150 && (
            <div className="absolute z-20 pointer-events-none" style={{ left: hud.m.csm.x, top: hud.m.csm.y, transform: "translate(-50%,-50%)" }} data-testid="csm-marker">
              <div className="w-7 h-7 border border-[#4fd1c5] rotate-45" />
              <div className="absolute left-9 top-0 font-mono text-[9px] tracking-[0.2em] text-[#4fd1c5] whitespace-nowrap">CSM</div>
            </div>
          )}
          {phase === "rendezvous" && (
            <button type="button" onClick={skipRendezvous} data-testid="rendezvous-skip" className="absolute bottom-6 short:bottom-2 right-6 md:right-10 safe-mr safe-mb z-30 font-mono text-[10px] tracking-[0.3em] text-zinc-400 hover:text-white px-3 py-2 touch:min-h-[44px] touch:px-4 bg-black/30 border border-white/10">
              SKIP CINEMATIC ›
            </button>
          )}
        </>
      )}

      {phase === "handover" && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center pointer-events-none" data-testid="dock-handover">
          <div className="font-mono text-[10px] tracking-[0.4em] text-[#FF3B00]">● RENDEZVOUS COMPLETE</div>
          <div className="font-display font-black text-white text-4xl short:text-2xl tracking-tight mt-1">LUNAVIA — DOCKING OPERATIONS</div>
          <div className="font-mono text-[10px] tracking-[0.25em] text-zinc-300 mt-1">MANUAL CONTROL · {difficulty}</div>
        </div>
      )}

      {/* Docking HUD (all from the simulation) */}
      {docking && tel && (
        <>
          <div className="absolute top-14 short:top-[var(--hud-top)] left-4 md:left-8 safe-ml z-30 pointer-events-none bg-black/55 backdrop-blur-sm border border-white/10 px-3 py-2 short:px-2 short:py-1.5 font-mono tabular w-[188px] short:w-[172px]" data-testid="dock-hud">
            <div className="text-[8px] tracking-[0.35em] text-[#FF3B00]">● DOCKING · {difficulty}</div>
            <div className="text-white text-[10px] short:text-[9px] tracking-[0.12em] mt-0.5 truncate" data-testid="dock-status">{phase === "captured" ? "DOCKING CONTACT · CAPTURE" : st ? st.phase : ""}</div>
            {difficulty === "CADET" && phase === "docking" && (
              <div className="text-[#4fd1c5] text-[8px] tracking-[0.08em] leading-tight mt-0.5" data-testid="dock-hint">
                {cadetHint(tel, cfg, align)}
              </div>
            )}
            <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] short:text-[9px]">
              <span className="text-zinc-400">RANGE</span>
              <span className="text-right text-white" data-testid="dock-range">{tel.axial.toFixed(tel.axial < 10 ? 2 : 1)} m</span>
              <span className="text-zinc-400">CLOSING</span>
              <span className={`text-right ${warnColor(tel.closing > tel.closingLimit)}`} data-testid="dock-closing">{tel.closing.toFixed(3)}</span>
              <span className="text-zinc-400">LAT R/L</span>
              <span className={`text-right ${warnColor(Math.abs(tel.vLat[0]) > cfg.tol.vLat)}`}>{tel.vLat[0].toFixed(3)}</span>
              <span className="text-zinc-400">VERT U/D</span>
              <span className={`text-right ${warnColor(Math.abs(tel.vLat[1]) > cfg.tol.vLat)}`}>{tel.vLat[1].toFixed(3)}</span>
              <span className="text-zinc-400">OFFSET</span>
              <span className={`text-right ${warnColor(tel.offsetR > Math.max(tolLat, 0.12 * tel.axial))}`} data-testid="dock-offset">
                {tel.offset[0] >= 0 ? "R" : "L"}
                {Math.abs(tel.offset[0]).toFixed(2)} {tel.offset[1] >= 0 ? "U" : "D"}
                {Math.abs(tel.offset[1]).toFixed(2)}
              </span>
              <span className="text-zinc-400">ATT P/Y/R</span>
              <span className={`text-right ${warnColor(tel.angle > cfg.tol.angle)}`} data-testid="dock-att">
                {deg(tel.pitch).toFixed(1)}/{deg(tel.yaw).toFixed(1)}/{deg(tel.roll).toFixed(1)}
              </span>
              <span className="text-zinc-400">RCS</span>
              <span className={`text-right ${warnColor(tel.propFrac < 0.15)}`} data-testid="dock-rcs">{Math.round(tel.propFrac * 100)} %</span>
            </div>
            {farSide && !linkUp && (
              <div className="mt-1 text-[8px] tracking-[0.15em] text-[#9fb6cc]" data-testid="earth-link">
                ○ EARTH LINK UNAVAILABLE
              </div>
            )}
            {st && st.warnings.length > 0 && (
              <div className="mt-1 text-[8px] tracking-[0.12em] text-[#FF3B00] leading-tight" data-testid="dock-warnings">
                {st.warnings.slice(0, 2).map((w) => (
                  <div key={w}>▲ {w}</div>
                ))}
              </div>
            )}
          </div>

          {/* Alignment display: offset dot and pointing cross, against the capture tolerance */}
          <div className="absolute top-14 short:top-[var(--hud-top)] right-4 md:right-8 safe-mr z-30 pointer-events-none flex flex-col items-end gap-1" data-testid="dock-align-display">
            <div className="relative bg-black/55 border border-white/10" style={{ width: box, height: box }}>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="absolute w-full h-px bg-white/15" />
                <div className="absolute h-full w-px bg-white/15" />
                <div className="rounded-full border border-[#4fd1c5]/60" style={{ width: (tolLat / 1) * (box - 12), height: (tolLat / 1) * (box - 12) }} />
              </div>
              <div className={`absolute w-2.5 h-2.5 rounded-full ${tel.offsetR < tolLat ? "bg-[#4fd1c5]" : "bg-[#FF3B00]"}`} style={{ left: box / 2 + offDot[0] - 5, top: box / 2 + offDot[1] - 5 }} data-testid="dock-offset-dot" />
              <div className="absolute text-[#f5c451] text-[14px] leading-none font-mono" style={{ left: box / 2 + attCross[0] - 5, top: box / 2 + attCross[1] - 8 }}>
                +
              </div>
            </div>
            <div className="font-mono text-[7px] tracking-[0.15em] text-zinc-400 text-right leading-tight">
              <span className="text-[#4fd1c5]">●</span> PORT OFFSET ±1 m · <span className="text-[#f5c451]">+</span> ATTITUDE ±10°
            </div>
            <div className={`font-mono text-[8px] tracking-[0.2em] px-1.5 py-0.5 border ${ok ? "text-[#4fd1c5] border-[#4fd1c5]/60" : "text-zinc-400 border-white/20"}`} data-testid="dock-corridor">
              {ok ? "IN CORRIDOR" : "OUT OF CORRIDOR"}
            </div>
          </div>

          {/* COAS: the boresight, the probe tip and the far axis mark (projected from the real geometry) */}
          {view === "COAS" && hud && hud.m.tip && (
            <div className="absolute inset-0 z-20 pointer-events-none" data-testid="dock-coas">
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                <div className="w-16 h-16 rounded-full border border-[#FF3B00]/70" />
                <div className="absolute left-1/2 top-1/2 w-24 h-px -translate-x-1/2 bg-[#FF3B00]/70" />
                <div className="absolute left-1/2 top-1/2 h-24 w-px -translate-y-1/2 bg-[#FF3B00]/70" />
              </div>
              {hud.m.far && hud.m.far.front && (
                <div className="absolute w-3 h-3 border border-[#f5c451] rotate-45" style={{ left: hud.m.far.x - 6, top: hud.m.far.y - 6 }} />
              )}
              {hud.m.tip.front && <div className="absolute w-3.5 h-3.5 rounded-full border-2 border-[#4fd1c5]" style={{ left: hud.m.tip.x - 7, top: hud.m.tip.y - 7 }} data-testid="dock-tip-mark" />}
            </div>
          )}
          {phase === "docking" && controls}
          <div className="absolute top-14 short:top-[var(--hud-top)] left-1/2 -translate-x-1/2 z-30 flex gap-1.5">
            <button type="button" data-testid="dock-view" onClick={() => setView(view === "COAS" ? "CHASE" : "COAS")} className="min-h-[36px] px-2.5 font-mono text-[9px] tracking-[0.2em] text-white bg-black/55 border border-white/25">
              VIEW · {view === "COAS" ? "WINDOW" : "EXTERNAL"}
            </button>
            <button type="button" data-testid="dock-pause" onClick={togglePause} className="min-h-[36px] px-2.5 font-mono text-[9px] tracking-[0.2em] text-white bg-black/55 border border-white/25">
              {paused ? "RESUME" : "PAUSE"}
            </button>
            <button type="button" data-testid="dock-abort" onClick={() => onAbort && onAbort()} className="min-h-[36px] px-2.5 font-mono text-[9px] tracking-[0.2em] text-zinc-300 bg-black/55 border border-white/25">
              ABORT
            </button>
          </div>
          {toast && performance.now() - toast.at < 3500 && (
            <div className="absolute top-[45%] left-1/2 -translate-x-1/2 z-30 pointer-events-none font-mono text-[11px] tracking-[0.25em] text-[#FF3B00] bg-black/60 border border-[#FF3B00]/60 px-3 py-1.5 text-center" data-testid="dock-toast">
              {toast.text}
              <div className="text-[9px] text-zinc-300 tracking-[0.18em] mt-0.5">BACK OFF · STABILIZE · TRY AGAIN</div>
            </div>
          )}
          {paused && (
            <div className="absolute inset-0 z-40 bg-black/60 flex items-center justify-center" data-testid="dock-paused">
              <div className="text-center">
                <div className="font-display font-black text-white text-4xl">PAUSED</div>
                <button type="button" onClick={togglePause} className="btn-hud btn-hud-primary mt-4 min-h-[44px]" data-testid="dock-resume">
                  RESUME
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {(phase === "docked" || phase === "transfer" || phase === "jettison") && (
        <div className="absolute left-6 md:left-10 bottom-10 short:bottom-3 safe-ml safe-mb z-30 pointer-events-none bg-black/50 backdrop-blur-sm border-l-2 border-[#4fd1c5] px-3 py-2 scan-in" data-testid="dock-complete">
          <div className="font-mono text-[9px] tracking-[0.4em] text-[#4fd1c5]">● {phase === "docked" ? "HARD DOCK CONFIRMED" : phase === "transfer" ? "CREW TRANSFER" : "ASCENT STAGE JETTISON"}</div>
          <div className="font-display font-black text-white text-2xl short:text-lg tracking-tight mt-0.5">
            {phase === "docked" ? "HARD DOCK CONFIRMED" : phase === "transfer" ? (transferStep >= TRANSFER_STEPS.length ? "CREW TRANSFER COMPLETE" : "CREW TRANSFER") : "ASCENT STAGE JETTISONED"}
          </div>
          {phase === "transfer" && (
            <ul className="font-mono text-[9px] tracking-[0.18em] text-zinc-300 mt-1 space-y-0.5" data-testid="dock-transfer-steps">
              {TRANSFER_STEPS.map((s, i) => (
                <li key={s} className={i < transferStep ? "text-white" : "text-zinc-600"}>
                  {i < transferStep ? "✓" : "·"} {s}
                </li>
              ))}
            </ul>
          )}
          {phase === "jettison" && <div className="font-mono text-[10px] tracking-[0.18em] text-zinc-300 mt-0.5">THE CSM CARRIES THE CREW HOME · PREPARE FOR TRANS-EARTH INJECTION</div>}
          {phase === "docked" && <div className="font-mono text-[10px] tracking-[0.18em] text-zinc-300 mt-0.5">12 LATCHES LOCKED · TUNNEL SEALED</div>}
        </div>
      )}

      {phase === "failed" && failure && (
        <div className="absolute inset-0 z-40 bg-black/65 backdrop-blur-sm flex items-center justify-center px-6" data-testid="dock-failed">
          <div className="text-center max-w-lg">
            <div className="font-mono text-[10px] tracking-[0.4em] text-[#FF3B00]">● DOCKING FAILED</div>
            <div className="font-display font-black text-white text-3xl short:text-2xl tracking-tight mt-1" data-testid="dock-failed-title">{failure.title}</div>
            <div className="font-mono text-[10px] tracking-[0.18em] text-zinc-300 mt-2">THE ASCENT STAGE RETURNS TO THE RENDEZVOUS CHECKPOINT · RCS REFILLED FOR THE ATTEMPT</div>
            <div className="mt-5 flex flex-wrap gap-3 justify-center">
              <button type="button" onClick={retry} className="btn-hud btn-hud-primary min-h-[44px]" data-testid="dock-retry">
                RETRY FROM RENDEZVOUS CHECKPOINT
              </button>
              <button type="button" onClick={() => onAbort && onAbort()} className="btn-hud min-h-[44px]" data-testid="dock-failed-abort">
                ABORT MISSION
              </button>
            </div>
          </div>
        </div>
      )}
      {farSide && !linkUp && !docking && (
        <div className="absolute top-36 short:top-[7.2rem] right-6 md:right-10 safe-mr z-30 pointer-events-none font-mono text-[9px] tracking-[0.3em] text-[#9fb6cc] bg-black/40 border border-[#9fb6cc]/40 px-2 py-1" data-testid="earth-link">
          ○ EARTH LINK UNAVAILABLE
        </div>
      )}
    </div>
  );
}
