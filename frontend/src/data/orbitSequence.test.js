import {
  APPROACH_RAY,
  ASSEMBLY_ROTATION,
  ASSEMBLY_X,
  CISLUNAR,
  COAST_ASSEMBLY,
  ORBIT_ANCHOR,
  LM_CENTRE_X,
  M_PER_UNIT,
  ORBIT_SEQ,
  ORBIT_SHOTS,
  STACK,
  STACK_ROTATION,
  TITLE_HOLD,
  assemblyPoint,
  carrierDrift,
  deployState,
  loiBurnLevel,
  MCC,
  mccLevel,
  approachCloseCamera,
  approachMoonKm,
  approachYaw,
  coastAttitude,
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
import { ASSEMBLY, CARRIER, MIDCOURSE_DV } from "./carrier";
import { TD } from "./transposition";
import { dockedLmPose } from "./csmDesign";
import { ADAPTER } from "./payloadDesign";

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

/**
 * Distance from a camera (vehicle frame, m) to the outbound assembly, as a cylinder of the adapter's
 * radius along its axis; in lunar orbit (anchor ORBIT_ANCHOR, engines first) or in the coast (on its
 * centre of mass, yaw π + turn: the nose along +X at yaw 0).
 */
function asmClearance(pos, coastPhi = null) {
  let p = pos;
  let x0 = Math.min(ASSEMBLY_X.nose, ASSEMBLY_X.aft) - 15; // the CSM backs out and turns round up to ~15 m beyond the nose
  let x1 = Math.max(ASSEMBLY_X.nose, ASSEMBLY_X.aft);
  if (coastPhi != null) {
    // into the assembly's own frame: nose along +X
    const c = Math.cos(coastPhi);
    const sn = Math.sin(coastPhi);
    p = [pos[0] * c + pos[2] * sn, pos[1], -pos[0] * sn + pos[2] * c];
    x0 = ASSEMBLY.aft - ASSEMBLY.com;
    x1 = ASSEMBLY.nose - ASSEMBLY.com;
  }
  const x = Math.min(x1, Math.max(x0, p[0]));
  return Math.hypot(p[0] - x, p[1], p[2]) - ADAPTER.R0;
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

describe("lunar orbit: insertion, the deployment, the undocking, the title", () => {
  test("the shots run in order without gaps: the insertion burn first, the LM held at the end", () => {
    expect(ORBIT_SHOTS.map((x) => x.id)).toEqual([
      "loi", "establish", "assembly", "deploySep", "deployTurn", "deployDock", "deployExtract", "leave", "tunnel", "undock", "pair", "title", "titleScreen",
    ]);
    expect(ORBIT_SHOTS[0].start).toBe(0);
    for (let i = 1; i < ORBIT_SHOTS.length; i++) {
      const a = ORBIT_SHOTS[i - 1];
      expect(ORBIT_SHOTS[i].start).toBeCloseTo(a.start + a.len, 9);
    }
    expect(ORBIT_SHOTS[1].wide).toBe(true);
    expect(ORBIT_SHOTS[1].start).toBe(ORBIT_SEQ.arrive);
    expect(ORBIT_SHOTS[ORBIT_SHOTS.length - 1].follow).toBe("lm");
    expect(orbitShotAt(ORBIT_SEQ.undock + 0.1).shot.id).toBe("undock");
    // go for powered descent during the two-spacecraft shot, then the title, then the title screen
    expect(orbitShotAt(ORBIT_SEQ.goPdi).shot.id).toBe("pair");
    expect(ORBIT_SEQ.goPdi).toBeGreaterThan(ORBIT_SEQ.undock + 10);
    expect(ORBIT_SEQ.title).toBeGreaterThan(ORBIT_SEQ.goPdi);
    expect(ORBIT_SEQ.titleScreen).toBeGreaterThan(ORBIT_SEQ.title);
    expect(ORBIT_SEQ.end).toBeGreaterThan(ORBIT_SEQ.titleScreen);
  });

  test("the deployment happens only in lunar orbit, after the insertion burn and a steady shot of the integrated assembly", () => {
    // integrated (adapter closed, the LM inside, the CSM on top) through the burn and the arrival
    for (let tau = 0; tau < ORBIT_SEQ.deploy + TD.sep; tau += 0.05) {
      const d = deployState(tau);
      expect(d.td.phase).toBe("mated");
      expect(d.craft).toBe(true);
      expect(d.on).toBe(true);
    }
    expect(ORBIT_SEQ.deploy).toBeGreaterThan(ORBIT_SEQ.cutoff + 5);
    const asm = ORBIT_SHOTS.find((x) => x.id === "assembly");
    expect(asm.start).toBe(ORBIT_SEQ.cut);
    expect(asm.len).toBeGreaterThanOrEqual(4);
    // then, in order and each in its own shot: the adapter opens, transposition, docking, extraction
    const at = (phase) => {
      for (let tau = 0; tau < 120; tau += 0.05) if (deployState(tau).td.phase === phase) return tau;
      return null;
    };
    expect(orbitShotAt(at("separation") + 0.01).shot.id).toBe("deploySep");
    expect(orbitShotAt(at("transposition") + 0.01).shot.id).toBe("deploySep"); // the turn starts as the CSM clears the adapter
    expect(orbitShotAt(at("approach") + 0.01).shot.id).toBe("deployDock");
    expect(orbitShotAt(at("docked") + 0.01).shot.id).toBe("deployDock");
    expect(orbitShotAt(at("extraction") + 0.01).shot.id).toBe("deployExtract");
    expect(at("extraction")).toBeLessThan(ORBIT_SEQ.swap);
    // the docked pair is handed to SpacecraftStack at a cut, before the undocking
    expect(ORBIT_SHOTS.find((x) => x.id === "leave").start).toBe(ORBIT_SEQ.swap);
    expect(ORBIT_SEQ.undock).toBeGreaterThan(ORBIT_SEQ.swap + 5);
    expect(deployState(ORBIT_SEQ.swap - 0.01).craft).toBe(true);
    expect(deployState(ORBIT_SEQ.swap).craft).toBe(false);
  });

  test("no swap and no jump: the docked pair the deployment ends with is exactly the stack that undocks", () => {
    const s = deployState(ORBIT_SEQ.swap).td;
    expect(s.docked).toBe(true);
    expect(s.hga).toBe(1);
    // the CSM's origin at the vehicle origin, turned as SpacecraftStack turns it (+Y along +X)
    assemblyPoint(s.csm.pos).forEach((x) => expect(x).toBeCloseTo(0, 9));
    const turn = s.csm.pitch + ASSEMBLY_ROTATION[2];
    expect(Math.cos(turn - STACK_ROTATION[2])).toBeCloseTo(1, 9);
    // the LM where the stack docks it (data/csmDesign dockedLmPose, turned onto +X)
    const lm = assemblyPoint(s.lm.pos);
    const docked = dockedLmPose(0).position;
    expect(lm[0]).toBeCloseTo(docked[1], 9);
    expect(lm[1]).toBeCloseTo(-docked[0], 9);
    expect(lm[2]).toBeCloseTo(docked[2], 9);
    // and the undocking starts from that docked stack
    expect(undocking(undockTime(ORBIT_SEQ.swap)).phase).not.toBe("separating");
    expect(undocking(undockTime(ORBIT_SEQ.swap)).gap).toBe(0);
  });

  test("the carrier backs away from the docked pair, then is no longer drawn; it never comes back", () => {
    let prev = 0;
    for (let dt = 0; dt < 20; dt += 0.05) {
      const d = carrierDrift(dt);
      expect(d.x).toBeGreaterThanOrEqual(prev);
      prev = d.x;
    }
    expect(carrierDrift(0.3).x).toBeCloseTo(TD.extract.v * 0.3, 9); // the extraction's 0.9 m/s carries on
    expect(carrierDrift(ORBIT_SEQ.tunnel - ORBIT_SEQ.swap).x).toBeGreaterThan(8);
    expect(carrierDrift(1.5).retro).toBe(1);
    expect(carrierDrift(0.2).retro).toBe(0);
    for (let tau = ORBIT_SEQ.tunnel; tau < 400; tau += 0.5) expect(deployState(tau).on).toBe(false);
  });

  test("every close shot sees the spacecraft from outside it, from above (its sunlit side), looking down at the horizon", () => {
    const M = moonScenePos(270000);
    for (let tau = 0; tau < ORBIT_SEQ.end + 30; tau += 0.25) {
      const { shot, u } = orbitShotAt(tau);
      if (shot.wide) continue;
      const s = undocking(undockTime(tau));
      const d = deployState(tau);
      const cam = orbitShotCamera(shot, u, s.lmY, d.e);
      if (d.on) expect(asmClearance(cam.pos)).toBeGreaterThan(6);
      if (!d.craft) expect(clearance(cam.pos, s.lmY, 0)).toBeGreaterThan(6);
      expect(cam.pos[1]).toBeGreaterThan(0);
      expect(cam.look[1]).toBeLessThan(cam.pos[1]);
      const pose = craftPose(tau, M, MOON_UNITS);
      const sunV = toVehicle(vehicleFrame(pose.fwd, pose.up), SUN);
      expect(sunV[1]).toBeGreaterThan(0.4); // the Sun lights the spacecraft from above the camera's side
    }
  });

  test("lunar orbit insertion: engines first, the carrier fires retrograde, then shuts down before the establishing shot", () => {
    // the carrier's engine exits lead along the flight path (+X), the CSM's nose trails
    expect(ASSEMBLY_X.aft).toBeGreaterThan(ASSEMBLY_X.nose);
    expect(assemblyPoint([0, CARRIER.engine.exitY, 0])[0]).toBeCloseTo(ASSEMBLY_X.aft, 9);
    expect(loiBurnLevel(0)).toBe(0);
    expect(loiBurnLevel(ORBIT_SEQ.ignition - 0.01)).toBe(0);
    expect(loiBurnLevel((ORBIT_SEQ.ignition + ORBIT_SEQ.cutoff) / 2)).toBe(1);
    expect(loiBurnLevel(ORBIT_SEQ.cutoff + 0.5)).toBe(0);
    expect(ORBIT_SEQ.cutoff + 0.5).toBeLessThanOrEqual(ORBIT_SEQ.arrive);
    for (let tau = ORBIT_SEQ.arrive; tau < 400; tau += 0.5) expect(deployState(tau).engines).toBe(0);
    expect(deployState(2).engines).toBe(1);
    // the burn is shot on the integrated assembly; the stack (SpacecraftStack) is not drawn yet
    expect(ORBIT_SHOTS[0].asm).toBe(true);
    expect(deployState(2).craft).toBe(true);
    // nothing in lunar orbit turns the stack (the assembly turned engines first on the approach)
    ORBIT_SHOTS.forEach((x) => expect(x.yaw || 0).toBe(0));
    expect(ORBIT_ANCHOR).toBeGreaterThan(ASSEMBLY.com);
  });

  test("the title shot continues the two-spacecraft shot with no cut, and settles where the descent setup holds", () => {
    const lmY = undocking(undockTime(ORBIT_SEQ.title)).lmY;
    const pair = ORBIT_SHOTS.find((x) => x.id === "pair");
    const title = ORBIT_SHOTS.find((x) => x.id === "title");
    const hold = ORBIT_SHOTS.find((x) => x.id === "titleScreen");
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

  test("captions name what happens: insertion, orbit, the integrated assembly, the deployment, preparation, undocking, two spacecraft", () => {
    const ids = ORBIT_SHOTS.filter((s) => s.caption).map((s) => s.caption);
    expect(ids).toEqual([
      "LUNAR ORBIT INSERTION", "LUNAR ORBIT", "LV-001 IN LUNAR ORBIT", "ADAPTER OPENS", "TRANSPOSITION", "DOCKING", "LUNAR MODULE EXTRACTED",
      "CARRIER LEFT BEHIND", "UNDOCKING PREPARATION", "UNDOCKING", "TWO SPACECRAFT",
    ]);
    // until the deployment the captions say the LM and the CSM are still integrated
    expect(ORBIT_SHOTS.find((x) => x.id === "establish").sub).toMatch(/STILL INTEGRATED/);
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

  test("attitudes read as travel: the engine back at the Earth leaving it; the nose at the Moon, then the engine first", () => {
    const nose = (phi) => [Math.cos(phi), 0, Math.sin(phi)];
    const towardPlanet = (phi) => -nose(phi)[2]; // the planet of the shot is at -Z
    for (let u = 0; u <= 1; u += 0.05) {
      expect(towardPlanet(coastAttitude("depart", u).phi)).toBeLessThan(-0.3); // nose away from the Earth, engine towards it
      expect(towardPlanet(coastAttitude("deep", u).phi)).toBeLessThan(-0.3);
    }
    expect(towardPlanet(coastAttitude("approach", 0).phi)).toBeGreaterThan(0.6); // nose on towards the Moon
    expect(towardPlanet(coastAttitude("approach", 1).phi)).toBeLessThan(-0.6); // turned: the engine towards the Moon
    // never broadside to the planet in the approach before or after the turn
    expect(Math.abs(towardPlanet(coastAttitude("approach", CISLUNAR.turn[0]).phi))).toBeGreaterThan(0.6);
    // every coast camera sees the assembly at a three-quarter angle (not end-on), with the engine end in view
    const view = (cam, phi) => {
      const f = cam.look.map((x, i) => x - cam.pos[i]);
      const l = Math.hypot(...f);
      return Math.acos(dot(f.map((x) => x / l), nose(phi))) / DEG;
    };
    for (let u = 0; u <= 1; u += 0.05) {
      [[cruiseCamera(u), "depart"], [deepCamera(u), "deep"]].forEach(([c, id]) => {
        const a = view(c, coastAttitude(id, u).phi);
        // near profile: the 3 m main engine stands out past the 10.9 m carrier (tan > 1.84 for the bell's tip)
        expect(a).toBeGreaterThan(92);
        expect(a).toBeLessThan(112);
      });
    }
    expect(view(approachCloseCamera(0), coastAttitude("approach", 0).phi)).toBeLessThan(60); // from behind the engine end
    // lunar orbit insertion is filmed from ahead of the engine end (engine first along +X)
    const loi = ORBIT_SHOTS[0].cam(0.5);
    const f = loi.look.map((x, i) => x - loi.pos[i]);
    expect(-f[0] / Math.hypot(...f)).toBeGreaterThan(0.4); // looking back along -X, at the engine end
    expect(loi.pos[0]).toBeGreaterThan(ASSEMBLY_X.aft);
  });

  test("coasting is unpowered; the only burn on the way is the midcourse correction on the main engine", () => {
    expect(mccLevel(0)).toBe(0);
    expect(mccLevel(1)).toBe(0);
    expect(mccLevel((MCC.on + MCC.off) / 2 / MCC.shotLen)).toBe(1);
    let on = 0;
    for (let u = 0; u <= 1; u += 0.005) if (mccLevel(u) > 0.02) on += 0.005 * MCC.shotLen;
    expect(on).toBeGreaterThan(0.8);
    expect(on).toBeLessThan(2);
    expect(MCC.dv).toBeLessThan(MIDCOURSE_DV);
  });

  test("the assembly turns engines first during the approach, smoothly, its RCS firing only to start and stop the turn", () => {
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
      // the outbound assembly on the way out (nose first, then turning engines first)
      [[cruiseCamera(u), "depart"], [deepCamera(u), "deep"]].forEach(([c, id]) => {
        expect(asmClearance(c.pos, coastAttitude(id, u).phi)).toBeGreaterThan(10);
        expect(c.pos[2]).toBeGreaterThan(0); // the planet is at -Z, beyond the assembly
      });
      const c = approachCloseCamera(u);
      expect(asmClearance(c.pos, coastAttitude("approach", u).phi)).toBeGreaterThan(10);
      expect(c.pos[2]).toBeGreaterThan(0);
      // the CSM alone on the way home
      expect(clearance(returnCamera(u).pos)).toBeGreaterThan(10);
      expect(returnCamera(u).pos[2]).toBeGreaterThan(0);
    }
    // the coast frames the assembly about its middle
    expect(COAST_ASSEMBLY.nose).toBeGreaterThan(0);
    expect(COAST_ASSEMBLY.aft).toBeLessThan(0);
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
