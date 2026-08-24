import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Apollo CSM-inspired procedural model.
 * Total length is normalized so the whole vehicle fits in ~0.4 scene units.
 * Uses only primitive geometries (cheap and always renders in headless too).
 */
export default function SpacecraftModel({ scale = 1, glow = true }) {
  const rootRef = useRef();
  const engineRef = useRef();

  useFrame((state, delta) => {
    if (rootRef.current) {
      // slow roll
      rootRef.current.rotation.z += delta * 0.4;
    }
    if (engineRef.current) {
      const s = 1 + Math.sin(state.clock.elapsedTime * 25) * 0.08;
      engineRef.current.scale.y = s;
    }
  });

  return (
    <group ref={rootRef} scale={scale}>
      {/* Command Module — cone (nose) */}
      <mesh position={[0.16, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.07, 0.12, 24]} />
        <meshStandardMaterial
          color="#e6e6e6"
          metalness={0.7}
          roughness={0.35}
        />
      </mesh>

      {/* CM/SM interface ring */}
      <mesh position={[0.098, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.075, 0.075, 0.015, 24]} />
        <meshStandardMaterial color="#2a2a2a" metalness={0.85} roughness={0.4} />
      </mesh>

      {/* Service Module — main cylinder */}
      <mesh position={[-0.02, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.075, 0.075, 0.22, 24]} />
        <meshStandardMaterial
          color="#c8c8cc"
          metalness={0.85}
          roughness={0.28}
        />
      </mesh>

      {/* Radiator panels (blue-black stripe) */}
      <mesh position={[-0.02, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.076, 0.076, 0.18, 24, 1, true]} />
        <meshStandardMaterial
          color="#0d1218"
          metalness={0.4}
          roughness={0.6}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Engine bell nozzle */}
      <mesh
        ref={engineRef}
        position={[-0.16, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
      >
        <coneGeometry args={[0.055, 0.11, 24, 1, true]} />
        <meshStandardMaterial
          color="#6b1a00"
          emissive="#FF3B00"
          emissiveIntensity={glow ? 1.4 : 0}
          roughness={0.4}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Engine plume glow */}
      {glow && (
        <>
          <mesh position={[-0.24, 0, 0]}>
            <sphereGeometry args={[0.05, 16, 16]} />
            <meshBasicMaterial color="#FFB37A" transparent opacity={0.55} />
          </mesh>
          <pointLight
            color="#FF3B00"
            intensity={1.4}
            distance={2}
            position={[-0.22, 0, 0]}
          />
        </>
      )}

      {/* High-gain antenna */}
      <group position={[0, 0.09, 0]}>
        <mesh>
          <cylinderGeometry args={[0.003, 0.003, 0.08, 8]} />
          <meshStandardMaterial color="#888" metalness={0.9} />
        </mesh>
        <mesh position={[0, 0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.028, 0.028, 0.006, 24]} />
          <meshStandardMaterial color="#d1d1d1" metalness={0.9} roughness={0.2} />
        </mesh>
      </group>

      {/* Solar panels (two sides) */}
      {[1, -1].map((side) => (
        <mesh
          key={side}
          position={[-0.02, 0, 0.13 * side]}
          rotation={[0, 0, 0]}
        >
          <boxGeometry args={[0.16, 0.005, 0.09]} />
          <meshStandardMaterial
            color="#12213d"
            metalness={0.6}
            roughness={0.35}
            emissive="#0a1830"
            emissiveIntensity={0.15}
          />
        </mesh>
      ))}
      {/* solar panel struts */}
      {[1, -1].map((side) => (
        <mesh key={"s" + side} position={[-0.02, 0, 0.08 * side]}>
          <boxGeometry args={[0.02, 0.006, 0.04]} />
          <meshStandardMaterial color="#333" metalness={0.9} />
        </mesh>
      ))}

      {/* Blinking beacon */}
      <mesh position={[0.16, 0, 0]}>
        <sphereGeometry args={[0.008, 8, 8]} />
        <meshBasicMaterial color="#FF3B00" />
      </mesh>
    </group>
  );
}
