/*
 * The expedition's hardware, from the pad to splashdown (pure, unit-tested).
 *
 * One ordered list of configurations. Each step names the event that changes
 * the vehicle, the parts it removes or joins, and the shot that shows it
 * happening, so nothing is swapped, added or dropped off screen. The tests
 * hold four rules: no part appears after the pad; every part that leaves is
 * shown leaving, except across the one cut the film makes on purpose (`offScreen`:
 * from TLI cutoff straight to lunar orbit, where only the spent upper stage
 * leaves, and the insertion burn is flown); the command and service module and
 * the lunar module that reach lunar orbit are the ones that stood on the pad;
 * and they leave the outbound assembly only in lunar orbit, after the insertion
 * burn, never near the Earth.
 *
 * `drawnBy` names the component that draws each configuration; all of them are
 * built from the same two models (CsmModel and LanderModel).
 */

/** Every piece of hardware, with the shared model it is drawn from. */
export const PARTS = {
  stage1: { name: "first stage", model: "RocketModel" },
  stage2: { name: "upper stage", model: "RocketModel" },
  carrier: { name: "lunar transfer carrier", model: "CarrierModel" },
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
    parts: ["stage1", "stage2", "carrier", "adapterRing", "adapterPanels", "lm", "sm", "cm", "les"],
    lm: "in the adapter, upright on its mounts, probes folded",
    hga: "folded",
    drawnBy: "RocketModel",
  },
  { id: "stagingFirst", event: "separation", removes: ["stage1"], shot: { launch: "stages" }, drawnBy: "RocketModel" },
  { id: "towerJettison", event: "lesJettison", removes: ["les"], shot: { launch: "usIgnition" }, drawnBy: "RocketModel" },
  { id: "earthOrbit", event: "orbit", shot: { launch: "orbitClose" }, drawnBy: "RocketModel" },
  { id: "tli", event: "tli", shot: { launch: "tli" }, burn: "stage2", drawnBy: "RocketModel" },
  // The cut: the film ends 2 s after TLI cutoff (the last launch shot) and resumes on the
  // arrival in lunar orbit. Behind it, off screen: the spent upper stage separates (the LM
  // stays in the closed adapter, the CSM on top), the three-day coast, the carrier's
  // insertion burn.
  { id: "translunarCut", event: "tliCutoff", removes: ["stage2"], offScreen: "TLI cutoff → lunar orbit", shot: { launch: "departure" }, lm: "in the adapter", drawnBy: "RocketModel" },
  { id: "lunarOrbitInsertion", offScreen: "TLI cutoff → lunar orbit", shot: { orbit: "establish" }, burn: "carrier", drawnBy: "PayloadSection" },
  { id: "lunarArrival", shot: { orbit: "assembly" }, drawnBy: "PayloadSection" },
  // The deployment, in lunar orbit (data/transposition, data/orbitSequence ORBIT_SEQ.deploy).
  { id: "panelsJettison", removes: ["adapterPanels"], shot: { orbit: "deploySep" }, drawnBy: "PayloadSection" },
  { id: "transposition", shot: { orbit: "deployTurn" }, drawnBy: "PayloadSection" },
  { id: "docking", joins: ["lm", "cm"], shot: { orbit: "deployDock" }, drawnBy: "PayloadSection" },
  { id: "extraction", shot: { orbit: "deployExtract" }, hga: "deployed", drawnBy: "PayloadSection" },
  { id: "carrierLeft", removes: ["carrier", "adapterRing"], shot: { orbit: "leave" }, drawnBy: "SpacecraftStack" },
  { id: "probesDeployed", event: "probes", shot: { orbit: "leave" }, lm: "probes deployed", drawnBy: "SpacecraftStack" },
  { id: "undocking", event: "undock", splits: [["cm", "sm"], ["lm"]], shot: { orbit: "undock" }, drawnBy: "SpacecraftStack" },
  // The LM lands and stays on the Moon (its ascent stage's rendezvous with the CSM is not flown);
  // the CSM flies home alone.
  { id: "descent", event: "touchdown", removes: ["lm"], shot: { mission: "descent" }, drawnBy: "LanderModel" },
  // The way home (data/earthReturn): the same CSM, alone. TEI on its service propulsion
  // engine over the Moon, the coast with the engine off, the Earth approach and the turn to
  // the entry attitude; then the service module separates, on screen, in the reentry.
  { id: "tei", event: "teiBurn", burn: "sps", shot: { mission: "tei" }, drawnBy: "SpacecraftStack" },
  { id: "transearthCoast", shot: { mission: "transearthCoast" }, drawnBy: "SpacecraftStack" },
  { id: "earthApproach", shot: { mission: "earthApproach" }, drawnBy: "SpacecraftStack" },
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
