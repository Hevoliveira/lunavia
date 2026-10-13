import { Canvas, createPortal, useFrame, useThree } from "@react-three/fiber";
import { Stars, OrbitControls, useTexture } from "@react-three/drei";
import { useRef, useMemo, Suspense, useEffect } from "react";
import * as THREE from "three";
import { EARTH_RADIUS_KM, MOON_RADIUS_KM, trajectoryPosition } from "@/data/missionPhases";
import { EARTH_UNITS, MOON_UNITS, SCENE_SCALE, craftScenePos } from "@/data/sceneTrack";
import SpacecraftStack from "@/components/spacecraft/SpacecraftStack";
import { lunarEnv } from "@/components/LanderModel";
import { COAST, undocking } from "@/data/undocking";
import AdaptiveResolution from "@/components/scenes/AdaptiveResolution";
import {
  APPROACH_RAY,
  CISLUNAR,
  LM_CENTRE_X,
  M_PER_UNIT,
  ORBIT_SEQ,
  RETURN_CLOSE_END,
  STACK,
  STACK_ROTATION,
  approachCloseCamera,
  approachMoonKm,
  approachYaw,
  coastDistanceKm,
  coastShotAt,
  cruiseCamera,
  deepCamera,
  orbitShotAt,
  orbitShotCamera,
  radialFrame,
  returnCamera,
  returnDistanceKm,
  spsLevel,
  toVehicle,
  toWorld,
  trueSizeDistance,
  undockTime,
  vehicleFrame,
} from "@/data/orbitSequence";
import { LZ_UP, MOON_ROTATION, craftPose, landingSite, orbitCamera, orbitPoint, smoother } from "@/data/lunarOrbitShot";

/*
 * The cruise, lunar orbit and return, in two layers composited every frame:
 * the planets in scene units, then the spacecraft at true size in metres
 * (data/orbitSequence explains the frames). The spacecraft is the expedition's
 * own (components/spacecraft): CSM and LM docked on the way out and in lunar
 * orbit, the LM undocking before the descent, the CSM alone on the way home.
 * Wide shots, where a 17 m spacecraft is far below a pixel, show it as a
 * sunlit glint on its path.
 */

// Public-domain planet textures hosted by three.js examples.
const EARTH_MAP = process.env.PUBLIC_URL + "/textures/planets/earth_atmos_2048.jpg";
const EARTH_NORMAL = process.env.PUBLIC_URL + "/textures/planets/earth_normal_2048.jpg";
const EARTH_SPEC = process.env.PUBLIC_URL + "/textures/planets/earth_specular_2048.jpg";
const EARTH_CLOUDS = process.env.PUBLIC_URL + "/textures/planets/earth_clouds_1024.png";
const MOON_MAP = process.env.PUBLIC_URL + "/textures/planets/moon_1024.jpg";

const SUN_POS = [30, 10, -20];
const SUN_DIR = new THREE.Vector3(...SUN_POS).normalize();
const SUN_W = [SUN_DIR.x, SUN_DIR.y, SUN_DIR.z];

const smooth01 = (x) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

export function Earth({ small }) {
  const [colorMap, normalMap, specMap, cloudMap] = useTexture([EARTH_MAP, EARTH_NORMAL, EARTH_SPEC, EARTH_CLOUDS]);
  const surfaceRef = useRef();
  const cloudRef = useRef();

  useFrame((_, delta) => {
    if (surfaceRef.current) surfaceRef.current.rotation.y += delta * 0.02;
    if (cloudRef.current) cloudRef.current.rotation.y += delta * 0.025;
  });

  // Drawn 10x oversized in the Earth-Moon views; seen from lunar orbit, at its true size in the sky.
  return (
    <group position={[0, 0, 0]} scale={small ? 0.1 : 1}>
      <mesh ref={surfaceRef}>
        <sphereGeometry args={[EARTH_UNITS, 128, 128]} />
        <meshPhongMaterial map={colorMap} normalMap={normalMap} specularMap={specMap} shininess={22} specular={new THREE.Color("#557799")} />
      </mesh>
      <mesh ref={cloudRef}>
        <sphereGeometry args={[EARTH_UNITS * 1.012, 96, 96]} />
        <meshPhongMaterial map={cloudMap} transparent opacity={0.75} depthWrite={false} />
      </mesh>
      {/* Atmosphere fresnel — sharp limb glow, dramatic terminator */}
      <mesh>
        <sphereGeometry args={[EARTH_UNITS * 1.055, 64, 64]} />
        <shaderMaterial
          transparent
          side={THREE.BackSide}
          depthWrite={false}
          uniforms={{ uColor: { value: new THREE.Color("#63a5ff") } }}
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
              float intensity = pow(0.68 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.6);
              gl_FragColor = vec4(uColor, 1.0) * intensity;
            }
          `}
        />
      </mesh>
    </group>
  );
}

// The Moon keeps one fixed orientation in every shot (it is tidally locked and
// turns by only half a degree per hour), with the landing site in a low
// morning Sun on the face the orbit camera sees. See data/lunarOrbitShot.js.
const MOON_QUATERNION = (() => {
  const m = MOON_ROTATION;
  const m4 = new THREE.Matrix4().set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
  return new THREE.Quaternion().setFromRotationMatrix(m4);
})();
// The landing-site ring lies flat on the surface (ringGeometry faces +Z).
const RING_QUATERNION = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...LZ_UP));

const _mc = new THREE.Vector3();

/*
 * Close to the surface (the spacecraft shots in lunar orbit) the 1k map is
 * magnified many times, and its JPEG blocks would show. Two cheap remedies,
 * invisible in the wide views: the map is softened by about a texel when it
 * loads, and a fine tiling regolith detail fades in as the camera nears the
 * surface (moonDetailTexture).
 */
const MOON_SOFT = new WeakMap();
function softMoonMap(raw) {
  if (MOON_SOFT.has(raw)) return MOON_SOFT.get(raw);
  const img = raw.image;
  let out = raw;
  try {
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.filter = "blur(1.1px)";
    g.drawImage(img, 0, 0);
    out = new THREE.CanvasTexture(c);
    out.colorSpace = raw.colorSpace;
    out.wrapS = raw.wrapS;
    out.wrapT = raw.wrapT;
  } catch {
    // keep the original map
  }
  MOON_SOFT.set(raw, out);
  return out;
}
let DETAIL_TEX = null;
function moonDetailTexture() {
  if (DETAIL_TEX) return DETAIL_TEX;
  const N = 256;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d");
  g.fillStyle = "rgb(128,128,128)";
  g.fillRect(0, 0, N, N);
  let s = 19;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  // Small craters (a dark floor, a bright sunward rim) and speckle, wrapping at the edges.
  for (let i = 0; i < 260; i++) {
    const x = r() * N;
    const y = r() * N;
    const rad = 1.5 + Math.pow(r(), 3) * 14;
    for (const [ox, oy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]]) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      gr.addColorStop(0, "rgba(70,70,70,0.55)");
      gr.addColorStop(0.75, "rgba(110,110,110,0.25)");
      gr.addColorStop(0.92, "rgba(190,190,190,0.45)");
      gr.addColorStop(1, "rgba(128,128,128,0)");
      g.fillStyle = gr;
      g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    }
  }
  for (let i = 0; i < 9000; i++) {
    const v = 100 + Math.floor(r() * 60);
    g.fillStyle = `rgba(${v},${v},${v},0.35)`;
    g.fillRect(r() * N, r() * N, 1, 1);
  }
  DETAIL_TEX = new THREE.CanvasTexture(c);
  DETAIL_TEX.wrapS = DETAIL_TEX.wrapT = THREE.RepeatWrapping;
  return DETAIL_TEX;
}

export function Moon({ position }) {
  const [raw] = useTexture([MOON_MAP]);
  const map = useMemo(() => softMoonMap(raw), [raw]);
  const gl = useThree((st) => st.gl);
  const mat = useRef();
  const detail = useMemo(() => ({ value: 0 }), []);
  useEffect(() => {
    // The close shots look across the surface at grazing angles: keep its detail there.
    // 4x is most of the gain; 16x cost a quarter of the frame in fill (measured).
    const n = gl.capabilities.getMaxAnisotropy();
    map.anisotropy = Math.min(4, n);
    map.needsUpdate = true;
    const d = moonDetailTexture();
    d.anisotropy = Math.min(2, n);
    d.needsUpdate = true;
  }, [map, gl]);
  const onBeforeCompile = useMemo(
    () => (shader) => {
      shader.uniforms.uDetail = detail;
      shader.uniforms.uDetailMap = { value: moonDetailTexture() };
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform sampler2D uDetailMap;\nuniform float uDetail;")
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
          #ifdef USE_MAP
            float dA = texture2D(uDetailMap, vMapUv * vec2(360.0, 180.0)).r;
            float dB = texture2D(uDetailMap, vMapUv * vec2(1500.0, 750.0)).r;
            diffuseColor.rgb *= mix(1.0, 0.55 + 0.9 * (dA * 0.6 + dB * 0.4), uDetail);
          #endif`
        );
    },
    [detail]
  );
  useFrame(({ camera }) => {
    // Relief from the bump map at a distance; close to the surface the bumps of a
    // magnified 1k map turn blocky, so they fade out as the regolith detail fades in.
    if (!mat.current) return;
    const d = camera.position.distanceTo(_mc.set(position[0], position[1], position[2])) / MOON_UNITS;
    mat.current.bumpScale = 0.05 * Math.min(1, Math.max(0.06, (d - 1.2) / 0.8));
    detail.value = 1 - Math.min(1, Math.max(0, (d - 1.25) / 0.45));
  });
  return (
    <mesh position={position} quaternion={MOON_QUATERNION}>
      <sphereGeometry args={[MOON_UNITS, 160, 120]} />
      <meshStandardMaterial ref={mat} map={map} roughness={1} metalness={0} bumpMap={map} bumpScale={0.05} onBeforeCompile={onBeforeCompile} />
    </mesh>
  );
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
function OrbitGuides({ clock, moonPos }) {
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
      <mesh position={[site[0] + LZ_UP[0] * 0.002, site[1] + LZ_UP[1] * 0.002, site[2] + LZ_UP[2] * 0.002]} quaternion={RING_QUATERNION}>
        <ringGeometry args={[0.035, 0.045, 48]} />
        <meshBasicMaterial ref={ringMat} color="#FF3B00" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function buildLeg(t0, t1, steps) {
  const pts = [];
  const tmp = [0, 0, 0];
  for (let i = 0; i <= steps; i++) {
    craftScenePos(t0 + (i / steps) * (t1 - t0), tmp);
    pts.push(new THREE.Vector3(tmp[0], tmp[1], tmp[2]));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

// Outbound + return legs only — the dense lunar-orbit loops would read as scribble
function TrajectoryPath({ viewRef }) {
  const group = useRef();
  const [outbound, inbound] = useMemo(() => [buildLeg(0, 270000, 220), buildLeg(504000, 702000, 140)], []);
  useFrame(() => {
    // Not while the camera rides with the spacecraft: the path would run through the lens.
    if (group.current) group.current.visible = !viewRef.current.vehicle;
  });
  return (
    <group ref={group}>
      <line geometry={outbound}>
        <lineBasicMaterial color="#FF3B00" transparent opacity={0.3} />
      </line>
      <line geometry={inbound}>
        <lineBasicMaterial color="#FF3B00" transparent opacity={0.3} />
      </line>
    </group>
  );
}

/* ---- the spacecraft layer (metres, vehicle frame) ----------------------------------------- */
const _sunV = new THREE.Vector3();
/**
 * Lights and the spacecraft, for a scene rendered with its own camera over the
 * planets (see Composite). viewRef.current carries the shot: { vehicle, sunV,
 * focus, stack, yaw, yawRcs, sps }. Shared with the title loop (components/opening/TitleLoop).
 */
export function VehicleLayer({ viewRef, lm = true }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const sun = useRef();
  const target = useRef();
  const group = useRef();
  const yawGroup = useRef();
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
    stackState.current.sps = v.sps || 0;
    // The stack turned about the local vertical through its middle (engine first for the burn).
    if (yawGroup.current) yawGroup.current.rotation.y = v.yaw || 0;
    _sunV.set(v.sunV[0], v.sunV[1], v.sunV[2]);
    if (target.current) target.current.position.set(v.focus[0], v.focus[1], v.focus[2]);
    if (sun.current && target.current) sun.current.position.copy(_sunV).multiplyScalar(60).add(target.current.position);
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
        <group ref={yawGroup} position={[STACK.mid, 0, 0]}>
          <group position={[-STACK.mid, 0, 0]} rotation={STACK_ROTATION}>
            <SpacecraftStack stateRef={stackState} lm={lm} shadows />
          </group>
        </group>
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
const _dp = new THREE.Vector3();
const _dl = new THREE.Vector3();
const _S = new THREE.Vector3();
const _M = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _origin = new THREE.Vector3(0, 0, 0);

export { LM_CENTRE_X };

function Director({ missionTime, cinematic, scPos, moonPos, orbitClock, viewRef }) {
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
    v.sps = 0;
    v.only = null;

    if (orbitClock) {
      // ---- Lunar orbit: data/orbitSequence (insertion burn, the docked stack, undocking, title) ----
      const tau = orbitClock.current;
      const pose = craftPose(tau, moonPos, MOON_UNITS);
      const { shot, u } = orbitShotAt(tau);
      v.shot = shot.id;
      v.stack = undocking(undockTime(tau));
      if (shot.wide) {
        const cam = orbitCamera(tau, moonPos, MOON_UNITS);
        camera.position.set(...cam.pos);
        camera.lookAt(...cam.look);
        camera.updateProjectionMatrix();
        v.glint = true;
        v.origin = pose.pos;
      } else {
        const frame = vehicleFrame(pose.fwd, pose.up);
        v.yaw = shot.yaw || 0;
        if (shot.id === "loi") v.sps = spsLevel(tau);
        v.focus = shot.follow === "lm" ? [LM_CENTRE_X + v.stack.lmY, 0, 0] : [2, 0, 0];
        vehicleView(v, frame, pose.pos, orbitShotCamera(shot, u, v.stack.lmY), camera);
      }
      snap.current = true;
      return;
    }

    const t = missionTime;
    _S.set(scPos[0], scPos[1], scPos[2]);
    _M.set(moonPos[0], moonPos[1], moonPos[2]);
    v.origin = scPos;

    // ---- From TLI to lunar orbit, and leaving the Moon: close on the spacecraft ----
    // The planet behind it is seen at its true apparent size (the planets are
    // drawn 10x oversized for the Earth-Moon views, so the planet camera stands
    // back by the same factor): the Earth only shrinks, the Moon only grows.
    const outbound = t <= CISLUNAR.los;
    const returnClose = t >= 504000 && t < RETURN_CLOSE_END;
    if (outbound || returnClose) {
      let frame;
      let origin;
      let cam;
      if (outbound) {
        const { id, u } = coastShotAt(t);
        if (id === "approach") {
          // The Moon behind the stack, seen from the side the lunar-orbit shots look at.
          frame = radialFrame(APPROACH_RAY);
          const d = trueSizeDistance(MOON_UNITS, approachMoonKm(u), MOON_RADIUS_KM);
          origin = [moonPos[0] + frame.z[0] * d, 0, moonPos[2] + frame.z[2] * d];
          cam = approachCloseCamera(u);
          // Only the Moon: from the spacecraft the Earth is behind the camera (the map-scale
          // Earth, drawn 10x oversized, must not appear beside it).
          v.only = "moon";
          const turn = approachYaw(u);
          v.yaw = turn.yaw;
          v.yawRcs = turn.rcs;
          v.shot = "approachClose";
        } else {
          frame = radialFrame([scPos[0], scPos[1], scPos[2]]);
          const d = trueSizeDistance(EARTH_UNITS, coastDistanceKm(t), EARTH_RADIUS_KM);
          origin = [frame.z[0] * d, 0, frame.z[2] * d];
          cam = id === "depart" ? cruiseCamera(smooth01(u)) : deepCamera(u);
          v.only = "earth"; // the Moon is ahead, out of this view
          v.shot = id === "depart" ? "cruiseClose" : "deepSpace";
        }
      } else {
        const away = [scPos[0] - moonPos[0], 0, scPos[2] - moonPos[2]];
        frame = radialFrame(away);
        const d = trueSizeDistance(MOON_UNITS, returnDistanceKm(t), MOON_RADIUS_KM);
        origin = [moonPos[0] + frame.z[0] * d, 0, moonPos[2] + frame.z[2] * d];
        cam = returnCamera(smooth01((t - 504000) / (RETURN_CLOSE_END - 504000)));
        v.shot = "returnClose";
      }
      v.stack = undocking(COAST);
      v.focus = [0, 0, 0];
      vehicleView(v, frame, origin, cam, camera);
      snap.current = true;
      return;
    }

    v.glint = true;
    v.shot = "wide";
    if (t < 620000) {
      // Return: looking back at the receding Moon, then home
      const u = smooth01((t - 504000) / 90000);
      _dp.set(_S.x + 0.8, _S.y + 0.4, _S.z + 0.9);
      _dl.lerpVectors(_M, _origin, u);
    } else if (t < 702000) {
      // Earth approach
      _dir.copy(_S).normalize();
      _dp.copy(_S).addScaledVector(_dir, 1.1).add(_tmp.set(0, 0.5, 0));
      _dl.copy(_origin);
    } else {
      // Splashdown framing
      _dp.set(5.0, 1.6, 4.6);
      _dl.copy(_origin);
    }

    if (snap.current) {
      pos.current.copy(_dp);
      look.current.copy(_dl);
      snap.current = false;
    } else {
      const k = Math.min(1, delta * 1.1);
      pos.current.lerp(_dp, k);
      look.current.lerp(_dl, k);
    }
    camera.position.copy(pos.current);
    camera.lookAt(look.current);
    camera.updateProjectionMatrix();
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
    const v = viewRef.current;
    w.shot = v.shot;
    w.vehicle = v.vehicle;
    w.stack = v.stack ? { gap: +v.stack.gap.toFixed(3), lmRoll: +v.stack.lmRoll.toFixed(3), phase: v.stack.phase } : null;
    w.yaw = v.yaw || 0;
    w.sps = v.sps || 0;
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

function Scene({ missionTime, cinematic, orbitClock }) {
  const t = orbitClock ? ORBIT_EPOCH : missionTime;
  const scPos = craftScenePos(t, [0, 0, 0]);
  const p = trajectoryPosition(t);
  const moonPos = useMemo(() => [p.moonX * SCENE_SCALE, 0, p.moonZ * SCENE_SCALE], [p.moonX, p.moonZ]);
  const viewRef = useRef({ vehicle: false, glint: false, origin: [0, 0, 0], stack: undocking(COAST), focus: [0, 0, 0], sunV: [0, 1, 0] });
  const vScene = useMemo(() => new THREE.Scene(), []);
  const vCam = useMemo(() => new THREE.PerspectiveCamera(45, 1, 0.1, 4000), []);
  // The lunar module flies out docked and stays on the Moon: the way home is the CSM alone.
  const lmAboard = !!orbitClock || missionTime < 504000;
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
        <Moon position={moonPos} />
      </group>
      <Glint viewRef={viewRef} />
      {orbitClock ? <OrbitGuides clock={orbitClock} moonPos={moonPos} /> : <TrajectoryPath viewRef={viewRef} />}
      {!cinematic && <OrbitControls enablePan={false} enableZoom={true} minDistance={2} maxDistance={60} dampingFactor={0.06} />}
      <Director missionTime={missionTime} cinematic={cinematic} scPos={scPos} moonPos={moonPos} orbitClock={orbitClock} viewRef={viewRef} />
      {/* after the Director: this frame's shot decides which planets are drawn */}
      <PlanetFilter viewRef={viewRef} earth={earthGroup} moon={moonGroup} />
      {createPortal(<VehicleLayer viewRef={viewRef} lm={lmAboard} />, vScene)}
      <Composite vScene={vScene} vCam={vCam} viewRef={viewRef} />
    </>
  );
}

function LoadingFallback() {
  return null;
}

/**
 * missionTime drives the cruise and return shots. orbitClock (a ref holding
 * seconds since lunar orbit began) switches to the lunar-orbit presentation
 * used before the descent; keep the same element mounted across the switch
 * so the camera hands over without a cut.
 */
export default function MissionScene({ missionTime, cinematic = false, orbitClock = null }) {
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
          <Scene missionTime={missionTime} cinematic={cinematic} orbitClock={orbitClock} />
        </Suspense>
        {/* Stars outside the texture suspense so deep space never goes blank */}
        <Stars radius={100} depth={50} count={8000} factor={3.5} saturation={0} fade speed={0.1} />
        <AdaptiveResolution />
      </Canvas>
    </div>
  );
}
