import {
  CRUISE,
  M_PER_UNIT,
  ORBIT_SEQ,
  ORBIT_SHOTS,
  STACK,
  coastDistanceKm,
  cruiseCamera,
  orbitShotAt,
  radialFrame,
  returnCamera,
  returnDistanceKm,
  toVehicle,
  toWorld,
  trueSizeDistance,
  undockTime,
  vehicleFrame,
} from "./orbitSequence";
import { OPENING, OPENING_SHOTS, OPENING_SOUND, loopCamera, openingCamera, openingShotAt, openingUndockTime, titleCards } from "./openingSequence";
import { craftPose } from "./lunarOrbitShot";
import { MOON_UNITS, moonScenePos } from "./sceneTrack";
import { undocking } from "./undocking";

const DEG = Math.PI / 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const SUN = (() => {
  const s = [30, 10, -20];
  const l = len(s);
  return s.map((x) => x / l);
})();

/** Distance from a camera (vehicle frame, m) to the spacecraft: the stack's axis segment, and the LM. */
function clearance(pos, lmY = 0) {
  const x = Math.min(STACK.nose, Math.max(STACK.aft, pos[0])); // CSM along +X
  const dCsm = Math.hypot(pos[0] - x, pos[1], pos[2]);
  const lx = 7 + lmY;
  const dLm = Math.hypot(pos[0] - lx, pos[1], pos[2]);
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

describe("lunar orbit: the docked spacecraft, then the undocking", () => {
  test("the shots run in order without gaps, establishing first and the LM held at the end", () => {
    expect(ORBIT_SHOTS[0].wide).toBe(true);
    for (let i = 1; i < ORBIT_SHOTS.length; i++) {
      const a = ORBIT_SHOTS[i - 1];
      expect(ORBIT_SHOTS[i].start).toBeCloseTo(a.start + (a.wide ? ORBIT_SEQ.cut : a.len), 9);
    }
    expect(ORBIT_SHOTS[ORBIT_SHOTS.length - 1].follow).toBe("lm");
    expect(orbitShotAt(ORBIT_SEQ.undock + 0.1).shot.id).toBe("undock");
    expect(ORBIT_SEQ.goPdi).toBeLessThan(ORBIT_SEQ.end);
  });

  test("every close shot sees the spacecraft from outside it, from above (its sunlit side), looking down at the horizon", () => {
    const M = moonScenePos(270000);
    for (let tau = ORBIT_SEQ.cut; tau < ORBIT_SEQ.end + 30; tau += 0.25) {
      const { shot, u } = orbitShotAt(tau);
      const s = undocking(undockTime(tau));
      let cam = shot.cam(u);
      if (shot.follow === "lm") cam = { pos: [cam.pos[0] + 7 + s.lmY, cam.pos[1], cam.pos[2]], look: [cam.look[0] + 7 + s.lmY, cam.look[1], cam.look[2]] };
      expect(clearance(cam.pos, s.lmY)).toBeGreaterThan(6);
      expect(cam.pos[1]).toBeGreaterThan(0);
      expect(cam.look[1]).toBeLessThan(cam.pos[1]);
      const pose = craftPose(tau, M, MOON_UNITS);
      const sunV = toVehicle(vehicleFrame(pose.fwd, pose.up), SUN);
      expect(sunV[1]).toBeGreaterThan(0.4); // the Sun lights the spacecraft from above the camera's side
    }
  });

  test("captions name what happens: docked, preparation, undocking, two spacecraft", () => {
    const ids = ORBIT_SHOTS.filter((s) => s.caption).map((s) => s.caption);
    expect(ids).toEqual(["LUNAR ORBIT", "LV-001 IN LUNAR ORBIT", "UNDOCKING PREPARATION", "UNDOCKING", "TWO SPACECRAFT"]);
  });
});

describe("cruise and return: close on the spacecraft, the planet at its true size", () => {
  test("the coast continues from the launch cinematic's last shot and recedes like Apollo's", () => {
    expect(coastDistanceKm(11770) / 24568).toBeGreaterThan(0.9);
    expect(coastDistanceKm(11770) / 24568).toBeLessThan(1.1);
    expect(coastDistanceKm(19840)).toBeGreaterThan(50000);
    expect(coastDistanceKm(CRUISE.closeEnd)).toBeGreaterThan(100000);
    let prev = 0;
    for (let t = 9840; t < 60000; t += 500) {
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

  test("the close cameras stay outside the spacecraft, on the far side from the planet", () => {
    for (let u = 0; u <= 1; u += 0.05) {
      [cruiseCamera(u), returnCamera(u)].forEach((c) => {
        expect(clearance(c.pos)).toBeGreaterThan(10);
        expect(c.pos[2]).toBeGreaterThan(0); // the planet is at -Z, beyond the stack
        expect(c.look[2]).toBeLessThanOrEqual(0.0001);
      });
    }
  });
});

describe("the main-menu opening", () => {
  test("35–55 seconds, in the brief's order, title last", () => {
    expect(OPENING.length).toBeGreaterThanOrEqual(35);
    expect(OPENING.length).toBeLessThanOrEqual(55);
    expect(OPENING_SHOTS.map((s) => s.id)).toEqual(["moon", "approach", "reveal", "interface", "undock", "pair", "title"]);
    for (let i = 1; i < OPENING_SHOTS.length; i++) expect(OPENING_SHOTS[i].start).toBeCloseTo(OPENING_SHOTS[i - 1].start + OPENING_SHOTS[i - 1].len, 9);
    const last = OPENING_SHOTS[OPENING_SHOTS.length - 1];
    expect(last.start + last.len).toBeCloseTo(OPENING.length, 9);
  });

  test("undocking inside the undocking shot; LUNAVIA, then the credit, then the tagline, then black", () => {
    expect(openingShotAt(OPENING.undock).shot.id).toBe("undock");
    expect(OPENING.title).toBeGreaterThanOrEqual(openingShotAt(OPENING.title).shot.start);
    expect(openingShotAt(OPENING.title).shot.id).toBe("title");
    expect(OPENING.credit).toBeGreaterThan(OPENING.title);
    expect(OPENING.tagline).toBeGreaterThan(OPENING.credit);
    expect(OPENING.fadeOut).toBeLessThan(OPENING.length);
    const c0 = titleCards(0);
    expect(c0.black).toBeCloseTo(1, 9);
    expect(titleCards(5).black).toBe(0);
    expect(titleCards(OPENING.title - 0.1).title).toBe(0);
    const held = titleCards(OPENING.fadeOut - 0.6); // everything up, before the fade to black
    expect(held.title).toBeCloseTo(1, 6);
    expect(held.credit).toBeCloseTo(1, 6);
    expect(held.tagline.every((x) => x > 0.99)).toBe(true);
    expect(titleCards(OPENING.length).black).toBeCloseTo(1, 9);
  });

  test("the camera never enters the spacecraft, and the LM keeps moving off after undocking", () => {
    for (let t = 0; t <= OPENING.length; t += 0.1) {
      const s = undocking(openingUndockTime(t));
      const cam = openingCamera(t, s.lmY);
      if (cam.wide) continue;
      expect(clearance(cam.pos, s.lmY)).toBeGreaterThan(6);
    }
    expect(undocking(openingUndockTime(OPENING.length)).gap).toBeGreaterThan(15);
    for (let t = 0; t < 600; t += 1) expect(clearance(loopCamera(t).pos)).toBeGreaterThan(15);
  });

  test("sound cues are in order, inside the opening, and mark the undocking", () => {
    for (let i = 1; i < OPENING_SOUND.length; i++) expect(OPENING_SOUND[i].t).toBeGreaterThanOrEqual(OPENING_SOUND[i - 1].t);
    OPENING_SOUND.forEach((c) => expect(c.t).toBeLessThan(OPENING.length));
    expect(OPENING_SOUND.find((c) => c.cue === "clank").t).toBe(OPENING.undock);
  });
});

test("orbital speed check: the orbit rate used after the cut is about 1.56 km/s", () => {
  // 0.0443 deg/s at 2015 km from the centre
  const v = 0.0443 * DEG * 1737 * 1.16;
  expect(v).toBeGreaterThan(1.5);
  expect(v).toBeLessThan(1.62);
});
