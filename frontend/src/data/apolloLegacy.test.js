import { LEGACY_IDS, LEGACY_SCENARIOS, PRECISION_BANDS, applyLegacyResult, emptyLegacyRecords, landingPrecision, legacyResult, legacyScenario, legacyText, readLegacyRecords } from "./apolloLegacy";
import { REACH, actionAt, currentTarget, freshEvaFor, objectiveIds, planEva, validateEvaRecordFor } from "./evaMissions";
import { evaWorld } from "./evaSim";
import { FOOT_RADIUS, LEGACY_SITE_IDS, SITE_IDS, getSite, siteStart } from "./landingSites";
import { DIFFICULTY } from "./landingPhysics";
import { buildTerrain, sunVisAt } from "./terrainMesh";
import { OFFICIAL_MISSION_IDS } from "./missionConfig";
import { SURVEYOR, surveyorPlaces } from "./surveyor";

const worlds = new Map();
function worldAt(sc, xm) {
  const key = `${sc.id}@${xm}`;
  if (worlds.has(key)) return worlds.get(key);
  const site = getSite(sc.siteId);
  const terrain = buildTerrain(site);
  const ground = (x, z) => terrain.lookup(x, z);
  const pose = { x: xm * 0.5, padY: site.scale.y(site.contactGround(xm)), tilt: 0, pitch: 0, comp: [0, 0, 0, 0], probe: [0, 0, 0, 0] };
  const world = evaWorld({ site, pose, ground, area: sc.eva.area });
  const out = { site, world, plan: planEva(world, sc.eva) };
  worlds.set(key, out);
  return out;
}
const safeNear = (siteId, around, span, step) => {
  const site = getSite(siteId);
  const xs = [];
  for (let x = around - span; x <= around + span; x += step) if (!site.evaluate(x).hazard) xs.push(x);
  return xs;
};
const targetsOf = (plan) => [plan.survey, ...plan.samples, plan.photo, plan.instrument, plan.retrieve].filter(Boolean);

describe("Apollo Legacy: three historical scenarios, separate from the campaign", () => {
  test("Apollo 11, 12 and 15, each on its own historical site", () => {
    expect(LEGACY_IDS).toEqual(["apollo11", "apollo12", "apollo15"]);
    expect(legacyScenario("apollo11").siteId).toBe("tranquillitatis");
    expect(legacyScenario("apollo12").siteId).toBe("oceanus");
    expect(legacyScenario("apollo15").siteId).toBe("hadley");
    expect(legacyScenario("apollo11").lm).toBe("EAGLE");
    expect(legacyScenario("apollo12").lm).toBe("INTREPID");
    expect(legacyScenario("apollo15").lm).toBe("FALCON");
  });
  test("the Ocean of Storms is its own scene, never an official destination or a renamed Tranquility", () => {
    expect(LEGACY_SITE_IDS).toEqual(["oceanus"]);
    expect(SITE_IDS).not.toContain("oceanus");
    expect(OFFICIAL_MISSION_IDS).not.toContain("oceanus");
    expect(OFFICIAL_MISSION_IDS.length).toBe(4);
    const oc = getSite("oceanus");
    const tq = getSite("tranquillitatis");
    expect(oc.id).toBe("oceanus");
    expect(oc.name).toBe("OCEAN OF STORMS");
    expect(oc.seed).not.toBe(tq.seed);
    expect(oc.height(150, -18)).not.toBeCloseTo(tq.height(150, -18), 1);
    // Surveyor 3 on the slope of Surveyor crater, ~150 m from the target (NASA: 160–180 m)
    const s3 = oc.objects.find((o) => o.id === "surveyor3");
    expect(Math.hypot(s3.x, s3.z)).toBeGreaterThan(140);
    expect(Math.hypot(s3.x, s3.z)).toBeLessThan(185);
    expect(Math.abs(s3.z)).toBeGreaterThan(FOOT_RADIUS + SURVEYOR.padR + 4); // never in the LM's footprint on the track
  });
  test("three genuinely different expeditions (never the same objectives relabelled)", () => {
    const seqs = LEGACY_SCENARIOS.map((s) => JSON.stringify(s.eva.objectives.map((o) => o.kind)));
    expect(new Set(seqs).size).toBe(3);
    expect(legacyScenario("apollo12").eva.objectives.some((o) => o.kind === "retrieve")).toBe(true);
    expect(legacyScenario("apollo15").eva.samples.length).toBe(2);
    expect(legacyScenario("apollo15").eva.area.limit).toBeGreaterThan(2 * legacyScenario("apollo11").eva.area.limit);
    expect(legacyScenario("apollo11").eva.instrument.kind).toBe("lrrr"); // Apollo 11's own equipment
  });
  test("every text in both languages; history, crew and sources present; radio dramatized", () => {
    for (const s of LEGACY_SCENARIOS) {
      for (const k of ["title", "subtitle", "date", "destination", "challenge", "summary", "gameplay"]) {
        expect(s[k].en.length).toBeGreaterThan(3);
        expect(s[k].pt.length).toBeGreaterThan(3);
      }
      expect(s.history.en.length).toBeGreaterThan(0);
      expect(s.history.pt.length).toBe(s.history.en.length);
      expect(s.crew.length).toBe(3);
      expect(s.sources.length).toBeGreaterThan(1);
      for (const lang of ["en", "pt"]) {
        const t = s.eva.text[lang];
        s.eva.objectives.forEach((o) => expect(t.objectives[o.id].length).toBeGreaterThan(3));
      }
    }
    expect(legacyText("en").dramatized).toMatch(/DRAMATIZED/);
    expect(legacyText("pt").dramatized).toMatch(/DRAMATIZADAS/);
  });
});

describe("the descents start at the historical point, on the approved physics", () => {
  test("every scenario at every difficulty: a valid state above the ground", () => {
    for (const s of LEGACY_SCENARIOS) {
      const site = getSite(s.siteId);
      for (const key of Object.keys(DIFFICULTY)) {
        const init = s.descent.init(key, site);
        const st = siteStart(site, DIFFICULTY[key], init);
        expect(st.alt).toBeGreaterThan(100);
        expect(st.fuel).toBeGreaterThan(40);
        expect(st.fuel).toBeLessThanOrEqual(DIFFICULTY[key].initialFuel);
      }
    }
  });
  test("Apollo 11 starts short of the boulder field; Apollo 12 west of its target, Surveyor crater beyond", () => {
    const tq = getSite("tranquillitatis");
    const a11 = legacyScenario("apollo11").descent.init("ASTRONAUT", tq);
    expect(a11.xPos * tq.approach.dir).toBeLessThan(-60);
    const oc = getSite("oceanus");
    const a12 = legacyScenario("apollo12").descent.init("ASTRONAUT", oc);
    expect(a12.xPos).toBeLessThan(-100);
  });
});

describe("the expeditions work where the LM actually lands", () => {
  const cases = [
    ["apollo11", safeNear("tranquillitatis", 0, 40, 8)],
    ["apollo15", safeNear("hadley", 0, 12, 4)],
    ["apollo12", safeNear("oceanus", 0, 60, 12)],
  ];
  test.each(cases)("%s: every target placed (none forced), reachable from the ladder", (id, xs) => {
    const sc = legacyScenario(id);
    expect(xs.length).toBeGreaterThan(1);
    for (const x of xs) {
      const { plan, world } = worldAt(sc, x);
      expect([x, plan.fallbacks]).toEqual([x, []]); // every target at its intended place
      for (const t of targetsOf(plan)) {
        expect(t.forced).toBeFalsy();
        const r = t.route;
        if (r) expect(r.length).toBeLessThanOrEqual(sc.eva.maxRoute || 70);
      }
      // all within the exploration area
      for (const t of targetsOf(plan)) expect(Math.hypot(t.x - world.lm.axis[0], t.z - world.lm.axis[1])).toBeLessThan(sc.eva.area.limit);
    }
  });
  test("Apollo 12: the inspection, photo and retrieval are at Surveyor 3, the camera within arm's reach", () => {
    const sc = legacyScenario("apollo12");
    const { plan, world, site } = worldAt(sc, 0);
    const s3 = site.objects.find((o) => o.id === "surveyor3");
    const pl = surveyorPlaces({ ...s3, y: world.ground(s3.x, s3.z) });
    expect(Math.hypot(plan.survey.x - s3.x, plan.survey.z - s3.z)).toBeLessThan(4);
    expect(plan.photo.subject.id).toBe("SURVEYOR-3");
    expect(Math.hypot(plan.photo.x - s3.x, plan.photo.z - s3.z)).toBeLessThan(11);
    expect(Math.hypot(plan.retrieve.x - pl.camera[0], plan.retrieve.z - pl.camera[2])).toBeLessThan(1.4);
    // standing there, RETRIEVE is offered; walking up to the probe from far away it is not
    const st = { progress: { firstSteps: true, survey: true, photo: true, retrieve: false }, samples: [], instruments: [] };
    expect(actionAt(plan, world, { x: plan.retrieve.x, z: plan.retrieve.z }, st)).toEqual({ kind: "retrieve" });
    expect(actionAt(plan, world, { x: s3.x - 20, z: s3.z }, st)).toBeNull();
    expect(currentTarget(plan, st).kind).toBe("retrieve");
    expect(REACH.retrieve).toBeLessThan(2);
  });
  test("Apollo 15: the station on the rim of Hadley Rille, the samples from two different places", () => {
    const sc = legacyScenario("apollo15");
    const { plan } = worldAt(sc, 0);
    expect(plan.survey.formation).toBe("rille");
    expect(plan.survey.x).toBeGreaterThan(18);
    expect(Math.hypot(plan.survey.x, plan.survey.z)).toBeGreaterThan(20);
    const [a, b] = plan.samples;
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(40); // the rille edge and the talus
    expect(a.x).toBeGreaterThan(20);
    expect(b.x).toBeLessThan(-30); // the foot of the Apennine front
    // both stones in sunlight (not in the black shadow at the foot of the talus)
    const t = buildTerrain(getSite("hadley"));
    for (const st of plan.samples) expect(sunVisAt(t, st.x, st.z)).toBeGreaterThanOrEqual(0.6);
    expect(plan.fallbacks).toEqual([]);
  });
});

describe("records: the EVA record and the results stay Apollo Legacy's own", () => {
  test("a fresh record validates; the retrieval is consistent with its objective", () => {
    const cfg = legacyScenario("apollo12").eva;
    const e = freshEvaFor(cfg);
    expect(e.retrieved).toEqual([]);
    expect(validateEvaRecordFor(cfg, e)).not.toBeNull();
    const done = { ...e, progress: { firstSteps: true, survey: true, photo: true, retrieve: true }, photos: [{ subject: "SURVEYOR-3", distance: 9 }], retrieved: [{ id: "TV-CAMERA" }], completed: true };
    expect(validateEvaRecordFor(cfg, done)).not.toBeNull();
    expect(validateEvaRecordFor(cfg, { ...done, retrieved: [] })).toBeNull();
    expect(validateEvaRecordFor(cfg, { ...done, retrieved: [{ id: "TV-CAMERA" }, { id: "TV-CAMERA" }] })).toBeNull();
    expect(objectiveIds(cfg)).toEqual(["firstSteps", "survey", "photo", "retrieve", "return"]);
  });
  test("precision bands and Surveyor distance", () => {
    const sc = legacyScenario("apollo12");
    const site = getSite("oceanus");
    expect(landingPrecision(sc, { x: 4 }, site).band).toBe("PINPOINT");
    expect(landingPrecision(sc, { x: -45 }, site).band).toBe("ACCEPTABLE");
    expect(landingPrecision(sc, { x: 120 }, site).band).toBe("WIDE");
    expect(landingPrecision(sc, { x: 0 }, site).dObject).toBeGreaterThan(140);
    expect(landingPrecision(legacyScenario("apollo11"), { x: 0 }, getSite("tranquillitatis"))).toBeNull();
    expect(PRECISION_BANDS[PRECISION_BANDS.length - 1].max).toBe(Infinity);
  });
  test("a completion counts once per attempt; nothing touches the campaign", () => {
    const sc = legacyScenario("apollo12");
    const eva = { progress: { firstSteps: true, survey: true, photo: true, retrieve: true }, samples: [], photos: [{}], retrieved: [{ id: "TV-CAMERA" }], completed: true };
    const r = legacyResult(sc, { landing: { safe: true, precision: { dTarget: 12, band: "PRECISE" } }, eva });
    expect(r.completed).toBe(true);
    let rec = applyLegacyResult(emptyLegacyRecords(), "L-1", "ASTRONAUT", r, 1);
    rec = applyLegacyResult(rec, "L-1", "ASTRONAUT", r, 2);
    expect(rec.scenarios.apollo12.completions).toBe(1);
    expect(rec.scenarios.apollo12.best.dTarget).toBe(12);
    const unfinished = legacyResult(sc, { landing: { safe: true }, eva: { ...eva, completed: false } });
    expect(unfinished.completed).toBe(false);
    expect(readLegacyRecords("{bad")).toEqual(emptyLegacyRecords());
    expect(Object.keys(rec)).toEqual(["v", "scenarios"]); // no score, medal or achievement fields
  });
});
