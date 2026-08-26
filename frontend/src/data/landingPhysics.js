export const MOON_G = 1.62; // m/s^2

export const DIFFICULTY = {
  CADET: {
    key: "CADET",
    label: "CADET",
    desc: "Assistência de estabilidade · combustível generoso · janela larga de pouso",
    initialAlt: 500,
    initialVy: -14,
    initialVx: 6,
    initialFuel: 220,
    fuelRate: 4,
    maxThrust: 5.5,
    tiltRate: 22,
    tiltAssist: true,
    safeVy: 4.5,
    safeVx: 4,
    safeTilt: 22,
  },
  ASTRONAUT: {
    key: "ASTRONAUT",
    label: "ASTRONAUT",
    desc: "Física intermediária · combustível limitado · janela menor",
    initialAlt: 800,
    initialVy: -22,
    initialVx: 10,
    initialFuel: 150,
    fuelRate: 6,
    maxThrust: 4.8,
    tiltRate: 30,
    tiltAssist: false,
    safeVy: 2.5,
    safeVx: 2,
    safeTilt: 12,
  },
  COMMANDER: {
    key: "COMMANDER",
    label: "COMMANDER",
    desc: "Assistência mínima · combustível apertado · precisão real",
    initialAlt: 1000,
    initialVy: -28,
    initialVx: 14,
    initialFuel: 110,
    fuelRate: 7.5,
    maxThrust: 4.2,
    tiltRate: 38,
    tiltAssist: false,
    safeVy: 1.5,
    safeVx: 1,
    safeTilt: 8,
  },
};

export const HAZARDS = [
  { x: -55, r: 10, kind: "crater", label: "CRATER · ROUGH" },
  { x: -20, r: 6, kind: "boulders", label: "BOULDERS" },
  { x: 25, r: 8, kind: "crater", label: "CRATER" },
  { x: 60, r: 12, kind: "boulders", label: "ROUGH TERRAIN" },
];

export const SAFE_ZONES = [
  { x: 0, r: 6, primary: true, label: "PRIMARY LZ" },
  { x: -38, r: 5, label: "ALT LZ WEST" },
  { x: 42, r: 4, label: "ALT LZ EAST" },
  { x: 75, r: 6, label: "ALT LZ FAR EAST" },
];

export const PRIMARY_LZ = SAFE_ZONES.find((z) => z.primary);

/** Returns { safeZone, hazard } for touchdown at x. */
export function evaluateGround(x) {
  for (const h of HAZARDS) {
    if (Math.abs(x - h.x) < h.r) {
      return { hazard: h, safeZone: null };
    }
  }
  for (const z of SAFE_ZONES) {
    if (Math.abs(x - z.x) < z.r) {
      return { hazard: null, safeZone: z };
    }
  }
  return { hazard: null, safeZone: null };
}

/** Distance band label for a given metric distance (m). */
export function accuracyLabel(distance) {
  if (distance < 3) return "EXCELLENT";
  if (distance < 10) return "GOOD";
  if (distance < 20) return "ACCEPTABLE";
  if (distance < 40) return "POOR";
  return "MISS";
}

/**
 * Grade a touchdown-frame state.
 *
 * Single source of truth. Score never uses hidden constants — the
 * displayed component chips always sum to the displayed total.
 *
 * Score (max 100):
 *   35  Vertical speed        35 * max(0, 1 - (|vy|/safeVy)^2)
 *   15  Horizontal speed      15 * max(0, 1 - (|vx|/safeVx)^2)
 *   25  Landing accuracy      25 * max(0, 1 - dist/60)
 *   15  Attitude / tilt       15 * max(0, 1 - (|tilt|/safeTilt)^2)
 *   10  Fuel remaining        10 * fuel/initialFuel
 *
 * Fatal (crashed) if ANY of:
 *   - |vy| > safeVy
 *   - |vx| > safeVx
 *   - |tilt| > safeTilt
 *   - hazard at touchdown x
 *   - fuel depleted before touchdown (fuelDepletedInFlight === true)
 *
 * Crash and score are decoupled: fatal outcomes still show the earned
 * performance score plus an explicit FATAL LANDING flag.
 */
export function gradeLanding(input) {
  const {
    vy, vx, tilt, fuel, initialFuel, xPos,
    safeZone, hazard,
    safeVy, safeVx, safeTilt,
    fuelDepletedInFlight = false,
  } = input;

  const absVy = Math.abs(vy);
  const absVx = Math.abs(vx);
  const absTilt = Math.abs(tilt);
  const touchdownSpeed = Math.sqrt(vy * vy + vx * vx);
  const fuelPct = Math.max(0, Math.min(100, Math.round((fuel / initialFuel) * 100)));

  const distance = Math.abs(xPos - PRIMARY_LZ.x);
  const label = accuracyLabel(distance);

  // Progressive component curves — over-limit yields exactly 0 pts.
  const vyRatio = absVy / safeVy;
  const vxRatio = absVx / safeVx;
  const tiltRatio = absTilt / safeTilt;
  const vyScoreRaw   = vyRatio   >= 1 ? 0 : 35 * Math.max(0, 1 - vyRatio * vyRatio);
  const vxScoreRaw   = vxRatio   >= 1 ? 0 : 15 * Math.max(0, 1 - vxRatio * vxRatio);
  const tiltScoreRaw = tiltRatio >= 1 ? 0 : 15 * Math.max(0, 1 - tiltRatio * tiltRatio);
  const accScoreRaw  = 25 * Math.max(0, 1 - distance / 60);
  const fuelScoreRaw = 10 * Math.max(0, Math.min(1, fuel / initialFuel));

  // Round for display. The rounded chips are the truth: the total is their sum
  // so the arithmetic on screen is always self-consistent.
  const vyScore   = Math.round(vyScoreRaw);
  const vxScore   = Math.round(vxScoreRaw);
  const tiltScore = Math.round(tiltScoreRaw);
  const accScore  = Math.round(accScoreRaw);
  const fuelScore = Math.round(fuelScoreRaw);
  const score = vyScore + vxScore + accScore + tiltScore + fuelScore;

  const failureReasons = [];
  if (fuelDepletedInFlight) failureReasons.push("FUEL DEPLETED BEFORE TOUCHDOWN");
  if (absVy > safeVy) failureReasons.push("VERTICAL SPEED EXCEEDED SAFE LIMIT");
  if (absVx > safeVx) failureReasons.push("EXCESSIVE HORIZONTAL SPEED");
  if (absTilt > safeTilt) failureReasons.push("TILT EXCEEDED SAFE LIMIT");
  if (hazard) failureReasons.push("UNSAFE TERRAIN");
  const crashed = failureReasons.length > 0;

  // Crash flag does NOT modify the performance score.  The grade collapses to
  // F on crew loss, but the numeric total is unchanged.  UI shows the earned
  // performance score AND a "FATAL LANDING — MISSION FAILED" banner.
  const grade = crashed ? "F"
    : score >= 92 ? "S"
    : score >= 82 ? "A"
    : score >= 70 ? "B"
    : score >= 55 ? "C" : "D";

  return {
    crashed,
    grade,
    score,
    touchdownSpeed,
    fuelPct,
    breakdown: {
      vy: { value: absVy, limit: safeVy, score: vyScore, max: 35, safe: absVy <= safeVy },
      vx: { value: absVx, limit: safeVx, score: vxScore, max: 15, safe: absVx <= safeVx },
      accuracy: { distance, score: accScore, max: 25, label },
      tilt: { value: absTilt, limit: safeTilt, score: tiltScore, max: 15, safe: absTilt <= safeTilt },
      fuel: { pct: fuelPct, score: fuelScore, max: 10 },
    },
    failureReasons,
    zone: safeZone ? (safeZone.label || (safeZone.primary ? "PRIMARY LZ" : "SAFE ZONE")) : (hazard ? hazard.label : "UNMAPPED TERRAIN"),
    crewSafety: crashed ? "LOST" : "NOMINAL",
  };
}
