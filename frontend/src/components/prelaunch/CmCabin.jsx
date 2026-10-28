import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import Astronaut from "@/components/eva/Astronaut";
import { baseSpec, solveRig } from "@/data/astronautRig";
import { CABIN_LOOK, clampLook, hatchClosedAt, panelById } from "@/data/preLaunch";
import { CONSOLE, COUCHES, EYE, LAMPS, cabinGeometry, hatchFaceTexture, lampLocal, lookVector, panelPlace, panelTextures, quiltTexture, windowTexture } from "./cmModel";

/*
 * COUNTDOWN TO LAUNCH — aboard the command module (stages "cabin" and "count"), first person from
 * the commander's couch: drag to look round the cabin, tap a panel to inspect it (the view glides
 * close), the launch checklist lights its panels, HATCH — CLOSED turns the view up to the hatch
 * swinging shut, the crewmates in the other two couches.
 *
 * ctl.current: { look: {yaw, pitch}, focus (panel id | null), ck (checklist), now (s), pick (fn),
 * hatchLook (s left looking at the hatch), counting }.
 */
const _e = new THREE.Euler(0, 0, 0, "YXZ");
const _ray = new THREE.Raycaster();
const _sp = new THREE.Vector3();
const _ndc = new THREE.Vector2();
const LAMP_OFF = new THREE.Color("#262624");
const LAMP_ON = { green: new THREE.Color("#5cff8a"), amber: new THREE.Color("#ffb21c"), white: new THREE.Color("#f4f1e6") };
// the hatch: open (swung up and out of the cabin) .. shut
const HATCH_OPEN = -1.5;

/** Seated in a couch, reclined, hands on the thighs (the root between the boots, facing +z). */
function seatedSpec(t) {
  const s = baseSpec();
  const br = Math.sin(t * 1.4);
  s.pelvis = [0, 0.52, -0.02];
  s.pelvisRot = [-0.25, 0, 0];
  s.torsoRot = [-0.5 + 0.01 * br, 0.06 * Math.sin(t * 0.21), 0];
  s.feet = [
    [0.15, 0.1, 0.52],
    [-0.15, 0.1, 0.52],
  ];
  s.footRot = [
    [-0.35, 0.05, 0],
    [-0.35, -0.05, 0],
  ];
  s.kneePole = [0, 1, 1];
  s.hands = [
    [0.22, 0.66 + 0.004 * br, 0.3],
    [-0.22, 0.66 + 0.004 * br, 0.3],
  ];
  s.grip = [0.3, 0.3];
  return s;
}

function Crew({ env }) {
  const refs = [useRef(null), useRef(null)];
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    refs.forEach((r, i) => {
      // the centre and right couches; heading π faces the console (−z)
      r.current = { pos: [COUCHES[i + 1], 0.06, 0.2], heading: Math.PI, rig: solveRig(seatedSpec(t + i * 2.3)), helmetUp: 0 };
    });
  });
  return (
    <>
      <Astronaut stateRef={refs[0]} variant="launch" env={env} />
      <Astronaut stateRef={refs[1]} variant="launch" env={env} />
    </>
  );
}

export default function CmCabin({ ctl }) {
  const { gl, camera, scene, size } = useThree();
  const env = useMemo(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const rt = pm.fromScene(new RoomEnvironment(), 0.04);
    pm.dispose();
    return rt;
  }, [gl]);
  const G = useMemo(() => cabinGeometry(), []);
  const T = useMemo(() => ({ panels: panelTextures(), quilt: quiltTexture(), win: windowTexture(), hatchFace: hatchFaceTexture() }), []);
  const M = useMemo(() => {
    const std = (o) => new THREE.MeshStandardMaterial(o);
    const panels = {};
    for (const [id, map] of Object.entries(T.panels)) panels[id] = std({ map, roughness: 0.55, metalness: 0.35, emissive: "#ffffff", emissiveMap: map, emissiveIntensity: 0.08 });
    return {
      panels,
      shell: std({ map: T.quilt, roughness: 0.9, metalness: 0, side: THREE.FrontSide }),
      frame: std({ color: "#3b3f43", roughness: 0.5, metalness: 0.55 }),
      rib: std({ color: "#9a9b96", roughness: 0.6, metalness: 0.3 }),
      couch: std({ color: "#7d8183", roughness: 0.8, metalness: 0.1 }),
      strut: std({ color: "#b9bcbf", roughness: 0.3, metalness: 0.85 }),
      cable: std({ color: "#575a52", roughness: 0.75, metalness: 0.1 }),
      windows: new THREE.MeshBasicMaterial({ map: T.win, toneMapped: true }),
      hatch: std({ color: "#9fa29f", roughness: 0.45, metalness: 0.45 }),
      glow: new THREE.MeshBasicMaterial({ color: "#fff8ec" }),
      hatchFace: std({ map: T.hatchFace, roughness: 0.4, metalness: 0.45, envMapIntensity: 0.8 }),
    };
  }, [T]);
  // a material per lamp: the checklist switches them on
  const lamps = useMemo(() => {
    const out = [];
    for (const pnl of CONSOLE) {
      const list = LAMPS[pnl.id] ? LAMPS[pnl.id].list : [];
      const pl = panelPlace(pnl);
      list.forEach((l, i) => {
        const q = lampLocal(pnl, l);
        const m = new THREE.MeshBasicMaterial({ color: LAMP_OFF.clone(), toneMapped: false });
        const g = new THREE.PlaneGeometry(q.w, q.h);
        out.push({ panel: pnl.id, i, warn: !!l.warn, m, g, pos: [q.u, q.v, 0.002], pl });
      });
    }
    return out;
  }, []);
  const panelRefs = useRef({});
  const hatchRef = useRef();
  const glowRef = useRef();
  const look = useRef({ yaw: CABIN_LOOK.rest.yaw, pitch: CABIN_LOOK.rest.pitch, fwd: 0 });

  useEffect(() => {
    scene.environment = env.texture;
    // the room map only for sheen on metal and visors: the cabin's own lamps do the lighting
    scene.environmentIntensity = 0.45;
    camera.near = 0.02;
    camera.far = 30;
    camera.fov = 70;
    camera.updateProjectionMatrix();
    // tap a panel to inspect it: a ray from the touch into the panels
    ctl.current.pick = (x, y) => {
      _ndc.set((x / size.width) * 2 - 1, -(y / size.height) * 2 + 1);
      _ray.setFromCamera(_ndc, camera);
      const hits = _ray.intersectObjects(Object.values(panelRefs.current).filter(Boolean), false);
      const id = hits.length ? hits[0].object.userData.panel : null;
      return panelById(id) ? id : null;
    };
    return () => {
      scene.environment = null;
      scene.environmentIntensity = 1;
      ctl.current.pick = null;
    };
  }, [scene, env, camera, ctl, size]);
  useEffect(
    () => () => {
      env.dispose();
      Object.values(G).forEach((g) => g && g.isBufferGeometry && g.dispose());
      Object.values(T.panels).forEach((t) => t.dispose());
      T.quilt.dispose();
      T.win.dispose();
      T.hatchFace.dispose();
      Object.values(M.panels).forEach((m) => m.dispose());
      Object.entries(M).forEach(([k, m]) => k !== "panels" && m.dispose());
      lamps.forEach((l) => {
        l.m.dispose();
        l.g.dispose();
      });
    },
    [env, G, T, M, lamps]
  );

  useFrame((_, dt0) => {
    const c = ctl.current;
    const dt = Math.min(0.1, dt0);
    c.now = (c.now || 0) + dt;
    const ck = c.ck;
    // where the view wants to be: the player's look, a panel being inspected, the hatch closing
    let want = clampLook(c.look, CABIN_LOOK);
    let fwd = 0;
    if (c.focus) {
      const p = CONSOLE.find((x) => x.id === c.focus);
      if (p) {
        want = { yaw: p.look.yaw, pitch: p.look.pitch };
        fwd = 0.55;
      }
    }
    const hatchT = ck && ck.at.hatch != null ? c.now - ck.at.hatch : null;
    if (hatchT != null && hatchT < 3.4) want = { yaw: -0.55, pitch: 1.08 };
    const k = 1 - Math.exp(-dt * 4.5);
    const L = look.current;
    L.yaw += (want.yaw - L.yaw) * k;
    L.pitch += (want.pitch - L.pitch) * k;
    L.fwd += (fwd - L.fwd) * k;
    const d = lookVector(L.yaw, L.pitch);
    camera.position.set(EYE[0] + d[0] * L.fwd, EYE[1] + d[1] * L.fwd, EYE[2] + d[2] * L.fwd);
    _e.set(L.pitch, L.yaw, 0, "YXZ");
    camera.quaternion.setFromEuler(_e);
    // validation tooling may hold the camera (window.__lvPrelaunchCam = { pos, look } in cabin metres)
    const hold = typeof window !== "undefined" ? window.__lvPrelaunchCam : null;
    if (hold && hold.pos && hold.look) {
      camera.position.set(...hold.pos);
      camera.lookAt(...hold.look);
    }

    // the hatch: open while boarding, swung shut by HATCH — CLOSED
    const shut = ck ? hatchClosedAt(ck, c.now) : 0;
    if (hatchRef.current) hatchRef.current.rotation.x = HATCH_OPEN * (1 - shut);
    if (glowRef.current) glowRef.current.visible = shut < 0.98;
    // the lamps: each checklist item lights its panel's (amber CABIN PRESS goes out with the first)
    const done = new Set(ck ? ck.done : []);
    for (const l of lamps) {
      let col = LAMP_OFF;
      if (l.panel === "caution") col = l.warn && !done.has("pressure") ? LAMP_ON.amber : LAMP_OFF;
      else if (l.panel === "guidance") col = done.has("guidance") ? LAMP_ON.green : LAMP_ON.white;
      else if (l.panel === "comms") col = done.has("comms") ? LAMP_ON.green : LAMP_OFF;
      else if (l.panel === "flight") col = done.has("launchControl") ? LAMP_ON.green : LAMP_OFF;
      else if (l.panel === "power") col = LAMP_ON.green;
      if (!l.m.color.equals(col)) l.m.color.copy(col);
    }
    // the count: the panels' glow a touch brighter, the cabin quiet
    for (const m of Object.values(M.panels)) m.emissiveIntensity = c.counting ? 0.14 : 0.08;
    if (typeof window !== "undefined") {
      const w = window.__lvPrelaunch || (window.__lvPrelaunch = {});
      // where each panel sits on screen (px; null when behind the view), for the validation tooling
      const at = {};
      for (const [id, m] of Object.entries(panelRefs.current)) {
        if (!m) continue;
        _sp.setFromMatrixPosition(m.matrixWorld).project(camera);
        at[id] = _sp.z < 1 && Math.abs(_sp.x) < 1 && Math.abs(_sp.y) < 1 ? [((_sp.x + 1) / 2) * size.width, ((1 - _sp.y) / 2) * size.height] : null;
      }
      w.cabin = { look: { yaw: L.yaw, pitch: L.pitch }, focus: c.focus || null, hatch: shut, done: ck ? [...ck.done] : [], panelsAt: at, calls: gl.info.render.calls, tris: gl.info.render.triangles };
    }
  });

  return (
    <>
      <ambientLight intensity={0.18} />
      <hemisphereLight args={["#f3efe6", "#4a4842", 0.25]} />
      {/* the cabin's floodlights, and the morning through the hatch window */}
      <pointLight position={[-0.6, 1.75, -0.25]} intensity={1.05} distance={4} decay={2} color="#fff1dc" />
      <pointLight position={[0.7, 1.75, -0.25]} intensity={0.95} distance={4} decay={2} color="#fff1dc" />
      <pointLight position={[0, 0.9, 0.9]} intensity={0.6} distance={3} decay={2} color="#ffe8c8" />
      <directionalLight position={[0.2, 3, -1]} intensity={0.6} color="#eef4ff" />
      <mesh geometry={G.shell} material={M.shell} />
      <mesh geometry={G.frame} material={M.frame} />
      <mesh geometry={G.rib} material={M.rib} />
      <mesh geometry={G.couch} material={M.couch} />
      <mesh geometry={G.strut} material={M.strut} />
      <mesh geometry={G.cable} material={M.cable} />
      <mesh geometry={G.windows} material={M.windows} />
      {/* the white room's light through the open hatch, and the hatch itself on its hinge */}
      <mesh ref={glowRef} material={M.glow} position={[0.02, 2.165, -0.06]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.78, 0.7]} />
      </mesh>
      <group position={G.hatchHinge}>
        <mesh ref={hatchRef} geometry={G.hatch} material={M.hatch}>
          <mesh geometry={G.hatchFace} material={M.hatchFace} />
        </mesh>
      </group>
      {CONSOLE.map((pnl) => {
        const pl = panelPlace(pnl);
        return (
          <mesh key={pnl.id} ref={(m) => (panelRefs.current[pnl.id] = m)} position={pl.c} quaternion={pl.q} material={M.panels[pnl.id]} userData={{ panel: pnl.id }}>
            <planeGeometry args={pnl.size} />
          </mesh>
        );
      })}
      {lamps.map((l, i) => (
        <group key={i} position={l.pl.c} quaternion={l.pl.q}>
          <mesh geometry={l.g} material={l.m} position={l.pos} />
        </group>
      ))}
      <Crew env={env.texture} />
    </>
  );
}
