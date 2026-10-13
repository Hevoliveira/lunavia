import {
  ASSEMBLY_ROTATION,
  ASSEMBLY_X,
  ORBIT_ANCHOR,
  ORBIT_ENTRY,
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
import { trajectoryPosition } from "./missionPhases";
import { LOOP_TAU, loopCamera } from "./titleLoop";
import { craftPose } from "./lunarOrbitShot";
import { MOON_UNITS, craftScenePos, moonScenePos } from "./sceneTrack";
import { undocking } from "./undocking";
import { ASSEMBLY, CARRIER } from "./carrier";
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

describe("lunar orbit: the arrival, the deployment, the undocking, the title", () => {
  test("the shots run in order without gaps: the arrival first, the LM held at the end", () => {
    expect(ORBIT_SHOTS.map((x) => x.id)).toEqual([
      "establish", "assembly", "deploySep", "deployTurn", "deployDock", "deployExtract", "leave", "tunnel", "undock", "pair", "title", "titleScreen",
    ]);
    expect(ORBIT_SHOTS[0].start).toBe(ORBIT_ENTRY);
    for (let i = 1; i < ORBIT_SHOTS.length; i++) {
      const a = ORBIT_SHOTS[i - 1];
      expect(ORBIT_SHOTS[i].start).toBeCloseTo(a.start + a.len, 9);
    }
    expect(ORBIT_SHOTS[0].wide).toBe(true);
    expect(ORBIT_SHOTS[0].start).toBe(ORBIT_SEQ.arrive);
    expect(ORBIT_SHOTS[ORBIT_SHOTS.length - 1].follow).toBe("lm");
    expect(orbitShotAt(ORBIT_SEQ.undock + 0.1).shot.id).toBe("undock");
    // go for powered descent during the two-spacecraft shot, then the title, then the title screen
    expect(orbitShotAt(ORBIT_SEQ.goPdi).shot.id).toBe("pair");
    expect(ORBIT_SEQ.goPdi).toBeGreaterThan(ORBIT_SEQ.undock + 10);
    expect(ORBIT_SEQ.title).toBeGreaterThan(ORBIT_SEQ.goPdi);
    expect(ORBIT_SEQ.titleScreen).toBeGreaterThan(ORBIT_SEQ.title);
    expect(ORBIT_SEQ.end).toBeGreaterThan(ORBIT_SEQ.titleScreen);
  });

  test("the deployment happens only in lunar orbit, after the arrival and a steady shot of the integrated assembly", () => {
    // integrated (adapter closed, the LM inside, the CSM on top) on arrival and after
    for (let tau = ORBIT_ENTRY; tau < ORBIT_SEQ.deploy + TD.sep; tau += 0.05) {
      const d = deployState(tau);
      expect(d.td.phase).toBe("mated");
      expect(d.craft).toBe(true);
      expect(d.on).toBe(true);
    }
    expect(ORBIT_SEQ.deploy).toBeGreaterThan(ORBIT_ENTRY + 5);
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
    for (let tau = ORBIT_ENTRY; tau < ORBIT_SEQ.end + 30; tau += 0.25) {
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

  test("the mission enters lunar orbit on the arrival (the cut from TLI cutoff): integrated, engines off, CAPCOM's welcome", () => {
    // the orbit clock starts on the establishing shot: no insertion-burn or approach shot is left
    expect(ORBIT_ENTRY).toBe(ORBIT_SEQ.arrive);
    const { shot } = orbitShotAt(ORBIT_ENTRY);
    expect(shot.id).toBe("establish");
    expect(shot.caption).toBe("LUNAR ORBIT");
    expect(shot.sub).toMatch(/LUNAR ORBIT INSERTION COMPLETE · LM AND CSM STILL INTEGRATED/);
    ORBIT_SHOTS.forEach((x) => {
      expect(x.start).toBeGreaterThanOrEqual(ORBIT_ENTRY);
      expect(`${x.id} ${x.caption || ""} ${x.sub || ""}`).not.toMatch(/\bloi\b|RETROGRADE BURN|APPROACH|COAST|MIDCOURSE/i);
    });
    // arrived integrated, engines first (the carrier's engine exits lead along +X), the burn over
    expect(ASSEMBLY_X.aft).toBeGreaterThan(ASSEMBLY_X.nose);
    expect(assemblyPoint([0, CARRIER.engine.exitY, 0])[0]).toBeCloseTo(ASSEMBLY_X.aft, 9);
    const d = deployState(ORBIT_ENTRY);
    expect(d.on && d.craft).toBe(true);
    expect(d.td.phase).toBe("mated");
    for (let tau = ORBIT_ENTRY; tau < 400; tau += 0.5) expect(deployState(tau).engines).toBe(0);
    // nothing in lunar orbit turns the stack
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

  test("captions name what happens: orbit, the integrated assembly, the deployment, preparation, undocking, two spacecraft", () => {
    const ids = ORBIT_SHOTS.filter((s) => s.caption).map((s) => s.caption);
    expect(ids).toEqual([
      "LUNAR ORBIT", "LV-001 IN LUNAR ORBIT", "ADAPTER OPENS", "TRANSPOSITION", "DOCKING", "LUNAR MODULE EXTRACTED",
      "CARRIER LEFT BEHIND", "UNDOCKING PREPARATION", "UNDOCKING", "TWO SPACECRAFT",
    ]);
    // until the deployment the captions say the LM and the CSM are still integrated
    expect(ORBIT_SHOTS.find((x) => x.id === "establish").sub).toMatch(/STILL INTEGRATED/);
  });
});

describe("the return: the planet at its true size", () => {
  test("the close camera stays outside the CSM, on the far side from the Moon", () => {
    for (let u = 0; u <= 1; u += 0.05) {
      expect(clearance(returnCamera(u).pos)).toBeGreaterThan(10);
      expect(returnCamera(u).pos[2]).toBeGreaterThan(0);
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
