/*
 * LUNAVIA — Training debriefs.
 *
 * Every number here comes from the simulation that was flown: the lander's
 * graded touchdown (gradeLanding), the reentry state (reentryPhysics) or the
 * docking capture (dockingSim judgeContact). The
 * main reason and the recommendations are chosen from what actually limited
 * the attempt.
 */
import { LIMITS, OUTCOME, CORRIDOR } from "./reentryPhysics";
import { DOCKING } from "./dockingSim";
import { getSite, SLOPE_LIMIT } from "./landingSites";
import { landingObjectiveMet, reentryObjectiveMet, objectiveRadius } from "./trainingScenarios";

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
/* Lunar landing                                                             */
/* ------------------------------------------------------------------------ */

function landingReason(r, scenarioId, cfg, site) {
  const b = r.breakdown;
  const why = {
    "FUEL DEPLETED BEFORE TOUCHDOWN": "Fuel ran out above the surface",
    "VERTICAL SPEED EXCEEDED SAFE LIMIT": `Vertical speed ${f1(b.vy.value)} m/s exceeded the ${cfg.safeVy} m/s limit`,
    "EXCESSIVE HORIZONTAL SPEED": `Horizontal speed ${f1(b.vx.value)} m/s exceeded the ${cfg.safeVx} m/s limit`,
    "TILT EXCEEDED SAFE LIMIT": `Tilt ${Math.round(b.tilt.value)}° exceeded the ${cfg.safeTilt}° limit`,
    "UNSAFE TERRAIN": `Touched down on ${r.zone}`,
  };
  if (r.crashed) return why[r.failureReasons[0]] || r.failureReasons[0];
  const rad = objectiveRadius(scenarioId, site);
  if (rad !== null && b.accuracy.distance >= rad) return `Safe, but ${f1(b.accuracy.distance)} m from the LZ centre (objective: under ${rad} m)`;
  return `Safe touchdown at ${f1(b.vy.value)} m/s, ${f1(b.accuracy.distance)} m from the LZ centre`;
}

function landingAdvice(r, scenarioId, cfg, site) {
  const b = r.breakdown;
  const reasons = r.failureReasons;
  const tips = [];
  const t = r.terrain || {};
  if (reasons.includes("FUEL DEPLETED BEFORE TOUCHDOWN")) tips.push("Start the braking burn at the BRAKE cue and descend steadily instead of hovering high; RESERVE shows the hover time you have.");
  if (reasons.includes("UNSAFE TERRAIN")) {
    tips.push(
      t.kind === "slope"
        ? `The ground under the footpads sloped past the LM's ${SLOPE_LIMIT}° limit: keep the yellow footprint ring off the red-marked ground.`
        : "Watch the ▾ projected-touchdown label and keep the yellow footprint ring clear of boulders; translate with RCS before 50 m."
    );
  }
  if (reasons.includes("VERTICAL SPEED EXCEEDED SAFE LIMIT")) tips.push(`Below 30 m hold THR earlier so V/S is under ${f1(cfg.safeVy * 0.6)} m/s by 5 m.`);
  if (reasons.includes("EXCESSIVE HORIZONTAL SPEED")) tips.push("Null H/S with short RCS taps before 20 m, then leave it alone.");
  if (reasons.includes("TILT EXCEEDED SAFE LIMIT")) tips.push("Use RCS, not tilt, for small corrections low down, and level the LM before contact.");
  const rad = objectiveRadius(scenarioId, site);
  if (!r.crashed && rad !== null && b.accuracy.distance >= rad) tips.push("Translate earlier, while high, and arrive above the LZ with H/S near 0.");
  if (!r.crashed && b.fuel.pct < 8) tips.push(`Down with only ${b.fuel.pct} % fuel: one firm braking burn at the BRAKE cue beats repeated short hovers.`);
  if (tips.length < 2 && !r.crashed) {
    // the weakest scored parts of the touchdown itself (fuel left out: some
    // scenarios start with part of the tank used)
    const parts = [
      [b.vy.score / b.vy.max, "Softer touchdown: arrive at 5 m with V/S well under the limit and let the LM settle."],
      [b.vx.score / b.vx.max, "Less drift at contact: null H/S earlier with short RCS taps."],
      [b.accuracy.score / b.accuracy.max, "Closer to the LZ centre: start translating while still high."],
      [b.tilt.score / b.tilt.max, "Land more level: finish attitude corrections above 20 m."],
    ].sort((x, y) => x[0] - y[0]);
    for (const [score, tip] of parts) if (tips.length < 2 && score < 0.85 && !tips.includes(tip)) tips.push(tip);
  }
  if (!tips.length) tips.push("Clean landing. Try the next difficulty or another scenario.");
  return tips.slice(0, 2);
}

/**
 * Debrief for a graded touchdown (gradeLanding result) at a landing site.
 * startFrac: the fuel the attempt started with, as a share of the tank
 * (mid-descent scenarios < 1).
 */
export function landingDebrief(result, scenarioId, cfg, startFrac = 1, site = getSite()) {
  const b = result.breakdown;
  const success = landingObjectiveMet(scenarioId, result, site);
  const recs = landingAdvice(result, scenarioId, cfg, site);
  const t = result.terrain;
  // What the footprint came down on (landingSites evaluate): the hazard, or the slope of clear ground.
  const ground = t ? { value: t.label || `${Math.round(t.slope)}° slope · clear`, ok: !t.kind } : null;
  return {
    success,
    landed: !result.crashed,
    title: result.crashed ? "CREW LOST" : success ? "OBJECTIVE COMPLETE" : "LANDED · OBJECTIVE NOT MET",
    grade: result.crashed ? "F" : result.grade,
    score: result.score,
    rows: [
      { label: "LANDING RESULT", value: result.crashed ? "CRASH" : `SAFE · ${result.zone}`, limit: null, ok: !result.crashed, testId: "debrief-result" },
      { label: "GRADE", value: `${result.crashed ? "F" : result.grade} · ${result.score}/100`, limit: null, ok: !result.crashed, testId: "debrief-grade" },
      { label: "VERTICAL TOUCHDOWN", value: `${f1(b.vy.value)} m/s`, limit: `limit ${cfg.safeVy}`, ok: b.vy.safe, testId: "debrief-vy" },
      { label: "HORIZONTAL TOUCHDOWN", value: `${f1(b.vx.value)} m/s`, limit: `limit ${cfg.safeVx}`, ok: b.vx.safe, testId: "debrief-vx" },
      { label: "FINAL ATTITUDE", value: `${Math.round(b.tilt.value)}° tilt`, limit: `limit ${cfg.safeTilt}°`, ok: b.tilt.safe, testId: "debrief-tilt" },
      { label: "DISTANCE FROM LZ CENTRE", value: `${f1(b.accuracy.distance)} m · ${b.accuracy.label}`, limit: null, ok: !result.failureReasons.includes("UNSAFE TERRAIN"), testId: "debrief-accuracy" },
      ...(ground ? [{ label: "GROUND UNDER THE LM", value: ground.value, limit: `limit ${SLOPE_LIMIT}°`, ok: ground.ok, testId: "debrief-ground" }] : []),
      { label: "FUEL REMAINING", value: `${b.fuel.pct} %`, limit: startFrac < 1 ? `started ${Math.round(startFrac * 100)} %` : null, ok: !result.failureReasons.includes("FUEL DEPLETED BEFORE TOUCHDOWN"), testId: "debrief-fuel" },
    ],
    reason: landingReason(result, scenarioId, cfg, site),
    reasons: result.failureReasons,
    recommendations: recs,
    recommendation: recs[0],
    record: {
      success,
      landed: !result.crashed,
      rank: success ? result.score : -1,
      label: `${result.grade} · ${result.score}`,
      grade: result.crashed ? null : result.grade,
      score: result.crashed ? null : result.score,
      fuelPct: result.crashed ? null : b.fuel.pct,
      accuracy: result.crashed ? null : b.accuracy.distance,
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Earth reentry                                                             */
/* ------------------------------------------------------------------------ */

const FAILURE_REASON = {
  [OUTCOME.SKIP_OUT]: "Atmospheric skip: the capsule climbed back out of the atmosphere",
  [OUTCOME.THERMAL]: `Thermal failure: the heat shield ran over its ${LIMITS.heatRateDesign} W/cm² design rate for too long`,
  [OUTCOME.STRUCTURAL]: `Structural failure: deceleration passed ${LIMITS.structuralG} g`,
  [OUTCOME.CHUTE_FAILURE]: "Parachutes: reached the ocean without a full main-chute descent",
};

/** Where the flown EI angle sits against the physics corridor (CORRIDOR). */
export function corridorStatus(fpa) {
  if (fpa > CORRIDOR.shallowEdge) return { text: "SHALLOW OF CORRIDOR", ok: false };
  if (fpa < CORRIDOR.steepEdge) return { text: "STEEP OF CORRIDOR", ok: false };
  if (fpa > CORRIDOR.shallowEdge - 0.4) return { text: "INSIDE · SHALLOW EDGE", ok: true };
  if (fpa < CORRIDOR.steepEdge + 0.4) return { text: "INSIDE · STEEP EDGE", ok: true };
  return { text: "INSIDE CORRIDOR", ok: true };
}

function reentryAdvice(d) {
  const tips = [];
  switch (d.outcome) {
    case OUTCOME.SKIP_OUT:
      tips.push("When the path stops steepening or the prediction says SKIP, roll the lift vector DOWN (toward 180°).");
      tips.push("Bring the lift back up once you are descending firmly, or the loads will climb.");
      break;
    case OUTCOME.THERMAL:
      tips.push("In a steep entry roll lift UP early so the capsule decelerates higher, where the air is thinner.");
      break;
    case OUTCOME.STRUCTURAL:
      tips.push(`Lift UP during the dive flattens the path and spreads the slowdown; act before G passes ${LIMITS.structuralG / 2} g.`);
      break;
    case OUTCOME.CHUTE_FAILURE:
      tips.push("The parachutes deploy on their own inside their envelopes; arrive slower and lower than their limits.");
      break;
    default:
      break;
  }
  if (d.outcome === OUTCOME.SPLASHDOWN) {
    if (!corridorStatus(d.eiFpa).ok) tips.push("Trim the planned EI angle into the corridor during ENTRY PREP: it buys margin for everything after.");
    if (d.peakG > 9) tips.push(`${f1(d.peakG)} g is close to the ${LIMITS.structuralG} g limit: start rolling lift UP sooner when loads build.`);
    if (d.shieldPct > 70) tips.push(`${Math.round(d.shieldPct)} % of the heat shield was used: avoid diving deep while still above 9 km/s.`);
    if (d.bankAgreement !== null && d.bankAgreement < 0.6) tips.push(`The lift vector matched the guidance only ${Math.round(d.bankAgreement * 100)} % of the hypersonic flight: make smaller, earlier roll corrections.`);
    if (!tips.length) tips.push("Clean entry. Try a higher difficulty or a recovery scenario.");
  }
  return tips.slice(0, 2);
}

/**
 * Debrief for a finished entry. `d` is built by ReentryGame from its
 * simulation state: { outcome, eiFpa, peakG, peakHeatRate, heatLoad, overheat,
 * shieldPct, bankAgreement (0..1 or null), rollDeg, splashV, drogue, main }.
 */
export function reentryDebrief(d) {
  const success = reentryObjectiveMet(d.outcome);
  const corr = corridorStatus(d.eiFpa);
  const drogue = d.drogue && d.drogue.alt !== null && d.drogue.alt !== undefined ? d.drogue : null;
  const main = d.main && d.main.alt !== null && d.main.alt !== undefined ? d.main : null;
  const chutes = main
    ? `DROGUE ${f1(drogue.alt / 1000)} km · MAIN ${f1(main.alt / 1000)} km`
    : drogue
    ? `DROGUE ${f1(drogue.alt / 1000)} km · MAIN NOT DEPLOYED`
    : "NOT DEPLOYED";
  const recs = reentryAdvice(d);
  const rows = [
    { label: "INITIAL ENTRY ANGLE", value: `${d.eiFpa.toFixed(2)}°`, limit: "target −6.50°", ok: true, testId: "debrief-fpa" },
    { label: "ENTRY CORRIDOR", value: corr.text, limit: `${CORRIDOR.shallowEdge}° to ${CORRIDOR.steepEdge}°`, ok: corr.ok, testId: "debrief-corridor" },
    { label: "PEAK HEATING RATE", value: `${Math.round(d.peakHeatRate)} W/cm²`, limit: `design ${LIMITS.heatRateDesign}`, ok: d.peakHeatRate <= LIMITS.heatRateDesign, testId: "debrief-heat" },
    { label: "MAX THERMAL LOAD", value: `${Math.round(d.heatLoad).toLocaleString("en-US")} J/cm² · ${Math.round(d.shieldPct)} %`, limit: "of shield", ok: d.outcome !== OUTCOME.THERMAL, testId: "debrief-load" },
    { label: "PEAK G-LOAD", value: `${f1(d.peakG)} g`, limit: `limit ${LIMITS.structuralG} g`, ok: d.outcome !== OUTCOME.STRUCTURAL, testId: "debrief-g" },
    { label: "PARACHUTES", value: chutes, limit: null, ok: !!main, testId: "debrief-chutes" },
    { label: "SPLASHDOWN VELOCITY", value: d.splashV !== null && d.splashV !== undefined ? `${f1(d.splashV)} m/s` : "—", limit: null, ok: success, testId: "debrief-splash" },
    {
      label: "BANK CONTROL",
      value: d.bankAgreement === null ? "—" : `${Math.round(d.bankAgreement * 100)} % on guidance`,
      limit: `${Math.round(d.rollDeg)}° rolled`,
      ok: d.bankAgreement === null || d.bankAgreement >= 0.6,
      testId: "debrief-bank",
    },
    { label: "OUTCOME", value: success ? "SPLASHDOWN" : "VEHICLE LOST", limit: null, ok: success, testId: "debrief-outcome" },
  ];
  return {
    success,
    landed: success,
    title: success ? "SPLASHDOWN · OBJECTIVE COMPLETE" : "ENTRY FAILED",
    grade: null,
    score: null,
    rows,
    reason: success
      ? `Captured inside the vehicle's limits: ${f1(d.peakG)} g peak, ${Math.round(d.peakHeatRate)} W/cm² peak heating`
      : FAILURE_REASON[d.outcome] || d.outcome,
    reasons: success ? [] : [FAILURE_REASON[d.outcome] || d.outcome],
    recommendations: recs,
    recommendation: recs[0],
    record: { success, landed: success, rank: success ? 1000 - d.peakG * 10 : -1, label: `${f1(d.peakG)} g · ${Math.round(d.peakHeatRate)} W/cm²`, peakG: success ? d.peakG : null },
  };
}

/* ---- orbital docking -------------------------------------------------------------------- */
/**
 * The docking training debrief, from DockingOps' result (success: the physics' capture facts
 * at contact). Rows against the difficulty's capture limits; a record whose rank is the time
 * (faster ranks higher).
 */
export function dockingDebrief(r, difficulty) {
  const tol = DOCKING[difficulty].tol;
  const c = r.capture || {};
  const deg = (x) => ((x * 180) / Math.PI).toFixed(1);
  const t = r.attemptTime != null ? r.attemptTime : r.time;
  const propPct = Math.round((100 * (r.propLeft || 0)) / DOCKING[difficulty].prop);
  const rows = [
    { label: "DOCKING TIME", value: `${Math.round(t)} s`, limit: "this attempt", ok: true, testId: "debrief-dock-time" },
    { label: "ATTEMPTS", value: `${r.attempts}${r.restarts ? ` · ${r.restarts} RESTART${r.restarts > 1 ? "S" : ""}` : ""}`, limit: null, ok: true, testId: "debrief-dock-attempts" },
    { label: "BOUNCED CONTACTS", value: `${r.attemptContacts || 0}`, limit: "0 is clean", ok: !r.attemptContacts, testId: "debrief-dock-contacts" },
    { label: "CLOSING AT CONTACT", value: c.closing != null ? `${c.closing.toFixed(3)} m/s` : "—", limit: `${tol.vMin}–${tol.vMax}`, ok: c.closing == null || (c.closing >= tol.vMin && c.closing <= tol.vMax), testId: "debrief-dock-closing" },
    { label: "PROBE OFF CENTRE", value: c.lateral != null ? `${c.lateral.toFixed(2)} m` : "—", limit: `limit ${tol.lateral} m`, ok: c.lateral == null || c.lateral <= tol.lateral, testId: "debrief-dock-lateral" },
    { label: "PORT ANGLE", value: c.angle != null ? `${deg(c.angle)}°` : "—", limit: `limit ${deg(tol.angle)}°`, ok: c.angle == null || c.angle <= tol.angle, testId: "debrief-dock-angle" },
    { label: "SIDEWAYS DRIFT", value: c.vLat != null ? `${c.vLat.toFixed(3)} m/s` : "—", limit: `limit ${tol.vLat}`, ok: c.vLat == null || c.vLat <= tol.vLat, testId: "debrief-dock-drift" },
    { label: "RCS LEFT", value: `${propPct} %`, limit: null, ok: propPct > 15, testId: "debrief-dock-rcs" },
    { label: "OUTCOME", value: "HARD DOCK", limit: null, ok: true, testId: "debrief-dock-outcome" },
  ];
  const recs = [];
  if (c.closing != null && c.closing > 0.6 * tol.vMax) recs.push("Come in slower over the last metres: FINE APPROACH, or short AFT taps, keep the closing speed low.");
  if (c.lateral != null && c.lateral > 0.5 * tol.lateral) recs.push("Centre the port on the axis before closing in (AUTO-CENTER, or small sideways taps).");
  if (c.angle != null && c.angle > 0.5 * tol.angle) recs.push("Line up the docking axis first (AUTO-ALIGN, or the attitude controls).");
  if (r.attemptContacts) recs.push("A bounced contact means the probe met the drogue outside the limits: check the six capture conditions before the last metre.");
  if (propPct < 40) recs.push("Use fewer, shorter RCS pulses: let the assists or the vehicle's own motion do the work.");
  if (!recs.length) recs.push(difficulty === "COMMANDER" ? "Clean manual docking. Fly it at a different starting point." : "Clean docking. Try the next difficulty, or the drifting approach.");
  return {
    success: true,
    landed: false,
    title: "HARD DOCK CONFIRMED · OBJECTIVE COMPLETE",
    grade: null,
    score: null,
    rows,
    reason: `Captured at ${c.closing != null ? c.closing.toFixed(3) : "—"} m/s, ${c.lateral != null ? c.lateral.toFixed(2) : "—"} m off centre`,
    reasons: [],
    recommendations: recs.slice(0, 3),
    recommendation: recs[0],
    record: { success: true, landed: false, rank: 100000 - Math.round(t), label: `${Math.round(t)} s` },
  };
}
