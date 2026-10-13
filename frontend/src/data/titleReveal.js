/*
 * LUNAVIA — the title, inside the mission (pure, unit-tested).
 *
 * The game's title is presented once per full mission, in lunar orbit, at the
 * moment the mission turns into the player's: after the real undocking and
 * FLIGHT's "we're go for powered descent", while the camera eases in behind
 * the lunar module as it moves away from the CSM (data/orbitSequence, the
 * title shot). Then the descent setup opens over the same, still-moving shot.
 *
 * Times are the mission's orbit clock (seconds since lunar orbit began), so
 * the title is part of the mission's own timeline: SKIP TO DESCENT jumps past
 * it with everything else, a restarted landing (DIFFICULTY again) never
 * replays it, and the Training Center, which never flies the orbit, never
 * shows it.
 */
import { ORBIT_SEQ } from "./orbitSequence";

export const TITLE = {
  reveal: 38.6, // LUNAVIA (after the go for powered descent, ORBIT_SEQ.goPdi)
  credit: 41, // A LAJU PRODUCTIONS GAME
  out: 44.6, // both fade out ...
  gone: 45.8, // ... before the descent setup opens (ORBIT_SEQ.end)
  music: ORBIT_SEQ.goPdi + 0.6, // the music swells under it (padStart ramps in over 6 s)
};

const ease = (x) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * c * (c * (c * 6 - 15) + 10);
};

/** Opacities at orbit time tau: { title, credit, veil } (0..1); veil darkens the left of the frame behind the text. */
export function titleCards(tau) {
  const out = 1 - ease((tau - TITLE.out) / (TITLE.gone - TITLE.out));
  const title = ease((tau - TITLE.reveal) / 2.2) * out;
  const credit = ease((tau - TITLE.credit) / 1.6) * out;
  return { title, credit, veil: Math.max(title, credit) };
}

/** Whether any of the title is on screen at tau. */
export const titleVisible = (tau) => tau > TITLE.reveal && tau < TITLE.gone;
