import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { plumeMaterial } from "@/components/LanderModel";
import { CARRIER } from "@/data/carrier";

/**
 * LUNAVIA's lunar transfer carrier (data/carrier), in the payload frame
 * (metres, origin on the axis at its deck, +Y up the vehicle). It is the top
 * 1.35 m of LV-001's upper-stage cylinder: its skin is the black band under
 * the adapter (unchanged, 1.08 m) and a strip of the stage's white, its
 * separation plane just above the stage's orange band.
 *
 * Under the deck: a toroidal propellant tank; under the aft bulkhead, the
 * propulsion end — a conical thrust structure, and on its apex the gimballed
 * main engine (chamber, throat, a 2 m bell and its lighter nozzle extension,
 * a heat-darkened interior), with its feed lines and gimbal actuators. Four
 * RCS quads on the skin.
 *
 * `ctrlRef.current.carrier` (optional), read every frame:
 *   { engines 0..1 (the main engine: lunar orbit insertion, midcourse correction),
 *     rcs 0..1 (forward push: exhaust aft), retro 0..1 (backing away: exhaust
 *     forward), yaw -1..1 (the aft quads' side thrusters: + exhausts towards +Z,
 *     a torque about +X), inside: bool (draw the parts only seen once the upper
 *     stage has gone) }
 * Materials come from RocketModel (the launch vehicle's own paint).
 */
const DEG = Math.PI / 180;

const rod = (a, b, r, seg = 6) => {
  const d = b.clone().sub(a);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
};

let GEO = null;
function geometry() {
  if (GEO) return GEO;
  const { H, R, tank, engine: E, thrustCone: C, rcs } = CARRIER;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // LV-001's black band (unchanged), and the stage's white below it down to the separation plane
  const B = CARRIER.bandH;
  const skin = new THREE.CylinderGeometry(R, R, B, 48, 1, true).translate(0, -B / 2, 0);
  const skinLow = new THREE.CylinderGeometry(R, R, H - B, 48, 1, true).translate(0, -B - (H - B) / 2, 0);
  // Deck under the LM's mounts; the aft bulkhead: a plate over the thrust cone and an outer
  // ring, the tank showing between them.
  const deck = new THREE.CircleGeometry(R - 0.02, 48).rotateX(-Math.PI / 2);
  const aftCentre = new THREE.CircleGeometry(C.topR + 0.05, 32).rotateX(Math.PI / 2).translate(0, -H, 0);
  const aftRing = new THREE.RingGeometry(4.35, R, 48).rotateX(Math.PI / 2).translate(0, -H, 0);
  const torus = new THREE.TorusGeometry(tank.R, tank.r, 14, 48).rotateX(Math.PI / 2).translate(0, tank.y, 0);
  // Thrust structure: a cone of sheet and eight longerons, from the bulkhead to the gimbal.
  const cone = new THREE.CylinderGeometry(C.topR, C.bottomR, C.topY - C.bottomY, 32, 1, true).translate(0, (C.topY + C.bottomY) / 2, 0);
  const hw = [deck, aftCentre, aftRing];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    hw.push(rod(V(Math.cos(a) * (C.topR + 0.02), C.topY, Math.sin(a) * (C.topR + 0.02)), V(Math.cos(a) * (C.bottomR + 0.03), C.bottomY, Math.sin(a) * (C.bottomR + 0.03)), 0.045));
  }
  hw.push(new THREE.TorusGeometry(C.bottomR + 0.02, 0.05, 8, 24).rotateX(Math.PI / 2).translate(0, C.bottomY, 0));
  // Gimbal block, chamber and injector dome
  hw.push(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 20).translate(0, E.gimbalY - 0.06, 0));
  const chamber = new THREE.CylinderGeometry(E.chamberR, E.chamberR, E.gimbalY - 0.12 - (E.throatY + 0.1), 24).translate(0, (E.gimbalY - 0.12 + E.throatY + 0.1) / 2, 0);
  // Two feed lines from the tank, down the cone, into the injector; two gimbal actuators.
  const feeds = [];
  [-1, 1].forEach((s) => {
    const a = s > 0 ? 0.3 : Math.PI + 0.3;
    const p0 = V(Math.cos(a) * (tank.R - tank.r * 0.7), -H - 0.02, Math.sin(a) * (tank.R - tank.r * 0.7));
    const p1 = V(Math.cos(a) * (C.topR + 0.25), -H - 0.12, Math.sin(a) * (C.topR + 0.25));
    const p2 = V(Math.cos(a) * 0.62, C.bottomY - 0.05, Math.sin(a) * 0.62);
    const p3 = V(Math.cos(a) * 0.36, E.gimbalY - 0.2, Math.sin(a) * 0.36);
    feeds.push(rod(p0, p1, 0.07, 8), rod(p1, p2, 0.07, 8), rod(p2, p3, 0.07, 8));
    const b = a + Math.PI / 2;
    hw.push(rod(V(Math.cos(b) * (C.bottomR + 0.35), C.bottomY + 0.15, Math.sin(b) * (C.bottomR + 0.35)), V(Math.cos(b) * 0.5, E.throatY - 0.35, Math.sin(b) * 0.5), 0.05));
  });
  // The bell: throat to exit (a contoured nozzle), upper part dark, lighter extension below.
  const bellPts = (k) => {
    const pts = [];
    const L = E.throatY - E.exitY;
    for (let i = 0; i <= 24; i++) {
      const u = i / 24;
      pts.push(new THREE.Vector2((E.throatR + (E.exitR - E.throatR) * (1 - Math.pow(1 - u, 1.9))) * k, -u * L));
    }
    return pts;
  };
  const split = 9; // the extension starts here
  const outer = bellPts(1);
  const bellUpper = new THREE.LatheGeometry(outer.slice(0, split + 1), 40).translate(0, E.throatY, 0);
  const bellExt = new THREE.LatheGeometry(outer.slice(split), 40).translate(0, E.throatY, 0);
  const convergent = new THREE.LatheGeometry([new THREE.Vector2(E.chamberR, 0.1), new THREE.Vector2(E.throatR * 1.02, 0)], 32).translate(0, E.throatY, 0);
  const inner = new THREE.LatheGeometry(bellPts(0.975), 40).translate(0, E.throatY, 0);
  const lip = new THREE.TorusGeometry(E.exitR, 0.03, 6, 48).rotateX(Math.PI / 2).translate(0, E.exitY, 0);
  // RCS quads on the skin: a housing and four nozzles (fore, aft, both sides)
  const quads = [];
  const quadAt = (d) => {
    const a = d * DEG;
    const out = V(Math.cos(a), 0, Math.sin(a));
    return { out, c: out.clone().multiplyScalar(R + 0.16).setY(rcs.y), side: V(-out.z, 0, out.x) };
  };
  rcs.azDeg.forEach((d) => {
    const { out, c, side } = quadAt(d);
    const box = new THREE.BoxGeometry(0.42, 0.5, 0.3);
    box.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), out));
    quads.push(box.translate(c.x, c.y, c.z));
    [[V(0, 1, 0), 0.3], [V(0, -1, 0), 0.3], [side, 0.26], [side.clone().negate(), 0.26]].forEach(([dir, k]) => {
      const n = new THREE.CylinderGeometry(0.03, 0.07, 0.16, 8);
      n.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, -1, 0), dir));
      const p = c.clone().addScaledVector(dir, k);
      quads.push(n.translate(p.x, p.y, p.z));
    });
  });
  const flat = (a) => mergeGeometries(a.map((g) => (g.index ? g.toNonIndexed() : g)), false);
  // RCS exhaust: a cone from a nozzle along dir.
  const puffAlong = (from, dir, len = 1.4) => {
    const g = new THREE.CylinderGeometry(0.04, 0.32, len, 10, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, -1, 0), dir));
    const p = from.clone().addScaledVector(dir, len / 2);
    return g.translate(p.x, p.y, p.z);
  };
  const puffs = (dir, ks) => flat(rcs.azDeg.filter((d, i) => ks.includes(i)).map((d) => {
    const q = quadAt(d);
    const dd = dir(q);
    return puffAlong(q.c.clone().addScaledVector(dd, 0.36), dd);
  }));
  // Main engine plume: a faint wide vacuum plume and a brighter core, down the axis from the exit.
  const plumeOuter = new THREE.CylinderGeometry(E.exitR * 0.96, 5.5, 16, 32, 1, true).translate(0, E.exitY - 8, 0);
  const plumeCore = new THREE.CylinderGeometry(E.exitR * 0.72, 0.12, 4.5, 24, 1, true).translate(0, E.exitY - 2.25, 0);
  GEO = {
    skin,
    skinLow,
    hw: flat(hw),
    cone,
    torus,
    chamber: flat([chamber, convergent]),
    bellUpper,
    bellExt,
    inner,
    lip,
    feeds: flat(feeds),
    quads: flat(quads),
    puffs: puffs(() => V(0, -1, 0), [0, 1, 2, 3]),
    retroPuffs: puffs(() => V(0, 1, 0), [0, 1, 2, 3]),
    // The quads at 0° and 180° (on ±X) fire sideways along ±Z to turn the assembly about X.
    yawPos: puffs(() => V(0, 0, 1), [0, 2]),
    yawNeg: puffs(() => V(0, 0, -1), [0, 2]),
    plumeOuter,
    plumeCore,
  };
  return GEO;
}

export default function CarrierModel({ ctrlRef = null, materials, shadows = false }) {
  const G = geometry();
  const insideRef = useRef();
  const puffRef = useRef();
  const retroRef = useRef();
  const yawPosRef = useRef();
  const yawNegRef = useRef();
  const outerRef = useRef();
  const coreRef = useRef();
  const M = useMemo(
    () => ({
      puff: new THREE.MeshBasicMaterial({ color: "#dfe6ff", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      outer: plumeMaterial(0.55, "#ffe8d0", "#ff9a66", false),
      core: plumeMaterial(1.3, "#ffffff", "#ffc48a", true),
      tank: new THREE.MeshStandardMaterial({ color: "#b8925a", roughness: 0.42, metalness: 0.6 }),
      // Engine: a dark machined upper bell, a lighter radiatively cooled extension, a sooty
      // heat-darkened interior that glows faintly while the engine runs.
      bellUpper: new THREE.MeshStandardMaterial({ color: "#4f4d4a", roughness: 0.45, metalness: 0.8, side: THREE.DoubleSide }),
      bellExt: new THREE.MeshStandardMaterial({ color: "#bdb6aa", roughness: 0.34, metalness: 0.72, side: THREE.DoubleSide }),
      inner: new THREE.MeshStandardMaterial({ color: "#121110", roughness: 0.85, metalness: 0.3, side: THREE.BackSide, emissive: new THREE.Color("#ff7a2e"), emissiveIntensity: 0 }),
      chamber: new THREE.MeshStandardMaterial({ color: "#77736c", roughness: 0.4, metalness: 0.85 }),
      feeds: new THREE.MeshStandardMaterial({ color: "#c9ccd1", roughness: 0.3, metalness: 0.9 }),
    }),
    []
  );

  useFrame((state) => {
    const c = ((ctrlRef && ctrlRef.current) || {}).carrier || {};
    const k = c.engines || 0;
    const t = state.clock.elapsedTime;
    if (insideRef.current) insideRef.current.visible = !!c.inside;
    const yaw = c.yaw || 0;
    const puff = Math.max(c.rcs || 0, c.retro || 0, Math.abs(yaw));
    if (puffRef.current) puffRef.current.visible = (c.rcs || 0) > 0.02;
    if (retroRef.current) retroRef.current.visible = (c.retro || 0) > 0.02;
    if (yawPosRef.current) yawPosRef.current.visible = yaw > 0.02;
    if (yawNegRef.current) yawNegRef.current.visible = yaw < -0.02;
    M.puff.opacity = 0.32 * puff;
    M.inner.emissiveIntensity = 0.9 * k;
    const on = k > 0.02;
    if (outerRef.current) {
      outerRef.current.visible = on;
      coreRef.current.visible = on;
      if (on) {
        const ex = CARRIER.engine.exitY;
        const so = (0.3 + 0.7 * k) * (1 + 0.035 * Math.sin(t * 47));
        const sc = 0.35 + 0.65 * k;
        outerRef.current.scale.set(1, so, 1);
        coreRef.current.scale.set(1, sc, 1);
        // scale about the exit plane
        outerRef.current.position.y = ex * (1 - so);
        coreRef.current.position.y = ex * (1 - sc);
        M.outer.uniforms.uThrust.value = k;
        M.outer.uniforms.uTime.value = t;
        M.core.uniforms.uThrust.value = k;
        M.core.uniforms.uTime.value = t;
      }
    }
  });

  return (
    <group name="carrier">
      <mesh geometry={G.skin} material={materials.black} castShadow={shadows} receiveShadow={shadows} />
      <mesh geometry={G.skinLow} material={materials.white} castShadow={shadows} receiveShadow={shadows} />
      <mesh geometry={G.quads} material={materials.hardware} castShadow={shadows} />
      {/* The propulsion end, seen once the upper stage has separated */}
      <group ref={insideRef} visible={false}>
        <mesh geometry={G.hw} material={materials.hardware} castShadow={shadows} receiveShadow={shadows} />
        <mesh geometry={G.cone} material={materials.structure || materials.hardware} castShadow={shadows} receiveShadow={shadows} />
        <mesh geometry={G.torus} material={M.tank} />
        <mesh geometry={G.chamber} material={M.chamber} castShadow={shadows} />
        <mesh geometry={G.feeds} material={M.feeds} />
        <mesh geometry={G.bellUpper} material={M.bellUpper} castShadow={shadows} receiveShadow={shadows} />
        <mesh geometry={G.bellExt} material={M.bellExt} castShadow={shadows} receiveShadow={shadows} />
        <mesh geometry={G.inner} material={M.inner} />
        <mesh geometry={G.lip} material={M.bellUpper} />
      </group>
      <mesh ref={puffRef} geometry={G.puffs} material={M.puff} visible={false} renderOrder={2} />
      <mesh ref={retroRef} geometry={G.retroPuffs} material={M.puff} visible={false} renderOrder={2} />
      <mesh ref={yawPosRef} geometry={G.yawPos} material={M.puff} visible={false} renderOrder={2} />
      <mesh ref={yawNegRef} geometry={G.yawNeg} material={M.puff} visible={false} renderOrder={2} />
      <mesh ref={outerRef} geometry={G.plumeOuter} material={M.outer} visible={false} renderOrder={2} />
      <mesh ref={coreRef} geometry={G.plumeCore} material={M.core} visible={false} renderOrder={3} />
    </group>
  );
}
