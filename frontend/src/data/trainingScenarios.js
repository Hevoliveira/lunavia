/*
 * LUNAVIA — Flight Training Center scenarios.
 *
 * Training flies the mission's own simulations: the lander integrator
 * (landerSim.js) with the mission's DIFFICULTY configs and touchdown grading,
 * and the reentry physics (reentryPhysics.js) with the mission's
 * ENTRY_DIFFICULTY guidance settings. A scenario only chooses where the
 * flight starts and what counts as meeting its objective. It never changes
 * thrust, fuel flow, limits, hazards or grading, and an objective is never
 * easier than a safe mission landing or splashdown.
 *
 * Every start state below is derived from the physics, and
 * trainingScenarios.test.js re-derives it.
 */
import { DIFFICULTY, PRIMARY_LZ } from "./landingPhysics";
import { NOMINAL_FPA, OUTCOME } from "./reentryPhysics";

export const DIFFICULTY_KEYS = ["CADET", "ASTRONAUT", "COMMANDER"];

/*
 * Mid-descent starts take the state a reference descent actually has at that
 * altitude: the guided pilot of landerPilots.js (reaction lag, tap length,
 * HUD refresh) flying the full descent from the difficulty's own start.
 * Descent rate is that pilot's; fuel is rounded DOWN from what it has left,
 * so a training start is never more generous than the mission at that point;
 * the engine is running (throttle 1) where that pilot was mid-burn over the
 * last second, and off where it was still coasting to its braking burn.
 */
export const REFERENCE_STATE = {
  // altitude 220 m
  drift: {
    CADET: { vy: -24.5, fuelFrac: 1.0, throttle: 0 },
    ASTRONAUT: { vy: -28.0, fuelFrac: 0.9, throttle: 1 },
    COMMANDER: { vy: -25.8, fuelFrac: 0.75, throttle: 1 },
  },
  // altitude 120 m
  precision: {
    CADET: { vy: -23.5, fuelFrac: 0.95, throttle: 1 },
    ASTRONAUT: { vy: -21.8, fuelFrac: 0.8, throttle: 1 },
    COMMANDER: { vy: -19.9, fuelFrac: 0.6, throttle: 1 },
  },
};

export const LANDING_SCENARIOS = [
  {
    id: "guided",
    title: "GUIDED DESCENT",
    tag: "FUNDAMENTALS",
    summary: "The full powered descent from the difficulty's start state.",
    objective: "Land safely: vertical speed, drift and tilt inside the limits, on safe ground.",
    teaches: ["Throttle against the TGT V/S band", "Braking countdown", "Hover reserve"],
    init: () => null,
  },
  {
    id: "drift",
    title: "HORIZONTAL VELOCITY CORRECTION",
    tag: "LATERAL CONTROL",
    summary: "220 m, already braking, with a 10 m/s eastward drift that would carry the LM over a crater.",
    objective: "Null the drift and land safely.",
    teaches: ["RCS translation", "Reading H/S", "Holding the descent while correcting"],
    altitude: 220,
    init: (key) => {
      const cfg = DIFFICULTY[key];
      const r = REFERENCE_STATE.drift[key];
      return { alt: 220, vy: r.vy, vx: 10, xPos: -10, fuel: cfg.initialFuel * r.fuelFrac, throttle: r.throttle };
    },
  },
  {
    id: "precision",
    title: "PRECISION LANDING",
    tag: "ACCURACY",
    summary: "120 m, 35 m past the primary LZ on the far side of a crater.",
    objective: `Land safely inside the primary LZ (within ${PRIMARY_LZ.r} m of its centre).`,
    teaches: ["Translating back over hazards", "Arriving with no drift", "Touchdown accuracy"],
    altitude: 120,
    init: (key) => {
      const cfg = DIFFICULTY[key];
      const r = REFERENCE_STATE.precision[key];
      return { alt: 120, vy: r.vy, vx: -2, xPos: 35, fuel: cfg.initialFuel * r.fuelFrac, throttle: r.throttle };
    },
  },
  {
    id: "commander",
    title: "COMMANDER CHALLENGE",
    tag: "QUALIFICATION",
    summary: "The full COMMANDER descent: 750 m, −14 m/s, tight fuel and touchdown limits.",
    objective: "Land safely on COMMANDER limits with minimal guidance.",
    teaches: ["Everything, with no coaching"],
    lock: "COMMANDER",
    init: () => null,
  },
];

/** Did a graded touchdown meet the scenario's objective? (result = gradeLanding output) */
export function landingObjectiveMet(scenarioId, result) {
  if (!result || result.crashed) return false;
  if (scenarioId === "precision") return result.breakdown.accuracy.distance < PRIMARY_LZ.r;
  return true;
}

/*
 * Reentry starts. The shallow and steep angles come from a sweep of the
 * deterministic physics flown by a simulated crew with a reaction delay, the
 * physical 20°/s roll rate and real-time pacing (trainingScenarios.test.js):
 *  - SHALLOW −5.7°, lift up: holding the attitude skips out at every angle
 *    from −5.2° to −5.9°; managing the lift vector recovers from −5.5° to
 *    −5.9°, so −5.7° sits mid-band. Holding lift down instead overloads the
 *    capsule, so the scenario needs management, not one roll.
 *  - STEEP −6.9°, lift down: doing nothing breaks the capsule; rolling lift up
 *    recovers from −6.8° to −7.2° (peak ≈ 10–11 g against 8.6 g nominal).
 *    Holding lift up all the way skips out, so it also needs management.
 * Both start at entry interface, already committed: there is no prep burn
 * to trim the problem away.
 */
export const SHALLOW_FPA = -5.7;
export const STEEP_FPA = -6.9;

export const REENTRY_SCENARIOS = [
  {
    id: "nominal",
    title: "NOMINAL ENTRY",
    tag: "FUNDAMENTALS",
    summary: `Lunar-return entry at 11 km/s, planned at ${NOMINAL_FPA.toFixed(1)}°. Starts at ENTRY PREP.`,
    objective: "Set up the entry, commit, and fly the lift vector to splashdown.",
    teaches: ["Entry angle and corridor", "Lift-vector (bank) control", "Heating, G-load and parachutes"],
    start: () => ({ phase: "PREP", fpa: NOMINAL_FPA, bank: 0 }),
  },
  {
    id: "shallow",
    title: "SHALLOW ENTRY RECOVERY",
    tag: "SKIP-OUT",
    summary: `Committed at ${SHALLOW_FPA.toFixed(1)}° with the lift vector up: held like this, the capsule skips back to space.`,
    objective: "Avoid the atmospheric skip by managing the lift vector, then splash down.",
    teaches: ["Lift down to stay in the atmosphere", "Not over-correcting into high G"],
    start: () => ({ phase: "ENTRY", fpa: SHALLOW_FPA, bank: 0 }),
  },
  {
    id: "steep",
    title: "STEEP ENTRY RECOVERY",
    tag: "OVERLOAD",
    summary: `Committed at ${STEEP_FPA.toFixed(1)}° with the lift vector down: held like this, the loads break the capsule.`,
    objective: "Cut heating and deceleration by managing the lift vector, then splash down.",
    teaches: ["Lift up to flatten the dive", "Heat-shield and G limits", "Not skipping out afterwards"],
    start: () => ({ phase: "ENTRY", fpa: STEEP_FPA, bank: 180 }),
  },
  {
    id: "commander",
    title: "COMMANDER REENTRY CHALLENGE",
    tag: "QUALIFICATION",
    summary: "The mission's COMMANDER entry: a dispersed entry angle, a small RCS budget, no corridor zones, no prediction.",
    objective: "Trim, commit and fly to splashdown with minimal guidance.",
    teaches: ["Everything, with no coaching"],
    lock: "COMMANDER",
    // null fpa: the mission's own randomised dispersion for the difficulty
    start: () => ({ phase: "PREP", fpa: null, bank: 0 }),
  },
];

export const reentryObjectiveMet = (outcome) => outcome === OUTCOME.SPLASHDOWN;

export const scenarioList = (discipline) => (discipline === "reentry" ? REENTRY_SCENARIOS : LANDING_SCENARIOS);
export const findScenario = (discipline, id) => scenarioList(discipline).find((s) => s.id === id) || scenarioList(discipline)[0];
export const difficultyFor = (scenario, chosen) => scenario.lock || chosen;
