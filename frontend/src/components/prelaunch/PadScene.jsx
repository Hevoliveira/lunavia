import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import RocketModel, { setRocketTextureAnisotropy } from "@/components/RocketModel";
import LaunchComplex from "@/components/scenes/LaunchComplex";
import { createEnvironment, R as ENV_R, KM_PER_UNIT } from "@/components/scenes/launch/environment";
import Astronaut from "@/components/eva/Astronaut";
import PadTech, { techPose } from "./PadTech";
import { UNIT_M } from "@/data/launchTimeline";
import { solveRig, standSpec } from "@/data/astronautRig";
import { ARM, BOARD, CM_ON_PAD, ROCKET_SCALE, TOWER_RIDE, WALK, WALK_LEN, WHITE_ROOM, boardEye, footfallsBetween, smooth, stepBob, towerCameraAt, walkEye } from "@/data/preLaunch";
import { armGeometry, disposeAll, grimeTex, hatchGeometry, padMaterials, withGrime } from "./padModel";

/*
 * COUNTDOWN TO LAUNCH — the pad: arrival, the elevator ride up the tower, the walk along the crew
 * access arm, the white room and the open hatch (stages "tower" and "walkway").
 *
 * The same LV-001 (RocketModel, at the launch film's scale) on the same launch complex
 * (LaunchComplex, its small crew arm left out: the arm is drawn here at human scale) under the same
 * sky, sea and Sun as the launch film's pad shots (launch/environment, composited first, then the
 * vehicle layer over a cleared depth buffer). Inside the white room the rocket is clipped away and
 * this scene's boost cover, hatch and open door stand in its place.
 *
 * ctl (a ref the overlay shares): { stage, towerT, s (m walked), stop (index or -1), resume,
 * boardT (null until BOARD), look: { yaw, pitch }, onBoarded, events: [] }.
 */
const S = 1 / UNIT_M; // metres → scene units
const K_ENV = UNIT_M / 1000 / KM_PER_UNIT; // env units per scene unit
const SUN = new THREE.Vector3(10, 8, 8).normalize();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, "YXZ");

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

/** Clip the rocket inside the white room (its own materials cloned with a box of clipping planes). */
function clipBox() {
  const F = ARM.floor;
  const x0 = 0.25 * S;
  const x1 = (WHITE_ROOM.x1 + 0.02) * S;
  const y0 = (F - 0.06) * S;
  const y1 = (F + WHITE_ROOM.height + 0.08) * S;
  const z = (WHITE_ROOM.width / 2 + 0.08) * S;
  // clipIntersection: a fragment goes only if it is inside every plane (inside the box)
  return [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -x1),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), x0),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -y1),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), y0),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -z),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), -z),
  ];
}

function WhiteRoomPeople({ env }) {
  // the suit technician by the hatch, and the two crewmates waiting their turn either side
  const tech = useRef({ visible: true, pos: [CM_ON_PAD.hatch.r + 0.95, ARM.floor + 0.935, -0.95], yaw: Math.PI / 2 - 0.5, pose: techPose("stand") });
  const crew = [useRef(null), useRef(null)];
  useFrame((state) => {
    const k = state.clock.elapsedTime;
    tech.current.pose = techPose("stand", "check", 0.55 + 0.25 * Math.sin(k * 0.7));
    [0, 1].forEach((i) => {
      const side = i ? -1 : 1;
      crew[i].current = {
        pos: [WHITE_ROOM.x1 - 0.85, ARM.floor, side * 1.18],
        heading: side > 0 ? Math.PI + 0.35 : -0.35,
        rig: solveRig(standSpec(k + i * 1.7)),
        helmetUp: 0,
      };
    });
  });
  return (
    <>
      <PadTech stateRef={tech} variant={1} />
      <Astronaut stateRef={crew[0]} variant="launch" env={env} />
      <Astronaut stateRef={crew[1]} variant="launch" env={env} />
    </>
  );
}

export default function PadScene({ ctl }) {
  const { gl, camera, scene } = useThree();
  const sunRef = useRef();
  const ptRef = useRef();
  const rocketRef = useRef();
  const complexRef = useRef();
  const doorRef = useRef();
  const padProg = useRef(0);
  const ctrlRef = useRef({ engines: [0, 0, 0, 0, 0], glow: 0, sep: 0, upper: 0, showStage1: true, expand: 0 });
  const anisotropy = useMemo(() => Math.min(8, gl.capabilities.getMaxAnisotropy()), [gl]);
  useEffect(() => setRocketTextureAnisotropy(anisotropy), [anisotropy]);
  const env = useMemo(() => createEnvironment(), []);
  const sky = useMemo(() => daySkyEnv(gl), [gl]);
  const geo = useMemo(() => ({ arm: armGeometry(), hatch: hatchGeometry() }), []);
  const M = useMemo(() => padMaterials(), []);
  const planes = useMemo(() => clipBox(), []);

  useEffect(() => {
    gl.localClippingEnabled = true;
    scene.environment = sky.texture;
    // the rocket's materials, cloned with the white room's clip box (the shared originals untouched)
    const clones = [];
    const root = rocketRef.current;
    if (root)
      root.traverse((o) => {
        if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
        const m = o.material;
        if (!(m.isMeshStandardMaterial || m.isMeshBasicMaterial || m.isMeshPhongMaterial)) return;
        const c = m.clone();
        c.clippingPlanes = planes;
        c.clipIntersection = true;
        o.material = c;
        clones.push([o, m, c]);
      });
    return () => {
      clones.forEach(([o, m, c]) => {
        o.material = m;
        c.dispose();
      });
      scene.environment = null;
      gl.localClippingEnabled = false;
    };
  }, [gl, scene, sky, planes]);
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
  useEffect(
    () => () => {
      env.dispose();
      sky.dispose();
      disposeAll(geo.arm, geo.hatch, M.mat, M.tex);
    },
    [env, sky, geo, M]
  );
  useEffect(() => {
    const l = sunRef.current;
    if (!l) return;
    l.castShadow = true;
    l.shadow.mapSize.set(2048, 2048);
    l.shadow.bias = -0.0003;
    l.shadow.normalBias = 0.01;
  }, []);

  useFrame((state, dt0) => {
    const c = ctl.current;
    const dt = Math.min(0.1, dt0);
    let eye;
    let look;
    let fov = 62;
    let dip = 0;
    if (c.stage === "tower") {
      c.towerT += dt;
      const cam = towerCameraAt(c.towerT);
      camera.position.set(...cam.pos);
      camera.lookAt(...cam.look);
      fov = cam.fov;
      dip = cam.dip;
      if (c.towerT >= TOWER_RIDE.dur) c.toWalk && c.toWalk();
    } else {
      // walking: on along the arm unless paused at a stop; BOARD takes the view to the hatch
      if (c.boardT != null) {
        c.boardT += dt;
        const b = boardEye(Math.min(c.boardT, BOARD.dur));
        eye = b.pos;
        look = b.look;
        dip = smooth((c.boardT - BOARD.dip[0]) / (BOARD.dip[1] - BOARD.dip[0]));
        if (c.boardT >= BOARD.dur && c.onBoarded) {
          const f = c.onBoarded;
          c.onBoarded = null;
          f();
        }
      } else {
        const stopX = c.stop + 1 < WALK.stops.length ? WALK.stops[c.stop + 1].x : -1e9;
        const sStop = Math.min(WALK_LEN, ARM.start - stopX);
        if (c.paused) {
          c.pauseT += dt;
          if (c.resume || (c.stop < WALK.stops.length - 1 && c.pauseT > WALK.pauseMax)) {
            c.paused = false;
            c.resume = false;
          }
        } else if (c.s < sStop) {
          const s0 = c.s;
          c.s = Math.min(sStop, c.s + WALK.speed * dt);
          c.steps += footfallsBetween(s0, c.s);
          if (c.s >= sStop - 1e-6) {
            c.stop += 1;
            c.paused = true;
            c.pauseT = 0;
            c.events.push({ type: "stop", id: WALK.stops[c.stop].id, call: WALK.stops[c.stop].call });
          }
        }
        eye = walkEye(c.s);
        eye = [eye[0], eye[1] + (c.paused ? 0 : stepBob(c.s)), eye[2]];
      }
      camera.position.set(eye[0] * S, eye[1] * S, eye[2] * S);
      // facing along the arm (−x), turned by the player's drag; while boarding, towards the hatch
      if (c.boardT != null) {
        camera.lookAt(look[0] * S, look[1] * S, look[2] * S);
      } else {
        _e.set(c.look.pitch, Math.PI / 2 + c.look.yaw, 0, "YXZ");
        camera.quaternion.setFromEuler(_e);
      }
    }
    // the near plane: 2.4 cm on foot (the arm's walls are close), 30 cm on the ground
    const near = c.stage === "tower" && c.towerT < TOWER_RIDE.elevator[0] ? 0.01 : 0.0008;
    if (Math.abs(camera.fov - fov) > 1e-3 || camera.near !== near || camera.far !== 300) {
      camera.fov = fov;
      camera.near = near;
      camera.far = 300;
      camera.updateProjectionMatrix();
    }
    // validation tooling may hold the camera (window.__lvPrelaunchCam = { pos, look } in metres)
    const hold = typeof window !== "undefined" ? window.__lvPrelaunchCam : null;
    if (hold && hold.pos && hold.look) {
      camera.position.set(hold.pos[0] * S, hold.pos[1] * S, hold.pos[2] * S);
      camera.lookAt(hold.look[0] * S, hold.look[1] * S, hold.look[2] * S);
      dip = 0;
    }
    camera.updateMatrixWorld();
    c.dip = dip;

    // the Sun's shadows: the pad from the ground, the arm and the white room once up there
    const l = sunRef.current;
    if (l) {
      const sc = l.shadow.camera;
      const up = c.stage !== "tower" || c.towerT > TOWER_RIDE.elevator[0] + 6;
      const ctr = up ? _w.set((WHITE_ROOM.x1 + 14) * S, ARM.floor * S, 0) : _w.set(0.6, 1.4, 0);
      const half = up ? 0.75 : 3.2;
      l.position.copy(ctr).addScaledVector(SUN, up ? 3 : 12);
      l.target.position.copy(ctr);
      l.target.updateMatrixWorld();
      if (sc.right !== half) {
        sc.left = -half;
        sc.right = half;
        sc.top = up ? 0.4 : 5.2;
        sc.bottom = up ? -0.4 : -2.2;
        sc.near = 0.05;
        sc.far = up ? 8 : 60;
        sc.updateProjectionMatrix();
      }
    }
    // a soft fill that walks with the player inside the arm (the lamps' light)
    if (ptRef.current) {
      ptRef.current.position.copy(camera.position).add(_v.set(0, 0.6 * S, 0));
      ptRef.current.intensity = c.stage === "tower" ? 0 : 0.0012;
    }
    // the hatch door, open
    if (doorRef.current) doorRef.current.rotation.y = 1.85;

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
      w.pad = { stage: c.stage, towerT: c.towerT, s: c.s, stop: c.stop, paused: c.paused, boardT: c.boardT, cam: camera.position.toArray().map((x) => x * UNIT_M), calls: gl.info.render.calls, tris: gl.info.render.triangles };
    }
  }, 1);

  const A = geo.arm;
  const H = geo.hatch;
  return (
    <>
      <ambientLight intensity={0.22} />
      <hemisphereLight args={["#bcd3f0", "#5a5040", 0.32]} />
      <directionalLight ref={sunRef} position={[10, 8, 8]} intensity={2.4} color="#fff2e2" />
      <pointLight ref={ptRef} color="#fff1dc" intensity={0} distance={7 * S} decay={2} />
      <group ref={complexRef}>
        <LaunchComplex progRef={padProg} anisotropy={anisotropy} hideCrewArm />
      </group>
      <group ref={rocketRef}>
        <RocketModel scale={ROCKET_SCALE} ctrlRef={ctrlRef} />
      </group>
      {/* the arm, the white room and the hatch, at human scale */}
      <group scale={S}>
        <mesh geometry={A.wall} material={M.mat.wall} castShadow receiveShadow />
        <mesh geometry={A.floor} material={M.mat.floor} receiveShadow />
        <mesh geometry={A.frame} material={M.mat.frame} castShadow receiveShadow />
        <mesh geometry={A.truss} material={M.mat.truss} castShadow />
        <mesh geometry={A.rail} material={M.mat.rail} />
        <mesh geometry={A.lamp} material={M.mat.lamp} />
        <mesh geometry={A.white} material={M.mat.white} castShadow receiveShadow />
        <mesh geometry={A.red} material={M.mat.red} />
        <mesh geometry={A.hazard} material={M.mat.hazard} receiveShadow />
        <mesh geometry={A.conduit} material={M.mat.conduit} />
        {Object.entries(A.signs).map(([id, g]) => (
          <mesh key={id} geometry={g} material={M.mat.signs[id]} />
        ))}
        <mesh geometry={A.glass} material={M.mat.glass} renderOrder={5} />
        <mesh geometry={H.cover} material={M.mat.cover} receiveShadow />
        <mesh geometry={H.frame} material={M.mat.hatchFrame} />
        <mesh geometry={H.tunnel} material={M.mat.tunnel} />
        <mesh geometry={H.card} material={M.mat.card} />
        <group position={H.hinge}>
          <mesh ref={doorRef} geometry={H.door} material={M.mat.door} castShadow />
        </group>
        {/* the white room's lamps (a light's intensity and range are in the scene's 30 m units) */}
        <pointLight position={[CM_ON_PAD.hatch.r + 1.2, ARM.floor + 2.3, 0]} intensity={0.006} distance={0.25} decay={2} color="#fff4e6" />
        {/* the white room's brighter clean-room light, spilling out through the doorway (the destination) */}
        <pointLight position={[WHITE_ROOM.x1 - 0.6, ARM.floor + 2.2, 0]} intensity={0.005} distance={0.3} decay={2} color="#f4f8ff" />
        <WhiteRoomPeople env={sky.texture} />
      </group>
    </>
  );
}
