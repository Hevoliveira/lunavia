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
 * All values come from the LM's captured touchdown frame — no post-hoc
 * animation influence. The final grade & fatal flag are the source of
 * truth for the rest of the mission (mission cannot proceed on fatal).
 *
 * Score (max 100):
 *   40  Vertical speed        40 * max(0, 1 - |vy|/safeVy)^1.5
 *   30  Landing accuracy      30 * max(0, 1 - dist / 60)
 *   20  Attitude / tilt       20 * max(0, 1 - |tilt|/safeTilt)^1.2
 *   10  Fuel remaining        10 * fuel/initialFuel
 *
 * Fatal (crashed) if ANY of:
 *   - |vy| > safeVy
 *   - |vx| > safeVx
 *   - |tilt| > safeTilt
 *   - hazard at touchdown x
 *   - fuel depleted before touchdown (fuelDepletedInFlight === true)
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

  // Distance from PRIMARY LZ center (mission designated target)
  const distance = Math.abs(xPos - PRIMARY_LZ.x);
  const label = accuracyLabel(distance);

  // Component scores (derived directly from simulation values)
  const vyScore = 40 * Math.pow(Math.max(0, 1 - absVy / safeVy), 1.5);
  const accScore = 30 * Math.max(0, 1 - distance / 60);
  const tiltScore = 20 * Math.pow(Math.max(0, 1 - absTilt / safeTilt), 1.2);
  const fuelScore = 10 * Math.max(0, Math.min(1, fuel / initialFuel));

  // Failure detection — every reason listed for the result screen
  const failureReasons = [];
  if (fuelDepletedInFlight) failureReasons.push("FUEL DEPLETED BEFORE TOUCHDOWN");
  if (absVy > safeVy) failureReasons.push("VERTICAL SPEED EXCEEDED SAFE LIMIT");
  if (absVx > safeVx) failureReasons.push("EXCESSIVE HORIZONTAL SPEED");
  if (absTilt > safeTilt) failureReasons.push("TILT EXCEEDED SAFE LIMIT");
  if (hazard) failureReasons.push("UNSAFE TERRAIN");

  const crashed = failureReasons.length > 0;

  // If crashed, we still compute the raw component scores so the player
  // can see how close each metric was, but the total is capped severely.
  const rawTotal = vyScore + accScore + tiltScore + fuelScore;
  const total = crashed ? Math.min(rawTotal, 25) : rawTotal;
  const score = Math.round(total);

  const grade = crashed ? "F"
    : total >= 92 ? "S"
    : total >= 82 ? "A"
    : total >= 70 ? "B"
    : total >= 55 ? "C" : "D";

  return {
    crashed,
    grade,
    score,
    touchdownSpeed,
    fuelPct,
    // Detailed per-component breakdown for the result screen
    breakdown: {
      vy: { value: absVy, limit: safeVy, score: Math.round(vyScore), max: 40, safe: absVy <= safeVy },
      vx: { value: absVx, limit: safeVx, safe: absVx <= safeVx },
      tilt: { value: absTilt, limit: safeTilt, score: Math.round(tiltScore), max: 20, safe: absTilt <= safeTilt },
      accuracy: { distance, score: Math.round(accScore), max: 30, label },
      fuel: { pct: fuelPct, score: Math.round(fuelScore), max: 10 },
    },
    failureReasons,
    zone: safeZone ? (safeZone.label || (safeZone.primary ? "PRIMARY LZ" : "SAFE ZONE")) : (hazard ? hazard.label : "UNMAPPED TERRAIN"),
    crewSafety: crashed ? "LOST" : "NOMINAL",
  };
}
