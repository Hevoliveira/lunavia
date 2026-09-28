import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import { useRef, useMemo, Suspense } from "react";
import * as THREE from "three";
import RocketModel from "@/components/RocketModel";

/**
 * AscentScene — cinematic launch, atmospheric climb and stage separation.
 * progress in [0..1] drives everything; t = progress / ASCENT_RATE is the
 * seconds-since-liftoff clock used for the staged ignition sequence.
 */

const ASCENT_RATE = 0.09;
const IGN_END = 0.08; // progress at which the hold-down clamps release

const smooth = (x) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};
const lerp = THREE.MathUtils.lerp;

// Ignition hold, then climb — continuous through staging at p=0.35
function altitudeFor(p) {
  if (p <= 0.35) {
    const u = Math.max(0, (p - IGN_END) / (0.35 - IGN_END));
    return 4.2 * Math.pow(u, 1.7);
  }
  return 4.2 + (p - 0.35) * 12;
}

/* ------------------------------------------------------------------ */

function SkyDome({ progRef }) {
  const mat = useRef();
  const cols = useMemo(
    () => ({
      botDay: new THREE.Color("#a9c7e6"),
      botMid: new THREE.Color("#1c3a68"),
      botSpace: new THREE.Color("#020203"),
      topDay: new THREE.Color("#3a6db4"),
      topMid: new THREE.Color("#0d1226"),
      topSpace: new THREE.Color("#010102"),
      bot: new THREE.Color(),
      top: new THREE.Color(),
    }),
    []
  );
  useFrame(() => {
    if (!mat.current) return;
    const p = progRef.current;
    if (p < 0.35) {
      const u = smooth(p / 0.35);
      cols.bot.copy(cols.botDay).lerp(cols.botMid, u);
      cols.top.copy(cols.topDay).lerp(cols.topMid, u);
    } else {
      const u = smooth((p - 0.35) / 0.2);
      cols.bot.copy(cols.botMid).lerp(cols.botSpace, u);
      cols.top.copy(cols.topMid).lerp(cols.topSpace, u);
    }
    mat.current.uniforms.uBottom.value.copy(cols.bot);
    mat.current.uniforms.uTop.value.copy(cols.top);
  });
  return (
    <mesh renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[300, 32, 24]} />
      <shaderMaterial
        ref={mat}
        side={THREE.BackSide}
        depthWrite={false}
        uniforms={{
          uTop: { value: new THREE.Color("#3a6db4") },
          uBottom: { value: new THREE.Color("#a9c7e6") },
        }}
        vertexShader={`
          varying vec3 vDir;
          void main() {
            vDir = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          varying vec3 vDir;
          uniform vec3 uTop;
          uniform vec3 uBottom;
          void main() {
            float h = clamp(normalize(vDir).y * 0.5 + 0.5, 0.0, 1.0);
            gl_FragColor = vec4(mix(uBottom, uTop, pow(h, 0.7)), 1.0);
          }
        `}
      />
    </mesh>
  );
}

function makeEarthTexture() {
  const W = 1024;
  const H = 512;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#123f73");
  g.addColorStop(0.5, "#1a5690");
  g.addColorStop(1, "#0f3a6a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const rand = mulberry(33);
  // Land masses: soft irregular blobs
  for (let i = 0; i < 14; i++) {
    const cx = rand() * W, cy = H * (0.25 + rand() * 0.5), r = 30 + rand() * 90;
    for (let k = 0; k < 18; k++) {
      const x = cx + (rand() - 0.5) * r * 1.6, y = cy + (rand() - 0.5) * r;
      const rr = r * (0.25 + rand() * 0.45);
      const lg = ctx.createRadialGradient(x, y, 0, x, y, rr);
      lg.addColorStop(0, "rgba(96,110,72,0.85)");
      lg.addColorStop(1, "rgba(96,110,72,0)");
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Cloud field: many soft white puffs, banded like weather systems
  for (let i = 0; i < 520; i++) {
    const band = rand() < 0.6 ? H * (0.3 + 0.4 * rand()) : rand() * H;
    const x = rand() * W, y = band + (rand() - 0.5) * 40, r = 6 + rand() * 34;
    const cg = ctx.createRadialGradient(x, y, 0, x, y, r);
    cg.addColorStop(0, `rgba(255,255,255,${0.35 + rand() * 0.4})`);
    cg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.8, r, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// Curved Earth far below — the horizon bends as the vehicle climbs.
// The fresnel limb shell fades in only once the camera leaves the pad.
function EarthCurve({ progRef }) {
  const shellRef = useRef();
  const earthTex = useMemo(() => makeEarthTexture(), []);
  useFrame(() => {
    if (shellRef.current) {
      shellRef.current.uniforms.uFade.value = smooth(
        (progRef.current - 0.1) / 0.18
      );
    }
  });
  return (
    <group position={[0, -45.05, 0]}>
      <mesh>
        <sphereGeometry args={[45, 64, 48]} />
        <meshStandardMaterial map={earthTex} roughness={0.85} metalness={0.05} />
      </mesh>
      <mesh>
        <sphereGeometry args={[45.9, 48, 36]} />
        <shaderMaterial
          transparent
          side={THREE.BackSide}
          depthWrite={false}
          uniforms={{
            uColor: { value: new THREE.Color("#6fb2ff") },
            uFade: { value: 0 },
          }}
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
            uniform float uFade;
            void main() {
              float i = pow(0.7 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.4);
              gl_FragColor = vec4(uColor, 1.0) * i * uFade;
            }
          `}
        />
      </mesh>
    </group>
  );
}

function LaunchComplex({ progRef }) {
  const groundRef = useRef();
  const rootRef = useRef();
  useFrame(() => {
    if (rootRef.current) {
      // Pad structures stay behind once the vehicle is high — cut them so they
      // don't float over the planet limb
      rootRef.current.visible = progRef.current < 0.3;
    }
    if (!groundRef.current) return;
    // Flat pad terrain fades once the curved planet takes over
    const p = progRef.current;
    groundRef.current.material.opacity = 1 - smooth((p - 0.05) / 0.11);
  });
  return (
    <group ref={rootRef}>
      {/* Flat terrain disc (near-field only) */}
      <mesh ref={groundRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[26, 40]} />
        <meshStandardMaterial color="#24211b" roughness={1} transparent />
      </mesh>
      {/* Concrete apron */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[6, 32]} />
        <meshStandardMaterial color="#383631" roughness={0.95} />
      </mesh>
      {/* Pad mount */}
      <mesh position={[0, 0.08, 0]}>
        <cylinderGeometry args={[0.9, 1.1, 0.16, 8]} />
        <meshStandardMaterial color="#2a2a2c" metalness={0.6} roughness={0.5} />
      </mesh>
      {/* Flame trench exits */}
      {[1, -1].map((s) => (
        <mesh key={s} position={[s * 1.05, 0.03, 0]}>
          <boxGeometry args={[0.8, 0.06, 1.0]} />
          <meshStandardMaterial color="#0c0c0d" roughness={1} />
        </mesh>
      ))}

      {/* Service tower — lattice column + umbilical arms + crane */}
      <group position={[1.35, 0, 0]}>
        {[0.25, -0.25].map((dz) =>
          [0.25, -0.25].map((dx) => (
            <mesh key={`${dx}${dz}`} position={[dx, 1.7, dz]}>
              <boxGeometry args={[0.07, 3.4, 0.07]} />
              <meshStandardMaterial color="#9aa0a6" metalness={0.6} roughness={0.4} />
            </mesh>
          ))
        )}
        {[0.55, 1.1, 1.65, 2.2, 2.75, 3.3].map((y) => (
          <mesh key={y} position={[0, y, 0]}>
            <boxGeometry args={[0.58, 0.05, 0.58]} />
            <meshStandardMaterial color="#8a9096" metalness={0.6} roughness={0.4} />
          </mesh>
        ))}
        {/* Umbilical arms reaching the vehicle */}
        {[0.9, 1.7, 2.5].map((y) => (
          <mesh key={y} position={[-0.55, y, 0]}>
            <boxGeometry args={[1.0, 0.06, 0.08]} />
            <meshStandardMaterial color="#7c8288" metalness={0.65} roughness={0.4} />
          </mesh>
        ))}
        {/* Crane with LUNAVIA orange tip */}
        <mesh position={[-0.5, 3.55, 0]}>
          <boxGeometry args={[1.4, 0.06, 0.06]} />
          <meshStandardMaterial color="#9aa0a6" metalness={0.6} roughness={0.4} />
        </mesh>
        <mesh position={[-1.15, 3.55, 0]}>
          <boxGeometry args={[0.12, 0.09, 0.09]} />
          <meshStandardMaterial color="#FF3B00" metalness={0.4} roughness={0.5} />
        </mesh>
      </group>

      {/* Lightning masts */}
      {[
        [-2.5, -1.5],
        [2.5, -2.0],
        [-1.5, 2.5],
      ].map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 2, 0]}>
            <cylinderGeometry args={[0.025, 0.04, 4, 8]} />
            <meshStandardMaterial color="#6a7076" metalness={0.7} roughness={0.4} />
          </mesh>
          <mesh position={[0, 4.05, 0]}>
            <sphereGeometry args={[0.07, 8, 8]} />
            <meshStandardMaterial color="#c8ccd0" metalness={0.8} roughness={0.3} />
          </mesh>
        </group>
      ))}

      {/* Water tower + propellant spheres */}
      <group position={[-4.2, 0, -3.6]}>
        {[0.35, -0.35].map((dz) =>
          [0.35, -0.35].map((dx) => (
            <mesh key={`${dx}${dz}`} position={[dx, 0.7, dz]}>
              <boxGeometry args={[0.07, 1.4, 0.07]} />
              <meshStandardMaterial color="#7c8288" metalness={0.6} roughness={0.45} />
            </mesh>
          ))
        )}
        <mesh position={[0, 1.75, 0]}>
          <sphereGeometry args={[0.75, 20, 16]} />
          <meshStandardMaterial color="#aeb4ba" metalness={0.55} roughness={0.45} />
        </mesh>
      </group>
      {[
        [3.6, -3.2, 0.55],
        [4.5, -2.2, 0.45],
      ].map(([x, z, r], i) => (
        <mesh key={i} position={[x, r * 0.7, z]}>
          <sphereGeometry args={[r, 20, 16]} />
          <meshStandardMaterial color="#c3c8cd" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

/* --- Pad smoke: one instanced draw call, billboarded in the shader ------- */

function mulberry(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function makePuffTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,0.85)");
  g.addColorStop(0.45, "rgba(255,255,255,0.42)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

const SMOKE_COUNT = 108;

function PadSmoke({ progRef }) {
  const { geo, mat } = useMemo(() => {
    const rand = mulberry(7);
    const spawn = new Float32Array(SMOKE_COUNT * 3);
    const vel = new Float32Array(SMOKE_COUNT * 3);
    const birth = new Float32Array(SMOKE_COUNT);
    const life = new Float32Array(SMOKE_COUNT);
    const size = new Float32Array(SMOKE_COUNT);
    const seed = new Float32Array(SMOKE_COUNT);

    for (let i = 0; i < SMOKE_COUNT; i++) {
      const r1 = rand(), r2 = rand(), r3 = rand(), r4 = rand();
      if (i < 12) {
        // Pre-ignition venting vapor
        spawn.set([(r1 - 0.5) * 0.7, 0.06, (r2 - 0.5) * 0.7], i * 3);
        vel.set([(r1 - 0.5) * 0.4, 0.25 + r3 * 0.35, (r2 - 0.5) * 0.4], i * 3);
        birth[i] = r4 * 0.25;
        life[i] = 1.2 + r1 * 1.0;
        size[i] = 0.22 + r2 * 0.3;
      } else {
        // Ignition: billow sideways out of the flame trench
        const side = i % 2 === 0 ? 1 : -1;
        spawn.set([side * (0.85 + r1 * 0.4), 0.04, (r2 - 0.5) * 1.1], i * 3);
        vel.set([side * (0.9 + r3 * 1.9), 0.3 + r4 * 0.55, (r2 - 0.5) * 1.0], i * 3);
        birth[i] = 0.18 + r1 * 2.1;
        life[i] = 2.4 + r3 * 2.0;
        size[i] = 0.55 + r2 * 0.95;
      }
      seed[i] = rand();
    }

    const g = new THREE.PlaneGeometry(1, 1);
    g.setAttribute("aSpawn", new THREE.InstancedBufferAttribute(spawn, 3));
    g.setAttribute("aVel", new THREE.InstancedBufferAttribute(vel, 3));
    g.setAttribute("aBirth", new THREE.InstancedBufferAttribute(birth, 1));
    g.setAttribute("aLife", new THREE.InstancedBufferAttribute(life, 1));
    g.setAttribute("aSize", new THREE.InstancedBufferAttribute(size, 1));
    g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 1));

    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uTex: { value: makePuffTexture() },
        uOpacity: { value: 0.8 },
      },
      vertexShader: `
        attribute vec3 aSpawn;
        attribute vec3 aVel;
        attribute float aBirth;
        attribute float aLife;
        attribute float aSize;
        attribute float aSeed;
        uniform float uTime;
        varying vec2 vUv;
        varying float vFade;
        varying float vSeed;
        void main() {
          vUv = uv;
          vSeed = aSeed;
          float age = uTime - aBirth;
          float n = clamp(age / aLife, 0.0, 1.0);
          float alive = step(0.0, age) * step(age, aLife);
          vFade = alive * smoothstep(0.0, 0.12, n) * (1.0 - smoothstep(0.45, 1.0, n));
          vec3 center = aSpawn + aVel * age + vec3(0.0, 0.35, 0.0) * age * (0.5 + aSeed);
          center.x += sin(age * 1.7 + aSeed * 20.0) * 0.08 * age;
          center.z += cos(age * 1.3 + aSeed * 17.0) * 0.08 * age;
          float scale = aSize * (0.55 + n * 2.8) * alive;
          vec4 mv = modelViewMatrix * vec4(center, 1.0);
          mv.xy += position.xy * scale;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform sampler2D uTex;
        uniform float uOpacity;
        varying vec2 vUv;
        varying float vFade;
        varying float vSeed;
        void main() {
          float a = texture2D(uTex, vUv).a;
          vec3 tint = mix(vec3(0.94, 0.95, 0.97), vec3(0.55, 0.53, 0.5), vSeed * 0.6);
          float alpha = a * vFade * uOpacity;
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(tint, alpha);
        }
      `,
    });
    return { geo: g, mat: m };
  }, []);

  const smokeT = useRef(0);
  useFrame((_, delta) => {
    // Keep smoke evolving even when progress is frozen (MECO coast hold)
    smokeT.current = Math.max(progRef.current / ASCENT_RATE, smokeT.current + delta);
    mat.uniforms.uTime.value = smokeT.current;
  });

  return <instancedMesh args={[geo, mat, SMOKE_COUNT]} frustumCulled={false} renderOrder={5} />;
}

/* ------------------------------------------------------------------ */

function IgnitionFlash({ progRef }) {
  const mesh = useRef();
  const light = useRef();
  useFrame(() => {
    const t = progRef.current / ASCENT_RATE;
    const u = (t - 0.16) / 0.5;
    const on = u > 0 && u < 1;
    if (mesh.current) {
      mesh.current.visible = on;
      if (on) {
        const s = Math.sin(u * Math.PI);
        mesh.current.scale.setScalar(0.35 + u * 1.4);
        mesh.current.material.opacity = s * 0.8;
      }
    }
    if (light.current) {
      light.current.intensity = on ? Math.sin(u * Math.PI) * 30 : u >= 1 ? 3 : 0;
    }
  });
  return (
    <group position={[0, 0.05, 0]}>
      <mesh ref={mesh} visible={false}>
        <sphereGeometry args={[0.5, 16, 16]} />
        <meshBasicMaterial
          color="#ffd9a0"
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <pointLight ref={light} color="#ff9a4a" intensity={0} distance={12} decay={2} />
    </group>
  );
}

function DustRing({ progRef }) {
  const mesh = useRef();
  useFrame(() => {
    if (!mesh.current) return;
    const t = progRef.current / ASCENT_RATE;
    const u = (t - 0.9) / 1.6;
    const on = u > 0 && u < 1;
    mesh.current.visible = on;
    if (on) {
      mesh.current.scale.setScalar(0.5 + u * 7);
      mesh.current.material.opacity = 0.45 * (1 - u);
    }
  });
  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} visible={false}>
      <ringGeometry args={[0.35, 1, 48]} />
      <meshBasicMaterial color="#b8b0a4" transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

function makeGradientTexture() {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 128, 0, 0);
  g.addColorStop(0, "#000000");
  g.addColorStop(1, "#ffffff");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 128);
  return new THREE.CanvasTexture(c);
}

// Condensation trail while still in the lower atmosphere
function Contrail({ progRef }) {
  const mesh = useRef();
  const tex = useMemo(() => makeGradientTexture(), []);
  useFrame(() => {
    if (!mesh.current) return;
    const p = progRef.current;
    const alt = altitudeFor(p);
    const vis = p > 0.1 && p < 0.3;
    mesh.current.visible = vis;
    if (vis) {
      const len = Math.max(0.01, alt);
      mesh.current.scale.set(1 + len * 0.12, len, 1 + len * 0.12);
      mesh.current.position.y = len / 2 + 0.16;
      mesh.current.material.opacity =
        0.45 * Math.min(1, (0.3 - p) / 0.1) * Math.min(1, (p - 0.1) / 0.05);
    }
  });
  return (
    <mesh ref={mesh} visible={false}>
      <cylinderGeometry args={[0.16, 0.34, 1, 20, 1, true]} />
      <meshBasicMaterial
        color="#dfe5ea"
        transparent
        opacity={0}
        side={THREE.DoubleSide}
        depthWrite={false}
        alphaMap={tex}
      />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */

function CloudLayer({ progRef }) {
  const groupRef = useRef();
  const clouds = useMemo(() => {
    const arr = [];
    const rand = mulberry(21);
    for (let i = 0; i < 22; i++) {
      arr.push({
        x: (rand() - 0.5) * 26,
        y: rand() * 6 - 1,
        z: (rand() - 0.5) * 22 - 2,
        s: 0.8 + rand() * 2.0,
      });
    }
    return arr;
  }, []);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const p = progRef.current;
    groupRef.current.position.y = -p * 14;
    groupRef.current.visible = p < 0.28;
    const fade = 0.3 * Math.min(1, Math.max(0, (0.28 - p) / 0.1));
    groupRef.current.children.forEach((c) => {
      c.position.x += delta * 0.12;
      if (c.position.x > 15) c.position.x = -15;
      c.material.opacity = fade;
    });
  });

  return (
    <group ref={groupRef}>
      {clouds.map((c, i) => (
        <mesh key={i} position={[c.x, c.y, c.z]} scale={[c.s, c.s * 0.35, c.s]}>
          <sphereGeometry args={[1, 12, 10]} />
          <meshBasicMaterial color="#eef2f6" transparent opacity={0.3} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function AscentRocket({ progRef, separated, thrustEff, sepRef, altRef }) {
  const groupRef = useRef();
  useFrame(() => {
    if (!groupRef.current) return;
    const p = progRef.current;
    const alt = altitudeFor(p);
    altRef.current = alt + 0.16;
    groupRef.current.position.y = alt + 0.16;
    groupRef.current.rotation.z = Math.sin(p * 3) * 0.02;
  });
  return (
    <group ref={groupRef}>
      <RocketModel separated={separated} thrust={thrustEff} sepRef={sepRef} scale={0.6} />
    </group>
  );
}

const _dp = new THREE.Vector3();
const _dl = new THREE.Vector3();

function AscentCamera({ progRef, sepRef, separated }) {
  const { camera } = useThree();
  const pos = useRef(new THREE.Vector3(2.3, 0.6, 3.1));
  const look = useRef(new THREE.Vector3(0, 1.7, 0));
  const snap = useRef(true);

  useFrame((state, delta) => {
    const p = progRef.current;
    const alt = altitudeFor(p) + 0.16;
    const t = state.clock.elapsedTime;

    if (separated) {
      const s = sepRef.current;
      // Stage 1 offset in world units (mirrors RocketModel: (0.85e, -3.1e) x 0.6 scale)
      const e = 1 - Math.pow(1 - s, 3);
      const s1y = alt + 0.89 - e * 1.86;
      const s1x = e * 0.51;
      const s2y = alt + 2.12;
      if (s < 0.12) {
        // Close engineering view on the separation plane as the joint opens
        _dp.set(0.7, alt + 1.35, 2.5);
        _dl.set(0.1, alt + 1.5, 0);
      } else if (s < 0.62) {
        // Two-stage composition: frame the midpoint, widen as the gap grows
        const u = smooth((s - 0.12) / 0.5);
        const my = (s1y + s2y) / 2;
        const mx = s1x / 2;
        _dp.set(mx + 1.2 + u * 0.8, my + 0.9, 3.4 + u * 2.6);
        _dl.set(mx, my, 0);
      } else {
        // Favor the active upper stage; spent stage recedes below
        const u = smooth((s - 0.62) / 0.38);
        _dp.set(lerp(2.2, 2.6, u), s2y + lerp(1.0, 1.5, u), lerp(6.0, 5.2, u));
        _dl.set(0, lerp((s1y + s2y) / 2, s2y - 0.2, u), 0);
      }
    } else if (p < 0.03) {
      // Documentary low pad shot: camera near the apron so the tower sets the scale
      _dp.set(1.9 + Math.sin(t * 0.4) * 0.04, 0.32, 3.3 + Math.cos(t * 0.33) * 0.04);
      _dl.set(0.2, 1.9, 0);
    } else if (p < 0.35) {
      // Track the climb, slowly dollying back
      const u = smooth((p - 0.03) / 0.32);
      _dp.set(lerp(2.2, 5.6, u), Math.max(0.45, alt * 0.8 + 0.5), lerp(3.4, 6.0, u));
      _dl.set(0, alt + 1.3, 0);
    } else {
      // MECO: engineering view of the engine section and interstage, slow arc.
      // The frame is offset so the vehicle sits left of the crew-action prompt.
      // Camera below the engine plane looks up into the bells.
      const a = 0.9 + t * 0.05;
      _dp.set(Math.sin(a) * 2.7, alt - 0.75, Math.cos(a) * 2.7);
      _dl.set(Math.cos(a) * 1.0, alt + 0.2, -Math.sin(a) * 1.0);
    }

    if (snap.current) {
      pos.current.copy(_dp);
      look.current.copy(_dl);
      snap.current = false;
    } else {
      const k = Math.min(1, delta * (separated ? 2.2 : 1.6));
      pos.current.lerp(_dp, k);
      look.current.lerp(_dl, k);
    }
    camera.position.copy(pos.current);
    camera.lookAt(look.current);
  });
  return null;
}

/* ------------------------------------------------------------------ */

// The existing cool back-fill light strengthens into a rim light in near-space (no extra light cost).
function RimLight({ progRef }) {
  const ref = useRef();
  useFrame(() => {
    if (ref.current) ref.current.intensity = 0.3 + 1.1 * smooth((progRef.current - 0.25) / 0.12);
  });
  return <directionalLight ref={ref} position={[-6, 4, -8]} intensity={0.3} color="#9fb8dc" />;
}

function Scene({ progress, separated, thrust }) {
  const progRef = useRef(progress);
  progRef.current = progress;
  const sepRef = useRef(0);
  const altRef = useRef(0.16);

  const tIg = progress / ASCENT_RATE;
  const thrustEff = THREE.MathUtils.clamp((tIg - 0.18) / 0.4, 0, 1) * thrust;

  return (
    <>
      <SkyDome progRef={progRef} />
      {progress > 0.45 && (
        <Stars radius={100} depth={50} count={4000} factor={2.5} saturation={0} fade speed={0.2} />
      )}
      <ambientLight intensity={0.4} />
      <directionalLight position={[10, 8, 8]} intensity={2.2} color="#fff2e2" />
      <RimLight progRef={progRef} />
      <EarthCurve progRef={progRef} />
      <LaunchComplex progRef={progRef} />
      <PadSmoke progRef={progRef} />
      <DustRing progRef={progRef} />
      <IgnitionFlash progRef={progRef} />
      <Contrail progRef={progRef} />
      <CloudLayer progRef={progRef} />
      <AscentRocket
        progRef={progRef}
        separated={separated}
        thrustEff={thrustEff}
        sepRef={sepRef}
        altRef={altRef}
      />
      <AscentCamera progRef={progRef} sepRef={sepRef} separated={separated} />
    </>
  );
}

export default function AscentScene({ progress, separated = false, thrust = 1 }) {
  return (
    <div className="absolute inset-0 canvas-host" data-testid="ascent-canvas">
      <Canvas
        camera={{ position: [2.3, 0.6, 3.1], fov: 55 }}
        dpr={[1, 2]}
        gl={{
          antialias: true,
          alpha: false,
          toneMapping: THREE.ACESFilmicToneMapping,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        onCreated={({ gl }) => gl.setClearColor("#3a6db4")}
      >
        <Suspense fallback={null}>
          <Scene progress={progress} separated={separated} thrust={thrust} />
        </Suspense>
      </Canvas>
    </div>
  );
}
