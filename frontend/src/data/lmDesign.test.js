import * as THREE from "three";
import { EXIT_R, EXIT_Y, GROUND, PAD_H, PAD_R, PAD_SIZE, PARTS, PROBE_L, TOP, buildBody, buildPad, legFrames } from "./lmDesign";
import { LM, PROBE_LENGTH } from "./touchdownFx";

const S = LM.scale;
const tris = (g) => g.attributes.position.count / 3;
const bounds = (g) => {
  g.computeBoundingBox();
  return g.boundingBox;
};

describe("the lunar module keeps its contact contract with the physics", () => {
  const body = buildBody();
  const all = new THREE.Box3();
  PARTS.forEach((k) => all.union(bounds(body[k])));

  test("model units: footpads, nozzle exit and height are the ones touchdownFx draws and the physics flies", () => {
    expect(GROUND * S).toBeCloseTo(-LM.foot, 9);
    expect(PAD_R * S).toBeCloseTo(LM.padRadius, 9);
    expect(PAD_SIZE * S).toBeCloseTo(LM.padSize, 9);
    expect((EXIT_Y - GROUND) * S).toBeCloseTo(LM.nozzle, 9);
    expect((TOP - GROUND) * S).toBeCloseTo(LM.height, 9);
    expect(PROBE_L * S).toBeCloseTo(PROBE_LENGTH, 9);
  });

  test("the nozzle exit is the lowest point of the body, at the exit plane; nothing rises above the antenna limit", () => {
    const eng = bounds(body.engine);
    expect(eng.min.y).toBeGreaterThan(EXIT_Y - 0.01);
    expect(eng.min.y).toBeLessThan(EXIT_Y + 0.001);
    expect(all.min.y).toBeGreaterThan(EXIT_Y - 0.01);
    expect(all.max.y).toBeLessThanOrEqual(TOP + 1e-6);
    expect(all.max.y).toBeGreaterThan(TOP - 0.03); // the tallest antenna reaches the drawn height
    // the bell's exit rim has the exit radius
    const xz = Math.max(Math.abs(eng.min.x), Math.abs(eng.max.x));
    expect(xz).toBeGreaterThan(EXIT_R);
  });

  test("the body stays inside the footpad circle, and the ascent stage is wide enough to read as one", () => {
    expect(Math.max(-all.min.x, all.max.x, -all.min.z, all.max.z)).toBeLessThan(PAD_R - PAD_SIZE);
    const cabin = bounds(body.paint);
    expect(cabin.max.x - cabin.min.x).toBeGreaterThan(0.85); // pods included: ~4.4 m across
    expect(cabin.min.y).toBeGreaterThan(0.34); // sits on the descent stage
  });

  test("every material part has geometry; the whole vehicle stays inside an iPhone budget", () => {
    let n = 0;
    PARTS.forEach((k) => {
      expect(tris(body[k])).toBeGreaterThan(0);
      expect(body[k].attributes.normal.count).toBe(body[k].attributes.position.count);
      expect(body[k].attributes.uv.count).toBe(body[k].attributes.position.count);
      n += tris(body[k]);
    });
    n += 4 * tris(buildPad());
    expect(n).toBeLessThan(12000);
  });

  test("footpads: the dish's bottom is at its origin, its radius is the physics' pad radius", () => {
    const b = bounds(buildPad());
    expect(b.min.y).toBeCloseTo(0, 6);
    expect(Math.max(b.max.x, b.max.z)).toBeCloseTo(PAD_SIZE, 6); // a lathe has a vertex on +Z
    expect(b.max.y).toBeLessThan(PAD_H + 0.04);
  });

  test("legs: four, on the physics' axes; the pad tops sit at the footpad radius; probes and ladder as on the LM", () => {
    const legs = legFrames();
    expect(legs).toHaveLength(4);
    legs.forEach((L, i) => {
      const a = (LM.legAngles[i] * Math.PI) / 180;
      expect(L.padTop.x).toBeCloseTo(PAD_R * Math.cos(a), 9);
      expect(L.padTop.z).toBeCloseTo(PAD_R * Math.sin(a), 9);
      expect(L.padTop.y).toBeCloseTo(GROUND + PAD_H, 9);
      expect(L.axis.y).toBeGreaterThan(0.5); // a strut, not a beam: compression lifts the pad
      expect(L.probe).toBe(LM.probes[i]);
      expect(L.upper.y).toBeLessThan(0.34); // hangs from the descent stage
    });
    expect(legs.filter((L) => L.ladder).map((L) => LM.legAngles[legs.indexOf(L)])).toEqual([90]); // front leg, under the hatch
  });
});
