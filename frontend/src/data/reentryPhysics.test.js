import {
  createEntryState,
  step,
  advance,
  density,
  heatRate,
  recommendBank,
  rollToward,
  predict,
  OUTCOME,
  LIMITS,
  CHUTES,
  CORRIDOR,
  EI_ALT,
  G0,
  SIM_DT,
} from "./reentryPhysics";

const DEG = Math.PI / 180;

// Fly a complete entry with a bank policy f(state) -> bank (deg). Records samples.
function fly(fpaDeg, policy, { dt = SIM_DT, maxT = 4000 } = {}) {
  const s = createEntryState({ fpaDeg });
  const trace = { maxH: s.h, climbed: false, heatAfterPeak: [] };
  while (!s.outcome && s.t < maxT) {
    if (policy) s.bank = policy(s);
    step(s, dt);
    if (s.gamma > 0) trace.climbed = true;
    if (s.entered) trace.maxH = Math.max(trace.maxH, s.h);
  }
  return { s, trace };
}

// Simple altitude-rate guidance: lift up while diving, lift down while climbing.
const altRateGuidance = (s) => {
  const hdot = s.v * Math.sin(s.gamma);
  const c = Math.max(-1, Math.min(1, (-30 - hdot) / 150));
  return Math.acos(c) / DEG;
};
const liftUp = () => 0;
const liftDown = () => 180;

// Look-ahead guidance (what the CADET cue uses), flown with the physical roll rate.
function flyWithPredictor(fpaDeg) {
  const s = createEntryState({ fpaDeg });
  let next = 0;
  let target = 0;
  while (!s.outcome && s.t < 4000) {
    if (s.t >= next && s.v > 3000) {
      target = recommendBank(s).bank;
      next = s.t + 2;
    }
    s.rollInput = s.v > 3000 ? rollToward(s.bank, target) : 0;
    step(s);
  }
  return s;
}

describe("atmosphere and loads are physical, not scripted", () => {
  test("density increases monotonically as altitude decreases", () => {
    let prev = 0;
    for (let h = 140e3; h >= 0; h -= 5e3) {
      const rho = density(h);
      expect(rho).toBeGreaterThan(prev);
      prev = rho;
    }
    expect(density(0)).toBeCloseTo(1.225, 3);
  });

  test("heating scales with v³ and √ρ", () => {
    const q1 = heatRate(1e-4, 5000);
    expect(heatRate(1e-4, 10000) / q1).toBeCloseTo(8, 6);
    expect(heatRate(4e-4, 5000) / q1).toBeCloseTo(2, 6);
  });

  test("G-load equals the simulated aerodynamic deceleration", () => {
    const s = createEntryState({ fpaDeg: -6.5 });
    advance(s, 60);
    expect(s.gLoad).toBeCloseTo(s.decel / G0, 10);
    // and the velocity actually drops at roughly that rate
    const v0 = s.v;
    step(s);
    expect((v0 - s.v) / SIM_DT).toBeGreaterThan(s.decel * 0.8);
  });

  test("identical inputs give identical trajectories (deterministic)", () => {
    const a = fly(-6.5, altRateGuidance).s;
    const b = fly(-6.5, altRateGuidance).s;
    expect(a.outcome).toBe(b.outcome);
    expect(a.t).toBe(b.t);
    expect(a.peak.g).toBe(b.peak.g);
    expect(a.heatLoad).toBe(b.heatLoad);
  });

  test("result is converged with respect to the integration step", () => {
    const a = fly(-6.5, altRateGuidance, { dt: SIM_DT }).s;
    const b = fly(-6.5, altRateGuidance, { dt: SIM_DT / 2 }).s;
    expect(a.outcome).toBe(b.outcome);
    expect(Math.abs(a.peak.g - b.peak.g) / b.peak.g).toBeLessThan(0.01);
    expect(Math.abs(a.peak.heatRate - b.peak.heatRate) / b.peak.heatRate).toBeLessThan(0.01);
  });
});

describe("TEST A — nominal entry (-6.5°)", () => {
  const { s } = fly(-6.5, altRateGuidance);

  test("survives the heat pulse and splashes down under main chutes", () => {
    expect(s.outcome).toBe(OUTCOME.SPLASHDOWN);
    expect(s.splashV).toBeLessThan(12);
  });

  test("loads build, peak and fall away inside vehicle limits", () => {
    expect(s.peak.g).toBeGreaterThan(4);
    expect(s.peak.g).toBeLessThan(LIMITS.structuralG);
    expect(s.peak.heatRate).toBeGreaterThan(100);
    expect(s.overheat).toBeLessThan(LIMITS.overheatBudget);
    expect(s.heatLoad).toBeLessThan(LIMITS.heatLoadCapacity);
    // peak heating happens high and fast, in the 45-75 km band
    expect(s.peak.heatRateAlt).toBeGreaterThan(45e3);
    expect(s.peak.heatRateAlt).toBeLessThan(75e3);
    expect(s.peak.heatRateV).toBeGreaterThan(9000);
    // heating peaks before maximum deceleration, as in real entries
    expect(s.peak.heatRateT).toBeLessThanOrEqual(s.peak.gT);
  });

  test("parachutes deploy only inside their altitude/speed envelopes", () => {
    expect(s.drogue.alt).toBeLessThanOrEqual(CHUTES.drogue.maxAlt);
    expect(s.drogue.v).toBeLessThanOrEqual(CHUTES.drogue.maxSpeed);
    expect(s.main.alt).toBeLessThanOrEqual(CHUTES.main.maxAlt);
    expect(s.main.v).toBeLessThanOrEqual(CHUTES.main.maxSpeed);
    expect(s.mainT).toBeGreaterThan(s.drogueT);
  });
});

describe("TEST B — too shallow", () => {
  test("-4.8° flown lift-up climbs back out of the atmosphere (skip-out)", () => {
    const { s, trace } = fly(-4.8, liftUp);
    expect(s.outcome).toBe(OUTCOME.SKIP_OUT);
    expect(trace.climbed).toBe(true);
    expect(s.gamma).toBeGreaterThan(0);
    expect(s.h).toBeGreaterThan(EI_ALT);
    // it never got deep enough to shed much energy
    expect(s.v).toBeGreaterThan(9000);
    expect(s.peak.g).toBeLessThan(3);
  });

  test("the skip happens even with the best available lift modulation", () => {
    const s = flyWithPredictor(CORRIDOR.shallowEdge + 0.3);
    expect(s.outcome).toBe(OUTCOME.SKIP_OUT);
  });
});

describe("TEST C — too steep", () => {
  test("-8.0° lift-up: heat rate overwhelms the shield (thermal failure)", () => {
    const { s } = fly(-8.0, liftUp);
    expect(s.outcome).toBe(OUTCOME.THERMAL);
    expect(s.overheat).toBeGreaterThan(LIMITS.overheatBudget);
    expect(s.peak.heatRate).toBeGreaterThan(LIMITS.heatRateDesign);
    expect(s.peak.g).toBeGreaterThan(8);
  });

  test("-10.5° lift-up: deceleration exceeds the structural limit", () => {
    const { s } = fly(-10.5, liftUp);
    expect(s.outcome).toBe(OUTCOME.STRUCTURAL);
    expect(s.gLoad).toBeGreaterThan(LIMITS.structuralG);
  });

  test("a steep entry decelerates harder and faster than a nominal one", () => {
    const nom = fly(-6.5, liftUp).s;
    const steep = fly(-7.6, liftUp).s;
    expect(steep.peak.g).toBeGreaterThan(nom.peak.g);
    expect(steep.peak.gT).toBeLessThan(nom.peak.gT);
    expect(steep.peak.heatRate).toBeGreaterThan(nom.peak.heatRate);
  });
});

describe("boundaries and recovery — no angle-based rules", () => {
  test("the same entry angle has different outcomes depending on the lift vector", () => {
    expect(fly(-6.5, liftUp).s.outcome).toBe(OUTCOME.SKIP_OUT);
    expect(fly(-6.5, liftDown).s.outcome).toBe(OUTCOME.STRUCTURAL);
    expect(fly(-6.5, altRateGuidance).s.outcome).toBe(OUTCOME.SPLASHDOWN);
  });

  test("a marginal shallow entry is recoverable by rolling the lift vector", () => {
    expect(fly(-5.6, liftUp).s.outcome).toBe(OUTCOME.SKIP_OUT);
    expect(flyWithPredictor(-5.6).outcome).toBe(OUTCOME.SPLASHDOWN);
  });

  test("a marginal steep entry survives only if lift is kept up", () => {
    expect(fly(-7.0, liftDown).s.outcome).not.toBe(OUTCOME.SPLASHDOWN);
    expect(flyWithPredictor(-7.0).outcome).toBe(OUTCOME.SPLASHDOWN);
  });

  test("the guidance corridor constants match what the physics produces", () => {
    expect(flyWithPredictor(CORRIDOR.shallowEdge + 0.3).outcome).toBe(OUTCOME.SKIP_OUT);
    expect(flyWithPredictor(CORRIDOR.shallowEdge - 0.1).outcome).toBe(OUTCOME.SPLASHDOWN);
    expect(flyWithPredictor(CORRIDOR.steepEdge).outcome).toBe(OUTCOME.SPLASHDOWN);
    expect([OUTCOME.THERMAL, OUTCOME.STRUCTURAL]).toContain(
      flyWithPredictor(CORRIDOR.steepEdge - 0.2).outcome
    );
  });

  test("roll is rate-limited — the lift vector cannot flip instantly", () => {
    const s = createEntryState({ fpaDeg: -6.5, bankDeg: 0 });
    s.rollInput = 1;
    advance(s, 1);
    expect(s.bank).toBeCloseTo(20, 5);
    expect(rollToward(170, -170)).toBe(1);
    expect(rollToward(10, 0)).toBe(-1);
  });

  test("predictor agrees with the full simulation it looks ahead on", () => {
    const s = createEntryState({ fpaDeg: -4.8 });
    expect(predict(s, 0).outcome).toBe(OUTCOME.SKIP_OUT);
    const steep = createEntryState({ fpaDeg: -8.0 });
    expect(predict(steep, 0).outcome).toBe(OUTCOME.THERMAL);
  });
});
