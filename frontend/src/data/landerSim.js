import {
  MOON_G,
  evaluateGround,
  gradeLanding,
} from "./landingPhysics";

/**
 * Lunar descent integrator, shared by the game loop (DescentGame) and the
 * deterministic simulations in landerSim.test.js. One implementation, so a
 * test result is a statement about the game the player actually flies.
 */

// Throttle spool rates (1/s). Rising is quicker than falling so a correction
// bites when asked for, while the engine keeps visible mass on the way down.
export const THROTTLE_SPOOL_UP = 2.8;
export const THROTTLE_SPOOL_DOWN = 1.9;
// Lateral authority of the RCS translation thrusters (m/s^2).
export const RCS_ACCEL = 3;
// Touchdown is captured at this altitude (m), so the LM can never hover
// indefinitely just above the surface.
export const CONTACT_ALT = 0.5;
// Fuel running dry above this altitude is a failure in its own right.
export const DRY_TANK_ALT = 5;
// Attitude limit of the gimbal / RCS (deg).
export const MAX_TILT = 45;
// Largest physics step (s); frames are sub-stepped to at most this.
export const MAX_STEP = 0.033;

/** Initial physics state for a difficulty config. */
export function initialState(cfg) {
  return {
    alt: cfg.initialAlt,
    vy: cfg.initialVy,
    vx: cfg.initialVx,
    xPos: -cfg.initialAlt * 0.3,
    tilt: 0,
    throttle: 0,
    fuel: cfg.initialFuel,
    fuelDepletedInFlight: false,
    held: { l: 0, r: 0, sl: 0, sr: 0 },
    t: 0,
  };
}

/**
 * Fine control. A tilt or RCS press starts at a fine rate and blends up to the
 * full rate over `ramp` seconds, so a short tap trims by a degree or a few
 * tenths of a m/s while a held press keeps the full authority. Without a
 * fine rate in the config the press acts at full rate from the first frame.
 */
const ramped = (fine, full, ramp, held) =>
  fine == null ? full : fine + (full - fine) * Math.min(1, held / (ramp || 0.35));

/** Tilt rate (deg/s) after the input has been held for `held` s. */
export const tiltRateFor = (cfg, held) => ramped(cfg.tiltFine, cfg.tiltRate, cfg.fineRamp, held);

/** RCS translation acceleration (m/s^2) after `held` s. */
export const rcsAccelFor = (cfg, held) => ramped(cfg.rcsFine, cfg.rcsAccel || RCS_ACCEL, cfg.fineRamp, held);

/**
 * Advance the lander by dt seconds. Mutates p.
 * inp: { throttle, left, right, strafeLeft, strafeRight: bool }
 */
export function stepLander(p, inp, cfg, dt) {
  // How long each attitude / RCS input has been held (for fine control).
  const held = p.held || (p.held = { l: 0, r: 0, sl: 0, sr: 0 });
  held.l = inp.left ? held.l + dt : 0;
  held.r = inp.right ? held.r + dt : 0;
  held.sl = inp.strafeLeft ? held.sl + dt : 0;
  held.sr = inp.strafeRight ? held.sr + dt : 0;

  // Throttle: the command is on/off, the engine spools towards it.
  const throttleTarget = inp.throttle && p.fuel > 0 ? 1 : 0;
  const spool = throttleTarget > p.throttle ? THROTTLE_SPOOL_UP : THROTTLE_SPOOL_DOWN;
  p.throttle += (throttleTarget - p.throttle) * Math.min(1, dt * spool);

  // Attitude
  let dTilt = 0;
  if (inp.left) dTilt -= tiltRateFor(cfg, held.l) * dt;
  if (inp.right) dTilt += tiltRateFor(cfg, held.r) * dt;
  if (!inp.left && !inp.right && cfg.tiltAssist) {
    dTilt -= Math.sign(p.tilt) * Math.min(Math.abs(p.tilt), 15 * dt);
  }
  p.tilt = Math.max(-MAX_TILT, Math.min(MAX_TILT, p.tilt + dTilt));

  // RCS translation
  if (inp.strafeLeft) p.vx -= rcsAccelFor(cfg, held.sl) * dt;
  if (inp.strafeRight) p.vx += rcsAccelFor(cfg, held.sr) * dt;

  // Fuel, and the moment the tanks run dry
  const fuelBefore = p.fuel;
  p.fuel = Math.max(0, p.fuel - p.throttle * cfg.fuelRate * dt);
  if (fuelBefore > 0 && p.fuel <= 0 && p.alt > DRY_TANK_ALT) p.fuelDepletedInFlight = true;
  const effThrottle = p.fuel > 0 ? p.throttle : 0;

  // Semi-implicit Euler
  const thrustAcc = effThrottle * cfg.maxThrust;
  const rad = p.tilt * (Math.PI / 180);
  p.vy += (thrustAcc * Math.cos(rad) - MOON_G) * dt;
  p.vx += thrustAcc * Math.sin(rad) * dt;
  p.alt += p.vy * dt;
  p.xPos += p.vx * dt;
  p.t = (p.t || 0) + dt;
}

/**
 * Advance one rendered frame: sub-steps of at most MAX_STEP, stopping at
 * contact. Returns true once the lander has reached CONTACT_ALT.
 */
export function stepFrame(p, inp, cfg, frameDt) {
  const totalDt = Math.min(0.25, frameDt);
  const subSteps = Math.max(1, Math.ceil(totalDt / MAX_STEP));
  const dt = totalDt / subSteps;
  for (let s = 0; s < subSteps; s++) {
    stepLander(p, inp, cfg, dt);
    if (p.alt <= CONTACT_ALT) return true;
  }
  return false;
}

/** Grade the touchdown state exactly as the game does. */
export function gradeTouchdown(p, cfg) {
  const g = evaluateGround(p.xPos);
  return gradeLanding({
    vy: p.vy,
    vx: p.vx,
    tilt: p.tilt,
    fuel: p.fuel,
    initialFuel: cfg.initialFuel,
    xPos: p.xPos,
    safeZone: g.safeZone,
    hazard: g.hazard,
    safeVy: cfg.safeVy,
    safeVx: cfg.safeVx,
    safeTilt: cfg.safeTilt,
    fuelDepletedInFlight: p.fuelDepletedInFlight,
  });
}

/**
 * Fly a whole descent with a pilot function at a fixed frame rate.
 * pilot(view, t) -> input object; `view` is a copy of the state the pilot can
 * see. Returns { result, state, t, trace }.
 */
export function simulate(cfg, pilot, { fps = 60, maxTime = 300, init, trace = false } = {}) {
  const p = { ...initialState(cfg), ...(init || {}) };
  const frame = 1 / fps;
  const samples = [];
  let inp = {};
  while (p.t < maxTime) {
    inp = pilot({ ...p }, p.t) || {};
    if (trace) samples.push({ t: p.t, alt: p.alt, vy: p.vy, vx: p.vx, x: p.xPos, tilt: p.tilt, thr: p.throttle, fuel: p.fuel });
    if (stepFrame(p, inp, cfg, frame)) break;
  }
  return { result: gradeTouchdown(p, cfg), state: p, t: p.t, trace: samples };
}
