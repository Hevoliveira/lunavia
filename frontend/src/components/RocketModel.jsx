import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/**
 * LV-001 — two-stage lunar vehicle (engineering pass).
 * Clustered first-stage engines, lattice interstage, single vacuum engine on
 * stage 2, CSM with boost protective cover and escape tower.
 * Apollo/Saturn is engineering inspiration only — proportions and markings
 * (white insulation + LUNAVIA orange bands) remain LUNAVIA's own.
 */
export default function RocketModel({ separated = false, thrust = 1, sepRef = null, scale = 1 }) {
  const stage1Ref = useRef();
  const plume1Ref = useRef();
  const plume2Ref = useRef();
  const localSep = useRef(0);

  const bellMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#3a3b3e",
        metalness: 0.9,
        roughness: 0.35,
        emissive: new THREE.Color("#ff7a1e"),
        emissiveIntensity: 0,
        side: THREE.DoubleSide,
      }),
    []
  );
  const bell2Mat = useMemo(() => bellMat.clone(), [bellMat]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    if (separated) {
      if (sepRef) sepRef.current = Math.min(1, sepRef.current + delta / 3.2);
      else localSep.current = Math.min(1, localSep.current + delta / 3.2);
    }
    const s = sepRef ? sepRef.current : localSep.current;
    const e = easeOut(s);

    // Stage 1 keeps the shared trajectory, drifts back relative to stage 2,
    // then picks up a slow tumble. It never just drops vertically.
    if (stage1Ref.current) {
      stage1Ref.current.position.set(e * 0.85, -e * 3.1, 0);
      stage1Ref.current.rotation.z = s * 0.55;
      stage1Ref.current.rotation.x = s * 0.22;
    }

    const flick = 1 + Math.sin(t * 47) * 0.06 + Math.sin(t * 29) * 0.05;

    const s1On = thrust > 0.25 && !separated;
    if (plume1Ref.current) {
      plume1Ref.current.visible = s1On;
      if (s1On) {
        plume1Ref.current.scale.set(flick, (0.55 + 0.45 * thrust) * flick, flick);
      }
    }
    bellMat.emissiveIntensity = s1On ? 0.9 : 0;

    // Delayed upper-stage ignition after separation
    const ig = separated ? clamp01((s - 0.28) / 0.3) : 0;
    if (plume2Ref.current) {
      plume2Ref.current.visible = ig > 0.02;
      if (ig > 0.02) {
        plume2Ref.current.scale.set(flick, Math.max(0.05, ig) * flick, flick);
      }
    }
    bell2Mat.emissiveIntensity = ig * 0.9;
  });

  return (
    <group scale={scale}>
      {/* ============ STAGE 1 (booster + interstage, jettisoned together) ============ */}
      <group ref={stage1Ref}>
        {/* Engine bells: 1 center + 4 outboard */}
        {[
          [0, -0.02, 0, 1],
          [0.16, -0.02, 0, 0.9],
          [-0.16, -0.02, 0, 0.9],
          [0, -0.02, 0.16, 0.9],
          [0, -0.02, -0.16, 0.9],
        ].map(([x, y, z, sc], i) => (
          <mesh key={i} position={[x, y, z]} scale={sc} material={bellMat}>
            <coneGeometry args={[0.11, 0.24, 20, 1, true]} />
          </mesh>
        ))}

        {/* Engine skirt */}
        <mesh position={[0, 0.26, 0]}>
          <cylinderGeometry args={[0.3, 0.44, 0.44, 24, 1, true]} />
          <meshStandardMaterial
            color="#2b2b2d"
            metalness={0.8}
            roughness={0.45}
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* Booster body — white insulation */}
        <mesh position={[0, 1.48, 0]}>
          <cylinderGeometry args={[0.38, 0.38, 2.0, 28]} />
          <meshStandardMaterial color="#f1f0ec" metalness={0.3} roughness={0.52} />
        </mesh>

        {/* Tank stringer rings */}
        {[0.9, 1.5, 2.1].map((y) => (
          <mesh key={y} position={[0, y, 0]}>
            <cylinderGeometry args={[0.383, 0.383, 0.035, 28]} />
            <meshStandardMaterial color="#d9d9d6" metalness={0.4} roughness={0.5} />
          </mesh>
        ))}

        {/* Black intertank band */}
        <mesh position={[0, 1.16, 0]}>
          <cylinderGeometry args={[0.384, 0.384, 0.12, 28]} />
          <meshStandardMaterial color="#17181a" metalness={0.5} roughness={0.45} />
        </mesh>

        {/* LUNAVIA orange bands */}
        <mesh position={[0, 2.3, 0]}>
          <cylinderGeometry args={[0.385, 0.385, 0.1, 28]} />
          <meshStandardMaterial color="#FF3B00" metalness={0.3} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.62, 0]}>
          <cylinderGeometry args={[0.385, 0.385, 0.06, 28]} />
          <meshStandardMaterial color="#FF3B00" metalness={0.3} roughness={0.5} />
        </mesh>

        {/* Fins */}
        {[0, 1, 2, 3].map((i) => {
          const a = (i / 4) * Math.PI * 2;
          return (
            <mesh
              key={i}
              position={[Math.cos(a) * 0.44, 0.35, Math.sin(a) * 0.44]}
              rotation={[0, -a, 0]}
            >
              <boxGeometry args={[0.03, 0.55, 0.42]} />
              <meshStandardMaterial color="#c8c8c8" metalness={0.5} roughness={0.4} />
            </mesh>
          );
        })}

        {/* Lattice interstage (stays with stage 1) */}
        <mesh position={[0, 2.67, 0]}>
          <cylinderGeometry args={[0.36, 0.38, 0.38, 28, 1, true]} />
          <meshStandardMaterial
            color="#242628"
            metalness={0.7}
            roughness={0.4}
            side={THREE.DoubleSide}
            transparent
            opacity={0.35}
          />
        </mesh>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
          const a = (i / 8) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * 0.36, 2.67, Math.sin(a) * 0.36]}>
              <boxGeometry args={[0.04, 0.36, 0.04]} />
              <meshStandardMaterial color="#45484c" metalness={0.8} roughness={0.35} />
            </mesh>
          );
        })}

        {/* Sea-level plume — layered core / mid / outer + shock diamonds */}
        <group ref={plume1Ref} position={[0, -0.14, 0]}>
          <mesh position={[0, -0.45, 0]}>
            <coneGeometry args={[0.15, 1.0, 18]} />
            <meshBasicMaterial
              color="#fff3d6"
              transparent
              opacity={0.95}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <mesh position={[0, -0.75, 0]}>
            <coneGeometry args={[0.25, 1.6, 18]} />
            <meshBasicMaterial
              color="#FFB37A"
              transparent
              opacity={0.7}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <mesh position={[0, -1.1, 0]}>
            <coneGeometry args={[0.36, 2.3, 18]} />
            <meshBasicMaterial
              color="#FF5A1A"
              transparent
              opacity={0.28}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          {[-0.35, -0.65, -0.95, -1.25].map((y) => (
            <mesh key={y} position={[0, y, 0]}>
              <sphereGeometry args={[0.05, 10, 10]} />
              <meshBasicMaterial
                color="#ffe9c0"
                transparent
                opacity={0.8}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
              />
            </mesh>
          ))}
          <pointLight color="#FF7A3B" intensity={4.5} distance={9} position={[0, -0.8, 0]} />
        </group>
      </group>

      {/* ============ STAGE 2 + SPACECRAFT (continues the mission) ============ */}
      {/* Vacuum engine bell (hidden inside interstage until separation) */}
      <mesh position={[0, 2.82, 0]} material={bell2Mat}>
        <coneGeometry args={[0.17, 0.34, 22, 1, true]} />
      </mesh>

      {/* Vacuum plume — wide, translucent, blue-shifted */}
      <group ref={plume2Ref} position={[0, 2.6, 0]}>
        <mesh position={[0, -0.35, 0]}>
          <coneGeometry args={[0.12, 0.8, 16]} />
          <meshBasicMaterial
            color="#eaf4ff"
            transparent
            opacity={0.85}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[0, -0.95, 0]}>
          <coneGeometry args={[0.5, 2.0, 18]} />
          <meshBasicMaterial
            color="#7fb8ff"
            transparent
            opacity={0.1}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[0, -1.45, 0]}>
          <coneGeometry args={[0.8, 3.0, 18]} />
          <meshBasicMaterial
            color="#4a86ff"
            transparent
            opacity={0.05}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        <pointLight color="#6aa8ff" intensity={2.5} distance={5} position={[0, -0.7, 0]} />
      </group>

      {/* Stage 2 body */}
      <mesh position={[0, 3.54, 0]}>
        <cylinderGeometry args={[0.3, 0.34, 1.36, 28]} />
        <meshStandardMaterial color="#efefec" metalness={0.35} roughness={0.5} />
      </mesh>
      <mesh position={[0, 3.2, 0]}>
        <cylinderGeometry args={[0.325, 0.325, 0.03, 28]} />
        <meshStandardMaterial color="#d9d9d6" metalness={0.4} roughness={0.5} />
      </mesh>
      <mesh position={[0, 4.1, 0]}>
        <cylinderGeometry args={[0.305, 0.305, 0.07, 28]} />
        <meshStandardMaterial color="#FF3B00" metalness={0.3} roughness={0.5} />
      </mesh>

      {/* RCS quad blocks */}
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.32, 3.95, Math.sin(a) * 0.32]}>
            <boxGeometry args={[0.06, 0.08, 0.06]} />
            <meshStandardMaterial color="#55575c" metalness={0.8} roughness={0.35} />
          </mesh>
        );
      })}

      {/* Service module — brushed metal + dark radiator band */}
      <mesh position={[0, 4.47, 0]}>
        <cylinderGeometry args={[0.22, 0.26, 0.5, 28]} />
        <meshStandardMaterial color="#c9ccd2" metalness={0.85} roughness={0.3} />
      </mesh>
      <mesh position={[0, 4.47, 0]}>
        <cylinderGeometry args={[0.265, 0.265, 0.28, 28, 1, true]} />
        <meshStandardMaterial
          color="#10151c"
          metalness={0.5}
          roughness={0.55}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Boost protective cover over the command module */}
      <mesh position={[0, 4.92, 0]}>
        <coneGeometry args={[0.23, 0.4, 28]} />
        <meshStandardMaterial color="#f0f0ee" metalness={0.4} roughness={0.45} />
      </mesh>

      {/* Escape tower: lattice rails + mast + Q-ball tip */}
      {[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.05, 5.34, Math.sin(a) * 0.05]}>
            <cylinderGeometry args={[0.006, 0.006, 0.44, 6]} />
            <meshStandardMaterial color="#e6e6e6" metalness={0.6} roughness={0.4} />
          </mesh>
        );
      })}
      <mesh position={[0, 5.36, 0]}>
        <cylinderGeometry args={[0.014, 0.014, 0.5, 8]} />
        <meshStandardMaterial color="#e6e6e6" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0, 5.64, 0]}>
        <sphereGeometry args={[0.025, 10, 10]} />
        <meshStandardMaterial color="#e6e6e6" metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Beacon */}
      <mesh position={[0, 5.6, 0]}>
        <sphereGeometry args={[0.018, 8, 8]} />
        <meshBasicMaterial color="#FF3B00" />
      </mesh>
    </group>
  );
}
