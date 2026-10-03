import { Canvas, useFrame } from "@react-three/fiber";
import { Stars, useTexture } from "@react-three/drei";
import { useRef, Suspense } from "react";
import * as THREE from "three";
import SpacecraftModel from "@/components/SpacecraftModel";

const EARTH_MAP = process.env.PUBLIC_URL + "/textures/planets/earth_atmos_2048.jpg";
const EARTH_NORMAL = process.env.PUBLIC_URL + "/textures/planets/earth_normal_2048.jpg";
const EARTH_SPEC = process.env.PUBLIC_URL + "/textures/planets/earth_specular_2048.jpg";
const EARTH_CLOUDS = process.env.PUBLIC_URL + "/textures/planets/earth_clouds_1024.png";
const MOON_MAP = process.env.PUBLIC_URL + "/textures/planets/moon_1024.jpg";

function Earth() {
  const [colorMap, normalMap, specMap, cloudMap] = useTexture([
    EARTH_MAP,
    EARTH_NORMAL,
    EARTH_SPEC,
    EARTH_CLOUDS,
  ]);
  const surfaceRef = useRef();
  const cloudRef = useRef();
  useFrame((_, delta) => {
    if (surfaceRef.current) surfaceRef.current.rotation.y += delta * 0.04;
    if (cloudRef.current) cloudRef.current.rotation.y += delta * 0.055;
  });

  return (
    <group position={[-2.5, -0.4, 0]}>
      <mesh ref={surfaceRef}>
        <sphereGeometry args={[2, 128, 128]} />
        <meshPhongMaterial
          map={colorMap}
          normalMap={normalMap}
          specularMap={specMap}
          shininess={18}
          specular={new THREE.Color("#3a5a8a")}
        />
      </mesh>
      <mesh ref={cloudRef}>
        <sphereGeometry args={[2.02, 96, 96]} />
        <meshPhongMaterial map={cloudMap} transparent opacity={0.72} depthWrite={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[2.15, 64, 64]} />
        <shaderMaterial
          transparent
          side={THREE.BackSide}
          depthWrite={false}
          uniforms={{ uColor: { value: new THREE.Color("#4a90e2") } }}
          vertexShader={`
            varying vec3 vNormal;
            void main() {
              vNormal = normalize(normalMatrix * normal);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
          fragmentShader={`
            varying vec3 vNormal;
            uniform vec3 uColor;
            void main() {
              float intensity = pow(0.7 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.4);
              gl_FragColor = vec4(uColor, 1.0) * intensity;
            }
          `}
        />
      </mesh>
    </group>
  );
}

function Moon() {
  const [map] = useTexture([MOON_MAP]);
  const ref = useRef();
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.02;
  });
  return (
    <mesh ref={ref} position={[3.4, 0.7, -1]}>
      <sphereGeometry args={[0.62, 96, 96]} />
      <meshStandardMaterial
        map={map}
        bumpMap={map}
        bumpScale={0.02}
        roughness={1}
        metalness={0}
      />
    </mesh>
  );
}

function TrajectoryArc() {
  const points = [];
  const start = new THREE.Vector3(-2.5, -0.4, 0);
  const end = new THREE.Vector3(3.4, 0.7, -1);
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    const p = new THREE.Vector3().lerpVectors(start, end, t);
    p.y += Math.sin(Math.PI * t) * 1.2;
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

function DriftingShip() {
  const ref = useRef();
  useFrame((state) => {
    if (ref.current) {
      const t = state.clock.elapsedTime * 0.06 + 0.1;
      // moves along the same arc as TrajectoryArc, looping
      const u = (t % 1);
      const start = new THREE.Vector3(-2.5, -0.4, 0);
      const end = new THREE.Vector3(3.4, 0.7, -1);
      const p = new THREE.Vector3().lerpVectors(start, end, u);
      p.y += Math.sin(Math.PI * u) * 1.2;
      p.z += Math.sin(Math.PI * u) * 0.4;
      ref.current.position.copy(p);
    }
  });
  return (
    <group ref={ref}>
      <SpacecraftModel scale={1.8} />
    </group>
  );
}

export default function EarthMoonHero() {
  return (
    <div className="absolute inset-0 canvas-host" data-testid="hero-canvas">
      <Canvas
        camera={{ position: [0, 0.4, 6.2], fov: 45 }}
        dpr={[1, 2]}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        onCreated={({ gl }) => gl.setClearColor("#050505")}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.04} />
          <directionalLight position={[10, 4, 6]} intensity={3.4} color="#ffffff" />
          <directionalLight position={[-8, -3, -4]} intensity={0.12} color="#3a5a8a" />
          <Stars radius={80} depth={40} count={6000} factor={3} saturation={0} fade speed={0.2} />
          <Earth />
          <Moon />
          <TrajectoryArc />
          <DriftingShip />
        </Suspense>
      </Canvas>
    </div>
  );
}
