/*
 * LUNAVIA — Training Center instructor lines.
 *
 * Short, one-at-a-time hints shown beside the telemetry while training. They
 * are pure functions of the live telemetry the HUD already shows and never
 * feed back into the simulation or pause it.
 *
 *   CADET      explains what is happening and what to do about it
 *   ASTRONAUT  the objective, the touchdown / corridor limits and danger calls
 *   COMMANDER  the objective only
 */
import { DANGER, CAUTION } from "./descentProfile";
import { LIMITS, CHUTES } from "./reentryPhysics";

export const COACH_LEVEL = { CADET: "full", ASTRONAUT: "key", COMMANDER: "minimal" };

const INTRO_S = 6; // seconds the opening line stays up
const MIN_SHOW_S = 5; // an event line stays at least this long

const info = (title, text) => ({ title, text, tone: "info" });
const warn = (title, text) => ({ title, text, tone: "warn" });

/* ------------------------------------------------------------------------ */
/* Lunar landing                                                             */
/* ------------------------------------------------------------------------ */

const LANDING_INTRO = {
  guided: {
    full: info("GUIDED DESCENT", "Hold THR to brake. Keep V/S inside the TGT V/S band."),
    key: info("GUIDED DESCENT", "Land safely. The TGT V/S band and the BRAKE cue are your guide."),
  },
  drift: {
    full: info("DRIFT 10 M/S EAST", "Tap ◄ RCS to null H/S, steer back to the LZ, keep braking."),
    key: info("DRIFT CORRECTION", "10 m/s eastward drift. Null it and land safely."),
  },
  precision: {
    full: info("LZ 35 M WEST", "Translate with ◄ RCS; arrive over the LZ with H/S near 0."),
    key: info("PRECISION LANDING", "Touch down inside the primary LZ, 35 m west."),
  },
  commander: {
    minimal: info("COMMANDER CHALLENGE", "Land safely on COMMANDER limits."),
  },
};

/**
 * Lunar instructor line. `d` carries what the descent HUD shows:
 * { t, alt, vy, vx, tilt, cfg, profile, projectedHazard, distanceToLZ, ended }.
 */
export function landingCoach(d, scenarioId, difficulty) {
  if (!d || d.ended) return null;
  const level = COACH_LEVEL[difficulty] || "full";
  const { t, alt, vx, tilt, cfg, profile: a } = d;
  const intro = LANDING_INTRO[scenarioId] || LANDING_INTRO.guided;
  if (t < INTRO_S) return intro[level] || intro.key || intro.full || intro.minimal;
  if (level === "minimal") return null;

  const limits = `V/S < ${cfg.safeVy} · H/S < ${cfg.safeVx} · TILT < ${cfg.safeTilt}°`;
  if (d.projectedHazard && alt > 5) {
    return warn("HAZARD AHEAD", level === "full" ? "Touchdown point is on rough ground. Translate toward the LZ." : "Touchdown point is on rough ground.");
  }
  if (level === "key") return alt < 40 ? info("TOUCHDOWN LIMITS", limits) : null;

  // CADET: explain the most important thing right now.
  if (a.vyState >= DANGER) return warn("TOO FAST", "Too fast for this height. Hold THR until V/S is in the band.");
  if (a.vyState >= CAUTION && a.brakeTime < 1.5) return warn("BRAKING BURN", "Start the braking burn: hold THR.");
  if (Math.abs(vx) > cfg.safeVx && (a.vxState >= CAUTION || alt < 80)) {
    return warn("DRIFT", `H/S ${vx.toFixed(1)} m/s: tap ${vx > 0 ? "◄ RCS" : "RCS ►"} to null it (limit ${cfg.safeVx}).`);
  }
  if (Math.abs(tilt) > cfg.safeTilt * 0.5) return info("ATTITUDE", "Level the LM: tilt back to 0° before contact.");
  if (a.fuelState >= CAUTION) return warn("FUEL", "Fuel low. Avoid hovering; descend steadily.");
  if (alt < 30) return info("FINAL APPROACH", limits);
  if (scenarioId === "precision") {
    return d.distanceToLZ > 6
      ? info("TRANSLATE", "Translate toward the LZ; arrive above it with H/S near 0.")
      : info("OVER THE LZ", "Hold H/S at 0 and settle straight down.");
  }
  if (scenarioId === "drift") return info("DRIFT", "Keep H/S near 0 while V/S follows the band.");
  return info("PROFILE", "Keep V/S in the TGT V/S band. RESERVE = hover time left.");
}

/* ------------------------------------------------------------------------ */
/* Earth reentry                                                             */
/* ------------------------------------------------------------------------ */

const REENTRY_INTRO = {
  nominal: {
    full: info("ENTRY ANGLE", "Meet the air at about −6.5°. The green band is the safe corridor."),
    key: info("NOMINAL ENTRY", "Trim into the corridor, commit, and fly to splashdown."),
  },
  shallow: {
    full: warn("SKIP RISK", "Too shallow with lift up: it will skip back to space. Roll lift DOWN."),
    key: warn("SHALLOW ENTRY", "Committed at −5.7°, lift up. Avoid the skip-out."),
  },
  steep: {
    full: warn("OVERLOAD RISK", "Too steep with lift down: loads will break the capsule. Roll lift UP."),
    key: warn("STEEP ENTRY", "Committed at −6.9°, lift down. Keep heating and G inside the limits."),
  },
  commander: {
    minimal: info("COMMANDER CHALLENGE", "Trim, commit and fly to splashdown. No coaching."),
  },
};

/**
 * Reentry instructor. Event lines are shown once and held for a few seconds;
 * danger calls override them while their condition lasts. `u` is the
 * ReentryGame telemetry snapshot plus `inBand`.
 */
export function createReentryCoach(scenarioId, difficulty) {
  const level = COACH_LEVEL[difficulty] || "full";
  const intro = REENTRY_INTRO[scenarioId] || REENTRY_INTRO.nominal;
  const introLine = intro[level] || intro.key || intro.full || intro.minimal;
  const shown = new Set();
  let current = null;
  let since = -Infinity;
  let t0 = null;

  const once = (id, line, t) => {
    if (shown.has(id)) return false;
    shown.add(id);
    current = line;
    since = t;
    return true;
  };

  return function coach(u) {
    if (!u || u.phase === "APPROACH") return null;
    if (u.phase === "SPLASHED" || u.phase === "FAILED") return null;
    const t = u.realT;
    if (t0 === null) t0 = t;
    if (t - t0 < INTRO_S) return introLine;
    if (level === "minimal") return null;

    const entry = u.phase === "ENTRY";
    const hypersonic = entry && u.vel > 3000;

    // Danger calls (prediction comes from the same physics, CADET / ASTRONAUT only)
    if (hypersonic && (u.pred === "SHALLOW" || (u.climbing && u.g < 3))) {
      return warn("ATMOSPHERIC SKIP", level === "full" ? "Skip-out ahead: roll lift DOWN to stay in the air." : "Skip-out predicted.");
    }
    if (hypersonic && (u.pred === "STEEP" || u.g > 7.5)) {
      return warn("G-LOAD / HEATING", level === "full" ? "Overload ahead: roll lift UP to flatten the dive." : "Overload predicted.");
    }
    if (level === "key") {
      if (u.phase === "PREP" && !u.inBand) return info("CORRIDOR", "EI angle off target: trim into the green band.");
      return null;
    }

    // CADET event lines
    if (current && t - since < MIN_SHOW_S) return current;
    if (u.phase === "PREP") {
      if (!u.inBand) return info("TRIM", "Trim ↑ shallower / ↓ steeper until the marker is in the green band.");
      if (u.attitudeReady && once("bank-prep", info("BANK", "Keep lift UP (0°) for now, then COMMIT TO ENTRY."), t)) return current;
      return current;
    }
    if (!entry) return null;
    if (scenarioId === "nominal" && once("bank", info("LIFT VECTOR", "Lift UP flattens the path; lift DOWN steepens it. Roll ← / →."), t)) return current;
    if (u.blackout && once("blackout", info("BLACKOUT", "Hot plasma blocks the radio. Normal: fly the gauges."), t)) return current;
    if (u.q > 60 && once("heat", info("HEATING", `Peak heating. Shield design limit ${LIMITS.heatRateDesign} W/cm²; lift up lowers it.`), t)) return current;
    if (u.g > 4 && once("g", info("G-LOAD", `${u.g.toFixed(1)} g now. Structure rated for ${LIMITS.structuralG} g.`), t)) return current;
    if (u.shield > 0.5 && once("thermal", warn("THERMAL LIMIT", `Shield ${Math.round(u.shield * 100)} % used. Don't dive deeper while fast.`), t)) return current;
    if (entry && u.vel < 3000 && once("done", info("ENTRY COMPLETE", `Lift no longer matters. Drogues open below ${(CHUTES.drogue.maxAlt / 1000).toFixed(1)} km.`), t)) return current;
    if (u.drogue && u.drogue.alt !== null && once("chutes", info("PARACHUTES", `Drogues steady it; mains open below ${(CHUTES.main.maxAlt / 1000).toFixed(1)} km, ${CHUTES.main.maxSpeed} m/s.`), t)) return current;
    return current && t - since < MIN_SHOW_S * 2 ? current : null;
  };
}
