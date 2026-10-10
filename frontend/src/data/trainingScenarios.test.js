import { DIFFICULTY, PRIMARY_LZ, gradeLanding } from "./landingPhysics";
import { simulate, initialState } from "./landerSim";
import { fly, humanPilot, guidedStrategy, profileStrategy } from "./landerPilots";
import { createEntryState, step, recommendBank, rollToward, OUTCOME, SIM_DT, NOMINAL_FPA } from "./reentryPhysics";
import { timeScaleFor, ENTRY_DIFFICULTY } from "./reentryGuidance";
import { DANGER, OK } from "./descentProfile";
import {
  LANDING_SCENARIOS, REENTRY_SCENARIOS, REFERENCE_STATE, SHALLOW_FPA, STEEP_FPA,
  landingObjectiveMet, findScenario, difficultyFor,
} from "./trainingScenarios";
import { landingCoach, createReentryCoach } from "./trainingCoach";
import { landingDebrief, reentryDebrief, liftAgrees } from "./trainingDebrief";

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

describe("lunar training starts are taken from a real descent", () => {
  const passAt = (cfg, alt) => {
    const r = simulate(cfg, humanPilot(cfg, guidedStrategy(), { lag: 0.3, seed: 1 }), { trace: true });
    const i = r.trace.findIndex((x) => x.alt <= alt);
    // engine duty over the last second (60 fps samples)
    const win = r.trace.slice(Math.max(0, i - 60), i + 1);
    return { ...r.trace[i], duty: win.reduce((a, x) => a + x.thr, 0) / win.length };
  };

  test("reference states match the guided pilot's descent, and never give more fuel", () => {
    for (const k of KEYS) {
      const cfg = DIFFICULTY[k];
      for (const [id, alt] of [["drift", 220], ["precision", 120]]) {
        const ref = passAt(cfg, alt);
        const tbl = REFERENCE_STATE[id][k];
        expect(Math.abs(ref.vy - tbl.vy)).toBeLessThan(1.0);
        expect(tbl.fuelFrac).toBeLessThanOrEqual(ref.fuel / cfg.initialFuel + 1e-9);
        expect(ref.fuel / cfg.initialFuel - tbl.fuelFrac).toBeLessThan(0.05);
        expect(tbl.throttle).toBe(ref.duty >= 0.5 ? 1 : 0);
      }
    }
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
    for (const lag of LAGS) for (const seed of SEEDS) runs.push(fly(cfg, strategy, { init, lag, seed }));
    return runs;
  };

  test.each(KEYS)("%s: drift and precision scenarios are landable by simulated pilots", (k) => {
    const cfg = DIFFICULTY[k];
    for (const id of ["drift", "precision"]) {
      const init = findScenario("landing", id).init(k);
      const guided = campaign(cfg, guidedStrategy(), init);
      const profile = campaign(cfg, profileStrategy(), init);
      const rate = (runs) => runs.filter((r) => r.landed).length / runs.length;
      // COMMANDER keeps the mission's tight fuel and limits: simulated pilots
      // land 78-94 % of these starts, as they do the COMMANDER mission.
      const need = k === "COMMANDER" ? 0.75 : 0.9;
      expect(rate(guided)).toBeGreaterThanOrEqual(need);
      expect(rate(profile)).toBeGreaterThanOrEqual(need);
      if (id === "precision") {
        const inLz = guided.filter((r) => r.landed && Math.abs(r.x - PRIMARY_LZ.x) < PRIMARY_LZ.r).length / guided.length;
        expect(inLz).toBeGreaterThanOrEqual(need);
      }
    }
  });

  test("the drift scenario is a real problem: left alone, the drift crashes the LM", () => {
    for (const k of KEYS) {
      const cfg = DIFFICULTY[k];
      const init = findScenario("landing", "drift").init(k);
      const g = guidedStrategy();
      const noRcs = (seen, mem, c, t) => ({ ...g(seen, mem, c, t), strafeLeft: false, strafeRight: false, left: false, right: false });
      const r = fly(cfg, noRcs, { init, lag: 0.3, seed: 1 });
      expect(r.landed).toBe(false);
    }
  });
});

describe("objectives are never easier than the mission", () => {

  test("a crash never meets an objective", () => {
    const crash = gradeLanding({ ...base, vy: -3, xPos: 0 });
    expect(crash.crashed).toBe(true);
    for (const sc of LANDING_SCENARIOS) expect(landingObjectiveMet(sc.id, crash)).toBe(false);
  });

  test("precision needs the primary LZ; the other scenarios need a safe landing", () => {
    const near = gradeLanding({ ...base, xPos: 2 });
    const off = gradeLanding({ ...base, xPos: 12, safeZone: null });
    expect(landingObjectiveMet("precision", near)).toBe(true);
    expect(landingObjectiveMet("precision", off)).toBe(false);
    expect(landingObjectiveMet("guided", off)).toBe(true);
  });
});

describe("instructor and debrief", () => {
  const cfg = DIFFICULTY.CADET;
  const okProfile = { vyState: OK, vxState: OK, tiltState: OK, fuelState: OK, brakeTime: Infinity };
  const d = (over) => ({ t: 20, alt: 300, vy: -10, vx: 0, tilt: 0, cfg, profile: okProfile, projectedHazard: false, distanceToLZ: 30, ended: false, ...over });

  test("guidance shrinks with difficulty", () => {
    const danger = d({ profile: { ...okProfile, vyState: DANGER } });
    expect(landingCoach(danger, "guided", "CADET").tone).toBe("warn");
    expect(landingCoach(danger, "guided", "ASTRONAUT")).toBeNull();
    expect(landingCoach(danger, "commander", "COMMANDER")).toBeNull();
    expect(landingCoach(d({ t: 1 }), "commander", "COMMANDER").title).toBe("COMMANDER CHALLENGE");
    expect(landingCoach(d({ ended: true }), "guided", "CADET")).toBeNull();
  });

  test("reentry coach: intro first, then danger calls for CADET only", () => {
    const u = { phase: "ENTRY", realT: 0, vel: 10500, pred: "SHALLOW", climbing: false, g: 1, q: 10, shield: 0, blackout: false, inBand: true };
    const cadet = createReentryCoach("shallow", "CADET");
    expect(cadet(u).title).toBe("SKIP RISK");
    expect(cadet({ ...u, realT: 10 }).title).toBe("ATMOSPHERIC SKIP");
    const cmd = createReentryCoach("commander", "COMMANDER");
    expect(cmd(u)).not.toBeNull();
    expect(cmd({ ...u, realT: 10 })).toBeNull();
  });

  test("landing debrief reports the graded touchdown and a fitting recommendation", () => {
    const r = gradeLanding({ ...base, vy: -3.1, xPos: 4 });
    const db = landingDebrief(r, "guided", DIFFICULTY.COMMANDER);
    expect(db.success).toBe(false);
    expect(db.rows.find((x) => x.label === "TOUCHDOWN V/S").value).toBe("3.1 m/s");
    expect(db.recommendation).toMatch(/3\.1 m\/s/);
    const dry = gradeLanding({ ...base, xPos: 0, fuel: 0, fuelDepletedInFlight: true });
    expect(landingDebrief(dry, "guided", DIFFICULTY.COMMANDER).recommendation).toMatch(/Fuel ran out/);
  });

  test("reentry debrief carries the flown values and the failure reason", () => {
    const s = crew(SHALLOW_FPA, 0, { policy: "hold" });
    const db = reentryDebrief({
      outcome: s.outcome, eiFpa: s.ei.fpa, peakG: s.peak.g, peakHeatRate: s.peak.heatRate,
      heatLoad: s.heatLoad, overheat: s.overheat, shieldPct: 10, bankAgreement: 0.2, rollDeg: 0, splashV: null,
    });
    expect(db.success).toBe(false);
    expect(db.reasons[0]).toMatch(/SKIP/);
    expect(db.rows[0].value).toBe(`${SHALLOW_FPA.toFixed(2)}°`);
    expect(db.recommendation).toMatch(/DOWN/);
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
