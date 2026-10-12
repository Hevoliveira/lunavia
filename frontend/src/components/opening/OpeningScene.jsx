import { Canvas, createPortal, useFrame, useThree } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import { Composite, Earth, Glint, Moon, VehicleLayer, vehicleView } from "@/components/MissionScene";
import { craftPose, orbitCamera } from "@/data/lunarOrbitShot";
import { MOON_UNITS, moonScenePos } from "@/data/sceneTrack";
import { ORBIT_SEQ, vehicleFrame } from "@/data/orbitSequence";
import { COAST, undocking } from "@/data/undocking";
import { OPENING, loopCamera, openingCamera, openingUndockTime } from "@/data/openingSequence";
import AdaptiveResolution from "@/components/scenes/AdaptiveResolution";

/*
 * Lunar orbit for the opening and for the title loop behind the main menu.
 * Everything is the mission's own: the Moon and Sun of its lunar orbit
 * (MissionScene, data/lunarOrbitShot), the spacecraft at true size in its own
 * layer, the undocking choreography (data/undocking). Shots: data/openingSequence.
 *
 * clockRef.current (seconds) advances here, with the frames: the opening holds
 * while its textures load and while the app is in the background.
 *   mode "opening": the 52 s opening (docked stack → undocking → the LM leaves)
 *   mode "loop":    the command and service module alone, the camera drifting
 */
const SUN_POS = [30, 10, -20];
const MOON_POS = moonScenePos(270000); // where the mission's lunar orbit is

function Director({ clockRef, mode, viewRef }) {
  const { camera } = useThree();
  useFrame((_, delta) => {
    clockRef.current += Math.min(delta, 0.1);
    const t = clockRef.current;
    const v = viewRef.current;
    const pose = craftPose(OPENING.orbitTau + t, MOON_POS, MOON_UNITS);
    const frame = vehicleFrame(pose.fwd, pose.up);
    let cam;
    if (mode === "loop") {
      v.stack = undocking(COAST);
      cam = loopCamera(t);
      v.focus = [-2, 0, 0];
      v.shot = "loop";
    } else {
      v.stack = undocking(openingUndockTime(t));
      cam = openingCamera(t, v.stack.lmY);
      v.focus = cam.shot === "title" ? [7 + v.stack.lmY, 0, 0] : [2, 0, 0];
      v.shot = cam.shot;
    }
    if (cam.wide) {
      // The whole Moon, as the mission's establishing shot: the spacecraft a glint on its orbit.
      const w = orbitCamera(Math.min(t, ORBIT_SEQ.cut - 0.1), MOON_POS, MOON_UNITS);
      camera.up.set(0, 1, 0);
      camera.near = 0.1;
      camera.position.set(...w.pos);
      camera.lookAt(...w.look);
      camera.updateProjectionMatrix();
      v.vehicle = false;
      v.glint = true;
      v.origin = pose.pos;
    } else {
      vehicleView(v, frame, pose.pos, cam, camera);
    }
    if (typeof window !== "undefined") {
      const w = window.__lvOpening || (window.__lvOpening = {});
      w.t = t;
      w.mode = mode;
      w.shot = v.shot;
      w.gap = v.stack.gap;
    }
  });
  return null;
}

function Contents({ clockRef, mode }) {
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
      <Glint viewRef={viewRef} />
      <Director clockRef={clockRef} mode={mode} viewRef={viewRef} />
      {createPortal(<VehicleLayer viewRef={viewRef} lm={mode !== "loop"} />, vScene)}
      <Composite vScene={vScene} vCam={vCam} viewRef={viewRef} />
    </>
  );
}

export default function OpeningScene({ clockRef, mode = "opening", dpr = [1, 2], testId = "opening-canvas" }) {
  return (
    <div className="absolute inset-0" data-testid={testId}>
      <Canvas
        camera={{ position: [0, 0, 0], fov: 45, near: 0.002, far: 2000 }}
        dpr={dpr}
        shadows="percentage"
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }}
        onCreated={({ gl }) => gl.setClearColor("#000000")}
      >
        <Suspense fallback={null}>
          <Contents clockRef={clockRef} mode={mode} />
        </Suspense>
        <Stars radius={100} depth={50} count={8000} factor={3.5} saturation={0} fade speed={0.1} />
        <AdaptiveResolution />
      </Canvas>
    </div>
  );
}
