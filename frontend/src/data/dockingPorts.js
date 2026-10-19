/*
 * LUNAVIA — the two docking ports, and everything the docking displays say
 * about them (pure; unit-tested).
 *
 * Every number here is read from the docking physics (data/dockingSim). Nothing
 * here moves a vehicle or decides a docking: only judgeContact does that.
 *
 * **The two interfaces** (the audit; the physics and the 3D models agree):
 *   TARGET PORT (receiving, on the CSM): the docking ring at the top of the
 *     command module's tunnel, [0, DOCK_Y, 0] in the CSM frame, and the probe
 *     standing PROBE_L = 0.78 m out of it along +Y. The probe tip, PROBE_TIP, is
 *     the first point to touch: contact is judged when it crosses the drogue's
 *     ring plane. The port's axis is the CSM's +Y (the approach comes in from +Y,
 *     behind the CSM along its orbit).
 *   ACTIVE PORT (on the ascent stage, flown by the player): the drogue at the
 *     top of the ascent stage's tunnel, PORT_B = 1.464 m up the body +Y axis from
 *     the stage's centre, mouth radius DROGUE_R = 0.42 m (outside it the probe
 *     strikes the deck). Its axis is the body +Y. Docked, the ascent stage sits
 *     upside down on the probe: its +Y along the CSM's −Y.
 *
 * Frames: the CSM frame of dockingSim (metres; +Y up the probe's axis, +Z away
 * from the Moon). Screen terms, as seen from the docked attitude: right = −X,
 * up = +Z (dockingSim.telemetry).
 */
import { SPS } from "./csmDesign";
import { DOCKING, DOCK_Y, DROGUE_R, HULL_B, PORT_B, PROBE_L, PROBE_TIP, csmRadiusAt, judgeContact, portState, qConj, qRot, telemetry } from "./dockingSim";

const DEG = Math.PI / 180;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---- the ports ---------------------------------------------------------------------- */
// The CSM's docking ring (csmDesign buildCM: the anodised ring around the tunnel's top).
export const TARGET_RING_R = 0.4;
export const TARGET_PORT = { ring: [0, DOCK_Y, 0], tip: PROBE_TIP.slice(), axis: [0, 1, 0], right: [-1, 0, 0], up: [0, 0, 1], ringR: TARGET_RING_R, probeL: PROBE_L };
export const ACTIVE_PORT = { ringB: PORT_B.slice(), axisB: [0, 1, 0], mouthR: DROGUE_R };
// The middle of the CSM stack (probe tip to engine exit): what the port is NOT.
export const CSM_CENTRE = [0, (PROBE_TIP[1] + SPS.exit) / 2, 0];

/** Both ports in the CSM frame now, and the vehicles' centres (for contrast). */
export function portFrames(s) {
  const { port, axis, vPort } = portState(s);
  return {
    target: { ring: TARGET_PORT.ring, tip: TARGET_PORT.tip, axis: TARGET_PORT.axis, ringR: TARGET_RING_R },
    active: { ring: port, axis, v: vPort, mouthR: DROGUE_R },
    centres: { csm: CSM_CENTRE, lm: s.pos.slice() },
  };
}

/* ---- the approach corridor ----------------------------------------------------------- */
/**
 * The approach corridor's radius at an axial distance from the probe tip: the
 * guidance's own "lined up for the approach" test (dockingGuidance evaluate:
 * max(0.6 × the lateral capture tolerance, 0.03 × range)). It narrows to the
 * capture ring as the ports close.
 */
export function corridorRadius(axial, difficulty = "ASTRONAUT") {
  return Math.max(0.6 * DOCKING[difficulty].tol.lateral, 0.03 * Math.max(0, axial));
}
export const CORRIDOR_MARKS = [5, 10, 20, 30]; // distance markers along the axis (m)
export const CORRIDOR_LENGTH = 40;
/**
 * The corridor in space, attached to a port frame (default: the CSM's receiving
 * port): the axis out of the probe tip, a cross-section at each distance marker
 * and the capture ring (the lateral capture tolerance) at the tip.
 */
export function corridorGeometry(difficulty = "ASTRONAUT", frame = TARGET_PORT, length = CORRIDOR_LENGTH) {
  const at = (d) => add(frame.tip, scale(frame.axis, d));
  const sections = [0, ...CORRIDOR_MARKS.filter((d) => d < length), length].map((d) => ({ axial: d, centre: at(d), radius: corridorRadius(d, difficulty) }));
  return {
    from: frame.tip.slice(),
    to: at(length),
    axis: frame.axis.slice(),
    right: frame.right.slice(),
    up: frame.up.slice(),
    sections,
    marks: CORRIDOR_MARKS.filter((d) => d < length).map((d) => ({ axial: d, centre: at(d), radius: corridorRadius(d, difficulty) })),
    capture: { centre: frame.tip.slice(), radius: DOCKING[difficulty].tol.lateral },
  };
}

/* ---- where the ports are, relative to each other -------------------------------------- */
/**
 * The port-to-port picture (the HUD's numbers), from the ports' own frames:
 * distance from the drogue to the probe tip, the drogue's offset from the probe's
 * axis (right / up), the angle between the two docking axes, roll, closing and
 * lateral speed of the drogue. Plus where the drift is taking the drogue.
 */
export function portAlignment(s, difficulty = "ASTRONAUT") {
  const m = telemetry(s, difficulty);
  const { axis } = portState(s);
  const facing = -axis[1] > 0.5; // the drogue looks at the probe (dockingSim: contact is judged only then)
  const tGo = m.closing > 1e-3 && m.axial > 0 ? m.axial / m.closing : null;
  const predicted = tGo != null ? [m.offset[0] + m.vLat[0] * tGo, m.offset[1] + m.vLat[1] * tGo] : null;
  return { ...m, distance: m.range, lateral: m.offset[0], vertical: m.offset[1], facing, tGo, predicted, predictedR: predicted ? Math.hypot(predicted[0], predicted[1]) : null };
}

/* ---- the capture conditions (what the latches will accept) ---------------------------- */
// Shown green only with a margin inside each physics tolerance, so a green item never
// meets a contact the physics would reject a step later.
export const READY_MARGIN = 0.95;
/**
 * The final-approach readiness checklist: each capture condition of judgeContact
 * against the difficulty's own tolerance, now. `ready` = every condition met
 * (with READY_MARGIN), the drogue facing the probe, in front of it and inside
 * the corridor.
 */
export function captureReadiness(s, difficulty = "ASTRONAUT", margin = READY_MARGIN) {
  const tol = DOCKING[difficulty].tol;
  const a = portAlignment(s, difficulty);
  const vHi = Math.min(tol.vMax, a.closingLimit);
  const items = {
    align: { ok: a.angle <= margin * tol.angle && Math.abs(a.roll) <= margin * tol.roll, angle: a.angle, roll: a.roll, limit: tol.angle, rollLimit: tol.roll },
    offset: { ok: a.offsetR <= margin * tol.lateral, value: a.offsetR, limit: tol.lateral },
    drift: { ok: a.vLatR <= margin * tol.vLat, value: a.vLatR, limit: tol.vLat },
    closing: { ok: a.closing >= tol.vMin / margin && a.closing <= margin * vHi, value: a.closing, min: tol.vMin, max: vHi, high: a.closing > margin * vHi, low: a.closing < tol.vMin / margin },
    rate: { ok: a.rate <= margin * tol.rate, value: a.rate, limit: tol.rate },
    corridor: { ok: a.facing && a.axial > 0 && a.offsetR < corridorRadius(a.axial, difficulty), value: a.offsetR, limit: corridorRadius(a.axial, difficulty) },
  };
  const ready = Object.values(items).every((i) => i.ok);
  return { ready, items, a };
}

/* ---- the approach status (one line, from the simulation state) ------------------------- */
export const STATUS_KEYS = ["acquired", "alignPorts", "lateral", "attitude", "aligned", "reduce", "authorized", "unsafe", "contact", "hardDock", "failed"];
export const ACQUIRE_S = 3; // TARGET ACQUIRED stays up for the first seconds of an attempt
/**
 * The approach's state now. `prev` is the previous result (hysteresis: inside the
 * corridor holds to 1.25 × its radius, an attitude correction until 0.9 × tolerance).
 * Returns { key, corridor: "inside" | "outside", lateralOff, angular, unsafe, ready, a }.
 */
export function approachStatus(s, difficulty = "ASTRONAUT", prev = null) {
  if (s.status === "captured") return { key: "contact", corridor: "inside", ready: true };
  if (s.status === "docked") return { key: "hardDock", corridor: "inside", ready: true };
  if (s.status === "failed") return { key: "failed", corridor: "outside", ready: false };
  const tol = DOCKING[difficulty].tol;
  const r = captureReadiness(s, difficulty);
  const a = r.a;
  const was = prev && prev.a ? prev : null;
  const radius = corridorRadius(a.axial, difficulty) * (was && was.corridor === "inside" ? 1.25 : 1);
  const inside = a.facing && a.axial > -0.05 && a.offsetR < radius;
  const kA = was && was.angular ? 0.9 : 1;
  const angular = a.angle > kA * tol.angle || Math.abs(a.roll) > kA * tol.roll;
  // unsafe directions: the drogue turned away from the probe (contact cannot be made), beside or
  // behind the probe tip, or a drift that will carry the probe outside the drogue in the last metres
  let unsafe = null;
  if (!a.facing) unsafe = "facing";
  else if (a.axial < -0.05) unsafe = "behind";
  else if (a.closing > 0.005 && a.axial < 3 && a.predictedR != null && a.predictedR > DROGUE_R) unsafe = "miss";
  let key;
  if (a.closing > a.closingLimit) key = "reduce";
  else if (unsafe) key = "unsafe";
  else if (s.t < ACQUIRE_S) key = "acquired";
  else if (angular && !inside) key = "alignPorts";
  else if (angular) key = "attitude";
  else if (!inside) key = "lateral";
  else if (r.ready) key = "authorized";
  else key = "aligned";
  return { key, corridor: inside ? "inside" : "outside", lateralOff: !inside, angular, unsafe, ready: r.ready, readiness: r, a };
}

/* ---- the movement words (from the guidance's own buttons) ------------------------------ */
// The guidance (data/dockingGuidance) names the buttons; these are the words for what they do.
// Body axes: in NAV, WINDOW and COCKPIT screen right is body +X and screen up body +Z.
const ACTION = {
  left: ["MOVE LEFT", "MOVA PARA A ESQUERDA"],
  right: ["MOVE RIGHT", "MOVA PARA A DIREITA"],
  up: ["TRANSLATE UP", "TRANSLADE PARA CIMA"],
  down: ["TRANSLATE DOWN", "TRANSLADE PARA BAIXO"],
  fwd: ["CLOSE IN", "AVANCE"],
  aft: ["BACK AWAY", "RECUE"],
  "pitch-up": ["CORRECT PITCH", "CORRIJA A ARFAGEM"],
  "pitch-down": ["CORRECT PITCH", "CORRIJA A ARFAGEM"],
  "yaw-left": ["CORRECT YAW", "CORRIJA A GUINADA"],
  "yaw-right": ["CORRECT YAW", "CORRIJA A GUINADA"],
  "roll-left": ["CORRECT ROLL", "CORRIJA A ROLAGEM"],
  "roll-right": ["CORRECT ROLL", "CORRIJA A ROLAGEM"],
};
/** The short order for an instruction's buttons: "MOVE RIGHT · TRANSLATE UP", "REDUCE CLOSING VELOCITY". */
export function actionWords(g, lang = "en") {
  if (!g || !g.buttons || !g.buttons.length) return "";
  const i = lang === "pt" ? 1 : 0;
  if ((g.key === "brake" || g.key === "slow") && g.buttons.every((b) => b === "aft")) return ["REDUCE CLOSING VELOCITY", "REDUZA A VELOCIDADE DE APROXIMAÇÃO"][i];
  const words = [];
  g.buttons.forEach((b) => {
    const w = ACTION[b] && ACTION[b][i];
    if (w && !words.includes(w)) words.push(w);
  });
  return words.join(" · ");
}
// body axis of each translation button
const T_AXIS = { left: [-1, 0, 0], right: [1, 0, 0], up: [0, 0, 1], down: [0, 0, -1], fwd: [0, 1, 0], aft: [0, -1, 0] };
/**
 * Where the named translation pushes the vehicle, in the CSM frame (the 360° view's
 * arrow): the body axes of the buttons turned through the current attitude. Null for
 * rotations.
 */
export function thrustDirection(s, buttons) {
  const b = (buttons || []).filter((k) => T_AXIS[k]);
  if (!b.length) return null;
  const body = b.reduce((acc, k) => add(acc, T_AXIS[k]), [0, 0, 0]);
  const l = len(body);
  if (l < 1e-9) return null;
  return qRot(s.q, scale(body, 1 / l));
}

/* ---- the screen markers ---------------------------------------------------------------- */
// The ascent stage's bulk, in its body frame from its centre (for occlusion only): the cabin and
// the two propellant pods (lmDesign; HULL_B's extremes).
const LM_BOX = (() => {
  const xs = HULL_B.map((p) => p[0]);
  const ys = HULL_B.map((p) => p[1]);
  const zs = HULL_B.map((p) => p[2]);
  return { x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)], z: [Math.min(...zs), Math.max(...zs)] };
})();
const insideCsm = (p) => Math.hypot(p[0], p[2]) < csmRadiusAt(p[1]);
function insideLm(p, s) {
  const b = qRot(qConj(s.q), sub(p, s.pos));
  return b[0] > LM_BOX.x[0] && b[0] < LM_BOX.x[1] && b[1] > LM_BOX.y[0] && b[1] < LM_BOX.y[1] && b[2] > LM_BOX.z[0] && b[2] < LM_BOX.z[1];
}
/**
 * Whether a point is hidden from the camera by a vehicle's hull: the CSM (always)
 * and the ascent stage (only when it is drawn: not from inside it). The last
 * `near` metres before the point are not tested (the port's own structure).
 */
export function occluded(camPos, p, s, { lm = true, near = 0.3, samples = 64 } = {}) {
  const d = sub(p, camPos);
  const l = len(d);
  if (l < 1e-6) return false;
  const end = Math.max(0, 1 - near / l);
  for (let k = 1; k < samples; k++) {
    const u = (k / samples) * end;
    const q = add(camPos, scale(d, u));
    if (insideCsm(q) || (lm && insideLm(q, s))) return true;
  }
  return false;
}

/**
 * A marker's place on screen: { state, x, y (pixels), angle (off-screen arrow), r
 * (the port ring's projected radius, px), depth }. state: "visible" | "hidden"
 * (behind a hull) | "offscreen" | "window" (on screen but outside the window
 * opening, first-person views). cam = { pos, q, fov } (dockingViews.viewCamera).
 */
export function markerPlacement(cam, p, { w, h, ringR = TARGET_RING_R, hidden = false, inWindow = true, inset = 28 }) {
  const v = qRot(qConj(cam.q), sub(p, cam.pos));
  const depth = -v[2];
  const t = Math.tan((cam.fov * DEG) / 2);
  const aspect = w / h;
  let nx = v[0] / Math.abs(depth || 1e-6) / (t * aspect);
  let ny = v[1] / Math.abs(depth || 1e-6) / t;
  const front = depth > 0.05;
  const x = (nx * 0.5 + 0.5) * w;
  const y = (-ny * 0.5 + 0.5) * h;
  const r = front ? (ringR / depth / t) * (h / 2) : 0;
  const onScreen = front && x >= 0 && x <= w && y >= 0 && y <= h;
  if (!onScreen) {
    // behind the camera the direction flips; pin to the edge, pointing at the target
    if (!front) {
      nx = -nx;
      ny = -ny;
    }
    const ang = Math.atan2(-ny, nx);
    const hx = w / 2 - inset;
    const hy = h / 2 - inset;
    const k = Math.min(hx / Math.max(1e-6, Math.abs(Math.cos(ang))), hy / Math.max(1e-6, Math.abs(Math.sin(ang))));
    return { state: "offscreen", x: w / 2 + Math.cos(ang) * k, y: h / 2 + Math.sin(ang) * k, angle: ang, r: 0, depth };
  }
  return { state: hidden ? "hidden" : inWindow ? "visible" : "window", x, y, angle: 0, r, depth };
}
/**
 * The marker's look by distance: far out a bracket with its label; close in the
 * bracket tightens on the ring; in the last metres only four corner ticks outside
 * the ring (nothing over the port itself).
 */
export function markerStyle(rPx, axial) {
  const size = clamp(rPx * 2.6, 26, 220);
  const level = axial > 12 ? "far" : axial > 3 ? "near" : "final";
  return { size, level, label: level !== "final" || rPx < 30 };
}

/* ---- FOCUS DOCKING PORTS (360°) ---------------------------------------------------------- */
/** The point between the two docking interfaces (the drogue and the probe tip). */
export function portsMidpoint(s) {
  const { port } = portState(s);
  return scale(add(port, PROBE_TIP), 0.5);
}
/**
 * The 360° camera framing both ports from the side (perpendicular to the docking
 * axis, on the sunlit side, a little above), far enough to hold both with margin.
 * Only the camera: neither vehicle moves.
 */
export function focusOrbit(s, fov = 50) {
  const { port } = portState(s);
  const span = len(sub(port, PROBE_TIP));
  const dist = clamp(((span / 2 + 2.6) / Math.tan((fov * DEG) / 2)) * 1.15, 6, 90);
  return { az: Math.PI / 2, el: 0.32, dist, focus: "ports" };
}

/* ---- why a contact failed (from the physics' own judgement) ----------------------------- */
const f2 = (v) => v.toFixed(2);
const f3 = (v) => v.toFixed(3);
const dg = (r) => ((r * 180) / Math.PI).toFixed(1);
// which part of the ascent stage (HULL_B order: 12 cabin corners, 4 RCS quads, 4 pod ends, 6 deck points)
const HULL_PART = (i) => (i < 12 ? 0 : i < 16 ? 1 : i < 20 ? 2 : 3);
const PART = { en: ["CABIN", "RCS QUAD", "PROPELLANT POD", "TOP DECK"], pt: ["CABINE", "BLOCO DE RCS", "TANQUE LATERAL", "CONVÉS SUPERIOR"] };
function hitPart(s) {
  let best = { i: 0, gap: Infinity, y: 0 };
  HULL_B.forEach((hb, i) => {
    const p = add(s.pos, qRot(s.q, hb));
    const gap = Math.hypot(p[0], p[2]) - csmRadiusAt(p[1]);
    if (csmRadiusAt(p[1]) > 0 && gap < best.gap) best = { i, gap, y: p[1] };
  });
  return best;
}
/**
 * The cause of a contact or a failure, in words, with the measured value against
 * the limit: { title, lines[], kind }. `e` is the physics' event (judgeContact or
 * a failure), `s` the state at the event.
 */
export function contactCause(e, s, difficulty = "ASTRONAUT", lang = "en") {
  const pt = lang === "pt";
  const tol = DOCKING[difficulty].tol;
  const f = (e && e.facts) || {};
  const R = {
    "OFF AXIS": () => (pt ? `DESVIO LATERAL ${f2(f.lateral)} m > ${f2(tol.lateral)} m` : `LATERAL OFFSET ${f2(f.lateral)} m > ${f2(tol.lateral)} m`),
    MISALIGNED: () => (pt ? `ALINHAMENTO ANGULAR ${dg(f.angle)}° > ${dg(tol.angle)}°` : `ANGULAR ALIGNMENT ${dg(f.angle)}° > ${dg(tol.angle)}°`),
    ROLL: () => (pt ? `ROLAGEM ${dg(f.roll)}° > ${dg(tol.roll)}°` : `ROLL ${dg(f.roll)}° > ${dg(tol.roll)}°`),
    "TOO FAST": () => (pt ? `VELOCIDADE DE IMPACTO ${f3(f.closing)} > ${f3(tol.vMax)} m/s` : `IMPACT VELOCITY ${f3(f.closing)} > ${f3(tol.vMax)} m/s`),
    "TOO SLOW TO LATCH": () => (pt ? `APROXIMAÇÃO ${f3(f.closing)} < ${f3(tol.vMin)} m/s — LENTA DEMAIS PARA TRAVAR` : `CLOSING ${f3(f.closing)} < ${f3(tol.vMin)} m/s — TOO SLOW TO LATCH`),
    "LATERAL DRIFT": () => (pt ? `DERIVA LATERAL ${f3(f.vLat)} > ${f3(tol.vLat)} m/s` : `LATERAL DRIFT ${f3(f.vLat)} > ${f3(tol.vLat)} m/s`),
    ROTATING: () => (pt ? `ROTAÇÃO ${dg(f.rate)} > ${dg(tol.rate)} °/s` : `ROTATION ${dg(f.rate)} > ${dg(tol.rate)} °/s`),
  };
  if (!e) return { kind: null, title: "", lines: [] };
  if (e.kind === "deflected") {
    return { kind: e.kind, title: pt ? "SEM CAPTURA — A SONDA FOI DEFLETIDA" : "NO CAPTURE — PROBE DEFLECTED", lines: (e.reasons || []).map((k) => (R[k] ? R[k]() : k)) };
  }
  if (e.kind === "outside") {
    return {
      kind: e.kind,
      title: pt ? "A SONDA ATINGIU FORA DO DROGUE" : "PROBE STRUCK OUTSIDE THE DROGUE",
      lines: [pt ? `DESVIO LATERAL ${f2(f.lateral)} m > ${f2(DROGUE_R)} m (BOCA DO DROGUE)` : `LATERAL OFFSET ${f2(f.lateral)} m > ${f2(DROGUE_R)} m (DROGUE MOUTH)`],
    };
  }
  if (e.kind === "damage") {
    return { kind: e.kind, title: pt ? "VELOCIDADE DE IMPACTO EXCESSIVA" : "EXCESSIVE IMPACT VELOCITY", lines: [pt ? `IMPACTO ${f3(f.closing)} m/s > ${f3(0.6)} m/s: MECANISMO DANIFICADO` : `IMPACT ${f3(f.closing)} m/s > ${f3(0.6)} m/s: DOCKING MECHANISM DAMAGED`] };
  }
  if (e.kind === "collision") {
    const h = s ? hitPart(s) : null;
    const facing = s ? -portState(s).axis[1] > 0.5 : true;
    const where = h ? (h.y > 0.234 ? (pt ? "o cone do módulo de comando" : "the command module's cone") : pt ? "o módulo de serviço" : "the service module") : "";
    const what = h ? PART[pt ? "pt" : "en"][HULL_PART(h.i)] : "";
    const lines = [pt ? `CONTATO COM UMA SUPERFÍCIE QUE NÃO É A PORTA: ${what} CONTRA ${where.toUpperCase()}` : `CONTACT WITH A NON-DOCKING SURFACE: ${what} AGAINST ${where.toUpperCase()}`];
    if (f.speed != null) lines.push(pt ? `VELOCIDADE ${f3(f.speed)} m/s${e.recoverable ? "" : " > 0.120 m/s"}` : `SPEED ${f3(f.speed)} m/s${e.recoverable ? "" : " > 0.120 m/s"}`);
    if (!facing) lines.push(pt ? "DIREÇÃO DE APROXIMAÇÃO INCORRETA: O DROGUE NÃO APONTAVA PARA A SONDA" : "INCORRECT APPROACH DIRECTION: THE DROGUE WAS NOT FACING THE PROBE");
    return { kind: e.kind, title: pt ? "COLISÃO COM O CSM" : "COLLISION WITH THE CSM", lines };
  }
  if (e.kind === "lost") return { kind: e.kind, title: pt ? "ALVO PERDIDO — FORA DE ALCANCE" : "TARGET LOST — OUT OF RANGE", lines: [pt ? "MAIS DE 180 m DA PORTA DE DOCKING" : "MORE THAN 180 m FROM THE DOCKING PORT"] };
  if (e.kind === "propellant") return { kind: e.kind, title: pt ? "PROPELENTE DO RCS ESGOTADO" : "RCS PROPELLANT DEPLETED", lines: [pt ? "PAROU ANTES DA PORTA, SEM RCS PARA CONTINUAR" : "STOPPED SHORT OF THE PORT WITH NO RCS LEFT"] };
  return { kind: e.kind, title: e.title || "", lines: [] };
}

/** The physics' verdict on a contact made right now (tests and tooling; read-only). */
export const judgeNow = (s, difficulty) => judgeContact(s, difficulty);
