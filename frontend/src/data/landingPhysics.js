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
    fuelRate: 4,     // kg/s at full throttle
    maxThrust: 5.5, // m/s^2 at full throttle
    tiltRate: 22,   // deg/s
    tiltAssist: true, // auto-levels when no input
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

// Landing site is at horizontalPos = 0.
// Hazards & safe zones spread across ±80m.
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

/** Returns { landed, safeZone, hazard } for x on the surface. */
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

/**
 * Grade a landing outcome given the final state and difficulty.
 * Returns { grade, score, accuracy, touchdownSpeed, fuelRemaining, tilt, crewSafety }.
 */
export function gradeLanding({
  vy, vx, tilt, fuel, initialFuel, xPos, safeZone, hazard, crashed,
}) {
  const touchdownSpeed = Math.sqrt(vy * vy + vx * vx);
  const fuelPct = Math.round((fuel / initialFuel) * 100);
  const tiltAbs = Math.abs(tilt);

  if (crashed) {
    return {
      grade: "D",
      score: 0,
      accuracy: 0,
      touchdownSpeed,
      fuelRemaining: fuelPct,
      tilt: tiltAbs,
      crewSafety: "LOST",
      crashed: true,
    };
  }

  // Landing accuracy: distance from a safe-zone center → 100%
  let accuracy = 0;
  if (safeZone) {
    const dist = Math.abs(xPos - safeZone.x);
    accuracy = Math.max(0, 100 - (dist / safeZone.r) * 40);
    if (safeZone.primary) accuracy += 5;
  } else if (hazard) {
    accuracy = 40;
  } else {
    accuracy = 65;
  }
  accuracy = Math.min(100, Math.round(accuracy));

  const speedScore = Math.max(0, 100 - touchdownSpeed * 25);
  const fuelScore = Math.min(100, fuelPct * 2);
  const tiltScore = Math.max(0, 100 - tiltAbs * 4);

  const total =
    accuracy * 0.35 +
    speedScore * 0.3 +
    fuelScore * 0.2 +
    tiltScore * 0.15;

  const grade =
    total >= 92 ? "S" :
    total >= 82 ? "A" :
    total >= 70 ? "B" :
    total >= 55 ? "C" : "D";

  return {
    grade,
    score: Math.round(total),
    accuracy,
    touchdownSpeed,
    fuelRemaining: fuelPct,
    tilt: tiltAbs,
    crewSafety: "NOMINAL",
    crashed: false,
  };
}
