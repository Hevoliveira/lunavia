/*
 * LUNAVIA — Earth reentry comms, driven by telemetry.
 *
 * Fed the ReentryGame HUD snapshot (15 Hz). Returns the calls to make, plus
 * the state of the air-to-ground link:
 *
 *   link      1 = clear. Falls as the plasma sheath builds (heat rate), so
 *             the last calls before blackout sound strained.
 *   blackout  the same test as the HUD's COMM BLACKOUT: no ground voice
 *             gets through (onboard computer warnings still do). Telemetry,
 *             guidance and the HUD carry on; Houston comes back after AOS.
 *
 * Lift-vector advice uses the look-ahead prediction the HUD shows, so the
 * voice only says what the gauges say (and nothing when the difficulty has no
 * prediction, as on COMMANDER).
 *
 * u = { phase, realT, vel, g, q, overheat, prepFpa, inBand, attitudeReady,
 *       blackout, pred, climbing, drogue, main, outcome }
 * Returns { requests: [{ id, delay?, relevant? }], blackout, link }.
 */
import { LIMITS } from "../data/reentryPhysics";
import { TARGET_FPA } from "../data/reentryGuidance";

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function createReentryMonitor() {
  let latest = null;
  let prevG = 0;
  let hadBlackout = false;
  let threatened = null; // "SHALLOW" | "STEEP" while a correction is needed
  let prepOutSide = null;
  const fired = new Set();
  const since = {};
  const once = (key) => (fired.has(key) ? false : (fired.add(key), true));
  // true once `cond` has held for `hold` seconds; then again every `repeat`
  // seconds while it still holds (a reminder), never on every frame
  const fireAt = {};
  const held = (key, cond, t, hold, repeat = Infinity) => {
    if (!cond) {
      delete since[key];
      delete fireAt[key];
      return false;
    }
    if (since[key] === undefined) since[key] = t;
    if (t - since[key] < hold) return false;
    if (fireAt[key] !== undefined && t - fireAt[key] < repeat) return false;
    fireAt[key] = t;
    return true;
  };
  const live = (fn) => () => !!latest && !latest.outcome && fn(latest);

  return function update(u) {
    const out = [];
    if (!u) return { requests: out, blackout: false, link: 1 };
    latest = u;
    const t = u.realT || 0;
    const entry = u.phase === "ENTRY";
    const chutes = (u.drogue && u.drogue.alt !== null) || (u.main && u.main.alt !== null);
    const hyper = entry && u.vel > 3000 && !chutes;
    const blackout = entry && !!u.blackout;
    // The link degrades from a heat rate of ~6 W/cm² to the blackout threshold (20).
    const link = blackout ? 0 : entry && u.vel > 6000 && !chutes ? clamp(1 - (u.q - 6) / 16, 0.3, 1) : 1;
    const gRising = u.g > prevG + 0.01;
    prevG = u.g;

    if (u.phase === "APPROACH" && once("approach")) out.push({ id: "reentry.approach", delay: 0.8 });

    if (u.phase === "PREP") {
      if (once("sep")) out.push({ id: "reentry.separation", delay: 0.4 });
      const side = u.inBand ? null : u.prepFpa > TARGET_FPA ? "SHALLOW" : "STEEP";
      if (held("prepOut", !!side && side === prepOutSide, t, 1.2, 9) && fired.has("sep")) {
        out.push({
          id: side === "SHALLOW" ? "reentry.prepShallow" : "reentry.prepSteep",
          relevant: () => latest && latest.phase === "PREP" && !latest.inBand,
        });
      }
      prepOutSide = side;
      if (u.inBand && u.attitudeReady && once("prepGo")) {
        // "Go for entry... see you on the other side": the blackout warning
        // rides on this call, because the plasma closes the link about a
        // second after entry interface in real time.
        out.push({ id: "reentry.prepGo", relevant: () => latest && latest.phase === "PREP" && latest.inBand });
      }
    }

    if (entry) {
      if (once("ei")) out.push({ id: "reentry.ei", delay: 0.3 });
      // Fallback when "go for entry" was never said (committed outside the band, or a training ENTRY start)
      if (!blackout && hyper && !fired.has("prepGo") && once("blackoutExpected")) out.push({ id: "reentry.blackoutExpected", relevant: live((x) => !x.blackout) });
      if (blackout) hadBlackout = true;

      if (hyper) {
        // Prediction-driven lift calls, and the recovery when they work
        const skip = u.pred === "SHALLOW";
        const steep = u.pred === "STEEP";
        if (held("shallow", skip, t, 0.8, 8)) {
          threatened = "SHALLOW";
          out.push({ id: "reentry.shallow", relevant: live((x) => x.pred === "SHALLOW") });
        }
        if (held("steep", steep, t, 0.8, 8)) {
          threatened = "STEEP";
          out.push({ id: "reentry.steep", relevant: live((x) => x.pred === "STEEP") });
        }
        if (threatened && held("recovered", u.pred === "NOMINAL", t, 1.5)) {
          threatened = null;
          out.push({ id: "reentry.recovered", relevant: live((x) => x.pred === "NOMINAL") });
        }
        if (held("climb", u.climbing, t, 1, 8)) out.push({ id: "reentry.climbWarning", relevant: live((x) => x.climbing) });
        if (!blackout && u.q > 10 && once("heating")) out.push({ id: "reentry.heating", relevant: live((x) => !x.blackout) });
        if (!blackout && u.g > 3 && gRising && once("peakDecel")) out.push({ id: "reentry.peakDecel", relevant: live((x) => !x.blackout) });
      }
      // Onboard alarms: these are heard even in blackout
      if (held("heatAlarm", u.overheat > 0 || u.q > LIMITS.heatRateDesign * 0.92, t, 0.3, 6)) out.push({ id: "reentry.heatWarning", relevant: live((x) => x.overheat > 0 || x.q > LIMITS.heatRateDesign * 0.85) });
      if (held("gAlarm", u.g > LIMITS.structuralG * 0.7 && gRising, t, 0.3, 6)) out.push({ id: "reentry.gWarning", relevant: live((x) => x.g > LIMITS.structuralG * 0.6) });

      if (hadBlackout && !blackout && !u.outcome && once("aos")) out.push({ id: "reentry.aos", delay: 1.1, relevant: live((x) => !x.blackout && !x.climbing) });
      if (u.drogue && u.drogue.alt !== null && once("drogue")) out.push({ id: "reentry.drogues", delay: 0.5 });
      if (u.main && u.main.alt !== null && once("main")) out.push({ id: "reentry.mains", delay: 0.6 });
    }

    if (u.phase === "SPLASHED" && once("splash")) out.push({ id: "reentry.splashdown", delay: 0.9 }, { id: "reentry.splashFlight", delay: 2.5 });
    if (u.phase === "FAILED" && once("failed")) {
      if (u.outcome === "SKIP_OUT") out.push({ id: "reentry.skipOut", delay: 0.3 }, { id: "reentry.corridorLost", delay: 1.5 });
      else out.push({ id: "reentry.los", delay: 0.8 });
    }
    return { requests: out, blackout, link };
  };
}
