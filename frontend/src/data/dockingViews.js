/*
 * LUNAVIA — the four docking views (pure camera geometry; unit-tested).
 *
 * All four views look at the ONE docking simulation (data/dockingSim): a view
 * only decides where the camera is and which way it looks. Nothing here, and
 * nothing in a view switch, writes the simulation state.
 *
 *   NAV      the docking navigation display: the camera on the docking port's
 *            own axis, looking up it at the CSM's probe, with the reticle, the
 *            alignment display and the full HUD drawn over it (DockingOps).
 *            It is the view the docking always had, unchanged.
 *   WINDOW   first person through the ascent stage's overhead docking window,
 *            from the commander's eye: left of and below the tunnel, so the
 *            target sits a little off-centre and shifts with parallax as the
 *            vehicle moves and turns. A real window frame, no instruments.
 *   COCKPIT  inside the cabin, further back from the same window: the cabin
 *            structure, the window frame and the docking instrument panel
 *            (live telemetry) around the view of the CSM.
 *   ORBIT    "360°": a free camera orbiting the ascent stage, in the CSM's
 *            frame (so it stays still while the vehicle turns), driven by
 *            drag and pinch; it starts on the old chase framing.
 *
 * Frames: the CSM frame of dockingSim (metres; +Y the probe's axis, +Z away
 * from the Moon). The ascent stage's body: +Y up its docking tunnel, +Z
 * forward, +X right. The first-person views share one camera orientation in
 * the body frame (look along +Y, screen up = body +Z, screen right = body +X),
 * so the pad's ▲ ▼ ◀ ▶ mean the same on screen in NAV, WINDOW and COCKPIT.
 */
import { PORT_B, qConj, qMul, qNorm, qRot } from "./dockingSim";
import { portsMidpoint } from "./dockingPorts";

export const VIEWS = ["NAV", "WINDOW", "COCKPIT", "ORBIT"];
export const VIEW_LABEL = { NAV: "NAV", WINDOW: "WINDOW", COCKPIT: "COCKPIT", ORBIT: "360°" };
export const FIRST_PERSON = { NAV: true, WINDOW: true, COCKPIT: true, ORBIT: false };

// The eye frame (camera looks along its −Z, up its +Y) mounted in the body frame:
// −Z_eye → body +Y (the docking axis), +Y_eye → body +Z, +X_eye → body +X. A quarter turn about X.
export const MOUNT_Q = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];

// Eye positions in the body frame (metres from the ascent stage's centre) and vertical fields of view.
export const EYE = {
  NAV: [0, PORT_B[1] - 0.25, 0], // on the docking axis, just inside the port (as it always was)
  WINDOW: [-0.3, 0.8, 0.22], // commander's eye under the overhead docking window
  COCKPIT: [-0.22, 0.45, 0.15], // further back in the cabin: the panel and the window frame in view
};
export const FOV = { NAV: 50, WINDOW: 62, COCKPIT: 72, ORBIT: 50 };
// The WINDOW view's window opening, in its eye frame (metres; DockingCabin WindowFrame).
export const WINDOW_OPENING = { z: -0.28, x0: -0.24, x1: 0.24, y0: -0.135, y1: 0.135 };
/** Whether a world point is seen through a window opening in the eye frame of a camera. */
export function throughOpening(cam, p, w) {
  const v = qRot(qConj(cam.q), sub(p, cam.pos));
  if (v[2] >= 0) return false;
  const k = w.z / v[2];
  return v[0] * k > w.x0 && v[0] * k < w.x1 && v[1] * k > w.y0 && v[1] * k < w.y1;
}
// The cockpit's docking window, in the eye frame (metres): the opening in the forward bulkhead.
export const COCKPIT_WINDOW = { z: -0.56, x0: -0.21, x1: 0.21, y0: -0.12, y1: 0.24 };
/** Whether a world point is seen through the cockpit's docking window (not the bulkhead). */
export const throughCockpitWindow = (cam, p) => throughOpening(cam, p, COCKPIT_WINDOW);

/* ---- 360°: the free orbit camera ------------------------------------------------- */
// az about the CSM frame's +Z (0 = behind the ascent stage, on +Y), el above (+Z, away from the Moon).
export const ORBIT_DEFAULT = { az: Math.atan2(-6, 9), el: Math.asin(5.5 / Math.hypot(6, 9, 5.5)), dist: Math.hypot(6, 9, 5.5) };
export const ORBIT_LIMITS = { el: 1.45, distMin: 3, distMax: 90 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** A drag of (dx, dy) screen pixels: around and over the vehicle (a full turn every ~1000 px). */
export function orbitDrag(o, dx, dy, k = 0.0063) {
  return { ...o, az: o.az - dx * k, el: clamp(o.el + dy * k, -ORBIT_LIMITS.el, ORBIT_LIMITS.el) };
}
/** A pinch (finger spread ratio > 1 zooms in) or wheel factor. */
export function orbitZoom(o, ratio) {
  return { ...o, dist: clamp(o.dist / Math.max(0.2, Math.min(5, ratio)), ORBIT_LIMITS.distMin, ORBIT_LIMITS.distMax) };
}
export function orbitOffset(o) {
  return [o.dist * Math.cos(o.el) * Math.sin(o.az), o.dist * Math.cos(o.el) * Math.cos(o.az), o.dist * Math.sin(o.el)];
}

/* ---- the camera of each view ------------------------------------------------------ */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** Quaternion [x,y,z,w] of the rotation whose columns are the basis vectors x, y, z. */
export function quatFromBasis(x, y, z) {
  const [m00, m10, m20] = x;
  const [m01, m11, m21] = y;
  const [m02, m12, m22] = z;
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return qNorm(q);
}
/** Camera looking from `pos` at `target`, with `up` as near screen-up as possible. */
export function lookAtQ(pos, target, up = [0, 0, 1]) {
  const f = norm(sub(target, pos));
  let r = cross(f, up);
  if (Math.hypot(...r) < 1e-6) r = cross(f, [0, 1, 0]);
  r = norm(r);
  const u = cross(r, f);
  return quatFromBasis(r, u, [-f[0], -f[1], -f[2]]);
}

/**
 * The camera of a view for a simulation state: { pos, q, fov, target }.
 * `orbit` is the 360° camera's { az, el, dist }.
 */
export function viewCamera(view, s, orbit = ORBIT_DEFAULT) {
  if (view === "ORBIT") {
    // centred on the ascent stage, or (FOCUS DOCKING PORTS) on the point between the two ports
    const target = orbit.focus === "ports" ? portsMidpoint(s) : s.pos.slice();
    const off = orbitOffset(orbit);
    const pos = [target[0] + off[0], target[1] + off[1], target[2] + off[2]];
    // near the poles the CSM frame's +Z stops being a usable "up": use the azimuth's own direction
    const up = Math.abs(orbit.el) > 1.35 ? [-Math.sin(orbit.az) * Math.sign(orbit.el), -Math.cos(orbit.az) * Math.sign(orbit.el), 0] : [0, 0, 1];
    return { pos, q: lookAtQ(pos, target, up), fov: FOV.ORBIT, target };
  }
  const eye = EYE[view] || EYE.NAV;
  const e = qRot(s.q, eye);
  return { pos: [s.pos[0] + e[0], s.pos[1] + e[1], s.pos[2] + e[2]], q: qNorm(qMul(s.q, MOUNT_Q)), fov: FOV[view] || FOV.NAV, eye };
}

/** Where a world point falls in a camera's picture: NDC x, y in −1..1 when on screen, and depth. */
export function project(cam, p, aspect = 16 / 9) {
  const v = qRot(qConj(cam.q), sub(p, cam.pos));
  const depth = -v[2];
  const t = Math.tan((cam.fov * Math.PI) / 360);
  return { x: v[0] / depth / (t * aspect), y: v[1] / depth / t, depth, front: depth > 0 };
}
