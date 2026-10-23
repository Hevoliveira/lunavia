import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { lunarEnv } from "@/components/LanderModel";
import { SEGMENTS } from "@/data/astronautRig";
import { astronautGeometry, astronautMaterials } from "./astronautModel";

/**
 * The astronaut, drawn on the rig (data/astronautRig solveRig) the EVA scene solves each frame.
 * stateRef.current = { pos [x, y, z] (m, the root between the boots), heading (rad), rig, hidden,
 * dust (0..1: the lower legs and boots greyed by the walk) }. Units are metres: the scene puts the
 * astronaut in a group scaled to its own 0.5 units per metre.
 */
const CLEAN = new THREE.Color("#e3ded4");
const DUSTY = new THREE.Color("#a99f90");
const BOOT_CLEAN = new THREE.Color("#c9c8c2");
const BOOT_DUSTY = new THREE.Color("#9f998f");
const _z = new THREE.Vector3(0, 0, 1);
const _d = new THREE.Vector3();

export default function Astronaut({ stateRef }) {
  const gl = useThree((s) => s.gl);
  const G = astronautGeometry();
  const M = useMemo(() => astronautMaterials(lunarEnv(gl)), [gl]);
  const root = useRef();
  const segs = useRef({});
  const fingerL = useRef();
  const fingerR = useRef();
  const scoop = useRef();

  useFrame(() => {
    const s = stateRef.current;
    const g = root.current;
    if (!g || !s || !s.rig) return;
    g.visible = !s.hidden;
    if (s.hidden) return;
    g.position.set(s.pos[0], s.pos[1], s.pos[2]);
    g.rotation.set(0, s.heading, 0);
    const rig = s.rig;
    for (const name of SEGMENTS) {
      const o = segs.current[name];
      if (!o) continue;
      o.position.copy(rig[name].p);
      o.quaternion.copy(rig[name].q);
    }
    const grip = rig.grip || [0.35, 0.35];
    if (fingerL.current) fingerL.current.rotation.z = -grip[0] * 1.35;
    if (fingerR.current) fingerR.current.rotation.z = grip[1] * 1.35;
    const sc = scoop.current;
    if (sc) {
      const on = !!rig.scoop && rig.tool > 0.02;
      sc.visible = on;
      if (on) {
        const [hx, hy, hz] = rig.scoop.hold;
        sc.position.set(hx, hy, hz);
        _d.set(rig.scoop.head[0] - hx, rig.scoop.head[1] - hy, rig.scoop.head[2] - hz).normalize();
        sc.quaternion.setFromUnitVectors(_z, _d);
      }
    }
    M.dusty.color.lerpColors(CLEAN, DUSTY, Math.min(1, s.dust || 0));
    M.boot.color.lerpColors(BOOT_CLEAN, BOOT_DUSTY, Math.min(1, (s.dust || 0) * 1.2));
  });

  const parts = (name) =>
    Object.entries(G[name]).map(([mat, geo]) => <mesh key={mat} geometry={geo} material={M[mat]} castShadow={mat !== "visor"} receiveShadow />);

  return (
    <group ref={root} name="astronaut">
      {SEGMENTS.map((name) => (
        <group key={name} ref={(el) => (segs.current[name] = el)} name={name}>
          {parts(name)}
          {name === "handL" && (
            <group ref={fingerL} position={[0, -0.158, 0]}>
              {parts("fingersL")}
            </group>
          )}
          {name === "handR" && (
            <group ref={fingerR} position={[0, -0.158, 0]}>
              {parts("fingersR")}
            </group>
          )}
        </group>
      ))}
      <group ref={scoop} visible={false} name="scoop">
        {parts("scoop")}
      </group>
    </group>
  );
}
