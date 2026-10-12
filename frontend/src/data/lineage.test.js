import fs from "fs";
import path from "path";
import { LINEAGE, PARTS, partsAfter } from "./lineage";
import { EVENTS, SHOTS } from "./launchTimeline";
import { ORBIT_SHOTS } from "./orbitSequence";

const SRC = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const MISSION_SHOTS = ["cruiseClose", "approachClose", "returnClose", "descent", "reentry"];

describe("spacecraft lineage: one launch vehicle, one spacecraft, one mission", () => {
  const pad = LINEAGE[0].parts;

  test("everything that flies to the Moon is on the pad", () => {
    expect(pad).toEqual(expect.arrayContaining(["cm", "sm", "lm"]));
    LINEAGE.forEach((s) => {
      [...(s.removes || []), ...(s.joins || []), ...(s.splits || []).flat()].forEach((p) => {
        expect(pad).toContain(p);
        expect(PARTS[p]).toBeDefined();
      });
    });
  });

  test("no part ever appears after the launch", () => {
    LINEAGE.forEach((s) => partsAfter(s.id).forEach((p) => expect(pad).toContain(p)));
    expect(LINEAGE.filter((s) => s.parts)).toHaveLength(1);
  });

  test("the command and service module and the lunar module that undock in lunar orbit are the ones from the pad", () => {
    expect(partsAfter("undocking")).toEqual(expect.arrayContaining(["cm", "sm", "lm"]));
    expect(partsAfter("extraction").sort()).toEqual(["cm", "lm", "sm"]);
    expect(partsAfter("translunarCoast").sort()).toEqual(["cm", "lm", "sm"]);
    expect(partsAfter("lunarArrival").sort()).toEqual(["cm", "lm", "sm"]);
  });

  test("the upper stage, the adapter and the escape tower leave, and each is shown leaving", () => {
    const removedAt = {};
    LINEAGE.forEach((s) => (s.removes || []).forEach((p) => (removedAt[p] = s)));
    expect(Object.keys(removedAt).sort()).toEqual(["adapterPanels", "adapterRing", "les", "lm", "sm", "stage1", "stage2"]);
    Object.values(removedAt).forEach((s) => expect(s.shot).toBeTruthy());
    expect(removedAt.stage2.id).toBe("extraction");
  });

  test("every change is seen in a shot that exists, at an event that exists", () => {
    const launchShots = SHOTS.map((s) => s.id);
    const orbitShots = ORBIT_SHOTS.map((s) => s.id);
    const events = EVENTS.map((e) => e.id);
    LINEAGE.forEach((s) => {
      const { launch, orbit, mission } = s.shot;
      if (launch) {
        expect(launchShots).toContain(launch);
        if (s.event) expect(events).toContain(s.event);
      }
      if (orbit) expect(orbitShots).toContain(orbit);
      if (mission) expect(MISSION_SHOTS).toContain(mission);
    });
    // The extraction shot comes after the docking shot, which comes after TLI
    const at = (id) => launchShots.indexOf(id);
    expect(at("tli")).toBeLessThan(at("tdSep"));
    expect(at("tdSep")).toBeLessThan(at("tdTurn"));
    expect(at("tdTurn")).toBeLessThan(at("tdDock"));
    expect(at("tdDock")).toBeLessThan(at("tdExtract"));
  });

  test("no substitute models: every scene draws the spacecraft from the same two models", () => {
    // The removed placeholders stay removed
    ["components/SpacecraftModel.jsx", "components/EarthMoonHero.jsx"].forEach((f) => expect(fs.existsSync(path.join(SRC, f))).toBe(false));
    // The rocket carries the CSM and the LM through its payload section
    const rocket = read("components/RocketModel.jsx");
    expect(rocket).toMatch(/import PayloadSection from "@\/components\/spacecraft\/PayloadSection"/);
    const payload = read("components/spacecraft/PayloadSection.jsx");
    expect(payload).toMatch(/import CsmModel/);
    expect(payload).toMatch(/import LanderModel from "@\/components\/LanderModel"/);
    // The stack flown to the Moon and back
    const stack = read("components/spacecraft/SpacecraftStack.jsx");
    expect(stack).toMatch(/import CsmModel/);
    expect(stack).toMatch(/import LanderModel from "@\/components\/LanderModel"/);
    expect(read("components/MissionScene.jsx")).toMatch(/import SpacecraftStack/);
    // Reentry: the same command module profile and service module
    const reentry = read("components/scenes/ReentryScene.jsx");
    expect(reentry).toMatch(/buildCM/);
    expect(reentry).toMatch(/CsmModel/);
    // Nothing else builds a spacecraft of its own
    const offenders = [];
    const walk = (dir) =>
      fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) return walk(p);
        if (!/\.jsx?$/.test(d.name) || /\.test\./.test(d.name)) return;
        const s = fs.readFileSync(p, "utf8");
        if (/function\s+(Spacecraft|Capsule|Lander|Csm|Lm)[A-Za-z]*Model\b/.test(s)) offenders.push(path.relative(SRC, p));
      });
    walk(path.join(SRC, "components"));
    expect(offenders.sort()).toEqual(["components/LanderModel.jsx", "components/scenes/ReentryScene.jsx", "components/spacecraft/CsmModel.jsx"]);
    // ReentryScene's CapsuleModel is the CM's own profile (buildCM), not a separate shape
    expect(reentry).toMatch(/function CapsuleModel[\s\S]*buildCM\(/);
  });
});
