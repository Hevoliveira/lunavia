/*
 * COUNTDOWN TO LAUNCH — the command module's cabin, built for first-person close range (metres).
 *
 * The frame is the commander's: seated (reclined) in the left couch, +x to his right, +y up the
 * couch's back, −z ahead. The main display console spans the cabin above and ahead of the three
 * couches, its panels turned to face the crew; above it the rendezvous windows, overhead the hatch.
 * A simplified, LUNAVIA-styled interior inspired by the Apollo command module (not a replica).
 *
 * Panels are canvas-drawn: gauges, switch rows with guards, lamp matrices, the guidance computer's
 * display and keyboard, the attitude ball. The lamps that the checklist turns on are separate small
 * meshes (CmCabin switches their colours).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CABIN_LOOK } from "@/data/preLaunch";

/** The commander's eye and the couches' places (m). */
export const EYE = [-0.72, 1.12, 0.18];
export const COUCHES = [-0.72, 0.02, 0.76];
export const PANEL_DIST = 1.1;

/** A look (yaw + to the left, pitch + up; rad) as a direction from the eye. */
export function lookVector(yaw, pitch) {
  return [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
}

/** The console's panels: the four the player may inspect (data/preLaunch CABIN_PANELS) and two more. */
export const CONSOLE = [
  { id: "entry", look: { yaw: 0.84, pitch: 0.42 }, size: [0.4, 0.3] },
  { id: "flight", look: { yaw: 0.42, pitch: 0.46 }, size: [0.42, 0.31] },
  { id: "guidance", look: { yaw: 0.0, pitch: 0.5 }, size: [0.4, 0.32] },
  { id: "caution", look: { yaw: -0.42, pitch: 0.46 }, size: [0.42, 0.29] },
  { id: "power", look: { yaw: -0.8, pitch: 0.42 }, size: [0.4, 0.3] },
  { id: "comms", look: { yaw: -1.14, pitch: 0.62 }, size: [0.36, 0.26] },
];
/** A panel's centre and its orientation (it faces the eye). */
export function panelPlace(p, dist = PANEL_DIST) {
  const d = lookVector(p.look.yaw, p.look.pitch);
  const c = [EYE[0] + d[0] * dist, EYE[1] + d[1] * dist, EYE[2] + d[2] * dist];
  // the panel's +z (its face) towards the eye: Matrix4.lookAt(eye, target) builds z = eye − target
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(...EYE), new THREE.Vector3(...c), new THREE.Vector3(0, 1, 0));
  return { c, q: new THREE.Quaternion().setFromRotationMatrix(m) };
}

/* ---- the panels' faces ------------------------------------------------------------------------- */
function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}
function texOf(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}
const INK = "#ebe8de";
function frame(g, w, h, title) {
  g.fillStyle = "#43474b";
  g.fillRect(0, 0, w, h);
  // the panel's brushed finish
  const r = rng(w + h);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(255,255,255,${r() * 0.035})`;
    g.fillRect(r() * w, r() * h, 6, 1);
  }
  g.strokeStyle = "#1f2224";
  g.lineWidth = 6;
  g.strokeRect(3, 3, w - 6, h - 6);
  // the corner screws
  g.fillStyle = "#8d9196";
  for (const [x, y] of [
    [14, 14],
    [w - 14, 14],
    [14, h - 14],
    [w - 14, h - 14],
  ]) {
    g.beginPath();
    g.arc(x, y, 5, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = INK;
  g.font = "bold 20px Helvetica, Arial, sans-serif";
  g.textAlign = "center";
  g.fillText(title, w / 2, 32);
}
function gauge(g, x, y, r, label, needle = 0.35) {
  g.fillStyle = "#121315";
  g.beginPath();
  g.arc(x, y, r + 5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#1b1d1f";
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 2;
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * (0.75 + (1.5 * i) / 10);
    g.beginPath();
    g.moveTo(x + Math.cos(a) * r * 0.78, y + Math.sin(a) * r * 0.78);
    g.lineTo(x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92);
    g.stroke();
  }
  const a = Math.PI * (0.75 + 1.5 * needle);
  g.strokeStyle = "#f2efe4";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8);
  g.stroke();
  g.fillStyle = INK;
  g.font = "bold 12px Helvetica, Arial, sans-serif";
  g.textAlign = "center";
  g.fillText(label, x, y + r + 20);
}
function switches(g, x, y, n, dx, labels = [], guard = false) {
  for (let i = 0; i < n; i++) {
    const cx = x + i * dx;
    g.fillStyle = "#16181a";
    g.beginPath();
    g.arc(cx, y, 9, 0, Math.PI * 2);
    g.fill();
    // the toggle's lever, lit from above
    const grd = g.createLinearGradient(cx - 3, y - 18, cx + 3, y);
    grd.addColorStop(0, "#f2f2ee");
    grd.addColorStop(1, "#8a8d90");
    g.fillStyle = grd;
    g.fillRect(cx - 3, y - 20, 6, 20);
    if (guard) {
      g.strokeStyle = "#d63b20";
      g.lineWidth = 3;
      g.strokeRect(cx - 12, y - 26, 24, 34);
    }
    if (labels[i]) {
      g.fillStyle = INK;
      g.font = "bold 10px Helvetica, Arial, sans-serif";
      g.textAlign = "center";
      g.fillText(labels[i], cx, y + 24);
    }
  }
}
function talkback(g, x, y, label) {
  g.fillStyle = "#0f1011";
  g.beginPath();
  g.arc(x, y, 12, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#2b2d30";
  g.fillRect(x - 7, y - 3, 14, 6);
  g.fillStyle = INK;
  g.font = "bold 9px Helvetica, Arial, sans-serif";
  g.textAlign = "center";
  g.fillText(label, x, y + 24);
}
function sevenSeg(g, x, y, text, size = 26) {
  g.fillStyle = "#0b120c";
  g.fillRect(x - 4, y - size - 2, text.length * size * 0.62 + 8, size + 8);
  g.fillStyle = "#79e389";
  g.font = `bold ${size}px "Courier New", monospace`;
  g.textAlign = "left";
  g.fillText(text, x, y);
}

/** Each panel's face (a canvas texture). */
export function panelTextures() {
  const W = 512;
  const out = {};
  const draw = (id, h, fn) => {
    const c = canvas(W, h);
    const g = c.getContext("2d");
    fn(g, W, h);
    out[id] = texOf(c);
  };
  draw("entry", 380, (g, w, h) => {
    frame(g, w, h, "ENTRY MONITOR · SCS");
    g.fillStyle = "#0e1517";
    g.fillRect(40, 56, 200, 150);
    g.strokeStyle = "#5fcf86";
    g.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.moveTo(40, 190 - i * 22);
      g.bezierCurveTo(100, 180 - i * 20, 160, 120 - i * 10, 238, 70 + i * 4);
      g.stroke();
    }
    gauge(g, 360, 130, 62, "G METER", 0.18);
    switches(g, 70, 280, 6, 70, ["SCS", "BMAG", "RATE", "ATT", "ROLL", "PITCH"]);
  });
  draw("flight", 365, (g, w, h) => {
    frame(g, w, h, "FLIGHT CONTROLS");
    // the attitude ball (FDAI): its window, the ball (black above, white below), the needles
    g.fillStyle = "#0c0d0e";
    g.beginPath();
    g.arc(160, 170, 102, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.beginPath();
    g.arc(160, 170, 88, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = "#e8e6df";
    g.fillRect(60, 170, 200, 100);
    g.fillStyle = "#262729";
    g.fillRect(60, 70, 200, 100);
    g.strokeStyle = "#e2531f";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(60, 170);
    g.lineTo(260, 170);
    g.stroke();
    g.restore();
    g.strokeStyle = "#ffcf3a";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(110, 170);
    g.lineTo(145, 170);
    g.moveTo(175, 170);
    g.lineTo(210, 170);
    g.stroke();
    g.fillStyle = INK;
    g.font = "bold 12px Helvetica, Arial, sans-serif";
    g.textAlign = "center";
    g.fillText("FDAI", 160, 292);
    gauge(g, 340, 110, 42, "ALT (FT)", 0.02);
    gauge(g, 440, 110, 42, "VEL", 0.02);
    sevenSeg(g, 300, 236, "00 00 00", 24);
    g.fillStyle = INK;
    g.font = "bold 11px Helvetica, Arial, sans-serif";
    g.fillText("EVENT TIMER", 380, 262);
    switches(g, 300, 322, 4, 50, ["LV", "SII", "ABORT", "EDS"], true);
  });
  draw("guidance", 410, (g, w, h) => {
    frame(g, w, h, "GUIDANCE COMPUTER");
    // the display: COMP ACTY, PROG, VERB, NOUN, three registers
    g.fillStyle = "#121314";
    g.fillRect(36, 52, 210, 270);
    g.fillStyle = INK;
    g.font = "bold 11px Helvetica, Arial, sans-serif";
    g.textAlign = "left";
    g.fillText("PROG", 150, 76);
    g.fillText("VERB", 56, 136);
    g.fillText("NOUN", 150, 136);
    sevenSeg(g, 150, 110, "02", 28);
    sevenSeg(g, 56, 168, "16", 28);
    sevenSeg(g, 150, 168, "65", 28);
    sevenSeg(g, 56, 214, "+00000", 26);
    sevenSeg(g, 56, 254, "+00000", 26);
    sevenSeg(g, 56, 294, "+00000", 26);
    // the keyboard
    const keys = ["VERB", "+", "7", "8", "9", "CLR", "NOUN", "-", "4", "5", "6", "PRO", "", "0", "1", "2", "3", "KEY REL", "ENTR", "RSET"];
    keys.forEach((k, i) => {
      const cx = 268 + (i % 4) * 58;
      const cy = 66 + Math.floor(i / 4) * 64;
      if (!k) return;
      g.fillStyle = "#24262a";
      g.fillRect(cx, cy, 50, 52);
      g.fillStyle = "#3b3e43";
      g.fillRect(cx + 3, cy + 3, 44, 46);
      g.fillStyle = INK;
      g.font = `bold ${k.length > 3 ? 10 : 18}px Helvetica, Arial, sans-serif`;
      g.textAlign = "center";
      g.fillText(k, cx + 25, cy + 32);
    });
  });
  draw("caution", 340, (g, w, h) => {
    frame(g, w, h, "CAUTION AND WARNING");
    const names = ["CRYO PRESS", "O2 FLOW", "SM RCS A", "SM RCS B", "CM RCS 1", "CM RCS 2", "BUS A UV", "BUS B UV", "FC 1", "FC 2", "FC 3", "BAT CHG", "CABIN PRESS", "GLYCOL", "SUIT COMP", "CO2 PP", "GMBL MTR", "SPS PRESS", "CMC", "ISS", "PITCH GMBL", "YAW GMBL", "C/W", "MN BUS A", "MN BUS B", "AC BUS 1", "AC BUS 2", "O2 HTR", "H2 FLOW", "CREW ALERT", "UPLINK", "MASTER"];
    const cols = 4;
    names.forEach((n, i) => {
      const x = 30 + (i % cols) * 115;
      const y = 56 + Math.floor(i / cols) * 34;
      g.fillStyle = "#1a1b1c";
      g.fillRect(x, y, 106, 28);
      g.fillStyle = "#5c5a53";
      g.font = "bold 10px Helvetica, Arial, sans-serif";
      g.textAlign = "center";
      g.fillText(n, x + 53, y + 18);
    });
  });
  draw("power", 375, (g, w, h) => {
    frame(g, w, h, "ELECTRICAL POWER");
    gauge(g, 110, 130, 56, "DC VOLTS", 0.62);
    gauge(g, 250, 130, 56, "DC AMPS", 0.34);
    gauge(g, 390, 130, 56, "AC VOLTS", 0.6);
    switches(g, 60, 262, 8, 56, ["FC1", "FC2", "FC3", "BAT A", "BAT B", "BAT C", "INV 1", "INV 2"]);
    talkback(g, 90, 322, "MN A");
    talkback(g, 170, 322, "MN B");
    talkback(g, 250, 322, "AC 1");
  });
  draw("comms", 365, (g, w, h) => {
    frame(g, w, h, "AUDIO CONTROL");
    const knobs = ["S-BAND", "VHF AM", "INTERCOM", "PAD COMM", "MASTER"];
    knobs.forEach((k, i) => {
      const x = 70 + i * 92;
      g.fillStyle = "#121315";
      g.beginPath();
      g.arc(x, 120, 30, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#2f3236";
      g.beginPath();
      g.arc(x, 120, 22, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x, 120);
      g.lineTo(x + 14, 106);
      g.stroke();
      g.fillStyle = INK;
      g.font = "bold 11px Helvetica, Arial, sans-serif";
      g.textAlign = "center";
      g.fillText(k, x, 172);
    });
    switches(g, 70, 262, 5, 92, ["T/R", "T/R", "T/R", "ON", "PTT"]);
  });
  return out;
}

/**
 * The lamps the checklist lights, in each panel's artwork pixels (512 wide, H tall: panelTextures),
 * so they sit on what is drawn whatever the panel's size: { H, list: [{ x, y, w, h, warn }] }.
 */
export const LAMPS = {
  caution: { H: 340, list: Array.from({ length: 32 }, (_, i) => ({ x: 30 + (i % 4) * 115, y: 56 + Math.floor(i / 4) * 34, w: 106, h: 28, warn: i === 12 })) },
  guidance: { H: 410, list: [{ x: 44, y: 60, w: 92, h: 30 }] },
  comms: { H: 365, list: [0, 1, 2, 3, 4].map((i) => ({ x: 62 + i * 92, y: 182, w: 16, h: 10 })) },
  flight: { H: 365, list: [{ x: 290, y: 278, w: 22, h: 12 }, { x: 340, y: 278, w: 22, h: 12 }, { x: 390, y: 278, w: 22, h: 12 }, { x: 440, y: 278, w: 22, h: 12 }] },
  power: { H: 375, list: [{ x: 80, y: 316, w: 20, h: 12 }, { x: 160, y: 316, w: 20, h: 12 }, { x: 240, y: 316, w: 20, h: 12 }] },
};
/** A lamp's place on its panel (panel-local metres, the panel's centre at 0). */
export function lampLocal(panel, l) {
  const H = LAMPS[panel.id].H;
  const [w, h] = panel.size;
  return { u: ((l.x + l.w / 2) / 512 - 0.5) * w, v: (0.5 - (l.y + l.h / 2) / H) * h, w: (l.w / 512) * w, h: (l.h / H) * h };
}

/* ---- the cabin's body ---------------------------------------------------------------------------- */
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const rod = (a, b, r, seg = 8) => {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const g = new THREE.CylinderGeometry(r, r, A.distanceTo(B), seg, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
  return g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
};
const clean = (g) => {
  const o = g.index ? g.toNonIndexed() : g;
  if (!o.attributes.uv) o.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(o.attributes.position.count * 2), 2));
  for (const k of Object.keys(o.attributes)) if (!["position", "normal", "uv"].includes(k)) o.deleteAttribute(k);
  return o;
};
const merge = (list) => mergeGeometries(list.map(clean), false);

/**
 * The cabin's shell and furniture by material: shell (quilted wall, inside a truncated cone round
 * the crew), frame (the console's body), rib (the wall ribs), couch, strut, cable, window (the windows'
 * glow), hatch (the hatch's inner face, about its hinge).
 */
export function cabinGeometry() {
  // the shell: a cone round the crew, its axis along the couches' backs (y), the console's arc in it
  const shell = new THREE.CylinderGeometry(1.05, 1.95, 2.6, 40, 6, true, 0, Math.PI * 2).translate(0, 1.0, -0.15);
  shell.scale(1, 1, 0.92);
  const shellIn = shell.toNonIndexed();
  // flip it to face inward
  const p = shellIn.attributes.position;
  for (let i = 0; i < p.count; i += 3) {
    const x = p.getX(i + 1);
    const y = p.getY(i + 1);
    const z = p.getZ(i + 1);
    p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
    p.setXYZ(i + 2, x, y, z);
  }
  shellIn.computeVertexNormals();
  const floor = new THREE.CircleGeometry(1.95, 40).rotateX(-Math.PI / 2).translate(0, -0.3, -0.15);
  const roof = new THREE.CircleGeometry(1.05, 32).rotateX(Math.PI / 2).translate(0, 2.3, -0.15);

  const frame = [];
  // the console: a dark band round the commander's eye just behind the panels (yaw −0.95..1.1,
  // pitch 0.05..0.75) with a lip along its lower edge, and a raised wing to the right (yaw
  // −1.34..−0.95, pitch 0.42..0.82) carrying the audio panel over the other couches' helmets
  const bandPart = (yaw0, yaw1, p0, p1) => {
    const g = new THREE.SphereGeometry(PANEL_DIST + 0.03, 40, 10, yaw0 - Math.PI / 2, yaw1 - yaw0, Math.PI / 2 - p1, p1 - p0).translate(EYE[0], EYE[1], EYE[2]);
    const bi = g.index;
    for (let i = 0; i < bi.count; i += 3) {
      const a = bi.getX(i + 1);
      bi.setX(i + 1, bi.getX(i + 2));
      bi.setX(i + 2, a);
    }
    g.computeVertexNormals();
    return g;
  };
  frame.push(bandPart(-0.95, 1.1, 0.05, 0.75), bandPart(-1.34, -0.95, 0.42, 0.82));
  const lip = new THREE.TorusGeometry(PANEL_DIST + 0.02, 0.025, 6, 40, 2.05).rotateX(Math.PI / 2);
  // the arc's points sit at yaw −π/2 − a (a 0..len); turned by yaw0 + len + π/2 they run yaw0..yaw0 + len
  lip.rotateY(-0.95 + 2.05 + Math.PI / 2).translate(EYE[0], EYE[1] + (PANEL_DIST + 0.02) * Math.sin(0.05), EYE[2]);
  frame.push(lip);
  // what holds the console up: braces from the band's ends and middle out to the cabin's wall, and a
  // beam from its top to the roof ring (the shell: a cone round y, radius 1.95 at y −0.3 to 1.05 at 2.3)
  const shellR = (y) => 1.95 - (0.9 * (y + 0.3)) / 2.6;
  const toWall = (p, dir) => {
    const q = [...p];
    for (let i = 0; i < 400; i++) {
      q[0] += dir[0] * 0.01;
      q[1] += dir[1] * 0.01;
      q[2] += dir[2] * 0.01;
      if (Math.hypot(q[0], (q[2] + 0.15) / 0.92) > shellR(q[1]) - 0.04) break;
    }
    return q;
  };
  const onBand = (yaw, pitch, r = PANEL_DIST + 0.05) => {
    const d = lookVector(yaw, pitch);
    return [EYE[0] + d[0] * r, EYE[1] + d[1] * r, EYE[2] + d[2] * r];
  };
  for (const [yaw, pitch] of [[1.08, 0.35], [-0.93, 0.3], [-1.32, 0.6]]) {
    const p = onBand(yaw, pitch);
    const d = lookVector(yaw, 0.15);
    frame.push(rod(p, toWall(p, d), 0.028, 8));
  }
  {
    const p = onBand(0.05, 0.74);
    frame.push(rod(p, [p[0] * 0.6, 2.28, p[2] * 0.6 - 0.06], 0.03, 8));
  }
  // ribs up the walls (painted like the wall's frame, not the console's dark grey)
  const rib = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.52;
    rib.push(rod([Math.cos(a) * 1.86, -0.25, -0.15 + Math.sin(a) * 1.71], [Math.cos(a) * 1.08, 2.25, -0.15 + Math.sin(a) * 0.99], 0.018));
  }
  // stowage lockers low behind the couches
  frame.push(box(2.6, 0.5, 0.45, 0, -0.05, 1.05));
  for (let i = 0; i < 5; i++) frame.push(box(0.012, 0.42, 0.01, -1.04 + i * 0.52, -0.05, 0.82));

  // the couches: frames, seat pans, back pads, head rests, struts to the floor
  const couch = [];
  const strut = [];
  for (const x of COUCHES) {
    const seat = box(0.56, 0.08, 0.6, x, 0.42, 0.15);
    const back = box(0.56, 0.08, 0.9, 0, 0, 0).rotateX(-Math.PI / 2 + 0.6).translate(x, 0.86, 0.62);
    const head = box(0.34, 0.08, 0.28, 0, 0, 0).rotateX(-Math.PI / 2 + 0.6).translate(x, 1.36, 0.97);
    const legs = box(0.5, 0.06, 0.5, 0, 0, 0).rotateX(0.35).translate(x, 0.28, -0.32);
    couch.push(seat, back, head, legs);
    strut.push(rod([x - 0.24, -0.3, 0.3], [x - 0.24, 0.38, 0.2], 0.03), rod([x + 0.24, -0.3, 0.3], [x + 0.24, 0.38, 0.2], 0.03));
    strut.push(rod([x - 0.27, 0.42, -0.12], [x - 0.27, 0.42, 0.46], 0.022), rod([x + 0.27, 0.42, -0.12], [x + 0.27, 0.42, 0.46], 0.022));
    strut.push(rod([x, -0.3, 0.9], [x, 0.7, 0.8], 0.035)); // the attenuator strut
  }
  // cable bundles along the walls
  const cable = [];
  for (const s of [1, -1]) {
    cable.push(rod([s * 1.6, 0.05, -0.75], [s * 1.25, 1.55, -0.55], 0.03, 6));
    cable.push(rod([s * 1.62, 0.12, -0.7], [s * 1.28, 1.6, -0.5], 0.022, 6));
  }

  // the windows' openings: two rendezvous windows above the console, a side window each side
  const windows = [];
  for (const [x, y, z, ry, rx] of [
    [-0.55, 2.0, -0.85, 0.25, 0.75],
    [0.55, 2.0, -0.85, -0.25, 0.75],
    [-1.55, 1.1, -0.5, 1.15, 0.2],
    [1.55, 1.1, -0.5, -1.15, 0.2],
  ])
    windows.push(new THREE.PlaneGeometry(0.28, 0.24).rotateX(rx).rotateY(ry).translate(x, y, z));
  // the hatch overhead (its window in the middle), drawn about its hinge (the hinge on its −z edge)
  const hatch = merge([box(0.8, 0.06, 0.72, 0, 0, 0.36), box(0.16, 0.03, 0.16, 0, -0.045, 0.36), box(0.06, 0.03, 0.3, 0.28, -0.045, 0.36)]);
  // its inner face (what the crew see from the couches): the window, bolts, the latch handle
  const hatchFace = new THREE.PlaneGeometry(0.76, 0.68).rotateX(Math.PI / 2).translate(0, -0.032, 0.36);
  return {
    shell: merge([shellIn, floor, roof]),
    frame: merge(frame),
    rib: merge(rib),
    couch: merge(couch),
    strut: merge(strut),
    cable: merge(cable),
    windows: merge(windows),
    hatch,
    hatchFace,
    hatchHinge: [0.02, 2.12, -0.42],
  };
}

/** The quilted wall's texture (Beta-cloth bags and their stitching). */
export function quiltTexture() {
  const c = canvas(256, 256);
  const g = c.getContext("2d");
  g.fillStyle = "#b3b0a6";
  g.fillRect(0, 0, 256, 256);
  const r = rng(77);
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = `rgba(0,0,0,${r() * 0.05})`;
    g.fillRect(r() * 256, r() * 256, 3, 3);
  }
  g.strokeStyle = "rgba(90,88,80,0.28)";
  g.lineWidth = 2;
  for (let x = 0; x <= 256; x += 64) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 256);
    g.stroke();
  }
  for (let y = 0; y <= 256; y += 85) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y);
    g.stroke();
  }
  g.fillStyle = "rgba(255,255,255,0.06)";
  for (let x = 0; x < 256; x += 64) g.fillRect(x + 8, 0, 18, 256);
  const t = texOf(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 2);
  return t;
}
/** The hatch's inner face: brushed metal, its rim, the round window, a ring of bolts, the latch. */
export function hatchFaceTexture() {
  const c = canvas(512, 460);
  const g = c.getContext("2d");
  const w = 512;
  const h = 460;
  g.fillStyle = "#a9aca8";
  g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 2) {
    g.fillStyle = `rgba(255,255,255,${0.03 + 0.03 * Math.sin(y * 0.7)})`;
    g.fillRect(0, y, w, 1);
  }
  g.strokeStyle = "#5d605e";
  g.lineWidth = 14;
  g.strokeRect(7, 7, w - 14, h - 14);
  g.strokeStyle = "#838683";
  g.lineWidth = 3;
  g.strokeRect(26, 26, w - 52, h - 52);
  // the window: a deep bezel, the glass (the white room's light), a ring of bolts
  const cx = w / 2;
  const cy = h / 2 - 10;
  g.fillStyle = "#3b3e3f";
  g.beginPath();
  g.arc(cx, cy, 92, 0, Math.PI * 2);
  g.fill();
  const grd = g.createRadialGradient(cx - 20, cy - 25, 8, cx, cy, 72);
  grd.addColorStop(0, "#f4f6f3");
  grd.addColorStop(0.6, "#b9c3c8");
  grd.addColorStop(1, "#6d7a80");
  g.fillStyle = grd;
  g.beginPath();
  g.arc(cx, cy, 70, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#2a2c2d";
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    g.beginPath();
    g.arc(cx + Math.cos(a) * 82, cy + Math.sin(a) * 82, 4, 0, Math.PI * 2);
    g.fill();
  }
  // the latch handle on its gearbox, the latch bars to the edges, the stencils
  g.fillStyle = "#4b4e4f";
  g.fillRect(cx - 170, cy + 120, 120, 46);
  g.fillStyle = "#1e2021";
  g.fillRect(cx - 160, cy + 106, 22, 74);
  g.fillStyle = "#6c6f6e";
  for (const x of [60, w - 80]) g.fillRect(x, cy - 6, 20, 12);
  g.fillStyle = "#b02a1c";
  g.font = "bold 22px Helvetica, Arial, sans-serif";
  g.textAlign = "center";
  g.fillText("UNLATCH ◀  ▶ LATCH", cx + 70, cy + 150);
  g.fillStyle = "#222";
  g.font = "bold 18px Helvetica, Arial, sans-serif";
  g.fillText("CREW HATCH", cx, 60);
  return texOf(c);
}
/** What the windows show: the boost cover's white inner face lit by the morning (a bright glow). */
export function windowTexture() {
  const c = canvas(128, 128);
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64, 54, 6, 64, 64, 80);
  grd.addColorStop(0, "#fffaf0");
  grd.addColorStop(0.6, "#e8eef4");
  grd.addColorStop(1, "#9aa4ad");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return texOf(c);
}
export const LOOK_LIMITS = CABIN_LOOK;
