/*
 * COUNTDOWN TO LAUNCH — the crew access arm, the white room and the command module's hatch, built at
 * human scale (metres, the pad's frame: the rocket's axis at x = z = 0, the hardstand at y = 0, the
 * tower on +x; data/preLaunch). The launch scene draws them in a group scaled to its 30 m units, in
 * the place of the launch complex's own small arm (LaunchComplex hideCrewArm).
 *
 * Merged by material: the whole arm and white room cost about a dozen draw calls.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ARM, CM_ON_PAD, TOWER, WHITE_ROOM } from "@/data/preLaunch";
import { CM_PROFILE } from "@/data/csmDesign";

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const rod = (a, b, r, seg = 6) => {
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

/** The CM's radius (m) at a height y above its base (the heat shield's shoulder to the apex). */
export function cmRadiusAt(yLocal) {
  const P = CM_PROFILE;
  for (let i = 0; i < P.length - 1; i++) {
    const [r0, y0] = P[i];
    const [r1, y1] = P[i + 1];
    if (yLocal >= y0 && yLocal <= y1) return r0 + ((r1 - r0) * (yLocal - y0)) / (y1 - y0);
  }
  return yLocal < P[0][1] ? P[0][0] : 0;
}

/* ---- textures ---------------------------------------------------------------------------------- */
function canvasTex(w, h, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  t.anisotropy = 4;
  return t;
}
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/**
 * The arm's floor across its width (v 0..1 from one wall to the other), one metre along it per
 * repeat: diamond-plate edges, the yellow safety lines, the open steel grating down the middle.
 */
function floorTexture() {
  return canvasTex(
    256,
    256,
    (g, w, h) => {
      const r = rng(7);
      // diamond plate at the edges
      g.fillStyle = "#6f7378";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "rgba(205,210,214,0.35)";
      for (let y = 0; y < h; y += 12)
        for (let x = (y / 12) % 2 ? 6 : 0; x < w; x += 12) {
          g.save();
          g.translate(x + 3, y + 3);
          g.rotate(0.6);
          g.fillRect(-4, -1, 8, 2);
          g.restore();
        }
      // the grating: dark gaps between bearing bars along the walkway, cross rods every 10 cm
      const g0 = h * 0.2;
      const g1 = h * 0.8;
      g.fillStyle = "#1d1f22";
      g.fillRect(0, g0, w, g1 - g0);
      g.fillStyle = "#7d8186";
      for (let y = g0; y < g1; y += 7) g.fillRect(0, y, w, 2.6);
      g.fillStyle = "#5f6368";
      for (let x = 0; x < w; x += 25.6) g.fillRect(x, g0, 3, g1 - g0);
      // the yellow lines, worn
      g.fillStyle = "#d4ac1e";
      g.fillRect(0, h * 0.165, w, h * 0.03);
      g.fillRect(0, h * 0.805, w, h * 0.03);
      for (let i = 0; i < 900; i++) {
        g.fillStyle = `rgba(30,30,30,${0.05 + r() * 0.1})`;
        g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 2);
      }
    },
    { repeat: [1, 1] }
  );
}
/** The arm's wall panels, 1.2 m wide by 2.4 m from the floor: ribbed sheet, seams, rivets, a kick plate. */
function armWallTexture() {
  return canvasTex(
    256,
    512,
    (g, w, h) => {
      g.fillStyle = "#d4d5d0";
      g.fillRect(0, 0, w, h);
      const r = rng(19);
      for (let i = 0; i < 2600; i++) {
        const v = (r() - 0.5) * 16;
        g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`;
        g.fillRect(r() * w, r() * h, 2, 2);
      }
      // shallow ribs
      for (let x = 16; x < w; x += 32) {
        g.fillStyle = "rgba(255,255,255,0.25)";
        g.fillRect(x, 0, 3, h);
        g.fillStyle = "rgba(0,0,0,0.08)";
        g.fillRect(x + 3, 0, 3, h);
      }
      // the seam at the panel's edge, rivet rows, the grey kick plate (lowest 25 cm), a grime line
      g.fillStyle = "rgba(60,62,64,0.55)";
      g.fillRect(0, 0, 2, h);
      for (let y = 8; y < h; y += 22) g.fillRect(6, y, 2, 2);
      const kick = h * (1 - 0.25 / 2.4);
      g.fillStyle = "#7d8083";
      g.fillRect(0, kick, w, h - kick);
      g.fillStyle = "rgba(40,40,40,0.35)";
      g.fillRect(0, kick - 3, w, 3);
      g.fillStyle = "rgba(60,55,45,0.12)";
      g.fillRect(0, kick - 30, w, 27);
    },
    { repeat: [1, 1] }
  );
}
/** Black and yellow hazard stripes (the doorway into the white room, the joint's threshold). */
function hazardTexture() {
  return canvasTex(
    128,
    128,
    (g, w, h) => {
      g.fillStyle = "#e0b31c";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#17181a";
      for (let i = -2; i < 4; i++) {
        g.beginPath();
        g.moveTo(i * 64, 0);
        g.lineTo(i * 64 + 32, 0);
        g.lineTo(i * 64 + 32 + h, h);
        g.lineTo(i * 64 + h, h);
        g.fill();
      }
    },
    { repeat: [1, 1] }
  );
}
/** The arm's signs: the WHITE ROOM over the doorway, station numbers, the safety placards. */
function signTextures() {
  const sign = (w, h, draw) => canvasTex(w, h, draw);
  const text = (g, t, x, y, size, color, align = "left") => {
    g.fillStyle = color;
    g.font = `bold ${size}px Helvetica, Arial, sans-serif`;
    g.textAlign = align;
    g.fillText(t, x, y);
  };
  const out = {
    whiteRoom: sign(512, 112, (g, w, h) => {
      g.fillStyle = "#16181b";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#ff3b00";
      g.fillRect(16, 18, 8, h - 36);
      text(g, "WHITE ROOM", 40, 62, 48, "#f4f2ec");
      text(g, "LV-001 · COMMAND MODULE ACCESS", 42, 94, 20, "#9aa3ad");
    }),
    joint: sign(512, 128, (g, w, h) => {
      g.fillStyle = "#e9e8e2";
      g.fillRect(0, 0, w, h);
      text(g, "CREW ACCESS ARM · LC-39", w / 2, 56, 34, "#1b1d20", "center");
      text(g, "WHITE ROOM  20 M  ▶", w / 2, 102, 30, "#c43a1c", "center");
    }),
    noFlame: sign(256, 182, (g, w, h) => {
      g.fillStyle = "#f2f0ea";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#c2281c";
      g.fillRect(0, 0, w, 54);
      text(g, "DANGER", w / 2, 40, 34, "#ffffff", "center");
      text(g, "NO SMOKING", w / 2, 100, 26, "#1b1d20", "center");
      text(g, "NO OPEN FLAME", w / 2, 136, 26, "#1b1d20", "center");
      text(g, "HYPERGOLIC AREA", w / 2, 168, 18, "#1b1d20", "center");
    }),
    egress: sign(320, 128, (g, w, h) => {
      g.fillStyle = "#1f7a3a";
      g.fillRect(0, 0, w, h);
      text(g, "◀ EMERGENCY EGRESS", w / 2, 56, 26, "#ffffff", "center");
      text(g, "SLIDEWIRE · TOWER LEVEL 320", w / 2, 98, 18, "#d8f0de", "center");
    }),
    suitedOnly: sign(256, 168, (g, w, h) => {
      g.fillStyle = "#f2f0ea";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#1d4f9c";
      g.fillRect(0, 0, w, 50);
      text(g, "NOTICE", w / 2, 37, 30, "#ffffff", "center");
      text(g, "FLIGHT CREW AND", w / 2, 92, 22, "#1b1d20", "center");
      text(g, "CLOSEOUT TEAM ONLY", w / 2, 124, 22, "#1b1d20", "center");
    }),
  };
  for (const n of [2, 6, 10, 14])
    out[`station${n}`] = sign(256, 104, (g, w, h) => {
      g.fillStyle = "#16181b";
      g.fillRect(0, 0, w, h);
      text(g, `ARM STA ${String(n).padStart(2, "0")}`, w / 2, 66, 38, "#f2c230", "center");
    });
  return out;
}
/** The walls' painted panels (inside the arm): a light grey with seams and rivet rows. */
function panelTexture(base = "#d9dad6", seam = "rgba(90,92,95,0.45)") {
  return canvasTex(
    256,
    256,
    (g, w, h) => {
      g.fillStyle = base;
      g.fillRect(0, 0, w, h);
      const r = rng(31);
      for (let i = 0; i < 1400; i++) {
        const v = (r() - 0.5) * 18;
        g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`;
        g.fillRect(r() * w, r() * h, 2, 2);
      }
      g.strokeStyle = seam;
      g.lineWidth = 2;
      g.strokeRect(1, 1, w - 2, h - 2);
      g.fillStyle = "rgba(70,72,75,0.55)";
      for (let x = 8; x < w; x += 16) {
        g.fillRect(x, 6, 2, 2);
        g.fillRect(x, h - 8, 2, 2);
      }
    },
    { repeat: [1, 1] }
  );
}
/** The boost cover round the hatch: white, its panel seams, the hatch's stencils. */
function coverTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = "#eeede8";
    g.fillRect(0, 0, w, h);
    const r = rng(53);
    for (let i = 0; i < 3000; i++) {
      g.fillStyle = `rgba(120,118,112,${r() * 0.05})`;
      g.fillRect(r() * w, r() * h, 2, 2);
    }
    g.strokeStyle = "rgba(110,110,105,0.5)";
    g.lineWidth = 2;
    for (let x = 0; x <= w; x += 128) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
    for (let y = 0; y <= h; y += 170) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
    // stencils by the hatch (the texture's centre is the hatch)
    g.fillStyle = "#c2381b";
    g.font = "bold 18px Helvetica, Arial, sans-serif";
    g.textAlign = "center";
    g.fillText("RESCUE", w * 0.5, h * 0.18);
    g.fillText("PUSH TO OPEN", w * 0.5, h * 0.84);
    g.fillStyle = "#2a2a2a";
    g.font = "bold 14px Helvetica, Arial, sans-serif";
    g.fillText("LV-001 · CM", w * 0.82, h * 0.12);
  });
}
/** What one sees through the open hatch: the cabin lit, the centre couch, the console's glow. */
export function cabinGlimpseTexture() {
  return canvasTex(512, 384, (g, w, h) => {
    const grd = g.createRadialGradient(w * 0.5, h * 0.35, 20, w * 0.5, h * 0.45, w * 0.7);
    grd.addColorStop(0, "#6c6f6a");
    grd.addColorStop(0.5, "#34373a");
    grd.addColorStop(1, "#111214");
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    // the main display console, overhead: panels with ringed dials, toggle rows and a few lamps
    const r = rng(19);
    const panels = [[0.06, 0.07, 0.27], [0.355, 0.05, 0.29], [0.67, 0.07, 0.27]];
    for (const [x0, y0, pw] of panels) {
      g.fillStyle = "#4a4e52";
      g.fillRect(w * x0, h * y0, w * pw, h * 0.33);
      g.strokeStyle = "#25282b";
      g.lineWidth = 3;
      g.strokeRect(w * x0, h * y0, w * pw, h * 0.33);
      // two or three dials
      for (let i = 0; i < 3; i++) {
        const cx = w * (x0 + pw * (0.2 + i * 0.3));
        const cy = h * (y0 + 0.1);
        g.fillStyle = "#1c1e20";
        g.beginPath();
        g.arc(cx, cy, 15, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = "#b9bdb8";
        g.lineWidth = 2;
        g.stroke();
        g.beginPath();
        g.moveTo(cx, cy);
        const a = -2.2 + r() * 2.6;
        g.lineTo(cx + Math.cos(a) * 11, cy + Math.sin(a) * 11);
        g.stroke();
      }
      // a row of toggles and a row of lamps
      for (let i = 0; i < 6; i++) {
        const sx = w * (x0 + pw * (0.1 + i * 0.15));
        g.fillStyle = "#c9ccc8";
        g.fillRect(sx, h * (y0 + 0.2), 4, 12);
        g.fillStyle = r() < 0.3 ? "#8fd39c" : r() < 0.5 ? "#e8c46a" : "#2d3033";
        g.fillRect(sx - 3, h * (y0 + 0.27), 10, 6);
      }
    }
    // the couches: their frames and pads
    g.fillStyle = "#8a8f8f";
    for (const cx of [0.22, 0.5, 0.78]) {
      g.fillRect(w * (cx - 0.11), h * 0.55, w * 0.22, h * 0.09);
      g.fillRect(w * (cx - 0.09), h * 0.64, w * 0.18, h * 0.2);
    }
    g.fillStyle = "rgba(255,240,210,0.08)";
    g.fillRect(0, 0, w, h);
  });
}

/* ---- the arm ------------------------------------------------------------------------------------- */
/**
 * Planar texture coordinates in metres (the arm's surfaces are long boxes: their own UVs would
 * stretch one texture over the whole length). Each face takes the two world axes across it; `f`
 * may remap (u, v) per surface.
 */
function worldUV(g, su = 1, sv = 1, f = null) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    let u;
    let v;
    if (ay >= ax && ay >= az) [u, v] = [x, z];
    else if (az >= ax) [u, v] = [x, y];
    else [u, v] = [z, y];
    if (f) [u, v] = f(u, v, x, y, z);
    uv[i * 2] = u / su;
    uv[i * 2 + 1] = v / sv;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Where the arm's signs go (each a plane and the name of its texture in padMaterials' signs). */
export const ARM_SIGNS = ["whiteRoom", "station2", "station6", "station10", "station14", "noFlame", "egress", "joint", "suitedOnly"];

export function armGeometry() {
  const F = ARM.floor;
  const W = ARM.width;
  const H = ARM.height;
  const x0 = ARM.end;
  const x1 = TOWER.face + 1.9; // into the tower to the elevator's landing
  const L = x1 - x0;
  const cx = (x0 + x1) / 2;
  const wall = [];
  const floor = [];
  const frame = [];
  const truss = [];
  const glass = [];
  const lamp = [];
  const rail = [];
  const white = [];
  const red = [];
  const hazard = [];
  const conduit = [];
  const signs = {};
  const T = 0.06; // wall thickness
  const sill = 1.02;
  const head = 1.92;
  const BAY = ARM.windowEvery;
  const JOINT = 24; // the arm's mid-span joint (a bulkhead frame across the walkway)

  // the floor: one plate, its texture across the walkway (grating down the middle, diamond-plate
  // edges, yellow safety lines), repeating every metre along it
  floor.push(box(L, 0.04, W, cx, F - 0.02, 0));
  frame.push(box(L, 0.06, 0.08, cx, F + 0.03, W / 2 - 0.04), box(L, 0.06, 0.08, cx, F + 0.03, -W / 2 + 0.04));
  // the side walls: below the windows, above them; each bay a window or (every fourth) a solid
  // panel with the arm's equipment on it; a heavier portal frame every four bays
  let k = 0;
  for (let x = x0; x <= x1 - BAY * 0.5; x += BAY, k++) {
    const bx = x + 0.22 + (BAY - 0.22) / 2;
    const bw = BAY - 0.22;
    // bays 1, 5, 9 … from the white room (never the two beside the walk's first stop, the view)
    const solid = k % 4 === 1 && x > x0 + BAY && x < x1 - 2 * BAY;
    const portal = k % 4 === 0;
    for (const s of [1, -1]) {
      const z = s * (W / 2 + T / 2);
      // the post at the start of the bay (deeper and wider at a portal)
      frame.push(box(portal ? 0.3 : 0.2, head - sill, T + (portal ? 0.1 : 0.02), x + 0.11, F + (sill + head) / 2, z - s * (portal ? 0.04 : 0)));
      if (solid) wall.push(box(bw, head - sill, T, bx, F + (sill + head) / 2, z));
      else {
        glass.push(box(bw, head - sill, 0.012, bx, F + (sill + head) / 2, z));
        frame.push(box(bw, 0.04, T + 0.03, bx, F + sill, z), box(bw, 0.04, T + 0.03, bx, F + head, z));
      }
      if (portal) {
        // the portal's legs below and above the window line, its knee braces under the roof
        frame.push(box(0.3, sill, 0.1, x + 0.11, F + sill / 2, s * (W / 2 - 0.02)));
        frame.push(box(0.3, H - head, 0.1, x + 0.11, F + (head + H) / 2, s * (W / 2 - 0.02)));
        frame.push(box(0.06, 0.06, 0.32, x + 0.11, F + H - 0.2, s * (W / 2 - 0.16)).rotateX(0));
      }
    }
    if (portal) frame.push(box(0.3, 0.2, W, x + 0.11, F + H - 0.1, 0), box(0.3, 0.02, W - 0.1, x + 0.11, F + 0.005, 0));
    if (solid) {
      // on the +z wall a fire extinguisher cabinet, on the −z wall a junction box and its conduit
      red.push(box(0.36, 0.62, 0.12, bx, F + 1.38, W / 2 - 0.06));
      frame.push(box(0.3, 0.5, 0.01, bx, F + 1.38, W / 2 - 0.125));
      frame.push(box(0.4, 0.5, 0.16, bx, F + 1.45, -W / 2 + 0.08));
      conduit.push(rod([bx, F + 1.7, -W / 2 + 0.05], [bx, F + H - 0.05, -W / 2 + 0.05], 0.022, 8));
    }
  }
  for (const s of [1, -1]) {
    const z = s * (W / 2 + T / 2);
    wall.push(box(L, sill, T, cx, F + sill / 2, z));
    wall.push(box(L, H - head, T, cx, F + (head + H) / 2, z));
    // the handrail along the wall, on brackets
    rail.push(rod([x0, F + 0.98, s * (W / 2 - 0.07)], [x1 - 1.6, F + 0.98, s * (W / 2 - 0.07)], 0.022, 8));
    for (let x = x0 + 0.6; x < x1 - 1.6; x += 2.4) rail.push(rod([x, F + 0.98, s * (W / 2 - 0.07)], [x, F + 0.98, s * (W / 2)], 0.012));
  }
  // the roof; under it a cable tray along the +z side and two conduits along the −z side; caged
  // lamps down the middle, alternating long and short fittings
  wall.push(box(L, T, W + 2 * T, cx, F + H + T / 2, 0));
  frame.push(box(L, 0.05, 0.32, cx, F + H - 0.1, W / 2 - 0.2), box(L, 0.1, 0.02, cx, F + H - 0.08, W / 2 - 0.36));
  for (let x = x0 + 0.5; x < x1; x += 1.2) frame.push(box(0.03, 0.12, 0.34, x, F + H - 0.06, W / 2 - 0.2));
  conduit.push(rod([x0, F + H - 0.08, -W / 2 + 0.06], [x1, F + H - 0.08, -W / 2 + 0.06], 0.025, 8));
  conduit.push(rod([x0, F + H - 0.15, -W / 2 + 0.06], [x1, F + H - 0.15, -W / 2 + 0.06], 0.018, 8));
  for (let x = x0 + 1.2, i = 0; x < x1; x += BAY, i++) {
    frame.push(box(0.08, 0.1, W - 0.6, x, F + H - 0.05, -0.05));
    const len = i % 2 ? 0.5 : 0.9;
    lamp.push(box(len, 0.03, 0.12, x + 1.2, F + H - 0.04, -0.05));
    for (const dz of [-0.07, 0.07]) frame.push(box(len + 0.04, 0.012, 0.012, x + 1.2, F + H - 0.065, -0.05 + dz));
    for (let j = -1; j <= 1; j++) frame.push(box(0.012, 0.03, 0.16, x + 1.2 + (j * len) / 2.2, F + H - 0.06, -0.05));
  }
  // the mid-span joint: a bulkhead frame narrowing the walkway, its seal and its sign
  for (const s of [1, -1]) frame.push(box(0.28, H, 0.22, JOINT, F + H / 2, s * (W / 2 - 0.09)));
  frame.push(box(0.28, 0.3, W, JOINT, F + H - 0.15, 0));
  hazard.push(box(0.3, 0.012, W - 0.44, JOINT, F + 0.006, 0));
  signs.joint = new THREE.PlaneGeometry(0.9, 0.22).rotateY(Math.PI / 2).translate(JOINT + 0.145, F + H - 0.15, 0);
  // station numbers on the portal frames, facing the walker; safety placards on the walls
  for (const [id, n] of [["station2", 2], ["station6", 6], ["station10", 10], ["station14", 14]]) {
    const x = x0 + n * BAY + 0.27;
    if (x < x1 - 1) signs[id] = new THREE.PlaneGeometry(0.34, 0.14).rotateY(Math.PI / 2).translate(x, F + 1.62, W / 2 - 0.13);
  }
  signs.noFlame = new THREE.PlaneGeometry(0.42, 0.3).rotateY(Math.PI).translate(x1 - 4.6, F + 1.45, W / 2 - 0.005);
  signs.egress = new THREE.PlaneGeometry(0.5, 0.2).translate(x1 - 9.8, F + 2.05, -W / 2 + 0.005);
  signs.suitedOnly = new THREE.PlaneGeometry(0.46, 0.3).rotateY(Math.PI).translate(x0 + 3.3, F + 1.45, W / 2 - 0.005);
  // underneath: the arm's truss (two deep chords, diagonals), outside the walls
  const D = 1.6; // truss depth under the floor
  for (const s of [1, -1]) {
    const z = s * (W / 2 + 0.12);
    truss.push(rod([x0, F - 0.1, z], [x1 - 1.6, F - 0.1, z], 0.09, 8));
    truss.push(rod([x0 + 1.0, F - D, z], [x1 - 1.6, F - D, z], 0.09, 8));
    let up = true;
    for (let x = x0 + 1.0; x < x1 - 2.6; x += 2.4) {
      truss.push(rod([x, up ? F - D : F - 0.1, z], [x + 2.4, up ? F - 0.1 : F - D, z], 0.06));
      truss.push(rod([x, F - D, z], [x, F - 0.1, z], 0.05));
      up = !up;
    }
  }
  for (let x = x0 + 1.0; x < x1 - 1.6; x += 2.4) truss.push(rod([x, F - D, W / 2 + 0.12], [x, F - D, -W / 2 - 0.12], 0.04));
  // the cables and the pipe run along the outside of the arm
  truss.push(rod([x0, F + 0.35, W / 2 + T + 0.08], [x1 - 1.6, F + 0.35, W / 2 + T + 0.08], 0.05, 8));
  truss.push(rod([x0, F + 0.5, W / 2 + T + 0.08], [x1 - 1.6, F + 0.5, W / 2 + T + 0.08], 0.035, 8));

  /* the white room: a clean room round the hatch, from the arm's end to the boost cover */
  const R0 = 0.3; // its back wall (inside the cover's line: the cover is drawn in front of it)
  const R1 = WHITE_ROOM.x1;
  const WR = WHITE_ROOM.width;
  const HR = WHITE_ROOM.height;
  const rc = (R0 + R1) / 2;
  white.push(box(R1 - R0, 0.05, WR, rc, F - 0.025, 0)); // floor (white deck)
  white.push(box(R1 - R0, 0.06, WR + 0.12, rc, F + HR + 0.03, 0)); // ceiling
  for (const s of [1, -1]) white.push(box(R1 - R0, HR, T, rc, F + HR / 2, s * (WR / 2 + T / 2)));
  // the wall where the arm comes in: either side of the doorway, and above it
  const side = (WR - W) / 2;
  for (const s of [1, -1]) white.push(box(T, HR, side, R1, F + HR / 2, s * (W / 2 + side / 2)));
  white.push(box(T, HR - H, W, R1, F + H + (HR - H) / 2, 0));
  white.push(box(T, HR, WR, R0, F + HR / 2, 0)); // the back (behind the cover)
  // the doorway from the arm: a hazard-striped frame and threshold, the WHITE ROOM sign over it
  for (const s of [1, -1]) hazard.push(box(0.1, H - 0.05, 0.08, R1 + 0.08, F + (H - 0.05) / 2, s * (W / 2 - 0.04)));
  hazard.push(box(0.1, 0.08, W, R1 + 0.08, F + H - 0.09, 0), box(0.4, 0.012, W - 0.16, R1 + 0.25, F + 0.006, 0));
  signs.whiteRoom = new THREE.PlaneGeometry(1.1, 0.24).rotateY(Math.PI / 2).translate(R1 + 0.14, F + H - 0.27, 0);
  // lamps in the ceiling, a bench, a tool board, a step to the hatch
  for (const z of [-0.8, 0.8]) lamp.push(box(1.2, 0.025, 0.2, rc + 0.2, F + HR - 0.015, z));
  frame.push(box(0.6, 0.06, 0.45, R1 - 0.5, F + 0.48, WR / 2 - 0.3));
  for (const x of [R1 - 0.75, R1 - 0.25]) frame.push(box(0.05, 0.46, 0.05, x, F + 0.23, WR / 2 - 0.3));
  frame.push(box(0.9, 0.7, 0.03, rc + 0.3, F + 1.45, WR / 2 - 0.02));
  frame.push(box(0.6, 0.22, 0.9, CM_ON_PAD.hatch.r + 0.55, F + 0.11, 0)); // the step
  const floorG = worldUV(merge(floor), 1, 1, (u, v, x, y, z) => [x, z / W + 0.5]);
  return {
    wall: worldUV(merge(wall), 1.2, 2.4, (u, v, x, y) => [u, y - F]),
    floor: floorG,
    frame: merge(frame),
    truss: merge(truss),
    glass: merge(glass),
    lamp: merge(lamp),
    rail: merge(rail),
    white: worldUV(merge(white), 1.2, 2.4, (u, v, x, y) => [u, y - F]),
    red: merge(red),
    hazard: worldUV(merge(hazard), 0.5, 0.5),
    conduit: merge(conduit),
    signs,
  };
}

/**
 * The boost cover round the hatch (a section of the CM's cone, white) with the hatch's opening, its
 * frame, the hatch door (hinged on its +z edge, opening outward), and the cabin seen through it.
 * The cover is a few centimetres outside the CM's own surface. Returns geometries and the hatch's
 * hinge (for the door's swing).
 */
export function hatchGeometry() {
  const base = CM_ON_PAD.base;
  const h = CM_ON_PAD.hatch;
  const F = ARM.floor;
  const OFF = 0.03;
  const yA = F;
  const yB = F + WHITE_ROOM.height;
  const thMax = 1.25;
  const NY = 36;
  const NT = 60;
  const pos = [];
  const uv = [];
  const inOpening = (u, v) => {
    // a rounded rectangle, w × h, corner radius 0.14
    const rr = 0.14;
    const ax = Math.abs(u) - (h.w / 2 - rr);
    const ay = Math.abs(v) - (h.h / 2 - rr);
    if (ax <= 0 || ay <= 0) return Math.abs(u) < h.w / 2 && Math.abs(v) < h.h / 2;
    return ax * ax + ay * ay < rr * rr;
  };
  const P = (th, y) => {
    const r = cmRadiusAt(y - base) + OFF;
    return [r * Math.cos(th), y, r * Math.sin(th)];
  };
  for (let i = 0; i < NT; i++)
    for (let j = 0; j < NY; j++) {
      const t0 = -thMax + (2 * thMax * i) / NT;
      const t1 = -thMax + (2 * thMax * (i + 1)) / NT;
      const y0 = yA + ((yB - yA) * j) / NY;
      const y1 = yA + ((yB - yA) * (j + 1)) / NY;
      const tm = (t0 + t1) / 2;
      const ym = (y0 + y1) / 2;
      const rm = cmRadiusAt(ym - base);
      if (inOpening(tm * rm, ym - h.y)) continue;
      const q = [P(t0, y0), P(t1, y0), P(t1, y1), P(t0, y1)];
      const uvq = [
        [t0, y0],
        [t1, y0],
        [t1, y1],
        [t0, y1],
      ].map(([t, y]) => [0.5 - (t * rm) / 3, 0.5 + (y - h.y) / 3]); // u runs −z → +z as seen from the arm
      for (const k of [0, 2, 1, 0, 3, 2]) {
        pos.push(...q[k]);
        uv.push(...uvq[k]);
      }
    }
  const cover = new THREE.BufferGeometry();
  cover.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  cover.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  cover.computeVertexNormals();

  // the opening's rim on the cover (a superellipse), its frame (a tube round it), and the hull's
  // thickness: the rim carried inward along the cover's normal (the cone tilts it up), then the
  // cabin seen through it (a card parallel to the cover)
  const r = cmRadiusAt(h.y - base) + OFF;
  const tilt = CM_ON_PAD.coneSlope;
  const nrm = new THREE.Vector3(Math.cos(tilt), Math.sin(tilt), 0);
  const ring = [];
  const N = 48;
  for (let k = 0; k <= N; k++) {
    const a = (k / N) * Math.PI * 2;
    const cu = Math.cos(a);
    const sv = Math.sin(a);
    const u = (Math.sign(cu) * Math.pow(Math.abs(cu), 0.35) * h.w) / 2;
    const v = (Math.sign(sv) * Math.pow(Math.abs(sv), 0.35) * h.h) / 2;
    const rr = cmRadiusAt(h.y + v - base) + OFF;
    const th = u / rr;
    ring.push(new THREE.Vector3(rr * Math.cos(th) + 0.012, h.y + v, rr * Math.sin(th)));
  }
  const frame = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ring.slice(0, N), true), 96, 0.035, 6, true);
  const depth = 0.38;
  const tp = [];
  for (let k = 0; k < N; k++) {
    const A = ring[k];
    const B = ring[k + 1];
    const Ai = A.clone().addScaledVector(nrm, -depth);
    const Bi = B.clone().addScaledVector(nrm, -depth);
    tp.push(...A.toArray(), ...Ai.toArray(), ...B.toArray(), ...B.toArray(), ...Ai.toArray(), ...Bi.toArray());
  }
  const tunnelG = new THREE.BufferGeometry();
  tunnelG.setAttribute("position", new THREE.Float32BufferAttribute(tp, 3));
  tunnelG.computeVertexNormals();
  const card = new THREE.PlaneGeometry(h.w + 0.12, h.h + 0.12)
    .rotateY(Math.PI / 2)
    .rotateZ(tilt)
    .translate(r - depth * Math.cos(tilt) + 0.004, h.y - depth * Math.sin(tilt), 0);
  const tunnel = [tunnelG];
  // the hatch door, built about its hinge (its +z edge), shut it would sit in the opening
  const door = merge([
    box(0.07, h.h - 0.04, h.w - 0.04, 0, 0, -(h.w - 0.04) / 2),
    box(0.03, 0.18, 0.12, 0.05, 0.05, -(h.w - 0.04) * 0.62), // the handle housing
    box(0.03, 0.04, 0.3, 0.07, -0.18, -(h.w - 0.04) * 0.5), // the latch bar
  ]);
  return {
    cover,
    frame,
    tunnel: merge(tunnel),
    card,
    door,
    hinge: [r + 0.04, h.y, h.w / 2],
  };
}

/** The materials (dispose with disposeAll). */
export function padMaterials() {
  const tex = { floor: floorTexture(), panel: panelTexture(), armWall: armWallTexture(), hazard: hazardTexture(), cover: coverTexture(), glimpse: cabinGlimpseTexture() };
  const signs = signTextures();
  const std = (o) => new THREE.MeshStandardMaterial(o);
  return {
    tex: { ...tex, ...Object.fromEntries(Object.entries(signs).map(([k, t]) => [`sign_${k}`, t])) },
    mat: {
      wall: std({ map: tex.armWall, roughness: 0.62, metalness: 0.12, envMapIntensity: 0.6 }),
      floor: std({ map: tex.floor, roughness: 0.62, metalness: 0.35, envMapIntensity: 0.45 }),
      red: std({ color: "#b8261b", roughness: 0.45, metalness: 0.2 }),
      hazard: std({ map: tex.hazard, roughness: 0.6, metalness: 0.1 }),
      conduit: std({ color: "#9a9d9f", roughness: 0.4, metalness: 0.8 }),
      signs: Object.fromEntries(Object.entries(signs).map(([k, t]) => [k, new THREE.MeshBasicMaterial({ map: t, toneMapped: true })])),
      frame: std({ color: "#3e4246", roughness: 0.5, metalness: 0.55 }),
      truss: std({ color: "#8d4a3a", roughness: 0.7, metalness: 0.35 }),
      glass: new THREE.MeshPhysicalMaterial({ color: "#c9dbe6", roughness: 0.05, metalness: 0, transparent: true, opacity: 0.14, depthWrite: false }),
      lamp: std({ color: "#fff6e4", emissive: "#fff2d8", emissiveIntensity: 1.6 }),
      rail: std({ color: "#c9c3b6", roughness: 0.35, metalness: 0.75 }),
      white: std({ map: tex.panel, roughness: 0.55, metalness: 0.05 }),
      cover: std({ map: tex.cover, roughness: 0.48, metalness: 0.05, side: THREE.DoubleSide }),
      hatchFrame: std({ color: "#9a9ea3", roughness: 0.32, metalness: 0.85 }),
      tunnel: std({ color: "#55595d", roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide }),
      card: new THREE.MeshBasicMaterial({ map: tex.glimpse, toneMapped: true }),
      door: std({ color: "#d9d8d2", roughness: 0.42, metalness: 0.25 }),
    },
  };
}
export function disposeAll(...things) {
  const seen = new Set();
  const free = (x) => {
    if (!x || seen.has(x) || typeof x.dispose !== "function") return;
    seen.add(x);
    x.dispose();
  };
  const walk = (t, depth) => {
    if (!t || depth > 3) return;
    if (t.isBufferGeometry || t.isMaterial || t.isTexture) free(t);
    else if (typeof t === "object") Object.values(t).forEach((v) => walk(v, depth + 1));
  };
  for (const t of things) walk(t, 0);
}

/* ---- the launch complex up close (pre-launch only) ------------------------------------------- */
/**
 * Worn paint and grime for the tower's steel, seen from the elevator and the arm: a tileable
 * grey-scale texture applied in world space (triplanar), so long members are not smeared by their
 * own UVs. Multiplies the base colour (0.72..1.08) and roughens the worn patches.
 */
function grimeTexture() {
  return canvasTex(
    256,
    256,
    (g, w, h) => {
      g.fillStyle = "#d6d6d6";
      g.fillRect(0, 0, w, h);
      const r = rng(97);
      // paint mottling
      for (let i = 0; i < 260; i++) {
        const x = r() * w;
        const y = r() * h;
        const rad = 4 + r() * 22;
        const grd = g.createRadialGradient(x, y, 0, x, y, rad);
        const v = r() < 0.5 ? 200 : 236;
        grd.addColorStop(0, `rgba(${v},${v},${v},0.5)`);
        grd.addColorStop(1, `rgba(${v},${v},${v},0)`);
        g.fillStyle = grd;
        g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      // rust-dark streaks running down from the joints
      for (let i = 0; i < 70; i++) {
        const x = r() * w;
        const y = r() * h;
        const len = 20 + r() * 70;
        const grd = g.createLinearGradient(x, y, x, y + len);
        grd.addColorStop(0, "rgba(90,82,74,0.45)");
        grd.addColorStop(1, "rgba(90,82,74,0)");
        g.fillStyle = grd;
        g.fillRect(x, y, 1 + r() * 2.5, len);
      }
      // speckle
      for (let i = 0; i < 2500; i++) {
        g.fillStyle = `rgba(0,0,0,${r() * 0.12})`;
        g.fillRect(r() * w, r() * h, 1, 1);
      }
    },
    { repeat: [1, 1], srgb: false }
  );
}
/**
 * Clone a launch-complex material with the grime applied in world space. `metres` is the size of
 * one repeat; `unit` the scene's metres per unit. The original material is left untouched.
 */
export function withGrime(base, tex, { metres = 2.5, unit = 30, strength = 1 } = {}) {
  const m = base.clone();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGrime = { value: tex };
    sh.uniforms.uGrimeScale = { value: unit / metres };
    sh.uniforms.uGrimeK = { value: strength };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGwPos;\nvarying vec3 vGwN;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvGwPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGwN = normalize(mat3(modelMatrix) * objectNormal);");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D uGrime;\nuniform float uGrimeScale;\nuniform float uGrimeK;\nvarying vec3 vGwPos;\nvarying vec3 vGwN;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
vec3 gw = abs(normalize(vGwN)); gw = gw / (gw.x + gw.y + gw.z);
vec3 gp = vGwPos * uGrimeScale;
float gv = texture2D(uGrime, gp.yz).r * gw.x + texture2D(uGrime, gp.xz).r * gw.y + texture2D(uGrime, gp.xy).r * gw.z;
float lvGrime = mix(1.0, 0.72 + 0.42 * gv, uGrimeK);
diffuseColor.rgb *= lvGrime;`
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + (1.0 - lvGrime) * 0.6, 0.0, 1.0);");
  };
  m.customProgramCacheKey = () => `lv-grime-${base.uuid}`;
  return m;
}
export const grimeTex = grimeTexture;
