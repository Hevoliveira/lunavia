import {
  APPROACH,
  CAMERA_RAY,
  LZ_LAT,
  LZ_LON,
  LZ_SUN_ELEVATION,
  LZ_UP,
  MOON_ROTATION,
  ORBIT,
  applyRotation,
  approachCamera,
  approachPoint,
  craftAlpha,
  craftPose,
  goForPdi,
  landingSite,
  norm,
  orbitCamera,
} from "./lunarOrbitShot";
import { MOON_UNITS as R, craftScenePos, moonScenePos } from "./sceneTrack";

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
  test("always moves forward, decelerating smoothly from arrival to a creep", () => {
    let prev = craftAlpha(0);
    let prevRate = Infinity;
    for (let t = 0.05; t < 600; t += 0.05) {
      const a = craftAlpha(t);
      const rate = (a - prev) / 0.05 / DEG;
      expect(rate).toBeGreaterThan(0);
      expect(rate).toBeLessThanOrEqual(prevRate + 1e-9);
      prev = a;
      prevRate = rate;
    }
    expect((craftAlpha(0.05) - craftAlpha(0)) / 0.05 / DEG).toBeLessThan(8);
    expect((craftAlpha(20.05) - craftAlpha(20)) / 0.05 / DEG).toBeLessThan(0.15);
  });

  test("stays near the PDI point however long the player reads (bounded creep)", () => {
    expect((craftAlpha(3600) - ORBIT.pdiAlpha) / DEG).toBeLessThanOrEqual(ORBIT.creep / DEG + 1e-6);
  });

  test("GO FOR PDI lights about nine seconds in and stays lit", () => {
    const first = [...Array(400).keys()].map((i) => i * 0.1).find((t) => goForPdi(t));
    expect(first).toBeGreaterThan(6);
    expect(first).toBeLessThan(13);
    for (let t = first; t < 3600; t += 1) expect(goForPdi(t)).toBe(true);
  });

  test("flies towards the landing site, east to west", () => {
    const before = craftPose(8, M, R);
    const site = landingSite(M, R);
    expect(dot(before.fwd, norm(sub(site, before.pos)))).toBeGreaterThan(0.5);
    expect(before.alpha).toBeLessThan(0);
  });
});

describe("orbit camera: the Moon cannot appear to turn", () => {
  const dt = 1 / 60;
  const rows = [];
  for (let i = 0; i <= 600 * 60; i += i < 60 * 20 ? 1 : 60) rows.push({ tau: i * dt, cam: orbitCamera(i * dt, M, R) });

  test("the camera never leaves its ray from the Moon's centre: total surface sweep is zero", () => {
    let total = 0;
    for (let i = 1; i < rows.length; i++) total += angle(sub(rows[i - 1].cam.pos, M), sub(rows[i].cam.pos, M));
    expect(total).toBeLessThan(0.001);
    rows.forEach((r) => expect(angle(sub(r.cam.pos, M), CAMERA_RAY)).toBeLessThan(0.001));
  });

  test("it only dollies in and tilts, gently: pan < 8 deg/s, dolly < 0.6 R/s, no roll, never inside 1.25 R", () => {
    const first20 = rows.filter((r) => r.tau <= 20);
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
    const a = orbitCamera(ORBIT.settleEnd + 0.5, M, R);
    const b = orbitCamera(3600, M, R);
    expect(a.pos).toEqual(b.pos);
    expect(a.look).toEqual(b.look);
  });

  test("establishing shot: the whole Moon in frame with the landing site on the visible face", () => {
    const cam = orbitCamera(0, M, R);
    const d = len(sub(cam.pos, M));
    const radius = Math.asin(R / d) / DEG;
    const off = angle(sub(cam.look, cam.pos), sub(M, cam.pos));
    expect(radius + off).toBeLessThan(22.5); // fits the 45° vertical field of view
    expect(dot(sub(cam.pos, landingSite(M, R)), LZ_UP)).toBeGreaterThan(0);
  });

  // Left and top edges of the LUNAR DESCENT prompt (bottom right), as measured in the app.
  test.each([
    ["iPhone SE", 667 / 375, 0.45, 0.6],
    ["iPhone 15", 852 / 393, 0.57, 0.58],
    ["iPhone Pro Max", 932 / 430, 0.6, 0.6],
    ["desktop", 1280 / 720, 0.6, 0.7],
  ])("settled on %s: craft upper left moving right, site ahead below it and clear of the prompt", (_, aspect, promptX, promptY) => {
    for (const tau of [ORBIT.settleEnd + 1, 30, 120, 600]) {
      const cam = orbitCamera(tau, M, R);
      const craft = craftPose(tau, M, R);
      const c = project(cam, craft.pos, aspect);
      expect(c[2]).toBeGreaterThan(0);
      expect(c[0]).toBeGreaterThan(0.1);
      expect(c[0]).toBeLessThan(0.42);
      expect(c[1]).toBeGreaterThan(0.22); // the whole craft below the top HUD strip
      expect(c[1]).toBeLessThan(0.4);
      const ahead = project(cam, add(craft.pos, craft.fwd.map((x) => x * 0.05)), aspect);
      expect(ahead[0] - c[0]).toBeGreaterThan(Math.abs(ahead[1] - c[1])); // flies left to right
      const site = landingSite(M, R);
      const l = project(cam, site, aspect);
      expect(l[2]).toBeGreaterThan(0);
      expect(dot(sub(cam.pos, site), LZ_UP)).toBeGreaterThan(0); // on the visible face
      expect(l[0]).toBeGreaterThan(c[0]);
      expect(l[1]).toBeGreaterThan(c[1]);
      expect(l[1]).toBeLessThan(0.75);
      expect(l[0] + 0.03 > promptX && l[1] + 0.03 > promptY).toBe(false); // ring clear of the LUNAR DESCENT prompt
    }
  });
});

describe("arrival at the end of the cruise", () => {
  // The cruise camera before the arrival shot: near the craft, looking back at the Earth.
  const cruise = (t) => ({ pos: add(craftScenePos(t), [0.8, 0.35, 0.9]), look: [0, 0, 0] });
  const frames = [];
  for (let t = APPROACH.turnStart; t <= APPROACH.losEnd; t += 30000 / 60) {
    const c = cruise(t);
    const Mt = moonScenePos(t);
    frames.push({ t, M: Mt, S: craftScenePos(t), cam: approachCamera(t, c.pos, c.look, Mt, R, craftScenePos(t)) });
  }
  const dt = 1 / 60;

  test("the camera turns to the Moon while it is still small, never whipping round when it is big", () => {
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1];
      const b = frames[i];
      const pan = angle(sub(a.cam.look, a.cam.pos), sub(b.cam.look, b.cam.pos)) / dt;
      const moonRadius = Math.asin(Math.min(1, R / len(sub(b.M, b.cam.pos)))) / DEG;
      if (moonRadius > 9) expect(pan).toBeLessThan(15);
    }
  });

  test("once the Moon is big the camera stays on one ray, Moon centred: zero sweep", () => {
    const held = frames.filter((f) => f.t >= APPROACH.anchorEnd);
    expect(held.length).toBeGreaterThan(10);
    let total = 0;
    for (let i = 1; i < held.length; i++) {
      // the Moon itself moves a little along its orbit: measure from its own centre
      total += angle(sub(held[i - 1].cam.pos, held[i - 1].M), sub(held[i].cam.pos, held[i].M));
    }
    expect(total).toBeLessThan(0.01);
    held.forEach((f) => {
      expect(len(sub(f.cam.pos, approachPoint(f.M, R, f.S)))).toBeLessThan(1e-9);
      expect(angle(sub(f.cam.look, f.cam.pos), sub(f.M, f.cam.pos))).toBeLessThan(0.001);
    });
  });

  test("loss of signal comes before the craft could be seen reaching the drawn Moon", () => {
    const at = (t) => len(sub(craftScenePos(t), moonScenePos(t))) / R;
    expect(at(APPROACH.los)).toBeGreaterThan(1.5);
    expect(at(APPROACH.losEnd)).toBeGreaterThan(1.1);
    expect(APPROACH.los).toBeGreaterThan(APPROACH.anchorEnd);
  });

  test("the camera follows the craft down its ray, never overtaking it, then holds while it flies on", () => {
    let prevDist = Infinity;
    for (let t = APPROACH.anchorEnd; t <= APPROACH.losEnd; t += 500) {
      const Mt = moonScenePos(t);
      const S = craftScenePos(t);
      const camDist = len(sub(approachPoint(Mt, R, S), Mt));
      expect(camDist - len(sub(S, Mt))).toBeGreaterThan(1.5 * R);
      expect(camDist).toBeLessThanOrEqual(prevDist + 1e-9);
      expect(camDist).toBeGreaterThan(APPROACH.hold * R);
      prevDist = camDist;
    }
  });
});
