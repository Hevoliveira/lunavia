import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { DOCKING, DOCK_Y, DROGUE_R, PORT_B, PROBE_L, PROBE_TIP, portState } from "@/data/dockingSim";
import { TARGET_RING_R, corridorGeometry, corridorRadius, markerPlacement, markerStyle, occluded, thrustDirection } from "@/data/dockingPorts";
import { WINDOW_OPENING, throughCockpitWindow, throughOpening } from "@/data/dockingViews";
import { PORT_TEXT } from "@/data/dockingPortsText";

/**
 * The two docking interfaces made visible (data/dockingPorts holds the geometry
 * and the tests that tie it to the physics):
 *
 *   TargetPortHardware  on the CSM, in its frame: the docking ring's face, four
 *                       alignment index marks, the probe's capture head, and a thin
 *                       cyan perimeter line while the approach is flown.
 *   ActivePortHardware  on the ascent stage, in its body frame (metres from its
 *                       centre): the drogue's funnel face (its mouth is the physics'
 *                       DROGUE_R: outside it the probe strikes the deck), index marks,
 *                       and an orange perimeter line while the approach is flown.
 *   ApproachCorridor    the corridor attached to the receiving port: the probe's axis,
 *                       a translucent cone (360° only) whose radius is the guidance's
 *                       own lined-up threshold, distance rings at 5/10/20/30 m, the
 *                       capture ring (the lateral capture tolerance) at the probe tip,
 *                       the ascent stage's own docking axis, and (360°) an arrow for the
 *                       translation the guidance is asking for. Cyan inside the
 *                       corridor, amber outside.
 *   PortMarkers         the screen markers (DOM), placed every frame from the real 3D
 *                       ports through the live camera (Director calls placePortMarkers).
 *
 * The hardware is drawn only in the docking scene; the canonical CSM and LM models
 * (data/csmDesign, data/lmDesign) are unchanged, so every other scene is untouched.
 */

export const CYAN = "#4fd1c5";
export const ORANGE = "#FF3B00";
export const AMBER = "#f5c451";
const _tip = new THREE.Vector3(...PROBE_TIP);
const flying = (s, phaseRef) => s && s.mode === "docking" && s.status === "approach" && phaseRef.current === "docking";

/* ---- the drogue's funnel face (a small canvas texture, made once) ---------------------- */
let DROGUE_TEX = null;
function drogueTexture() {
  if (DROGUE_TEX) return DROGUE_TEX;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(128, 128, 6, 128, 128, 128);
  gr.addColorStop(0, "#0d0f11");
  gr.addColorStop(0.1, "#1d2124");
  gr.addColorStop(0.16, "#5b6268");
  gr.addColorStop(0.7, "#aeb4ba");
  gr.addColorStop(0.92, "#d9dde1");
  gr.addColorStop(1, "#f1f3f5");
  g.fillStyle = gr;
  g.beginPath();
  g.arc(128, 128, 128, 0, Math.PI * 2);
  g.fill();
  // the funnel's ribs
  g.strokeStyle = "rgba(40,44,48,0.35)";
  g.lineWidth = 2;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    g.beginPath();
    g.moveTo(128 + Math.cos(a) * 22, 128 + Math.sin(a) * 22);
    g.lineTo(128 + Math.cos(a) * 120, 128 + Math.sin(a) * 120);
    g.stroke();
  }
  // the receptacle at the apex
  g.strokeStyle = "#e9edf0";
  g.lineWidth = 3;
  g.beginPath();
  g.arc(128, 128, 16, 0, Math.PI * 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  DROGUE_TEX = t;
  return t;
}

const IndexMarks = ({ radius, y, color, size = [0.05, 0.014, 0.11] }) =>
  [0, 1, 2, 3].map((k) => {
    const a = (k * Math.PI) / 2;
    return (
      <mesh key={k} position={[Math.cos(a) * radius, y, Math.sin(a) * radius]} rotation={[0, -a, 0]}>
        <boxGeometry args={[size[2], size[1], size[0]]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} roughness={0.6} />
      </mesh>
    );
  });

/** The CSM's receiving port (CSM frame). */
export function TargetPortHardware({ simRef, phaseRef }) {
  const glow = useRef();
  useFrame(() => {
    if (glow.current) glow.current.visible = flying(simRef.current, phaseRef);
  });
  return (
    <group name="target-docking-port" position={[0, DOCK_Y, 0]}>
      {/* the docking ring's face: a light anodised annulus on the tunnel's dark ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.042, 0]}>
        <ringGeometry args={[0.29, 0.44, 48]} />
        <meshStandardMaterial color="#d6d9de" metalness={0.5} roughness={0.42} side={THREE.DoubleSide} />
      </mesh>
      <IndexMarks radius={0.365} y={0.05} color={ORANGE} />
      {/* the probe's capture head: a dark latch collar under a bright tip */}
      <mesh position={[0, PROBE_L - 0.2, 0]}>
        <cylinderGeometry args={[0.078, 0.078, 0.06, 16]} />
        <meshStandardMaterial color="#202326" metalness={0.3} roughness={0.6} />
      </mesh>
      <mesh position={[0, PROBE_L - 0.012, 0]}>
        <sphereGeometry args={[0.03, 12, 8]} />
        <meshStandardMaterial color="#f2f5f7" emissive="#9fe9e1" emissiveIntensity={0.35} />
      </mesh>
      {/* the perimeter line, while the approach is flown */}
      <mesh ref={glow} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} visible={false}>
        <torusGeometry args={[TARGET_RING_R + 0.1, 0.009, 6, 48]} />
        <meshBasicMaterial color={CYAN} transparent opacity={0.75} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** The ascent stage's active port (body frame, metres from the stage's centre). */
export function ActivePortHardware({ simRef, phaseRef }) {
  const glow = useRef();
  const tex = useMemo(() => drogueTexture(), []);
  useFrame(() => {
    if (glow.current) glow.current.visible = flying(simRef.current, phaseRef);
  });
  return (
    <group name="active-docking-port" position={PORT_B}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
        <circleGeometry args={[DROGUE_R - 0.035, 40]} />
        <meshStandardMaterial map={tex} metalness={0.35} roughness={0.5} side={THREE.DoubleSide} />
      </mesh>
      <IndexMarks radius={DROGUE_R + 0.01} y={0.03} color={ORANGE} size={[0.04, 0.012, 0.09]} />
      <mesh ref={glow} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} visible={false}>
        <torusGeometry args={[DROGUE_R + 0.09, 0.009, 6, 48]} />
        <meshBasicMaterial color={ORANGE} transparent opacity={0.75} toneMapped={false} />
      </mesh>
    </group>
  );
}

/* ---- the approach corridor ------------------------------------------------------------------ */
function circlePoints(r, n = 64) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  return pts;
}
function labelSprite(text) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 48;
  const g = c.getContext("2d");
  g.font = "bold 30px monospace";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "rgba(0,0,0,0.55)";
  g.fillRect(8, 6, 112, 36);
  g.fillStyle = "#cfeee9";
  g.fillText(text, 64, 25);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false });
}

/**
 * The corridor, attached to the receiving port. `statusRef` holds the approach status
 * (inside / outside), `guideRef` the guidance on display (its buttons, for the arrow).
 */
export function ApproachCorridor({ simRef, viewRef, phaseRef, difficulty, statusRef, guideRef }) {
  const geo = useMemo(() => corridorGeometry(difficulty), [difficulty]);
  const group = useRef();
  const cone = useRef();
  const rings = useRef();
  const capture = useRef();
  const axisLine = useRef();
  const lmAxis = useRef();
  const arrowRef = useRef();
  const coneGeo = useMemo(() => {
    const pts = [];
    for (let d = 0; d <= geo.to[1] - geo.from[1] + 1e-6; d += 1) pts.push(new THREE.Vector2(corridorRadius(d, difficulty), d));
    return new THREE.LatheGeometry(pts, 40);
  }, [geo, difficulty]);
  const coneMat = useMemo(() => new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }), []);
  const ringMat = useMemo(() => new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.5, toneMapped: false }), []);
  const ringGeos = useMemo(() => geo.marks.map((m) => new THREE.BufferGeometry().setFromPoints(circlePoints(m.radius))), [geo]);
  const labels = useMemo(() => geo.marks.map((m) => labelSprite(`${m.axial} m`)), [geo]);
  const axisGeo = useMemo(() => new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...geo.from), new THREE.Vector3(...geo.to)]), [geo]);
  const lmAxisGeo = useMemo(() => new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]), []);
  const arrow = useMemo(() => new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 2.2, AMBER, 0.6, 0.35), []);
  useEffect(() => {
    arrow.line.material.toneMapped = false;
    arrow.cone.material.toneMapped = false;
    return () => {
      coneGeo.dispose();
      ringGeos.forEach((g) => g.dispose());
    };
  }, [arrow, coneGeo, ringGeos]);
  const color = useMemo(() => new THREE.Color(), []);
  const { camera } = useThree();
  const captureMat = useRef();
  useFrame(() => {
    const s = simRef.current;
    if (!group.current) return;
    const on = flying(s, phaseRef);
    group.current.visible = on;
    if (!on) return;
    const v = viewRef.current;
    const st = statusRef.current;
    color.set(st && st.corridor === "outside" ? AMBER : CYAN);
    coneMat.color.copy(color);
    ringMat.color.copy(color);
    // 360°: everything; NAV: the rings and the capture ring (a cone seen from inside would only tint
    // the picture); WINDOW and COCKPIT: the capture ring alone
    cone.current.visible = v === "ORBIT";
    rings.current.visible = v === "ORBIT" || v === "NAV";
    // seen from the ascent stage (NAV), only the rings well ahead of the camera: one at or behind
    // it would sweep across the whole picture
    const camAxial = camera.position.y - PROBE_TIP[1];
    rings.current.children.forEach((r, i) => (r.visible = v === "ORBIT" || geo.marks[i].axial < camAxial - 4));
    // the capture ring thins out as the camera closes on it, so it never covers the port
    if (captureMat.current) {
      const dc = camera.position.distanceTo(_tip);
      captureMat.current.opacity = v === "ORBIT" ? 0.9 : Math.max(0.22, Math.min(0.85, (dc - 0.8) / 5));
    }
    axisLine.current.visible = v === "ORBIT";
    lmAxis.current.visible = v === "ORBIT";
    capture.current.visible = true;
    const { port, axis } = portState(s);
    const pos = lmAxisGeo.attributes.position;
    pos.setXYZ(0, port[0], port[1], port[2]);
    pos.setXYZ(1, port[0] + axis[0] * 12, port[1] + axis[1] * 12, port[2] + axis[2] * 12);
    pos.needsUpdate = true;
    lmAxisGeo.computeBoundingSphere();
    // the translation the guidance asks for, as an arrow on the ascent stage (360° only)
    const g = guideRef.current;
    const dir = v === "ORBIT" && g && !g.confirm ? thrustDirection(s, g.buttons) : null;
    arrowRef.current.visible = !!dir;
    if (dir) {
      arrow.setDirection(new THREE.Vector3(...dir));
      arrow.position.set(s.pos[0] + dir[0] * 2.4, s.pos[1] + dir[1] * 2.4, s.pos[2] + dir[2] * 2.4);
    }
  });
  return (
    <group ref={group} name="approach-corridor" visible={false}>
      <mesh ref={cone} geometry={coneGeo} material={coneMat} position={geo.from} renderOrder={2} />
      <group ref={rings}>
        {geo.marks.map((m, i) => (
          <group key={m.axial} position={m.centre}>
            <line geometry={ringGeos[i]} material={ringMat} />
            {/* the distance, beside the ring on the screen-right side (CSM −X) */}
            <sprite material={labels[i]} position={[-(m.radius + 0.7), 0, 0]} scale={[1.1, 0.41, 1]} />
          </group>
        ))}
      </group>
      <mesh ref={capture} position={geo.capture.centre} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[geo.capture.radius, 0.01, 6, 48]} />
        <meshBasicMaterial ref={captureMat} color={CYAN} transparent opacity={0.9} toneMapped={false} />
      </mesh>
      <line ref={axisLine} geometry={axisGeo}>
        <lineDashedMaterial color={CYAN} transparent opacity={0.55} dashSize={0.6} gapSize={0.4} />
      </line>
      <line ref={lmAxis} geometry={lmAxisGeo}>
        <lineBasicMaterial color={ORANGE} transparent opacity={0.75} />
      </line>
      <primitive ref={arrowRef} object={arrow} visible={false} />
    </group>
  );
}

/* ---- the screen markers --------------------------------------------------------------------- */
/**
 * Where the markers go this frame, for the live camera (called by DockingOps' Director after
 * it has placed the camera). Returns the data PortMarkers draws.
 */
export function placePortMarkers(s, view, camera, size) {
  const cam = { pos: camera.position.toArray(), q: camera.quaternion.toArray(), fov: camera.fov };
  const vp = { w: size.width, h: size.height };
  const tip = PROBE_TIP;
  const first = view !== "ORBIT";
  const inWindow = view === "WINDOW" ? throughOpening(cam, tip, WINDOW_OPENING) : view === "COCKPIT" ? throughCockpitWindow(cam, tip) : true;
  const { port } = portState(s);
  const axial = port[1] - PROBE_TIP[1];
  const target = { ...markerPlacement(cam, tip, { ...vp, ringR: TARGET_RING_R, hidden: occluded(cam.pos, tip, s, { lm: !first }), inWindow }), axial };
  const active = view === "ORBIT" ? { ...markerPlacement(cam, port, { ...vp, ringR: DROGUE_R, hidden: occluded(cam.pos, port, s, { lm: true }) }), axial } : null;
  return { target, active, view, w: vp.w, h: vp.h };
}

function Marker({ apiKey, regRef, color, testId }) {
  const el = useRef();
  const corners = useRef();
  const dashed = useRef();
  const label = useRef();
  const arrow = useRef();
  useEffect(() => {
    regRef.current[apiKey] = { el, corners, dashed, label, arrow };
  }, [apiKey, regRef]);
  const c = (pos) => <span className="absolute w-2.5 h-2.5" style={{ borderColor: color, ...pos }} />;
  return (
    <div ref={el} className="absolute left-0 top-0 pointer-events-none" style={{ display: "none", willChange: "transform" }} data-testid={testId}>
      <div ref={corners} className="absolute" style={{ left: 0, top: 0 }}>
        {c({ left: 0, top: 0, borderLeftWidth: 2, borderTopWidth: 2 })}
        {c({ right: 0, top: 0, borderRightWidth: 2, borderTopWidth: 2 })}
        {c({ left: 0, bottom: 0, borderLeftWidth: 2, borderBottomWidth: 2 })}
        {c({ right: 0, bottom: 0, borderRightWidth: 2, borderBottomWidth: 2 })}
      </div>
      <div ref={dashed} className="absolute border border-dashed" style={{ borderColor: color, opacity: 0.7, display: "none" }} />
      <div ref={arrow} className="absolute text-[16px] leading-none font-mono" style={{ color, display: "none", left: -8, top: -9 }}>
        ➤
      </div>
      <div ref={label} className="absolute whitespace-nowrap font-mono text-[8.5px] short:text-[8px] tracking-[0.16em] px-1 py-px bg-black/55" style={{ color }} />
    </div>
  );
}

/** The two screen markers; `apiRef.current(data)` places them (from Director, every frame). */
export function PortMarkers({ apiRef, lang = "en" }) {
  const reg = useRef({});
  const T = PORT_TEXT[lang] || PORT_TEXT.en;
  useEffect(() => {
    const draw = (key, m, w, h, names) => {
      const r = reg.current[key];
      if (!r || !r.el.current) return;
      const el = r.el.current;
      if (!m) {
        el.style.display = "none";
        el.dataset.state = "none";
        return;
      }
      el.style.display = "block";
      el.dataset.state = m.state;
      el.dataset.x = m.x.toFixed(1);
      el.dataset.y = m.y.toFixed(1);
      // a marker that is not in plain view (off screen, hidden, outside the window) is kept in the
      // clear band between the top bar and the controls, its arrow pointing at the real port
      let px = m.x;
      let py = m.y;
      let ang = m.angle;
      let pinned = m.state === "offscreen";
      if (m.state !== "visible") {
        const cx = Math.max(60, Math.min(w - 60, m.x));
        const cy = Math.max(118, Math.min(h - 150, m.y));
        if (cx !== m.x || cy !== m.y) {
          if (!pinned) ang = Math.atan2(m.y - cy, m.x - cx);
          pinned = true;
        }
        px = cx;
        py = cy;
      }
      el.dataset.px = px.toFixed(1);
      el.dataset.py = py.toFixed(1);
      el.style.transform = `translate(${px}px, ${py}px)`;
      const st = markerStyle(m.r, m.axial);
      const half = st.size / 2;
      const off = pinned;
      r.arrow.current.style.display = off ? "block" : "none";
      if (off) r.arrow.current.style.transform = `rotate(${ang}rad)`;
      r.corners.current.style.display = !off && m.state === "visible" ? "block" : "none";
      r.dashed.current.style.display = !off && m.state !== "visible" ? "block" : "none";
      el.dataset.pinned = off ? "1" : "0";
      for (const b of [r.corners.current, r.dashed.current]) {
        b.style.left = `${-half}px`;
        b.style.top = `${-half}px`;
        b.style.width = `${st.size}px`;
        b.style.height = `${st.size}px`;
      }
      const dist = m.axial > 0 ? ` · ${m.axial.toFixed(m.axial < 10 ? 1 : 0)} m` : "";
      let text = st.level === "far" ? names[0] + dist : names[1] + dist;
      if (m.state === "hidden") text = `${names[1]} · ${T.hidden}`;
      if (m.state === "window") text = `${names[1]} · ${T.outWindow}`;
      if (m.state === "offscreen") text = `${names[1]}${dist}`;
      const showLabel = off || m.state !== "visible" || st.label;
      r.label.current.style.display = showLabel ? "block" : "none";
      r.label.current.textContent = text;
      // the label sits beside the bracket (right of it; left of it near the right edge), clear of the
      // reticle and the port
      const right = px < w - 270; // clear of the right-hand column (alignment, 360° buttons)
      const gap = off ? 14 : half + 5;
      r.label.current.style.top = "-7px";
      r.label.current.style.left = right ? `${gap}px` : `${-gap}px`;
      r.label.current.style.transform = right ? "none" : "translateX(-100%)";
    };
    apiRef.current = (d) => {
      if (!d) {
        draw("target", null);
        draw("active", null);
        return;
      }
      draw("target", d.target, d.w, d.h, [T.target, T.targetShort]);
      draw("active", d.active, d.w, d.h, [T.active, T.activeShort]);
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, T]);
  return (
    <div className="absolute inset-0 z-[21] pointer-events-none overflow-hidden" data-testid="dock-port-markers">
      <Marker apiKey="target" regRef={reg} color={CYAN} testId="dock-target-marker" />
      <Marker apiKey="active" regRef={reg} color={ORANGE} testId="dock-active-marker" />
    </div>
  );
}

/** The capture tolerance of a difficulty (for the NAV legend). */
export const captureTol = (difficulty) => DOCKING[difficulty].tol;
