import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Stars, useTexture } from "@react-three/drei";
import { useRef, Suspense, useMemo } from "react";
import * as THREE from "three";
import LanderModel from "@/components/LanderModel";

const MOON_MAP = "https://threejs.org/examples/textures/planets/moon_1024.jpg";
const EARTH_MAP = "https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg";

function MoonSurface() {
  const [tex] = useTexture([MOON_MAP]);
  const meshRef = useRef();
  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.4, 0]}>
      <planeGeometry args={[80, 80, 32, 32]} />
      <meshStandardMaterial
        map={tex}
        bumpMap={tex}
        bumpScale={0.15}
        color="#c8c2b3"
        roughness={1}
      />
    </mesh>
  );
}

function Boulders() {
  const rocks = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 30; i++) {
      arr.push({
        x: (Math.random() - 0.5) * 25,
        z: (Math.random() - 0.5) * 25 - 3,
        s: 0.05 + Math.random() * 0.2,
      });
    }
    return arr;
  }, []);
  return (
    <group>
      {rocks.map((r, i) => (
        <mesh key={i} position={[r.x, -0.4 + r.s * 0.5, r.z]}>
          <dodecahedronGeometry args={[r.s, 0]} />
          <meshStandardMaterial color="#b0aa9c" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function DistantEarth() {
  const [tex] = useTexture([EARTH_MAP]);
  const ref = useRef();
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.02;
  });
  return (
    <mesh ref={ref} position={[-8, 6, -15]}>
      <sphereGeometry args={[1.6, 64, 64]} />
      <meshStandardMaterial map={tex} emissive="#0a1830" emissiveIntensity={0.15} />
    </mesh>
  );
}

function Lander({ altitude, thrust }) {
  const ref = useRef();
  useFrame(() => {
    if (ref.current) {
      ref.current.position.y = altitude;
      // very slow rotation
      ref.current.rotation.y += 0.001;
    }
  });
  return (
    <group ref={ref}>
      <LanderModel thrust={thrust} scale={0.7} />
    </group>
  );
}

function Dust({ visible, altitude }) {
  const ref = useRef();
  const particles = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.3 + Math.random() * 1.2;
      arr.push({
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        vx: Math.cos(a) * (0.3 + Math.random() * 0.5),
        vz: Math.sin(a) * (0.3 + Math.random() * 0.5),
        life: Math.random(),
      });
    }
    return arr;
  }, []);
  useFrame((state, delta) => {
    if (!ref.current || !visible) return;
    ref.current.children.forEach((child, i) => {
      const p = particles[i];
      p.life += delta * 0.6;
      if (p.life > 1) {
        p.life = 0;
        p.x = 0;
        p.z = 0;
      }
      child.position.x = p.x + p.vx * p.life;
      child.position.z = p.z + p.vz * p.life;
      child.position.y = -0.35 + p.life * 0.1;
      child.material.opacity = (1 - p.life) * 0.7;
    });
  });
  if (!visible || altitude > 0.4) return null;
  return (
    <group ref={ref}>
      {particles.map((_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[0.05, 8, 8]} />
          <meshBasicMaterial color="#c8c2b3" transparent opacity={0.6} />
        </mesh>
      ))}
    </group>
  );
}

function DescentCamera({ altitude }) {
  const { camera } = useThree();
  useFrame((_, delta) => {
    // Camera tracks lander from side, gradually lowering
    const desired = new THREE.Vector3(2.2, Math.max(0.7, altitude + 0.4), 2.4);
    const lookAt = new THREE.Vector3(0, Math.max(0, altitude), 0);
    camera.position.lerp(desired, Math.min(1, delta * 2));
    camera.lookAt(lookAt);
  });
  return null;
}

function Scene({ altitude, thrust, dust }) {
  return (
    <>
      <color attach="background" args={["#050505"]} />
      <Stars radius={100} depth={50} count={4000} factor={2.5} saturation={0} fade speed={0.1} />
      <ambientLight intensity={0.15} />
      <directionalLight position={[10, 12, 6]} intensity={2.5} color="#ffffff" />
      <directionalLight position={[-6, 2, -8]} intensity={0.15} color="#3a5a8a" />
      <MoonSurface />
      <Boulders />
      <DistantEarth />
      <Lander altitude={altitude} thrust={thrust} />
      <Dust visible={dust} altitude={altitude} />
      <DescentCamera altitude={altitude} />
    </>
  );
}

/**
 * DescentScene:
 * `altitude` in scene units (10 = high, 0 = touched down).
 * `thrust` in [0..1].
 * `dust` boolean — kick up dust particles when close.
 */
export default function DescentScene({ altitude = 8, thrust = 1, dust = false }) {
  return (
    <div className="absolute inset-0 canvas-host" data-testid="descent-canvas">
      <Canvas
        camera={{ position: [2.2, 5, 2.4], fov: 45 }}
        dpr={[1, 2]}
        gl={{
          antialias: true,
          alpha: false,
          toneMapping: THREE.ACESFilmicToneMapping,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
      >
        <Suspense fallback={null}>
          <Scene altitude={altitude} thrust={thrust} dust={dust} />
        </Suspense>
      </Canvas>
    </div>
  );
}
