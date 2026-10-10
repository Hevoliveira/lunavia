/*
 * LUNAVIA — reentry guidance, difficulty and presentation pacing.
 * Nothing here changes the physics in reentryPhysics.js; difficulty only
 * changes what the crew is told, how precisely the entry is targeted and
 * how much help the flight computer gives.
 */
import { NOMINAL_FPA } from "./reentryPhysics";

export const TARGET_FPA = NOMINAL_FPA;

// FPA trim sensitivity of the final corridor-correction burn (deg per m/s).
export const TRIM_SENSITIVITY = 0.3;
export const TRIM_RATE = 0.5; // m/s of RCS Δv per real second while a trim key is held

/*
 * band: guidance tolerance around TARGET_FPA for the "GO FOR ENTRY" call.
 *   The physics corridor under ideal lift modulation is about -5.5° to -7.2°
 *   (see CORRIDOR in reentryPhysics.js), so the originally proposed ±2.5° /
 *   ±1.5° bands would have called fatal angles "GO". Bands are narrowed to
 *   stay inside the physical corridor; they are advisory, not pass/fail.
 * initialError: magnitude of the entry-angle dispersion to trim out in ENTRY PREP.
 */
export const ENTRY_DIFFICULTY = {
  CADET: {
    band: 0.7,
    initialError: 0.6,
    rcsBudget: 8,
    corridorZones: true,
    prediction: true,
    bankCue: true,
    liftAssist: true,
    climbWarning: true,
  },
  ASTRONAUT: {
    band: 0.5,
    initialError: 1.2,
    rcsBudget: 7,
    corridorZones: true,
    prediction: true,
    bankCue: false,
    liftAssist: false,
    climbWarning: true,
  },
  COMMANDER: {
    band: 0.3,
    initialError: 1.8,
    rcsBudget: 6.5,
    corridorZones: false,
    prediction: false,
    bankCue: false,
    liftAssist: false,
    climbWarning: false,
  },
};

export const PREP_SECONDS = 18; // real seconds before automatic entry interface
export const APPROACH_SECONDS = 4;

/*
 * Presentation time scale (simulation seconds per real second). The physics
 * always advances in fixed SIM_DT steps; only the number of steps per frame
 * changes. Critical flight runs slowest so the player can react.
 */
export function timeScaleFor(s) {
  if (s.mainT !== null) return s.t - s.mainT < 9 ? 3 : 32;
  if (s.drogueT !== null) return s.t - s.drogueT < 4 ? 3 : 9;
  if (s.v < 3000) return 18;
  const pastPeak = s.peak.heatRate > 15 && s.heatRate < s.peak.heatRate * 0.97;
  if (!pastPeak) return s.heatRate > 15 || s.gLoad > 0.4 ? 4 : 10;
  if (s.gLoad > 3) return 6;
  if (s.heatRate > 15) return 16;
  return 24;
}

// Communication blackout: the plasma sheath is dense enough to block S-band.
export function inBlackout(s) {
  return s.drogueT === null && s.v > 6000 && s.heatRate > 20;
}

// 0..1 plasma intensity for presentation, driven by the stagnation heat rate.
export function plasmaLevel(s) {
  if (s.drogueT !== null) return 0;
  return Math.min(1.25, Math.max(0, (s.heatRate - 2) / 180));
}

export const SPEED_OF_SOUND = 300; // m/s, representative stratospheric value

export function flightPhase(s) {
  if (!s) return "ENTRY PREP";
  if (s.outcome === "SPLASHDOWN" || s.h <= 0) return "SPLASHDOWN";
  if (s.mainT !== null) return "MAIN CHUTES";
  if (s.drogueT !== null) return "DROGUE CHUTES";
  if (s.v < SPEED_OF_SOUND) return "SUBSONIC";
  if (s.v < 3000) return "ATMOSPHERIC FLIGHT";
  // Peak heating: the heat pulse has flattened (rising < 2 %/s) or has only just turned over.
  const q = s.heatRate;
  const rising = s.heatRateDot > 0;
  if (q > 60 && ((rising && s.heatRateDot / q < 0.02) || (!rising && q > s.peak.heatRate * 0.85))) return "PEAK HEATING";
  if (q > 15 && rising) return "PLASMA BUILDUP";
  if (s.heatRate > 15) return "DECELERATION";
  if (s.heatRate > 1.5) return s.peak.heatRate > 15 ? "DECELERATION" : "INITIAL IONIZATION";
  return s.t < 15 ? "ENTRY INTERFACE" : "UPPER ATMOSPHERE";
}
