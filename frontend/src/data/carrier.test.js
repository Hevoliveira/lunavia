import { ASSEMBLY, ASSEMBLY_MASS, CARRIER, LOI_DV, MIDCOURSE_DV, STAGE_FORWARD, STAGE_SEP, burnLevel, deltaVCapacity, loiBurnSeconds, propellantVolume, stageGap, stageSepRcs, tankVolume } from "./carrier";
import { ADAPTER, LM_HEIGHTS, LM_MOUNT, UPPER_STAGE } from "./payloadDesign";

describe("LUNAVIA's lunar transfer carrier", () => {
  test("it is the top of LV-001's upper-stage cylinder: same diameter, so the launch vehicle's outline is unchanged", () => {
    expect(CARRIER.R).toBeCloseTo(UPPER_STAGE.R, 9);
    expect(CARRIER.R).toBeCloseTo(ADAPTER.R0, 9);
    expect(CARRIER.deckY).toBe(0); // the deck is where the upper stage's bulkhead was: the LM does not move
    expect(LM_HEIGHTS.pads).toBeCloseTo(LM_MOUNT.h, 9);
    expect(CARRIER.H).toBeGreaterThan(1);
    expect(CARRIER.H).toBeLessThan(1.6);
    // LV-001's black band under the adapter keeps its 0.06 model units (1.08 m); the carrier's skin below it is white
    expect(CARRIER.bandH).toBeCloseTo(0.06 * 18, 9);
    expect(CARRIER.bandH).toBeLessThan(CARRIER.H);
  });

  test("the tank fits inside it; the main engine hangs on the axis from its thrust cone, inside the upper stage's forward skirt", () => {
    const { tank, engine, thrustCone } = CARRIER;
    expect(tank.R + tank.r).toBeLessThan(CARRIER.R - 0.3);
    expect(tank.y + tank.r).toBeLessThan(CARRIER.deckY);
    expect(tank.y - tank.r).toBeGreaterThan(-CARRIER.H);
    // the thrust cone runs from the aft bulkhead to the gimbal, inside the tank's ring
    expect(thrustCone.topY).toBeCloseTo(-CARRIER.H, 9);
    expect(thrustCone.topR).toBeLessThan(tank.R - tank.r - 0.2);
    expect(engine.gimbalY).toBeCloseTo(thrustCone.bottomY, 9);
    // a real bell: throat to exit, area ratio ~29, wider than the chamber
    expect(engine.exitY).toBeLessThan(engine.throatY - 1.5);
    expect((engine.exitR / engine.throatR) ** 2).toBeGreaterThan(15);
    expect(engine.exitR).toBeLessThan(CARRIER.R - 0.5);
    // At launch the bell reaches below the separation plane into the upper stage's forward skirt,
    // above its forward dome (a spherical cap from the apex on the axis to the rim).
    const cap = STAGE_FORWARD.apexY - STAGE_FORWARD.rimY;
    const rho = (STAGE_FORWARD.R * STAGE_FORWARD.R + cap * cap) / (2 * cap);
    const domeY = (r) => STAGE_FORWARD.apexY - (rho - Math.sqrt(rho * rho - r * r));
    for (const r of [0, engine.exitR / 2, engine.exitR]) expect(engine.exitY - domeY(r)).toBeGreaterThan(0.2);
  });

  test("mass and propulsion: enough Δv for lunar orbit insertion and midcourse corrections, in a tank that holds the propellant", () => {
    expect(ASSEMBLY_MASS).toBeGreaterThan(60);
    expect(ASSEMBLY_MASS).toBeLessThan(75);
    expect(deltaVCapacity()).toBeGreaterThan(LOI_DV + MIDCOURSE_DV);
    expect(tankVolume()).toBeGreaterThan(propellantVolume() * 1.05); // with ullage
    // An eight-minute class burn on the main engine (Apollo's first LOI burn: about six minutes)
    expect(loiBurnSeconds()).toBeGreaterThan(300);
    expect(loiBurnSeconds()).toBeLessThan(700);
    // The assembly: about 24 m from the main engine's exit to the CSM's probe, centre of mass inside the adapter
    expect(ASSEMBLY.nose - ASSEMBLY.aft).toBeGreaterThan(22);
    expect(ASSEMBLY.nose - ASSEMBLY.aft).toBeLessThan(26);
    expect(ASSEMBLY.com).toBeGreaterThan(0);
    expect(ASSEMBLY.com).toBeLessThan(ADAPTER.H);
  });

  test("after TLI the upper stage separates gently, then falls behind; the carrier's RCS fires only while the push builds", () => {
    expect(stageGap(0)).toBe(0);
    expect(stageGap(STAGE_SEP.t0)).toBe(0);
    let prev = 0;
    for (let t = 0; t < 14; t += 0.05) {
      const g = stageGap(t);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
    // a few metres by the end of the separation shot, the carrier's nozzles fully clear of the stage
    expect(stageGap(STAGE_SEP.coastFrom)).toBeGreaterThan(-CARRIER.engine.exitY + STAGE_FORWARD.apexY + 2.5);
    expect(stageGap(STAGE_SEP.coastFrom + 5)).toBeGreaterThan(80);
    expect(stageSepRcs(STAGE_SEP.t0 - 0.1)).toBe(0);
    expect(stageSepRcs(STAGE_SEP.t0 + STAGE_SEP.ramp / 2)).toBe(1);
    expect(stageSepRcs(STAGE_SEP.t0 + STAGE_SEP.ramp + 0.1)).toBe(0);
  });

  test("engine burns start and stop softly", () => {
    expect(burnLevel(0, 1, 5)).toBe(0);
    expect(burnLevel(3, 1, 5)).toBe(1);
    expect(burnLevel(6, 1, 5)).toBe(0);
    expect(burnLevel(1.1, 1, 5)).toBeGreaterThan(0);
    expect(burnLevel(1.1, 1, 5)).toBeLessThan(0.5);
  });
});
