/*
 * LUNAVIA — Training Center flight instructor.
 *
 * One callout at a time, chosen from the live simulation values the HUD
 * already shows (descent assessment, prediction, heating, G, chute state).
 * Nothing here feeds back into the simulation or pauses it.
 *
 *   CADET      frequent callouts, each with a one-line explanation
 *   ASTRONAUT  concise callouts: the warnings and key events only
 *   COMMANDER  the objective and the outcome, nothing else
 *
 * A callout is { title, text, tone: "info" | "warn" | "good", say? }. `say`
 * is the short phrase the optional instructor voice speaks.
 */
import { DANGER, CAUTION } from "./descentProfile";
import { LIMITS, CHUTES, CORRIDOR } from "./reentryPhysics";
import { TARGET_FPA } from "./reentryGuidance";

export const COACH_LEVEL = { CADET: "full", ASTRONAUT: "key", COMMANDER: "minimal" };

const INTRO_S = 6; // seconds the opening line stays up
const HOLD_S = 4; // an event callout stays at least this long

const line = (tone) => (title, text, say) => ({ title, text, tone, say });
const info = line("info");
const warn = line("warn");
const good = line("good");
const f1 = (x) => x.toFixed(1);

/* ------------------------------------------------------------------------ */
/* Lunar landing                                                             */
/* ------------------------------------------------------------------------ */

const LANDING_INTRO = {
  standard: {
    full: info("STANDARD LANDING", "Hold THR to brake. Keep V/S inside the TGT V/S band; steer to the LZ."),
    key: info("STANDARD LANDING", "Land safely inside the primary LZ."),
  },
  precision: {
    full: info("LZ 35 M WEST", "Translate with ◄ RCS; arrive over the centre with H/S near 0."),
    key: info("PRECISION LANDING", "Touch down within 3 m of the LZ centre."),
  },
  braking: {
    full: info("BRAKING PRACTICE", "Falling fast. BRAKE counts down to the burn: hold THR when it reaches 0."),
    key: info("BRAKING PRACTICE", "Brake in time and keep a reserve."),
  },
  commander: {
    minimal: info("COMMANDER CHALLENGE", "Land safely inside the primary LZ. No coaching."),
  },
};

/**
 * Lunar callout. `d` carries what the descent HUD shows:
 * { t, alt, vy, vx, tilt, cfg, profile, projectedHazard, projectedZone,
 *   distanceToLZ, outcome: null | "landed" | "crashed" }.
 */
export function landingCoach(d, scenarioId, difficulty) {
  if (!d) return null;
  const level = COACH_LEVEL[difficulty] || "full";
  if (d.outcome === "landed") return good("SAFE TOUCHDOWN", "Contact light. Engine stop.", "Safe touchdown.");
  if (d.outcome === "crashed") return warn("HARD CONTACT", "Touchdown outside the vehicle's limits.");
  const { t, alt, vy, vx, cfg, profile: a } = d;
  const intro = LANDING_INTRO[scenarioId] || LANDING_INTRO.standard;
  if (t < INTRO_S) return intro[level] || intro.key || intro.full || intro.minimal;
  if (level === "minimal") return null;
  const full = level === "full";
  const env = a.envelope || { lo: 0, hi: 0 };

  if (d.projectedHazard && alt > 5) {
    return warn("HAZARD AT TOUCHDOWN POINT", full ? "Projected touchdown is on rough ground. Translate toward the LZ." : "Translate clear.", "Hazard ahead. Translate.");
  }
  if (a.vyState >= DANGER || (a.vyState >= CAUTION && a.brakeTime < 1.5) || a.brakeTime < 0.5) {
    return warn(
      "DESCENT RATE HIGH — BEGIN BRAKING",
      full ? `V/S ${f1(vy)} m/s; target band ${f1(env.lo)}–${f1(env.hi)}. Hold THR until V/S is in the band.` : `Target ${f1(env.lo)}–${f1(env.hi)} m/s.`,
      "Descent rate high. Begin braking."
    );
  }
  if (a.vxState >= CAUTION || (Math.abs(vx) > cfg.safeVx && alt < 80)) {
    return warn(
      "HORIZONTAL VELOCITY EXCESSIVE",
      full ? `H/S ${f1(vx)} m/s, limit ${cfg.safeVx}. Tap ${vx > 0 ? "◄ RCS" : "RCS ►"} to null it.` : `H/S ${f1(vx)}, limit ${cfg.safeVx}.`,
      "Horizontal velocity excessive."
    );
  }
  if (a.tiltState >= CAUTION) {
    return warn("ATTITUDE", full ? "Level the LM: tilt back toward 0° before contact." : "Level the LM.", "Level the vehicle.");
  }
  if (a.fuelState >= CAUTION) {
    const r = Number.isFinite(a.reserve) ? Math.max(0, Math.round(a.reserve)) : 0;
    return warn("FUEL RESERVE LOW", full ? `${r} s of hover reserve. Descend steadily; don't hover high.` : `${r} s of hover reserve.`, "Fuel reserve low.");
  }
  if (Number.isFinite(a.brakeTime) && a.brakeTime < 8) {
    return info("BRAKING ALTITUDE", full ? `Braking burn due in ${Math.ceil(a.brakeTime)} s. Hold THR when BRAKE reaches 0.` : `Burn in ${Math.ceil(a.brakeTime)} s.`);
  }
  if (d.projectedZone === "PRIMARY LZ" && alt > 15 && alt < 150 && d.distanceToLZ < 40) {
    return good("LANDING ZONE AHEAD", full ? "Projected touchdown is on the primary LZ. Keep H/S near 0." : "On the primary LZ.", "Landing zone ahead.");
  }
  if (alt < 40) return info("FINAL APPROACH", `V/S < ${cfg.safeVy} · H/S < ${cfg.safeVx} · TILT < ${cfg.safeTilt}°`);
  if (!full) return null;
  if (scenarioId === "precision") return info("TRANSLATE", "Steer toward the LZ while high; arrive above the centre with H/S near 0.");
  if (scenarioId === "braking") return info("RESERVE", "Ride the TGT V/S band. RESERVE is your hover time beyond the landing minimum.");
  return info("PROFILE", "Keep V/S in the TGT V/S band. RESERVE = hover time left.");
}

/* ------------------------------------------------------------------------ */
/* Earth reentry                                                             */
/* ------------------------------------------------------------------------ */

const REENTRY_INTRO = {
  nominal: {
    full: info("ENTRY ANGLE", "Meet the air at about −6.5°. The green band is the safe corridor."),
    key: info("NOMINAL ENTRY", "Trim into the corridor, commit, fly to splashdown."),
  },
  shallow: {
    full: warn("SHALLOW EDGE OF CORRIDOR", "Committed at −5.7° with lift up: held like this it skips back to space. Roll lift DOWN.", "Shallow entry. Roll lift down."),
    key: warn("SHALLOW EDGE OF CORRIDOR", "Committed at −5.7°, lift up. Avoid the skip-out."),
  },
  steep: {
    full: warn("STEEP EDGE OF CORRIDOR", "Committed at −6.9° with lift down: held like this the loads break the capsule. Roll lift UP.", "Steep entry. Roll lift up."),
    key: warn("STEEP EDGE OF CORRIDOR", "Committed at −6.9°, lift down. Keep heating and G in limits."),
  },
  commander: {
    minimal: info("COMMANDER REENTRY", "Trim, commit and fly to splashdown. No coaching."),
  },
};

/**
 * Reentry instructor. `u` is the ReentryGame telemetry snapshot plus `inBand`.
 * Keeps a little memory (what was shown, the last prediction) so it can call
 * events once and notice when a predicted failure has been recovered.
 */
export function createReentryCoach(scenarioId, difficulty) {
  const level = COACH_LEVEL[difficulty] || "full";
  const full = level === "full";
  const intro = REENTRY_INTRO[scenarioId] || REENTRY_INTRO.nominal;
  const introLine = intro[level] || intro.key || intro.full || intro.minimal;
  const shown = new Set();
  let held = null;
  let heldAt = -Infinity;
  let t0 = null;
  let lastPred = null;
  let threatened = false;
  let lastG = 0;

  const event = (id, l, t) => {
    if (shown.has(id)) return null;
    shown.add(id);
    held = l;
    heldAt = t;
    return l;
  };

  return function coach(u) {
    if (!u || u.phase === "APPROACH") return null;
    if (u.phase === "SPLASHED") return good("SPLASHDOWN", u.splashV ? `In the water at ${f1(u.splashV)} m/s.` : "In the water.", "Splashdown.");
    if (u.phase === "FAILED") return warn("VEHICLE LOST", "See the debrief for what happened.");
    const t = u.realT;
    if (t0 === null) t0 = t;
    if (t - t0 < INTRO_S) return introLine;
    if (level === "minimal") return null;
    const entry = u.phase === "ENTRY";
    const hyper = entry && u.vel > 3000 && !(u.drogue && u.drogue.alt !== null);
    const gRising = u.g > lastG + 0.02;
    lastG = u.g;

    // ENTRY PREP: corridor status of the planned angle
    if (u.phase === "PREP") {
      if (!u.inBand) {
        const shallow = u.prepFpa > TARGET_FPA;
        return warn(
          shallow ? "ENTRY CORRIDOR TOO SHALLOW" : "ENTRY CORRIDOR TOO STEEP",
          full
            ? `Planned EI ${f1(u.prepFpa)}°. Trim ${shallow ? "↓ steeper" : "↑ shallower"} toward ${TARGET_FPA.toFixed(1)}° (corridor ${CORRIDOR.shallowEdge}° to ${CORRIDOR.steepEdge}°).`
            : `Planned EI ${f1(u.prepFpa)}°. Trim toward ${TARGET_FPA.toFixed(1)}°.`,
          shallow ? "Entry corridor too shallow." : "Entry corridor too steep."
        );
      }
      if (u.attitudeReady) return good("GO FOR ENTRY", full ? "In the corridor. Keep lift UP (0°), then COMMIT TO ENTRY." : "In the corridor. Commit.");
      return full ? info("ENTRY ATTITUDE", "Turning heat shield forward. Lift UP flattens the path; lift DOWN steepens it.") : null;
    }
    if (!entry) return null;

    // Prediction-driven: adjust the lift vector, and notice the recovery
    if (hyper && u.pred) {
      if (u.pred === "SHALLOW" || u.pred === "STEEP") threatened = true;
      else if (threatened && lastPred && lastPred !== "NOMINAL") {
        threatened = false;
        held = good("TRAJECTORY RECOVERED", full ? "Prediction back to nominal capture. Hold this lift vector." : "Nominal capture.", "Trajectory recovered.");
        heldAt = t;
      }
      lastPred = u.pred;
    }
    if (hyper && (u.pred === "SHALLOW" || (u.climbing && u.g < 3))) {
      return warn("ADJUST LIFT VECTOR", full ? "Skip-out predicted: roll lift DOWN to stay in the atmosphere." : "Skip-out predicted — lift down.", "Adjust lift vector. Lift down.");
    }
    if (hyper && u.pred === "STEEP") {
      return warn("ADJUST LIFT VECTOR", full ? "Overload predicted: roll lift UP to flatten the dive." : "Overload predicted — lift up.", "Adjust lift vector. Lift up.");
    }
    if (hyper && (u.q > LIMITS.heatRateDesign * 0.8 || u.overheat > 0)) {
      return warn(
        "HEATING APPROACHING LIMIT",
        full ? `${Math.round(u.q)} W/cm² of ${LIMITS.heatRateDesign} design. Lift up keeps the capsule higher, in thinner air.` : `${Math.round(u.q)} W/cm² of ${LIMITS.heatRateDesign}.`,
        "Heating approaching limit."
      );
    }
    if (hyper && u.g > 6 && gRising) {
      return warn("G-LOAD INCREASING", full ? `${f1(u.g)} g and rising. Structure rated ${LIMITS.structuralG} g; lift up spreads the slowdown.` : `${f1(u.g)} g, limit ${LIMITS.structuralG}.`, "G load increasing.");
    }

    // Events: held for a few seconds each
    if (held && t - heldAt < HOLD_S) return held;
    if (u.drogue && u.drogue.alt !== null) {
      const l = event("drogue", good("PARACHUTE CONDITIONS MET", full ? `Below ${(CHUTES.drogue.maxAlt / 1000).toFixed(1)} km and ${CHUTES.drogue.maxSpeed} m/s: drogues out. Mains follow below ${(CHUTES.main.maxAlt / 1000).toFixed(1)} km.` : "Drogues deployed.", "Parachute conditions met."), t);
      if (l) return l;
    }
    if (u.main && u.main.alt !== null) {
      const l = event("main", good("MAIN CHUTES", full ? "Three mains open. Descent to the ocean under canopy." : "Mains open."), t);
      if (l) return l;
    }
    if (full) {
      const l =
        (u.blackout && event("blackout", info("COMM BLACKOUT", "Hot plasma blocks the radio. Normal: fly the gauges."), t)) ||
        (u.q > 60 && event("heat", info("HEATING", `Peak heating builds. Shield design limit ${LIMITS.heatRateDesign} W/cm².`), t)) ||
        (u.shield > 0.5 && event("thermal", warn("THERMAL LOAD", `Shield ${Math.round(u.shield * 100)} % used. Don't dive deeper while fast.`), t)) ||
        (u.vel < 3000 && event("done", info("ENTRY COMPLETE", `Lift no longer matters. Drogues open below ${(CHUTES.drogue.maxAlt / 1000).toFixed(1)} km.`), t)) ||
        (scenarioId === "nominal" && event("bank", info("LIFT VECTOR", "Lift UP flattens the path; lift DOWN steepens it. Roll ← / →."), t));
      if (l) return l;
    }
    return held && t - heldAt < HOLD_S * 2 ? held : null;
  };
}
