/*
 * LUNAVIA — Earth reentry physics (lunar-return blunt-body capsule).
 *
 * Planar point-mass entry over a spherical, non-rotating Earth, integrated
 * with fixed-step RK4. Every telemetry value (heating, G, deceleration,
 * skip-out, chutes) is derived from this state; nothing is animated
 * independently and there are no angle-based pass/fail rules. Outcomes
 * emerge from the trajectory and the vehicle's physical limits.
 *
 * Simplifications (documented for review):
 *  - Single-scale-height exponential atmosphere (good to ~2x in 60-120 km).
 *  - Constant hypersonic C_D and L/D at trim angle of attack; no Mach effects.
 *  - Planar motion: only the vertical lift component (L·cos σ) shapes the
 *    trajectory; cross-range from L·sin σ is not modelled.
 *  - Convective stagnation heating only (Sutton-Graves); no radiative term.
 *  - Heat shield modelled as an ablator budget (integrated heat load) plus a
 *    surface overheat budget that accumulates while heat rate exceeds design.
 */

export const R_EARTH = 6371e3; // m
export const G0 = 9.80665; // m/s²
export const RHO0 = 1.225; // kg/m³, sea level
export const SCALE_HEIGHT = 7200; // m

export const EI_ALT = 120e3; // entry interface altitude, m
export const EI_VELOCITY = 11000; // m/s, lunar-return inertial speed
export const NOMINAL_FPA = -6.5; // deg at entry interface

export const CAPSULE = {
  mass: 5560, // kg (command module at entry)
  area: 11.95, // m², 3.9 m diameter
  cd: 1.29, // hypersonic drag coefficient at trim AoA
  liftToDrag: 0.3, // trim L/D of the offset-CG blunt body
  noseRadius: 4.69, // m, heat-shield spherical radius
  trimAoA: 20, // deg, presentation only
};

export const LIMITS = {
  structuralG: 12, // sensed aerodynamic load limit
  heatRateDesign: 200, // W/cm², shield surface design heat rate
  overheatBudget: 90, // J/cm² absorbed above design rate before the char layer fails
  heatLoadCapacity: 32000, // J/cm², total ablator capacity
};

// Command-module roll authority (deg/s of simulation time).
export const ROLL_RATE = 20;

// Survivable EI flight-path-angle window found by the physics under ideal lift
// modulation (see reentryPhysics.test.js, which re-derives it). It is used for
// guidance displays only; nothing in the simulation reads it.
export const CORRIDOR = { shallowEdge: -5.5, steepEdge: -7.2, center: -6.35 };

const SUTTON_GRAVES_K = 1.7415e-4; // SI, Earth air

export const CHUTES = {
  drogue: { maxAlt: 7300, maxSpeed: 220, cdA: 21.6, inflateTime: 3 },
  main: { maxAlt: 3200, maxSpeed: 90, cdA: 1225, inflateTime: 8 },
};

export const OUTCOME = {
  SKIP_OUT: "SKIP_OUT",
  THERMAL: "THERMAL",
  STRUCTURAL: "STRUCTURAL",
  CHUTE_FAILURE: "CHUTE_FAILURE",
  SPLASHDOWN: "SPLASHDOWN",
};

export const SIM_DT = 0.02; // s, fixed integration step

const DEG = Math.PI / 180;

export function density(h) {
  return RHO0 * Math.exp(-Math.max(0, h) / SCALE_HEIGHT);
}

export function gravity(h) {
  const r = R_EARTH + h;
  return G0 * (R_EARTH / r) * (R_EARTH / r);
}

export function heatRate(rho, v) {
  // W/cm²
  return (SUTTON_GRAVES_K * Math.sqrt(rho / CAPSULE.noseRadius) * v * v * v) / 1e4;
}

function chuteCdA(s) {
  let a = 0;
  if (s.drogueT !== null) {
    const u = Math.min(1, (s.t - s.drogueT) / CHUTES.drogue.inflateTime);
    if (s.mainT === null) a += CHUTES.drogue.cdA * u * u;
  }
  if (s.mainT !== null) {
    const u = Math.min(1, (s.t - s.mainT) / CHUTES.main.inflateTime);
    a += CHUTES.drogue.cdA * (1 - u) + CHUTES.main.cdA * u * u * u;
  }
  return a;
}

// Aerodynamic accelerations (m/s²) for the current state.
function aero(s, h, v) {
  const rho = density(h);
  const q = 0.5 * rho * v * v;
  const capsuleCdA = CAPSULE.cd * CAPSULE.area;
  const chutes = chuteCdA(s);
  const drag = (q * (capsuleCdA + chutes)) / CAPSULE.mass;
  // Lift only while flying the bare capsule at trim; chutes kill the trim.
  const lift = chutes > 0 ? 0 : (q * capsuleCdA * CAPSULE.liftToDrag) / CAPSULE.mass;
  return { rho, drag, lift };
}

function derivs(s, h, v, gamma) {
  const r = R_EARTH + h;
  const g = gravity(h);
  const { drag, lift } = aero(s, h, v);
  const vs = Math.max(v, 1);
  return {
    dh: v * Math.sin(gamma),
    dv: -drag - g * Math.sin(gamma),
    dgamma: (lift * Math.cos(s.bank * DEG)) / vs + (vs / r - g / vs) * Math.cos(gamma),
    ds: (v * Math.cos(gamma) * R_EARTH) / r,
  };
}

/** Create a state at entry interface. fpaDeg is the flight-path angle (negative = descending). */
export function createEntryState({
  fpaDeg = NOMINAL_FPA,
  velocity = EI_VELOCITY,
  altitude = EI_ALT,
  bankDeg = 0,
} = {}) {
  return {
    t: 0,
    rollInput: 0, // -1 roll left, 0 hold, +1 roll right
    h: altitude,
    v: velocity,
    gamma: fpaDeg * DEG,
    s: 0,
    bank: bankDeg,
    // derived telemetry
    rho: density(altitude),
    heatRate: 0,
    heatRateDot: 0, // W/cm² per second, trend of the heat pulse
    heatLoad: 0, // J/cm²
    overheat: 0, // J/cm² absorbed above design rate
    gLoad: 0,
    decel: 0,
    // flags / events
    entered: false,
    drogueT: null,
    mainT: null,
    drogue: { alt: null, v: null },
    main: { alt: null, v: null },
    peak: { heatRate: 0, heatRateAlt: 0, heatRateV: 0, heatRateT: 0, g: 0, gAlt: 0, gV: 0, gT: 0 },
    ei: { alt: altitude, v: velocity, fpa: fpaDeg },
    outcome: null,
    splashV: null,
  };
}

/** Advance the state by exactly one fixed step (SIM_DT). Mutates and returns s. */
export function step(s, dt = SIM_DT) {
  if (s.outcome) return s;

  if (s.rollInput) {
    s.bank += s.rollInput * ROLL_RATE * dt;
    if (s.bank > 180) s.bank -= 360;
    if (s.bank <= -180) s.bank += 360;
  }

  const { h, v, gamma } = s;
  const k1 = derivs(s, h, v, gamma);
  const k2 = derivs(s, h + (k1.dh * dt) / 2, v + (k1.dv * dt) / 2, gamma + (k1.dgamma * dt) / 2);
  const k3 = derivs(s, h + (k2.dh * dt) / 2, v + (k2.dv * dt) / 2, gamma + (k2.dgamma * dt) / 2);
  const k4 = derivs(s, h + k3.dh * dt, v + k3.dv * dt, gamma + k3.dgamma * dt);
  s.h += ((k1.dh + 2 * k2.dh + 2 * k3.dh + k4.dh) * dt) / 6;
  s.v += ((k1.dv + 2 * k2.dv + 2 * k3.dv + k4.dv) * dt) / 6;
  s.gamma += ((k1.dgamma + 2 * k2.dgamma + 2 * k3.dgamma + k4.dgamma) * dt) / 6;
  s.s += ((k1.ds + 2 * k2.ds + 2 * k3.ds + k4.ds) * dt) / 6;
  s.v = Math.max(0.1, s.v);
  s.t += dt;

  // Derived telemetry from the new state
  const a = aero(s, s.h, s.v);
  s.rho = a.rho;
  s.decel = Math.hypot(a.drag, a.lift);
  s.gLoad = s.decel / G0;
  const qPrev = s.heatRate;
  s.heatRate = s.drogueT === null ? heatRate(a.rho, s.v) : 0;
  s.heatRateDot = (s.heatRate - qPrev) / dt;
  s.heatLoad += s.heatRate * dt;
  if (s.heatRate > LIMITS.heatRateDesign) {
    s.overheat += (s.heatRate - LIMITS.heatRateDesign) * dt;
  }

  if (s.heatRate > s.peak.heatRate) {
    Object.assign(s.peak, { heatRate: s.heatRate, heatRateAlt: s.h, heatRateV: s.v, heatRateT: s.t });
  }
  if (s.gLoad > s.peak.g) {
    Object.assign(s.peak, { g: s.gLoad, gAlt: s.h, gV: s.v, gT: s.t });
  }

  if (!s.entered && s.h < EI_ALT - 500) s.entered = true;

  // --- Vehicle limits (physical consequences) ---
  if (s.gLoad > LIMITS.structuralG) {
    s.outcome = OUTCOME.STRUCTURAL;
    return s;
  }
  if (s.overheat > LIMITS.overheatBudget || s.heatLoad > LIMITS.heatLoadCapacity) {
    s.outcome = OUTCOME.THERMAL;
    return s;
  }
  // Climbed back out through the interface: the atmosphere could not capture it.
  if (s.entered && s.h > EI_ALT + 1000 && s.gamma > 0) {
    s.outcome = OUTCOME.SKIP_OUT;
    return s;
  }

  // --- Parachutes: gated on altitude, speed and a surviving vehicle ---
  if (s.drogueT === null && s.h <= CHUTES.drogue.maxAlt && s.v <= CHUTES.drogue.maxSpeed) {
    s.drogueT = s.t;
    s.drogue = { alt: s.h, v: s.v };
  }
  if (
    s.drogueT !== null &&
    s.mainT === null &&
    s.t - s.drogueT > CHUTES.drogue.inflateTime &&
    s.h <= CHUTES.main.maxAlt &&
    s.v <= CHUTES.main.maxSpeed
  ) {
    s.mainT = s.t;
    s.main = { alt: s.h, v: s.v };
  }

  if (s.h <= 0) {
    s.h = 0;
    s.splashV = s.v;
    s.outcome = s.mainT !== null && s.v < 15 ? OUTCOME.SPLASHDOWN : OUTCOME.CHUTE_FAILURE;
  }
  return s;
}

/** Advance by an arbitrary amount of simulation time using fixed sub-steps. */
export function advance(s, simSeconds, dt = SIM_DT) {
  let remaining = simSeconds;
  while (remaining > 1e-9 && !s.outcome) {
    const d = Math.min(dt, remaining);
    step(s, d);
    remaining -= d;
  }
  return s;
}

export function cloneState(s) {
  return {
    ...s,
    drogue: { ...s.drogue },
    main: { ...s.main },
    peak: { ...s.peak },
    ei: { ...s.ei },
  };
}

/**
 * Look-ahead: fly a copy of the state holding a constant bank until something
 * decisive happens (skip-out, vehicle loss, or the entry is safely over).
 */
export function predict(s, bankDeg = s.bank, { dt = 0.2, maxTime = 900 } = {}) {
  const p = cloneState(s);
  p.bank = bankDeg;
  p.rollInput = 0;
  const t0 = p.t;
  let captured = false;
  while (!p.outcome && p.t - t0 < maxTime) {
    step(p, dt);
    // Past peak loads and slowing through 3 km/s: the entry is decided.
    if (p.v < 3000 && p.gamma < 0) {
      captured = true;
      break;
    }
  }
  return {
    outcome: p.outcome || (captured ? "CAPTURED" : "UNRESOLVED"),
    peakG: Math.max(p.peak.g, s.peak.g),
    peakHeatRate: Math.max(p.peak.heatRate, s.peak.heatRate),
    heatLoad: p.heatLoad,
    overheat: p.overheat,
    minAlt: p.h,
  };
}

/** Human classification of a prediction, for guidance and HUD text. */
export function classifyPrediction(pred) {
  if (pred.outcome === OUTCOME.SKIP_OUT) return "SHALLOW";
  if (pred.outcome === OUTCOME.THERMAL || pred.outcome === OUTCOME.STRUCTURAL) return "STEEP";
  if (pred.peakG > LIMITS.structuralG * 0.8) return "STEEP";
  if (pred.overheat > LIMITS.overheatBudget * 0.6) return "STEEP";
  return "NOMINAL";
}

/** Recommended bank (deg) among candidate lift orientations, preferring the gentlest safe one. */
export function recommendBank(s, candidates = [0, 45, 90, 135, 180]) {
  let best = null;
  for (const b of candidates) {
    const pr = predict(s, b);
    const safe = pr.outcome === "CAPTURED" || pr.outcome === OUTCOME.SPLASHDOWN;
    // Safe: gentlest loads. Unsafe: lean toward the lift direction that fights the failure.
    const score = safe
      ? pr.peakG + pr.overheat / 20
      : 1e6 + (pr.outcome === OUTCOME.SKIP_OUT ? 180 - b : b);
    if (!best || score < best.score) best = { bank: b, score, pred: pr, safe };
  }
  // Keep the roll direction continuous with the current bank sign.
  if (best && s.bank < 0 && best.bank !== 0 && best.bank !== 180) best.bank = -best.bank;
  return best;
}

/** Signed shortest roll direction (-1, 0, +1) from the current bank toward a target bank. */
export function rollToward(current, target, deadband = 3) {
  let d = target - current;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  if (Math.abs(d) <= deadband) return 0;
  return d > 0 ? 1 : -1;
}
