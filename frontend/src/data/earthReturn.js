import { EARTH_RADIUS_KM, MOON_RADIUS_KM } from "./missionPhases";
import { EARTH_UNITS, MOON_UNITS } from "./sceneTrack";

/*
 * The return to Earth, from the ascent stage's jettison to the reentry's EARTH APPROACH
 * (pages/Mission RETURN, drawn by components/MissionScene). Pure data: real seconds t
 * since the return began → the shot, the spacecraft's attitude, its engines and both
 * cameras. Nothing here changes the reentry or any physics.
 *
 * The spacecraft is the CSM that stayed in lunar orbit (SpacecraftStack, the LM gone).
 *
 *   0      TEI PREPARATION   over the Moon, nose retrograde, GO for TEI
 *   4.5    TURN              an RCS slew of 180° about the local vertical, nose prograde
 *   12     IGNITION          the service propulsion system (SPS): thrust along the CSM's
 *                            axis, nose first; the CSM visibly pulls ahead
 *   21     CUTOFF            the engine stops; from here on it never fires again
 *   24.5   TRANSEARTH COAST  engine off; passive thermal control (a slow roll about the
 *                            long axis, broadside to the Sun); the attitude is held, not
 *                            pointed along the path
 *   32.5   EARTH APPROACH    the Earth grows; the roll is stopped and an RCS slew puts the
 *                            nose along the flight path (the attitude the reentry's
 *                            EARTH APPROACH starts in: SM aft, CM nose first), before the
 *                            service module's separation in the reentry
 *   42     → REENTRY
 *
 * Attitude in each shot's vehicle frame (X forward: prograde over the Moon, the flight
 * path near the Earth; Y up; Z = X × Y). yaw turns the CSM's nose about Y (nose
 * direction [cos yaw, 0, -sin yaw]); roll turns it about its own long axis. Every
 * attitude change is a slew with an acceleration, a coast and a deceleration, and the
 * RCS couple fires exactly while the rate changes (yawRcs, rollRcs: -1..1, sign = the
 * torque's). The SPS level is 0 except between IGNITION and CUTOFF.
 */

export const RETURN_SEQ = {
  prep: 0,
  turn: [4.5, 11],
  ignition: 12,
  cutoff: 21,
  coast: 24.5,
  approach: 32.5,
  entryTurn: [34.5, 40],
  end: 42,
};
export const RETURN_LEN = RETURN_SEQ.end;

export const SPS_RAMP = { up: 0.35, down: 0.3 }; // s: the engine's start and tail-off
export const BURN_ACCEL = 0.32; // m/s², the CSM pulling ahead of its orbit in the shot (time-compressed)
export const SLEW_RAMP = 1.2; // s of RCS firing to start and to stop a slew
export const PTC_YAW = 0.6; // rad: the coast attitude, the long axis broadside to the Sun (34° off the path)
export const PTC_RATE = 0.16; // rad/s: the passive thermal control roll (time-compressed)
export const ROLL_STOP = 1.6; // s: the RCS stops the roll at the start of the entry slew
export const TEI_ALT_KM = 110;
export const TEI_OMEGA = 0.0032; // rad/s, the orbit's drift under the shot (time-compressed)
export const PERIGEE_KM = EARTH_RADIUS_KM + 65; // the flight path skims the top of the atmosphere

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
const smooth = (x) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

/**
 * A slew from `from` to `to` between t0 and t1: constant angular acceleration for `ramp`
 * seconds, a constant rate, then the same deceleration. { angle, rate, torque } where
 * torque is -1, 0 or +1 (the RCS couple's sign while it fires).
 */
export function slew(t, t0, t1, from, to, ramp = SLEW_RAMP) {
  const T = t1 - t0;
  const r = Math.min(ramp, T / 2);
  const d = to - from;
  const s = Math.sign(d) || 1;
  const w = d / (T - r); // the coasting rate
  const a = w / r;
  if (t <= t0) return { angle: from, rate: 0, torque: 0 };
  if (t >= t1) return { angle: to, rate: 0, torque: 0 };
  const x = t - t0;
  if (x < r) return { angle: from + 0.5 * a * x * x, rate: a * x, torque: s };
  if (x <= T - r) return { angle: from + 0.5 * a * r * r + w * (x - r), rate: w, torque: 0 };
  const y = T - x;
  return { angle: to - 0.5 * a * y * y, rate: a * y, torque: -s };
}

/** The SPS engine's level (0..1): on only between IGNITION and CUTOFF (with its start and tail-off). */
export function spsLevel(t) {
  const { ignition, cutoff } = RETURN_SEQ;
  if (t < ignition || t >= cutoff + SPS_RAMP.down) return 0;
  if (t < cutoff) return Math.min(1, (t - ignition) / SPS_RAMP.up);
  return 1 - (t - cutoff) / SPS_RAMP.down;
}

/** The CSM's forward displacement in the TEI shot (m along +X): it pulls ahead under thrust, then coasts. */
export function burnOffset(t) {
  const { ignition, cutoff } = RETURN_SEQ;
  if (t <= ignition) return 0;
  const Tb = cutoff - ignition;
  if (t <= cutoff) return 0.5 * BURN_ACCEL * (t - ignition) ** 2;
  return 0.5 * BURN_ACCEL * Tb * Tb + BURN_ACCEL * Tb * (t - cutoff);
}

/** The shot at return time t, with its progress u (0..1), and the step being shown. */
export function returnShotAt(t) {
  const S = RETURN_SEQ;
  let shot;
  let t0;
  let t1;
  if (t < S.coast) [shot, t0, t1] = ["tei", 0, S.coast];
  else if (t < S.approach) [shot, t0, t1] = ["coast", S.coast, S.approach];
  else [shot, t0, t1] = ["approach", S.approach, S.end];
  let step;
  if (t < S.turn[0]) step = "teiPrep";
  else if (t < S.ignition) step = "teiTurn";
  else if (t < S.cutoff) step = "teiBurn";
  else if (t < S.coast) step = "teiCutoff";
  else if (t < S.approach) step = "coast";
  else if (t < S.entryTurn[0]) step = "approach";
  else step = "entryAttitude";
  return { shot, step, u: clamp01((t - t0) / (t1 - t0)) };
}

/**
 * The CSM's attitude and engines at return time t: { yaw, roll, rate, sps, yawRcs, rollRcs, x }
 * (x: the TEI shot's forward displacement, m).
 */
export function returnState(t) {
  const S = RETURN_SEQ;
  const out = { yaw: 0, roll: 0, sps: spsLevel(t), yawRcs: 0, rollRcs: 0, x: 0 };
  if (t < S.coast) {
    // TEI: nose retrograde, a 180° slew to prograde, then the burn along the axis.
    const y = slew(t, S.turn[0], S.turn[1], Math.PI, 0);
    out.yaw = y.angle;
    out.yawRcs = y.torque;
    out.x = burnOffset(t);
    return out;
  }
  // Coast and approach: passive thermal control, then the entry slew.
  const [e0, e1] = S.entryTurn;
  const rollT = Math.min(t, e0) - S.coast;
  let roll = PTC_RATE * rollT;
  if (t > e0) {
    // the RCS stops the roll: a constant deceleration over ROLL_STOP seconds
    const x = Math.min(t - e0, ROLL_STOP);
    roll += PTC_RATE * x - (0.5 * PTC_RATE * x * x) / ROLL_STOP;
    if (t - e0 < ROLL_STOP) out.rollRcs = -1;
  }
  out.roll = roll;
  const y = slew(t, e0, e1, PTC_YAW, 0);
  out.yaw = y.angle;
  out.yawRcs = y.torque;
  return out;
}

/* ---- frames: the shot's vehicle frame (unit axes in world/scene space) and origin ---- */

/** A right-handed frame with X along `fwd` and Y as close as possible to `upHint`. */
export function frameAlong(fwd, upHint) {
  const x = norm(fwd);
  const u = dot(upHint, x);
  const y = norm([upHint[0] - u * x[0], upHint[1] - u * x[1], upHint[2] - u * x[2]]);
  return { x, y, z: cross(x, y) };
}
export const toWorld = (F, v) => [F.x[0] * v[0] + F.y[0] * v[1] + F.z[0] * v[2], F.x[1] * v[0] + F.y[1] * v[1] + F.z[1] * v[2], F.x[2] * v[0] + F.y[2] * v[1] + F.z[2] * v[2]];
export const toVehicle = (F, w) => [dot(F.x, w), dot(F.y, w), dot(F.z, w)];

/** Where a planet of drawn radius R stands so that it looks as it does from distanceKm (its radius radiusKm). */
export const trueSize = (R, distanceKm, radiusKm) => (R * distanceKm) / radiusKm;

// The TEI orbit over the sunlit Moon: the angle (about the orbit normal, world +Y) of the
// spacecraft round the Moon, from the scene's Sun direction.
export const TEI_SUN_OFFSET = 0.62; // rad past the subsolar point: a low Sun, long shadows

/**
 * The TEI shot's frame at t: the CSM in a 110 km circular orbit over the Moon (centre
 * moonPos, scene units), X prograde, Y radially out, Z = X × Y; the frame advances along
 * the orbit (the ground drifts aft under the shot).
 */
export function teiFrame(t, moonPos, sunDir) {
  const th0 = Math.atan2(sunDir[2], sunDir[0]) + TEI_SUN_OFFSET;
  const th = th0 - TEI_OMEGA * t;
  const up = [Math.cos(th), 0, Math.sin(th)];
  const pro = [Math.sin(th), 0, -Math.cos(th)]; // d(up)/d(-theta): prograde, as theta falls
  const d = trueSize(MOON_UNITS, MOON_RADIUS_KM + TEI_ALT_KM, MOON_RADIUS_KM);
  return { frame: frameAlong(pro, up), origin: [moonPos[0] + up[0] * d, moonPos[1], moonPos[2] + up[2] * d] };
}

// The direction from the Earth to the incoming spacecraft (scene, about the Earth at the origin),
// chosen so the approach sees a sunlit, gibbous Earth and the Sun is on the shots' camera
// side (-Z), as over the Moon: the CSM flies screen-left in every shot home, as in the reentry.
export const EARTH_APPROACH_FROM = -0.95; // rad from the Sun's direction, about world +Y

/** Distance from the Earth's centre (km) at return time t (coast and approach shots). */
export function earthDistanceKm(t) {
  const S = RETURN_SEQ;
  if (t < S.approach) return 262000 - (262000 - 188000) * clamp01((t - S.coast) / (S.approach - S.coast));
  // the approach: the last 70,000 km, faster as the Earth pulls
  const u = clamp01((t - S.approach) / (S.end - S.approach));
  return 70000 - (70000 - 21000) * (1 - (1 - u) * (1 - u * 0.35));
}

/**
 * The coast's and the approach's frame at t: X along the flight path (aimed to skim the
 * Earth at PERIGEE_KM, the Earth's centre below the path), Y up, and the origin at the
 * spacecraft's true distance for the Earth's drawn size.
 */
export function earthFrame(t, sunDir) {
  const a = Math.atan2(sunDir[2], sunDir[0]) + EARTH_APPROACH_FROM;
  const u = [Math.cos(a), 0, Math.sin(a)]; // Earth → spacecraft
  const D = earthDistanceKm(t);
  const along = Math.sqrt(Math.max(0, D * D - PERIGEE_KM * PERIGEE_KM));
  const path = norm([-u[0] * along, PERIGEE_KM, -u[2] * along]); // the Earth's centre lies below the path
  const d = trueSize(EARTH_UNITS, D, EARTH_RADIUS_KM);
  return { frame: frameAlong(path, [0, 1, 0]), origin: [u[0] * d, 0, u[2] * d], distanceKm: D };
}

/* ---- cameras (metres, the shot's vehicle frame) -------------------------------------------- */
// On the sunlit side (-Z here), above and a little behind: the Moon's horizon beyond.
const TEI_CAM = {
  a: { pos: [-7, 6.5, -21], look: [0.5, -1.6, 0] },
  b: { pos: [-5, 5.2, -18], look: [1.5, -1.2, 0] },
};
export function returnCamera(t) {
  const S = RETURN_SEQ;
  const { shot, u } = returnShotAt(t);
  if (shot === "tei") {
    // A slow push in over the preparation and the turn; through the burn the camera keeps
    // its place in the orbit while the CSM pulls ahead (look follows, position lags).
    const x = burnOffset(t);
    const p = lerp(TEI_CAM.a.pos, TEI_CAM.b.pos, smooth(t / S.ignition));
    const l = lerp(TEI_CAM.a.look, TEI_CAM.b.look, smooth(t / S.ignition));
    return { pos: [p[0] + 0.55 * x, p[1], p[2]], look: [l[0] + 0.85 * x, l[1], l[2]] };
  }
  if (shot === "coast") {
    // From the sunlit side, a little behind: the Earth small ahead, beyond the CSM.
    return { pos: lerp([-14, 3.4, -10], [-13, 3.1, -9.2], u), look: [8, -0.8, 1.5] };
  }
  // The approach: from the sunlit side, the Earth ahead and below; a slow drift in.
  return { pos: lerp([-14, 3.2, -9.4], [-12.6, 2.8, -8.4], smooth(u)), look: [10, -2.2, 2] };
}

/* ---- the mission clock and the captions --------------------------------------------------- */
const CLOCK = [
  [0, 503250],
  [RETURN_SEQ.ignition, 504000], // TEI at T+140:00:00
  [RETURN_SEQ.cutoff, 504150], // a 2 min 30 s burn
  [RETURN_SEQ.coast, 504600],
  [RETURN_SEQ.approach, 668000],
  [RETURN_SEQ.end, 695000], // entry interface, T+193 h
];
/** Mission seconds (the HUD clock) at return time t. */
export function returnMissionTime(t) {
  if (t <= 0) return CLOCK[0][1];
  for (let i = 1; i < CLOCK.length; i++) {
    const [ta, ma] = CLOCK[i - 1];
    const [tb, mb] = CLOCK[i];
    if (t <= tb) return ma + ((t - ta) / (tb - ta)) * (mb - ma);
  }
  return CLOCK[CLOCK.length - 1][1];
}

export const RETURN_CAPTIONS = {
  teiPrep: { kicker: "TRANS-EARTH INJECTION", title: "LEAVING LUNAR ORBIT", sub: "THE SAME CSM · THE CREW ABOARD · GO FOR TEI" },
  teiTurn: { kicker: "TRANS-EARTH INJECTION", title: "MANEUVER TO BURN ATTITUDE", sub: "RCS · NOSE PROGRADE, SERVICE PROPULSION ENGINE AFT" },
  teiBurn: { kicker: "TRANS-EARTH INJECTION", title: "TEI BURN", sub: "SERVICE PROPULSION SYSTEM · THRUST ALONG THE AXIS · Δv 1,000 m/s" },
  teiCutoff: { kicker: "TRANS-EARTH INJECTION", title: "ENGINE CUTOFF", sub: "ON COURSE FOR EARTH · NO MORE BURNS NEEDED" },
  coast: { kicker: "TRANSEARTH COAST", title: "COASTING HOME", sub: "ENGINE OFF · PASSIVE THERMAL CONTROL ROLL · ATTITUDE HELD" },
  approach: { kicker: "EARTH APPROACH", title: "EARTH APPROACH", sub: "11 KM/S AND RISING · ENTRY INTERFACE IN 30 MIN" },
  entryAttitude: { kicker: "EARTH APPROACH", title: "ENTRY ATTITUDE", sub: "RCS · ROLL STOPPED · NOSE ALONG THE FLIGHT PATH · SM SEPARATION NEXT" },
};

/** Mission Control's calls on the way home (data line ids, audio/commsLines.json), at return time t. */
export const RETURN_CUES = [
  { t: 0.8, line: "return.goTei" },
  { t: RETURN_SEQ.turn[0], sound: "hiss", dur: 1.0, vol: 0.06 },
  { t: RETURN_SEQ.turn[1] - SLEW_RAMP, sound: "hiss", dur: 1.0, vol: 0.06 },
  { t: RETURN_SEQ.ignition - 0.05, line: "return.teiIgnition" },
  { t: RETURN_SEQ.ignition, sound: "thud", vol: 0.32 },
  { t: RETURN_SEQ.ignition, sound: "burn" },
  { t: RETURN_SEQ.cutoff, sound: "burnStop" },
  { t: RETURN_SEQ.cutoff + 0.1, line: "return.teiCutoff" },
  { t: RETURN_SEQ.coast + 1.2, line: "return.coast" },
  { t: RETURN_SEQ.entryTurn[0], sound: "hiss", dur: 1.4, vol: 0.06 },
  { t: RETURN_SEQ.entryTurn[1] - SLEW_RAMP, sound: "hiss", dur: 1.0, vol: 0.06 },
];

/* ---- the service module's separation (the reentry's ENTRY PREP, components/scenes/ReentryScene) ---- */
/*
 * Capsule units (1 = the CM's 3.9 m diameter), the SM's own frame (+Y towards the CM). The SM
 * backs away along its own axis, behind the CM that flies on, drifting a little down and away
 * from the camera; faster as the shot compresses the minutes after separation. The CM starts its
 * turn to the entry attitude (heat shield forward) once the SM is clear.
 */
export const SM_SEP = { back: 0.32, backAccel: 0.12, down: 0.04, away: 0.08, gone: 11.5 };
export const ATTITUDE_TURN = { after: 2.2, len: 3.2 }; // s after separation, s
export const SEP_LONG_AGO = 12; // sepT for a start or a retry long after the separation (the SM gone)
/** The separated service module's offset (its own frame, capsule units) sepT seconds after separation. */
export function smOffset(sepT, out = [0, 0, 0]) {
  const t = Math.max(0, sepT);
  out[0] = -SM_SEP.down * t;
  out[1] = -(SM_SEP.back * t + SM_SEP.backAccel * t * t);
  out[2] = -SM_SEP.away * t;
  return out;
}

export const _test = { norm, cross, dot };
