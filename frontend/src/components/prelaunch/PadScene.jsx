import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import RocketModel, { setRocketTextureAnisotropy } from "@/components/RocketModel";
import LaunchComplex from "@/components/scenes/LaunchComplex";
import { createEnvironment, R as ENV_R, KM_PER_UNIT } from "@/components/scenes/launch/environment";
import { UNIT_M } from "@/data/launchTimeline";
import { PAD_SHOT, ROCKET_SCALE, padCameraAt } from "@/data/preLaunch";
import { grimeTex, withGrime } from "./padModel";

/*
 * COUNTDOWN TO LAUNCH — the launch complex: LV-001 on its pad, seen from the hardstand in one slow
 * push in (data/preLaunch padCameraAt), before the cut into the command module.
 *
 * The same LV-001 (RocketModel, at the launch film's scale) on the same launch complex
 * (LaunchComplex, with its own crew access arm as part of the tower) under the same sky, sea and
 * Sun as the launch film's pad shots (launch/environment, composited first, then the vehicle layer
 * over a cleared depth buffer). The complex's steel carries worn paint and grime here (clones of
 * its materials; the launch film keeps its own).
 *
 * ctl (a ref the overlay shares): { t (s into the shot), onDone (called once at the shot's end) }.
 */
const K_ENV = UNIT_M / 1000 / KM_PER_UNIT; // env units per scene unit
const SUN = new THREE.Vector3(10, 8, 8).normalize();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** A small sky for the materials' reflections (the launch film's own day sky, as an env map). */
function daySkyEnv(gl) {
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

export default function PadScene({ ctl }) {
  const { gl, camera, scene } = useThree();
  const sunRef = useRef();
  const complexRef = useRef();
  const rocketRef = useRef();
  const padProg = useRef(0);
  const ctrlRef = useRef({ engines: [0, 0, 0, 0, 0], glow: 0, sep: 0, upper: 0, showStage1: true, expand: 0 });
  const anisotropy = useMemo(() => Math.min(8, gl.capabilities.getMaxAnisotropy()), [gl]);
  useEffect(() => setRocketTextureAnisotropy(anisotropy), [anisotropy]);
  const env = useMemo(() => createEnvironment(), []);
  const sky = useMemo(() => daySkyEnv(gl), [gl]);

  useEffect(() => {
    scene.environment = sky.texture;
    return () => {
      scene.environment = null;
    };
  }, [scene, sky]);
  // the launch complex up close: its steel, decks, tanks and buildings with worn paint and grime
  // (clones for this scene only; the launch film keeps the complex's own materials)
  useEffect(() => {
    const root = complexRef.current;
    if (!root) return undefined;
    const tex = grimeTex();
    const made = new Map();
    const swapped = [];
    const STRENGTH = { "9aa0a6": 1, "4d5257": 0.9, cfd2d4: 0.55, e6e5e0: 0.5 };
    root.traverse((o) => {
      if (!o.isMesh || !o.material || Array.isArray(o.material) || !o.material.isMeshStandardMaterial) return;
      const m = o.material;
      const hex = m.color.getHexString();
      const k = STRENGTH[hex] != null ? STRENGTH[hex] : m.map && m.metalness > 0.4 ? 0.7 : null;
      if (k == null) return;
      if (!made.has(m)) made.set(m, withGrime(m, tex, { strength: k, metres: hex === "e6e5e0" ? 3.5 : 2.2 }));
      o.material = made.get(m);
      swapped.push([o, m]);
    });
    return () => {
      swapped.forEach(([o, m]) => (o.material = m));
      made.forEach((c) => c.dispose());
      tex.dispose();
    };
  }, []);
  // the vehicle casts the Sun's shadow on the deck, as in the launch film
  useEffect(() => {
    rocketRef.current?.traverse((o) => {
      if (o.isMesh && o.material && o.material.isMeshStandardMaterial) o.castShadow = true;
    });
  }, []);
  useEffect(
    () => () => {
      env.dispose();
      sky.dispose();
    },
    [env, sky]
  );
  useEffect(() => {
    const l = sunRef.current;
    if (!l) return;
    l.castShadow = true;
    l.shadow.mapSize.set(2048, 2048);
    l.shadow.bias = -0.0003;
    l.shadow.normalBias = 0.01;
    const sc = l.shadow.camera;
    sc.left = -3.2;
    sc.right = 3.2;
    sc.top = 5.2;
    sc.bottom = -2.2;
    sc.near = 0.05;
    sc.far = 60;
    sc.updateProjectionMatrix();
    l.position.set(0.6, 1.4, 0).addScaledVector(SUN, 12);
    l.target.position.set(0.6, 1.4, 0);
    l.target.updateMatrixWorld();
  }, []);

  useFrame((state, dt0) => {
    const c = ctl.current;
    const dt = Math.min(0.1, dt0);
    c.t += dt;
    if (c.t >= PAD_SHOT.dur && c.onDone) {
      const f = c.onDone;
      c.onDone = null;
      f();
    }
    const cam = padCameraAt(Math.min(c.t, PAD_SHOT.dur));
    camera.position.set(...cam.pos);
    camera.lookAt(...cam.look);
    // validation tooling may hold the camera (window.__lvPrelaunchCam = { pos, look } in metres)
    const hold = typeof window !== "undefined" ? window.__lvPrelaunchCam : null;
    if (hold && hold.pos && hold.look) {
      camera.position.set(hold.pos[0] / UNIT_M, hold.pos[1] / UNIT_M, hold.pos[2] / UNIT_M);
      camera.lookAt(hold.look[0] / UNIT_M, hold.look[1] / UNIT_M, hold.look[2] / UNIT_M);
    }
    if (Math.abs(camera.fov - cam.fov) > 1e-3 || camera.near !== 0.01 || camera.far !== 300) {
      camera.fov = cam.fov;
      camera.near = 0.01;
      camera.far = 300;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();

    // the environment (true-scale sky, sea and horizon), then the vehicle layer over it
    const envPos = _w.set(camera.position.x * K_ENV, ENV_R + camera.position.y * K_ENV, camera.position.z * K_ENV);
    const altKm = Math.max(0.002, (camera.position.y * UNIT_M) / 1000);
    _q.copy(camera.quaternion);
    env.update({ camPos: envPos, camQuat: _q, main: camera, altKm, sun: SUN });
    gl.autoClear = false;
    gl.clear(true, true, true);
    gl.render(env.scene, env.camera);
    gl.clearDepth();
    gl.render(scene, camera);
    if (typeof window !== "undefined") {
      const w = window.__lvPrelaunch || (window.__lvPrelaunch = {});
      w.pad = { t: c.t, cam: camera.position.toArray().map((x) => x * UNIT_M), calls: gl.info.render.calls, tris: gl.info.render.triangles };
    }
  }, 1);

  return (
    <>
      <ambientLight intensity={0.22} />
      <hemisphereLight args={["#bcd3f0", "#5a5040", 0.32]} />
      <directionalLight ref={sunRef} position={[10, 8, 8]} intensity={2.4} color="#fff2e2" />
      <group ref={complexRef}>
        <LaunchComplex progRef={padProg} anisotropy={anisotropy} />
      </group>
      {/* LV-001 on the deck, as in the launch film (its base held at the launcher's height) */}
      <group ref={rocketRef} position={[0, 0.16, 0]}>
        <RocketModel scale={ROCKET_SCALE} ctrlRef={ctrlRef} />
      </group>
    </>
  );
}
