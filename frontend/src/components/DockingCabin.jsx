import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RCS_THRUSTERS as LM_RCS } from "@/data/lmDesign";
import { ASC_CENTRE_U, DOCKING, telemetry } from "@/data/dockingSim";
import { COCKPIT_WINDOW, WINDOW_OPENING, viewCamera } from "@/data/dockingViews";

/**
 * The ascent stage's cabin, for the WINDOW and COCKPIT docking views
 * (data/dockingViews): real geometry carried in the eye frame of the view's
 * camera (−Z ahead along the docking axis, +Y up), placed every frame on the
 * simulation's own position and attitude, so the cabin turns with the vehicle
 * and the CSM, the Moon and the stars move past its windows.
 *
 *   WindowFrame  WINDOW: the overhead docking window's frame, gasket, bolts
 *                and glass around the commander's eye — no instruments.
 *   Cockpit      COCKPIT: the forward bulkhead with the docking window and
 *                its two flanking panes, window frames, structure, a breaker
 *                console, and four instrument displays drawn from the
 *                simulation's telemetry several times a second.
 *   CabinLight   a dim warm cabin light that follows the eye in both views
 *                (always in the scene, at zero intensity outside them, so
 *                switching views never recompiles shaders).
 */

const DOCKING_PHASES = ["docking", "captured"];
const show = (viewRef, phaseRef, view) => viewRef.current === view && DOCKING_PHASES.includes(phaseRef.current);
const _e = new THREE.Vector3();

/** Which LM RCS jets fire for a body command (translation t, rotation r), as levels 0..1. */
export function rcsLevels(t, r) {
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

/* ---- shapes ------------------------------------------------------------------------------ */
function roundRect(path, x0, y0, x1, y1, r) {
  path.moveTo(x0 + r, y0);
  path.lineTo(x1 - r, y0);
  path.quadraticCurveTo(x1, y0, x1, y0 + r);
  path.lineTo(x1, y1 - r);
  path.quadraticCurveTo(x1, y1, x1 - r, y1);
  path.lineTo(x0 + r, y1);
  path.quadraticCurveTo(x0, y1, x0, y1 - r);
  path.lineTo(x0, y0 + r);
  path.quadraticCurveTo(x0, y0, x0 + r, y0);
  return path;
}
const rectShape = (x0, y0, x1, y1, r = 0) => (r ? roundRect(new THREE.Shape(), x0, y0, x1, y1, r) : new THREE.Shape([new THREE.Vector2(x0, y0), new THREE.Vector2(x1, y0), new THREE.Vector2(x1, y1), new THREE.Vector2(x0, y1)]));
const rectHole = (x0, y0, x1, y1, r = 0) => (r ? roundRect(new THREE.Path(), x0, y0, x1, y1, r) : new THREE.Path([new THREE.Vector2(x0, y0), new THREE.Vector2(x1, y0), new THREE.Vector2(x1, y1), new THREE.Vector2(x0, y1)]));
/** A frame ring around an opening, extruded toward the eye; front face at zFront. */
function frameRing(x0, y0, x1, y1, w, depth, zFront, r = 0.015) {
  const s = rectShape(x0 - w, y0 - w, x1 + w, y1 + w, r + w * 0.5);
  s.holes.push(rectHole(x0, y0, x1, y1, r));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, zFront - depth);
  return g;
}
const flat = (gs) => mergeGeometries(gs.map((g) => (g.index ? g.toNonIndexed() : g)), false);
function boltRing(x0, y0, x1, y1, inset, n) {
  const pts = [];
  const w = x1 - x0;
  const h = y1 - y0;
  const per = 2 * (w + h);
  for (let k = 0; k < n; k++) {
    let d = (k / n) * per;
    let p;
    if (d < w) p = [x0 + d, y0 - inset];
    else if ((d -= w) < h) p = [x1 + inset, y0 + d];
    else if ((d -= h) < w) p = [x1 - d, y1 + inset];
    else p = [x0 - inset, y1 - (d - w)];
    pts.push(p);
  }
  return pts;
}

/* ---- glass: a faint tint and a soft sheen, never in the way --------------------------------- */
let GLASS_TEX = null;
function glassTexture() {
  if (GLASS_TEX) return GLASS_TEX;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const gr = g.createLinearGradient(0, 0, 128, 128);
  gr.addColorStop(0, "rgba(160,200,255,0.10)");
  gr.addColorStop(0.42, "rgba(160,200,255,0.02)");
  gr.addColorStop(0.5, "rgba(220,235,255,0.16)");
  gr.addColorStop(0.58, "rgba(160,200,255,0.02)");
  gr.addColorStop(1, "rgba(160,200,255,0.07)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  GLASS_TEX = new THREE.CanvasTexture(c);
  GLASS_TEX.colorSpace = THREE.SRGBColorSpace;
  return GLASS_TEX;
}
function useGlassMaterial() {
  return useMemo(() => new THREE.MeshBasicMaterial({ map: glassTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), []);
}

/* ---- WINDOW: the overhead docking window, seen from the commander's eye ------------------------ */
const WIN = WINDOW_OPENING;
export function WindowFrame({ simRef, viewRef, phaseRef }) {
  const grp = useRef();
  const glass = useGlassMaterial();
  const { bulk, frame, gasket, bolts } = useMemo(() => {
    // the cabin ceiling around the window (fills the view outside the opening)
    const s = rectShape(-1.6, -1.1, 1.6, 1.1);
    s.holes.push(rectHole(WIN.x0 - 0.03, WIN.y0 - 0.03, WIN.x1 + 0.03, WIN.y1 + 0.03, 0.05));
    const bulkG = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false, curveSegments: 8 });
    bulkG.translate(0, 0, WIN.z - 0.07);
    const frameG = frameRing(WIN.x0, WIN.y0, WIN.x1, WIN.y1, 0.034, 0.05, WIN.z, 0.04);
    const gs = rectShape(WIN.x0 - 0.002, WIN.y0 - 0.002, WIN.x1 + 0.002, WIN.y1 + 0.002, 0.04);
    gs.holes.push(rectHole(WIN.x0 + 0.008, WIN.y0 + 0.008, WIN.x1 - 0.008, WIN.y1 - 0.008, 0.034));
    const gasketG = new THREE.ShapeGeometry(gs, 8);
    gasketG.translate(0, 0, WIN.z - 0.012);
    return { bulk: bulkG, frame: frameG, gasket: gasketG, bolts: boltRing(WIN.x0, WIN.y0, WIN.x1, WIN.y1, 0.017, 18) };
  }, []);
  const boltMesh = useRef();
  useEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    bolts.forEach(([x, y], i) => {
      m.compose(new THREE.Vector3(x, y, WIN.z + 0.004), q, new THREE.Vector3(1, 1, 1));
      boltMesh.current.setMatrixAt(i, m);
    });
    boltMesh.current.instanceMatrix.needsUpdate = true;
  }, [bolts]);
  useFrame(() => {
    const s = simRef.current;
    if (!grp.current || !s) return;
    const on = show(viewRef, phaseRef, "WINDOW");
    grp.current.visible = on;
    if (!on) return;
    const cam = viewCamera("WINDOW", s);
    grp.current.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
    grp.current.quaternion.set(cam.q[0], cam.q[1], cam.q[2], cam.q[3]);
  });
  return (
    <group ref={grp} visible={false} name="window-frame">
      <mesh geometry={bulk}>
        <meshStandardMaterial color="#2b2e33" roughness={0.9} metalness={0.1} />
      </mesh>
      <mesh geometry={frame}>
        <meshStandardMaterial color="#5c6168" roughness={0.42} metalness={0.65} />
      </mesh>
      <mesh geometry={gasket}>
        <meshStandardMaterial color="#0b0b0c" roughness={0.95} />
      </mesh>
      <instancedMesh ref={boltMesh} args={[null, null, bolts.length]}>
        <cylinderGeometry args={[0.0055, 0.0055, 0.008, 8]} />
        <meshStandardMaterial color="#8a8f96" roughness={0.35} metalness={0.8} />
      </instancedMesh>
      <mesh position={[0, 0, WIN.z - 0.018]} material={glass}>
        <planeGeometry args={[WIN.x1 - WIN.x0, WIN.y1 - WIN.y0]} />
      </mesh>
    </group>
  );
}

/* ---- COCKPIT: the cabin, its windows and the docking instruments ------------------------------------ */
const CW = COCKPIT_WINDOW; // main docking window opening, eye frame (m)
const SIDE = [
  { x0: -0.345, x1: -0.235, y0: -0.06, y1: 0.2 },
  { x0: 0.235, x1: 0.345, y0: -0.06, y1: 0.2 },
];
const ZB = CW.z; // the forward bulkhead's face
// the four displays: left (range & rate, lateral & attitude), right (alignment, RCS & status)
export const DISPLAYS = [
  { key: "range", x: -0.5, y: 0.19 },
  { key: "lateral", x: -0.5, y: 0.025 },
  { key: "align", x: 0.5, y: 0.19 },
  { key: "rcs", x: 0.5, y: 0.025 },
];
const DW = 0.26;
const DH = 0.16;
const CAN_W = 384;
const CAN_H = 236;

function buildCockpit() {
  // forward bulkhead with the docking window and two flanking panes
  const s = rectShape(-0.95, -0.8, 0.95, 0.75);
  s.holes.push(rectHole(CW.x0, CW.y0, CW.x1, CW.y1, 0.02));
  SIDE.forEach((w) => s.holes.push(rectHole(w.x0, w.y0, w.x1, w.y1, 0.012)));
  const bulkhead = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: false, curveSegments: 4 });
  bulkhead.translate(0, 0, ZB - 0.05);
  // metal: window frames, display bezels, the overhead beam and grab handle, the console
  const metal = [frameRing(CW.x0, CW.y0, CW.x1, CW.y1, 0.026, 0.035, ZB + 0.035, 0.02), ...SIDE.map((w) => frameRing(w.x0, w.y0, w.x1, w.y1, 0.018, 0.028, ZB + 0.028, 0.012))];
  DISPLAYS.forEach((d) => {
    const b = new THREE.BoxGeometry(DW + 0.03, DH + 0.03, 0.025);
    b.translate(d.x, d.y, ZB + 0.0125);
    metal.push(b);
  });
  const beam = new THREE.BoxGeometry(1.7, 0.07, 0.34);
  beam.translate(0, 0.5, ZB + 0.17);
  metal.push(beam);
  const handle = [new THREE.BoxGeometry(0.2, 0.018, 0.018), new THREE.BoxGeometry(0.018, 0.018, 0.06), new THREE.BoxGeometry(0.018, 0.018, 0.06)];
  handle[0].translate(0, 0.34, ZB + 0.06);
  handle[1].translate(-0.1, 0.34, ZB + 0.03);
  handle[2].translate(0.1, 0.34, ZB + 0.03);
  metal.push(...handle);
  const console_ = new THREE.BoxGeometry(0.62, 0.26, 0.16);
  console_.rotateX(-0.5);
  console_.translate(0, -0.36, ZB + 0.08);
  metal.push(console_);
  // side walls and ceiling (the cabin's shell beyond the bulkhead's edges)
  const shell = [];
  const wallL = new THREE.PlaneGeometry(0.9, 1.6);
  wallL.rotateY(Math.PI / 2);
  wallL.translate(-0.95, 0, ZB + 0.45);
  const wallR = wallL.clone();
  wallR.rotateY(Math.PI);
  wallR.translate(0, 0, 2 * (ZB + 0.45));
  const ceil = new THREE.PlaneGeometry(1.9, 0.9);
  ceil.rotateX(Math.PI / 2);
  ceil.translate(0, 0.75, ZB + 0.45);
  shell.push(wallL, wallR, ceil);
  // a cable bundle along the upper left
  const cable = new THREE.CylinderGeometry(0.016, 0.016, 0.9, 8);
  cable.rotateZ(Math.PI / 2 + 0.12);
  cable.translate(-0.25, 0.42, ZB + 0.04);
  const glassG = flat([CW, ...SIDE].map((w) => {
    const p = new THREE.PlaneGeometry(w.x1 - w.x0, w.y1 - w.y0);
    p.translate((w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2, ZB - 0.02);
    return p;
  }));
  // breaker knobs and indicator lights on the console and beside the panes
  const knobs = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) knobs.push([-0.24 + c * 0.06, -0.27 - r * 0.045, ZB + 0.17 - r * 0.02]);
  const lamps = [];
  [-0.29, 0.29].forEach((x) => [-0.085, -0.105].forEach((y) => lamps.push([x, y, ZB + 0.008])));
  [-0.36, -0.33, 0.33, 0.36].forEach((x) => lamps.push([x, 0.235, ZB + 0.008]));
  return { bulkhead, metal: flat(metal), shell: flat(shell), cable, glass: glassG, knobs, lamps };
}

/* the displays' drawing (canvas), from the simulation's telemetry */
const C_BG = "#05080b";
const C_LAB = "#6f97a3";
const C_VAL = "#e9f5f1";
const C_WARN = "#ff4a1a";
const C_OK = "#4fd1c5";
const C_YEL = "#f5c451";
function frameDisplay(g, title) {
  g.fillStyle = C_BG;
  g.fillRect(0, 0, CAN_W, CAN_H);
  g.strokeStyle = "#1d3036";
  g.lineWidth = 4;
  g.strokeRect(3, 3, CAN_W - 6, CAN_H - 6);
  g.fillStyle = C_LAB;
  g.font = "bold 24px monospace";
  g.textBaseline = "top";
  g.fillText(title, 16, 12);
}
const sgn = (v, d = 3) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(d);
const deg = (r) => (r * 180) / Math.PI;
export function drawDisplay(g, key, s, difficulty, extra = {}) {
  const cfg = DOCKING[difficulty];
  const m = telemetry(s, difficulty);
  if (typeof window !== "undefined" && key === "range") {
    // validation tooling: what the instruments read, from the same telemetry
    window.__lvCockpitShows = { t: s.t, range: +m.axial.toFixed(m.axial < 10 ? 2 : 1), closing: +m.closing.toFixed(3), propPct: Math.round(m.propFrac * 100), offsetR: +m.offsetR.toFixed(2) };
  }
  if (key === "range") {
    frameDisplay(g, "RANGE · RATE");
    g.fillStyle = C_VAL;
    g.font = "bold 62px monospace";
    g.fillText(`${m.axial.toFixed(m.axial < 10 ? 2 : 1)} m`, 16, 44);
    const hot = m.closing > m.closingLimit;
    g.fillStyle = hot ? C_WARN : C_VAL;
    g.font = "bold 46px monospace";
    g.fillText(`${sgn(m.closing)}`, 16, 122);
    g.fillStyle = C_LAB;
    g.font = "bold 22px monospace";
    g.fillText("m/s CLOSING", 210, 140);
    g.fillText(`LIMIT ${m.closingLimit.toFixed(2)} m/s`, 16, 188);
  } else if (key === "lateral") {
    frameDisplay(g, "LATERAL · ATTITUDE");
    g.font = "bold 34px monospace";
    const row = (y, lab, val, bad) => {
      g.fillStyle = C_LAB;
      g.font = "bold 24px monospace";
      g.fillText(lab, 16, y + 6);
      g.fillStyle = bad ? C_WARN : C_VAL;
      g.font = `bold ${val.length > 10 ? 26 : 34}px monospace`;
      g.fillText(val, 150, y + (val.length > 10 ? 5 : 0));
    };
    row(46, "R/L m/s", sgn(m.vLat[0]), Math.abs(m.vLat[0]) > cfg.tol.vLat);
    row(90, "U/D m/s", sgn(m.vLat[1]), Math.abs(m.vLat[1]) > cfg.tol.vLat);
    row(134, "P/Y/R °", `${deg(m.pitch).toFixed(1)}/${deg(m.yaw).toFixed(1)}/${deg(m.roll).toFixed(1)}`, m.angle > cfg.tol.angle);
    row(178, "RATE °/s", deg(m.rate).toFixed(2), m.rate > cfg.tol.rate);
  } else if (key === "align") {
    frameDisplay(g, "ALIGNMENT");
    const cx = 112;
    const cy = 136;
    const R = 86;
    g.strokeStyle = "#2a4048";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx - R, cy);
    g.lineTo(cx + R, cy);
    g.moveTo(cx, cy - R);
    g.lineTo(cx, cy + R);
    g.stroke();
    g.strokeStyle = C_OK;
    g.globalAlpha = 0.7;
    g.beginPath();
    g.arc(cx, cy, Math.max(4, cfg.tol.lateral * R), 0, Math.PI * 2); // the capture tolerance (±1 m full scale)
    g.stroke();
    g.globalAlpha = 1;
    // port offset (dot, ±1 m) and pointing error (cross, ±10°)
    const ox = Math.max(-1, Math.min(1, m.offset[0])) * R;
    const oy = -Math.max(-1, Math.min(1, m.offset[1])) * R;
    g.fillStyle = m.offsetR < cfg.tol.lateral ? C_OK : C_WARN;
    g.beginPath();
    g.arc(cx + ox, cy + oy, 9, 0, Math.PI * 2);
    g.fill();
    const ax = Math.max(-1, Math.min(1, -deg(m.yaw) / 10)) * R;
    const ay = -Math.max(-1, Math.min(1, deg(m.pitch) / 10)) * R;
    g.strokeStyle = C_YEL;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(cx + ax - 12, cy + ay);
    g.lineTo(cx + ax + 12, cy + ay);
    g.moveTo(cx + ax, cy + ay - 12);
    g.lineTo(cx + ax, cy + ay + 12);
    g.stroke();
    const inCorr = m.offsetR < cfg.tol.lateral && m.angle < cfg.tol.angle && m.closing <= m.closingLimit && m.vLatR < cfg.tol.vLat;
    g.font = "bold 26px monospace";
    g.fillStyle = inCorr ? C_OK : C_LAB;
    g.fillText(inCorr ? "IN" : "OUT", 228, 70);
    g.fillText("CORRIDOR", 228, 100);
    g.fillStyle = C_LAB;
    g.font = "bold 20px monospace";
    g.fillText(`OFS ${m.offsetR.toFixed(2)} m`, 228, 150);
    g.fillText(`ANG ${deg(m.angle).toFixed(1)}°`, 228, 178);
  } else if (key === "rcs") {
    frameDisplay(g, "RCS · STATUS");
    const pct = Math.round(m.propFrac * 100);
    g.fillStyle = "#13242a";
    g.fillRect(16, 46, 220, 30);
    g.fillStyle = m.propFrac < 0.15 ? C_WARN : C_OK;
    g.fillRect(16, 46, 2.2 * pct, 30);
    g.fillStyle = C_VAL;
    g.font = "bold 30px monospace";
    g.fillText(`${pct}%`, 250, 46);
    // the 16 jets: lit while firing
    const lv = rcsLevels((s.fired || {}).t || [0, 0, 0], (s.fired || {}).r || [0, 0, 0]);
    lv.forEach((v, i) => {
      g.fillStyle = v > 0.05 ? C_YEL : "#1b2b30";
      g.fillRect(16 + (i % 8) * 44, 92 + Math.floor(i / 8) * 30, 34, 22);
    });
    g.font = "bold 24px monospace";
    g.fillStyle = C_LAB;
    g.fillText(`MODE ${extra.mode === "ATTITUDE" ? "ATT" : "TRANS"}${cfg.autoAlign ? (extra.align ? " · ALIGN ON" : " · ALIGN OFF") : ""}`, 16, 160);
    const st = s.status === "docked" ? ["HARD DOCK", C_OK] : s.status === "captured" ? ["CAPTURE", C_OK] : s.lastContact && s.t - s.lastContact.t < 3 ? ["CONTACT", C_YEL] : extra.step ? [`GUIDANCE STEP ${extra.step}/5`, C_LAB] : ["APPROACH", C_LAB];
    g.fillStyle = st[1];
    g.fillText(st[0], 16, 196);
  }
}

export function Cockpit({ simRef, viewRef, phaseRef, difficulty, extraRef }) {
  const grp = useRef();
  const glass = useGlassMaterial();
  const parts = useMemo(() => buildCockpit(), []);
  const screens = useMemo(
    () =>
      DISPLAYS.map((d) => {
        const c = document.createElement("canvas");
        c.width = CAN_W;
        c.height = CAN_H;
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        return { ...d, canvas: c, g: c.getContext("2d"), tex, mat: new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }) };
      }),
    []
  );
  const knobRef = useRef();
  const lampRef = useRef();
  useEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    parts.knobs.forEach((p, i) => {
      m.compose(new THREE.Vector3(...p), q, new THREE.Vector3(1, 1, 1));
      knobRef.current.setMatrixAt(i, m);
    });
    knobRef.current.instanceMatrix.needsUpdate = true;
    parts.lamps.forEach((p, i) => {
      m.compose(new THREE.Vector3(...p), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      lampRef.current.setMatrixAt(i, m);
      lampRef.current.setColorAt(i, new THREE.Color(i % 3 === 0 ? "#ff8a2a" : i % 3 === 1 ? "#4fd1c5" : "#f5c451"));
    });
    lampRef.current.instanceMatrix.needsUpdate = true;
    if (lampRef.current.instanceColor) lampRef.current.instanceColor.needsUpdate = true;
    lampRef.current.material.needsUpdate = true;
  }, [parts]);
  const last = useRef(0);
  useFrame((state) => {
    const s = simRef.current;
    if (!grp.current || !s) return;
    const on = show(viewRef, phaseRef, "COCKPIT");
    grp.current.visible = on;
    if (!on) return;
    const cam = viewCamera("COCKPIT", s);
    grp.current.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
    grp.current.quaternion.set(cam.q[0], cam.q[1], cam.q[2], cam.q[3]);
    // the instruments: redrawn from the telemetry ~8 times a second
    const now = state.clock.elapsedTime;
    if (now - last.current > 0.12) {
      last.current = now;
      const extra = extraRef ? extraRef.current : {};
      screens.forEach((sc) => {
        drawDisplay(sc.g, sc.key, s, difficulty, extra);
        sc.tex.needsUpdate = true;
      });
      if (typeof window !== "undefined") window.__lvCockpitDrawn = (window.__lvCockpitDrawn || 0) + 1; // validation tooling
    }
  });
  return (
    <group ref={grp} visible={false} name="cockpit">
      <mesh geometry={parts.bulkhead}>
        <meshStandardMaterial color="#3a3d43" roughness={0.88} metalness={0.15} />
      </mesh>
      <mesh geometry={parts.metal}>
        <meshStandardMaterial color="#5b6067" roughness={0.45} metalness={0.6} />
      </mesh>
      <mesh geometry={parts.shell}>
        <meshStandardMaterial color="#25272b" roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={parts.cable}>
        <meshStandardMaterial color="#1a1a1c" roughness={0.7} />
      </mesh>
      <mesh geometry={parts.glass} material={glass} />
      <instancedMesh ref={knobRef} args={[null, null, parts.knobs.length]}>
        <cylinderGeometry args={[0.009, 0.009, 0.02, 8]} />
        <meshStandardMaterial color="#c9ccd1" roughness={0.3} metalness={0.7} />
      </instancedMesh>
      <instancedMesh ref={lampRef} args={[null, null, parts.lamps.length]}>
        <boxGeometry args={[0.018, 0.012, 0.006]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      {screens.map((sc) => (
        <mesh key={sc.key} position={[sc.x, sc.y, ZB + 0.0265]} material={sc.mat} name={`display-${sc.key}`}>
          <planeGeometry args={[DW, DH]} />
        </mesh>
      ))}
    </group>
  );
}

/** A dim warm cabin light at the eye in WINDOW and COCKPIT; zero elsewhere (always present: no shader recompiles). */
export function CabinLight({ simRef, viewRef, phaseRef }) {
  const light = useRef();
  useFrame(() => {
    const s = simRef.current;
    if (!light.current || !s) return;
    const v = viewRef.current;
    const on = (v === "WINDOW" || v === "COCKPIT") && DOCKING_PHASES.includes(phaseRef.current);
    light.current.intensity = on ? (v === "COCKPIT" ? 0.9 : 0.35) : 0;
    if (on) {
      const cam = viewCamera(v, s);
      // a little above and behind the eye
      _e.set(0, 0.12, 0.1).applyQuaternion(new THREE.Quaternion(cam.q[0], cam.q[1], cam.q[2], cam.q[3]));
      light.current.position.set(cam.pos[0] + _e.x, cam.pos[1] + _e.y, cam.pos[2] + _e.z);
    }
  });
  return <pointLight ref={light} color="#ffd8a8" intensity={0} distance={2.2} decay={2} />;
}
