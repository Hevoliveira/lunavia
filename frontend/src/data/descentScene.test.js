import fs from "fs";
import path from "path";
import {
  CLOUD_FIELD,
  CONFIRM,
  DROGUE,
  DROGUE_DRIFT_M,
  FLOAT,
  MAIN,
  M_PER_UNIT,
  PLACED_CLOUDS,
  SIGNIFICANT_HEIGHT_M,
  SPLASH,
  WAVES,
  chuteCamera,
  chuteRelease,
  cloudField,
  curvatureDrop,
  horizonDistance,
  lowWorldFade,
  mainCanopyCentres,
  recoveryCamera,
  seaLevelY,
  seaSurface,
  splashBob,
  u,
} from "./descentScene";
import { CM_R } from "./csmDesign";
import { CHUTES } from "./reentryPhysics";

const SRC = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

describe("one scale for the capsule, the sea, the clouds and the parachutes", () => {
  test("1 unit is the capsule's diameter (3.9 m), as the reentry scene draws it", () => {
    expect(M_PER_UNIT).toBeCloseTo(2 * CM_R, 9);
    expect(read("components/scenes/ReentryScene.jsx")).toMatch(/const CAPSULE_SCALE = 1 \/ \(2 \* CM_R\);/);
    // the old low world at 25 m per unit (the capsule 6.4x too big for its sea) is gone
    expect(read("components/scenes/ReentryScene.jsx")).not.toMatch(/LOW_SCALE/);
  });
  test("the sea lies at the true depth below the capsule, curving away with the Earth", () => {
    expect(seaLevelY(0)).toBeCloseTo(0, 12);
    expect(seaLevelY(3900)).toBeCloseTo(-1000, 9);
    // horizon from 1 km: about 113 km
    expect(horizonDistance(1000) * M_PER_UNIT).toBeGreaterThan(110e3);
    expect(horizonDistance(1000) * M_PER_UNIT).toBeLessThan(116e3);
    // 100 km away the surface has dropped about 785 m
    expect(curvatureDrop(u(100e3)) * M_PER_UNIT).toBeCloseTo(785, -1);
    // the low world is drawn below 26 km, fully below 15 km, and not at all in space
    expect(lowWorldFade(40e3)).toBe(0);
    expect(lowWorldFade(14e3)).toBe(1);
  });
});

describe("the sea: a recovery sea state at its real size", () => {
  test("waves about a metre high, swell under 100 m long, gentle slopes (the capsule is not a toy)", () => {
    expect(SIGNIFICANT_HEIGHT_M).toBeGreaterThan(0.8);
    expect(SIGNIFICANT_HEIGHT_M).toBeLessThan(1.6);
    WAVES.forEach((w) => {
      expect(w.len).toBeLessThan(110);
      expect(w.amp).toBeLessThan(0.5);
    });
    let maxSlope = 0;
    let maxH = 0;
    for (let x = 0; x < 200; x += 3.7)
      for (let t = 0; t < 30; t += 1.3) {
        const s = seaSurface(x, x * 0.37, t);
        maxSlope = Math.max(maxSlope, Math.hypot(s.dx, s.dz));
        maxH = Math.max(maxH, Math.abs(s.h));
      }
    expect(maxSlope).toBeLessThan(0.16); // under 9°
    expect(maxH).toBeLessThan(1.0);
  });
  test("the slope the floating capsule follows is the derivative of the drawn surface", () => {
    const e = 1e-4;
    [[3, 7, 2], [41, -12, 9.5], [-80, 33, 17]].forEach(([x, z, t]) => {
      const s = seaSurface(x, z, t);
      expect((seaSurface(x + e, z, t).h - seaSurface(x - e, z, t).h) / (2 * e)).toBeCloseTo(s.dx, 6);
      expect((seaSurface(x, z + e, t).h - seaSurface(x, z - e, t).h) / (2 * e)).toBeCloseTo(s.dz, 6);
    });
    // the ocean shader and the capsule read the same waves
    expect(read("components/scenes/descent/Ocean.jsx")).toMatch(/import \{[^}]*WAVES[^}]*\} from "@\/data\/descentScene"/);
  });
});

describe("the clouds: a coherent field of cumulus", () => {
  const { clouds, puffs } = cloudField();
  test("fair-weather cumulus at plausible heights, of varied size, never a uniform blanket", () => {
    expect(clouds.length).toBe(CLOUD_FIELD.count);
    clouds.forEach((c) => {
      expect(c.base * M_PER_UNIT).toBeGreaterThanOrEqual(650 - 1e-6);
      expect(c.base * M_PER_UNIT).toBeLessThanOrEqual(1000);
      expect(c.top * M_PER_UNIT).toBeLessThanOrEqual(2700);
      expect(c.top).toBeGreaterThan(c.base);
      expect(Math.hypot(c.x, c.z)).toBeLessThanOrEqual(CLOUD_FIELD.radius + 1e-6);
    });
    const r = clouds.map((c) => c.r * M_PER_UNIT).sort((a, b) => a - b);
    expect(r[r.length - 1] / r[0]).toBeGreaterThan(2); // varied sizes
    // coverage: the formations cover well under half of the field (scattered, with sea between)
    const covered = clouds.reduce((a, c) => a + Math.PI * c.r * c.r, 0) / (Math.PI * CLOUD_FIELD.radius ** 2);
    expect(covered).toBeLessThan(0.35);
    expect(covered).toBeGreaterThan(0.02);
  });
  test("every puff sits in its own cloud, from its flat base to its top", () => {
    puffs.forEach((p) => {
      const c = clouds[p.cloud];
      expect(p.y - p.r * 0.42).toBeGreaterThanOrEqual(c.base - 1e-6);
      expect(p.y).toBeLessThanOrEqual(c.top + 1e-6);
    });
    expect(puffs.length).toBeLessThan(1400); // a mobile budget: one instanced draw
  });
  test("the capsule's own path down is clear of cloud (it passes between them), and a tower stands in shot", () => {
    // the capsule comes down at the ground position it reaches after the drogues' drift
    const cx = -u(DROGUE_DRIFT_M);
    puffs.forEach((p) => expect(Math.hypot(p.x - cx, p.z) - p.r).toBeGreaterThan(u(40)));
    // the tall placed formation is behind the capsule as the descent camera looks at it
    const cam = chuteCamera(1500, true).pos;
    const toCapsule = Math.atan2(-cam[2], -cam[0]);
    const tower = PLACED_CLOUDS[0];
    PLACED_CLOUDS.forEach((c) => {
      const toCloud = Math.atan2(c.z - cam[2], c.x - cx - cam[0]);
      expect(Math.abs(toCloud - toCapsule)).toBeLessThan(0.45); // in shot, behind the capsule
    });
    expect(tower.topM).toBeGreaterThan(2000); // the capsule passes it on the way down under the mains
  });
});

describe("the parachutes", () => {
  test("Apollo's sizes: 25.4 m mains on lines about twice that long, above the capsule; 5 m drogues", () => {
    expect(MAIN.radius * 2 * M_PER_UNIT).toBeCloseTo(25.4, 1);
    expect(DROGUE.radius * 2 * M_PER_UNIT).toBeCloseTo(5, 1);
    expect(MAIN.lineLen * M_PER_UNIT).toBeGreaterThan(35);
    mainCanopyCentres(1).forEach((c) => {
      expect(c[1]).toBeGreaterThan(MAIN.lineLen * 0.9); // well above the riser
      expect(Math.hypot(c[0], c[2])).toBeGreaterThan(MAIN.radius * 0.9); // three canopies side by side
    });
  });
  test("they open when the simulation opens them (no timing of their own), and are released at splashdown", () => {
    const chutes = read("components/scenes/descent/Chutes.jsx");
    expect(chutes).toMatch(/CHUTES\[which\]\.inflateTime/);
    expect(chutes).toMatch(/const t0 = which === "main" \? s\.mainT : s\.drogueT;/);
    expect(CHUTES.main.maxAlt).toBe(3200); // unchanged
    expect(chuteRelease(0).drop).toBe(0);
    expect(chuteRelease(6).drop).toBe(1);
    expect(chuteRelease(8).flat).toBe(1);
  });
});

describe("splashdown and flotation", () => {
  test("the capsule plunges past its floating depth, comes back and settles (no hovering, no sinking)", () => {
    expect(splashBob(0)).toBe(0);
    expect(splashBob(SPLASH.dipT)).toBeCloseTo(-SPLASH.dip, 9);
    for (let t = 6; t < 20; t += 0.5) expect(Math.abs(splashBob(t))).toBeLessThan(0.02);
    let mn = 0;
    for (let t = 0; t < 10; t += 0.01) mn = Math.min(mn, splashBob(t));
    expect(mn).toBeGreaterThanOrEqual(-SPLASH.dip - 1e-9);
    expect(SPLASH.dip * M_PER_UNIT).toBeLessThan(1.5);
  });
  test("it floats apex up, the heat shield and the lower cone in the water, the hatch above it", () => {
    const draft = (FLOAT.waterlineY - FLOAT.shieldBottomY) * M_PER_UNIT;
    expect(draft).toBeGreaterThan(0.8);
    expect(draft).toBeLessThan(1.6);
    expect(FLOAT.waterlineY).toBeGreaterThan(0.04); // the rim is under water
    expect(FLOAT.waterlineY).toBeLessThan(0.77 * 0.5); // most of the cone above it
    const scene = read("components/scenes/ReentryScene.jsx");
    expect(scene).toMatch(/const floatY = atmo\.seaY \+ wave\.h \/ M_PER_UNIT - FLOAT\.waterlineY;/);
  });
  test("the splash starts at the heat shield's first point in the water, and only at contact", () => {
    const scene = read("components/scenes/ReentryScene.jsx");
    expect(scene).toMatch(/if \(splashed && !\(v\.splash && v\.splash\.on\)\) v\.splash = \{ on: true, x: lx, y: atmo\.seaY, z: lz, t: 0 \};/);
    const game = read("components/ReentryGame.jsx");
    expect(game).toMatch(/if \(s\.outcome === OUTCOME\.SPLASHDOWN\) \{\s+v\.phase = "SPLASHED";/);
    const splash = read("components/scenes/descent/Splash.jsx");
    expect(splash).toMatch(/const on = !!\(sp && sp\.on && sp\.t < 3\);/);
  });
  test("SPLASHDOWN CONFIRMED, then CREW SAFE, only once the simulation reports the splashdown; then MISSION COMPLETE", () => {
    expect(CONFIRM.splashdown).toBeGreaterThan(0);
    expect(CONFIRM.crewSafe).toBeGreaterThan(CONFIRM.splashdown);
    expect(CONFIRM.done).toBeGreaterThan(CONFIRM.crewSafe + 2);
    const game = read("components/ReentryGame.jsx");
    expect(game).toMatch(/u && phase === "SPLASHED" && u\.splashT >= CONFIRM\.splashdown/);
    expect(game).toMatch(/SPLASHDOWN CONFIRMED/);
    expect(game).toMatch(/u\.splashT >= CONFIRM\.crewSafe/);
    expect(game).toMatch(/if \(v\.phaseT > CONFIRM\.done && !doneRef\.current\)/);
    // Houston's "Splashdown... welcome home" waits for the confirmed splashdown
    expect(read("audio/reentryComms.js")).toMatch(/if \(u\.phase === "SPLASHED" && once\("splash"\)\)/);
    expect(read("pages/Mission.jsx")).toMatch(/LUNAVIA —<\/div>\s+<h2[^>]*>\s+MISSION COMPLETE/);
  });
});

describe("the cameras", () => {
  test("under the parachutes the camera stays above the sea all the way down, and the recovery shot starts near the sea", () => {
    for (let h = 3200; h >= 0; h -= 25) {
      const c = chuteCamera(h, true, h * 0.01).pos;
      expect(c[1]).toBeGreaterThanOrEqual(seaLevelY(h) + 1.5 - 1e-9);
    }
    const r0 = recoveryCamera(0);
    expect(r0.pos[1]).toBeLessThan(3);
    // slow: it moves less than a unit per second
    for (let s = 0; s < 30; s += 0.5) {
      const a = recoveryCamera(s).pos;
      const b = recoveryCamera(s + 0.5).pos;
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 0.5).toBeLessThan(1);
    }
  });
});

describe("presentation only", () => {
  test("the descent never steps or changes the reentry simulation", () => {
    ["components/scenes/descent/Ocean.jsx", "components/scenes/descent/CloudField.jsx", "components/scenes/descent/Chutes.jsx", "components/scenes/descent/Splash.jsx", "components/scenes/ReentryScene.jsx"].forEach((f) => {
      const src = read(f);
      expect(src).not.toMatch(/\b(advance|step)\(s[,)]/);
      expect(src).not.toMatch(/s\.(h|v|t|mainT|drogueT|outcome)\s*=[^=]/);
    });
  });
  test("every asset is offline: procedural textures and the bundled NASA map only", () => {
    ["components/scenes/descent/Ocean.jsx", "components/scenes/descent/CloudField.jsx", "components/scenes/descent/Chutes.jsx", "components/scenes/descent/Splash.jsx"].forEach((f) => {
      expect(read(f)).not.toMatch(/https?:\/\//);
    });
    expect(read("components/scenes/descent/Ocean.jsx")).toMatch(/planetTexture\("earthAux"\)/);
  });
});
