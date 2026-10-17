import { lastFlight, loadMissionLog, loadSelection, logMissionComplete, logMissionLanding, logMissionStart, saveSelection } from "./missionSelection";
import { loadProgress } from "./trainingProgress";

beforeEach(() => window.localStorage.clear());

describe("the official mission selection, kept on the device", () => {
  test("a fresh device starts on Mission 01, ASTRONAUT; a choice is kept and read back", () => {
    expect(loadSelection()).toEqual({ siteId: "tranquillitatis", difficulty: "ASTRONAUT" });
    saveSelection({ siteId: "tycho", difficulty: "COMMANDER" });
    expect(loadSelection()).toEqual({ siteId: "tycho", difficulty: "COMMANDER" });
    // a second mission selection replaces the first entirely: nothing of it is inherited
    saveSelection({ siteId: "far-side", difficulty: "CADET" });
    expect(loadSelection()).toEqual({ siteId: "far-side", difficulty: "CADET" });
  });

  test("damaged or foreign storage falls back to the defaults", () => {
    window.localStorage.setItem("lunavia.mission.selection.v1", "{not json");
    expect(loadSelection()).toEqual({ siteId: "tranquillitatis", difficulty: "ASTRONAUT" });
    window.localStorage.setItem("lunavia.mission.selection.v1", JSON.stringify({ siteId: "hadley", difficulty: "PILOT" }));
    expect(loadSelection()).toEqual({ siteId: "hadley", difficulty: "ASTRONAUT" });
  });
});

describe("the official missions' log (separate from training records)", () => {
  const landed = { crashed: false, grade: "A", score: 86, zone: "PRIMARY LZ", fuelPct: 31.4, terrain: { site: "hadley" }, breakdown: { vy: { value: 0.8 }, vx: { value: 0.2 }, tilt: { value: 1.5 }, accuracy: { distance: 2.3 } } };
  const crashed = { crashed: true, grade: "D", score: 10, zone: "BOULDER FIELD", fuelPct: 5, terrain: { site: "tycho" }, breakdown: { vy: { value: 5.1 }, vx: { value: 1 }, tilt: { value: 3 }, accuracy: { distance: 14 } } };

  test("each flight records its destination, pilot difficulty, landing (success or failure, telemetry) and completion", () => {
    const a = logMissionStart({ siteId: "hadley", difficulty: "ASTRONAUT" });
    logMissionLanding(a, landed);
    logMissionComplete(a);
    const b = logMissionStart({ siteId: "tycho", difficulty: "COMMANDER" });
    logMissionLanding(b, crashed);
    const log = loadMissionLog();
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ mode: "official", siteId: "hadley", difficulty: "ASTRONAUT", completed: true });
    expect(log[0].landing).toMatchObject({ success: true, grade: "A", zone: "PRIMARY LZ", vy: 0.8, vx: 0.2, tilt: 1.5, distance: 2.3, fuelPct: 31.4, terrain: "hadley", attempts: 1 });
    expect(log[1]).toMatchObject({ siteId: "tycho", difficulty: "COMMANDER", completed: false });
    expect(log[1].landing).toMatchObject({ success: false, grade: null, terrain: "tycho" });
    // a retried landing counts attempts on the same flight; the last attempt is what is kept
    logMissionLanding(b, landed);
    expect(loadMissionLog()[1].landing).toMatchObject({ success: true, attempts: 2 });
    expect(lastFlight(loadMissionLog(), "tycho").id).toBe(b);
    expect(lastFlight(loadMissionLog(), "far-side")).toBe(null);
    // nothing written into the training records
    expect(loadProgress()).toEqual({});
  });
});
