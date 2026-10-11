import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { LM, PROBE_LENGTH } from "@/data/touchdownFx";

/**
 * Apollo LM-inspired lunar lander.
 * Octagonal descent stage, ascent stage on top, and four landing legs at the
 * front, back and sides: each a primary strut (sleeve + piston that strokes on
 * touchdown), two secondary struts and a dished footpad. Three legs carry the
 * contact probes that light CONTACT LIGHT; the front leg carries the ladder.
 *
 * `fx` (optional, a ref's current object) drives it every frame without React
 * renders: { thrust 0..1, comp: [4] strut compression (scene units),
 * probe: [4] probe bend (radians) }. Without it the LM stands at rest.
 *
 * iPhone cost: every strut, probe and rung is one instance of a single
 * InstancedMesh, and the four footpads another, so the legs are two draw calls.
 */

// Model-space geometry (the group is scaled by LM.scale in the descent scene).
const S = LM.scale;
const PAD_R = LM.padRadius / S; // footpad centre radius
const PAD_TOP = -0.335; // footpad top (bottom at -0.377)
const UPPER = { r: 0.52, y: 0.36 }; // primary strut upper attachment
const SEC = { r: 0.5, y: 0.04, spread: 0.42 }; // secondary strut body attachments (rad either side)
const PROBE_L = PROBE_LENGTH / S;

const COLORS = {
  sleeve: new THREE.Color("#c9c9cc"),
  piston: new THREE.Color("#ececee"),
  secondary: new THREE.Color("#b9b9bd"),
  probe: new THREE.Color("#dcdce0"),
  rung: new THREE.Color("#c9c9cc"),
};
const RADIUS = { sleeve: 0.03, piston: 0.019, secondary: 0.011, probe: 0.011, rung: 0.006 };

const _d = new THREE.Vector3();
const _m = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _M = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();

/** Instance matrix of a unit cylinder (radius 1, height 1) laid between a and b with radius r. */
function rodMatrix(a, b, r) {
  _d.subVectors(b, a);
  const len = _d.length() || 1e-6;
  _m.addVectors(a, b).multiplyScalar(0.5);
  _q.setFromUnitVectors(_up, _d.multiplyScalar(1 / len));
  _s.set(r, len, r);
  return _M.compose(_m, _q, _s);
}

const goldFoil = { color: "#d1a04a", metalness: 0.45, roughness: 0.55 };

// Leg geometry at rest, per leg.
const LEGS = LM.legAngles.map((deg) => {
  const a = (deg * Math.PI) / 180;
  const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  const upper = new THREE.Vector3(UPPER.r * dir.x, UPPER.y, UPPER.r * dir.z);
  const padTop = new THREE.Vector3(PAD_R * dir.x, PAD_TOP, PAD_R * dir.z);
  return {
    dir,
    upper,
    padTop,
    axis: new THREE.Vector3().subVectors(upper, padTop).normalize(),
    secA: new THREE.Vector3(SEC.r * Math.cos(a + SEC.spread), SEC.y, SEC.r * Math.sin(a + SEC.spread)),
    secB: new THREE.Vector3(SEC.r * Math.cos(a - SEC.spread), SEC.y, SEC.r * Math.sin(a - SEC.spread)),
    sleeveLen: upper.distanceTo(padTop) * 0.58,
  };
});
// Ladder rungs on the front leg (+Z), along its primary strut.
const RUNGS = [0.18, 0.34, 0.5, 0.66].map((u) => {
  const L = LEGS[1];
  const c = new THREE.Vector3().lerpVectors(L.upper, L.padTop, u).add(new THREE.Vector3(0, 0, 0.035));
  return [c.clone().add(new THREE.Vector3(-0.06, 0, 0)), c.clone().add(new THREE.Vector3(0.06, 0, 0))];
});
const ROD_COUNT = 4 * 4 + LM.probes.filter(Boolean).length + RUNGS.length;

export default function LanderModel({ thrust = 0, scale = 1, fx = null }) {
  const flameRef = useRef();
  const lightRef = useRef();
  const rodsRef = useRef();
  const padsRef = useRef();
  const { rodGeo, padGeo } = useMemo(() => {
    // A dished footpad as one lathe profile (top disc, rim, dish underneath).
    const profile = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.115, 0),
      new THREE.Vector2(0.115, -0.024),
      new THREE.Vector2(0.07, -0.042),
      new THREE.Vector2(0, -0.042),
    ];
    return { rodGeo: new THREE.CylinderGeometry(1, 1, 1, 8), padGeo: new THREE.LatheGeometry(profile, 16) };
  }, []);
  useEffect(() => () => {
    rodGeo.dispose();
    padGeo.dispose();
  }, [rodGeo, padGeo]);
  const last = useRef(null);

  useFrame((state) => {
    const f = fx || {};
    const th = f.thrust != null ? f.thrust : thrust;
    if (flameRef.current) {
      const t = state.clock.elapsedTime;
      const k = Math.max(0, th);
      flameRef.current.visible = k > 0.03;
      flameRef.current.scale.set(0.55 + 0.45 * k + Math.sin(t * 45) * 0.04 * k, (0.35 + 0.75 * k) * (1 + Math.sin(t * 50) * 0.12 * k), 0.55 + 0.45 * k);
    }
    if (lightRef.current) lightRef.current.intensity = 2.6 * Math.max(0, th);
    // Legs: rebuilt only when a strut or probe moved.
    const comp = f.comp || [0, 0, 0, 0];
    const probe = f.probe || [0, 0, 0, 0];
    const key = comp.map((v) => v.toFixed(4)).join() + probe.map((v) => v.toFixed(3)).join();
    const rods = rodsRef.current;
    const pads = padsRef.current;
    if (!rods || !pads || last.current === key) return;
    last.current = key;
    let n = 0;
    const put = (a, b, r, color) => {
      rods.setMatrixAt(n, rodMatrix(a, b, r));
      rods.setColorAt(n, color);
      n++;
    };
    LEGS.forEach((L, i) => {
      // The pad strokes up along the strut axis so that it rises comp/scale vertically.
      _p1.copy(L.padTop).addScaledVector(L.axis, comp[i] / S / L.axis.y);
      pads.setMatrixAt(i, _M.makeTranslation(_p1.x, _p1.y, _p1.z));
      _p2.copy(L.upper).addScaledVector(L.axis, -L.sleeveLen);
      put(L.upper, _p2, RADIUS.sleeve, COLORS.sleeve);
      put(_p2.addScaledVector(L.axis, 0.06), _p1, RADIUS.piston, COLORS.piston);
      _p2.copy(_p1).y += 0.02;
      put(L.secA, _p2, RADIUS.secondary, COLORS.secondary);
      put(L.secB, _p2, RADIUS.secondary, COLORS.secondary);
      if (LM.probes[i]) {
        // The probe hangs from the pad and folds outward as it meets the ground.
        _p2.copy(_p1).y -= 0.042;
        const b = probe[i];
        _d.set(L.dir.x * Math.sin(b), -Math.cos(b), L.dir.z * Math.sin(b)).multiplyScalar(PROBE_L).add(_p2);
        put(_p2.clone(), _d.clone(), RADIUS.probe, COLORS.probe);
      }
    });
    RUNGS.forEach(([a, b]) => put(a, b, RADIUS.rung, COLORS.rung));
    rods.instanceMatrix.needsUpdate = true;
    if (rods.instanceColor) rods.instanceColor.needsUpdate = true;
    pads.instanceMatrix.needsUpdate = true;
  });

  return (
    <group scale={scale}>
      {/* Descent stage (octagonal) */}
      <mesh position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.5, 0.5, 0.4, 8]} />
        <meshStandardMaterial {...goldFoil} />
      </mesh>
      {/* Foil wrap band */}
      <mesh position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.5, 0.5, 0.1, 8]} />
        <meshStandardMaterial color="#8a6a24" metalness={0.35} roughness={0.7} />
      </mesh>
      {/* Descent engine nozzle */}
      <mesh position={[0, -0.05, 0]}>
        <coneGeometry args={[0.15, 0.28, 20, 1, true]} />
        <meshStandardMaterial color="#4a4a4a" metalness={0.85} roughness={0.3} side={THREE.DoubleSide} />
      </mesh>

      {/* Landing gear: struts, probes and ladder rungs (one draw call), footpads (one) */}
      <instancedMesh ref={rodsRef} args={[rodGeo, undefined, ROD_COUNT]} frustumCulled={false}>
        <meshStandardMaterial color="#ffffff" metalness={0.75} roughness={0.32} />
      </instancedMesh>
      <instancedMesh ref={padsRef} args={[padGeo, undefined, 4]} frustumCulled={false}>
        <meshStandardMaterial color="#9a9aa0" metalness={0.6} roughness={0.45} side={THREE.DoubleSide} />
      </instancedMesh>

      {/* Ascent stage — cabin */}
      <mesh position={[0, 0.65, 0]}>
        <boxGeometry args={[0.55, 0.35, 0.55]} />
        <meshStandardMaterial color="#e0e0e0" metalness={0.5} roughness={0.4} />
      </mesh>
      {/* Forward windows */}
      <mesh position={[0, 0.72, 0.28]}>
        <boxGeometry args={[0.22, 0.12, 0.005]} />
        <meshStandardMaterial color="#111" metalness={0.9} roughness={0.1} />
      </mesh>
      {/* Antenna */}
      <mesh position={[0.2, 0.95, 0]}>
        <cylinderGeometry args={[0.004, 0.004, 0.25, 6]} />
        <meshStandardMaterial color="#888" />
      </mesh>
      {/* Ascent stage engine (small) */}
      <mesh position={[0, 0.48, 0]}>
        <coneGeometry args={[0.06, 0.1, 12, 1, true]} />
        <meshStandardMaterial color="#3a3a3a" metalness={0.85} roughness={0.3} side={THREE.DoubleSide} />
      </mesh>

      {/* Descent flame: in vacuum the plume is short and faint, sized by the real throttle */}
      <group ref={flameRef} position={[0, -0.19, 0]}>
        <mesh position={[0, -0.3, 0]}>
          <coneGeometry args={[0.13, 0.6, 18, 1, true]} />
          <meshBasicMaterial color="#FFC68A" transparent opacity={0.55} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, -0.42, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.07, 0.5, 14, 1, true]} />
          <meshBasicMaterial color="#FF6A2A" transparent opacity={0.45} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
      <pointLight ref={lightRef} position={[0, -0.45, 0]} color="#FF8A4B" intensity={fx ? 0 : 2.5 * thrust} distance={3} />
    </group>
  );
}
