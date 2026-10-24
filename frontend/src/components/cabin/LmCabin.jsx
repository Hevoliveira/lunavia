import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, createPortal, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import LanderModel, { lunarEnv } from "@/components/LanderModel";
import { SiteRocks, SiteSky, SiteSun, SiteTerrain } from "@/components/scenes/LunarSite";
import AdaptiveResolution from "@/components/scenes/AdaptiveResolution";
import { regolithNearTexture } from "@/components/eva/evaTextures";
import { getSite } from "@/data/landingSites";
import { buildTerrain, skyDirection } from "@/data/terrainMesh";
import { evaWorld } from "@/data/evaSim";
import { GROUND, legFrames } from "@/data/lmDesign";
import { LM } from "@/data/touchdownFx";
import {
  ASCENT_PREP,
  DEFAULT_STATION,
  EVA_PREP,
  GLIDE_TIME,
  HOTSPOTS,
  STATIONS,
  ascentReady,
  cabinStep,
  cabinText,
  cabinTick,
  clampLook,
  createCabin,
  evaReady,
  glide,
  hotspotById,
  lookDir,
  mixAngle,
  panelText,
  stationById,
  throughAnyWindow,
  windowCorners,
} from "@/data/lmCabin";
import { breakerMatrices, cabinGeometry, fdaiPlace, fdaiTexture, floorTexture, glassGeometry, lampLayout, panelLayout, panelPlane, panelTextures, quiltTexture } from "./cabinModel";

/**
 * LM CABIN — the inside of the lunar module the player just landed (optional).
 *
 * One camera, two passes: first the landing site itself (the same terrain,
 * rocks, sky, Sun and near-field ground as the ascent preparation and the EVA,
 * with the real lunar module casting its shadow), then, after a depth clear,
 * the cabin's interior, which covers everything except its two window
 * openings. The interior has its own light: the site's Sun through the
 * windows (with shadows from the cabin's own walls), the bounce off the bright
 * ground outside, the floodlights and the panels' integral lighting.
 *
 * Navigation is seated: five stations the view glides between (no cuts), a
 * drag to look around within each station's limits, and a few panel hotspots
 * to tap. The EVA and ascent preparations are short checklists; their last
 * step opens BEGIN EVA / CONTINUE TO ASCENT. Nothing here is required.
 */
const S_PER_M = 0.5; // scene units per metre
const DEG = Math.PI / 180;
const OUT_NEAR = 0.3; // the site pass's near plane (scene units): the ground is metres away
const IN_NEAR = 0.004; // the cabin pass's near plane (2 mm)

/* ---- the site, as the ascent preparation and the EVA have it --------------------------------- */
/** The real lunar module, drawn only into the shadow map: its shadow falls on the ground outside. */
function ShadowOnlyLander({ base, pose, fx }) {
  const ref = useRef();
  useEffect(() => {
    const hide = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    const t = setInterval(() => {
      if (!ref.current) return;
      ref.current.traverse((o) => {
        if (o.isMesh && o.material !== hide) {
          o.material = hide;
          o.castShadow = true;
          o.receiveShadow = false;
        }
      });
    }, 250);
    return () => clearInterval(t);
  }, []);
  return (
    <group ref={ref} position={base} rotation={[(pose.pitch || 0) * DEG, 0, -(pose.tilt || 0) * DEG]}>
      <LanderModel scale={LM.scale} fx={fx} />
    </group>
  );
}

/* ---- the cabin's interior ----------------------------------------------------------------------- */
const LAMP_OFF = new THREE.Color("#1d1f1e");
const LAMP = { green: new THREE.Color("#45ff86"), amber: new THREE.Color("#ffb21c"), blue: new THREE.Color("#7cc3ff"), red: new THREE.Color("#ff4b33"), white: new THREE.Color("#fff3d6") };

function CabinInterior({ site, stateRef, farSide }) {
  const gl = useThree((s) => s.gl);
  const geo = useMemo(() => cabinGeometry(), []);
  const panels = useMemo(() => panelLayout(), []);
  const art = useMemo(() => panelTextures(site.name), [site]);
  const env = useMemo(() => lunarEnv(gl), [gl]);
  const mats = useMemo(() => {
    const quilt = quiltTexture();
    return {
      shell: new THREE.MeshStandardMaterial({ map: quilt, color: "#d9d6cc", roughness: 0.93, metalness: 0, side: THREE.DoubleSide }),
      frame: new THREE.MeshStandardMaterial({ color: "#1b1c1e", roughness: 0.55, metalness: 0.4, envMap: env, envMapIntensity: 0.4 }),
      metal: new THREE.MeshStandardMaterial({ color: "#a3a7ab", roughness: 0.4, metalness: 0.8, envMap: env, envMapIntensity: 0.7 }),
      dark: new THREE.MeshStandardMaterial({ color: "#2e3134", roughness: 0.7, metalness: 0.25 }),
      soft: new THREE.MeshStandardMaterial({ map: quilt, color: "#cbc6b6", roughness: 0.95 }),
      white: new THREE.MeshStandardMaterial({ color: "#e4e1d8", roughness: 0.8 }),
      hoseBlue: new THREE.MeshStandardMaterial({ color: "#2b5fae", roughness: 0.55 }),
      hoseRed: new THREE.MeshStandardMaterial({ color: "#b8382a", roughness: 0.55 }),
      floor: new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.85, metalness: 0.3 }),
      glass: new THREE.MeshStandardMaterial({ color: "#c9d6e2", transparent: true, opacity: 0.1, roughness: 0.05, metalness: 0, envMap: env, envMapIntensity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
      knob: new THREE.MeshStandardMaterial({ color: "#1a1a1b", roughness: 0.5, metalness: 0.3 }),
    };
  }, [env]);
  const faces = useMemo(
    () =>
      [
        ["left", "left"],
        ["centre", "centre"],
        ["right", "right"],
        ["comms", "comms"],
        ["cbL", "cb"],
        ["cbR", "cb"],
        ["cbWall", "cb"],
        ["eva", "eva"],
        ["hatch", "hatch"],
      ].map(([where, what]) => ({
        key: where,
        geo: panelPlane(panels[where]),
        mat: new THREE.MeshStandardMaterial({ map: art[what].map, emissiveMap: art[what].glow, emissive: new THREE.Color("#ffffff"), emissiveIntensity: what === "hatch" ? 0 : 0.85, roughness: 0.62, metalness: 0.15 }),
      })),
    [panels, art]
  );
  // breaker knobs
  const knobs = useMemo(() => {
    const m = breakerMatrices();
    const g = new THREE.CylinderGeometry(0.0055, 0.0055, 0.006, 8).translate(0, 0.003, 0);
    const mesh = new THREE.InstancedMesh(g, mats.knob, m.length);
    m.forEach((x, i) => mesh.setMatrixAt(i, x));
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    return mesh;
  }, [mats]);
  // indicator lamps (unlit: they glow), coloured from the cabin's state each frame
  const lampDefs = useMemo(() => lampLayout(), []);
  const lamps = useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ toneMapped: false }), lampDefs.length);
    const M = new THREE.Matrix4();
    lampDefs.forEach((l, i) => {
      mesh.setMatrixAt(i, M.compose(new THREE.Vector3(...l.pos), new THREE.Quaternion(), new THREE.Vector3(l.size, l.size * 0.62, l.size)));
      mesh.setColorAt(i, LAMP_OFF);
    });
    return mesh;
  }, [lampDefs]);
  // the attitude ball shows the LM's resting tilt
  const fdai = useMemo(() => fdaiPlace(), []);
  const fdaiMat = useMemo(() => new THREE.MeshStandardMaterial({ map: fdaiTexture(), roughness: 0.35, metalness: 0.1 }), []);
  const ballRef = useRef();
  const glass = useMemo(() => glassGeometry(), []);

  useFrame((state) => {
    const st = stateRef.current;
    const c = st.cabin;
    const now = state.clock.elapsedTime;
    const blink = Math.sin(now * 6) > 0;
    const set = (id, col) => {
      const i = lampDefs.findIndex((l) => l.id === id);
      if (i >= 0) lamps.setColorAt(i, col);
    };
    [0, 1, 2].forEach((i) => {
      set(`asc${i}`, i < c.ascent ? LAMP.green : c.busy && c.busy.kind === "ascent" && c.busy.index === i ? (blink ? LAMP.amber : LAMP_OFF) : LAMP_OFF);
      set(`eva${i}`, c.evaDone ? LAMP.green : i < c.eva ? LAMP.green : c.busy && c.busy.kind === "eva" && c.busy.index === i ? (blink ? LAMP.amber : LAMP_OFF) : c.evaAvailable ? new THREE.Color("#3a2a10") : LAMP_OFF);
    });
    set("link", farSide ? LAMP.blue.clone().multiplyScalar(0.35) : LAMP.green);
    set("hatch", c.evaAvailable && c.eva >= 2 ? LAMP.amber : LAMP.green);
    set("master", LAMP_OFF);
    if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
    // the ball turns with the vehicle's resting attitude
    if (ballRef.current) ballRef.current.rotation.set(st.ballPitch, 0, st.ballRoll);
  });

  // the ball's mount faces out of the panel (+Z of its group along the panel's normal)
  const ballQ = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...fdai.n)), [fdai]);

  return (
    <group>
      <mesh geometry={geo.shell} material={mats.shell} castShadow receiveShadow />
      {["frame", "metal", "dark", "soft", "white", "hoseBlue", "hoseRed", "floor"].map((k) =>
        geo[k] ? <mesh key={k} geometry={geo[k]} material={mats[k]} castShadow={k !== "floor"} receiveShadow /> : null
      )}
      {faces.map((f) => (
        <mesh key={f.key} geometry={f.geo} material={f.mat} receiveShadow />
      ))}
      <primitive object={knobs} />
      <primitive object={lamps} />
      <group position={fdai.pos} quaternion={ballQ}>
        <mesh position={[0, 0, -fdai.r * 0.45]} ref={ballRef}>
          <sphereGeometry args={[fdai.r, 24, 16]} />
          <primitive object={fdaiMat} attach="material" />
        </mesh>
        <mesh position={[0, 0, 0.0015]}>
          <ringGeometry args={[fdai.r * 0.98, fdai.r * 1.18, 32]} />
          <meshStandardMaterial color="#111214" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0, fdai.r * 0.56]}>
          <boxGeometry args={[fdai.r * 0.9, fdai.r * 0.07, 0.001]} />
          <meshBasicMaterial color="#ff9a2a" toneMapped={false} />
        </mesh>
      </group>
      <mesh geometry={glass} material={mats.glass} renderOrder={5} />
    </group>
  );
}

/** The cabin's light: the site's Sun through the windows, the ground's bounce, floods. */
function CabinLights({ site, base, groupQ }) {
  const sun = useRef();
  const target = useMemo(() => new THREE.Object3D(), []);
  const dir = useMemo(() => new THREE.Vector3(...skyDirection(site.sun)), [site]);
  useEffect(() => {
    const l = sun.current;
    if (!l) return;
    const cam = l.shadow.camera;
    cam.left = -1.8;
    cam.right = 1.8;
    cam.top = 1.8;
    cam.bottom = -1.8;
    cam.near = 0.1;
    cam.far = 12;
    cam.updateProjectionMatrix();
    l.shadow.mapSize.set(512, 512);
    l.shadow.bias = -0.0006;
    l.shadow.normalBias = 0.006;
    target.position.set(base[0], base[1] + 1.45, base[2]);
    target.updateMatrixWorld();
    l.target = target;
    l.position.copy(target.position).addScaledVector(dir, 6);
  }, [base, dir, target]);
  const sunI = Math.min(6, 1.4 / Math.max(0.2, Math.sin(site.sun.el * DEG)));
  const bounce = new THREE.Color(site.palette.bright).multiplyScalar(0.9);
  // floodlights, in the cabin frame (model units → world by the cabin's transform)
  const at = (p) => new THREE.Vector3(...p).multiplyScalar(LM.scale).applyQuaternion(groupQ).add(new THREE.Vector3(...base));
  const f1 = at([0.14, 0.82, -0.1]);
  const f2 = at([-0.14, 0.82, -0.1]);
  return (
    <>
      <primitive object={target} />
      <directionalLight ref={sun} color="#fffaf1" intensity={sunI} castShadow />
      <hemisphereLight args={["#232a36", bounce, 0.62]} />
      <ambientLight intensity={0.05} />
      <pointLight position={f1.toArray()} color="#ffe6c2" intensity={0.55} distance={3} decay={2} />
      <pointLight position={f2.toArray()} color="#ffe6c2" intensity={0.55} distance={3} decay={2} />
    </>
  );
}

/* ---- the camera and the two passes --------------------------------------------------------- */
function Director({ base, groupQ, stateRef, cabinScene, markerRefs, siteId }) {
  const { camera, gl, scene, size } = useThree();
  const _e = useMemo(() => new THREE.Vector3(), []);
  const _q = useMemo(() => new THREE.Quaternion(), []);
  const _eu = useMemo(() => new THREE.Euler(0, 0, 0, "YXZ"), []);
  const _p = useMemo(() => new THREE.Vector3(), []);
  const _d = useMemo(() => new THREE.Vector3(), []);
  const B = useMemo(() => new THREE.Vector3(...base), [base]);
  const panes = useMemo(() => [windowCorners(0), windowCorners(1)], []);
  const toWorld = (p, out) => out.set(p[0], p[1], p[2]).multiplyScalar(LM.scale).applyQuaternion(groupQ).add(B);

  useFrame((_, delta) => {
    const st = stateRef.current;
    const v = st.view;
    const dt = Math.min(0.05, delta);
    // the glide between stations (eye, gaze, field of view), then the player's look on top
    v.t = Math.min(1, v.t + dt / GLIDE_TIME);
    const u = glide(v.t);
    const to = stationById(v.to);
    const eye = [0, 1, 2].map((k) => v.from.eye[k] + (to.eye[k] - v.from.eye[k]) * u);
    const [ly, lp] = clampLook(to, to.yaw + st.look.yaw, to.pitch + st.look.pitch);
    const yaw = mixAngle(v.from.yaw, ly, u);
    const pitch = v.from.pitch + (lp - v.from.pitch) * u;
    const fov = v.from.fov + (to.fov - v.from.fov) * u;
    v.cur = { eye, yaw, pitch, fov };
    toWorld(eye, _e);
    camera.position.copy(_e);
    _eu.set(pitch * DEG, (yaw + 180) * DEG, 0, "YXZ");
    _q.setFromEuler(_eu);
    camera.quaternion.copy(groupQ).multiply(_q);
    if (camera.fov !== fov) camera.fov = fov;

    // hotspot markers (DOM, positioned from here: no React renders per frame)
    const shown = [];
    HOTSPOTS.forEach((h) => {
      const el = markerRefs.current[h.id];
      if (!el) return;
      toWorld(h.pos, _p);
      _d.copy(_p).sub(camera.position);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const ahead = _d.dot(fwd) > 0.01;
      _p.project(camera);
      const x = (_p.x * 0.5 + 0.5) * size.width;
      const y = (-_p.y * 0.5 + 0.5) * size.height;
      const on = ahead && v.t >= 1 && Math.abs(_p.x) < 0.94 && Math.abs(_p.y) < 0.9 && st.hotspotsOn;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.style.opacity = on ? "1" : "0";
      el.style.pointerEvents = on ? "auto" : "none";
      if (on) shown.push(h.id);
    });

    // Nothing in the cabin or on the site moves: once both shadow maps are made (the site's Sun,
    // the Sun through the windows), they are kept instead of being drawn again every frame.
    st.frames = (st.frames || 0) + 1;
    gl.shadowMap.autoUpdate = st.frames < 20;

    // Is either window on screen? (conservative: a pane partly behind the eye counts as seen.) If not,
    // the site pass is skipped: the cabin covers the whole view.
    camera.near = IN_NEAR;
    camera.far = 8;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    let seen = false;
    const box = [Infinity, Infinity, -Infinity, -Infinity]; // the panes' screen bounds (NDC)
    for (const tri of panes) {
      // the pane in eye space, clipped to the near plane, then its screen bounds
      const pts = tri.map((c) => toWorld(c, new THREE.Vector3()).applyMatrix4(camera.matrixWorldInverse));
      const clip = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const ina = a.z < -IN_NEAR;
        const inb = b.z < -IN_NEAR;
        if (ina) clip.push(a);
        if (ina !== inb) clip.push(a.clone().lerp(b, (-IN_NEAR - a.z) / (b.z - a.z)));
      }
      if (!clip.length) continue; // wholly behind the eye
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const q of clip) {
        _p.copy(q).applyMatrix4(camera.projectionMatrix);
        x0 = Math.min(x0, _p.x);
        x1 = Math.max(x1, _p.x);
        y0 = Math.min(y0, _p.y);
        y1 = Math.max(y1, _p.y);
      }
      if (x1 > -1 && x0 < 1 && y1 > -1 && y0 < 1) {
        seen = true;
        box[0] = Math.min(box[0], x0);
        box[1] = Math.min(box[1], y0);
        box[2] = Math.max(box[2], x1);
        box[3] = Math.max(box[3], y1);
      }
    }
    st.windowsSeen = seen;

    // the two passes: the site (far planes), a depth clear, the cabin (near planes)
    gl.autoClear = false;
    gl.clear();
    const solo = typeof window !== "undefined" && window.__lvCabinPass === false;
    if (seen || solo) {
      camera.near = OUT_NEAR;
      camera.far = 6000;
      camera.updateProjectionMatrix();
      // only the windows' part of the screen is drawn (a little margin for the bezel)
      if (!solo && !gl.shadowMap.autoUpdate) {
        const m = 0.02;
        const x0 = Math.max(0, ((box[0] - m) * 0.5 + 0.5) * size.width);
        const x1 = Math.min(size.width, ((box[2] + m) * 0.5 + 0.5) * size.width);
        const y0 = Math.max(0, ((box[1] - m) * 0.5 + 0.5) * size.height);
        const y1 = Math.min(size.height, ((box[3] + m) * 0.5 + 0.5) * size.height);
        gl.setScissor(Math.floor(x0), Math.floor(y0), Math.ceil(x1 - x0) + 1, Math.ceil(y1 - y0) + 1);
        gl.setScissorTest(true);
      }
      gl.render(scene, camera);
      gl.setScissorTest(false);
    }
    gl.clearDepth();
    camera.near = IN_NEAR;
    camera.far = 8;
    camera.updateProjectionMatrix();
    // (validation tooling: __lvCabinPass = false shows the site pass alone)
    if (!(typeof window !== "undefined" && window.__lvCabinPass === false)) gl.render(cabinScene, camera);

    if (typeof window !== "undefined") {
      const d = lookDir(yaw, pitch);
      const w = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      window.__lvCabin = {
        siteId,
        station: v.to,
        settled: v.t >= 1,
        yaw: +yaw.toFixed(2),
        pitch: +pitch.toFixed(2),
        fov: +fov.toFixed(1),
        eye: eye.map((q) => +q.toFixed(4)),
        cam: camera.position.toArray().map((q) => +q.toFixed(3)),
        dirWorld: w.toArray().map((q) => +q.toFixed(4)),
        throughWindow: throughAnyWindow(eye, d),
        windowsSeen: st.windowsSeen,
        hotspots: shown,
        cabin: { eva: st.cabin.eva, ascent: st.cabin.ascent, evaAvailable: st.cabin.evaAvailable, evaDone: st.cabin.evaDone, busy: !!st.cabin.busy },
        base,
      };
    }
  }, 1);
  return null;
}

function Scene({ site, pose, base, fx, groupQ, stateRef, markerRefs, farSide }) {
  const cabinScene = useMemo(() => {
    const s = new THREE.Scene();
    return s;
  }, []);
  // the ground at close range, as the EVA has it (the swept ground round the LM, its footpads)
  const near = useMemo(() => {
    const terrain = buildTerrain(site);
    const world = evaWorld({ site, pose, ground: (x, z) => terrain.lookup(x, z) });
    const L = world.lm;
    const k = S_PER_M;
    const pads = legFrames().map((f) => {
      const q = L.toWorld([f.padTop.x, GROUND, f.padTop.z]);
      return [q[0] * k, q[2] * k, L.padR * k];
    });
    return { tex: regolithNearTexture(), blast: [L.axis[0] * k, L.axis[1] * k, 11 * k], under: [L.axis[0] * k, L.axis[1] * k, 3.2 * k], pads };
  }, [site, pose]);
  return (
    <>
      <color attach="background" args={["#030304"]} />
      <SiteSky site={site} />
      <SiteSun site={site} focus={() => base} box={30} />
      <SiteTerrain site={site} near={near} />
      <SiteRocks site={site} />
      <ShadowOnlyLander base={base} pose={pose} fx={fx} />
      {createPortal(
        <>
          <CabinLights site={site} base={base} groupQ={groupQ} />
          <group position={base} quaternion={groupQ} scale={LM.scale}>
            <CabinInterior site={site} stateRef={stateRef} farSide={farSide} />
          </group>
        </>,
        cabinScene
      )}
      <Director base={base} groupQ={groupQ} stateRef={stateRef} cabinScene={cabinScene} markerRefs={markerRefs} siteId={site.id} />
    </>
  );
}

/* ---- the screen ------------------------------------------------------------------------------- */
const tone = (t) => (t === "ok" ? "text-emerald-300" : t === "warn" ? "text-amber-300" : t === "far" ? "text-[#9fb6cc]" : "text-white");

export default function LmCabin({ siteId, pose = null, result = null, audio = null, lang = "en", farSide = false, evaAvailable = false, evaDone = false, onBeginEva = null, onAscent = null, onExit = null }) {
  const T = cabinText(lang);
  const pt = lang === "pt";
  const site = useMemo(() => getSite(siteId), [siteId]);
  const p = pose || { x: 0, padY: site.contactGround ? site.scale.y(site.contactGround(0)) : 0, tilt: 0, pitch: 0, comp: [0, 0, 0, 0], probe: [0, 0, 0, 0] };
  const base = useMemo(() => [p.x, p.padY + LM.foot, 0], [p.x, p.padY]);
  const fx = useMemo(() => ({ thrust: 0, comp: (p.comp || [0, 0, 0, 0]).slice(), probe: (p.probe || [0, 0, 0, 0]).slice() }), [p.comp, p.probe]);
  const groupQ = useMemo(() => new THREE.Quaternion().setFromEuler(new THREE.Euler((p.pitch || 0) * DEG, 0, -(p.tilt || 0) * DEG, "XYZ")), [p.pitch, p.tilt]);
  const s0 = stationById(DEFAULT_STATION);
  const stateRef = useRef({
    view: { from: { eye: s0.eye, yaw: s0.yaw, pitch: s0.pitch, fov: s0.fov }, to: s0.id, t: 1, cur: null },
    look: { yaw: 0, pitch: 0 },
    cabin: createCabin({ evaAvailable, evaDone }),
    hotspotsOn: true,
    ballPitch: (p.pitch || 0) * DEG,
    ballRoll: (p.tilt || 0) * DEG,
  });
  const markerRefs = useRef({});
  const [station, setStation] = useState(s0.id);
  const [inspect, setInspect] = useState(null);
  const [cabin, setCabin] = useState(stateRef.current.cabin);
  const [fade, setFade] = useState(1);
  const leaving = useRef(false);

  // cabin ambience: a low systems hum, muffled; the far side has no Earth link
  useEffect(() => {
    requestAnimationFrame(() => setFade(0));
    if (!audio) return undefined;
    if (farSide) audio.setEarthLink(false);
    audio.ambienceStart && audio.ambienceStart();
    audio.clank && audio.clank(0.18);
    return () => audio.ambienceStop && audio.ambienceStop(0.8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // a checklist step under way ticks to its end
  useEffect(() => {
    if (!cabin.busy) return undefined;
    const id = setInterval(() => {
      const c = cabinTick(stateRef.current.cabin, 0.1);
      stateRef.current.cabin = c;
      if (!c.busy) {
        setCabin(c);
        if (audio) {
          audio.beep && audio.beep(1500, 0.05, 0.08);
          if (evaReady(c) && !evaReady(cabin)) {
            audio.say("cabin.evaReady");
            if (!farSide) audio.say("cabin.evaGo", { delay: 0.6 });
          }
          if (ascentReady(c) && !ascentReady(cabin)) {
            audio.say("cabin.ascentReady");
            if (!farSide) audio.say("cabin.ascentGo", { delay: 0.6 });
          }
        }
      }
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabin.busy]);

  const goStation = (id) => {
    const st = stateRef.current;
    const cur = st.view.cur || { eye: st.view.from.eye, yaw: st.view.from.yaw, pitch: st.view.from.pitch, fov: st.view.from.fov };
    st.view = { from: { ...cur }, to: id, t: id === st.view.to && st.view.t >= 1 ? 1 : 0, cur };
    st.look = { yaw: 0, pitch: 0 };
    setStation(id);
    if (audio && audio.beep) audio.beep(700, 0.03, 0.04);
  };
  const openHotspot = (id) => {
    const h = hotspotById(id);
    if (!h) return;
    if (h.station !== stateRef.current.view.to) goStation(h.station);
    setInspect(id);
    if (audio && audio.beep) audio.beep(1100, 0.04, 0.06);
  };
  const step = (kind, i) => {
    const before = stateRef.current.cabin;
    const c = cabinStep(before, kind, i);
    if (c === before) return;
    stateRef.current.cabin = c;
    setCabin(c);
    if (!audio) return;
    const id = (kind === "eva" ? EVA_PREP : ASCENT_PREP)[i].id;
    if (kind === "eva" && id === "suit") audio.hiss && audio.hiss(1.1, 0.07);
    else if (kind === "eva" && id === "hatch") {
      audio.hiss && audio.hiss(1.3, 0.12); // the cabin's air vented
      setTimeout(() => audio.clank && audio.clank(0.3), 900);
    } else if (kind === "ascent" && id === "secure") {
      audio.clank && audio.clank(0.35);
      setTimeout(() => audio.hiss && audio.hiss(1.0, 0.08), 300); // repress
    } else audio.beep && audio.beep(900, 0.06, 0.07);
  };
  const leave = (fn) => {
    if (leaving.current || !fn) return;
    leaving.current = true;
    setFade(1);
    setTimeout(fn, 650);
  };

  // drag to look (limited around the station; the glide owns the view until it settles)
  const drag = useRef(null);
  const onDown = (e) => {
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const st = stateRef.current;
    const s = stationById(st.view.to);
    const k = s.fov / Math.max(240, window.innerHeight); // degrees per pixel: the world follows the finger
    const [y, pp] = clampLook(s, s.yaw + st.look.yaw + (e.clientX - d.x) * k, s.pitch + st.look.pitch + (e.clientY - d.y) * k);
    st.look = { yaw: y - s.yaw, pitch: pp - s.pitch };
    d.x = e.clientX;
    d.y = e.clientY;
  };
  const onUp = (e) => {
    if (drag.current && drag.current.id === e.pointerId) drag.current = null;
  };

  const ctx = { site, pose: p, farSide, cabin, result };
  const info = inspect ? panelText(inspect, ctx, lang) : null;
  const eRdy = evaReady(cabin);
  const aRdy = ascentReady(cabin);
  const busyOn = (kind, i) => cabin.busy && cabin.busy.kind === kind && cabin.busy.index === i;

  const StepList = ({ kind }) => {
    const list = kind === "eva" ? EVA_PREP : ASCENT_PREP;
    const n = kind === "eva" ? cabin.eva : cabin.ascent;
    return (
      <div className="mt-2 grid gap-1.5 short:gap-1" data-testid={`cabin-steps-${kind}`}>
        {list.map((s, i) => {
          const done = i < n;
          const next = i === n && !cabin.busy;
          return (
            <button
              key={s.id}
              type="button"
              disabled={!next}
              onClick={() => step(kind, i)}
              data-testid={`cabin-step-${kind}-${i}`}
              data-done={done ? "1" : "0"}
              className={`w-full min-h-[44px] short:min-h-[40px] px-3 flex items-center justify-between gap-2 font-mono text-left touch-manipulation border ${done ? "border-emerald-400/40 bg-emerald-400/10" : next ? "border-[#FF3B00] bg-[#FF3B00]/15 hover:bg-[#FF3B00]/25" : "border-white/10 bg-black/30 opacity-60"}`}
            >
              <span className="text-[11px] short:text-[10px] tracking-[0.18em] text-white">{s.label[pt ? "pt" : "en"]}</span>
              <span className={`text-[10px] tracking-[0.15em] ${done ? "text-emerald-300" : "text-zinc-400"}`}>{done ? "✓" : busyOn(kind, i) ? T.working : next ? "›" : ""}</span>
            </button>
          );
        })}
        {n > 0 && <div className="font-mono text-[10px] short:text-[9px] tracking-[0.1em] text-zinc-400 leading-snug" data-testid={`cabin-step-note-${kind}`}>{list[Math.min(n, list.length) - 1].done[pt ? "pt" : "en"]}</div>}
      </div>
    );
  };
  const Primary = ({ onClick, label, sub, testId }) => (
    <button type="button" onClick={onClick} data-testid={testId} className="mt-2 w-full min-h-[50px] short:min-h-[46px] flex flex-col items-center justify-center font-mono text-white bg-[#FF3B00]/90 hover:bg-[#FF3B00] active:bg-[#d93200] border border-[#FF3B00] touch-manipulation">
      <span className="text-[12px] short:text-[11px] tracking-[0.3em]">{label}</span>
      <span className="text-[9px] short:text-[8px] tracking-[0.16em] text-white/80 mt-0.5">{sub}</span>
    </button>
  );

  return (
    <div className="absolute inset-0 bg-[#030304] select-none" data-testid="lm-cabin" data-site={site.id} data-station={station}>
      <div className="absolute inset-0 canvas-host touch-none" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} data-testid="cabin-look">
        <Canvas
          camera={{ fov: s0.fov, near: IN_NEAR, far: 6000 }}
          dpr={[1, 2]}
          shadows={{ type: THREE.PCFShadowMap }}
          gl={{ antialias: true, alpha: false, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }}
          onCreated={({ gl }) => gl.setClearColor("#030304")}
        >
          <Suspense fallback={null}>
            <Scene site={site} pose={p} base={base} fx={fx} groupQ={groupQ} stateRef={stateRef} markerRefs={markerRefs} farSide={farSide} />
          </Suspense>
          <AdaptiveResolution />
        </Canvas>
      </div>

      {/* hotspot markers (placed by the scene each frame) */}
      <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden">
        {HOTSPOTS.map((h) => (
          <button
            key={h.id}
            type="button"
            ref={(el) => (markerRefs.current[h.id] = el)}
            onClick={() => openHotspot(h.id)}
            data-testid={`cabin-hotspot-${h.id}`}
            style={{ opacity: 0 }}
            className="absolute left-0 top-0 -ml-[22px] -mt-[22px] w-11 h-11 flex items-center justify-center transition-opacity duration-300 touch-manipulation"
            aria-label={h.label[pt ? "pt" : "en"]}
          >
            <span className={`absolute inset-2 rounded-full border-2 ${inspect === h.id ? "border-[#FF3B00] bg-[#FF3B00]/30" : "border-white/80 bg-black/35"} cabin-pulse`} />
            <span className="absolute w-2 h-2 rounded-full bg-white" />
            <span className="absolute top-full mt-0.5 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] short:text-[9px] tracking-[0.18em] text-white bg-black/55 px-1.5 py-0.5">{h.label[pt ? "pt" : "en"]}</span>
          </button>
        ))}
      </div>

      {/* top: where we are, and the way out */}
      <div className="absolute top-[calc(var(--hud-top)+0.25rem)] left-[calc(var(--sal)+1rem)] z-30 pointer-events-none bg-black/50 backdrop-blur-sm border-l-2 border-[#FF3B00] px-3 py-1.5 max-w-[46vw]">
        <div className="font-mono text-[10px] short:text-[9px] tracking-[0.35em] text-[#FF3B00]" data-testid="cabin-site">● {site.name} · {T.cabin}</div>
        <div className="font-mono text-[10px] short:text-[9px] tracking-[0.18em] text-zinc-300 mt-0.5">{T.drag}</div>
      </div>
      <button
        type="button"
        onClick={() => leave(onExit)}
        data-testid="cabin-exit"
        className="absolute top-[calc(var(--hud-top)+0.25rem)] right-[calc(var(--sar)+1rem)] z-30 min-h-[44px] px-4 font-mono text-[11px] tracking-[0.25em] text-white bg-black/55 hover:bg-white/10 border border-white/30 touch-manipulation"
      >
        {T.exit} ✕
      </button>

      {/* right: the inspected panel, or the cabin's tasks */}
      <div className="absolute z-30 right-[calc(var(--sar)+1rem)] top-[calc(var(--hud-top)+3.6rem)] short:top-[calc(var(--hud-top)+3.3rem)] bottom-[calc(var(--sab)+0.75rem)] w-[min(320px,40vw)] flex flex-col justify-end pointer-events-none">
        <div className="pointer-events-auto max-h-full overflow-y-auto bg-black/65 backdrop-blur-sm border-l-2 border-[#FF3B00] px-4 py-3 short:px-3 short:py-2" data-testid={info ? "cabin-inspector" : "cabin-tasks"} data-panel={inspect || ""}>
          {info ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="font-mono text-[11px] short:text-[10px] tracking-[0.3em] text-[#FF3B00]" data-testid="cabin-inspector-title">● {info.title}</div>
                <button type="button" onClick={() => setInspect(null)} data-testid="cabin-close" className="min-h-[40px] min-w-[64px] px-2 font-mono text-[10px] tracking-[0.2em] text-zinc-300 hover:text-white border border-white/20 touch-manipulation">
                  ‹ {T.close}
                </button>
              </div>
              <ul className="mt-2 space-y-1 font-mono text-[11px] short:text-[10px] tracking-[0.08em]" data-testid="cabin-readout">
                {info.lines.map(([k, val, t]) => (
                  <li key={k} className="flex justify-between gap-3">
                    <span className="text-zinc-400">{k}</span>
                    <span className={`${tone(t)} text-right`}>{val}</span>
                  </li>
                ))}
              </ul>
              {info.note && <div className="mt-2 font-sans text-[12px] short:text-[11px] leading-snug text-zinc-300">{info.note}</div>}
              {inspect === "eva" && cabin.evaAvailable && <StepList kind="eva" />}
              {(inspect === "eva" || inspect === "hatch") && eRdy && onBeginEva && <Primary onClick={() => leave(onBeginEva)} label={T.beginEva} sub={T.beginEvaSub} testId="cabin-begin-eva" />}
              {inspect === "ascent" && <StepList kind="ascent" />}
              {inspect === "ascent" && aRdy && onAscent && <Primary onClick={() => leave(onAscent)} label={T.toAscent} sub={T.toAscentSub} testId="cabin-to-ascent" />}
            </>
          ) : (
            <>
              <div className="font-mono text-[11px] short:text-[10px] tracking-[0.3em] text-[#FF3B00]">● {T.tasks}</div>
              <button type="button" onClick={() => openHotspot("eva")} data-testid="cabin-task-eva" className="mt-2 w-full min-h-[46px] short:min-h-[42px] px-3 flex items-center justify-between font-mono border border-white/25 bg-black/30 hover:bg-white/10 touch-manipulation">
                <span className="text-[11px] short:text-[10px] tracking-[0.18em] text-white">{T.evaPrep}</span>
                <span className={`text-[10px] tracking-[0.12em] ${cabin.evaDone || eRdy ? "text-emerald-300" : "text-zinc-400"}`}>{cabin.evaDone ? T.evaDone : !cabin.evaAvailable ? T.evaNone : `${cabin.eva} / ${EVA_PREP.length} ›`}</span>
              </button>
              <button type="button" onClick={() => openHotspot("ascent")} data-testid="cabin-task-ascent" className="mt-1.5 w-full min-h-[46px] short:min-h-[42px] px-3 flex items-center justify-between font-mono border border-white/25 bg-black/30 hover:bg-white/10 touch-manipulation">
                <span className="text-[11px] short:text-[10px] tracking-[0.18em] text-white">{T.ascentPrep}</span>
                <span className={`text-[10px] tracking-[0.12em] ${aRdy ? "text-emerald-300" : "text-zinc-400"}`}>{`${cabin.ascent} / ${ASCENT_PREP.length} ›`}</span>
              </button>
              {eRdy && onBeginEva && <Primary onClick={() => leave(onBeginEva)} label={T.beginEva} sub={T.beginEvaSub} testId="cabin-begin-eva" />}
              {aRdy && onAscent && <Primary onClick={() => leave(onAscent)} label={T.toAscent} sub={T.toAscentSub} testId="cabin-to-ascent" />}
            </>
          )}
        </div>
      </div>

      {/* bottom: the stations */}
      <div className="absolute z-30 left-[calc(var(--sal)+1rem)] bottom-[calc(var(--sab)+0.75rem)] right-[calc(var(--sar)+min(320px,40vw)+2rem)] flex flex-wrap gap-1.5" data-testid="cabin-stations">
        {STATIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => goStation(s.id)}
            data-testid={`cabin-station-${s.id}`}
            className={`min-h-[44px] px-3 short:px-2.5 font-mono text-[10px] short:text-[9px] tracking-[0.2em] touch-manipulation border ${station === s.id ? "text-white border-[#FF3B00] bg-[#FF3B00]/25" : "text-zinc-300 border-white/20 bg-black/45 hover:bg-white/10"}`}
          >
            {s.label[pt ? "pt" : "en"]}
          </button>
        ))}
      </div>

      {farSide && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none font-mono text-[9px] tracking-[0.3em] text-[#9fb6cc] bg-black/40 border border-[#9fb6cc]/40 px-2 py-1 whitespace-nowrap" data-testid="earth-link">
          ○ EARTH LINK UNAVAILABLE
        </div>
      )}
      <div className="absolute inset-0 z-40 bg-black pointer-events-none transition-opacity" style={{ opacity: fade, transitionDuration: "600ms" }} />
    </div>
  );
}
