import fs from "fs";
import path from "path";
import { LINEAGE, PARTS, partsAfter } from "./lineage";
import { EVENTS, SHOTS } from "./launchTimeline";
import { ORBIT_SHOTS } from "./orbitSequence";

const SRC = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const MISSION_SHOTS = ["tei", "transearthCoast", "earthApproach", "descent", "reentry"];

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
    expect(partsAfter("carrierLeft").sort()).toEqual(["cm", "lm", "sm"]);
    // they cross to the Moon integrated: carrier, adapter (panels closed, the LM inside), CSM
    const outbound = ["adapterPanels", "adapterRing", "carrier", "cm", "lm", "sm"];
    expect(partsAfter("translunarCut").sort()).toEqual(outbound);
    expect(partsAfter("lunarOrbitInsertion").sort()).toEqual(outbound);
    expect(partsAfter("lunarArrival").sort()).toEqual(outbound);
  });

  test("no deployment near the Earth: the LM and the CSM leave the outbound assembly only in lunar orbit, after the insertion burn", () => {
    const idx = (id) => LINEAGE.findIndex((s) => s.id === id);
    const loi = idx("lunarOrbitInsertion");
    expect(LINEAGE[loi].burn).toBe("carrier");
    // Every step shown in the launch cinematic keeps the LM inside the closed adapter
    LINEAGE.filter((s) => s.shot.launch).forEach((s) => {
      expect(partsAfter(s.id)).toEqual(expect.arrayContaining(["lm", "adapterPanels", "adapterRing", "cm", "sm"]));
      expect(s.joins).toBeUndefined();
    });
    // The panels open, the CSM docks with the LM and the carrier is left behind only after
    // the insertion burn, each in a lunar-orbit shot
    ["panelsJettison", "transposition", "docking", "extraction", "carrierLeft"].forEach((id) => {
      expect(idx(id)).toBeGreaterThan(loi);
      expect(LINEAGE[idx(id)].shot.orbit).toBeTruthy();
      expect(LINEAGE[idx(id)].shot.launch).toBeUndefined();
    });
    // Near the Earth only the spent stages and the escape tower go
    const earthSide = LINEAGE.slice(0, idx("translunarCut") + 1).flatMap((s) => s.removes || []);
    expect(earthSide.sort()).toEqual(["les", "stage1", "stage2"]);
  });

  test("the upper stage, the carrier, the adapter and the escape tower leave, and each is shown leaving", () => {
    const removedAt = {};
    LINEAGE.forEach((s) => (s.removes || []).forEach((p) => (removedAt[p] = s)));
    expect(Object.keys(removedAt).sort()).toEqual(["adapterPanels", "adapterRing", "carrier", "les", "lm", "sm", "stage1", "stage2"]);
    Object.values(removedAt).forEach((s) => expect(s.shot).toBeTruthy());
    // the spent upper stage across the one deliberate cut (TLI cutoff → lunar orbit); everything else on screen
    expect(removedAt.stage2.id).toBe("translunarCut");
    expect(removedAt.stage2.offScreen).toBeTruthy();
    expect(LINEAGE.filter((s) => s.offScreen).map((s) => s.id)).toEqual(["translunarCut", "lunarOrbitInsertion"]);
    Object.values(removedAt).filter((s) => s !== removedAt.stage2).forEach((s) => expect(s.offScreen).toBeUndefined());
    expect(removedAt.carrier.id).toBe("carrierLeft");
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
    // The launch ends on the departure after TLI (the cut); lunar orbit opens on the arrival,
    // then the deployment in order, then the undocking
    const at = (id) => launchShots.indexOf(id);
    expect(at("tli")).toBeLessThan(at("departure"));
    expect(launchShots[launchShots.length - 1]).toBe("departure");
    const o = (id) => orbitShots.indexOf(id);
    expect(orbitShots[0]).toBe("establish");
    ["establish", "assembly", "deploySep", "deployTurn", "deployDock", "deployExtract", "leave", "undock"].forEach((id, i, a) => {
      if (i) expect(o(a[i - 1])).toBeLessThan(o(id));
    });
  });

  test("no substitute models: every scene draws the spacecraft from the same two models", () => {
    // The removed placeholders stay removed
    ["components/SpacecraftModel.jsx", "components/EarthMoonHero.jsx"].forEach((f) => expect(fs.existsSync(path.join(SRC, f))).toBe(false));
    // The rocket carries the CSM and the LM through its payload section, on the carrier
    const rocket = read("components/RocketModel.jsx");
    expect(rocket).toMatch(/import PayloadSection from "@\/components\/spacecraft\/PayloadSection"/);
    const payload = read("components/spacecraft/PayloadSection.jsx");
    expect(payload).toMatch(/import CsmModel/);
    expect(payload).toMatch(/import LanderModel from "@\/components\/LanderModel"/);
    expect(payload).toMatch(/import CarrierModel from "@\/components\/spacecraft\/CarrierModel"/);
    // The same payload section flies the coast and the deployment in lunar orbit
    expect(read("components/MissionScene.jsx")).toMatch(/import PayloadSection from "@\/components\/spacecraft\/PayloadSection"/);
    // The stack flown to the Moon and back
    const stack = read("components/spacecraft/SpacecraftStack.jsx");
    expect(stack).toMatch(/import CsmModel/);
    expect(stack).toMatch(/import LanderModel(, \{ plumeMaterial \})? from "@\/components\/LanderModel"/);
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
