import { ASCENT, G_MOON, ascentAt, pitchAt } from "./lunarAscent";

describe("lunar liftoff", () => {
  test("the ascent stage climbs off the descent stage: thrust beats lunar gravity from ignition", () => {
    const a0 = ascentAt(0.5);
    expect(a0.vy).toBeGreaterThan(0);
    expect(ASCENT.thrust / ASCENT.mass0).toBeGreaterThan(G_MOON * 1.8); // T/W ≈ 2 in lunar gravity
  });
  test("vertical rise for ten seconds, then a pitchover towards the direction of flight", () => {
    const v = ascentAt(ASCENT.vertical);
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.alt).toBeGreaterThan(70);
    expect(v.alt).toBeLessThan(110);
    expect(pitchAt(5)).toBe(0);
    expect(pitchAt(ASCENT.pitchEnd) * (180 / Math.PI)).toBeCloseTo(ASCENT.pitch, 6);
    const end = ascentAt(ASCENT.film);
    expect(end.x).toBeGreaterThan(50); // moving downrange
    expect(end.alt).toBeGreaterThan(v.alt); // still climbing
    expect(end.vy).toBeGreaterThan(0);
  });
  test("lighter as it burns: acceleration grows", () => {
    expect(ascentAt(20).accel).toBeGreaterThan(ascentAt(1).accel);
    expect(ascentAt(20).mass).toBeLessThan(ASCENT.mass0);
  });
});
