/*
 * LUNAVIA — the lunar module cabin's interior (geometry and panel artwork).
 *
 * Built in LanderModel's model units, inside the exterior's own cabin profile
 * (data/lmDesign CABIN_PROFILE, extruded ±CABIN_HALF_X), so the inner skin, the
 * two triangular window openings and the forward hatch sit exactly where the
 * outside of the vehicle has them. Static parts are merged per material (a
 * handful of draw calls); the panel faces are canvas textures with a separate
 * glow layer (the LM's integrally lit panels and displays); indicator lamps
 * are one instanced mesh whose colours the scene sets from the cabin's state.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CABIN_PROFILE, CABIN_HALF_X } from "@/data/lmDesign";
import { CABIN_WALL, FLOOR_Y, windowCorners } from "@/data/lmCabin";

const W = CABIN_HALF_X - CABIN_WALL; // inner half-width

/* ---- the inner profile ---------------------------------------------------------------------- */
function insetProfile(P, d) {
  const n = P.length;
  const c = P.reduce((a, p) => [a[0] + p[0] / n, a[1] + p[1] / n], [0, 0]);
  const lines = P.map((p, i) => {
    const q = P[(i + 1) % n];
    const e = [q[0] - p[0], q[1] - p[1]];
    const L = Math.hypot(e[0], e[1]);
    let nn = [-e[1] / L, e[0] / L];
    const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    if ((c[0] - mid[0]) * nn[0] + (c[1] - mid[1]) * nn[1] < 0) nn = [-nn[0], -nn[1]];
    return { p: [p[0] + nn[0] * d, p[1] + nn[1] * d], e: [e[0] / L, e[1] / L], n: nn };
  });
  return lines.map((l, i) => {
    const m = lines[(i - 1 + n) % n];
    // intersect line m (through m.p along m.e) with line l
    const det = m.e[0] * -l.e[1] - m.e[1] * -l.e[0];
    const rx = l.p[0] - m.p[0];
    const ry = l.p[1] - m.p[1];
    const t = (rx * -l.e[1] - ry * -l.e[0]) / det;
    return [m.p[0] + m.e[0] * t, m.p[1] + m.e[1] * t];
  });
}
export const INNER = insetProfile(CABIN_PROFILE, CABIN_WALL);
// edges of the profile: 0 floor, 1 toe slope, 2 lower front (hatch), 3 panel face, 4 window facet,
// 5 roof, 6 aft upper bevel, 7 aft wall
const centroid = INNER.reduce((a, p) => [a[0] + p[0] / INNER.length, a[1] + p[1] / INNER.length], [0, 0]);

/** An edge's frame: origin (its first inner vertex), unit direction s (z, y) pointing up the edge, inward normal. */
export function edgeFrame(i) {
  let a = INNER[i];
  let b = INNER[(i + 1) % INNER.length];
  if (b[1] < a[1] - 1e-9 || (Math.abs(b[1] - a[1]) < 1e-9 && b[0] < a[0])) [a, b] = [b, a];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const s = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  let n = [-s[1], s[0]];
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if ((centroid[0] - mid[0]) * n[0] + (centroid[1] - mid[1]) * n[1] < 0) n = [-n[0], -n[1]];
  return { a, b, L, s, n };
}
/** A point on edge i: x across, at distance u up the edge, lifted `lift` inward (cabin frame [x, y, z]). */
export function onEdge(i, x, u, lift = 0) {
  const f = edgeFrame(i);
  return [x, f.a[1] + f.s[1] * u + f.n[1] * lift, f.a[0] + f.s[0] * u + f.n[0] * lift];
}

/* ---- builders ------------------------------------------------------------------------------- */
const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
/** A rectangle w×h centred at c with right axis U and up axis V (normal U×V, towards the viewer). */
function plane(c, U, V, w, h) {
  const g = new THREE.PlaneGeometry(w, h);
  const u = V3(U).normalize();
  const v = V3(V).normalize();
  const n = new THREE.Vector3().crossVectors(u, v);
  g.applyMatrix4(new THREE.Matrix4().makeBasis(u, v, n).setPosition(V3(c)));
  return g;
}
/** A box with the same frame (depth along the normal, its back face at c). */
function slab(c, U, V, w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d).translate(0, 0, d / 2);
  const u = V3(U).normalize();
  const v = V3(V).normalize();
  const n = new THREE.Vector3().crossVectors(u, v);
  g.applyMatrix4(new THREE.Matrix4().makeBasis(u, v, n).setPosition(V3(c)));
  return g;
}
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const rod = (a, b, r, seg = 6) => {
  const A = V3(a);
  const B = V3(b);
  const g = new THREE.CylinderGeometry(r, r, A.distanceTo(B), seg, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return g.applyQuaternion(q).translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
};
const tube = (pts, r, seg = 24) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(V3)), seg, r, 6, false);
/** Edge i's panel frame: centre at x, u (along the edge), lifted; U = right as seen from inside, V = up the edge. */
function edgeAxes(i, x, u, lift) {
  const f = edgeFrame(i);
  const V = [0, f.s[1], f.s[0]];
  const N = [0, f.n[1], f.n[0]];
  // U = V × N (so that U × V = N)
  const U = [V[1] * N[2] - V[2] * N[1], V[2] * N[0] - V[0] * N[2], V[0] * N[1] - V[1] * N[0]];
  return { c: onEdge(i, x, u, lift), U, V, N };
}

/* ---- the shell ------------------------------------------------------------------------------ */
function shellGeometry() {
  const parts = [];
  // side walls (the inner profile at x = ±W)
  const shape = new THREE.Shape(INNER.map(([z, y]) => new THREE.Vector2(z, y)));
  [-1, 1].forEach((sx) => {
    const g = new THREE.ShapeGeometry(shape);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) p.setXYZ(k, sx * W, p.getY(k), p.getX(k));
    g.computeVertexNormals();
    parts.push(g);
  });
  // the edges (all but the window facet: that one has the two openings)
  INNER.forEach((a, i) => {
    if (i === 4) return;
    const b = INNER[(i + 1) % INNER.length];
    const g = new THREE.BufferGeometry();
    const v = [-W, a[1], a[0], W, a[1], a[0], W, b[1], b[0], -W, b[1], b[0]];
    g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    parts.push(g);
  });
  parts.push(facetWithWindows());
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)).map(stripUv));
}
function stripUv(g) {
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", g.attributes.position);
  if (g.attributes.normal) out.setAttribute("normal", g.attributes.normal);
  else out.computeVertexNormals();
  // a planar uv in metres (x, and y+z) for the quilted wall texture
  const p = g.attributes.position;
  const uv = [];
  for (let k = 0; k < p.count; k++) uv.push(p.getX(k) * 4.8, (p.getY(k) + p.getZ(k)) * 4.8);
  out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return out;
}
/** The window facet's inner skin with the two triangular openings, in the facet's own 2D frame. */
function windowHoles2D() {
  const f = edgeFrame(4);
  // project each window corner onto the inner facet: (x, distance up the edge)
  return [0, 1].map((w) =>
    windowCorners(w).map(([x, y, z]) => {
      const u = (z - f.a[0]) * f.s[0] + (y - f.a[1]) * f.s[1];
      return [x, u];
    })
  );
}
function facetWithWindows() {
  const f = edgeFrame(4);
  const sh = new THREE.Shape([new THREE.Vector2(-W, 0), new THREE.Vector2(W, 0), new THREE.Vector2(W, f.L), new THREE.Vector2(-W, f.L)]);
  windowHoles2D().forEach((tri) => {
    const pts = tri.map(([x, u]) => new THREE.Vector2(x, u));
    // holes run the other way round
    const area = (pts[1].x - pts[0].x) * (pts[2].y - pts[0].y) - (pts[2].x - pts[0].x) * (pts[1].y - pts[0].y);
    sh.holes.push(new THREE.Path(area > 0 ? pts.slice().reverse() : pts));
  });
  const g = new THREE.ShapeGeometry(sh);
  const p = g.attributes.position;
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k);
    const u = p.getY(k);
    p.setXYZ(k, x, f.a[1] + f.s[1] * u, f.a[0] + f.s[0] * u);
  }
  g.computeVertexNormals();
  return g;
}
/** Black anodised frames round the openings (a triangular ring, extruded inward). */
function windowFrames() {
  const f = edgeFrame(4);
  const out = [];
  windowHoles2D().forEach((tri) => {
    const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
    const cu = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
    const grow = (k) => tri.map(([x, u]) => new THREE.Vector2(cx + (x - cx) * k, cu + (u - cu) * k));
    const outer = grow(1.32);
    const inner = grow(1.0);
    const sh = new THREE.Shape(outer);
    const area = (inner[1].x - inner[0].x) * (inner[2].y - inner[0].y) - (inner[2].x - inner[0].x) * (inner[1].y - inner[0].y);
    const ca = (outer[1].x - outer[0].x) * (outer[2].y - outer[0].y) - (outer[2].x - outer[0].x) * (outer[1].y - outer[0].y);
    sh.holes.push(new THREE.Path(Math.sign(area) === Math.sign(ca) ? inner.slice().reverse() : inner));
    // a thin bezel, flush with the skin: the windows face up, so the view out is a grazing one and a
    // deep frame would hide the ground
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.0022, bevelEnabled: false, curveSegments: 1 });
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k);
      const u = p.getY(k);
      const d = p.getZ(k);
      p.setXYZ(k, x, f.a[1] + f.s[1] * u + f.n[1] * d, f.a[0] + f.s[0] * u + f.n[0] * d);
    }
    g.computeVertexNormals();
    out.push(g);
  });
  return out;
}
/** The two panes (the exterior's glass position and an inner pane), as plain triangles. */
export function glassGeometry() {
  const f = edgeFrame(4);
  const tris = [];
  [0, 1].forEach((w) => {
    const outer = windowCorners(w);
    tris.push(outer);
    tris.push(outer.map(([x, y, z]) => [x, y + f.n[1] * 0.002, z + f.n[0] * 0.002]));
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(tris.flat(2), 3));
  g.computeVertexNormals();
  return g;
}

/* ---- panel artwork -------------------------------------------------------------------------- */
const PANEL_BG = "#3a3d41";
const INK = "#e9e7df";
function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}
function tex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const label = (g, text, x, y, size = 14, color = INK, align = "center") => {
  g.font = `bold ${size}px "Helvetica Neue", Arial, sans-serif`;
  g.textAlign = align;
  g.textBaseline = "middle";
  g.fillStyle = color;
  g.fillText(text, x, y);
};
function gauge(g, glow, x, y, r, title, ticks = 10, needle = 0.4) {
  g.fillStyle = "#15171a";
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#9aa0a6";
  g.lineWidth = 2;
  g.stroke();
  for (let i = 0; i <= ticks; i++) {
    const a = Math.PI * (0.75 + 1.5 * (i / ticks));
    glow.strokeStyle = "#d8f5d0";
    glow.lineWidth = 2;
    glow.beginPath();
    glow.moveTo(x + Math.cos(a) * r * 0.78, y + Math.sin(a) * r * 0.78);
    glow.lineTo(x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92);
    glow.stroke();
  }
  const a = Math.PI * (0.75 + 1.5 * needle);
  g.strokeStyle = "#f2f2ee";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8);
  g.stroke();
  label(g, title, x, y + r + 14, 12);
  label(glow, title, x, y + r + 14, 12, "#cfe9c8");
}
function tape(g, glow, x, y, w, h, title) {
  g.fillStyle = "#121315";
  g.fillRect(x, y, w, h);
  g.strokeStyle = "#8b9095";
  g.strokeRect(x, y, w, h);
  for (let k = 0; k < 9; k++) {
    const yy = y + 8 + (k * (h - 16)) / 8;
    glow.fillStyle = "#e8e4d6";
    glow.fillRect(x + 4, yy, k % 2 ? 8 : 16, 2);
  }
  glow.fillStyle = "#ff9b2e";
  glow.fillRect(x, y + h * 0.48, w, 3);
  label(g, title, x + w / 2, y + h + 12, 11);
  label(glow, title, x + w / 2, y + h + 12, 11, "#cfe9c8");
}
function switches(g, glow, x, y, n, dx, labels) {
  for (let i = 0; i < n; i++) {
    const cx = x + i * dx;
    g.fillStyle = "#1d1f22";
    g.beginPath();
    g.arc(cx, y, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#c9ccd0";
    g.fillRect(cx - 2.5, y - 16, 5, 16);
    if (labels && labels[i]) {
      label(g, labels[i], cx, y + 20, 10);
      label(glow, labels[i], cx, y + 20, 10, "#cfe9c8");
    }
  }
}
function sevenSeg(glow, g, x, y, text, size = 26, color = "#ffb347") {
  g.fillStyle = "#0b0b0c";
  g.fillRect(x - 6, y - size * 0.65, text.length * size * 0.62 + 12, size * 1.3);
  glow.font = `bold ${size}px "Courier New", monospace`;
  glow.textAlign = "left";
  glow.textBaseline = "middle";
  glow.fillStyle = color;
  glow.fillText(text, x, y);
  g.font = glow.font;
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.fillStyle = "#4d3a1d";
  g.fillText(text, x, y);
}
function cwMatrix(g, glow, x, y, names, cols, cw, ch, lit = []) {
  names.forEach((n, i) => {
    const cx = x + (i % cols) * cw;
    const cy = y + Math.floor(i / cols) * ch;
    g.fillStyle = "#24221d";
    g.fillRect(cx + 2, cy + 2, cw - 4, ch - 4);
    label(g, n, cx + cw / 2, cy + ch / 2, 10, "#6f6a5c");
    if (lit.includes(i)) {
      glow.fillStyle = "rgba(255,170,40,0.85)";
      glow.fillRect(cx + 2, cy + 2, cw - 4, ch - 4);
      label(glow, n, cx + cw / 2, cy + ch / 2, 10, "#2a1600");
    }
  });
}
function frame(g, w, h, title) {
  g.fillStyle = PANEL_BG;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "#5d6166";
  g.lineWidth = 4;
  g.strokeRect(2, 2, w - 4, h - 4);
  // screw heads
  [
    [12, 12],
    [w - 12, 12],
    [12, h - 12],
    [w - 12, h - 12],
  ].forEach(([x, y]) => {
    g.fillStyle = "#8d9196";
    g.beginPath();
    g.arc(x, y, 4, 0, Math.PI * 2);
    g.fill();
  });
  if (title) label(g, title, w / 2, 22, 15);
}

/** Each panel's artwork: { map, glow } canvas textures. */
export function panelTextures(siteName = "") {
  const out = {};
  const make = (id, w, h, draw) => {
    const a = canvas(w, h);
    const b = canvas(w, h);
    const g = a.getContext("2d");
    const gl = b.getContext("2d");
    gl.fillStyle = "#000";
    gl.fillRect(0, 0, w, h);
    draw(g, gl, w, h);
    out[id] = { map: tex(a), glow: tex(b) };
  };
  // the commander's flight panel (left): attitude ball (a real sphere sits on it), tapes, event timer
  make("left", 512, 512, (g, gl, w, h) => {
    frame(g, w, h, "FLIGHT DISPLAYS · CDR");
    g.fillStyle = "#101113";
    g.beginPath();
    g.arc(170, 200, 92, 0, Math.PI * 2);
    g.fill();
    label(g, "FDAI", 170, 306, 13);
    label(gl, "FDAI", 170, 306, 13, "#cfe9c8");
    tape(g, gl, 300, 110, 46, 190, "ALT");
    tape(g, gl, 370, 110, 46, 190, "ALT RT");
    tape(g, gl, 440, 110, 46, 190, "T/W");
    sevenSeg(gl, g, 60, 360, "102:45:40", 30);
    label(g, "MISSION TIMER", 160, 392, 11);
    sevenSeg(gl, g, 330, 360, "00 00", 30, "#ffb347");
    label(g, "EVENT TIMER", 380, 392, 11);
    switches(g, gl, 70, 450, 6, 72, ["MODE", "RATE", "ATT", "ENG", "ABORT", "STAGE"]);
  });
  // the centre panel: caution & warning, DSKY, propellant
  make("centre", 512, 512, (g, gl, w, h) => {
    frame(g, w, h, "CAUTION & WARNING · GUIDANCE");
    const names = ["ASC PRESS", "DES REG", "CES AC", "CES DC", "AGS", "ASC HI", "LGC", "ISS", "RCS TCA", "RCS A", "RCS B", "HEATER", "C/W PWR", "ECS", "GLYCOL", "SUIT/FAN", "CO2 HI", "H2O SEP", "INVERTER", "BATTERY", "RNDZ RDR", "LDG RDR", "S-BD RCVR", "PRE AMPS"];
    cwMatrix(g, gl, 24, 44, names, 6, 77, 26, [21]);
    // DSKY
    g.fillStyle = "#1a1c1f";
    g.fillRect(40, 220, 210, 270);
    g.fillStyle = "#050806";
    g.fillRect(56, 236, 178, 120);
    gl.font = 'bold 22px "Courier New", monospace';
    gl.textAlign = "left";
    gl.fillStyle = "#7dff9e";
    gl.fillText("PROG 68", 64, 258);
    gl.fillText("VERB 16  NOUN 43", 64, 284);
    gl.fillText("+00000 +00000", 64, 312);
    gl.fillText("+00000", 64, 338);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 7; c++) {
        g.fillStyle = "#c8c6bd";
        g.fillRect(56 + c * 25, 372 + r * 36, 20, 28);
      }
    label(g, "DSKY", 145, 478, 12);
    gauge(g, gl, 330, 270, 46, "FUEL %", 10, 0.18);
    gauge(g, gl, 440, 270, 46, "OXID %", 10, 0.2);
    gauge(g, gl, 330, 400, 46, "ENG THRUST", 10, 0.0);
    gauge(g, gl, 440, 400, 46, "HE PRESS", 10, 0.62);
  });
  // the pilot's panel (right): environment and the ascent readiness lamps
  make("right", 512, 512, (g, gl, w, h) => {
    frame(g, w, h, "ENVIRONMENT · ASCENT · LMP");
    gauge(g, gl, 100, 120, 48, "CABIN PRESS", 10, 0.6);
    gauge(g, gl, 230, 120, 48, "SUIT PRESS", 10, 0.55);
    gauge(g, gl, 360, 120, 48, "O2 QTY", 10, 0.7);
    tape(g, gl, 440, 70, 44, 130, "H2O");
    g.fillStyle = "#26282b";
    g.fillRect(40, 236, 432, 160);
    label(g, "ASCENT READINESS", 256, 256, 16);
    label(gl, "ASCENT READINESS", 256, 256, 16, "#cfe9c8");
    ["SYSTEMS CHECK", "CABIN SECURE", "READY FOR ASCENT"].forEach((t, i) => {
      label(g, t, 200, 300 + i * 34, 14, INK, "left");
      label(gl, t, 200, 300 + i * 34, 14, "#cfe9c8", "left");
      g.fillStyle = "#101010";
      g.fillRect(130, 288 + i * 34, 46, 24);
    });
    switches(g, gl, 70, 450, 6, 72, ["ASC ENG", "ARM", "RCS A", "RCS B", "AGS", "CB"]);
  });
  // communications (right wall)
  make("comms", 512, 384, (g, gl, w, h) => {
    frame(g, w, h, "COMMUNICATIONS");
    ["S-BAND T/R", "VHF A", "VHF B", "AUDIO CDR", "AUDIO LMP"].forEach((t, i) => {
      g.fillStyle = "#1c1e21";
      g.fillRect(30 + i * 94, 56, 70, 96);
      g.fillStyle = "#a9adb1";
      for (let k = 0; k < 6; k++) g.fillRect(40 + i * 94, 66 + k * 14, 50, 6);
      label(g, t, 65 + i * 94, 168, 11);
      label(gl, t, 65 + i * 94, 168, 11, "#cfe9c8");
    });
    gauge(g, gl, 110, 262, 52, "ANT PITCH", 8, 0.45);
    gauge(g, gl, 250, 262, 52, "ANT YAW", 8, 0.58);
    gauge(g, gl, 390, 262, 52, "SIGNAL", 10, 0.75);
    label(g, "EARTH LINK", 455, 196, 11);
  });
  // circuit breakers (left wall, and either side of the hatch)
  make("cb", 512, 256, (g, gl, w, h) => {
    frame(g, w, h, "CIRCUIT BREAKERS");
    const groups = ["FLT DISPLAYS", "STAB/CONT", "ECS", "COMM", "LIGHTING", "PROPULSION", "EPS"];
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 14; c++) {
        g.fillStyle = "#1a1b1d";
        g.beginPath();
        g.arc(28 + c * 34, 60 + r * 46, 11, 0, Math.PI * 2);
        g.fill();
        label(g, `${(r * 14 + c + 1) % 40 || 40}`, 28 + c * 34, 80 + r * 46, 8, "#b8b6ae");
      }
    groups.forEach((t, i) => label(g, t, 40 + i * 68, 240, 9));
  });
  // the EVA panel (aft, between the two backpacks)
  make("eva", 256, 256, (g, gl, w, h) => {
    frame(g, w, h, "EVA · PLSS");
    ["SUIT CHECK", "HATCH", "EVA SYS"].forEach((t, i) => {
      label(g, t, 150, 80 + i * 46, 14, INK, "left");
      label(gl, t, 150, 80 + i * 46, 14, "#cfe9c8", "left");
      g.fillStyle = "#101010";
      g.fillRect(70, 68 + i * 46, 50, 26);
    });
    switches(g, gl, 46, 222, 4, 54, ["O2", "FAN", "PUMP", "COMM"]);
  });
  // the forward hatch's placard
  make("hatch", 256, 256, (g) => {
    g.fillStyle = "#b9b7ae";
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = "#7a786f";
    g.lineWidth = 6;
    g.strokeRect(6, 6, 244, 244);
    label(g, "FORWARD HATCH", 128, 46, 20, "#222");
    label(g, "CABIN MUST BE AT 0 PSI", 128, 82, 13, "#7a1d10");
    label(g, "HANDLE · ROTATE · PULL", 128, 106, 13, "#222");
    g.fillStyle = "#e1572a";
    g.fillRect(40, 200, 176, 16);
    label(g, siteName ? siteName.toUpperCase() : "LUNAVIA", 128, 176, 12, "#333");
  });
  return out;
}
/** The quilted beta-cloth wall covering (repeats every metre). */
export function quiltTexture() {
  const c = canvas(256, 256);
  const g = c.getContext("2d");
  g.fillStyle = "#b3b1a8";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(${90 + Math.random() * 60},${90 + Math.random() * 60},${85 + Math.random() * 50},0.06)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  g.strokeStyle = "rgba(70,68,62,0.45)";
  g.lineWidth = 2;
  g.setLineDash([5, 4]);
  for (let k = 0; k <= 256; k += 64) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k, 256);
    g.stroke();
    g.beginPath();
    g.moveTo(0, k);
    g.lineTo(256, k);
    g.stroke();
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
/** The floor's grating. */
export function floorTexture() {
  const c = canvas(256, 256);
  const g = c.getContext("2d");
  g.fillStyle = "#4b4c4a";
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = "#363735";
  for (let y = 0; y < 256; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < 256; x += 16) g.fillRect(x + 3, y + 3, 9, 9);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}
/** The attitude ball's face (white sky, black ground, a pitch ladder). */
export function fdaiTexture() {
  const c = canvas(256, 128);
  const g = c.getContext("2d");
  g.fillStyle = "#e8e6df";
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = "#1d1d1d";
  g.fillRect(0, 64, 256, 64);
  g.strokeStyle = "#888";
  for (let k = 8; k < 128; k += 8) {
    g.beginPath();
    g.moveTo(0, k);
    g.lineTo(256, k);
    g.stroke();
  }
  g.fillStyle = "#ff8a2a";
  g.fillRect(0, 62, 256, 4);
  return tex(c);
}

/* ---- the layout ------------------------------------------------------------------------------- */
/** Panel placements: id → { c, U, V, w, h } (model units), the face a little proud of the skin. */
export function panelLayout() {
  const e3 = edgeFrame(3);
  const u3 = e3.L * 0.5;
  const P = {};
  const onFace = (i, x, u, w, h, lift = 0.011) => ({ ...edgeAxes(i, x, u, lift), w, h });
  P.left = onFace(3, 0.18, u3, 0.17, 0.142);
  P.centre = onFace(3, 0.0, u3, 0.17, 0.142);
  P.right = onFace(3, -0.18, u3, 0.17, 0.142);
  const e2 = edgeFrame(2);
  P.cbL = onFace(2, 0.185, e2.L * 0.62, 0.17, 0.085);
  P.cbR = onFace(2, -0.185, e2.L * 0.62, 0.17, 0.085);
  P.hatch = onFace(2, 0.0, e2.L * 0.55, 0.15, 0.13, 0.012);
  // side walls: the right wall (−X) faces +X; its "right" (seen from inside) is aft (−Z)
  P.comms = { c: [-W + 0.004, 0.7, 0.02], U: [0, 0, -1], V: [0, 1, 0], w: 0.2, h: 0.15 };
  P.cbWall = { c: [W - 0.004, 0.71, -0.02], U: [0, 0, 1], V: [0, 1, 0], w: 0.22, h: 0.11 };
  // aft wall faces +Z; seen from inside its right is +X
  P.eva = { c: [0, 0.64, INNER[7][0] + 0.03], U: [1, 0, 0], V: [0, 1, 0], w: 0.07, h: 0.07 };
  return P;
}

/** Indicator lamps: [x, y, z] model units and what drives them. */
export function lampLayout() {
  const P = panelLayout();
  const at = (p, fx, fy, lift = 0.0035) => {
    const n = new THREE.Vector3().crossVectors(V3(p.U), V3(p.V)).normalize();
    return [p.c[0] + p.U[0] * fx * p.w + p.V[0] * fy * p.h + n.x * lift, p.c[1] + p.U[1] * fx * p.w + p.V[1] * fy * p.h + n.y * lift, p.c[2] + p.U[2] * fx * p.w + p.V[2] * fy * p.h + n.z * lift];
  };
  const L = [];
  // ascent readiness on the pilot's panel (artwork boxes at x 130..176 / 512, y 288+34i .. /512)
  [0, 1, 2].forEach((i) => L.push({ id: `asc${i}`, pos: at(P.right, (153 - 256) / 512, (256 - (300 + i * 34)) / 512), size: 0.009 }));
  [0, 1, 2].forEach((i) => L.push({ id: `eva${i}`, pos: at(P.eva, (95 - 128) / 256, (128 - (81 + i * 46)) / 256), size: 0.0055 }));
  L.push({ id: "link", pos: at(P.comms, (455 - 256) / 512, (192 - 214) / 384), size: 0.008 });
  L.push({ id: "hatch", pos: at(P.hatch, 0.36, 0.38, 0.004), size: 0.008 });
  L.push({ id: "master", pos: at(P.centre, 0.42, 0.44), size: 0.008 });
  return L;
}

/** All static interior geometry, merged per material. */
export function cabinGeometry() {
  const P = panelLayout();
  const M = { shell: [shellGeometry()], frame: windowFrames(), metal: [], dark: [], soft: [], white: [], hoseBlue: [], hoseRed: [], floor: [] };
  // floor (a grating panel on the floor)
  const f0 = edgeFrame(0);
  M.floor.push(new THREE.PlaneGeometry(2 * W - 0.01, f0.L - 0.01).rotateX(-Math.PI / 2).translate(0, FLOOR_Y + 0.001, (f0.a[0] + f0.b[0]) / 2));
  // panel backing boxes (the faces are textured planes, drawn separately)
  Object.entries(P).forEach(([id, p]) => {
    if (id === "hatch") return;
    const n = new THREE.Vector3().crossVectors(V3(p.U), V3(p.V)).normalize();
    const back = [p.c[0] - n.x * 0.011, p.c[1] - n.y * 0.011, p.c[2] - n.z * 0.011];
    M.dark.push(slab(back, p.U, p.V, p.w + 0.008, p.h + 0.008, 0.0105));
  });
  // a glare shield over the three main panels
  const top = edgeAxes(3, 0, edgeFrame(3).L * 0.97, 0.03);
  M.dark.push(slab(top.c, top.U, [0, 1, 0], 0.56, 0.008, 0.03));
  // the forward hatch: a raised door with a frame, hinges and its handle
  const h = P.hatch;
  const hn = new THREE.Vector3().crossVectors(V3(h.U), V3(h.V)).normalize();
  const hb = [h.c[0] - hn.x * 0.012, h.c[1] - hn.y * 0.012, h.c[2] - hn.z * 0.012];
  M.white.push(slab(hb, h.U, h.V, 0.17, 0.15, 0.01));
  M.metal.push(slab(hb, h.U, h.V, 0.19, 0.17, 0.004));
  const hp = (fx, fy, d) => [h.c[0] + h.U[0] * fx + h.V[0] * fy + hn.x * d, h.c[1] + h.U[1] * fx + h.V[1] * fy + hn.y * d, h.c[2] + h.U[2] * fx + h.V[2] * fy + hn.z * d];
  M.metal.push(tube([hp(-0.03, -0.045, 0.002), hp(-0.03, -0.045, 0.016), hp(0.03, -0.045, 0.016), hp(0.03, -0.045, 0.002)], 0.0035, 12));
  [-0.05, 0.05].forEach((fy) => M.metal.push(rod(hp(-0.09, fy, 0.004), hp(-0.075, fy, 0.004), 0.006, 8)));
  // roof: transverse beams, the docking (overhead) hatch ring, two floodlight housings
  const roofY = INNER[5][1];
  [-0.16, 0.06].forEach((z) => M.metal.push(box(2 * W, 0.012, 0.016, 0, roofY - 0.006, z)));
  M.metal.push(new THREE.TorusGeometry(0.075, 0.008, 8, 32).rotateX(Math.PI / 2).translate(0, roofY - 0.006, -0.05));
  M.white.push(new THREE.CylinderGeometry(0.068, 0.068, 0.006, 28).translate(0, roofY - 0.004, -0.05));
  M.metal.push(rod([-0.03, roofY - 0.015, -0.05], [0.03, roofY - 0.015, -0.05], 0.0035));
  [0.14, -0.14].forEach((x) => M.dark.push(box(0.05, 0.016, 0.03, x, roofY - 0.008, -0.1)));
  // side-wall stringers and handholds
  [-1, 1].forEach((sx) => {
    // stringers either side of the wall panels (never across them)
    [-0.2, 0.16].forEach((z) => M.metal.push(box(0.01, 0.4, 0.014, sx * (W - 0.005), FLOOR_Y + 0.2, z)));
    // a handhold by each window and by the hatch
    M.metal.push(tube([[sx * 0.24, 0.72, 0.2], [sx * 0.25, 0.745, 0.19], [sx * 0.26, 0.77, 0.17]], 0.004, 8));
    M.metal.push(tube([[sx * 0.1, 0.5, 0.235], [sx * 0.11, 0.53, 0.25], [sx * 0.1, 0.56, 0.255]], 0.004, 8));
    // armrests at each station
    M.dark.push(box(0.035, 0.012, 0.09, sx * 0.21, 0.6, 0.15));
    M.metal.push(rod([sx * 0.21, 0.594, 0.11], [sx * 0.21, FLOOR_Y, 0.11], 0.004));
    // stowage bags low on each wall
    const bag = new THREE.BoxGeometry(0.02, 0.09, 0.14, 1, 2, 2);
    const p = bag.attributes.position;
    for (let k = 0; k < p.count; k++) p.setX(k, p.getX(k) * (1 - 0.25 * Math.abs(p.getY(k)) / 0.045));
    bag.computeVertexNormals();
    M.soft.push(bag.translate(sx * (W - 0.012), FLOOR_Y + 0.08, -0.12));
  });
  // the ascent engine cover ("doghouse") in the aft cabin floor
  const dog = new THREE.CylinderGeometry(0.105, 0.105, 0.19, 24, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2);
  M.soft.push(dog.translate(0, FLOOR_Y, -0.125));
  M.soft.push(box(0.21, 0.004, 0.19, 0, FLOOR_Y + 0.002, -0.125));
  // the two backpacks (PLSS) stowed on the aft wall, and their oxygen and water hoses
  const aftZ = INNER[7][0];
  [-1, 1].forEach((sx) => {
    M.white.push(new THREE.BoxGeometry(0.13, 0.15, 0.05, 2, 2, 1).translate(sx * 0.1, 0.62, aftZ + 0.027));
    M.dark.push(box(0.135, 0.012, 0.054, sx * 0.1, 0.6, aftZ + 0.027));
    M.metal.push(box(0.05, 0.018, 0.012, sx * 0.1, 0.705, aftZ + 0.052)); // the OPS on top
    M.hoseBlue.push(tube([[sx * 0.05, 0.6, aftZ + 0.06], [sx * 0.07, 0.5, aftZ + 0.12], [sx * 0.16, 0.45, aftZ + 0.2], [sx * 0.24, 0.52, aftZ + 0.25]], 0.006, 24));
    M.hoseRed.push(tube([[sx * 0.06, 0.58, aftZ + 0.06], [sx * 0.09, 0.47, aftZ + 0.13], [sx * 0.19, 0.44, aftZ + 0.19], [sx * 0.26, 0.5, aftZ + 0.22]], 0.006, 24));
  });
  // stowage lockers high on the aft wall
  M.white.push(box(0.5, 0.05, 0.04, 0, 0.75, aftZ + 0.02));
  M.dark.push(box(0.003, 0.05, 0.042, 0, 0.75, aftZ + 0.02));
  const merge = (list) => (list.length ? mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => {
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", g.attributes.position);
    out.setAttribute("normal", g.attributes.normal || g.computeVertexNormals() || g.attributes.normal);
    if (g.attributes.uv) out.setAttribute("uv", g.attributes.uv);
    else out.setAttribute("uv", new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 2).fill(0), 2));
    return out;
  })) : null);
  const out = {};
  Object.entries(M).forEach(([k, list]) => (out[k] = k === "shell" ? list[0] : merge(list)));
  return out;
}

/** A panel face's plane (with the panel's own uv). */
export function panelPlane(p) {
  return plane(p.c, p.U, p.V, p.w, p.h);
}
/** Breaker knobs on the breaker panels (instanced cylinders): their matrices. */
export function breakerMatrices() {
  const P = panelLayout();
  const out = [];
  ["cbL", "cbR", "cbWall"].forEach((id) => {
    const p = P[id];
    const n = new THREE.Vector3().crossVectors(V3(p.U), V3(p.V)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 14; c++) {
        const fx = (28 + c * 34 - 256) / 512;
        const fy = (128 - (60 + r * 46)) / 256;
        const pos = new THREE.Vector3(p.c[0] + p.U[0] * fx * p.w + p.V[0] * fy * p.h, p.c[1] + p.U[1] * fx * p.w + p.V[1] * fy * p.h, p.c[2] + p.U[2] * fx * p.w + p.V[2] * fy * p.h).addScaledVector(n, 0.002);
        const pulled = (r * 14 + c) % 23 === 7; // a couple pulled out (a real panel is never uniform)
        out.push(new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, pulled ? 1.7 : 1, 1)));
      }
  });
  return out;
}
/** Where the attitude ball sits (the commander's panel). */
export function fdaiPlace() {
  const p = panelLayout().left;
  const fx = (170 - 256) / 512;
  const fy = (256 - 200) / 512;
  const n = new THREE.Vector3().crossVectors(V3(p.U), V3(p.V)).normalize();
  return { pos: [p.c[0] + p.U[0] * fx * p.w + p.V[0] * fy * p.h, p.c[1] + p.U[1] * fx * p.w + p.V[1] * fy * p.h, p.c[2] + p.U[2] * fx * p.w + p.V[2] * fy * p.h], n: [n.x, n.y, n.z], r: 0.026 };
}
