import { MOON_G } from "./landingPhysics";
import { simulate, stepLander, initialState, CONTACT_ALT } from "./landerSim";
import { targetRate as scheduleRate, assessDescent } from "./descentProfile";

/**
 * Reference pilots for the descent simulations (tests and balance analysis
 * only; the game never imports this file).
 *
 * They are deliberately NOT autopilots with perfect information. Each one
 * flies with the handicaps of a person holding a phone:
 *   - lag:      reaction time; decisions use the state seen `lag` s earlier
 *   - hz:       decisions per second (between decisions the inputs are held)
 *   - minPress: shortest throttle press or release (a tap), s
 *   - hud:      the HUD refresh rate the state is read at (game: 15 Hz)
 *   - noise:    error in the pilot's reading of the descent rate, m/s
 *   - lead:     how far ahead (s) the pilot anticipates the engine's effect
 *               from the throttle bar (0 = a beginner who waits to see it)
 * and a strategy that a player could plausibly adopt. Several strategies are
 * used so a balance result never hinges on one exact control sequence.
 */

// Deterministic PRNG so every simulated run is repeatable.
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** Distance (m) to stop a descent of `rate` m/s with full thrust. */
export const stopDistance = (rate, cfg, k = 1) =>
  (rate * rate) / (2 * k * Math.max(0.05, cfg.maxThrust - MOON_G));

/**
 * Wrap a strategy with human handicaps. strategy(seen, mem, cfg) returns
 * { throttle, left, right, strafeLeft, strafeRight } from the perceived state.
 */
export function humanPilot(cfg, strategy, {
  lag = 0.3, hz = 8, minPress = 0.15, hud = 15, noise = 0.15, seed = 1, script = null, lead = 0.45,
} = {}) {
  const rand = rng(seed);
  const history = [];
  let hudState = null;
  let hudT = -1;
  let nextDecision = 0;
  let current = {};
  let throttleSince = -1;
  const mem = { lead };
  return (view, t) => {
    // The HUD refreshes at `hud` Hz; the pilot reads it with a delay.
    if (t - hudT >= 1 / hud - 1e-9 || !hudState) {
      hudState = { ...view };
      hudT = t;
    }
    history.push({ t, s: hudState });
    while (history.length > 2 && history[1].t <= t - lag) history.shift();
    const seen = { ...history[0].s };
    if (t >= nextDecision) {
      nextDecision = t + 1 / hz;
      seen.vy += (rand() * 2 - 1) * noise;
      seen.vx += (rand() * 2 - 1) * noise;
      const want = strategy(seen, mem, cfg, t) || {};
      // Taps have a minimum length: a throttle change is held at least minPress.
      if (want.throttle !== current.throttle) {
        if (throttleSince < 0 || t - throttleSince >= minPress) throttleSince = t;
        else want.throttle = current.throttle;
      }
      current = want;
    }
    const out = { ...current };
    if (script) Object.assign(out, script(view, t, out) || {});
    return out;
  };
}

// --- Shared pilot technique ---------------------------------------------------
// A practised pilot leads the engine: the throttle bar is on the HUD, so the
// pilot judges where the descent rate is heading, not just where it is.
function anticipate(seen, cfg, lead = 0.45) {
  const thrust = (seen.fuel > 0 ? seen.throttle : 0) * cfg.maxThrust * Math.cos((seen.tilt * Math.PI) / 180);
  return seen.vy + (thrust - MOON_G) * lead;
}

// Target descent rate for altitude h: the guidance schedule (braking curve,
// then "rate ~ altitude / tau"), flown with the pilot's own aggressiveness.
export const targetRate = (h, cfg, { frac = 0.6, tau = 5, floor = 0.6 } = {}) =>
  scheduleRate(h, cfg, { frac, tau, floor });

// Time to touchdown if the vehicle falls freely from its current rate until it
// meets the targetRate schedule, then follows it.
export function timeToGo(h, rate, cfg, opts) {
  let t = 0;
  const n = 24;
  for (let i = 0; i < n; i++) {
    const hm = h * (1 - (i + 0.5) / n);
    const vFree = Math.sqrt(Math.max(0, rate) ** 2 + 2 * MOON_G * (h - hm));
    t += h / n / Math.max(0.3, Math.min(vFree, targetRate(hm, cfg, opts)));
  }
  return t;
}

// Steer towards the primary LZ while high, null the drift low down. RCS only.
function rcsLateral(seen, cfg, tGo, { aim = true } = {}) {
  const x = seen.xPos;
  let vxT = 0;
  if (aim) {
    const lim = Math.max(0, Math.min(9, (seen.alt - 8) / 6));
    vxT = Math.max(-lim, Math.min(lim, -x / Math.max(3, tGo * 0.5)));
  }
  const err = seen.vx - vxT;
  const band = seen.alt < 25 ? 0.25 : 0.5;
  return { strafeLeft: err > band, strafeRight: err < -band };
}

// Bring the tilt to `want`: hold while far off, then pulse short taps (press
// one decision, release the next) as a practised pilot does near the target.
function tiltTo(seen, mem, want = 0) {
  const err = seen.tilt - want;
  if (Math.abs(err) <= 1.5) return { left: false, right: false };
  if (Math.abs(err) < 6) {
    mem.tap = !mem.tap;
    if (!mem.tap) return { left: false, right: false };
  }
  return { left: err > 0, right: err < 0 };
}
const levelTilt = (seen, mem) => tiltTo(seen, mem, 0);

function verticalHold(seen, mem, cfg, vT, band) {
  const rate = -anticipate(seen, cfg, mem.lead);
  if (rate > vT + band) mem.burn = true;
  else if (rate < vT - band) mem.burn = false;
  return !!mem.burn;
}

/**
 * PROFILE: follow a descent-rate schedule the way Apollo crews flew the
 * approach, braking along a fraction `frac` of the available deceleration.
 * On/off throttle with hysteresis.
 */
export function profileStrategy({ frac = 0.6, tau = 5, band = 0.3, aim = true, late = 0 } = {}) {
  return (seen, mem, cfg, t) => {
    const h = Math.max(0, seen.alt - CONTACT_ALT);
    const vT = targetRate(h, cfg, { frac, tau });
    let throttle = verticalHold(seen, mem, cfg, vT, band);
    // `late`: the first braking burn starts this many seconds after the
    // profile first calls for it (a pilot who reacts late to the cue).
    if (throttle && mem.firstCall == null) mem.firstCall = t;
    if (mem.firstCall != null && t < mem.firstCall + late) throttle = false;
    const tGo = timeToGo(h, -seen.vy, cfg, { frac, tau });
    return { throttle, ...rcsLateral(seen, cfg, tGo, { aim }), ...levelTilt(seen, mem) };
  };
}

/**
 * GUIDED: flies the HUD's own cues and nothing else - the TARGET V/S band
 * midpoint and the braking-burn countdown from assessDescent. Shows that the
 * guidance the player sees is enough to land, without being an autopilot:
 * the pilot still has the lag, tap length and misreadings of the others.
 */
export function guidedStrategy({ band = 0.35, aim = true } = {}) {
  return (seen, mem, cfg) => {
    const h = Math.max(0, seen.alt - CONTACT_ALT);
    const a = assessDescent({ ...seen, cfg });
    const throttle = verticalHold(seen, mem, cfg, a.envelope.mid, band);
    const tGo = timeToGo(h, -seen.vy, cfg, { frac: 0.55, tau: 6 });
    return { throttle, ...rcsLateral(seen, cfg, tGo, { aim }), ...levelTilt(seen, mem) };
  };
}

/**
 * PRECISION: the guided vertical technique, with the lateral attention of a
 * pilot aiming for the centre of the LZ: keeps steering toward it down to a
 * couple of metres, at a closing speed that shrinks with height (never above
 * 40 % of the touchdown limit near the ground), with finer RCS taps low down.
 */
export function precisionStrategy({ band = 0.35 } = {}) {
  return (seen, mem, cfg) => {
    const h = Math.max(0, seen.alt - CONTACT_ALT);
    const a = assessDescent({ ...seen, cfg });
    const throttle = verticalHold(seen, mem, cfg, a.envelope.mid, band);
    const tGo = timeToGo(h, -seen.vy, cfg, { frac: 0.55, tau: 6 });
    const lim = Math.min(8, Math.max(cfg.safeVx * 0.4, (seen.alt - 2) / 5));
    const vxT = Math.max(-lim, Math.min(lim, -seen.xPos / Math.max(2, tGo * 0.4)));
    const err = seen.vx - vxT;
    const db = seen.alt < 25 ? 0.15 : 0.4;
    return { throttle, strafeLeft: err > db, strafeRight: err < -db, ...levelTilt(seen, mem) };
  };
}

/**
 * BEGINNER: brakes once the descent "looks fast" for the altitude (a steep
 * schedule using 75 % of the braking authority), keeps a loose band, and has
 * little feel yet for the engine's lag. Use with BEGINNER_HANDICAP.
 */
export function beginnerStrategy() {
  return profileStrategy({ frac: 0.75, tau: 4, band: 0.5 });
}
export const BEGINNER_HANDICAP = { lead: 0.15, hz: 6, noise: 0.3, minPress: 0.2 };

/** The same pilot with the RCS translation never used (drift left alone). */
export function withoutRcs(strategy) {
  return (seen, mem, cfg, t) => ({ ...strategy(seen, mem, cfg, t), strafeLeft: false, strafeRight: false });
}

/**
 * LATE BRAKE: coast, then a full-thrust braking burn started when the
 * stopping distance (times a safety factor) reaches the altitude, then the
 * final-approach profile. `margin` < 0 brakes too late; `delay` starts the
 * burn that many seconds after the pilot should have.
 */
export function lateBrakeStrategy({ margin = 0.25, gate = 25, delay = 0, aim = true } = {}) {
  const tail = profileStrategy({ frac: 0.75, aim });
  return (seen, mem, cfg, t) => {
    const h = Math.max(0, seen.alt - CONTACT_ALT);
    const rate = -seen.vy;
    if (mem.cue == null && h - gate <= stopDistance(rate, cfg) * (1 + margin)) mem.cue = t;
    const tGo = timeToGo(h, rate, cfg, { frac: 0.75 });
    if (mem.cue == null || t < mem.cue + delay) {
      return { throttle: false, ...rcsLateral(seen, cfg, tGo, { aim }), ...levelTilt(seen, mem) };
    }
    if (!mem.braked) {
      // Hold the braking burn until the final-approach profile is reached.
      if (rate > targetRate(h, cfg, { frac: 0.75 }) + 0.3) {
        return { throttle: true, ...rcsLateral(seen, cfg, tGo, { aim }), ...levelTilt(seen, mem) };
      }
      mem.braked = true;
    }
    return tail(seen, mem, cfg, t);
  };
}

/**
 * EARLY BRAKE: kill most of the descent rate immediately, then descend at a
 * constant `cruise` rate before the final approach. Safe but fuel-hungry.
 */
export function earlyBrakeStrategy({ cruise = 4, aim = true } = {}) {
  return (seen, mem, cfg) => {
    const h = Math.max(0, seen.alt - CONTACT_ALT);
    const vT = Math.min(cruise, targetRate(h, cfg, { frac: 0.6 }));
    const throttle = verticalHold(seen, mem, cfg, vT, 0.3);
    const tGo = timeToGo(h, Math.min(-seen.vy, cruise), cfg, { frac: 0.6 });
    return { throttle, ...rcsLateral(seen, cfg, tGo, { aim }), ...levelTilt(seen, mem) };
  };
}

/**
 * TILT: vertical profile as PROFILE, coarse lateral steering by banking the
 * main engine while high, RCS only for the final trim. Banking only pushes
 * while the engine burns, and costs vertical thrust while it does.
 */
export function tiltStrategy({ frac = 0.6, bank = 12 } = {}) {
  const vert = profileStrategy({ frac });
  return (seen, mem, cfg, t) => {
    const v = vert(seen, mem, cfg, t);
    const h = Math.max(0, seen.alt - CONTACT_ALT);
    if (seen.alt < 40) return { throttle: v.throttle, ...rcsLateral(seen, cfg, timeToGo(h, -seen.vy, cfg, { frac })), ...levelTilt(seen, mem) };
    const tGo = timeToGo(h, -seen.vy, cfg, { frac });
    const vxT = Math.max(-9, Math.min(9, -seen.xPos / Math.max(3, tGo * 0.5)));
    const err = seen.vx - vxT;
    const want = Math.abs(err) > 0.5 ? Math.max(-bank, Math.min(bank, -err * 6)) : 0;
    return { throttle: v.throttle, ...tiltTo(seen, mem, want) };
  };
}

/**
 * Minimum fuel for a vertical landing: the ideal single braking burn (coast,
 * then full thrust to touchdown at the safe rate) with the game's own engine
 * spool, found by bisection on the burn start time. Returns null if even the
 * ideal burn cannot land.
 */
export function idealBurn(cfg, init = {}) {
  // Probe with an unlimited tank to find the latest start that still lands
  // safely; the fuel that burn uses is the minimum any pilot could need.
  const unlimited = { ...cfg, initialFuel: 1e9 };
  const probe = (tStart) => {
    const p = { ...initialState(unlimited), ...init, vx: 0 };
    const dt = 1 / 240;
    let used = 0;
    while (p.alt > CONTACT_ALT && p.t < 400) {
      const burning = p.t >= tStart && p.vy < -cfg.safeVy * 0.5;
      const f0 = p.fuel;
      stepLander(p, { throttle: burning }, unlimited, dt);
      used += f0 - p.fuel;
      if (p.vy > 0.2) return { ok: true, used, vy: p.vy, t: p.t };
    }
    return { ok: -p.vy <= cfg.safeVy, used, vy: p.vy, t: p.t };
  };
  let lo = 0;
  let hi = 200;
  if (!probe(lo).ok) return null;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (probe(mid).ok) lo = mid; else hi = mid;
  }
  const best = probe(lo);
  return {
    burnStart: lo,
    fuelUsed: best.used,
    fuelRatio: cfg.initialFuel / best.used,
    touchdownTime: best.t,
    possible: best.used <= cfg.initialFuel,
  };
}

/** Run a pilot over a difficulty and return a compact outcome record. */
export function fly(cfg, strategy, opts = {}) {
  const { init, fps = 60, ...pilotOpts } = opts;
  const pilot = humanPilot(cfg, strategy, pilotOpts);
  const r = simulate(cfg, pilot, { fps, init });
  const s = r.state;
  return {
    landed: !r.result.crashed,
    reasons: r.result.failureReasons,
    vy: s.vy, vx: s.vx, tilt: s.tilt, x: s.xPos,
    fuelPct: (s.fuel / cfg.initialFuel) * 100,
    t: r.t,
    grade: r.result.grade,
    score: r.result.score,
  };
}
