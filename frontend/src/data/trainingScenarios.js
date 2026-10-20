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
 *
 * Lunar landing training is flown at a chosen landing site (landingSites):
 * a scenario's start is placed on the site's approach (its side and offset),
 * and "the primary landing zone" is the site's. The full mission always flies
 * its own site (MISSION_SITE_ID).
 */
import { DIFFICULTY } from "./landingPhysics";
import { stepLander } from "./landerSim";
import { getSite, siteStart } from "./landingSites";
import { NOMINAL_FPA, OUTCOME } from "./reentryPhysics";

export const DIFFICULTY_KEYS = ["CADET", "ASTRONAUT", "COMMANDER"];

/*
 * PRECISION starts mid-descent in the state a reference descent actually has
 * at 120 m: the guided pilot of landerPilots.js (reaction lag, tap length,
 * HUD refresh) flying the full descent from the difficulty's own start.
 * Descent rate is that pilot's; fuel is rounded DOWN from what it has left,
 * so a training start is never more generous than the mission at that point;
 * the engine is running (throttle 1) because that pilot was mid-burn there.
 */
export const REFERENCE_STATE = {
  precision: {
    CADET: { vy: -23.5, fuelFrac: 0.95, throttle: 1 },
    ASTRONAUT: { vy: -21.8, fuelFrac: 0.8, throttle: 1 },
    COMMANDER: { vy: -19.9, fuelFrac: 0.6, throttle: 1 },
  },
};

/*
 * BRAKING starts from the site's mission start state after the LM has coasted
 * engine-off for COAST_S seconds: same integrator, same full tank, nothing
 * changed but the braking burn is now about 5 s away (at Tranquillity: CADET
 * 279 m at −20 m/s, ASTRONAUT 389 m at −24 m/s, COMMANDER 529 m at −30 m/s).
 */
export const COAST_S = 10;
export function coastedStart(cfg, site = getSite(), seconds = COAST_S) {
  const p = siteStart(site, cfg);
  const dt = 1 / 120;
  for (let t = 0; t < seconds - 1e-9; t += dt) stepLander(p, {}, cfg, dt, site.contactGround);
  return { alt: p.alt, y: p.y, vy: p.vy, vx: p.vx, xPos: p.xPos, fuel: p.fuel, throttle: 0 };
}

// "Near the centre" for the precision objective: the EXCELLENT accuracy band.
export const PRECISION_RADIUS = 3;

// Precision: where the attempt starts, past the LZ (m, along the approach).
export const PRECISION_PAST = 35;

/*
 * `objective(site)` is the scenario's objective at a landing site, and
 * `init(key, site)` its start (null: the site's mission start). Starts are
 * placed on the site's approach: past the LZ means beyond it in the direction
 * of flight.
 */
export const LANDING_SCENARIOS = [
  {
    id: "standard",
    title: "STANDARD LANDING",
    tag: "FUNDAMENTALS",
    summary: "The full powered descent from the difficulty's mission start state.",
    objective: (site = getSite()) => `Land safely inside the primary landing zone (within ${site.primary.r} m of its centre).`,
    teaches: ["Throttle against the TGT V/S band", "Braking countdown", "Steering to the LZ"],
    init: () => null,
  },
  {
    id: "precision",
    title: "PRECISION LANDING",
    tag: "ACCURACY",
    summary: `120 m and already braking, ${PRECISION_PAST} m past the primary LZ: translate back over the terrain.`,
    objective: () => `Land safely within ${PRECISION_RADIUS} m of the LZ centre.`,
    teaches: ["RCS translation back over hazards", "Arriving with no drift", "Touchdown accuracy"],
    init: (key, site = getSite()) => {
      const cfg = DIFFICULTY[key];
      const r = REFERENCE_STATE.precision[key];
      const d = site.approach.dir;
      return { alt: 120, vy: r.vy, vx: -2 * d, xPos: PRECISION_PAST * d, fuel: cfg.initialFuel * r.fuelFrac, throttle: r.throttle };
    },
  },
  {
    id: "braking",
    title: "BRAKING PRACTICE",
    tag: "THROTTLE MANAGEMENT",
    summary: `The mission start after ${COAST_S} s of coasting engine-off: falling fast, full tank, braking burn due in about 5 s.`,
    objective: () => "Brake in time and land safely, keeping a fuel reserve.",
    teaches: ["Braking altitude", "Vertical-speed target band", "Fuel reserve"],
    init: (key, site = getSite()) => coastedStart(DIFFICULTY[key], site),
  },
  {
    id: "commander",
    title: "COMMANDER CHALLENGE",
    tag: "QUALIFICATION",
    summary: "The full COMMANDER descent: 750 m, −14 m/s, tight fuel and touchdown limits.",
    objective: () => "Land safely inside the primary landing zone on COMMANDER limits, with minimal guidance.",
    teaches: ["Everything, with no coaching"],
    lock: "COMMANDER",
    init: () => null,
  },
];

/** The objective's distance limit at a site, m (null: any safe landing). */
export const objectiveRadius = (scenarioId, site = getSite()) =>
  scenarioId === "precision" ? PRECISION_RADIUS : scenarioId === "standard" || scenarioId === "commander" ? site.primary.r : null;

/** Did a graded touchdown meet the scenario's objective at the site? (result = gradeLanding output) */
export function landingObjectiveMet(scenarioId, result, site = getSite()) {
  if (!result || result.crashed) return false;
  const rad = objectiveRadius(scenarioId, site);
  return rad === null || result.breakdown.accuracy.distance < rad;
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

/*
 * Orbital docking training: straight to the final-approach checkpoint in lunar orbit (no
 * landing, no ascent, no rendezvous film), the mission's own docking simulation
 * (data/dockingSim), its assists, guidance and capture rules. `start(difficulty)` returns the
 * checkpoint overrides (null: the difficulty's own mission checkpoint), which RESTART DOCKING
 * also returns to.
 */
export const DOCKING_SCENARIOS = [
  {
    id: "approach",
    title: "FINAL APPROACH AND DOCKING",
    tag: "FUNDAMENTALS",
    summary: "The rendezvous hands over: the ascent stage is behind the CSM, a little off its docking axis, closing slowly.",
    objective: "Align, centre on the axis, match velocity and fly the final approach to a soft capture and hard dock.",
    teaches: ["Relative motion", "Attitude alignment", "Lateral alignment", "Velocity matching", "Final approach", "Docking contact"],
    start: () => null,
  },
  {
    id: "drift",
    title: "DRIFTING APPROACH",
    tag: "RELATIVE MOTION",
    summary: "The same place, but sliding sideways, turned off the axis and closing faster than is safe.",
    objective: "Stop the relative motion before closing in, line up, then dock.",
    teaches: ["Relative motion", "Velocity matching", "Attitude alignment", "Lateral alignment"],
    start: () => ({ offset: [1.4, -1.1], drift: [0.035, -0.025], closing: 0.18, att: [9, -6, 10] }),
  },
  {
    id: "commander",
    title: "COMMANDER DOCKING",
    tag: "QUALIFICATION",
    summary: "The mission's COMMANDER approach: no assists, no attitude hold, the strictest capture limits.",
    objective: "Dock by hand: attitude, translation and closing speed are all yours.",
    teaches: ["Everything, with no assists"],
    lock: "COMMANDER",
    start: () => null,
  },
];

export const scenarioList = (discipline) => (discipline === "reentry" ? REENTRY_SCENARIOS : discipline === "docking" ? DOCKING_SCENARIOS : LANDING_SCENARIOS);
export const findScenario = (discipline, id) => scenarioList(discipline).find((s) => s.id === id) || scenarioList(discipline)[0];
export const difficultyFor = (scenario, chosen) => scenario.lock || chosen;
