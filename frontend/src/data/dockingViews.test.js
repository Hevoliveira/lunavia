import { DIFFICULTY_KEYS, PORT_B, PROBE_TIP, checkpointState, flyDocking, qAxisAngle, qMul, qNorm, qRot, referencePilot, stepDocking } from "./dockingSim";
import { EYE, FOV, MOUNT_Q, ORBIT_DEFAULT, ORBIT_LIMITS, VIEWS, WINDOW_OPENING, orbitDrag, orbitZoom, project, throughCockpitWindow, throughOpening, viewCamera } from "./dockingViews";

const DEG = Math.PI / 180;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const look = (cam) => qRot(cam.q, [0, 0, -1]);
const up = (cam) => qRot(cam.q, [0, 1, 0]);
const ASPECTS = [667 / 375, 852 / 393, 932 / 430];

describe("four distinct cameras on one simulation", () => {
  test("NAV is the docking camera the game always had: on the port's axis, looking up it, body +Z up", () => {
    for (const d of DIFFICULTY_KEYS) {
      const s = checkpointState(d);
      const cam = viewCamera("NAV", s);
      const port = s.pos.map((v, i) => v + qRot(s.q, PORT_B)[i]);
      const axis = qRot(s.q, [0, 1, 0]);
      // the previous Director: P = port − axis·0.25, looking along the axis, up = body +Z
      expect(dist(cam.pos, port.map((v, i) => v - axis[i] * 0.25))).toBeLessThan(1e-9);
      expect(dist(look(cam), axis)).toBeLessThan(1e-9);
      expect(dist(up(cam), qRot(s.q, [0, 0, 1]))).toBeLessThan(1e-9);
      expect(cam.fov).toBe(50);
    }
  });
  test("NAV, WINDOW, COCKPIT and 360° are four different cameras", () => {
    const s = checkpointState("ASTRONAUT");
    const cams = VIEWS.map((v) => viewCamera(v, s));
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++) {
        const a = cams[i];
        const b = cams[j];
        const differ = dist(a.pos, b.pos) > 0.2 || a.fov !== b.fov || dist(look(a), look(b)) > 0.05;
        expect(differ).toBe(true);
      }
    expect(new Set(cams.map((c) => c.fov)).size).toBeGreaterThanOrEqual(3);
    // the first-person eyes sit at three different places in the cabin
    expect(dist(EYE.NAV, EYE.WINDOW)).toBeGreaterThan(0.3);
    expect(dist(EYE.WINDOW, EYE.COCKPIT)).toBeGreaterThan(0.3);
    expect(FOV.COCKPIT).toBeGreaterThan(FOV.WINDOW);
  });
  test("WINDOW and COCKPIT ride with the ascent stage: they move and turn exactly with it", () => {
    const s = checkpointState("COMMANDER");
    for (const v of ["NAV", "WINDOW", "COCKPIT"]) {
      const a = viewCamera(v, s);
      const turn = qAxisAngle([0.3, 1, -0.2], 25 * DEG);
      const s2 = { ...s, pos: [s.pos[0] + 2, s.pos[1] - 3, s.pos[2] + 1], q: qNorm(qMul(turn, s.q)) };
      const b = viewCamera(v, s2);
      // the camera's view direction turned by exactly the vehicle's rotation
      expect(dist(look(b), qRot(turn, look(a)))).toBeLessThan(1e-9);
      expect(dist(up(b), qRot(turn, up(a)))).toBeLessThan(1e-9);
      // and its eye stayed at the same place in the cabin
      const eyeA = qRot(s.q, EYE[v]);
      const eyeB = qRot(s2.q, EYE[v]);
      expect(dist(a.pos, s.pos.map((x, i) => x + eyeA[i]))).toBeLessThan(1e-9);
      expect(dist(b.pos, s2.pos.map((x, i) => x + eyeB[i]))).toBeLessThan(1e-9);
      expect(dist(qRot(MOUNT_Q, [0, 0, -1]), [0, 1, 0])).toBeLessThan(1e-12);
    }
  });
  test("a view never writes the simulation", () => {
    const s = checkpointState("CADET");
    const before = JSON.stringify(s);
    VIEWS.forEach((v) => viewCamera(v, s, { az: 1, el: 0.3, dist: 20 }));
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("the target stays in sight through the approach", () => {
  test("NAV, WINDOW and COCKPIT see the probe tip from the checkpoint to contact (all difficulties, iPhone aspects), WINDOW and COCKPIT through their window openings", () => {
    for (const d of DIFFICULTY_KEYS) {
      const s = checkpointState(d);
      const pilot = referencePilot(d, { lag: 0.25 });
      let n = 0;
      let cmd = { t: [0, 0, 0], r: [0, 0, 0] };
      for (let k = 0; k < 120 * 900 && s.status === "approach"; k++) {
        if (k % 15 === 0) cmd = pilot(s);
        stepDocking(s, cmd, d, 1 / 120, { align: d === "CADET" });
        if (k % 240 !== 0 || s.status !== "approach") continue;
        for (const v of ["NAV", "WINDOW", "COCKPIT"]) {
          const cam = viewCamera(v, s);
          for (const a of ASPECTS) {
            const p = project(cam, PROBE_TIP, a);
            expect(p.front).toBe(true);
            expect(Math.abs(p.x)).toBeLessThan(1);
            expect(Math.abs(p.y)).toBeLessThan(1);
          }
          if (v === "COCKPIT") expect(throughCockpitWindow(cam, PROBE_TIP)).toBe(true);
          if (v === "WINDOW") expect(throughOpening(cam, PROBE_TIP, WINDOW_OPENING)).toBe(true);
        }
        n++;
      }
      expect(s.status).toBe("captured");
      expect(n).toBeGreaterThan(20);
    }
  });
});

describe("360°: a free camera around the ascent stage", () => {
  test("it starts on the chase framing and sees both vehicles at the checkpoint", () => {
    for (const d of DIFFICULTY_KEYS) {
      const s = checkpointState(d);
      const cam = viewCamera("ORBIT", s);
      expect(dist(cam.pos, [s.pos[0] - 6, s.pos[1] + 9, s.pos[2] + 5.5])).toBeLessThan(1e-9);
      const lm = project(cam, s.pos);
      expect(Math.abs(lm.x)).toBeLessThan(1e-9); // the ascent stage at the centre
      for (const a of ASPECTS) {
        const csm = project(cam, [0, 1, 0], a);
        expect(csm.front && Math.abs(csm.x) < 1 && Math.abs(csm.y) < 1).toBe(true);
      }
    }
  });
  test("it orbits in the CSM's frame: the vehicle's attitude does not move it", () => {
    const s = checkpointState("COMMANDER");
    const a = viewCamera("ORBIT", s, { az: 0.7, el: -0.2, dist: 15 });
    const b = viewCamera("ORBIT", { ...s, q: qNorm(qMul(qAxisAngle([1, 1, 0], 1.1), s.q)) }, { az: 0.7, el: -0.2, dist: 15 });
    expect(dist(a.pos, b.pos)).toBeLessThan(1e-12);
    expect(dist(look(a), look(b))).toBeLessThan(1e-12);
  });
  test("drag goes all the way round and over; pinch zooms within limits; reset is the default", () => {
    let o = ORBIT_DEFAULT;
    o = orbitDrag(o, 1000, 0);
    expect(Math.abs(o.az - ORBIT_DEFAULT.az)).toBeCloseTo(2 * Math.PI, 1); // ~1000 px: a full turn
    o = orbitDrag(o, 0, 5000);
    expect(o.el).toBe(ORBIT_LIMITS.el); // over the top, never past the pole
    o = orbitDrag(o, 0, -10000);
    expect(o.el).toBe(-ORBIT_LIMITS.el); // and under: the Moon below
    expect(orbitZoom(o, 100).dist).toBe(Math.max(ORBIT_LIMITS.distMin, o.dist / 5));
    let z = o;
    for (let k = 0; k < 40; k++) z = orbitZoom(z, 1.5);
    expect(z.dist).toBe(ORBIT_LIMITS.distMin);
    for (let k = 0; k < 40; k++) z = orbitZoom(z, 0.5);
    expect(z.dist).toBe(ORBIT_LIMITS.distMax);
    // every pose is a valid camera looking at the vehicle
    for (let az = -3; az <= 3; az += 0.5)
      for (let el = -1.45; el <= 1.45; el += 0.29) {
        const s = checkpointState("ASTRONAUT");
        const cam = viewCamera("ORBIT", s, { az, el, dist: 12 });
        const p = project(cam, s.pos);
        expect(Math.abs(p.x) + Math.abs(p.y)).toBeLessThan(1e-6);
        expect(cam.q.every(Number.isFinite)).toBe(true);
      }
  });
});

describe("one simulation under every view", () => {
  test("flying the same inputs while switching views every few frames gives the identical flight", () => {
    for (const d of DIFFICULTY_KEYS) {
      const a = checkpointState(d);
      const b = checkpointState(d);
      const pa = referencePilot(d, { lag: 0.25 });
      const pb = referencePilot(d, { lag: 0.25 });
      let ca = { t: [0, 0, 0], r: [0, 0, 0] };
      let cb = ca;
      for (let k = 0; k < 120 * 300; k++) {
        if (k % 15 === 0) {
          ca = pa(a);
          cb = pb(b);
        }
        stepDocking(a, ca, d, 1 / 120, { align: d === "CADET" });
        // b's frames are drawn through a different view each time; the views only read it
        viewCamera(VIEWS[k % 4], b, { az: k * 0.01, el: 0.2, dist: 10 });
        stepDocking(b, cb, d, 1 / 120, { align: d === "CADET" });
      }
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });
  test("a docking completes in each view's camera (the flight never depends on the view)", () => {
    for (const v of VIEWS) {
      const r = flyDocking("ASTRONAUT", referencePilot("ASTRONAUT"), {});
      viewCamera(v, r.state);
      expect(r.docked).toBe(true);
    }
  });
});
