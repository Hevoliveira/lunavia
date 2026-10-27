import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FLOAT, M_PER_UNIT, curvatureDrop, seaSurface } from "@/data/descentScene";
import {
  BASKET_POINT,
  CAPSULE_YAW,
  COLLAR,
  HATCH_SWING,
  RAFT,
  RECOVERY,
  SHIP,
  cameraAt,
  collarAt,
  crewAt,
  hatchAt,
  heliAt,
  hoistAt,
  raftAt,
  swimmerAt,
} from "@/data/oceanRecovery";
import HelicopterModel from "./HelicopterModel";
import RecoveryFigure, { posed } from "./RecoveryFigure";

/*
 * OCEAN RECOVERY's scene layer, inside the MISSION COMPLETE scene (components/scenes/ReentryScene,
 * final): the same sea, clouds, Sun and floating capsule; this adds the helicopter, the swimmers,
 * the collar, the raft, the opening hatch, the crew, the basket and the carrier, all placed from
 * data/oceanRecovery at the cinematic's clock (recRef.current.t), riding the very waves that are
 * drawn (data/descentScene seaSurface). Nothing of it exists until WATCH RECOVERY, and it all goes
 * when the cinematic ends (the parent unmounts it).
 */

const M = M_PER_UNIT;
const S = 1 / M; // metres → scene units
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();

// the capsule's frame in metres (the CSM design's own): the cone's slope at the hatch
const CONE_SLOPE = Math.atan2(0.36 * 3.9, 0.545 * 3.9);
const bandAt = (y) => 1.95 - 0.6606 * (y - 0.2925);
const HATCH = { y: 1.0, w: 0.92, h: 0.82 };
const COLLAR_Y = FLOAT.waterlineY * M + 0.14; // the collar riding high on its buoyancy, just above the waterline

/* ---- the flotation collar: a torus that wraps round and inflates (one draw, no rebuild) ---- */
function collarMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.02 });
  m.userData.uniforms = { uTube: { value: COLLAR.folded }, uArc: { value: 0 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, m.userData.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 aCentre;\nattribute vec3 aDir;\nattribute float aAng;\nuniform float uTube;\nvarying float vAng;")
      .replace("#include <beginnormal_vertex>", "vec3 objectNormal = aDir;")
      .replace("#include <begin_vertex>", "vec3 transformed = aCentre + aDir * uTube;\nvAng = aAng;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uArc;\nvarying float vAng;")
      .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\nif (abs(vAng) > uArc) discard;");
  };
  return m;
}
function collarGeometry() {
  const NA = 96;
  const NT = 14;
  const pos = [];
  const ctr = [];
  const dir = [];
  const ang = [];
  const col = [];
  const idx = [];
  const base = new THREE.Color("#858157"); // olive drab
  const strap = new THREE.Color("#2e2e25");
  for (let i = 0; i <= NA; i++) {
    // angle measured from the back of the capsule (opposite the hatch), both ways round
    const a = (i / NA) * Math.PI * 2;
    const th = a - Math.PI; // -π .. π, 0 at the back
    const cx = Math.sin(a + Math.PI) * COLLAR.ringR;
    const cz = Math.cos(a + Math.PI) * COLLAR.ringR;
    const seg = (a / (Math.PI * 2)) * COLLAR.segments;
    const isStrap = Math.abs(seg - Math.round(seg)) < 0.035;
    for (let j = 0; j < NT; j++) {
      const b = (j / NT) * Math.PI * 2;
      const rx = Math.sin(a + Math.PI);
      const rz = Math.cos(a + Math.PI);
      const d = [rx * Math.cos(b), Math.sin(b), rz * Math.cos(b)];
      ctr.push(cx, 0, cz);
      dir.push(...d);
      pos.push(cx + d[0] * COLLAR.tubeR, d[1] * COLLAR.tubeR, cz + d[2] * COLLAR.tubeR);
      ang.push(th);
      const c = isStrap ? strap : base;
      const shade = 0.92 + 0.08 * Math.sin(b * 3 + i);
      col.push(c.r * shade, c.g * shade, c.b * shade);
    }
  }
  for (let i = 0; i < NA; i++) {
    for (let j = 0; j < NT; j++) {
      const a = i * NT + j;
      const b = i * NT + ((j + 1) % NT);
      const c = (i + 1) * NT + j;
      const d = (i + 1) * NT + ((j + 1) % NT);
      idx.push(a, c, b, b, c, d); // outward-facing (counter-clockwise seen from outside)
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aCentre", new THREE.Float32BufferAttribute(ctr, 3));
  g.setAttribute("aDir", new THREE.Float32BufferAttribute(dir, 3));
  g.setAttribute("aAng", new THREE.Float32BufferAttribute(ang, 1));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(dir, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), COLLAR.ringR + 0.6);
  return g;
}

/* ---- the life raft: a rounded tube with a floor --------------------------------------------- */
function raftGeometry() {
  const L = RAFT.length / 2 - RAFT.tubeR;
  const W = RAFT.width / 2 - RAFT.tubeR;
  const rc = 0.55; // the corners' radius
  const pts = [];
  const corner = (cx, cz, a0) => {
    for (let i = 0; i <= 6; i++) {
      const a = a0 + (i / 6) * (Math.PI / 2);
      pts.push(new THREE.Vector3(cx + Math.cos(a) * rc, 0, cz + Math.sin(a) * rc));
    }
  };
  corner(L - rc, W - rc, 0);
  corner(-(L - rc), W - rc, Math.PI / 2);
  corner(-(L - rc), -(W - rc), Math.PI);
  corner(L - rc, -(W - rc), Math.PI * 1.5);
  const curve = new THREE.CatmullRomCurve3(pts, true, "centripetal");
  const tube = new THREE.TubeGeometry(curve, 64, RAFT.tubeR, 10, true);
  const shape = new THREE.Shape();
  pts.forEach((p, i) => (i ? shape.lineTo(p.x, p.z) : shape.moveTo(p.x, p.z)));
  const floor = new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2).translate(0, -RAFT.tubeR * 0.6, 0);
  const clean = (g) => {
    const o = g.index ? g.toNonIndexed() : g;
    ["uv"].forEach((k) => o.deleteAttribute(k));
    return o;
  };
  return { tube: clean(tube), floor: clean(floor) };
}

/* ---- the rescue basket (a frame basket on a four-leg bridle) -------------------------------- */
function basketGeometry() {
  const parts = [];
  const rod = (a, b, r = 0.022) => {
    const A = new THREE.Vector3(...a);
    const B = new THREE.Vector3(...b);
    const g = new THREE.CylinderGeometry(r, r, A.distanceTo(B), 5, 1);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
    parts.push(g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2));
  };
  // drawn from the bridle's apex (y = 0): the rim 1.0 m below, the floor 1.5 m below
  const w = 0.48;
  const d = 0.33;
  const h = 0.5;
  const R0 = -1.0;
  const c = [[-w, -d], [w, -d], [w, d], [-w, d]];
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = c[i];
    const [x1, z1] = c[(i + 1) % 4];
    rod([x0, R0, z0], [x1, R0, z1]);
    rod([x0, R0 - h, z0], [x1, R0 - h, z1]);
    rod([x0, R0, z0], [x0, R0 - h, z0]);
    rod([x0, R0, z0], [0, 0, 0], 0.012); // the bridle
  }
  rod([-w, R0 - h * 0.5, -d], [w, R0 - h * 0.5, -d], 0.016);
  rod([-w, R0 - h * 0.5, d], [w, R0 - h * 0.5, d], 0.016);
  const clean = (g) => {
    const o = g.index ? g.toNonIndexed() : g;
    o.deleteAttribute("uv");
    return o;
  };
  const frame = mergeGeometries(parts.map(clean));
  const floor = new THREE.BoxGeometry(w * 2, 0.03, d * 2).translate(0, R0 - h, 0);
  return { frame, floor };
}

/* ---- the recovery ship, far out: an aircraft carrier's silhouette ---------------------------- */
function carrierGeometry() {
  const parts = [];
  const box = (w, h, d, x, y, z, ry = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (ry) g.rotateY(ry);
    parts.push(g.translate(x, y, z));
  };
  // the hull (tapering to the bow), the hangar deck, the flight deck with its angled deck, the island
  const hull = new THREE.Shape();
  hull.moveTo(-130, -14);
  hull.lineTo(110, -14);
  hull.quadraticCurveTo(140, -6, 140, 0);
  hull.quadraticCurveTo(140, 6, 110, 14);
  hull.lineTo(-130, 14);
  hull.closePath();
  parts.push(new THREE.ExtrudeGeometry(hull, { depth: 17, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, -2, 0));
  box(250, 6, 30, -5, 18, 0); // hangar sides
  box(268, 1.4, 34, 0, 21.5, 0); // flight deck
  box(110, 1.4, 22, -55, 21.5, -20, 0.15); // angled deck overhang (port)
  box(32, 14, 10, 15, 29, 19); // the island
  box(10, 9, 6, 18, 40, 19); // the bridge and stack
  box(1.2, 18, 1.2, 12, 50, 19); // the mast
  box(9, 1, 1, 12, 56, 19); // radar yard
  const clean = (g) => {
    const o = g.index ? g.toNonIndexed() : g;
    o.deleteAttribute("uv");
    return o;
  };
  return mergeGeometries(parts.map(clean));
}

/* ---- the foam a swimmer stirs up (a soft white ring on the water: black wetsuits read on the sea) */
function foamTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(32, 32, 6, 32, 32, 31);
  g.addColorStop(0, "rgba(255,255,255,0.0)");
  g.addColorStop(0.35, "rgba(255,255,255,0.75)");
  g.addColorStop(0.6, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---- the director --------------------------------------------------------------------------- */
export default function OceanRecovery({ recRef, atmo, poseRef }) {
  const heliState = useRef({ visible: false, pos: [0, 0, 0], yaw: 0, pitch: 0, roll: 0, door: 0, rotor: 3.4, scale: S });
  const swim = [useRef({ visible: false }), useRef({ visible: false })];
  const crew = [useRef({ visible: false }), useRef({ visible: false }), useRef({ visible: false })];
  const capsuleFrame = useRef();
  const hatchHinge = useRef();
  const collar = useRef();
  const raft = useRef();
  const raftFloor = useRef();
  const basket = useRef();
  const cable = useRef();
  const carrier = useRef();
  const smoothAtt = useRef({ pitch: 0, roll: 0 });
  const foam = [useRef(), useRef()];
  const g = useMemo(() => ({ collar: collarGeometry(), raft: raftGeometry(), basket: basketGeometry(), carrier: carrierGeometry() }), []);
  const mats = useMemo(
    () => ({
      collar: collarMaterial(),
      raft: new THREE.MeshStandardMaterial({ color: "#6f7468", roughness: 0.8, metalness: 0.02 }),
      raftFloor: new THREE.MeshStandardMaterial({ color: "#3b3f3a", roughness: 0.9 }),
      hatch: new THREE.MeshStandardMaterial({ color: "#121416", roughness: 0.4, metalness: 0.3 }),
      hatchRim: new THREE.MeshStandardMaterial({ color: "#c9ccd2", roughness: 0.38, metalness: 0.5 }),
      basket: new THREE.MeshStandardMaterial({ color: "#e2a21d", roughness: 0.55, metalness: 0.3 }),
      cable: new THREE.MeshStandardMaterial({ color: "#2b2b2b", roughness: 0.5, metalness: 0.6 }),
      // the carrier at 6 km: haze grey, already part-way to the horizon's colour
      foam: new THREE.MeshBasicMaterial({ map: foamTexture(), transparent: true, depthWrite: false, opacity: 0.85, toneMapped: false }),
      carrier: new THREE.MeshStandardMaterial({ color: "#8c97a0", roughness: 0.9, metalness: 0, emissive: new THREE.Color("#6d7f8f"), emissiveIntensity: 0.25 }),
    }),
    []
  );

  // released when the cinematic ends: every geometry, material and texture under this layer
  // (the helicopter's and the figures' too, and those declared inline) — nothing stays on the GPU
  const root = useRef();
  useEffect(() => {
    // listed now, while mounted (by the time of the cleanup the children are already detached)
    const owned = [];
    if (root.current)
      root.current.traverse((o) => {
        if (o.geometry) owned.push(o.geometry);
        if (o.material) owned.push(...(Array.isArray(o.material) ? o.material : [o.material]));
      });
    return () => {
      const seen = new Set();
      const free = (x) => {
        if (!x || seen.has(x)) return;
        seen.add(x);
        if (x.map) free(x.map);
        x.dispose();
      };
      owned.forEach(free);
      [g.collar, g.raft.tube, g.raft.floor, g.basket.frame, g.basket.floor, g.carrier].forEach(free);
      Object.values(mats).forEach(free);
    };
  }, [g, mats]);

  useFrame((state, dt) => {
    const rec = recRef.current;
    const on = !!(rec && rec.active);
    const vis = (o, v) => o && (o.visible = v);
    [capsuleFrame, raft, basket, cable, carrier].forEach((r) => vis(r.current, on));
    heliState.current.visible = on && heliState.current.visible;
    if (!on) {
      foam.forEach((r) => vis(r.current, false));
      heliState.current.visible = false;
      swim.forEach((r) => (r.current.visible = false));
      crew.forEach((r) => (r.current.visible = false));
      return;
    }
    if (!rec.paused) rec.t = Math.min(RECOVERY.duration, rec.t + dt);
    if (rec.t >= RECOVERY.duration && !rec.done) {
      rec.done = true;
      if (rec.onEnd) rec.onEnd();
    }
    const t = rec.t;
    const wt = state.clock.elapsedTime; // the waves' own clock
    const seaAt = (xm, zm) => {
      const w = seaSurface(xm + atmo.drift * M, zm, wt);
      return { y: atmo.seaY + w.h * S, dx: w.dx, dz: w.dz };
    };
    const toScene = (p, yScene) => [p[0] * S, yScene, p[2] * S];

    // the capsule's frame (its floating pose this frame: written by the Vehicle before this)
    const pose = poseRef.current;
    const cf = capsuleFrame.current;
    if (cf) {
      cf.position.copy(pose.pos);
      cf.quaternion.copy(pose.quat);
    }
    // the hatch swings out on its hinge; the collar wraps round and fills
    if (hatchHinge.current) hatchHinge.current.rotation.y = -hatchAt(t) * HATCH_SWING;
    const C = collarAt(t);
    if (collar.current) {
      collar.current.visible = C.visible;
      const u = mats.collar.userData.uniforms;
      u.uArc.value = 0.12 + C.wrap * (Math.PI + 0.02);
      u.uTube.value = COLLAR.folded + (COLLAR.tubeR - COLLAR.folded) * C.fill;
    }

    // the raft, on the swell beside the hatch
    const R = raftAt(t);
    const rs = seaAt(RAFT.centre[0], RAFT.centre[1]);
    if (raft.current) {
      raft.current.visible = R.visible;
      raft.current.position.set(RAFT.centre[0] * S, rs.y + (0.06 * S) * R.fill, RAFT.centre[1] * S);
      _e.set(Math.atan(rs.dz) * 0.8, CAPSULE_YAW, -Math.atan(rs.dx) * 0.8, "YXZ");
      raft.current.quaternion.setFromEuler(_e);
      const k = 0.35 + 0.65 * R.fill;
      raft.current.scale.set(S * k, S * (0.3 + 0.7 * R.fill), S * k);
    }
    if (raftFloor.current) raftFloor.current.visible = R.fill > 0.6;

    // the helicopter: its path, with its attitude eased (a machine does not snap)
    const H = heliAt(t);
    const sa = smoothAtt.current;
    const ke = Math.min(1, dt * 3);
    sa.pitch += (H.pitch - sa.pitch) * ke;
    sa.roll += (H.roll - sa.roll) * ke;
    Object.assign(heliState.current, { visible: H.visible, pos: toScene(H.pos, atmo.seaY + H.pos[1] * S), yaw: H.yaw, pitch: sa.pitch, roll: sa.roll, door: H.door, rotor: 3.4, scale: S });

    // the swimmers
    swim.forEach((ref, i) => {
      const s = swimmerAt(i, t);
      const st = ref.current;
      st.visible = s.visible;
      const fm = foam[i].current;
      if (fm) fm.visible = s.visible && s.mode !== "fall";
      if (!s.visible) return;
      const sea = seaAt(s.pos[0], s.pos[2]);
      if (fm) {
        // stretched along the way they swim, round where they work; it breathes with the strokes
        const swimming = s.mode === "swim";
        const r = (swimming ? 1.0 : 0.8) * (1 + 0.08 * Math.sin((s.stroke || 0) * 1.3));
        fm.position.set(s.pos[0] * S, sea.y + 0.02 * S, s.pos[2] * S);
        fm.rotation.set(-Math.PI / 2, 0, s.face || 0, "YXZ");
        fm.scale.set(r * (swimming ? 2.4 : 1.6) * S, r * 1.5 * S, 1);
      }
      // a swimmer's pelvis about 0.9 m down treading, shoulders out; flat on the water swimming
      let y;
      let pitch = 0;
      let pose;
      if (s.mode === "fall") {
        y = atmo.seaY + s.pos[1] * S;
        pose = posed("fall");
      } else if (s.mode === "swim") {
        y = sea.y - 0.22 * S;
        pitch = 1.2;
        pose = posed("swim", "swim", 0, s.stroke, "swim");
      } else if (s.mode === "work") {
        y = sea.y - 0.55 * S;
        pitch = 0.25;
        pose = posed("work", "work", 0, s.stroke, "work");
      } else {
        y = sea.y - 0.62 * S;
        pose = posed("tread", "tread", 0, s.stroke, "tread");
      }
      // (face is a yaw for +x forward; the figure faces +z: a quarter turn)
      Object.assign(st, { visible: true, pos: [s.pos[0] * S, y, s.pos[2] * S], yaw: s.face + Math.PI / 2, pitch, roll: 0, pose, scale: S });
    });

    // the crew
    const hatchWorld = (local) => {
      // a point of the capsule's frame (CSM metres) in the scene
      _v.set(local[0], local[1], local[2]).multiplyScalar(S).applyQuaternion(pose.quat).add(pose.pos);
      return [_v.x, _v.y, _v.z];
    };
    const rH = bandAt(HATCH.y);
    const sill = [0, HATCH.y - 0.15, rH + 0.45];
    const ho = hoistAt(t);
    // the bridle's apex: floating with the swell in the water, else on the cable
    const basketScene = [ho.basket[0] * S, 0, ho.basket[2] * S];
    if (ho.inWater) basketScene[1] = seaAt(ho.basket[0], ho.basket[2]).y + 1.25 * S;
    else basketScene[1] = atmo.seaY + ho.basket[1] * S;
    const inBasket = [basketScene[0], basketScene[1] - 1.25 * S, basketScene[2]];
    crew.forEach((ref, i) => {
      const c = crewAt(i, t);
      const st = ref.current;
      if (c.where === "inside" || c.where === "aboard") {
        st.visible = false;
        return;
      }
      const seat = seaAt(c.seat[0], c.seat[1]);
      const seatPos = [c.seat[0] * S, seat.y + 0.18 * S, c.seat[1] * S];
      const faceHull = Math.atan2(-c.seat[0], -c.seat[1]); // looking at the capsule
      let pos;
      let yaw = faceHull;
      let pose;
      if (c.where === "hatch") {
        // rising in the hatch: from inside to sitting on the sill, looking out
        const a = [0, HATCH.y - 0.55, rH - 0.55];
        pos = hatchWorld(a.map((v, j) => v + (sill[j] - v) * c.k));
        yaw = CAPSULE_YAW;
        pose = posed("crouch", "emerge", c.k);
      } else if (c.where === "out") {
        const a = hatchWorld(sill);
        const k = c.k;
        pos = [a[0] + (seatPos[0] - a[0]) * k, a[1] + (seatPos[1] - a[1]) * k + Math.sin(Math.PI * k) * 0.35 * S, a[2] + (seatPos[2] - a[2]) * k];
        yaw = CAPSULE_YAW;
        pose = posed("emerge", "sit", k);
      } else if (c.where === "raft") {
        pos = seatPos;
        pose = posed("sit");
      } else if (c.where === "basket") {
        const k = c.k;
        const b = inBasket;
        pos = [seatPos[0] + (b[0] - seatPos[0]) * k, seatPos[1] + (b[1] - seatPos[1]) * k + Math.sin(Math.PI * k) * 0.3 * S, seatPos[2] + (b[2] - seatPos[2]) * k];
        pose = posed("sit", "basket", k);
      } else {
        // "lift": in the basket
        pos = inBasket;
        yaw = H.yaw + Math.PI / 2;
        pose = posed("basket");
      }
      Object.assign(st, { visible: true, pos, yaw, pitch: 0, roll: 0, pose, scale: S });
    });

    // the basket and its cable
    if (basket.current) {
      basket.current.visible = ho.visible;
      basket.current.position.set(basketScene[0], basketScene[1], basketScene[2]);
      basket.current.rotation.set(0, H.yaw, 0);
      basket.current.scale.setScalar(S);
    }
    if (cable.current) {
      const hook = [ho.hook[0] * S, atmo.seaY + ho.hook[1] * S, ho.hook[2] * S];
      const top = basketScene;
      const len = Math.hypot(hook[0] - top[0], hook[1] - top[1], hook[2] - top[2]);
      cable.current.visible = ho.visible && len > 0.01;
      cable.current.position.set((hook[0] + top[0]) / 2, (hook[1] + top[1]) / 2, (hook[2] + top[2]) / 2);
      _v.set(hook[0] - top[0], hook[1] - top[1], hook[2] - top[2]).normalize();
      _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _v);
      cable.current.quaternion.copy(_q);
      cable.current.scale.set(1, Math.max(0.001, len), 1);
    }

    // the carrier far out, on the curve of the sea
    if (carrier.current) {
      const d = Math.hypot(SHIP.pos[0], SHIP.pos[2]) * S;
      carrier.current.position.set(SHIP.pos[0] * S, atmo.seaY - curvatureDrop(d), SHIP.pos[2] * S);
      carrier.current.rotation.set(0, SHIP.heading, 0);
      carrier.current.scale.setScalar(S);
    }

    // read-only, for the validation tooling
    if (typeof window !== "undefined") {
      const cam = cameraAt(t);
      window.__lvRecovery = { t, shot: cam.shot, heli: H.pos, heliYaw: H.yaw, door: H.door, collar: C, raft: R, hatch: hatchAt(t), crew: [0, 1, 2].map((i) => crewAt(i, t).where), swimmers: [0, 1].map((i) => swimmerAt(i, t).mode), hoist: { visible: ho.visible, cable: ho.cable, occupied: ho.occupied }, calls: state.gl.info.render.calls, tris: state.gl.info.render.triangles };
    }
  });

  return (
    <group ref={root}>
      {/* in the capsule's own frame (CSM metres): the collar and the hatch door */}
      <group ref={capsuleFrame} visible={false}>
        <group scale={S}>
          <mesh ref={collar} geometry={g.collar} material={mats.collar} position={[0, COLLAR_Y, 0]} visible={false} frustumCulled={false} />
          <group position={[0, HATCH.y, bandAt(HATCH.y) + 0.035]} rotation={[-CONE_SLOPE, 0, 0]}>
            <group ref={hatchHinge} position={[-HATCH.w / 2, 0, 0]}>
              <mesh material={mats.hatch} position={[HATCH.w / 2, 0, 0.012]}>
                <boxGeometry args={[HATCH.w - 0.02, HATCH.h - 0.02, 0.05]} />
              </mesh>
              <mesh material={mats.hatchRim} position={[HATCH.w / 2 + 0.3, 0, 0.05]}>
                <boxGeometry args={[0.06, 0.2, 0.04]} />
              </mesh>
            </group>
          </group>
        </group>
      </group>
      <group ref={raft} visible={false}>
        <mesh geometry={g.raft.tube} material={mats.raft} />
        <mesh ref={raftFloor} geometry={g.raft.floor} material={mats.raftFloor} />
      </group>
      <group ref={basket} visible={false}>
        <mesh geometry={g.basket.frame} material={mats.basket} />
        <mesh geometry={g.basket.floor} material={mats.basket} />
      </group>
      <mesh ref={cable} material={mats.cable} visible={false}>
        <cylinderGeometry args={[0.012 * S, 0.012 * S, 1, 4, 1]} />
      </mesh>
      <mesh ref={carrier} geometry={g.carrier} material={mats.carrier} visible={false} />
      <HelicopterModel stateRef={heliState} />
      {swim.map((r, i) => (
        <RecoveryFigure key={`s${i}`} kind="swimmer" stateRef={r} />
      ))}
      {foam.map((r, i) => (
        <mesh key={`f${i}`} ref={r} material={mats.foam} visible={false} renderOrder={2}>
          <planeGeometry args={[1, 1]} />
        </mesh>
      ))}
      {crew.map((r, i) => (
        <RecoveryFigure key={`c${i}`} kind="crew" stateRef={r} />
      ))}
    </group>
  );
}

/** The cinematic's camera in the scene (units), for the reentry scene's camera rig. */
export function recoveryCameraScene(t, seaY) {
  const c = cameraAt(t);
  return { pos: [c.pos[0] * S, seaY + c.pos[1] * S, c.pos[2] * S], look: [c.look[0] * S, seaY + c.look[1] * S, c.look[2] * S], fov: c.fov, shot: c.shot };
}
export const _basketPoint = BASKET_POINT;
