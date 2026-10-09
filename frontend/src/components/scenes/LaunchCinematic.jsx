import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef, useState, Suspense } from "react";
import * as THREE from "three";
import RocketModel, { setRocketTextureAnisotropy } from "@/components/RocketModel";
import LaunchComplex from "@/components/scenes/LaunchComplex";
import { framePoints, centreViewOn } from "@/lib/cameraFraming";
import { ParticlePool } from "@/components/scenes/launch/particles";
import { createEnvironment, R as ENV_R, KM_PER_UNIT } from "@/components/scenes/launch/environment";
import * as TL from "@/data/launchTimeline";

/*
 * LaunchCinematic — automatic Earth departure of LV-001, from T-15 on the pad
 * to translunar injection. Driven entirely by data/launchTimeline; the player
 * watches (a discreet SKIP is offered) and takes control only at the Moon.
 *
 * Rendering is two layers composited every frame:
 *  1. Environment (true scale, see launch/environment): sky, atmosphere,
 *     planet, limb, Sun, stars and low clouds, seen from a camera that rides
 *     the trajectory at the true altitude and downrange distance.
 *  2. Vehicle layer: LV-001, the launch complex and every particle effect, at
 *     pad scale (1 unit = 30 m). In flight the vehicle stays at the origin
 *     and the environment moves past it.
 * The depth buffer is cleared between the two, so a 104 m vehicle is drawn at
 * its own scale against a planet of true size.
 */

const ROCKET_SCALE = 0.6;
const BASE_Y = 0.16; // hold-down height of the vehicle base on the deck
const K_ENV = (TL.UNIT_M / 1000) / KM_PER_UNIT; // env units per vehicle unit
const SUN_ENV = new THREE.Vector3(10, 8, 8).normalize();
// Hardware stations in model units (RocketModel, before the 0.6 scale)
const S1 = { bells: -0.38, aft: 0.05, lowTank: 1.4, top: 2.88 };
const S2 = { bell: 2.12, low: 3.3, tip: 5.76 };
const FRAME = { x0: 0.04, x1: 0.96, y0: 0.15, y1: 0.86 };
const OVER = { x0: 0.04, x1: 0.96, y0: 0.15, y1: 0.97 };

const smooth = TL.smooth;
const clamp01 = TL.clamp01;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qz = new THREE.Quaternion();
const _ax = new THREE.Vector3(0, 0, 1);
const _sol = { center: new THREE.Vector3(), dist: 0 };
const _cam = { a: new THREE.Vector3(), b: new THREE.Vector3() };
const dirOf = (x, y, z) => new THREE.Vector3(x, y, z).normalize();

/* ------------------------------------------------------------------ */
/* Image-based lighting: daylight sky at the pad, Earth below in space. */

function buildEnvMaps(gl) {
  const make = (frag) => {
    const s = new THREE.Scene();
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(10, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying vec3 vP; void main(){ vec3 d = normalize(vP); ${frag} }`,
      })
    );
    s.add(m);
    const pm = new THREE.PMREMGenerator(gl);
    const rt = pm.fromScene(s, 0.02);
    pm.dispose();
    m.geometry.dispose();
    m.material.dispose();
    return rt;
  };
  const day = make(`
    vec3 zen = vec3(0.16,0.32,0.62), hor = vec3(0.8,0.85,0.9), gnd = vec3(0.24,0.22,0.18);
    vec3 c = d.y > 0.0 ? mix(hor, zen, pow(d.y, 0.55)) : mix(hor * 0.7, gnd, pow(-d.y, 0.35));
    float sun = pow(max(dot(d, normalize(vec3(10.0, 8.0, 8.0))), 0.0), 220.0);
    gl_FragColor = vec4(c + vec3(6.0, 5.6, 5.0) * sun, 1.0);`);
  const orbit = make(`
    vec3 earth = vec3(0.22,0.36,0.62), limb = vec3(0.55,0.7,1.0);
    float h = smoothstep(-0.22, 0.02, d.y) * (1.0 - smoothstep(0.02, 0.1, d.y));
    vec3 c = d.y < -0.05 ? earth * (0.7 + 0.3 * smoothstep(-1.0, -0.2, d.y)) : vec3(0.0);
    c += limb * h * 0.8;
    float sun = pow(max(dot(d, normalize(vec3(10.0, 8.0, 8.0))), 0.0), 400.0);
    gl_FragColor = vec4(c + vec3(9.0) * sun, 1.0);`);
  // Orbital sunset: night below, a warm limb towards the low Sun (behind,
  // to the south of the vehicle at that point of the orbit).
  const dusk = make(`
    vec3 s = normalize(vec3(-0.85, 0.02, 0.53));
    float toward = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(s.x, 0.0, s.z))), 0.0), 2.0);
    float band = smoothstep(-0.3, 0.0, d.y) * (1.0 - smoothstep(0.0, 0.12, d.y));
    vec3 limb = mix(vec3(1.0, 0.42, 0.12), vec3(0.35, 0.55, 1.0), smoothstep(-0.05, 0.08, d.y));
    vec3 c = d.y < -0.05 ? vec3(0.025, 0.03, 0.05) : vec3(0.0);
    c += limb * band * (0.15 + 1.2 * toward);
    float sun = pow(max(dot(d, s), 0.0), 300.0);
    gl_FragColor = vec4(c + vec3(7.0, 3.6, 1.6) * sun, 1.0);`);
  // Night pass: dark planet with a faint glow of cities, the limb brightening
  // ahead where the Sun will rise.
  const night = make(`
    float band = smoothstep(-0.28, 0.0, d.y) * (1.0 - smoothstep(0.0, 0.1, d.y));
    vec3 c = d.y < -0.05 ? vec3(0.03, 0.026, 0.024) : vec3(0.004, 0.005, 0.01);
    c += vec3(0.25, 0.32, 0.55) * band * (0.1 + 0.6 * pow(max(d.x, 0.0), 3.0));
    gl_FragColor = vec4(c, 1.0);`);
  return { day, orbit, dusk, night };
}

/* ------------------------------------------------------------------ */
/* Camera shots. Pad shots are fixed or tracking documentary set-ups;   */
/* flight shots are solved so the named hardware fits the frame.       */

const PAD_SHOTS = {
  wide: (u) => ({ pos: [17 - 2.2 * u, 2.4 - 0.3 * u, 23 - 2.8 * u], look: [0.6, 2.0, -0.6], fov: 21 }),
  lowAngle: (u) => ({ pos: [2.3 - 0.12 * u, 0.3, 3.4 - 0.12 * u], look: [0.05, 1.7 + 1.5 * u, 0], fov: 54 }),
  engines: (u) => ({ pos: [0.3 - 0.02 * u, -0.06, 0.31 - 0.02 * u], look: [-0.04, 0.04 + 0.03 * u, -0.04], fov: 64, shake: 1 }),
  trench: (u, c) => ({ pos: [2.9 - 0.2 * u, 0.7 + 0.1 * u, 7.6 - 0.4 * u], look: [0.15, Math.max(1.5, c.baseY + 1.3), -0.8], fov: 40, shake: 0.5 }),
  tower: (u, c) => ({ pos: [2.2, 1.25, 0.8], look: [c.lagX, c.lagY + 1.5, 0], fov: 60, shake: 0.35 }),
  wideAscent: (u, c) => ({ pos: [13.5, 1.0, 18.5], look: [c.lagX, c.lagY + 0.2, 0], fov: 21 - 2 * u }),
};

// Flight shots: camera directions in the local-horizon frame of the vehicle.
const FLIGHT_SHOTS = {
  highAlt: { d0: dirOf(0.55, -0.02, 0.83), d1: dirOf(0.5, 0.42, 0.76), pts: "full", roll: 0.04, rect: FRAME },
  meco: { d0: dirOf(0.2, 0.08, 0.98), d1: dirOf(0.02, 0.14, 0.99), pts: "aft", roll: 0.1, rect: FRAME },
  sepJoint: { d0: dirOf(0.1, 0.25, 0.96), d1: dirOf(-0.05, 0.3, 0.95), pts: "joint", roll: 0.14, rect: FRAME },
  stages: { d0: dirOf(-0.05, 0.38, 0.92), d1: dirOf(-0.25, 0.5, 0.83), pts: "both", roll: 0.2, rect: OVER },
  usIgnition: { d0: dirOf(-0.35, 0.28, 0.9), d1: dirOf(-0.55, 0.32, 0.77), pts: "upper", roll: 0.12, rect: FRAME },
  limb: { d0: dirOf(0.1, 0.34, 0.94), d1: dirOf(0.28, 0.3, 0.91), pts: "upperWide", roll: -0.06, rect: FRAME, extra: 1.5 },
  // Earth orbit, five compositions (A-E). Directions are camera offsets in
  // the vehicle frame: +X along the orbit, +Y local up, +Z south.
  // A: wide, the spacecraft small over the sunlit planet.
  orbitWide: { d0: dirOf(-0.42, 0.62, -0.66), d1: dirOf(-0.22, 0.66, -0.72), pts: "upperWide", roll: 0.08, rect: FRAME, extra: 3.4 },
  // B: engineering close-up of the upper stage and spacecraft, Earth sliding past.
  orbitClose: { d0: dirOf(0.32, 0.5, 0.8), d1: dirOf(0.52, 0.44, 0.73), pts: "detail", roll: -0.1, rect: FRAME, extra: 1.0 },
  // C: along the atmospheric limb ahead of the vehicle.
  orbitLimb: { d0: dirOf(-0.88, 0.4, 0.25), d1: dirOf(-0.84, 0.46, 0.28), pts: "upperWide", roll: 0.02, rect: FRAME, extra: 1.5 },
  // D: orbital sunset - the vehicle in the last warm light over the night side.
  orbitSunset: { d0: dirOf(0.42, 0.24, -0.88), d1: dirOf(0.62, 0.2, -0.76), pts: "upperWide", roll: -0.04, rect: FRAME, extra: 1.25 },
  // E: night pass, roll to burn attitude on RCS.
  tliPrep: { d0: dirOf(-0.35, 0.5, -0.79), d1: dirOf(-0.25, 0.42, -0.87), pts: "upperWide", roll: 0.06, rect: FRAME, extra: 1.15 },
  // TLI burn at orbital sunrise.
  tli: { d0: dirOf(-0.58, 0.3, -0.76), d1: dirOf(-0.74, 0.26, -0.62), pts: "upperBurn", roll: 0.04, rect: FRAME, extra: 1.2 },
  // Lunar transfer: looking back past the spacecraft at the receding Earth.
  departure: { d0: dirOf(0.3, 0.9, -0.3), d1: dirOf(0.1, 0.98, -0.16), pts: "upperWide", roll: 0.0, rect: FRAME, extra: 2.4 },
};

// The onboard camera on the spent stage, looking up its axis at the upper stage.
const STAGE1_CAM = { at: [0.85, S1.top - 0.35, 0], fov: 50 };

/* ------------------------------------------------------------------ */

function Director({ rigRef, rocketGroupRef, ctrlRef, padProg, sunRef, padLightRef, fillRefs, pools, hooks, envMaps }) {
  const { gl, scene, camera, size } = useThree();
  const setDpr = useThree((state) => state.setDpr);
  const env = useMemo(() => createEnvironment(), []);
  useEffect(() => () => env.dispose(), [env]);
  const st = useRef({ t: 0, lastShot: null, camPos: new THREE.Vector3(), look: new THREE.Vector3(), rnd: 1, fired: new Set(), acc: {}, roll: 0, done: false });
  const pool = useMemo(() => Array.from({ length: 8 }, () => ({ pos: new THREE.Vector3(), rad: 0 })), []);

  useEffect(() => {
    gl.shadowMap.autoUpdate = true;
    return () => {
      scene.environment = null;
      gl.toneMappingExposure = 1;
    };
  }, [gl, scene]);

  // Pre-pass (before RocketModel): clock, events, vehicle state, lights, particles.
  useFrame((state, rawDelta) => {
    const S = st.current;
    // Seek (validation tooling): jump to a time with the particle history rebuilt.
    let seek = typeof window !== "undefined" ? window.__lvLaunchSeek : null;
    if (seek != null) {
      window.__lvLaunchSeek = null;
      seek = Math.max(0, Math.min(TL.DURATION - 0.01, seek));
      pools.smoke.reset();
      pools.fire.reset();
      S.acc = {};
      const from = Math.max(TL.shotAt(seek).regime === "flight" ? 32 : 0, seek - 14);
      for (let x = from; x < seek; x += 1 / 30) emitParticles(x, 1 / 30, pools, S, rigRef, rocketGroupRef);
      TL.EVENTS.forEach((e) => e.t <= seek && S.fired.add(e.id));
      S.t = seek;
      S.lastShot = null;
      S.seeked = true;
    }
    // Adaptive resolution: if the device cannot hold ~45 fps (heaviest shots
    // are the smoke-filled liftoff), step the pixel ratio down once per 2 s,
    // never back up (no oscillation). __lvFixedDpr pins it for captures.
    const pf = S.perf || (S.perf = { acc: 0, n: 0, wall: 0, dpr: gl.getPixelRatio() });
    pf.wall += Math.min(rawDelta, 1);
    // Skip the shader-compile warm-up and app-switch pauses (> 1 s)
    if (pf.wall > 1.5 && rawDelta < 1) {
      pf.acc += rawDelta;
      pf.n++;
      if (pf.acc > 2) {
        const ft = pf.acc / pf.n;
        if (!(typeof window !== "undefined" && window.__lvFixedDpr) && ft > 1 / 45 && pf.dpr > 1.25) {
          pf.dpr = Math.max(1.25, pf.dpr - 0.25);
          setDpr(pf.dpr);
        }
        pf.acc = 0;
        pf.n = 0;
      }
    }
    // Validation tooling: __lvLaunchPause freezes the clock for still captures.
    const dt = typeof window !== "undefined" && window.__lvLaunchPause ? 0 : Math.min(rawDelta, 0.1);
    const prevT = S.t;
    if (!S.done && seek == null) S.t = Math.min(TL.DURATION, S.t + dt);
    const t = S.t;
    const shot = TL.shotAt(t);
    const regime = shot.regime;
    const traj = TL.trajectoryAt(t);

    // --- Events (captions, audio) ---
    for (const e of TL.EVENTS) {
      if (!S.fired.has(e.id) && e.t <= t && e.t > prevT - 1e-6) {
        S.fired.add(e.id);
        hooks.onEvent(e);
      }
    }
    if (t >= TL.DURATION && !S.done) {
      S.done = true;
      hooks.onComplete();
    }

    // --- Vehicle state ---
    const c = ctrlRef.current;
    TL.stage1EngineThrust(t, c.engines);
    c.glow = TL.stage1Glow(t);
    c.sep = TL.sepProgress(t);
    c.upper = TL.upperThrust(t);
    c.showStage1 = TL.stage1Visible(t);
    c.expand = 1 - Math.sqrt(TL.airDensity(traj.altKm));
    const g = rocketGroupRef.current;
    let baseY = BASE_Y;
    if (g) {
      // Z-Y-X: roll about the vehicle axis first, then pitch over downrange.
      g.rotation.order = "ZYX";
      if (regime === "pad") {
        baseY = BASE_Y + TL.padHeight(t);
        g.position.set(TL.padDownrange(t), baseY, 0);
        g.rotation.set(TL.twang(t), 0, -TL.padPitch(t));
      } else {
        g.position.set(0, 0, 0);
        g.rotation.set(0, traj.roll || 0, -traj.pitch);
      }
    }
    padProg.current = regime === "pad" ? 0 : 1; // LaunchComplex hides itself in flight

    // --- Lights ---
    const thrust = (c.engines[0] + c.engines[1] + c.engines[2] + c.engines[3] + c.engines[4]) / 5;
    const theta = traj.downrangeKm / 6371;
    _qz.setFromAxisAngle(_ax, theta); // env → vehicle frame (local horizon at the vehicle)
    const sunV = _v.copy(SUN_ENV).applyQuaternion(_qz);
    // In orbit the vehicle passes from day through sunset into Earth's
    // shadow and back out at sunrise: dim and redden its sunlight to match.
    const sun = regime === "pad" ? null : TL.sunAt(t);
    if (sunRef.current) {
      sunRef.current.position.copy(sunV).multiplyScalar(30);
      sunRef.current.intensity = (regime === "pad" ? 2.4 : 3.0) * (sun ? sun.lit : 1);
      const red = sun ? sun.red : 0;
      sunRef.current.color.setRGB(1, 0.949 - 0.42 * red, 0.886 - 0.66 * red);
    }
    // Sky fill fades to a faint earthshine in Earth's shadow, enough to keep
    // the vehicle's shape readable on a phone
    const fill = sun ? 0.35 + 0.65 * sun.lit : 1;
    if (fillRefs.amb.current) fillRefs.amb.current.intensity = 0.2 * fill;
    if (fillRefs.hemi.current) fillRefs.hemi.current.intensity = 0.25 * fill;
    if (padLightRef.current) {
      const flick = 0.85 + 0.15 * Math.sin(t * 37) * Math.sin(t * 23);
      const near = regime === "pad" ? 1 - smooth((TL.padHeight(t) - 4) / 12) : 0;
      padLightRef.current.intensity = 14 * thrust * near * flick * (shot.id === "engines" ? 0.45 : 1);
      padLightRef.current.position.set(0, Math.min(baseY, 3) - 0.1, 0.25);
    }
    if (envMaps) {
      let map = envMaps.day;
      let k = THREE.MathUtils.lerp(0.85, 0.32, smooth((traj.altKm - 9) / 45));
      if (t >= 43) {
        if (sun.lit < 0.5) [map, k] = [envMaps.night, 0.4];
        else if (sun.red > 0.35) [map, k] = [envMaps.dusk, 0.5];
        else [map, k] = [envMaps.orbit, 0.55];
      }
      scene.environment = map.texture;
      scene.environmentIntensity = k;
    }
    gl.shadowMap.autoUpdate = regime === "pad" && t < 27;
    // Camera exposure: the close cameras flare as the engines come up to
    // thrust (and the onboard camera when the upper stage lights above it).
    let expo = 1;
    if (shot.id === "engines") expo = 1 + 0.5 * thrust;
    else if (shot.id === "trench") expo = 1 + 0.25 * thrust * (1 - smooth((TL.padHeight(t) - 1) / 4));
    else if (shot.id === "stage1Cam") expo = 1 + 0.45 * TL.upperThrust(t);
    gl.toneMappingExposure = expo;

    // --- Particles ---
    if (S.lastShot && S.lastShot.regime !== regime) {
      pools.smoke.reset();
      pools.fire.reset();
    }
    if (!S.seeked) emitParticles(t, t - prevT, pools, S, rigRef, rocketGroupRef);
    S.seeked = false;
    const glowPos = _w.set(g ? g.position.x : 0, baseY - 0.25, 0);
    [pools.smoke, pools.fire].forEach((p) => {
      p.material.uniforms.uGlowPos.value.copy(glowPos);
      p.material.uniforms.uGlow.value = thrust * (regime === "pad" ? 1.5 : 0.5) * (1 - c.expand * 0.6);
      p.material.uniforms.uGlowRange.value = regime === "pad" ? 2.2 + TL.padHeight(t) * 0.05 : 1.5;
      p.flush(t);
    });
    pools.smoke.material.uniforms.uAmbient.value.setRGB(1, 1, 1).multiplyScalar(regime === "pad" ? 1 : 0.9);
    S.frame = { t, shot, regime, traj, thrust, baseY, theta, dt };
  }, -1);

  // Post-pass (after RocketModel moved the stages): camera, environment, composite.
  useFrame(() => {
    const S = st.current;
    if (!S.frame) return;
    const { t, shot, regime, traj, thrust, baseY, theta, dt } = S.frame;
    const c = ctrlRef.current;

    // --- Camera ---
    const shotU = (t - shot.start) / (shot.end - shot.start);
    const cut = S.lastShot !== shot;
    if (regime === "pad") {
      const lag = Math.max(TL.LIFTOFF_T, t - 0.35);
      const cx = { baseY, lagX: TL.padDownrange(lag), lagY: BASE_Y + TL.padHeight(lag) };
      const def = PAD_SHOTS[shot.id](smooth(shotU) * 0.6 + shotU * 0.4, cx);
      camera.position.set(...def.pos);
      if (def.shake) {
        const a = def.shake * 0.006 * thrust * (1 + (t > TL.LIFTOFF_T && t < TL.LIFTOFF_T + 4 ? 1.5 : 0));
        camera.position.x += Math.sin(t * 53.1) * a + Math.sin(t * 31.7) * a * 0.6;
        camera.position.y += Math.sin(t * 47.3) * a;
      }
      camera.up.set(0, 1, 0);
      camera.lookAt(def.look[0], def.look[1], def.look[2]);
      if (camera.fov !== def.fov) {
        camera.fov = def.fov;
        camera.updateProjectionMatrix();
      }
      camera.clearViewOffset();
      S.roll = 0;
    } else if (shot.id === "stage1Cam") {
      // Onboard camera on the spent stage, looking up its axis: the upper
      // stage pulls away and lights its engine straight into the lens.
      const rig = rigRef.current;
      if (rig && rig.root && rig.stage1) {
        rig.root.updateWorldMatrix(true, true);
        const st1 = rig.stage1;
        // On a boom just outside the skin, aimed at the receding engine bell
        const [ax, ay, az] = STAGE1_CAM.at;
        const base = st1.localToWorld(_cam.a.set(0, ay, 0));
        camera.position.copy(st1.localToWorld(_cam.b.set(ax, ay, az)));
        camera.up.copy(_cam.b).sub(base).normalize();
        camera.lookAt(rig.root.localToWorld(_cam.a.set(0, S2.bell + 0.25, 0)));
        if (camera.fov !== STAGE1_CAM.fov) {
          camera.fov = STAGE1_CAM.fov;
          camera.updateProjectionMatrix();
        }
        camera.clearViewOffset();
        S.roll = 0;
      }
    } else {
      const f = FLIGHT_SHOTS[shot.id];
      const rig = rigRef.current;
      if (f && rig && rig.root && rig.stage1) {
        rig.root.updateWorldMatrix(true, true);
        let n = 0;
        const pt = (obj, y, rad) => {
          const q = pool[n++];
          q.pos.copy(obj.localToWorld(_w.set(0, y, 0)));
          q.rad = rad;
          return q;
        };
        let pts;
        const plumeLen = -1.2 - c.expand * 1.4;
        switch (f.pts) {
          case "aft":
            pts = [pt(rig.stage1, S1.bells - 0.1, 0.32), pt(rig.stage1, S1.aft, 0.33), pt(rig.stage1, S1.lowTank, 0.3)];
            break;
          case "joint":
            pts = [pt(rig.stage1, S1.lowTank + 0.6, 0.3), pt(rig.stage1, S1.top, 0.3), pt(rig.root, S2.bell, 0.25), pt(rig.root, S2.tip - 0.6, 0.2)];
            break;
          case "both":
            pts = [pt(rig.stage1, S1.bells, 0.32), pt(rig.stage1, S1.top, 0.32), pt(rig.root, S2.bell, 0.24), pt(rig.root, S2.tip, 0.18)];
            break;
          case "upper":
            pts = [pt(rig.root, S2.bell - 1.0, 0.35), pt(rig.root, S2.bell, 0.25), pt(rig.root, S2.tip, 0.18), pt(rig.stage1, S1.top, 0.3)];
            break;
          case "detail":
            pts = [pt(rig.root, S2.bell + 0.2, 0.3), pt(rig.root, S2.low + 0.9, 0.28), pt(rig.root, S2.tip - 0.9, 0.2)];
            break;
          case "upperWide":
          case "upperBurn":
            pts = [pt(rig.root, S2.bell - (c.upper > 0.1 ? 1.2 : 0.1), 0.3), pt(rig.root, S2.tip, 0.2)];
            break;
          default:
            pts = [pt(rig.root, plumeLen + S1.bells, 0.4), pt(rig.root, S2.tip, 0.18)];
        }
        if (camera.fov !== 45) {
          camera.fov = 45;
          camera.updateProjectionMatrix();
        }
        const u = smooth(shotU);
        const dir = _v.copy(f.d0).lerp(f.d1, u).normalize();
        const roll = f.roll * (0.6 + 0.4 * u);
        S.roll = cut || dt === 0 ? roll : S.roll + (roll - S.roll) * (1 - Math.exp(-dt * 2.5));
        framePoints(pts, dir, camera.fov, size.width / size.height, f.rect, 0.86, _sol, S.roll);
        const dist = _sol.dist * (f.extra || 1);
        const goal = _w.copy(dir).multiplyScalar(dist).add(_sol.center);
        if (cut || dt === 0) {
          S.camPos.copy(goal);
          S.look.copy(_sol.center);
        } else {
          const k = 1 - Math.exp(-dt * 3.2);
          S.camPos.lerp(goal, k);
          S.look.lerp(_sol.center, k);
        }
        camera.position.copy(S.camPos);
        camera.up.set(0, 1, 0);
        camera.lookAt(S.look);
        if (S.roll) camera.rotateZ(S.roll);
        centreViewOn(camera, size.width, size.height, f.rect);
      }
    }
    camera.updateMatrixWorld();
    S.lastShot = shot;

    // --- Environment camera (true scale) ---
    let altKm;
    let envPos;
    if (regime === "pad") {
      // Pad frame: the site is at the top of the planet
      envPos = _w.set(camera.position.x * K_ENV, ENV_R + camera.position.y * K_ENV, camera.position.z * K_ENV);
      altKm = Math.max(0.002, (camera.position.y * TL.UNIT_M) / 1000);
    } else {
      const altV = traj.altKm / KM_PER_UNIT;
      _q.setFromAxisAngle(_ax, -theta);
      envPos = _w.set(0, ENV_R + altV, 0).applyQuaternion(_q).add(_v.copy(camera.position).multiplyScalar(K_ENV).applyQuaternion(_q));
      altKm = Math.max(0.002, (envPos.length() - ENV_R) * KM_PER_UNIT);
    }
    _q.setFromAxisAngle(_ax, regime === "pad" ? 0 : -theta).multiply(camera.quaternion);
    env.update({ camPos: envPos, camQuat: _q, main: camera, altKm, sun: SUN_ENV });

    // --- Composite: environment, then the vehicle layer over a cleared depth buffer ---
    gl.autoClear = false;
    gl.clear(true, true, true);
    gl.render(env.scene, env.camera);
    gl.clearDepth();
    gl.render(scene, camera);

    // --- Overlay + validation tooling ---
    hooks.frame({ t, shot, traj, thrust });
    if (typeof window !== "undefined") {
      const w = window.__lvLaunch || (window.__lvLaunch = {});
      w.t = t;
      w.shot = shot.id;
      w.regime = regime;
      w.met = TL.metAt(t);
      w.altKm = traj.altKm;
      w.fired = [...S.fired];
      w.dpr = gl.getPixelRatio();
      w.calls = gl.info.render.calls;
      w.triangles = gl.info.render.triangles;
      if (!S.pc || Math.abs(t - S.pc) > 0.5) {
        S.pc = t;
        w.particles = { smoke: pools.smoke.alive(t), fire: pools.fire.alive(t) };
      }
      if (window.__lvLaunchMeasure) {
        w.overdraw = {
          smoke: +pools.smoke.overdraw(t, camera, size.width, size.height).toFixed(2),
          fire: +pools.fire.overdraw(t, camera, size.width, size.height).toFixed(2),
        };
      }
    }
  }, 1);
  return null;
}

/* ------------------------------------------------------------------ */
/* Particle emitters (deterministic in t, so seeks reproduce a frame).  */

function rate(S, key, perSec, dt) {
  const a = (S.acc[key] || 0) + perSec * dt;
  const n = Math.floor(a);
  S.acc[key] = a - n;
  return n;
}

function emitParticles(t, dt, pools, S, rigRef, rocketGroupRef) {
  if (dt <= 0) return;
  const r = () => {
    S.rnd = (S.rnd * 16807) % 2147483647;
    return (S.rnd - 1) / 2147483646;
  };
  const sm = pools.smoke;
  const fi = pools.fire;
  const regime = t < 32 ? "pad" : "flight";
  const eng = TL.stage1EngineThrust(t, [0, 0, 0, 0, 0]);
  const thrust = (eng[0] + eng[1] + eng[2] + eng[3] + eng[4]) / 5;
  const ENG = [[0, 0], [0.205, 0.205], [-0.205, 0.205], [-0.205, -0.205], [0.205, -0.205]];

  if (regime === "pad") {
    const h = TL.padHeight(t);
    const bx = TL.padDownrange(t);
    const base = BASE_Y + h;
    const s = ROCKET_SCALE;
    const exitY = base + S1.bells * s;
    // Cryogenic venting before ignition: cold vapour curls off the tanks and sinks
    if (t > 1 && t < TL.LIFTOFF_T + 2) {
      for (let i = rate(S, "vent", 9, dt); i > 0; i--) {
        const a = r() * Math.PI * 2;
        const y = base + (r() < 0.6 ? 2.55 : 4.1) * s;
        const rr = r() < 0.6 ? 0.39 * s : 0.32 * s;
        sm.emit(t, [bx + Math.cos(a) * rr, y, Math.sin(a) * rr], [Math.cos(a) * 0.12, -0.18 - r() * 0.12, Math.sin(a) * 0.12], 2.6 + r(), 0.06, 0.42, 0.95, 0.96, 0.98, 0.22, 0.4, -0.25);
      }
    }
    // Sound-suppression water: spray mist, then steam once the engines light
    if (t > 5 && t < TL.LIFTOFF_T + 10) {
      const steam = 4 + 15 * thrust * (1 - smooth((h - 2) / 6));
      for (let i = rate(S, "deluge", steam, dt); i > 0; i--) {
        const a = r() * Math.PI * 2;
        const rr = 0.6 + r() * 1.1;
        const k = thrust > 0.3 ? 1 : 0.5;
        sm.emit(t, [0.4 + Math.cos(a) * rr, 0.22, Math.sin(a) * rr * 0.9], [Math.cos(a) * 0.45 * k, 0.12 + r() * 0.3 * k, Math.sin(a) * 0.45 * k], 3 + r() * 2.5, 0.22, 0.8 + r() * 0.8 * k, 0.97, 0.97, 0.98, 0.2, 0.5, 0.15);
      }
    }
    // HBOI sparklers: radial sparks under the engines to burn off hydrogen
    if (t > 7.4 && t < 8.9) {
      for (let i = rate(S, "spark", 90, dt); i > 0; i--) {
        const corner = ENG[1 + Math.floor(r() * 4)];
        const a = r() * Math.PI * 2;
        const sp = 0.6 + r() * 1.0;
        fi.emit(t, [corner[0] * 1.6, 0.04, corner[1] * 1.6], [Math.cos(a) * sp, 0.3 + r() * 0.6, Math.sin(a) * sp], 0.5 + r() * 0.5, 0.025, 0.02, 1.0, 0.72, 0.32, 1.0, 0.3, -2.4);
      }
    }
    // Ignition flashes per engine, then the turbulent plume
    eng.forEach((k, i) => {
      const key = "ign" + i;
      if (k > 0.02 && !S.acc[key + "done"] && t < TL.LIFTOFF_T) {
        S.acc[key + "done"] = 1;
        for (let j = 0; j < 10; j++) {
          fi.emit(t, [bx + ENG[i][0] * s, exitY, ENG[i][1] * s], [(r() - 0.5) * 0.8, -0.6 - r(), (r() - 0.5) * 0.8], 0.28 + r() * 0.2, 0.15, 0.7, 1.0, 0.8, 0.55, 1.0, 1.5, 0.6);
        }
      }
    });
    if (thrust > 0.02) {
      for (let i = rate(S, "plume", 250 * thrust, dt); i > 0; i--) {
        const e = ENG[Math.floor(r() * 5)];
        const vy = -(6 + r() * 3);
        const life = 0.32 + r() * 0.28;
        // Clamp the visible jet at the deck while the vehicle sits in the hole
        const floor = Math.max(0, 0.05 - h);
        fi.emit(t, [bx + e[0] * s + (r() - 0.5) * 0.05, exitY - 0.05, e[1] * s + (r() - 0.5) * 0.05], [(r() - 0.5) * 0.45, vy * (floor > 0 ? 0.35 : 1), (r() - 0.5) * 0.45], life, 0.2, 0.6 + r() * 0.45, 1.0, 0.68, 0.34, 0.26, 0.35, 0.4);
      }
    }
    // Exhaust forced down the flame trench (−Z) while the vehicle is low
    const trench = thrust * (1 - smooth((h - 1.2) / 5));
    if (trench > 0.02) {
      for (let i = rate(S, "trenchFire", 70 * trench, dt); i > 0; i--) {
        fi.emit(t, [-2.6 - r() * 1.4, 0.12, (r() - 0.5) * 0.5], [-4 - r() * 3, 0.4 + r() * 0.8, (r() - 0.5) * 1.2], 0.3 + r() * 0.25, 0.3, 1.2 + r() * 0.8, 1.0, 0.68, 0.35, 0.5, 1.0, 0.6);
      }
      for (let i = rate(S, "trenchSmoke", 27 * trench, dt); i > 0; i--) {
        const tan = 0.8 + r() * 0.17;
        sm.emit(t, [-3.6 - r() * 0.6, 0.3, (r() - 0.5) * 0.8], [-2.6 - r() * 3.2, 0.6 + r() * 1.3, (r() - 0.5) * 3.4], 14 + r() * 9, 0.8, 5.0 + r() * 3.5, tan, tan * 0.96, tan * 0.9, 0.7, 0.32, 0.3);
      }
      // Steam: the deluge water flashing off the flame pit, rising and spreading
      if (thrust > 0.4 && h < 1.5) {
        for (let i = rate(S, "pitSteam", 4 * thrust, dt); i > 0; i--) {
          const a = r() * Math.PI * 2;
          const w = 0.97 + r() * 0.03;
          sm.emit(t, [0.3 + Math.cos(a) * 0.7, 0.35, Math.sin(a) * 0.7], [Math.cos(a) * 0.5, 0.7 + r() * 0.7, Math.sin(a) * 0.5], 7 + r() * 4, 1.0, 3.0 + r() * 1.4, w, w, w, 0.45, 0.5, 0.25);
        }
      }
      // Billows pouring out from under the deck on every side
      for (let i = rate(S, "deckBillow", 14 * trench, dt); i > 0; i--) {
        // Out of the open west and north sides of the deck, away from the tower
        const a = Math.PI * (0.7 + r() * 0.85);
        const tan = 0.84 + r() * 0.14;
        sm.emit(t, [0.4 + Math.cos(a) * 1.5, 0.3, Math.sin(a) * 1.3], [Math.cos(a) * (0.9 + r() * 1.1), 0.1 + r() * 0.35, Math.sin(a) * (0.8 + r() * 1.0)], 10 + r() * 6, 0.6, 2.8 + r() * 2.0, tan, tan * 0.97, tan * 0.93, 0.6, 0.42, 0.08);
      }
    }
    // Ground surge at release: the full exhaust hits the deck and a wall of
    // smoke and steam rolls outward across the pad, slowing as it spreads
    if (t > TL.LIFTOFF_T + 0.2 && t < TL.LIFTOFF_T + 3.2) {
      for (let i = rate(S, "surge", 13, dt); i > 0; i--) {
        const a = Math.PI * (0.55 + r() * 1.25);
        const sp = 2.2 + r() * 2.2;
        const w = 0.86 + r() * 0.12;
        sm.emit(t, [0.4 + Math.cos(a) * 1.4, 0.25, Math.sin(a) * 1.4], [Math.cos(a) * sp, 0.25 + r() * 0.5, Math.sin(a) * sp], 11 + r() * 7, 0.9, 3.2 + r() * 2.0, w, w * 0.97, w * 0.93, 0.64, 0.9, 0.12);
      }
    }
    // Dust and vapour knocked flat across the pad at release
    if (t > TL.LIFTOFF_T && t < TL.LIFTOFF_T + 1.8) {
      for (let i = rate(S, "dust", 42, dt); i > 0; i--) {
        const a = r() * Math.PI * 2;
        const sp = 2.5 + r() * 2.5;
        sm.emit(t, [0.4 + Math.cos(a) * 2.2, 0.15, Math.sin(a) * 2.2], [Math.cos(a) * sp, 0.15, Math.sin(a) * sp], 6 + r() * 3, 0.4, 2.4 + r() * 1.5, 0.72, 0.67, 0.6, 0.38, 0.9, 0.1);
      }
    }
    // Exhaust column left in the air by the climbing vehicle (stays put)
    if (t > TL.LIFTOFF_T + 0.6 && h > 1.0) {
      const speed = 0.144 * (t - TL.LIFTOFF_T) + 0.0008 * (t - TL.LIFTOFF_T) ** 3;
      for (let i = rate(S, "column", Math.min(44, 10 + speed * 2.4), dt); i > 0; i--) {
        const y = exitY - 1.4 - r() * 1.2;
        const g = 0.88 + r() * 0.1;
        sm.emit(t, [bx + (r() - 0.5) * 0.4, y, (r() - 0.5) * 0.4], [(r() - 0.5) * 0.6, -0.8 - r() * 0.6, (r() - 0.5) * 0.6], 16 + r() * 8, 0.9, 3.6 + r() * 2.4, g, g, g * 0.98, 0.58, 0.45, 0.12);
      }
    }
  } else {
    // Flight regime: the vehicle sits at the origin, pitched downrange.
    const traj = TL.trajectoryAt(t);
    const p = traj.pitch;
    const ax = [Math.sin(p), Math.cos(p), 0]; // body axis (nose direction)
    const dens = TL.airDensity(traj.altKm);
    const expand = 1 - Math.sqrt(dens);
    const s = ROCKET_SCALE;
    const exit = S1.bells * s;
    const at = (along, x, z) => [ax[0] * along + x * Math.cos(p), ax[1] * along - x * Math.sin(p), z];
    if (thrust > 0.02) {
      const stream = 8 + traj.speedKmps * 2;
      for (let i = rate(S, "fplume", 120 * thrust, dt); i > 0; i--) {
        const e = ENG[Math.floor(r() * 5)];
        const spread = 0.4 + expand * 2.6;
        const pos = at(exit - 0.05, e[0] * s, e[1] * s);
        fi.emit(t, pos, [-ax[0] * stream + (r() - 0.5) * spread, -ax[1] * stream + (r() - 0.5) * spread, (r() - 0.5) * spread], 0.2 + r() * 0.15, 0.18 + expand * 0.2, 0.6 + expand * 1.2, 1.0, 0.72 - expand * 0.2, 0.42 - expand * 0.15, 0.35 * (1 - expand * 0.6), 2.0, 0);
      }
      // Trail: dense and persistent low down, gone in near-vacuum
      if (dens > 0.004) {
        const k = Math.min(1, dens * 4);
        for (let i = rate(S, "trail", 45, dt); i > 0; i--) {
          const pos = at(exit - 1.6 - r() * 0.8, (r() - 0.5) * 0.3, (r() - 0.5) * 0.3);
          const g = 0.92 + r() * 0.06;
          sm.emit(t, pos, [-ax[0] * stream * 1.4 + (r() - 0.5), -ax[1] * stream * 1.4 + (r() - 0.5), (r() - 0.5)], 2.0 + r(), 0.9 + expand, 3.5 + expand * 5, g, g, g, 0.42 * k, 0.15, 0);
        }
      }
    }
    // RCS firings that start and stop the roll to burn attitude: short white
    // puffs from the thruster quads at the forward end of the upper stage
    const rcsOn = (t > 85.6 && t < 86.4) || (t > 87.9 && t < 88.7);
    if (rcsOn && rigRef.current && rigRef.current.root) {
      const root = rigRef.current.root;
      root.updateWorldMatrix(true, false);
      const sign = t < 87 ? 1 : -1;
      for (let i = rate(S, "rcs", 55, dt); i > 0; i--) {
        const q = Math.floor(r() * 4);
        const a = (q * Math.PI) / 2 + Math.PI / 4;
        const w = root.localToWorld(new THREE.Vector3(Math.cos(a) * 0.42, S2.low + 0.35, Math.sin(a) * 0.42));
        const c = root.localToWorld(new THREE.Vector3(0, S2.low + 0.35, 0));
        const out = w.clone().sub(c).normalize();
        // tangential jet, opposite to the roll it drives
        const tan = new THREE.Vector3(-out.z, 0, out.x).multiplyScalar(sign);
        sm.emit(t, [w.x, w.y, w.z], [out.x * 0.4 + tan.x * 1.4, out.y * 0.4 + tan.y * 1.4, out.z * 0.4 + tan.z * 1.4], 0.35 + r() * 0.3, 0.02, 0.13 + r() * 0.08, 0.95, 0.96, 1.0, 0.32, 1.6, 0);
      }
    }
    // Separation: motor smoke and a brief ring of released vapour at the joint
    const sep = TL.sepProgress(t);
    if (sep > 0 && sep < 0.16) {
      const g = rocketGroupRef.current;
      const st1 = rigRef.current && rigRef.current.stage1;
      if (g && st1) {
        st1.updateWorldMatrix(true, false);
        for (let i = rate(S, "retro", 60, dt); i > 0; i--) {
          const a = Math.PI / 4 + Math.floor(r() * 4) * (Math.PI / 2);
          const w = st1.localToWorld(new THREE.Vector3(Math.cos(a) * 0.4, 2.8, Math.sin(a) * 0.4));
          sm.emit(t, [w.x, w.y, w.z], [-ax[0] * 2.5 + (r() - 0.5) * 0.4, -ax[1] * 2.5 + (r() - 0.5) * 0.4, (r() - 0.5) * 0.4], 1.6 + r(), 0.12, 0.9, 0.9, 0.9, 0.9, 0.45, 0.6, 0);
        }
        if (!S.acc.ring) {
          S.acc.ring = 1;
          const w = st1.localToWorld(new THREE.Vector3(0, S1.top, 0));
          for (let j = 0; j < 26; j++) {
            const a = (j / 26) * Math.PI * 2;
            sm.emit(t, [w.x, w.y, w.z], [Math.cos(a) * 0.9 * Math.cos(p), -Math.cos(a) * 0.9 * Math.sin(p), Math.sin(a) * 0.9], 1.8 + r(), 0.1, 0.55, 0.96, 0.97, 1.0, 0.35, 0.8, 0);
          }
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */

function GroundSkirt() {
  // Scrub and wetland around the complex, blending into the planet-scale ground
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(64, 64, 20, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.7, "rgba(255,255,255,0.8)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} renderOrder={-1}>
      <ringGeometry args={[20, 160, 48, 1]} />
      <meshStandardMaterial color="#56604a" roughness={1} transparent alphaMap={tex} depthWrite={false} />
    </mesh>
  );
}

function PadShadowSetup({ lightRef }) {
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
    c.far = 60;
    c.updateProjectionMatrix();
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.02;
    l.target.position.set(0.6, 1.4, 0);
    l.target.updateMatrixWorld();
  }, [lightRef]);
  return null;
}

function Scene({ hooks }) {
  const { gl } = useThree();
  const rigRef = useRef(null);
  const rocketGroupRef = useRef();
  const ctrlRef = useRef({ engines: [0, 0, 0, 0, 0], glow: 0, sep: 0, upper: 0, showStage1: true, expand: 0 });
  const padProg = useRef(0);
  const sunRef = useRef();
  const padLightRef = useRef();
  const fillRefs = { amb: useRef(), hemi: useRef() };
  const anisotropy = useMemo(() => Math.min(8, gl.capabilities.getMaxAnisotropy()), [gl]);
  useEffect(() => setRocketTextureAnisotropy(anisotropy), [anisotropy]);
  const envMaps = useMemo(() => buildEnvMaps(gl), [gl]);
  useEffect(() => () => Object.values(envMaps).forEach((m) => m.dispose()), [envMaps]);
  const pools = useMemo(
    () => ({
      smoke: new ParticlePool({ count: 1300, kind: "smoke", accel: [0, 0.16, 0], seed: 11 }),
      fire: new ParticlePool({ count: 400, kind: "fire", accel: [0, 1.0, 0], seed: 23 }),
    }),
    []
  );
  useEffect(() => () => {
    pools.smoke.dispose();
    pools.fire.dispose();
  }, [pools]);
  useEffect(() => {
    rocketGroupRef.current?.traverse((o) => {
      if (o.isMesh && o.material && o.material.isMeshStandardMaterial) o.castShadow = true;
    });
  }, []);

  return (
    <>
      <ambientLight ref={fillRefs.amb} intensity={0.2} />
      <directionalLight ref={sunRef} position={[10, 8, 8]} intensity={2.4} color="#fff2e2" />
      <PadShadowSetup lightRef={sunRef} />
      <hemisphereLight ref={fillRefs.hemi} args={["#bcd3f0", "#5a5040", 0.25]} />
      <pointLight ref={padLightRef} color="#ffae66" intensity={0} distance={16} decay={1.6} />
      <LaunchComplex progRef={padProg} anisotropy={anisotropy} />
      <PadVisible padProg={padProg}>
        <GroundSkirt />
      </PadVisible>
      <group ref={rocketGroupRef}>
        <RocketModel scale={ROCKET_SCALE} rigRef={rigRef} ctrlRef={ctrlRef} />
      </group>
      <primitive object={pools.smoke.mesh} />
      <primitive object={pools.fire.mesh} />
      <Director
        rigRef={rigRef}
        rocketGroupRef={rocketGroupRef}
        ctrlRef={ctrlRef}
        padProg={padProg}
        sunRef={sunRef}
        padLightRef={padLightRef}
        fillRefs={fillRefs}
        pools={pools}
        hooks={hooks}
        envMaps={envMaps}
      />
    </>
  );
}

function PadVisible({ padProg, children }) {
  const ref = useRef();
  useFrame(() => {
    if (ref.current) ref.current.visible = padProg.current < 0.5;
  });
  return <group ref={ref}>{children}</group>;
}

/* ------------------------------------------------------------------ */
/* Overlay: mission clock, event captions, countdown, fades, skip.      */

function useAudioDirector(audio) {
  const roar = useRef({ level: 0, muffle: 0, last: 0 });
  // Space-to-ground calls carry Quindar tones, as Apollo's did: an intro
  // tone before the voice and an outro tone after it.
  const quindar = (text, delay = 0) => {
    setTimeout(() => {
      audio.beep(2525, 0.25, 0.05);
      audio.comms(text, 320);
      setTimeout(() => audio.beep(2475, 0.25, 0.05), 320 + 450 + text.length * 62);
    }, delay);
  };
  return {
    event(e) {
      if (!audio) return;
      switch (e.id) {
        case "venting":
          audio.ambienceStart?.();
          break;
        case "sparklers":
          audio.hiss?.(1.4, 0.18);
          break;
        case "engineStart":
          // A low whump as the first engine lights, then the roar builds
          audio.thud?.(0.5);
          audio.roarStart?.();
          audio.comms("Main engine start.", 0);
          break;
        case "liftoff":
          audio.clank?.(0.6);
          audio.boom(0.55);
          audio.comms("Zero. And liftoff. Liftoff of LV-001.", 150);
          break;
        case "towerClear":
          audio.comms("Tower cleared. Roll and pitch program.", 200);
          audio.ambienceStop?.();
          break;
        case "maxQ":
          audio.comms("Vehicle is passing through max-Q.", 0);
          break;
        case "meco":
          audio.roarStop?.(0.35);
          audio.comms("Main engine cutoff.", 900);
          break;
        case "separation":
          // Pyrotechnic bolts, then the separation motors, felt through the structure
          audio.boom(0.22);
          audio.clank?.(0.35);
          audio.thud?.(0.45);
          audio.hiss?.(0.9, 0.08);
          audio.comms("Staging. Separation confirmed.", 700);
          break;
        case "usIgnition":
          audio.thud?.(0.3);
          audio.roarStart?.({ onboard: true });
          audio.comms("Upper stage ignition. Good burn.", 600);
          break;
        case "orbit":
          audio.roarStop?.(1.2);
          quindar("Cutoff. Orbit insertion confirmed. Parking orbit, one eighty-five kilometers.", 900);
          audio.padStart?.();
          break;
        case "sunset":
          quindar("LV-001, Houston. Loss of daylight in one minute. Systems look good.", 600);
          break;
        case "tliPrep":
          // RCS thrusters starting the roll, heard as thumps through the hull
          [0, 260, 2600, 2860].forEach((d) => setTimeout(() => audio.thud?.(0.16), 400 + d));
          quindar("LV-001, Houston. You are go for T. L. I.", 1400);
          break;
        case "tli":
          audio.thud?.(0.3);
          audio.roarStart?.({ onboard: true });
          quindar("Translunar injection burn underway. Thrust is good.", 300);
          break;
        case "lunarTransfer":
          audio.roarStop?.(1.5);
          quindar("Cutoff. LV-001, you are on your way to the Moon.", 600);
          break;
        default:
      }
    },
    countdown(n) {
      if (!audio) return;
      audio.beep(n === 0 ? 660 : 880, 0.06, 0.08);
      if (n === 10) audio.comms("T-minus ten.", 0);
      else if (n <= 9 && n >= 7) audio.speak?.(String(n), { rate: 1.05 });
      else if (n <= 4 && n >= 1) audio.speak?.(String(n), { rate: 1.05 });
    },
    frame({ t, shot, traj, thrust }) {
      if (!audio || !audio.roarSet) return;
      const R = roar.current;
      if (t - R.last < 0.1) return;
      R.last = t;
      let level = 0;
      let muffle = 0;
      if (t < 32) {
        level = thrust;
        // Distance of the camera from the vehicle (close shots are louder, brighter)
        muffle = { wide: 0.6, lowAngle: 0.3, engines: 0.05, trench: 0.25, tower: 0.15, wideAscent: 0.65 }[shot.id] ?? 0.4;
      } else if (t < 44) {
        // Aerodynamic roar peaks near max-Q, then the air thins out
        const q = Math.exp(-((t - 34) * (t - 34)) / 30);
        level = thrust * (0.55 + 0.35 * q) * (0.4 + 0.6 * TL.airDensity(traj.altKm) ** 0.3);
        muffle = 0.55 + 0.35 * (1 - TL.airDensity(traj.altKm));
      } else {
        // Space: only an onboard, structure-borne rumble while a stage burns
        level = TL.upperThrust(t) * 0.32;
        muffle = 0.95;
      }
      if (shot.id === "stage1Cam") level = 0; // the camera on the spent stage hears nothing
      audio.roarSet(level, muffle);
    },
  };
}

const CinematicCanvas = memo(function CinematicCanvas({ hooks }) {
  return (
    <Canvas
      camera={{ position: [17, 2.6, 23], fov: 26, near: 0.05, far: 4000 }}
      dpr={[1, 2]}
      shadows
      gl={{ antialias: true, alpha: false, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace, powerPreference: "high-performance" }}
      onCreated={({ gl }) => gl.setClearColor("#000000")}
    >
      <Suspense fallback={null}>
        <Scene hooks={hooks} />
      </Suspense>
    </Canvas>
  );
});

export default function LaunchCinematic({ audio, onComplete, onSkip }) {
  const [caption, setCaption] = useState(null);
  const [hud, setHud] = useState({ met: TL.formatMet(-15), name: TL.SHOTS[0].name, alt: null, vel: null, count: null });
  const [skipVisible, setSkipVisible] = useState(false);
  const fadeRef = useRef();
  const flashRef = useRef();
  const capTimer = useRef(null);
  const lastCount = useRef(null);
  const director = useAudioDirector(audio);
  const doneRef = useRef(false);

  useEffect(() => {
    const id = setTimeout(() => setSkipVisible(true), 2500);
    return () => {
      clearTimeout(id);
      clearTimeout(capTimer.current);
    };
  }, []);

  const hooks = useMemo(
    () => ({
      onEvent(e) {
        director.event(e);
        if (e.caption) {
          setCaption({ id: e.id, title: e.caption, sub: e.sub });
          clearTimeout(capTimer.current);
          capTimer.current = setTimeout(() => setCaption(null), 4200);
        }
      },
      onComplete() {
        if (doneRef.current) return;
        doneRef.current = true;
        onComplete && onComplete();
      },
      frame(info) {
        const { t, shot, traj } = info;
        director.frame(info);
        // Countdown calls, one per second from T-10
        const n = Math.ceil(TL.LIFTOFF_T - t);
        if (n >= 0 && n <= 10 && n !== lastCount.current) {
          lastCount.current = n;
          director.countdown(n);
        }
        // Fades: dip to black across the pad → flight cut, out at the end; a
        // short bright bloom as the full-thrust exhaust hits the trench.
        const f = Math.max(
          1 - Math.abs(t - 32) / 0.4,
          smooth((t - (TL.DURATION - 0.9)) / 0.8),
          0
        );
        if (fadeRef.current) fadeRef.current.style.opacity = String(clamp01(f));
        const fl = Math.max(0, 1 - Math.abs(t - TL.LIFTOFF_T - 0.15) / 0.45) * 0.22;
        if (flashRef.current) flashRef.current.style.opacity = String(fl);
        // Clock / telemetry, refreshed ~8 times a second
        if (!hooks._last || t - hooks._last > 0.12 || t < hooks._last) {
          hooks._last = t;
          const met = TL.metAt(t);
          setHud({
            met: TL.formatMet(met),
            name: shot.name,
            alt: t >= TL.LIFTOFF_T ? traj.altKm : null,
            vel: t >= TL.LIFTOFF_T ? traj.speedKmps : null,
            count: t < TL.LIFTOFF_T && TL.LIFTOFF_T - t <= 10.5 ? Math.ceil(TL.LIFTOFF_T - t) : null,
          });
        }
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const fmtAlt = (a) => (a < 1 ? `${Math.round(a * 1000)} M` : `${a.toFixed(a < 10 ? 1 : 0)} KM`);

  return (
    <div className="absolute inset-0" data-testid="launch-cinematic">
      <div className="absolute inset-0 canvas-host" data-testid="ascent-canvas">
        <CinematicCanvas hooks={hooks} />
      </div>

      <div ref={flashRef} className="absolute inset-0 bg-[#fff4e0] pointer-events-none" style={{ opacity: 0 }} />
      <div ref={fadeRef} className="absolute inset-0 bg-black pointer-events-none" style={{ opacity: 0 }} />

      {/* Mission clock + telemetry */}
      <div
        data-testid="launch-clock"
        className="absolute top-20 short:top-[var(--hud-top)] left-1/2 -translate-x-1/2 hud-panel px-4 py-1.5 short:py-1 flex flex-col items-center z-30 pointer-events-none"
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] short:text-[10px] tracking-[0.3em] text-white tabular" data-testid="launch-met">{hud.met}</span>
          <span className="w-px h-3.5 bg-white/15" />
          <span className="font-mono text-[10px] short:text-[9px] tracking-[0.3em] text-zinc-300 whitespace-nowrap" data-testid="launch-phase">{hud.name}</span>
        </div>
        {hud.alt != null && (
          <div className="font-mono text-[9px] tracking-[0.25em] text-zinc-500 mt-0.5 tabular whitespace-nowrap" data-testid="launch-telemetry">
            ALT {fmtAlt(hud.alt)} · VEL {hud.vel.toFixed(hud.vel < 1 ? 2 : 1)} KM/S
          </div>
        )}
      </div>

      {/* Countdown, broadcast-subtitle style */}
      {hud.count != null && (
        <div className="absolute bottom-10 short:bottom-4 left-1/2 -translate-x-1/2 safe-mb z-30 pointer-events-none text-center" data-testid="launch-countdown">
          <div className="font-mono text-[9px] tracking-[0.4em] text-zinc-400">T-MINUS</div>
          <div className="font-display font-black text-white/90 text-5xl short:text-4xl tabular leading-none">{hud.count}</div>
        </div>
      )}

      {/* Event caption, lower third */}
      {caption && (
        <div
          key={caption.id}
          data-testid="launch-caption"
          data-event={caption.id}
          className="absolute bottom-10 short:bottom-3 left-6 md:left-10 safe-ml safe-mb z-30 pointer-events-none scan-in bg-black/45 backdrop-blur-sm border-l-2 border-[#FF3B00] px-3 py-2 short:py-1.5 max-w-[min(26rem,60vw)]"
        >
          <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.4em] text-[#FF3B00]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#FF3B00]" /> MISSION EVENT
          </div>
          <div className="font-display font-black text-white text-2xl md:text-3xl short:text-xl tracking-tight mt-0.5">{caption.title}</div>
          <div className="font-mono text-[10px] short:text-[9px] tracking-[0.22em] text-zinc-300 mt-0.5">{caption.sub}</div>
        </div>
      )}

      {skipVisible && (
        <button
          type="button"
          data-testid="skip-cinematic"
          onClick={() => onSkip && onSkip()}
          className="absolute bottom-6 short:bottom-2 right-6 md:right-10 safe-mr safe-mb z-30 font-mono text-[10px] tracking-[0.3em] text-zinc-400 hover:text-white px-3 py-2 touch:min-h-[44px] touch:px-4 bg-black/30 border border-white/10"
        >
          SKIP CINEMATIC ›
        </button>
      )}
    </div>
  );
}
