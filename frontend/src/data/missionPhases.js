// Local canonical phases (fallback + trajectory helpers)
// Actual data is loaded from backend GET /api/mission/phases

export const EARTH_RADIUS_KM = 6371;
export const MOON_RADIUS_KM = 1737;
export const EARTH_MOON_DIST_KM = 384400;

// Return the spacecraft position (in km, Earth-centered 2D XZ plane)
// for a given mission_time_s using patched-conic simplification.
// - Phase 1-3: at Earth (small offset)
// - Phase 4-5: transfer ellipse (Hohmann-like)
// - Phase 6-7: at Moon
// - Phase 8-9: return ellipse
export function trajectoryPosition(t) {
  // t in seconds. Reference timeline based on backend phases.
  const TLI_start = 9840;
  const TLI_end = 273360;      // LOI capture
  const LO_start = 288000;     // Lunar orbit begin
  const TEI_start = 504000;    // Trans-Earth injection
  const REENTRY = 702000;      // Reentry

  // Moon orbits Earth; we assume Moon revolution period 27.3 days
  const moonAngle = (t / (27.3 * 86400)) * Math.PI * 2;
  const moonX = Math.cos(moonAngle) * EARTH_MOON_DIST_KM;
  const moonZ = Math.sin(moonAngle) * EARTH_MOON_DIST_KM;

  if (t < TLI_start) {
    // LEO parking: small circle 185 km alt
    const p = (t / TLI_start) * Math.PI * 2 * 3;
    const r = EARTH_RADIUS_KM + 185;
    return { x: Math.cos(p) * r, y: 0, z: Math.sin(p) * r, moonX, moonZ };
  }

  if (t < TLI_end) {
    // Transfer ellipse from LEO to Moon distance
    const u = (t - TLI_start) / (TLI_end - TLI_start); // 0..1
    // parametric position on translating great arc from Earth to Moon(t=TLI_end)
    // Approximate as an ellipse in the Earth-Moon plane where the Moon has moved.
    const targetAngle = ((TLI_end / (27.3 * 86400)) * Math.PI * 2);
    // Start point: on LEO in the launch direction (angle 0)
    const startR = EARTH_RADIUS_KM + 185;
    const endR = EARTH_MOON_DIST_KM;
    // r(u): elliptical growth (ease-in-out)
    const eased = 0.5 - Math.cos(Math.PI * u) / 2;
    const r = startR + (endR - startR) * eased;
    const ang = targetAngle * u;
    return {
      x: Math.cos(ang) * r,
      y: 0,
      z: Math.sin(ang) * r,
      moonX,
      moonZ,
    };
  }

  if (t < TEI_start) {
    // Lunar orbit around the moving Moon
    const localT = (t - LO_start);
    const period = 118 * 60; // 118 min
    const p = (localT / period) * Math.PI * 2;
    const r = MOON_RADIUS_KM + 100;
    return {
      x: moonX + Math.cos(p) * r,
      y: 0,
      z: moonZ + Math.sin(p) * r,
      moonX,
      moonZ,
    };
  }

  if (t < REENTRY) {
    // Return ellipse from Moon back to Earth
    const u = (t - TEI_start) / (REENTRY - TEI_start);
    const startR = EARTH_MOON_DIST_KM;
    const endR = EARTH_RADIUS_KM + 122;
    const eased = 0.5 - Math.cos(Math.PI * u) / 2;
    const r = startR - (startR - endR) * eased;
    const startAngle = ((TEI_start / (27.3 * 86400)) * Math.PI * 2);
    const endAngle = startAngle - Math.PI * 0.75; // return arc
    const ang = startAngle + (endAngle - startAngle) * u;
    return {
      x: Math.cos(ang) * r,
      y: 0,
      z: Math.sin(ang) * r,
      moonX,
      moonZ,
    };
  }

  // After reentry — parked on Earth
  return { x: EARTH_RADIUS_KM + 10, y: 0, z: 0, moonX, moonZ };
}

// Given phase code, return the mission_time_s to jump to.
export function phaseStartTime(phase) {
  return phase.t_plus_seconds;
}

// Format seconds → T+HH:MM:SS
export function formatMET(seconds) {
  const sign = seconds < 0 ? "T-" : "T+";
  const s = Math.abs(Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${sign}${String(h).padStart(3, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
