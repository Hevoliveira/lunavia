import { MASS, ROLL_RATE, UNDOCK, gapAt, relSpeed, rollAt, undocking } from "./undocking";

const DEG = Math.PI / 180;
const steps = (t0, t1, dt = 0.02) => {
  const out = [];
  for (let t = t0; t <= t1 + 1e-9; t += dt) out.push(t);
  return out;
};

describe("lunar module undocking: gentle, controlled, physically consistent", () => {
  test("docked until the latches release: nothing moves", () => {
    const s = undocking(-3);
    expect(s.gap).toBe(0);
    expect(s.csmY).toBeCloseTo(0, 12);
    expect(s.lmY).toBeCloseTo(0, 12);
    expect(s.lmRoll).toBe(0);
    expect(s.csmRcs).toBe(0);
    expect(s.phase).toBe("docked");
  });

  test("no jolt: the gap opens from zero with zero speed, speed and gap continuous", () => {
    expect(relSpeed(UNDOCK.latch)).toBe(0);
    let prevGap = gapAt(-1);
    let prevV = relSpeed(-1);
    steps(-1, 60).forEach((t) => {
      const g = gapAt(t);
      const v = relSpeed(t);
      expect(g).toBeGreaterThanOrEqual(prevGap - 1e-12);
      expect(Math.abs(v - prevV)).toBeLessThan(0.02); // no step in speed between frames
      expect(Math.abs(g - prevGap)).toBeLessThan(0.03);
      prevGap = g;
      prevV = v;
    });
  });

  test("the gap is the integral of the speed (what is drawn is what is flown)", () => {
    let x = 0;
    const dt = 0.001;
    for (let t = 0; t < 40; t += dt) x += relSpeed(t + dt / 2) * dt;
    expect(x).toBeCloseTo(gapAt(40), 2);
  });

  test("RCS speeds only: under 1.2 m/s apart, accelerations under 0.5 m/s²", () => {
    steps(0, 60, 0.01).forEach((t) => {
      expect(relSpeed(t)).toBeLessThanOrEqual(UNDOCK.sepV + UNDOCK.burnV + 1e-9);
      expect(Math.abs(relSpeed(t + 0.01) - relSpeed(t)) / 0.01).toBeLessThan(0.5);
    });
    expect(UNDOCK.sepV + UNDOCK.burnV).toBeLessThan(1.2);
  });

  test("both spacecraft move, about their common centre of mass", () => {
    steps(0, 60, 0.5).forEach((t) => {
      const s = undocking(t);
      expect(MASS.csm * s.csmY + MASS.lm * s.lmY).toBeCloseTo(0, 9);
      expect(s.lmY - s.csmY).toBeCloseTo(s.gap, 9);
      expect(s.lmY).toBeGreaterThanOrEqual(0);
    });
  });

  test("the thrusters fire while the speed changes, and only then", () => {
    steps(0, 40, 0.05).forEach((t) => {
      const accel = (relSpeed(t + 0.025) - relSpeed(t - 0.025)) / 0.05;
      const s = undocking(t);
      if (accel > 0.02) expect(s.csmRcs).toBeGreaterThan(0);
      if (s.csmRcs === 0) expect(accel).toBeLessThan(0.02);
    });
  });

  test("the lunar module's roll is slow (inspection of the gear): at most ROLL_RATE, started and stopped on RCS", () => {
    expect(ROLL_RATE / DEG).toBeLessThan(15);
    steps(0, 30, 0.01).forEach((t) => expect(Math.abs(rollAt(t + 0.01) - rollAt(t)) / 0.01).toBeLessThanOrEqual(ROLL_RATE * 1.01));
    expect(rollAt(UNDOCK.rollEnd + 1)).toBeCloseTo(UNDOCK.roll, 9);
    expect(undocking(UNDOCK.rollStart + 0.3).lmRollRcs).toBeGreaterThan(0);
    expect(undocking(UNDOCK.rollEnd - 0.3).lmRollRcs).toBeLessThan(0);
    expect(undocking((UNDOCK.rollStart + UNDOCK.rollEnd) / 2).lmRollRcs).toBe(0);
  });

  test("a clear separation within the scene: over 8 m apart 18 s after release, still opening", () => {
    expect(gapAt(18)).toBeGreaterThan(8);
    expect(relSpeed(30)).toBeGreaterThan(0.8);
  });
});
