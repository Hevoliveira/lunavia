import fs from "fs";
import path from "path";
import {
  CLOUD_FIELD,
  CONFIRM,
  DROGUE,
  DROGUE_DRIFT_M,
  ENTRY_SIDE,
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
  test("every puff sits in its own cloud, from its flat base to its top: volumes, never cards", () => {
    puffs.forEach((p) => {
      const c = clouds[p.cloud];
      expect(p.y).toBeGreaterThanOrEqual(c.base - 1e-6);
      expect(p.y).toBeLessThanOrEqual(c.top + 1e-6);
      expect(p.sy).toBeGreaterThan(0.3); // an ellipsoid of vapour (r × r·sy × r)
      expect(p.sy).toBeLessThanOrEqual(1);
      expect(p.dens).toBeGreaterThan(0);
    });
    expect(puffs.length).toBeLessThan(1400); // a mobile budget: one instanced draw
    // one condensation level: the whole field's flat bases within 80 m of each other
    const bases = clouds.map((c) => c.base * M_PER_UNIT);
    expect(Math.max(...bases) - Math.min(...bases)).toBeLessThanOrEqual(80);
    // cumulus, not towers of balls: most clouds no taller than they are wide
    const squat = clouds.filter((c) => c.top - c.base <= 2 * c.r).length;
    expect(squat / clouds.length).toBeGreaterThan(0.85);
    // the renderer traces each puff as a volume from a bound drawn by its back faces (camera inside works)
    const cf = read("components/scenes/descent/CloudField.jsx");
    expect(cf).toMatch(/side: THREE\.BackSide/);
    expect(cf).toMatch(/new THREE\.IcosahedronGeometry\(1, 0\)/);
    // the bound must contain the puff: scaled by at least 1 / the icosahedron's inradius
    const edge = 4 / Math.sqrt(10 + 2 * Math.sqrt(5)); // circumradius 1
    const inradius = (Math.sqrt(3) / 12) * (3 + Math.sqrt(5)) * edge;
    expect(+cf.match(/const BOUND_SCALE = ([\d.]+);/)[1]).toBeGreaterThanOrEqual(1 / inradius);
    expect(cf).not.toMatch(/PlaneGeometry/); // no camera-facing quads
    expect(cf).toMatch(/the vapour crossed/);
  });
  test("the capsule's own path down is clear of cloud (it passes between them), and a tower stands in shot", () => {
    // the capsule comes down at the ground position it reaches after the drogues' drift
    const cx = -u(DROGUE_DRIFT_M);
    puffs.forEach((p) => expect(Math.hypot(p.x - cx, p.z) - p.r).toBeGreaterThan(u(40)));
    // the tall placed formation is behind the capsule as the descent camera looks at it
    const cam = chuteCamera(1500, 30).pos;
    const toCapsule = Math.atan2(-cam[2], -cam[0]);
    const tower = PLACED_CLOUDS[0];
    PLACED_CLOUDS.forEach((c, i) => {
      const toCloud = Math.atan2(c.z - cam[2], c.x - cx - cam[0]);
      // the two formations behind the capsule; the two near cumulus either side of the shot
      expect(Math.abs(toCloud - toCapsule)).toBeLessThan(i < 2 ? 0.45 : 0.8);
    });
    // the camera's own column falls between the clouds too
    puffs.forEach((p) => expect(Math.hypot(p.x - (cx + cam[0]), p.z - cam[2]) - p.r).toBeGreaterThan(u(150)));
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
    // they lie down on the sea only as they reach it: never flat discs hanging in the air
    for (let s = 0; s <= 8; s += 0.1) {
      const r = chuteRelease(s);
      if (r.drop < 0.75) expect(r.flat).toBeLessThan(0.05);
    }
    // and go under as one sheet, fading (0 on the surface .. 1 gone), gone within about 11 s
    expect(chuteRelease(4).sink).toBe(0);
    expect(chuteRelease(8).sink).toBeGreaterThan(0.2);
    expect(chuteRelease(11).sink).toBe(1);
    const chutesSrc = read("components/scenes/descent/Chutes.jsx");
    expect(chutesSrc).not.toMatch(/- uSink;/); // the sea never rises through the fabric
    expect(chutesSrc).toMatch(/1\.0 - smoothstep\(0\.15, 0\.85, uSink\)/);
    // blended from the start: no new shader program compiled in the middle of the splashdown
    expect(chutesSrc).toMatch(/transparent: true,\s*forceSinglePass: true,/);
    expect(chutesSrc).not.toMatch(/mat\.needsUpdate = true/);
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
    expect(splash).toMatch(/const on = !!\(sp && sp\.on && sp\.t < 3\.5\);/);
    // no crown sheet, ring or disc: spray streaks and mist; what stays is in the water itself
    expect(splash).not.toMatch(/CylinderGeometry|RingGeometry|CircleGeometry/);
    const ocean = read("components/scenes/descent/Ocean.jsx");
    expect(ocean).toMatch(/No drawn circle, no disc/);
    expect(ocean).toMatch(/uHull/);
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
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  test("one continuous move from the drogues to the water, never below the waves", () => {
    for (let h = 3200; h >= 0; h -= 25) {
      const c = chuteCamera(h, 60, h * 0.01).pos;
      expect(c[1]).toBeGreaterThanOrEqual(seaLevelY(h) + 0.55 - 1e-9); // 2 m over the mean sea at the lowest
    }
    // no jumps: the framing changes smoothly with altitude (less than a unit per 10 m of descent)
    for (let h = 3200; h > 0; h -= 10) {
      const a = chuteCamera(h, 60, 0);
      const b = chuteCamera(h - 10, 60, 0);
      expect(dist(a.pos, b.pos) - 10 / M_PER_UNIT).toBeLessThan(1);
      expect(dist(a.look, b.look)).toBeLessThan(0.5);
    }
    // and from the drogues to the mains, over the mains' inflation
    for (let s = 0; s < 8; s += 0.25) expect(dist(chuteCamera(3000, s).pos, chuteCamera(3000, s + 0.25).pos)).toBeLessThan(1.6);
    expect(dist(chuteCamera(3200, null).pos, chuteCamera(3200, 0).pos)).toBeLessThan(1e-9);
    // and from the entry's side view as the drogues open: eased from rest, no jolt
    expect(dist(chuteCamera(7300, null, 0, 0).pos, ENTRY_SIDE.pos)).toBeLessThan(1e-9);
    for (let s = 0; s < 7; s += 0.25) expect(dist(chuteCamera(7000, null, 0, s).pos, chuteCamera(7000, null, 0, s + 0.25).pos)).toBeLessThan(0.75);
  });
  test("shot A wide on the approach, shot B close at the contact, shot C closer still: the hero shot", () => {
    const a = chuteCamera(600, 60).pos;
    const b = chuteCamera(0, 60).pos;
    const c = recoveryCamera(9).pos;
    const d = (p) => Math.hypot(p[0], p[2]);
    expect(d(a)).toBeGreaterThan(20); // ~95 m off, the canopies and the sea in frame
    expect(d(b)).toBeLessThan(9);
    expect(d(c)).toBeLessThan(d(b));
    expect(d(c)).toBeLessThan(6); // the capsule large in frame (about 20 m away)
    expect(c[1]).toBeLessThan(0.6); // low over the water
    // the splashdown camera continues the descent camera exactly at contact
    expect(dist(chuteCamera(0, 60).pos, recoveryCamera(0).pos)).toBeLessThan(1e-6);
    // smooth: no faster than 2 units (8 m) a second, and no jumps
    for (let s = 0; s < 40; s += 0.25) {
      expect(dist(recoveryCamera(s).pos, recoveryCamera(s + 0.25).pos) / 0.25).toBeLessThan(2);
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
