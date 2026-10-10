import { DIFFICULTY, PRIMARY_LZ, MOON_G, gradeLanding } from "./landingPhysics";
import { simulate, initialState } from "./landerSim";
import { fly, humanPilot, guidedStrategy, profileStrategy, precisionStrategy } from "./landerPilots";
import { createEntryState, step, recommendBank, rollToward, OUTCOME, SIM_DT, NOMINAL_FPA } from "./reentryPhysics";
import { timeScaleFor, ENTRY_DIFFICULTY, TRIM_SENSITIVITY, TRIM_RATE, PREP_SECONDS } from "./reentryGuidance";
import { DANGER, CAUTION, OK, brakeIn } from "./descentProfile";
import {
  LANDING_SCENARIOS, REENTRY_SCENARIOS, REFERENCE_STATE, SHALLOW_FPA, STEEP_FPA, COAST_S,
  landingObjectiveMet, findScenario, difficultyFor,
} from "./trainingScenarios";
import { landingCoach, createReentryCoach } from "./trainingCoach";
import { landingDebrief, reentryDebrief, liftAgrees, corridorStatus } from "./trainingDebrief";

const KEYS = ["CADET", "ASTRONAUT", "COMMANDER"];
// A clean COMMANDER touchdown on the primary LZ, varied per test.
const base = { vy: -1, vx: 0.2, tilt: 1, fuel: 50, initialFuel: 160, safeZone: PRIMARY_LZ, hazard: null, safeVy: 2, safeVx: 1.2, safeTilt: 8 };

/*
 * A simulated crew flying the entry in REAL time, the way the game paces it
 * (timeScaleFor): no input for `react` seconds, then a decision every 1/hz s
 * on the state seen `lag` s earlier, rolling at the physical 20°/s.
 *   pred  follows the look-ahead guidance (what the CADET cue shows)
 *   hdot  a rule a player can fly from the gauges: lift down while not
 *         descending, lift up in a fast dive, lift sideways between
 *   hold / up / down  constant attitudes
 */
function crew(fpa, bank0, { policy = "pred", react = 3, lag = 0.8, hz = 2, frame = 1 / 30 } = {}) {
  const s = createEntryState({ fpaDeg: fpa, bankDeg: bank0 });
  const hist = [];
  let real = 0;
  let next = react;
  let target = bank0;
  while (!s.outcome && real < 2000) {
    hist.push({ real, s: { ...s, peak: { ...s.peak } } });
    while (hist.length > 2 && hist[1].real <= real - lag) hist.shift();
    if (real >= next && s.v > 3000) {
      const seen = hist[0].s;
      if (policy === "pred") target = recommendBank(seen).bank;
      else if (policy === "hdot") {
        const hdot = seen.v * Math.sin(seen.gamma);
        target = hdot > -40 ? 180 : hdot < -250 ? 0 : 90;
      } else if (policy === "up") target = 0;
      else if (policy === "down") target = 180;
      next = real + 1 / hz;
    }
    s.rollInput = s.v > 3000 && real >= react ? rollToward(s.bank, target) : 0;
    let rem = frame * timeScaleFor(s);
    while (rem > 1e-9 && !s.outcome) {
      const d = Math.min(SIM_DT, rem);
      step(s, d);
      rem -= d;
    }
    real += frame;
  }
  return s;
}

describe("reentry training starts are chosen by the physics", () => {
  const nominal = crew(NOMINAL_FPA, 0);

  test("scenario table matches the tested angles and attitudes", () => {
    expect(findScenario("reentry", "nominal").start()).toEqual({ phase: "PREP", fpa: NOMINAL_FPA, bank: 0 });
    expect(findScenario("reentry", "shallow").start()).toEqual({ phase: "ENTRY", fpa: SHALLOW_FPA, bank: 0 });
    expect(findScenario("reentry", "steep").start()).toEqual({ phase: "ENTRY", fpa: STEEP_FPA, bank: 180 });
    // COMMANDER challenge uses the mission's own randomised dispersion
    expect(findScenario("reentry", "commander").start().fpa).toBeNull();
    expect(difficultyFor(findScenario("reentry", "commander"), "CADET")).toBe("COMMANDER");
  });

  test("nominal: the managed entry splashes down; holding lift up skips out", () => {
    expect(nominal.outcome).toBe(OUTCOME.SPLASHDOWN);
    expect(crew(NOMINAL_FPA, 0, { policy: "hold" }).outcome).toBe(OUTCOME.SKIP_OUT);
  });

  test("shallow: unmanaged it skips out, managed it is recoverable", () => {
    expect(crew(SHALLOW_FPA, 0, { policy: "hold" }).outcome).toBe(OUTCOME.SKIP_OUT);
    for (const react of [3, 6]) expect(crew(SHALLOW_FPA, 0, { react }).outcome).toBe(OUTCOME.SPLASHDOWN);
    expect(crew(SHALLOW_FPA, 0, { policy: "hdot" }).outcome).toBe(OUTCOME.SPLASHDOWN);
    // one roll and hold is not management: lift down all the way overloads
    expect(crew(SHALLOW_FPA, 0, { policy: "down" }).outcome).not.toBe(OUTCOME.SPLASHDOWN);
  });

  test("shallow: the chosen angle sits inside the recoverable band, with margin", () => {
    for (const fpa of [SHALLOW_FPA + 0.2, SHALLOW_FPA - 0.2]) {
      expect(crew(fpa, 0, { policy: "hold" }).outcome).toBe(OUTCOME.SKIP_OUT);
      expect(crew(fpa, 0).outcome).toBe(OUTCOME.SPLASHDOWN);
    }
  });

  test("steep: unmanaged it breaks up, managed it is recoverable at higher loads", () => {
    expect([OUTCOME.STRUCTURAL, OUTCOME.THERMAL]).toContain(crew(STEEP_FPA, 180, { policy: "hold" }).outcome);
    for (const react of [3, 6]) expect(crew(STEEP_FPA, 180, { react }).outcome).toBe(OUTCOME.SPLASHDOWN);
    const managed = crew(STEEP_FPA, 180, { policy: "hdot" });
    expect(managed.outcome).toBe(OUTCOME.SPLASHDOWN);
    // moderately steep: noticeably harder on the vehicle than the nominal entry
    expect(crew(STEEP_FPA, 180).peak.g).toBeGreaterThan(nominal.peak.g + 1);
    // and lift up all the way is not the answer either: it skips out
    expect(crew(STEEP_FPA, 180, { policy: "up" }).outcome).toBe(OUTCOME.SKIP_OUT);
  });

  test("steep: the chosen angle sits inside the recoverable band, with margin", () => {
    for (const fpa of [STEEP_FPA + 0.1, STEEP_FPA - 0.1]) {
      expect(crew(fpa, 180, { policy: "hold" }).outcome).not.toBe(OUTCOME.SPLASHDOWN);
      expect(crew(fpa, 180).outcome).toBe(OUTCOME.SPLASHDOWN);
    }
  });

  test("an unrecoverable entry stays unrecoverable: training adds no margin", () => {
    // well outside the corridor even the look-ahead guidance cannot save it
    expect(crew(-4.9, 0).outcome).toBe(OUTCOME.SKIP_OUT);
    expect([OUTCOME.STRUCTURAL, OUTCOME.THERMAL]).toContain(crew(-7.6, 180).outcome);
  });
});

describe("lunar training starts are taken from the mission's own flight", () => {
  const passAt = (cfg, alt) => {
    const r = simulate(cfg, humanPilot(cfg, guidedStrategy(), { lag: 0.3, seed: 1 }), { trace: true });
    const i = r.trace.findIndex((x) => x.alt <= alt);
    // engine duty over the last second (60 fps samples)
    const win = r.trace.slice(Math.max(0, i - 60), i + 1);
    return { ...r.trace[i], duty: win.reduce((a, x) => a + x.thr, 0) / win.length };
  };

  test("precision: the reference descent's state at 120 m, never more fuel", () => {
    for (const k of KEYS) {
      const cfg = DIFFICULTY[k];
      const ref = passAt(cfg, 120);
      const tbl = REFERENCE_STATE.precision[k];
      expect(Math.abs(ref.vy - tbl.vy)).toBeLessThan(1.0);
      expect(tbl.fuelFrac).toBeLessThanOrEqual(ref.fuel / cfg.initialFuel + 1e-9);
      expect(ref.fuel / cfg.initialFuel - tbl.fuelFrac).toBeLessThan(0.05);
      expect(tbl.throttle).toBe(ref.duty >= 0.5 ? 1 : 0);
    }
  });

  test("braking: the mission start coasted engine-off, same tank, braking burn ~5 s away", () => {
    for (const k of KEYS) {
      const cfg = DIFFICULTY[k];
      const s = findScenario("landing", "braking").init(k);
      expect(s.fuel).toBe(cfg.initialFuel);
      expect(s.throttle).toBe(0);
      // free fall from the mission start: v = v0 - g t
      expect(s.vy).toBeCloseTo(cfg.initialVy - MOON_G * COAST_S, 6);
      const b = brakeIn(s.alt, -s.vy, cfg);
      expect(b).toBeGreaterThan(4);
      expect(b).toBeLessThan(6);
    }
  });

  test("standard and COMMANDER challenge start exactly where the mission does", () => {
    expect(findScenario("landing", "standard").init("ASTRONAUT")).toBeNull();
    expect(findScenario("landing", "commander").init("CADET")).toBeNull();
    expect(difficultyFor(findScenario("landing", "commander"), "CADET")).toBe("COMMANDER");
  });

  test("scenario starts only set the flight state: limits, thrust and fuel flow are the mission's", () => {
    for (const sc of LANDING_SCENARIOS) {
      for (const k of KEYS) {
        const init = sc.init(k);
        if (!init) continue;
        expect(Object.keys(init).sort()).toEqual(["alt", "fuel", "throttle", "vx", "vy", "xPos"]);
        expect(init.fuel).toBeLessThanOrEqual(DIFFICULTY[k].initialFuel);
        const p = { ...initialState(DIFFICULTY[k]), ...init };
        expect(p.fuelDepletedInFlight).toBe(false);
      }
    }
  });

  const LAGS = [0.2, 0.3, 0.45];
  const SEEDS = [1, 2, 3, 4, 5, 6];
  const campaign = (cfg, strategy, init) => {
    const runs = [];
    for (const lag of LAGS) for (const seed of SEEDS) runs.push(fly(cfg, strategy, init ? { init, lag, seed } : { lag, seed }));
    return runs;
  };
  const rate = (runs, ok = (r) => r.landed) => runs.filter(ok).length / runs.length;
  // COMMANDER keeps the mission's tight fuel and limits: simulated pilots land
  // 78-96 % of its starts, as they do the COMMANDER mission itself.
  const need = (k) => (k === "COMMANDER" ? 0.75 : 0.9);
  const inLz = (r) => r.landed && Math.abs(r.x - PRIMARY_LZ.x) < PRIMARY_LZ.r;

  test.each(KEYS)("%s: every scenario is physically achievable by simulated pilots", (k) => {
    const cfg = DIFFICULTY[k];
    for (const sc of LANDING_SCENARIOS) {
      if (sc.lock && sc.lock !== k) continue;
      const init = sc.init(k);
      const guided = campaign(cfg, guidedStrategy(), init);
      const profile = campaign(cfg, profileStrategy(), init);
      expect(rate(guided)).toBeGreaterThanOrEqual(need(k));
      expect(rate(profile)).toBeGreaterThanOrEqual(need(k));
      // the objective itself, not just a safe landing: precision is flown by a
      // pilot aiming for the centre (precisionStrategy), the rest by the guided one
      const objective = (r) => landingObjectiveMet(sc.id, { crashed: !r.landed, breakdown: { accuracy: { distance: Math.abs(r.x - PRIMARY_LZ.x) } } });
      const flown = sc.id === "precision" ? campaign(cfg, precisionStrategy(), init) : guided;
      expect(rate(flown, objective)).toBeGreaterThanOrEqual(need(k));
    }
  });

  test("braking is a real problem: with no braking the LM crashes at every difficulty", () => {
    for (const k of KEYS) {
      const r = fly(DIFFICULTY[k], () => ({}), { init: findScenario("landing", "braking").init(k), lag: 0.3, seed: 1 });
      expect(r.landed).toBe(false);
      expect(r.reasons).toContain("VERTICAL SPEED EXCEEDED SAFE LIMIT");
    }
  });

  test("COMMANDER keeps the rebalanced configuration (not the old impossible tank)", () => {
    expect(DIFFICULTY.COMMANDER.initialFuel).toBe(160);
    expect(DIFFICULTY.COMMANDER.safeVy).toBe(2.0);
    expect(DIFFICULTY.COMMANDER.safeVx).toBe(1.2);
    expect(DIFFICULTY.COMMANDER.tiltRate).toBe(30);
  });
});

describe("COMMANDER reentry challenge is survivable with skilled input", () => {
  const cfg = ENTRY_DIFFICULTY.COMMANDER;

  test("the worst-case dispersion can be trimmed out inside the prep window", () => {
    const worst = cfg.initialError; // newPrep: |error| <= initialError
    const dvNeeded = worst / TRIM_SENSITIVITY;
    expect(dvNeeded).toBeLessThanOrEqual(cfg.rcsBudget);
    expect(dvNeeded / TRIM_RATE).toBeLessThan(PREP_SECONDS);
  });

  test("trimmed into the corridor, a managed entry splashes down; untrimmed extremes are lost", () => {
    expect(crew(NOMINAL_FPA, 0).outcome).toBe(OUTCOME.SPLASHDOWN);
    // trimmed to within 0.4° of the target, either side: survivable
    expect(crew(NOMINAL_FPA - 0.4, 0).outcome).toBe(OUTCOME.SPLASHDOWN);
    expect(crew(NOMINAL_FPA + 0.4, 0).outcome).toBe(OUTCOME.SPLASHDOWN);
    // no trim at all: the narrow margin is real, both ways
    expect(crew(NOMINAL_FPA + cfg.initialError, 0).outcome).toBe(OUTCOME.SKIP_OUT);
    expect([OUTCOME.THERMAL, OUTCOME.STRUCTURAL]).toContain(crew(NOMINAL_FPA - cfg.initialError, 0).outcome);
  });
});

describe("objectives are never easier than the mission", () => {
  test("a crash never meets an objective", () => {
    const crash = gradeLanding({ ...base, vy: -3, xPos: 0 });
    expect(crash.crashed).toBe(true);
    for (const sc of LANDING_SCENARIOS) expect(landingObjectiveMet(sc.id, crash)).toBe(false);
  });

  test("standard needs the LZ, precision its centre, braking a safe landing", () => {
    const centre = gradeLanding({ ...base, xPos: 2 });
    const inLz = gradeLanding({ ...base, xPos: 4.5 });
    const off = gradeLanding({ ...base, xPos: 12, safeZone: null });
    expect(landingObjectiveMet("precision", centre)).toBe(true);
    expect(landingObjectiveMet("precision", inLz)).toBe(false);
    expect(landingObjectiveMet("standard", inLz)).toBe(true);
    expect(landingObjectiveMet("standard", off)).toBe(false);
    expect(landingObjectiveMet("commander", off)).toBe(false);
    expect(landingObjectiveMet("braking", off)).toBe(true);
  });
});

describe("instructor and debrief", () => {
  const cfg = DIFFICULTY.CADET;
  const okProfile = { vyState: OK, vxState: OK, tiltState: OK, fuelState: OK, brakeTime: Infinity, reserve: 60, envelope: { lo: 5, mid: 10, hi: 20 } };
  const d = (over) => ({ t: 20, alt: 300, vy: -10, vx: 0, tilt: 0, cfg, profile: okProfile, projectedHazard: false, projectedZone: "UNMAPPED TERRAIN", distanceToLZ: 60, outcome: null, ...over });

  test("lunar callouts follow the telemetry, and shrink with difficulty", () => {
    const fast = d({ vy: -30, profile: { ...okProfile, vyState: DANGER } });
    expect(landingCoach(fast, "standard", "CADET").title).toBe("DESCENT RATE HIGH — BEGIN BRAKING");
    expect(landingCoach(fast, "standard", "CADET").text).toMatch(/-30\.0 m\/s/);
    expect(landingCoach(fast, "standard", "ASTRONAUT").title).toBe("DESCENT RATE HIGH — BEGIN BRAKING");
    expect(landingCoach(fast, "commander", "COMMANDER")).toBeNull();
    expect(landingCoach(d({ vx: 3, profile: { ...okProfile, vxState: CAUTION } }), "standard", "CADET").title).toBe("HORIZONTAL VELOCITY EXCESSIVE");
    expect(landingCoach(d({ profile: { ...okProfile, fuelState: CAUTION, reserve: 7 } }), "braking", "CADET").title).toBe("FUEL RESERVE LOW");
    expect(landingCoach(d({ alt: 90, projectedZone: "PRIMARY LZ", distanceToLZ: 10 }), "standard", "CADET").title).toBe("LANDING ZONE AHEAD");
    expect(landingCoach(d({ profile: { ...okProfile, brakeTime: 4.2 } }), "braking", "CADET").title).toBe("BRAKING ALTITUDE");
    expect(landingCoach(d({ outcome: "landed" }), "commander", "COMMANDER").title).toBe("SAFE TOUCHDOWN");
    expect(landingCoach(d({ t: 1 }), "commander", "COMMANDER").title).toBe("COMMANDER CHALLENGE");
  });

  test("reentry callouts: corridor, lift vector, heating, G, recovery, parachutes", () => {
    const u = { phase: "ENTRY", realT: 0, vel: 10500, pred: "NOMINAL", climbing: false, g: 1, q: 10, shield: 0, overheat: 0, blackout: false, inBand: true, drogue: { alt: null }, main: { alt: null } };
    const c = createReentryCoach("shallow", "CADET");
    expect(c(u).title).toBe("SHALLOW EDGE OF CORRIDOR");
    expect(c({ ...u, realT: 10, pred: "SHALLOW" }).title).toBe("ADJUST LIFT VECTOR");
    expect(c({ ...u, realT: 11, pred: "NOMINAL" }).title).toBe("TRAJECTORY RECOVERED");
    expect(c({ ...u, realT: 20, q: 175 }).title).toBe("HEATING APPROACHING LIMIT");
    expect(c({ ...u, realT: 21, g: 6.5 }).title).toBe("G-LOAD INCREASING");
    expect(c({ ...u, realT: 40, vel: 150, drogue: { alt: 7000, v: 200 } }).title).toBe("PARACHUTE CONDITIONS MET");
    const prep = createReentryCoach("nominal", "ASTRONAUT");
    prep({ phase: "PREP", realT: 0 });
    expect(prep({ phase: "PREP", realT: 8, inBand: false, prepFpa: -5.6 }).title).toBe("ENTRY CORRIDOR TOO SHALLOW");
    expect(prep({ phase: "PREP", realT: 9, inBand: false, prepFpa: -7.4 }).title).toBe("ENTRY CORRIDOR TOO STEEP");
    const cmd = createReentryCoach("commander", "COMMANDER");
    expect(cmd(u)).not.toBeNull();
    expect(cmd({ ...u, realT: 10, pred: "SHALLOW" })).toBeNull();
  });

  test("landing debrief: every field from the graded touchdown, a main reason, 1-2 tips", () => {
    const r = gradeLanding({ ...base, vy: -3.1, xPos: 4 });
    const db = landingDebrief(r, "standard", DIFFICULTY.COMMANDER);
    expect(db.success).toBe(false);
    const row = (l) => db.rows.find((x) => x.label === l).value;
    expect(row("VERTICAL TOUCHDOWN")).toBe("3.1 m/s");
    expect(row("HORIZONTAL TOUCHDOWN")).toBe("0.2 m/s");
    expect(row("FINAL ATTITUDE")).toBe("1° tilt");
    expect(row("DISTANCE FROM LZ CENTRE")).toMatch(/^4\.0 m/);
    expect(db.reason).toMatch(/3\.1 m\/s exceeded the 2 m\/s limit/);
    expect(db.recommendations.length).toBeGreaterThanOrEqual(1);
    expect(db.recommendations.length).toBeLessThanOrEqual(2);
    const dry = gradeLanding({ ...base, xPos: 0, fuel: 0, fuelDepletedInFlight: true });
    expect(landingDebrief(dry, "standard", DIFFICULTY.COMMANDER).recommendations[0]).toMatch(/BRAKE cue/);
    const off = landingDebrief(gradeLanding({ ...base, xPos: 4.5 }), "precision", DIFFICULTY.COMMANDER);
    expect(off.title).toBe("LANDED · OBJECTIVE NOT MET");
    expect(off.reason).toMatch(/objective: under 3 m/);
  });

  test("reentry debrief carries the flown values, corridor and parachute status, and the failure reason", () => {
    const s = crew(SHALLOW_FPA, 0, { policy: "hold" });
    const db = reentryDebrief({
      outcome: s.outcome, eiFpa: s.ei.fpa, peakG: s.peak.g, peakHeatRate: s.peak.heatRate,
      heatLoad: s.heatLoad, overheat: s.overheat, shieldPct: 10, bankAgreement: 0.2, rollDeg: 0, splashV: null,
      drogue: s.drogue, main: s.main,
    });
    const row = (l) => db.rows.find((x) => x.label === l).value;
    expect(db.success).toBe(false);
    expect(db.reason).toMatch(/Atmospheric skip/);
    expect(row("INITIAL ENTRY ANGLE")).toBe(`${SHALLOW_FPA.toFixed(2)}°`);
    expect(row("ENTRY CORRIDOR")).toBe("INSIDE · SHALLOW EDGE");
    expect(corridorStatus(-5.3).text).toBe("SHALLOW OF CORRIDOR");
    expect(corridorStatus(-7.4).text).toBe("STEEP OF CORRIDOR");
    expect(corridorStatus(STEEP_FPA).text).toBe("INSIDE · STEEP EDGE");
    expect(row("PARACHUTES")).toBe("NOT DEPLOYED");
    expect(row("SPLASHDOWN VELOCITY")).toBe("—");
    expect(db.recommendations[0]).toMatch(/DOWN/);

    const ok = crew(NOMINAL_FPA, 0);
    const good = reentryDebrief({
      outcome: ok.outcome, eiFpa: ok.ei.fpa, peakG: ok.peak.g, peakHeatRate: ok.peak.heatRate, heatLoad: ok.heatLoad,
      overheat: ok.overheat, shieldPct: 40, bankAgreement: 0.8, rollDeg: 500, splashV: ok.splashV, drogue: ok.drogue, main: ok.main,
    });
    expect(good.success).toBe(true);
    expect(good.rows.find((x) => x.label === "ENTRY CORRIDOR").value).toBe("INSIDE CORRIDOR");
    expect(good.rows.find((x) => x.label === "PARACHUTES").value).toMatch(/^DROGUE \d+\.\d km · MAIN \d+\.\d km$/);
    expect(good.rows.find((x) => x.label === "SPLASHDOWN VELOCITY").value).toBe(`${ok.splashV.toFixed(1)} m/s`);
  });

  test("bank agreement compares vertical lift, either roll direction", () => {
    expect(liftAgrees(170, -170)).toBe(true);
    expect(liftAgrees(0, 180)).toBe(false);
    expect(liftAgrees(45, -45)).toBe(true);
  });

  test("training uses the mission's guidance settings for each difficulty", () => {
    for (const k of KEYS) expect(ENTRY_DIFFICULTY[k]).toBeDefined();
  });
});
