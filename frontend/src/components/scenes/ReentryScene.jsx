import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import { useRef, useMemo, useEffect } from "react";
import * as THREE from "three";
import { R_EARTH, CAPSULE, OUTCOME } from "@/data/reentryPhysics";
import { PlanetEarth } from "@/components/planets/Planets";
import { plasmaLevel } from "@/data/reentryGuidance";
import CsmModel, { csmMaterials } from "@/components/spacecraft/CsmModel";
import { CM_R, PARTS as CSM_PARTS, buildCM } from "@/data/csmDesign";
import { SM_SEP, smOffset } from "@/data/earthReturn";
import { CONFIRM, DROGUE_DRIFT_M, ENTRY_SIDE, FLOAT, M_PER_UNIT, chuteCamera, lowWorldFade, recoveryCamera, seaLevelY, seaSurface, splashBob } from "@/data/descentScene";
import Ocean from "@/components/scenes/descent/Ocean";
import CloudField, { CloudPass, cloudShadowMap, noiseTexture } from "@/components/scenes/descent/CloudField";
import Splash from "@/components/scenes/descent/Splash";
import Chutes from "@/components/scenes/descent/Chutes";
import AdaptiveResolution from "@/components/scenes/AdaptiveResolution";

/*
 * ReentryScene — rendered entirely from the live reentry simulation state
 * (simRef) plus presentation state (viewRef: phase, timers). Nothing here
 * advances physics; plasma, sky, Earth, chutes and ocean read the state.
 *
 * Scene frame: capsule at the origin, local vertical +Y, flight to -X.
 * Capsule diameter = 1 unit (3.9 m).
 */


const EARTH_RS = 400; // scene radius of the Earth sphere (altitude scaled 1:1 in angle)
const DEG = Math.PI / 180;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};


/* ------------------------------ helpers ------------------------------ */

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

function velocityDir(s, out) {
  // Flight toward -X; gamma < 0 descending.
  return out.set(-Math.cos(s.gamma), Math.sin(s.gamma), 0).normalize();
}


/* ------------------------------- capsule ------------------------------- */

// The expedition's own command and service module (data/csmDesign), in capsule
// units: diameter 1 = 3.9 m. Same geometry as at launch and in lunar orbit; the
// reentry gives the command module its own materials (heat-shield glow, fade).
const CAPSULE_SCALE = 1 / (2 * CM_R);

function CapsuleModel({ shieldMatRef, bodyOpacityRef }) {
  const geo = useMemo(() => buildCM({ probe: false }), []);
  const shieldMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#3b2f27",
        roughness: 0.92,
        metalness: 0.05,
        emissive: new THREE.Color("#ff5a14"),
        emissiveIntensity: 0,
        transparent: true,
      }),
    []
  );
  // The CSM's silver skin with its panel seams, a little less metallic here: the
  // reentry has no environment map to reflect.
  const bodyMat = useMemo(() => {
    const m = csmMaterials().cmSkin.clone();
    m.metalness = 0.55;
    m.roughness = 0.38;
    m.transparent = true;
    return m;
  }, []);
  const metalMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#c9ccd2", roughness: 0.38, metalness: 0.5, transparent: true }), []);
  const darkMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#121416", roughness: 0.4, metalness: 0.3, transparent: true }), []);
  const bandMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#FF3B00", roughness: 0.5, metalness: 0.2, transparent: true }), []);
  useEffect(() => {
    shieldMatRef.current = shieldMat;
    bodyOpacityRef.current = [shieldMat, bodyMat, metalMat, darkMat, bandMat];
  }, [shieldMat, bodyMat, metalMat, darkMat, bandMat, shieldMatRef, bodyOpacityRef]);

  const byPart = { shield: shieldMat, cmSkin: bodyMat, metal: metalMat, black: darkMat, glass: darkMat, accent: bandMat };
  return (
    <group scale={CAPSULE_SCALE}>
      {CSM_PARTS.filter((p) => geo[p]).map((p) => (
        <mesh key={p} geometry={geo[p]} material={byPart[p] || bodyMat} />
      ))}
    </group>
  );
}

// Service module (approach only) — the same SM as at launch and in lunar orbit. At ENTRY
// PREP it separates: it backs away along its own axis (behind the capsule, which flies
// on), drifting a little down and away from the camera, faster as the shot compresses
// time, and leaves the frame (data/earthReturn smOffset). It is never swapped or popped.
const _smOff = new THREE.Vector3();
const _smo = [0, 0, 0];
function ServiceModule({ viewRef, smQuatRef }) {
  const ref = useRef();
  useFrame(() => {
    if (!ref.current) return;
    const v = viewRef.current;
    const sep = v.phase === "APPROACH" ? 0 : v.sepT || 0;
    ref.current.visible = v.phase === "APPROACH" || ((v.phase === "PREP" || v.phase === "ENTRY") && sep < SM_SEP.gone);
    // SM keeps its approach attitude and backs away along its own axis after separation.
    ref.current.quaternion.copy(smQuatRef.current);
    smOffset(sep, _smo);
    _smOff.set(_smo[0], _smo[1], _smo[2]).applyQuaternion(smQuatRef.current);
    ref.current.position.copy(_smOff);
  });
  return (
    <group ref={ref}>
      <group scale={CAPSULE_SCALE}>
        <CsmModel cm={false} />
      </group>
    </group>
  );
}

/* ------------------------------- plasma ------------------------------- */

const NOISE_GLSL = `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`;

// Colour ramp shared by shock and wake: faint violet ionization -> orange -> white-yellow at peak.
const RAMP_GLSL = `
  vec3 plasmaColor(float k) {
    vec3 ion = vec3(0.55, 0.45, 1.0);
    vec3 orange = vec3(1.0, 0.45, 0.12);
    vec3 hot = vec3(1.0, 0.88, 0.62);
    return k < 0.35 ? mix(ion, orange, k / 0.35) : mix(orange, hot, clamp((k - 0.35) / 0.65, 0.0, 1.0));
  }
`;

function ShockLayer({ levelRef }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        forceSinglePass: true,
        uniforms: { uLevel: { value: 0 }, uTime: { value: 0 } },
        vertexShader: `
          varying vec3 vN; varying vec3 vP;
          void main() { vN = normalize(normalMatrix * normal); vP = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `
          uniform float uLevel; uniform float uTime; varying vec3 vN; varying vec3 vP;
          ${NOISE_GLSL} ${RAMP_GLSL}
          void main() {
            // vP.y < 0 is upstream; stagnation region is the cap centre.
            float r = length(vP.xz) / 0.62;
            float core = pow(1.0 - clamp(r, 0.0, 1.0), 2.2);
            float rim = smoothstep(0.6, 1.0, r) * (1.0 - smoothstep(1.0, 1.1, r));
            float flick = 0.8 + 0.2 * noise(vec2(atan(vP.z, vP.x) * 4.0, uTime * 7.0));
            float a = (core * 0.75 + rim * 0.22 + 0.06) * uLevel * flick;
            gl_FragColor = vec4(plasmaColor(clamp(uLevel * (0.45 + 0.55 * core), 0.0, 1.0)) * a, a);
          }`,
      }),
    []
  );
  useFrame((state) => {
    mat.uniforms.uLevel.value = levelRef.current;
    mat.uniforms.uTime.value = state.clock.elapsedTime;
  });
  // Bow shock cap stands off ahead of the heat shield (upstream = -Y in the flow frame).
  return (
    <mesh position={[0, -0.14, 0]} rotation={[Math.PI, 0, 0]} scale={[0.92, 0.5, 0.92]} material={mat}>
      <sphereGeometry args={[0.62, 40, 16, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
    </mesh>
  );
}

function Wake({ levelRef, radius, length, strength, streak }) {
  const ref = useRef();
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        forceSinglePass: true,
        uniforms: { uLevel: { value: 0 }, uTime: { value: 0 }, uStrength: { value: strength }, uStreak: { value: streak } },
        vertexShader: `
          varying vec2 vUv; varying vec3 vN; varying vec3 vView;
          void main() { vUv = uv; vN = normalize(normalMatrix * normal);
            vec4 mv = modelViewMatrix * vec4(position, 1.0); vView = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `
          uniform float uLevel; uniform float uTime; uniform float uStrength; uniform float uStreak;
          varying vec2 vUv; varying vec3 vN; varying vec3 vView;
          ${NOISE_GLSL} ${RAMP_GLSL}
          void main() {
            float along = 1.0 - vUv.y;           // 1 at the capsule, 0 far downstream
            float edge = pow(abs(dot(vN, vView)), 0.8);
            float streaks = noise(vec2(vUv.x * uStreak, along * 6.0 + uTime * 9.0));
            float body = pow(along, 1.8) * (0.55 + 0.45 * streaks) * smoothstep(1.0, 0.88, along);
            float a = body * edge * uLevel * uStrength;
            vec3 col = plasmaColor(clamp(uLevel * along, 0.0, 1.0));
            col = mix(col, vec3(0.85, 0.32, 0.55), (1.0 - along) * 0.35);
            gl_FragColor = vec4(col * a, a);
          }`,
      }),
    [strength, streak]
  );
  useFrame((state) => {
    const L = levelRef.current;
    mat.uniforms.uLevel.value = L;
    mat.uniforms.uTime.value = state.clock.elapsedTime;
    if (ref.current) {
      const len = length * (0.25 + 0.75 * Math.min(1, L));
      ref.current.visible = L > 0.01;
      ref.current.scale.set(1, len, 1);
      // Wake begins just behind the apex; the sheath covers the flow along the afterbody.
      ref.current.position.y = 0.7 + len / 2;
    }
  });
  // Downstream = +Y in the flow frame. Cone apex far downstream.
  return (
    <mesh ref={ref} material={mat}>
      <cylinderGeometry args={[radius * 0.25, radius, 1, 32, 1, true]} />
    </mesh>
  );
}

const SPARKS = 180;
function AblationSparks({ levelRef }) {
  const { geo, mat } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const seed = new Float32Array(SPARKS * 3);
    for (let i = 0; i < SPARKS; i++) {
      seed[i * 3] = Math.random() * Math.PI * 2;
      seed[i * 3 + 1] = Math.random();
      seed[i * 3 + 2] = 0.5 + Math.random();
    }
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 3));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uLevel: { value: 0 } },
      vertexShader: `
        attribute vec3 aSeed; uniform float uTime; uniform float uLevel; varying float vA;
        void main() {
          float life = fract(aSeed.y + uTime * 0.9 * aSeed.z);
          float ang = aSeed.x;
          vec3 p = vec3(cos(ang) * (0.5 + life * 0.5), 0.02 + life * (1.2 + 5.0 * uLevel) * aSeed.z, sin(ang) * (0.5 + life * 0.5));
          vA = (1.0 - life) * clamp(uLevel * 1.4 - 0.25, 0.0, 1.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (3.0 + 5.0 * (1.0 - life)) * (4.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA;
        void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
          gl_FragColor = vec4(vec3(1.0, 0.72, 0.35) * vA, vA * (1.0 - d * 2.0)); }`,
    });
    return { geo: g, mat: m };
  }, []);
  useFrame((state) => {
    mat.uniforms.uTime.value = state.clock.elapsedTime;
    mat.uniforms.uLevel.value = levelRef.current;
  });
  return <points geometry={geo} material={mat} frustumCulled={false} />;
}

function PlasmaSheath({ levelRef }) {
  const ref = useRef();
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        forceSinglePass: true,
        uniforms: { uLevel: { value: 0 }, uTime: { value: 0 } },
        vertexShader: `
          varying vec2 vUv; varying vec3 vN; varying vec3 vView;
          void main() { vUv = uv; vN = normalize(normalMatrix * normal);
            vec4 mv = modelViewMatrix * vec4(position, 1.0); vView = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `
          uniform float uLevel; uniform float uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vView;
          ${NOISE_GLSL} ${RAMP_GLSL}
          void main() {
            float along = 1.0 - vUv.y;               // 1 at the shoulder, 0 behind the apex
            float edge = 1.0 - abs(dot(vN, vView));  // silhouette-bright: the body stays visible
            float streak = 0.6 + 0.4 * noise(vec2(vUv.x * 30.0, vUv.y * 5.0 - uTime * 10.0));
            float a = pow(edge, 2.2) * pow(along, 0.8) * streak * uLevel * 0.55;
            gl_FragColor = vec4(plasmaColor(clamp(uLevel * 0.85, 0.0, 1.0)) * a, a);
          }`,
      }),
    []
  );
  useFrame((state) => {
    mat.uniforms.uLevel.value = levelRef.current;
    mat.uniforms.uTime.value = state.clock.elapsedTime;
    if (ref.current) ref.current.visible = levelRef.current > 0.02;
  });
  return (
    <mesh ref={ref} position={[0, 0.55, 0]} material={mat}>
      <cylinderGeometry args={[0.34, 0.6, 1.1, 40, 1, true]} />
    </mesh>
  );
}

function ShoulderGlow({ levelRef }) {
  const ref = useRef();
  useFrame(() => {
    if (!ref.current) return;
    const L = levelRef.current;
    ref.current.visible = L > 0.02;
    ref.current.material.opacity = Math.min(0.45, L * 0.45);
  });
  return (
    <mesh ref={ref} position={[0, 0.03, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[0.53, 0.035, 10, 48]} />
      <meshBasicMaterial color="#ffc27a" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
    </mesh>
  );
}

/* ------------------------------ environment ------------------------------ */

function SkyDome({ simRef, atmo }) {
  const mat = useRef();
  const uniforms = useMemo(() => ({ uTop: { value: new THREE.Color("#010103") }, uHor: { value: new THREE.Color("#04060c") }, uSun: { value: atmo.sun }, uGlow: { value: 0 } }), [atmo]);
  const cols = useMemo(
    () => ({
      topSpace: new THREE.Color("#010103"),
      horSpace: new THREE.Color("#04060c"),
      topHigh: new THREE.Color("#050b1f"),
      horHigh: new THREE.Color("#2a5aa8"),
      topLow: new THREE.Color("#2f67b4"),
      horLow: new THREE.Color("#aecbe3"),
      hazeLow: new THREE.Color("#a7bfd4"),
      top: new THREE.Color(),
      hor: new THREE.Color(),
    }),
    []
  );
  useFrame(() => {
    const s = simRef.current;
    if (!mat.current || !s) return;
    const h = s.h / 1000;
    const hi = smooth((85 - h) / 45); // 85 -> 40 km: space turns deep blue
    const lo = smooth((35 - h) / 25); // 35 -> 10 km: daylight sky
    cols.top.copy(cols.topSpace).lerp(cols.topHigh, hi).lerp(cols.topLow, lo);
    cols.hor.copy(cols.horSpace).lerp(cols.horHigh, hi).lerp(cols.horLow, lo);
    mat.current.uniforms.uTop.value.copy(cols.top);
    mat.current.uniforms.uHor.value.copy(cols.hor);
    mat.current.uniforms.uGlow.value = lo;
    // the sea and the clouds take the sky's own colours: one atmosphere
    atmo.top.copy(cols.top);
    atmo.hor.copy(cols.hor);
    atmo.haze.copy(cols.hor).lerp(cols.hazeLow, lo * 0.45);
  });
  return (
    <mesh renderOrder={-2} frustumCulled={false}>
      <sphereGeometry args={[900, 32, 16]} />
      <shaderMaterial
        ref={mat}
        side={THREE.BackSide}
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={`varying vec3 vD; void main(){ vD = position; vec4 p = modelViewMatrix * vec4(position,1.0); p.xyz += cameraPosition * 0.0; gl_Position = projectionMatrix * p;} `}
        fragmentShader={`uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSun; uniform float uGlow; varying vec3 vD;
          void main(){ vec3 d = normalize(vD); float y = d.y; float k = pow(clamp(y, 0.0, 1.0), 0.45);
            vec3 c = mix(uHor, uTop, k);
            // below the horizon: the haze over the sea (the sea itself is drawn over this)
            c = mix(c, uHor * 0.92, smoothstep(0.0, -0.08, y));
            // a soft brightening round the Sun (no flare)
            float sd = max(dot(d, uSun), 0.0);
            c += vec3(1.0, 0.93, 0.82) * (pow(sd, 6.0) * 0.16 + pow(sd, 64.0) * 0.35) * uGlow;
            gl_FragColor = vec4(c, 1.0); }`}
      />
    </mesh>
  );
}

/*
 * The descent's shared state, each frame before the rest of the scene (data/descentScene): how
 * much of the low world is drawn, where the sea's surface is below the capsule (so that the heat
 * shield touches the waves exactly when the simulation's altitude reaches zero), and how far the
 * ground has drifted by under it since the drogues opened (the sea and the clouds move together).
 */
function AtmoState({ simRef, viewRef, poseRef, atmo, final }) {
  const anchor = useRef(null);
  const lowAtSplash = useRef(null);
  useFrame(() => {
    const s = simRef.current;
    const v = viewRef.current;
    if (!s) return;
    const splashed = v.phase === "SPLASHED";
    atmo.low = splashed ? 1 : lowWorldFade(v.phase === "APPROACH" || v.phase === "PREP" ? 200e3 : s.h);
    if (s.drogueT !== null && anchor.current === null) anchor.current = s.s;
    if (s.drogueT === null && !splashed) anchor.current = null;
    atmo.drift = anchor.current === null ? 0 : -(s.s - anchor.current) / M_PER_UNIT;
    // the MISSION COMPLETE backdrop: the same place on the same sea, under the same clouds
    if (final) atmo.drift = -DROGUE_DRIFT_M / M_PER_UNIT;
    const low = poseRef.current ? poseRef.current.low : -0.11;
    if (splashed && lowAtSplash.current === null) lowAtSplash.current = low;
    if (!splashed) lowAtSplash.current = null;
    atmo.seaY = seaLevelY(s.h) + (lowAtSplash.current !== null ? lowAtSplash.current : low);
  });
  return null;
}

// The Sun of this scene (the directional light below): it lights the capsule and the Earth alike.
const REENTRY_SUN = [-6, 7, 5];
function OrbitalEarth({ simRef, viewRef }) {
  const group = useRef();
  const fade = useRef(1);
  const limb = useRef(1);
  useFrame(() => {
    const s = simRef.current;
    if (!group.current || !s) return;
    const v = viewRef.current;
    let h = s.h;
    if (v.phase === "APPROACH" || v.phase === "PREP") h = 120e3 + (v.approachAlt || 0);
    if (v.phase === "FAILED" && s.outcome === OUTCOME.SKIP_OUT) h = s.h + (v.failT || 0) * 6000;
    const hs = (EARTH_RS * h) / R_EARTH;
    group.current.position.set(0, -(EARTH_RS + hs), 0);
    group.current.rotation.z = -(s.s / R_EARTH) - 0.35;
    const vis = smooth((h / 1000 - 12) / 10);
    group.current.visible = vis > 0.01;
    fade.current = vis;
    // The limb glow is seen from outside the atmosphere only; inside it, the sky dome takes over.
    limb.current = smooth((hs - EARTH_RS * 0.018 - 0.3) / 2);
  });
  // The shared NASA Earth (components/planets), as in every other scene.
  return (
    <group ref={group}>
      <PlanetEarth radius={EARTH_RS} sun={REENTRY_SUN} rotation={[0.4, 0, 0]} cloudDrift={0.0002} segments={160} opacityRef={fade} limbRef={limb} />
    </group>
  );
}

/* ------------------------------ vehicle rig ------------------------------ */

const DEBRIS = [
  [0.6, 0.2, 0.3],
  [0.4, -0.25, -0.35],
  [0.8, 0.05, -0.1],
];

// The heat shield's lowest points in the capsule's frame: the centre of the shield and its rim.
const SHIELD_PTS = [[0, FLOAT.shieldBottomY, 0], ...Array.from({ length: 16 }, (_, i) => [Math.cos((i / 16) * Math.PI * 2) * FLOAT.rimR, 0.04, Math.sin((i / 16) * Math.PI * 2) * FLOAT.rimR])];
const _lp = new THREE.Vector3();

function Vehicle({ simRef, viewRef, poseRef, atmo }) {
  const attitude = useRef();
  const flow = useRef();
  const light = useRef();
  const debris = useRef([]);
  const levelRef = useRef(0);
  const shieldMatRef = useRef(null);
  const mats = useRef([]);
  const upright = useRef(0);
  const smQuatRef = useRef(new THREE.Quaternion());
  const vdir = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, dt) => {
    const s = simRef.current;
    const v = viewRef.current;
    if (!s || !attitude.current) return;
    const t = state.clock.elapsedTime;

    // Plasma level straight from the simulated heat rate
    let L = v.phase === "ENTRY" || v.phase === "FAILED" ? plasmaLevel(s) : 0;
    const failed = v.phase === "FAILED";
    const ft = failed ? v.failT || 0 : 0;
    if (failed && s.outcome === OUTCOME.SKIP_OUT) L *= Math.max(0, 1 - ft / 3);
    if (failed && (s.outcome === OUTCOME.THERMAL || s.outcome === OUTCOME.STRUCTURAL)) L *= Math.max(0, 1.2 - ft / 2.4);
    levelRef.current = L;

    velocityDir(s, vdir);
    if (v.phase === "APPROACH" || v.phase === "PREP") vdir.set(-Math.cos(v.approachFpa || -0.11), Math.sin(v.approachFpa || -0.11), 0).normalize();

    // Flow frame: -Y points upstream (along velocity)
    _q.setFromUnitVectors(DOWN, vdir);
    if (flow.current) flow.current.quaternion.copy(_q);

    // Capsule attitude: heat shield forward, rolled by bank, trimmed at AoA.
    const bank = (v.phase === "PREP" || v.phase === "APPROACH" ? v.prepBank || 0 : s.bank) * DEG;
    _q2.setFromAxisAngle(vdir, -bank);
    const liftDir = _v.set(0, 1, 0).sub(vdir.clone().multiplyScalar(vdir.y)).normalize().applyQuaternion(_q2);
    const axis = new THREE.Vector3().crossVectors(vdir, liftDir).normalize();
    const trim = new THREE.Quaternion().setFromAxisAngle(axis, CAPSULE.trimAoA * DEG);
    const flight = new THREE.Quaternion().copy(_q).premultiply(_q2).premultiply(trim);

    // Approach: apex leads (SM attached), then turn to entry attitude during prep
    let target = flight;
    const apexFwd = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vdir);
    if (v.phase === "APPROACH") smQuatRef.current.copy(apexFwd);
    if (v.phase === "APPROACH" || (v.phase === "PREP" && (v.attitudeU ?? 1) < 1)) {
      const u = v.phase === "APPROACH" ? 0 : smooth(v.attitudeU);
      target = apexFwd.clone().slerp(flight, u);
    }
    // Under chutes: swing apex-up and hang
    const chuting = s.drogueT !== null;
    upright.current = chuting ? Math.min(1, upright.current + dt * 0.5) : 0;
    if (chuting) {
      const hangQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(t * 0.9) * 0.06, 0, Math.cos(t * 0.7) * 0.05 + 0.3));
      target = target.clone().slerp(hangQ, smooth(upright.current));
    }
    // Afloat: apex up, riding the waves (the slope of the very sea that is drawn), a gentle list
    const splashed = v.phase === "SPLASHED";
    let wave = null;
    if (splashed) {
      wave = seaSurface(atmo.drift * M_PER_UNIT, 0, t);
      const ax = Math.atan(wave.dz) * 0.75 + FLOAT.tilt * Math.sin(t * 0.41);
      const az = -Math.atan(wave.dx) * 0.75 + 0.05 + 0.03 * Math.sin(t * 0.33 + 1);
      // from the hanging attitude into the floating one over the first seconds
      const settle = smooth((v.phaseT || 0) / 2.4);
      const floatQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(ax, 0.2, az));
      const hangQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.3));
      target = hangQ.slerp(floatQ, settle);
    }
    if (failed && s.outcome === OUTCOME.STRUCTURAL) {
      target = new THREE.Quaternion().setFromEuler(new THREE.Euler(ft * 2.1, ft * 0.7, ft * 1.4)).multiply(flight);
    }
    attitude.current.quaternion.slerp(target, Math.min(1, dt * 3));
    if (splashed) {
      // floating: the capsule's origin FLOAT.waterlineY below the wave under it (the heat shield
      // and the lower cone in the water), after the plunge and bob of the impact
      const pt = v.phaseT || 0;
      const floatY = atmo.seaY + wave.h / M_PER_UNIT - FLOAT.waterlineY;
      attitude.current.position.y = floatY * smooth(pt / 0.5) + splashBob(pt);
    } else attitude.current.position.y = 0;

    // the capsule's pose for the parachutes and the descent, and its lowest point (the sea meets it there)
    const pose = poseRef.current;
    pose.pos.copy(attitude.current.position);
    pose.quat.copy(attitude.current.quaternion);
    let low = Infinity;
    let lx = 0;
    let lz = 0;
    SHIELD_PTS.forEach((q) => {
      _lp.set(q[0], q[1], q[2]).applyQuaternion(attitude.current.quaternion);
      if (_lp.y < low) [low, lx, lz] = [_lp.y, _lp.x, _lp.z];
    });
    if (!splashed) pose.low = low;
    // contact: the splash starts where the heat shield first met the sea, and only then
    if (splashed && !(v.splash && v.splash.on)) v.splash = { on: true, x: lx, y: atmo.seaY, z: lz, t: 0 };
    if (!splashed && v.splash) v.splash = null;
    if (v.splash) v.splash.t = v.phaseT || 0;

    // Heat shield glow tracks surface heating
    if (shieldMatRef.current) {
      const glow = Math.min(1.4, L * 1.1 + (failed && s.outcome === OUTCOME.THERMAL ? ft * 0.5 : 0));
      shieldMatRef.current.emissiveIntensity = glow;
      shieldMatRef.current.emissive.setRGB(1, 0.3 + 0.3 * Math.min(1, glow), 0.06 + 0.25 * Math.max(0, glow - 1));
    }
    // Vehicle loss: body fades as it breaks up
    const loss = failed && s.outcome !== OUTCOME.SKIP_OUT;
    const opacity = loss ? Math.max(0, 1 - Math.max(0, ft - 1.2) / 1.6) : 1;
    (mats.current || []).forEach((m) => {
      m.opacity = opacity;
    });
    debris.current.forEach((d, i) => {
      if (!d) return;
      d.visible = loss && ft > 0.9 && ft < 5;
      if (d.visible) {
        const k = ft - 0.9;
        d.position.set(DEBRIS[i][0] * k * 1.8, DEBRIS[i][1] * k * 1.2, DEBRIS[i][2] * k * 1.5);
        d.rotation.set(k * (2 + i), k * 1.3, k * (1 + i));
      }
    });
    if (light.current) light.current.intensity = L * 3.5;
  });

  return (
    <group>
      <group ref={attitude}>
        <CapsuleModel shieldMatRef={shieldMatRef} bodyOpacityRef={mats} />
      </group>
      <ServiceModule viewRef={viewRef} smQuatRef={smQuatRef} />
      <group ref={flow}>
        <ShockLayer levelRef={levelRef} />
        <ShoulderGlow levelRef={levelRef} />
        <PlasmaSheath levelRef={levelRef} />
        <Wake levelRef={levelRef} radius={0.6} length={6} strength={1.7} streak={18} />
        <Wake levelRef={levelRef} radius={1.15} length={10} strength={0.7} streak={9} />
        <AblationSparks levelRef={levelRef} />
        <pointLight ref={light} color="#ff8a3b" distance={6} decay={2} position={[0, -0.5, 0]} />
      </group>
      {DEBRIS.map((_, i) => (
        <mesh key={i} ref={(el) => (debris.current[i] = el)} visible={false}>
          <boxGeometry args={[0.12 - i * 0.02, 0.05, 0.09]} />
          <meshStandardMaterial color="#2e2a26" emissive="#ff6a1a" emissiveIntensity={0.8} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------ camera ------------------------------ */

function CameraRig({ simRef, viewRef, atmo }) {
  const { camera } = useThree();
  const first = useRef(true);
  const pos = useRef(new THREE.Vector3(3, 1, 4.5));
  const look = useRef(new THREE.Vector3());
  const _p = useMemo(() => new THREE.Vector3(), []);
  const _l = useMemo(() => new THREE.Vector3(), []);
  useFrame((state, dt) => {
    const s = simRef.current;
    const v = viewRef.current;
    if (!s) return;
    const t = state.clock.elapsedTime;
    const L = plasmaLevel(s);
    if (v.phase === "APPROACH") {
      // Ahead and to the sunlit side, as the return's approach shot: the CSM flies screen-left.
      _p.set(-1.2, 1.3, 5.6);
      _l.set(0.5, -0.4, 0);
    } else if (v.phase === "PREP") {
      // The service module backs away behind (screen right, away from the camera) and the
      // command module turns its heat shield forward.
      _p.set(-1.9 + Math.sin(t * 0.1) * 0.2, 0.85, 4.6);
      _l.set(0.7, -0.3, 0);
    } else if (v.phase === "SPLASHED") {
      // the recovery shot: from near the sea, slowly drawing back and round (data/descentScene)
      const c = recoveryCamera(v.phaseT || 0);
      _p.set(...c.pos);
      _l.set(...c.look);
    } else if (v.phase === "FAILED" && s.outcome === OUTCOME.SKIP_OUT) {
      const k = Math.min(1, (v.failT || 0) / 4);
      _p.set(3 + k * 5, 1 + k * 3, 5 + k * 8);
      _l.set(0, -2 * k, 0);
    } else if (s.mainT !== null || s.drogueT !== null) {
      // under the parachutes, one continuous move from the drogues to the water (data/descentScene)
      const c = chuteCamera(s.h, s.mainT !== null ? s.t - s.mainT : null, t, s.drogueT !== null ? s.t - s.drogueT : Infinity);
      _p.set(...c.pos);
      _l.set(...c.look);
    } else if (s.v < 3000) {
      _p.set(...ENTRY_SIDE.pos);
      _l.set(...ENTRY_SIDE.look);
    } else {
      // Documentary side view: capsule left of frame, wake streaming right.
      const close = Math.min(1, L);
      _p.set(1.5 + Math.sin(t * 0.15) * 0.15, 0.55, 4.6 - close * 1.1);
      _l.set(0.9 + close * 0.6, 0.15, 0);
    }
    if (first.current) {
      // the first frame (the MISSION COMPLETE scene opening on the recovery shot): no sweep in
      first.current = false;
      pos.current.copy(_p);
      look.current.copy(_l);
    }
    pos.current.lerp(_p, Math.min(1, dt * 1.2));
    look.current.lerp(_l, Math.min(1, dt * 1.6));
    // never below the waves: clear of the very swell under the camera
    if (atmo.low > 0.5) {
      const w = seaSurface((pos.current.x + atmo.drift) * M_PER_UNIT, pos.current.z * M_PER_UNIT, t);
      pos.current.y = Math.max(pos.current.y, atmo.seaY + w.h / M_PER_UNIT + 0.32);
    }
    camera.position.copy(pos.current);
    camera.lookAt(look.current);
    // read-only, for the validation tooling: the camera, the sea and the splash each frame
    if (typeof window !== "undefined") {
      const w = window.__lvReentryView || (window.__lvReentryView = {});
      w.cam = pos.current.toArray();
      w.look = look.current.toArray();
      w.seaY = atmo.seaY;
      w.low = atmo.low;
      w.phase = v.phase;
      w.phaseT = v.phaseT;
      w.splash = v.splash ? { x: v.splash.x, y: v.splash.y, z: v.splash.z, t: v.splash.t } : null;
      w.calls = state.gl.info.render.calls;
      w.tris = state.gl.info.render.triangles;
    }
  });
  return null;
}

function Scene({ simRef, viewRef, final = false }) {
  const starRef = useRef();
  // One atmosphere for the sky, the sea and the clouds (written by SkyDome and AtmoState).
  const atmo = useMemo(
    () => ({ sun: new THREE.Vector3(...REENTRY_SUN).normalize(), top: new THREE.Color(), hor: new THREE.Color(), haze: new THREE.Color("#b8cfe0"), low: 0, seaY: -1e4, drift: 0 }),
    []
  );
  const poseRef = useRef({ pos: new THREE.Vector3(), quat: new THREE.Quaternion(), low: -0.11 });
  const shadows = useMemo(() => cloudShadowMap(REENTRY_SUN.map((x) => x / Math.hypot(...REENTRY_SUN))), []);
  const noise = useMemo(() => noiseTexture(), []);
  const cloudPass = useRef(null);
  useFrame((_, dt) => {
    const s = simRef.current;
    const ph = viewRef.current.phase;
    // the MISSION COMPLETE scene: the recovery shot runs on from where the splashdown left it
    if (final) viewRef.current.phaseT = (viewRef.current.phaseT || 0) + dt;
    if (starRef.current && s) starRef.current.visible = ph === "APPROACH" || ph === "PREP" || ((ph === "ENTRY" || ph === "FAILED") && s.h > 55e3);
  });
  return (
    <>
      <AtmoState simRef={simRef} viewRef={viewRef} poseRef={poseRef} atmo={atmo} final={final} />
      <SkyDome simRef={simRef} atmo={atmo} />
      <group ref={starRef}>
        <Stars radius={500} depth={60} count={3500} factor={3} saturation={0} fade speed={0.2} />
      </group>
      <ambientLight intensity={0.28} />
      <hemisphereLight args={["#9cc6ff", "#0b1a2c", 0.35]} />
      <directionalLight position={[-6, 7, 5]} intensity={2.6} color="#fff4e6" />
      <OrbitalEarth simRef={simRef} viewRef={viewRef} />
      <Ocean simRef={simRef} viewRef={viewRef} atmo={atmo} cloudShadows={shadows} />
      <CloudField simRef={simRef} atmo={atmo} passRef={cloudPass} />
      <Vehicle simRef={simRef} viewRef={viewRef} poseRef={poseRef} atmo={atmo} />
      <Chutes simRef={simRef} viewRef={viewRef} poseRef={poseRef} atmo={atmo} />
      <Splash viewRef={viewRef} noise={noise} sun={atmo.sun} />
      <CameraRig simRef={simRef} viewRef={viewRef} atmo={atmo} />
      {/* after the camera rig: the clouds' buffer drawn from this frame's camera, before the main pass */}
      <CloudPass passRef={cloudPass} />
    </>
  );
}

// Static splashdown state for the mission-complete backdrop.
function splashedState() {
  return {
    t: 1000, h: 0, v: 0, gamma: -Math.PI / 2, s: 0, bank: 0, heatRate: 0, gLoad: 1,
    drogueT: 900, mainT: 950, outcome: OUTCOME.SPLASHDOWN, peak: { heatRate: 0 },
  };
}

export default function ReentryScene({ simRef, viewRef, final = false }) {
  const localSim = useRef(splashedState());
  const localView = useRef({ phase: "SPLASHED", phaseT: CONFIRM.done });
  const sRef = final || !simRef ? localSim : simRef;
  const vRef = final || !viewRef ? localView : viewRef;
  return (
    <div className="absolute inset-0 canvas-host" data-testid="reentry-canvas">
      <Canvas
        camera={{ position: [3, 1, 4.5], fov: 45, near: 0.08, far: 160000 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }}
        onCreated={({ gl }) => gl.setClearColor("#020203")}
      >
        <Scene simRef={sRef} viewRef={vRef} final={final || !simRef} />
        <AdaptiveResolution />
      </Canvas>
    </div>
  );
}
