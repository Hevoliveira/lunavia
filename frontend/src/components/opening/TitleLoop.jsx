import { Canvas, createPortal, useFrame, useThree } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import { Composite, Earth, Moon, VehicleLayer, vehicleView } from "@/components/MissionScene";
import { craftPose } from "@/data/lunarOrbitShot";
import { MOON_UNITS, moonScenePos } from "@/data/sceneTrack";
import { vehicleFrame } from "@/data/orbitSequence";
import { COAST, undocking } from "@/data/undocking";
import { LOOP_TAU, loopCamera } from "@/data/titleLoop";
import AdaptiveResolution from "@/components/scenes/AdaptiveResolution";

/**
 * Behind the main menu: the expedition's command and service module alone in
 * lunar orbit (the lunar module has gone down to land), the camera drifting
 * slowly round it (data/titleLoop). Everything is the mission's own: the Moon
 * and Sun of its lunar orbit (MissionScene, data/lunarOrbitShot) and the
 * spacecraft at true size in its own layer. Lighter than the mission: no lunar
 * module, a capped pixel ratio. The clock advances with the frames, so it
 * holds while textures load and while the app is in the background.
 */
const SUN_POS = [30, 10, -20];
const MOON_POS = moonScenePos(270000); // where the mission's lunar orbit is

function Director({ clockRef, viewRef }) {
  const { camera } = useThree();
  useFrame((_, delta) => {
    clockRef.current += Math.min(delta, 0.1);
    const t = clockRef.current;
    const v = viewRef.current;
    const pose = craftPose(LOOP_TAU + t, MOON_POS, MOON_UNITS);
    v.stack = undocking(COAST);
    v.focus = [-2, 0, 0];
    v.shot = "loop";
    vehicleView(v, vehicleFrame(pose.fwd, pose.up), pose.pos, loopCamera(t), camera);
  });
  return null;
}

function Contents({ clockRef }) {
  const viewRef = useRef({ vehicle: false, glint: false, origin: [0, 0, 0], stack: undocking(COAST), focus: [0, 0, 0], sunV: [0, 1, 0] });
  const vScene = useMemo(() => new THREE.Scene(), []);
  const vCam = useMemo(() => new THREE.PerspectiveCamera(45, 1, 0.1, 4000), []);
  return (
    <>
      <ambientLight intensity={0.02} />
      <hemisphereLight args={["#24344c", "#050505", 0.3]} />
      <directionalLight position={SUN_POS} intensity={3.4} color="#ffffff" />
      <directionalLight position={[-20, -5, 25]} intensity={0.1} color="#3a5a8a" />
      <Earth small />
      <Moon position={MOON_POS} />
      <Director clockRef={clockRef} viewRef={viewRef} />
      {createPortal(<VehicleLayer viewRef={viewRef} lm={false} />, vScene)}
      <Composite vScene={vScene} vCam={vCam} viewRef={viewRef} />
    </>
  );
}

export default function TitleLoop() {
  const clockRef = useRef(0);
  return (
    <div className="absolute inset-0" data-testid="title-loop">
      <Canvas
        camera={{ position: [0, 0, 0], fov: 45, near: 0.002, far: 2000 }}
        dpr={[1, 1.5]}
        shadows="percentage"
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }}
        onCreated={({ gl }) => gl.setClearColor("#000000")}
      >
        <Suspense fallback={null}>
          <Contents clockRef={clockRef} />
        </Suspense>
        <Stars radius={100} depth={50} count={8000} factor={3.5} saturation={0} fade speed={0.1} />
        <AdaptiveResolution />
      </Canvas>
    </div>
  );
}
