import {
  SHOTS, EVENTS, DURATION, LIFTOFF_T, MILESTONES, metAt, formatMet, trajectoryAt, padHeight,
  stage1Thrust, upperThrust, sepProgress, eventTime, shotAt, airDensity,
} from "./launchTimeline";

describe("launch timeline", () => {
  test("shots tile the whole sequence without gaps or overlaps", () => {
    expect(SHOTS[0].start).toBe(0);
    for (let i = 1; i < SHOTS.length; i++) expect(SHOTS[i].start).toBe(SHOTS[i - 1].end);
    expect(SHOTS[SHOTS.length - 1].end).toBe(DURATION);
    SHOTS.forEach((s) => expect(s.end - s.start).toBeGreaterThanOrEqual(3));
  });

  test("events are ordered, inside the sequence, and never gate on input", () => {
    for (let i = 1; i < EVENTS.length; i++) expect(EVENTS[i].t).toBeGreaterThan(EVENTS[i - 1].t);
    EVENTS.forEach((e) => {
      expect(e.t).toBeGreaterThanOrEqual(0);
      expect(e.t).toBeLessThan(DURATION);
      expect(e).not.toHaveProperty("requiresInput");
    });
    const order = MILESTONES.map(eventTime);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
  });

  test("ignition precedes liftoff by a visible delay; the vehicle does not move before release", () => {
    expect(LIFTOFF_T - eventTime("engineStart")).toBeGreaterThanOrEqual(5);
    expect(padHeight(LIFTOFF_T - 0.01)).toBe(0);
    expect(padHeight(LIFTOFF_T + 1)).toBeLessThan(0.1); // ~2 m in the first second: heavy, slow
    expect(padHeight(eventTime("towerClear"))).toBeGreaterThan(4.6); // base above the 4.7-unit tower top
    expect(padHeight(eventTime("towerClear") - 1.5)).toBeLessThan(4.7);
  });

  test("mission clock: countdown in real time, then monotonic", () => {
    expect(metAt(0)).toBe(-15);
    expect(metAt(LIFTOFF_T)).toBe(0);
    let prev = -Infinity;
    for (let t = 0; t <= DURATION; t += 0.1) {
      const m = metAt(t);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
    expect(formatMet(metAt(eventTime("orbit")))).toBe("T+00:11:30");
    expect(formatMet(metAt(eventTime("tli")))).toBe("T+02:44:00");
    expect(formatMet(-10)).toBe("T-00:00:10");
  });

  test("ascent, orbit insertion and TLI stay distinct", () => {
    const meco = trajectoryAt(eventTime("meco"));
    const orbit = trajectoryAt(eventTime("orbit") + 2);
    const tliEnd = trajectoryAt(DURATION);
    expect(meco.altKm).toBeGreaterThan(55);
    expect(meco.speedKmps).toBeLessThan(3); // far from orbital speed at staging
    expect(orbit.altKm).toBeCloseTo(185, 0);
    expect(orbit.speedKmps).toBeCloseTo(7.8, 1); // circular LEO
    expect(tliEnd.speedKmps).toBeGreaterThan(10.4); // above LEO, escape-class after TLI
    // Altitude never decreases through the flight regime
    let prev = 0;
    for (let t = 32; t <= DURATION; t += 0.25) {
      const a = trajectoryAt(t).altKm;
      expect(a).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = a;
    }
  });

  test("engine schedule: MECO before separation, upper stage lights only after a clear gap", () => {
    expect(stage1Thrust(eventTime("engineStart") - 0.1)).toBe(0);
    expect(stage1Thrust(LIFTOFF_T - 1)).toBeCloseTo(1, 5); // full thrust before release
    expect(stage1Thrust(eventTime("meco") + 1)).toBe(0);
    expect(upperThrust(eventTime("separation"))).toBe(0);
    expect(sepProgress(eventTime("usIgnition"))).toBeGreaterThan(0.4);
    expect(upperThrust(eventTime("usIgnition") + 1)).toBe(1);
    expect(upperThrust(eventTime("orbit") + 2)).toBe(0); // coasting in parking orbit
    expect(upperThrust(eventTime("tli") + 1)).toBe(1);
    expect(upperThrust(DURATION)).toBe(0);
    let prev = 0;
    for (let t = 40; t <= DURATION; t += 0.1) {
      const s = sepProgress(t);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  test("shot lookup and atmosphere", () => {
    expect(shotAt(0).id).toBe("wide");
    expect(shotAt(eventTime("separation")).id).toBe("sepJoint");
    expect(shotAt(DURATION - 0.01).id).toBe("tli");
    expect(airDensity(0)).toBe(1);
    expect(airDensity(65)).toBeLessThan(0.001);
  });
});
