import * as THREE from "three";
import {
  CM_PROFILE,
  CM_R,
  CM_SHIELD,
  DOCK_Y,
  LENGTH,
  LM_DROGUE,
  LM_M_PER_UNIT,
  PARTS,
  RCS_THRUSTERS,
  SM_BOTTOM,
  SPS,
  buildCM,
  buildSM,
  dockedLmPose,
} from "./csmDesign";
import { buildBody, TOP, RCS_THRUSTERS as LM_RCS } from "./lmDesign";

const verts = (parts) => Object.values(parts).reduce((n, g) => n + (g ? g.attributes.position.count : 0), 0);
const calls = (parts) => Object.values(parts).filter(Boolean).length;

describe("one spacecraft: Apollo-class command and service module, LUNAVIA's finish", () => {
  test("the command module is the reentry capsule's own profile (3.9 m)", () => {
    expect(CM_R * 2).toBeCloseTo(3.9, 6);
    // capsule units (diameter 1) x 3.9 m
    expect(CM_PROFILE[0]).toEqual([0.5 * 3.9, 0.06 * 3.9]);
    expect(CM_SHIELD[CM_SHIELD.length - 1]).toEqual([0.5 * 3.9, 0.06 * 3.9]);
    expect(DOCK_Y).toBeCloseTo(0.765 * 3.9, 6);
  });

  test("proportions: about 11 m from probe to engine exit, the engine longer than half the drum", () => {
    expect(LENGTH).toBeGreaterThan(10.5);
    expect(LENGTH).toBeLessThan(11.8);
    expect(SM_BOTTOM - SPS.exit).toBeGreaterThan(2.5);
    expect(SPS.exitR).toBeLessThan(CM_R);
  });

  test("every part is one merged geometry per material: a dozen draw calls, a modest vertex budget", () => {
    const cm = buildCM();
    const sm = buildSM();
    Object.keys(cm).forEach((k) => expect(PARTS).toContain(k));
    expect(calls(cm) + calls(sm)).toBeLessThanOrEqual(16);
    expect(verts(cm) + verts(sm)).toBeLessThan(60000);
  });

  test("the probe can be left off (stowed for the trip home)", () => {
    expect(verts(buildCM({ probe: false }))).toBeLessThan(verts(buildCM()));
  });

  test("four RCS quads of four thrusters, firing fore, aft and to both sides", () => {
    expect(RCS_THRUSTERS).toHaveLength(16);
    const fwd = RCS_THRUSTERS.filter((t) => t.dir[1] > 0.9);
    const aft = RCS_THRUSTERS.filter((t) => t.dir[1] < -0.9);
    expect(fwd).toHaveLength(4);
    expect(aft).toHaveLength(4);
    RCS_THRUSTERS.forEach((t) => expect(Math.hypot(t.pos[0], t.pos[2])).toBeGreaterThan(CM_R));
    expect(LM_RCS).toHaveLength(16);
  });
});

describe("the docked stack", () => {
  const pose = dockedLmPose(0);
  const lmToCsm = (p) => {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...pose.position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...pose.rotation)),
      new THREE.Vector3(pose.scale, pose.scale, pose.scale)
    );
    return new THREE.Vector3(...p).applyMatrix4(m);
  };

  test("the lunar module's drogue ring sits on the docking ring, on the spacecraft's axis", () => {
    const d = lmToCsm([0, LM_DROGUE.y, LM_DROGUE.z]);
    expect(d.x).toBeCloseTo(0, 6);
    expect(d.y).toBeCloseTo(DOCK_Y, 6);
    expect(d.z).toBeCloseTo(0, 6);
    expect(pose.scale).toBe(LM_M_PER_UNIT);
  });

  test("upside down: the lunar module's top faces the command module, its footpads point away", () => {
    expect(lmToCsm([0, TOP, 0]).y).toBeLessThan(lmToCsm([0, 0, 0]).y);
    expect(lmToCsm([0, -0.35, 0]).y).toBeGreaterThan(DOCK_Y + 4);
  });

  test("nothing of the lunar module passes through the command module", () => {
    // command module radius at height y (CSM frame), from its profile
    const prof = CM_PROFILE;
    const rAt = (y) => {
      for (let i = 1; i < prof.length; i++) {
        const [r0, y0] = prof[i - 1];
        const [r1, y1] = prof[i];
        if (y >= y0 && y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0 || 1);
      }
      return 0;
    };
    const body = buildBody();
    let checked = 0;
    Object.values(body).forEach((g) => {
      const a = g.attributes.position.array;
      for (let i = 0; i < a.length; i += 3) {
        const p = lmToCsm([a[i], a[i + 1], a[i + 2]]);
        // below the docking interface itself (the two rings meet there), down to the shoulder
        if (p.y < DOCK_Y - 0.1 && p.y > CM_PROFILE[0][1]) {
          checked++;
          expect(Math.hypot(p.x, p.z)).toBeGreaterThan(rAt(p.y) + 0.05);
        }
      }
    });
    expect(checked).toBeGreaterThan(0); // the antennas do reach past the ring, beside the cone
  });

  test("undocking opens the stack along its axis only", () => {
    const a = dockedLmPose(0);
    const b = dockedLmPose(2.5);
    expect(b.position[1] - a.position[1]).toBeCloseTo(2.5, 9);
    expect(b.position[0]).toBe(a.position[0]);
    expect(b.position[2]).toBe(a.position[2]);
    expect(b.rotation).toEqual(a.rotation);
  });
});
