import { Canvas, useFrame } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import { useRef, Suspense } from "react";
import * as THREE from "three";

function Earth() {
  const ref = useRef();
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.05;
  });
  return (
    <mesh ref={ref} position={[-2.4, -0.3, 0]}>
      <sphereGeometry args={[2, 96, 96]} />
      <meshStandardMaterial
        color="#1a3a6b"
        roughness={0.85}
        metalness={0.0}
        emissive="#0a1830"
        emissiveIntensity={0.15}
      />
    </mesh>
  );
}

function EarthAtmosphere() {
  return (
    <mesh position={[-2.4, -0.3, 0]}>
      <sphereGeometry args={[2.08, 64, 64]} />
      <meshBasicMaterial
        color="#4a90e2"
        transparent
        opacity={0.08}
        side={THREE.BackSide}
      />
    </mesh>
  );
}

function Moon() {
  const ref = useRef();
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.02;
  });
  return (
    <mesh ref={ref} position={[3.2, 0.6, -1]}>
      <sphereGeometry args={[0.55, 64, 64]} />
      <meshStandardMaterial color="#b8b3a8" roughness={1} metalness={0} />
    </mesh>
  );
}

function TrajectoryArc() {
  const points = [];
  const start = new THREE.Vector3(-2.4, -0.3, 0);
  const end = new THREE.Vector3(3.2, 0.6, -1);
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const p = new THREE.Vector3().lerpVectors(start, end, t);
    // add elliptical bulge
    p.y += Math.sin(Math.PI * t) * 1.1;
    p.z += Math.sin(Math.PI * t) * 0.4;
    points.push(p);
  }
  const geom = new THREE.BufferGeometry().setFromPoints(points);
  return (
    <line geometry={geom}>
      <lineBasicMaterial color="#FF3B00" transparent opacity={0.55} />
    </line>
  );
}

export default function EarthMoonHero() {
  return (
    <div className="absolute inset-0 canvas-host" data-testid="hero-canvas">
      <Canvas
        camera={{ position: [0, 0.4, 6.2], fov: 45 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl }) => gl.setClearColor("#050505")}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.06} />
          <directionalLight
            position={[8, 3, 5]}
            intensity={2.5}
            color="#ffffff"
          />
          <Stars
            radius={80}
            depth={40}
            count={4000}
            factor={2.5}
            saturation={0}
            fade
            speed={0.4}
          />
          <Earth />
          <EarthAtmosphere />
          <Moon />
          <TrajectoryArc />
        </Suspense>
      </Canvas>
    </div>
  );
}
