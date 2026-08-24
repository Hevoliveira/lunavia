import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Stars, OrbitControls, useTexture } from "@react-three/drei";
import { useRef, useMemo, Suspense, useEffect } from "react";
import * as THREE from "three";
import {
  EARTH_RADIUS_KM,
  MOON_RADIUS_KM,
  EARTH_MOON_DIST_KM,
  trajectoryPosition,
} from "@/data/missionPhases";
import SpacecraftModel from "@/components/SpacecraftModel";

// Public-domain planet textures hosted by three.js examples.
const EARTH_MAP = "https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg";
const EARTH_NORMAL = "https://threejs.org/examples/textures/planets/earth_normal_2048.jpg";
const EARTH_SPEC = "https://threejs.org/examples/textures/planets/earth_specular_2048.jpg";
const EARTH_CLOUDS = "https://threejs.org/examples/textures/planets/earth_clouds_1024.png";
const MOON_MAP = "https://threejs.org/examples/textures/planets/moon_1024.jpg";

const SCENE_SCALE = 20 / EARTH_MOON_DIST_KM;
const EARTH_UNITS = EARTH_RADIUS_KM * SCENE_SCALE * 10;
const MOON_UNITS = MOON_RADIUS_KM * SCENE_SCALE * 10;

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
    if (surfaceRef.current) surfaceRef.current.rotation.y += delta * 0.02;
    if (cloudRef.current) cloudRef.current.rotation.y += delta * 0.025;
  });

  return (
    <group position={[0, 0, 0]}>
      {/* Surface */}
      <mesh ref={surfaceRef}>
        <sphereGeometry args={[EARTH_UNITS, 128, 128]} />
        <meshPhongMaterial
          map={colorMap}
          normalMap={normalMap}
          specularMap={specMap}
          shininess={16}
          specular={new THREE.Color("#3a5a8a")}
        />
      </mesh>

      {/* Clouds */}
      <mesh ref={cloudRef}>
        <sphereGeometry args={[EARTH_UNITS * 1.012, 96, 96]} />
        <meshPhongMaterial
          map={cloudMap}
          transparent
          opacity={0.7}
          depthWrite={false}
        />
      </mesh>

      {/* Atmosphere fresnel */}
      <mesh>
        <sphereGeometry args={[EARTH_UNITS * 1.06, 64, 64]} />
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
              float intensity = pow(0.65 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.2);
              gl_FragColor = vec4(uColor, 1.0) * intensity;
            }
          `}
        />
      </mesh>
    </group>
  );
}

function Moon({ position }) {
  const [map] = useTexture([MOON_MAP]);
  const ref = useRef();
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.01;
  });
  return (
    <mesh ref={ref} position={position}>
      <sphereGeometry args={[MOON_UNITS, 96, 96]} />
      <meshStandardMaterial
        map={map}
        roughness={1}
        metalness={0}
        bumpMap={map}
        bumpScale={0.02}
      />
    </mesh>
  );
}

function Spacecraft({ position, cinematic }) {
  const ref = useRef();
  useFrame(() => {
    if (ref.current) {
      ref.current.position.set(position[0], position[1], position[2]);
    }
  });
  // In cinematic wide shots the ship is tiny, so scale it up quite a bit
  return (
    <group ref={ref}>
      <SpacecraftModel scale={cinematic ? 1.6 : 1.2} />
    </group>
  );
}

function TrajectoryPath({ duration = 702000 }) {
  const geom = useMemo(() => {
    const pts = [];
    const steps = 320;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * duration;
      const p = trajectoryPosition(t);
      pts.push(new THREE.Vector3(p.x * SCENE_SCALE, 0, p.z * SCENE_SCALE));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [duration]);
  return (
    <line geometry={geom}>
      <lineBasicMaterial color="#FF3B00" transparent opacity={0.35} />
    </line>
  );
}

function CinematicCamera({ missionTime, cinematic, spacecraftScenePos, moonScenePos }) {
  const { camera } = useThree();
  const targetPos = useRef(new THREE.Vector3(0, 12, 28));
  const lookAt = useRef(new THREE.Vector3(0, 0, 0));

  useFrame((_, delta) => {
    if (!cinematic) return;
    let desiredPos = new THREE.Vector3();
    let desiredLook = new THREE.Vector3();

    if (missionTime < 690) {
      // Launch: close on Earth from above the launch site
      desiredPos.set(4.2, 2.5, 5.5);
      desiredLook.set(0, 0, 0);
    } else if (missionTime < 9840) {
      // LEO: mid-distance, looking along the orbital plane
      desiredPos.set(5.5, 2.2, 5.5);
      desiredLook.set(0, 0, 0);
    } else if (missionTime < 273360) {
      // TLI + cruise: pull back to show whole system
      const u = Math.min(1, (missionTime - 9840) / 100000);
      desiredPos.set(
        THREE.MathUtils.lerp(6, 10, u),
        THREE.MathUtils.lerp(4, 9, u),
        THREE.MathUtils.lerp(10, 22, u)
      );
      desiredLook.set(
        (spacecraftScenePos[0] + moonScenePos[0]) * 0.5,
        0,
        (spacecraftScenePos[2] + moonScenePos[2]) * 0.5
      );
    } else if (missionTime < 504000) {
      // Lunar orbit: close on Moon
      desiredPos.set(
        moonScenePos[0] + 2.2,
        1.4,
        moonScenePos[2] + 2.2
      );
      desiredLook.set(moonScenePos[0], 0, moonScenePos[2]);
    } else if (missionTime < 702000) {
      // Return: pull back then close on Earth
      const u = Math.min(1, (missionTime - 504000) / 198000);
      desiredPos.set(
        THREE.MathUtils.lerp(10, 4.5, u),
        THREE.MathUtils.lerp(8, 2.5, u),
        THREE.MathUtils.lerp(22, 5.5, u)
      );
      desiredLook.set(
        spacecraftScenePos[0] * (1 - u),
        0,
        spacecraftScenePos[2] * (1 - u)
      );
    } else {
      // Splashdown
      desiredPos.set(4.5, 2.2, 5.5);
      desiredLook.set(0, 0, 0);
    }

    const lerpSpeed = Math.min(1, delta * 0.7);
    targetPos.current.lerp(desiredPos, lerpSpeed);
    lookAt.current.lerp(desiredLook, lerpSpeed);
    camera.position.copy(targetPos.current);
    camera.lookAt(lookAt.current);
    camera.updateProjectionMatrix();
  });

  useEffect(() => {
    if (!cinematic) {
      camera.position.set(0, 12, 28);
      camera.lookAt(0, 0, 0);
      targetPos.current.set(0, 12, 28);
      lookAt.current.set(0, 0, 0);
    }
  }, [cinematic, camera]);

  return null;
}

function Scene({ missionTime, cinematic }) {
  const pos = trajectoryPosition(missionTime);
  const spacecraftScenePos = [pos.x * SCENE_SCALE, 0, pos.z * SCENE_SCALE];
  const moonScenePos = [pos.moonX * SCENE_SCALE, 0, pos.moonZ * SCENE_SCALE];

  return (
    <>
      {/* Deep space ambient */}
      <ambientLight intensity={0.04} />
      {/* Sun — harsh directional */}
      <directionalLight
        position={[40, 8, 25]}
        intensity={3.2}
        color="#ffffff"
        castShadow={false}
      />
      {/* Subtle rim on the dark side */}
      <directionalLight
        position={[-30, -5, -20]}
        intensity={0.15}
        color="#3a5a8a"
      />
      <Stars radius={100} depth={50} count={8000} factor={3.5} saturation={0} fade speed={0.1} />
      <Earth />
      <Moon position={moonScenePos} />
      <Spacecraft position={spacecraftScenePos} cinematic={cinematic} />
      <TrajectoryPath />
      {!cinematic && (
        <OrbitControls
          enablePan={false}
          enableZoom={true}
          minDistance={2}
          maxDistance={60}
          dampingFactor={0.06}
        />
      )}
      <CinematicCamera
        missionTime={missionTime}
        cinematic={cinematic}
        spacecraftScenePos={spacecraftScenePos}
        moonScenePos={moonScenePos}
      />
    </>
  );
}

function LoadingFallback() {
  return null;
}

export default function MissionScene({ missionTime, cinematic = false }) {
  return (
    <div className="absolute inset-0 canvas-host" data-testid="mission-canvas">
      <Canvas
        camera={{ position: [0, 12, 28], fov: 45 }}
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
        <Suspense fallback={<LoadingFallback />}>
          <Scene missionTime={missionTime} cinematic={cinematic} />
        </Suspense>
      </Canvas>
    </div>
  );
}
