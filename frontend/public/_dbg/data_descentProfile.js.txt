import { MOON_G } from "@/data/landingPhysics";

/**
 * PHASE 2 - LANDING USABILITY
 *
 * One shared read of "how is this descent going right now".
 *
 * Everything the player is told - the warning strip, the vertical-speed colour
 * zones, the descent-profile chip and the corrective guidance line - is derived
 * from this single function, so those four displays can never disagree with one
 * another. It introduces no new physics: it reuses MOON_G and the same
 * per-difficulty cfg (maxThrust, safeVy, safeVx, safeTilt, tiltRate) that the
 * integrator and gradeLanding already use.
 *
 * Severity scale used throughout: 0 = nominal, 1 = caution, 2 = danger.
 */

export const OK = 0;
export const CAUTION = 1;
export const DANGER = 2;

// Contact is captured at 0.5 m (see DescentGame CONTACT_ALT), so that is the
// altitude the vehicle actually has available to fix anything.
const CONTACT_ALT = 0.5;

// Lateral authority of the RCS translation thrusters, in m/s^2. Matches the
// +/- 3 * dt applied in the integrator.
const RCS_ACCEL = 3;

export function assessDescent({ alt, vy, vx, tilt, throttle, fuel, cfg }) {
  const h = Math.max(0, alt - CONTACT_ALT);
  const rate = Math.max(0, -vy);            // descent rate, positive downwards
  const hasFuel = fuel > 0;

  // --- Vertical ------------------------------------------------------------
  // Best deceleration the vehicle can still produce, and the deceleration it
  // needs to average to arrive at the surface at the safe touchdown rate.
  const bestDecel = Math.max(0.01, cfg.maxThrust - MOON_G);
  const needDecel =
    h > 0.05 ? (rate * rate - cfg.safeVy * cfg.safeVy) / (2 * h) : Infinity;

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
  else if (demand > 0.55 || projVy > cfg.safeVy * 1.6) vyState = CAUTION;

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

  // --- Fuel ----------------------------------------------------------------
  const fuelPct = (fuel / cfg.initialFuel) * 100;
  let fuelState = OK;
  if (fuelPct < 10) fuelState = DANGER;
  else if (fuelPct < 25) fuelState = CAUTION;

  return {
    vyState, vxState, tiltState, fuelState,
    demand, projVy, tContact, fuelPct,
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
  if (a.vyState === DANGER) return { text: "REDUCE DESCENT RATE", level: DANGER };
  if (a.tiltState === DANGER) return { text: "LEVEL VEHICLE", level: DANGER };
  if (a.vxState === DANGER) return { text: "REDUCE LATERAL VELOCITY", level: DANGER };
  if (a.fuelState === DANGER) return { text: "FUEL CRITICAL", level: DANGER };
  if (a.vyState === CAUTION) return { text: "WATCH DESCENT RATE", level: CAUTION };
  if (a.tiltState === CAUTION) return { text: "LEVEL VEHICLE", level: CAUTION };
  if (a.vxState === CAUTION) return { text: "REDUCE LATERAL VELOCITY", level: CAUTION };
  if (a.fuelState === CAUTION) return { text: "FUEL LOW", level: CAUTION };
  return null;
}
