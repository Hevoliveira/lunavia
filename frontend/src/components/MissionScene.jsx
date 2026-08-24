import { Canvas, useFrame } from "@react-three/fiber";
import { Stars, OrbitControls } from "@react-three/drei";
import { useRef, useMemo, Suspense } from "react";
import * as THREE from "three";
import {
  EARTH_RADIUS_KM,
  MOON_RADIUS_KM,
  EARTH_MOON_DIST_KM,
  trajectoryPosition,
} from "@/data/missionPhases";

// Visual scale: convert km → scene units.
// Distance Earth-Moon ~ 384400 km rendered as ~20 units.
const SCENE_SCALE = 20 / EARTH_MOON_DIST_KM;
const EARTH_UNITS = EARTH_RADIUS_KM * SCENE_SCALE * 30; // amplify body size
const MOON_UNITS = MOON_RADIUS_KM * SCENE_SCALE * 30;

function Earth() {
  const ref = useRef();
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.02;
  });
  return (
    <group position={[0, 0, 0]}>
      <mesh ref={ref}>
        <sphereGeometry args={[EARTH_UNITS, 96, 96]} />
        <meshStandardMaterial
          color="#1a3a6b"
          emissive="#0a1830"
          emissiveIntensity={0.12}
          roughness={0.85}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[EARTH_UNITS * 1.05, 48, 48]} />
        <meshBasicMaterial
          color="#4a90e2"
          transparent
          opacity={0.07}
          side={THREE.BackSide}
        />
      </mesh>
    </group>
  );
}

function Moon({ position }) {
  return (
    <mesh position={position}>
      <sphereGeometry args={[MOON_UNITS, 64, 64]} />
      <meshStandardMaterial color="#b8b3a8" roughness={1} />
    </mesh>
  );
}

function Spacecraft({ position }) {
  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[0.12, 0.06, 0.06]} />
        <meshStandardMaterial color="#FAFAFA" emissive="#FF3B00" emissiveIntensity={0.6} />
      </mesh>
      <pointLight color="#FF3B00" intensity={0.6} distance={1} />
    </group>
  );
}

function TrajectoryPath({ missionTime, duration = 702000 }) {
  const points = useMemo(() => {
    const pts = [];
    const steps = 240;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * duration;
      const p = trajectoryPosition(t);
      pts.push(new THREE.Vector3(p.x * SCENE_SCALE, 0, p.z * SCENE_SCALE));
    }
    return pts;
  }, [duration]);

  const geom = useMemo(
    () => new THREE.BufferGeometry().setFromPoints(points),
    [points]
  );
  return (
    <line geometry={geom}>
      <lineBasicMaterial color="#FF3B00" transparent opacity={0.35} />
    </line>
  );
}

function Scene({ missionTime }) {
  const pos = trajectoryPosition(missionTime);
  const spacecraftPos = [
    pos.x * SCENE_SCALE,
    0,
    pos.z * SCENE_SCALE,
  ];
  const moonPos = [pos.moonX * SCENE_SCALE, 0, pos.moonZ * SCENE_SCALE];

  return (
    <>
      <ambientLight intensity={0.05} />
      <directionalLight
        position={[30, 10, 20]}
        intensity={2.5}
        color="#ffffff"
      />
      <Stars radius={100} depth={50} count={6000} factor={3} saturation={0} fade speed={0.2} />
      <Earth />
      <Moon position={moonPos} />
      <Spacecraft position={spacecraftPos} />
      <TrajectoryPath missionTime={missionTime} />
      <OrbitControls
        enablePan={false}
        enableZoom={true}
        minDistance={3}
        maxDistance={60}
        dampingFactor={0.06}
      />
    </>
  );
}

export default function MissionScene({ missionTime }) {
  return (
    <div className="absolute inset-0 canvas-host" data-testid="mission-canvas">
      <Canvas
        camera={{ position: [0, 15, 18], fov: 40 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl }) => gl.setClearColor("#050505")}
      >
        <Suspense fallback={null}>
          <Scene missionTime={missionTime} />
        </Suspense>
      </Canvas>
    </div>
  );
}
