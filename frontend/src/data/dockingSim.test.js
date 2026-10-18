import {
  DAMAGE_SPEED,
  DIFFICULTY_KEYS,
  DOCKED_POS,
  DOCKED_Q,
  DOCKING,
  DROGUE_R,
  MEAN_MOTION,
  PORT_B,
  PROBE_TIP,
  checkpointState,
  csmRadiusAt,
  dockingStatus,
  flyDocking,
  frames,
  judgeContact,
  portState,
  qAxisAngle,
  qMul,
  referencePilot,
  stepDocking,
  telemetry,
} from "./dockingSim";
import { DOCK_Y as CSM_DOCK_Y, PROBE_L as CSM_PROBE_L, LM_DROGUE, LM_M_PER_UNIT, dockedLmPose } from "./csmDesign";

const DEG = Math.PI / 180;
const NONE = { t: [0, 0, 0], r: [0, 0, 0] };
const run = (s, input, d, seconds, opts) => {
  const events = [];
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    const e = stepDocking(s, typeof input === "function" ? input(s) : input, d, 1 / 60, opts);
    if (e) events.push(e);
  }
  return events;
};
// The ascent stage `axial` metres from the probe tip, at the docking attitude q (default: exact).
function nearContact(d, { axial = 0.3, lateral = [0, 0], closing = 0.08, vLat = [0, 0], q = DOCKED_Q } = {}) {
  const s = checkpointState(d);
  s.q = q.slice();
  s.w = [0, 0, 0];
  const pB = portState({ ...s, pos: [0, 0, 0] }).port; // port offset in the CSM frame at this attitude
  s.pos = [lateral[0] - pB[0], PROBE_TIP[1] + axial - pB[1], lateral[1] - pB[2]];
  s.vel = [vLat[0], -closing, vLat[1]];
  return s;
}

describe("geometry: the same docking interface as the 3D models", () => {
  test("the probe, the docking ring and the drogue are csmDesign's; docked, the drogue sits on the ring", () => {
    expect(PROBE_TIP[1]).toBeCloseTo(CSM_DOCK_Y + CSM_PROBE_L, 9);
    // the docked ascent stage's port (drogue ring) is on the CSM's docking ring
    const s = checkpointState("ASTRONAUT");
    s.pos = DOCKED_POS.slice();
    s.q = DOCKED_Q.slice();
    const { port, axis } = portState(s);
    expect(port[1]).toBeCloseTo(CSM_DOCK_Y, 9);
    expect(Math.hypot(port[0], port[2])).toBeLessThan(1e-9);
    expect(axis[1]).toBeCloseTo(-1, 9); // the drogue looks down the probe
    // and the same point as SpacecraftStack's docked LM (dockedLmPose): drogue = LM_DROGUE in the LM model
    const pose = dockedLmPose(0);
    expect(pose.position[1] - LM_DROGUE.y * LM_M_PER_UNIT).toBeCloseTo(port[1], 9);
    expect(PORT_B[1]).toBeGreaterThan(1); // the tunnel is above the ascent stage's centre
    expect(DROGUE_R).toBeCloseTo(0.42, 2);
  });
  test("the CSM's hull: command module cone to the docking ring, service module drum below", () => {
    expect(csmRadiusAt(CSM_DOCK_Y + 0.1)).toBe(0);
    expect(csmRadiusAt(2.9)).toBeLessThan(0.45);
    expect(csmRadiusAt(0.5)).toBeGreaterThan(1.7);
    expect(csmRadiusAt(-3)).toBeCloseTo(1.95, 6);
  });
});

describe("relative motion in lunar orbit (Clohessy–Wiltshire)", () => {
  test("coasting with no input follows the closed-form CW solution", () => {
    const s = checkpointState("COMMANDER");
    s.pos = [6, 120, -4];
    s.vel = [0.02, -0.05, 0.01];
    s.w = [0, 0, 0];
    s.q = DOCKED_Q.slice();
    const [x0, y0, z0] = frames.toL(s.pos);
    const [vx0, vy0, vz0] = frames.toL(s.vel);
    const T = 240;
    run(s, NONE, "COMMANDER", T);
    const n = MEAN_MOTION;
    const c = Math.cos(n * T);
    const sn = Math.sin(n * T);
    const x = (4 - 3 * c) * x0 + (sn / n) * vx0 + (2 / n) * (1 - c) * vy0;
    const y = 6 * (sn - n * T) * x0 + y0 - (2 / n) * (1 - c) * vx0 + ((4 * sn - 3 * n * T) / n) * vy0;
    const z = c * z0 + (sn / n) * vz0;
    const got = frames.toL(s.pos);
    expect(got[0]).toBeCloseTo(x, 1);
    expect(got[1]).toBeCloseTo(y, 1);
    expect(got[2]).toBeCloseTo(z, 1);
    // and the orbit's pull is real over a docking approach: not a straight line
    expect(Math.abs(got[0] - (x0 + vx0 * T))).toBeGreaterThan(0.1);
    expect(s.prop).toBe(DOCKING.COMMANDER.prop); // nothing fired
  });
});

describe("the pilot's RCS: translation, attitude, inertia", () => {
  test("translation commands act along the ascent stage's own axes, and the velocity stays when the jets stop", () => {
    const d = "ASTRONAUT";
    const s = checkpointState(d);
    s.q = DOCKED_Q.slice();
    s.w = [0, 0, 0];
    s.vel = [0, 0, 0];
    run(s, { t: [0, 1, 0], r: [0, 0, 0] }, d, 1); // forward 1 s: towards the probe (−Y)
    expect(s.vel[1]).toBeCloseTo(-DOCKING[d].accel, 2);
    const v = s.vel.slice();
    run(s, NONE, d, 5); // inertia: still moving
    expect(s.vel[1]).toBeCloseTo(v[1], 3);
    run(s, { t: [1, 0, 0], r: [0, 0, 0] }, d, 1); // right: body +X = CSM −X at the docking attitude
    expect(s.vel[0]).toBeCloseTo(-DOCKING[d].accel, 2);
    run(s, { t: [0, 0, 1], r: [0, 0, 0] }, d, 1); // up: body +Z = CSM +Z
    expect(s.vel[2]).toBeCloseTo(DOCKING[d].accel, 2);
    expect(s.prop).toBeLessThan(DOCKING[d].prop);
  });
  test("attitude: a pulse starts a rotation that persists with no hold (COMMANDER), and is damped by attitude hold (ASTRONAUT)", () => {
    for (const [d, persists] of [
      ["COMMANDER", true],
      ["ASTRONAUT", false],
    ]) {
      const s = checkpointState(d);
      s.q = DOCKED_Q.slice();
      s.w = [0, 0, 0];
      run(s, { t: [0, 0, 0], r: [1, 0, 0] }, d, 0.5);
      const w0 = s.w[0];
      expect(w0).toBeCloseTo(DOCKING[d].angAccel * 0.5, 3);
      run(s, NONE, d, 5);
      if (persists) expect(s.w[0]).toBeCloseTo(w0, 6);
      else expect(Math.abs(s.w[0])).toBeLessThan(0.1 * w0);
      expect(Math.abs(telemetry(s, d).pitch)).toBeGreaterThan(0.2 * DEG); // the attitude moved
    }
  });
  test("CADET's docking-attitude hold brings the ascent stage onto the docking attitude by itself (translation stays the pilot's)", () => {
    const s = checkpointState("CADET");
    const before = telemetry(s, "CADET").angle;
    const p0 = s.pos.slice();
    run(s, NONE, "CADET", 30, { align: true });
    expect(telemetry(s, "CADET").angle).toBeLessThan(0.15 * before);
    // it does not translate for the pilot
    expect(Math.hypot(s.pos[0] - p0[0] - s.vel[0] * 0, s.pos[2] - p0[2])).toBeGreaterThan(0.2); // the start's drift is still there
  });
});

describe("docking: capture only on the real geometry", () => {
  test("aligned and gentle: capture, then the probe retracts to a hard dock on the ring", () => {
    for (const d of DIFFICULTY_KEYS) {
      const s = nearContact(d, { closing: Math.min(0.1, DOCKING[d].tol.vMax * 0.6) });
      const ev = run(s, NONE, d, 12);
      expect(ev.map((e) => e.kind)).toEqual(["capture", "docked"]);
      expect(s.status).toBe("docked");
      expect(portState(s).port[1]).toBeCloseTo(CSM_DOCK_Y, 6);
      expect(dockingStatus(s, d).phase).toBe("HARD DOCK CONFIRMED");
    }
  });
  test("visibly misaligned: no capture (deflected, recoverable) — one tolerance at a time", () => {
    const d = "ASTRONAUT";
    const t = DOCKING[d].tol;
    const cases = [
      ["MISALIGNED", { q: qMul(DOCKED_Q, qAxisAngle([1, 0, 0], t.angle * 1.6)) }],
      ["OFF AXIS", { lateral: [t.lateral * 1.5, 0] }],
      ["TOO FAST", { closing: t.vMax * 1.3 }],
      ["TOO SLOW TO LATCH", { closing: t.vMin * 0.5, axial: 0.04 }],
      ["LATERAL DRIFT", { vLat: [t.vLat * 1.6, 0] }],
      ["ROLL", { q: qMul(DOCKED_Q, qAxisAngle([0, 1, 0], t.roll * 1.6)) }],
    ];
    for (const [reason, over] of cases) {
      const s = nearContact(d, over);
      const ev = run(s, NONE, d, 8);
      expect(ev[0].kind).toBe("deflected");
      expect(ev[0].reasons).toContain(reason);
      expect(s.status).toBe("approach"); // recoverable: the vehicles push apart
      expect(s.contacts).toBe(1);
      expect(telemetry(s, d).closing).toBeLessThan(0); // opening after the rebound
    }
  });
  test("the same approach is accepted by CADET's tolerances and refused by COMMANDER's", () => {
    const over = { lateral: [0.18, 0], closing: 0.2, q: qMul(DOCKED_Q, qAxisAngle([0, 0, 1], 4 * DEG)) };
    expect(run(nearContact("CADET", over), NONE, "CADET", 12).map((e) => e.kind)).toContain("docked");
    const ev = run(nearContact("COMMANDER", over), NONE, "COMMANDER", 3);
    expect(ev[0].kind).toBe("deflected");
  });
  test("the probe outside the drogue's mouth strikes the deck (recoverable); a hard impact is not", () => {
    const d = "ASTRONAUT";
    const s = nearContact(d, { lateral: [DROGUE_R * 1.4, 0] });
    const ev = run(s, NONE, d, 6);
    expect(ev[0].kind).toBe("outside");
    expect(s.status).toBe("approach");
    const hard = nearContact(d, { closing: DAMAGE_SPEED * 1.2 });
    const ev2 = run(hard, NONE, d, 3);
    expect(ev2[0].kind).toBe("damage");
    expect(hard.status).toBe("failed");
  });
  test("hitting the command module's side is a collision", () => {
    const d = "ASTRONAUT";
    const s = checkpointState(d);
    s.q = DOCKED_Q.slice();
    s.w = [0, 0, 0];
    s.pos = [4.5, 1.2, 0]; // beside the command module's cone, outside the probe's corridor
    s.vel = [-0.4, 0, 0];
    const ev = run(s, NONE, d, 10);
    expect(ev[0].kind).toBe("collision");
    expect(s.status).toBe("failed");
    // a slow touch is only a bump
    const b = checkpointState(d);
    b.q = DOCKED_Q.slice();
    b.w = [0, 0, 0];
    b.pos = [4.5, 1.2, 0];
    b.vel = [-0.06, 0, 0];
    const evb = run(b, NONE, d, 40);
    expect(evb[0].kind).toBe("collision");
    expect(b.status).toBe("approach");
  });
});

describe("all three difficulties are achievable; mistakes are recoverable; retries start clean", () => {
  test("the reference pilot (reaction time, pulses only) docks at CADET, ASTRONAUT and COMMANDER", () => {
    for (const d of DIFFICULTY_KEYS) {
      for (const lag of [0.25, 0.4]) {
        const r = flyDocking(d, referencePilot(d, { lag }), { lag });
        expect([d, lag, r.state.status]).toEqual([d, lag, "docked"]);
        expect(r.state.prop).toBeGreaterThan(0.25 * DOCKING[d].prop);
        expect(r.t).toBeLessThan(600);
      }
    }
  });
  test("COMMANDER is the strictest and leanest; CADET the most forgiving", () => {
    const [c, a, m] = DIFFICULTY_KEYS.map((k) => DOCKING[k]);
    expect(c.tol.lateral).toBeGreaterThan(a.tol.lateral);
    expect(a.tol.lateral).toBeGreaterThan(m.tol.lateral);
    expect(c.tol.angle).toBeGreaterThan(m.tol.angle);
    expect(c.prop).toBeGreaterThan(m.prop);
    expect([c.attHold, a.attHold, m.attHold]).toEqual([true, true, false]);
    expect([c.autoAlign, a.autoAlign, m.autoAlign]).toEqual([true, false, false]);
    // not frame-perfect: COMMANDER's capture window is centimetres and degrees, not millimetres
    expect(m.tol.lateral).toBeGreaterThanOrEqual(0.1);
    expect(m.tol.angle).toBeGreaterThanOrEqual(3 * DEG);
  });
  test("a deflected first contact can be followed by a successful one", () => {
    const d = "ASTRONAUT";
    const s = nearContact(d, { lateral: [0.3, 0], axial: 0.4 });
    const ev = run(s, NONE, d, 6);
    expect(ev[0].kind).toBe("deflected");
    const r = flyDocking(d, referencePilot(d), { state: s });
    expect(r.state.status).toBe("docked");
    expect(r.state.contacts).toBe(1);
  });
  test("a retry starts again from the same rendezvous checkpoint: same state, full propellant", () => {
    for (const d of DIFFICULTY_KEYS) {
      const a = checkpointState(d);
      run(a, { t: [0, 1, 1], r: [1, 0, 0] }, d, 5);
      const b = checkpointState(d);
      const c = checkpointState(d);
      expect(b).toEqual(c);
      expect(b.prop).toBe(DOCKING[d].prop);
      expect(b.status).toBe("approach");
      expect(telemetry(b, d).axial).toBeCloseTo(DOCKING[d].start.range, 1);
    }
  });
  test("drifting away loses the target; running dry is a failure, not a hang", () => {
    const d = "ASTRONAUT";
    const s = checkpointState(d);
    s.vel = [0, 2, 0];
    const ev = run(s, NONE, d, 120);
    expect(ev.map((e) => e.kind)).toContain("lost");
    const p = checkpointState(d);
    p.prop = 0;
    p.vel = [0, 0.01, 0]; // opening slowly, no propellant to stop
    const evp = run(p, NONE, d, 40);
    expect(evp.map((e) => e.kind)).toContain("propellant");
  });
});

describe("HUD status from the state", () => {
  test("acquire → align → final approach, and warnings for speed and drift", () => {
    const d = "ASTRONAUT";
    const s = checkpointState(d);
    expect(dockingStatus(s, d).phase).toMatch(/ACQUIRE|ALIGN/);
    const f = nearContact(d, { axial: 3, closing: 0.08 });
    expect(dockingStatus(f, d).phase).toBe("FINAL APPROACH");
    const fast = nearContact(d, { axial: 3, closing: 0.9 });
    expect(dockingStatus(fast, d).warnings).toContain("REDUCE CLOSING VELOCITY");
    const drift = nearContact(d, { axial: 3, vLat: [0.2, 0] });
    expect(dockingStatus(drift, d).warnings).toContain("LATERAL DRIFT");
  });
});
