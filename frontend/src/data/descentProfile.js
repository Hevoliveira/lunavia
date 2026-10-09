import { MOON_G } from "./landingPhysics";

/**
 * PHASE 2 - LANDING USABILITY
 *
 * One shared read of "how is this descent going right now".
 *
 * Everything the player is told - the warning strip, the vertical-speed colour
 * zones, the descent-profile chip, the corrective guidance line and the
 * braking / fuel-reserve / target-rate readouts - is derived from this single
 * function, so those displays can never disagree with one another. It
 * introduces no new physics: it reuses MOON_G and the same per-difficulty cfg
 * (maxThrust, fuelRate, safeVy, safeVx, safeTilt, tiltRate) that the
 * integrator (landerSim) and gradeLanding use.
 *
 * Severity scale used throughout: 0 = nominal, 1 = caution, 2 = danger.
 */

export const OK = 0;
export const CAUTION = 1;
export const DANGER = 2;

// Contact is captured at 0.5 m (landerSim CONTACT_ALT), so that is the
// altitude the vehicle actually has available to fix anything.
const CONTACT_ALT = 0.5;

// Lateral authority of the RCS translation thrusters at full press, m/s^2
// (landerSim RCS_ACCEL).
const RCS_ACCEL = 3;

// Time between deciding to brake and the engine delivering most of its
// thrust (reaction plus spool-up), s. Added to every stopping distance.
const RESPONSE = 0.5;

/* ---------------------------------------------------------------------------
 * Descent-rate schedule. A braking curve sqrt(2 a h) high up, then
 * "rate ~ altitude / tau" for the final approach (the Apollo rule of thumb),
 * never below a gentle touchdown rate. `frac` is the share of the engine's
 * braking authority the schedule plans to use.
 * ------------------------------------------------------------------------- */
export function targetRate(h, cfg, { frac = 0.55, tau = 6, floor = 0.6 } = {}) {
  const a = frac * Math.max(0.05, cfg.maxThrust - MOON_G);
  const f = cfg.safeVy * floor;
  return Math.max(f, Math.min(Math.sqrt(2 * a * Math.max(0, h)), h / tau + f));
}

/** Recommended descent-rate band (m/s, positive down) at height h. */
export function rateEnvelope(h, cfg) {
  return {
    lo: targetRate(h, cfg, { frac: 0.3, tau: 10, floor: 0.3 }),
    mid: targetRate(h, cfg),
    hi: targetRate(h, cfg, { frac: 0.8, tau: 4, floor: 0.9 }),
  };
}

/**
 * Nominal remaining descent from height h at descent rate `rate`: the
 * vehicle falls freely until it meets the recommended schedule, then follows
 * it. Returns cumulative [t, h] samples from now to touchdown.
 */
export function nominalDescent(h, rate, cfg, n = 24) {
  const out = [[0, h]];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const hm = h * (1 - (i + 0.5) / n);
    const vFree = Math.sqrt(Math.max(0, rate) ** 2 + 2 * MOON_G * (h - hm));
    t += h / n / Math.max(0.3, Math.min(vFree, targetRate(hm, cfg)));
    out.push([t, h * (1 - (i + 1) / n)]);
  }
  return out;
}

/** Time to touchdown on the nominal descent, s. */
export const timeToGo = (h, rate, cfg) => nominalDescent(h, rate, cfg, 16)[16][0];

/**
 * Predicted touchdown x (physics metres) if the drift is left alone and the
 * descent follows the recommended schedule. Shared by the LPD reticle, the
 * PROJECTED TOUCHDOWN readout and the descent camera.
 */
export function predictTouchdownX(p, cfg) {
  const h = Math.max(0, p.alt - CONTACT_ALT);
  return p.xPos + p.vx * timeToGo(h, -p.vy, cfg);
}

/**
 * Height (m) a full-thrust burn started now needs to bring `rate` down to a
 * touchdown rate safely inside the limit, including the engine's response.
 */
export function stopDistance(rate, cfg) {
  const a = Math.max(0.05, cfg.maxThrust - MOON_G);
  const vf = cfg.safeVy * 0.8;
  return Math.max(0, rate * rate - vf * vf) / (2 * a) + Math.max(0, rate) * RESPONSE;
}

/**
 * Least fuel that can still land from (h, rate): coast, then one full-thrust
 * burn arriving at the touchdown rate. Infinity if even that cannot arrive
 * within the safe rate.
 */
export function minLandingFuel(h, rate, cfg) {
  const a = Math.max(0.05, cfg.maxThrust - MOON_G);
  const g = MOON_G;
  const vf = cfg.safeVy * 0.5;
  const r = Math.max(0, rate);
  const hb = (r * r + 2 * g * h - vf * vf) / (2 * (a + g));
  let burn;
  if (hb >= h) {
    // Already inside the braking curve: full thrust from now.
    const arrive2 = r * r - 2 * a * h;
    if (arrive2 > cfg.safeVy * cfg.safeVy) return Infinity;
    burn = (r - Math.sqrt(Math.max(0, arrive2))) / a;
  } else {
    burn = (Math.sqrt(vf * vf + 2 * a * hb) - vf) / a;
  }
  return burn * cfg.fuelRate;
}

/** Fuel flow (units/s) while hovering. */
export const hoverFuelRate = (cfg) => (cfg.fuelRate * MOON_G) / cfg.maxThrust;

/**
 * Seconds to wait (coasting) before a braking burn must start, keeping a 20 %
 * stopping-distance margin. 0 when it should already have started.
 */
export function brakeIn(h, rate, cfg) {
  for (let t = 0; t <= 12; t += 0.1) {
    const r = rate + MOON_G * t;
    const ht = h - rate * t - 0.5 * MOON_G * t * t;
    if (ht <= stopDistance(r, cfg) * 1.2 + 10) return t;
  }
  return Infinity;
}

export function assessDescent({ alt, vy, vx, tilt, throttle, fuel, cfg }) {
  const h = Math.max(0, alt - CONTACT_ALT);
  const rate = Math.max(0, -vy);            // descent rate, positive downwards
  const hasFuel = fuel > 0;

  // --- Vertical ------------------------------------------------------------
  // Best deceleration the vehicle can still produce, and the deceleration it
  // needs to average to arrive at the surface at the safe touchdown rate.
  const bestDecel = Math.max(0.01, cfg.maxThrust - MOON_G);
  // On the surface nothing more is needed unless it is still coming down too fast.
  const needDecel =
    h > 0.05 ? (rate * rate - cfg.safeVy * cfg.safeVy) / (2 * h) : rate > cfg.safeVy ? Infinity : 0;

  // demand = 0 -> nothing required, 1 -> needs every bit of thrust it has.
  // This is the term that makes -10 m/s at 400 m nominal and -10 m/s at 15 m
  // critical, instead of judging vertical speed on its own.
  const demand = hasFuel === false ? Infinity : Math.max(0, needDecel) / bestDecel;

  // Where this touchdown ends up if the player simply holds the current
  // throttle. Short-horizon, constant-acceleration estimate - deliberately not
  // a predictive engine.
  const thrustAcc = hasFuel ? throttle * cfg.maxThrust * Math.cos((tilt * Math.PI) / 180) : 0;
  const sink = MOON_G - thrustAcc;          // +ve = still accelerating downwards
  const projSq = rate * rate + 2 * sink * h;
  const projVy = projSq > 0 ? Math.sqrt(projSq) : 0;

  let vyState = OK;
  if (demand > 0.85 || (hasFuel === false && projVy > cfg.safeVy)) vyState = DANGER;
  // Holding the current throttle into a fast arrival only matters in the
  // final approach; higher up the braking cue below is the better guide.
  else if (demand > 0.55 || (projVy > cfg.safeVy * 1.6 && h < 60)) vyState = CAUTION;

  // --- Time left -----------------------------------------------------------
  // Average of current and projected rate is accurate enough to decide whether
  // a lateral or attitude error is still fixable.
  const meanRate = Math.max(0.4, (rate + projVy) / 2);
  const tContact = h / meanRate;

  // --- Lateral -------------------------------------------------------------
  // Judged by whether there is still time to null the drift, not by raw speed.
  const speedX = Math.abs(vx);
  const tNullVx = Math.max(0, speedX - cfg.safeVx * 0.5) / RCS_ACCEL;
  let vxState = OK;
  if (speedX > cfg.safeVx && tContact < tNullVx * 1.4) vxState = DANGER;
  else if (speedX > cfg.safeVx * 0.6 && tContact < tNullVx * 3.5) vxState = CAUTION;

  // --- Attitude ------------------------------------------------------------
  const angle = Math.abs(tilt);
  const tLevel = angle / Math.max(1, cfg.tiltRate);
  let tiltState = OK;
  if (angle > cfg.safeTilt && tContact < tLevel * 4) tiltState = DANGER;
  else if (angle > cfg.safeTilt * 0.7 && tContact < tLevel * 9) tiltState = CAUTION;
  // Past the limit close to the ground is always a danger, whatever the maths.
  if (angle > cfg.safeTilt && h < 40) tiltState = DANGER;

  // --- Braking -------------------------------------------------------------
  // Spare height if a full braking burn started now, and - during the
  // initial coast, before any braking burn - how long the vehicle can keep
  // coasting before it must start one.
  const margin = h - stopDistance(rate, cfg);
  const burning = thrustAcc > MOON_G * 0.8;
  const coasting = !burning && fuel > cfg.initialFuel * 0.97;
  const brakeTime = coasting ? brakeIn(h, rate, cfg) : Infinity;
  if (margin < 0 && hasFuel && rate > cfg.safeVy) vyState = DANGER;
  else if (vyState === OK && brakeTime < 1.5 && rate > cfg.safeVy * 2) vyState = CAUTION;

  // --- Fuel ----------------------------------------------------------------
  // Hover reserve: seconds of hovering the tank holds beyond the least fuel
  // that can still land from here (Apollo's "60 seconds" calls).
  const fuelPct = (fuel / cfg.initialFuel) * 100;
  const need = minLandingFuel(h, rate, cfg);
  const reserve = Number.isFinite(need) ? (fuel - need) / hoverFuelRate(cfg) : -Infinity;
  let fuelState = OK;
  if (fuelPct < 10 || reserve < 3) fuelState = DANGER;
  else if (fuelPct < 25 || reserve < 10) fuelState = CAUTION;

  return {
    vyState, vxState, tiltState, fuelState,
    demand, projVy, tContact, fuelPct,
    envelope: rateEnvelope(h, cfg),
    margin, brakeTime, burning, reserve,
  };
}

/**
 * Compact profile chip shown in the HUD. Worst axis wins, so the chip can never
 * read ON PROFILE while another display is warning about something.
 */
export function profileLabel(a, hazard) {
  const worst = Math.max(a.vyState, a.vxState, a.tiltState);
  if (hazard && worst < DANGER) return { text: "DIVERT", level: CAUTION };
  if (worst === DANGER) return { text: a.vyState === DANGER ? "TOO FAST" : "UNSTABLE", level: DANGER };
  if (worst === CAUTION) return { text: "CAUTION", level: CAUTION };
  return { text: "ON PROFILE", level: OK };
}

/**
 * One guidance line, never several at once. Names the problem, never the key -
 * the player still has to work out what to do about it.
 */
export function guidanceFor(a, hazard) {
  if (hazard) return { text: "DIVERT - HAZARDOUS TERRAIN", level: DANGER };
  if (a.vyState === DANGER) return { text: a.margin < 0 ? "FULL THRUST - CANNOT STOP IN TIME" : "REDUCE DESCENT RATE", level: DANGER };
  if (a.tiltState === DANGER) return { text: "LEVEL VEHICLE", level: DANGER };
  if (a.vxState === DANGER) return { text: "REDUCE LATERAL VELOCITY", level: DANGER };
  if (a.fuelState === DANGER) return { text: a.reserve < 0 ? "FUEL BELOW LANDING MINIMUM" : "FUEL CRITICAL", level: DANGER };
  if (a.vyState === CAUTION) return { text: a.brakeTime < 1.5 ? "BEGIN BRAKING BURN" : "WATCH DESCENT RATE", level: CAUTION };
  if (a.tiltState === CAUTION) return { text: "LEVEL VEHICLE", level: CAUTION };
  if (a.vxState === CAUTION) return { text: "REDUCE LATERAL VELOCITY", level: CAUTION };
  if (a.fuelState === CAUTION) return { text: a.reserve < 10 ? "HOVER RESERVE LOW" : "FUEL LOW", level: CAUTION };
  if (a.brakeTime < 8) return { text: `BRAKING BURN IN ${Math.ceil(a.brakeTime)} S`, level: OK };
  return null;
}
