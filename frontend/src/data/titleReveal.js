/*
 * LUNAVIA — the title, inside the mission (pure, unit-tested).
 *
 * The game's title is presented once per full mission, in lunar orbit, at the
 * moment the mission turns into the player's: after the deployment, the real
 * undocking and CAPCOM's "we're go for powered descent", while the camera
 * eases in behind the lunar module as it moves away from the CSM
 * (data/orbitSequence, the title shot). LUNAVIA, then A LAJU PRODUCTIONS
 * GAME, then START MISSIONS: the title screen stays up, with no timer, until
 * the player presses it once; that opens the descent setup.
 *
 * Times are the mission's orbit clock (seconds since lunar orbit began), so
 * the title is part of the mission's own timeline: SKIP jumps to the title
 * screen (never past it), a restarted landing (DIFFICULTY again) never
 * replays it, and the Training Center, which never flies the orbit, never
 * shows it.
 */
import { ORBIT_SEQ } from "./orbitSequence";

export const TITLE = {
  reveal: ORBIT_SEQ.goPdi + 3.8, // LUNAVIA, once CAPCOM's go for powered descent has been heard
  credit: ORBIT_SEQ.goPdi + 6.2, // A LAJU PRODUCTIONS GAME
  button: ORBIT_SEQ.titleScreen, // START MISSIONS: the title screen, held until pressed
  music: ORBIT_SEQ.goPdi + 0.6, // the music swells under it (padStart ramps in over 6 s)
};

/** Button labels by subtitle language (audio settings subLang). */
export const START_LABEL = { en: "START MISSIONS", pt: "INICIAR MISSÕES" };
export const startLabel = (lang) => START_LABEL[lang] || START_LABEL.en;

const ease = (x) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * c * (c * (c * 6 - 15) + 10);
};

/**
 * Opacities at orbit time tau: { title, credit, button, veil } (0..1); veil
 * darkens the left of the frame behind the text. Once up they stay up.
 */
export function titleCards(tau) {
  const title = ease((tau - TITLE.reveal) / 2.2);
  const credit = ease((tau - TITLE.credit) / 1.6);
  const button = ease((tau - TITLE.button) / 0.8);
  return { title, credit, button, veil: Math.max(title, credit) };
}

/** Whether any of the title is on screen at tau. */
export const titleVisible = (tau) => tau > TITLE.reveal;
