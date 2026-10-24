import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import * as THREE from "three";
import LanderModel from "@/components/LanderModel";
import { Horizon, SiteRocks, SiteSun, SiteTerrain } from "@/components/scenes/LunarSite";
import AdaptiveResolution from "@/components/scenes/AdaptiveResolution";
import { PlanetEarth, PlanetMoon } from "@/components/planets/Planets";
import { getSite } from "@/data/landingSites";
import { parseCoords } from "@/data/missionConfig";
import { skyDirection } from "@/data/terrainMesh";
import { LM } from "@/data/touchdownFx";
import {
  ASCENT_DIFFICULTY,
  R_MOON,
  STAGE,
  TARGET,
  VERTICAL_RISE,
  advance,
  createAscent,
  drift,
  csmAngle,
  cutoffDue,
  guidancePitch,
  orbitOf,
  orbitPath,
  planePos,
  telemetry,
} from "@/data/manualAscent";
import { ORBIT_R } from "@/data/dockingSim";

/**
 * MANUAL ASCENT — the ascent stage flown by the player from the lunar surface into lunar orbit.
 *
 * One authoritative simulation (data/manualAscent: gravity, the ascent engine's fixed thrust,
 * mass and propellant, RCS attitude, the orbit's conic) is stepped every frame by the player's
 * commands; the scene, the HUD and the NAV display are drawn from it and nothing else moves the
 * stage. The descent stage stays on the Moon where it landed (its own model, untouched); the
 * ascent stage separates at ignition and flies from the deck.
 *
 * The scene is the landing site (the same terrain, rocks, horizon and Sun as the descent and the
 * EVA) in a frame whose origin is the site: the stage's true position around the Moon (its
 * downrange arc and the surface's curvature) is placed in it, so it climbs away from the site,
 * which falls behind and below. The whole Moon is drawn at 1/1000 around the camera (as in the
 * docking: the same angular size, no far-plane trouble) in a background pass of its own (with the
 * stars and the Earth), so it can never cover the site or the spacecraft; the site's terrain fades
 * into it as the stage climbs.
 *
 * Views: EXTERNAL (a chase camera, its distance growing with altitude, the horizon ahead),
 * COCKPIT (through the forward windows: the ground ahead, then the horizon as the stage pitches
 * over) and NAV (the trajectory: the Moon, the conic the stage is on, the target and the CSM).
 */

const K = 0.5; // scene units per metre (touchdownFx WORLD_X; the site's horizontal scale)
const ASC_CENTRE = 0.6 * LM.scale; // the ascent stage's centre above the LM origin (scene units)
const MOON_SCALE = 1 / 1000;
const DEG = Math.PI / 180;
const BG_LAYER = 1;
const VIEWS = ["EXTERNAL", "COCKPIT", "NAV"];
const WARPS = [1, 2, 4];
const smooth = (x) => {
  const u = Math.max(0, Math.min(1, x));
  return u * u * (3 - 2 * u);
};
const fadeOut = (v, a, b) => 1 - smooth((v - a) / (b - a));
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _e = new THREE.Euler();
const X_AXIS = new THREE.Vector3(1, 0, 0);

/** A selenographic direction on the shared Moon globe (components/planets: the same mapping as FarSideIntro). */
function selenoDir(lat, lon) {
  const phi = ((lon + 180) / 360) * Math.PI * 2;
  const th = ((90 - lat) * Math.PI) / 180;
  return new THREE.Vector3(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th));
}
/** The globe turned so the landing site is straight up (+Y) and west (the flight's direction) is +Z. */
function moonQuaternion(site) {
  const c = parseCoords(site.coords) || { lat: 0, lon: 0 };
  const up = selenoDir(c.lat, c.lon);
  const north = new THREE.Vector3(0, 1, 0);
  let east = new THREE.Vector3().crossVectors(north, up);
  if (east.lengthSq() < 1e-6) east = new THREE.Vector3(0, 0, -1);
  east.normalize();
  const west = east.clone().negate();
  const xAxis = new THREE.Vector3().crossVectors(up, west).normalize();
  const m = new THREE.Matrix4().makeBasis(xAxis, up, west); // scene axes → globe directions
  return new THREE.Quaternion().setFromRotationMatrix(m).invert();
}

/** The stage's place and attitude in the site's frame (scene units), from the simulation. */
function stageFrame(s, base) {
  const dy = (s.r * Math.cos(s.th) - R_MOON) * K;
  const dz = s.r * Math.sin(s.th) * K;
  const pos = [base[0], base[1] + ASC_CENTRE + dy, base[2] + dz];
  const up = [0, Math.cos(s.th), Math.sin(s.th)]; // the local vertical
  const fwd = [0, -Math.sin(s.th), Math.cos(s.th)]; // downrange, along the local horizon
  return { pos, up, fwd, inertial: s.th + s.pitch };
}

/* ---- the background pass: stars, the Earth, the whole Moon -------------------------------------- */
function Background({ site, base, simRef }) {
  const { camera } = useThree();
  const sky = useRef();
  const moon = useRef();
  const sunDir = useMemo(() => skyDirection(site.sun), [site]);
  const earthDir = useMemo(() => (site.earth ? skyDirection(site.earth) : null), [site]);
  const moonQ = useMemo(() => moonQuaternion(site), [site]);
  const centre = useMemo(() => new THREE.Vector3(base[0], base[1] - R_MOON * K, base[2]), [base]);
  const root = useRef();
  const tagged = useRef(0);
  useFrame(() => {
    // everything here is drawn in the background pass only (re-tagged for a while: textures and
    // the stars mount over the first frames)
    if (root.current && tagged.current < 120) {
      tagged.current += 1;
      if (tagged.current % 10 === 1) root.current.traverse((o) => o.layers.set(BG_LAYER));
    }
    if (sky.current) sky.current.position.copy(camera.position);
    if (moon.current) {
      // the Moon at 1/1000 around the camera: the same direction and angular size. On the pad and
      // in the first tens of metres the site's own terrain and horizon fill the view (as in the
      // guided liftoff): the globe is not drawn there (it would only be hidden, at a cost)
      const s = simRef.current;
      moon.current.visible = !!s && s.r - R_MOON > 60;
      _v.copy(centre).sub(camera.position).multiplyScalar(MOON_SCALE).add(camera.position);
      moon.current.position.copy(_v);
    }
  });
  const SKY_R = 1800;
  return (
    <group ref={root}>
      <group ref={sky}>
        <Stars radius={SKY_R} depth={200} count={4000} factor={40} saturation={0} fade speed={0.05} />
        {earthDir && <PlanetEarth radius={SKY_R * Math.tan(1.9 * DEG)} sun={sunDir} spin={0.01} segments={64} small position={earthDir.map((v) => v * SKY_R)} />}
      </group>
      <group ref={moon}>
        <PlanetMoon radius={1} scale={R_MOON * K * MOON_SCALE} sun={sunDir} quaternion={moonQ} detail={() => 0.35} exposure={0.62} segments={144} />
      </group>
    </group>
  );
}

/** Two passes each frame: the background (layer 1), then the site and the spacecraft over it (layer 0). */
function Passes() {
  useFrame(({ gl, scene, camera }) => {
    gl.autoClear = false;
    gl.clear(true, true, true);
    camera.layers.set(BG_LAYER);
    gl.render(scene, camera);
    gl.clearDepth();
    camera.layers.set(0);
    gl.render(scene, camera);
  }, 1);
  return null;
}

/* ---- the site, fading as the stage climbs ------------------------------------------------------- */
function FadingSite({ site, base, pose, fx, simRef }) {
  const terrain = useRef();
  const rocks = useRef();
  const horizon = useRef();
  const descent = useRef();
  const last = useRef({ t: -1, r: -1, h: -1 });
  const setOpacity = (group, o) => {
    if (!group) return;
    group.visible = o > 0.005;
    group.traverse((m) => {
      if (!m.material) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach((mat) => {
        const want = o < 0.999;
        if (mat.transparent !== want) {
          mat.transparent = want;
          mat.needsUpdate = true;
        }
        mat.opacity = o;
        mat.depthWrite = o > 0.5;
      });
    });
  };
  useFrame(() => {
    const s = simRef.current;
    if (!s) return;
    const alt = s.r - R_MOON;
    const L = last.current;
    const t = fadeOut(alt, 1600, 5200);
    const r = fadeOut(alt, 300, 900);
    const h = fadeOut(alt, 250, 1400);
    if (Math.abs(t - L.t) > 0.01 || (t === 0) !== (L.t === 0)) setOpacity(terrain.current, t);
    if (Math.abs(r - L.r) > 0.01 || (r === 0) !== (L.r === 0)) setOpacity(rocks.current, r);
    if (Math.abs(h - L.h) > 0.01 || (h === 0) !== (L.h === 0)) setOpacity(horizon.current, h);
    if (descent.current) descent.current.visible = t > 0.02;
    last.current = { t, r, h };
  });
  return (
    <>
      <group ref={terrain}>
        <SiteTerrain site={site} />
      </group>
      <group ref={rocks}>
        <SiteRocks site={site} />
      </group>
      <group ref={horizon}>
        <Horizon site={site} />
      </group>
      {/* the descent stage stays where it landed, its legs as they settled */}
      <group ref={descent} position={base} rotation={[(pose.pitch || 0) * DEG, 0, -(pose.tilt || 0) * DEG]}>
        <LanderModel scale={LM.scale} fx={fx} parts="descent" />
      </group>
    </>
  );
}

/* ---- the ascent stage ----------------------------------------------------------------------------- */
function AscentStage({ simRef, base, pose, viewRef }) {
  const g = useRef();
  const asc = useRef({ x: 0, y: 0, z: 0, rx: 0, rz: 0, thrust: 0 });
  const poseQ = useMemo(() => new THREE.Quaternion().setFromEuler(new THREE.Euler((pose.pitch || 0) * DEG, 0, -(pose.tilt || 0) * DEG)), [pose.pitch, pose.tilt]);
  useFrame((_, delta) => {
    const s = simRef.current;
    if (!s || !g.current) return;
    const f = stageFrame(s, base);
    g.current.position.set(f.pos[0], f.pos[1], f.pos[2]);
    _q.setFromAxisAngle(X_AXIS, f.inertial);
    // on the deck the stage sits as the LM landed; the RCS takes it to the guidance's vertical
    const u = s.engine === "armed" ? 0 : smooth(s.t / 2);
    _qa.copy(poseQ).slerp(_q, u);
    g.current.quaternion.copy(_qa);
    // the engine: fixed thrust (on or off); the plume grows in over a fraction of a second
    const on = s.engine === "on" ? 1 : 0;
    const a = asc.current;
    a.thrust += (on - a.thrust) * Math.min(1, delta * 9);
    if (a.thrust < 0.01) a.thrust = 0;
    // seen from the cockpit, the stage's own outside is not drawn (the camera is at the window)
    g.current.visible = viewRef.current !== "COCKPIT";
  });
  return (
    <group ref={g}>
      <group position={[0, -ASC_CENTRE, 0]}>
        <LanderModel scale={LM.scale} parts="ascent" ascent={asc.current} />
      </group>
    </group>
  );
}

/** The ignition: the engine fires into the descent stage's deck (a flash) and flecks of foil and dust fly out, near the surface only. */
function IgnitionFx({ simRef, base }) {
  const light = useRef();
  const pts = useRef();
  const N = 90;
  const seed = useMemo(() => {
    const a = [];
    let x = 7;
    const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < N; i++) {
      const az = rnd() * Math.PI * 2;
      const sp = 3 + rnd() * 9; // m/s
      const el = 0.05 + rnd() * 0.5;
      a.push([Math.cos(az) * Math.cos(el) * sp, Math.sin(el) * sp, Math.sin(az) * Math.cos(el) * sp]);
    }
    return a;
  }, []);
  const geo = useMemo(() => {
    const gg = new THREE.BufferGeometry();
    gg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    return gg;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame(() => {
    const s = simRef.current;
    const t = s && s.ignitedAt != null && s.engine !== "armed" ? s.t : -1;
    if (light.current) light.current.intensity = t >= 0 && t < 1.2 ? 30 * Math.exp(-t * 4) : 0;
    if (!pts.current) return;
    const live = t >= 0 && t < 2.6;
    pts.current.visible = live;
    if (!live) return;
    const p = geo.attributes.position.array;
    const g = 1.62;
    for (let i = 0; i < N; i++) {
      const v = seed[i];
      const y = Math.max(0, v[1] * t - 0.5 * g * t * t);
      p[i * 3] = base[0] + v[0] * t * K;
      p[i * 3 + 1] = base[1] + 0.4 + y * K;
      p[i * 3 + 2] = base[2] + v[2] * t * K;
    }
    geo.attributes.position.needsUpdate = true;
    pts.current.material.opacity = 0.75 * (1 - t / 2.6);
  });
  return (
    <>
      <pointLight ref={light} position={[base[0], base[1] + 0.95, base[2] + 0.2]} color="#ffb070" intensity={0} distance={10} decay={2} />
      <points ref={pts} geometry={geo} visible={false}>
        <pointsMaterial color="#d8cdb8" size={0.06} sizeAttenuation transparent opacity={0.75} depthWrite={false} />
      </points>
    </>
  );
}

/* ---- the cameras -------------------------------------------------------------------------------- */
function Director({ simRef, base, viewRef }) {
  const { camera } = useThree();
  const pos = useRef(new THREE.Vector3());
  const look = useRef(new THREE.Vector3());
  const up = useRef(new THREE.Vector3(0, 1, 0));
  const ready = useRef(false);
  const lastView = useRef(viewRef.current);
  const blend = useRef(1);
  useFrame((state, delta) => {
    const s = simRef.current;
    if (!s) return;
    const f = stageFrame(s, base);
    const P = _v.set(...f.pos);
    const U = new THREE.Vector3(...f.up);
    const F = new THREE.Vector3(...f.fwd);
    const alt = s.r - R_MOON;
    const view = viewRef.current;
    if (view !== lastView.current) {
      lastView.current = view;
      blend.current = 0; // a clean, short move to the new view
    }
    blend.current = Math.min(1, blend.current + delta / 0.6);
    let camP;
    let camL;
    let camU = U;
    let fov = 45;
    if (view === "COCKPIT") {
      // at the forward window, looking out along the stage's +Z (its windows), its up the thrust axis
      _q.setFromAxisAngle(X_AXIS, f.inertial);
      const eye = new THREE.Vector3(0, 0.5, 0.8).applyQuaternion(_q).add(P);
      // the crew's line of sight: towards the horizon ahead (15° below it), but never more than
      // 55° from the window's own axis (+Z: as the stage pitches over, the windows face the ground)
      const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(_q);
      const want = F.clone().multiplyScalar(Math.cos(15 * DEG)).addScaledVector(U, -Math.sin(15 * DEG));
      const ang = axis.angleTo(want);
      const lim = 55 * DEG;
      const dir = ang <= lim ? want : axis.clone().lerp(want, lim / ang).normalize();
      camP = eye;
      camL = eye.clone().addScaledVector(dir, 20);
      camU = new THREE.Vector3(0, 1, 0).applyQuaternion(_q);
      fov = 64;
    } else {
      // EXTERNAL (and NAV's view behind its display): behind, above and to the side of the stage
      const t = s.engine === "armed" ? -1 : s.t;
      const dM = Math.min(70, 16 + alt * 0.0025); // metres: further out as the stage climbs
      const d = dM * K;
      const chase = P.clone().addScaledVector(F, -d * 0.85).addScaledVector(U, d * 0.42).addScaledVector(X_AXIS, d * 0.45);
      const chaseL = P.clone().addScaledVector(F, d * 0.9).addScaledVector(U, -d * 0.1);
      if (t < 4.5) {
        // on the pad and the first seconds: low by the descent stage, looking up at the separation
        const ground = new THREE.Vector3(base[0] + 8.5, base[1] + 1.0, base[2] - 8.5);
        const u = t < 0 ? 0 : smooth((t - 2.5) / 2);
        camP = ground.lerp(chase, u);
        camL = new THREE.Vector3(base[0], base[1] + 0.2, base[2]).lerp(P, smooth((t + 0.3) / 2)).lerp(chaseL, u);
        if (t < 0) camP.add(new THREE.Vector3(Math.sin(state.clock.elapsedTime * 0.05) * 0.8, 0, 0));
      } else {
        camP = chase;
        camL = chaseL;
      }
    }
    if (!ready.current) {
      pos.current.copy(camP);
      look.current.copy(camL);
      up.current.copy(camU);
      ready.current = true;
    } else {
      // follow the stage rigidly (it moves at km/s); only a view change eases in
      const b = smooth(blend.current);
      const k = b >= 1 ? 1 : Math.min(1, delta * 2 + b * 0.25);
      pos.current.lerp(camP, k);
      look.current.lerp(camL, k);
      up.current.lerp(camU, k).normalize();
    }
    camera.up.copy(up.current);
    camera.position.copy(pos.current);
    camera.lookAt(look.current);
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov += (fov - camera.fov) * Math.min(1, delta * 5);
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

/** The simulation's clock: the player's commands step it every frame (paused, nothing moves). */
function Flight({ simRef, inputRef, pausedRef, warpRef, onTick }) {
  useFrame((_, delta) => {
    const s = simRef.current;
    if (!s || pausedRef.current) return;
    const scale = (warpRef.current || 1) * (typeof window !== "undefined" && window.__lvTimeScale > 0 ? window.__lvTimeScale : 1);
    const dt = Math.min(delta, 0.1) * scale;
    if (s.status === "orbit" || s.status === "failed") {
      drift(s, dt); // the conic flown on behind the result (display only)
      return;
    }
    const inp = inputRef.current.read();
    const before = s.status;
    advance(s, inp, dt);
    onTick(s, before);
  });
  return null;
}

/* ---- text (EN/PT) ----------------------------------------------------------------------------------- */
const TXT = {
  en: {
    title: "MANUAL ASCENT",
    sub: "PILOT THE ASCENT STAGE INTO LUNAR ORBIT",
    brief: (d) =>
      d === "CADET"
        ? "Ignite, rise vertically, then start the pitch program: PITCH ASSIST can fly it for you. The engine cuts off on its own at the target."
        : d === "ASTRONAUT"
          ? "Ignite, rise vertically, then pitch over towards the horizon following the cue. Cut off when the apoapsis reaches 96 km with a safe periapsis (or arm AUTO CUTOFF)."
          : "No cue, no attitude hold: every RCS firing must be stopped by the opposite one. Build horizontal speed and cut off on the orbit you want.",
    target: "TARGET ORBIT",
    targetVal: "APO 96 KM · PERI ≥ 15 KM",
    ignite: "ENGINE IGNITION",
    cutoff: "ENGINE CUTOFF",
    confirmCut: "CONFIRM CUTOFF · NO ORBIT YET",
    pitchUp: "PITCH ▲",
    pitchUpSub: "TOWARD VERTICAL",
    pitchDown: "PITCH ▼",
    pitchDownSub: "TOWARD HORIZON",
    assist: "PITCH ASSIST",
    autoCut: "AUTO CUTOFF",
    on: "ON",
    off: "OFF",
    pause: "PAUSE",
    resume: "RESUME",
    retry: "RETRY ASCENT",
    menu: "RETURN TO MENU",
    cont: "CONTINUE TO RENDEZVOUS",
    attempt: "ATTEMPT",
    paused: "ASCENT PAUSED",
  },
  pt: {
    title: "ASCENSÃO MANUAL",
    sub: "PILOTE O ESTÁGIO DE ASCENSÃO ATÉ A ÓRBITA LUNAR",
    brief: (d) =>
      d === "CADET"
        ? "Ligue o motor, suba na vertical e inicie o programa de inclinação: o PITCH ASSIST pode voá-lo por você. O motor desliga sozinho no alvo."
        : d === "ASTRONAUT"
          ? "Ligue o motor, suba na vertical e incline rumo ao horizonte seguindo a indicação. Desligue quando o apoapsis chegar a 96 km com periapsis seguro (ou arme o AUTO CUTOFF)."
          : "Sem indicação, sem retenção de atitude: cada disparo do RCS precisa ser parado pelo oposto. Ganhe velocidade horizontal e desligue na órbita que quiser.",
    target: "ÓRBITA ALVO",
    targetVal: "APO 96 KM · PERI ≥ 15 KM",
    ignite: "IGNIÇÃO DO MOTOR",
    cutoff: "DESLIGAR MOTOR",
    confirmCut: "CONFIRMAR CORTE · AINDA SEM ÓRBITA",
    pitchUp: "PITCH ▲",
    pitchUpSub: "PARA A VERTICAL",
    pitchDown: "PITCH ▼",
    pitchDownSub: "PARA O HORIZONTE",
    assist: "PITCH ASSIST",
    autoCut: "AUTO CUTOFF",
    on: "LIG",
    off: "DESL",
    pause: "PAUSA",
    resume: "CONTINUAR",
    retry: "TENTAR DE NOVO",
    menu: "VOLTAR AO MENU",
    cont: "SEGUIR PARA O ENCONTRO",
    attempt: "TENTATIVA",
    paused: "ASCENSÃO EM PAUSA",
  },
};
/** The flight's messages (Part 6), in flight order, by data/manualAscent stepOf. */
const STEP_TEXT = {
  en: { IGNITION: "ASCENT ENGINE IGNITION", VERTICAL: "VERTICAL ASCENT", PITCH: "BEGIN PITCH PROGRAM", HORIZONTAL: "BUILD HORIZONTAL VELOCITY", INSERTION: "ORBITAL INSERTION", CUTOFF: "ENGINE CUTOFF", ORBIT: "STABLE ORBIT ACHIEVED", RENDEZVOUS: "RENDEZVOUS READY" },
  pt: { IGNITION: "IGNIÇÃO DO MOTOR DE ASCENSÃO", VERTICAL: "SUBIDA VERTICAL", PITCH: "INICIAR PROGRAMA DE INCLINAÇÃO", HORIZONTAL: "GANHAR VELOCIDADE HORIZONTAL", INSERTION: "INSERÇÃO ORBITAL", CUTOFF: "MOTOR DESLIGADO", ORBIT: "ÓRBITA ESTÁVEL ALCANÇADA", RENDEZVOUS: "PRONTO PARA O ENCONTRO" },
};
const FAILURE_TEXT = {
  en: {
    impact: ["SURFACE IMPACT", "The ascent stage came back down to the surface: it was pitched towards the horizon before it had the speed to stay up."],
    premature: ["PREMATURE CUTOFF · INSUFFICIENT VELOCITY", "The engine stopped below orbital speed: the trajectory meets the surface (periapsis below the ground)."],
    depleted: ["PROPELLANT DEPLETED", "The ascent propellant ran out before a stable orbit: too much of it went into climbing instead of horizontal speed."],
    unrecoverable: ["TRAJECTORY UNRECOVERABLE", "Even the least speed a stable orbit would need from here is more than the engine has left."],
    apoHigh: ["WRONG TRAJECTORY · APOAPSIS ABOVE THE CSM", "The burn went on too long: the orbit climbs above the CSM's, and the rendezvous needs the ascent stage below it."],
    phasing: ["ORBIT NOT RENDEZVOUS-CAPABLE", "A stable orbit, but too low: the ascent stage would pass the CSM before the rendezvous could start."],
    phasingSlow: ["ORBIT NOT RENDEZVOUS-CAPABLE", "A stable orbit, but too close below the CSM's: the ascent stage would gain on it too slowly to catch it within five orbits."],
    rendezvous: ["INSUFFICIENT PROPELLANT FOR RENDEZVOUS", "A stable orbit, but the rendezvous from it needs more Δv than the stage has left."],
  },
  pt: {
    impact: ["IMPACTO NA SUPERFÍCIE", "O estágio de ascensão voltou à superfície: inclinou para o horizonte antes de ter velocidade para se manter no alto."],
    premature: ["CORTE PREMATURO · VELOCIDADE INSUFICIENTE", "O motor parou abaixo da velocidade orbital: a trajetória encontra a superfície (periapsis abaixo do solo)."],
    depleted: ["PROPELENTE ESGOTADO", "O propelente de ascensão acabou antes de uma órbita estável: muito dele foi para a subida em vez da velocidade horizontal."],
    unrecoverable: ["TRAJETÓRIA IRRECUPERÁVEL", "Mesmo a menor velocidade que uma órbita estável exigiria daqui é maior do que o motor ainda tem."],
    apoHigh: ["TRAJETÓRIA ERRADA · APOAPSIS ACIMA DO CSM", "A queima durou demais: a órbita sobe acima da do CSM, e o encontro exige o estágio de ascensão abaixo dele."],
    phasing: ["ÓRBITA SEM CONDIÇÃO DE ENCONTRO", "Uma órbita estável, mas baixa demais: o estágio passaria o CSM antes de o encontro começar."],
    phasingSlow: ["ÓRBITA SEM CONDIÇÃO DE ENCONTRO", "Uma órbita estável, mas próxima demais abaixo da do CSM: o estágio o alcançaria devagar demais, sem chegar em cinco órbitas."],
    rendezvous: ["PROPELENTE INSUFICIENTE PARA O ENCONTRO", "Uma órbita estável, mas o encontro a partir dela exige mais Δv do que o estágio ainda tem."],
  },
};
/** The onboard computer's messages (COMPUTER role; on the far side the only voice besides the crew). */
const ONBOARD = {
  verified: "comp.ascentVerified",
  authorized: "comp.ignitionAuthorized",
  pitch: "comp.beginPitch",
  velocityLow: "comp.velocityLow",
  insertion: "comp.insertionApproaching",
  cutoff: "comp.cutoffRecommended",
  orbit: "comp.orbitConfirmed",
};
const ONBOARD_TEXT = {
  en: { verified: "ASCENT CONFIGURATION VERIFIED.", authorized: "IGNITION AUTHORIZED.", pitch: "BEGIN PITCH PROGRAM.", velocityLow: "VELOCITY BELOW TARGET.", insertion: "ORBITAL INSERTION APPROACHING.", cutoff: "ENGINE CUTOFF RECOMMENDED.", orbit: "STABLE LUNAR ORBIT CONFIRMED." },
  pt: { verified: "CONFIGURAÇÃO DE ASCENSÃO VERIFICADA.", authorized: "IGNIÇÃO AUTORIZADA.", pitch: "INICIAR PROGRAMA DE INCLINAÇÃO.", velocityLow: "VELOCIDADE ABAIXO DO ALVO.", insertion: "INSERÇÃO ORBITAL SE APROXIMANDO.", cutoff: "CORTE DO MOTOR RECOMENDADO.", orbit: "ÓRBITA LUNAR ESTÁVEL CONFIRMADA." },
};

const km = (m, d = 1) => (Number.isFinite(m) ? (m / 1000).toFixed(d) : "∞");
const sgn = (v, d = 0) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}`;

/* ---- the NAV display ------------------------------------------------------------------------------ */
function NavDisplay({ s, lang }) {
  // a Moon-centred view of the orbit's plane, turned so the stage is at the top: the surface,
  // the conic the stage is on, the target apoapsis, the CSM's orbit and the CSM
  const W = 1000;
  const H = 560;
  const pp = planePos(s.r, s.th);
  const ang = Math.atan2(pp[0], pp[1]);
  const span = 1150e3; // m across the display
  const sc = W / span;
  const cx = W / 2;
  const cy = 250 + s.r * sc; // the Moon's centre below the view: the stage stays 250 px from the top
  const rot = (p) => {
    const c = Math.cos(ang);
    const sn = Math.sin(ang);
    const x = p[0] * c - p[1] * sn;
    const y = p[0] * sn + p[1] * c;
    return [cx + x * sc, cy - y * sc];
  };
  const path = useMemo(() => orbitPath(s.r, s.th, s.vr, s.vt, 220), [s.r, s.th, s.vr, s.vt]);
  const d = path.map((p, i) => `${i ? "L" : "M"}${rot(p)[0].toFixed(1)},${rot(p)[1].toFixed(1)}`).join(" ");
  const me = rot(pp);
  const csmA = csmAngle(s.t);
  const csm = rot(planePos(ORBIT_R, csmA));
  const vel = [s.vr * Math.sin(s.th) + s.vt * Math.cos(s.th), s.vr * Math.cos(s.th) - s.vt * Math.sin(s.th)];
  const vlen = Math.hypot(vel[0], vel[1]) || 1;
  const vEnd = rot([pp[0] + (vel[0] / vlen) * 60e3, pp[1] + (vel[1] / vlen) * 60e3]);
  const thrustA = s.th + s.pitch;
  const tEnd = rot([pp[0] + Math.sin(thrustA) * 40e3, pp[1] + Math.cos(thrustA) * 40e3]);
  const T = lang === "pt" ? { title: "NAV · TRAJETÓRIA", target: "ALVO 96 KM", csm: "CSM 110 KM", traj: "TRAJETÓRIA PREVISTA", vel: "VELOCIDADE", thr: "EMPUXO" } : { title: "NAV · TRAJECTORY", target: "TARGET 96 KM", csm: "CSM 110 KM", traj: "PREDICTED TRAJECTORY", vel: "VELOCITY", thr: "THRUST" };
  return (
    <div className="absolute inset-0 z-10 bg-[#03060a] pointer-events-none" data-testid="ascent-nav">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full">
        <defs>
          <clipPath id="navclip">
            <rect x="0" y="0" width={W} height={H} />
          </clipPath>
        </defs>
        <g clipPath="url(#navclip)">
          <circle cx={cx} cy={cy} r={R_MOON * sc} fill="#15181d" stroke="#6b7480" strokeWidth="1.2" />
          <circle cx={cx} cy={cy} r={(R_MOON + TARGET.apo) * sc} fill="none" stroke="#5be37a" strokeWidth="1" strokeDasharray="6 6" opacity="0.7" />
          <circle cx={cx} cy={cy} r={(R_MOON + TARGET.safePeri) * sc} fill="none" stroke="#f5c451" strokeWidth="0.8" strokeDasharray="2 6" opacity="0.6" />
          <circle cx={cx} cy={cy} r={ORBIT_R * sc} fill="none" stroke="#6aa8ff" strokeWidth="1" opacity="0.65" />
          {path.length > 1 && <path d={d} fill="none" stroke="#ffffff" strokeWidth="1.6" opacity="0.9" data-testid="ascent-nav-path" />}
          <line x1={me[0]} y1={me[1]} x2={vEnd[0]} y2={vEnd[1]} stroke="#4fd1c5" strokeWidth="2" />
          {s.engine === "on" && <line x1={me[0]} y1={me[1]} x2={tEnd[0]} y2={tEnd[1]} stroke="#FF3B00" strokeWidth="2" />}
          <circle cx={me[0]} cy={me[1]} r="5" fill="#FF3B00" />
          <circle cx={csm[0]} cy={csm[1]} r="4.5" fill="#6aa8ff" />
          <text x={csm[0] + 8} y={csm[1] - 6} fill="#6aa8ff" fontSize="13" fontFamily="monospace">CSM</text>
        </g>
      </svg>
      <div className="absolute left-1/2 -translate-x-1/2 bottom-[calc(var(--sab)+0.6rem)] flex flex-wrap justify-center gap-x-3 gap-y-0.5 w-[min(420px,44vw)] font-mono text-[8.5px] tracking-[0.15em]" data-testid="ascent-nav-legend">
        <span className="text-white">— {T.traj}</span>
        <span className="text-[#5be37a]">- - {T.target}</span>
        <span className="text-[#6aa8ff]">— {T.csm}</span>
        <span className="text-[#4fd1c5]">→ {T.vel}</span>
        <span className="text-[#FF3B00]">→ {T.thr}</span>
      </div>
    </div>
  );
}

/* ---- the component ------------------------------------------------------------------------------- */
/**
 * Props: siteId, pose (the landing's), difficulty, farSide, audio, lang, attempt (this ascent's
 * attempt number), onStart() (ENGINE IGNITION: an attempt under way), onInsertion(result) (a
 * stable, rendezvous-capable orbit: CONTINUE TO RENDEZVOUS), onFailed(result) (the attempt
 * failed: reported once), onRetry() (RETRY ASCENT), onMenu() (RETURN TO MENU).
 */
export default function ManualAscent({ siteId, pose = null, difficulty = "ASTRONAUT", farSide = false, audio = null, lang = "en", attempt = 1, onStart = null, onInsertion, onFailed = null, onRetry, onMenu }) {
  const site = useMemo(() => getSite(siteId), [siteId]);
  const L = lang === "pt" ? "pt" : "en";
  const T = TXT[L];
  const cfg = ASCENT_DIFFICULTY[difficulty] || ASCENT_DIFFICULTY.ASTRONAUT;
  const p = pose || { x: 0, padY: site.contactGround ? site.scale.y(site.contactGround(0)) : 0, tilt: 0, pitch: 0, comp: [0, 0, 0, 0], probe: [0, 0, 0, 0] };
  const base = useMemo(() => [p.x, p.padY + LM.foot, 0], [p.x, p.padY]);
  const fx = useMemo(() => ({ thrust: 0, comp: (p.comp || [0, 0, 0, 0]).slice(), probe: (p.probe || [0, 0, 0, 0]).slice() }), [p.comp, p.probe]);

  const simRef = useRef(null);
  if (!simRef.current) simRef.current = createAscent(difficulty);
  const [view, setViewState] = useState("EXTERNAL");
  const viewRef = useRef("EXTERNAL");
  const setView = (v) => {
    if (!VIEWS.includes(v)) return;
    viewRef.current = v;
    setViewState(v);
  };
  const pausedRef = useRef(false);
  const [paused, setPausedState] = useState(false);
  const setPaused = (v) => {
    pausedRef.current = v;
    setPausedState(v);
    held.current.clear();
  };
  const warpRef = useRef(1);
  const [warp, setWarpState] = useState(1);
  const setWarp = (w) => {
    warpRef.current = w;
    setWarpState(w);
  };
  const [tele, setTele] = useState(() => telemetry(simRef.current));
  const [status, setStatus] = useState("pad"); // pad | flight | orbit | failed
  const [ready, setReady] = useState(false); // IGNITION AUTHORIZED
  const [assistOn, setAssistOn] = useState(false);
  const [autoCut, setAutoCut] = useState(cfg.autoCutoff === "on");
  const assistRef = useRef(false);
  const autoCutRef = useRef(cfg.autoCutoff === "on");
  const [confirmCut, setConfirmCut] = useState(false);
  const [onboard, setOnboard] = useState(null); // the onboard computer's last message
  const said = useRef(new Set());
  const reported = useRef(false);

  /* -- input: the pitch control (held buttons and keys, a minimum pulse per tap), ignition, cutoff -- */
  const held = useRef(new Map()); // key → { v, until, down }
  const edges = useRef({ ignite: false, cutoff: false });
  const press = (key, v) => held.current.set(key, { v, until: performance.now() + 120, down: true });
  const release = (key) => {
    const h = held.current.get(key);
    if (!h) return;
    h.down = false;
    if (performance.now() >= h.until) held.current.delete(key);
  };
  const inputRef = useRef(null);
  if (!inputRef.current)
    inputRef.current = {
      read: () => {
        const now = performance.now();
        let pitch = 0;
        for (const [k, h] of held.current) {
          if (!h.down && now >= h.until) {
            held.current.delete(k);
            continue;
          }
          pitch += h.v;
        }
        const tool = typeof window !== "undefined" && window.__lvAscentTools && window.__lvAscentTools.pilot;
        const out = { pitch: Math.max(-1, Math.min(1, pitch)), ignite: edges.current.ignite, cutoff: edges.current.cutoff, assist: assistRef.current, autoCutoff: autoCutRef.current };
        edges.current = { ignite: false, cutoff: false };
        // validation tooling: a scripted pilot (the same commands a player gives)
        if (tool && simRef.current) return { ...out, ...tool(simRef.current, telemetry(simRef.current)) };
        return out;
      },
    };

  const say = (id, o) => audio && audio.say && audio.say(id, o);
  const once = (k, fn) => {
    if (said.current.has(k)) return;
    said.current.add(k);
    fn();
  };
  const computer = (k) =>
    once("c-" + k, () => {
      setOnboard({ k, text: ONBOARD_TEXT[L][k], at: Date.now() });
      say(ONBOARD[k]);
    });

  // validation tooling: the guidance's own functions, for a scripted pilot (window.__lvAscentTools.pilot)
  // that gives the same commands a player does — pitch control, cutoff — never positions
  useEffect(() => {
    if (typeof window !== "undefined") window.__lvAscentLib = { guidancePitch, cutoffDue, orbitOf, VERTICAL_RISE };
  }, []);

  // the preparation: onboard checks, then the ignition is authorized (no Earth link on the far side)
  useEffect(() => {
    if (audio && farSide && audio.setEarthLink) audio.setEarthLink(false);
    const ts = [];
    ts.push(setTimeout(() => computer("verified"), 900));
    if (!farSide) ts.push(setTimeout(() => say("capcom.manualAscentGo"), 2200));
    ts.push(setTimeout(() => {
      computer("authorized");
      setReady(true);
    }, farSide ? 2400 : 4200));
    return () => {
      ts.forEach(clearTimeout);
      if (audio) audio.stopRumble && audio.stopRumble();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the HUD: ten times a second, from the simulation
  useEffect(() => {
    const id = setInterval(() => {
      const s = simRef.current;
      const t = telemetry(s);
      setTele(t);
      if (typeof window !== "undefined") window.__lvManualAscent = { ...t, attempt, view: viewRef.current, paused: pausedRef.current, warp: warpRef.current, difficulty, siteId, descentStays: true, evaluation: s.evaluation || null, separated: s.engine !== "armed", cutoffBy: s.cutoffBy };
    }, 100);
    return () => clearInterval(id);
  }, [attempt, difficulty, siteId]);

  // the messages the flight earns (each from the simulation's state)
  useEffect(() => {
    const t = tele;
    if (status !== "flight") return;
    if (t.t >= VERTICAL_RISE && !t.pitchProgram) computer("pitch");
    if (t.apo >= TARGET.apo && t.peri < TARGET.safePeri && t.t > 60) computer("velocityLow");
    if (t.apo >= TARGET.apo * 0.8 && t.peri > -400000) computer("insertion");
    if (t.guidance && t.guidance.cutoff) computer("cutoff");
    else if (!cfg.cue && cutoffDue(simRef.current)) computer("cutoff");
    // near side: Houston's pitchover call
    if (!farSide && t.pitchProgram && t.t > VERTICAL_RISE) once("capcom-pitch", () => say("ascent.pitchover"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tele, status]);

  const onTick = (s, before) => {
    if (s.status !== before) {
      setStatus(s.status);
      if (s.status === "flight") {
        if (audio) {
          audio.say && audio.say("ascent.proceed");
          audio.thud && audio.thud(0.5);
          audio.startRumble && audio.startRumble(0.35);
        }
        if (onStart) onStart();
      }
      if (s.status === "orbit" || s.status === "failed") {
        if (audio) audio.stopRumble && audio.stopRumble();
        held.current.clear();
        setConfirmCut(false);
        if (s.status === "orbit") {
          computer("orbit");
          if (!farSide) setTimeout(() => say("capcom.manualOrbit"), 2600);
        }
        if (s.status === "failed" && !reported.current && onFailed) {
          reported.current = true;
          onFailed(resultOf(s));
        }
      }
    }
    if (s.engine !== "on" && before === "flight" && audio && audio.stopRumble) audio.stopRumble();
  };

  const resultOf = (s) => {
    const e = s.evaluation || {};
    return {
      mode: "manual",
      success: s.status === "orbit",
      failure: s.failure ? s.failure.kind : null,
      apo: Number.isFinite(e.apo) ? e.apo : null,
      peri: Number.isFinite(e.peri) ? e.peri : null,
      fuelKg: s.prop,
      fuelPct: (100 * s.prop) / STAGE.prop,
      burn: s.cutoffAt,
      cutoffBy: s.cutoffBy,
      accuracy: e.accuracy || null,
      rendezvousDv: e.rendezvous ? e.rendezvous.dv : null,
      rendezvousBudget: e.rendezvous ? e.rendezvous.budget : null,
      cut: e.cut || null,
      difficulty,
      attempt,
    };
  };

  /* -- commands -- */
  const ignite = () => {
    const s = simRef.current;
    if (!ready || s.engine !== "armed" || pausedRef.current) return;
    edges.current.ignite = true;
  };
  const cutoff = () => {
    const s = simRef.current;
    if (s.engine !== "on" || pausedRef.current) return;
    const orbital = telemetry(s).orbital;
    // CADET: a cutoff below orbit asks once more (the strongest warning); the others act at once
    if (cfg.confirmCutoff && !orbital && !confirmCut) {
      setConfirmCut(true);
      setTimeout(() => setConfirmCut(false), 2500);
      return;
    }
    setConfirmCut(false);
    edges.current.cutoff = true;
  };
  const toggleAssist = () => {
    const v = !assistRef.current;
    assistRef.current = v;
    setAssistOn(v);
  };
  const toggleAutoCut = () => {
    if (cfg.autoCutoff === "none") return;
    const v = !autoCutRef.current;
    autoCutRef.current = v;
    setAutoCut(v);
  };

  // keyboard (desktop): W/↑ toward vertical, S/↓ toward the horizon, Space ignition/cutoff, 1-3 views
  useEffect(() => {
    const map = { KeyW: -1, ArrowUp: -1, KeyS: 1, ArrowDown: 1 };
    const views = { Digit1: "EXTERNAL", Digit2: "COCKPIT", Digit3: "NAV" };
    const dn = (e) => {
      if (map[e.code] != null) {
        e.preventDefault();
        if (!held.current.has("k" + e.code) || !held.current.get("k" + e.code).down) press("k" + e.code, map[e.code]);
      } else if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) (simRef.current.engine === "armed" ? ignite : cutoff)();
      } else if (views[e.code]) setView(views[e.code]);
    };
    const up = (e) => map[e.code] != null && release("k" + e.code);
    const letGo = () => held.current.clear();
    const vis = () => document.hidden && letGo();
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", letGo);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("keydown", dn);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", letGo);
      document.removeEventListener("visibilitychange", vis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, confirmCut]);

  const s = simRef.current;
  const t = tele;
  const stepText = STEP_TEXT[L][status === "orbit" ? "RENDEZVOUS" : t.step];
  const insertion =
    t.engine === "armed"
      ? "—"
      : t.peri < 0
        ? L === "pt" ? "SUBORBITAL" : "SUBORBITAL"
        : t.peri < TARGET.safePeri
          ? L === "pt" ? "ÓRBITA · PERIAPSIS BAIXO" : "ORBIT · PERIAPSIS LOW"
          : t.apo > TARGET.apoLimit
            ? L === "pt" ? "APOAPSIS ACIMA DO LIMITE" : "APOAPSIS ABOVE LIMIT"
            : t.apo < TARGET.apo - 6000
              ? L === "pt" ? "ESTÁVEL · APOAPSIS BAIXO" : "STABLE · APOAPSIS LOW"
              : L === "pt" ? "ESTÁVEL · NO ALVO" : "STABLE · ON TARGET";
  // the alerts: subtle, from the state; CADET the most, COMMANDER only the critical ones
  const alerts = [];
  if (status === "flight") {
    const W = cfg.warnings;
    if (t.vr < -5 && t.peri < TARGET.safePeri && t.alt < 25000) alerts.push({ k: "desc", crit: true, text: L === "pt" ? "DESCENDO · INCLINE PARA CIMA" : "DESCENDING · PITCH UP" });
    if (t.fuelPct < 10 && t.engine === "on") alerts.push({ k: "fuel", crit: true, text: L === "pt" ? `PROPELENTE ${t.fuelPct.toFixed(0)}%` : `PROPELLANT ${t.fuelPct.toFixed(0)}%` });
    if (W !== "critical" && t.marginal && t.t > 30) alerts.push({ k: "marg", text: L === "pt" ? "VELOCIDADE HORIZONTAL BAIXA · INCLINE PARA O HORIZONTE" : "HORIZONTAL SPEED LOW · PITCH TOWARD HORIZON" });
    if (W !== "critical" && t.apo >= TARGET.apo && t.peri < TARGET.safePeri) alerts.push({ k: "peri", text: L === "pt" ? "APOAPSIS NO ALVO · PERIAPSIS AINDA BAIXO" : "APOAPSIS ON TARGET · PERIAPSIS STILL LOW" });
    if (W !== "critical" && t.rcsPct < 20) alerts.push({ k: "rcs", text: `RCS ${t.rcsPct.toFixed(0)}%` });
    if (W === "strong" && t.guidance && t.t > VERTICAL_RISE && t.pitchProgram && Math.abs(t.guidance.pitch - t.pitch) > 10 && !assistOn) alerts.push({ k: "cue", text: L === "pt" ? "SIGA A INDICAÇÃO DE INCLINAÇÃO" : "FOLLOW THE PITCH CUE" });
    if (W === "strong" && t.t >= VERTICAL_RISE + 4 && !t.pitchProgram) alerts.push({ k: "start", text: L === "pt" ? "SEGURE PITCH ▼ PARA INICIAR A INCLINAÇÃO" : "HOLD PITCH ▼ TO START THE PITCH OVER" });
  }
  const cue = t.guidance && t.t >= VERTICAL_RISE ? t.guidance.pitch : null;
  const ev = s.evaluation || null;
  const failKey = s.failure ? (s.failure.kind === "phasing" && ev && ev.rendezvous && ev.rendezvous.reason === "slow" ? "phasingSlow" : s.failure.kind) : null;
  const fail = status === "failed" && s.failure ? FAILURE_TEXT[L][failKey] || [s.failure.kind, ""] : null;
  const hold = (key, v) => ({
    onPointerDown: (e) => {
      e.preventDefault();
      if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
      if (status === "flight" && !pausedRef.current) press(key, v);
    },
    onPointerUp: () => release(key),
    onPointerCancel: () => release(key),
    onLostPointerCapture: () => release(key),
    onContextMenu: (e) => e.preventDefault(),
  });
  const row = (k, v, testid, tone = "text-white") => (
    <div className="flex items-baseline justify-between gap-2 leading-tight" data-testid={testid}>
      <span className="text-zinc-400 shrink-0">{k}</span>
      <span className={`tabular-nums text-right ${tone}`}>{v}</span>
    </div>
  );

  return (
    <div className="absolute inset-0 bg-[#050505] select-none" data-testid="manual-ascent" data-status={status} data-view={view} data-difficulty={difficulty}>
      <div className="absolute inset-0 canvas-host">
        <Canvas
          camera={{ position: [base[0] + 8.5, base[1] + 1.0, base[2] - 8.5], fov: 45, near: 0.1, far: 8000 }}
          dpr={[1, 2]}
          shadows={{ type: THREE.PCFShadowMap }}
          gl={{ antialias: true, alpha: false, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }}
          onCreated={({ gl }) => gl.setClearColor("#050505")}
        >
          <Suspense fallback={null}>
            <Background site={site} base={base} simRef={simRef} />
            <SiteSun site={site} focus={() => stageFrame(simRef.current, base).pos} />
            <FadingSite site={site} base={base} pose={p} fx={fx} simRef={simRef} />
            <AscentStage simRef={simRef} base={base} pose={p} viewRef={viewRef} />
            <IgnitionFx simRef={simRef} base={base} />
            <Director simRef={simRef} base={base} viewRef={viewRef} />
            <Flight simRef={simRef} inputRef={inputRef} pausedRef={pausedRef} warpRef={warpRef} onTick={onTick} />
          </Suspense>
          <Passes />
          <AdaptiveResolution />
        </Canvas>
      </div>

      {view === "NAV" && <NavDisplay s={{ ...s, t: t.t }} lang={L} />}
      {view === "COCKPIT" && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-[5]" viewBox="0 0 100 56" preserveAspectRatio="none" data-testid="ascent-cockpit">
          {/* the LM's forward window: a dark frame around a canted triangle-ish pane */}
          <path d="M0 0 H100 V56 H0 Z M14 6 L86 6 L80 44 L58 52 L42 52 L20 44 Z" fill="#06080b" fillRule="evenodd" opacity="0.94" />
          <path d="M14 6 L86 6 L80 44 L58 52 L42 52 L20 44 Z" fill="none" stroke="#2a2f36" strokeWidth="0.8" />
        </svg>
      )}

      {/* top: the flight's message (subtle), the onboard computer, the alerts */}
      <div className="absolute top-3 short:top-1.5 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1 pointer-events-none w-[min(440px,52vw)]">
        {status !== "pad" && (
          <div className="font-mono text-[10px] short:text-[9px] tracking-[0.32em] text-white/90 bg-black/35 px-3 py-1 text-center" data-testid="ascent-step" data-step={status === "orbit" ? "RENDEZVOUS" : t.step}>
            {stepText}
          </div>
        )}
        {onboard && Date.now() - onboard.at < 6000 && (
          <div className="font-mono text-[9px] short:text-[8.5px] tracking-[0.22em] text-[#9fe0ff] bg-black/30 px-2 py-0.5 text-center" data-testid="ascent-onboard" data-key={onboard.k}>
            {farSide ? (L === "pt" ? "COMPUTADOR · " : "COMPUTER · ") : "LGC · "}
            {onboard.text}
          </div>
        )}
        {alerts.slice(0, 2).map((a) => (
          <div key={a.k} className={`font-mono text-[9px] short:text-[8.5px] tracking-[0.2em] px-2 py-0.5 text-center ${a.crit ? "text-[#ffb4a0] bg-[#3a0d05]/55" : "text-[#f5c451] bg-black/35"}`} data-testid="ascent-alert" data-key={a.k}>
            {a.text}
          </div>
        ))}
      </div>

      {/* top left: pause, the attempt; top right: the views and the time rate */}
      <div className="absolute top-3 short:top-1.5 left-[calc(var(--sal)+0.75rem)] z-30 flex items-center gap-2">
        <button type="button" onClick={() => setPaused(true)} disabled={status === "orbit" || status === "failed"} className="min-h-[40px] px-3 font-mono text-[9.5px] tracking-[0.25em] text-white bg-black/45 border border-white/20 disabled:opacity-30 touch-manipulation" data-testid="ascent-pause">
          ❚❚ {T.pause}
        </button>
        <span className="font-mono text-[8.5px] tracking-[0.25em] text-zinc-400" data-testid="ascent-attempt">
          {T.attempt} {attempt} · {difficulty}
        </span>
      </div>
      <div className="absolute top-3 short:top-1.5 right-[calc(var(--sar)+0.75rem)] z-30 flex items-center gap-1.5">
        {VIEWS.map((v) => (
          <button key={v} type="button" onClick={() => setView(v)} className={`min-h-[40px] px-2.5 font-mono text-[9px] tracking-[0.2em] border touch-manipulation ${view === v ? "text-black bg-white border-white" : "text-white bg-black/45 border-white/20"}`} data-testid={`ascent-view-${v.toLowerCase()}`}>
            {v}
          </button>
        ))}
        <button type="button" onClick={() => setWarp(WARPS[(WARPS.indexOf(warp) + 1) % WARPS.length])} className="min-h-[40px] px-2.5 font-mono text-[9px] tracking-[0.2em] text-white bg-black/45 border border-white/20 touch-manipulation" data-testid="ascent-warp">
          ×{warp}
        </button>
      </div>

      {/* left: LUNAR ASCENT telemetry (every value from the simulation) */}
      <div className="absolute left-[calc(var(--sal)+0.75rem)] top-[3.6rem] short:top-[2.9rem] z-20 w-[min(190px,24vw)] hud-panel border-l-2 border-[#FF3B00] px-2.5 py-2 short:py-1.5 font-mono text-[10px] short:text-[9px] tracking-[0.08em] space-y-0.5" data-testid="ascent-hud">
        <div className="text-[8.5px] tracking-[0.3em] text-[#FF3B00] mb-0.5">● {L === "pt" ? "ASCENSÃO LUNAR" : "LUNAR ASCENT"}</div>
        {row(L === "pt" ? "ALTITUDE" : "ALTITUDE", t.alt < 10000 ? `${t.alt.toFixed(0)} M` : `${km(t.alt)} KM`, "ascent-alt")}
        {row(L === "pt" ? "VEL VERT" : "VERT SPD", `${sgn(t.vr, 1)} M/S`, "ascent-vs")}
        {row(L === "pt" ? "VEL HORIZ" : "HORIZ SPD", `${t.vt.toFixed(1)} M/S`, "ascent-hs")}
        {row(L === "pt" ? "VEL TOTAL" : "TOTAL SPD", `${t.v.toFixed(1)} M/S`, "ascent-v")}
        {row("PITCH", `${t.pitch.toFixed(1)}°${cue != null ? ` · ${L === "pt" ? "ALVO" : "CUE"} ${cue.toFixed(0)}°` : ""}`, "ascent-pitch", cue != null && Math.abs(cue - t.pitch) > 8 ? "text-[#f5c451]" : "text-white")}
        {row(L === "pt" ? "RUMO" : "HEADING", `270° W · FPA ${sgn(t.fpa, 1)}°`, "ascent-heading")}
        {row(L === "pt" ? "PROPELENTE" : "FUEL", `${t.fuelKg.toFixed(0)} KG · ${t.fuelPct.toFixed(0)}%`, "ascent-fuel", t.fuelPct < 10 ? "text-[#ffb4a0]" : "text-white")}
        {row(L === "pt" ? "QUEIMA REST" : "BURN LEFT", `${t.burnLeft.toFixed(0)} S`, "ascent-burnleft")}
        {row(L === "pt" ? "MOTOR" : "ENGINE", t.engine === "armed" ? (ready ? (L === "pt" ? "ARMADO" : "ARMED") : (L === "pt" ? "VERIFICANDO" : "CHECKS")) : t.engine === "on" ? (L === "pt" ? "LIGADO · 15,6 KN" : "ON · 15.6 KN") : t.engine === "depleted" ? (L === "pt" ? "SEM PROPELENTE" : "DEPLETED") : L === "pt" ? "DESLIGADO" : "CUTOFF", "ascent-engine", t.engine === "on" ? "text-[#FF7A45]" : "text-white")}
        {row("RCS", `${cfg.hold ? (assistOn && cfg.pitchAssist && s.assist ? "AUTO" : "HOLD") : L === "pt" ? "DIRETO" : "DIRECT"} · ${t.rcsPct.toFixed(0)}%${Math.abs(t.rcsFiring) > 0.05 ? " ◆" : ""}`, "ascent-rcs")}
      </div>

      {/* right: the orbit (the conic the burn has made so far) and the guidance */}
      <div className="absolute right-[calc(var(--sar)+0.75rem)] top-[3.6rem] short:top-[2.9rem] z-20 w-[min(190px,24vw)] hud-panel border-l-2 border-[#5be37a] px-2.5 py-2 short:py-1.5 font-mono text-[10px] short:text-[9px] tracking-[0.08em] space-y-0.5" data-testid="ascent-orbit">
        <div className="text-[8.5px] tracking-[0.3em] text-[#5be37a] mb-0.5">● {L === "pt" ? "GUIAGEM ORBITAL" : "ORBITAL GUIDANCE"}</div>
        {row("APOAPSIS", t.engine === "armed" ? "—" : `${km(t.apo)} KM`, "ascent-apo")}
        {row("PERIAPSIS", t.engine === "armed" ? "—" : t.peri < 0 ? (L === "pt" ? "SOB O SOLO" : "BELOW SURFACE") : `${km(t.peri)} KM`, "ascent-peri", t.peri >= TARGET.safePeri ? "text-[#5be37a]" : "text-white")}
        {row(T.target, T.targetVal, "ascent-target", "text-zinc-200")}
        {row(L === "pt" ? "INSERÇÃO" : "INSERTION", insertion, "ascent-insertion", t.orbital && t.apo <= TARGET.apoLimit ? "text-[#5be37a]" : "text-white")}
        {row("CSM", `${km(t.csmRange, 0)} KM`, "ascent-csm")}
        {t.guidance && !t.guidance.cutoff && t.guidance.cutoffIn != null && t.guidance.cutoffIn < 60 && row(L === "pt" ? "CORTE EM" : "CUTOFF IN", `${t.guidance.cutoffIn.toFixed(1)} S`, "ascent-tgo", t.guidance.cutoffIn < 5 ? "text-[#f5c451]" : "text-white")}
        {t.guidance && t.guidance.cutoff && <div className="text-[#5be37a] tracking-[0.18em]" data-testid="ascent-cue-cutoff">{L === "pt" ? "▶ DESLIGUE O MOTOR" : "▶ CUT OFF NOW"}</div>}
      </div>

      {/* the preparation */}
      {status === "pad" && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-[calc(var(--sab)+0.75rem)] z-20 w-[min(420px,50vw)] hud-panel border-l-2 border-[#FF3B00] px-3 py-2 short:py-1.5 veil-in" data-testid="ascent-manual-brief">
          <div className="font-mono text-[9px] tracking-[0.35em] text-[#FF3B00]">● {T.title} · {difficulty}</div>
          <div className="font-mono text-[9px] tracking-[0.2em] text-zinc-300 mt-0.5">{T.sub}</div>
          <p className="text-[11px] short:text-[10px] leading-snug text-zinc-200 mt-1">{T.brief(difficulty)}</p>
        </div>
      )}

      {/* bottom left: the engine */}
      {(status === "pad" || status === "flight") && (
        <div className="absolute left-[calc(var(--sal)+0.75rem)] bottom-[calc(var(--sab)+0.75rem)] z-30 flex flex-col gap-1.5">
          {status === "pad" ? (
            <button type="button" onClick={ignite} disabled={!ready} className="min-h-[60px] w-[min(190px,24vw)] font-mono text-[11px] tracking-[0.25em] text-white bg-[#FF3B00]/90 border border-[#FF3B00] disabled:opacity-35 touch-manipulation" data-testid="ascent-ignite">
              {T.ignite}
            </button>
          ) : (
            <button type="button" onClick={cutoff} disabled={t.engine !== "on"} className={`min-h-[60px] w-[min(190px,24vw)] font-mono text-[10.5px] tracking-[0.22em] text-white border touch-manipulation disabled:opacity-35 ${confirmCut ? "bg-[#a01d00] border-[#ffb4a0]" : "bg-black/55 border-[#FF3B00]"}`} data-testid="ascent-cutoff">
              {confirmCut ? T.confirmCut : T.cutoff}
            </button>
          )}
          {(cfg.pitchAssist || cfg.autoCutoff === "optional") && status === "flight" && (
            <div className="flex gap-1.5">
              {cfg.pitchAssist && (
                <button type="button" onClick={toggleAssist} className={`min-h-[42px] flex-1 font-mono text-[8.5px] tracking-[0.15em] border touch-manipulation ${assistOn ? "text-black bg-[#9fe0ff] border-[#9fe0ff]" : "text-white bg-black/45 border-white/25"}`} data-testid="ascent-assist" data-on={assistOn ? "1" : "0"}>
                  {T.assist} {assistOn ? T.on : T.off}
                </button>
              )}
              <button type="button" onClick={toggleAutoCut} className={`min-h-[42px] flex-1 font-mono text-[8.5px] tracking-[0.15em] border touch-manipulation ${autoCut ? "text-black bg-[#5be37a] border-[#5be37a]" : "text-white bg-black/45 border-white/25"}`} data-testid="ascent-autocut" data-on={autoCut ? "1" : "0"}>
                {T.autoCut} {autoCut ? T.on : T.off}
              </button>
            </div>
          )}
        </div>
      )}

      {/* bottom right: the RCS pitch control */}
      {(status === "pad" || status === "flight") && (
        <div className="absolute right-[calc(var(--sar)+0.75rem)] bottom-[calc(var(--sab)+0.75rem)] z-30 flex flex-col gap-1.5 w-[min(150px,20vw)]">
          <button type="button" {...hold("up", -1)} disabled={status !== "flight"} className="min-h-[58px] short:min-h-[52px] flex flex-col items-center justify-center font-mono text-white bg-black/50 border border-white/30 active:bg-white/20 disabled:opacity-30 touch-none" data-testid="ascent-pitch-up">
            <span className="text-[12px] tracking-[0.2em]">{T.pitchUp}</span>
            <span className="text-[7.5px] tracking-[0.18em] text-zinc-400">{T.pitchUpSub}</span>
          </button>
          <button type="button" {...hold("down", 1)} disabled={status !== "flight"} className="min-h-[58px] short:min-h-[52px] flex flex-col items-center justify-center font-mono text-white bg-black/50 border border-white/30 active:bg-white/20 disabled:opacity-30 touch-none" data-testid="ascent-pitch-down">
            <span className="text-[12px] tracking-[0.2em]">{T.pitchDown}</span>
            <span className="text-[7.5px] tracking-[0.18em] text-zinc-400">{T.pitchDownSub}</span>
          </button>
        </div>
      )}

      {/* pause */}
      {paused && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55" data-testid="ascent-paused">
          <div className="hud-panel border-l-2 border-white/60 px-5 py-4 w-[min(340px,80vw)] flex flex-col gap-2">
            <div className="font-mono text-[11px] tracking-[0.35em] text-white">{T.paused}</div>
            <button type="button" onClick={() => setPaused(false)} className="btn-hud btn-hud-primary min-h-[46px]" data-testid="ascent-resume">
              {T.resume}
            </button>
            <button type="button" onClick={() => onRetry && onRetry()} className="btn-hud min-h-[44px]" data-testid="ascent-pause-retry">
              {T.retry}
            </button>
            <button type="button" onClick={() => onMenu && onMenu()} className="btn-hud min-h-[44px]" data-testid="ascent-pause-menu">
              {T.menu}
            </button>
          </div>
        </div>
      )}

      {/* the orbit judged: a stable orbit the rendezvous can fly */}
      {status === "orbit" && ev && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-[calc(var(--sab)+0.75rem)] z-40 w-[min(520px,64vw)] hud-panel border-l-2 border-[#5be37a] px-4 py-3 short:py-2 veil-in" data-testid="ascent-success">
          <div className="font-mono text-[9px] tracking-[0.35em] text-[#5be37a]">● {L === "pt" ? "INSERÇÃO ORBITAL CONCLUÍDA" : "ORBITAL INSERTION COMPLETE"}</div>
          <h2 className="font-display font-black text-white text-xl short:text-[15px] tracking-tight mt-0.5">{STEP_TEXT[L].ORBIT} · {STEP_TEXT[L].RENDEZVOUS}</h2>
          <div className="mt-1.5 grid grid-cols-2 gap-x-4 font-mono text-[10px] short:text-[9px] tracking-[0.08em]">
            {row(L === "pt" ? "ÓRBITA" : "ORBIT", `${km(ev.apo)} × ${km(ev.peri)} KM`, "ascent-final-orbit")}
            {row(L === "pt" ? "PRECISÃO" : "ACCURACY", `${ev.accuracy.grade} · ${ev.accuracy.miss.toFixed(1)} KM`, "ascent-final-accuracy")}
            {row(L === "pt" ? "PROPELENTE" : "FUEL LEFT", `${ev.fuelKg.toFixed(0)} KG · ${ev.fuelPct.toFixed(1)}%`, "ascent-final-fuel")}
            {row(L === "pt" ? "QUEIMA" : "BURN", `${(ev.burn || 0).toFixed(0)} S · ${ev.cutoffBy === "auto" ? "AUTO" : L === "pt" ? "PILOTO" : "PILOT"}`, "ascent-final-burn")}
            {row(L === "pt" ? "ΔV ENCONTRO" : "RENDEZVOUS ΔV", `${ev.rendezvous.dv.toFixed(1)} / ${ev.rendezvous.budget.toFixed(0)} M/S`, "ascent-final-rdv")}
            {row(T.attempt, `${attempt}`, "ascent-final-attempt")}
          </div>
          <button type="button" onClick={() => onInsertion && onInsertion(resultOf(simRef.current))} className="mt-2.5 w-full min-h-[50px] font-mono text-[11px] tracking-[0.3em] text-white bg-[#1f6b3a] border border-[#5be37a] touch-manipulation" data-testid="ascent-continue">
            {T.cont}
          </button>
        </div>
      )}

      {/* the attempt failed: never a fake success */}
      {status === "failed" && fail && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-[calc(var(--sab)+0.75rem)] z-40 w-[min(520px,64vw)] hud-panel border-l-2 border-[#FF3B00] px-4 py-3 short:py-2 veil-in" data-testid="ascent-failed" data-failure={s.failure ? s.failure.kind : ""}>
          <div className="font-mono text-[9px] tracking-[0.35em] text-[#FF3B00]">● {L === "pt" ? "ASCENSÃO FALHOU" : "ASCENT FAILED"}</div>
          <h2 className="font-display font-black text-white text-xl short:text-[15px] tracking-tight mt-0.5">{fail[0]}</h2>
          <p className="text-[11px] short:text-[10px] text-zinc-300 leading-snug mt-1">{fail[1]}</p>
          <div className="mt-1 grid grid-cols-2 gap-x-4 font-mono text-[10px] short:text-[9px] tracking-[0.08em]">
            {row("APOAPSIS", Number.isFinite(t.apo) ? `${km(t.apo)} KM` : "∞", "ascent-fail-apo")}
            {row("PERIAPSIS", t.peri < 0 ? (L === "pt" ? "SOB O SOLO" : "BELOW SURFACE") : `${km(t.peri)} KM`, "ascent-fail-peri")}
            {row(L === "pt" ? "PROPELENTE" : "FUEL LEFT", `${t.fuelKg.toFixed(0)} KG`, "ascent-fail-fuel")}
            {row("T", `${t.t.toFixed(0)} S`, "ascent-fail-t")}
          </div>
          {cfg.warnings === "strong" && (
            <p className="text-[10px] text-[#9fe0ff] leading-snug mt-1" data-testid="ascent-fail-tip">
              {L === "pt" ? "DICA: após a subida vertical, incline até ~50° e siga a indicação; desligue quando o apoapsis chegar a 96 km com o periapsis acima de 15 km." : "TIP: after the vertical rise, pitch to about 50° and follow the cue; cut off when the apoapsis reaches 96 km with the periapsis above 15 km."}
            </p>
          )}
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => onRetry && onRetry()} className="min-h-[48px] font-mono text-[10.5px] tracking-[0.25em] text-white bg-[#FF3B00]/90 border border-[#FF3B00] touch-manipulation" data-testid="ascent-retry">
              {T.retry}
            </button>
            <button type="button" onClick={() => onMenu && onMenu()} className="min-h-[48px] font-mono text-[10.5px] tracking-[0.25em] text-white bg-black/45 border border-white/30 touch-manipulation" data-testid="ascent-menu">
              {T.menu}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
