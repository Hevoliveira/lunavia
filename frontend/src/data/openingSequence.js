/*
 * LUNAVIA — the main-menu opening (pure, unit-tested).
 *
 * About 52 seconds in lunar orbit, built from the mission's own pieces: the
 * same Moon and Sun as the mission's lunar orbit (data/lunarOrbitShot), the
 * same spacecraft (data/csmDesign, the approved lunar module) and the same
 * undocking (data/undocking). Shots are in the vehicle frame of
 * data/orbitSequence (metres; X along the flight path, Y the local vertical,
 * Z = X × Y; the docked stack along +X, lunar module leading, hatch side +Z).
 *
 *  0–4.5  THE MOON          the whole Moon in deep space, the spacecraft a glint on its orbit
 *  4.5–10.5 LUNAR ORBIT     over the horizon, the spacecraft approaches
 *  10.5–17.5 THE SPACECRAFT tracking along it: service module, command module, docking, lunar module
 *  17.5–24 PREPARATION      close on the docking tunnel
 *  24–34  UNDOCKING         latches release at 25 s; the CSM backs away; the LM rolls
 *  34–41  TWO SPACECRAFT    the CSM stays in orbit, the LM moves on
 *  41–52  TITLE             the camera stays with the LM: LUNAVIA, A LAJU PRODUCTIONS GAME, the tagline
 *
 * It changes nothing in the game: no mission state, no records, no descent.
 */

const lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
const ease = (x) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * c * (c * (c * 6 - 15) + 10);
};
const clamp01 = (x) => Math.min(1, Math.max(0, x));

export const OPENING = {
  length: 52,
  undock: 25, // latches release (data/undocking t = 0)
  title: 41.5, // LUNAVIA
  credit: 44, // A LAJU PRODUCTIONS GAME
  tagline: 46.2, // MASTER THE DESCENT. EXPLORE THE MOON. RETURN TO EARTH.
  fadeOut: 50.4, // to black, then the menu
  orbitTau: 10, // the craft's place on the mission's lunar orbit (real orbital rate from there)
};

// The docked lunar module's centre along the stack (+X, metres), as in MissionScene.
const LM_X = 7.0;

export const OPENING_SHOTS = [
  { id: "moon", start: 0, len: 4.5, wide: true },
  {
    id: "approach",
    start: 4.5,
    len: 6,
    // From far ahead, the spacecraft comes towards the camera over the lunar horizon.
    cam: (u) => ({ pos: lerp([230, 26, 90], [26, 5.5, 20], ease(u)), look: lerp([2, -14, 0], [1.2, -2.4, 0], ease(u)) }),
  },
  {
    id: "reveal",
    start: 10.5,
    len: 7,
    // Along the stack from the engine end to the lunar module.
    cam: (u) => ({ pos: lerp([-13, 5.5, 17], [10, 4.2, 15.5], ease(u)), look: lerp([-3.5, -1.6, 0], [5.5, -1.3, 0], ease(u)) }),
  },
  {
    id: "interface",
    start: 17.5,
    len: 6.5,
    cam: (u) => ({ pos: lerp([0.4, 4.4, 10.8], [1.6, 3.7, 8.8], ease(u)), look: [3.2, -0.7, 0] }),
  },
  {
    id: "undock",
    start: 24,
    len: 10,
    cam: (u) => ({ pos: lerp([-1.5, 7, 19.5], [1, 7.4, 22.5], ease(u)), look: lerp([2.8, -1.9, 0], [4.4, -1.9, 0], ease(u)) }),
  },
  {
    id: "pair",
    start: 34,
    len: 7.5,
    cam: (u) => ({ pos: lerp([-11, 11.5, 34], [-8, 12, 38], ease(u)), look: lerp([4, -4, 0], [6.5, -4, 0], ease(u)) }),
  },
  {
    id: "title",
    start: 41.5,
    len: 10.5,
    follow: "lm",
    // Behind and above the lunar module, easing back as it moves on, the CSM receding beyond
    // it; the LM held in the right third, the title on the left.
    cam: (u) => ({ pos: lerp([-8, 4.5, 12], [-12, 6.5, 17], ease(u)), look: lerp([-2.6, -1.8, -3.4], [-2.2, -2.6, -4.2], ease(u)) }),
  },
];

/** The shot at opening time t, with its progress u (0..1). */
export function openingShotAt(t) {
  let s = OPENING_SHOTS[0];
  for (const x of OPENING_SHOTS) if (t >= x.start) s = x;
  return { shot: s, u: clamp01((t - s.start) / s.len) };
}

/** Undocking choreography time for opening time t (negative = docked). */
export const openingUndockTime = (t) => t - OPENING.undock;

/** Vehicle-frame camera at t, given the lunar module's displacement lmY (data/undocking). */
export function openingCamera(t, lmY = 0) {
  const { shot, u } = openingShotAt(t);
  if (shot.wide) return { wide: true, shot: shot.id };
  const c = shot.cam(u);
  if (shot.follow !== "lm") return { ...c, shot: shot.id };
  const x = LM_X + lmY;
  return { pos: [c.pos[0] + x, c.pos[1], c.pos[2]], look: [c.look[0] + x, c.look[1], c.look[2]], shot: shot.id };
}

/** Title card opacities at t: { title, credit, tagline: [3], black } (0..1). */
export function titleCards(t) {
  const fade = (t0, len = 1.6) => ease((t - t0) / len);
  const out = 1 - ease((t - OPENING.fadeOut + 0.4) / 1.2);
  return {
    title: fade(OPENING.title, 2.2) * out,
    credit: fade(OPENING.credit, 1.6) * out,
    tagline: [0, 1, 2].map((i) => fade(OPENING.tagline + i * 0.9, 1.2) * out),
    black: Math.max(1 - ease(t / 1.6), ease((t - OPENING.fadeOut) / (OPENING.length - OPENING.fadeOut))),
  };
}

/** Sound cues: [{ t, cue, ... }], fired once each as the opening passes them. */
export const OPENING_SOUND = [
  { t: 0.2, cue: "pad" },
  { t: OPENING.undock, cue: "clank", vol: 0.35 },
  { t: OPENING.undock + 0.08, cue: "hiss", dur: 1.4, vol: 0.18 },
  { t: OPENING.undock + 4.5, cue: "hiss", dur: 0.5, vol: 0.1 },
  { t: 36, cue: "say", id: "orbit.goPdi" },
  { t: OPENING.undock + 13, cue: "hiss", dur: 2.6, vol: 0.16 },
  { t: OPENING.fadeOut - 1, cue: "padStop" },
];

/* ---- the title loop behind the main menu ------------------------------------------------- */
/*
 * Lightweight and distinct from the opening: the command and service module
 * alone in lunar orbit (the lunar module has gone down to land), the camera
 * drifting slowly round it.
 */
export function loopCamera(t) {
  const a = -0.55 + 0.35 * Math.sin(t * 0.045);
  const r = 24 + 2 * Math.sin(t * 0.07);
  // The CSM sits in the right half, clear of the menu's title on the left.
  return { pos: [-2.4 + Math.sin(a) * r, 5 + Math.sin(t * 0.05) * 1.2, Math.cos(a) * r], look: [-7.5, -2.6, -4] };
}
