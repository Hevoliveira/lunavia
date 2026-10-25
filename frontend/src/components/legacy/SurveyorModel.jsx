import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SURVEYOR, cameraLocal, surveyorLegs } from "@/data/surveyor";
import { WORLD_X } from "@/data/touchdownFx";
import { buildTerrain } from "@/data/terrainMesh";
import { toWorld } from "@/data/astronautRig";

/**
 * Surveyor 3 as Apollo 12 found it (APOLLO LEGACY): the triangular aluminium spaceframe on three
 * shock-absorbing legs with crushable footpads, the central mast with the solar panel and the flat
 * planar-array antenna, the two insulated electronics compartments, the three vernier engines, the
 * surface sampler's arm and scoop, and the television camera under its mirror hood (data/surveyor:
 * proportions in metres). Its white paint is drawn tan, as the crew found it. A few merged meshes.
 *
 * The camera is its own mesh so the EVA can remove it from the frame once it is retrieved.
 */
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const tube = (a, b, r, seg = 6) => {
  const A = V(a);
  const B = V(b);
  const g = new THREE.CylinderGeometry(r, r, A.distanceTo(B), seg, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
  return g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
};
const box = (w, h, d, x, y, z, ry = 0, rx = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  return g.translate(x, y, z);
};
const merge = (list) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => {
  const o = new THREE.BufferGeometry();
  o.setAttribute("position", g.attributes.position);
  if (!g.attributes.normal) g.computeVertexNormals();
  o.setAttribute("normal", g.attributes.normal);
  return o;
}));

function buildSurveyor(S = SURVEYOR) {
  const frame = []; // aluminium tubes and fittings
  const white = []; // thermal compartments and antenna (dust-tan)
  const dark = []; // solar cells, nozzles, the mirror's shadow side
  const pads = []; // footpads (crushable honeycomb)
  const legs = surveyorLegs(S);
  const corners = legs.map((l) => l.hip);
  const mastBase = [0, S.frameY - 0.05, 0];
  const mastTop = [0, S.mastTop, 0];
  // the base triangle and the tetrahedral struts up to the mast
  for (let i = 0; i < 3; i++) {
    frame.push(tube(corners[i], corners[(i + 1) % 3], 0.035));
    frame.push(tube(corners[i], [0, 1.55, 0], 0.028));
    frame.push(tube(corners[i], mastBase, 0.03));
  }
  frame.push(tube(mastBase, mastTop, 0.045, 8));
  // the legs: the main member and its shock absorber down to the footpad, a diagonal brace
  for (const l of legs) {
    const c = Math.cos(l.az * (Math.PI / 180));
    const s = Math.sin(l.az * (Math.PI / 180));
    const knee = [c * (S.padR - 0.18), 0.32, s * (S.padR - 0.18)];
    frame.push(tube(l.hip, knee, 0.04, 8));
    frame.push(tube([l.hip[0] * 0.95, l.hip[1] + 0.25, l.hip[2] * 0.95], [c * 1.5, 0.45, s * 1.5], 0.05, 8)); // shock absorber
    frame.push(tube(knee, l.pad, 0.035));
    // the brace from the neighbouring corner
    const side = [-s * 0.42 + c * S.frameR, S.frameY - 0.04, c * 0.42 + s * S.frameR];
    frame.push(tube(side, knee, 0.022));
    pads.push(new THREE.CylinderGeometry(S.padSize, S.padSize * 0.85, 0.12, 14).translate(l.pad[0], l.pad[1], l.pad[2]));
  }
  // compartment A (electronics) and B (batteries), on the frame between the legs
  for (const [az, w] of [[150, 0.56], [270, 0.5]]) {
    const c = Math.cos(az * (Math.PI / 180));
    const s = Math.sin(az * (Math.PI / 180));
    const g = box(w, 0.38, 0.36, c * 0.6, 1.02, s * 0.6, -az * (Math.PI / 180) + Math.PI / 2);
    white.push(g);
    frame.push(box(w + 0.04, 0.04, 0.4, c * 0.6, 0.82, s * 0.6, -az * (Math.PI / 180) + Math.PI / 2));
  }
  // the three vernier engines under the frame
  for (const l of legs) {
    const p = [l.hip[0] * 0.55, S.frameY - 0.14, l.hip[2] * 0.55];
    dark.push(new THREE.CylinderGeometry(0.05, 0.085, 0.18, 10).translate(p[0], p[1], p[2]));
  }
  // the solar panel and the planar antenna on the mast's positioner
  dark.push(box(0.98, 0.025, 0.86, 0.12, S.mastTop + 0.32, -0.2, 0.3, -0.55));
  white.push(box(0.92, 0.03, 0.92, -0.1, S.mastTop + 0.2, 0.36, -0.4, 0.62));
  frame.push(tube([0, S.mastTop, 0], [0.1, S.mastTop + 0.28, -0.18], 0.025));
  frame.push(tube([0, S.mastTop, 0], [-0.08, S.mastTop + 0.18, 0.3], 0.025));
  // two small omni antennas on booms
  frame.push(tube([0, 1.55, 0], [0.55, 2.2, -0.55], 0.012, 4));
  frame.push(tube([0, 1.55, 0], [-0.6, 2.1, -0.4], 0.012, 4));
  // the surface sampler: arm folded along the frame, its scoop at the end
  const sa = 90 * (Math.PI / 180);
  const sc = Math.cos(sa + 0.55);
  const ss = Math.sin(sa + 0.55);
  frame.push(tube([sc * 0.55, 0.95, ss * 0.55], [sc * 1.25, 0.72, ss * 1.25], 0.03));
  white.push(box(0.14, 0.1, 0.2, sc * 1.32, 0.66, ss * 1.32, -(sa + 0.55)));
  // the television camera's mount (the camera itself is a separate mesh)
  const cam = cameraLocal(S);
  frame.push(tube([cam[0] * 0.55, S.camera.y - 0.05, cam[2] * 0.55], [cam[0], S.camera.y, cam[2]], 0.03));
  return { frame: merge(frame), white: merge(white), dark: merge(dark), pads: merge(pads) };
}

function buildCamera(S = SURVEYOR) {
  const body = new THREE.CylinderGeometry(S.camera.radius, S.camera.radius, S.camera.h, 14).translate(0, 0, 0);
  // the mirror assembly's hood on top, tilted towards the ground in front
  const hood = new THREE.CylinderGeometry(S.camera.radius * 0.95, S.camera.radius * 1.1, 0.16, 14).rotateZ(0.5).translate(0.04, S.camera.h / 2 + 0.06, 0);
  const lens = new THREE.CylinderGeometry(0.055, 0.055, 0.04, 10).rotateZ(Math.PI / 2).translate(S.camera.radius + 0.07, S.camera.h / 2 + 0.07, 0);
  return { white: merge([body, hood]), dark: merge([lens]) };
}

export const SURVEYOR_MATS = () => ({
  frame: new THREE.MeshStandardMaterial({ color: "#b9b1a0", roughness: 0.42, metalness: 0.75 }),
  white: new THREE.MeshStandardMaterial({ color: "#d3c5a4", roughness: 0.8, metalness: 0.05 }),
  dark: new THREE.MeshStandardMaterial({ color: "#1f2430", roughness: 0.35, metalness: 0.4 }),
  pads: new THREE.MeshStandardMaterial({ color: "#a59c88", roughness: 0.85, metalness: 0.3 }),
});

/** The camera alone (for the astronaut's hand once retrieved), in metres, its base at the origin. */
export function SurveyorCamera({ mats }) {
  const g = useMemo(() => buildCamera(), []);
  return (
    <group>
      <mesh geometry={g.white} material={mats.white} castShadow />
      <mesh geometry={g.dark} material={mats.dark} />
    </group>
  );
}

/** The probe in metres (a group scaled by the caller): `cameraOn` false once retrieved. */
export function SurveyorModel({ cameraOn = true, mats }) {
  const g = useMemo(() => buildSurveyor(), []);
  const cam = cameraLocal();
  return (
    <group>
      <mesh geometry={g.frame} material={mats.frame} castShadow receiveShadow />
      <mesh geometry={g.white} material={mats.white} castShadow receiveShadow />
      <mesh geometry={g.dark} material={mats.dark} castShadow />
      <mesh geometry={g.pads} material={mats.pads} castShadow receiveShadow />
      {cameraOn && (
        <group position={cam} rotation={[0, -SURVEYOR.cameraAz * (Math.PI / 180), 0]}>
          <SurveyorCamera mats={mats} />
        </group>
      )}
    </group>
  );
}

/**
 * The site's fixed historical objects (Surveyor 3 at Apollo Legacy's Ocean of Storms), on the
 * drawn terrain (scene units: WORLD_X per metre, the site's vertical scale). Nothing on official
 * sites (they have none). `retrieved`: the parts already taken (ids), so the camera is gone.
 */
export function SiteObjects({ site, retrieved = [] }) {
  const mats = useMemo(() => SURVEYOR_MATS(), []);
  const placed = useMemo(() => {
    const terrain = buildTerrain(site);
    return (site.objects || [])
      .filter((o) => o.kind === "surveyor")
      .map((o) => {
        // sit on the slope: tilt the probe to the ground's mean plane under its three pads
        const g = (x, z) => terrain.lookup(x, z);
        const e = 1.5;
        const gx = (g(o.x + e, o.z) - g(o.x - e, o.z)) / (2 * e);
        const gz = (g(o.x, o.z + e) - g(o.x, o.z - e)) / (2 * e);
        const n = new THREE.Vector3(-gx, 1, -gz).normalize();
        const tilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
        const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -(o.heading || 0) * (Math.PI / 180));
        return { o, pos: [o.x * WORLD_X, site.scale.y(g(o.x, o.z)) - 0.02, o.z * WORLD_X], q: tilt.multiply(yaw) };
      });
  }, [site]);
  if (!placed.length) return null;
  return (
    <>
      {placed.map(({ o, pos, q }) => (
        <group key={o.id} position={pos} quaternion={q} scale={WORLD_X}>
          <SurveyorModel mats={mats} cameraOn={!retrieved.includes("TV-CAMERA")} />
        </group>
      ))}
    </>
  );
}

/**
 * The retrieved part in the astronaut's right glove (the EVA's metre frame), from the moment it is
 * freed until the hatch closes; hidden with the body (the photo mode's chest camera).
 */
const _q = new THREE.Quaternion();
const _y = new THREE.Vector3(0, 1, 0);
export function CarriedPart({ sim }) {
  const mats = useMemo(() => SURVEYOR_MATS(), []);
  const g = useRef();
  useFrame(() => {
    const o = g.current;
    if (!o) return;
    const a = sim.astro;
    const held = sim.retrieved.length > 0 || !!(sim.retrieveAct && sim.retrieveAct.grabbed);
    const hand = a && a.rig && a.rig.handR;
    o.visible = !!(held && hand && !a.hidden);
    if (!o.visible) return;
    const p = toWorld(a.pos, a.heading, [hand.p.x, hand.p.y, hand.p.z]);
    _q.setFromAxisAngle(_y, a.heading).multiply(hand.q);
    o.position.set(p[0], p[1], p[2]);
    o.quaternion.copy(_q);
  });
  return (
    <group ref={g} visible={false}>
      {/* hanging from the glove by its handle */}
      <group position={[0, -SURVEYOR.camera.h * 0.55, 0.06]} rotation={[0.25, 0, 0]}>
        <SurveyorCamera mats={mats} />
      </group>
    </group>
  );
}
