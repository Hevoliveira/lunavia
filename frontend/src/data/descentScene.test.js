import fs from "fs";
import path from "path";
import {
  CONFIRM,
  DROGUE,
  DROGUE_DRIFT_M,
  ENTRY_SIDE,
  FLOAT,
  MAIN,
  M_PER_UNIT,
  SIGNIFICANT_HEIGHT_M,
  SPLASH,
  WAVES,
  chuteCamera,
  chuteRelease,
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
import { COLUMN, CUMULUS, cloudNoise3D, coverFraction, cumulusCells, weatherMap } from "./cumulusField";
import { BAND_A, BAND_B, MSS_TOTAL, MSS_UNRESOLVED, WIND, meanSquareSlope, oceanBand } from "./oceanSpectrum";
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

describe("the clouds: scattered fair-weather cumulus, traced through a weather map", () => {
  const cells = cumulusCells();
  test("one flat base, tops of varied height, mostly small clouds and a few large ones", () => {
    expect(cells.length).toBeGreaterThan(500);
    cells.forEach((c) => {
      expect(c.top).toBeGreaterThanOrEqual(CUMULUS.topMinM - 1e-6);
      expect(c.top).toBeLessThanOrEqual(CUMULUS.topMaxM + 1e-6);
      expect(c.r).toBeGreaterThanOrEqual(CUMULUS.rMinM);
      expect(c.r).toBeLessThanOrEqual(CUMULUS.rMaxM);
    });
    const r = cells.map((c) => c.r).sort((a, b) => a - b);
    expect(r[Math.floor(r.length * 0.9)] / r[Math.floor(r.length * 0.1)]).toBeGreaterThan(2);
    expect(r[Math.floor(r.length / 2)]).toBeLessThan((CUMULUS.rMinM + CUMULUS.rMaxM) / 2); // heavy-tailed
    // cumulus, not towers: no cloud more than about twice as tall as its radius
    cells.forEach((c) => expect(c.top - CUMULUS.baseM).toBeLessThanOrEqual(Math.max(CUMULUS.topMinM - CUMULUS.baseM, 1.85 * c.r) + 1e-6));
  });
  test("separate clouds with clear air between them, and none near the splashdown", () => {
    // every pair of neighbours at least the gap apart, edge to edge (a sweep along x)
    const byX = [...cells].sort((p, q) => p.x - q.x);
    const reach = 2 * CUMULUS.rMaxM + CUMULUS.gapM;
    let least = Infinity;
    for (let i = 0; i < byX.length; i++)
      for (let j = i + 1; j < byX.length && byX[j].x - byX[i].x < reach; j++) {
        const d = Math.hypot(byX[i].x - byX[j].x, byX[i].z - byX[j].z);
        least = Math.min(least, d - byX[i].r - byX[j].r);
      }
    expect(least).toBeGreaterThanOrEqual(CUMULUS.gapM - 1e-6);
    // the last of the descent and the recovery are in clear air: the nearest cloud's edge kilometres off
    cells.forEach((c) => expect(Math.hypot(c.x - COLUMN.x, c.z - COLUMN.z) - c.r).toBeGreaterThanOrEqual(CUMULUS.clearM - 1e-6));
  });
  test("about a fifth of the sky covered: never a blanket, never empty", () => {
    const N = 256;
    const map = weatherMap(cells, N);
    const near = coverFraction(map, N, 30000);
    const all = coverFraction(map, N, 75000);
    expect(near).toBeGreaterThan(0.08);
    expect(near).toBeLessThan(0.32);
    expect(all).toBeGreaterThan(0.12);
    expect(all).toBeLessThan(0.3);
    // within the clear zone: no cover at all
    expect(coverFraction(map, N, CUMULUS.clearM * 0.9)).toBe(0);
  });
  test("the 3D noise wraps on every axis (no seam where it repeats)", () => {
    const N = 32;
    const n = cloudNoise3D(N);
    const at = (x, y, z, ch) => n[((z * N + y) * N + x) * 4 + ch];
    [0, 1].forEach((ch) => {
      let inner = 0;
      let wrap = 0;
      let k = 0;
      for (let z = 0; z < N; z += 3)
        for (let y = 0; y < N; y += 3) {
          inner += Math.abs(at(N / 2, y, z, ch) - at(N / 2 - 1, y, z, ch));
          wrap += Math.abs(at(0, y, z, ch) - at(N - 1, y, z, ch));
          k++;
        }
      expect(wrap / k).toBeLessThan((inner / k) * 2 + 4);
    });
  });
  test("one ray-marched pass at reduced resolution: no puffs, no cards, no per-cloud geometry", () => {
    const src = read("components/scenes/descent/CumulusLayer.jsx");
    expect(src).toMatch(/export const CLOUD_RESOLUTION = 0\.34;/);
    expect(src).toMatch(/sampler3D uNoise/);
    expect(src).not.toMatch(/InstancedMesh|PlaneGeometry|Sprite|IcosahedronGeometry/);
    // while the view holds still, half the pixels each frame, in whole 2 x 2 quads (a GPU shades quads)
    expect(src).toMatch(/mod\(floor\(gl_FragCoord\.x \* 0\.5\) \+ floor\(gl_FragCoord\.y \* 0\.5\) \+ uPhase, 2\.0\)/);
    expect(src).toMatch(/last\.dir\.angleTo\(dir\) < U\.uPix\.value \* 0\.5/);
    // the sky, the sea's haze and the clouds' haze are one atmosphere
    expect(src).toMatch(/SKY_GLSL/);
    expect(read("components/scenes/descent/Ocean.jsx")).toMatch(/SKY_GLSL/);
    expect(read("components/scenes/ReentryScene.jsx")).toMatch(/<CumulusLayer simRef=\{simRef\} atmo=\{atmo\} passRef=\{cloudPass\} \/>/);
  });
});

describe("the wind sea: a random sea from a wave spectrum, its slopes those of the real ocean", () => {
  const a = oceanBand(BAND_A);
  test("the slopes add up to Cox & Munk's measured mean square slope for the breeze", () => {
    expect(MSS_TOTAL).toBeCloseTo(0.003 + 0.00512 * WIND.speed, 9);
    expect(meanSquareSlope(a)).toBeCloseTo(BAND_A.mss, 6);
    expect(MSS_UNRESOLVED).toBeGreaterThan(0);
    expect(BAND_A.mss + BAND_B.mss + MSS_UNRESOLVED).toBeCloseTo(MSS_TOTAL, 9);
    // gentle: the chop's height about a tenth of a metre (rms), its slopes a few degrees
    let hh = 0;
    for (let o = 0; o < a.h.length; o++) hh += a.h[o] * a.h[o];
    expect(Math.sqrt(hh / a.h.length)).toBeLessThan(0.3);
  });
  test("the tile wraps without a seam, and the waves run in many directions (no stripes)", () => {
    const N = a.N;
    let inner = 0;
    let wrap = 0;
    for (let y = 0; y < N; y++) {
      inner += Math.abs(a.h[y * N + N / 2] - a.h[y * N + N / 2 - 1]);
      wrap += Math.abs(a.h[y * N] - a.h[y * N + N - 1]);
    }
    expect(wrap).toBeLessThan(inner * 1.5);
    // the slope along the wind and across it: both present (a spread sea, not parallel crests)
    let along = 0;
    let across = 0;
    const wx = Math.cos(WIND.dir);
    const wz = Math.sin(WIND.dir);
    for (let o = 0; o < a.sx.length; o++) {
      along += (a.sx[o] * wx + a.sz[o] * wz) ** 2;
      across += (-a.sx[o] * wz + a.sz[o] * wx) ** 2;
    }
    expect(across / along).toBeGreaterThan(0.25);
    expect(across / along).toBeLessThan(1);
  });
  test("the ocean shader reads the spectrum, filters it with distance and fades into the sky's own horizon", () => {
    const src = read("components/scenes/descent/Ocean.jsx");
    expect(src).toMatch(/from "@\/data\/oceanSpectrum"/);
    expect(src).not.toMatch(/planetTexture/);
    expect(src).toMatch(/skyColor\(/);
    // half-float bands with their mip chain built on the CPU (no float mip generation on the GPU)
    expect(src).toMatch(/THREE\.HalfFloatType/);
    expect(src).toMatch(/generateMipmaps = false/);
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
    // never left hanging: they fall on at the descent rate from contact (no pause in the air), the
    // lines slack and the canopies deflating, and are on the sea within about three seconds
    expect(chuteRelease(0.1).drop).toBeGreaterThan(0.015);
    expect(chuteRelease(1).collapse).toBeGreaterThan(0.6);
    expect(chuteRelease(3.4).drop).toBe(1);
    expect(chuteRelease(4).flat).toBe(1);
    for (let s = 0; s < 4; s += 0.05) expect(chuteRelease(s + 0.05).drop).toBeGreaterThanOrEqual(chuteRelease(s).drop);
    // and go under as one sheet, fading (0 on the surface .. 1 gone): on the sea through the
    // recovery shot, gone within about 22 s
    expect(chuteRelease(6).sink).toBe(0);
    expect(chuteRelease(10).sink).toBeLessThan(0.25);
    expect(chuteRelease(14).sink).toBeGreaterThan(0.3);
    expect(chuteRelease(22).sink).toBe(1);
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
    // no crown sheet, ring or disc: lit masses of spray and a few fine drops; what stays is in the water itself
    expect(splash).not.toMatch(/CylinderGeometry|RingGeometry|CircleGeometry/);
    expect(splash).toMatch(/const MASSES = \d+;/);
    expect(+splash.match(/const DROPS = (\d+);/)[1]).toBeLessThanOrEqual(200); // never a confetti of streaks
    // the drops as thin as drops are on screen: their coverage, not a fixed width
    expect(splash).toMatch(/min\(1\.0, px \/ 1\.2\)/);
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
    ["components/scenes/descent/Ocean.jsx", "components/scenes/descent/CumulusLayer.jsx", "components/scenes/descent/Chutes.jsx", "components/scenes/descent/Splash.jsx", "components/scenes/ReentryScene.jsx"].forEach((f) => {
      const src = read(f);
      expect(src).not.toMatch(/\b(advance|step)\(s[,)]/);
      expect(src).not.toMatch(/s\.(h|v|t|mainT|drogueT|outcome)\s*=[^=]/);
    });
  });
  test("every asset is offline: the sky, the clouds and the sea are computed on the device", () => {
    [
      "components/scenes/descent/Ocean.jsx",
      "components/scenes/descent/CumulusLayer.jsx",
      "components/scenes/descent/atmosphere.js",
      "components/scenes/descent/noise2d.js",
      "components/scenes/descent/Chutes.jsx",
      "components/scenes/descent/Splash.jsx",
      "data/cumulusField.js",
      "data/oceanSpectrum.js",
    ].forEach((f) => {
      expect(read(f)).not.toMatch(/https?:\/\//);
      expect(read(f)).not.toMatch(/\.(png|jpe?g|webp|ktx2?)["']/);
    });
  });
});
