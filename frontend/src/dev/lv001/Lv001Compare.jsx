import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import RocketModel, { setRocketTextureAnisotropy } from "@/components/RocketModel";
import LaunchComplex from "@/components/scenes/LaunchComplex";
import { createEnvironment, R as ENV_R, KM_PER_UNIT } from "@/components/scenes/launch/environment";
import { UNIT_M } from "@/data/launchTimeline";
import { ROCKET_SCALE } from "@/data/preLaunch";
import Lv001Prototype, { lv001LoadStats } from "./Lv001Prototype";

/*
 * DEVELOPMENT ONLY (App.js mounts it at /dev/lv001 when NODE_ENV is development; production
 * builds never import it): LV-001 as it is (model A, RocketModel) against the Blender prototype
 * (model B, art/lv001 -> lv001_prototype.glb) in LUNAVIA's own renderer, on the pad, under the
 * launch film's pad lighting: the same Sun, ambient and hemisphere fill, day sky reflections
 * (environmentIntensity 0.85, as the film on the pad), ACES tone mapping, exposure 1, the
 * true-scale environment composited behind, LaunchComplex, the vehicle at BASE_Y on the deck,
 * its meshes casting shadows. Nothing differs between A and B but the vehicle.
 *
 * ?model=a|b  ?view=1..6  ?solo=1 (vehicle only: no complex, no environment — for counting the
 * vehicle's own draw calls)  ?sep=<0..2>&les=<s>&gap=<m> (separation interface check)
 * window.__lvFreeze = true stops the render loop (screenshots under a software renderer).
 * window.__lvCompare: { ready, model, view, calls, tris, textures, geometries, programs,
 *   texBytes, geoBytes, loadMs, firstFrameMs, frameMs }.
 */

const GL = { antialias: true, alpha: false, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace, powerPreference: "high-performance", preserveDrawingBuffer: true }; // capture tooling reads the canvas
const SUN = new THREE.Vector3(10, 8, 8).normalize();
const K_ENV = UNIT_M / 1000 / KM_PER_UNIT;
const BASE_Y = 0.16; // LaunchCinematic: hold-down height of the vehicle base on the deck

// Views (scene units). 2 and 3 are the launch film's own pad shots ("wide", "engines" at u = 0).
export const VIEWS = {
  1: { name: "full vehicle from ground level", pos: [-3.3, 0.06, 4.9], look: [0, 1.85, 0], fov: 42 },
  2: { name: "rocket and tower (film: wide)", pos: [17, 2.4, 23], look: [0.6, 2.0, -0.6], fov: 21 },
  3: { name: "engine section (film: engines)", pos: [0.3, -0.06, 0.31], look: [-0.04, 0.04, -0.04], fov: 64 },
  4: { name: "first-stage body", pos: [-1.05, 1.0, 1.35], look: [0, 1.0, 0], fov: 40 },
  5: { name: "interstage", pos: [-0.72, 1.8, 0.92], look: [0, 1.76, 0], fov: 40 },
  6: { name: "upper stage and payload", pos: [-1.35, 2.75, 1.55], look: [0, 2.75, 0], fov: 46 },
};

function buildDaySky(gl) {
  // the launch film's day env map (LaunchCinematic buildEnvMaps "day")
  const s = new THREE.Scene();
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vP; void main(){ vec3 d = normalize(vP);
        vec3 zen = vec3(0.16,0.32,0.62), hor = vec3(0.8,0.85,0.9), gnd = vec3(0.24,0.22,0.18);
        vec3 c = d.y > 0.0 ? mix(hor, zen, pow(d.y, 0.55)) : mix(hor * 0.7, gnd, pow(-d.y, 0.35));
        float sun = pow(max(dot(d, normalize(vec3(10.0, 8.0, 8.0))), 0.0), 220.0);
        gl_FragColor = vec4(c + vec3(6.0, 5.6, 5.0) * sun, 1.0); }`,
    })
  );
  s.add(m);
  const pm = new THREE.PMREMGenerator(gl);
  const rt = pm.fromScene(s, 0.02);
  pm.dispose();
  m.geometry.dispose();
  m.material.dispose();
  return rt;
}

function vehicleStats(root) {
  const tex = new Set();
  const geo = new Set();
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    geo.add(o.geometry);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => {
      ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "bumpMap", "emissiveMap", "alphaMap", "clearcoatNormalMap"].forEach((k) => m && m[k] && tex.add(m[k]));
    });
  });
  // GPU bytes: compressed textures (KTX2) by their transcoded mip data, others as RGBA8 + mips
  let texBytes = 0;
  tex.forEach((t) => {
    if (t.isCompressedTexture && t.mipmaps && t.mipmaps.length) {
      t.mipmaps.forEach((m) => (texBytes += m.data ? m.data.byteLength : 0));
      return;
    }
    const im = t.image;
    if (im && im.width) texBytes += im.width * im.height * 4 * (t.generateMipmaps !== false ? 4 / 3 : 1);
  });
  let geoBytes = 0;
  geo.forEach((g) => {
    Object.values(g.attributes).forEach((a) => (geoBytes += a.array.byteLength));
    if (g.index) geoBytes += g.index.array.byteLength;
  });
  return { textures: tex.size, texBytes, geometries: geo.size, geoBytes };
}

function CompareScene({ model, view, solo, ctrl }) {
  const { gl, scene, camera } = useThree();
  const setFrameloop = useThree((s) => s.setFrameloop);
  const sunRef = useRef();
  const vehRef = useRef();
  const padProg = useRef(0);
  const ctrlRef = useRef(ctrl);
  const st = useRef({ t0: performance.now(), ready: model === "a", readyAt: model === "a" ? performance.now() : 0, frames: 0, first: 0, acc: [] });
  const anisotropy = useMemo(() => Math.min(8, gl.capabilities.getMaxAnisotropy()), [gl]);
  useEffect(() => setRocketTextureAnisotropy(anisotropy), [anisotropy]);
  const env = useMemo(() => createEnvironment(), []);
  const sky = useMemo(() => buildDaySky(gl), [gl]);
  useEffect(() => {
    scene.environment = sky.texture;
    scene.environmentIntensity = 0.85; // the film's pad value
    gl.toneMappingExposure = 1;
    return () => {
      scene.environment = null;
      env.dispose();
      sky.dispose();
    };
  }, [gl, scene, env, sky]);
  useEffect(() => {
    const l = sunRef.current;
    l.castShadow = true;
    l.shadow.mapSize.set(1536, 1536);
    const c = l.shadow.camera;
    c.left = -3.2;
    c.right = 3.2;
    c.top = 5.2;
    c.bottom = -2.2;
    c.near = 1;
    c.far = 60;
    c.updateProjectionMatrix();
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.02;
    l.target.position.set(0.6, 1.4, 0);
    l.target.updateMatrixWorld();
  }, []);
  useEffect(() => {
    if (model === "a")
      vehRef.current?.traverse((o) => {
        if (o.isMesh && o.material && o.material.isMeshStandardMaterial) o.castShadow = true;
      });
  }, [model]);
  const onReady = useCallback(() => {
    st.current.ready = true;
    st.current.readyAt = performance.now();
  }, []);

  useFrame((state, dt) => {
    if (window.__lvFreeze) {
      // capture tooling: stop rendering, the canvas keeps the last frame
      setFrameloop("never");
      return;
    }
    const V = VIEWS[view];
    camera.position.set(...V.pos);
    camera.lookAt(...V.look);
    if (camera.fov !== V.fov || camera.near !== 0.05) {
      camera.fov = V.fov;
      camera.near = 0.05;
      camera.far = 4000;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    gl.autoClear = false;
    gl.clear(true, true, true);
    if (!solo) {
      const envPos = new THREE.Vector3(camera.position.x * K_ENV, ENV_R + camera.position.y * K_ENV, camera.position.z * K_ENV);
      env.update({ camPos: envPos, camQuat: camera.quaternion.clone(), main: camera, altKm: Math.max(0.002, (camera.position.y * UNIT_M) / 1000), sun: SUN });
      gl.render(env.scene, env.camera);
      gl.clearDepth();
    }
    gl.info.reset();
    gl.info.autoReset = false;
    gl.render(scene, camera);
    gl.info.autoReset = true;
    const S = st.current;
    if (S.ready) {
      S.frames += 1;
      if (S.frames === 2) S.first = performance.now();
      if (S.frames > 40 && S.acc.length < 120) S.acc.push(dt * 1000); // steady state: after uploads and shader compiles
      if (S.frames === 3 || S.frames % 30 === 0) {
        const vs = vehRef.current ? vehicleStats(vehRef.current) : {};
        const acc = S.acc.slice().sort((a, b) => a - b);
        window.__lvCompare = {
          ready: S.frames > 3,
          model,
          view,
          solo,
          calls: gl.info.render.calls,
          tris: gl.info.render.triangles,
          programs: gl.info.programs ? gl.info.programs.length : null,
          ...vs,
          glbBytes: model === "b" ? lv001LoadStats.bytes : 0,
          fetchMs: model === "b" ? lv001LoadStats.fetchMs : 0,
          parseMs: model === "b" ? lv001LoadStats.parseMs : 0,
          firstFrameMs: S.first - S.t0,
          frameMs: acc.length ? acc[Math.floor(acc.length / 2)] : null,
          frameSamples: acc.length,
        };
      }
    }
  }, 1);

  return (
    <>
      <ambientLight intensity={0.2} />
      <directionalLight ref={sunRef} position={[10, 8, 8]} intensity={2.4} color="#fff2e2" />
      <hemisphereLight args={["#bcd3f0", "#5a5040", 0.25]} />
      {!solo && <LaunchComplex progRef={padProg} anisotropy={anisotropy} />}
      <group ref={vehRef} position={[0, BASE_Y, 0]}>
        {model === "a" ? <RocketModel scale={ROCKET_SCALE} ctrlRef={ctrlRef} /> : <Lv001Prototype scale={ROCKET_SCALE} ctrlRef={ctrlRef} anisotropy={anisotropy} onReady={onReady} />}
      </group>
    </>
  );
}

export default function Lv001Compare() {
  const q = useMemo(() => new URLSearchParams(window.location.search), []);
  const model = q.get("model") === "b" ? "b" : "a";
  const view = Math.min(6, Math.max(1, Number(q.get("view")) || 1));
  const solo = q.get("solo") === "1";
  const ctrl = useMemo(
    () => ({ engines: [0, 0, 0, 0, 0], glow: 0, sep: Number(q.get("sep")) || 0, upper: 0, showStage1: true, expand: 0, les: Number(q.get("les")) || 0, stageGap: Number(q.get("gap")) || 0, td: null }),
    [q]
  );
  const label = q.get("label") !== "0";
  return (
    <main className="fixed inset-0 bg-black" data-testid="lv001-compare">
      <Canvas dpr={Number(q.get("dpr")) || [1, 2]} shadows camera={{ fov: 40, near: 0.05, far: 4000 }} gl={GL} onCreated={({ gl }) => gl.setClearColor("#000000")}>
        <Suspense fallback={null}>
          <CompareScene model={model} view={view} solo={solo} ctrl={ctrl} />
        </Suspense>
      </Canvas>
      {label && (
        <div className="absolute top-2 left-2 bg-black/60 px-2 py-1 font-mono text-[11px] tracking-[0.2em] text-white pointer-events-none">
          {model === "a" ? "A · LV-001 CURRENT" : "B · LV-001 BLENDER PROTOTYPE"} · VIEW {view} · {VIEWS[view].name.toUpperCase()}
        </div>
      )}
    </main>
  );
}
