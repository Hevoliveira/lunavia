import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import LanderModel, { lunarEnv } from "@/components/LanderModel";
import { SiteRocks, SiteSky, SiteSun, SiteTerrain } from "@/components/scenes/LunarSite";
import AdaptiveResolution from "@/components/scenes/AdaptiveResolution";
import Astronaut from "./Astronaut";
import { ContactShadows, NearPebbles } from "./EvaGround";
import { bootPrintTexture, regolithNearTexture } from "./evaTextures";
import { GROUND, legFrames } from "@/data/lmDesign";
import { evaText } from "./evaText";
import { SUBTITLE_LANE as LANE, setSubtitlePlacement } from "@/components/CommsSubtitles";
import { getSite } from "@/data/landingSites";
import { buildTerrain } from "@/data/terrainMesh";
import { LM } from "@/data/touchdownFx";
import { SAMPLE_TIME, createWalker, egressAt, egressLength, evaWorld, ingressAt, ingressLength, ladderPoints, stepWalker } from "@/data/evaSim";
import { DATA_TIME, DEPLOY_TIME, SURVEY_TIME, actionAt, cleanProgressFor, currentTarget, evaMission, evaMissionText, nextObjective, objectiveIds, photoCheckFor, planEva, routeBetween } from "@/data/evaMissions";
import { chestCamera, consoleSpec, deploySpec, inspectSpec, photoSpec, sampleSpec, sequenceSpec, solveRig, toLocal, toWorld, walkSpec } from "@/data/astronautRig";
import { Instrument, RING, SampleStones, ScienceMarkers, stoneLift } from "./EvaScience";
import { DataPanel, InfoCard } from "./EvaPanels";

/**
 * LUNAR EVA — the four expeditions (data/evaMissions): one EVA, one configuration per destination.
 *
 * An optional extravehicular activity between the landing and the lunar ascent: the same site
 * (terrain, rocks, sky, Sun) and the lunar module exactly where and how it landed. The astronaut
 * leaves the cabin through the forward hatch, climbs down the ladder, takes the first steps and
 * then walks freely through the destination's objectives (the Sea of Tranquility: the marked
 * sample and a photograph of the landing site; Hadley: a geological survey, two samples, Mons
 * Hadley, the seismometer; Tycho: impact material, two samples, a crater from its rim, the gnomon;
 * the far side: a sample, the radio antenna, the basin ring, the receiver's data, with no Earth
 * link), and returns up the ladder into the LM. Then the mission goes on to the ascent.
 *
 * Simulation in data/evaSim (walking, collisions, the exploration area, the egress and ingress,
 * the objectives), the body in data/astronautRig, the suit in components/eva. Everything here is
 * in metres; the scene draws 0.5 units per metre (the EVA group is scaled by it).
 *
 * Props: siteId, pose (the landing result's pose), audio, lang, resume ({ progress, samples,
 * photos } from a save: with the first steps done the EVA resumes at the foot of the ladder),
 * onCheckpoint(eva) (a safe point to save), onComplete(eva) (the hatch is closed), onAbort().
 */
const S_PER_M = 0.5;
const DEG = Math.PI / 180;
const VFOV = 50;
const PHOTO_VFOV = 59; // the square viewfinder (82% of the height) then spans PHOTO_FRAME_FOV
const PHOTO_FRAME_FOV = 50 * DEG;
// third person: the look point a little above the helmet keeps the astronaut in the lower half of
// the frame (the subtitles and the objective marker stay clear of him), the LM and the plain beyond
const CAM = { dist: 5.6, pitch: 0.19, target: 1.65, minPitch: -0.08, maxPitch: 0.8, near: 1.8 };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (x) => {
  const u = clamp(x, 0, 1);
  return u * u * (3 - 2 * u);
};
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/* ---- the scene's mutable state (the director owns it; the HUD reads and writes input) ---------- */
function makeSim({ site, pose, resume }) {
  const terrain = buildTerrain(site);
  const ground = (x, z) => terrain.lookup(x, z);
  const cfg = evaMission(site.id);
  const world = evaWorld({ site, pose, ground, area: cfg.area });
  const plan = planEva(world);
  const lm = world.lm;
  const P = ladderPoints(lm);
  const progress = cleanProgressFor(cfg, resume && resume.progress);
  const sampleObj = cfg.objectives.find((o) => o.kind === "sample");
  const instObj = cfg.objectives.find((o) => o.kind === "instrument");
  const sampleIds = plan.samples.map((x) => x.id);
  const out = [Math.sin(P.outward), Math.cos(P.outward)];
  let side = [out[1], -out[0]];
  if (side[0] * world.sunH[0] + side[1] * world.sunH[1] < 0) side = [-side[0], -side[1]]; // the camera on the sunlit side
  const sim = {
    site,
    world,
    lm,
    P,
    out,
    side,
    mode: progress.firstSteps ? "explore" : "egress",
    t: 0,
    walker: createWalker(world, lm.board[0], lm.board[2], P.outward),
    cfg,
    plan,
    progress,
    samples: (resume && Array.isArray(resume.samples) ? resume.samples : []).filter((x) => x && sampleIds.includes(x.id)).slice(0, 4),
    photos: (resume && Array.isArray(resume.photos) ? resume.photos : []).slice(0, 8),
    instruments: (resume && Array.isArray(resume.instruments) ? resume.instruments : []).slice(0, 1),
    sampleObjective: sampleObj ? sampleObj.id : null,
    instrumentObjective: instObj ? instObj.id : null,
    sampleObjectiveDone: !!(sampleObj && progress[sampleObj.id]),
    survey: null,
    deploy: null,
    // a receiver deployed before a save has recorded while the crew was away
    dataReadyAt: instObj && progress[instObj.id] ? 0 : null,
    input: { x: 0, y: 0 },
    keys: new Set(),
    look: { dx: 0, dy: 0 },
    lookAt: -1e3,
    camYaw: P.outward,
    camPitch: CAM.pitch,
    camDist: CAM.dist,
    photoPitch: 0,
    turnPhase: 0,
    approach: null,
    sample: null,
    hatch: 0,
    paused: false,
    distance: 0,
    clock: 0,
    started: 0,
    events: [],
    said: new Set(),
    lastProgressAt: 0,
    prints: [],
    dust: [],
    hud: {},
    resumed: !!progress.firstSteps,
  };
  // a resumed EVA goes on counting the distance walked before the interruption
  if (resume && typeof resume.distance === "number" && Number.isFinite(resume.distance) && resume.distance > 0) {
    sim.walker.distance = resume.distance;
    sim.distance = resume.distance;
  }
  // the first look: towards the next target, from behind the astronaut
  sim.camYaw = bearingTo(sim, targetOf(sim)) ?? P.outward;
  if (progress.firstSteps) sim.walker.heading = sim.camYaw;
  return sim;
}

/** The current target, during the egress the first one after it: { kind, objective, id?, p [x, y, z] }. */
function targetInfo(sim) {
  const st = sim.progress.firstSteps ? sim : { ...sim, progress: { ...sim.progress, firstSteps: true } };
  const t = currentTarget(sim.plan, st, sim.walker);
  if (t.kind === "board" || t.x == null) return { ...t, kind: "board", p: [sim.lm.board[0], sim.lm.board[1], sim.lm.board[2]] };
  return { ...t, p: [t.x, t.y, t.z] };
}
function targetOf(sim) {
  return targetInfo(sim).p;
}
function bearingTo(sim, p) {
  if (!p) return null;
  const w = sim.walker;
  const dx = p[0] - w.x;
  const dz = p[2] - w.z;
  if (Math.hypot(dx, dz) < 0.5) return null;
  return Math.atan2(dx, dz);
}

/* ---- the hatch: the opening and the door swinging in (LanderModel model units) ---------------- */
function Hatch({ sim }) {
  const open = useRef();
  const door = useRef();
  const shut = useRef();
  const gl = useThree((s) => s.gl);
  const doorMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#46484e", roughness: 0.58, metalness: 0.15 }), []);
  const metal = useMemo(() => new THREE.MeshStandardMaterial({ color: "#c9ccd2", roughness: 0.3, metalness: 0.85, envMap: lunarEnv(gl), envMapIntensity: 1.1 }), [gl]);
  // the hatch's hardware (model units, in the hatch's frame): the trim round the opening, the
  // hinges on its left, the handle on its right (on the door, so it swings in with it)
  const hw = useMemo(() => {
    const trim = mergeGeometries([
      new THREE.BoxGeometry(0.186, 0.008, 0.003).translate(0, 0.078, 0.0075),
      new THREE.BoxGeometry(0.186, 0.008, 0.003).translate(0, -0.078, 0.0075),
      new THREE.BoxGeometry(0.008, 0.148, 0.003).translate(0.089, 0, 0.0075),
      new THREE.BoxGeometry(0.008, 0.148, 0.003).translate(-0.089, 0, 0.0075),
      new THREE.CylinderGeometry(0.0055, 0.0055, 0.026, 10).translate(-0.093, 0.046, 0.0095),
      new THREE.CylinderGeometry(0.0055, 0.0055, 0.026, 10).translate(-0.093, -0.046, 0.0095),
    ]);
    const handle = mergeGeometries([
      new THREE.BoxGeometry(0.006, 0.052, 0.006).translate(0, 0, 0.0048),
      new THREE.BoxGeometry(0.006, 0.006, 0.006).translate(0, 0.023, 0.0018),
      new THREE.BoxGeometry(0.006, 0.006, 0.006).translate(0, -0.023, 0.0018),
      new THREE.CylinderGeometry(0.009, 0.009, 0.004, 12).rotateX(Math.PI / 2).translate(-0.085, 0.04, 0.001),
    ]);
    return { trim, handle };
  }, []);
  const dark = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 8;
    c.height = 64;
    const g = c.getContext("2d");
    const gr = g.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, "#020203");
    gr.addColorStop(0.75, "#0b0b0d");
    gr.addColorStop(1, "#1a1918");
    g.fillStyle = gr;
    g.fillRect(0, 0, 8, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
  }, []);
  useFrame(() => {
    const h = sim.hatch;
    if (open.current) open.current.visible = h > 0.005;
    if (shut.current) shut.current.visible = h <= 0.005;
    if (door.current) {
      door.current.visible = h > 0.005;
      // the door turns in about its hinge: seen from outside it narrows towards the hinge
      const a = h * 1.45;
      door.current.scale.x = Math.max(0.02, Math.cos(a));
      doorMat.color.setScalar(0.27 - 0.17 * h);
    }
  });
  return (
    <group position={[0, 0.545, 0.288]} rotation={[0.124, 0, 0]}>
      <mesh ref={open} position={[0, 0, 0.0064]} material={dark} visible={false} renderOrder={1}>
        <planeGeometry args={[0.168, 0.148]} />
      </mesh>
      <group ref={door} position={[-0.084, 0, 0.0068]} visible={false}>
        <mesh position={[0.084, 0, 0]} material={doorMat} renderOrder={2}>
          <planeGeometry args={[0.168, 0.148]} />
        </mesh>
        <mesh position={[0.084 + 0.058, 0, 0]} geometry={hw.handle} material={metal} />
      </group>
      <mesh geometry={hw.trim} material={metal} castShadow />
      <mesh ref={shut} position={[0.058, 0, 0.0068]} geometry={hw.handle} material={metal} castShadow />
    </group>
  );
}

/* ---- footprints and dust (the stones, rings and instruments: EvaScience) ------------------------ */
const MAX_PRINTS = 700;
function Footprints({ sim }) {
  const ref = useRef();
  // the overshoe's chevron tread pressed into the regolith, its rim of pushed-up dust (evaTextures)
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ map: bootPrintTexture(), transparent: true, depthWrite: false, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 }), []);
  const geo = useMemo(() => new THREE.PlaneGeometry(0.19, 0.42).rotateX(-Math.PI / 2), []);
  const seen = useRef(0);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const one = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  useFrame(() => {
    const im = ref.current;
    if (!im || sim.prints.length === seen.current) return;
    for (let i = seen.current; i < sim.prints.length; i++) {
      const p = sim.prints[i];
      q.setFromAxisAngle(up, p.heading);
      pos.set(p.x, p.y + 0.012, p.z);
      im.setMatrixAt(i % MAX_PRINTS, m.compose(pos, q, one));
    }
    seen.current = sim.prints.length;
    im.count = Math.min(MAX_PRINTS, sim.prints.length);
    im.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, mat, MAX_PRINTS]} frustumCulled={false} receiveShadow renderOrder={2} />;
}

const MAX_DUST = 320;
function Dust({ sim }) {
  const ref = useRef();
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_DUST * 3), 3));
    g.setDrawRange(0, 0);
    return g;
  }, []);
  useFrame(() => {
    const arr = geo.attributes.position.array;
    const now = sim.clock;
    let n = 0;
    const keep = [];
    for (const d of sim.dust) {
      const t = now - d.t0;
      // in vacuum: a clean ballistic arc under lunar gravity, no billowing, no hanging cloud
      const y = d.y + d.vy * t - 0.81 * t * t;
      if (y < d.floor || t > 2.2) continue;
      keep.push(d);
      if (n < MAX_DUST) {
        arr[n * 3] = d.x + d.vx * t;
        arr[n * 3 + 1] = y;
        arr[n * 3 + 2] = d.z + d.vz * t;
        n++;
      }
    }
    sim.dust = keep;
    geo.setDrawRange(0, n);
    geo.attributes.position.needsUpdate = true;
    if (ref.current) ref.current.visible = n > 0;
  });
  return (
    <points ref={ref} geometry={geo} frustumCulled={false}>
      <pointsMaterial color="#a59d90" size={0.022} sizeAttenuation transparent opacity={0.9} depthWrite={false} />
    </points>
  );
}

/* ---- the director: the EVA's clock, the astronaut, the camera ---------------------------------- */
const _v = new THREE.Vector3();
const _t = new THREE.Vector3();
const _c = new THREE.Vector3();

function Director({ sim, astroRef, camState, markerRefs, callbacks }) {
  const { camera, size } = useThree();
  const camPos = useRef(null);
  const camLook = useRef(new THREE.Vector3());
  const perf = useRef({ n: 0, acc: 0, list: [] });

  useEffect(() => {
    camera.fov = VFOV;
    camera.near = 0.05;
    camera.updateProjectionMatrix();
  }, [camera]);

  useFrame((state, rawDt) => {
    // the step is capped (a stall must not throw the astronaut across the plain); validation in a
    // software renderer may raise the cap so the EVA runs at its own pace there
    const cap = typeof window !== "undefined" && window.__lvEvaMaxDt ? window.__lvEvaMaxDt : 1 / 20;
    const dt = Math.min(rawDt, cap);
    const S = sim;
    const now = state.clock.elapsedTime;
    // frame pacing (validation tooling: browser figures, not an iPhone measurement)
    const pf = perf.current;
    if (rawDt < 1) {
      pf.n++;
      pf.acc += rawDt;
      pf.list.push(rawDt);
      if (pf.list.length > 600) pf.list.shift();
    }
    if (!S.paused) {
      S.clock += dt;
      advance(S, dt, now, callbacks);
    }
    // the body for this frame
    const a = S.astro;
    if (a) astroRef.current = a;
    // camera
    updateCamera(S, camera, dt, camPos, camLook, camState, size);
    // markers on the HUD
    placeMarkers(S, camera, size, markerRefs);
    if (typeof window !== "undefined" && pf.n === 40) {
      // validation tooling: the Sun's shadow map as it is (its size proves it was made right)
      state.scene.traverse((o) => {
        if (o.isDirectionalLight && o.castShadow) window.__lvEvaShadow = { map: o.shadow.map ? o.shadow.map.width : 0, box: o.shadow.camera.right };
      });
    }
    if (typeof window !== "undefined") {
      const w = S.walker;
      if (!pf.sortedAt || now - pf.sortedAt > 0.5) {
        const sorted = pf.list.slice().sort((x, y) => x - y);
        pf.p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
        pf.sortedAt = now;
      }
      window.__lvEva = {
        mode: S.mode,
        t: S.t,
        progress: { ...S.progress },
        x: w.x,
        z: w.z,
        y: w.y,
        heading: w.heading,
        speed: w.speed,
        warn: w.warn,
        atLimit: w.atLimit,
        hit: w.hit,
        lmDist: Math.hypot(w.x - S.lm.axis[0], w.z - S.lm.axis[1]),
        interact: S.hud.interact || null,
        verdict: S.hud.verdict || null,
        photoDist: S.hud.photoDist || null,
        camYaw: S.camYaw,
        target: targetOf(S),
        distance: S.distance,
        prints: S.prints.length,
        hatch: S.hatch,
        pose: S.pose,
        cam: camera.position.toArray().map((v) => v / S_PER_M),
        camInsideLM: camState.current.insideLM,
        camBelowGround: camState.current.belowGround,
        camGuard: camState.current.guarded,
        camRange: camera.position.distanceTo(camLook.current) / S_PER_M,
        frame: { n: pf.n, avg: pf.n ? pf.acc / pf.n : 0, p95: pf.p95 || 0 },
        samples: S.samples.length,
        photos: S.photos.length,
        site: S.site.id,
        objective: nextObjective(S.cfg, S.progress),
        targetKind: targetInfo(S).kind,
        sampleIds: S.samples.map((x) => x.id),
        instruments: S.instruments.length,
        dataReady: S.dataReadyAt != null && S.clock >= S.dataReadyAt,
        deployU: S.deploy ? S.deploy.t / DEPLOY_TIME : null,
        surveyU: S.survey ? S.survey.t / SURVEY_TIME : null,
      };
      if (!window.__lvEvaRoute) window.__lvEvaRoute = (x, z) => routeBetween(S.world, [S.walker.x, S.walker.z], [x, z]); // validation tooling
      if (!window.__lvEvaPlan || window.__lvEvaPlan.site !== S.site.id) {
        const P = S.plan;
        const pt = (t) => t && { x: t.x, y: t.y, z: t.z, fallback: !!t.fallback, formation: t.formation || null, route: t.route ? t.route.points : null };
        window.__lvEvaPlan = { site: S.site.id, lm: S.lm.axis, board: [S.lm.board[0], S.lm.board[2]], samples: P.samples.map((t) => ({ id: t.id, ...pt(t) })), survey: pt(P.survey), look: P.survey ? P.survey.look : null, photo: { ...pt(P.photo), subject: P.photo.subject }, instrument: P.instrument ? { ...pt(P.instrument), kind: P.instrument.kind } : null, fallbacks: P.fallbacks };
      }
    }
  });
  return null;
}

/** A line once per EVA (the reminder and the boundary call have their own cooldowns). */
function sayOnce(S, cb, id, opts) {
  if (!id || S.said.has(id)) return;
  S.said.add(id);
  cb.say(id, opts);
}

/**
 * An objective done: recorded, said (the crew's call, then the next task from the destination's
 * voice: Houston, or the onboard computer on the far side), and a safe point to save.
 */
function completeObjective(S, id, cb, { delay = 2.6 } = {}) {
  if (S.progress[id]) return;
  S.progress[id] = true;
  S.lastProgressAt = S.clock;
  S.events.push(`done:${id}`);
  const V = S.cfg.voice;
  sayOnce(S, cb, V.done[id]);
  const next = nextObjective(S.cfg, S.progress);
  sayOnce(S, cb, next === "return" ? V.returnLM : V.go[next], { delay });
  cb.checkpoint();
}

/** One step of the EVA (everything but the camera). */
function advance(S, dt, now, cb) {
  const lm = S.lm;
  const w = S.walker;
  const V = S.cfg.voice;
  const say = (id, opts) => sayOnce(S, cb, id, opts);
  if (S.mode === "egress") {
    S.t += dt;
    const T = egressLength();
    const f = egressAt(lm, Math.min(S.t, T + 0.05));
    S.hatch = f.hatch;
    S.pose = f.pose;
    if (S.t > 2.4) say("eva.hatch");
    if (f.pose === "climb") say("eva.ladder");
    if (f.firstStep && !S.progress.firstSteps) {
      S.progress.firstSteps = true;
      S.lastProgressAt = S.clock;
      S.events.push("firstSteps");
      // the first bootprints, off the footpad
      S.prints.push({ x: lm.board[0] + S.side[0] * 0.13 + S.out[0] * -0.42, y: S.world.ground(lm.board[0], lm.board[2]), z: lm.board[2] + S.side[1] * 0.13 + S.out[1] * -0.42, heading: f.heading + Math.PI });
      say("eva.firstStep");
      say(V.firstSteps, { delay: 5.5 });
    }
    const spec = sequenceSpec(lm, f, now);
    S.astro = { pos: f.pos, heading: f.heading, rig: solveRig(spec), hidden: !!f.hidden, dust: S.distance / 160 };
    if (S.t >= T) {
      S.mode = "explore";
      w.x = lm.board[0];
      w.z = lm.board[2];
      w.y = S.world.ground(w.x, w.z);
      w.heading = f.heading;
      w.speed = 0;
      S.prints.push({ x: w.x - S.side[0] * 0.13, y: w.y, z: w.z - S.side[1] * 0.13, heading: w.heading });
      S.events.push("explore");
      const next = nextObjective(S.cfg, S.progress);
      say(next === "return" ? V.returnLM : V.go[next], { delay: 2.5 });
      cb.checkpoint();
    }
    return;
  }
  if (S.mode === "ingress") {
    S.t += dt;
    const T = ingressLength();
    // past the end by a margin: the phases are summed in floating point, so the last one must
    // not be left a hair short of done (and the end is decided on the clock, not on that frame)
    const f = ingressAt(lm, Math.min(S.t, T + 0.05));
    S.hatch = f.hatch;
    S.pose = f.pose;
    const spec = sequenceSpec(lm, f, now);
    S.astro = { pos: f.pos, heading: f.heading, rig: solveRig(spec), hidden: !!f.hidden, dust: S.distance / 160 };
    if (S.t >= T && S.mode !== "done") {
      S.mode = "done";
      S.doneAt = S.clock;
      S.events.push("hatchClosed");
      say("eva.hatchClosed");
      say(V.complete, { delay: 3.2 });
    }
    return;
  }
  if (S.mode === "done") {
    if (S.clock - S.doneAt > 4.2 && !S.finished) {
      S.finished = true;
      cb.complete();
    }
    return;
  }

  // ---- on the surface: explore, approach, sample, survey, deploy, the receiver's panel, photo ----
  let input = { x: 0, y: 0, camYaw: S.camYaw };
  const keyX = (S.keys.has("d") || S.keys.has("arrowright") ? 1 : 0) - (S.keys.has("a") || S.keys.has("arrowleft") ? 1 : 0);
  const keyY = (S.keys.has("w") || S.keys.has("arrowup") ? 1 : 0) - (S.keys.has("s") || S.keys.has("arrowdown") ? 1 : 0);
  const stick = { x: clamp(S.input.x + keyX, -1, 1), y: clamp(S.input.y + keyY, -1, 1) };
  if (S.mode === "explore") {
    input = { x: stick.x, y: stick.y, camYaw: S.camYaw };
  } else if (S.mode === "approach") {
    const A = S.approach;
    const dx = A.x - w.x;
    const dz = A.z - w.z;
    const d = Math.hypot(dx, dz);
    const b = Math.atan2(dx, dz);
    if (d > A.standoff + 0.04) input = { x: 0, y: clamp((d - A.standoff) * 1.4, 0.3, 0.7), camYaw: b };
    else {
      // there: face the way the next part needs, then go on
      const face = A.face != null ? A.face : b;
      const diff = wrapPi(face - w.heading);
      input = { x: 0, y: 0.6, camYaw: face, turnOnly: true };
      if (Math.abs(diff) < 0.06 && Math.abs(w.speed) < 0.03) {
        w.heading = face;
        if (A.then === "sample") startSample(S, now, A.id);
        else if (A.then === "survey") startSurvey(S);
        else if (A.then === "deploy") startDeploy(S);
        else if (A.then === "console") startConsole(S);
        else if (A.then === "ingress") startIngress(S, cb);
        S.approach = null;
      }
    }
    if (S.approach && S.clock - A.at > 12) {
      // never stuck walking into something
      S.approach = null;
      S.mode = "explore";
    }
  } else if (S.mode === "photo") {
    // the stick turns the body; the camera's on the chest
    w.heading = wrapPi(w.heading - stick.x * 0.9 * dt);
    input = { x: 0, y: 0, camYaw: S.camYaw, locked: true };
  } else if (S.mode === "sample" || S.mode === "survey" || S.mode === "deploy" || S.mode === "console") {
    input = { x: 0, y: 0, camYaw: S.camYaw, locked: true };
  }
  if (S.mode === "ingress") return;

  const h0 = w.heading;
  const events = stepWalker(w, S.world, input, dt);
  const dh = Math.abs(wrapPi(w.heading - h0));
  S.distance = w.distance;
  // turning on the spot: small shuffle steps
  S.turnPhase += dh / 0.9;
  const turning = clamp(dh / dt / 0.6, 0, 1);

  // the body
  let spec;
  const root = [w.x, w.y, w.z];
  if (S.mode === "sample") {
    const sm = S.sample;
    sm.t += dt;
    const u = sm.t / SAMPLE_TIME;
    spec = sampleSpec(Math.min(1, u), sm.stoneLocal, now);
    sm.stoneIn = spec.stoneIn;
    sm.head = spec.scoop ? toWorld(root, w.heading, spec.scoop.head) : null;
    if (u >= 1) {
      const st = S.plan.samples.find((x) => x.id === sm.id);
      S.sample = null;
      S.mode = "explore";
      S.samples = [...S.samples.filter((x) => x.id !== st.id), { id: st.id, site: S.site.id, x: +st.x.toFixed(2), z: +st.z.toFixed(2), at: new Date().toISOString() }];
      S.lastProgressAt = S.clock;
      S.events.push(`sample:${st.id}`);
      const all = S.plan.samples.every((x) => S.samples.some((y) => y.id === x.id));
      if (all) {
        S.sampleObjectiveDone = true;
        completeObjective(S, S.sampleObjective, cb);
      } else {
        say(V.sampleOne);
        say(V.goSecond, { delay: 2.4 });
        cb.checkpoint();
      }
    }
  } else if (S.mode === "survey") {
    const sv = S.survey;
    sv.t += dt;
    const u = sv.t / SURVEY_TIME;
    spec = inspectSpec(Math.min(1, u), toLocal(root, w.heading, S.plan.survey.look), now);
    if (u >= 1) {
      S.survey = null;
      S.mode = "explore";
      S.events.push("survey");
      completeObjective(S, "survey", cb, { delay: 6 });
    }
  } else if (S.mode === "deploy") {
    const D = S.deploy;
    D.t += dt;
    const u = D.t / DEPLOY_TIME;
    spec = deploySpec(Math.min(1, u), now);
    D.pack = spec.pack ? toWorld(root, w.heading, spec.pack) : null;
    if (u >= 1) {
      const I = S.plan.instrument;
      S.deploy = null;
      S.mode = "explore";
      S.instruments = [{ id: I.id, site: S.site.id, x: +I.x.toFixed(2), z: +I.z.toFixed(2), at: new Date().toISOString() }];
      S.instrumentHeading = D.heading;
      S.dataReadyAt = S.clock + DATA_TIME;
      S.events.push("instrument");
      completeObjective(S, S.instrumentObjective, cb, { delay: 6 });
    }
  } else if (S.mode === "console") {
    spec = consoleSpec(now);
  } else if (S.mode === "photo") {
    spec = photoSpec(S.photoPitch, now);
  } else {
    spec = walkSpec({
      phase: w.phase,
      speed: w.speed,
      turnPhase: S.turnPhase,
      turning,
      t: now,
      groundAt: (lx, lz) => {
        const p = toWorld(root, w.heading, [lx, 0, lz]);
        return S.world.ground(p[0], p[2]) - w.y;
      },
    });
  }
  const rig = solveRig(spec);
  S.pose = S.mode;
  S.astro = { pos: [w.x, w.y, w.z], heading: w.heading, rig, hidden: S.mode === "photo", dust: S.distance / 160 };
  // bootprints and dust where a boot comes down
  for (const e of events) {
    const ank = rig.joints[e.side === "L" ? "ankleL" : "ankleR"];
    const p = toWorld([w.x, w.y, w.z], w.heading, [ank.x, 0, ank.z + 0.06]);
    const gy = S.world.ground(p[0], p[2]);
    S.prints.push({ x: p[0], y: gy, z: p[2], heading: w.heading });
    const n = 5 + Math.floor(e.speed * 6);
    for (let i = 0; i < n && S.dust.length < MAX_DUST; i++) {
      const sp = 0.35 + Math.random() * (0.6 + e.speed * 0.7);
      const el = (18 + Math.random() * 38) * DEG;
      const az = w.heading + (Math.random() - 0.5) * 1.6 + (w.speed < 0 ? Math.PI : 0);
      S.dust.push({ x: p[0], y: gy + 0.03, z: p[2], vx: Math.sin(az) * Math.cos(el) * sp, vy: Math.sin(el) * sp, vz: Math.cos(az) * Math.cos(el) * sp, t0: S.clock, floor: gy - 0.01 });
    }
  }
  // what the astronaut can do here, and the photo's verdict; BOARD THE LM once he has walked away
  // from the ladder (or when it is the task), not the moment he steps off it
  if (!S.leftLadder && Math.hypot(w.x - lm.board[0], w.z - lm.board[2]) > 3) S.leftLadder = true;
  let can = S.mode === "explore" ? actionAt(S.plan, S.world, w, S) : null;
  if (can && can.kind === "board" && !S.leftLadder && nextObjective(S.cfg, S.progress) !== "return") can = null;
  S.hud.action = can;
  S.hud.interact = can ? can.kind : null;
  if (S.mode === "photo") {
    const view = photoView(S, rig);
    const v = photoCheckFor(S.plan, S.world, view);
    S.hud.verdict = v.verdict;
    S.hud.photoDist = v.distance;
  } else S.hud.verdict = null;
  // the exploration limit
  if (w.warn && !S.warned) {
    S.warned = true;
    S.events.push("boundary");
    cb.say(V.boundary);
  }
  if (!w.warn && S.warned && Math.hypot(w.x - lm.axis[0], w.z - lm.axis[1]) < S.cfg.area.warn - 3) S.warned = false;
  // a gentle reminder when nothing has happened for a while
  if (S.clock - S.lastProgressAt > 80 && S.mode === "explore") {
    S.lastProgressAt = S.clock;
    cb.say(V.remind);
  }
}

function startSample(S, now, id) {
  const w = S.walker;
  const st = S.plan.samples.find((x) => x.id === id) || S.plan.samples[0];
  S.mode = "sample";
  S.sample = { id: st.id, t: 0, stoneLocal: toLocal([w.x, w.y, w.z], w.heading, [st.x, st.y + stoneLift(st.type), st.z]), stoneIn: "ground", head: null, at: now };
}
function startSurvey(S) {
  S.mode = "survey";
  S.walker.speed = 0;
  S.survey = { t: 0 };
}
function startDeploy(S) {
  const w = S.walker;
  const I = S.plan.instrument;
  // the instrument turned to the astronaut: the seismometer's and the gnomon's front, or the gap
  // between two of the antenna's elements (they unroll clear of his boots)
  const dx = w.x - I.x;
  const dz = w.z - I.z;
  const heading = I.kind === "antenna" ? Math.atan2(-dz, dx) : Math.atan2(dx, dz);
  S.mode = "deploy";
  w.speed = 0;
  S.deploy = { t: 0, heading, pack: null };
}
function startConsole(S) {
  S.mode = "console";
  S.walker.speed = 0;
  S.events.push("console");
}
function startIngress(S, cb) {
  S.mode = "ingress";
  S.t = 0;
  cb.say("eva.board");
}

/** The chest camera's view (world m) for the photo check. */
function photoView(S, rig) {
  const w = S.walker;
  const c = chestCamera(rig);
  const lens = toWorld([w.x, w.y, w.z], w.heading, [c.lens.x, c.lens.y, c.lens.z]);
  const pitch = Math.asin(clamp(c.dir.y, -1, 1));
  return { pos: lens, yaw: w.heading, pitch, vfov: PHOTO_FRAME_FOV, aspect: 1 };
}

/* ---- the camera ---------------------------------------------------------------------------------- */
/**
 * How deep (m) a point is inside each of the camera's keep-out volumes, one entry per volume
 * (negative: outside it): the ground, the LM (a cylinder a little wider than the descent stage),
 * the legs' struts, the footpads and the boulders. Written into `out`; returns the count.
 */
function keepOut(S, x, y, z, out) {
  const lm = S.lm;
  const g = S.world.ground(x, z);
  let n = 0;
  out[n++] = g + 0.35 - y;
  const r = Math.hypot(x - lm.axis[0], z - lm.axis[1]);
  out[n++] = y < lm.base[1] + 7 ? 3.1 - r : -1;
  // the legs: each strut runs from its outrigger (about 2.3 m out, 3.2 m up) down to its footpad;
  // keep the lens well clear of it so a strut never fills the frame
  for (const c of S.world.cols.capsules) {
    const vx = c.bx - c.ax;
    const vz = c.bz - c.az;
    const u = clamp(((x - c.ax) * vx + (z - c.az) * vz) / (vx * vx + vz * vz), 0, 1);
    const top = lm.base[1] + 2.3 - 2.1 * u; // the strut's height over this point
    out[n++] = y < top + 0.9 ? 0.95 - Math.hypot(x - (c.ax + vx * u), z - (c.az + vz * u)) : -1;
  }
  for (const c of S.world.cols.circles) {
    if (c.kind === "lm") continue;
    out[n++] = y < g + (c.kind === "pad" ? 0.6 : c.r * 1.25 + 0.3) ? c.r + 0.3 - Math.hypot(x - c.x, z - c.z) : -1;
  }
  return n;
}
const _kT = [];
const _kP = [];
/**
 * From the look-at point T towards the wanted position: the last clear point (m). A point is in the
 * way only where the ray goes deeper into a keep-out volume than T already is: the astronaut can
 * stand closer to the LM, a strut or a boulder than the camera's margins, and a ray leaving it
 * outwards is clear.
 */
function clearPath(S, T, C) {
  const n = keepOut(S, T[0], T[1], T[2], _kT);
  let last = T.slice();
  for (let i = 1; i <= 28; i++) {
    const u = i / 28;
    const p = [T[0] + (C[0] - T[0]) * u, T[1] + (C[1] - T[1]) * u, T[2] + (C[2] - T[2]) * u];
    keepOut(S, p[0], p[1], p[2], _kP);
    let hit = false;
    for (let k = 0; k < n && !hit; k++) hit = _kP[k] > 0 && _kP[k] > Math.max(0, _kT[k]) + 0.01;
    if (hit) {
      const back = Math.max(0, u - 0.06);
      return [T[0] + (C[0] - T[0]) * back, T[1] + (C[1] - T[1]) * back, T[2] + (C[2] - T[2]) * back];
    }
    last = p;
  }
  return last;
}

function updateCamera(S, camera, dt, camPos, camLook, camState, size) {
  const w = S.walker;
  const lm = S.lm;
  const P = S.P;
  const k = 1 - Math.exp(-dt * 5);
  let C;
  let L;
  let fov = VFOV;
  const yawBefore = S.camYaw;
  // the look drag
  const ld = S.look;
  if (ld.dx || ld.dy) {
    if (S.mode === "photo") {
      w.heading = wrapPi(w.heading - ld.dx * 0.004);
      S.photoPitch = clamp(S.photoPitch - ld.dy * 0.003, -0.25, 0.25);
    } else {
      S.camYaw = wrapPi(S.camYaw - ld.dx * 0.0065);
      S.camPitch = clamp(S.camPitch + ld.dy * 0.0045, CAM.minPitch, CAM.maxPitch);
    }
    S.lookAt = S.clock;
    ld.dx = 0;
    ld.dy = 0;
  }
  const a = S.astro;
  const out = S.out;
  const side = S.side;
  if (S.mode === "egress" || S.mode === "ingress" || S.mode === "done") {
    // the cinematic: the hatch over the porch, then following the astronaut down (or up) the ladder,
    // and low on the ground for the first boot off the footpad
    const pose = S.pose;
    const root = a ? a.pos : P.porch;
    if (pose === "crawl" || (S.mode === "egress" && S.t < 2.4) || S.mode === "done" || (S.mode === "ingress" && (pose === "lower" || pose === "crawl"))) {
      C = [P.porch[0] + out[0] * 5.4 + side[0] * 2.6, P.porch[1] + 0.55, P.porch[2] + out[1] * 5.4 + side[1] * 2.6];
      L = [lm.hatch[0], lm.hatch[1] - 0.35, lm.hatch[2]];
    } else if (pose === "drop" || pose === "stepDown" || (pose === "stepUp" && S.t < 1.2)) {
      // low, beside the footpad: the boots, the pad and the first prints, the astronaut whole
      const gy = S.world.ground(lm.board[0], lm.board[2]);
      C = [lm.board[0] + out[0] * 2.9 + side[0] * 2.3, gy + 0.6, lm.board[2] + out[1] * 2.9 + side[1] * 2.3];
      L = [lm.pad[0] + out[0] * 0.6, lm.pad[1] + 0.85, lm.pad[2] + out[1] * 0.6];
    } else if (pose === "turn" || pose === "idle") {
      // into the walking camera, behind the astronaut, facing the first task
      const T = [root[0], root[1] + CAM.target, root[2]];
      const yaw = S.camYaw;
      C = clearPath(S, T, [T[0] - Math.sin(yaw) * CAM.dist * Math.cos(CAM.pitch), T[1] + Math.sin(CAM.pitch) * CAM.dist, T[2] - Math.cos(yaw) * CAM.dist * Math.cos(CAM.pitch)]);
      L = T;
    } else {
      C = [root[0] + out[0] * 5.0 + side[0] * 2.7, root[1] + 1.4, root[2] + out[1] * 5.0 + side[1] * 2.7];
      L = [root[0], root[1] + 1.0, root[2]];
    }
  } else if (S.mode === "photo") {
    const rig = a.rig;
    const view = photoView(S, rig);
    C = view.pos;
    L = [C[0] + Math.sin(view.yaw) * Math.cos(view.pitch) * 10, C[1] + Math.sin(view.pitch) * 10, C[2] + Math.cos(view.yaw) * Math.cos(view.pitch) * 10];
    fov = PHOTO_VFOV;
  } else {
    // third person: behind and above, orbiting with the drag; it settles behind the walk when
    // the player is not looking round. Taking the sample it swings round to the side, where the
    // scoop and the stone can be seen (from behind the backpack hides them).
    const T = [w.x, w.y + CAM.target, w.z];
    const at = (yw, q, dd) => [T[0] - Math.sin(yw) * dd * Math.cos(q), T[1] + Math.sin(q) * dd, T[2] - Math.cos(yw) * dd * Math.cos(q)];
    const reach = (yw, q) => {
      const f = clearPath(S, T, at(yw, q, CAM.dist));
      return Math.hypot(f[0] - T[0], f[1] - T[1], f[2] - T[2]);
    };
    const pNow = S.camPitch + (S.camLift || 0);
    const clear = (yw) => reach(yw, pNow) >= CAM.near;
    // the camera never parks on a side where the LM, a strut or a boulder is right behind the
    // astronaut (it would close in on the backpack): a drag into that side stops at its edge ...
    if (S.camYaw !== yawBefore && !clear(S.camYaw) && clear(yawBefore)) {
      let a0 = yawBefore;
      let a1 = yawBefore + wrapPi(S.camYaw - yawBefore);
      for (let i = 0; i < 6; i++) {
        const m = (a0 + a1) / 2;
        if (clear(m)) a0 = m;
        else a1 = m;
      }
      S.camYaw = wrapPi(a0);
    }
    // ... the swing for the sample and the settle behind the walk only turn it towards clear sides ...
    let aim = null;
    const busy = S.mode === "sample" || S.mode === "survey" || S.mode === "deploy" || S.mode === "console";
    if (busy) aim = wrapPi(w.heading + 1.25);
    else if (S.clock - S.lookAt > 2.2 && Math.abs(w.speed) > 0.35) aim = w.heading;
    if (aim !== null) {
      const next = wrapPi(S.camYaw + wrapPi(aim - S.camYaw) * Math.min(1, dt * (busy ? 1.6 : 0.6)));
      if (clear(next) || !clear(S.camYaw)) S.camYaw = next;
    }
    // ... and if the astronaut backs up against something with the camera on that side, the camera
    // slides round to the nearest clear side
    if (!clear(S.camYaw)) {
      let to = null;
      for (let j = 1; j <= 16 && to === null; j++) {
        for (const sg of [1, -1]) {
          const y2 = wrapPi(S.camYaw + sg * j * 0.1);
          if (clear(y2)) {
            to = y2;
            break;
          }
        }
      }
      if (to !== null) S.camYaw = wrapPi(S.camYaw + wrapPi(to - S.camYaw) * Math.min(1, dt * 6));
    }
    const yaw = S.camYaw;
    // the drag's pitch, unless a boulder or a strut is still right behind: then the camera rises
    // over the astronaut and looks down, and settles back as soon as the way behind is clear
    let want = S.camPitch;
    let best = reach(yaw, want);
    for (let q = S.camPitch + 0.12; best < 2.4 && q <= 1.36; q += 0.12) {
      const r = reach(yaw, q);
      if (r > best + 0.05) {
        best = r;
        want = q;
      }
    }
    S.camLift = (S.camLift || 0) + (want - S.camPitch - (S.camLift || 0)) * Math.min(1, dt * 5);
    const p = S.camPitch + S.camLift;
    const fd = reach(yaw, p);
    // pull in at once when something is in the way, ease back out
    S.camDist = fd < S.camDist ? fd : Math.min(fd, S.camDist + dt * 2.2);
    const d = Math.max(0.6, S.camDist);
    C = at(yaw, p, d);
    L = T;
  }
  _c.set(C[0] * S_PER_M, C[1] * S_PER_M, C[2] * S_PER_M);
  _t.set(L[0] * S_PER_M, L[1] * S_PER_M, L[2] * S_PER_M);
  const follow = S.mode === "explore" || S.mode === "approach" || S.mode === "sample" || S.mode === "survey" || S.mode === "deploy" || S.mode === "console";
  if (!camPos.current || S.mode === "photo") {
    // the first frame, and the chest camera (it is where the body is)
    camPos.current = camPos.current || new THREE.Vector3();
    camPos.current.copy(_c);
    camLook.current.copy(_t);
  } else {
    camPos.current.lerp(_c, follow ? 1 - Math.exp(-dt * 12) : k);
    camLook.current.lerp(_t, follow ? 1 - Math.exp(-dt * 16) : 1 - Math.exp(-dt * 4));
  }
  // never inside the LM or below the ground, whatever the smoothing did
  const cm = camPos.current;
  const cx = cm.x / S_PER_M;
  const cy = cm.y / S_PER_M;
  const cz = cm.z / S_PER_M;
  const g = S.world.ground(cx, cz);
  if (cy < g + 0.25) cm.y = (g + 0.25) * S_PER_M;
  // and never inside the LM's body, whatever the pull-in left (a last guard: out to its side)
  const rl = Math.hypot(cx - lm.axis[0], cz - lm.axis[1]);
  camState.current.guarded = false;
  if (rl < 2.55 && cy < lm.base[1] + 6.5 && S.mode !== "egress" && S.mode !== "ingress" && S.mode !== "done") {
    const k = rl > 1e-3 ? 2.55 / rl : 1;
    cm.x = (lm.axis[0] + (cx - lm.axis[0]) * k) * S_PER_M;
    cm.z = (lm.axis[1] + (cz - lm.axis[1]) * k) * S_PER_M;
    camState.current.guarded = true;
  }
  camState.current.insideLM = Math.hypot(cm.x / S_PER_M - lm.axis[0], cm.z / S_PER_M - lm.axis[1]) < 2.4 && cm.y / S_PER_M < lm.base[1] + 6;
  camState.current.belowGround = cm.y / S_PER_M < S.world.ground(cm.x / S_PER_M, cm.z / S_PER_M);
  camera.position.copy(cm);
  camera.lookAt(camLook.current);
  // development only (compiled out of production): a fixed camera for visual review captures,
  // window.__lvEvaCam = { pos: [x, y, z], look: [x, y, z] (m), fov }
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined" && window.__lvEvaCam) {
    const o = window.__lvEvaCam;
    camera.position.set(o.pos[0] * S_PER_M, o.pos[1] * S_PER_M, o.pos[2] * S_PER_M);
    camera.lookAt(o.look[0] * S_PER_M, o.look[1] * S_PER_M, o.look[2] * S_PER_M);
    if (o.fov) fov = o.fov;
  }
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  void size;
}

/* ---- the objective marker on the HUD: over its target, or at the edge pointing to it ---------- */
function placeMarkers(S, camera, size, refs) {
  const el = refs.marker.current;
  if (!el) return;
  const show = (S.mode === "explore" || S.mode === "approach") && !S.paused;
  if (!show) {
    el.style.opacity = "0";
    return;
  }
  const tg = targetInfo(S);
  const p = tg.p;
  _v.set(p[0] * S_PER_M, (p[1] + (tg.kind === "board" ? 1.2 : 0.5)) * S_PER_M, p[2] * S_PER_M).project(camera);
  const behind = _v.z > 1;
  let x = (_v.x * 0.5 + 0.5) * size.width;
  let y = (-_v.y * 0.5 + 0.5) * size.height;
  if (behind) {
    x = size.width - x;
    y = size.height - y;
  }
  // the edges it may sit on stay clear of the HUD: the objectives (upper left), the controls (the
  // lower corners); an off-screen target is shown on an inner rim, pointing the way
  const m = 56;
  const rim = { l: 90, r: size.width - 90, t: 70, b: size.height - 110 };
  const off = behind || x < m || x > size.width - m || y < m || y > size.height - m;
  let ang = 0;
  if (off) {
    const cx = size.width / 2;
    const cy = size.height / 2;
    let dx = x - cx;
    let dy = y - cy;
    if (behind && Math.hypot(dx, dy) < 1) dy = 1;
    const sx = (dx > 0 ? rim.r - cx : cx - rim.l) / Math.max(1e-3, Math.abs(dx));
    const sy = (dy > 0 ? rim.b - cy : cy - rim.t) / Math.max(1e-3, Math.abs(dy));
    const s = Math.min(sx, sy);
    x = cx + dx * s;
    y = cy + dy * s;
    ang = Math.atan2(dy, dx);
  }
  const w = S.walker;
  if (!off) {
    // never over the astronaut: lift it above his helmet when the target is behind him on screen
    _v.set(w.x * S_PER_M, (w.y + 2.05) * S_PER_M, w.z * S_PER_M).project(camera);
    const hx = (_v.x * 0.5 + 0.5) * size.width;
    const hy = (-_v.y * 0.5 + 0.5) * size.height;
    _v.set(w.x * S_PER_M, w.y * S_PER_M, w.z * S_PER_M).project(camera);
    const fy = (-_v.y * 0.5 + 0.5) * size.height;
    const half = Math.max(28, (fy - hy) * 0.32);
    if (Math.abs(x - hx) < half + 24 && y > hy - 26 && y < fy + 10) y = Math.max(m, hy - 26);
  }
  const d = Math.hypot(p[0] - w.x, p[2] - w.z);
  el.style.opacity = "1";
  el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  el.dataset.off = off ? "1" : "0";
  if (refs.arrow.current) {
    refs.arrow.current.style.display = off ? "block" : "none";
    refs.arrow.current.style.transform = `rotate(${ang}rad)`;
  }
  if (refs.dist.current) refs.dist.current.textContent = `${d.toFixed(0)} m`;
  el.dataset.kind = tg.kind;
}

/* ---- touch: the joystick (left), the look drag (right) ---------------------------------------- */
function Joystick({ sim, label }) {
  const [knob, setKnob] = useState(null);
  const id = useRef(null);
  const R = 52;
  const set = (o, e) => {
    const dx = e.clientX - o.x;
    const dy = e.clientY - o.y;
    const m = Math.hypot(dx, dy);
    const k = m > R ? R / m : 1;
    sim.input.x = clamp(dx / R, -1, 1);
    sim.input.y = clamp(-dy / R, -1, 1);
    setKnob({ x: o.x, y: o.y, kx: dx * k, ky: dy * k });
  };
  const origin = useRef(null);
  const down = (e) => {
    e.preventDefault();
    if (id.current != null) return;
    id.current = e.pointerId;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    origin.current = { x: e.clientX, y: e.clientY, rx: r.left, ry: r.top };
    set(origin.current, e);
  };
  const move = (e) => {
    if (e.pointerId !== id.current) return;
    e.preventDefault();
    set(origin.current, e);
  };
  const up = (e) => {
    if (e.pointerId !== id.current) return;
    id.current = null;
    sim.input.x = 0;
    sim.input.y = 0;
    setKnob(null);
  };
  return (
    <div
      className="absolute left-0 bottom-0 w-[44vw] h-[62vh] z-[16] touch-none select-none"
      data-testid="eva-joystick"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
    >
      {knob ? (
        <div className="fixed pointer-events-none" style={{ left: knob.x - R, top: knob.y - R, width: R * 2, height: R * 2 }}>
          <div className="absolute inset-0 rounded-full border border-white/30 bg-black/25" />
          <div className="absolute w-[46px] h-[46px] rounded-full bg-white/25 border border-white/60" style={{ left: R - 23 + knob.kx, top: R - 23 + knob.ky }} />
        </div>
      ) : (
        <div className="absolute left-[calc(var(--sal)+1.75rem)] bottom-[calc(var(--sab)+1.5rem)] short:bottom-[calc(var(--sab)+0.9rem)] w-[104px] h-[104px] rounded-full border border-white/20 bg-black/15 flex items-center justify-center pointer-events-none">
          <div className="w-[40px] h-[40px] rounded-full border border-white/35 bg-white/10" />
          <span className="absolute -top-4 font-mono text-[8px] tracking-[0.3em] text-zinc-400">{label}</span>
        </div>
      )}
    </div>
  );
}

function LookPad({ sim }) {
  const last = useRef(new Map());
  const down = (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    last.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const move = (e) => {
    const p = last.current.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    sim.look.dx += e.clientX - p.x;
    sim.look.dy += e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
  };
  const up = (e) => last.current.delete(e.pointerId);
  return (
    <div
      className="absolute right-0 top-0 w-[56vw] h-full z-[15] touch-none select-none cursor-grab active:cursor-grabbing"
      data-testid="eva-look"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

/* ---- the EVA ---------------------------------------------------------------------------------------- */
const KIND_COLOR = { sample: RING.sample, photo: RING.photo, board: RING.board, survey: RING.survey, instrument: RING.instrument, data: RING.data };

export default function LunarEva({ siteId = "tranquillitatis", pose = null, audio = null, lang = "en", resume = null, onCheckpoint = null, onComplete = null, onAbort = null }) {
  const T = evaText(lang);
  const site = useMemo(() => getSite(siteId), [siteId]);
  const p = pose || { x: 0, padY: site.contactGround ? site.scale.y(site.contactGround(0)) : 0, tilt: 0, pitch: 0, comp: [0, 0, 0, 0], probe: [0, 0, 0, 0] };
  const base = useMemo(() => [p.x, p.padY + LM.foot, 0], [p.x, p.padY]);
  const fx = useMemo(() => ({ thrust: 0, comp: (p.comp || [0, 0, 0, 0]).slice(), probe: (p.probe || [0, 0, 0, 0]).slice() }), [p.comp, p.probe]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sim = useMemo(() => makeSim({ site, pose: p, resume }), [site]);
  const cfg = sim.cfg;
  const MT = evaMissionText(cfg, lang);
  const legacy = cfg.id === "tranquillitatis"; // phase 1's own wording, unchanged
  const farSide = cfg.comms.earthLink === false;
  // the ground at close range (scene units): the swept ground round the LM, occlusion under the
  // descent stage and round each footpad (data/lmDesign: the pads where they stand)
  const near = useMemo(() => {
    const L = sim.lm;
    const k = S_PER_M;
    const pads = legFrames().map((f) => {
      const q = L.toWorld([f.padTop.x, GROUND, f.padTop.z]);
      return [q[0] * k, q[2] * k, L.padR * k];
    });
    return { tex: regolithNearTexture(), blast: [L.axis[0] * k, L.axis[1] * k, 11 * k], under: [L.axis[0] * k, L.axis[1] * k, 3.2 * k], pads };
  }, [sim]);
  const astroRef = useRef(null);
  const camState = useRef({});
  const markerRefs = { marker: useRef(), arrow: useRef(), dist: useRef() };
  const [hud, setHud] = useState({ mode: sim.mode, progress: { ...sim.progress } });
  const [banner, setBanner] = useState(null); // { kind, title, sub }
  const [toast, setToast] = useState(null);
  const [card, setCard] = useState(null); // the science card after a survey or a deployment
  const [dataDone, setDataDone] = useState(false);
  const [confirmBoard, setConfirmBoard] = useState(false);
  const [paused, setPaused] = useState(false);
  const [flash, setFlash] = useState(0);
  const cbs = useRef({});

  const evaState = () => {
    const e = { progress: { ...sim.progress }, samples: sim.samples.slice(), photos: sim.photos.slice(), completed: sim.mode === "done", distance: +sim.distance.toFixed(1) };
    if (cfg.instrument) e.instruments = sim.instruments.slice();
    return e;
  };
  cbs.current.say = (id, opts) => audio && audio.say(id, opts);
  cbs.current.checkpoint = () => onCheckpoint && onCheckpoint(evaState());
  cbs.current.complete = () => onComplete && onComplete({ ...evaState(), completed: true });

  // the start: EVA authorized (a fresh EVA), or back at the foot of the ladder (resumed). On the
  // far side there is no Earth link: only the onboard computer and the crew are heard
  useEffect(() => {
    if (farSide && audio && audio.setEarthLink) audio.setEarthLink(false);
    if (!sim.resumed) audio && audio.say(cfg.voice.authorized);
    else {
      const next = nextObjective(cfg, sim.progress);
      setBanner({ kind: "resume", title: MT.title, sub: next === "return" ? T.objectives.return : MT.objectives[next] });
      setTimeout(() => setBanner(null), 3200);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the HUD reads the simulation ten times a second; events become banners, toasts and cards
  useEffect(() => {
    const id = setInterval(() => {
      const w = sim.walker;
      const lmB = Math.atan2(sim.lm.axis[0] - w.x, sim.lm.axis[1] - w.z);
      setHud({
        mode: sim.mode,
        progress: { ...sim.progress },
        interact: sim.hud.interact || null,
        action: sim.hud.action || null,
        verdict: sim.hud.verdict || null,
        warn: !!w.warn && (sim.mode === "explore" || sim.mode === "approach"),
        lmDist: Math.hypot(w.x - sim.lm.axis[0], w.z - sim.lm.axis[1]),
        lmBearing: wrapPi(lmB - sim.camYaw), // 0: straight ahead on screen
        sampleU: sim.sample ? sim.sample.t / SAMPLE_TIME : null,
        surveyU: sim.survey ? sim.survey.t / SURVEY_TIME : null,
        deployU: sim.deploy ? sim.deploy.t / DEPLOY_TIME : null,
        dataU: sim.dataReadyAt == null ? 0 : clamp(1 - (sim.dataReadyAt - sim.clock) / DATA_TIME, 0, 1),
        dataReady: sim.dataReadyAt != null && sim.clock >= sim.dataReadyAt,
        samples: sim.samples.map((x) => x.id),
        target: targetInfo(sim),
        pose: sim.pose,
      });
      while (sim.events.length) {
        const e = sim.events.shift();
        if (e === "firstSteps") {
          setBanner({ kind: "first", title: T.firstSteps, sub: MT.banner });
          setTimeout(() => setBanner((b) => (b && b.kind === "first" ? null : b)), 5200);
        } else if (e.startsWith("sample:")) {
          const sid = e.slice(7);
          setToast({ text: legacy ? T.sampleDone : `${T.sampleStowed} · ${sid} · ${MT.samples[sid] || ""}`, at: Date.now() });
        } else if (e === "photoDone") setToast({ text: legacy ? T.photoDone : `${T.photoRecorded} · ${photoSubjectName()}`, at: Date.now() });
        else if (e === "survey") {
          const f = sim.plan.survey.formation;
          const [title, body] = MT.survey[f] || MT.survey.regolith;
          setCard({ kind: "survey", tag: MT.objectives.survey, title, body, color: RING.survey, at: Date.now() });
        } else if (e === "instrument") {
          const [title, body] = MT.instrument;
          setCard({ kind: "instrument", tag: `${title} · ${T.instrumentDone}`, title, body, color: RING.instrument, at: Date.now() });
        } else if (e === "console") setCard(null);
        else if (e === "hatchClosed") {
          setCard(null);
          setBanner({ kind: "complete", title: T.complete, sub: T.completeSub });
        }
      }
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // the subtitles take the top lane between the objectives and PAUSE, above the astronaut's helmet,
  // above the notices under them (checkpoint saved, sample stowed) and above the banners of the
  // egress and ingress films (FIRST STEPS ON THE MOON, EVA COMPLETE) lower down
  useEffect(() => {
    setSubtitlePlacement("lane");
    return () => {
      setSubtitlePlacement("default");
      if (typeof window !== "undefined") {
        delete window.__lvEvaRoute;
        delete window.__lvEvaPlan;
      }
    };
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);
  // the science card stays while it is read, then goes (or with CLOSE)
  useEffect(() => {
    if (!card) return undefined;
    const t = setTimeout(() => setCard((c) => (c && c.at === card.at ? null : c)), 20000);
    return () => clearTimeout(t);
  }, [card]);

  // keyboard (desktop)
  useEffect(() => {
    const keyOf = (e) => (e.key || "").toLowerCase();
    const dn = (e) => {
      const k = keyOf(e);
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
        sim.keys.add(k);
        e.preventDefault();
      } else if (k === "e" || k === "enter") {
        if (sim.mode === "console") confirmData();
        else act();
      } else if (k === "c") toggleCamera();
      else if (k === " ") {
        if (sim.mode === "photo") shutter();
        e.preventDefault();
      } else if (k === "escape" || k === "p") togglePause();
      else if (k === "q") sim.look.dx -= 40;
      else if (k === "r") sim.look.dx += 40;
    };
    const upk = (e) => sim.keys.delete(keyOf(e));
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", upk);
    return () => {
      window.removeEventListener("keydown", dn);
      window.removeEventListener("keyup", upk);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const photoSubjectName = () => {
    const s = sim.plan.photo.subject;
    if (s.kind === "horizon" && MT.subjectFallback) return MT.subjectFallback;
    return MT.subject;
  };
  const act = () => {
    if (sim.paused || sim.mode !== "explore") return;
    const what = actionAt(sim.plan, sim.world, sim.walker, sim);
    if (!what) return;
    const P = sim.plan;
    if (what.kind === "sample") {
      const st = P.samples.find((x) => x.id === what.id);
      sim.mode = "approach";
      sim.approach = { x: st.x, z: st.z, standoff: 0.85, face: null, then: "sample", id: st.id, at: sim.clock };
    } else if (what.kind === "survey") {
      const sv = P.survey;
      sim.mode = "approach";
      sim.approach = { x: sv.x, z: sv.z, standoff: 0.05, face: Math.atan2(sv.look[0] - sv.x, sv.look[2] - sv.z), then: "survey", at: sim.clock };
    } else if (what.kind === "instrument") {
      const I = P.instrument;
      sim.mode = "approach";
      sim.approach = { x: I.x, z: I.z, standoff: 0.6, face: null, then: "deploy", at: sim.clock };
    } else if (what.kind === "data") {
      const I = P.instrument;
      sim.mode = "approach";
      sim.approach = { x: I.x, z: I.z, standoff: 0.75, face: null, then: "console", at: sim.clock };
    } else if (what.kind === "board") {
      if (cfg.objectives.some((o) => !sim.progress[o.id])) setConfirmBoard(true);
      else board();
    }
  };
  const board = () => {
    setConfirmBoard(false);
    setCard(null);
    const lm = sim.lm;
    sim.mode = "approach";
    sim.approach = { x: lm.board[0], z: lm.board[2], standoff: 0.05, face: sim.P.facingLM, then: "ingress", at: sim.clock };
  };
  const confirmData = () => {
    if (sim.mode !== "console" || sim.paused) return;
    if (!(sim.dataReadyAt != null && sim.clock >= sim.dataReadyAt)) return;
    setDataDone(true);
    completeObjective(sim, "data", cbs.current, { delay: 2.2 });
    setTimeout(() => {
      if (sim.mode === "console") sim.mode = "explore";
      setDataDone(false);
    }, 2600);
  };
  const closeConsole = () => {
    if (sim.mode === "console") sim.mode = "explore";
  };
  const toggleCamera = () => {
    if (sim.paused) return;
    if (sim.mode === "photo") {
      sim.mode = "explore";
      sim.photoPitch = 0;
    } else if (sim.mode === "explore" && sim.progress.firstSteps) {
      sim.mode = "photo";
      sim.walker.speed = 0;
      sim.photoPitch = 0;
    }
  };
  const photoObj = cfg.objectives.find((o) => o.kind === "photo").id;
  const shutter = () => {
    if (sim.mode !== "photo" || sim.paused) return;
    setFlash((n) => n + 1);
    const v = sim.hud.verdict;
    if (v === "ok") {
      const first = !sim.progress[photoObj];
      sim.photos = [...sim.photos, { subject: cfg.photo.subject.id, site: sim.site.id, distance: +(sim.hud.photoDist || 0).toFixed(1), at: new Date().toISOString() }].slice(-8);
      sim.lastProgressAt = sim.clock;
      if (first) {
        sim.events.push("photoDone");
        completeObjective(sim, photoObj, cbs.current);
        setTimeout(() => {
          if (sim.mode === "photo") toggleCamera();
        }, 1400);
      } else setToast({ text: legacy ? T.photoDone : `${T.photoRecorded} · ${photoSubjectName()}`, at: Date.now() });
    } else setToast({ text: `${T.photoMiss} — ${verdictText(v)}`, at: Date.now(), warn: true });
  };
  const verdictText = (v) => {
    if (!v) return "";
    if (sim.plan.photo.subject.kind === "lm") return T.verdict[v] || "";
    const SV = T.subjectVerdict;
    const name = photoSubjectName();
    if (v === "goToPoint") return SV.goToPoint;
    if (v === "aimSubject") return SV.aimSubject(name);
    if (v === "centreSubject") return SV.centreSubject(name);
    if (v === "tiltUp") return SV.tiltUp;
    if (v === "tiltDown") return sim.plan.photo.subject.kind === "crater" ? SV.tiltDownCrater : SV.tiltDown;
    return T.verdict[v] || "";
  };
  const togglePause = () => {
    sim.paused = !sim.paused;
    setPaused(sim.paused);
  };
  const skip = () => {
    sim.said.add("eva.hatch");
    sim.said.add("eva.ladder");
    if (sim.mode === "egress") sim.t = Math.max(sim.t, egressLength() - 2.3);
    else if (sim.mode === "ingress") sim.t = Math.max(sim.t, ingressLength() - 0.05);
  };

  const pr = hud.progress || sim.progress;
  const task = nextObjective(cfg, pr);
  const scripted = hud.mode === "egress" || hud.mode === "ingress" || hud.mode === "done";
  const objectives = objectiveIds(cfg);
  const tg = hud.target || targetInfo(sim);
  const tKind = tg.kind;
  const markerLabel = () => {
    if (tKind === "sample") return legacy ? T.sampleLabel : `${T.sampleLabel} ${tg.id}`;
    if (tKind === "photo") return T.photoLabel;
    if (tKind === "survey") return T.surveyLabel;
    if (tKind === "instrument") return T.deployLabel;
    if (tKind === "data") return T.instrumentLabel;
    return T.ladderLabel;
  };
  const actLabel = (k) => ({ sample: T.collect, survey: T.inspect, instrument: T.deploy, data: T.checkInstrument, board: T.board })[k] || T.board;
  const nSamples = cfg.samples.length;
  const ready = hud.interact && hud.interact === tKind;

  return (
    <div className="absolute inset-0 bg-[#050505]" data-testid="lunar-eva" data-mode={hud.mode} data-task={task} data-site={cfg.id}>
      <div className="absolute inset-0 canvas-host">
        <Canvas
          camera={{ position: [p.x + 6, p.padY + 3, 8], fov: VFOV, near: 0.05, far: 6000 }}
          dpr={[1, 2]}
          shadows={{ type: THREE.PCFShadowMap }}
          gl={{ antialias: true, alpha: false, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }}
          onCreated={({ gl }) => gl.setClearColor("#050505")}
        >
          <Suspense fallback={null}>
            <color attach="background" args={["#050505"]} />
            <SiteSky site={site} />
            <SiteSun site={site} box={24} focus={() => (astroRef.current ? [astroRef.current.pos[0] * S_PER_M, astroRef.current.pos[1] * S_PER_M, astroRef.current.pos[2] * S_PER_M] : base)} />
            <SiteTerrain site={site} near={near} />
            <SiteRocks site={site} />
            <group position={base} rotation={[(p.pitch || 0) * DEG, 0, -(p.tilt || 0) * DEG]}>
              <LanderModel scale={LM.scale} fx={fx} quality="close" />
              <group scale={LM.scale}>
                <Hatch sim={sim} />
              </group>
            </group>
            <group scale={S_PER_M}>
              <Astronaut stateRef={astroRef} />
              <ContactShadows sim={sim} />
              <NearPebbles sim={sim} color={site.palette.rock} />
              <SampleStones sim={sim} />
              <ScienceMarkers sim={sim} />
              <Instrument sim={sim} />
              <Footprints sim={sim} />
              <Dust sim={sim} />
            </group>
            <Director sim={sim} astroRef={astroRef} camState={camState} markerRefs={markerRefs} callbacks={cbs.current} />
          </Suspense>
          <AdaptiveResolution />
        </Canvas>
      </div>

      {/* the controls: nothing over the astronaut (the middle of the screen) */}
      {!scripted && !paused && hud.mode !== "photo" && hud.mode !== "console" && <Joystick sim={sim} label={T.move} />}
      {!scripted && !paused && <LookPad sim={sim} />}

      {/* objectives, upper left (hidden during the egress and ingress films) */}
      <div style={scripted ? { display: "none" } : undefined} className="absolute top-[calc(var(--hud-top)+0.25rem)] left-[calc(var(--sal)+1rem)] md:left-[calc(var(--sal)+2rem)] z-30 pointer-events-none bg-black/50 backdrop-blur-sm border-l-2 border-[#FF3B00] px-3 py-2 short:px-2.5 short:py-1.5 max-w-[min(260px,42vw)]" data-testid="eva-objectives">
        <div className="font-mono text-[9px] short:text-[8px] tracking-[0.35em] text-[#FF3B00]">● {MT.title}</div>
        {farSide && (
          <div className="font-mono text-[7.5px] short:text-[7px] tracking-[0.2em] text-[#9fb6cc] mt-0.5" data-testid="eva-earth-link">
            ◌ {T.earthLink} · {T.onboard}
          </div>
        )}
        <ul className="mt-1 space-y-0.5 font-mono text-[10px] short:text-[9px] tracking-[0.14em]">
          {objectives.map((k) => {
            const done = k === "return" ? hud.mode === "done" || hud.mode === "ingress" : pr[k];
            const cur = !done && task === k && !scripted;
            const label = k === "return" ? T.objectives.return : MT.objectives[k];
            const count = k === sim.sampleObjective && nSamples > 1 ? ` ${(hud.samples || sim.samples.map((x) => x.id)).length}/${nSamples}` : "";
            return (
              <li key={k} className={`flex items-center gap-2 ${done ? "text-[#4fd1c5]" : cur ? "text-white" : "text-zinc-500"}`} data-testid={`eva-obj-${k}`} data-done={done ? "1" : "0"} data-current={cur ? "1" : "0"}>
                <span className="w-3 text-center">{done ? "✓" : cur ? "›" : "·"}</span>
                <span>
                  {label}
                  {count && <span className="tabular text-zinc-300">{count}</span>}
                </span>
              </li>
            );
          })}
        </ul>
        {!scripted && (
          <div className={`mt-1 flex items-center gap-1.5 font-mono text-[8px] tracking-[0.2em] tabular ${hud.warn ? "text-[#f5c451]" : "text-zinc-400"}`} data-testid="eva-lm-dist">
            {/* the way back to the LM, relative to the view: up is straight ahead */}
            <span className="inline-block text-[9px] leading-none" style={{ transform: `rotate(${hud.lmBearing != null ? -hud.lmBearing : 0}rad)` }} data-testid="eva-lm-arrow">
              ▲
            </span>
            <span>
              {T.lm} {hud.lmDist != null ? hud.lmDist.toFixed(0) : "–"} m
            </span>
          </div>
        )}
        {/* the exploration limit: part of the panel, so it never covers the scene or another control */}
        {hud.warn && !scripted && (
          <div className="mt-1.5 border border-[#f5c451]/60 bg-black/60 px-2 py-1 font-mono text-[9px] short:text-[8px] leading-snug tracking-[0.16em] text-[#f5c451]" data-testid="eva-boundary">
            ▲ {T.boundary}
          </div>
        )}
      </div>

      {/* pause, upper right */}
      <button
        type="button"
        onClick={togglePause}
        data-testid="eva-pause"
        className="absolute top-[calc(var(--hud-top)+0.25rem)] right-[calc(var(--sar)+1rem)] md:right-[calc(var(--sar)+2rem)] z-30 min-w-[44px] min-h-[44px] px-3 font-mono text-[10px] tracking-[0.25em] text-white bg-black/50 border border-white/20 hover:border-white/50 touch-manipulation"
      >
        II <span className="hidden md:inline">{T.pause}</span>
      </button>

      {/* the objective marker (placed by the director): filled when the action is in reach */}
      <div ref={markerRefs.marker} className="absolute left-0 top-0 z-20 pointer-events-none" style={{ opacity: 0 }} data-testid="eva-marker" data-ready={ready ? "1" : "0"}>
        <div className="-translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
          <div ref={markerRefs.arrow} className="absolute text-[#f5c451] text-[14px]" style={{ display: "none" }}>
            <span className="inline-block translate-x-[18px]">➤</span>
          </div>
          <div className="w-3 h-3 rotate-45 border-2" style={{ borderColor: KIND_COLOR[tKind] || RING.board, background: ready ? KIND_COLOR[tKind] : "rgba(0,0,0,0.3)" }} />
          <div className="mt-1 font-mono text-[8px] tracking-[0.25em] text-white bg-black/45 px-1 whitespace-nowrap">
            {markerLabel()} · <span ref={markerRefs.dist} className="tabular">–</span>
          </div>
        </div>
      </div>

      {/* actions, lower right: INTERACT (when there is something to do), CAMERA, the shutter */}
      {!scripted && !paused && hud.mode !== "console" && (
        <div className="absolute right-[calc(var(--sar)+1rem)] md:right-[calc(var(--sar)+2rem)] bottom-[calc(var(--sab)+1.25rem)] short:bottom-[calc(var(--sab)+0.75rem)] z-30 flex items-end gap-2.5">
          {hud.mode === "photo" ? (
            <>
              <button type="button" onClick={toggleCamera} data-testid="eva-camera" className="min-w-[56px] min-h-[48px] px-2 font-mono text-[9px] tracking-[0.2em] text-zinc-200 bg-black/55 border border-white/25 touch-manipulation">
                ✕ {T.exitCamera}
              </button>
              <button
                type="button"
                onClick={shutter}
                data-testid="eva-shutter"
                data-ready={hud.verdict === "ok" ? "1" : "0"}
                className={`w-[68px] h-[68px] short:w-[60px] short:h-[60px] rounded-full border-4 ${hud.verdict === "ok" ? "border-[#4fd1c5] bg-white/90" : "border-white/60 bg-white/40"} touch-manipulation`}
                aria-label={T.shutter}
              />
            </>
          ) : (
            <>
              {pr.firstSteps && (
                <button
                  type="button"
                  onClick={toggleCamera}
                  disabled={hud.mode !== "explore"}
                  data-testid="eva-camera"
                  data-hint={task === photoObj ? "1" : "0"}
                  className={`min-w-[60px] min-h-[52px] short:min-h-[46px] px-2 font-mono text-[9px] tracking-[0.2em] text-white bg-black/55 border touch-manipulation disabled:opacity-40 ${task === photoObj ? "border-[#4fd1c5] shadow-[0_0_0_2px_#4fd1c5,0_0_14px_rgba(79,209,197,0.45)]" : "border-white/25"}`}
                >
                  ◉ {T.camera}
                </button>
              )}
              {hud.interact && hud.mode === "explore" && (
                <button
                  type="button"
                  onClick={act}
                  data-testid="eva-interact"
                  data-action={hud.interact}
                  className="min-w-[150px] short:min-w-[132px] min-h-[52px] short:min-h-[46px] px-4 font-mono text-[11px] short:text-[10px] tracking-[0.25em] text-white bg-[#FF3B00]/90 hover:bg-[#FF3B00] border border-[#FF3B00] touch-manipulation veil-in"
                >
                  {actLabel(hud.interact)}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* the chest camera's viewfinder */}
      {hud.mode === "photo" && (
        <div className="absolute inset-0 z-[18] pointer-events-none flex items-center justify-center" data-testid="eva-viewfinder" data-verdict={hud.verdict || ""}>
          <div className="relative h-[82vh] aspect-square max-w-[82vw]">
            {["top-0 left-0 border-t-2 border-l-2", "top-0 right-0 border-t-2 border-r-2", "bottom-0 left-0 border-b-2 border-l-2", "bottom-0 right-0 border-b-2 border-r-2"].map((c) => (
              <div key={c} className={`absolute w-6 h-6 ${c} ${hud.verdict === "ok" ? "border-[#4fd1c5]" : "border-white/80"}`} />
            ))}
            <div className="absolute left-1/2 top-1/2 w-5 h-px bg-white/70 -translate-x-1/2" />
            <div className="absolute left-1/2 top-1/2 h-5 w-px bg-white/70 -translate-y-1/2" />
            <div className={`absolute -bottom-1 left-1/2 -translate-x-1/2 translate-y-full font-mono text-[10px] short:text-[9px] tracking-[0.25em] px-2 py-0.5 whitespace-nowrap ${hud.verdict === "ok" ? "text-[#4fd1c5]" : "text-white"} bg-black/50`} data-testid="eva-verdict">
              {verdictText(hud.verdict)}
            </div>
          </div>
        </div>
      )}
      {flash > 0 && <div key={flash} className="absolute inset-0 z-[19] bg-white pointer-events-none eva-flash" />}

      {/* collecting, surveying, deploying */}
      {(hud.mode === "sample" || hud.mode === "survey" || hud.mode === "deploy") && (
        <div className="absolute bottom-[calc(var(--sab)+1.5rem)] left-1/2 -translate-x-1/2 z-30 pointer-events-none font-mono text-[10px] tracking-[0.3em] text-white bg-black/50 px-3 py-1.5 whitespace-nowrap" data-testid={hud.mode === "sample" ? "eva-collecting" : hud.mode === "survey" ? "eva-surveying" : "eva-deploying"}>
          {hud.mode === "sample" ? T.collecting : hud.mode === "survey" ? T.surveying : T.deploying}{" "}
          <span className="inline-block w-16 h-1 bg-white/20 align-middle ml-2">
            <span className="block h-1" style={{ width: `${Math.min(100, ((hud.mode === "sample" ? hud.sampleU : hud.mode === "survey" ? hud.surveyU : hud.deployU) || 0) * 100)}%`, background: hud.mode === "sample" ? RING.sample : hud.mode === "survey" ? RING.survey : RING.instrument }} />
          </span>
        </div>
      )}

      {/* the science of what was surveyed or deployed */}
      {!scripted && !paused && hud.mode !== "photo" && hud.mode !== "console" && <InfoCard card={card} T={T} onClose={() => setCard(null)} />}
      {/* the far side's receiver: its own interface */}
      {hud.mode === "console" && !paused && <DataPanel T={T} u={hud.dataU || 0} ready={!!hud.dataReady} confirmed={dataDone || !!pr.data} onConfirm={confirmData} onClose={closeConsole} />}

      {/* egress / ingress caption and skip */}
      {scripted && hud.mode !== "done" && (
        <>
          <div className="absolute bottom-6 short:bottom-3 left-6 md:left-10 safe-ml safe-mb z-30 pointer-events-none bg-black/45 backdrop-blur-sm border-l-2 border-[#FF3B00] px-3 py-1.5 font-mono text-[9px] short:text-[8px] tracking-[0.35em] text-zinc-200" data-testid="eva-phase">
            ● {hud.mode === "egress" ? T.egress : T.ingress}
          </div>
          <button type="button" onClick={skip} data-testid="eva-skip" className="absolute bottom-6 short:bottom-2 right-6 md:right-10 safe-mr safe-mb z-30 font-mono text-[10px] tracking-[0.3em] text-zinc-400 hover:text-white px-3 py-2 touch:min-h-[44px] touch:px-4 bg-black/30 border border-white/10">
            {T.skip}
          </button>
        </>
      )}

      {/* banners: FIRST STEPS ON THE MOON, EVA COMPLETE */}
      {banner && (
        <div className="absolute inset-x-0 top-[30%] short:top-[29%] z-30 pointer-events-none flex flex-col items-center text-center px-4 scan-in" data-testid={`eva-banner-${banner.kind}`}>
          <div className="font-mono text-[10px] short:text-[9px] tracking-[0.45em] text-[#FF3B00]">● {banner.sub}</div>
          <div className="font-display font-black text-white text-4xl md:text-6xl short:text-3xl tracking-tight mt-1 drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]">{banner.title}</div>
        </div>
      )}
      {/* notices in the upper lane between the objectives and PAUSE, under the subtitles (which take
          the top of the same lane while walking): clear of the astronaut in the middle of the screen */}
      {toast && (
        <div className={`absolute ${LANE} top-[calc(var(--hud-top)+5rem)] short:top-[calc(var(--hud-top)+4.6rem)] z-30 pointer-events-none flex justify-center`}>
          <div key={toast.at} className={`min-w-0 max-w-full text-center font-mono text-[10px] short:text-[9px] tracking-[0.25em] leading-snug px-3 py-1.5 bg-black/60 border veil-in ${toast.warn ? "text-[#f5c451] border-[#f5c451]/50" : "text-[#4fd1c5] border-[#4fd1c5]/50"}`} data-testid="eva-toast">
            {toast.text}
          </div>
        </div>
      )}

      {/* keyboard help on desktop */}
      {!scripted && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none font-mono text-[8px] tracking-[0.25em] text-zinc-500 touch:hidden short:hidden whitespace-nowrap">{T.keys}</div>
      )}

      {/* BOARD THE LM with objectives left */}
      {confirmBoard && (
        <div className="absolute inset-0 z-40 bg-black/60 flex items-center justify-center px-4" data-testid="eva-board-confirm">
          <div className="hud-panel max-w-sm w-full px-5 py-4 border-l-2 border-[#f5c451]">
            <div className="font-mono text-[10px] tracking-[0.35em] text-[#f5c451]">● {T.confirmBoard}</div>
            <p className="mt-2 text-[13px] text-zinc-200 leading-snug">{T.confirmBoardSub}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setConfirmBoard(false)} data-testid="eva-board-cancel" className="min-h-[46px] font-mono text-[10px] tracking-[0.2em] text-white bg-black/40 border border-white/25">
                {T.keepGoing}
              </button>
              <button type="button" onClick={board} data-testid="eva-board-go" className="min-h-[46px] font-mono text-[10px] tracking-[0.2em] text-white bg-[#FF3B00]/90 border border-[#FF3B00]">
                {T.boardAnyway}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* pause */}
      {paused && (
        <div className="absolute inset-0 z-40 bg-black/65 flex items-center justify-center px-4" data-testid="eva-paused">
          <div className="hud-panel max-w-xs w-full px-5 py-4 border-l-2 border-[#FF3B00]">
            <div className="font-mono text-[10px] tracking-[0.35em] text-[#FF3B00]">● {T.paused}</div>
            <div className="mt-4 grid gap-2">
              <button type="button" onClick={togglePause} data-testid="eva-resume" className="min-h-[48px] font-mono text-[11px] tracking-[0.25em] text-white bg-[#FF3B00]/90 border border-[#FF3B00]">
                {T.resume}
              </button>
              <button type="button" onClick={() => onAbort && onAbort()} data-testid="eva-abort" className="min-h-[44px] font-mono text-[10px] tracking-[0.25em] text-zinc-300 bg-black/40 border border-white/20">
                {T.abort}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
