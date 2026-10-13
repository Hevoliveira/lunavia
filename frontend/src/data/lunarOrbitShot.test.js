import {
  CAMERA_RAY,
  LZ_LAT,
  LZ_LON,
  LZ_SUN_ELEVATION,
  LZ_UP,
  MOON_ROTATION,
  ORBIT,
  applyRotation,
  craftAlpha,
  craftPose,
  goForPdi,
  landingSite,
  norm,
  orbitCamera,
} from "./lunarOrbitShot";
import { MOON_UNITS as R, moonScenePos } from "./sceneTrack";
import { APPROACH_RAY, ORBIT_RATE, ORBIT_SEQ } from "./orbitSequence";

const DEG = Math.PI / 180;
const M = moonScenePos(270000); // the lunar orbit is shown with the Moon where the cruise left it
const SUN = norm([30, 10, -20]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))) / DEG;
const len = (a) => Math.hypot(a[0], a[1], a[2]);

/** Screen position (0..1, y down) of world point p for a camera, landscape phone. */
function project(cam, p, aspect) {
  const t = Math.tan((45 / 2) * DEG);
  const f = norm(sub(cam.look, cam.pos));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const d = sub(p, cam.pos);
  const z = dot(d, f);
  return [0.5 + dot(d, r) / z / (t * aspect) / 2, 0.5 - dot(d, u) / z / t / 2, z];
}

describe("Moon orientation and lighting", () => {
  test("the real landing site (0.67°N 23.47°E) is placed at LZ_UP by a proper rotation", () => {
    const lz = [Math.cos(LZ_LAT) * Math.cos(LZ_LON), Math.sin(LZ_LAT), -Math.cos(LZ_LAT) * Math.sin(LZ_LON)];
    const w = applyRotation(MOON_ROTATION, lz);
    w.forEach((x, i) => expect(x).toBeCloseTo(LZ_UP[i], 9));
    const m = MOON_ROTATION;
    const rows = [m.slice(0, 3), m.slice(3, 6), m.slice(6, 9)];
    rows.forEach((r, i) => rows.forEach((q, j) => expect(dot(r, q)).toBeCloseTo(i === j ? 1 : 0, 9)));
    expect(dot(cross(rows[0], rows[1]), rows[2])).toBeCloseTo(1, 9);
  });

  test("the site is in low morning sunlight, the Sun behind the craft as it flies in (Apollo-style)", () => {
    expect(LZ_SUN_ELEVATION).toBeGreaterThan(8);
    expect(LZ_SUN_ELEVATION).toBeLessThan(25);
    expect(dot(craftPose(20, M, R).fwd, SUN)).toBeLessThan(0);
  });

  test("the face the orbit camera sees is mostly lit, with the site on it", () => {
    expect((1 + dot(CAMERA_RAY, SUN)) / 2).toBeGreaterThan(0.6);
    expect(angle(CAMERA_RAY, LZ_UP)).toBeLessThan(40);
  });
});

describe("spacecraft in lunar orbit", () => {
  test("during the insertion burn it flies at its real orbital rate, continuous into the establishing shot", () => {
    for (const t of [0, 1, 3, ORBIT_SEQ.arrive - 0.1]) {
      expect((craftAlpha(t + 0.05) - craftAlpha(t)) / 0.05 / DEG).toBeCloseTo(ORBIT_RATE, 6);
    }
    expect(Math.abs(craftAlpha(ORBIT_SEQ.arrive - 1e-6) - craftAlpha(ORBIT_SEQ.arrive))).toBeLessThan(1e-6);
  });

  test("from the establishing shot, always moves forward, decelerating smoothly from arrival to a creep", () => {
    const A = ORBIT_SEQ.arrive;
    let prev = craftAlpha(A);
    let prevRate = Infinity;
    for (let t = A + 0.05; t < 600; t += 0.05) {
      const a = craftAlpha(t);
      const rate = (a - prev) / 0.05 / DEG;
      expect(rate).toBeGreaterThan(0);
      expect(rate).toBeLessThanOrEqual(prevRate + 1e-9);
      prev = a;
      prevRate = rate;
    }
    expect((craftAlpha(A + 0.05) - craftAlpha(A)) / 0.05 / DEG).toBeLessThan(8);
    expect((craftAlpha(A + 20.05) - craftAlpha(A + 20)) / 0.05 / DEG).toBeLessThan(0.15);
  });

  test("time-compressed only in the wide establishing shot; at the spacecraft, its real orbital rate", () => {
    expect(ORBIT_RATE).toBeGreaterThan(0.04); // deg/s: 1.56 km/s at 278 km
    expect(ORBIT_RATE).toBeLessThan(0.05);
    for (const t of [ORBIT_SEQ.cut + 0.5, 20, 100, 600]) {
      expect((craftAlpha(t + 0.05) - craftAlpha(t)) / 0.05 / DEG).toBeCloseTo(ORBIT_RATE, 6);
    }
    // continuous at the cut
    expect(Math.abs(craftAlpha(ORBIT_SEQ.cut + 1e-6) - craftAlpha(ORBIT_SEQ.cut))).toBeLessThan(1e-6);
  });

  test("GO FOR PDI lights once the lunar module has undocked and separated, before the title screen", () => {
    const first = [...Array(1200).keys()].map((i) => i * 0.1).find((t) => goForPdi(t));
    expect(first).toBeGreaterThan(ORBIT_SEQ.undock + 10);
    expect(first).toBeLessThanOrEqual(ORBIT_SEQ.titleScreen);
    for (let t = first; t < 3600; t += 1) expect(goForPdi(t)).toBe(true);
  });

  test("flies towards the landing site, east to west", () => {
    const before = craftPose(ORBIT_SEQ.arrive + 8, M, R);
    const site = landingSite(M, R);
    expect(dot(before.fwd, norm(sub(site, before.pos)))).toBeGreaterThan(0.5);
    expect(before.alpha).toBeLessThan(0);
  });
});

describe("orbit camera: the Moon cannot appear to turn", () => {
  const dt = 1 / 60;
  const rows = [];
  // From the establishing shot on (the only shot that uses this camera).
  for (let i = 0; i <= 600 * 60; i += i < 60 * 20 ? 1 : 60) rows.push({ tau: ORBIT_SEQ.arrive + i * dt, cam: orbitCamera(ORBIT_SEQ.arrive + i * dt, M, R) });

  test("the camera never leaves its ray from the Moon's centre: total surface sweep is zero", () => {
    let total = 0;
    for (let i = 1; i < rows.length; i++) total += angle(sub(rows[i - 1].cam.pos, M), sub(rows[i].cam.pos, M));
    expect(total).toBeLessThan(0.001);
    rows.forEach((r) => expect(angle(sub(r.cam.pos, M), CAMERA_RAY)).toBeLessThan(0.001));
  });

  test("it only dollies in and tilts, gently: pan < 8 deg/s, dolly < 0.6 R/s, no roll, never inside 1.25 R", () => {
    const first20 = rows.filter((r) => r.tau <= ORBIT_SEQ.arrive + 20);
    for (let i = 1; i < first20.length; i++) {
      const a = first20[i - 1].cam;
      const b = first20[i].cam;
      expect(angle(sub(a.look, a.pos), sub(b.look, b.pos)) / dt).toBeLessThan(8);
      expect(len(sub(b.pos, a.pos)) / dt / R).toBeLessThan(0.6);
    }
    rows.forEach((r) => {
      expect(r.cam.up).toEqual([0, 1, 0]);
      expect(len(sub(r.cam.pos, M))).toBeGreaterThan(R * 1.25);
    });
  });

  test("once settled the picture is still: nothing in it moves more than the craft's creep", () => {
    const a = orbitCamera(ORBIT_SEQ.arrive + ORBIT.settleEnd + 0.5, M, R);
    const b = orbitCamera(3600, M, R);
    expect(a.pos).toEqual(b.pos);
    expect(a.look).toEqual(b.look);
  });

  test("establishing shot: the whole Moon in frame with the landing site on the visible face", () => {
    const cam = orbitCamera(ORBIT_SEQ.arrive, M, R);
    const d = len(sub(cam.pos, M));
    const radius = Math.asin(R / d) / DEG;
    const off = angle(sub(cam.look, cam.pos), sub(M, cam.pos));
    expect(radius + off).toBeLessThan(22.5); // fits the 45° vertical field of view
    expect(dot(sub(cam.pos, landingSite(M, R)), LZ_UP)).toBeGreaterThan(0);
  });

  // Before the cut to the spacecraft: its glint on its orbit, in front of the Moon, clear of the
  // top HUD strip and of SKIP TO DESCENT (bottom right).
  test.each([
    ["iPhone SE", 667 / 375],
    ["iPhone 15", 852 / 393],
    ["iPhone Pro Max", 932 / 430],
    ["desktop", 1280 / 720],
  ])("establishing shot on %s: the spacecraft's glint is on screen, in front of the Moon, the site on the visible face", (_, aspect) => {
    for (const tau of [0.5, 2, 4].map((x) => ORBIT_SEQ.arrive + x)) {
      const cam = orbitCamera(tau, M, R);
      const craft = craftPose(tau, M, R);
      const c = project(cam, craft.pos, aspect);
      expect(c[2]).toBeGreaterThan(0);
      expect(c[0]).toBeGreaterThan(0.08);
      expect(c[0]).toBeLessThan(0.8);
      expect(c[1]).toBeGreaterThan(0.18);
      expect(c[1]).toBeLessThan(0.82);
      // not hidden behind the Moon: the line of sight reaches the craft before any surface
      const d = sub(craft.pos, cam.pos);
      const dl = len(d);
      const u = d.map((x) => x / dl);
      const oc = sub(cam.pos, M);
      const b = dot(oc, u);
      const disc = b * b - (dot(oc, oc) - R * R);
      if (disc > 0) expect(-b - Math.sqrt(disc)).toBeGreaterThan(dl);
      expect(dot(sub(cam.pos, landingSite(M, R)), LZ_UP)).toBeGreaterThan(0);
    }
  });
});

describe("arrival at the end of the cruise", () => {
  test("the approach sees the Moon from the side the orbit shots look at: the same face, lit the same way", () => {
    const flat = norm([CAMERA_RAY[0], 0, CAMERA_RAY[2]]);
    APPROACH_RAY.forEach((x, i) => expect(x).toBeCloseTo(flat[i], 9));
    // mostly lit (gibbous), not the night side
    expect((1 + dot(APPROACH_RAY, SUN)) / 2).toBeGreaterThan(0.6);
  });
});
