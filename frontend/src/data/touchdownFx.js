/*
 * LUNAVIA — touchdown presentation for the final metres of the lunar descent
 * (pure, unit-tested).
 *
 * Everything here READS the authoritative descent state (data/landerSim) and
 * turns it into what is drawn and heard: the vertical scale near the ground,
 * the regolith sheet blown out by the descent engine, the contact probes and
 * CONTACT LIGHT, the legs meeting the surface, the settle after touchdown and
 * the camera shot that follows. Nothing here decides the outcome: touchdown is
 * captured, graded and scored by landerSim / landingPhysics exactly as before,
 * and the settle only plays out the graded result.
 *
 * Units: sim metres in, scene units out (DescentGame draws x at 0.5 unit/m).
 */

const DEG = Math.PI / 180;

/* ---- vertical scale ------------------------------------------------------ */
// High above the surface the scene draws 0.05 unit per metre, which keeps the
// whole descent and the landing zone in frame. Near the ground that made the
// last 50 m read as a few centimetres under a 1.75-unit LM (35 "metres" tall).
// The extra term stretches only the final metres, so close to the surface the
// scale is 0.25 unit/m and the LM is drawn at its true 7 m height.
export const ALT_SCALE = 0.05;
export const NEAR_GAIN = 3; // scene units added by the surface stretch
export const NEAR_H = 15; // m, depth of the stretch

/** Scene height (units) of the LM's footpad plane at sim altitude alt (m). */
export function sceneAlt(alt) {
  const a = Math.max(0, alt);
  return ALT_SCALE * a + NEAR_GAIN * (1 - Math.exp(-a / NEAR_H));
}

/** Scene units per metre at altitude alt (for velocities). */
export const sceneAltRate = (alt) => ALT_SCALE + (NEAR_GAIN / NEAR_H) * Math.exp(-Math.max(0, alt) / NEAR_H);

/* ---- the lander as drawn (LanderModel at scale 1.2) ----------------------- */
export const LM = {
  scale: 1.2,
  foot: 0.44, // model origin to footpad bottom, scene units
  height: 1.75, // footpad to antenna, scene units
  padRadius: 1.08, // footpad centres from the vertical axis, scene units
  // Legs at +X, +Z (front, ladder), -X, -Z. The front leg carries no probe (as on the LM).
  legAngles: [0, 90, 180, 270],
  probes: [true, false, true, true],
  stroke: 0.09, // primary-strut stroke, scene units (honeycomb crush cartridges)
  crush: 0.07, // extra collapse when a strut bottoms out in a crash
  nozzle: 0.22, // nozzle exit above the footpad plane, scene units
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
 * Footpad heights above the (flat) ground for a footpad plane at H scene units
 * on the axis and an attitude of tilt degrees (the LM banks about Z, +tilt
 * lowers the +X side).
 */
export function padHeights(H, tilt) {
  const s = Math.sin(tilt * DEG);
  return padOffsets().map(([x]) => H - x * s);
}

/**
 * Leg contact in flight: a pad that would go below ground compresses its strut
 * instead; past the stroke the whole LM rides up on it. Returns the per-leg
 * compression and the lift applied to the body (scene units).
 */
export function legContact(H, tilt) {
  const pen = padHeights(H, tilt).map((h) => -h);
  const lift = Math.max(0, Math.max(...pen) - LM.stroke);
  return { comp: pen.map((p) => Math.min(LM.stroke, Math.max(0, p - lift))), lift };
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
  clearRadius: 1.35, // scene units around the plume axis with no dust drawn (pads stay visible)
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
export const dustSpeed = (level) => 7 + 9 * level;

/**
 * Where the plume meets the ground (scene x): under the nozzle, displaced by
 * the attitude (+tilt points the nozzle towards -X).
 */
export const plumeCenter = (x, H, tilt) => x - (H + LM.nozzle) * Math.tan(Math.max(-60, Math.min(60, tilt)) * DEG);

/* ---- touchdown and the settle that follows ---------------------------------- */
/**
 * What the graded touchdown looks like once the LM is on the ground. Inputs
 * are the state at capture and the grading result (landingPhysics); outputs
 * only drive the drawing.
 */
export function touchdownPlan({ vy, vx, tilt }, result, cfg) {
  const crashed = !!(result && result.crashed);
  const reasons = (result && result.failureReasons) || [];
  const hard = Math.min(1.6, Math.abs(vy) / (cfg.safeVy || 2.5));
  const sgn = (v) => (v < 0 ? -1 : 1);
  let tiltTarget = 0;
  if (crashed) {
    if (reasons.some((r) => /TILT/.test(r))) tiltTarget = sgn(tilt) * Math.min(26, Math.abs(tilt) * 1.5 + 4);
    else if (reasons.some((r) => /HORIZONTAL/.test(r))) tiltTarget = sgn(vx) * 13;
    else if (reasons.some((r) => /TERRAIN/.test(r))) tiltTarget = sgn(tilt || vx || 1) * 14;
    else tiltTarget = sgn(tilt || 1) * 5;
  }
  return {
    crashed,
    tilt0: tilt,
    tiltTarget,
    // Visual impact speed in scene units/s, from the real touchdown rate.
    impact: Math.abs(vy) * sceneAltRate(0.5),
    // Rest compression: harder landings crush the cartridges further.
    rest: crashed && reasons.some((r) => /VERTICAL/.test(r)) ? LM.stroke + LM.crush : LM.stroke * (0.2 + 0.45 * Math.min(1, hard)),
    maxComp: crashed ? LM.stroke + LM.crush : LM.stroke,
    burst: crashed ? 0.9 : 0.15 + 0.25 * Math.min(1, hard), // footpad kick-up, ballistic
  };
}

/** Initial settle state at capture: footpad plane height and its speed (scene units). */
export const settleStart = (plan, H0) => ({ H: H0, v: -plan.impact, tilt: plan.tilt0, w: 0, t: 0 });

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
    s.t += h;
  }
  return s;
}

/**
 * Per-leg compression and body lift during the settle: like legContact, but a
 * crashed LM may bottom its struts out (up to stroke + crush).
 */
export function settleLegs(s, plan) {
  const pen = padHeights(s.H, s.tilt).map((h) => -h);
  const lift = Math.max(0, Math.max(...pen) - plan.maxComp);
  return { comp: pen.map((p) => Math.min(plan.maxComp, Math.max(0, p - lift))), lift };
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
  distance: 4.9, // scene units from the LM's base
  lookUp: 1.2, // look point above the LM's base: the LM sits in the lower half, clear of the captions
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
 */
export function touchdownCamera(t, from, base) {
  const k = smoother((t - SHOT.delay) / SHOT.glide);
  const rel = [from.pos[0] - base[0], from.pos[1] - base[1], from.pos[2] - base[2]];
  const d0 = Math.hypot(rel[0], rel[1], rel[2]);
  const az0 = Math.atan2(rel[2], rel[0]);
  const el0 = Math.asin(rel[1] / d0);
  const az = az0 + SHOT.swing * DEG * k;
  const el = el0 + (SHOT.elevation * DEG - el0) * k;
  const d = d0 + (SHOT.distance - d0) * k;
  const pos = [base[0] + d * Math.cos(el) * Math.cos(az), base[1] + d * Math.sin(el), base[2] + d * Math.cos(el) * Math.sin(az)];
  const goal = [base[0], base[1] + SHOT.lookUp, base[2]];
  const look = from.look.map((v, i) => v + (goal[i] - v) * k);
  return { pos, look, k };
}
