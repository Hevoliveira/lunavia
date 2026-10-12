/*
 * The expedition's hardware, from the pad to splashdown (pure, unit-tested).
 *
 * One ordered list of configurations. Each step names the event that changes
 * the vehicle, the parts it removes or joins, and the shot that shows it
 * happening, so nothing is swapped, added or dropped off screen. The tests
 * hold three rules: no part appears after the pad; every part that leaves is
 * shown leaving; the command and service module and the lunar module that reach
 * lunar orbit are the ones that stood on the pad.
 *
 * `drawnBy` names the component that draws each configuration; all of them are
 * built from the same two models (CsmModel and LanderModel).
 */

/** Every piece of hardware, with the shared model it is drawn from. */
export const PARTS = {
  stage1: { name: "first stage", model: "RocketModel" },
  stage2: { name: "upper stage", model: "RocketModel" },
  les: { name: "escape tower and boost cover", model: "RocketModel" },
  adapterPanels: { name: "adapter panels", model: "PayloadSection" },
  adapterRing: { name: "adapter ring and LM mounts", model: "PayloadSection" },
  cm: { name: "command module", model: "CsmModel" },
  sm: { name: "service module", model: "CsmModel" },
  lm: { name: "lunar module", model: "LanderModel" },
};

/**
 * The configurations in mission order. `shot` is where the change is seen:
 * a launch-cinematic shot (data/launchTimeline SHOTS), a lunar-orbit shot
 * (data/orbitSequence ORBIT_SHOTS) or a mission stage.
 */
export const LINEAGE = [
  {
    id: "pad",
    shot: { launch: "payload" },
    parts: ["stage1", "stage2", "adapterRing", "adapterPanels", "lm", "sm", "cm", "les"],
    lm: "in the adapter, upright on its mounts, probes folded",
    hga: "folded",
    drawnBy: "RocketModel",
  },
  { id: "stagingFirst", event: "separation", removes: ["stage1"], shot: { launch: "stages" }, drawnBy: "RocketModel" },
  { id: "towerJettison", event: "lesJettison", removes: ["les"], shot: { launch: "usIgnition" }, drawnBy: "RocketModel" },
  { id: "earthOrbit", event: "orbit", shot: { launch: "orbitClose" }, drawnBy: "RocketModel" },
  { id: "tli", event: "tli", shot: { launch: "tli" }, burn: "stage2", drawnBy: "RocketModel" },
  { id: "panelsJettison", event: "tdSep", removes: ["adapterPanels"], shot: { launch: "tdSep" }, drawnBy: "RocketModel" },
  { id: "transposition", event: "tdTurn", shot: { launch: "tdTurn" }, drawnBy: "RocketModel" },
  { id: "docking", event: "hardDock", joins: ["lm", "cm"], shot: { launch: "tdDock" }, drawnBy: "RocketModel" },
  {
    id: "extraction",
    event: "tdExtract",
    removes: ["stage2", "adapterRing"],
    shot: { launch: "tdExtract" },
    hga: "deployed",
    drawnBy: "RocketModel",
  },
  { id: "translunarCoast", event: "farewell", shot: { launch: "farewell", mission: "cruiseClose" }, drawnBy: "SpacecraftStack" },
  { id: "lunarArrival", shot: { mission: "approachClose", orbit: "stack" }, drawnBy: "SpacecraftStack" },
  { id: "probesDeployed", event: "probes", shot: { orbit: "stack" }, lm: "probes deployed", drawnBy: "SpacecraftStack" },
  { id: "undocking", event: "undock", splits: [["cm", "sm"], ["lm"]], shot: { orbit: "undock" }, drawnBy: "SpacecraftStack" },
  // The LM lands and stays on the Moon (its ascent stage's rendezvous with the CSM is not flown);
  // the CSM flies home alone.
  { id: "descent", event: "touchdown", removes: ["lm"], shot: { mission: "descent" }, drawnBy: "LanderModel" },
  { id: "return", shot: { mission: "returnClose" }, drawnBy: "SpacecraftStack" },
  { id: "smJettison", event: "separation", removes: ["sm"], shot: { mission: "reentry" }, drawnBy: "ReentryScene" },
];

/** The expedition's hardware still flying after a step. */
export function partsAfter(stepId) {
  let set = [];
  for (const s of LINEAGE) {
    if (s.parts) set = [...s.parts];
    if (s.removes) set = set.filter((p) => !s.removes.includes(p));
    if (s.id === stepId) return set;
  }
  return null;
}
