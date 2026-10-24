import fs from "fs";
import path from "path";
import { DIFFICULTY } from "./landingPhysics";
import { getSite, SITE_IDS, siteStart } from "./landingSites";
import { simulate } from "./landerSim";
import { humanPilot, guidedStrategy, precisionStrategy, idealBurn } from "./landerPilots";
import { DOCKING, flyDocking, checkpointState } from "./dockingSim";
import { guidedPilot } from "./dockingGuidance";
import { createEntryState, advance, recommendBank, rollToward, LIMITS, OUTCOME } from "./reentryPhysics";
import { TARGET_FPA, timeScaleFor } from "./reentryGuidance";
import { liftAgrees } from "./trainingDebrief";
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_IDS,
  DESTINATIONS,
  LANDING_FUEL_REF,
  MEDALS,
  PHASE_MAX,
  SCORING_VERSION,
  TOTAL_MAX,
  achievementProgress,
  dockingSnapshot,
  landingSnapshot,
  newAchievements,
  recommendation,
  reentrySnapshot,
  scoreDocking,
  scoreLanding,
  scoreMission,
  scoreReentry,
} from "./missionScoring";
import { createFlightScoring } from "./flightScoring";
import { ACHIEVEMENT_TEXT, componentText, recommendationText } from "./scoringText";
import { RECORDS_KEY, applyDocking, applyFlightStart, applyLanding, applyMission, applyReentry, category, emptyRecords, importLegacy, loadRecords, saveRecords, updateRecords, unlockedBy } from "../lib/missionRecords";
import { loadProgress, recordAttempt } from "../lib/trainingProgress";
import { logMissionDocking, logMissionLanding, logMissionStart, logMissionComplete } from "../lib/missionSelection";

const deepFreeze = (o) => {
  if (o && typeof o === "object") {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
};

/* ---- deterministic phase telemetry (what the games report) ------------------------------- */
// a gradeTouchdown-shaped landing result
const landingResult = ({ vy = 0, vx = 0, tilt = 0, distance = 0, fuelLeft = 100, initialFuel = 140, crashed = false, reasons = [] } = {}) => ({
  crashed,
  failureReasons: reasons,
  zone: crashed ? "BOULDERS" : "PRIMARY LZ",
  fuelLeft,
  initialFuel,
  time: 60,
  fuelPct: Math.round((fuelLeft / initialFuel) * 100),
  breakdown: { vy: { value: vy }, vx: { value: vx }, tilt: { value: tilt }, accuracy: { distance } },
});
// a DockingOps hard-dock result
const dockResult = (difficulty, { closing, lateral = 0, angle = 0, roll = 0, vLat = 0, rate = 0, propLeft, attempts = 1, restarts = 0, attemptContacts = 0 } = {}) => {
  const t = DOCKING[difficulty].tol;
  return { success: true, attempts, restarts, attemptContacts, propLeft: propLeft != null ? propLeft : DOCKING[difficulty].prop, capture: { closing: closing != null ? closing : t.vMin, lateral, angle, roll, vLat, rate } };
};
// a ReentryGame resultData at splashdown
const entryData = (o = {}) => ({ outcome: OUTCOME.SPLASHDOWN, eiFpa: TARGET_FPA, peakG: 8.5, peakHeatRate: 180, heatLoad: 15000, overheat: 0, shieldPct: 50, bankAgreement: 1, splashV: 8.6, attempts: 1, losses: [], ...o });

const perfect = (difficulty, siteId = "tycho") => ({
  siteId,
  difficulty,
  landing: landingSnapshot(landingResult({ initialFuel: DIFFICULTY[difficulty].initialFuel, fuelLeft: DIFFICULTY[difficulty].initialFuel - LANDING_FUEL_REF[difficulty][siteId] }), { difficulty, siteId }),
  docking: dockingSnapshot(dockResult(difficulty), { difficulty }),
  reentry: reentrySnapshot(entryData(), { difficulty }),
});

beforeEach(() => window.localStorage.clear());

describe("phase scores from deterministic telemetry", () => {
  test("1. landing: each component against the difficulty's own limits, summed from rounded parts", () => {
    // ASTRONAUT: safeVy 2.5, safeVx 2, safeTilt 12; Tycho's ideal burn 61.5 units
    const snap = landingSnapshot(landingResult({ vy: 1.0, vx: 0.8, tilt: 3, distance: 4, fuelLeft: 140 - 61.5 / 0.75 }), { difficulty: "ASTRONAUT", siteId: "tycho" });
    const L = scoreLanding(snap);
    const p = Object.fromEntries(L.components.map((c) => [c.id, c.points]));
    // vertical: 1.0/2.5 = 0.4 → 1 − ((0.4 − 0.2)/0.8)² = 0.9375 → 131
    expect(p.vertical).toBe(Math.round(140 * 0.9375));
    // horizontal: 0.8/2 = 0.4 → 0.9375 → 56
    expect(p.horizontal).toBe(Math.round(60 * 0.9375));
    // attitude: 3/12 = 0.25 → 1 − (0.15/0.9)² → 39
    expect(p.attitude).toBe(Math.round(40 * (1 - (0.15 / 0.9) ** 2)));
    // accuracy: 4 m → (30 − 4)/(30 − 1) → 90
    expect(p.accuracy).toBe(Math.round(100 * (26 / 29)));
    // fuel: efficiency 0.75 → (0.75 − 0.35)/0.5 = 0.8 → 48
    expect(L.efficiency).toBeCloseTo(0.75, 6);
    expect(p.fuel).toBe(48);
    expect(L.score).toBe(p.vertical + p.horizontal + p.attitude + p.accuracy + p.fuel);
    expect(L.max).toBe(400);
    // safety first: the touchdown speeds and attitude carry 60 % of the landing, fuel 15 %
    expect(140 + 60 + 40).toBe(0.6 * PHASE_MAX.landing);
    // a crash scores nothing, whatever else was good
    const crash = scoreLanding(landingSnapshot(landingResult({ vy: 3.0, crashed: true, reasons: ["VERTICAL SPEED EXCEEDED SAFE LIMIT"] }), { difficulty: "ASTRONAUT", siteId: "tycho" }));
    expect(crash.score).toBe(0);
    expect(crash.safe).toBe(false);
    expect(crash.rating).toBe("CRASH");
    // a hoarded tank earns nothing beyond an efficient descent
    const eff = (u) => scoreLanding(landingSnapshot(landingResult({ fuelLeft: 140 - 61.5 / u }), { difficulty: "ASTRONAUT", siteId: "tycho" })).components[4].points;
    expect(eff(0.85)).toBe(60);
    expect(eff(1.0)).toBe(60);
  });

  test("2. docking: the capture's own facts against the difficulty's capture tolerances, RCS left, clean capture, attempts", () => {
    const t = DOCKING.COMMANDER.tol;
    const r = dockResult("COMMANDER", { closing: t.vMax * 0.65, lateral: t.lateral * 0.55, vLat: t.vLat * 0.5, angle: t.angle * 0.4, roll: t.roll * 0.2, rate: t.rate * 0.6, propLeft: DOCKING.COMMANDER.prop * 0.6, attemptContacts: 1 });
    const D = scoreDocking(dockingSnapshot(r, { difficulty: "COMMANDER" }));
    const p = Object.fromEntries(D.components.map((c) => [c.id, c.points]));
    const u = (ratio, free) => (ratio <= free ? 1 : 1 - ((ratio - free) / (1 - free)) ** 2);
    expect(p.closing).toBe(Math.round(70 * u(0.65, 0.3)));
    expect(p.alignment).toBe(Math.round(70 * u(0.55, 0.1)));
    expect(p.drift).toBe(Math.round(40 * u(0.5, 0.1)));
    expect(p.angle).toBe(Math.round(30 * u(0.4, 0.1)));
    expect(p.roll).toBe(Math.round(10 * u(0.2, 0.1)));
    expect(p.rate).toBe(Math.round(10 * u(0.6, 0.1)));
    expect(p.rcs).toBe(Math.round(40 * ((0.6 - 0.3) / 0.55)));
    expect(p.clean).toBe(15);
    expect(D.score).toBe(Object.values(p).reduce((a, b) => a + b, 0));
    expect(D.firstAttempt).toBe(true);
    // a docking that did not capture scores nothing
    expect(scoreDocking(dockingSnapshot({ success: false, failure: "collision" }, { difficulty: "COMMANDER" })).score).toBe(0);
    // a "success" without the physics' capture facts is not a scored docking
    expect(dockingSnapshot({ success: true }, { difficulty: "CADET" }).success).toBe(false);
  });

  test("3. reentry: corridor, peak g, peak heating, heat shield and lift-vector control; splashdown is the gate", () => {
    const R = scoreReentry(reentrySnapshot(entryData({ eiFpa: TARGET_FPA - 0.35, peakG: 10.2, peakHeatRate: 194, shieldPct: 66, bankAgreement: 0.8 }), { difficulty: "ASTRONAUT" }));
    const p = Object.fromEntries(R.components.map((c) => [c.id, c.points]));
    expect(p.corridor).toBe(Math.round(90 * ((0.9 - 0.35) / 0.75)));
    expect(p.gload).toBe(Math.round(70 * ((12 - 10.2) / 3)));
    expect(p.heating).toBe(Math.round(60 * ((200 - 194) / 12)));
    expect(p.shield).toBe(Math.round(40 * ((90 - 66) / 30)));
    expect(p.control).toBe(Math.round(40 * ((0.8 - 0.5) / 0.4)));
    expect(R.score).toBe(Object.values(p).reduce((a, b) => a + b, 0));
    // any heat absorbed above the shield's design rate: no heating points
    expect(scoreReentry(reentrySnapshot(entryData({ overheat: 3, peakHeatRate: 203 }), { difficulty: "ASTRONAUT" })).components[2].points).toBe(0);
    // a lost capsule scores nothing
    const lost = scoreReentry(reentrySnapshot(entryData({ outcome: OUTCOME.STRUCTURAL }), { difficulty: "ASTRONAUT" }));
    expect(lost.score).toBe(0);
    expect(lost.rating).toBe("VEHICLE LOST");
  });

  test("4. the maximum is exactly 1,000 (400 + 300 + 300) and no telemetry can exceed it", () => {
    expect(PHASE_MAX).toEqual({ landing: 400, docking: 300, reentry: 300 });
    expect(TOTAL_MAX).toBe(1000);
    ["CADET", "ASTRONAUT", "COMMANDER"].forEach((d) => {
      const m = scoreMission(perfect(d));
      expect([m.landing.score, m.docking.score, m.reentry.score, m.total]).toEqual([400, 300, 300, 1000]);
    });
    // impossible extremes (negative speeds, more fuel than the tank, agreement > 1) still cap at the phase maxima
    const odd = scoreMission({
      siteId: "hadley",
      difficulty: "COMMANDER",
      landing: landingSnapshot(landingResult({ vy: -0.0, vx: 0, fuelLeft: 999, initialFuel: 160 }), { difficulty: "COMMANDER", siteId: "hadley" }),
      docking: dockingSnapshot({ ...dockResult("COMMANDER"), propLeft: 99 }, { difficulty: "COMMANDER" }),
      reentry: reentrySnapshot(entryData({ bankAgreement: 3, peakG: 0, shieldPct: -5 }), { difficulty: "COMMANDER" }),
    });
    expect(odd.landing.score).toBeLessThanOrEqual(400);
    expect(odd.docking.score).toBeLessThanOrEqual(300);
    expect(odd.reentry.score).toBeLessThanOrEqual(300);
    expect(odd.total).toBeLessThanOrEqual(1000);
  });

  test("identical telemetry, configuration and scoring version give identical results (and nothing is mutated)", () => {
    const a = deepFreeze(perfect("ASTRONAUT", "hadley"));
    const s1 = JSON.stringify(scoreMission(a));
    const s2 = JSON.stringify(scoreMission(JSON.parse(JSON.stringify(a))));
    expect(s1).toBe(s2);
    expect(scoreMission(a).version).toBe(SCORING_VERSION);
  });
});

describe("medals", () => {
  // a mission whose total is exactly `total`, built from real telemetry: the deficit is taken, in order, from
  // the landing's accuracy, the entry's peak g, its corridor and its control, then the docking's alignment
  const withTotal = (difficulty, total) => {
    const tank = DIFFICULTY[difficulty].initialFuel;
    const t = DOCKING[difficulty].tol;
    const build = (o) =>
      scoreMission({
        siteId: "tycho",
        difficulty,
        landing: landingSnapshot(landingResult({ distance: o.d, vy: o.vy * DIFFICULTY[difficulty].safeVy, initialFuel: tank, fuelLeft: tank - LANDING_FUEL_REF[difficulty].tycho }), { difficulty, siteId: "tycho" }),
        docking: dockingSnapshot(dockResult(difficulty, { lateral: o.lat * t.lateral }), { difficulty }),
        reentry: reentrySnapshot(entryData({ peakG: o.g, eiFpa: TARGET_FPA + o.e, bankAgreement: o.a }), { difficulty }),
      });
    const o = { d: 0, vy: 0, g: 8.5, e: 0, a: 1, lat: 0 };
    const knobs = [
      ["d", 0, 30], // landing accuracy: 0 … 100 points lost
      ["vy", 0.2, 0.9999], // vertical touchdown speed: 0 … 140
      ["g", 9, 12], // peak g: 0 … 70
      ["e", 0.15, 0.9], // corridor: 0 … 90
      ["a", 0.9, 0.5], // control: 0 … 40
      ["lat", 0.1, 0.9999], // docking alignment: 0 … 70
    ];
    for (const [k, a, b] of knobs) {
      if (build(o).total <= total) break;
      for (let i = 0; i <= 20000; i++) {
        o[k] = a + ((b - a) * i) / 20000;
        if (build(o).total <= total) break;
      }
    }
    const m = build(o);
    if (m.total !== total) throw new Error(`no ${total} (${m.total})`);
    return m;
  };

  test("5. thresholds: BRONZE 500, SILVER 700, GOLD 850, PLATINUM 950 (COMMANDER)", () => {
    expect(MEDALS.map((m) => [m.id, m.min])).toEqual([["PLATINUM", 950], ["GOLD", 850], ["SILVER", 700], ["BRONZE", 500]]);
    const at = (t) => withTotal("COMMANDER", t).medal;
    expect(at(950)).toBe("PLATINUM");
    expect(at(949)).toBe("GOLD");
    expect(at(850)).toBe("GOLD");
    expect(at(849)).toBe("SILVER");
    expect(at(700)).toBe("SILVER");
    expect(at(699)).toBe("BRONZE");
    expect(at(500)).toBe("BRONZE");
    expect(at(499)).toBe(null);
    expect(withTotal("COMMANDER", 849).next).toEqual({ medal: "GOLD", points: 1 });
  });

  test("6. a failed mission never earns a mission medal (it may show a partial score)", () => {
    const p = perfect("COMMANDER");
    const crash = scoreMission({ ...p, landing: landingSnapshot(landingResult({ crashed: true, reasons: ["UNSAFE TERRAIN"] }), { difficulty: "COMMANDER", siteId: "tycho" }), docking: null, reentry: null });
    expect([crash.completed, crash.eligible, crash.medal, crash.total]).toEqual([false, false, null, 0]);
    const noDock = scoreMission({ ...p, docking: null, reentry: null });
    expect([noDock.eligible, noDock.medal, noDock.total]).toEqual([false, null, 400]); // the landing still shows
    const lost = scoreMission({ ...p, reentry: reentrySnapshot(entryData({ outcome: OUTCOME.THERMAL }), { difficulty: "COMMANDER" }) });
    expect([lost.eligible, lost.medal, lost.total]).toEqual([false, null, 700]);
    // RETRY ENTRY after a lost capsule: the flight completes, scored, but it was a failed mission
    const retried = scoreMission({ ...p, reentry: reentrySnapshot(entryData({ attempts: 2, losses: [OUTCOME.SKIP_OUT] }), { difficulty: "COMMANDER" }) });
    expect([retried.completed, retried.eligible, retried.medal, retried.total]).toEqual([true, false, null, 1000]);
    expect(retried.gates.find((g) => g.id === "survival").ok).toBe(false);
  });

  test("14. CADET and ASTRONAUT: up to GOLD, with the cap explained (capped = true)", () => {
    ["CADET", "ASTRONAUT"].forEach((d) => {
      const m = scoreMission(perfect(d));
      expect(m.total).toBe(1000);
      expect(m.tier).toBe("PLATINUM");
      expect(m.medal).toBe("GOLD");
      expect(m.capped).toBe(true);
      expect(m.next).toBe(null);
      expect(recommendation(m, emptyRecords()).id).toBe("commander");
      expect(withTotal(d, 850).medal).toBe("GOLD");
      expect(withTotal(d, 849).medal).toBe("SILVER");
    });
  });

  test("15. COMMANDER: PLATINUM from 950", () => {
    const m = scoreMission(perfect("COMMANDER"));
    expect([m.medal, m.capped]).toEqual(["PLATINUM", false]);
    expect(withTotal("COMMANDER", 950).medal).toBe("PLATINUM");
  });
});

describe("the flight's scoring follows the mission's events", () => {
  const F = (o = {}) => createFlightScoring({ id: "f1", siteId: "hadley", difficulty: "ASTRONAUT", ...o });

  test("never stale: a new descent or flight starts empty; each phase keeps only the attempt that ended it", () => {
    const f = F();
    f.beginDescent();
    f.landed(landingResult({ vy: 0.5 }));
    f.docking(dockResult("ASTRONAUT"));
    f.splashdown(entryData());
    expect(f.mission().total).toBeGreaterThan(900);
    // RETRY DESCENT: everything from the earlier attempt is gone
    f.beginDescent();
    expect([f.flight.landing, f.flight.docking, f.flight.reentry]).toEqual([null, null, null]);
    expect(f.mission().total).toBe(0);
    // a crash replaced by a safe landing: only the safe one counts; a later worse landing replaces a better one
    f.landed(landingResult({ crashed: true, vy: 3, reasons: ["VERTICAL SPEED EXCEEDED SAFE LIMIT"] }));
    expect(f.mission().landing.score).toBe(0);
    f.beginDescent();
    f.landed(landingResult({ vy: 0.5 }));
    const good = f.mission().landing.score;
    f.beginDescent();
    f.landed(landingResult({ vy: 2.0, distance: 9 }));
    expect(f.mission().landing.score).toBeLessThan(good);
    // a second flight shares nothing with the first
    expect(F({ id: "f2" }).mission().total).toBe(0);
  });

  test("7. RESTART DOCKING: never a false first attempt, and the attempts are kept", () => {
    const f = F();
    f.beginDescent();
    f.landed(landingResult());
    f.docking({ success: false, failure: "restart", attempts: 1, restarts: 1 });
    const D = f.docking(dockResult("ASTRONAUT", { attempts: 2, restarts: 1 }));
    expect(D.firstAttempt).toBe(false);
    expect(newAchievements("docking", { docking: D }, {})).not.toContain("FIRST_ATTEMPT_DOCKING");
    expect(newAchievements("docking", { docking: D }, {})).toContain("FIRST_CONTACT");
    // a failed attempt (the rendezvous checkpoint's retry) is never a first attempt either
    const g = F({ id: "f3" });
    g.docking({ success: false, failure: "collision", attempts: 1, restarts: 0 });
    expect(g.docking(dockResult("ASTRONAUT", { attempts: 2, restarts: 1 })).firstAttempt).toBe(false);
    // and the clean one is
    expect(F({ id: "f4" }).docking(dockResult("ASTRONAUT")).firstAttempt).toBe(true);
  });

  test("17. repeated checkpoints never inflate: the final capture only, minus a mild, capped retry cost", () => {
    const one = F().docking(dockResult("ASTRONAUT")).score;
    const f = F({ id: "f5" });
    for (let k = 1; k <= 6; k++) f.docking({ success: false, failure: "restart", attempts: k, restarts: k });
    const after = f.docking(dockResult("ASTRONAUT", { attempts: 7, restarts: 6 }));
    expect(after.score).toBe(one - 30); // −10 per extra attempt, at most −30
    expect(after.deductions).toEqual([{ id: "attempts", points: -30, value: 6 }]);
    expect(after.score).toBeLessThan(one);
    // two restarts cost 20, one 10: learning stays cheap
    expect(F({ id: "f6" }).docking(dockResult("ASTRONAUT", { attempts: 2, restarts: 1 })).score).toBe(one - 10);
    // reentry attempts after a lost capsule never raise the score above the flown entry's own
    const g = F({ id: "f7" });
    g.entryLost({ outcome: OUTCOME.SKIP_OUT });
    const R = g.splashdown(entryData({ attempts: 2 }));
    expect(R.score).toBe(scoreReentry(reentrySnapshot(entryData(), { difficulty: "ASTRONAUT" })).score);
    expect(g.mission().eligible).toBe(false);
    expect(g.flight.reentry.losses).toEqual([OUTCOME.SKIP_OUT]);
  });

  test("the history status follows what the flight reached; a failed phase is flown, scored 0", () => {
    const g = F({ id: "g" });
    g.beginDescent();
    g.landed(landingResult());
    g.docking({ success: false, failure: "collision", attempts: 1, restarts: 0 });
    expect(g.mission().docking).toMatchObject({ score: 0, success: false, rating: "NOT DOCKED" });
    expect(g.status()).toBe("failed-docking");
    g.docking(dockResult("ASTRONAUT", { attempts: 2, restarts: 1 }));
    g.entryLost({ outcome: OUTCOME.THERMAL, eiFpa: -7.6, peakG: 11, peakHeatRate: 230, attempts: 1, losses: [OUTCOME.THERMAL] });
    expect(g.mission().reentry).toMatchObject({ score: 0, splashdown: false, rating: "VEHICLE LOST" });
    expect(g.status()).toBe("failed-reentry");
    const f = F();
    f.beginDescent();
    expect(f.status()).toBe("failed-landing");
    expect(f.status("aborted")).toBe("aborted");
    f.landed(landingResult());
    expect(f.status()).toBe("failed-docking");
    f.docking(dockResult("ASTRONAUT"));
    expect(f.status()).toBe("failed-reentry");
    f.splashdown(entryData());
    expect(f.status()).toBe("complete");
    const s = f.summary("complete");
    expect(s).toMatchObject({ version: SCORING_VERSION, status: "complete", completed: true, eligible: true });
    // the summary re-scores identically from its snapshots
    expect(scoreMission({ siteId: "hadley", difficulty: "ASTRONAUT", ...s.snaps }).total).toBe(s.total);
  });
});

describe("achievements", () => {
  test("twenty-four achievements (the lunar EVA's under LANDING and SURFACE, the manual ascent's under ASCENT), each with an explicit test and English and Portuguese text", () => {
    expect(ACHIEVEMENT_IDS).toEqual([
      "FIRST_FOOTPRINT", "SOFT_TOUCHDOWN", "PRECISION_PILOT", "FUEL_MASTER", "FIRST_EVA",
      "VALLEY_GEOLOGIST", "IMPACT_INVESTIGATOR", "FAR_SIDE_LISTENER", "FIELD_SCIENTIST",
      "HAND_FLOWN_ASCENT", "PRECISE_INSERTION",
      "FIRST_CONTACT", "PRECISION_DOCKING", "FIRST_ATTEMPT_DOCKING", "RENDEZVOUS_MASTER",
      "WELCOME_HOME", "REENTRY_SPECIALIST",
      "FOUR_DESTINATIONS", "MOUNTAIN_NAVIGATOR", "CRATER_SPECIALIST", "SILENT_HORIZON_VETERAN",
      "COMMANDER_QUALIFIED", "PERFECT_EXPEDITION", "LUNAVIA_MASTER",
    ]);
    ACHIEVEMENTS.forEach((a) => {
      expect(["landing", "eva", "ascent", "docking", "reentry", "mission"]).toContain(a.on);
      expect(ACHIEVEMENT_TEXT[a.id].en[0]).toMatch(/^[A-Z][A-Z –-]+$/);
      expect(ACHIEVEMENT_TEXT[a.id].pt[1].length).toBeGreaterThan(20);
    });
  });

  test("landing achievements from the touchdown's own numbers", () => {
    const at = (o) => newAchievements("landing", { landing: scoreLanding(landingSnapshot(landingResult(o), { difficulty: "COMMANDER", siteId: "tycho" })) }, {});
    const tank = DIFFICULTY.COMMANDER.initialFuel;
    expect(at({ vy: 0.6, vx: 0.36, distance: 0.9, fuelLeft: tank - 111.1 / 0.9, initialFuel: tank })).toEqual(["FIRST_FOOTPRINT", "SOFT_TOUCHDOWN", "PRECISION_PILOT", "FUEL_MASTER"]);
    expect(at({ vy: 0.61, vx: 0.2, distance: 1.1, fuelLeft: tank - 111.1 / 0.87, initialFuel: tank })).toEqual(["FIRST_FOOTPRINT"]);
    expect(at({ crashed: true, reasons: ["UNSAFE TERRAIN"] })).toEqual([]);
  });

  test("FIRST STEPS: the whole EVA (sample, photograph, back aboard) and nothing less; no points", () => {
    const eva = (o = {}) => ({ progress: { firstSteps: true, sample: true, photo: true }, completed: true, ...o });
    expect(newAchievements("eva", { eva: eva() }, {})).toEqual(["FIRST_EVA"]);
    expect(newAchievements("eva", { eva: eva({ completed: false }) }, {})).toEqual([]);
    expect(newAchievements("eva", { eva: eva({ progress: { firstSteps: true, sample: true, photo: false } }) }, {})).toEqual([]);
    expect(newAchievements("eva", { eva: eva() }, { FIRST_EVA: { at: 1 } })).toEqual([]);
    expect(newAchievements("landing", { eva: eva() }, {})).toEqual([]);
    // the 1,000-point model is untouched by it
    expect(TOTAL_MAX).toBe(1000);
  });

  test("each expedition its own achievement, only complete and only where it was flown; all four: LUNAR FIELD SCIENTIST", () => {
    const ha = { progress: { firstSteps: true, survey: true, samples: true, photo: true, instrument: true }, completed: true };
    const ty = { progress: { firstSteps: true, survey: true, samples: true, photo: true, instrument: true }, completed: true };
    const fs = { progress: { firstSteps: true, sample: true, instrument: true, photo: true, data: true }, completed: true };
    expect(newAchievements("eva", { eva: ha, siteId: "hadley" }, {})).toEqual(["VALLEY_GEOLOGIST"]);
    expect(newAchievements("eva", { eva: ty, siteId: "tycho" }, {})).toEqual(["IMPACT_INVESTIGATOR"]);
    expect(newAchievements("eva", { eva: fs, siteId: "far-side" }, {})).toEqual(["FAR_SIDE_LISTENER"]); // never FIRST STEPS, though it has a sample and a photo
    expect(newAchievements("eva", { eva: { ...ha, progress: { ...ha.progress, instrument: false } }, siteId: "hadley" }, {})).toEqual([]);
    expect(newAchievements("eva", { eva: { ...fs, completed: false }, siteId: "far-side" }, {})).toEqual([]);
    expect(newAchievements("eva", { eva: ha, siteId: "tycho" }, {})).toEqual(["IMPACT_INVESTIGATOR"]); // the record is checked per destination before it gets here
    const three = { FIRST_EVA: { at: 1 }, VALLEY_GEOLOGIST: { at: 2 }, IMPACT_INVESTIGATOR: { at: 3 } };
    expect(newAchievements("eva", { eva: fs, siteId: "far-side", unlocked: three }, three)).toEqual(["FAR_SIDE_LISTENER", "FIELD_SCIENTIST"]);
    expect(newAchievements("eva", { eva: fs, siteId: "far-side", unlocked: { FIRST_EVA: { at: 1 } } }, { FIRST_EVA: { at: 1 } })).toEqual(["FAR_SIDE_LISTENER"]);
    expect(achievementProgress("FIELD_SCIENTIST", { categories: {}, achievements: three })).toEqual({ done: 3, of: 4 });
    expect(TOTAL_MAX).toBe(1000);
  });

  test("8. no duplicate unlocks: an achievement is unlocked once, on the flight that earned it", () => {
    const rec = emptyRecords();
    const flight = { id: "a", siteId: "hadley", difficulty: "CADET" };
    const L = scoreLanding(landingSnapshot(landingResult({ initialFuel: 200 }), { difficulty: "CADET", siteId: "hadley" }));
    expect(applyLanding(rec, flight, L, 1)).toContain("FIRST_FOOTPRINT");
    expect(applyLanding(rec, flight, L, 2)).toEqual([]);
    expect(applyLanding(rec, { ...flight, id: "b" }, L, 3)).toEqual([]);
    expect(rec.achievements.FIRST_FOOTPRINT).toMatchObject({ at: 1, flightId: "a" });
    expect(unlockedBy(rec, "a")).toContain("FIRST_FOOTPRINT");
    expect(unlockedBy(rec, "b")).toEqual([]);
    // the mission end is applied once per flight
    const m = scoreMission(perfect("CADET", "hadley"));
    expect(applyMission(rec, flight, m, 4).unlocked).toContain("MOUNTAIN_NAVIGATOR");
    expect(applyMission(rec, flight, m, 5)).toMatchObject({ repeat: true, unlocked: [] });
    expect(category(rec, "hadley", "CADET").successes).toBe(1);
  });

  test("destinations, COMMANDER and the elite achievements need successful missions", () => {
    const rec = emptyRecords();
    DESTINATIONS.forEach((s, i) => {
      const m = scoreMission(perfect("COMMANDER", s));
      const got = applyMission(rec, { id: `m${i}`, siteId: s, difficulty: "COMMANDER" }, m, i).unlocked;
      if (i === 0) expect(got).toEqual(["COMMANDER_QUALIFIED", "PERFECT_EXPEDITION"]);
      if (s === "far-side") expect(got).toEqual(["FOUR_DESTINATIONS", "SILENT_HORIZON_VETERAN", "LUNAVIA_MASTER"]);
    });
    expect(achievementProgress("LUNAVIA_MASTER", rec)).toEqual({ done: 4, of: 4 });
    // a completed flight that lost a capsule on entry is not a successful mission
    const rec2 = emptyRecords();
    const lost = scoreMission({ ...perfect("COMMANDER", "hadley"), reentry: reentrySnapshot(entryData({ attempts: 2, losses: ["THERMAL"] }), { difficulty: "COMMANDER" }) });
    expect(applyMission(rec2, { id: "x", siteId: "hadley", difficulty: "COMMANDER" }, lost, 1).unlocked).toEqual([]);
    expect(category(rec2, "hadley", "COMMANDER").successes).toBe(0);
  });
});

describe("records and persistence", () => {
  const fly = (rec, id, siteId, difficulty, distance = 0, at = 1) => {
    const flight = { id, siteId, difficulty };
    applyFlightStart(rec, flight);
    const p = perfect(difficulty, siteId);
    const m = scoreMission({ ...p, landing: landingSnapshot(landingResult({ distance, initialFuel: DIFFICULTY[difficulty].initialFuel, fuelLeft: DIFFICULTY[difficulty].initialFuel - LANDING_FUEL_REF[difficulty][siteId] }), { difficulty, siteId }) });
    applyLanding(rec, flight, m.landing, at);
    applyDocking(rec, flight, m.docking, at);
    applyReentry(rec, flight, m.reentry, at);
    return { m, out: applyMission(rec, flight, m, at) };
  };

  test("9. personal best: the first scored mission, then only a strictly higher score", () => {
    const rec = emptyRecords();
    const a = fly(rec, "1", "tycho", "ASTRONAUT", 10);
    expect(a.out).toMatchObject({ prev: null, newBest: true });
    const b = fly(rec, "2", "tycho", "ASTRONAUT", 20);
    expect(b.out.newBest).toBe(false);
    expect(b.out.prev.score).toBe(a.m.total);
    const c = fly(rec, "3", "tycho", "ASTRONAUT", 10);
    expect(c.out.newBest).toBe(false); // equal is not a new best
    const d = fly(rec, "4", "tycho", "ASTRONAUT", 0);
    expect(d.out).toMatchObject({ newBest: true });
    expect(d.out.prev.score).toBe(a.m.total);
    expect(category(rec, "tycho", "ASTRONAUT")).toMatchObject({ attempts: 4, successes: 4, bestMedal: "GOLD" });
    expect(category(rec, "tycho", "ASTRONAUT").bestTotal.score).toBe(d.m.total);
  });

  test("10. persistence: records survive a restart (reload from storage); damaged or newer data is never destroyed", () => {
    updateRecords((rec) => fly(rec, "p1", "hadley", "COMMANDER"));
    const reloaded = loadRecords(); // a new session reads the same storage
    expect(category(reloaded, "hadley", "COMMANDER")).toMatchObject({ attempts: 1, successes: 1, bestMedal: "PLATINUM" });
    expect(reloaded.achievements.FIRST_FOOTPRINT.flightId).toBe("p1");
    // damaged: kept aside, never overwritten, and the game starts clean
    window.localStorage.setItem(RECORDS_KEY, "{oops");
    const fresh = loadRecords();
    expect(fresh.categories).toEqual({});
    expect(window.localStorage.getItem(`${RECORDS_KEY}.damaged`)).toBe("{oops");
    // written by a newer version of the game: read, never written back
    const newer = JSON.stringify({ schema: 99, categories: { "tycho|CADET": { attempts: 3 } }, achievements: {} });
    window.localStorage.setItem(RECORDS_KEY, newer);
    const r = loadRecords();
    expect(r.readOnly).toBe(true);
    expect(category(r, "tycho", "CADET").attempts).toBe(3);
    saveRecords(r);
    expect(window.localStorage.getItem(RECORDS_KEY)).toBe(newer);
    // junk inside a valid document is dropped, the rest kept
    window.localStorage.setItem(RECORDS_KEY, JSON.stringify({ schema: 1, categories: { "tycho|CADET": { attempts: 2, bestTotal: { score: 5000 } }, "mars|CADET": { attempts: 9 } }, achievements: { NOPE: {}, WELCOME_HOME: { at: 5 } } }));
    const s = loadRecords();
    expect(Object.keys(s.categories)).toEqual(["tycho|CADET"]);
    expect(category(s, "tycho", "CADET")).toMatchObject({ attempts: 2, bestTotal: null });
    expect(Object.keys(s.achievements)).toEqual(["WELCOME_HOME"]);
  });

  test("11–12. twelve categories: records are separate by destination and by pilot difficulty", () => {
    const rec = emptyRecords();
    let n = 0;
    SITE_IDS.forEach((s) => ["CADET", "ASTRONAUT", "COMMANDER"].forEach((d) => fly(rec, `c${n++}`, s, d, n % 7)));
    expect(Object.keys(rec.categories).sort()).toHaveLength(12);
    SITE_IDS.forEach((s) =>
      ["CADET", "ASTRONAUT", "COMMANDER"].forEach((d) => {
        const c = category(rec, s, d);
        expect([c.attempts, c.successes]).toEqual([1, 1]);
        expect(c.bestMedal).toBe(d === "COMMANDER" && c.bestTotal.score >= 950 ? "PLATINUM" : c.bestTotal.score >= 850 ? "GOLD" : "SILVER");
      })
    );
    fly(rec, "extra", "tycho", "CADET");
    expect(category(rec, "tycho", "CADET").attempts).toBe(2);
    expect(category(rec, "tycho", "ASTRONAUT").attempts).toBe(1);
    expect(category(rec, "hadley", "CADET").attempts).toBe(1);
  });

  test("13. training stays separate: neither store writes the other", () => {
    recordAttempt("landing", "full-descent", "ASTRONAUT", { success: true, landed: true, rank: 90, label: "A · 90", grade: "A", fuelPct: 40, accuracy: 2 });
    updateRecords((rec) => fly(rec, "t1", "tranquillitatis", "ASTRONAUT"));
    expect(Object.keys(loadProgress())).toEqual(["landing.full-descent.ASTRONAUT"]);
    expect(Object.keys(loadRecords().categories)).toEqual(["tranquillitatis|ASTRONAUT"]);
    expect(Object.keys(window.localStorage).sort()).toEqual(["lunavia.mission.records.v1", "lunavia.training.v2"]);
  });

  test("the log before scoring: only what it proves is taken over (attempts, phase firsts), no score or medal", () => {
    const a = logMissionStart({ siteId: "hadley", difficulty: "ASTRONAUT" });
    logMissionLanding(a, { crashed: false, grade: "A", score: 86, zone: "PRIMARY LZ", fuelPct: 31, terrain: { site: "hadley" }, breakdown: { vy: { value: 0.8 }, vx: { value: 0.2 }, tilt: { value: 1 }, accuracy: { distance: 2 } } });
    logMissionDocking(a, { success: true, attempts: 1, restarts: 0 });
    logMissionComplete(a);
    const b = logMissionStart({ siteId: "tycho", difficulty: "COMMANDER" }); // never flown
    expect(b).toBeTruthy();
    const rec = loadRecords();
    expect(rec.legacyImported).toBe(true);
    expect(Object.keys(rec.categories)).toEqual(["hadley|ASTRONAUT"]);
    expect(category(rec, "hadley", "ASTRONAUT")).toMatchObject({ attempts: 1, successes: 0, legacyCompleted: 1, bestTotal: null, bestMedal: null, firstAttemptDockings: 1 });
    expect(Object.keys(rec.achievements).sort()).toEqual(["FIRST_ATTEMPT_DOCKING", "FIRST_CONTACT", "FIRST_FOOTPRINT", "WELCOME_HOME"]);
    expect(rec.achievements.FIRST_CONTACT.legacy).toBe(true);
    // imported once: a second load does not count the flight again
    expect(category(loadRecords(), "hadley", "ASTRONAUT").attempts).toBe(1);
    expect(importLegacy({ ...emptyRecords(), legacyImported: true }, []).categories).toEqual({});
  });
});

describe("16. fair scoring on telemetry the game actually produces (reference pilots, all 12 combinations)", () => {
  // the reentry flown as ReentryGame flies it: the presentation time scale, cues every 0.6 s, a pilot's lag, the bank sampling
  function flyEntry(fpa, { lag = 0.6 } = {}) {
    const s = createEntryState({ fpaDeg: fpa, bankDeg: 0 });
    let realT = 0;
    let lastCue = -1;
    let target = 0;
    const pending = [];
    const b = { onT: 0, totalT: 0, rec: null, nextRec: 0 };
    const dt = 1 / 30;
    while (!s.outcome && realT < 600) {
      realT += dt;
      if (s.v > 3000 && s.drogueT === null && realT - lastCue > 0.6) {
        lastCue = realT;
        pending.push({ at: realT + lag, cue: recommendBank(s).bank });
      }
      while (pending.length && pending[0].at <= realT) target = pending.shift().cue;
      s.rollInput = s.v > 3000 ? rollToward(s.bank, target) : 0;
      const simDt = dt * timeScaleFor(s);
      if (s.entered && s.v > 3000 && s.drogueT === null) {
        if (realT >= b.nextRec) {
          b.rec = recommendBank(s).bank;
          b.nextRec = realT + 0.75;
        }
        b.totalT += simDt;
        if (liftAgrees(s.bank, b.rec)) b.onT += simDt;
      }
      advance(s, simDt);
    }
    return { outcome: s.outcome, eiFpa: fpa, peakG: s.peak.g, peakHeatRate: s.peak.heatRate, heatLoad: s.heatLoad, overheat: s.overheat, shieldPct: Math.max(s.heatLoad / LIMITS.heatLoadCapacity, s.overheat / LIMITS.overheatBudget) * 100, bankAgreement: b.totalT > 1 ? b.onT / b.totalT : null, splashV: s.splashV, attempts: 1, losses: [] };
  }
  const dockingOf = (d, lag) => {
    const r = flyDocking(d, guidedPilot(d, { lag }), { lag, maxT: 1200 });
    const cap = r.events.find((e) => e.kind === "capture");
    return { success: r.docked, attempts: 1, restarts: 0, attemptContacts: r.state.contacts, propLeft: r.state.prop, capture: cap ? cap.facts : null };
  };

  test("the ideal-burn table is the ideal burn the descent allows (landerPilots idealBurn)", () => {
    Object.keys(DIFFICULTY).forEach((d) =>
      SITE_IDS.forEach((s) => {
        const st = siteStart(getSite(s), DIFFICULTY[d], null);
        expect(Math.abs(idealBurn(DIFFICULTY[d], { alt: st.alt, vy: st.vy }).fuelUsed - LANDING_FUEL_REF[d][s])).toBeLessThan(0.06);
      })
    );
  });

  test("real flights score in sensible bands, the best reach the top medals, and every phase gate is the physics' own", () => {
    const entries = { nominal: flyEntry(TARGET_FPA), steep: flyEntry(TARGET_FPA - 0.3, { lag: 1.2 }) };
    expect(entries.nominal.outcome).toBe(OUTCOME.SPLASHDOWN);
    const dock = Object.fromEntries(Object.keys(DOCKING).map((d) => [d, { good: dockingOf(d, 0.35), slow: dockingOf(d, 0.9) }]));
    const rec = emptyRecords();
    const table = [];
    SITE_IDS.forEach((siteId) =>
      Object.keys(DIFFICULTY).forEach((difficulty) => {
        const cfg = DIFFICULTY[difficulty];
        const site = getSite(siteId);
        const land = (strategy, opts) => simulate(cfg, humanPilot(cfg, strategy, opts), { site }).result;
        const best = land(precisionStrategy(), { lag: 0.25, seed: 1 });
        const typical = land(guidedStrategy(), { lag: 0.45, seed: 2 });
        [best, typical].forEach((r) => expect(r.crashed).toBe(false));
        const f = createFlightScoring({ id: `${siteId}-${difficulty}`, siteId, difficulty });
        f.beginDescent();
        f.landed(best);
        const D = f.docking(dock[difficulty].good);
        expect(D.success).toBe(true);
        f.splashdown(entries.nominal);
        const top = f.mission();
        // the same pilot on an off-day: a looser landing, a slower docking, a steeper entry
        const g = createFlightScoring({ id: `${siteId}-${difficulty}-b`, siteId, difficulty });
        g.beginDescent();
        g.landed(typical);
        g.docking({ ...dock[difficulty].slow, attempts: 2, restarts: 1 });
        g.splashdown(entries.steep);
        const off = g.mission();
        table.push([siteId, difficulty, top.total, top.medal, off.total, off.medal]);
        expect(top.eligible && off.eligible).toBe(true);
        expect(top.total).toBeGreaterThan(off.total);
        expect(top.total).toBeGreaterThanOrEqual(850); // a precise reference flight earns at least GOLD
        expect(off.total).toBeGreaterThanOrEqual(600);
        expect(off.total).toBeLessThan(950);
        applyFlightStart(rec, f.flight);
        applyLanding(rec, f.flight, top.landing);
        applyDocking(rec, f.flight, top.docking);
        applyReentry(rec, f.flight, top.reentry);
        applyMission(rec, f.flight, top);
      })
    );
    // progression: the twelve categories all recorded, PLATINUM only on COMMANDER
    expect(Object.keys(rec.categories)).toHaveLength(12);
    table.forEach(([, difficulty, , medal]) => expect(medal === "PLATINUM").toBe(difficulty === "COMMANDER" && table.find((t) => t[1] === difficulty && t[3] === medal)[2] >= 950));
    expect(table.some(([, d, t]) => d === "COMMANDER" && t >= 950)).toBe(true); // PLATINUM is achievable
    // eslint-disable-next-line no-console
    console.log(table.map((t) => t.join(" ")).join("\n"));
  });

  test("a recommendation is always drawn from the flight's own numbers", () => {
    const p = perfect("COMMANDER");
    const t = DOCKING.COMMANDER.tol;
    const m = scoreMission({ ...p, docking: dockingSnapshot(dockResult("COMMANDER", { lateral: t.lateral * 0.95 }), { difficulty: "COMMANDER" }) });
    expect(m.medal).toBe("GOLD");
    const r = recommendation(m, emptyRecords());
    expect(r).toMatchObject({ id: "next-component", medal: "PLATINUM", phase: "docking", component: "alignment", need: 950 - m.total });
    expect(r.lost).toBe(70 - m.docking.components.find((c) => c.id === "alignment").points);
    expect(recommendationText(r, "en")).toMatch(/docking-port alignment.*PLATINUM/);
    expect(recommendationText(r, "pt")).toMatch(/alinhamento com a porta.*PLATINA/);
    // failed gates come first
    expect(recommendation(scoreMission({ ...p, docking: null, reentry: null }), null).id).toBe("gate-docking");
    // every component has words in both languages
    const all = scoreMission(perfect("ASTRONAUT", "hadley"));
    ["landing", "docking", "reentry"].forEach((ph) =>
      all[ph].components.forEach((c) => ["en", "pt"].forEach((l) => expect(componentText(ph, c, all[ph].snapshot, l).how.length).toBeGreaterThan(10)))
    );
  });
});

describe("18. scoring never touches the spacecraft physics", () => {
  const SRC = path.resolve(__dirname, "..");
  const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
  test("the scoring modules only read constants from the simulations and never call or mutate them", () => {
    ["data/missionScoring.js", "data/flightScoring.js", "lib/missionRecords.js"].forEach((f) => {
      const src = read(f);
      expect(src).not.toMatch(/\bstepDocking\b|\bstepLander\b|\bstepFrame\b|\badvance\(|\bstep\(|restoreCheckpoint|createEntryState|simRef|Math\.random|Date\.now\(\)\s*[-+]/);
    });
    expect(read("data/missionScoring.js")).toMatch(/import \{ DIFFICULTY \} from "\.\/landingPhysics";/);
  });
  test("the touchdown grade, the capture judgement and the entry are unchanged: same inputs, same verdicts", () => {
    const cfg = DIFFICULTY.ASTRONAUT;
    const r = simulate(cfg, humanPilot(cfg, guidedStrategy(), { lag: 0.3, seed: 1 }), { site: getSite("hadley") }).result;
    const again = simulate(cfg, humanPilot(cfg, guidedStrategy(), { lag: 0.3, seed: 1 }), { site: getSite("hadley") }).result;
    expect(again).toEqual(r);
    expect(Object.keys(r)).toEqual(expect.arrayContaining(["crashed", "grade", "score", "breakdown", "fuelLeft", "initialFuel", "time"]));
    // the score on the landing result screen is still the /100 grade, untouched by mission scoring
    expect(r.score).toBe(Object.values(r.breakdown).reduce((a, b) => a + b.score, 0));
    const s = checkpointState("CADET");
    expect(s.prop).toBe(DOCKING.CADET.prop);
  });
});


describe("the manual ascent's achievements (outside the score)", () => {
  const { newAchievements: na, TOTAL_MAX: TM, PHASES: PH } = require("./missionScoring");
  test("a manual insertion unlocks HAND-FLOWN ASCENT, a precise one PRECISE INSERTION; the guided ascent or a failure nothing", () => {
    expect(na("ascent", { ascent: { mode: "manual", success: true, accuracy: { grade: "GOOD", miss: 4 } } }, {})).toEqual(["HAND_FLOWN_ASCENT"]);
    expect(na("ascent", { ascent: { mode: "manual", success: true, accuracy: { grade: "PRECISE", miss: 0.4 } } }, {})).toEqual(["HAND_FLOWN_ASCENT", "PRECISE_INSERTION"]);
    expect(na("ascent", { ascent: { mode: "guided", success: true } }, {})).toEqual([]);
    expect(na("ascent", { ascent: { mode: "manual", success: false } }, {})).toEqual([]);
    expect(na("ascent", { ascent: { mode: "manual", success: true, accuracy: { grade: "PRECISE" } } }, { HAND_FLOWN_ASCENT: {} })).toEqual(["PRECISE_INSERTION"]);
  });
  test("the score is unchanged: 1,000 points over landing, docking and reentry only", () => {
    expect(TM).toBe(1000);
    expect(PH).toEqual(["landing", "docking", "reentry"]);
  });
});
