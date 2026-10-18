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
  restoreCheckpoint,
  stepDocking,
  telemetry,
} from "@/data/dockingSim";
import { COAST, FINAL, PLAY_S, TRANSFER, planRendezvous, playToMission, rangeOf } from "@/data/rendezvous";
import { CONTROLS, GUIDANCE_VOICE, STEPS, UI as GUI, createGuidance, guidanceText, guidedPilot } from "@/data/dockingGuidance";
import { FIRST_PERSON, ORBIT_DEFAULT, VIEWS, VIEW_LABEL, orbitDrag, orbitZoom, viewCamera } from "@/data/dockingViews";
import { CabinLight, Cockpit, WindowFrame, rcsLevels } from "@/components/DockingCabin";
import { VERBOSITY } from "@/audio/commsDirector";
import { useAudioSettings } from "@/audio/audioSettings";

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
 * RESTART DOCKING (top bar, held for RESTART_HOLD_MS so a brush cannot fire it;
 * also on the pause and failure screens) puts the whole simulation back on
 * that checkpoint (dockingSim.restoreCheckpoint) at any time during the
 * approach. Each restart is a new attempt in the mission log.
 *
 * FOUR VIEWS (data/dockingViews; the selector under the top bar), all on the one
 * simulation, none of them able to change it:
 *   NAV      the docking navigation display it always had: the camera on the
 *            port's axis with the reticle, the alignment display and the HUD;
 *   WINDOW   first person through the overhead docking window (DockingCabin
 *            WindowFrame), a compact readout and the guidance;
 *   COCKPIT  the 3D cabin (DockingCabin Cockpit) with its live instruments;
 *   360°     a free camera around the ascent stage: drag to orbit, pinch or
 *            wheel to zoom, RESET CAMERA; the gesture layer sits under the
 *            controls, so a drag never reaches a jet button and a jet button
 *            never turns the camera.
 *
 * DOCKING GUIDANCE (bottom centre, between the controls): data/dockingGuidance
 * reads the same state and shows one instruction at a time — the step (1–5),
 * the correction, the button that makes it (lit on the pad for CADET and
 * ASTRONAUT), and a confirmation when it is done. GUIDANCE ON/OFF hides it;
 * the HUD's safety warnings and telemetry stay.
 *
 * Controls (iPhone landscape): a cross pad and a FWD/AFT pair, in TRANSLATION
 * or ATTITUDE mode (the pad becomes pitch/yaw, the pair roll). A tap is one
 * minimum-impulse firing; holding keeps the jets on; buttons combine
 * (multi-touch). Keyboard (desktop): W/S up/down, A/D left/right, R/F
 * forward/aft, arrows pitch/yaw, Q/E roll.
 */

const MOON_MAP = process.env.PUBLIC_URL + "/textures/planets/moon_1024.jpg";
// Loaded with the app, so lunar orbit is drawn from its first frame after the ascent.
useTexture.preload(MOON_MAP);
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
    // the first-person views are inside the ascent stage: its outside is not drawn there
    lm.current.visible = !(FIRST_PERSON[viewRef.current] && s.status !== "docked" && s.mode === "docking");
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
    grp.current.visible = viewRef.current === "ORBIT" && s.mode === "docking" && s.status === "approach";
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
function Director({ simRef, viewRef, phaseRef, markRef, sizeRef, clockRef, orbitRef }) {
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
    const dockingPhase = ph === "docking" || ph === "handover" || ph === "captured";
    const v = viewRef.current;
    let fov = 50;
    if (dockingPhase && v !== "NAV") {
      // WINDOW, COCKPIT and 360°: the view's own camera (data/dockingViews), placed directly
      const cam = viewCamera(v, s, orbitRef.current);
      camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
      camera.quaternion.set(cam.q[0], cam.q[1], cam.q[2], cam.q[3]);
      if (camera.fov !== cam.fov) {
        camera.fov = cam.fov;
        camera.updateProjectionMatrix();
      }
      camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
      camera.updateMatrixWorld();
      // keep the smoothing state on this camera, so leaving the view later is seamless
      pos.current.copy(camera.position);
      look.current.set(0, 0, -10).applyQuaternion(camera.quaternion).add(camera.position);
      up.current.copy(camera.up);
      first.current = false;
      const m = markRef.current;
      if (m) {
        m.csm = proj([0, DOCK_Y - 3, 0]);
        m.tip = proj(PROBE_TIP);
        m.far = proj(FAR_AXIS);
      }
      if (typeof window !== "undefined") window.__lvDockCam = { view: v, pos: cam.pos, q: cam.q, fov: cam.fov }; // validation tooling
      sizeRef.current = { w: size.width, h: size.height };
      clockRef.current = s.missionT || 0;
      return;
    }
    if (ph === "docked" || ph === "transfer" || ph === "jettison") {
      // the joined vehicles above the Moon: a slow orbit of the stack
      const a = 0.9 + now * 0.06;
      const mid = [0, DOCK_Y - 1.5, 0];
      P = [mid[0] + Math.cos(a) * 26, mid[1] + 4, mid[2] + 9 + Math.sin(a) * 6];
      L = ph === "jettison" ? [C[0] * 0.5, (C[1] + mid[1]) * 0.5, C[2] * 0.5] : mid;
    } else if (v === "NAV" && dockingPhase) {
      // NAV: the docking navigation camera, as it always was: on the port's axis, looking up it, +Z up
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
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    camera.up.copy(up.current);
    camera.position.copy(pos.current);
    camera.lookAt(look.current);
    camera.updateMatrixWorld();
    if (typeof window !== "undefined" && dockingPhase) window.__lvDockCam = { view: v, pos: camera.position.toArray(), q: camera.quaternion.toArray(), fov: camera.fov };
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

/* ---- 360°: the camera gestures (one finger orbits, two fingers pinch, the wheel zooms) ---------------- */
function OrbitPad({ orbitRef }) {
  const pts = useRef(new Map());
  const pinch = useRef(null);
  const spread = () => {
    const [a, b] = [...pts.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const down = (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pinch.current = pts.current.size >= 2 ? spread() : null;
  };
  const move = (e) => {
    const p = pts.current.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pts.current.size >= 2) {
      const d = spread();
      if (pinch.current) orbitRef.current = orbitZoom(orbitRef.current, d / pinch.current);
      pinch.current = d;
    } else {
      orbitRef.current = orbitDrag(orbitRef.current, dx, dy);
    }
    if (typeof window !== "undefined") window.__lvOrbitGestures = (window.__lvOrbitGestures || 0) + 1; // validation tooling
  };
  const up = (e) => {
    pts.current.delete(e.pointerId);
    pinch.current = pts.current.size >= 2 ? spread() : null;
  };
  return (
    <div
      className="absolute inset-0 z-[15] touch-none select-none cursor-grab active:cursor-grabbing"
      data-testid="dock-orbit-pad"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onWheel={(e) => {
        orbitRef.current = orbitZoom(orbitRef.current, Math.exp(-e.deltaY * 0.0015));
      }}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

/* ---- touch controls ----------------------------------------------------------------------------- */
export const RESTART_HOLD_MS = 600;
const HINT_RING = "shadow-[0_0_0_2px_#4fd1c5,0_0_16px_rgba(79,209,197,0.55)] border-[#4fd1c5]";
function JetButton({ label, sub, onDown, onUp, testId, className = "", hint = false }) {
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
      data-hint={hint ? "1" : undefined}
      className={`select-none touch-none flex flex-col items-center justify-center w-[52px] h-[52px] short:w-[46px] short:h-[46px] bg-black/55 border border-white/25 active:bg-[#FF3B00]/40 active:border-[#FF3B00] text-white font-mono text-[10px] tracking-[0.1em] backdrop-blur-sm ${hint ? HINT_RING : ""} ${className}`}
    >
      <span className="text-[15px] leading-none">{label}</span>
      {sub && <span className="text-[7px] tracking-[0.15em] text-zinc-400 mt-0.5">{sub}</span>}
    </button>
  );
}

/**
 * RESTART DOCKING: one deliberate action — press and hold. The fill shows the hold;
 * letting go early cancels and says how it works. Never fires from a brush or a
 * thumb sliding off a jet button.
 */
function HoldButton({ label, sub, hintText, onFire, testId, disabled = false }) {
  const [p, setP] = useState(0);
  const [hint, setHint] = useState(false);
  const raf = useRef(0);
  const t0 = useRef(0);
  const fired = useRef(false);
  const stop = () => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
  };
  useEffect(() => stop, []);
  const down = (e) => {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    fired.current = false;
    t0.current = performance.now();
    const tick = () => {
      const u = Math.min(1, (performance.now() - t0.current) / RESTART_HOLD_MS);
      setP(u);
      if (u >= 1) {
        fired.current = true;
        stop();
        setP(0);
        onFire();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    stop();
    raf.current = requestAnimationFrame(tick);
  };
  const up = (e) => {
    e.preventDefault();
    if (!raf.current) return;
    stop();
    setP(0);
    if (!fired.current) {
      setHint(true);
      setTimeout(() => setHint(false), 1600);
    }
  };
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
      className="relative overflow-hidden select-none touch-none min-h-[44px] w-[96px] px-1.5 font-mono text-white bg-black/55 border border-[#f5c451]/70 disabled:opacity-40 flex flex-col items-center justify-center leading-tight"
    >
      <span className="absolute inset-y-0 left-0 bg-[#f5c451]/35" style={{ width: `${p * 100}%` }} aria-hidden />
      <span className="relative text-[9px] tracking-[0.14em] text-[#f5c451]">↺ {label.split(" ")[0]}</span>
      <span className="relative text-[9px] tracking-[0.14em]">{label.split(" ").slice(1).join(" ")}</span>
      <span className="relative text-[6.5px] tracking-[0.18em] text-zinc-400 mt-0.5" data-testid={`${testId}-sub`}>
        {hint ? hintText : sub}
      </span>
    </button>
  );
}

const SEV = { safety: "#FF3B00", correct: "#f5c451", wait: "#9fb6cc", info: "#9fb6cc", go: "#4fd1c5", ok: "#4fd1c5" };
/** The live DOCKING GUIDANCE panel: step, the one correction, how, and the numbers behind it. */
function GuidancePanel({ g, text, lang, on, onToggle, clearAlign = false }) {
  const ui = GUI[lang] || GUI.en;
  // between the pad (left) and the FWD/AFT column (right); clear of CADET's AUTO ALIGN button too
  const right = clearAlign ? "right-[calc(var(--sar,0px)_+_132px)] short:right-[calc(var(--sar,0px)_+_124px)]" : "right-[calc(var(--sar,0px)_+_92px)] short:right-[calc(var(--sar,0px)_+_84px)]";
  const place = `absolute z-30 bottom-3 short:bottom-2 safe-mb left-[calc(var(--sal,0px)_+_196px)] short:left-[calc(var(--sal,0px)_+_172px)] ${right} flex justify-center pointer-events-none`;
  if (!on || !g || !text) {
    return (
      <div className={place}>
        <button type="button" data-testid="dock-guidance-toggle" onClick={onToggle} className="pointer-events-auto min-h-[34px] px-3 font-mono text-[8px] tracking-[0.25em] text-zinc-400 bg-black/50 border border-white/20">
          {ui.off}
        </button>
      </div>
    );
  }
  const color = g.confirm ? SEV.ok : SEV[g.sev] || SEV.info;
  return (
    <div className={place}>
      <div
        className="pointer-events-auto w-full max-w-[440px] bg-black/65 backdrop-blur-sm border border-white/10 border-l-2 px-2.5 py-1.5 short:py-1 font-mono"
        style={{ borderLeftColor: color }}
        data-testid="dock-guidance"
        data-key={g.key}
        data-step={g.step}
        data-sev={g.sev}
        data-confirm={g.confirm || ""}
        data-buttons={(g.buttons || []).join(",")}
      >
        <div className="flex items-center gap-2">
          <div className="text-[8px] tracking-[0.28em] whitespace-nowrap" style={{ color }} data-testid="dock-guidance-step">
            {ui.header} — {ui.step} {g.step}/5
          </div>
          <div className="flex gap-0.5 flex-1 min-w-0" aria-hidden>
            {STEPS.map((_, i) => (
              <span key={i} className="h-[3px] flex-1" style={{ background: i < g.step ? color : "rgba(255,255,255,0.15)" }} />
            ))}
          </div>
          <button type="button" data-testid="dock-guidance-toggle" onClick={onToggle} className="shrink-0 min-h-[26px] px-1.5 text-[7px] tracking-[0.2em] text-zinc-400 border border-white/15 bg-black/40">
            {ui.on}
          </button>
        </div>
        <div className="text-[7.5px] tracking-[0.22em] text-zinc-500 truncate">{text.stepName}</div>
        <div className="text-white text-[12px] short:text-[11px] font-bold tracking-[0.05em] leading-tight mt-0.5" data-testid="dock-guidance-title">
          {g.confirm ? `✓ ${text.confirm}` : text.title}
        </div>
        {!g.confirm && text.detail && (
          <div className="text-zinc-300 text-[9.5px] short:text-[9px] leading-snug mt-0.5" data-testid="dock-guidance-detail">
            {text.detail}
          </div>
        )}
        {!g.confirm && (text.control || text.support) && (
          <div className="flex flex-wrap items-baseline gap-x-2 mt-0.5">
            {text.control && (
              <span className="text-[10px] text-[#4fd1c5] tracking-[0.06em]" data-testid="dock-guidance-control">
                ▸ {text.control}
              </span>
            )}
            {text.support && (
              <span className="text-[8px] text-zinc-500 tracking-[0.1em] tabular" data-testid="dock-guidance-support">
                {text.support}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const GUIDE_KEY = "lunavia.dockGuidance";
function loadGuidanceOn(difficulty) {
  try {
    const v = JSON.parse(window.localStorage.getItem(GUIDE_KEY) || "{}")[difficulty];
    return v == null ? true : !!v;
  } catch (e) {
    return true;
  }
}
function saveGuidanceOn(difficulty, on) {
  try {
    const all = JSON.parse(window.localStorage.getItem(GUIDE_KEY) || "{}");
    all[difficulty] = on;
    window.localStorage.setItem(GUIDE_KEY, JSON.stringify(all));
  } catch (e) {
    /* storage unavailable: the choice lasts for this flight */
  }
}

/* ---- the component -------------------------------------------------------------------------------- */
export default function DockingOps({ difficulty = "ASTRONAUT", farSide = false, audio = null, onComplete, onAbort, onResult }) {
  const cfg = DOCKING[difficulty];
  const lang = useAudioSettings().subLang === "pt" ? "pt" : "en";
  const ui = GUI[lang];
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
  // the docking view: NAV first; a view only moves the camera (data/dockingViews)
  const [view, setViewState] = useState("NAV");
  const viewRef = useRef("NAV");
  const viewSwitches = useRef(0);
  const setView = (v) => {
    if (!VIEWS.includes(v) || v === viewRef.current) return;
    viewRef.current = v;
    viewSwitches.current += 1;
    setViewState(v);
  };
  const orbitRef = useRef(ORBIT_DEFAULT); // the 360° camera: { az, el, dist }
  const extraRef = useRef({}); // what the cockpit's displays show beyond the state (mode, auto align, step)
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
  const restartsRef = useRef(0);
  const startedAtRef = useRef(null);
  const firstStartRef = useRef(null);
  const attemptOpen = useRef(false);
  const contactsRef = useRef(0);
  // the guidance: one tracker per attempt (reset on restart), shown or hidden by the player
  const guidanceRef = useRef(createGuidance(difficulty));
  const lastGuideKey = useRef(null);
  const [guideOn, setGuideOnState] = useState(() => loadGuidanceOn(difficulty));
  const guideOnRef = useRef(guideOn);
  const setGuideOn = (on) => {
    guideOnRef.current = on;
    setGuideOnState(on);
    saveGuidanceOn(difficulty, on);
  };
  const keyboard = useMemo(() => typeof window !== "undefined" && !!window.matchMedia && !window.matchMedia("(pointer: coarse)").matches, []);
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

  // keyboard (desktop): translation and attitude at once, from the same table as the pad
  // (data/dockingGuidance CONTROLS). Keys still down when a restart happens are ignored
  // until released, so no jet carries over into the new attempt.
  const keysDown = useRef(new Set());
  const keysBlocked = useRef(new Set());
  useEffect(() => {
    const MAP = {};
    Object.values(CONTROLS).forEach((c) => (MAP[c.key] = [c.axis, c.i, c.v]));
    const VIEW_KEYS = { Digit1: "NAV", Digit2: "WINDOW", Digit3: "COCKPIT", Digit4: "ORBIT" };
    const dn = (e) => {
      if (VIEW_KEYS[e.code] && (phaseRef.current === "docking" || phaseRef.current === "captured")) {
        setView(VIEW_KEYS[e.code]);
        return;
      }
      const m = MAP[e.code];
      if (!m) return;
      keysDown.current.add(e.code);
      if (phaseRef.current !== "docking") return;
      e.preventDefault();
      if (keysBlocked.current.has(e.code)) return;
      if (!held.current.has("k" + e.code) || !held.current.get("k" + e.code).down) press("k" + e.code, ...m);
    };
    const upk = (e) => {
      keysDown.current.delete(e.code);
      keysBlocked.current.delete(e.code);
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
    // the docking calls follow the pilot's difficulty (coaching for CADET and ASTRONAUT)
    if (audio && audio.setVerbosity) audio.setVerbosity(VERBOSITY[difficulty] || "full");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [difficulty]);
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

  /**
   * The final-approach checkpoint, for the first attempt and every restart: the whole
   * simulation state rebuilt in place (position, velocity, attitude, rates, clock, RCS
   * refilled, contacts, capture and failure state), no jet held, no key carried over,
   * the guidance starting afresh.
   */
  const startDocking = () => {
    const s = simRef.current;
    restoreCheckpoint(s, difficulty);
    s.mode = "docking";
    held.current.clear();
    keysBlocked.current = new Set(keysDown.current);
    guidanceRef.current.reset();
    lastGuideKey.current = null;
    attemptOpen.current = true;
    if (!firstStartRef.current) firstStartRef.current = performance.now();
    startedAtRef.current = performance.now();
    pausedRef.current = false;
    setPaused(false);
    setToast(null);
    setFailure(null);
    setPhase("docking");
  };
  // an attempt ends (failure or restart): its contacts go into the flight's totals once
  const closeAttempt = () => {
    if (!attemptOpen.current) return;
    attemptOpen.current = false;
    contactsRef.current += simRef.current.contacts || 0;
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
        closeAttempt();
        const now = performance.now();
        const result = {
          success: true,
          attempts: attemptsRef.current,
          restarts: restartsRef.current,
          contacts: contactsRef.current,
          propLeft: +s.prop.toFixed(2),
          time: +((now - (firstStartRef.current || now)) / 1000).toFixed(1),
          attemptTime: +((now - (startedAtRef.current || now)) / 1000).toFixed(1),
          // the capture judgement's own facts (judgeContact) and this attempt's bounced contacts (mission scoring)
          capture: s.lastContact && s.lastContact.kind === "capture" ? { ...s.lastContact.facts } : null,
          attemptContacts: s.contacts || 0,
        };
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
        closeAttempt();
        setFailure(e);
        setPhase("failed");
        onResult && onResult({ success: false, failure: e.kind, attempts: attemptsRef.current, restarts: restartsRef.current, contacts: contactsRef.current });
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
      const ph = phaseRef.current;
      const st = ph === "docking" ? dockingStatus(s, difficulty) : null;
      // the guidance reads the same state (it never writes it)
      let g = null;
      if ((ph === "docking" || ph === "captured") && s.mode === "docking") {
        g = guidanceRef.current.update(s, { mode: modeRef.current, align: alignRef.current });
        if (g.key !== lastGuideKey.current) {
          lastGuideKey.current = g.key;
          const line = GUIDANCE_VOICE[g.key];
          const key = g.key;
          if (line && guideOnRef.current && ph === "docking") say(line, { relevant: () => lastGuideKey.current === key && guideOnRef.current });
        }
      }
      extraRef.current = { mode: modeRef.current, align: alignRef.current, step: g && g.step };
      setHud({ tel, st, g, status: s.status, m: { ...markRef.current }, size: { ...sizeRef.current }, missionT: s.missionT || 0 });
      if (typeof window !== "undefined") {
        window.__lvDock = {
          phase: ph,
          status: s.status,
          difficulty,
          tel,
          st,
          contacts: s.contacts,
          prop: s.prop,
          attempts: attemptsRef.current,
          restarts: restartsRef.current,
          view: viewRef.current,
          mode: modeRef.current,
          align: alignRef.current,
          pos: s.pos.slice(),
          vel: s.vel.slice(),
          w: s.w.slice(),
          t: s.t,
          q: s.q.slice(),
          fired: s.fired ? { t: s.fired.t.slice(), r: s.fired.r.slice() } : null,
          guidance: g && { key: g.key, step: g.step, sev: g.sev, buttons: g.buttons, mode: g.mode, needMode: g.needMode, confirm: g.confirm },
          guidanceOn: guideOnRef.current,
          viewSwitches: viewSwitches.current,
          orbit: { ...orbitRef.current },
        };
        window.__lvDockState = s; // validation tooling (read-only)
      }
      // the closing-rate warning, said once per breach
      if (st && st.warnings.includes("REDUCE CLOSING VELOCITY")) say("dock.closing");
    }, 100);
    if (typeof window !== "undefined") window.__lvDockingTools = { referencePilot, telemetry, guidedPilot, checkpointState };
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [difficulty]);

  /**
   * RESTART DOCKING: during the approach (not once the probe has captured), from the
   * pause screen, or after a failed attempt. Only the docking restarts — never the
   * rendezvous, the ascent or the landing. Each restart is a new attempt in the log.
   */
  const restartDocking = () => {
    const ph = phaseRef.current;
    const s = simRef.current;
    if (!(ph === "failed" || (ph === "docking" && s.status === "approach"))) return false;
    const fromFailure = ph === "failed";
    closeAttempt();
    restartsRef.current += 1;
    if (!fromFailure) onResult && onResult({ success: false, failure: "restart", attempts: attemptsRef.current, restarts: restartsRef.current, contacts: contactsRef.current });
    attemptsRef.current += 1;
    if (audio && audio.commsFlush) audio.commsFlush(); // nothing queued from the last attempt
    say("dock.g.restart", { delay: 0.4 });
    startDocking();
    return true;
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

  /* -- control pad (TRANSLATION / ATTITUDE), built from the guidance's own control table -- */
  const g = hud && hud.g;
  // the guidance lights the button it names (CADET and ASTRONAUT), or MODE first when needed
  const lit = guideOn && g && !g.confirm && difficulty !== "COMMANDER" && phase === "docking" ? g.buttons : [];
  const litMode = guideOn && g && !g.confirm && g.needMode && difficulty !== "COMMANDER" && phase === "docking";
  const pad = (name, cls) => {
    const c = CONTROLS[name];
    const [icon, ...rest] = c.label.split(" ");
    return (
      <JetButton
        key={name}
        testId={`dock-${name}`}
        label={icon}
        sub={rest.join(" ")}
        className={cls}
        hint={!litMode && lit.includes(name)}
        onDown={() => press(name, c.axis, c.i, c.v)}
        onUp={() => release(name)}
      />
    );
  };
  const tMode = mode === "TRANSLATION";
  const controls = (
    <div className="absolute inset-x-0 bottom-0 z-30 pointer-events-none flex items-end justify-between px-4 pb-4 short:px-3 short:pb-2 safe-ml safe-mr safe-mb" data-testid="dock-controls">
      {/* left: the cross pad */}
      <div className="pointer-events-auto grid grid-cols-3 gap-1.5" data-testid="dock-pad">
        <span />
        {tMode ? pad("up") : pad("pitch-up")}
        <span />
        {tMode ? pad("left") : pad("yaw-left")}
        <button
          type="button"
          data-testid="dock-mode"
          onClick={() => {
            const m = tMode ? "ATTITUDE" : "TRANSLATION";
            modeRef.current = m;
            setMode(m);
            held.current.clear();
          }}
          data-hint={litMode ? "1" : undefined}
          className={`w-[52px] h-[52px] short:w-[46px] short:h-[46px] font-mono text-[7px] tracking-[0.12em] border ${tMode ? "border-[#4fd1c5]/70 text-[#4fd1c5]" : "border-[#f5c451]/70 text-[#f5c451]"} bg-black/60 touch-manipulation ${litMode ? HINT_RING : ""}`}
        >
          {tMode ? "TRANS" : "ATT"}
          <br />
          MODE
        </button>
        {tMode ? pad("right") : pad("yaw-right")}
        <span />
        {tMode ? pad("down") : pad("pitch-down")}
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
        {tMode ? pad("fwd", "!w-[60px]") : pad("roll-left", "!w-[60px]")}
        {tMode ? pad("aft", "!w-[60px]") : pad("roll-right", "!w-[60px]")}
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
          <WindowFrame simRef={simRef} viewRef={viewRef} phaseRef={phaseRef} />
          <Cockpit simRef={simRef} viewRef={viewRef} phaseRef={phaseRef} difficulty={difficulty} extraRef={extraRef} />
          <CabinLight simRef={simRef} viewRef={viewRef} phaseRef={phaseRef} />
          <Director simRef={simRef} viewRef={viewRef} phaseRef={phaseRef} markRef={markRef} sizeRef={sizeRef} clockRef={clockRef} orbitRef={orbitRef} />
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
          {/* 360°: the gesture layer (under the HUD and the controls: it only gets the touches they do not) */}
          {view === "ORBIT" && <OrbitPad orbitRef={orbitRef} />}
          {(view === "NAV" || view === "ORBIT") && (
          <div className="absolute top-14 short:top-[var(--hud-top)] left-4 md:left-8 safe-ml z-30 pointer-events-none bg-black/55 backdrop-blur-sm border border-white/10 px-3 py-2 short:px-2 short:py-1.5 font-mono tabular w-[188px] short:w-[172px]" data-testid="dock-hud">
            <div className="text-[8px] tracking-[0.35em] text-[#FF3B00]">● DOCKING · {difficulty}</div>
            <div className="text-white text-[10px] short:text-[9px] tracking-[0.12em] mt-0.5 truncate" data-testid="dock-status">{phase === "captured" ? "DOCKING CONTACT · CAPTURE" : st ? st.phase : ""}</div>
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
          )}

          {/* WINDOW: a compact readout, so nothing big stands between the window and the target */}
          {view === "WINDOW" && (
            <div className="absolute top-14 short:top-[var(--hud-top)] left-4 md:left-8 safe-ml z-30 pointer-events-none bg-black/45 backdrop-blur-sm border border-white/10 px-2 py-1 font-mono tabular text-[10px] short:text-[9px] tracking-[0.12em] w-[150px]" data-testid="dock-window-strip">
              <div className="text-[8px] tracking-[0.3em] text-[#4fd1c5]">● WINDOW · {difficulty}</div>
              <div className="flex justify-between text-white">
                <span className="text-zinc-400">RANGE</span>
                <span data-testid="dock-window-range">{tel.axial.toFixed(tel.axial < 10 ? 2 : 1)} m</span>
              </div>
              <div className={`flex justify-between ${warnColor(tel.closing > tel.closingLimit)}`}>
                <span className="text-zinc-400">CLOSING</span>
                <span data-testid="dock-window-closing">{tel.closing.toFixed(3)}</span>
              </div>
              <div className={`flex justify-between ${warnColor(tel.vLatR > cfg.tol.vLat)}`}>
                <span className="text-zinc-400">LATERAL</span>
                <span>{tel.vLatR.toFixed(3)}</span>
              </div>
              {st && st.warnings.length > 0 && (
                <div className="text-[8px] text-[#FF3B00] leading-tight mt-0.5" data-testid="dock-warnings">
                  ▲ {st.warnings[0]}
                </div>
              )}
            </div>
          )}

          {/* Alignment display: offset dot and pointing cross, against the capture tolerance */}
          {(view === "NAV" || view === "ORBIT") && (
          <div className="absolute top-14 short:top-[var(--hud-top)] right-4 md:right-8 safe-mr z-30 pointer-events-none flex flex-col items-end gap-1" data-testid="dock-align-display">
            <div className="relative bg-black/55 border border-white/10" style={{ width: box, height: box }} data-testid="dock-align-box">
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
            {view === "ORBIT" && (
              <button
                type="button"
                data-testid="dock-camera-reset"
                onClick={() => {
                  orbitRef.current = ORBIT_DEFAULT;
                }}
                className="pointer-events-auto mt-1 min-h-[36px] px-2 font-mono text-[8px] tracking-[0.18em] text-white bg-black/60 border border-white/30"
              >
                ⌖ {ui.resetCam}
              </button>
            )}
          </div>
          )}

          {/* COAS: the boresight, the probe tip and the far axis mark (projected from the real geometry) */}
          {view === "NAV" && hud && hud.m.tip && (
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
          {(phase === "docking" || phase === "captured") && <GuidancePanel g={g} text={g && guidanceText(g, difficulty, lang, { keyboard, view })} lang={lang} on={guideOn} onToggle={() => setGuideOn(!guideOn)} clearAlign={!!cfg.autoAlign} />}
          {/* the bar sits a little right of centre: clear of the HUD on the left at 667 pt */}
          <div className="absolute top-14 short:top-[var(--hud-top)] left-[calc(50%_+_24px)] -translate-x-1/2 z-30 flex gap-1.5 items-stretch">
            <button type="button" data-testid="dock-pause" onClick={togglePause} className="min-h-[44px] short:min-h-[40px] px-2 font-mono text-[9px] tracking-[0.18em] text-white bg-black/55 border border-white/25">
              {paused ? "RESUME" : "PAUSE"}
            </button>
            <HoldButton testId="dock-restart" label={ui.restart} sub={ui.hold} hintText={ui.holdHint} onFire={restartDocking} disabled={phase !== "docking"} />
            <button type="button" data-testid="dock-abort" onClick={() => onAbort && onAbort()} className="min-h-[44px] short:min-h-[40px] px-2 font-mono text-[9px] tracking-[0.18em] text-zinc-300 bg-black/55 border border-white/25">
              ABORT
            </button>
          </div>
          {/* the four views: NAV | WINDOW | COCKPIT | 360°, under the top bar */}
          <div className="absolute top-[6.75rem] short:top-[calc(var(--hud-top)_+_50px)] left-[calc(50%_+_24px)] -translate-x-1/2 z-30 flex border border-white/25 bg-black/55" role="tablist" data-testid="dock-views" data-view={view}>
            {VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                data-testid={`dock-view-${v === "ORBIT" ? "360" : v.toLowerCase()}`}
                onClick={() => setView(v)}
                className={`min-h-[36px] px-2.5 font-mono text-[9px] tracking-[0.16em] border-r last:border-r-0 border-white/15 touch-manipulation ${view === v ? "bg-[#4fd1c5]/25 text-[#4fd1c5]" : "text-zinc-300"}`}
              >
                {VIEW_LABEL[v]}
              </button>
            ))}
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
                <div className="mt-4 flex flex-wrap gap-3 justify-center">
                  <button type="button" onClick={togglePause} className="btn-hud btn-hud-primary min-h-[44px]" data-testid="dock-resume">
                    RESUME
                  </button>
                  {phase === "docking" && (
                    <button type="button" onClick={restartDocking} className="btn-hud min-h-[44px]" data-testid="dock-paused-restart">
                      ↺ {ui.restart}
                    </button>
                  )}
                </div>
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
            <div className="font-mono text-[10px] tracking-[0.18em] text-zinc-300 mt-2">
              {lang === "pt" ? "O ESTÁGIO DE ASCENSÃO VOLTA AO PONTO DE APROXIMAÇÃO DO ENCONTRO · RCS REABASTECIDO PARA A TENTATIVA" : "RETRY FROM RENDEZVOUS CHECKPOINT · THE ASCENT STAGE RETURNS TO THE FINAL-APPROACH CHECKPOINT · RCS REFILLED FOR THE ATTEMPT"}
            </div>
            <div className="mt-5 flex flex-wrap gap-3 justify-center">
              <button type="button" onClick={restartDocking} className="btn-hud btn-hud-primary min-h-[44px]" data-testid="dock-retry">
                ↺ {ui.restart}
              </button>
              <button type="button" onClick={() => onAbort && onAbort("failed")} className="btn-hud min-h-[44px]" data-testid="dock-failed-abort">
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
