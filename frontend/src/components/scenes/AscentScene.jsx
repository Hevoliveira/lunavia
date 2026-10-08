import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import { useRef, useMemo, useEffect, Suspense } from "react";
import * as THREE from "three";
import RocketModel, { setRocketTextureAnisotropy } from "@/components/RocketModel";
import LaunchComplex from "@/components/scenes/LaunchComplex";
import { framePoints, centreViewOn } from "@/lib/cameraFraming";

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
function EarthCurve({ progRef, anisotropy = 1 }) {
  const shellRef = useRef();
  const earthTex = useMemo(() => makeEarthTexture(), []);
  useEffect(() => {
    earthTex.anisotropy = anisotropy;
    earthTex.needsUpdate = true;
  }, [earthTex, anisotropy]);
  useEffect(() => () => earthTex.dispose(), [earthTex]);
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

/*
 * Image-based lighting from a procedural sky (no downloaded HDR): metals and
 * paint get real reflections of sky, horizon and ground. Built once with
 * PMREM; its strength fades from the pad to near-space.
 */
function SkyEnvironment({ progRef }) {
  const { gl, scene } = useThree();
  const envTex = useMemo(() => {
    const envScene = new THREE.Scene();
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(10, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying vec3 vP;
          void main(){
            vec3 d = normalize(vP);
            vec3 zen = vec3(0.16,0.32,0.62), hor = vec3(0.78,0.84,0.9), gnd = vec3(0.22,0.2,0.17);
            vec3 c = d.y > 0.0 ? mix(hor, zen, pow(d.y, 0.55)) : mix(hor * 0.7, gnd, pow(-d.y, 0.35));
            float sun = pow(max(dot(d, normalize(vec3(10.0, 8.0, 8.0))), 0.0), 220.0);
            gl_FragColor = vec4(c + vec3(6.0, 5.6, 5.0) * sun, 1.0);
          }`,
      })
    );
    envScene.add(sky);
    const pmrem = new THREE.PMREMGenerator(gl);
    const rt = pmrem.fromScene(envScene, 0.02);
    pmrem.dispose();
    sky.geometry.dispose();
    sky.material.dispose();
    return rt;
  }, [gl]);
  useEffect(() => {
    scene.environment = envTex.texture;
    return () => {
      scene.environment = null;
      envTex.dispose();
    };
  }, [scene, envTex]);
  useFrame(() => {
    scene.environmentIntensity = THREE.MathUtils.lerp(0.85, 0.22, smooth((progRef.current - 0.12) / 0.3));
  });
  return null;
}

// Shadow casting for the vehicle on the pad; the shadow map stops updating
// once the pad is out of view so it costs nothing in flight.
function PadShadows({ progRef, lightRef }) {
  const { gl } = useThree();
  useEffect(() => {
    const l = lightRef.current;
    if (!l) return;
    l.castShadow = true;
    l.shadow.mapSize.set(1536, 1536);
    const c = l.shadow.camera;
    c.left = -3.2;
    c.right = 3.2;
    c.top = 5.2;
    c.bottom = -2.2;
    c.near = 1;
    c.far = 30;
    c.updateProjectionMatrix();
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.02;
    l.target.position.set(0.6, 1.4, 0);
    l.target.updateMatrixWorld();
  }, [lightRef]);
  useFrame(() => {
    gl.shadowMap.autoUpdate = progRef.current < 0.3;
  });
  return null;
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
  const smokeRef = useRef();
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
    // Pad smoke stays at the pad: fade it out with the pad structures so the
    // downward-looking staging shots never show it hanging in space.
    const fade = 1 - smooth((progRef.current - 0.26) / 0.06);
    mat.uniforms.uOpacity.value = 0.8 * fade;
    if (smokeRef.current) smokeRef.current.visible = fade > 0.01;
  });

  return <instancedMesh ref={smokeRef} args={[geo, mat, SMOKE_COUNT]} frustumCulled={false} renderOrder={5} />;
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

function AscentRocket({ progRef, separated, thrustEff, sepRef, altRef, rigRef }) {
  const groupRef = useRef();
  useEffect(() => {
    groupRef.current?.traverse((o) => {
      if (o.isMesh && o.material && o.material.isMeshStandardMaterial) o.castShadow = true;
    });
  }, []);
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
      <RocketModel separated={separated} thrust={thrustEff} sepRef={sepRef} scale={0.6} rigRef={rigRef} />
    </group>
  );
}

/*
 * Cinematography. Every beat names the hardware it must show (points in the
 * vehicle's own frame, read through the rocket rig so tumbling and recession
 * are tracked exactly) and a viewing direction. The camera distance is solved
 * so those points fit inside the screen area the HUD leaves free, and the
 * image centre is moved into that area. Beats blend with exponential
 * smoothing: no cuts, no shake.
 *
 *   PAD       low documentary angle, full stack + umbilical tower
 *   CLIMB     tracking the stack and the near plume, slowly rising
 *   MECO      engineering view of the engine section, engines off
 *             (left third: the crew-action prompt owns the centre)
 *   IMPULSE   the separation plane as the joint opens and retros fire
 *   STAGES    both stages whole, gap opening, Earth below for scale
 *   RECEDE    spent stage tumbling away while the upper stage lights
 *   ACTIVE    the burning upper stage carries the frame
 */
const HUD_TOP = 0.14; // top band used by the mission HUD on every screen size
const FULL = { x0: 0.03, x1: 0.97, y0: HUD_TOP, y1: 0.98 };
const PROMPT_SIDE = { x0: 0.03, x1: 0.36, y0: HUD_TOP, y1: 0.98 };
const dirOf = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
const DIRS = {
  pad: dirOf(0.42, -0.2, 0.88),
  climb0: dirOf(0.5, -0.12, 0.86),
  climb1: dirOf(0.62, 0.05, 0.78),
  meco: dirOf(0.62, -0.42, 0.66),
  impulse: dirOf(0.8, -0.16, 0.58),
  stages: dirOf(0.74, 0.36, 0.57),
  recede: dirOf(0.66, 0.44, 0.61),
  active: dirOf(0.62, 0.3, 0.72),
};
// Hardware stations in model units (RocketModel, before the 0.6 scale)
const S1 = { bells: -0.38, aft: 0.05, lowTank: 1.4, top: 2.88 };
const S2 = { bell: 2.12, low: 3.3, tip: 5.76, plume: 1.0 };

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _rot = new THREE.Quaternion();
const _goalPos = new THREE.Vector3();
const _goalLook = new THREE.Vector3();
const _sol = { center: new THREE.Vector3(), dist: 0 };

function AscentCamera({ progRef, sepRef, separated, rigRef }) {
  const { camera, size } = useThree();
  const pos = useRef(null);
  const look = useRef(new THREE.Vector3());
  const rect = useRef({ ...FULL });
  const rollRef = useRef(0);
  const pool = useMemo(() => Array.from({ length: 8 }, () => ({ pos: new THREE.Vector3(), rad: 0 })), []);

  useFrame((state, delta) => {
    const rig = rigRef.current;
    if (!rig || !rig.root || !rig.stage1) return;
    const p = progRef.current;
    const t = state.clock.elapsedTime;
    rig.root.updateWorldMatrix(true, true);
    let n = 0;
    const pt = (obj, y, rad) => {
      const q = pool[n++];
      q.pos.copy(obj.localToWorld(_v.set(0, y, 0)));
      q.rad = rad;
      return q;
    };
    const tower = (y) => {
      const q = pool[n++];
      q.pos.set(1.55, y, 0);
      q.rad = 0.35;
      return q;
    };
    let pts;
    let roll = 0;
    let goalRect = FULL;
    const maxDist = 40;
    if (separated) {
      const s = sepRef.current;
      if (s < 0.14) {
        _dir.copy(DIRS.impulse);
        pts = [pt(rig.stage1, S1.lowTank + 0.4, 0.3), pt(rig.stage1, S1.top, 0.3), pt(rig.root, S2.bell, 0.25), pt(rig.root, S2.tip, 0.18)];
        roll = 0.12 * smooth(s / 0.14);
      } else if (s < 0.45) {
        _dir.copy(DIRS.impulse).lerp(DIRS.stages, smooth((s - 0.14) / 0.2)).normalize();
        pts = [pt(rig.stage1, S1.bells, 0.32), pt(rig.stage1, S1.top, 0.32), pt(rig.root, S2.bell, 0.24), pt(rig.root, S2.tip, 0.18)];
        roll = lerp(0.12, 0.4, smooth((s - 0.14) / 0.25));
      } else if (s < 0.72) {
        _dir.copy(DIRS.stages).lerp(DIRS.recede, smooth((s - 0.45) / 0.27)).normalize();
        pts = [pt(rig.stage1, S1.bells, 0.32), pt(rig.stage1, S1.top, 0.32), pt(rig.root, S2.plume, 0.3), pt(rig.root, S2.tip, 0.18)];
        roll = 0.4;
      } else {
        _dir.copy(DIRS.recede).lerp(DIRS.active, smooth((s - 0.72) / 0.28)).normalize();
        pts = [pt(rig.root, S2.plume, 0.35), pt(rig.root, S2.bell, 0.25), pt(rig.root, S2.tip, 0.18)];
        roll = lerp(0.4, 0.22, smooth((s - 0.72) / 0.28));
      }
    } else if (p >= 0.35) {
      // MECO: slow arc round the engine section, prompt-safe composition
      _dir.copy(DIRS.meco).applyQuaternion(_rot.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.sin(t * 0.12) * 0.5));
      pts = [pt(rig.stage1, S1.bells, 0.3), pt(rig.stage1, S1.aft, 0.33), pt(rig.stage1, S1.lowTank, 0.3)];
      goalRect = PROMPT_SIDE;
    } else if (p < 0.03) {
      _dir.copy(DIRS.pad);
      pts = [pt(rig.root, -0.3, 0.3), pt(rig.root, S2.tip, 0.15), tower(4.75), tower(0.2)];
    } else {
      const u = smooth((p - 0.03) / 0.32);
      _dir.copy(DIRS.climb0).lerp(DIRS.climb1, u).normalize();
      pts = [pt(rig.root, S1.bells - 1.4 * (1 - u * 0.6), 0.3), pt(rig.root, S2.tip, 0.15)];
    }

    // Blend the screen rectangle too (prompt appears / disappears)
    const r = rect.current;
    const kr = 1 - Math.exp(-delta * 3);
    r.x0 += (goalRect.x0 - r.x0) * kr;
    r.x1 += (goalRect.x1 - r.x1) * kr;
    r.y0 += (goalRect.y0 - r.y0) * kr;
    r.y1 += (goalRect.y1 - r.y1) * kr;

    // Smoothed roll (documentary diagonal for the separation beats; level otherwise)
    rollRef.current += (roll - rollRef.current) * (1 - Math.exp(-delta * 2.5));
    framePoints(pts, _dir, camera.fov, size.width / size.height, r, 0.88, _sol, rollRef.current);
    const dist = THREE.MathUtils.clamp(_sol.dist, 1.6, maxDist);
    _goalPos.copy(_dir).multiplyScalar(dist).add(_sol.center);
    _goalLook.copy(_sol.center);
    // Keep the camera above the pad surface
    _goalPos.y = Math.max(_goalPos.y, 0.25);

    if (!pos.current) {
      pos.current = _goalPos.clone();
      look.current.copy(_goalLook);
    } else {
      const k = 1 - Math.exp(-delta * (separated ? 3.6 : 2.4));
      pos.current.lerp(_goalPos, k);
      look.current.lerp(_goalLook, k);
    }
    camera.position.copy(pos.current);
    camera.lookAt(look.current);
    if (rollRef.current) camera.rotateZ(rollRef.current); // same sense as the framing basis
    centreViewOn(camera, size.width, size.height, r);
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
  const rigRef = useRef(null);
  const sunRef = useRef();
  const { gl } = useThree();
  const anisotropy = useMemo(() => Math.min(8, gl.capabilities.getMaxAnisotropy()), [gl]);
  useEffect(() => setRocketTextureAnisotropy(anisotropy), [anisotropy]);
  const three = useThree();
  useEffect(() => {
    // Development-only handle for render measurements (stripped from production builds).
    if (process.env.NODE_ENV !== "production") window.__lvAscent = { gl: three.gl, scene: three.scene, camera: three.camera, rigRef, sepRef };
  }, [three]);

  const tIg = progress / ASCENT_RATE;
  const thrustEff = THREE.MathUtils.clamp((tIg - 0.18) / 0.4, 0, 1) * thrust;

  return (
    <>
      <SkyDome progRef={progRef} />
      {progress > 0.45 && (
        <Stars radius={100} depth={50} count={4000} factor={2.5} saturation={0} fade speed={0.2} />
      )}
      <SkyEnvironment progRef={progRef} />
      <ambientLight intensity={0.22} />
      <directionalLight ref={sunRef} position={[10, 8, 8]} intensity={2.4} color="#fff2e2" />
      <PadShadows progRef={progRef} lightRef={sunRef} />
      <RimLight progRef={progRef} />
      <EarthCurve progRef={progRef} anisotropy={anisotropy} />
      <LaunchComplex progRef={progRef} anisotropy={anisotropy} />
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
        rigRef={rigRef}
      />
      <AscentCamera progRef={progRef} sepRef={sepRef} separated={separated} rigRef={rigRef} />
    </>
  );
}

export default function AscentScene({ progress, separated = false, thrust = 1 }) {
  return (
    <div className="absolute inset-0 canvas-host" data-testid="ascent-canvas">
      <Canvas
        camera={{ position: [2.3, 0.6, 3.1], fov: 55 }}
        dpr={[1, 2]}
        shadows
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
