import {
  DEFAULT_SELECTION,
  MODE,
  OFFICIAL_MISSIONS,
  OFFICIAL_MISSION_IDS,
  PILOT_DIFFICULTIES,
  TRAINING_LANDING_SITE,
  TRAINING_LANDING_SITES,
  createMissionConfig,
  normalizeSelection,
  orbitViewFor,
  parseCoords,
} from "./missionConfig";
import { DIFFICULTY } from "./landingPhysics";
import { SITE_DEFS, SITE_IDS, getSite, siteStart } from "./landingSites";
import { fly, guidedStrategy } from "./landerPilots";

describe("four official lunar missions", () => {
  test("01–04: Tranquility, Hadley–Apennine, Tycho Highlands, Silent Horizon, introductory to expert", () => {
    expect(OFFICIAL_MISSIONS.map((m) => [m.number, m.siteId, m.environment])).toEqual([
      ["01", "tranquillitatis", "INTRODUCTORY"],
      ["02", "hadley", "INTERMEDIATE"],
      ["03", "tycho", "ADVANCED"],
      ["04", "far-side", "EXPERT"],
    ]);
    expect(getSite("tranquillitatis").name).toBe("SEA OF TRANQUILITY");
    expect(getSite("hadley").name).toBe("HADLEY–APENNINE");
    expect(getSite("tycho").name).toBe("TYCHO HIGHLANDS");
    expect(getSite("far-side").name).toBe("SILENT HORIZON");
    // every official mission is an existing site implementation (nothing duplicated), all four of them
    expect([...OFFICIAL_MISSION_IDS].sort()).toEqual([...SITE_IDS].sort());
    OFFICIAL_MISSIONS.forEach((m) => {
      expect(m.summary.length).toBeGreaterThan(20);
      expect(m.challenge.length).toBeGreaterThan(10);
      expect(m.features.length).toBeGreaterThanOrEqual(3);
    });
    expect(OFFICIAL_MISSIONS.find((m) => m.siteId === "far-side").features).toContain("No direct Earth communications");
  });

  test("environmental difficulty is the destination's; pilot difficulty is separate and the same three everywhere", () => {
    expect(PILOT_DIFFICULTIES).toEqual(["CADET", "ASTRONAUT", "COMMANDER"]);
    const envLabels = OFFICIAL_MISSIONS.map((m) => m.environment);
    PILOT_DIFFICULTIES.forEach((k) => expect(envLabels).not.toContain(k));
  });

  test("lunar landing training is the Sea of Tranquility only", () => {
    expect(TRAINING_LANDING_SITES).toEqual(["tranquillitatis"]);
    expect(TRAINING_LANDING_SITE).toBe("tranquillitatis");
    expect(createMissionConfig({ mode: MODE.TRAINING, siteId: "tranquillitatis", difficulty: "CADET" }).mode).toBe("training");
    ["hadley", "tycho", "far-side"].forEach((id) => expect(() => createMissionConfig({ mode: MODE.TRAINING, siteId: id, difficulty: "CADET" })).toThrow());
  });
});

describe("one mission config for the whole expedition", () => {
  test("every destination × pilot difficulty builds its own frozen config, carrying the site's terrain, zones, comms and seed", () => {
    for (const m of OFFICIAL_MISSIONS) {
      for (const difficulty of PILOT_DIFFICULTIES) {
        const c = createMissionConfig({ mode: MODE.OFFICIAL, siteId: m.siteId, difficulty });
        const def = SITE_DEFS.find((s) => s.id === m.siteId);
        expect(c).toMatchObject({ mode: "official", siteId: m.siteId, difficulty, number: m.number, environment: m.environment, terrain: m.siteId, seed: def.seed });
        expect(c.name).toBe(def.name);
        expect(c.zones.filter((z) => z.primary)).toHaveLength(1);
        expect(c.comms.farSide).toBe(m.siteId === "far-side");
        expect(c.comms.earthLink).toBe(m.siteId !== "far-side");
        expect(Object.isFrozen(c)).toBe(true);
        expect(() => {
          c.siteId = "tranquillitatis";
        }).toThrow();
      }
    }
    expect(() => createMissionConfig({ mode: MODE.OFFICIAL, siteId: "mars", difficulty: "CADET" })).toThrow();
    expect(() => createMissionConfig({ mode: MODE.OFFICIAL, siteId: "tycho", difficulty: "EASY" })).toThrow();
  });

  test("the destinations stay distinct: seeds, landing zones, approaches and coordinates differ", () => {
    const cs = OFFICIAL_MISSIONS.map((m) => createMissionConfig({ mode: MODE.OFFICIAL, siteId: m.siteId, difficulty: "ASTRONAUT" }));
    expect(new Set(cs.map((c) => c.seed)).size).toBe(4);
    expect(new Set(cs.map((c) => JSON.stringify(c.zones))).size).toBe(4);
    expect(new Set(cs.map((c) => `${c.coords.lat},${c.coords.lon}`)).size).toBe(4);
  });

  test("pilot difficulty does not change the spacecraft by destination: the same entry state, fuel and limits at every site", () => {
    for (const k of PILOT_DIFFICULTIES) {
      const cfg = DIFFICULTY[k];
      const starts = OFFICIAL_MISSION_IDS.map((id) => siteStart(getSite(id), cfg));
      starts.forEach((p) => {
        expect(p.y).toBe(cfg.initialAlt);
        expect(p.fuel).toBe(cfg.initialFuel);
        expect(p.vy).toBe(cfg.initialVy);
      });
    }
  });

  test("all twelve official mission / pilot difficulty combinations are achievable (the reference pilot lands)", () => {
    for (const m of OFFICIAL_MISSIONS) {
      for (const k of PILOT_DIFFICULTIES) {
        const c = createMissionConfig({ mode: MODE.OFFICIAL, siteId: m.siteId, difficulty: k });
        const r = fly(DIFFICULTY[c.difficulty], guidedStrategy(), { lag: 0.3, seed: 1, site: getSite(c.terrain) });
        expect([m.siteId, k, r.landed]).toEqual([m.siteId, k, true]);
      }
    }
  });
});

describe("selection persistence and the lunar-orbit view", () => {
  test("a stored selection is used as is; anything else falls back to the defaults", () => {
    expect(normalizeSelection({ siteId: "tycho", difficulty: "COMMANDER" })).toEqual({ siteId: "tycho", difficulty: "COMMANDER" });
    expect(normalizeSelection(null)).toEqual(DEFAULT_SELECTION);
    expect(normalizeSelection({ siteId: "atlantis", difficulty: "HERO" })).toEqual(DEFAULT_SELECTION);
    expect(normalizeSelection({ siteId: "far-side" })).toEqual({ siteId: "far-side", difficulty: DEFAULT_SELECTION.difficulty });
  });

  test("selenographic coordinates are read from the sites", () => {
    expect(parseCoords("26.13°N 3.63°E")).toEqual({ lat: 26.13, lon: 3.63 });
    expect(parseCoords("40.98°S 11.51°W")).toEqual({ lat: -40.98, lon: -11.51 });
    expect(parseCoords("45.4°S 177.6°E")).toEqual({ lat: -45.4, lon: 177.6 });
  });

  test("lunar orbit is shown over a near-side destination itself; for the far side, over the near side short of the limb, with no site marker", () => {
    for (const def of SITE_DEFS) {
      const v = orbitViewFor(def);
      const c = parseCoords(def.coords);
      if (def.earthLink === false) {
        expect(v.marker).toBe(false);
        expect(Math.abs(v.lon)).toBeLessThan(90); // seen from the Earth: Houston's arrival and go for PDI are justified
        expect(v.lat).toBe(c.lat);
      } else {
        expect(v).toEqual({ lat: c.lat, lon: c.lon, marker: true, nearSide: true });
        expect(Math.abs(v.lon)).toBeLessThan(90);
      }
    }
  });
});
