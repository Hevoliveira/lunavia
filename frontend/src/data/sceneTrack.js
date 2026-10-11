/*
 * LUNAVIA — where MissionScene draws the Earth, the Moon and the craft (pure).
 * Shared by the scene and the tests that check what the camera shows.
 */
import { EARTH_RADIUS_KM, MOON_RADIUS_KM, EARTH_MOON_DIST_KM, trajectoryPosition } from "./missionPhases";

export const SCENE_SCALE = 20 / EARTH_MOON_DIST_KM;
// Earth and Moon are drawn 10x oversized so they read at Earth-Moon scale.
export const EARTH_UNITS = EARTH_RADIUS_KM * SCENE_SCALE * 10;
export const MOON_UNITS = MOON_RADIUS_KM * SCENE_SCALE * 10;

const smooth01 = (x) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

// Map physical km distance to display radius: Earth is drawn 10x oversized,
// so the craft must hug the (exaggerated) surface in LEO and still arrive at
// the Moon's orbit ring during approach.
export function displayRadius(rKm) {
  const R1 = EARTH_RADIUS_KM + 185;
  const R2 = 60000;
  const START = EARTH_UNITS + 0.12;
  const SPAN = 2.4;
  const END = 19.4;
  if (rKm <= R2) {
    return START + smooth01((rKm - R1) / (R2 - R1)) * SPAN;
  }
  const u = smooth01((rKm - R2) / (EARTH_MOON_DIST_KM - R2));
  return START + SPAN + u * (END - START - SPAN);
}

/** Moon centre in scene units at mission time t. */
export function moonScenePos(t) {
  const p = trajectoryPosition(t);
  return [p.moonX * SCENE_SCALE, 0, p.moonZ * SCENE_SCALE];
}

/** Craft position in scene units at mission time t (written into out). */
export function craftScenePos(t, out = [0, 0, 0]) {
  const p = trajectoryPosition(t);
  const mx = p.moonX * SCENE_SCALE;
  const mz = p.moonZ * SCENE_SCALE;
  // Lunar vicinity: orbit visibly around the Moon
  if (t >= 270000 && t < 504000) {
    const w = smooth01((t - 270000) / 6000);
    const ox = p.x - p.moonX;
    const oz = p.z - p.moonZ;
    const ol = Math.hypot(ox, oz) || 1;
    const orbR = MOON_UNITS * 1.6;
    const lx = mx + (ox / ol) * orbR;
    const lz = mz + (oz / ol) * orbR;
    const dir = Math.atan2(p.z, p.x);
    const r = displayRadius(Math.hypot(p.x, p.z));
    out[0] = (1 - w) * Math.cos(dir) * r + w * lx;
    out[1] = 0;
    out[2] = (1 - w) * Math.sin(dir) * r + w * lz;
    return out;
  }
  const dir = Math.atan2(p.z, p.x);
  const r = displayRadius(Math.hypot(p.x, p.z));
  out[0] = Math.cos(dir) * r;
  out[1] = 0;
  out[2] = Math.sin(dir) * r;
  return out;
}
