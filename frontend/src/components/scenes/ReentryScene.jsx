import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import { useRef, useMemo, useEffect, useState } from "react";
import * as THREE from "three";
import { R_EARTH, CAPSULE, CHUTES, OUTCOME } from "@/data/reentryPhysics";
import { plasmaLevel } from "@/data/reentryGuidance";

/*
 * ReentryScene — rendered entirely from the live reentry simulation state
 * (simRef) plus presentation state (viewRef: phase, timers). Nothing here
 * advances physics; plasma, sky, Earth, chutes and ocean read the state.
 *
 * Scene frame: capsule at the origin, local vertical +Y, flight to -X.
 * Capsule diameter = 1 unit (3.9 m).
 */

const EARTH_MAP = process.env.PUBLIC_URL + "/textures/planets/earth_atmos_2048.jpg";
const CLOUD_MAP = process.env.PUBLIC_URL + "/textures/planets/earth_clouds_1024.png";

const EARTH_RS = 400; // scene radius of the Earth sphere (altitude scaled 1:1 in angle)
const LOW_SCALE = 25; // metres per scene unit in the low-altitude world
const DEG = Math.PI / 180;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

// Texture loads that fail quietly (no Suspense throw) — the planet falls back to a flat material.
function useOptionalTexture(url) {
  const [tex, setTex] = useState(null);
  useEffect(() => {
    let alive = true;
    new THREE.TextureLoader().load(
      url,
      (t) => {
        if (!alive) return;
        t.colorSpace = THREE.SRGBColorSpace;
        setTex(t);
      },
      undefined,
      () => {}
    );
    return () => {
      alive = false;
    };
  }, [url]);
  return tex;
}

/* ------------------------------ helpers ------------------------------ */

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

function velocityDir(s, out) {
  // Flight toward -X; gamma < 0 descending.
  return out.set(-Math.cos(s.gamma), Math.sin(s.gamma), 0).normalize();
}

function chuteInflation(s, which) {
  const t0 = which === "main" ? s.mainT : s.drogueT;
  if (t0 === null || t0 === undefined) return 0;
  const cfg = which === "main" ? CHUTES.main : CHUTES.drogue;
  return clamp01((s.t - t0) / cfg.inflateTime);
}

/* ------------------------------- capsule ------------------------------- */

function useCapsuleGeometry() {
  return useMemo(() => {
    // Heat shield: shallow spherical dome + toroidal shoulder
    const Rh = 1.2;
    const shield = [];
    for (let i = 0; i <= 12; i++) {
      const r = (i / 12) * 0.5;
      shield.push(new THREE.Vector2(Math.max(r, 0.0001), -(Rh - Math.sqrt(Rh * Rh - r * r))));
    }
    shield.push(new THREE.Vector2(0.512, 0.012));
    shield.push(new THREE.Vector2(0.515, 0.035));
    shield.push(new THREE.Vector2(0.5, 0.06));
    const shieldGeo = new THREE.LatheGeometry(shield, 48);

    // Conical afterbody + docking tunnel
    const body = [
      new THREE.Vector2(0.5, 0.06),
      new THREE.Vector2(0.49, 0.075),
      new THREE.Vector2(0.14, 0.62),
      new THREE.Vector2(0.105, 0.64),
      new THREE.Vector2(0.1, 0.75),
      new THREE.Vector2(0.07, 0.765),
      new THREE.Vector2(0.0001, 0.77),
    ];
    const bodyGeo = new THREE.LatheGeometry(body, 48);
    return { shieldGeo, bodyGeo };
  }, []);
}

function CapsuleModel({ shieldMatRef, bodyOpacityRef }) {
  const { shieldGeo, bodyGeo } = useCapsuleGeometry();
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
  const bodyMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#d9dade", roughness: 0.38, metalness: 0.55, transparent: true }),
    []
  );
  const darkMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#121416", roughness: 0.4, metalness: 0.3, transparent: true }), []);
  const bandMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#FF3B00", roughness: 0.5, metalness: 0.2, transparent: true }), []);
  useEffect(() => {
    shieldMatRef.current = shieldMat;
    bodyOpacityRef.current = [shieldMat, bodyMat, darkMat, bandMat];
  }, [shieldMat, bodyMat, darkMat, bandMat, shieldMatRef, bodyOpacityRef]);

  return (
    <group>
      <mesh geometry={shieldGeo} material={shieldMat} />
      <mesh geometry={bodyGeo} material={bodyMat} />
      {/* LUNAVIA orange band just above the shoulder */}
      <mesh position={[0, 0.12, 0]} material={bandMat}>
        <cylinderGeometry args={[0.452, 0.467, 0.035, 48, 1, true]} />
      </mesh>
      {/* Crew windows */}
      {[-0.55, 0.55].map((a, i) => (
        <mesh key={i} position={[Math.sin(a) * 0.33, 0.34, Math.cos(a) * 0.33]} rotation={[-0.58, a, 0]} material={darkMat}>
          <boxGeometry args={[0.075, 0.06, 0.012]} />
        </mesh>
      ))}
      {/* Hatch */}
      <mesh position={[0, 0.3, 0.355]} rotation={[-0.58, 0, 0]} material={darkMat}>
        <boxGeometry args={[0.14, 0.16, 0.006]} />
      </mesh>
      {/* RCS quads */}
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.3, 0.42, Math.sin(a) * 0.3]} material={darkMat}>
            <boxGeometry args={[0.04, 0.04, 0.04]} />
          </mesh>
        );
      })}
    </group>
  );
}

// Service module (approach only) — separated and drifts away at ENTRY PREP.
const _smOff = new THREE.Vector3();
function ServiceModule({ viewRef, smQuatRef }) {
  const ref = useRef();
  useFrame(() => {
    if (!ref.current) return;
    const v = viewRef.current;
    const sep = v.phase === "APPROACH" ? 0 : Math.min(8, v.sepT || 0);
    ref.current.visible = v.phase === "APPROACH" || (v.phase === "PREP" && sep < 7.5);
    // SM keeps its approach attitude and backs away along its own axis after separation.
    ref.current.quaternion.copy(smQuatRef.current);
    _smOff.set(0.12 * sep, -0.62 - 0.45 * sep, -0.3 * sep).applyQuaternion(smQuatRef.current);
    ref.current.position.copy(_smOff);
  });
  return (
    <group ref={ref}>
      <mesh position={[0, -0.25, 0]}>
        <cylinderGeometry args={[0.48, 0.48, 0.9, 40]} />
        <meshStandardMaterial color="#c9ccd2" metalness={0.8} roughness={0.32} />
      </mesh>
      <mesh position={[0, -0.25, 0]}>
        <cylinderGeometry args={[0.485, 0.485, 0.16, 40, 1, true]} />
        <meshStandardMaterial color="#1a2029" metalness={0.4} roughness={0.6} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, -0.83, 0]}>
        <coneGeometry args={[0.2, 0.3, 24, 1, true]} />
        <meshStandardMaterial color="#3a3b3e" metalness={0.85} roughness={0.35} side={THREE.DoubleSide} />
      </mesh>
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

/* ------------------------------ parachutes ------------------------------ */

function makeGoreTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 32;
  const ctx = c.getContext("2d");
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#FF3B00" : "#f3f1ec";
    ctx.fillRect(i * 16, 0, 16, 32);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Parachutes({ simRef }) {
  const drogueRef = useRef();
  const mainRef = useRef();
  const canopies = useRef([]);
  const goreTex = useMemo(() => makeGoreTexture(), []);
  const lineGeo = useMemo(() => {
    const pts = [];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const cx = Math.cos(a) * 1.9;
      const cz = Math.sin(a) * 1.9;
      for (let j = 0; j < 8; j++) {
        const b = (j / 8) * Math.PI * 2;
        pts.push(0, 0.78, 0, cx + Math.cos(b) * 2.2, 6.1, cz + Math.sin(b) * 2.2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  const drogueLines = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0.78, 0, -0.45, 2.55, 0, 0, 0.78, 0, 0.45, 2.55, 0], 3));
    return g;
  }, []);

  useFrame((state) => {
    const s = simRef.current;
    if (!s) return;
    const dU = chuteInflation(s, "drogue");
    const mU = chuteInflation(s, "main");
    const t = state.clock.elapsedTime;
    if (drogueRef.current) {
      drogueRef.current.visible = s.drogueT !== null && mU < 0.6;
      const k = 0.2 + 0.8 * dU;
      drogueRef.current.scale.set(k, 0.4 + 0.6 * dU, k);
      drogueRef.current.rotation.z = Math.sin(t * 2.3) * 0.08;
    }
    if (mainRef.current) {
      mainRef.current.visible = s.mainT !== null;
      const k = 0.12 + 0.88 * Math.pow(mU, 1.5);
      mainRef.current.scale.set(k, 0.35 + 0.65 * Math.pow(mU, 0.8), k);
      mainRef.current.rotation.z = Math.sin(t * 0.7) * 0.03;
      canopies.current.forEach((c, i) => {
        if (c) c.rotation.y = t * 0.08 + i;
      });
    }
  });

  return (
    <group>
      <group ref={drogueRef} visible={false}>
        {[-0.45, 0.45].map((x, i) => (
          <mesh key={i} position={[x, 2.75, 0]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.32, 0.42, 16, 1, true]} />
            <meshStandardMaterial map={goreTex} side={THREE.DoubleSide} roughness={0.9} />
          </mesh>
        ))}
        <lineSegments geometry={drogueLines}>
          <lineBasicMaterial color="#d8d4cc" transparent opacity={0.7} />
        </lineSegments>
      </group>
      <group ref={mainRef} visible={false}>
        {[0, 1, 2].map((k) => {
          const a = (k / 3) * Math.PI * 2;
          return (
            <mesh
              key={k}
              ref={(el) => (canopies.current[k] = el)}
              position={[Math.cos(a) * 1.9, 6.1, Math.sin(a) * 1.9]}
              rotation={[Math.sin(a) * 0.22, 0, -Math.cos(a) * 0.22]}
            >
              <sphereGeometry args={[2.3, 32, 12, 0, Math.PI * 2, 0, Math.PI * 0.42]} />
              <meshStandardMaterial map={goreTex} side={THREE.DoubleSide} roughness={0.85} />
            </mesh>
          );
        })}
        <lineSegments geometry={lineGeo}>
          <lineBasicMaterial color="#e2ded6" transparent opacity={0.45} />
        </lineSegments>
      </group>
    </group>
  );
}

/* ------------------------------ environment ------------------------------ */

function SkyDome({ simRef }) {
  const mat = useRef();
  const uniforms = useMemo(() => ({ uTop: { value: new THREE.Color("#010103") }, uHor: { value: new THREE.Color("#04060c") } }), []);
  const cols = useMemo(
    () => ({
      topSpace: new THREE.Color("#010103"),
      horSpace: new THREE.Color("#04060c"),
      topHigh: new THREE.Color("#050b1f"),
      horHigh: new THREE.Color("#2a5aa8"),
      topLow: new THREE.Color("#3f78c4"),
      horLow: new THREE.Color("#b9d3ea"),
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
  });
  return (
    <mesh renderOrder={-2} frustumCulled={false}>
      <sphereGeometry args={[900, 32, 16]} />
      <shaderMaterial
        ref={mat}
        side={THREE.BackSide}
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={`varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `}
        fragmentShader={`uniform vec3 uTop; uniform vec3 uHor; varying vec3 vD;
          void main(){ float y = normalize(vD).y; float k = pow(clamp(y, 0.0, 1.0), 0.45);
            gl_FragColor = vec4(mix(uHor, uTop, k), 1.0); }`}
      />
    </mesh>
  );
}

function OrbitalEarth({ simRef, viewRef }) {
  const group = useRef();
  const surface = useRef();
  const clouds = useRef();
  const shell = useRef();
  const map = useOptionalTexture(EARTH_MAP);
  const cloudMap = useOptionalTexture(CLOUD_MAP);
  const shellUniforms = useMemo(() => ({ uFade: { value: 1 } }), []);
  useFrame((_, dt) => {
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
    if (surface.current) surface.current.material.opacity = vis;
    if (clouds.current) {
      clouds.current.rotation.y += dt * 0.003;
      clouds.current.material.opacity = 0.75 * vis;
    }
    if (shell.current) {
      // The limb glow is seen from outside the atmosphere only; inside it, the sky dome takes over.
      const outside = smooth((hs - EARTH_RS * 0.018 - 0.3) / 2);
      shell.current.visible = outside > 0.01;
      shellUniforms.uFade.value = vis * outside;
    }
  });
  return (
    <group ref={group}>
      <mesh ref={surface} rotation={[0.4, 0, 0]}>
        <sphereGeometry args={[EARTH_RS, 96, 64]} />
        <meshStandardMaterial map={map || null} color={map ? "#ffffff" : "#1d4f86"} roughness={0.85} metalness={0.05} transparent />
      </mesh>
      <mesh ref={clouds} rotation={[0.4, 0, 0]}>
        <sphereGeometry args={[EARTH_RS * 1.0025, 96, 64]} />
        <meshStandardMaterial map={cloudMap || null} color="#ffffff" transparent opacity={cloudMap ? 0.75 : 0} depthWrite={false} />
      </mesh>
      <mesh ref={shell}>
        <sphereGeometry args={[EARTH_RS * 1.018, 64, 48]} />
        <shaderMaterial
          transparent
          side={THREE.BackSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          uniforms={shellUniforms}
          vertexShader={`varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `}
          fragmentShader={`uniform float uFade; varying vec3 vN; void main(){ float i = pow(0.72 - dot(vN, vec3(0.0,0.0,1.0)), 3.0); gl_FragColor = vec4(0.35,0.62,1.0,1.0) * i * 1.4 * uFade; }`}
        />
      </mesh>
    </group>
  );
}

function LowWorld({ simRef, viewRef }) {
  const ocean = useRef();
  const cloudGroup = useRef();
  const spray = useRef();
  const foam = useRef();
  const cloudBits = useMemo(() => {
    const arr = [];
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < 40; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 90 + rnd() * 420;
      arr.push({ x: Math.cos(a) * r, z: Math.sin(a) * r - 60, s: 25 + rnd() * 45, y: rnd() * 12 });
    }
    return arr;
  }, []);
  const puff = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.5, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);
  const oceanMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uFade: { value: 0 } },
        transparent: true,
        vertexShader: `varying vec2 vW; varying vec3 vPos; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xz; vPos = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `uniform float uTime; uniform float uFade; varying vec2 vW; varying vec3 vPos;
          void main(){
            float w = sin(vW.x * 0.35 + uTime * 1.3) * 0.5 + sin(vW.y * 0.27 - uTime * 1.1) * 0.5 + sin((vW.x + vW.y) * 0.9 + uTime * 2.1) * 0.25;
            float dist = length(vPos - cameraPosition);
            vec3 deep = vec3(0.03, 0.16, 0.30); vec3 lit = vec3(0.10, 0.34, 0.52);
            vec3 col = mix(deep, lit, 0.5 + 0.25 * w);
            col = mix(col, vec3(0.62, 0.76, 0.88), clamp(dist / 900.0, 0.0, 0.85));
            gl_FragColor = vec4(col, uFade); }`,
      }),
    []
  );
  useFrame((state) => {
    const s = simRef.current;
    if (!s) return;
    const v = viewRef.current;
    const hKm = s.h / 1000;
    const fade = smooth((25 - hKm) / 10);
    const y = -s.h / LOW_SCALE;
    oceanMat.uniforms.uTime.value = state.clock.elapsedTime;
    oceanMat.uniforms.uFade.value = fade;
    if (ocean.current) {
      ocean.current.visible = fade > 0.01;
      ocean.current.position.y = Math.min(y, -0.05);
    }
    if (cloudGroup.current) {
      cloudGroup.current.visible = fade > 0.01 && s.h > 300;
      cloudGroup.current.position.y = (2600 - s.h) / LOW_SCALE;
      cloudGroup.current.children.forEach((c) => {
        c.material.opacity = 0.55 * fade;
        c.quaternion.copy(state.camera.quaternion);
      });
    }
    const splashed = v.phase === "SPLASHED";
    const st = splashed ? v.phaseT || 0 : 0;
    if (spray.current) {
      const u = clamp01(st / 2.2);
      spray.current.visible = splashed && u < 1;
      spray.current.scale.setScalar(0.6 + u * 3.2);
      spray.current.material.opacity = 0.7 * (1 - u);
    }
    if (foam.current) {
      foam.current.visible = splashed;
      foam.current.scale.setScalar(1.2 + Math.min(1, st / 3) * 1.6);
      foam.current.material.opacity = 0.35 * Math.max(0.3, 1 - st / 10);
    }
  });
  return (
    <group>
      <mesh ref={ocean} rotation={[-Math.PI / 2, 0, 0]} material={oceanMat}>
        <planeGeometry args={[4000, 4000, 1, 1]} />
      </mesh>
      <group ref={cloudGroup}>
        {cloudBits.map((c, i) => (
          <mesh key={i} position={[c.x, c.y, c.z]} scale={[c.s, c.s * 0.45, 1]}>
            <planeGeometry args={[2, 2]} />
            <meshBasicMaterial color="#f4f7fa" alphaMap={puff} transparent opacity={0} depthWrite={false} />
          </mesh>
        ))}
      </group>
      <mesh ref={spray} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} visible={false}>
        <ringGeometry args={[0.5, 0.9, 40]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={foam} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} visible={false}>
        <circleGeometry args={[0.8, 40]} />
        <meshBasicMaterial color="#d9ecf4" transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

/* ------------------------------ vehicle rig ------------------------------ */

const DEBRIS = [
  [0.6, 0.2, 0.3],
  [0.4, -0.25, -0.35],
  [0.8, 0.05, -0.1],
];

function Vehicle({ simRef, viewRef }) {
  const attitude = useRef();
  const flow = useRef();
  const hang = useRef();
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
    if (v.phase === "SPLASHED") {
      target = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(t * 0.8) * 0.07, 0, 0.35 + Math.cos(t * 0.6) * 0.06));
    }
    if (failed && s.outcome === OUTCOME.STRUCTURAL) {
      target = new THREE.Quaternion().setFromEuler(new THREE.Euler(ft * 2.1, ft * 0.7, ft * 1.4)).multiply(flight);
    }
    attitude.current.quaternion.slerp(target, Math.min(1, dt * 3));
    attitude.current.position.y = v.phase === "SPLASHED" ? Math.sin(t * 1.1) * 0.03 - 0.28 : 0;

    if (hang.current) {
      hang.current.visible = chuting && v.phase !== "FAILED" && !(v.phase === "SPLASHED" && (v.phaseT || 0) > 1.2);
      hang.current.quaternion.copy(attitude.current.quaternion);
      hang.current.position.copy(attitude.current.position);
    }

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
      <group ref={hang} visible={false}>
        <Parachutes simRef={simRef} />
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

function CameraRig({ simRef, viewRef }) {
  const { camera } = useThree();
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
      _p.set(3.4, 1.4, 5.2);
      _l.set(0, -0.4, 0);
    } else if (v.phase === "PREP") {
      _p.set(2.6 + Math.sin(t * 0.1) * 0.2, 0.9, 4.4);
      _l.set(0.2, -0.3, 0);
    } else if (v.phase === "SPLASHED") {
      _p.set(4.5, 1.1, 7.5);
      _l.set(0, 0.6, 0);
    } else if (v.phase === "FAILED" && s.outcome === OUTCOME.SKIP_OUT) {
      const k = Math.min(1, (v.failT || 0) / 4);
      _p.set(3 + k * 5, 1 + k * 3, 5 + k * 8);
      _l.set(0, -2 * k, 0);
    } else if (s.mainT !== null) {
      _p.set(6.5, -3.2, 12);
      _l.set(0, 3.2, 0);
    } else if (s.drogueT !== null) {
      _p.set(3.6, -1.2, 6.2);
      _l.set(0, 1.2, 0);
    } else if (s.v < 3000) {
      _p.set(2.8, 0.4, 4.6);
      _l.set(0.3, 0.1, 0);
    } else {
      // Documentary side view: capsule left of frame, wake streaming right.
      const close = Math.min(1, L);
      _p.set(1.5 + Math.sin(t * 0.15) * 0.15, 0.55, 4.6 - close * 1.1);
      _l.set(0.9 + close * 0.6, 0.15, 0);
    }
    pos.current.lerp(_p, Math.min(1, dt * 1.2));
    look.current.lerp(_l, Math.min(1, dt * 1.6));
    camera.position.copy(pos.current);
    camera.lookAt(look.current);
  });
  return null;
}

function Scene({ simRef, viewRef }) {
  const starRef = useRef();
  useFrame(() => {
    const s = simRef.current;
    const ph = viewRef.current.phase;
    if (starRef.current && s) starRef.current.visible = ph === "APPROACH" || ph === "PREP" || ((ph === "ENTRY" || ph === "FAILED") && s.h > 55e3);
  });
  return (
    <>
      <SkyDome simRef={simRef} />
      <group ref={starRef}>
        <Stars radius={500} depth={60} count={3500} factor={3} saturation={0} fade speed={0.2} />
      </group>
      <ambientLight intensity={0.28} />
      <hemisphereLight args={["#9cc6ff", "#0b1a2c", 0.35]} />
      <directionalLight position={[-6, 7, 5]} intensity={2.6} color="#fff4e6" />
      <OrbitalEarth simRef={simRef} viewRef={viewRef} />
      <LowWorld simRef={simRef} viewRef={viewRef} />
      <Vehicle simRef={simRef} viewRef={viewRef} />
      <CameraRig simRef={simRef} viewRef={viewRef} />
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
  const localView = useRef({ phase: "SPLASHED", phaseT: 10 });
  const sRef = final || !simRef ? localSim : simRef;
  const vRef = final || !viewRef ? localView : viewRef;
  return (
    <div className="absolute inset-0 canvas-host" data-testid="reentry-canvas">
      <Canvas
        camera={{ position: [3, 1, 4.5], fov: 45, near: 0.05, far: 3000 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }}
        onCreated={({ gl }) => gl.setClearColor("#020203")}
      >
        <Scene simRef={sRef} viewRef={vRef} />
      </Canvas>
    </div>
  );
}
