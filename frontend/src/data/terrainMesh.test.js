import { FOOT_RADIUS, SITE_IDS, getSite, hazardMap } from "./landingSites";
import { GRID, buildTerrain, farAxis, fineAxis, hazardStrip, rockInstances, skyDirection, sunVisAt } from "./terrainMesh";
import { WORLD_X } from "./touchdownFx";

const SITES = SITE_IDS.map((id) => getSite(id));

describe("the drawn terrain is the physics terrain", () => {
  test("1 m cells where the LM flies and lands; a coarse far field to the horizon that meets the fine patch's edge", () => {
    const xs = fineAxis(GRID.fineX);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(1, 9);
    expect(xs[0]).toBe(-GRID.fineX);
    expect(xs[xs.length - 1]).toBe(GRID.fineX);
    const fx = farAxis(GRID.fineX);
    expect(fx[0]).toBe(-GRID.far);
    expect(fx[fx.length - 1]).toBe(GRID.far);
    expect(fx).toContain(GRID.fineX);
    expect(fx).toContain(-GRID.fineX);
    for (let i = 1; i < fx.length; i++) expect(fx[i]).toBeGreaterThan(fx[i - 1]);
    // the whole track the LM can land on is inside the fine patch
    for (const s of SITES) expect(Math.max(...s.zones.map((z) => Math.abs(z.x) + z.r)) + FOOT_RADIUS).toBeLessThan(GRID.fineX);
    const t = buildTerrain(SITES[0]);
    expect(t.count).toBeLessThan(25000); // iPhone budget: one draw call, ~40k triangles
  });

  test.each(SITE_IDS)("%s: every vertex sits at the site's height, in the site's scale", (id) => {
    const s = getSite(id);
    const t = buildTerrain(s);
    const { near, far } = t;
    // all of the track row (z = 0) of the fine patch: these are the first vertices
    const j0 = near.zs.indexOf(0);
    for (let i = 0; i < near.nx; i += 1) {
      const k = j0 * near.nx + i;
      expect(near.heights[k]).toBeCloseTo(s.height(near.xs[i], 0), 4);
      expect(t.positions[k * 3]).toBeCloseTo(near.xs[i] * WORLD_X, 4);
      expect(t.positions[k * 3 + 1]).toBeCloseTo(s.scale.y(s.height(near.xs[i], 0)), 4);
      expect(t.positions[k * 3 + 2]).toBe(0);
    }
    for (const g of [near, far]) {
      for (let k = 0; k < g.nx * g.nz; k += 397) expect(g.heights[k]).toBeCloseTo(s.height(g.xs[k % g.nx], g.zs[(k / g.nx) | 0]), 4);
    }
    // the drawn surface (1 m cells, what lookup returns for the markers and footpads)
    // stays within 25 cm of the physics terrain everywhere the LM can land (the
    // largest gaps are on sharp crater-rim crests between vertices), less than
    // the struts take up (0.36 m)
    let worst = 0;
    for (let x = -GRID.fineX; x <= GRID.fineX; x += 0.23) {
      for (const z of [-4.9, -2.1, 0.4, 3.3, 4.9]) worst = Math.max(worst, Math.abs(t.lookup(x, z) - s.height(x, z)));
    }
    expect(worst).toBeLessThan(0.25);
    // and at a vertex it is exact, in the fine patch and in the far field
    expect(t.lookup(12, 3)).toBeCloseTo(s.height(12, 3), 4);
    expect(t.lookup(far.xs[3], far.zs[5])).toBeCloseTo(s.height(far.xs[3], far.zs[5]), 4);
  });

  test.each(SITE_IDS)("%s: every rock is drawn once, where the physics has it, as tall and as wide", (id) => {
    const s = getSite(id);
    const boulders = rockInstances(s, true);
    const debris = rockInstances(s, false);
    expect(boulders.length).toBe(s.boulders.length);
    expect(boulders.length + debris.length).toBe(s.rocks.length);
    boulders.forEach((r) => {
      expect(r.position[0]).toBeCloseTo(r.rock.x * WORLD_X, 6);
      expect(r.position[2]).toBeCloseTo(r.rock.z * WORLD_X, 6);
      expect(r.position[1]).toBeCloseTo(s.scale.y(r.rock.base), 6);
      expect(r.position[1] + r.scale[1]).toBeCloseTo(s.scale.y(r.rock.top), 6); // the drawn top is the physical top
      expect(r.scale[0]).toBeCloseTo(r.rock.r * WORLD_X, 6); // radius 1 unit rock -> the rock's radius
    });
  });

  test.each(SITE_IDS)("%s: the hazard strip marks exactly the unsafe stretches, across the LM's footprint", (id) => {
    const s = getSite(id);
    const strip = hazardStrip(s);
    expect(strip.map(({ x0, x1, name }) => ({ x0, x1, name }))).toEqual(hazardMap(s).map(({ x0, x1, name }) => ({ x0, x1, name })));
    strip.forEach((h) => expect(h.halfWidth).toBeCloseTo(FOOT_RADIUS, 9));
  });
});

describe("light", () => {
  test("Sun directions are unit vectors above the horizon, low as on the Apollo landings", () => {
    for (const s of SITES) {
      const d = skyDirection(s.sun);
      expect(Math.hypot(...d)).toBeCloseTo(1, 9);
      expect(s.sun.el).toBeGreaterThan(8);
      expect(s.sun.el).toBeLessThan(26);
      expect(d[1]).toBeCloseTo(Math.sin((s.sun.el * Math.PI) / 180), 9);
    }
  });

  test("the terrain's own shadows: inside a crater the wall nearest the Sun is in shadow, the far wall lit", () => {
    const s = getSite("tycho");
    const t = buildTerrain(s);
    const crater = s.features.find((f) => f.type === "crater" && f.label === "FRESH CRATER");
    const d = skyDirection(s.sun);
    const h = Math.hypot(d[0], d[2]);
    const [ux, uz] = [d[0] / h, d[2] / h];
    const near = sunVisAt(t, crater.x + ux * crater.r * 0.7, crater.z + uz * crater.r * 0.7);
    const far = sunVisAt(t, crater.x - ux * crater.r * 0.7, crater.z - uz * crater.r * 0.7);
    expect(near).toBeLessThan(0.3);
    expect(far).toBeGreaterThan(0.7);
    // the flat melt pond is in full sunlight
    expect(sunVisAt(t, 0, 0)).toBeGreaterThan(0.95);
  });

  test.each(SITE_IDS)("%s: every landing zone is in sunlight (the low Sun's long shadows never cover a place to land)", (id) => {
    const s = getSite(id);
    const t = buildTerrain(s);
    s.zones.forEach((z) => {
      for (const dx of [-z.r, 0, z.r]) expect([z.label, dx, sunVisAt(t, z.x + dx, 0) > 0.9]).toEqual([z.label, dx, true]);
    });
  });
});
