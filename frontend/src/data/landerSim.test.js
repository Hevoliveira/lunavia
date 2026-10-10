import { DIFFICULTY, MOON_G } from "./landingPhysics";
import {
  initialState, stepLander, stepFrame, simulate, tiltRateFor, rcsAccelFor,
  THROTTLE_SPOOL_UP, THROTTLE_SPOOL_DOWN, RCS_ACCEL,
} from "./landerSim";
import {
  assessDescent, predictTouchdownX, minLandingFuel, hoverFuelRate, rateEnvelope, brakeIn,
} from "./descentProfile";
import {
  fly, humanPilot, idealBurn, guidedStrategy, profileStrategy, lateBrakeStrategy,
  earlyBrakeStrategy, tiltStrategy, beginnerStrategy, withoutRcs, BEGINNER_HANDICAP,
} from "./landerPilots";

const { CADET, ASTRONAUT, COMMANDER } = DIFFICULTY;
// COMMANDER as it shipped before the rebalance.
const OLD_COMMANDER = {
  ...COMMANDER, initialFuel: 105, safeVy: 1.5, safeVx: 1.0, tiltRate: 38,
  tiltFine: undefined, rcsFine: undefined, fineRamp: undefined,
};

// Reaction times 0.2-0.45 s and several noise seeds: a balance claim must hold
// across pilots, not for one lucky run.
const LAGS = [0.2, 0.3, 0.45];
const SEEDS = [1, 2, 3, 4, 5, 6];
function campaign(cfg, strategy, opts = {}, lags = LAGS) {
  const runs = [];
  for (const lag of lags) for (const seed of SEEDS) runs.push(fly(cfg, strategy, { ...opts, lag, seed }));
  return {
    runs,
    rate: runs.filter((r) => r.landed).length / runs.length,
    reasons: runs.flatMap((r) => r.reasons),
  };
}

describe("lander integrator", () => {
  // The integrator as it was inline in DescentGame before it moved to
  // landerSim. With fine control off, the shared step must reproduce it.
  function legacyStep(p, inp, cfg, dt) {
    const throttleTarget = inp.throttle && p.fuel > 0 ? 1 : 0;
    const spool = throttleTarget > p.throttle ? 2.8 : 1.9;
    p.throttle += (throttleTarget - p.throttle) * Math.min(1, dt * spool);
    let dTilt = 0;
    if (inp.left) dTilt -= cfg.tiltRate * dt;
    if (inp.right) dTilt += cfg.tiltRate * dt;
    if (!inp.left && !inp.right && cfg.tiltAssist) dTilt -= Math.sign(p.tilt) * Math.min(Math.abs(p.tilt), 15 * dt);
    p.tilt = Math.max(-45, Math.min(45, p.tilt + dTilt));
    if (inp.strafeLeft) p.vx -= 3 * dt;
    if (inp.strafeRight) p.vx += 3 * dt;
    const fuelBefore = p.fuel;
    p.fuel = Math.max(0, p.fuel - p.throttle * cfg.fuelRate * dt);
    if (fuelBefore > 0 && p.fuel <= 0 && p.alt > 5) p.dry = true;
    const thrustAcc = (p.fuel > 0 ? p.throttle : 0) * cfg.maxThrust;
    const rad = p.tilt * (Math.PI / 180);
    p.vy += (thrustAcc * Math.cos(rad) - MOON_G) * dt;
    p.vx += thrustAcc * Math.sin(rad) * dt;
    p.alt += p.vy * dt;
    p.xPos += p.vx * dt;
  }

  test("reproduces the previous in-game integrator exactly (fine control off)", () => {
    for (const cfg of [CADET, ASTRONAUT, OLD_COMMANDER]) {
      const plain = { ...cfg, tiltFine: undefined, rcsFine: undefined };
      const a = initialState(plain);
      const b = { ...initialState(plain) };
      for (let i = 0; i < 1500; i++) {
        const inp = {
          throttle: i % 90 < 50, left: i % 200 < 20, right: i % 200 > 180 && i % 200 < 195,
          strafeLeft: i % 150 < 10, strafeRight: i % 170 < 12,
        };
        stepLander(a, inp, plain, 1 / 60);
        legacyStep(b, inp, plain, 1 / 60);
      }
      ["alt", "vy", "vx", "xPos", "tilt", "throttle", "fuel"].forEach((k) => expect(a[k]).toBeCloseTo(b[k], 9));
    }
  });

  test("lunar gravity, thrust, spool and fuel flow", () => {
    const p = initialState(COMMANDER);
    stepLander(p, {}, COMMANDER, 1);
    expect(p.vy).toBeCloseTo(COMMANDER.initialVy - MOON_G, 9);
    expect(p.fuel).toBe(COMMANDER.initialFuel);
    // Spool: rising faster than falling, never instantaneous.
    const q = initialState(COMMANDER);
    for (let i = 0; i < 6; i++) stepLander(q, { throttle: true }, COMMANDER, 1 / 60);
    expect(q.throttle).toBeGreaterThan(0.2);
    expect(q.throttle).toBeLessThan(0.3);
    expect(THROTTLE_SPOOL_UP).toBeGreaterThan(THROTTLE_SPOOL_DOWN);
    // Fuel flow is throttle x fuelRate.
    const r = { ...initialState(COMMANDER), throttle: 1 };
    stepLander(r, { throttle: true }, COMMANDER, 0.01);
    expect(COMMANDER.initialFuel - r.fuel).toBeCloseTo(COMMANDER.fuelRate * 0.01, 9);
  });

  test("dry tanks above 5 m are recorded and kill the thrust", () => {
    const p = { ...initialState(COMMANDER), fuel: 0.05, throttle: 1 };
    stepLander(p, { throttle: true }, COMMANDER, 0.1);
    expect(p.fuel).toBe(0);
    expect(p.fuelDepletedInFlight).toBe(true);
    const vy = p.vy;
    stepLander(p, { throttle: true }, COMMANDER, 1);
    expect(p.vy).toBeCloseTo(vy - MOON_G, 9);
  });

  test("fine control: a tap trims finely, a held press reaches full authority", () => {
    for (const cfg of [CADET, ASTRONAUT, COMMANDER]) {
      expect(tiltRateFor(cfg, 0)).toBe(cfg.tiltFine);
      expect(tiltRateFor(cfg, 1)).toBe(cfg.tiltRate);
      expect(rcsAccelFor(cfg, 1)).toBe(RCS_ACCEL);
    }
    // A 0.1 s tap on COMMANDER: about a degree, not the old 3.8 degrees.
    const p = initialState(COMMANDER);
    for (let i = 0; i < 6; i++) stepLander(p, { right: true }, COMMANDER, 1 / 60);
    expect(p.tilt).toBeGreaterThan(0.8);
    expect(p.tilt).toBeLessThan(1.5);
    const old = initialState(OLD_COMMANDER);
    for (let i = 0; i < 6; i++) stepLander(old, { right: true }, OLD_COMMANDER, 1 / 60);
    expect(old.tilt).toBeCloseTo(3.8, 6);
    // Held for 1 s: within 15 % of the full-rate swing.
    const h = initialState(COMMANDER);
    for (let i = 0; i < 60; i++) stepLander(h, { right: true }, COMMANDER, 1 / 60);
    expect(h.tilt).toBeGreaterThan(COMMANDER.tiltRate * 0.85);
    // A 0.1 s RCS tap changes drift by ~0.15 m/s, not 0.3 m/s.
    const s = initialState(COMMANDER);
    for (let i = 0; i < 6; i++) stepLander(s, { strafeLeft: true }, COMMANDER, 1 / 60);
    expect(COMMANDER.initialVx - s.vx).toBeLessThan(0.2);
  });

  test("frames are sub-stepped and the result is independent of frame rate", () => {
    const run = (fps) => simulate(COMMANDER, humanPilot(COMMANDER, guidedStrategy(), { seed: 3 }), { fps });
    const a = run(60);
    const b = run(120);
    expect(a.result.crashed).toBe(false);
    expect(b.result.crashed).toBe(false);
    expect(Math.abs(a.t - b.t)).toBeLessThan(1.5);
    // stepFrame never takes a step longer than 33 ms.
    const p = initialState(COMMANDER);
    const q = initialState(COMMANDER);
    stepFrame(p, {}, COMMANDER, 0.1);
    for (let i = 0; i < 4; i++) stepLander(q, {}, COMMANDER, 0.025);
    expect(p.alt).toBeCloseTo(q.alt, 9);
  });

  test("runs are deterministic", () => {
    const a = fly(COMMANDER, guidedStrategy(), { lag: 0.3, seed: 5 });
    const b = fly(COMMANDER, guidedStrategy(), { lag: 0.3, seed: 5 });
    expect(a).toEqual(b);
  });
});

describe("COMMANDER diagnosis (before the rebalance)", () => {
  test("the old tank could not land even with an ideal braking burn", () => {
    const ideal = idealBurn(OLD_COMMANDER);
    expect(ideal.fuelUsed).toBeGreaterThan(OLD_COMMANDER.initialFuel);
    expect(ideal.possible).toBe(false);
    // Not even from rest at the same altitude.
    expect(idealBurn({ ...OLD_COMMANDER, initialVy: 0 }).possible).toBe(false);
  });

  test("every simulated strategy failed, mostly from dry tanks", () => {
    const c = campaign(OLD_COMMANDER, profileStrategy({ frac: 0.6 }));
    expect(c.rate).toBe(0);
    expect(c.reasons).toContain("FUEL DEPLETED BEFORE TOUCHDOWN");
  });
});

describe("difficulty hierarchy", () => {
  const ratio = (cfg) => idealBurn(cfg).fuelRatio;

  test("fuel margin over the ideal burn: CADET > ASTRONAUT > COMMANDER > 1.3x", () => {
    expect(ratio(CADET)).toBeGreaterThan(ratio(ASTRONAUT));
    expect(ratio(ASTRONAUT)).toBeGreaterThan(ratio(COMMANDER));
    expect(ratio(COMMANDER)).toBeGreaterThan(1.3);
    expect(ratio(COMMANDER)).toBeLessThan(1.6);
  });

  test("COMMANDER keeps the hardest start, the weakest engine and the tightest limits", () => {
    expect(COMMANDER.initialAlt).toBeGreaterThan(ASTRONAUT.initialAlt);
    expect(-COMMANDER.initialVy).toBeGreaterThan(-ASTRONAUT.initialVy);
    expect(COMMANDER.initialVx).toBeGreaterThan(ASTRONAUT.initialVx);
    expect(COMMANDER.maxThrust).toBeLessThan(ASTRONAUT.maxThrust);
    expect(COMMANDER.safeVy).toBeLessThan(ASTRONAUT.safeVy);
    expect(COMMANDER.safeVx).toBeLessThan(ASTRONAUT.safeVx);
    expect(COMMANDER.safeTilt).toBeLessThan(ASTRONAUT.safeTilt);
    expect(COMMANDER.tiltAssist).toBe(false);
  });

  test("the same guided pilot lands every mode, with less fuel to spare each step up", () => {
    const left = [CADET, ASTRONAUT, COMMANDER].map((cfg) => {
      const c = campaign(cfg, guidedStrategy());
      expect(c.rate).toBeGreaterThanOrEqual(0.85);
      const ok = c.runs.filter((r) => r.landed);
      return ok.reduce((a, r) => a + r.fuelPct, 0) / ok.length;
    });
    expect(left[0]).toBeGreaterThan(left[1]);
    expect(left[1]).toBeGreaterThan(left[2]);
  });

  test("a beginner lands less often on COMMANDER than on CADET", () => {
    const rate = (cfg) => campaign(cfg, beginnerStrategy(), BEGINNER_HANDICAP, [0.35, 0.45, 0.55]).rate;
    expect(rate(COMMANDER)).toBeLessThan(rate(CADET));
    expect(rate(COMMANDER)).toBeLessThan(0.5);
  });
});

describe("COMMANDER scenarios (after the rebalance)", () => {
  test("nominal skilled approach lands with a reasonable fuel reserve", () => {
    const c = campaign(COMMANDER, guidedStrategy());
    expect(c.rate).toBeGreaterThanOrEqual(0.85);
    c.runs.filter((r) => r.landed).forEach((r) => {
      expect(r.fuelPct).toBeGreaterThan(5);
      expect(Math.abs(r.vy)).toBeLessThanOrEqual(COMMANDER.safeVy);
      expect(Math.abs(r.vx)).toBeLessThanOrEqual(COMMANDER.safeVx);
      expect(Math.abs(r.tilt)).toBeLessThanOrEqual(COMMANDER.safeTilt);
    });
  });

  test("several different control strategies are viable", () => {
    const strategies = {
      cautiousProfile: profileStrategy({ frac: 0.5 }),
      firmProfile: profileStrategy({ frac: 0.7 }),
      singleBurn: lateBrakeStrategy({ margin: 0.15 }),
      bankToSteer: tiltStrategy(),
    };
    Object.entries(strategies).forEach(([name, s]) => {
      const c = campaign(COMMANDER, s);
      expect([name, c.rate >= 0.6]).toEqual([name, true]);
    });
  });

  test("moderate early braking error: lands, at a fuel cost", () => {
    const c = campaign(COMMANDER, profileStrategy({ frac: 0.3 }));
    expect(c.rate).toBeGreaterThanOrEqual(0.7);
    const early = Math.min(...c.runs.filter((r) => r.landed).map((r) => r.fuelPct));
    const nominal = Math.min(...campaign(COMMANDER, guidedStrategy()).runs.filter((r) => r.landed).map((r) => r.fuelPct));
    expect(early).toBeLessThan(nominal);
  });

  test("moderate horizontal drift (+4 m/s) is recoverable", () => {
    const c = campaign(COMMANDER, guidedStrategy(), { init: { vx: COMMANDER.initialVx + 4 } });
    expect(c.rate).toBeGreaterThanOrEqual(0.7);
  });

  test("late braking: 2 s late recovers, 4 s late does not", () => {
    expect(campaign(COMMANDER, profileStrategy({ frac: 0.5, late: 2 })).rate).toBeGreaterThanOrEqual(0.6);
    const tooLate = campaign(COMMANDER, profileStrategy({ frac: 0.5, late: 4 }));
    expect(tooLate.rate).toBe(0);
    expect(tooLate.reasons).toContain("VERTICAL SPEED EXCEEDED SAFE LIMIT");
  });

  test("excessive lateral velocity: never correcting the drift fails", () => {
    const c = campaign(COMMANDER, withoutRcs(profileStrategy({ frac: 0.5 })));
    expect(c.rate).toBe(0);
    expect(c.reasons).toContain("EXCESSIVE HORIZONTAL SPEED");
  });

  test("fuel mismanagement: hovering down from altitude runs the tanks dry", () => {
    const c = campaign(COMMANDER, earlyBrakeStrategy({ cruise: 6 }));
    expect(c.rate).toBe(0);
    expect(c.reasons).toContain("FUEL DEPLETED BEFORE TOUCHDOWN");
  });

  test("unsafe touchdown: cutting the engine at 15 m is a hard landing", () => {
    const guided = guidedStrategy();
    const cut = (seen, mem, cfg, t) => (seen.alt < 15 ? { throttle: false } : guided(seen, mem, cfg, t));
    const c = campaign(COMMANDER, cut);
    expect(c.rate).toBe(0);
    expect(c.reasons).toContain("VERTICAL SPEED EXCEEDED SAFE LIMIT");
  });

  test("touch handicaps: tap length does not decide the outcome", () => {
    [0.1, 0.15, 0.25].forEach((minPress) => {
      expect(campaign(COMMANDER, guidedStrategy(), { minPress }).rate).toBeGreaterThanOrEqual(0.8);
    });
  });
});

describe("guidance derived from the simulation", () => {
  test("the predicted touchdown point beats the old free-fall estimate", () => {
    // Drift left alone (no RCS), descent following the schedule: compare the
    // prediction made at 400 m with where the vehicle actually lands.
    const pilot = humanPilot(COMMANDER, withoutRcs(guidedStrategy()), { lag: 0.3, seed: 2 });
    const r = simulate(COMMANDER, pilot, { trace: true });
    const at = r.trace.find((s) => s.alt <= 400);
    const actual = r.state.xPos;
    const predicted = predictTouchdownX({ alt: at.alt, vy: at.vy, vx: at.vx, xPos: at.x }, COMMANDER);
    const tFree = (at.vy + Math.sqrt(at.vy * at.vy + 2 * MOON_G * at.alt)) / MOON_G;
    const freeFall = at.x + at.vx * tFree;
    expect(Math.abs(predicted - actual)).toBeLessThan(Math.abs(freeFall - actual) / 2);
    expect(Math.abs(predicted - actual)).toBeLessThan(25);
  });

  test("the braking cue is early enough to act on", () => {
    // Coast until BRAKE reads NOW, then react 0.4 s late with full thrust
    // and fly the target band: still a safe landing.
    const guided = guidedStrategy();
    const cue = (seen, mem, cfg, t) => {
      const a = assessDescent({ ...seen, cfg });
      if (mem.cueAt == null && !a.burning && a.brakeTime < 0.05) mem.cueAt = t;
      if (mem.cueAt == null) return { throttle: false };
      if (t < mem.cueAt + 0.4) return { throttle: false };
      if (!mem.done && -seen.vy > a.envelope.mid) return { throttle: true };
      mem.done = true;
      return guided(seen, mem, cfg, t);
    };
    const c = campaign(COMMANDER, cue);
    expect(c.rate).toBeGreaterThanOrEqual(0.8);
  });

  test("hover reserve: negative for the old tank, positive for the new one", () => {
    const reserve = (cfg) => {
      const h = cfg.initialAlt - 0.5;
      return (cfg.initialFuel - minLandingFuel(h, -cfg.initialVy, cfg)) / hoverFuelRate(cfg);
    };
    expect(reserve(OLD_COMMANDER)).toBeLessThan(0);
    expect(reserve(COMMANDER)).toBeGreaterThan(10);
    // The analytic minimum agrees with the simulated ideal burn within 5 %.
    const sim = idealBurn(COMMANDER).fuelUsed;
    expect(Math.abs(minLandingFuel(COMMANDER.initialAlt - 0.5, -COMMANDER.initialVy, COMMANDER) - sim) / sim).toBeLessThan(0.05);
  });

  test("target band is ordered and narrows to a gentle touchdown rate", () => {
    [800, 300, 100, 20, 2].forEach((h) => {
      const e = rateEnvelope(h, COMMANDER);
      expect(e.lo).toBeLessThanOrEqual(e.mid);
      expect(e.mid).toBeLessThanOrEqual(e.hi);
    });
    expect(rateEnvelope(0, COMMANDER).hi).toBeLessThan(COMMANDER.safeVy);
    expect(brakeIn(749.5, 14, COMMANDER)).toBeGreaterThan(8);
  });
});
