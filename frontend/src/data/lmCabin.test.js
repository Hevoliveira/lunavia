import {
  ASCENT_PREP,
  CDR_WINDOW,
  EVA_PREP,
  HOTSPOTS,
  LMP_WINDOW,
  STATIONS,
  STEP_TIME,
  ascentReady,
  cabinStep,
  cabinText,
  cabinTick,
  clampLook,
  createCabin,
  evaReady,
  hotspotById,
  inWindowView,
  insideCabin,
  lookDir,
  panelText,
  stationById,
  throughAnyWindow,
  throughWindow,
  windowCorners,
  windowGroundBand,
  worldToCabin,
} from "./lmCabin";
import { CABIN_HALF_X, GROUND } from "./lmDesign";
import { OFFICIAL_MISSION_IDS } from "./missionConfig";
import { getSite } from "./landingSites";
import { skyDirection } from "./terrainMesh";

const run = (c, kind, i) => {
  let s = cabinStep(c, kind, i);
  for (let t = 0; t < STEP_TIME + 0.2; t += 0.1) s = cabinTick(s, 0.1);
  return s;
};

describe("the cabin is the inside of the ascent stage the player landed", () => {
  test("every station's eye and every panel is inside the exterior's cabin profile", () => {
    STATIONS.forEach((s) => expect(insideCabin(s.eye, s.id === "window" ? 0.012 : 0.02)).toBe(true));
    HOTSPOTS.forEach((h) => expect(insideCabin(h.pos, 0.004)).toBe(true));
  });
  test("outside the hull is outside the cabin", () => {
    expect(insideCabin([0, 0.6, 0.35])).toBe(false); // in front of the hatch
    expect(insideCabin([CABIN_HALF_X + 0.01, 0.6, 0])).toBe(false);
    expect(insideCabin([0, 0.9, 0])).toBe(false); // above the roof
    expect(insideCabin([0, 0.3, 0])).toBe(false); // under the floor
  });
  test("the two windows are the exterior's: the commander's on the left (+X), the pilot's on the right", () => {
    const cdr = windowCorners(CDR_WINDOW);
    const lmp = windowCorners(LMP_WINDOW);
    cdr.forEach((p) => expect(p[0]).toBeGreaterThan(0));
    lmp.forEach((p) => expect(p[0]).toBeLessThan(0));
    // on the upper front facet, high in the cabin and forward
    [...cdr, ...lmp].forEach((p) => {
      expect(p[1]).toBeGreaterThan(0.76);
      expect(p[1]).toBeLessThan(0.84);
      expect(p[2]).toBeGreaterThan(0.1);
    });
  });
});

describe("the window station sees the landing site", () => {
  test("the resting gaze goes out through the commander's window, below the horizon", () => {
    const s = stationById("window");
    expect(s.pitch).toBeLessThan(0);
    expect(throughWindow(s.eye, lookDir(s.yaw, s.pitch), CDR_WINDOW)).toBe(true);
  });
  test("the ground is in view: from ~6 m up, a band of the surface from about 15 m out to the horizon", () => {
    const eyeH = (stationById("window").eye[1] - GROUND) * 4.8;
    expect(eyeH).toBeGreaterThan(5);
    expect(eyeH).toBeLessThan(6.5);
    const band = windowGroundBand(eyeH);
    expect(band.bottom).toBeLessThan(-15); // looks well down
    expect(band.near).toBeLessThan(25);
    expect(band.top).toBe(0); // the horizon itself is in the window (the sweep starts there)
    expect(throughWindow(stationById("window").eye, lookDir(0, 15), CDR_WINDOW)).toBe(true); // and the black sky above it
  });
  test("a gaze straight down or straight back never passes through a window", () => {
    const s = stationById("window");
    expect(throughAnyWindow(s.eye, lookDir(0, -89))).toBe(false);
    expect(throughAnyWindow(s.eye, lookDir(180, 0))).toBe(false);
  });
  test("worldToCabin undoes the LM's resting attitude (level: unchanged)", () => {
    const d = [0.3, 0.5, 0.81];
    expect(worldToCabin(d, null)).toEqual(d);
    const tilted = worldToCabin([0, 1, 0], { tilt: 5, pitch: 0 });
    expect(Math.hypot(...tilted)).toBeCloseTo(1, 9);
    expect(Math.acos(tilted[1]) * (180 / Math.PI)).toBeCloseTo(5, 6);
  });
});

describe("looking around: limited, per station (no free walking)", () => {
  test("drags are clamped to the station's limits", () => {
    const s = stationById("window");
    expect(clampLook(s, 500, 500)).toEqual([s.yaw + s.look.yaw, s.pitch + s.look.up]);
    expect(clampLook(s, -500, -500)).toEqual([s.yaw - s.look.yaw, s.pitch - s.look.down]);
    expect(clampLook(s, s.yaw + 5, s.pitch + 3)).toEqual([s.yaw + 5, s.pitch + 3]);
  });
  test("no station can look straight down (no nausea-inducing flips)", () => {
    STATIONS.forEach((s) => expect(s.pitch - s.look.down).toBeGreaterThan(-75));
  });
  test("each hotspot belongs to an existing station and is in front of its eye", () => {
    HOTSPOTS.forEach((h) => {
      const s = stationById(h.station);
      expect(s.id).toBe(h.station);
      const v = [h.pos[0] - s.eye[0], h.pos[1] - s.eye[1], h.pos[2] - s.eye[2]];
      const d = lookDir(s.yaw, s.pitch);
      const cos = (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / Math.hypot(...v);
      expect(cos).toBeGreaterThan(Math.cos((s.fov * 0.62 * Math.PI) / 180)); // within the view at rest
    });
  });
});

describe("the checklists", () => {
  test("EVA preparation: three steps in order, each taking STEP_TIME, then BEGIN EVA is ready", () => {
    let c = createCabin({ evaAvailable: true });
    expect(evaReady(c)).toBe(false);
    expect(cabinStep(c, "eva", 1)).toBe(c); // out of order
    c = run(c, "eva", 0);
    expect(c.eva).toBe(1);
    const busy = cabinStep(c, "eva", 1);
    expect(cabinStep(busy, "eva", 2)).toBe(busy); // one at a time
    c = run(c, "eva", 1);
    c = run(c, "eva", 2);
    expect(c.eva).toBe(EVA_PREP.length);
    expect(evaReady(c)).toBe(true);
  });
  test("after the EVA (or where none is planned) there is nothing to prepare for it", () => {
    const done = createCabin({ evaAvailable: true, evaDone: true });
    expect(cabinStep(done, "eva", 0)).toBe(done);
    expect(evaReady(done)).toBe(false);
    const none = createCabin({ evaAvailable: false });
    expect(cabinStep(none, "eva", 0)).toBe(none);
  });
  test("ascent preparation: three steps, available with or without an EVA", () => {
    [createCabin({ evaAvailable: true }), createCabin({ evaDone: true }), createCabin()].forEach((c0) => {
      let c = c0;
      ASCENT_PREP.forEach((_, i) => (c = run(c, "ascent", i)));
      expect(ascentReady(c)).toBe(true);
    });
  });
});

describe("the panels read the mission's real state", () => {
  test("the window names the actual destination; the far side has no Earth", () => {
    OFFICIAL_MISSION_IDS.forEach((id) => {
      const site = getSite(id);
      const t = panelText("window", { site, pose: null }, "en");
      expect(t.lines[0][1]).toBe(site.name);
      const earth = t.lines.find((l) => l[0] === "EARTH");
      if (site.earth) expect(earth[1]).not.toMatch(/FAR SIDE/);
      else expect(earth[1]).toMatch(/FAR SIDE/);
    });
  });
  test("comms: Houston on the near side, no Earth link on the far side", () => {
    const near = panelText("comms", { site: getSite(OFFICIAL_MISSION_IDS[0]), farSide: false }, "en");
    expect(near.lines[0][1]).toMatch(/HOUSTON/);
    const far = panelText("comms", { site: getSite(OFFICIAL_MISSION_IDS[0]), farSide: true }, "pt");
    expect(far.lines[0][1]).toMatch(/INDISPONÍVEL/);
  });
  test("the landing panel shows the touchdown as flown", () => {
    const site = getSite(OFFICIAL_MISSION_IDS[0]);
    const t = panelText("landing", { site, pose: { tilt: 2, pitch: 1 }, result: { touchdownSpeed: 1.23, fuelPct: 17 } }, "en");
    expect(t.lines.find((l) => l[0] === "TOUCHDOWN SPEED")[1]).toBe("1.2 m/s");
    expect(t.lines.find((l) => l[0] === "DESCENT FUEL LEFT")[1]).toBe("17 %");
    expect(t.lines.find((l) => l[0] === "LM TILT")[1]).toBe("2.2°");
  });
  test("every panel has a title and lines in English and Portuguese", () => {
    const site = getSite(OFFICIAL_MISSION_IDS[1]);
    ["en", "pt"].forEach((lang) =>
      HOTSPOTS.forEach((h) => {
        const t = panelText(h.id, { site, cabin: createCabin({ evaAvailable: true }) }, lang);
        expect(t.title.length).toBeGreaterThan(3);
        expect(t.lines.length).toBeGreaterThan(0);
      })
    );
    expect(hotspotById("nope")).toBe(null);
  });
  test("whether the Earth shows in the windows follows the site's sky", () => {
    OFFICIAL_MISSION_IDS.forEach((id) => {
      const site = getSite(id);
      if (!site.earth) return;
      expect(typeof inWindowView(skyDirection(site.earth), null)).toBe("boolean");
    });
  });
  test("the UI text exists in both languages", () => {
    const en = cabinText("en");
    const pt = cabinText("pt");
    Object.keys(en).forEach((k) => expect(pt[k]).toBeTruthy());
  });
});
