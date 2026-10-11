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
import {
  MOON_ROTATION,
  ORBIT,
  craftPose,
  landingSite,
  orbitCamera,
  smoother,
  WEST,
} from "@/data/lunarOrbitShot";

// Public-domain planet textures hosted by three.js examples.
const EARTH_MAP = process.env.PUBLIC_URL + "/textures/planets/earth_atmos_2048.jpg";
const EARTH_NORMAL = process.env.PUBLIC_URL + "/textures/planets/earth_normal_2048.jpg";
const EARTH_SPEC = process.env.PUBLIC_URL + "/textures/planets/earth_specular_2048.jpg";
const EARTH_CLOUDS = process.env.PUBLIC_URL + "/textures/planets/earth_clouds_1024.png";
const MOON_MAP = process.env.PUBLIC_URL + "/textures/planets/moon_1024.jpg";

const SCENE_SCALE = 20 / EARTH_MOON_DIST_KM;
const EARTH_UNITS = EARTH_RADIUS_KM * SCENE_SCALE * 10;
const MOON_UNITS = MOON_RADIUS_KM * SCENE_SCALE * 10;

const smooth01 = (x) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

// Map physical km distance to display radius: Earth is drawn 10x oversized,
// so the craft must hug the (exaggerated) surface in LEO and still arrive at
// the Moon's orbit ring during approach.
function displayRadius(rKm) {
  const R1 = EARTH_RADIUS_KM + 185;
  const R2 = 60000;
  const START = EARTH_UNITS + 0.12;
  const SPAN = 2.4;
  const END = 19.4;
  if (rKm <= R2) {
    return START + smooth01((rKm - R1) / (R2 - R1)) * SPAN;
  }
  const u = smooth01((rKm - R2) / (EARTH_MOON_DIST_KM - R2));
  return START + SPAN + u * (END - START - SPAN);
}

const _craft = [0, 0, 0];
function craftScenePos(t, out) {
  const p = trajectoryPosition(t);
  const mx = p.moonX * SCENE_SCALE;
  const mz = p.moonZ * SCENE_SCALE;
  // Lunar vicinity: orbit visibly around the Moon
  if (t >= 270000 && t < 504000) {
    const w = smooth01((t - 270000) / 6000);
    const ox = p.x - p.moonX;
    const oz = p.z - p.moonZ;
    const ol = Math.hypot(ox, oz) || 1;
    const orbR = MOON_UNITS * 1.6;
    const lx = mx + (ox / ol) * orbR;
    const lz = mz + (oz / ol) * orbR;
    const dir = Math.atan2(p.z, p.x);
    const r = displayRadius(Math.hypot(p.x, p.z));
    out[0] = (1 - w) * Math.cos(dir) * r + w * lx;
    out[1] = 0;
    out[2] = (1 - w) * Math.sin(dir) * r + w * lz;
    return out;
  }
  const dir = Math.atan2(p.z, p.x);
  const r = displayRadius(Math.hypot(p.x, p.z));
  out[0] = Math.cos(dir) * r;
  out[1] = 0;
  out[2] = Math.sin(dir) * r;
  return out;
}

// Main-engine burn windows (TLI / LOI / TEI) — cruise is coast + barbecue roll
function isBurning(t) {
  return (
    (t >= 9840 && t < 12000) ||
    (t >= 270000 && t < 290000) ||
    (t >= 504000 && t < 506000)
  );
}

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
          shininess={22}
          specular={new THREE.Color("#557799")}
        />
      </mesh>

      {/* Clouds */}
      <mesh ref={cloudRef}>
        <sphereGeometry args={[EARTH_UNITS * 1.012, 96, 96]} />
        <meshPhongMaterial
          map={cloudMap}
          transparent
          opacity={0.75}
          depthWrite={false}
        />
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
// turns by only half a degree per hour): the landing site faces world +Y with
// the Sun low in its east. See data/lunarOrbitShot.js.
const MOON_QUATERNION = (() => {
  const m = MOON_ROTATION;
  const m4 = new THREE.Matrix4().set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
  return new THREE.Quaternion().setFromRotationMatrix(m4);
})();

function Moon({ position }) {
  const [map] = useTexture([MOON_MAP]);
  return (
    <mesh position={position} quaternion={MOON_QUATERNION}>
      <sphereGeometry args={[MOON_UNITS, 96, 96]} />
      <meshStandardMaterial
        map={map}
        roughness={1}
        metalness={0}
        bumpMap={map}
        bumpScale={0.05}
      />
    </mesh>
  );
}

function Spacecraft({ missionTime, cinematic }) {
  const ref = useRef();
  useFrame(() => {
    if (ref.current) {
      craftScenePos(missionTime, _craft);
      ref.current.position.set(_craft[0], _craft[1], _craft[2]);
    }
  });
  return (
    <group ref={ref}>
      <SpacecraftModel scale={cinematic ? 1.3 : 1.2} glow={isBurning(missionTime)} />
    </group>
  );
}

/*
 * Lunar orbit before the descent: the craft flies its orbit over the fixed
 * Moon, nose along its flight path, with a slow roll. On entering orbit it
 * glides in from where the cruise shot left it (no pop).
 */
const _q = new THREE.Quaternion();
const _basis = new THREE.Matrix4();
const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();
function OrbitingCraft({ clock, moonPos, from }) {
  const ref = useRef();
  const spin = useRef(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const tau = clock.current;
    const p = craftPose(tau, moonPos, MOON_UNITS);
    const u = smoother(tau / ORBIT.handover);
    const start = from.current || p.pos;
    g.position.set(start[0] + (p.pos[0] - start[0]) * u, start[1] + (p.pos[1] - start[1]) * u, start[2] + (p.pos[2] - start[2]) * u);
    _bx.set(p.fwd[0], p.fwd[1], p.fwd[2]);
    _by.set(p.up[0], p.up[1], p.up[2]);
    _bz.crossVectors(_bx, _by);
    _basis.makeBasis(_bx, _by, _bz);
    _q.setFromRotationMatrix(_basis);
    g.quaternion.copy(_q);
    if (spin.current) spin.current.rotation.x = tau * 0.08; // slow thermal roll about the long axis
  });
  return (
    <group ref={ref}>
      <group ref={spin}>
        <SpacecraftModel scale={0.3} glow={false} roll={0} />
      </group>
    </group>
  );
}

/** Landing site on the surface and the orbit path; both fade back as the camera settles. */
function OrbitGuides({ clock, moonPos }) {
  const ring = useRef();
  const orbitMat = useRef();
  const ringMat = useRef();
  const site = useMemo(() => landingSite(moonPos, MOON_UNITS), [moonPos]);
  const orbitLine = useMemo(() => {
    const r = MOON_UNITS * (1 + ORBIT.altitude);
    const pts = [];
    for (let i = 0; i <= 160; i++) {
      const a = (i / 160) * Math.PI * 2;
      pts.push(new THREE.Vector3(
        moonPos[0] + r * (Math.sin(a) * WEST[0]),
        moonPos[1] + r * Math.cos(a),
        moonPos[2] + r * (Math.sin(a) * WEST[2])
      ));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [moonPos]);
  useEffect(() => () => orbitLine.dispose(), [orbitLine]);
  useFrame((state) => {
    const tau = clock.current;
    const settle = smoother((tau - ORBIT.settleStart) / (ORBIT.settleEnd - ORBIT.settleStart));
    if (orbitMat.current) orbitMat.current.opacity = 0.28 * (1 - settle) * smoother(tau / 1.5);
    if (ringMat.current) ringMat.current.opacity = (0.55 + 0.25 * Math.sin(state.clock.elapsedTime * 2.2)) * smoother((tau - 1) / 2);
    if (ring.current) ring.current.scale.setScalar(1 - 0.35 * settle);
  });
  return (
    <group>
      <line geometry={orbitLine}>
        <lineBasicMaterial ref={orbitMat} color="#FF3B00" transparent opacity={0} depthWrite={false} />
      </line>
      <mesh ref={ring} position={[site[0], site[1] + 0.002, site[2]]} rotation={[-Math.PI / 2, 0, 0]}>
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
function TrajectoryPath() {
  const [outbound, inbound] = useMemo(
    () => [buildLeg(0, 270000, 220), buildLeg(504000, 702000, 140)],
    []
  );
  return (
    <group>
      <line geometry={outbound}>
        <lineBasicMaterial color="#FF3B00" transparent opacity={0.3} />
      </line>
      <line geometry={inbound}>
        <lineBasicMaterial color="#FF3B00" transparent opacity={0.3} />
      </line>
    </group>
  );
}

const _dp = new THREE.Vector3();
const _dl = new THREE.Vector3();
const _S = new THREE.Vector3();
const _M = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _origin = new THREE.Vector3(0, 0, 0);

function CinematicCamera({ missionTime, cinematic, scPos, moonPos, orbitClock }) {
  const { camera } = useThree();
  const pos = useRef(new THREE.Vector3(0, 12, 28));
  const look = useRef(new THREE.Vector3(0, 0, 0));
  const snap = useRef(true);
  const orbitFrom = useRef(null); // camera pose when lunar orbit began (for a seamless hand-over)

  useFrame((state, delta) => {
    if (!cinematic) return;
    if (orbitClock) {
      // Lunar orbit: the shot is fully defined by data/lunarOrbitShot (no
      // extra smoothing); the first seconds blend from wherever the cruise
      // camera was (ORBIT.handover), or start settled when the scene mounts mid-orbit.
      const tau = orbitClock.current;
      const shot = orbitCamera(tau, moonPos, MOON_UNITS);
      if (!orbitFrom.current) {
        orbitFrom.current = snap.current || tau > ORBIT.handover
          ? { pos: shot.pos, look: shot.look }
          : { pos: pos.current.toArray(), look: look.current.toArray() };
        snap.current = false;
      }
      const u = smoother(tau / ORBIT.handover);
      const f = orbitFrom.current;
      pos.current.set(...f.pos).lerp(_tmp.set(...shot.pos), u);
      look.current.set(...f.look).lerp(_tmp.set(...shot.look), u);
      camera.up.set(0, 1, 0);
      camera.position.copy(pos.current);
      camera.lookAt(look.current);
      return;
    }
    orbitFrom.current = null;
    const t = missionTime;
    _S.set(scPos[0], scPos[1], scPos[2]);
    _M.set(moonPos[0], moonPos[1], moonPos[2]);

    if (t < 9840) {
      // LEO: close over the limb
      _dp.copy(_S).multiplyScalar(1.25).add(_tmp.set(0.4, 0.6, 0.5));
      _dl.copy(_S);
    } else if (t < 55000) {
      // Translunar departure: chase the craft, Earth receding behind
      const u = smooth01((t - 9840) / 45160);
      _dp.copy(_S)
        .multiplyScalar(1.2 + u * 0.4)
        .add(_tmp.set(0.4, 0.6 + u * 0.5, 0.5));
      _dl.lerpVectors(_origin, _S, 0.3);
    } else if (t < 130000) {
      // Deep cruise: off-shoulder shot, Earth shrinking in black space
      const a = (t - 55000) * 0.00004;
      _dp.set(
        _S.x + Math.cos(a) * 0.85,
        _S.y + 0.4,
        _S.z + Math.sin(a) * 0.85
      );
      _dl.copy(_origin);
    } else if (t < 200000) {
      // Solitude pan: look slowly swings from Earth to the distant Moon
      const u = smooth01((t - 130000) / 70000);
      _dp.set(_S.x + 0.8, _S.y + 0.35, _S.z + 0.9);
      _dl.lerpVectors(_origin, _M, u);
    } else if (t < 273360) {
      // Lunar approach: behind the craft, the Moon fills the frame
      _dir.copy(_M).sub(_S).normalize();
      _dp.copy(_S).addScaledVector(_dir, -1.1).add(_tmp.set(0, 0.45, 0));
      _dl.copy(_M);
    } else if (t < 504000) {
      // Lunar orbit: slow drift around the Moon
      const a = t * 0.015;
      _dp.set(_M.x + Math.sin(a) * 2.9, 1.2, _M.z + Math.cos(a) * 2.9);
      _dl.copy(_M).lerp(_S, 0.25);
    } else if (t < 620000) {
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
  // Where the cruise left the craft, so it glides into orbit instead of
  // popping there. (At the very end of the approach the cruise path passes
  // inside the Moon's drawn sphere; start from just above its surface.)
  const lastCruise = useRef(null);
  const craftFrom = useRef(null);
  if (!orbitClock) {
    lastCruise.current = scPos;
    craftFrom.current = null;
  } else if (!craftFrom.current && lastCruise.current && orbitClock.current < 0.5) {
    const c = lastCruise.current;
    const d = [c[0] - moonPos[0], c[1] - moonPos[1], c[2] - moonPos[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    const r = Math.max(l, MOON_UNITS * 1.25);
    craftFrom.current = [moonPos[0] + (d[0] / l) * r, moonPos[1] + (d[1] / l) * r, moonPos[2] + (d[2] / l) * r];
  }

  return (
    <>
      {/* Deep space ambient — near zero for a hard terminator */}
      <ambientLight intensity={0.02} />
      {/* Faint starlight fill so the hull never turns into a void */}
      <hemisphereLight args={["#24344c", "#050505", 0.3]} />
      {/* Sun — positioned so departure shows a receding gibbous Earth and the
          approach a growing crescent Moon (Apollo-style phase language) */}
      <directionalLight
        position={[30, 10, -20]}
        intensity={3.4}
        color="#ffffff"
        castShadow={false}
      />
      {/* Faint cool fill on the night side */}
      <directionalLight position={[-20, -5, 25]} intensity={0.1} color="#3a5a8a" />
      <Earth />
      <Moon position={moonPos} />
      {orbitClock ? (
        <>
          <OrbitingCraft clock={orbitClock} moonPos={moonPos} from={craftFrom} />
          <OrbitGuides clock={orbitClock} moonPos={moonPos} />
        </>
      ) : (
        <>
          <Spacecraft missionTime={missionTime} cinematic={cinematic} />
          <TrajectoryPath />
        </>
      )}
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
        scPos={scPos}
        moonPos={moonPos}
        orbitClock={orbitClock}
      />
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
      </Canvas>
    </div>
  );
}
