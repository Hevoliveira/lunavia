/*
 * LUNAVIA — touchdown presentation for the final metres of the lunar descent
 * (pure, unit-tested).
 *
 * Everything here READS the authoritative descent state (data/landerSim) and
 * turns it into what is drawn and heard: the scene's vertical scale, the
 * regolith sheet blown out by the descent engine, the contact probes and
 * CONTACT LIGHT, the legs meeting the surface, the settle after touchdown and
 * the camera shot that follows. Nothing here decides the outcome: touchdown is
 * captured, graded and scored by landerSim / landingPhysics / landingSites,
 * and the settle only plays out the graded result.
 *
 * Units: sim metres in, scene units out.
 */

const DEG = Math.PI / 180;

/* ---- scene scale ---------------------------------------------------------- */
// Horizontal: 0.5 scene units per metre, everywhere.
export const WORLD_X = 0.5;
// Vertical, near the ground: the SAME 0.5 unit/m, so slopes, rocks, craters
// and the LM itself are drawn in their true proportions (a 12° slope looks
// like 12°, a 2 m boulder is as tall as it is wide). High above the ground
// the scene draws 0.05 unit/m, which keeps the whole descent and the landing
// zone in frame; a smooth blend joins the two.
export const SURFACE_SCALE = WORLD_X;
export const ALT_SCALE = 0.05;
export const NEAR_H = 15; // m, depth of the blend above the true-scale band
export const NEAR_GAIN = (SURFACE_SCALE - ALT_SCALE) * NEAR_H; // scene units the blend adds
export const BAND_MIN = 3; // m: the final metres are always drawn at true scale

/**
 * Vertical scale for a landing site whose terrain near the flight path rises
 * to `bandTop` metres above the landing-zone datum. Everything from the
 * lowest crater floor up to bandTop is drawn at true scale; above it the
 * scale blends to 0.05 unit/m. One function of HEIGHT (not of height above
 * the ground), so the LM never bobs as terrain passes beneath it, and the LM
 * and the ground it touches always share one scale.
 */
export function verticalScale(bandTop = BAND_MIN) {
  const top = Math.max(BAND_MIN, bandTop);
  const y = (m) => {
    if (m <= top) return SURFACE_SCALE * m;
    const u = m - top;
    return SURFACE_SCALE * top + ALT_SCALE * u + NEAR_GAIN * (1 - Math.exp(-u / NEAR_H));
  };
  const rate = (m) => (m <= top ? SURFACE_SCALE : ALT_SCALE + (NEAR_GAIN / NEAR_H) * Math.exp(-(m - top) / NEAR_H));
  return { top, y, rate };
}

const FLAT = verticalScale();
/** Scene height (units) of the footpad plane at altitude alt (m) over flat ground at the datum. */
export const sceneAlt = (alt) => FLAT.y(Math.max(0, alt));
/** Scene units per metre at altitude alt (m) over flat ground. */
export const sceneAltRate = (alt) => FLAT.rate(Math.max(0, alt));

/* ---- the lander as drawn (LanderModel at scale 2.4) ------------------------ */
// True size: 7 m from footpads to antenna, footpads 4.3 m from the axis.
export const LM = {
  scale: 2.4,
  foot: 0.88, // model origin to footpad bottom, scene units
  height: 3.5, // footpad to antenna, scene units (7 m)
  padRadius: 2.16, // footpad centres from the vertical axis, scene units (4.3 m)
  padSize: 0.276, // footpad radius, scene units (0.55 m)
  // Legs at +X, +Z (front, ladder), -X, -Z. The front leg carries no probe (as on the LM).
  legAngles: [0, 90, 180, 270],
  probes: [true, false, true, true],
  stroke: 0.18, // primary-strut stroke, scene units (0.36 m, honeycomb crush cartridges)
  crush: 0.14, // extra collapse when a strut bottoms out in a crash
  nozzle: 0.44, // nozzle exit above the footpad plane, scene units (0.88 m)
};

/** Footpad centres in the body frame, [x, z] scene units. */
export const padOffsets = () => LM.legAngles.map((a) => [LM.padRadius * Math.cos(a * DEG), LM.padRadius * Math.sin(a * DEG)]);

/* ---- contact probes and CONTACT LIGHT ------------------------------------ */
// The LM's probes reached 1.73 m below the footpads; when one touched the
// surface the CONTACT LIGHT came on and the crew shut the engine down.
export const PROBE_ALT = 1.7;
/** Probe length in scene units: its tip touches the ground exactly at PROBE_ALT. */
export const PROBE_LENGTH = sceneAlt(PROBE_ALT);
/** CONTACT LIGHT: on from first probe contact, and it stays on after touchdown. */
export const contactLit = (alt, landed = false) => landed || alt <= PROBE_ALT;

/** Bend of a probe (radians from hanging straight down) whose root is h units above the ground. */
export function probeBend(h) {
  if (h >= PROBE_LENGTH) return 0;
  return Math.acos(Math.max(0, h) / PROBE_LENGTH);
}

/* ---- legs on the ground --------------------------------------------------- */
/**
 * Footpad heights above the ground for a footpad plane H scene units above the
 * reference on the axis, an attitude of tilt (bank about Z, +tilt lowers the
 * +X side) and pitch (about X, +pitch lowers the +Z side) degrees, and the
 * ground under each pad `ground[k]` units above that reference (flat: 0).
 */
export function padHeights(H, tilt, pitch = 0, ground = null) {
  const st = Math.sin(tilt * DEG);
  const sp = Math.sin(pitch * DEG);
  return padOffsets().map(([x, z], k) => H - x * st - z * sp - (ground ? ground[k] : 0));
}

/**
 * Leg contact: a pad that would go below the ground compresses its strut
 * instead; past the stroke the whole LM rides up on it. Returns the per-leg
 * compression and the lift applied to the body (scene units).
 */
export function legContact(H, tilt, pitch = 0, ground = null, maxComp = LM.stroke) {
  const pen = padHeights(H, tilt, pitch, ground).map((h) => -h);
  const lift = Math.max(0, Math.max(...pen) - maxComp);
  return { comp: pen.map((p) => Math.min(maxComp, Math.max(0, p - lift))), lift };
}

/**
 * The ground plane under the four footpads (scene heights G[k]): its mean
 * height, the attitude an LM resting on it has (tilt, pitch, degrees) and
 * what is left over per pad (uneven ground the struts take up).
 */
export function groundPlane(G) {
  const R = LM.padRadius;
  const mean = (G[0] + G[1] + G[2] + G[3]) / 4;
  const bx = (G[0] - G[2]) / (2 * R); // rise towards +X
  const bz = (G[1] - G[3]) / (2 * R); // rise towards +Z
  const res = padOffsets().map(([x, z], k) => G[k] - mean - bx * x - bz * z);
  return { mean, tilt: -Math.atan(bx) / DEG, pitch: -Math.atan(bz) / DEG, res };
}

/* ---- regolith sheet --------------------------------------------------------- */
// In vacuum the blown regolith does not billow: each grain flies out in a
// straight, very flat line (1–3°) and is gone. The sheet starts at about 30 m
// (Apollo crews reported dust from ~30 m), thickens as the plume gets closer,
// follows the throttle continuously, and stops the instant the engine does.
export const DUST = {
  onset: 30, // m: first dust
  full: 3, // m: full ground effect
  maxAlpha: 0.42, // per-streak opacity at full effect: the surface stays readable through it
  clearRadius: 2.7, // scene units around the plume axis with no dust drawn (pads stay visible)
  count: 900, // streaks (one draw call)
  life: 0.9, // s, a streak's flight across the frame
};

const smooth = (x) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/** Dust level 0..1 from the engine throttle (0..1) and the altitude (m). */
export function dustLevel(alt, throttle) {
  if (!(throttle > 0)) return 0;
  const near = smooth((DUST.onset - alt) / (DUST.onset - DUST.full));
  const t = Math.min(1, throttle);
  // Plume pressure on the surface grows with thrust, saturating: at hover
  // thrust close to the ground the sheet is already dense (as on Apollo).
  return Math.min(1, (1 - Math.pow(1 - t, 2.2)) * near);
}

/** Outward speed of the sheet (scene units/s): faster with more thrust. */
export const dustSpeed = (level) => 14 + 18 * level;

/**
 * Where the plume meets the ground (scene x): under the nozzle, displaced by
 * the attitude (+tilt points the nozzle towards -X).
 */
export const plumeCenter = (x, H, tilt) => x - (H + LM.nozzle) * Math.tan(Math.max(-60, Math.min(60, tilt)) * DEG);

/* ---- touchdown and the settle that follows ---------------------------------- */
/**
 * What the graded touchdown looks like once the LM is on the ground. Inputs
 * are the state at capture, the grading result (landingPhysics) and the plane
 * of the ground under the footpads (groundPlane; flat if omitted). The settle
 * runs in that plane's frame: tilt0/pitch0 and the targets are relative to it.
 * Outputs only drive the drawing.
 */
export function touchdownPlan({ vy, vx, tilt }, result, cfg, plane = null) {
  const crashed = !!(result && result.crashed);
  const reasons = (result && result.failureReasons) || [];
  const hard = Math.min(1.6, Math.abs(vy) / (cfg.safeVy || 2.5));
  const sgn = (v) => (v < 0 ? -1 : 1);
  const pt = plane ? plane.tilt : 0;
  const pp = plane ? plane.pitch : 0;
  let tiltTarget = 0;
  let pitchTarget = 0;
  if (crashed) {
    const steep = Math.hypot(pt, pp) > 6;
    if (reasons.some((r) => /TILT/.test(r))) tiltTarget = sgn(tilt) * Math.min(26, Math.abs(tilt) * 1.5 + 4);
    else if (reasons.some((r) => /HORIZONTAL/.test(r))) tiltTarget = sgn(vx) * 13;
    else if (reasons.some((r) => /TERRAIN/.test(r)) && steep) {
      // on a slope the LM goes over downhill
      if (Math.abs(pt) >= Math.abs(pp)) tiltTarget = sgn(pt) * 14;
      else pitchTarget = sgn(pp) * 14;
    } else if (reasons.some((r) => /TERRAIN/.test(r))) tiltTarget = sgn(tilt || vx || 1) * 14;
    else tiltTarget = sgn(tilt || 1) * 5;
  }
  return {
    crashed,
    plane: { tilt: pt, pitch: pp },
    tilt0: tilt - pt,
    pitch0: -pp,
    tiltTarget,
    pitchTarget,
    // Visual impact speed in scene units/s, from the real touchdown rate.
    impact: Math.abs(vy) * sceneAltRate(0.5),
    // Rest compression: harder landings crush the cartridges further.
    rest: crashed && reasons.some((r) => /VERTICAL/.test(r)) ? LM.stroke + LM.crush : LM.stroke * (0.2 + 0.45 * Math.min(1, hard)),
    maxComp: crashed ? LM.stroke + LM.crush : LM.stroke,
    burst: crashed ? 0.9 : 0.15 + 0.25 * Math.min(1, hard), // footpad kick-up, ballistic
  };
}

/** Initial settle state at capture: footpad plane height above the ground plane and its speed (scene units). */
export const settleStart = (plan, H0) => ({ H: H0, v: -plan.impact, tilt: plan.tilt0, w: 0, pitch: plan.pitch0 || 0, wp: 0, t: 0 });

/**
 * Advance the settle by dt: the pads take the load through the struts (a
 * damped spring that only pushes once a pad is down), and the LM rocks onto
 * all four pads (or, after a failed landing, leans over to its final angle).
 * Mutates and returns s.
 */
export function settleStep(s, plan, dt) {
  const n = Math.max(1, Math.ceil(dt / 0.004));
  const h = dt / n;
  const wn = 15; // rad/s, struts
  const zeta = 0.6;
  const wt = 6.5; // rad/s, rocking
  const zt = 0.8;
  for (let i = 0; i < n; i++) {
    const target = -plan.rest;
    const a = s.H > 0 ? -1.62 * sceneAltRate(0) : -wn * wn * (s.H - target) - 2 * zeta * wn * s.v;
    s.v += a * h;
    s.H += s.v * h;
    if (s.H < -plan.maxComp) {
      s.H = -plan.maxComp;
      s.v = Math.max(0, s.v);
    }
    const at = -wt * wt * (s.tilt - plan.tiltTarget) - 2 * zt * wt * s.w;
    s.w += at * h;
    s.tilt += s.w * h;
    const ap = -wt * wt * (s.pitch - (plan.pitchTarget || 0)) - 2 * zt * wt * s.wp;
    s.wp += ap * h;
    s.pitch += s.wp * h;
    s.t += h;
  }
  return s;
}

/**
 * Per-leg compression and body lift during the settle: like legContact, but a
 * crashed LM may bottom its struts out (up to stroke + crush). `res`: the
 * ground left over under each pad (groundPlane), if the ground is uneven.
 */
export function settleLegs(s, plan, res = null) {
  return legContact(s.H, s.tilt, s.pitch || 0, res, plan.maxComp);
}

/* ---- the shot after touchdown ------------------------------------------------ */
// From wherever the chase camera was, one slow crane down and in to a low
// three-quarter view of the LM resting on the surface, horizon and sky above
// it. It swings round the LM by only a few degrees.
export const SHOT = {
  delay: 0.7, // s after touchdown: let the dust clear and the struts settle
  glide: 3.4, // s
  swing: -12, // degrees of azimuth round the LM
  elevation: 8, // degrees above the LM's base
  distance: 9.8, // scene units from the LM's base
  lookUp: 2.4, // look point above the LM's base: the LM sits in the lower half, clear of the captions
};

/** Result card delay after touchdown (ms). */
export const RESULT_DELAY = { landed: 5200, crashed: 3000 };

export const smoother = (x) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * c * (c * (c * 6 - 15) + 10);
};

/**
 * Camera pose t s after touchdown. from = { pos, look } at touchdown, base =
 * the LM's base [x, y, z]. Moves on a sphere round the LM (azimuth,
 * elevation and distance blend separately), so it never cuts across the LM.
 * `swing` (degrees) overrides SHOT.swing (mirrored for an approach from the east).
 */
export function touchdownCamera(t, from, base, swing = SHOT.swing) {
  const k = smoother((t - SHOT.delay) / SHOT.glide);
  const rel = [from.pos[0] - base[0], from.pos[1] - base[1], from.pos[2] - base[2]];
  const d0 = Math.hypot(rel[0], rel[1], rel[2]);
  const az0 = Math.atan2(rel[2], rel[0]);
  const el0 = Math.asin(rel[1] / d0);
  const az = az0 + swing * DEG * k;
  const el = el0 + (SHOT.elevation * DEG - el0) * k;
  const d = d0 + (SHOT.distance - d0) * k;
  const pos = [base[0] + d * Math.cos(el) * Math.cos(az), base[1] + d * Math.sin(el), base[2] + d * Math.cos(el) * Math.sin(az)];
  const goal = [base[0], base[1] + SHOT.lookUp, base[2]];
  const look = from.look.map((v, i) => v + (goal[i] - v) * k);
  return { pos, look, k };
}
