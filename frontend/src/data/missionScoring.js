/*
 * LUNAVIA — mission scoring, medals and achievements (pure; unit-tested).
 *
 * An official mission is scored out of 1,000 points from what the simulations
 * measured, phase by phase, at the end of each phase:
 *
 *   LUNAR LANDING     400   the graded touchdown (landerSim gradeTouchdown)
 *   ORBITAL DOCKING   300   the physics capture (dockingSim judgeContact facts)
 *   EARTH REENTRY     300   the entry that splashed down (reentryPhysics state)
 *
 * Nothing here reads a clock, the camera, the docking view or anything random:
 * the same snapshots, difficulty, destination and SCORING_VERSION always give
 * the same score. A phase snapshot is taken once, from the attempt that ended
 * the phase; a new attempt replaces it, it never adds to it.
 *
 * Every phase score is the sum of its rounded components, so the numbers on
 * screen always add up. Each component compares one measured value with the
 * pilot difficulty's own limit (the limits the physics already uses; nothing
 * here makes a limit easier):
 *   underLimit(ratio, free)  full marks up to `free` of the limit, then down
 *                            (quadratically) to 0 at the limit;
 *   lowerBetter(v, a, b)     full at or below a, 0 at or above b (linear);
 *   higherBetter(v, a, b)    0 at or below a, full at or above b (linear).
 *
 * Safety comes first: a crash scores 0 for the landing, a docking only scores
 * when the physics captured the probe, a reentry only when the capsule
 * splashed down. Speed is never scored, and fuel only up to an efficient
 * descent (a hoarded tank earns nothing more).
 *
 * Exploration on the lunar surface is not playable yet and is not scored: the
 * 1,000 points are fully achievable without it. A future exploration phase
 * comes with SCORING_VERSION 2; records keep the version they were scored with.
 */
import { DIFFICULTY } from "./landingPhysics";
import { DOCKING } from "./dockingSim";
import { OUTCOME } from "./reentryPhysics";
import { TARGET_FPA } from "./reentryGuidance";

export const SCORING_VERSION = 1;
export const PHASES = ["landing", "docking", "reentry"];
export const PHASE_MAX = Object.freeze({ landing: 400, docking: 300, reentry: 300 });
export const TOTAL_MAX = 1000;

/* ---- medals ------------------------------------------------------------------------ */
export const MEDALS = Object.freeze([
  { id: "PLATINUM", min: 950 },
  { id: "GOLD", min: 850 },
  { id: "SILVER", min: 700 },
  { id: "BRONZE", min: 500 },
]);
export const MEDAL_ORDER = ["BRONZE", "SILVER", "GOLD", "PLATINUM"];
export const medalRank = (m) => MEDAL_ORDER.indexOf(m); // -1 for none
export const betterMedal = (a, b) => (medalRank(b) > medalRank(a) ? b : a || b || null);
/** The highest medal each pilot difficulty can be awarded (this version: PLATINUM on COMMANDER only). */
export const MEDAL_CAP = Object.freeze({ CADET: "GOLD", ASTRONAUT: "GOLD", COMMANDER: "PLATINUM" });
export const medalMin = (m) => (MEDALS.find((x) => x.id === m) || { min: null }).min;

/** Phase performance rating, by the share of the phase's points (the medal thresholds' shares). */
export const RATINGS = Object.freeze([
  { id: "OUTSTANDING", min: 0.95 },
  { id: "EXCELLENT", min: 0.85 },
  { id: "GOOD", min: 0.7 },
  { id: "FAIR", min: 0.5 },
  { id: "NEEDS WORK", min: 0 },
]);
export const ratingFor = (score, max) => RATINGS.find((r) => score / max >= r.min - 1e-9).id;

/* ---- curves ------------------------------------------------------------------------ */
const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const underLimit = (ratio, free) => (!(ratio < 1) ? 0 : ratio <= free ? 1 : 1 - ((ratio - free) / (1 - free)) ** 2);
export const lowerBetter = (v, full, zero) => clamp01((zero - v) / (zero - full));
export const higherBetter = (v, zero, full) => clamp01((v - zero) / (full - zero));
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const abs = (v) => (num(v) === null ? null : Math.abs(v));
const points = (max, share) => Math.round(max * share);
const sum = (cs) => cs.reduce((a, c) => a + c.points, 0);

/* ---- lunar landing: 400 ------------------------------------------------------------- */
/*
 * Descent efficiency: the propellant a touchdown used against the least any
 * pilot could use from the same start, the ideal single braking burn
 * (landerPilots idealBurn, re-derived in the tests), per destination and
 * pilot difficulty. The descent's only consumable is propellant and every
 * descent starts with the same tank, so "fuel remaining" and "descent
 * efficiency" are one measurement here, scored once.
 */
export const LANDING_FUEL_REF = Object.freeze({
  CADET: { tranquillitatis: 26.9, hadley: 26.5, tycho: 26.8, "far-side": 26.6 },
  ASTRONAUT: { tranquillitatis: 61.7, hadley: 60.0, tycho: 61.5, "far-side": 60.8 },
  COMMANDER: { tranquillitatis: 111.5, hadley: 108.9, tycho: 111.1, "far-side": 110.3 },
});
export const LANDING_RULES = Object.freeze({
  vertical: { max: 140, free: 0.2 }, // of the difficulty's safe vertical speed
  horizontal: { max: 60, free: 0.2 }, // of the safe horizontal speed
  attitude: { max: 40, free: 0.1 }, // of the safe tilt
  accuracy: { max: 100, full: 1, zero: 30 }, // m from the primary LZ's centre
  fuel: { max: 60, zero: 0.35, full: 0.85 }, // descent efficiency (ideal burn / fuel used)
});

/** What the landing measured, from the graded touchdown (gradeTouchdown result). */
export function landingSnapshot(result, { difficulty, siteId }) {
  if (!result || !DIFFICULTY[difficulty]) return null;
  const b = result.breakdown || {};
  const cfg = DIFFICULTY[difficulty];
  const initialFuel = num(result.initialFuel) ?? cfg.initialFuel;
  const fuelLeft = num(result.fuelLeft) ?? (num(result.fuelPct) !== null ? (result.fuelPct / 100) * initialFuel : 0);
  return {
    difficulty,
    siteId,
    safe: !result.crashed,
    reasons: Array.isArray(result.failureReasons) ? result.failureReasons.slice() : [],
    zone: result.zone || null,
    vy: abs(b.vy && b.vy.value) ?? 0,
    vx: abs(b.vx && b.vx.value) ?? 0,
    tilt: abs(b.tilt && b.tilt.value) ?? 0,
    distance: abs(b.accuracy && b.accuracy.distance) ?? 0,
    fuelLeft: Math.max(0, fuelLeft),
    initialFuel,
    time: num(result.time),
  };
}

/** Descent efficiency 0..1: the ideal burn's propellant over what this descent used. */
export function landingEfficiency(snap) {
  const ref = (LANDING_FUEL_REF[snap.difficulty] || {})[snap.siteId] ?? LANDING_FUEL_REF[snap.difficulty].tranquillitatis;
  const used = Math.max(1e-6, snap.initialFuel - snap.fuelLeft);
  return Math.min(1, ref / used);
}

export function scoreLanding(snap) {
  if (!snap) return null;
  const cfg = DIFFICULTY[snap.difficulty];
  const R = LANDING_RULES;
  const ok = snap.safe;
  const eff = landingEfficiency(snap);
  const c = (id, max, share, extra) => ({ id, max, points: ok ? points(max, share) : 0, ...extra });
  const components = [
    c("vertical", R.vertical.max, underLimit(snap.vy / cfg.safeVy, R.vertical.free), { value: snap.vy, limit: cfg.safeVy, unit: "m/s" }),
    c("horizontal", R.horizontal.max, underLimit(snap.vx / cfg.safeVx, R.horizontal.free), { value: snap.vx, limit: cfg.safeVx, unit: "m/s" }),
    c("attitude", R.attitude.max, underLimit(snap.tilt / cfg.safeTilt, R.attitude.free), { value: snap.tilt, limit: cfg.safeTilt, unit: "°" }),
    c("accuracy", R.accuracy.max, lowerBetter(snap.distance, R.accuracy.full, R.accuracy.zero), { value: snap.distance, limit: R.accuracy.zero, unit: "m" }),
    c("fuel", R.fuel.max, higherBetter(eff, R.fuel.zero, R.fuel.full), {
      value: eff,
      fuelPct: (snap.fuelLeft / snap.initialFuel) * 100,
      usedRatio: eff > 0 ? 1 / eff : null,
      unit: "",
    }),
  ];
  const score = ok ? sum(components) : 0;
  return { phase: "landing", max: PHASE_MAX.landing, score, safe: ok, efficiency: eff, components, deductions: [], rating: ok ? ratingFor(score, PHASE_MAX.landing) : "CRASH", snapshot: snap };
}

/* ---- orbital docking: 300 ------------------------------------------------------------ */
export const DOCKING_RULES = Object.freeze({
  closing: { max: 70, free: 0.3 }, // contact speed, of the capture window's top (tol.vMax)
  alignment: { max: 70, free: 0.1 }, // probe tip off the drogue's axis, of tol.lateral
  drift: { max: 40, free: 0.1 }, // lateral / vertical drift at contact, of tol.vLat
  angle: { max: 30, free: 0.1 }, // docking-axis angle, of tol.angle
  roll: { max: 10, free: 0.1 }, // of tol.roll
  rate: { max: 10, free: 0.1 }, // body rotation rate, of tol.rate
  rcs: { max: 40, zero: 0.3, full: 0.85 }, // RCS left of the attempt's budget
  clean: { max: 30, perContact: 15 }, // contacts that bounced off before the capture
  attempt: { each: 10, max: 30 }, // each extra attempt (RESTART DOCKING or a failed attempt)
});

/**
 * What the docking measured: the capture judgement's own facts (dockingSim
 * judgeContact, at the instant the probe tip crossed the drogue's ring), the
 * RCS left, the contacts of the capturing attempt and the attempt history.
 */
export function dockingSnapshot(r, { difficulty }) {
  if (!r || !DOCKING[difficulty]) return null;
  const f = r.capture || null;
  const cap = f && ["closing", "lateral", "angle", "roll", "vLat", "rate"].every((k) => num(f[k]) !== null) ? { closing: f.closing, lateral: f.lateral, angle: f.angle, roll: Math.abs(f.roll), vLat: f.vLat, rate: f.rate } : null;
  const attempts = Math.max(1, Math.round(num(r.attempts) || 1));
  return {
    difficulty,
    success: !!r.success && !!cap,
    capture: cap,
    attempts,
    restarts: Math.max(0, Math.round(num(r.restarts) || 0)),
    failures: Array.isArray(r.failures) ? r.failures.filter((x) => typeof x === "string") : [],
    attemptContacts: Math.max(0, Math.round(num(r.attemptContacts) || 0)),
    propLeft: Math.max(0, num(r.propLeft) || 0),
    propBudget: DOCKING[difficulty].prop,
  };
}

export function scoreDocking(snap) {
  if (!snap) return null;
  const t = DOCKING[snap.difficulty].tol;
  const R = DOCKING_RULES;
  const ok = snap.success;
  const f = snap.capture || { closing: 0, lateral: 0, angle: 0, roll: 0, vLat: 0, rate: 0 };
  const c = (id, max, share, extra) => ({ id, max, points: ok ? points(max, share) : 0, ...extra });
  const propFrac = snap.propLeft / snap.propBudget;
  const components = [
    c("closing", R.closing.max, underLimit(f.closing / t.vMax, R.closing.free), { value: f.closing, limit: t.vMax, low: t.vMin, unit: "m/s" }),
    c("alignment", R.alignment.max, underLimit(f.lateral / t.lateral, R.alignment.free), { value: f.lateral, limit: t.lateral, unit: "m" }),
    c("drift", R.drift.max, underLimit(f.vLat / t.vLat, R.drift.free), { value: f.vLat, limit: t.vLat, unit: "m/s" }),
    c("angle", R.angle.max, underLimit(f.angle / t.angle, R.angle.free), { value: f.angle, limit: t.angle, unit: "rad" }),
    c("roll", R.roll.max, underLimit(f.roll / t.roll, R.roll.free), { value: f.roll, limit: t.roll, unit: "rad" }),
    c("rate", R.rate.max, underLimit(f.rate / t.rate, R.rate.free), { value: f.rate, limit: t.rate, unit: "rad/s" }),
    c("rcs", R.rcs.max, higherBetter(propFrac, R.rcs.zero, R.rcs.full), { value: propFrac, unit: "" }),
    c("clean", R.clean.max, Math.max(0, R.clean.max - R.clean.perContact * snap.attemptContacts) / R.clean.max, { value: snap.attemptContacts, unit: "" }),
  ];
  const extra = snap.attempts - 1;
  const deduction = ok ? Math.min(R.attempt.max, R.attempt.each * extra) : 0;
  const deductions = deduction ? [{ id: "attempts", points: -deduction, value: extra }] : [];
  const score = ok ? Math.max(0, sum(components) - deduction) : 0;
  return {
    phase: "docking",
    max: PHASE_MAX.docking,
    score,
    success: ok,
    firstAttempt: ok && snap.attempts === 1 && snap.restarts === 0 && snap.failures.length === 0,
    components,
    deductions,
    rating: ok ? ratingFor(score, PHASE_MAX.docking) : "NOT DOCKED",
    snapshot: snap,
  };
}

/* ---- Earth reentry: 300 -------------------------------------------------------------- */
/*
 * Only what the reentry simulation computes: the entry interface angle flown
 * (the corridor), the peak heating rate against the shield's design rate, the
 * share of the heat shield used, the peak deceleration against the structural
 * limit, and how much of the hypersonic flight the lift vector agreed with the
 * guidance's recommendation (flight control, as the Training Center measures
 * it). Splashdown is a gate, not points: the parachutes set the splashdown
 * speed, and the game has no recovery target or recovery-ship distance.
 */
export const REENTRY_RULES = Object.freeze({
  corridor: { max: 90, full: 0.15, zero: 0.9 }, // deg off the target entry angle (TARGET_FPA)
  gload: { max: 70, full: 9, zero: 12 }, // peak g (12 g: the structural limit)
  heating: { max: 60, full: 188, zero: 200 }, // peak W/cm² (200: the design rate); 0 if the shield overheated
  shield: { max: 40, full: 60, zero: 90 }, // % of the heat shield used
  control: { max: 40, zero: 0.5, full: 0.9 }, // share of hypersonic flight with the lift vector on guidance
});

/** What the entry measured (ReentryGame's resultData), plus the entry attempts of the flight. */
export function reentrySnapshot(d, { difficulty }) {
  if (!d) return null;
  return {
    difficulty,
    outcome: d.outcome || null,
    splashdown: d.outcome === OUTCOME.SPLASHDOWN,
    eiFpa: num(d.eiFpa) ?? 0,
    peakG: num(d.peakG) ?? 0,
    peakHeatRate: num(d.peakHeatRate) ?? 0,
    heatLoad: num(d.heatLoad) ?? 0,
    overheat: num(d.overheat) ?? 0,
    shieldPct: num(d.shieldPct) ?? 0,
    bankAgreement: num(d.bankAgreement),
    splashV: num(d.splashV),
    attempts: Math.max(1, Math.round(num(d.attempts) || 1)),
    losses: Array.isArray(d.losses) ? d.losses.filter((x) => typeof x === "string") : [],
  };
}

export function scoreReentry(snap) {
  if (!snap) return null;
  const R = REENTRY_RULES;
  const ok = snap.splashdown;
  const c = (id, max, share, extra) => ({ id, max, points: ok ? points(max, share) : 0, ...extra });
  const err = Math.abs(snap.eiFpa - TARGET_FPA);
  const components = [
    c("corridor", R.corridor.max, lowerBetter(err, R.corridor.full, R.corridor.zero), { value: snap.eiFpa, error: err, target: TARGET_FPA, unit: "°" }),
    c("gload", R.gload.max, lowerBetter(snap.peakG, R.gload.full, R.gload.zero), { value: snap.peakG, limit: R.gload.zero, unit: "g" }),
    c("heating", R.heating.max, snap.overheat > 0 ? 0 : lowerBetter(snap.peakHeatRate, R.heating.full, R.heating.zero), { value: snap.peakHeatRate, limit: R.heating.zero, overheat: snap.overheat, unit: "W/cm²" }),
    c("shield", R.shield.max, lowerBetter(snap.shieldPct, R.shield.full, R.shield.zero), { value: snap.shieldPct, unit: "%" }),
    c("control", R.control.max, snap.bankAgreement === null ? 0 : higherBetter(snap.bankAgreement, R.control.zero, R.control.full), { value: snap.bankAgreement, unit: "" }),
  ];
  const score = ok ? sum(components) : 0;
  return { phase: "reentry", max: PHASE_MAX.reentry, score, splashdown: ok, components, deductions: [], rating: ok ? ratingFor(score, PHASE_MAX.reentry) : "VEHICLE LOST", snapshot: snap };
}

/* ---- the mission ------------------------------------------------------------------------ */
/**
 * The mission's score, gates and medal from its three phase snapshots (any of
 * them null when the phase was not completed). A medal needs all four gates:
 * a safe landing, a docking captured by the physics, a splashdown, and no
 * capsule lost on an earlier entry attempt (RETRY ENTRY finishes the flight,
 * but a lost capsule is a failed mission). Then the score's tier, up to the
 * pilot difficulty's cap.
 */
export function scoreMission({ siteId, difficulty, landing = null, docking = null, reentry = null }) {
  const L = scoreLanding(landing);
  const D = scoreDocking(docking);
  const R = scoreReentry(reentry);
  const total = (L ? L.score : 0) + (D ? D.score : 0) + (R ? R.score : 0);
  const gates = [
    { id: "landing", ok: !!(L && L.safe) },
    { id: "docking", ok: !!(D && D.success) },
    { id: "reentry", ok: !!(R && R.splashdown) },
    { id: "survival", ok: !!(R && R.splashdown && reentry.losses.length === 0) },
  ];
  const completed = gates[0].ok && gates[1].ok && gates[2].ok;
  const eligible = gates.every((g) => g.ok);
  const tier = eligible ? (MEDALS.find((m) => total >= m.min) || { id: null }).id : null;
  const cap = MEDAL_CAP[difficulty] || "GOLD";
  const medal = tier && medalRank(tier) > medalRank(cap) ? cap : tier;
  // the next medal this difficulty can still be awarded, and the points it needs
  const next = eligible ? [...MEDALS].reverse().find((m) => medalRank(m.id) > medalRank(medal) && medalRank(m.id) <= medalRank(cap)) : null;
  return {
    version: SCORING_VERSION,
    siteId,
    difficulty,
    landing: L,
    docking: D,
    reentry: R,
    total,
    max: TOTAL_MAX,
    gates,
    completed,
    eligible,
    tier, // what the points reach
    medal, // what is awarded
    cap,
    capped: !!tier && tier !== medal,
    next: next ? { medal: next.id, points: next.min - total } : null,
  };
}

/* ---- achievements ----------------------------------------------------------------------- */
export const ACHIEVEMENT_RULES = Object.freeze({
  softShare: 0.3, // SOFT TOUCHDOWN: both touchdown speeds at most this share of their limits
  precisionDistance: 1.0, // PRECISION PILOT: m from the primary LZ's centre
  fuelEfficiency: 0.88, // FUEL MASTER: used at most 1/0.88 ≈ 1.14 × the ideal burn
  dockLateral: 0.25, // PRECISION DOCKING: shares of the capture tolerances
  dockAngle: 0.25,
  dockClosing: 0.5,
  dockDrift: 0.3,
  phaseMaster: 0.9, // RENDEZVOUS MASTER, REENTRY SPECIALIST, PERFECT EXPEDITION: 90 % of the phase
});
export const DESTINATIONS = ["tranquillitatis", "hadley", "tycho", "far-side"];
/** Each destination's EVA achievement (data/evaMissions: the expedition there). */
export const EXPEDITION_ACHIEVEMENT = { tranquillitatis: "FIRST_EVA", hadley: "VALLEY_GEOLOGIST", tycho: "IMPACT_INVESTIGATOR", "far-side": "FAR_SIDE_LISTENER" };
/** A finished expedition: back in the LM with every one of its objectives done (its record is the destination's own). */
const expeditionDone = (eva) => !!eva && eva.completed === true && !!eva.progress && Object.keys(eva.progress).length >= 3 && Object.values(eva.progress).every((v) => v === true);
const A = ACHIEVEMENT_RULES;
const pct = (p, max) => p >= Math.round(max * A.phaseMaster);

/*
 * Each achievement is decided at one moment of an official mission (`on`):
 * the landing result, the end of the lunar EVA, the hard dock, the splashdown, or the end of a
 * successful mission (with the records already updated by it). Training
 * flights never unlock achievements.
 */
export const ACHIEVEMENTS = Object.freeze([
  { id: "FIRST_FOOTPRINT", group: "LANDING", on: "landing", test: ({ landing }) => !!landing && landing.safe },
  {
    id: "SOFT_TOUCHDOWN",
    group: "LANDING",
    on: "landing",
    test: ({ landing }) => {
      if (!landing || !landing.safe) return false;
      const cfg = DIFFICULTY[landing.snapshot.difficulty];
      return landing.snapshot.vy <= A.softShare * cfg.safeVy && landing.snapshot.vx <= A.softShare * cfg.safeVx;
    },
  },
  { id: "PRECISION_PILOT", group: "LANDING", on: "landing", test: ({ landing }) => !!landing && landing.safe && landing.snapshot.distance <= A.precisionDistance },
  { id: "FUEL_MASTER", group: "LANDING", on: "landing", test: ({ landing }) => !!landing && landing.safe && landing.efficiency >= A.fuelEfficiency },
  // the optional lunar EVA: recorded apart from the 1,000-point score, which it does not change.
  // FIRST STEPS is the Sea of Tranquility's (phase 1); the other expeditions are under SURFACE
  { id: "FIRST_EVA", group: "LANDING", on: "eva", test: ({ eva, siteId }) => (siteId || "tranquillitatis") === "tranquillitatis" && !!eva && eva.completed && !!eva.progress && eva.progress.firstSteps && eva.progress.sample && eva.progress.photo },
  { id: "VALLEY_GEOLOGIST", group: "SURFACE", on: "eva", test: ({ eva, siteId }) => siteId === "hadley" && expeditionDone(eva) },
  { id: "IMPACT_INVESTIGATOR", group: "SURFACE", on: "eva", test: ({ eva, siteId }) => siteId === "tycho" && expeditionDone(eva) },
  { id: "FAR_SIDE_LISTENER", group: "SURFACE", on: "eva", test: ({ eva, siteId }) => siteId === "far-side" && expeditionDone(eva) },
  {
    id: "FIELD_SCIENTIST",
    group: "SURFACE",
    on: "eva",
    test: ({ eva, siteId, unlocked = {} }) => DESTINATIONS.every((s) => !!unlocked[EXPEDITION_ACHIEVEMENT[s]] || (s === (siteId || "tranquillitatis") && (s === "tranquillitatis" ? !!eva && eva.completed && !!eva.progress && eva.progress.firstSteps && eva.progress.sample && eva.progress.photo : expeditionDone(eva)))),
  },
  { id: "FIRST_CONTACT", group: "DOCKING", on: "docking", test: ({ docking }) => !!docking && docking.success },
  {
    id: "PRECISION_DOCKING",
    group: "DOCKING",
    on: "docking",
    test: ({ docking }) => {
      if (!docking || !docking.success) return false;
      const f = docking.snapshot.capture;
      const t = DOCKING[docking.snapshot.difficulty].tol;
      return f.lateral <= A.dockLateral * t.lateral && f.angle <= A.dockAngle * t.angle && f.closing <= A.dockClosing * t.vMax && f.vLat <= A.dockDrift * t.vLat;
    },
  },
  { id: "FIRST_ATTEMPT_DOCKING", group: "DOCKING", on: "docking", test: ({ docking }) => !!docking && docking.firstAttempt },
  { id: "RENDEZVOUS_MASTER", group: "DOCKING", on: "docking", test: ({ docking }) => !!docking && docking.success && pct(docking.score, PHASE_MAX.docking) },
  { id: "WELCOME_HOME", group: "EARTH RETURN", on: "reentry", test: ({ reentry }) => !!reentry && reentry.splashdown },
  { id: "REENTRY_SPECIALIST", group: "EARTH RETURN", on: "reentry", test: ({ reentry }) => !!reentry && reentry.splashdown && pct(reentry.score, PHASE_MAX.reentry) },
  { id: "FOUR_DESTINATIONS", group: "DESTINATIONS", on: "mission", test: ({ records }) => DESTINATIONS.every((id) => completedAt(records, id)) },
  { id: "MOUNTAIN_NAVIGATOR", group: "DESTINATIONS", on: "mission", test: ({ mission }) => mission.eligible && mission.siteId === "hadley" },
  { id: "CRATER_SPECIALIST", group: "DESTINATIONS", on: "mission", test: ({ mission }) => mission.eligible && mission.siteId === "tycho" },
  { id: "SILENT_HORIZON_VETERAN", group: "DESTINATIONS", on: "mission", test: ({ mission }) => mission.eligible && mission.siteId === "far-side" },
  { id: "COMMANDER_QUALIFIED", group: "ELITE", on: "mission", test: ({ mission }) => mission.eligible && mission.difficulty === "COMMANDER" },
  {
    id: "PERFECT_EXPEDITION",
    group: "ELITE",
    on: "mission",
    test: ({ mission }) => mission.eligible && pct(mission.landing.score, PHASE_MAX.landing) && pct(mission.docking.score, PHASE_MAX.docking) && pct(mission.reentry.score, PHASE_MAX.reentry),
  },
  { id: "LUNAVIA_MASTER", group: "ELITE", on: "mission", test: ({ records }) => DESTINATIONS.every((id) => commanderPlatinum(records, id)) },
]);
export const ACHIEVEMENT_IDS = ACHIEVEMENTS.map((a) => a.id);
export const ACHIEVEMENT_GROUPS = ["LANDING", "SURFACE", "DOCKING", "EARTH RETURN", "DESTINATIONS", "ELITE"];

export const categoryKey = (siteId, difficulty) => `${siteId}|${difficulty}`;
const cat = (records, siteId, difficulty) => (records && records.categories && records.categories[categoryKey(siteId, difficulty)]) || null;
const completedAt = (records, siteId) => Object.keys(DIFFICULTY).some((d) => ((cat(records, siteId, d) || {}).successes || 0) > 0);
const commanderPlatinum = (records, siteId) => ((cat(records, siteId, "COMMANDER") || {}).bestMedal || null) === "PLATINUM";

/** The achievements decided at `on` that this context satisfies and are not yet unlocked. */
export function newAchievements(on, ctx, unlocked = {}) {
  return ACHIEVEMENTS.filter((a) => a.on === on && !unlocked[a.id] && a.test(ctx)).map((a) => a.id);
}

/** Progress toward the measurable achievements, from the records (null where there is none to show). */
export function achievementProgress(id, records) {
  const best = (k) => Math.max(-Infinity, ...Object.values((records && records.categories) || {}).map((c) => (c[k] ? c[k].score : -Infinity)));
  switch (id) {
    case "FOUR_DESTINATIONS":
      return { done: DESTINATIONS.filter((s) => completedAt(records, s)).length, of: 4 };
    case "FIELD_SCIENTIST":
      return { done: DESTINATIONS.filter((s) => records && records.achievements && records.achievements[EXPEDITION_ACHIEVEMENT[s]]).length, of: 4 };
    case "LUNAVIA_MASTER":
      return { done: DESTINATIONS.filter((s) => commanderPlatinum(records, s)).length, of: 4 };
    case "RENDEZVOUS_MASTER": {
      const b = best("bestDocking");
      return b > -Infinity ? { best: b, goal: Math.round(PHASE_MAX.docking * A.phaseMaster), of: PHASE_MAX.docking } : null;
    }
    case "REENTRY_SPECIALIST": {
      const b = best("bestReentry");
      return b > -Infinity ? { best: b, goal: Math.round(PHASE_MAX.reentry * A.phaseMaster), of: PHASE_MAX.reentry } : null;
    }
    default:
      return null;
  }
}

/* ---- the debrief's recommendation --------------------------------------------------------- */
const COMPONENT_PHASE = (m) => PHASES.flatMap((p) => (m[p] ? m[p].components.map((c) => ({ phase: p, ...c, lost: c.max - c.points })) : []));

/**
 * One improvement recommendation from this mission's own scores and the
 * player's records: { id, ...params } (the debrief words it). In order: a
 * gate that was missed; the component that cost the most points toward the
 * next medal this difficulty can award; COMMANDER for PLATINUM; the next
 * destination still without PLATINUM on COMMANDER; the personal best to beat.
 */
export function recommendation(m, records = null) {
  if (!m.gates[0].ok) return { id: "gate-landing", reasons: m.landing ? m.landing.snapshot.reasons : [] };
  if (!m.gates[1].ok) return { id: "gate-docking" };
  if (!m.gates[2].ok) return { id: "gate-reentry", outcome: m.reentry ? m.reentry.snapshot.outcome : null };
  if (!m.gates[3].ok) return { id: "gate-survival", losses: m.reentry.snapshot.losses.length };
  if (m.next) {
    const worst = COMPONENT_PHASE(m)
      .filter((c) => c.lost > 0)
      .sort((a, b) => b.lost - a.lost)[0];
    const ded = m.docking && m.docking.deductions[0];
    if (ded && (!worst || -ded.points >= worst.lost)) return { id: "next-attempts", medal: m.next.medal, need: m.next.points, lost: -ded.points };
    if (worst) return { id: "next-component", medal: m.next.medal, need: m.next.points, phase: worst.phase, component: worst.id, lost: worst.lost };
  }
  if (m.capped || (m.medal === "GOLD" && m.difficulty !== "COMMANDER")) return { id: "commander", siteId: m.siteId };
  if (m.medal === "PLATINUM") {
    const left = DESTINATIONS.filter((s) => !commanderPlatinum(records, s));
    if (left.length) return { id: "platinum-at", siteId: left[0], done: 4 - left.length };
  }
  const c = cat(records, m.siteId, m.difficulty);
  const weakest = PHASES.map((p) => ({ phase: p, share: m[p].score / m[p].max, score: m[p].score, max: m[p].max })).sort((a, b) => a.share - b.share)[0];
  const best = c && c[`best${weakest.phase[0].toUpperCase()}${weakest.phase.slice(1)}`];
  return { id: "phase-best", phase: weakest.phase, best: best ? best.score : weakest.score, max: weakest.max };
}
