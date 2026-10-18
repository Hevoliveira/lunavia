import { COAST, FINAL, GATE, INSERTION, PERIOD, TRANSFER, cwPropagate, cwTarget, planRendezvous, playToMission, PLAY_S, rangeOf } from "./rendezvous";
import { DIFFICULTY_KEYS, checkpointState, cwAccel, frames } from "./dockingSim";

// Numerical integration of the same dynamics as the docking simulator (CSM frame), burns applied as impulses.
function integrate(plan, h = 0.5) {
  let pos = frames.fromL(plan.insertion.slice(0, 3));
  let vel = frames.fromL(plan.insertion.slice(3));
  let t = 0;
  const burns = plan.burns.slice();
  while (t < plan.total - 1e-9) {
    const next = burns.length ? burns[0].t : plan.total;
    const step = Math.min(h, next - t);
    // RK4
    const f = (p, v) => [v, cwAccel(p, v)];
    const add = (a, b, k) => a.map((x, i) => x + b[i] * k);
    const [k1p, k1v] = f(pos, vel);
    const [k2p, k2v] = f(add(pos, k1p, step / 2), add(vel, k1v, step / 2));
    const [k3p, k3v] = f(add(pos, k2p, step / 2), add(vel, k2v, step / 2));
    const [k4p, k4v] = f(add(pos, k3p, step), add(vel, k3v, step));
    pos = pos.map((x, i) => x + (step / 6) * (k1p[i] + 2 * k2p[i] + 2 * k3p[i] + k4p[i]));
    vel = vel.map((x, i) => x + (step / 6) * (k1v[i] + 2 * k2v[i] + 2 * k3v[i] + k4v[i]));
    t += step;
    if (burns.length && Math.abs(t - burns[0].t) < 1e-6) {
      vel = vel.map((v, i) => v + frames.fromL(burns[0].dv)[i]);
      burns.shift();
    }
  }
  return { pos, vel };
}

describe("automatic rendezvous: insertion to the docking checkpoint", () => {
  test("the closed-form CW propagation agrees with numerical integration of the docking simulator's dynamics", () => {
    const plan = planRendezvous("ASTRONAUT");
    const s = plan.sample(COAST - 1);
    const num = (() => {
      const p = { ...plan, burns: [], total: COAST - 1 };
      return integrate(p, 0.25);
    })();
    const L = frames.toL(num.pos);
    expect(L[0]).toBeCloseTo(s[0], 0);
    expect(L[1]).toBeCloseTo(s[1], 0);
  });
  test("for every difficulty, the guidance arrives on that difficulty's checkpoint (position and velocity), within centimetres", () => {
    for (const d of DIFFICULTY_KEYS) {
      const plan = planRendezvous(d);
      const end = integrate(plan, 0.25);
      const cp = checkpointState(d);
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(end.pos[i] - cp.pos[i])).toBeLessThan(0.05);
        expect(Math.abs(end.vel[i] - cp.vel[i])).toBeLessThan(0.002);
      }
    }
  });
  test("a believable lunar rendezvous: lower and behind, catching up; TPI, midcourse, gate and braking burns; a modest Δv", () => {
    const plan = planRendezvous("CADET");
    expect(plan.insertion[0]).toBe(INSERTION.x); // 14 km below
    expect(plan.insertion[4]).toBeGreaterThan(15); // faster: closing on the CSM along the orbit
    expect(plan.burns.map((b) => b.kind)).toEqual(["TPI", "MCC", "GATE", "BRAKING"]);
    expect(plan.totalDv).toBeGreaterThan(5); // Apollo-like terminal phase: a few m/s per burn
    expect(plan.totalDv).toBeLessThan(60);
    // the TPI executed with an error that the MCC corrects (not zero)
    const mcc = plan.burns[1].dv;
    expect(Math.hypot(...mcc)).toBeGreaterThan(0.05);
    expect(plan.total).toBeCloseTo(COAST + TRANSFER + FINAL, 6);
    expect(TRANSFER / PERIOD).toBeCloseTo(130 / 360, 6);
    // range: tens of km at insertion, tens of metres at handover
    expect(rangeOf(plan.sample(0)).range).toBeGreaterThan(40000);
    expect(rangeOf(plan.sample(plan.total)).range).toBeLessThan(60);
    // and it closes: tens of km before TPI, ~1 km at the gate, then steadily down the final approach
    expect(rangeOf(plan.sample(COAST)).range).toBeGreaterThan(20000);
    expect(rangeOf(plan.sample(COAST + TRANSFER)).range).toBeLessThan(1300);
    const r = [0, 0.25, 0.5, 0.75, 1].map((k) => rangeOf(plan.sample(COAST + TRANSFER + k * FINAL)).range);
    for (let i = 1; i < r.length; i++) expect(r[i]).toBeLessThan(r[i - 1]);
    // TPI at the Apollo elevation angle: the CSM 27° above the ascent stage's horizon
    const t = plan.sample(COAST);
    expect((Math.atan2(-t[0], -t[1]) * 180) / Math.PI).toBeCloseTo(27, 3);
  });
  test("CW targeting solves its boundary problem", () => {
    const r0 = [-5000, -20000, 300];
    const r1 = [10, -40, -2];
    const v = cwTarget(r0, r1, 2000);
    const s = cwPropagate([...r0, ...v], 2000);
    expect(s[0]).toBeCloseTo(r1[0], 6);
    expect(s[1]).toBeCloseTo(r1[1], 6);
    expect(s[2]).toBeCloseTo(r1[2], 6);
  });
  test("the film's clock covers the whole rendezvous, slowing at the end", () => {
    const plan = planRendezvous("ASTRONAUT");
    expect(playToMission(0, plan)).toBe(0);
    expect(playToMission(PLAY_S, plan)).toBeCloseTo(plan.total, 6);
    const early = playToMission(1, plan) - playToMission(0, plan);
    const late = playToMission(PLAY_S, plan) - playToMission(PLAY_S - 1, plan);
    expect(late).toBeLessThan(early / 20);
  });
  test("safe: the path never comes closer to the CSM than the checkpoint, and the last kilometre is flown from behind", () => {
    for (const d of DIFFICULTY_KEYS) {
      const plan = planRendezvous(d);
      const end = rangeOf(plan.sample(plan.total)).range;
      let minR = Infinity;
      for (let t = COAST; t <= plan.total; t += 2) {
        const s = plan.sample(t);
        const r = rangeOf(s).range;
        minR = Math.min(minR, r);
        if (r < 1500) expect(s[1]).toBeLessThan(0); // behind the CSM (−V-bar)
      }
      expect(minR).toBeGreaterThan(end - 0.5);
      // the gate is reached on the transfer arc
      const g = plan.sample(COAST + TRANSFER);
      expect(Math.hypot(g[0] - GATE[0], g[1] - GATE[1], g[2] - GATE[2])).toBeLessThan(0.5);
      // the final approach is slow
      const v = plan.sample(COAST + TRANSFER + FINAL / 2).slice(3);
      expect(Math.hypot(...v)).toBeLessThan(3);
    }
  });
});
