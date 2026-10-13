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
 * separation plane just above the stage's orange band. Under the deck: a toroidal propellant tank, the thrust
 * structure and four small engines; four RCS quads on the skin.
 *
 * `ctrlRef.current.carrier` (optional), read every frame:
 *   { engines 0..1 (lunar orbit insertion), rcs 0..1 (forward push: exhaust aft),
 *     retro 0..1 (backing away: exhaust forward), inside: bool (draw the parts
 *     only seen once the upper stage has gone) }
 * Materials come from RocketModel (the launch vehicle's own paint).
 */
const DEG = Math.PI / 180;

let GEO = null;
function geometry() {
  if (GEO) return GEO;
  const { H, R, tank, engines, rcs } = CARRIER;
  // LV-001's black band (unchanged), and the stage's white below it down to the separation plane
  const B = CARRIER.bandH;
  const skin = new THREE.CylinderGeometry(R, R, B, 48, 1, true).translate(0, -B / 2, 0);
  const skinLow = new THREE.CylinderGeometry(R, R, H - B, 48, 1, true).translate(0, -B - (H - B) / 2, 0);
  // Deck under the LM's mounts, and the aft bulkhead: a centre plate and an outer ring,
  // the tank showing between them, the engines on struts under it.
  const deck = new THREE.CircleGeometry(R - 0.02, 48).rotateX(-Math.PI / 2);
  const aftCentre = new THREE.CircleGeometry(2.25, 32).rotateX(Math.PI / 2).translate(0, -H, 0);
  const aftRing = new THREE.RingGeometry(4.35, R, 48).rotateX(Math.PI / 2).translate(0, -H, 0);
  const torus = new THREE.TorusGeometry(tank.R, tank.r, 14, 48).rotateX(Math.PI / 2).translate(0, tank.y, 0);
  const hw = [deck, aftCentre, aftRing];
  const bells = [];
  const inner = [];
  engines.azDeg.forEach((d) => {
    const a = d * DEG;
    const x = Math.cos(a) * engines.r;
    const z = Math.sin(a) * engines.r;
    // gimbal mount and struts from the tank's underside
    hw.push(new THREE.CylinderGeometry(0.16, 0.2, 0.22, 12).translate(x, engines.mountY + 0.11, z));
    [-1, 1].forEach((s) => {
      const t = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(0.55 * s);
      const p0 = new THREE.Vector3(x + t.x, tank.y - tank.r * 0.6, z + t.z);
      const p1 = new THREE.Vector3(x, engines.mountY + 0.2, z);
      const d3 = p1.clone().sub(p0);
      const g = new THREE.CylinderGeometry(0.035, 0.035, d3.length(), 6);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d3.clone().normalize()));
      hw.push(g.translate((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2));
    });
    // bell: throat at the mount, flaring to the exit
    const pts = [];
    const L = engines.mountY - engines.exitY;
    for (let i = 0; i <= 10; i++) {
      const u = i / 10;
      pts.push(new THREE.Vector2(engines.throatR + (engines.exitR - engines.throatR) * (1 - Math.pow(1 - u, 1.7)), -u * L));
    }
    bells.push(new THREE.LatheGeometry(pts, 20).translate(x, engines.mountY, z));
    inner.push(new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p.x * 0.96, p.y)), 20).translate(x, engines.mountY, z));
  });
  // RCS quads on the skin: a housing and four nozzles (fore, aft, both sides)
  const quads = [];
  rcs.azDeg.forEach((d) => {
    const a = d * DEG; // between the engines, under the adapter's hinges
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const c = out.clone().multiplyScalar(R + 0.16).setY(rcs.y);
    const box = new THREE.BoxGeometry(0.42, 0.5, 0.3);
    box.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), out));
    quads.push(box.translate(c.x, c.y, c.z));
    const side = new THREE.Vector3(-out.z, 0, out.x);
    [[new THREE.Vector3(0, 1, 0), 0.3], [new THREE.Vector3(0, -1, 0), 0.3], [side, 0.26], [side.clone().negate(), 0.26]].forEach(([dir, k]) => {
      const n = new THREE.CylinderGeometry(0.03, 0.07, 0.16, 8);
      n.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir));
      const p = c.clone().addScaledVector(dir, k);
      quads.push(n.translate(p.x, p.y, p.z));
    });
  });
  const flat = (a) => mergeGeometries(a.map((g) => (g.index ? g.toNonIndexed() : g)), false);
  // RCS exhaust, one cone per quad: aft-facing nozzles (forward push) and forward-facing ones (backing away)
  const puff = (sign) =>
    rcs.azDeg.map((d) => {
      const a = d * DEG;
      const c = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(R + 0.16).setY(rcs.y + sign * 0.38);
      const g = new THREE.CylinderGeometry(0.04, 0.32, 1.4, 10, 1, true);
      if (sign > 0) g.rotateX(Math.PI);
      return g.translate(c.x, c.y + sign * 0.7, c.z);
    });
  // Engine plumes: a faint vacuum plume and a core from each exit, down the axis
  const plume = (r0, r1, L) =>
    flat(engines.azDeg.map((d) => new THREE.CylinderGeometry(r0, r1, L, 20, 1, true).translate(Math.cos(d * DEG) * engines.r, engines.exitY - L / 2, Math.sin(d * DEG) * engines.r)));
  GEO = {
    skin,
    skinLow,
    hw: flat(hw),
    torus,
    bells: flat(bells),
    inner: flat(inner),
    quads: flat(quads),
    puffs: flat(puff(-1)),
    retroPuffs: flat(puff(1)),
    plumeOuter: plume(engines.exitR * 0.95, 1.9, 7.5),
    plumeCore: plume(engines.exitR * 0.7, 0.05, 2.4),
  };
  return GEO;
}

export default function CarrierModel({ ctrlRef = null, materials, shadows = false }) {
  const G = geometry();
  const insideRef = useRef();
  const puffRef = useRef();
  const retroRef = useRef();
  const outerRef = useRef();
  const coreRef = useRef();
  const puffMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "#dfe6ff", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    []
  );
  const outerMat = useMemo(() => plumeMaterial(0.6, "#ffe8d0", "#ff9a66", false), []);
  const coreMat = useMemo(() => plumeMaterial(1.2, "#ffffff", "#ffc48a", true), []);
  const tankMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#b8925a", roughness: 0.42, metalness: 0.6 }), []);

  useFrame((state) => {
    const c = ((ctrlRef && ctrlRef.current) || {}).carrier || {};
    const k = c.engines || 0;
    const t = state.clock.elapsedTime;
    if (insideRef.current) insideRef.current.visible = !!c.inside;
    const puff = Math.max(c.rcs || 0, c.retro || 0);
    if (puffRef.current) puffRef.current.visible = (c.rcs || 0) > 0.02;
    if (retroRef.current) retroRef.current.visible = (c.retro || 0) > 0.02;
    puffMat.opacity = 0.32 * puff;
    const on = k > 0.02;
    if (outerRef.current) {
      outerRef.current.visible = on;
      coreRef.current.visible = on;
      if (on) {
        outerRef.current.scale.set(1, (0.35 + 0.65 * k) * (1 + 0.04 * Math.sin(t * 47)), 1);
        coreRef.current.scale.set(1, 0.35 + 0.65 * k, 1);
        // scale about the exit plane
        outerRef.current.position.y = CARRIER.engines.exitY * (1 - outerRef.current.scale.y);
        coreRef.current.position.y = CARRIER.engines.exitY * (1 - coreRef.current.scale.y);
        outerMat.uniforms.uThrust.value = k;
        outerMat.uniforms.uTime.value = t;
        coreMat.uniforms.uThrust.value = k;
        coreMat.uniforms.uTime.value = t;
      }
    }
  });

  return (
    <group name="carrier">
      <mesh geometry={G.skin} material={materials.black} castShadow={shadows} receiveShadow={shadows} />
      <mesh geometry={G.skinLow} material={materials.white} castShadow={shadows} receiveShadow={shadows} />
      <mesh geometry={G.quads} material={materials.hardware} castShadow={shadows} />
      {/* Seen only once the upper stage has separated (or from inside the open adapter) */}
      <group ref={insideRef} visible={false}>
        <mesh geometry={G.hw} material={materials.hardware} />
        <mesh geometry={G.torus} material={tankMat} />
        <mesh geometry={G.bells} material={materials.bell} />
        <mesh geometry={G.inner} material={materials.bellInner} />
      </group>
      <mesh ref={puffRef} geometry={G.puffs} material={puffMat} visible={false} renderOrder={2} />
      <mesh ref={retroRef} geometry={G.retroPuffs} material={puffMat} visible={false} renderOrder={2} />
      <mesh ref={outerRef} geometry={G.plumeOuter} material={outerMat} visible={false} renderOrder={2} />
      <mesh ref={coreRef} geometry={G.plumeCore} material={coreMat} visible={false} renderOrder={3} />
    </group>
  );
}
