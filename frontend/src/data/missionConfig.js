/*
 * LUNAVIA — what a flight is: an OFFICIAL MISSION or a TRAINING EXERCISE
 * (pure, unit-tested).
 *
 * Both fly the same lunar landing (DescentGame over a site from
 * data/landingSites, the same physics and grading). What differs is the
 * journey and the player experience:
 *   official mission  the whole expedition: destination and pilot difficulty
 *                     chosen before launch, Earth launch, TLI, the cut to lunar
 *                     orbit, deployment, undocking, the title screen, START
 *                     MISSIONS, the descent at the chosen destination, results,
 *                     return and Earth reentry;
 *   training          straight to the problem (Flight Training Center): lunar
 *                     landing practice at the Sea of Tranquility only, Earth
 *                     reentry practice.
 *
 * The environment sets the challenge of a destination (terrain, hazards,
 * landing zones, communications). The pilot difficulty (CADET / ASTRONAUT /
 * COMMANDER, data/landingPhysics DIFFICULTY) sets the spacecraft's entry
 * state, fuel and touchdown limits, and is the same at every destination:
 * nothing here changes gravity, thrust, fuel use, RCS authority or limits.
 */
import { DIFFICULTY } from "./landingPhysics";
import { SITE_DEFS, SITE_IDS, getSite } from "./landingSites";

export const MODE = { OFFICIAL: "official", TRAINING: "training" };
export const PILOT_DIFFICULTIES = Object.keys(DIFFICULTY); // CADET, ASTRONAUT, COMMANDER

/** The four official lunar missions, in order of environmental challenge. */
export const OFFICIAL_MISSIONS = [
  {
    number: "01",
    siteId: "tranquillitatis",
    environment: "INTRODUCTORY",
    summary: "A wide lunar plain: open terrain and relatively forgiving landing conditions.",
    features: ["Wide lunar plain", "Open terrain", "Relatively forgiving landing conditions"],
    challenge: "Controlled descent and an accurate touchdown",
  },
  {
    number: "02",
    siteId: "hadley",
    environment: "INTERMEDIATE",
    summary: "A mountainous lunar valley: elevated terrain and a more constrained approach.",
    features: ["Mountainous lunar valley", "Elevated terrain", "More constrained approach"],
    challenge: "Terrain awareness and lateral control",
  },
  {
    number: "03",
    siteId: "tycho",
    environment: "ADVANCED",
    summary: "Crater-rich highlands: hazardous rocky terrain and smaller safe landing areas.",
    features: ["Crater-rich highlands", "Hazardous rocky terrain", "Smaller safe landing areas"],
    challenge: "Precision and diversion maneuvers",
  },
  {
    number: "04",
    siteId: "far-side",
    environment: "EXPERT",
    summary: "The far side: rugged terrain, difficult landing-zone selection, no direct Earth communications.",
    features: ["Far-side lunar destination", "Rugged terrain", "Difficult landing-zone selection", "No direct Earth communications"],
    challenge: "Choosing a safe landing zone with onboard guidance only",
  },
];
export const OFFICIAL_MISSION_IDS = OFFICIAL_MISSIONS.map((m) => m.siteId);

/** Lunar landing training: the Sea of Tranquility only (the other destinations are official missions). */
export const TRAINING_LANDING_SITES = ["tranquillitatis"];
export const TRAINING_LANDING_SITE = TRAINING_LANDING_SITES[0];

/** The selection a fresh device starts with. */
export const DEFAULT_SELECTION = { siteId: "tranquillitatis", difficulty: "ASTRONAUT" };

export const officialMission = (siteId) => OFFICIAL_MISSIONS.find((m) => m.siteId === siteId) || null;

/** A valid selection { siteId, difficulty } from anything (unknown values fall back to the defaults). */
export function normalizeSelection(sel) {
  const s = sel && typeof sel === "object" ? sel : {};
  return {
    siteId: OFFICIAL_MISSION_IDS.includes(s.siteId) ? s.siteId : DEFAULT_SELECTION.siteId,
    difficulty: PILOT_DIFFICULTIES.includes(s.difficulty) ? s.difficulty : DEFAULT_SELECTION.difficulty,
  };
}

/** Selenographic latitude and longitude (degrees, + north / east) from a site's "26.13°N 3.63°E". */
export function parseCoords(coords) {
  const m = /([\d.]+)°\s*([NS])\s+([\d.]+)°\s*([EW])/.exec(coords || "");
  if (!m) return null;
  return { lat: +m[1] * (m[2] === "S" ? -1 : 1), lon: +m[3] * (m[4] === "W" ? -1 : 1) };
}

/**
 * The ground under the lunar-orbit shots (deployment, undocking, the title):
 * a near-side destination itself, under the orbit and the site marker. The far
 * side cannot be seen from the Earth, and Houston's arrival and go for powered
 * descent need a line of sight: the orbit is shown over the near side, on the
 * ground track 120° east of the site (towards the western limb, where the
 * spacecraft go out of contact), with no site marker. Loss of signal is then
 * flown before the descent (FarSideIntro).
 */
export function orbitViewFor(def) {
  const c = parseCoords(def.coords);
  if (def.earthLink === false) return { lat: c.lat, lon: c.lon - 240, marker: false, nearSide: false };
  return { lat: c.lat, lon: c.lon, marker: true, nearSide: true };
}

/**
 * Everything a flight needs to know about where and how it flies. One object,
 * built once per flight and read by the mission page, the scenes and the
 * descent; frozen so nothing changes it on the way.
 */
export function createMissionConfig({ mode = MODE.OFFICIAL, siteId, difficulty } = {}) {
  if (mode !== MODE.OFFICIAL && mode !== MODE.TRAINING) throw new Error(`unknown mode ${mode}`);
  const allowed = mode === MODE.OFFICIAL ? OFFICIAL_MISSION_IDS : TRAINING_LANDING_SITES;
  if (!allowed.includes(siteId)) throw new Error(`${siteId} is not a ${mode} lunar destination`);
  if (!PILOT_DIFFICULTIES.includes(difficulty)) throw new Error(`unknown pilot difficulty ${difficulty}`);
  const def = SITE_DEFS.find((s) => s.id === siteId);
  const site = getSite(siteId);
  const official = officialMission(siteId);
  return Object.freeze({
    mode,
    siteId,
    difficulty,
    number: mode === MODE.OFFICIAL ? official.number : null,
    name: site.name,
    environment: mode === MODE.OFFICIAL ? official.environment : "TRAINING",
    // terrain, landing zones and hazards are the site's own (data/landingSites), by id
    terrain: siteId,
    zones: site.zones.map((z) => ({ x: z.x, r: z.r, label: z.label, primary: !!z.primary })),
    comms: Object.freeze({ earthLink: def.earthLink !== false, farSide: def.earthLink === false }),
    seed: def.seed,
    coords: parseCoords(def.coords),
    orbitView: orbitViewFor(def),
    briefing: def.briefing,
    base: siteId === "tranquillitatis" ? "TRANQUILITY BASE" : `${site.short} · SURFACE`,
  });
}

export const _test = { SITE_IDS };
