/*
 * LUNAVIA command and service module: the shape (pure; core three.js only, unit-tested).
 *
 * One spacecraft for the whole expedition. The same geometry is drawn on top
 * of LV-001 at launch, through Earth orbit and translunar injection, docked to
 * the lunar module on the way to the Moon and in lunar orbit, alone after
 * undocking, and (its command module) through reentry. Apollo-class
 * proportions, LUNAVIA's own finish: white service module with orange bands
 * and black accents, a silver command module with the orange shoulder band.
 *
 * Units are metres. The long axis is +Y (the command module's nose), with the
 * origin on the plane where the command module meets the service module.
 *
 * - **Command module.** The reentry capsule's own profile (ReentryScene uses
 *   CM_PROFILE too): a 3.9 m blunt cone on a dished heat shield, the docking
 *   tunnel on top with the probe, five windows, the side hatch, RCS ports and
 *   the orange band above the shoulder.
 * - **Service module.** A 3.9 m drum: forward fairing, six panel sectors,
 *   radiators (in the skin texture, CsmModel), four RCS quads with four
 *   thrusters each, the aft bulkhead, the main engine (SPS) on its gimbal ring
 *   and the steerable high-gain antenna on its boom.
 * - **Docking.** DOCK_Y is the docking ring at the top of the tunnel; the
 *   lunar module's drogue ring meets it there (dockedLmPose).
 *
 * Static parts are merged into one geometry per material, so the whole
 * spacecraft is about a dozen draw calls.
 */
import * as THREE from "three";

export const CM_R = 1.95; // command and service module radius (3.9 m)

// Command module profile [r, y] from the reentry capsule (capsule units x 3.9 m).
const K = 3.9;
const RH = 1.2 * K; // heat shield sphere radius
export const CM_SHIELD = (() => {
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const r = (i / 12) * 0.5 * K;
    pts.push([Math.max(r, 0.0004), -(RH - Math.sqrt(RH * RH - r * r))]);
  }
  pts.push([0.512 * K, 0.012 * K], [0.515 * K, 0.035 * K], [0.5 * K, 0.06 * K]);
  return pts;
})();
export const CM_PROFILE = [
  [0.5, 0.06],
  [0.49, 0.075],
  [0.14, 0.62],
  [0.105, 0.64],
  [0.1, 0.75],
  [0.07, 0.765],
  [0.0001, 0.77],
].map(([r, y]) => [r * K, y * K]);

export const CM_TOP = 0.765 * K; // top of the docking tunnel's ring
export const DOCK_Y = CM_TOP; // docking interface: ring to ring
export const PROBE_L = 0.78; // docking probe beyond the ring
export const SM_TOP = -0.55; // service module drum top (above it, the forward fairing to the CM)
export const SM_BOTTOM = -4.85;
export const SPS = { mount: SM_BOTTOM, throat: SM_BOTTOM - 0.28, exit: SM_BOTTOM - 3.0, exitR: 1.12 };
export const LENGTH = CM_TOP + PROBE_L - SPS.exit; // nose of the probe to the engine exit

/** Materials the shape is split into (CsmModel gives each its look). */
export const PARTS = ["cmSkin", "smSkin", "fairing", "shield", "metal", "black", "white", "accent", "glass", "engine", "engineInner"];

/* ---- small builders (as data/lmDesign) -------------------------------------------- */
const lathe = (profile, seg = 48) => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);

function rod(a, b, r, seg = 8) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const d = new THREE.Vector3().subVectors(B, A);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  return g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
}

/** A part placed on the body surface: built facing +Z at the origin, moved out to radius r at height y, turned to angle a. */
function onSurface(g, r, y, a, tilt = 0) {
  if (tilt) g.rotateX(tilt);
  g.translate(0, y, r);
  return g.rotateY(a);
}

function dish(r, h, seg = 20) {
  const pts = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    pts.push([Math.max(0.004, r * t), h * t * t]);
  }
  return lathe(pts, seg);
}

/** Merge geometries into one non-indexed geometry with position, normal and uv. */
export function merge(list) {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  parts.forEach((g) => (n += g.attributes.position.count));
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  let o = 0;
  parts.forEach((g) => {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, c * 3), o * 3);
    nor.set(g.attributes.normal.array.subarray(0, c * 3), o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array.subarray(0, c * 2), o * 2);
    o += c;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/* ---- the service module's layout round the drum ------------------------------------ */
// Angles from +Z (the hatch side) towards +X; u = angle / 360° on the skin texture.
export const SM_RADIATORS = [
  [0.07, 0.22],
  [0.57, 0.72],
]; // two radiator panels, as u ranges
export const SM_MARK_U = 330 / 360; // LUNAVIA · LV-001, on the hatch side
const UMBILICAL_A = (160 * Math.PI) / 180;
const SCIMITAR_A = [120, 300].map((d) => (d * Math.PI) / 180);

/* ---- RCS ------------------------------------------------------------------------ */
// Service module quads: four, 90° apart, rotated 7.25° off the main axes (as on the CSM).
const QUAD_Y = -1.55;
export const RCS_QUADS = [0, 1, 2, 3].map((i) => ((7.25 + i * 90) * Math.PI) / 180);
/**
 * Every service-module thruster: { quad, pos: [x, y, z], dir: [x, y, z] } (dir is
 * where the exhaust goes). Each quad fires fore, aft and to both sides.
 */
export const RCS_THRUSTERS = RCS_QUADS.flatMap((a, quad) => {
  const out = [Math.sin(a), 0, Math.cos(a)];
  const side = [Math.cos(a), 0, -Math.sin(a)];
  const c = [out[0] * (CM_R + 0.42), QUAD_Y, out[2] * (CM_R + 0.42)];
  const at = (d, k) => [c[0] + d[0] * k, c[1] + d[1] * k, c[2] + d[2] * k];
  return [
    { quad, pos: at([0, 1, 0], 0.32), dir: [0, 1, 0] },
    { quad, pos: at([0, -1, 0], 0.32), dir: [0, -1, 0] },
    { quad, pos: at(side, 0.26), dir: side },
    { quad, pos: at([-side[0], 0, -side[2]], 0.26), dir: [-side[0], 0, -side[2]] },
  ];
});

/* ---- high-gain antenna ------------------------------------------------------------ */
// On a boom from the aft bulkhead, deployed out to the side (as the CSM's S-band HGA).
const HGA_A = (225 * Math.PI) / 180;
export const HGA = {
  root: [Math.sin(HGA_A) * 1.45, SM_BOTTOM + 0.05, Math.cos(HGA_A) * 1.45],
  head: [Math.sin(HGA_A) * 3.25, SM_BOTTOM - 1.05, Math.cos(HGA_A) * 3.25],
};

/* ---- the command module ------------------------------------------------------------ */
/** The command module; `probe: false` leaves the docking probe off (stowed for the trip home). */
export function buildCM({ probe = true } = {}) {
  const P = Object.fromEntries(PARTS.map((k) => [k, []]));
  P.shield.push(lathe(CM_SHIELD));
  P.cmSkin.push(lathe(CM_PROFILE.slice(0, 4)));
  // Docking tunnel (darker anodised ring) and the probe on top.
  P.metal.push(lathe(CM_PROFILE.slice(3), 32));
  P.black.push(new THREE.TorusGeometry(0.4, 0.035, 8, 32).rotateX(Math.PI / 2).translate(0, CM_TOP - 0.02, 0));
  if (probe) {
    P.metal.push(rod([0, CM_TOP - 0.05, 0], [0, CM_TOP + PROBE_L - 0.12, 0], 0.07, 10));
    P.metal.push(new THREE.ConeGeometry(0.1, 0.16, 12).translate(0, CM_TOP + PROBE_L - 0.08, 0));
    [0, 1, 2].forEach((i) => {
      const a = (i / 3) * Math.PI * 2;
      const foot = [Math.cos(a) * 0.36, CM_TOP + 0.02, Math.sin(a) * 0.36];
      P.metal.push(rod(foot, [Math.cos(a) * 0.08, CM_TOP + 0.42, Math.sin(a) * 0.08], 0.022, 6));
    });
  }
  // Orange band above the shoulder (LUNAVIA), as on the reentry capsule.
  const bandAt = (y) => 0.5 * K - ((0.5 - 0.14) * K * (y - 0.075 * K)) / ((0.62 - 0.075) * K);
  const b0 = 0.105 * K;
  const b1 = 0.14 * K;
  P.accent.push(lathe([[bandAt(b0) + 0.012, b0], [bandAt(b1) + 0.012, b1]], 48));
  // Windows: two forward-facing rendezvous windows high on the cone, two side windows, the hatch window.
  const slope = Math.atan2((0.5 - 0.14) * K, (0.62 - 0.075) * K); // cone half-angle from the axis
  const win = (w, h, y, a, mat) => {
    const r = bandAt(y) + 0.01;
    const g = new THREE.BoxGeometry(w, h, 0.03);
    P[mat].push(onSurface(g, r, y, a, -slope));
  };
  win(0.36, 0.3, 1.55, 0.32, "glass");
  win(0.36, 0.3, 1.55, -0.32, "glass");
  win(0.42, 0.42, 0.95, 1.15, "glass");
  win(0.42, 0.42, 0.95, -1.15, "glass");
  // Side hatch with its window, and the frame around it.
  win(0.92, 0.82, 1.0, 0, "black");
  win(0.26, 0.26, 1.08, 0, "glass");
  // RCS ports (pitch and yaw pairs) and the aft roll engines.
  [Math.PI / 2, Math.PI, -Math.PI / 2].forEach((a) => {
    win(0.16, 0.16, 1.85, a, "black");
    win(0.16, 0.16, 1.85, a + 0.2, "black");
  });
  [0.6, 2.2, 3.8, 5.4].forEach((a) => win(0.12, 0.12, 0.42, a, "black"));
  // Tunnel latches (twelve, a ring of small blocks on the docking ring).
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    P.metal.push(new THREE.BoxGeometry(0.07, 0.08, 0.1).translate(0, CM_TOP + 0.03, 0.36).rotateY(a));
  }
  return Object.fromEntries(PARTS.map((k) => [k, P[k].length ? merge(P[k]) : null]));
}

/* ---- the service module ------------------------------------------------------------- */
export function buildSM() {
  const P = Object.fromEntries(PARTS.map((k) => [k, []]));
  // Drum (open: the bulkheads close it), forward fairing up to the CM's shield, aft bulkhead.
  P.smSkin.push(new THREE.CylinderGeometry(CM_R, CM_R, SM_TOP - SM_BOTTOM, 64, 1, true).translate(0, (SM_TOP + SM_BOTTOM) / 2, 0));
  P.fairing.push(lathe([[CM_R, SM_TOP], [CM_R + 0.012, SM_TOP + 0.04], [CM_R + 0.012, -0.06], [CM_R - 0.03, 0.02]], 64));
  P.black.push(new THREE.CylinderGeometry(CM_R + 0.008, CM_R + 0.008, 0.07, 64, 1, true).translate(0, SM_TOP, 0));
  P.black.push(lathe([[CM_R, SM_BOTTOM + 0.001], [1.3, SM_BOTTOM - 0.05], [0.62, SM_BOTTOM - 0.07], [0.001, SM_BOTTOM - 0.07]], 64));
  // Aft insulation blanket ring and the engine's thermal skirt.
  P.shield.push(lathe([[0.62, SM_BOTTOM - 0.07], [0.6, SM_BOTTOM - 0.16], [0.44, SM_BOTTOM - 0.24]], 32));
  // Main engine: gimbal ring, combustion chamber, then the bell (chamber dark, extension lighter).
  P.metal.push(new THREE.TorusGeometry(0.52, 0.04, 8, 32).rotateX(Math.PI / 2).translate(0, SPS.mount - 0.12, 0));
  P.engine.push(lathe([[0.36, SPS.mount - 0.08], [0.4, SPS.throat + 0.05], [0.3, SPS.throat]], 32));
  const bell = [];
  for (let i = 0; i <= 12; i++) {
    const u = i / 12;
    bell.push([0.3 + (SPS.exitR - 0.3) * (1 - Math.pow(1 - u, 1.8)), SPS.throat + (SPS.exit - SPS.throat) * u]);
  }
  bell.push([SPS.exitR + 0.03, SPS.exit], [SPS.exitR + 0.03, SPS.exit + 0.04]);
  P.engine.push(lathe(bell, 48));
  P.engineInner.push(lathe(bell.slice(0, 13).map(([r, y]) => [r - 0.018, y]).reverse(), 48));
  // Stiffener bands on the bell.
  [0.35, 0.62].forEach((u) => {
    const r = 0.3 + (SPS.exitR - 0.3) * (1 - Math.pow(1 - u, 1.8));
    P.metal.push(new THREE.TorusGeometry(r + 0.01, 0.022, 6, 48).rotateX(Math.PI / 2).translate(0, SPS.throat + (SPS.exit - SPS.throat) * u, 0));
  });
  // RCS quads: a base panel on the skin, the housing, four thruster cones.
  RCS_QUADS.forEach((a) => {
    P.white.push(onSurface(new THREE.BoxGeometry(0.95, 1.25, 0.08), CM_R + 0.02, QUAD_Y, a));
    P.metal.push(onSurface(new THREE.BoxGeometry(0.46, 0.58, 0.42), CM_R + 0.22, QUAD_Y, a));
  });
  RCS_THRUSTERS.forEach(({ pos, dir }) => {
    const g = new THREE.CylinderGeometry(0.035, 0.085, 0.2, 10, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(...dir)));
    P.engine.push(g.translate(pos[0] - dir[0] * 0.08, pos[1] - dir[1] * 0.08, pos[2] - dir[2] * 0.08));
  });
  // Umbilical fairing up the side to the CM (as the CSM's), and scimitar VHF antennas.
  P.white.push(onSurface(new THREE.BoxGeometry(0.34, 3.7, 0.16), CM_R + 0.05, (SM_TOP + SM_BOTTOM) / 2 + 0.25, UMBILICAL_A));
  SCIMITAR_A.forEach((a) => {
    P.metal.push(onSurface(new THREE.BoxGeometry(0.05, 0.9, 0.5), CM_R + 0.3, -2.9, a));
  });
  // High-gain antenna mount on the aft bulkhead (the antenna itself: buildHGA, on its hinge).
  P.metal.push(rod([HGA.root[0] * 0.85, SM_BOTTOM + 0.04, HGA.root[2] * 0.85], [HGA.root[0] * 1.12, SM_BOTTOM - 0.25, HGA.root[2] * 1.12], 0.1, 8));
  return Object.fromEntries(PARTS.map((k) => [k, P[k].length ? merge(P[k]) : null]));
}

/**
 * The high-gain antenna: boom, a cluster of four dishes round a wide-beam horn,
 * and its electronics box, in a frame whose origin is the boom's hinge
 * (HGA.root). CsmModel turns it on the hinge: folded down beside the engine
 * bell for launch (inside the spacecraft adapter), swung out once the lunar
 * module has been extracted (hgaRotation).
 */
export function buildHGA() {
  const P = { metal: [], white: [], black: [] };
  const o = new THREE.Vector3(...HGA.root);
  const rel = (v) => [v[0] - o.x, v[1] - o.y, v[2] - o.z];
  P.metal.push(rod([0, 0, 0], rel(HGA.head), 0.06, 8));
  const head = new THREE.Vector3(...rel(HGA.head));
  const look = new THREE.Vector3(Math.sin(HGA_A) * 0.35, -1, Math.cos(HGA_A) * 0.35).normalize(); // the dishes face aft and out
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), look);
  const across = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const up2 = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ].forEach(([i, j]) => {
    const c = head.clone().addScaledVector(across, i * 0.42).addScaledVector(up2, j * 0.42);
    P.white.push(dish(0.4, 0.13).applyQuaternion(q).translate(c.x, c.y, c.z));
    P.metal.push(rod([c.x, c.y, c.z], [head.x, head.y, head.z], 0.025, 5));
  });
  P.metal.push(new THREE.CylinderGeometry(0.13, 0.2, 0.42, 12).applyQuaternion(q).translate(head.x, head.y, head.z));
  P.black.push(new THREE.BoxGeometry(0.34, 0.34, 0.2).applyQuaternion(q).translate(head.x - look.x * 0.2, head.y - look.y * 0.2, head.z - look.z * 0.2));
  return { metal: merge(P.metal), white: merge(P.white), black: merge(P.black) };
}

/**
 * The antenna's fold for launch: down on a hinge tangent to the drum at the
 * boom's root (47.5°), the head turned 30° about the boom, so the boom hangs
 * beside the engine bell with the dish cluster between the bell and the
 * adapter wall (data/payloadDesign checks the clearances). Deployed, it stands
 * out to the side as drawn by buildHGA.
 */
const BOOM = new THREE.Vector3(HGA.head[0] - HGA.root[0], HGA.head[1] - HGA.root[1], HGA.head[2] - HGA.root[2]).normalize();
export const HGA_FOLD = { hinge: [Math.cos(HGA_A), 0, -Math.sin(HGA_A)], hingeDeg: 47.5, boom: BOOM.toArray(), spinDeg: 30 };
const Q_STOWED = new THREE.Quaternion()
  .setFromAxisAngle(new THREE.Vector3(...HGA_FOLD.hinge), (HGA_FOLD.hingeDeg * Math.PI) / 180)
  .multiply(new THREE.Quaternion().setFromAxisAngle(BOOM, (HGA_FOLD.spinDeg * Math.PI) / 180));
/** The antenna's rotation about its root for deploy 0 (stowed) .. 1 (deployed), as a quaternion [x, y, z, w]. */
export function hgaRotation(deploy) {
  const k = Math.min(1, Math.max(0, deploy));
  const q = Q_STOWED.clone().slerp(new THREE.Quaternion(), k * k * (3 - 2 * k));
  return [q.x, q.y, q.z, q.w];
}

/* ---- the docked stack ---------------------------------------------------------------- */
// The lunar module's drogue ring, in its own model units (data/lmDesign) and metres per unit.
export const LM_DROGUE = { y: 0.905, z: -0.03 };
export const LM_M_PER_UNIT = 4.8;

/**
 * Where the lunar module sits on the command module, in CSM metres: upside down,
 * its drogue ring on the docking ring, the drogue on the CSM's axis. `gap` opens
 * the stack along the axis (undocking). The LM's +Z (its front, the porch and
 * ladder) faces the CSM's +Z (the hatch side).
 */
export function dockedLmPose(gap = 0) {
  const y = DOCK_Y + gap + LM_DROGUE.y * LM_M_PER_UNIT;
  return {
    position: [0, y, -LM_DROGUE.z * LM_M_PER_UNIT],
    rotation: [0, 0, Math.PI], // about Z: +Y down, +Z kept
    scale: LM_M_PER_UNIT,
  };
}
