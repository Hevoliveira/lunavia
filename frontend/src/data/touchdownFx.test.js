import {
  ALT_SCALE,
  DUST,
  LM,
  SURFACE_SCALE,
  WORLD_X,
  groundPlane,
  verticalScale,
  PROBE_ALT,
  PROBE_LENGTH,
  RESULT_DELAY,
  SHOT,
  contactLit,
  dustLevel,
  legContact,
  padHeights,
  plumeCenter,
  probeBend,
  sceneAlt,
  sceneAltRate,
  settleLegs,
  settleStart,
  settleStep,
  touchdownCamera,
  touchdownPlan,
} from "./touchdownFx";
import { CONTACT_ALT, gradeTouchdown, initialState } from "./landerSim";
import { DIFFICULTY } from "./landingPhysics";

const DEG = Math.PI / 180;

describe("vertical scale", () => {
  test("continuous and monotonic, zero on the ground", () => {
    expect(sceneAlt(0)).toBe(0);
    let prev = 0;
    for (let a = 0.01; a < 900; a += 0.37) {
      const y = sceneAlt(a);
      expect(y).toBeGreaterThan(prev);
      expect(y - prev).toBeLessThan(0.2); // no jumps (0.5 unit/m at most)
      prev = y;
    }
  });

  test("near the ground the scene is drawn in true proportion: the LM is 7 m tall and 8.6 m across its footpads", () => {
    expect(sceneAltRate(0)).toBeCloseTo(WORLD_X, 9);
    expect(SURFACE_SCALE).toBe(WORLD_X);
    expect(LM.height / SURFACE_SCALE).toBeCloseTo(7, 6);
    expect((2 * LM.padRadius) / WORLD_X).toBeCloseTo(8.64, 2);
  });

  test("high up it keeps the old 0.05 unit/m scale (the descent still frames as before)", () => {
    expect(sceneAltRate(400)).toBeCloseTo(ALT_SCALE, 6);
    expect(sceneAlt(550) / (ALT_SCALE * 550)).toBeLessThan(1.3);
  });

  test("a site's scale is true up to its highest ground and continuous above it", () => {
    const v = verticalScale(40);
    expect(v.y(-12)).toBeCloseTo(-12 * SURFACE_SCALE, 9);
    expect(v.y(40)).toBeCloseTo(40 * SURFACE_SCALE, 9);
    expect(Math.abs(v.y(40.001) - v.y(40)) / 0.001).toBeCloseTo(SURFACE_SCALE, 2);
    expect(v.rate(500)).toBeLessThan(0.06);
  });
});

describe("contact probes and CONTACT LIGHT", () => {
  test("the probe tips reach the ground exactly when CONTACT LIGHT comes on", () => {
    expect(PROBE_LENGTH).toBeCloseTo(sceneAlt(PROBE_ALT), 9);
    expect(contactLit(PROBE_ALT + 0.01)).toBe(false);
    expect(contactLit(PROBE_ALT)).toBe(true);
    expect(contactLit(0, true)).toBe(true); // stays on after touchdown
  });

  test("it comes on before the simulation captures touchdown, never after", () => {
    expect(PROBE_ALT).toBeGreaterThan(CONTACT_ALT);
    expect(sceneAlt(CONTACT_ALT)).toBeLessThan(PROBE_LENGTH);
  });

  test("a probe folds smoothly from hanging straight to lying flat", () => {
    expect(probeBend(PROBE_LENGTH + 0.1)).toBe(0);
    expect(probeBend(0)).toBeCloseTo(Math.PI / 2, 9);
    let prev = 0;
    for (let h = PROBE_LENGTH; h >= 0; h -= 0.005) {
      const b = probeBend(h);
      expect(b).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = b;
    }
  });

  test("three of the four legs carry probes; the front (ladder) leg does not", () => {
    expect(LM.probes.filter(Boolean)).toHaveLength(3);
    expect(LM.probes[1]).toBe(false);
  });
});

describe("regolith sheet", () => {
  test("none above 30 m or with the engine off", () => {
    expect(dustLevel(DUST.onset + 0.1, 1)).toBe(0);
    expect(dustLevel(2, 0)).toBe(0);
  });

  test("changes continuously with thrust and height (no steps)", () => {
    for (let a = 0; a < 35; a += 0.05) {
      for (let t = 0; t <= 1; t += 0.05) {
        expect(Math.abs(dustLevel(a + 0.05, t) - dustLevel(a, t))).toBeLessThan(0.01);
        expect(Math.abs(dustLevel(a, Math.min(1, t + 0.05)) - dustLevel(a, t))).toBeLessThan(0.12);
      }
    }
  });

  test("more thrust or a lower LM never means less dust", () => {
    for (let a = 0; a < 35; a += 0.5) {
      for (let t = 0.05; t <= 1; t += 0.05) {
        expect(dustLevel(a, t)).toBeGreaterThanOrEqual(dustLevel(a, t - 0.05) - 1e-12);
        expect(dustLevel(a, t)).toBeGreaterThanOrEqual(dustLevel(a + 0.5, t) - 1e-12);
        expect(dustLevel(a, t)).toBeLessThanOrEqual(1);
      }
    }
  });

  test("the landing stays fair: translucent streaks, and the pads' ground is never covered", () => {
    expect(DUST.maxAlpha).toBeLessThanOrEqual(0.45);
    expect(DUST.clearRadius).toBeGreaterThan(LM.padRadius + 0.15);
  });

  test("the plume hits the ground under the nozzle, displaced by the attitude", () => {
    expect(plumeCenter(3, 0.5, 0)).toBe(3);
    expect(plumeCenter(3, 0.5, 10)).toBeLessThan(3); // +tilt points the nozzle to -X
    expect(plumeCenter(3, 0.5, -10)).toBeGreaterThan(3);
  });
});

describe("legs on the ground", () => {
  test("no pad ever goes below the surface; struts never compress past their stroke", () => {
    for (let H = -0.4; H < 1.2; H += 0.02) {
      for (let tilt = -45; tilt <= 45; tilt += 3) {
        const { comp, lift } = legContact(H, tilt);
        const h = padHeights(H + lift, tilt);
        h.forEach((y, i) => {
          expect(y + comp[i]).toBeGreaterThanOrEqual(-1e-9);
          expect(comp[i]).toBeLessThanOrEqual(LM.stroke + 1e-12);
        });
      }
    }
  });

  test("with a bank, the low-side pad touches first", () => {
    const h = padHeights(0.05, 6);
    expect(h[0]).toBeLessThan(h[2]); // +X is the low side for +tilt
    expect(h[1]).toBeCloseTo(h[3], 9);
  });

  test("on uneven ground no pad goes below its own ground either", () => {
    const G = [0.6, -0.2, -0.5, 0.1];
    for (let H = -0.5; H < 1.5; H += 0.02) {
      for (let tilt = -20; tilt <= 20; tilt += 4) {
        const { comp, lift } = legContact(H, tilt, 3, G);
        padHeights(H + lift, tilt, 3, G).forEach((y, i) => expect(y + comp[i]).toBeGreaterThanOrEqual(-1e-9));
      }
    }
  });

  test("an LM resting on a slope takes the slope's attitude; the struts take up what is left", () => {
    // ground rising 0.2 per unit towards +X and 0.1 towards +Z, plus a bump under pad 1
    const R = LM.padRadius;
    const G = [0.2 * R, 0.1 * R + 0.05, -0.2 * R, -0.1 * R];
    const p = groundPlane(G);
    expect(p.tilt).toBeCloseTo(-Math.atan(0.2) / DEG, 6); // +X side higher: banked towards -X
    expect(p.pitch).toBeCloseTo(-Math.atan(0.1 + 0.05 / (2 * R)) / DEG, 6);
    // resting on that plane, every pad is within the residual of its ground
    const h = padHeights(p.mean, p.tilt, p.pitch, G);
    h.forEach((y, i) => expect(Math.abs(y + p.res[i])).toBeLessThan(0.02 * R));
  });
});

describe("settle after touchdown", () => {
  const cfg = DIFFICULTY.ASTRONAUT;
  const run = (state, seconds = 2) => {
    const p = { ...initialState(cfg), xPos: 0, alt: 0.5, ...state };
    const result = gradeTouchdown(p, cfg);
    const plan = touchdownPlan(p, result, cfg);
    const s = settleStart(plan, sceneAlt(CONTACT_ALT));
    const trace = [];
    for (let t = 0; t < seconds; t += 1 / 60) {
      settleStep(s, plan, 1 / 60);
      trace.push({ ...s, legs: settleLegs(s, plan) });
    }
    return { result, plan, s, trace };
  };

  test("a good landing comes to rest level on all four pads within 1.2 s, struts within their stroke", () => {
    const { result, s, trace } = run({ vy: -1.6, vx: 0.4, tilt: 5 });
    expect(result.crashed).toBe(false);
    expect(Math.abs(s.tilt)).toBeLessThan(0.3);
    const after = trace.filter((r) => r.t > 1.2);
    after.forEach((r) => {
      expect(Math.abs(r.tilt)).toBeLessThan(0.6);
      expect(Math.abs(r.v)).toBeLessThan(0.02);
    });
    trace.forEach((r) => r.legs.comp.forEach((c) => expect(c).toBeLessThanOrEqual(LM.stroke + 1e-9)));
  });

  test("the compression is restrained, and a harder landing compresses further", () => {
    const soft = run({ vy: -0.8, vx: 0, tilt: 0 });
    const firm = run({ vy: -2.3, vx: 0, tilt: 0 });
    expect(soft.result.crashed || firm.result.crashed).toBe(false);
    expect(-firm.s.H).toBeGreaterThan(-soft.s.H);
    expect(-firm.s.H).toBeLessThan(LM.stroke);
    const overshoot = Math.min(...firm.trace.map((r) => r.H)) - firm.s.H;
    expect(-overshoot).toBeLessThan(0.06); // at most a small bounce past the rest point
  });

  test("a hard landing bottoms the struts out", () => {
    const { result, plan, s } = run({ vy: -4.2, vx: 0, tilt: 0 });
    expect(result.crashed).toBe(true);
    expect(-s.H).toBeCloseTo(plan.maxComp, 3);
  });

  test("an over-banked landing leans further over (restrained, under 30°)", () => {
    const { result, s } = run({ vy: -1.5, vx: 0, tilt: 15 });
    expect(result.crashed).toBe(true);
    expect(s.tilt).toBeGreaterThan(15);
    expect(s.tilt).toBeLessThan(30);
  });

  test("on a slope a good landing settles onto the slope's attitude (relative tilt 0)", () => {
    const p = { ...initialState(cfg), xPos: 0, alt: 0.5, vy: -1.4, vx: 0, tilt: 0 };
    const result = gradeTouchdown(p, cfg);
    const plane = { tilt: -8, pitch: 3 };
    const plan = touchdownPlan(p, result, cfg, plane);
    expect(plan.tilt0).toBeCloseTo(8, 9); // level LM on ground banked -8°
    const s = settleStart(plan, sceneAlt(CONTACT_ALT));
    for (let t = 0; t < 2; t += 1 / 60) settleStep(s, plan, 1 / 60);
    expect(Math.abs(s.tilt)).toBeLessThan(0.3);
    expect(Math.abs(s.pitch)).toBeLessThan(0.3);
    expect(plane.tilt + s.tilt).toBeCloseTo(-8, 0);
  });

  test("the drawing follows the grade, it never decides it", () => {
    // Same state, same grade, whatever the settle does.
    const st = { vy: -2.0, vx: 0.5, tilt: 4 };
    const a = run(st);
    const b = run(st, 0.1);
    expect(a.result).toEqual(b.result);
  });
});

describe("the shot after touchdown", () => {
  const base = [2, 0.88, 0];
  const dir = [-11, 8, 12];
  const l = Math.hypot(...dir);
  const from = { pos: dir.map((v, i) => base[i] + (v / l) * 14), look: [base[0], 1.8, 0] };
  const frames = [];
  for (let t = 0; t <= 6; t += 1 / 60) frames.push({ t, ...touchdownCamera(t, from, base) });
  const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.hypot(...a) / Math.hypot(...b)))) / DEG;

  test("starts exactly where the chase camera was and ends still", () => {
    expect(frames[0].pos.map((v) => +v.toFixed(9))).toEqual(from.pos.map((v) => +v.toFixed(9)));
    const end = frames.filter((f) => f.t > SHOT.delay + SHOT.glide);
    end.forEach((f) => expect(f.k).toBe(1));
  });

  test("swings round the LM by only a few degrees, gently, and never dips into the ground", () => {
    let maxRate = 0;
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1];
      const b = frames[i];
      const ra = [a.pos[0] - base[0], 0, a.pos[2] - base[2]];
      const rb = [b.pos[0] - base[0], 0, b.pos[2] - base[2]];
      maxRate = Math.max(maxRate, ang(ra, rb) * 60);
      expect(b.pos[1] - base[1]).toBeGreaterThan(0.5);
    }
    expect(Math.abs(SHOT.swing)).toBeLessThanOrEqual(15);
    expect(maxRate).toBeLessThan(10);
  });

  test("the result card waits for the shot after a landing", () => {
    expect(RESULT_DELAY.landed / 1000).toBeGreaterThanOrEqual(SHOT.delay + SHOT.glide + 0.8);
    expect(RESULT_DELAY.crashed).toBeLessThan(RESULT_DELAY.landed);
  });
});

test("probe geometry check: tips meet the ground at 1.7 m for every bank up to the safe limit", () => {
  // The pad plane at PROBE_ALT, level: the probe tips (hanging straight) touch the ground.
  const h = padHeights(sceneAlt(PROBE_ALT), 0);
  h.forEach((y) => expect(y - PROBE_LENGTH).toBeCloseTo(0, 9));
});
