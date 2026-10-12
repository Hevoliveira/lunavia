import { DIFFICULTY, MOON_G } from "./landingPhysics";
import { simulate, gradeTouchdown, CONTACT_ALT } from "./landerSim";
import { fly, guidedStrategy, withoutRcs } from "./landerPilots";
import {
  BOULDER_MIN,
  DEBRIS_MAX,
  FOOT,
  FOOT_RADIUS,
  MISSION_SITE_ID,
  PADS,
  PAD_SLOPE_LIMIT,
  SITE_DEFS,
  SITE_IDS,
  SLOPE_LIMIT,
  compileSite,
  getSite,
  hazardMap,
  siteStart,
} from "./landingSites";
import { LM, WORLD_X } from "./touchdownFx";

const KEYS = ["CADET", "ASTRONAUT", "COMMANDER"];
const SITES = SITE_IDS.map((id) => getSite(id));

// A small test site: flat unless given features.
const testSite = (over = {}) =>
  compileSite({
    id: "test",
    seed: 3,
    range: [-80, 80],
    approach: { dir: 1, offset: 0.3 },
    zones: [{ x: 0, r: 3, primary: true, label: "LZ" }],
    terrain: [],
    rockFields: [],
    ...over,
  });

// Fly straight down at x from `alt` m above the ground, holding a gentle rate.
const dropAt = (site, x, { vx = 0, vy = -1.2, alt = 20, tilt = 0 } = {}) => {
  const cfg = DIFFICULTY.CADET;
  const hold = (seen) => ({ throttle: seen.vy < vy });
  const init = { xPos: x, alt, vy, vx, tilt, fuel: cfg.initialFuel, throttle: 0.3 };
  return simulate(cfg, hold, { init, site, fps: 120 });
};

describe("the four lunar missions", () => {
  test("catalogue: wide plain, mountain valley, crater region, far side; primary LZ at the datum, LZs no larger as they get harder", () => {
    expect(SITE_IDS).toEqual(["tranquillitatis", "hadley", "tycho", "far-side"]);
    expect(SITES.map((s) => s.name)).toEqual(["SEA OF TRANQUILITY", "HADLEY–APENNINE", "TYCHO HIGHLANDS", "SILENT HORIZON"]);
    expect(SITES.map((s) => s.kind)).toEqual(["WIDE PLAIN", "MOUNTAIN VALLEY", "CRATER REGION", "FAR SIDE"]);
    expect(SITES.map((s) => s.level)).toEqual([1, 2, 3, 4]);
    expect(MISSION_SITE_ID).toBe("tranquillitatis");
    const radii = SITES.map((s) => s.primary.r);
    expect(radii).toEqual([6, 5, 4, 4]);
    SITES.forEach((s) => {
      expect(s.primary.x).toBe(0);
      expect(Math.abs(s.height(0, 0))).toBeLessThan(1e-9);
      expect(s.ref).toBeTruthy();
      expect(s.briefing).toBeTruthy();
      expect(s.challenge).toBeTruthy();
    });
  });

  test("the Earth: in the sky over the near-side sites, below the horizon (and out of radio reach) on the far side", () => {
    SITES.forEach((s) => {
      if (s.id === "far-side") {
        expect(s.earth).toBeNull();
        expect(s.earthLink).toBe(false);
      } else {
        expect(s.earth.el).toBeGreaterThan(20);
        expect(s.earthLink).not.toBe(false);
      }
    });
  });

  test("deterministic: the same definition always builds the same terrain and the same rocks", () => {
    for (const def of SITE_DEFS) {
      const a = compileSite(def);
      const b = compileSite(def);
      expect(a.rocks).toEqual(b.rocks);
      for (let x = -150; x <= 150; x += 7.3) for (let z = -60; z <= 60; z += 11.1) expect(a.height(x, z)).toBe(b.height(x, z));
    }
    expect(getSite("nowhere").id).toBe(MISSION_SITE_ID);
  });

  test("distinct environments: different relief, rock density and approach at each site", () => {
    const relief = SITES.map((s) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let x = -120; x <= 120; x += 2) {
        const h = s.height(x, 0);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
      return hi - lo;
    });
    // the open plain has the least relief; the Apennine front and the rille give Hadley the most;
    // the far side's crater wall and ridges are in between
    expect(relief[0]).toBe(Math.min(...relief));
    expect(relief[1]).toBe(Math.max(...relief));
    expect(relief[3]).toBeGreaterThan(2 * relief[0]);
    const density = SITES.map((s) => s.boulders.filter((b) => Math.abs(b.x) < 150 && Math.abs(b.z) < 60).length);
    expect(density[2]).toBe(Math.max(...density)); // Tycho: boulders everywhere
    const unsafe = SITES.map((s) => hazardMap(s, 0.5).filter((h) => h.x1 > -60 && h.x0 < 60).reduce((a, h) => a + Math.min(60, h.x1) - Math.max(-60, h.x0), 0));
    expect(unsafe[2]).toBe(Math.max(...unsafe)); // limited safe ground at Tycho
    // the far side's clearing is hemmed in: hazards on both sides within 5 m of its edge,
    // closer than anything near the plain's LZ
    const gaps = (s) => {
      const z = s.primary;
      const hm = hazardMap(s, 0.25);
      const before = Math.min(...hm.filter((h) => h.x1 < z.x).map((h) => z.x - z.r - h.x1));
      const after = Math.min(...hm.filter((h) => h.x0 > z.x).map((h) => h.x0 - z.x - z.r));
      return [before, after];
    };
    gaps(SITES[3]).forEach((g) => expect(g).toBeLessThan(5));
    expect(Math.max(...gaps(SITES[3]))).toBeLessThan(Math.min(...gaps(SITES[0])));
    // and its approach comes in over a crater wall steeper than the LM's limit
    expect(hazardMap(SITES[3], 0.5).some((h) => h.name === "CRATER WALL" && h.kind === "slope")).toBe(true);
    expect(new Set(SITES.map((s) => s.approach.dir)).size).toBe(2); // approaches from both sides
    expect(getSite("hadley").approach.offset).toBeLessThan(0.3); // Apollo 15's steep approach
  });
});

describe("terrain contact (collision)", () => {
  test("the LM's footprint matches the drawn LanderModel", () => {
    expect(FOOT.pad).toBeCloseTo(LM.padRadius / WORLD_X, 9);
    expect(FOOT_RADIUS).toBeCloseTo(4.87, 2);
    expect(PADS).toHaveLength(4);
  });

  test("on rising ground the uphill footpad meets the ground first", () => {
    const site = testSite({ terrain: [{ type: "front", x0: -20, x1: -120, h: 30 }] });
    for (const x of [-40, -60, -80]) {
      const up = site.height(x - FOOT.pad, 0); // the ground rises towards -x
      expect(site.contactGround(x)).toBeCloseTo(up, 9);
      expect(site.contactGround(x)).toBeGreaterThan(site.height(x, 0));
    }
  });

  test("a boulder under a footpad is met at its top; under the descent stage, when it reaches the engine skirt", () => {
    const site = testSite({ rockFields: [{ x: 30, z: 0, r: 0.01, n: 1, h: [2, 2], label: "BOULDERS" }] });
    const b = site.boulders[0];
    expect(b.h).toBeGreaterThanOrEqual(BOULDER_MIN);
    // centred over it: the descent stage
    expect(site.contactGround(b.x)).toBeCloseTo(Math.max(0, b.top - FOOT.clearance), 9);
    // a footpad over it
    expect(site.contactGround(b.x - FOOT.pad)).toBeCloseTo(b.top, 9);
    // clear of it: the ground
    expect(site.contactGround(b.x - 12)).toBeCloseTo(0, 9);
  });

  test("coming down onto a boulder, touchdown is captured above the boulder and graded UNSAFE TERRAIN", () => {
    const site = testSite({ rockFields: [{ x: 30, z: 0, r: 0.01, n: 1, h: [2, 2], label: "BOULDERS" }] });
    const b = site.boulders[0];
    const r = dropAt(site, b.x - FOOT.pad);
    expect(r.state.y).toBeGreaterThan(b.top);
    expect(r.state.y - b.top).toBeLessThanOrEqual(CONTACT_ALT + 1e-9);
    expect(r.result.crashed).toBe(true);
    expect(r.result.failureReasons).toContain("UNSAFE TERRAIN");
    expect(r.result.zone).toBe("BOULDERS");
    // between the pads, even where nothing touches, the footprint is not safe
    const between = b.x + FOOT.pad * Math.SQRT1_2;
    expect(site.evaluate(between).hazard.kind).toBe("boulders");
    // and well clear of it, the same descent lands
    expect(dropAt(site, b.x - 15).result.crashed).toBe(false);
  });

  test("slopes: the LM lands on ground up to 12° across its footpads, not beyond", () => {
    // a long ramp: slope 0 at both ends, steepest (≈ 20°) in the middle
    const site = testSite({ terrain: [{ type: "front", x0: -10, x1: -170, h: 40 }] });
    let gentle = null;
    let steep = null;
    for (let x = -15; x > -165; x -= 0.5) {
      const e = site.evaluate(x);
      if (!gentle && e.slope > 8 && e.slope < 10) gentle = x;
      if (!steep && e.slope > 14 && e.slope < 16) steep = x;
    }
    expect(gentle).not.toBeNull();
    expect(steep).not.toBeNull();
    const ok = dropAt(site, gentle);
    expect(ok.result.crashed).toBe(false);
    expect(ok.result.terrain.slope).toBeGreaterThan(8);
    const bad = dropAt(site, steep);
    expect(bad.result.crashed).toBe(true);
    expect(bad.result.failureReasons).toContain("UNSAFE TERRAIN");
    expect(bad.result.terrain.kind).toBe("slope");
    expect(bad.result.zone).toMatch(/°$/);
    expect(SLOPE_LIMIT).toBe(12);
  });

  test("a footpad on a crater wall slides: straddling a small fresh crater is unsafe where a pad meets its wall", () => {
    const site = testSite({ terrain: [{ type: "crater", x: 30, z: 0, r: 5, d: 1.6, rim: 0.35 }] });
    // centred, the four pads sit on its walls
    const c = site.evaluate(30);
    expect(c.footSlope).toBeGreaterThan(PAD_SLOPE_LIMIT);
    expect(c.hazard.kind).toBe("slope");
    // far enough away, the ground is flat again
    expect(site.evaluate(30 - 5 * 2.6 - FOOT_RADIUS).hazard).toBeNull();
  });

  test("flying low into rising ground ends the flight on the slope (terrain collision)", () => {
    const site = testSite({ terrain: [{ type: "ridge", x0: 40, z0: -100, x1: 40, z1: 100, w: 18, h: 9 }] });
    const cfg = DIFFICULTY.CADET;
    // hold a hover 4 m above the plain while drifting at 3 m/s into the ridge
    const hover = (seen) => ({ throttle: seen.vy < 0 || seen.y < 4.5 });
    const r = simulate(cfg, hover, { init: { xPos: 0, alt: 4.5, vy: 0, vx: 3, fuel: cfg.initialFuel, throttle: 0.3 }, site, fps: 120 });
    expect(r.state.xPos).toBeGreaterThan(40 - 18 - FOOT.pad - 1); // on the ridge's flank
    expect(r.state.xPos).toBeLessThan(40);
    expect(r.state.y - site.contactGround(r.state.xPos)).toBeLessThanOrEqual(CONTACT_ALT + 1e-9);
    expect(r.result.crashed).toBe(true);
  });

  test("debris stones are harmless, boulders are hazards, and no rock is in between", () => {
    for (const s of SITES) {
      for (const r of s.rocks) {
        if (r.boulder) expect(r.h).toBeGreaterThanOrEqual(BOULDER_MIN);
        else expect(r.h * 1.12).toBeLessThanOrEqual(DEBRIS_MAX + 1e-9);
      }
      expect(DEBRIS_MAX).toBeLessThan(FOOT.clearance);
    }
  });
});

describe("what is drawn is what is flown", () => {
  test("no invisible hazards: with no terrain and no rocks there is nothing unsafe anywhere", () => {
    const site = testSite();
    expect(hazardMap(site, 0.5)).toEqual([]);
  });

  test("every boulder the LM could stand on makes the ground under it unsafe", () => {
    for (const s of SITES) {
      for (const b of s.boulders) {
        if (Math.abs(b.z) >= FOOT_RADIUS + b.r || b.x < s.range[0] || b.x > s.range[1]) continue;
        const e = s.evaluate(b.x);
        expect([s.id, b.x, e.hazard && e.hazard.kind]).toEqual([s.id, b.x, "boulders"]);
      }
    }
  });

  test("every unsafe stretch has a cause on screen: a drawn boulder under the footprint, or ground steeper than the limits", () => {
    for (const s of SITES) {
      for (const h of hazardMap(s, 0.5)) {
        const x = (h.x0 + h.x1) / 2;
        const e = s.evaluate(x);
        if (!e.hazard) continue; // a stretch merged across a gap of the same feature
        if (e.hazard.kind === "boulders") {
          expect(s.rocks.some((r) => r.boulder && Math.hypot(r.x - x, r.z) < FOOT_RADIUS + r.r)).toBe(true);
        } else {
          expect(e.slope > SLOPE_LIMIT || e.footSlope > PAD_SLOPE_LIMIT || e.twist > FOOT.stroke || s.height(x, 0) - (e.pads.reduce((a, v) => a + v, 0) / 4) > FOOT.clearance).toBe(true);
        }
      }
    }
  });

  test("landing zones: safe across their whole width, gentle, and clear of the nearest hazard", () => {
    for (const s of SITES) {
      const map = hazardMap(s, 0.25);
      for (const z of s.zones) {
        for (let x = z.x - z.r + 0.05; x < z.x + z.r; x += 0.1) {
          const e = s.evaluate(x);
          expect([s.id, z.label, x, e.hazard]).toEqual([s.id, z.label, x, null]);
          expect(e.slope).toBeLessThan(5);
          expect(e.safeZone.label).toBe(z.label);
        }
        const gap = Math.min(...map.map((h) => (h.x1 < z.x ? z.x - z.r - h.x1 : h.x0 - z.x - z.r)));
        expect([s.id, z.label, gap >= 1.5]).toEqual([s.id, z.label, true]);
      }
    }
  });

  test("the hazard map is the touchdown evaluation itself", () => {
    for (const s of SITES) {
      const map = hazardMap(s, 0.25);
      for (let x = -100; x <= 100; x += 0.25 * 15) {
        const inMap = map.some((h) => x >= h.x0 - 1e-9 && x <= h.x1 + 1e-9);
        expect([s.id, x, inMap]).toEqual([s.id, x, !!s.evaluate(x).hazard]);
      }
    }
  });

  test("the mission's site keeps its four hazards where they were, now as real craters and boulders", () => {
    const s = getSite(MISSION_SITE_ID);
    const map = hazardMap(s, 0.25);
    const covers = (x, name) => map.some((h) => h.x0 <= x && h.x1 >= x && h.name === name);
    expect(covers(-55, "CRATER · ROUGH")).toBe(true);
    expect(covers(-20, "BOULDERS")).toBe(true);
    expect(covers(25, "CRATER")).toBe(true);
    expect(covers(60, "ROUGH TERRAIN")).toBe(true);
    // the primary LZ as before, flat
    expect(s.primary).toEqual({ x: 0, r: 6, primary: true, label: "PRIMARY LZ" });
    for (let x = -6; x <= 6; x += 0.5) expect(Math.abs(s.contactGround(x))).toBeLessThan(1e-9);
  });
});

describe("approaches and starts", () => {
  test.each(SITE_IDS)("%s: every difficulty starts high, heading for the LZ, and can coast 15 s engine-off without nearing the ground", (id) => {
    const s = getSite(id);
    for (const k of KEYS) {
      const cfg = DIFFICULTY[k];
      const p = siteStart(s, cfg);
      expect(p.y).toBe(cfg.initialAlt);
      expect(p.alt).toBeGreaterThan(cfg.initialAlt - 60);
      expect(p.alt).toBeLessThan(cfg.initialAlt + 20);
      expect(Math.sign(p.vx)).toBe(-Math.sign(p.xPos)); // drifting towards the LZ
      expect(Math.sign(p.xPos)).toBe(-s.approach.dir);
      // coast: free fall, the ground well below throughout
      let y = p.y;
      let vy = p.vy;
      let x = p.xPos;
      for (let t = 0; t < 15; t += 0.05) {
        vy -= MOON_G * 0.05;
        y += vy * 0.05;
        x += p.vx * 0.05;
        expect(y - s.contactGround(x)).toBeGreaterThan(150);
      }
    }
  });

  test.each(SITE_IDS)("%s: the reference pilot lands from every difficulty's start", (id) => {
    const s = getSite(id);
    for (const k of KEYS) {
      const r = fly(DIFFICULTY[k], guidedStrategy(), { lag: 0.3, seed: 1, site: s });
      expect([k, r.landed]).toEqual([k, true]);
    }
  });
});

describe("terrain changes the outcome where it should", () => {
  test("Hadley: from the steep approach, never nulling the drift carries the LM onto the rille or its boulders", () => {
    const s = getSite("hadley");
    const r = fly(DIFFICULTY.ASTRONAUT, withoutRcs(guidedStrategy()), { lag: 0.3, seed: 1, site: s });
    expect(r.landed).toBe(false);
    expect(r.x).toBeGreaterThan(15);
    expect(r.reasons).toContain("UNSAFE TERRAIN");
    expect(r.zone).toMatch(/RILLE/);
  });

  test("Tycho: off the melt pond, 20 m short of the LZ or 10 m beyond it, the LM comes down among craters and boulders", () => {
    const s = getSite("tycho");
    const cfg = DIFFICULTY.ASTRONAUT;
    for (const x of [-s.approach.dir * 20, s.approach.dir * 10]) {
      const p = siteStart(s, cfg, { xPos: x, alt: 0.5, vy: -1, vx: 0 });
      const result = gradeTouchdown(p, cfg, s);
      expect([x, result.crashed]).toEqual([x, true]);
      expect(result.failureReasons).toContain("UNSAFE TERRAIN");
    }
  });

  test("Silent Horizon: short of the clearing the secondary crater, past it the boulder field and the wrinkle ridge, behind it the crater wall", () => {
    const s = getSite("far-side");
    const cfg = DIFFICULTY.ASTRONAUT;
    const at = (x) => gradeTouchdown(siteStart(s, cfg, { xPos: x, alt: 0.5, vy: -1, vx: 0 }), cfg, s);
    const cases = [
      [17, "SECONDARY CRATER"],
      [-16, "BOULDER FIELD"],
      [-32, "WRINKLE RIDGE"],
      [125, "CRATER WALL"],
    ];
    for (const [x, name] of cases) {
      const r = at(x);
      expect([x, r.crashed]).toEqual([x, true]);
      expect(r.failureReasons).toContain("UNSAFE TERRAIN");
      expect(s.evaluate(x).hazard.name).toBe(name);
    }
    // the clearing itself, and both alternates, are safe
    s.zones.forEach((z) => expect([z.label, at(z.x).crashed]).toEqual([z.label, false]));
  });
});
