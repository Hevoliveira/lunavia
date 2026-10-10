/*
 * LUNAVIA — Training debriefs.
 *
 * Every number here comes from the simulation that was flown: the lander's
 * graded touchdown (gradeLanding) or the reentry state (reentryPhysics). The
 * recommendation is chosen from what actually limited the attempt.
 */
import { PRIMARY_LZ } from "./landingPhysics";
import { LIMITS, OUTCOME } from "./reentryPhysics";
import { landingObjectiveMet, reentryObjectiveMet } from "./trainingScenarios";

const f1 = (x) => x.toFixed(1);

/*
 * Bank-control score. In the planar entry model only the vertical part of the
 * lift (cos bank) shapes the trajectory, so a bank agrees with the guidance
 * when its vertical lift is within 0.5 of the recommended one (left or right
 * roll alike). ReentryGame samples this during hypersonic flight.
 */
export const liftAgrees = (bankDeg, recDeg) =>
  Math.abs(Math.cos((bankDeg * Math.PI) / 180) - Math.cos((recDeg * Math.PI) / 180)) <= 0.5;

/* ------------------------------------------------------------------------ */

function landingAdvice(r, scenarioId, cfg) {
  const b = r.breakdown;
  const reasons = r.failureReasons;
  if (reasons.includes("FUEL DEPLETED BEFORE TOUCHDOWN")) {
    return "Fuel ran out in flight. Start the braking burn at the BRAKE cue and descend steadily instead of hovering high; RESERVE shows how much hover time you have.";
  }
  if (reasons.includes("UNSAFE TERRAIN")) {
    return `You touched down on ${r.zone}. Watch the ▾ projected-touchdown label and translate with RCS before 50 m.`;
  }
  if (reasons.includes("VERTICAL SPEED EXCEEDED SAFE LIMIT")) {
    return `Contact at ${f1(b.vy.value)} m/s against a ${cfg.safeVy} m/s limit. Below 30 m hold THR earlier so V/S is under ${f1(cfg.safeVy * 0.6)} m/s by 5 m.`;
  }
  if (reasons.includes("EXCESSIVE HORIZONTAL SPEED")) {
    return `Contact with ${f1(b.vx.value)} m/s of drift (limit ${cfg.safeVx}). Null H/S with short RCS taps before 20 m, then leave it alone.`;
  }
  if (reasons.includes("TILT EXCEEDED SAFE LIMIT")) {
    return `Contact at ${Math.round(b.tilt.value)}° of tilt (limit ${cfg.safeTilt}°). Use RCS, not tilt, for small corrections low down, and level the LM before contact.`;
  }
  if (scenarioId === "precision" && !landingObjectiveMet(scenarioId, r)) {
    return `Safe, but ${f1(b.accuracy.distance)} m from the LZ centre (needed under ${PRIMARY_LZ.r} m). Translate earlier and arrive above the LZ with H/S near 0.`;
  }
  // Landed nearly dry: that is the thing to fix, whatever the score says.
  if (b.fuel.pct < 8) {
    return `Down with only ${b.fuel.pct} % fuel. One firm braking burn at the BRAKE cue beats repeated short hovers; watch RESERVE.`;
  }
  // Otherwise name the weakest scored component of the touchdown itself.
  // (Fuel is left out: mid-descent starts begin with part of the tank used.)
  const parts = [
    ["vy", b.vy.score / b.vy.max, "Softer touchdown: arrive at 5 m with V/S well under the limit and let the LM settle."],
    ["vx", b.vx.score / b.vx.max, "Less drift at contact: null H/S earlier with short RCS taps."],
    ["acc", b.accuracy.score / b.accuracy.max, "Closer to the LZ: start translating while still high, when it costs no hover time."],
    ["tilt", b.tilt.score / b.tilt.max, "Land more level: finish attitude corrections above 20 m."],
  ].sort((x, y) => x[1] - y[1]);
  if (parts[0][1] > 0.85) return "Clean landing. Try the next difficulty or another scenario.";
  return parts[0][2];
}

/**
 * Debrief for a graded touchdown (gradeLanding result). startFrac: the fuel the
 * attempt started with, as a share of the tank (mid-descent scenarios < 1).
 */
export function landingDebrief(result, scenarioId, cfg, startFrac = 1) {
  const b = result.breakdown;
  const success = landingObjectiveMet(scenarioId, result);
  const title = result.crashed ? "CREW LOST" : success ? "OBJECTIVE COMPLETE" : "LANDED · OBJECTIVE NOT MET";
  return {
    success,
    landed: !result.crashed,
    title,
    grade: result.grade,
    score: result.score,
    rows: [
      { label: "TOUCHDOWN V/S", value: `${f1(b.vy.value)} m/s`, limit: `limit ${cfg.safeVy}`, ok: b.vy.safe, testId: "debrief-vy" },
      { label: "HORIZONTAL VELOCITY", value: `${f1(b.vx.value)} m/s`, limit: `limit ${cfg.safeVx}`, ok: b.vx.safe, testId: "debrief-vx" },
      { label: "FUEL REMAINING", value: `${b.fuel.pct} %`, limit: startFrac < 1 ? `started ${Math.round(startFrac * 100)} %` : null, ok: !result.failureReasons.includes("FUEL DEPLETED BEFORE TOUCHDOWN"), testId: "debrief-fuel" },
      { label: "LANDING ACCURACY", value: `${f1(b.accuracy.distance)} m · ${b.accuracy.label}`, limit: result.zone, ok: !result.failureReasons.includes("UNSAFE TERRAIN"), testId: "debrief-accuracy" },
      { label: "TILT", value: `${Math.round(b.tilt.value)}°`, limit: `limit ${cfg.safeTilt}°`, ok: b.tilt.safe, testId: "debrief-tilt" },
      { label: "RESULT", value: result.crashed ? `F · ${result.score}/100` : `${result.grade} · ${result.score}/100`, limit: null, ok: !result.crashed, testId: "debrief-grade" },
    ],
    reasons: result.failureReasons,
    recommendation: landingAdvice(result, scenarioId, cfg),
    progress: { success, rank: success ? result.score : -1, label: `${result.grade} · ${result.score}` },
  };
}

/* ------------------------------------------------------------------------ */

const FAILURE_REASON = {
  [OUTCOME.SKIP_OUT]: "ATMOSPHERIC SKIP — the capsule climbed back out of the atmosphere",
  [OUTCOME.THERMAL]: `THERMAL LIMIT — heat shield over its ${LIMITS.heatRateDesign} W/cm² design rate for too long`,
  [OUTCOME.STRUCTURAL]: `STRUCTURAL LIMIT — deceleration above ${LIMITS.structuralG} g`,
  [OUTCOME.CHUTE_FAILURE]: "PARACHUTES — reached the ocean without a full main-chute descent",
};

function reentryAdvice(d) {
  switch (d.outcome) {
    case OUTCOME.SKIP_OUT:
      return "The capsule climbed out with too much lift up. When the path stops steepening or the prediction says SKIP, roll the lift vector DOWN (toward 180°); bring it back up once you are descending firmly.";
    case OUTCOME.THERMAL:
      return "The heat rate stayed above the shield's design limit. In a steep entry roll lift UP early so the capsule decelerates higher, where the air is thinner.";
    case OUTCOME.STRUCTURAL:
      return `Deceleration passed ${LIMITS.structuralG} g. Lift UP during the dive flattens the path and spreads the slowdown over more time.`;
    case OUTCOME.CHUTE_FAILURE:
      return "The parachutes did not complete their sequence. They deploy on their own inside their altitude and speed envelopes; arrive slower and lower than their limits.";
    default:
      break;
  }
  if (d.peakG > 9) return `Survived, but ${f1(d.peakG)} g is close to the ${LIMITS.structuralG} g limit. Start rolling lift UP sooner when loads build.`;
  if (d.shieldPct > 70) return `Survived, but ${Math.round(d.shieldPct)} % of the heat shield was used. Avoid diving deep while still above 9 km/s.`;
  if (d.bankAgreement !== null && d.bankAgreement < 0.6) {
    return `The lift vector matched the guidance only ${Math.round(d.bankAgreement * 100)} % of the hypersonic flight. Make smaller, earlier roll corrections.`;
  }
  return "Clean entry. Try a higher difficulty or a recovery scenario.";
}

/**
 * Debrief for a finished entry. `d` is built by ReentryGame from its
 * simulation state: { outcome, eiFpa, peakG, peakHeatRate, heatLoad, overheat,
 * shieldPct, bankAgreement (0..1 or null), rollDeg, splashV }.
 */
export function reentryDebrief(d) {
  const success = reentryObjectiveMet(d.outcome);
  const rows = [
    { label: "INITIAL ENTRY ANGLE", value: `${d.eiFpa.toFixed(2)}°`, limit: "target −6.50°", ok: true, testId: "debrief-fpa" },
    { label: "PEAK G-LOAD", value: `${f1(d.peakG)} g`, limit: `limit ${LIMITS.structuralG} g`, ok: d.peakG <= LIMITS.structuralG && d.outcome !== OUTCOME.STRUCTURAL, testId: "debrief-g" },
    { label: "PEAK HEATING RATE", value: `${Math.round(d.peakHeatRate)} W/cm²`, limit: `design ${LIMITS.heatRateDesign}`, ok: d.peakHeatRate <= LIMITS.heatRateDesign, testId: "debrief-heat" },
    { label: "MAX THERMAL LOAD", value: `${Math.round(d.heatLoad).toLocaleString("en-US")} J/cm² · ${Math.round(d.shieldPct)} %`, limit: "of shield", ok: d.outcome !== OUTCOME.THERMAL, testId: "debrief-load" },
    {
      label: "BANK CONTROL",
      value: d.bankAgreement === null ? "—" : `${Math.round(d.bankAgreement * 100)} % on guidance`,
      limit: `${Math.round(d.rollDeg)}° rolled`,
      ok: d.bankAgreement === null || d.bankAgreement >= 0.6,
      testId: "debrief-bank",
    },
    { label: "RESULT", value: success ? `SPLASHDOWN · ${f1(d.splashV)} m/s` : "VEHICLE LOST", limit: null, ok: success, testId: "debrief-result" },
  ];
  return {
    success,
    landed: success,
    title: success ? "SPLASHDOWN · OBJECTIVE COMPLETE" : "ENTRY FAILED",
    grade: null,
    score: null,
    rows,
    reasons: success ? [] : [FAILURE_REASON[d.outcome] || d.outcome],
    recommendation: reentryAdvice(d),
    progress: { success, rank: success ? 1000 - d.peakG * 10 : -1, label: `${f1(d.peakG)} g · ${Math.round(d.peakHeatRate)} W/cm²` },
  };
}
