import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Stars, useTexture } from "@react-three/drei";
import { useRef, Suspense, useMemo } from "react";
import * as THREE from "three";

const EARTH_MAP = "https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg";
const CLOUDS_MAP = "https://threejs.org/examples/textures/planets/earth_clouds_1024.png";

/**
 * ReentryScene — the capsule dives through the atmosphere with a
 * glowing plasma trail. Progress [0..1] drives altitude, plasma
 * intensity, atmosphere haze and finally parachute + splashdown.
 */

function Capsule({ shake }) {
  const ref = useRef();
  useFrame((state) => {
    if (ref.current) {
      // slight tumble
      const t = state.clock.elapsedTime;
      ref.current.rotation.x = Math.sin(t * 4) * 0.03 * shake;
      ref.current.rotation.z = Math.cos(t * 3) * 0.03 * shake;
    }
  });
  return (
    <group ref={ref}>
      {/* Heat shield (fat cone base) */}
      <mesh position={[0, -0.15, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.45, 0.25, 24]} />
        <meshStandardMaterial
          color="#3a2a1a"
          metalness={0.2}
          roughness={0.9}
          emissive="#FF3B00"
          emissiveIntensity={shake * 0.6}
        />
      </mesh>
      {/* Cabin */}
      <mesh position={[0, 0.15, 0]}>
        <coneGeometry args={[0.45, 0.6, 24]} />
        <meshStandardMaterial color="#e6e6e6" metalness={0.6} roughness={0.35} />
      </mesh>
      {/* Docking probe */}
      <mesh position={[0, 0.48, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.1, 12]} />
        <meshStandardMaterial color="#888" metalness={0.9} />
      </mesh>
    </group>
  );
}

function PlasmaTrail({ intensity }) {
  const groupRef = useRef();
  const trails = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 30; i++) {
      arr.push({
        offset: i * 0.15,
        w: 0.35 - i * 0.008,
      });
    }
    return arr;
  }, []);
  return (
    <group ref={groupRef} visible={intensity > 0.05}>
      {trails.map((t, i) => (
        <mesh key={i} position={[0, -0.2 - t.offset, 0]}>
          <sphereGeometry args={[t.w, 12, 12]} />
          <meshBasicMaterial
            color={i < 10 ? "#FFDCB4" : "#FF3B00"}
            transparent
            opacity={intensity * (1 - i / 30) * 0.55}
          />
        </mesh>
      ))}
      <pointLight color="#FF7A3B" intensity={intensity * 8} distance={4} position={[0, -0.5, 0]} />
    </group>
  );
}

function Parachute({ visible }) {
  if (!visible) return null;
  return (
    <group position={[0, 1.4, 0]}>
      {/* Canopy */}
      <mesh>
        <sphereGeometry args={[0.9, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#FF3B00" side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0, 0]} rotation={[0, Math.PI / 3, 0]}>
        <sphereGeometry args={[0.9, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#FAFAFA" side={THREE.DoubleSide} />
      </mesh>
      {/* Lines */}
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * Math.PI * 2;
        return (
          <mesh
            key={i}
            position={[Math.cos(a) * 0.4, -0.7, Math.sin(a) * 0.4]}
            rotation={[0, -a, Math.PI * 0.08]}
          >
            <cylinderGeometry args={[0.005, 0.005, 1.4, 4]} />
            <meshStandardMaterial color="#eee" />
          </mesh>
        );
      })}
    </group>
  );
}

function Ocean({ visible }) {
  const [earthTex] = useTexture([EARTH_MAP]);
  if (!visible) return null;
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.6, 0]}>
        <planeGeometry args={[100, 100, 1, 1]} />
        <meshStandardMaterial color="#0d3a5f" roughness={0.4} metalness={0.2} />
      </mesh>
      {/* far horizon */}
      <mesh position={[0, -0.2, -30]}>
        <planeGeometry args={[100, 8]} />
        <meshBasicMaterial color="#1a2d4a" />
      </mesh>
    </>
  );
}

function SkyDome({ progress }) {
  // Sky color transitions from black (space) -> plasma orange (peak reentry)
  // -> blue (atmosphere) -> ocean blue
  const meshRef = useRef();
  useFrame(() => {
    if (!meshRef.current) return;
    const c = new THREE.Color();
    if (progress < 0.15) {
      c.set("#050505");
    } else if (progress < 0.5) {
      const p = (progress - 0.15) / 0.35;
      // deepen to orange
      c.setHSL(0.05, 0.9, 0.05 + p * 0.15);
    } else if (progress < 0.8) {
      const p = (progress - 0.5) / 0.3;
      // orange -> blue
      c.setHSL(0.05 + p * 0.55, 0.7 - p * 0.3, 0.2 + p * 0.15);
    } else {
      c.set("#4a80b8");
    }
    meshRef.current.material.color.copy(c);
  });
  return (
    <mesh ref={meshRef} scale={[80, 80, 80]}>
      <sphereGeometry args={[1, 24, 24]} />
      <meshBasicMaterial side={THREE.BackSide} color="#050505" />
    </mesh>
  );
}

function ReentryCamera({ progress }) {
  const { camera } = useThree();
  useFrame((_, delta) => {
    // Close side shot of the capsule during reentry, pulls up for splashdown
    let desired;
    let lookAt = new THREE.Vector3(0, 0, 0);
    if (progress < 0.85) {
      desired = new THREE.Vector3(1.6, 0.4, 1.6);
    } else {
      // Splashdown wide
      desired = new THREE.Vector3(3, 1.6, 4);
      lookAt.set(0, -0.5, 0);
    }
    camera.position.lerp(desired, Math.min(1, delta * 2));
    camera.lookAt(lookAt);
  });
  return null;
}

function Scene({ progress }) {
  // Plasma intensity peaks around progress 0.3-0.6
  const plasma =
    progress < 0.15 ? 0 :
    progress < 0.6 ? Math.min(1, (progress - 0.15) / 0.15) :
    Math.max(0, 1 - (progress - 0.6) / 0.25);
  const shake = plasma;
  const parachute = progress > 0.78 && progress < 0.95;
  const showOcean = progress > 0.85;
  return (
    <>
      <SkyDome progress={progress} />
      {progress < 0.2 && (
        <Stars radius={80} depth={40} count={3000} factor={2} saturation={0} fade speed={0.1} />
      )}
      <ambientLight intensity={0.3} />
      <directionalLight position={[6, 8, 4]} intensity={2.4} />
      <Capsule shake={shake} />
      <PlasmaTrail intensity={plasma} />
      <Parachute visible={parachute} />
      <Ocean visible={showOcean} />
      <ReentryCamera progress={progress} />
    </>
  );
}

export default function ReentryScene({ progress = 0 }) {
  return (
    <div className="absolute inset-0 canvas-host" data-testid="reentry-canvas">
      <Canvas
        camera={{ position: [1.6, 0.4, 1.6], fov: 50 }}
        dpr={[1, 2]}
        gl={{
          antialias: true,
          alpha: false,
          toneMapping: THREE.ACESFilmicToneMapping,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        onCreated={({ gl }) => gl.setClearColor("#050505")}
      >
        <Suspense fallback={null}>
          <Scene progress={progress} />
        </Suspense>
      </Canvas>
    </div>
  );
}
