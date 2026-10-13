/*
 * LUNAVIA — the title loop behind the main menu (pure, unit-tested).
 *
 * Lightweight and static in spirit: the command and service module alone in
 * lunar orbit (the lunar module has gone down to land), on the mission's own
 * orbit and lighting (data/lunarOrbitShot), the camera drifting slowly round
 * it. Nothing plays by itself on the home screen: the game's title is
 * presented inside the mission (data/titleReveal).
 *
 * Cameras are in the vehicle frame of data/orbitSequence (metres; X along the
 * flight path, Y the local vertical, Z = X × Y).
 */
import { ORBIT_SEQ } from "./orbitSequence";

/** Where on the mission's lunar orbit the loop flies (orbit clock, s): past the arrival, at the real orbital rate. */
export const LOOP_TAU = ORBIT_SEQ.cut + 5.5;

export function loopCamera(t) {
  const a = -0.55 + 0.35 * Math.sin(t * 0.045);
  const r = 24 + 2 * Math.sin(t * 0.07);
  // The CSM sits in the right half, clear of the menu's title on the left.
  return { pos: [-2.4 + Math.sin(a) * r, 5 + Math.sin(t * 0.05) * 1.2, Math.cos(a) * r], look: [-7.5, -2.6, -4] };
}
