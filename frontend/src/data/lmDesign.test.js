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

describe("the two stages apart (lunar liftoff)", () => {
  const { buildBody: body, buildStages, ASC_ENGINE: E, PARTS: parts } = require("./lmDesign");
  const count = (g) => (g ? g.attributes.position.count : 0);
  test("the joined vehicle is exactly the two stages (the ascent engine aside)", () => {
    const B = body();
    const { descent, ascent } = buildStages();
    parts.forEach((k) => {
      const sum = count(descent[k]) + count(ascent[k]);
      if (k === "engine" || k === "engineInner") expect(sum).toBeGreaterThan(count(B[k])); // + the ascent engine
      else expect(sum).toBe(count(B[k]));
    });
  });
  test("the descent stage keeps the foil body, the descent engine and the interstage; the ascent stage the cabin, pods, tunnel and RCS", () => {
    const { descent, ascent } = buildStages();
    expect(descent.foilGold).toBeTruthy();
    expect(ascent.foilGold).toBeFalsy();
    expect(ascent.glass).toBeTruthy(); // windows
    expect(descent.glass).toBeFalsy();
    expect(ascent.accent).toBeTruthy(); // the pods' orange bands
    descent.foilGold.computeBoundingBox();
    expect(descent.foilGold.boundingBox.max.y).toBeLessThan(E.top);
    ascent.paint.computeBoundingBox();
    expect(ascent.paint.boundingBox.min.y).toBeGreaterThanOrEqual(E.top - 0.01);
    // the ascent engine sits under the cabin, inside the interstage while joined
    ascent.engine.computeBoundingBox();
    expect(ascent.engine.boundingBox.min.y).toBeCloseTo(E.exitY, 2);
    // hidden while joined: inside the interstage and the descent stage's top (as the real engine sits in its recess)
    expect(E.exitR).toBeLessThan(0.31);
    expect(E.exitY).toBeGreaterThan(0.2);
  });
});

describe("close range (the lunar EVA): the same vehicle, more of it", () => {
  const { buildCloseDetail, ladderParts, legFrames: legs } = require("./lmDesign");
  const close = buildBody({ close: true });
  const all = new THREE.Box3();
  PARTS.forEach((k) => all.union(bounds(close[k])));
  const detail = buildCloseDetail();
  const hw = new THREE.Box3();
  Object.values(detail).forEach((g) => hw.union(bounds(g)));

  test("the contact contract holds: the nozzle exit lowest, nothing above the antenna limit, inside the footpad circle", () => {
    expect(bounds(close.engine).min.y).toBeGreaterThan(EXIT_Y - 0.01);
    expect(all.min.y).toBeGreaterThan(EXIT_Y - 0.01);
    expect(all.max.y).toBeLessThanOrEqual(TOP + 1e-6);
    expect(Math.max(-all.min.x, all.max.x, -all.min.z, all.max.z)).toBeLessThan(PAD_R - PAD_SIZE);
    // the hardware (ladder, strut bands …) goes down the legs: above the footpad plane, inside the legs' reach
    expect(hw.min.y).toBeGreaterThan(GROUND);
    expect(hw.max.y).toBeLessThanOrEqual(TOP + 1e-6);
    expect(Math.max(-hw.min.x, hw.max.x, -hw.min.z, hw.max.z)).toBeLessThan(PAD_R);
  });

  test("the puffed foil stays within a few centimetres of the flat body; every part keeps normals and UVs", () => {
    const flat = bounds(buildBody().foilGold);
    const puffed = bounds(close.foilGold);
    expect(puffed.max.x - flat.max.x).toBeLessThan(0.012); // < 6 cm
    expect(puffed.max.x - flat.max.x).toBeGreaterThan(-1e-6);
    [...PARTS.map((k) => close[k]), ...Object.values(detail)].forEach((g) => {
      expect(g.attributes.normal.count).toBe(g.attributes.position.count);
      expect(g.attributes.uv.count).toBe(g.attributes.position.count);
    });
  });

  test("the ladder's treads sit on the very rungs the EVA climbs (data/evaSim), the rails where the gloves slide", () => {
    const L = legs().find((l) => l.ladder);
    const top = L.upper.clone().addScaledVector(L.axis, -0.05).addScaledVector(L.dir, 0.035);
    const bottom = L.padTop.clone().addScaledVector(L.axis, 0.14).addScaledVector(L.dir, 0.035);
    const { rungs, rails } = ladderParts();
    expect(rungs).toHaveLength(7);
    rungs.forEach(([a, b], i) => {
      const mid = a.clone().lerp(b, 0.5);
      expect(mid.distanceTo(top.clone().lerp(bottom, (i + 1) / 8))).toBeLessThan(1e-9);
      expect(a.distanceTo(b)).toBeCloseTo(0.09, 9);
    });
    rails.forEach(([a]) => expect(Math.abs(a.distanceTo(top) - 0.045)).toBeLessThan(1e-9));
  });

  test("an iPhone budget: body, hardware and four ribbed footpads under 22k triangles", () => {
    let n = 0;
    PARTS.forEach((k) => (n += tris(close[k])));
    Object.values(detail).forEach((g) => (n += tris(g)));
    n += 4 * tris(buildPad({ close: true }));
    expect(n).toBeLessThan(22000);
    // the footpad keeps its contact: bottom at its origin, the physics' radius (the rolled lip inside it)
    const b = bounds(buildPad({ close: true }));
    expect(b.min.y).toBeCloseTo(0, 6);
    expect(Math.max(b.max.x, b.max.z)).toBeLessThanOrEqual(PAD_SIZE + 0.002);
  });
});
