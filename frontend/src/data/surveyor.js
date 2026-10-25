/*
 * LUNAVIA — Surveyor 3, as Apollo 12 found it (pure; unit-tested). Apollo Legacy only.
 *
 * Surveyor 3 (NASA, landed 20 April 1967 in the Ocean of Storms) was a three-legged robotic lander
 * about 3 m tall: a triangular aluminium spaceframe on three shock-absorbing legs with crushable
 * footpads (their tips on a circle about 4.3 m across), a central mast carrying the solar panel and
 * the flat planar-array high-gain antenna, two insulated electronics compartments, three vernier
 * engines under the frame, a surface sampler (a scoop on an extendable arm) and a slow-scan
 * television camera looking down into a movable mirror. On 20 November 1969 Apollo 12's crew walked
 * to it on the inner slope of what is now called Surveyor crater and brought back parts of it,
 * among them the television camera, for engineers to study how 31 months on the Moon had affected
 * them. (NASA: Apollo 12 Mission Report; Surveyor III Mission Report; NSSDCA 1967-035A.)
 *
 * This is LUNAVIA's representation for a game: the proportions and the parts named above, in
 * metres, not an engineering model. Local frame: +Y up, the mast on the axis; legs at LEG_AZ
 * (degrees from +X towards +Z); the camera between two legs, at CAMERA_AZ.
 */
const DEG = Math.PI / 180;

export const SURVEYOR = Object.freeze({
  height: 3.0, // m, footpads to the top of the mast
  padR: 2.15, // m, footpad centres from the axis (tips on a ~4.3 m circle)
  padSize: 0.3, // m, footpad radius
  frameR: 0.78, // m, the base triangle's corners from the axis
  frameY: 0.62, // m, height of the base triangle
  mastTop: 2.55, // m, the top of the mast (the panel and antenna above it)
  legAz: [90, 210, 330], // deg
  cameraAz: 30, // deg, between the legs at 330° and 90°
  camera: { r: 0.72, y: 1.12, h: 0.62, radius: 0.12 }, // the television camera (body and mirror hood)
  bodyR: 1.0, // m, the walk-around collider of the frame and compartments
});

/** The legs and footpads in the local frame: [{ az, hip [x,y,z], pad [x,y,z] }]. */
export function surveyorLegs(S = SURVEYOR) {
  return S.legAz.map((az) => {
    const c = Math.cos(az * DEG);
    const s = Math.sin(az * DEG);
    return { az, hip: [c * S.frameR, S.frameY, s * S.frameR], pad: [c * S.padR, 0.08, s * S.padR] };
  });
}

/** The television camera's centre in the local frame. */
export function cameraLocal(S = SURVEYOR) {
  const c = Math.cos(S.cameraAz * DEG);
  const s = Math.sin(S.cameraAz * DEG);
  return [c * S.camera.r, S.camera.y + S.camera.h / 2, s * S.camera.r];
}

/**
 * The probe placed on the ground: obj { x, z, heading (deg: the local frame's +X turned by this,
 * towards +Z), y (the ground at the axis) }. Returns a local→world point function (no tilt in
 * plan: the crater slope's tilt is drawn, but a few degrees change nothing the EVA uses).
 */
export function surveyorToWorld(obj) {
  const h = (obj.heading || 0) * DEG;
  const ch = Math.cos(h);
  const sh = Math.sin(h);
  return ([lx, ly, lz]) => [obj.x + lx * ch - lz * sh, (obj.y || 0) + ly, obj.z + lx * sh + lz * ch];
}

/** Where things are, in the world (m): the camera, the footpads, and a stand point by the camera. */
export function surveyorPlaces(obj, S = SURVEYOR) {
  const W = surveyorToWorld(obj);
  const cam = W(cameraLocal(S));
  const pads = surveyorLegs(S).map((l) => W(l.pad));
  // the astronaut stands outboard of the camera, facing it
  const away = [cam[0] - obj.x, cam[2] - obj.z];
  const L = Math.hypot(away[0], away[1]) || 1;
  const reach = 0.95;
  const stand = [cam[0] + (away[0] / L) * reach, cam[2] + (away[1] / L) * reach];
  return { camera: cam, pads, stand, top: (obj.y || 0) + S.height };
}

/**
 * The probe's colliders for the EVA (data/evaSim colliders): its frame and compartments as one
 * circle, each leg as a capsule from the frame to the footpad, each footpad as a small circle.
 */
export function surveyorColliders(obj, S = SURVEYOR) {
  const W = surveyorToWorld(obj);
  const circles = [{ x: obj.x, z: obj.z, r: S.bodyR, kind: "object" }];
  const capsules = [];
  for (const l of surveyorLegs(S)) {
    const a = W(l.hip);
    const b = W(l.pad);
    capsules.push({ ax: a[0], az: a[2], bx: b[0], bz: b[2], r: 0.16, kind: "objectLeg" });
    circles.push({ x: b[0], z: b[2], r: S.padSize, kind: "objectPad" });
  }
  return { circles, capsules };
}
