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

/** The arm's floor: diamond-plate steel with the walkway's painted edge lines (1 m per repeat). */
function floorTexture() {
  return canvasTex(
    256,
    256,
    (g, w, h) => {
      g.fillStyle = "#7c8086";
      g.fillRect(0, 0, w, h);
      const r = rng(7);
      g.fillStyle = "rgba(210,214,220,0.35)";
      for (let y = 0; y < h; y += 16)
        for (let x = (y / 16) % 2 ? 8 : 0; x < w; x += 16) {
          g.save();
          g.translate(x + 4, y + 4);
          g.rotate(0.6);
          g.fillRect(-5, -1.3, 10, 2.6);
          g.restore();
        }
      for (let i = 0; i < 260; i++) {
        g.fillStyle = `rgba(40,40,40,${0.05 + r() * 0.08})`;
        g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
      }
    },
    { repeat: [1, 1] }
  );
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
    // the main display console, overhead, its lit dials
    g.fillStyle = "#3f4347";
    g.fillRect(w * 0.06, h * 0.06, w * 0.88, h * 0.32);
    const r = rng(19);
    for (let i = 0; i < 70; i++) {
      const x = w * (0.08 + r() * 0.84);
      const y = h * (0.08 + r() * 0.28);
      g.fillStyle = r() < 0.25 ? "#dfe7d8" : r() < 0.5 ? "#9fd8a8" : "#cfcfc6";
      g.beginPath();
      g.arc(x, y, 2 + r() * 4, 0, Math.PI * 2);
      g.fill();
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
 * { geometry by material } for the crew access arm and the white room. Materials: wall (painted
 * panels, both faces), floor, frame (dark steel), truss (the arm's structure, outside), glass,
 * lamp (emissive strips), rail (handrails), white (the white room), sign.
 */
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
  const T = 0.06; // wall thickness

  // floor plate and the sill strip at each side
  floor.push(box(L, 0.04, W, cx, F - 0.02, 0));
  frame.push(box(L, 0.06, 0.08, cx, F + 0.03, W / 2 - 0.04), box(L, 0.06, 0.08, cx, F + 0.03, -W / 2 + 0.04));
  // the side walls: below the windows, above them, and the posts between
  const sill = 1.02;
  const head = 1.92;
  for (const s of [1, -1]) {
    const z = s * (W / 2 + T / 2);
    wall.push(box(L, sill, T, cx, F + sill / 2, z));
    wall.push(box(L, H - head, T, cx, F + (head + H) / 2, z));
    for (let x = x0; x <= x1 - ARM.windowEvery * 0.5; x += ARM.windowEvery) {
      // a post at the start of each bay, the pane, the frame round it
      frame.push(box(0.22, head - sill, T + 0.02, x + 0.11, F + (sill + head) / 2, z));
      glass.push(box(ARM.windowEvery - 0.22, head - sill, 0.012, x + 0.22 + (ARM.windowEvery - 0.22) / 2, F + (sill + head) / 2, z));
      frame.push(box(ARM.windowEvery - 0.22, 0.04, T + 0.03, x + 0.22 + (ARM.windowEvery - 0.22) / 2, F + sill, z));
      frame.push(box(ARM.windowEvery - 0.22, 0.04, T + 0.03, x + 0.22 + (ARM.windowEvery - 0.22) / 2, F + head, z));
    }
    // the handrail along the wall, on brackets
    rail.push(rod([x0, F + 0.98, s * (W / 2 - 0.07)], [x1 - 1.6, F + 0.98, s * (W / 2 - 0.07)], 0.022, 8));
    for (let x = x0 + 0.6; x < x1 - 1.6; x += 2.4) rail.push(rod([x, F + 0.98, s * (W / 2 - 0.07)], [x, F + 0.98, s * (W / 2)], 0.012));
  }
  // the roof and its ribs, the lamps down the middle
  wall.push(box(L, T, W + 2 * T, cx, F + H + T / 2, 0));
  for (let x = x0 + 1.2; x < x1; x += 2.4) {
    frame.push(box(0.08, 0.1, W, x, F + H - 0.05, 0));
    lamp.push(box(1.1, 0.025, 0.16, x + 1.2, F + H - 0.015, 0));
  }
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
  // lamps in the ceiling, a bench, a tool board, a step to the hatch
  for (const z of [-0.8, 0.8]) lamp.push(box(1.2, 0.025, 0.2, rc + 0.2, F + HR - 0.015, z));
  frame.push(box(0.6, 0.06, 0.45, R1 - 0.5, F + 0.48, WR / 2 - 0.3));
  for (const x of [R1 - 0.75, R1 - 0.25]) frame.push(box(0.05, 0.46, 0.05, x, F + 0.23, WR / 2 - 0.3));
  frame.push(box(0.9, 0.7, 0.03, rc + 0.3, F + 1.45, WR / 2 - 0.02));
  frame.push(box(0.6, 0.22, 0.9, CM_ON_PAD.hatch.r + 0.55, F + 0.11, 0)); // the step
  return {
    wall: merge(wall),
    floor: merge(floor),
    frame: merge(frame),
    truss: merge(truss),
    glass: merge(glass),
    lamp: merge(lamp),
    rail: merge(rail),
    white: merge(white),
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
  const tex = { floor: floorTexture(), panel: panelTexture(), panelOut: panelTexture("#e9e8e3", "rgba(120,120,115,0.4)"), cover: coverTexture(), glimpse: cabinGlimpseTexture() };
  tex.floor.repeat.set(1.2, 1.2);
  const std = (o) => new THREE.MeshStandardMaterial(o);
  return {
    tex,
    mat: {
      wall: std({ map: tex.panelOut, roughness: 0.6, metalness: 0.15 }),
      floor: std({ map: tex.floor, roughness: 0.55, metalness: 0.6 }),
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
  for (const t of things) {
    if (!t) continue;
    if (t.isBufferGeometry || t.isMaterial || t.isTexture) free(t);
    else Object.values(t).forEach((v) => (v && (v.isBufferGeometry || v.isMaterial || v.isTexture) ? free(v) : null));
  }
}
