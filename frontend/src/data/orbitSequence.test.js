import {
  APPROACH_RAY,
  CISLUNAR,
  LM_CENTRE_X,
  M_PER_UNIT,
  ORBIT_SEQ,
  ORBIT_SHOTS,
  STACK,
  TITLE_HOLD,
  approachCloseCamera,
  approachMoonKm,
  approachYaw,
  coastDistanceKm,
  coastShotAt,
  cruiseCamera,
  cruiseTime,
  deepCamera,
  orbitShotAt,
  orbitShotCamera,
  radialFrame,
  returnCamera,
  returnDistanceKm,
  spsLevel,
  toVehicle,
  toWorld,
  trueSizeDistance,
  undockTime,
  vehicleFrame,
} from "./orbitSequence";
import { LOOP_TAU, loopCamera } from "./titleLoop";
import { craftPose } from "./lunarOrbitShot";
import { MOON_UNITS, craftScenePos, moonScenePos } from "./sceneTrack";
import { undocking } from "./undocking";

const DEG = Math.PI / 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const SUN = (() => {
  const s = [30, 10, -20];
  const l = len(s);
  return s.map((x) => x / l);
})();
const deg = (radiusKm, dKm) => (2 * Math.asin(radiusKm / dKm)) / DEG; // apparent diameter

/**
 * Distance from a camera (vehicle frame, m) to the spacecraft: the stack's axis
 * segment, and the LM; yaw: the stack turned about the vertical through its middle.
 */
function clearance(pos, lmY = 0, yaw = 0) {
  const c = Math.cos(-yaw);
  const sn = Math.sin(-yaw);
  const dx = pos[0] - STACK.mid;
  const p = [STACK.mid + dx * c + pos[2] * sn, pos[1], -dx * sn + pos[2] * c]; // the camera in the stack's own frame
  const x = Math.min(STACK.nose, Math.max(STACK.aft, p[0])); // CSM along +X
  const dCsm = Math.hypot(p[0] - x, p[1], p[2]);
  const lx = LM_CENTRE_X + lmY;
  const dLm = Math.hypot(p[0] - lx, p[1], p[2]);
  return Math.min(dCsm, dLm);
}

describe("two layers, one view: the vehicle frame", () => {
  test("planets are drawn at 1 unit ≈ 1,922 km; the spacecraft in metres", () => {
    expect(M_PER_UNIT / 1000).toBeGreaterThan(1900);
    expect(M_PER_UNIT / 1000).toBeLessThan(1945);
  });

  test("the vehicle frame is orthonormal and right-handed, and maps both ways", () => {
    const F = vehicleFrame([0.3, 0.2, 0.9], [0.1, 1, 0.05]);
    [F.x, F.y, F.z].forEach((a) => expect(len(a)).toBeCloseTo(1, 9));
    expect(dot(F.x, F.y)).toBeCloseTo(0, 9);
    expect(dot(F.y, F.z)).toBeCloseTo(0, 9);
    const c = [F.x[1] * F.y[2] - F.x[2] * F.y[1], F.x[2] * F.y[0] - F.x[0] * F.y[2], F.x[0] * F.y[1] - F.x[1] * F.y[0]];
    c.forEach((v, i) => expect(v).toBeCloseTo(F.z[i], 9));
    const v = [1.2, -3, 0.4];
    toVehicle(F, toWorld(F, v)).forEach((x, i) => expect(x).toBeCloseTo(v[i], 9));
  });

  test("radialFrame: the planet is behind the stack (-Z), the stack broadside to it", () => {
    const F = radialFrame([5, 0, -2]);
    expect(dot(F.z, [5 / Math.hypot(5, 2), 0, -2 / Math.hypot(5, 2)])).toBeCloseTo(1, 9);
    expect(F.y).toEqual([0, 1, 0]);
    expect(dot(F.x, F.z)).toBeCloseTo(0, 9);
  });
});

describe("lunar orbit: insertion, the docked spacecraft, the undocking, the title", () => {
  test("the shots run in order without gaps: the insertion burn first, the LM held at the end", () => {
    expect(ORBIT_SHOTS.map((x) => x.id)).toEqual(["loi", "establish", "stack", "tunnel", "undock", "pair", "title", "followLm"]);
    expect(ORBIT_SHOTS[0].start).toBe(0);
    for (let i = 1; i < ORBIT_SHOTS.length; i++) {
      const a = ORBIT_SHOTS[i - 1];
      expect(ORBIT_SHOTS[i].start).toBeCloseTo(a.start + a.len, 9);
    }
    expect(ORBIT_SHOTS[1].wide).toBe(true);
    expect(ORBIT_SHOTS[1].start).toBe(ORBIT_SEQ.arrive);
    expect(ORBIT_SHOTS[ORBIT_SHOTS.length - 1].follow).toBe("lm");
    expect(orbitShotAt(ORBIT_SEQ.undock + 0.1).shot.id).toBe("undock");
    // go for powered descent during the two-spacecraft shot, then the title, then the descent setup
    expect(orbitShotAt(ORBIT_SEQ.goPdi).shot.id).toBe("pair");
    expect(ORBIT_SEQ.goPdi).toBeGreaterThan(ORBIT_SEQ.undock + 10);
    expect(ORBIT_SEQ.title).toBeGreaterThan(ORBIT_SEQ.goPdi);
    expect(ORBIT_SEQ.end).toBeGreaterThan(ORBIT_SEQ.title);
  });

  test("every close shot sees the spacecraft from outside it, from above (its sunlit side), looking down at the horizon", () => {
    const M = moonScenePos(270000);
    for (let tau = 0; tau < ORBIT_SEQ.end + 30; tau += 0.25) {
      const { shot, u } = orbitShotAt(tau);
      if (shot.wide) continue;
      const s = undocking(undockTime(tau));
      const cam = orbitShotCamera(shot, u, s.lmY);
      expect(clearance(cam.pos, s.lmY, shot.yaw || 0)).toBeGreaterThan(6);
      expect(cam.pos[1]).toBeGreaterThan(0);
      expect(cam.look[1]).toBeLessThan(cam.pos[1]);
      const pose = craftPose(tau, M, MOON_UNITS);
      const sunV = toVehicle(vehicleFrame(pose.fwd, pose.up), SUN);
      expect(sunV[1]).toBeGreaterThan(0.4); // the Sun lights the spacecraft from above the camera's side
    }
  });

  test("lunar orbit insertion: engine first, the SPS fires retrograde, then shuts down before the establishing shot", () => {
    const loi = ORBIT_SHOTS[0];
    expect(loi.yaw).toBeCloseTo(Math.PI, 9);
    // turned about its middle, the service module's engine end leads along the flight path (+X)
    const aft = 2 * STACK.mid - STACK.aft;
    expect(aft).toBeGreaterThan(STACK.lmFar - 1);
    expect(spsLevel(0)).toBe(0);
    expect(spsLevel(ORBIT_SEQ.ignition - 0.01)).toBe(0);
    expect(spsLevel((ORBIT_SEQ.ignition + ORBIT_SEQ.cutoff) / 2)).toBe(1);
    expect(spsLevel(ORBIT_SEQ.cutoff + 0.5)).toBe(0);
    expect(ORBIT_SEQ.cutoff + 0.5).toBeLessThanOrEqual(ORBIT_SEQ.arrive);
    // the other shots fly the stack LM first
    ORBIT_SHOTS.slice(1).forEach((x) => expect(x.yaw || 0).toBe(0));
  });

  test("the title shot continues the two-spacecraft shot with no cut, and settles where the descent setup holds", () => {
    const lmY = undocking(undockTime(ORBIT_SEQ.title)).lmY;
    const pair = ORBIT_SHOTS.find((x) => x.id === "pair");
    const title = ORBIT_SHOTS.find((x) => x.id === "title");
    const hold = ORBIT_SHOTS.find((x) => x.id === "followLm");
    const a = orbitShotCamera(pair, 1, lmY);
    const b = orbitShotCamera(title, 0, lmY);
    a.pos.forEach((x, i) => expect(b.pos[i]).toBeCloseTo(x, 9));
    a.look.forEach((x, i) => expect(b.look[i]).toBeCloseTo(x, 9));
    const c = title.cam(1);
    const d = hold.cam(0);
    c.pos.forEach((x, i) => expect(d.pos[i]).toBeCloseTo(x, 9));
    c.look.forEach((x, i) => expect(d.look[i]).toBeCloseTo(x, 9));
    expect(d).toEqual(TITLE_HOLD);
    // the move is gentle: under 4.5 m/s (some 30 m from the LM) and 6°/s at its fastest
    let prev = null;
    for (let tau = ORBIT_SEQ.title; tau <= ORBIT_SEQ.end + 1; tau += 0.05) {
      const { shot, u } = orbitShotAt(tau);
      const cam = orbitShotCamera(shot, u, undocking(undockTime(tau)).lmY);
      if (prev) {
        expect(len(cam.pos.map((x, i) => x - prev.pos[i])) / 0.05).toBeLessThan(4.5);
        const f0 = prev.look.map((x, i) => x - prev.pos[i]);
        const f1 = cam.look.map((x, i) => x - cam.pos[i]);
        const ang = Math.acos(Math.min(1, dot(f0, f1) / len(f0) / len(f1))) / DEG;
        expect(ang / 0.05).toBeLessThan(6);
      }
      prev = cam;
    }
  });

  test("captions name what happens: insertion, orbit, docked, preparation, undocking, two spacecraft", () => {
    const ids = ORBIT_SHOTS.filter((s) => s.caption).map((s) => s.caption);
    expect(ids).toEqual(["LUNAR ORBIT INSERTION", "LUNAR ORBIT", "LV-001 IN LUNAR ORBIT", "UNDOCKING PREPARATION", "UNDOCKING", "TWO SPACECRAFT"]);
  });
});

describe("the cislunar coast: departure, deep space, approach, all close on the spacecraft", () => {
  test("the coast clock runs forward with no jumps, from the end of the launch to the approach's end", () => {
    expect(cruiseTime(0)).toBe(CISLUNAR.start);
    expect(cruiseTime(CISLUNAR.s.depart)).toBe(CISLUNAR.departEnd);
    expect(cruiseTime(CISLUNAR.s.deep)).toBeCloseTo(CISLUNAR.deepEnd, 6);
    expect(cruiseTime(CISLUNAR.s.end)).toBeCloseTo(CISLUNAR.los, 6);
    let prev = -Infinity;
    for (let s = 0; s <= CISLUNAR.s.end; s += 1 / 60) {
      const t = cruiseTime(s);
      expect(t).toBeGreaterThan(prev);
      if (prev > -Infinity) expect(t - prev).toBeLessThan(500); // at most ~30,000x at 60 fps
      prev = t;
    }
    // 12-16 s on screen, as before, with three shots
    expect(CISLUNAR.s.end).toBeGreaterThanOrEqual(12);
    expect(CISLUNAR.s.end).toBeLessThanOrEqual(16);
    expect([12000, 39999, 40000, 149999, 150000, 207000].map((t) => coastShotAt(t).id)).toEqual(["depart", "depart", "deep", "deep", "approach", "approach"]);
  });

  test("the Earth only shrinks, at its true size, across the departure and deep-space shots (no scale jump at the cut)", () => {
    let prev = Infinity;
    for (let t = CISLUNAR.start; t < CISLUNAR.deepEnd; t += 250) {
      const a = deg(6371, coastDistanceKm(t));
      expect(a).toBeLessThan(prev);
      prev = a;
    }
    const cut = [deg(6371, coastDistanceKm(CISLUNAR.departEnd - 1)), deg(6371, coastDistanceKm(CISLUNAR.departEnd))];
    expect(Math.abs(cut[0] - cut[1])).toBeLessThan(0.01);
    expect(deg(6371, coastDistanceKm(CISLUNAR.departEnd))).toBeLessThan(8); // never filling the frame
    expect(deg(6371, coastDistanceKm(CISLUNAR.deepEnd))).toBeLessThan(3); // "more distant" by deep space
  });

  test("the Moon only grows, at its true size and a steady rate, small at first and never filling the whole frame", () => {
    let prev = 0;
    let prevLog = null;
    for (let u = 0; u <= 1.0001; u += 0.02) {
      const a = deg(1737, approachMoonKm(u));
      expect(a).toBeGreaterThan(prev);
      const l = Math.log(approachMoonKm(u));
      if (prevLog != null) expect(Math.abs(prevLog - l - Math.log(CISLUNAR.moonKm[0] / CISLUNAR.moonKm[1]) * 0.02)).toBeLessThan(1e-9);
      prevLog = l;
      prev = a;
    }
    expect(deg(1737, approachMoonKm(0))).toBeLessThan(4);
    expect(deg(1737, approachMoonKm(1))).toBeGreaterThan(40);
    expect(deg(1737, approachMoonKm(1))).toBeLessThan(70);
  });

  test("the stack turns engine first during the approach, smoothly, its RCS firing only to start and stop the turn", () => {
    expect(approachYaw(0).yaw).toBe(0);
    expect(approachYaw(CISLUNAR.turn[0]).yaw).toBe(0);
    expect(approachYaw(CISLUNAR.turn[1]).yaw).toBeCloseTo(Math.PI, 9);
    expect(approachYaw(1).yaw).toBeCloseTo(Math.PI, 9);
    expect(approachYaw(0.2).rcs).toBe(0);
    expect(approachYaw(0.95).rcs).toBe(0);
    const mid = (CISLUNAR.turn[0] + CISLUNAR.turn[1]) / 2;
    expect(approachYaw(CISLUNAR.turn[0] + 0.05).rcs).toBeGreaterThan(0.5); // speeding the turn up
    expect(approachYaw(CISLUNAR.turn[1] - 0.05).rcs).toBeLessThan(-0.5); // stopping it
    expect(Math.abs(approachYaw(mid).rcs)).toBeLessThan(0.05); // coasting through the middle
    // seconds on screen and turn rate: over 2 s, under 90°/s
    const secs = ((CISLUNAR.turn[1] - CISLUNAR.turn[0]) * (CISLUNAR.s.end - CISLUNAR.s.deep));
    expect(secs).toBeGreaterThan(2);
    expect((Math.PI * 1.875) / secs / DEG).toBeLessThan(90);
  });

  test("the close cameras stay outside the spacecraft, on the far side from the planet", () => {
    for (let u = 0; u <= 1; u += 0.05) {
      [cruiseCamera(u), deepCamera(u), returnCamera(u)].forEach((c) => {
        expect(clearance(c.pos)).toBeGreaterThan(10);
        expect(c.pos[2]).toBeGreaterThan(0); // the planet is at -Z, beyond the stack
      });
      const c = approachCloseCamera(u);
      expect(clearance(c.pos, 0, approachYaw(u).yaw)).toBeGreaterThan(10);
      expect(c.pos[2]).toBeGreaterThan(0);
    }
  });

  // The planet in frame (the Earth behind the departing stack, the Moon behind the approaching one)
  // on landscape phones, and the stack lit from the camera's side.
  const project = (cam, d, aspect) => {
    const T = Math.tan(22.5 * DEG);
    const n = (v) => v.map((x) => x / len(v));
    const f = n(cam.look.map((x, i) => x - cam.pos[i]));
    const r = n([-f[2], 0, f[0]]);
    const up = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const z = dot(d, f);
    return [0.5 + dot(d, r) / z / (T * aspect) / 2, 0.5 - dot(d, up) / z / T / 2];
  };
  test.each([
    ["iPhone SE", 667 / 375],
    ["iPhone 15", 852 / 393],
    ["iPhone Pro Max", 932 / 430],
  ])("on %s the planet behind the stack is in frame in every coast shot", (_, aspect) => {
    for (let u = 0; u <= 1; u += 0.1) {
      for (const cam of [cruiseCamera(u), deepCamera(u), approachCloseCamera(u)]) {
        const p = project(cam, [0, 0, -1], aspect);
        expect(p[0]).toBeGreaterThan(0.05);
        expect(p[0]).toBeLessThan(0.95);
        expect(p[1]).toBeGreaterThan(0.1);
        expect(p[1]).toBeLessThan(0.6);
      }
    }
  });

  test("the Sun lights the side of the stack each coast camera sees", () => {
    for (let t = CISLUNAR.start; t < CISLUNAR.deepEnd; t += 5000) {
      const sunV = toVehicle(radialFrame(craftScenePos(t)), SUN);
      const { id, u } = coastShotAt(t);
      const cam = id === "depart" ? cruiseCamera(u) : deepCamera(u);
      expect(dot(sunV, cam.pos.map((x) => x / len(cam.pos)))).toBeGreaterThan(0.4);
    }
    const sunA = toVehicle(radialFrame(APPROACH_RAY), SUN);
    for (let u = 0; u <= 1; u += 0.1) {
      const cam = approachCloseCamera(u);
      expect(dot(sunA, cam.pos.map((x) => x / len(cam.pos)))).toBeGreaterThan(0.3);
    }
  });
});

describe("cruise and return: the planet at its true size", () => {
  test("the coast continues from the launch cinematic's last shot and recedes like Apollo's", () => {
    expect(coastDistanceKm(11770) / 24568).toBeGreaterThan(0.9);
    expect(coastDistanceKm(11770) / 24568).toBeLessThan(1.1);
    expect(coastDistanceKm(19840)).toBeGreaterThan(50000);
    expect(coastDistanceKm(CISLUNAR.departEnd)).toBeGreaterThan(100000);
    let prev = 0;
    for (let t = 9840; t < 160000; t += 500) {
      expect(coastDistanceKm(t)).toBeGreaterThanOrEqual(prev);
      prev = coastDistanceKm(t);
    }
    expect(returnDistanceKm(504000)).toBeGreaterThan(1737);
  });

  test("trueSizeDistance gives the planet the angular size it has from the spacecraft", () => {
    const R = 3.31; // drawn Earth radius
    const d = trueSizeDistance(R, 40000, 6371);
    expect(Math.asin(R / d)).toBeCloseTo(Math.asin(6371 / 40000), 12);
  });
});

describe("the title loop behind the main menu", () => {
  test("flies the mission's orbit at its real rate, the camera never entering the spacecraft", () => {
    expect(LOOP_TAU).toBeGreaterThan(ORBIT_SEQ.cut);
    for (let t = 0; t < 600; t += 1) expect(clearance(loopCamera(t).pos)).toBeGreaterThan(15);
  });
});

test("orbital speed check: the orbit rate used after the cut is about 1.56 km/s", () => {
  // 0.0443 deg/s at 2015 km from the centre
  const v = 0.0443 * DEG * 1737 * 1.16;
  expect(v).toBeGreaterThan(1.5);
  expect(v).toBeLessThan(1.62);
});
