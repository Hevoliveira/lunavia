import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * 2-stage rocket. Stage 1 is the fat lower booster with fins.
 * Stage 2 is the upper vehicle with the CSM at the tip.
 * If `separated`, stage 1 renders offset below to simulate discard.
 */
export default function RocketModel({ separated = false, thrust = 1, scale = 1 }) {
  const flameRef = useRef();
  const flame2Ref = useRef();

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (flameRef.current) {
      flameRef.current.scale.y = 1 + Math.sin(t * 40) * 0.15 * thrust;
      flameRef.current.scale.x = 1 + Math.sin(t * 35) * 0.08 * thrust;
      flameRef.current.scale.z = flameRef.current.scale.x;
      flameRef.current.visible = thrust > 0.05 && !separated;
    }
    if (flame2Ref.current) {
      flame2Ref.current.scale.y = 1 + Math.sin(t * 40) * 0.15 * thrust;
      flame2Ref.current.scale.x = 1 + Math.sin(t * 35) * 0.08 * thrust;
      flame2Ref.current.scale.z = flame2Ref.current.scale.x;
      flame2Ref.current.visible = thrust > 0.05 && separated;
    }
  });

  return (
    <group scale={scale}>
      {/* Stage 1: fat booster */}
      <group position={[0, separated ? -6 : 0, 0]}>
        {/* Booster body */}
        <mesh position={[0, 1.2, 0]}>
          <cylinderGeometry args={[0.35, 0.35, 2.4, 24]} />
          <meshStandardMaterial color="#f4f4f4" metalness={0.4} roughness={0.5} />
        </mesh>
        {/* Orange stripes */}
        <mesh position={[0, 2, 0]}>
          <cylinderGeometry args={[0.352, 0.352, 0.1, 24]} />
          <meshStandardMaterial color="#FF3B00" metalness={0.3} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.4, 0]}>
          <cylinderGeometry args={[0.352, 0.352, 0.08, 24]} />
          <meshStandardMaterial color="#FF3B00" metalness={0.3} roughness={0.5} />
        </mesh>
        {/* Fins */}
        {[0, 1, 2, 3].map((i) => {
          const a = (i / 4) * Math.PI * 2;
          return (
            <mesh
              key={i}
              position={[Math.cos(a) * 0.4, 0.25, Math.sin(a) * 0.4]}
              rotation={[0, -a, 0]}
            >
              <boxGeometry args={[0.02, 0.5, 0.4]} />
              <meshStandardMaterial color="#c8c8c8" metalness={0.5} roughness={0.4} />
            </mesh>
          );
        })}
        {/* Engine bell — flame origin */}
        <mesh position={[0, -0.05, 0]}>
          <coneGeometry args={[0.34, 0.3, 24, 1, true]} />
          <meshStandardMaterial color="#5a5a5a" metalness={0.8} roughness={0.3} side={THREE.DoubleSide} />
        </mesh>
        {/* Flame */}
        <group ref={flameRef} position={[0, -0.5, 0]}>
          <mesh>
            <coneGeometry args={[0.32, 1.4, 24]} />
            <meshBasicMaterial color="#FFB37A" transparent opacity={0.9} />
          </mesh>
          <mesh position={[0, -0.2, 0]}>
            <coneGeometry args={[0.22, 2, 24]} />
            <meshBasicMaterial color="#FF3B00" transparent opacity={0.75} />
          </mesh>
          <pointLight color="#FF7A3B" intensity={4} distance={6} position={[0, -0.4, 0]} />
        </group>
      </group>

      {/* Interstage */}
      <mesh position={[0, 2.5, 0]}>
        <cylinderGeometry args={[0.32, 0.32, 0.15, 24]} />
        <meshStandardMaterial color="#333" metalness={0.7} roughness={0.4} />
      </mesh>

      {/* Stage 2: upper */}
      <mesh position={[0, 3.35, 0]}>
        <cylinderGeometry args={[0.28, 0.32, 1.6, 24]} />
        <meshStandardMaterial color="#e6e6e6" metalness={0.5} roughness={0.4} />
      </mesh>

      {/* Stage 2 engine bell (visible only after separation) */}
      <mesh position={[0, 2.5, 0]}>
        <coneGeometry args={[0.16, 0.22, 20, 1, true]} />
        <meshStandardMaterial color="#5a5a5a" metalness={0.8} roughness={0.3} side={THREE.DoubleSide} />
      </mesh>
      <group ref={flame2Ref} position={[0, 2.15, 0]}>
        <mesh>
          <coneGeometry args={[0.14, 0.9, 20]} />
          <meshBasicMaterial color="#7EC8FF" transparent opacity={0.85} />
        </mesh>
        <mesh position={[0, -0.15, 0]}>
          <coneGeometry args={[0.08, 1.3, 20]} />
          <meshBasicMaterial color="#3B7AFF" transparent opacity={0.7} />
        </mesh>
        <pointLight color="#5aa6ff" intensity={3} distance={4} />
      </group>

      {/* CSM: cone + service module */}
      <mesh position={[0, 4.35, 0]}>
        <cylinderGeometry args={[0.22, 0.28, 0.4, 24]} />
        <meshStandardMaterial color="#c8c8cc" metalness={0.85} roughness={0.28} />
      </mesh>
      <mesh position={[0, 4.7, 0]}>
        <coneGeometry args={[0.22, 0.35, 24]} />
        <meshStandardMaterial color="#e6e6e6" metalness={0.7} roughness={0.35} />
      </mesh>

      {/* Blinking beacon on top */}
      <mesh position={[0, 4.9, 0]}>
        <sphereGeometry args={[0.03, 8, 8]} />
        <meshBasicMaterial color="#FF3B00" />
      </mesh>
    </group>
  );
}
