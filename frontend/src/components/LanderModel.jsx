import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Apollo LM-inspired lunar lander.
 * Bug-shaped: octagonal descent stage, 4 legs, ascent stage on top.
 */
export default function LanderModel({ thrust = 0, scale = 1 }) {
  const flameRef = useRef();

  useFrame((state) => {
    if (flameRef.current) {
      const t = state.clock.elapsedTime;
      flameRef.current.scale.y = 1 + Math.sin(t * 50) * 0.2 * thrust;
      flameRef.current.scale.x = 1 + Math.sin(t * 45) * 0.1 * thrust;
      flameRef.current.scale.z = flameRef.current.scale.x;
      flameRef.current.visible = thrust > 0.05;
    }
  });

  const legPositions = [0, 1, 2, 3].map((i) => (i / 4) * Math.PI * 2 + Math.PI / 4);

  return (
    <group scale={scale}>
      {/* Descent stage (octagonal-ish body) */}
      <mesh position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.5, 0.5, 0.4, 8]} />
        <meshStandardMaterial color="#d1a04a" metalness={0.4} roughness={0.6} />
      </mesh>
      {/* Foil wrap detail */}
      <mesh position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.5, 0.5, 0.1, 8]} />
        <meshStandardMaterial color="#8a6a24" metalness={0.35} roughness={0.7} />
      </mesh>

      {/* Descent engine nozzle */}
      <mesh position={[0, -0.05, 0]}>
        <coneGeometry args={[0.15, 0.28, 20, 1, true]} />
        <meshStandardMaterial color="#4a4a4a" metalness={0.85} roughness={0.3} side={THREE.DoubleSide} />
      </mesh>

      {/* Landing legs */}
      {legPositions.map((a, i) => (
        <group key={i}>
          <mesh
            position={[Math.cos(a) * 0.55, 0.05, Math.sin(a) * 0.55]}
            rotation={[0, -a, Math.PI * 0.18]}
          >
            <cylinderGeometry args={[0.02, 0.02, 0.9, 8]} />
            <meshStandardMaterial color="#c4c4c4" metalness={0.7} roughness={0.4} />
          </mesh>
          {/* Foot pad */}
          <mesh position={[Math.cos(a) * 0.9, -0.35, Math.sin(a) * 0.9]}>
            <cylinderGeometry args={[0.1, 0.1, 0.04, 12]} />
            <meshStandardMaterial color="#888" metalness={0.6} roughness={0.4} />
          </mesh>
        </group>
      ))}

      {/* Ascent stage — cabin */}
      <mesh position={[0, 0.65, 0]}>
        <boxGeometry args={[0.55, 0.35, 0.55]} />
        <meshStandardMaterial color="#e0e0e0" metalness={0.5} roughness={0.4} />
      </mesh>
      {/* Cockpit window (triangle-ish, use small dark box) */}
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

      {/* Descent flame */}
      <group ref={flameRef} position={[0, -0.35, 0]}>
        <mesh>
          <coneGeometry args={[0.15, 0.7, 20]} />
          <meshBasicMaterial color="#FFB37A" transparent opacity={0.9} />
        </mesh>
        <mesh position={[0, -0.15, 0]}>
          <coneGeometry args={[0.09, 1.1, 20]} />
          <meshBasicMaterial color="#FF3B00" transparent opacity={0.7} />
        </mesh>
        <pointLight color="#FF7A3B" intensity={2.5} distance={3} />
      </group>
    </group>
  );
}
