import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import { useRef, Suspense, useMemo } from "react";
import * as THREE from "three";
import RocketModel from "@/components/RocketModel";

/**
 * AscentScene — rocket climbs from launch pad through atmosphere into space.
 * Progress in [0..1] drives altitude, sky color, star density and camera.
 * `separated` triggers stage separation animation.
 */

function LaunchPad() {
  return (
    <group position={[0, -0.4, 0]}>
      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[20, 32]} />
        <meshStandardMaterial color="#2a2620" roughness={1} />
      </mesh>
      {/* Pad base */}
      <mesh position={[0, 0.05, 0]}>
        <cylinderGeometry args={[1.2, 1.4, 0.1, 24]} />
        <meshStandardMaterial color="#1a1a1a" metalness={0.6} roughness={0.5} />
      </mesh>
      {/* Tower */}
      <mesh position={[1.3, 1.5, 0]}>
        <boxGeometry args={[0.15, 3, 0.15]} />
        <meshStandardMaterial color="#c8c8c8" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* Cross beams on tower */}
      {[0.5, 1.2, 1.9, 2.6].map((y) => (
        <mesh key={y} position={[0.7, y, 0]}>
          <boxGeometry args={[1.2, 0.05, 0.05]} />
          <meshStandardMaterial color="#c8c8c8" metalness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

function AtmosphereBackground({ progress }) {
  // Fake sky using a very large sphere behind everything.
  // Color transitions from dawn blue -> deep navy -> pitch black.
  const meshRef = useRef();
  useFrame(() => {
    if (!meshRef.current) return;
    const c = new THREE.Color();
    if (progress < 0.4) {
      c.setHSL(0.6, 0.65, 0.35 - progress * 0.4);
    } else if (progress < 0.8) {
      const p = (progress - 0.4) / 0.4;
      c.setHSL(0.62, 0.55 * (1 - p), 0.2 - p * 0.18);
    } else {
      c.set("#050505");
    }
    meshRef.current.material.color.copy(c);
  });
  return (
    <mesh ref={meshRef} scale={[80, 80, 80]}>
      <sphereGeometry args={[1, 24, 24]} />
      <meshBasicMaterial side={THREE.BackSide} color="#3388cc" />
    </mesh>
  );
}

function CloudLayer({ progress }) {
  // A ring of tiny cloud sprites that fall past the camera as we ascend
  const groupRef = useRef();
  const clouds = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 40; i++) {
      arr.push({
        x: (Math.random() - 0.5) * 12,
        y: Math.random() * 8 - 2,
        z: (Math.random() - 0.5) * 10 - 2,
        s: 0.6 + Math.random() * 1.6,
      });
    }
    return arr;
  }, []);

  useFrame(() => {
    if (!groupRef.current) return;
    groupRef.current.position.y = -progress * 12; // clouds drop away as rocket ascends
    groupRef.current.visible = progress < 0.5;
  });

  return (
    <group ref={groupRef}>
      {clouds.map((c, i) => (
        <mesh key={i} position={[c.x, c.y, c.z]}>
          <sphereGeometry args={[c.s, 12, 12]} />
          <meshBasicMaterial color="#f2f4f8" transparent opacity={0.55} />
        </mesh>
      ))}
    </group>
  );
}

function AscentCamera({ progress }) {
  const { camera } = useThree();
  useFrame((_, delta) => {
    // Rocket rises. Camera trails behind and to the side.
    const altitude = progress * 12;
    const desired = new THREE.Vector3(
      2.4 - progress * 1.6,
      altitude + 1.2,
      3.5 - progress * 1.2
    );
    const lookAt = new THREE.Vector3(0, altitude + 1.8, 0);
    camera.position.lerp(desired, Math.min(1, delta * 2));
    camera.lookAt(lookAt);
  });
  return null;
}

function AscentRocket({ progress, separated, thrust }) {
  const groupRef = useRef();
  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.position.y = progress * 12;
      // slight roll
      groupRef.current.rotation.z = Math.sin(progress * 3) * 0.02;
    }
  });
  return (
    <group ref={groupRef}>
      <RocketModel separated={separated} thrust={thrust} scale={0.6} />
    </group>
  );
}

function Scene({ progress, separated, thrust }) {
  return (
    <>
      <AtmosphereBackground progress={progress} />
      {progress > 0.55 && (
        <Stars radius={100} depth={50} count={4000} factor={2.5} saturation={0} fade speed={0.2} />
      )}
      <ambientLight intensity={0.35} />
      <directionalLight position={[10, 8, 8]} intensity={2.4} />
      <LaunchPad />
      <CloudLayer progress={progress} />
      <AscentRocket progress={progress} separated={separated} thrust={thrust} />
      <AscentCamera progress={progress} />
    </>
  );
}

export default function AscentScene({ progress, separated = false, thrust = 1 }) {
  return (
    <div className="absolute inset-0 canvas-host" data-testid="ascent-canvas">
      <Canvas
        camera={{ position: [2.4, 1.2, 3.5], fov: 55 }}
        dpr={[1, 2]}
        gl={{
          antialias: true,
          alpha: false,
          toneMapping: THREE.ACESFilmicToneMapping,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        onCreated={({ gl }) => gl.setClearColor("#3388cc")}
      >
        <Suspense fallback={null}>
          <Scene progress={progress} separated={separated} thrust={thrust} />
        </Suspense>
      </Canvas>
    </div>
  );
}
