import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/*
 * COUNTDOWN TO LAUNCH — a pad suit technician (the suit room, the white room): white coveralls with
 * a turned-down collar, zip, pockets, belt and the LUNAVIA patch; a white skull cap, a comms
 * headset with its boom, white cotton gloves, white overshoes. Shaped parts (lathed trunk and
 * tapered limbs with folds), merged per material: about ten draw calls a figure.
 *
 * Its own figure, so nothing here touches the recovery's people (OCEAN RECOVERY). Metres; the root
 * is the pelvis; it faces +z.
 *
 * stateRef.current: { visible, pos, yaw, pose } with pose from techPose():
 *   { lean, head: [pitch, yaw], arms: [[swing, elbow, out] left, right], legs: [[hip, knee] l, r] }.
 */

const SEG = { torso: 0.5, upperArm: 0.3, foreArm: 0.28, thigh: 0.44, shin: 0.43, shoulderW: 0.2, hipW: 0.095 };

export const TECH_POSES = {
  stand: { lean: 0.02, head: [0.05, 0], arms: [[0.12, 0.25, 0.1], [0.12, 0.25, 0.1]], legs: [[0, 0.02], [0, 0.02]] },
  // both hands up holding the helmet over the astronaut's head (from behind)
  hold: { lean: -0.04, head: [-0.35, 0], arms: [[2.75, 0.45, 0.32], [2.75, 0.45, 0.32]], legs: [[0, 0.02], [0, 0.02]] },
  // lowering it onto the neck ring
  lower: { lean: 0.12, head: [0.15, 0], arms: [[2.05, 0.95, 0.38], [2.05, 0.95, 0.38]], legs: [[0.08, 0.12], [0.02, 0.06]] },
  // checking the lock ring at the neck with one hand, a clipboard in the other
  check: { lean: 0.08, head: [0.2, 0], arms: [[1.15, 1.25, 0.22], [0.55, 1.5, 0.15]], legs: [[0.02, 0.04], [0, 0.02]] },
};
export function techPose(a, b = a, k = 0) {
  const A = TECH_POSES[a];
  const B = TECH_POSES[b];
  const l = (x, y) => x + (y - x) * k;
  return {
    lean: l(A.lean, B.lean),
    head: A.head.map((v, i) => l(v, B.head[i])),
    arms: A.arms.map((arm, i) => arm.map((v, j) => l(v, B.arms[i][j]))),
    legs: A.legs.map((leg, i) => leg.map((v, j) => l(v, B.legs[i][j]))),
  };
}

const clean = (g) => {
  const o = g.index ? g.toNonIndexed() : g;
  if (!o.attributes.uv) o.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(o.attributes.position.count * 2), 2));
  for (const k of Object.keys(o.attributes)) if (!["position", "normal", "uv"].includes(k)) o.deleteAttribute(k);
  return o;
};
const merge = (list) => (list.length ? mergeGeometries(list.map(clean), false) : null);
const lathe = (pts, seg = 18) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
const sph = (r, x, y, z, sx = 1, sy = 1, sz = 1, ws = 14, hs = 10) => new THREE.SphereGeometry(r, ws, hs).scale(sx, sy, sz).translate(x, y, z);
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const torus = (r, t, y, sx = 1, sz = 1, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, 6, 20, arc).rotateX(Math.PI / 2).scale(sx, 1, sz).translate(0, y, 0);
/** A tapered limb hanging down -y from its joint: radii at the top and bottom, a few cloth folds. */
function limbGeo(len, r0, r1, folds = 0, foldAt = 0.5) {
  const pts = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    let r = r0 + (r1 - r0) * u;
    if (folds) r *= 1 + 0.06 * Math.max(0, Math.sin((u - foldAt + 0.15) * Math.PI * folds)) * (Math.abs(u - foldAt) < 0.25 ? 1 : 0);
    pts.push([r, -len * u]);
  }
  pts.unshift([0.001, 0.012]);
  pts.push([0.001, -len - 0.01]);
  return lathe(pts.map(([r, y]) => [r, y]), 14);
}

/** The figure's parts in each body frame, by material. */
function techGeometry({ glasses }) {
  const P = { cloth: {}, skin: {}, cap: {}, dark: {}, glove: {}, shoe: {}, accent: {}, metal: {} };
  const put = (frame, mat, g) => (P[mat][frame] = P[mat][frame] || []).push(g);
  // pelvis: the seat of the coveralls
  put("pelvis", "cloth", sph(0.15, 0, 0.0, 0, 1.0, 0.75, 0.78, 16, 10));
  // trunk (pivots at the waist): a lathed body, deeper at the chest, narrower at the waist
  const trunk = lathe(
    [
      [0.001, -0.02],
      [0.145, -0.01],
      [0.15, 0.08],
      [0.165, 0.2],
      [0.182, 0.32],
      [0.19, 0.4],
      [0.175, 0.46],
      [0.12, 0.5],
      [0.06, 0.52],
      [0.001, 0.525],
    ],
    20
  ).scale(1, 1, 0.72);
  put("trunk", "cloth", trunk);
  // shoulders (rounded), collar flaps turned down, the zip, two chest pockets, the patch, the belt
  for (const s of [-1, 1]) {
    put("trunk", "cloth", sph(0.075, s * 0.165, 0.455, 0, 1.1, 0.8, 1.0));
    put("trunk", "cloth", box(0.085, 0.012, 0.07, s * 0.05, 0.505, 0.08).rotateZ(s * -0.35).rotateX(0.35));
    put("trunk", "cloth", box(0.085, 0.085, 0.012, s * 0.085, 0.33, 0.135));
    put("trunk", "dark", box(0.07, 0.004, 0.004, s * 0.085, 0.37, 0.142));
  }
  put("trunk", "metal", box(0.008, 0.42, 0.006, 0, 0.27, 0.139));
  put("trunk", "accent", new THREE.CircleGeometry(0.03, 16).translate(0.09, 0.27, 0.141));
  put("trunk", "dark", torus(0.152, 0.012, 0.075, 1, 0.74));
  put("trunk", "metal", box(0.045, 0.03, 0.01, 0, 0.075, 0.115));
  // neck and head (the head frame pivots at the top of the neck)
  put("trunk", "skin", new THREE.CylinderGeometry(0.048, 0.054, 0.09, 12).translate(0, 0.56, 0.0));
  put("head", "skin", sph(0.094, 0, 0.1, 0.005, 0.86, 1.1, 0.98, 18, 14));
  put("head", "skin", sph(0.06, 0, 0.035, 0.03, 1.0, 0.75, 1.0)); // jaw
  put("head", "skin", sph(0.016, 0, 0.085, 0.098, 0.8, 1.0, 1.1, 8, 6)); // nose
  for (const s of [-1, 1]) {
    put("head", "skin", sph(0.02, s * 0.083, 0.095, 0.0, 0.5, 1.0, 0.8, 8, 6)); // ears
    put("head", "dark", sph(0.009, s * 0.032, 0.118, 0.083, 1, 0.7, 0.6, 8, 6)); // eyes
    put("head", "dark", box(0.03, 0.006, 0.006, s * 0.033, 0.136, 0.086)); // brows
  }
  put("head", "dark", box(0.03, 0.004, 0.004, 0, 0.055, 0.092)); // mouth
  // the skull cap (white, to the ears) and the comms headset: band, earcup, boom
  put("head", "cap", new THREE.SphereGeometry(0.1, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(0.92, 0.95, 1.03).translate(0, 0.118, -0.004));
  put("head", "cap", torus(0.088, 0.008, 0.118, 0.97, 1.08));
  put("head", "dark", new THREE.TorusGeometry(0.1, 0.007, 5, 18, Math.PI).rotateY(Math.PI / 2).translate(0, 0.11, 0));
  put("head", "dark", new THREE.CylinderGeometry(0.03, 0.03, 0.022, 14).rotateZ(Math.PI / 2).translate(0.092, 0.1, 0));
  put("head", "dark", new THREE.CylinderGeometry(0.004, 0.004, 0.11, 6).rotateX(Math.PI / 2).rotateY(-0.5).translate(0.075, 0.05, 0.06));
  put("head", "dark", sph(0.009, 0.045, 0.048, 0.106, 1, 1, 1, 8, 6));
  if (glasses) {
    for (const s of [-1, 1]) put("head", "dark", new THREE.TorusGeometry(0.019, 0.003, 5, 14).translate(s * 0.032, 0.117, 0.093));
    put("head", "dark", box(0.022, 0.003, 0.003, 0, 0.12, 0.094));
  }
  // arms (sleeves with an elbow fold), cuffs, gloves (palm, fingers, thumb)
  for (const s of ["L", "R"]) {
    put(`upper${s}`, "cloth", limbGeo(SEG.upperArm, 0.058, 0.048, 2, 0.85));
    put(`fore${s}`, "cloth", limbGeo(SEG.foreArm - 0.03, 0.05, 0.04, 2, 0.15));
    put(`fore${s}`, "cloth", new THREE.CylinderGeometry(0.043, 0.043, 0.03, 12).translate(0, -SEG.foreArm + 0.035, 0));
    const sx = s === "L" ? -1 : 1;
    put(`fore${s}`, "glove", sph(0.04, 0, -SEG.foreArm - 0.03, 0, 0.62, 1.0, 1.0, 10, 8));
    put(`fore${s}`, "glove", sph(0.032, 0, -SEG.foreArm - 0.085, 0.005, 0.55, 1.0, 0.95, 10, 8));
    put(`fore${s}`, "glove", sph(0.016, sx * -0.01, -SEG.foreArm - 0.04, 0.035, 0.8, 1.5, 0.8, 8, 6));
  }
  // legs (trouser folds at the knee), overshoes
  for (const s of ["L", "R"]) {
    put(`thigh${s}`, "cloth", limbGeo(SEG.thigh, 0.085, 0.06, 2, 0.95));
    put(`shin${s}`, "cloth", limbGeo(SEG.shin - 0.02, 0.06, 0.052, 3, 0.85));
    put(`shin${s}`, "shoe", sph(0.055, 0, -SEG.shin - 0.035, 0.055, 0.95, 0.6, 1.9, 14, 8));
  }
  const out = {};
  for (const [mat, frames] of Object.entries(P)) for (const [frame, list] of Object.entries(frames)) (out[frame] = out[frame] || {})[mat] = merge(list);
  return out;
}

const SKIN = ["#c49478", "#8d5f45", "#e0b49a"];

export default function PadTech({ stateRef, variant = 0 }) {
  const G = useMemo(() => techGeometry({ glasses: variant === 1 }), [variant]);
  const M = useMemo(() => {
    const std = (c, r, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
    return {
      cloth: std("#ecebe5", 0.88),
      cap: std("#f6f6f2", 0.8),
      skin: std(SKIN[variant % SKIN.length], 0.62),
      dark: std("#26282c", 0.5, 0.2),
      glove: std("#f4f3ee", 0.95),
      shoe: std("#dadad5", 0.7),
      accent: std("#c8452c", 0.55),
      metal: std("#b9bcc0", 0.35, 0.8),
    };
  }, [variant]);
  useEffect(
    () => () => {
      for (const f of Object.values(G)) for (const g of Object.values(f)) g && g.dispose();
      Object.values(M).forEach((m) => m.dispose());
    },
    [G, M]
  );
  const R = useRef({});
  const set = (k) => (el) => (R.current[k] = el);
  useFrame(() => {
    const s = stateRef.current;
    const J = R.current;
    if (!J.root || !s) return;
    J.root.visible = s.visible !== false;
    if (!J.root.visible) return;
    J.root.position.set(s.pos[0], s.pos[1], s.pos[2]);
    J.root.rotation.set(0, s.yaw || 0, 0);
    const p = s.pose || TECH_POSES.stand;
    J.trunk.rotation.x = p.lean;
    J.head.rotation.set(p.head[0], p.head[1], 0, "YXZ");
    ["L", "R"].forEach((k, i) => {
      const side = i === 0 ? -1 : 1;
      const [sw, el, ab] = p.arms[i];
      J[`sh${k}`].rotation.set(-sw, 0, side * ab);
      J[`el${k}`].rotation.set(-el, 0, 0);
      const [hip, knee] = p.legs[i];
      J[`hip${k}`].rotation.set(-hip, 0, side * 0.03);
      J[`knee${k}`].rotation.set(knee, 0, 0);
    });
  });
  const parts = (frame) => Object.entries(G[frame] || {}).map(([mat, g]) => g && <mesh key={mat} geometry={g} material={M[mat]} />);
  return (
    <group ref={set("root")}>
      {parts("pelvis")}
      <group ref={set("trunk")} position={[0, 0.07, 0]}>
        {parts("trunk")}
        <group ref={set("head")} position={[0, 0.6, 0]}>
          {parts("head")}
        </group>
        {["L", "R"].map((k, i) => (
          <group key={k} ref={set(`sh${k}`)} position={[(i === 0 ? -1 : 1) * SEG.shoulderW, SEG.torso - 0.06, 0]}>
            {parts(`upper${k}`)}
            <group ref={set(`el${k}`)} position={[0, -SEG.upperArm, 0]}>
              {parts(`fore${k}`)}
            </group>
          </group>
        ))}
      </group>
      {["L", "R"].map((k, i) => (
        <group key={k} ref={set(`hip${k}`)} position={[(i === 0 ? -1 : 1) * SEG.hipW, -0.03, 0]}>
          {parts(`thigh${k}`)}
          <group ref={set(`knee${k}`)} position={[0, -SEG.thigh, 0]}>
            {parts(`shin${k}`)}
          </group>
        </group>
      ))}
    </group>
  );
}
