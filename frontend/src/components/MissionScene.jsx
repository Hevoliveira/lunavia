import { Canvas, createPortal, useFrame, useThree } from "@react-three/fiber";
import { Stars, OrbitControls } from "@react-three/drei";
import { useRef, useMemo, Suspense, useEffect } from "react";
import * as THREE from "three";
import { trajectoryPosition } from "@/data/missionPhases";
import { EARTH_UNITS, MOON_UNITS, SCENE_SCALE } from "@/data/sceneTrack";
import SpacecraftStack from "@/components/spacecraft/SpacecraftStack";
import PayloadSection from "@/components/spacecraft/PayloadSection";
import { payloadMaterials } from "@/components/RocketModel";
import { lunarEnv } from "@/components/LanderModel";
import { COAST, undocking } from "@/data/undocking";
import AdaptiveResolution from "@/components/scenes/AdaptiveResolution";
import { PlanetEarth, PlanetMoon } from "@/components/planets/Planets";
import { preloadPlanetTextures } from "@/components/planets/planetMaterials";
import {
  ASSEMBLY_ROTATION,
  ASSEMBLY_X,
  LM_CENTRE_X,
  M_PER_UNIT,
  ORBIT_ANCHOR,
  ORBIT_SEQ,
  STACK,
  STACK_ROTATION,
  deployState,
  orbitShotAt,
  orbitShotCamera,
  toVehicle,
  toWorld,
  undockTime,
  vehicleFrame,
} from "@/data/orbitSequence";
import { LZ_UP, MOON_ROTATION, craftPose, landingSite, moonRotationFor, orbitCamera, orbitPoint, smoother } from "@/data/lunarOrbitShot";
import { earthFrame, returnCamera, returnShotAt, returnState, teiFrame } from "@/data/earthReturn";

/*
 * Lunar orbit and the return, in two layers composited every frame: the
 * planets in scene units, then the spacecraft at true size in metres
 * (data/orbitSequence explains the frames). The spacecraft is the expedition's
 * own (components/spacecraft): LV-001's outbound assembly, which arrives in lunar
 * orbit integrated (PayloadSection: the transfer carrier, the closed adapter with
 * the LM inside, the CSM on top; the mission cuts there straight from TLI
 * cutoff) and deploys there; then CSM and
 * LM docked (SpacecraftStack), the LM undocking before the descent, the CSM
 * alone on the way home. Wide shots, where the spacecraft is far below a
 * pixel, show it as a sunlit glint on its path.
 */

/**
 * Load the planets' textures ahead of time (during the launch), so the cut from
 * TLI cutoff to lunar orbit lands on a drawn scene, not on a frame waiting for them.
 * (NASA imagery, one shared copy: components/planets.)
 */
export function preloadMissionScene() {
  preloadPlanetTextures();
}

const SUN_POS = [30, 10, -20];
const SUN_DIR = new THREE.Vector3(...SUN_POS).normalize();
const SUN_W = [SUN_DIR.x, SUN_DIR.y, SUN_DIR.z];


export function Earth({ small }) {
  // Drawn 10x oversized in the Earth-Moon views; seen from lunar orbit, at its true size in the sky.
  // Lit by the scene's one Sun (SUN_DIR, which also lights the spacecraft layer).
  return <PlanetEarth radius={EARTH_UNITS} sun={SUN_DIR} spin={0.02} scale={small ? 0.1 : 1} />;
}

// The Moon keeps one fixed orientation in every shot (it is tidally locked and
// turns by only half a degree per hour), with the landing site in a low
// morning Sun on the face the orbit camera sees. See data/lunarOrbitShot.js.
const quaternionOf = (m) => {
  const m4 = new THREE.Matrix4().set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
  return new THREE.Quaternion().setFromRotationMatrix(m4);
};
const MOON_QUATERNION = quaternionOf(MOON_ROTATION);
/** The Moon turned so that a mission's orbit view (lat, lon in degrees) lies under the orbit (data/missionConfig orbitView). */
const moonQuaternionFor = (view) => (view ? quaternionOf(moonRotationFor(view.lat * (Math.PI / 180), view.lon * (Math.PI / 180))) : MOON_QUATERNION);
// The landing-site ring lies flat on the surface (ringGeometry faces +Z).
const RING_QUATERNION = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...LZ_UP));

const _mc = new THREE.Vector3();

/*
 * The Moon: NASA LRO colour and LOLA relief (components/planets), lit only by the
 * scene's Sun. Close to the surface (the spacecraft shots in lunar orbit) a fine
 * tiling regolith detail fades in as the camera nears it.
 */
const moonDetail = (position) => (camera) => {
  const d = camera.position.distanceTo(_mc.set(position[0], position[1], position[2])) / MOON_UNITS;
  return 1 - Math.min(1, Math.max(0, (d - 1.25) / 0.45));
};
export function Moon({ position, view = null }) {
  const quaternion = useMemo(() => moonQuaternionFor(view), [view]);
  const detail = useMemo(() => moonDetail(position), [position]);
  return <PlanetMoon radius={MOON_UNITS} sun={SUN_DIR} position={position} quaternion={quaternion} detail={detail} />;
}

/* ---- the spacecraft in wide shots: a sunlit point on its path ------------------------------- */
let GLINT_TEX = null;
function glintTexture() {
  if (GLINT_TEX) return GLINT_TEX;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.12, "rgba(255,246,228,0.85)");
  r.addColorStop(0.4, "rgba(255,200,150,0.18)");
  r.addColorStop(1, "rgba(255,180,120,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  GLINT_TEX = new THREE.CanvasTexture(c);
  return GLINT_TEX;
}
export function Glint({ viewRef }) {
  const ref = useRef();
  const mat = useMemo(
    () => new THREE.SpriteMaterial({ map: glintTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, sizeAttenuation: false }),
    []
  );
  useFrame((state) => {
    const v = viewRef.current;
    const s = ref.current;
    if (!s) return;
    s.visible = !!v.glint;
    if (!v.glint) return;
    s.position.set(v.origin[0], v.origin[1], v.origin[2]);
    const k = 0.016 * (1 + 0.12 * Math.sin(state.clock.elapsedTime * 2.1));
    s.scale.set(k, k, 1);
  });
  return <sprite ref={ref} material={mat} renderOrder={5} />;
}

/** Landing site on the surface and the orbit path, during the establishing shot. */
function OrbitGuides({ clock, moonPos, marker = true }) {
  const orbitMat = useRef();
  const ringMat = useRef();
  const site = useMemo(() => landingSite(moonPos, MOON_UNITS), [moonPos]);
  const orbitLine = useMemo(() => {
    const pts = [];
    for (let i = 0; i <= 160; i++) {
      const p = orbitPoint((i / 160) * Math.PI * 2, moonPos, MOON_UNITS);
      pts.push(new THREE.Vector3(p[0], p[1], p[2]));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [moonPos]);
  useEffect(() => () => orbitLine.dispose(), [orbitLine]);
  useFrame((state) => {
    const tau = clock.current;
    const on = tau < ORBIT_SEQ.cut ? 1 : 0;
    if (orbitMat.current) orbitMat.current.opacity = 0.3 * on * smoother(tau / 1.5);
    if (ringMat.current) ringMat.current.opacity = on * (0.55 + 0.25 * Math.sin(state.clock.elapsedTime * 2.2)) * smoother((tau - 1) / 2);
  });
  return (
    <group>
      <line geometry={orbitLine}>
        <lineBasicMaterial ref={orbitMat} color="#FF3B00" transparent opacity={0} depthWrite={false} />
      </line>
      <mesh visible={marker} position={[site[0] + LZ_UP[0] * 0.002, site[1] + LZ_UP[1] * 0.002, site[2] + LZ_UP[2] * 0.002]} quaternion={RING_QUATERNION}>
        <ringGeometry args={[0.035, 0.045, 48]} />
        <meshBasicMaterial ref={ringMat} color="#FF3B00" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/* ---- the spacecraft layer (metres, vehicle frame) ----------------------------------------- */
const _sunV = new THREE.Vector3();
/**
 * Lights and the spacecraft, for a scene rendered with its own camera over the
 * planets (see Composite). viewRef.current carries the shot: { vehicle, sunV,
 * focus, shadowR, stack, stackOn, yaw, yawRcs, asm }. asm (or null): the outbound
 * assembly { yaw (rad about the vertical), anchor (payload height at the origin),
 * x (shift along +X), td, craft, engines, retro, yawRcs }. Shared with the title
 * loop (components/opening/TitleLoop), which draws the CSM alone (assembly false).
 */
export function VehicleLayer({ viewRef, lm = true, assembly = false }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const sun = useRef();
  const target = useRef();
  const group = useRef();
  const yawGroup = useRef();
  const yawInner = useRef();
  const rollGroup = useRef();
  const stackRoot = useRef();
  const asmYaw = useRef();
  const asmInner = useRef();
  const asmCtrl = useRef({ td: null, ghost: 0, yawRcs: 0, hideCraft: false, carrier: { engines: 0, rcs: 0, retro: 0, inside: true } });
  const asmMats = useMemo(() => (assembly ? payloadMaterials() : null), [assembly]);
  const shadowR = useRef(14);
  const stackState = useRef(undocking(COAST));
  useEffect(() => {
    scene.environment = lunarEnv(gl);
  }, [gl, scene]);
  useEffect(() => {
    if (sun.current && target.current) sun.current.target = target.current;
  }, []);
  useEffect(() => {
    // Compile the spacecraft's shaders now, not at the first cut to it (a visible
    // hitch), including what is hidden until later (the SPS plume, the RCS puffs).
    const g = group.current;
    if (!g) return;
    const hidden = [];
    g.traverse((n) => {
      if (!n.visible) {
        hidden.push(n);
        n.visible = true;
      }
    });
    try {
      gl.compile(scene, camera);
    } catch {
      // compiled on first draw instead
    }
    hidden.forEach((n) => (n.visible = false));
  }, [gl, scene, camera]);
  useFrame(() => {
    const v = viewRef.current;
    if (group.current) group.current.visible = !!v.vehicle;
    if (!v.vehicle) return;
    Object.assign(stackState.current, v.stack);
    stackState.current.yawRcs = v.yawRcs || 0;
    stackState.current.rollRcs = v.rollRcs || 0;
    stackState.current.sps = v.sps || 0;
    // The stack turned about the local vertical through its middle (or, for the CSM alone
    // on the way home, through its centre of mass: v.pivot), rolled about its long axis
    // and moved along X (the TEI burn).
    const pivot = v.pivot != null ? v.pivot : STACK.mid;
    if (yawGroup.current) {
      yawGroup.current.rotation.y = v.yaw || 0;
      yawGroup.current.position.x = pivot + (v.x || 0);
    }
    if (yawInner.current) yawInner.current.position.x = -pivot;
    if (rollGroup.current) rollGroup.current.rotation.x = v.roll || 0;
    if (stackRoot.current) stackRoot.current.visible = v.stackOn !== false;
    // The outbound assembly: turned about the vertical, its payload frame laid along X.
    const a = v.asm;
    if (asmYaw.current) {
      asmYaw.current.visible = !!a;
      if (a) {
        asmYaw.current.rotation.y = a.yaw || 0;
        asmInner.current.position.x = a.anchor + (a.x || 0);
        const c = asmCtrl.current;
        c.td = a.td || null;
        c.yawRcs = a.yawRcs || 0;
        c.hideCraft = a.craft === false;
        c.carrier.engines = a.engines || 0;
        c.carrier.retro = a.retro || 0;
        c.carrier.yaw = a.yawRcs || 0; // the carrier's aft quads join the CSM's couple
      }
    }
    _sunV.set(v.sunV[0], v.sunV[1], v.sunV[2]);
    if (target.current) target.current.position.set(v.focus[0], v.focus[1], v.focus[2]);
    if (sun.current && target.current) sun.current.position.copy(_sunV).multiplyScalar(60).add(target.current.position);
    // The shadow camera covers the subject: the docked pair, or the larger assembly.
    const r = v.shadowR || 14;
    if (sun.current && r !== shadowR.current) {
      shadowR.current = r;
      const cam = sun.current.shadow.camera;
      cam.left = -r;
      cam.right = r;
      cam.top = r;
      cam.bottom = -r;
      cam.updateProjectionMatrix();
    }
  });
  return (
    <>
      <ambientLight intensity={0.03} />
      {/* The sunlit body below (local vertical +Y): a soft grey fill from underneath. */}
      <hemisphereLight args={["#0a0c12", "#5d5b57", 0.55]} />
      <directionalLight
        ref={sun}
        intensity={3.2}
        color="#fff8ef"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-camera-near={1}
        shadow-camera-far={140}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
      />
      <object3D ref={target} />
      <group ref={group}>
        <group ref={stackRoot}>
          <group ref={yawGroup} position={[STACK.mid, 0, 0]}>
            <group ref={rollGroup}>
              <group ref={yawInner} position={[-STACK.mid, 0, 0]} rotation={STACK_ROTATION}>
                <SpacecraftStack stateRef={stackState} lm={lm} shadows />
              </group>
            </group>
          </group>
        </group>
        {assembly && (
          <group ref={asmYaw} visible={false}>
            <group ref={asmInner} rotation={ASSEMBLY_ROTATION}>
              <PayloadSection ctrlRef={asmCtrl} materials={asmMats} shadows />
            </group>
          </group>
        )}
      </group>
    </>
  );
}

/** Draw only the planet a close shot is about (viewRef.current.only: "earth" | "moon" | null for both). */
function PlanetFilter({ viewRef, earth, moon }) {
  useFrame(() => {
    const only = viewRef.current.only;
    if (earth.current) earth.current.visible = only !== "moon";
    if (moon.current) moon.current.visible = only !== "earth";
  });
  return null;
}

/** Composite every frame: planets, then (when a shot needs it) the spacecraft over a cleared depth buffer. */
export function Composite({ vScene, vCam, viewRef }) {
  useFrame(({ gl, scene, camera, size }) => {
    gl.autoClear = false;
    gl.clear(true, true, true);
    gl.render(scene, camera);
    // Validation tooling (read-only): draw calls and triangles of both layers.
    const stats = typeof window !== "undefined" ? window.__lvSceneStats || (window.__lvSceneStats = {}) : {};
    stats.calls = gl.info.render.calls;
    stats.tris = gl.info.render.triangles;
    const v = viewRef.current;
    if (v.vehicle) {
      vCam.fov = camera.fov;
      vCam.aspect = size.width / size.height;
      vCam.near = 0.1;
      vCam.far = 4000;
      vCam.updateProjectionMatrix();
      vCam.position.set(v.vcam.pos[0], v.vcam.pos[1], v.vcam.pos[2]);
      vCam.up.set(0, 1, 0);
      vCam.lookAt(v.vcam.look[0], v.vcam.look[1], v.vcam.look[2]);
      vCam.updateMatrixWorld();
      gl.clearDepth();
      gl.render(vScene, vCam);
      stats.calls += gl.info.render.calls;
      stats.tris += gl.info.render.triangles;
    }
    stats.vehicle = !!v.vehicle;
  }, 1);
  return null;
}

/**
 * Point both cameras for a spacecraft shot: the vehicle camera at vcam
 * (metres, vehicle frame), the planet camera where the spacecraft is (origin,
 * scene units) plus that same offset, looking the same way.
 */
export function vehicleView(v, frame, origin, vcam, camera) {
  v.vehicle = true;
  v.glint = false;
  v.frame = frame;
  v.origin = origin;
  v.vcam = vcam;
  v.sunV = toVehicle(frame, SUN_W);
  const off = toWorld(frame, vcam.pos);
  camera.position.set(origin[0] + off[0] / M_PER_UNIT, origin[1] + off[1] / M_PER_UNIT, origin[2] + off[2] / M_PER_UNIT);
  const d = toWorld(frame, [vcam.look[0] - vcam.pos[0], vcam.look[1] - vcam.pos[1], vcam.look[2] - vcam.pos[2]]);
  const up = toWorld(frame, [0, 1, 0]);
  camera.up.set(up[0], up[1], up[2]);
  camera.lookAt(camera.position.x + d[0], camera.position.y + d[1], camera.position.z + d[2]);
  camera.near = 0.002;
  camera.far = 2000;
  camera.updateProjectionMatrix();
}

/* ---- the director: which shot, and where both cameras are --------------------------------- */

export { LM_CENTRE_X };

// The CSM's centre of mass along the stack's X (the CM and the fuelled service module):
// the point it turns about on the way home.
const CSM_PIVOT = -2.0;

function Director({ missionTime, cinematic, moonPos, orbitClock, orbitReal, returnClock, viewRef }) {
  const { camera } = useThree();
  const pos = useRef(new THREE.Vector3(0, 12, 28));
  const look = useRef(new THREE.Vector3(0, 0, 0));
  const snap = useRef(true);

  useFrame((state, delta) => {
    const v = viewRef.current;
    v.vehicle = false;
    v.glint = false;
    if (!cinematic) return;
    camera.up.set(0, 1, 0);
    camera.near = 0.1;
    camera.far = 2000;

    v.yaw = 0;
    v.yawRcs = 0;
    v.roll = 0;
    v.rollRcs = 0;
    v.sps = 0;
    v.x = 0;
    v.pivot = null;
    v.step = null;
    v.only = null;
    v.asm = null;
    v.stackOn = true;
    v.shadowR = 14;

    if (orbitClock) {
      // ---- Lunar orbit: data/orbitSequence (insertion burn, the docked stack, undocking, title) ----
      const tau = orbitClock.current;
      const pose = craftPose(tau, moonPos, MOON_UNITS);
      const { shot, u } = orbitShotAt(tau, orbitReal ? orbitReal.current : null);
      v.shot = shot.id;
      v.stack = undocking(undockTime(tau));
      // The outbound assembly until the deployment hands the docked pair to SpacecraftStack,
      // then the carrier backing away; engines first since the approach (no yaw).
      const d = deployState(tau);
      v.asm = d.on ? { yaw: 0, anchor: ORBIT_ANCHOR, x: d.x, td: d.td, craft: d.craft, engines: d.engines, retro: d.retro, yawRcs: 0 } : null;
      v.stackOn = !d.craft;
      if (shot.wide) {
        const cam = orbitCamera(tau, moonPos, MOON_UNITS);
        camera.position.set(...cam.pos);
        camera.lookAt(...cam.look);
        camera.updateProjectionMatrix();
        v.glint = true;
        v.origin = pose.pos;
      } else {
        const frame = vehicleFrame(pose.fwd, pose.up);
        if (shot.asm) {
          v.focus = [(ASSEMBLY_X.nose + ASSEMBLY_X.aft) / 2, 0, 0];
          v.shadowR = 22;
        } else if (shot.id === "leave") {
          v.focus = [6, 0, 0];
          v.shadowR = 20;
        } else v.focus = shot.follow === "lm" ? [LM_CENTRE_X + v.stack.lmY, 0, 0] : [2, 0, 0];
        const cam = orbitShotCamera(shot, u, v.stack.lmY, d.e);
        if (shot.id === "titleScreen") {
          // The title screen: the shot held, breathing very slowly (real time; the orbit clock is all but stopped).
          const t = state.clock.elapsedTime;
          cam.pos = [cam.pos[0] + 0.7 * Math.sin(t * 0.153), cam.pos[1] + 0.35 * Math.sin(t * 0.217 + 1), cam.pos[2] + 0.5 * Math.sin(t * 0.119 + 2)];
        }
        vehicleView(v, frame, pose.pos, cam, camera);
      }
      snap.current = true;
      return;
    }

    // ---- The return to Earth (data/earthReturn): the CSM alone, the same one that waited in
    // lunar orbit. TEI over the Moon, the coast, the Earth approach; the planets at their true
    // apparent size for the spacecraft's distance, and only the one the shot is about.
    if (returnClock) {
      const rt = returnClock.current;
      const { shot, step } = returnShotAt(rt);
      const st = returnState(rt);
      const F = shot === "tei" ? teiFrame(rt, moonPos, SUN_W) : earthFrame(rt, SUN_W);
      v.shot = shot === "tei" ? "tei" : shot === "coast" ? "transearthCoast" : "earthApproach";
      v.step = step;
      v.only = shot === "tei" ? "moon" : "earth";
      v.stack = undocking(COAST);
      v.yaw = st.yaw;
      v.yawRcs = st.yawRcs;
      v.roll = st.roll;
      v.rollRcs = st.rollRcs;
      v.sps = st.sps;
      v.x = st.x;
      v.pivot = CSM_PIVOT;
      v.focus = [CSM_PIVOT + st.x, 0, 0];
      v.shadowR = 9;
      vehicleView(v, F.frame, F.origin, returnCamera(rt), camera);
      snap.current = true;
      return;
    }

    // (Nothing else is flown on this scene: lunar orbit and the return are the only shots.)
  });

  // Camera, Moon and shot each frame, for the validation tooling.
  useFrame(() => {
    const w = window.__lvMissionView || (window.__lvMissionView = { cam: [0, 0, 0], moon: [0, 0, 0] });
    camera.position.toArray(w.cam);
    w.moon[0] = moonPos[0];
    w.moon[1] = moonPos[1];
    w.moon[2] = moonPos[2];
    w.t = missionTime;
    w.tau = orbitClock ? orbitClock.current : null;
    w.real = orbitReal ? orbitReal.current : null;
    const v = viewRef.current;
    w.shot = v.shot;
    w.vehicle = v.vehicle;
    w.stack = v.stack ? { gap: +v.stack.gap.toFixed(3), lmRoll: +v.stack.lmRoll.toFixed(3), phase: v.stack.phase } : null;
    w.yaw = v.yaw || 0;
    w.ret = returnClock ? { t: +returnClock.current.toFixed(2), step: v.step, yaw: +(v.yaw || 0).toFixed(4), roll: +(v.roll || 0).toFixed(4), sps: +(v.sps || 0).toFixed(3), yawRcs: v.yawRcs || 0, rollRcs: v.rollRcs || 0, x: +(v.x || 0).toFixed(2), only: v.only } : null;
    w.stackOn = v.vehicle ? v.stackOn !== false : null;
    w.asm = v.vehicle && v.asm ? { yaw: +v.asm.yaw.toFixed(4), craft: v.asm.craft, phase: v.asm.td ? v.asm.td.phase : "mated", x: +(v.asm.x || 0).toFixed(3), engines: +(v.asm.engines || 0).toFixed(3), retro: +(v.asm.retro || 0).toFixed(3), yawRcs: +(v.asm.yawRcs || 0).toFixed(3) } : null;
  });

  useEffect(() => {
    if (!cinematic) {
      camera.position.set(0, 12, 28);
      camera.lookAt(0, 0, 0);
      pos.current.set(0, 12, 28);
      look.current.set(0, 0, 0);
      snap.current = true;
    }
  }, [cinematic, camera]);

  return null;
}

// Lunar orbit and the descent-prep screens freeze the Earth-Moon geometry at
// the end of the cruise, so nothing drifts while the player reads.
const ORBIT_EPOCH = 270000;

function Scene({ missionTime, cinematic, orbitClock, orbitReal, returnClock, orbitView }) {
  const t = orbitClock ? ORBIT_EPOCH : missionTime;
  const p = trajectoryPosition(t);
  const moonPos = useMemo(() => [p.moonX * SCENE_SCALE, 0, p.moonZ * SCENE_SCALE], [p.moonX, p.moonZ]);
  const viewRef = useRef({ vehicle: false, glint: false, origin: [0, 0, 0], stack: undocking(COAST), focus: [0, 0, 0], sunV: [0, 1, 0] });
  const vScene = useMemo(() => new THREE.Scene(), []);
  const vCam = useMemo(() => new THREE.PerspectiveCamera(45, 1, 0.1, 4000), []);
  // The lunar module flies out docked and stays on the Moon: the way home is the CSM alone.
  const lmAboard = !!orbitClock;
  const earthGroup = useRef();
  const moonGroup = useRef();

  return (
    <>
      {/* Deep space ambient — near zero for a hard terminator */}
      <ambientLight intensity={0.02} />
      {/* Faint starlight fill so nothing turns into a void */}
      <hemisphereLight args={["#24344c", "#050505", 0.3]} />
      {/* Sun — positioned so departure shows a receding gibbous Earth and the
          approach a growing crescent Moon (Apollo-style phase language) */}
      <directionalLight position={SUN_POS} intensity={3.4} color="#ffffff" castShadow={false} />
      {/* Faint cool fill on the night side */}
      <directionalLight position={[-20, -5, 25]} intensity={0.1} color="#3a5a8a" />
      <group ref={earthGroup}>
        <Earth small={!!orbitClock} />
      </group>
      <group ref={moonGroup}>
        <Moon position={moonPos} view={orbitClock ? orbitView : null} />
      </group>
      <Glint viewRef={viewRef} />
      {orbitClock && <OrbitGuides clock={orbitClock} moonPos={moonPos} marker={!orbitView || orbitView.marker} />}
      {!cinematic && <OrbitControls enablePan={false} enableZoom={true} minDistance={2} maxDistance={60} dampingFactor={0.06} />}
      <Director missionTime={missionTime} cinematic={cinematic} moonPos={moonPos} orbitClock={orbitClock} orbitReal={orbitReal} returnClock={returnClock} viewRef={viewRef} />
      {/* after the Director: this frame's shot decides which planets are drawn */}
      <PlanetFilter viewRef={viewRef} earth={earthGroup} moon={moonGroup} />
      {createPortal(<VehicleLayer viewRef={viewRef} lm={lmAboard} assembly />, vScene)}
      <Composite vScene={vScene} vCam={vCam} viewRef={viewRef} />
    </>
  );
}

function LoadingFallback() {
  return null;
}

/**
 * orbitClock (a ref holding the orbit clock, data/orbitSequence orbitClockAt): the
 * lunar-orbit presentation used before the descent; orbitReal (optional, a ref holding
 * real seconds since lunar orbit began) paces the title screen's slow drift.
 * returnClock (a ref holding real seconds since the return began): the return to Earth
 * (data/earthReturn). missionTime places the Moon on its orbit round the Earth.
 */
export default function MissionScene({ missionTime, cinematic = false, orbitClock = null, orbitReal = null, returnClock = null, orbitView = null }) {
  return (
    <div className="absolute inset-0 canvas-host" data-testid="mission-canvas">
      <Canvas
        camera={{ position: [0, 12, 28], fov: 45 }}
        dpr={[1, 2]}
        shadows="percentage"
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
          <Scene missionTime={missionTime} cinematic={cinematic} orbitClock={orbitClock} orbitReal={orbitReal} returnClock={returnClock} orbitView={orbitView} />
        </Suspense>
        {/* Stars outside the texture suspense so deep space never goes blank */}
        <Stars radius={100} depth={50} count={8000} factor={3.5} saturation={0} fade speed={0.1} />
        <AdaptiveResolution />
      </Canvas>
    </div>
  );
}
