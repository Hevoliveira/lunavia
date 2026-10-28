import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { lunarEnv } from "@/components/LanderModel";
import { BODY, SEGMENTS } from "@/data/astronautRig";
import { BONES, FINGER_ROOT, astronautGeometry, astronautMaterials } from "./astronautModel";

/**
 * The astronaut, drawn on the rig (data/astronautRig solveRig) the EVA scene solves each frame.
 * stateRef.current = { pos [x, y, z] (m, the root between the boots), heading (rad), rig, hidden,
 * dust (0..1: the lower legs and boots greyed by the walk) }. Units are metres: the scene puts the
 * astronaut in a group scaled to its own 0.5 units per metre.
 *
 * The suit is one skinned mesh per material on a skeleton of rigid bones (a bone per rig segment,
 * the fingers under the hands, the scoop), so the whole astronaut costs about fifteen draw calls
 * with its shadow. The gold visor reflects the real surroundings: a small cube map is captured
 * from the helmet, a face per frame, whenever the astronaut has moved a couple of metres (the
 * astronaut hidden, the shadow maps not redrawn), then filtered for the visor's gloss.
 */
const VISOR_RES = 128;
const VISOR_MOVE = 1.6; // m walked before the reflection is captured again
const VISOR_EVERY = 1.2; // s, at least, between captures
const _v = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _d = new THREE.Vector3();
const HIDE = 1e-5;

function build(env, variant) {
  const G = astronautGeometry(variant);
  const cube = new THREE.WebGLCubeRenderTarget(VISOR_RES, { generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  cube.texture.colorSpace = THREE.SRGBColorSpace;
  const M = astronautMaterials(env, cube.texture);
  const root = new THREE.Group();
  root.name = "astronaut";
  const bones = {};
  for (const n of BONES) {
    const b = new THREE.Bone();
    b.name = n;
    bones[n] = b;
  }
  for (const n of BONES) {
    if (n === "fingersL") bones.handL.add(bones[n]);
    else if (n === "fingersR") bones.handR.add(bones[n]);
    else if (n === "helmet") bones.torso.add(bones[n]); // the launch suit's bubble rides on the torso
    else root.add(bones[n]);
  }
  bones.fingersL.position.set(...FINGER_ROOT);
  bones.fingersR.position.set(...FINGER_ROOT);
  // bind-pose inverses are identities: every vertex is authored in its bone's own frame
  const skeleton = new THREE.Skeleton(
    BONES.map((n) => bones[n]),
    BONES.map(() => new THREE.Matrix4())
  );
  const meshes = [];
  for (const [mat, geo] of Object.entries(G)) {
    const m = new THREE.SkinnedMesh(geo, M[mat]);
    m.name = `suit-${mat}`;
    m.bind(skeleton, new THREE.Matrix4());
    m.frustumCulled = false;
    m.castShadow = mat !== "visor" && mat !== "decal";
    m.receiveShadow = true;
    root.add(m);
    meshes.push(m);
  }
  const cam = new THREE.CubeCamera(0.04, 800, cube);
  return { root, bones, skeleton, meshes, M, cube, cam, face: 0, first: true, at: new THREE.Vector3(1e9, 0, 0), last: -1e9 };
}

/**
 * variant "eva" (the lunar surface suit, as approved) or "launch" (the pressure suit for launch,
 * COUNTDOWN TO LAUNCH: no backpack, a clear bubble; `env` the scene's own environment map, and
 * stateRef.current.helmetUp 0 locked .. 1 held up above the head).
 */
export default function Astronaut({ stateRef, variant = "eva", env = null }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const launch = variant === "launch";
  const A = useMemo(() => build(env || lunarEnv(gl), variant), [gl, env, variant]);

  useEffect(
    () => () => {
      A.cube.dispose();
      A.skeleton.dispose();
      for (const k of Object.keys(A.M)) if (A.M[k] && A.M[k].dispose) A.M[k].dispose();
    },
    [A]
  );

  /** The helmet's reflection: capture `n` faces of the cube map from the helmet's centre. */
  const capture = (n, clock) => {
    const C = A;
    if (C.cam.coordinateSystem !== gl.coordinateSystem) {
      C.cam.coordinateSystem = gl.coordinateSystem;
      C.cam.updateCoordinateSystem();
    }
    const prevRT = gl.getRenderTarget();
    const prevFace = gl.getActiveCubeFace();
    const prevMip = gl.getActiveMipmapLevel();
    const prevAuto = gl.shadowMap.autoUpdate;
    gl.shadowMap.autoUpdate = false;
    A.root.visible = false;
    for (let k = 0; k < n && C.face < 6; k++, C.face++) {
      gl.setRenderTarget(C.cube, C.face);
      gl.render(scene, C.cam.children[C.face]);
    }
    gl.setRenderTarget(prevRT, prevFace, prevMip);
    gl.shadowMap.autoUpdate = prevAuto;
    A.root.visible = true;
    if (C.face >= 6) {
      C.face = -1;
      C.first = false;
      C.last = clock;
      C.cube.texture.needsPMREMUpdate = true;
    }
  };

  useFrame((state) => {
    const s = stateRef.current;
    const g = A.root;
    if (!s || !s.rig) {
      g.visible = false;
      return;
    }
    g.visible = !s.hidden;
    if (s.hidden) return;
    g.position.set(s.pos[0], s.pos[1], s.pos[2]);
    g.rotation.set(0, s.heading, 0);
    const rig = s.rig;
    const B = A.bones;
    for (const name of SEGMENTS) {
      B[name].position.copy(rig[name].p);
      B[name].quaternion.copy(rig[name].q);
    }
    const grip = rig.grip || [0.35, 0.35];
    B.fingersL.rotation.z = -grip[0] * 1.35;
    B.fingersR.rotation.z = grip[1] * 1.35;
    const sc = B.scoop;
    const on = !!rig.scoop && rig.tool > 0.02;
    if (on) {
      const [hx, hy, hz] = rig.scoop.hold;
      sc.position.set(hx, hy, hz);
      _d.set(rig.scoop.head[0] - hx, rig.scoop.head[1] - hy, rig.scoop.head[2] - hz).normalize();
      sc.quaternion.setFromUnitVectors(_z, _d);
      sc.scale.setScalar(1);
    } else sc.scale.setScalar(HIDE);
    A.M.dust.value = Math.min(1, s.dust || 0);
    if (launch) {
      // the bubble: held over the head by the technician behind, then lowered onto the neck ring
      const up = Math.max(0, Math.min(1, s.helmetUp || 0));
      B.helmet.position.set(0, 0.3 * up, -0.05 * up);
      B.helmet.rotation.set(-0.12 * up, 0, 0);
      return; // a clear bubble: no visor reflection to capture
    }

    // the visor's reflection, from the helmet's centre (world)
    const clock = state.clock.elapsedTime;
    if (A.face < 0 || A.first) {
      g.updateMatrixWorld(true);
      _v.set(BODY.helmet[0], BODY.helmet[1], BODY.helmet[2]).applyMatrix4(B.torso.matrixWorld);
      const moved = _v.distanceTo(A.at) / Math.max(1e-6, g.parent ? g.parent.matrixWorld.getMaxScaleOnAxis() : 1);
      if (A.first || (moved > VISOR_MOVE && clock - A.last > VISOR_EVERY)) {
        A.at.copy(_v);
        A.cam.position.copy(_v);
        A.cam.updateMatrixWorld(true);
        if (A.face < 0) A.face = 0;
      }
    }
    if (A.face >= 0 && (A.first || clock - A.last > VISOR_EVERY || A.face > 0)) capture(A.first ? 6 : 1, clock);
  });

  return <primitive object={A.root} />;
}
