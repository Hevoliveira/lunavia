import {
  DOCKING,
  PULSE,
  FINE_SCALE,
  JET_SOFT,
  assistLimit,
  assistsOf,
  checkpointState,
  disengageStabilize,
  dockingStatus,
  engageStabilize,
  jetCommand,
  restoreCheckpoint,
  stepDocking,
  telemetry,
  vec,
} from "./dockingSim";
import { SEQUENCE, assistSequence, createGuidance, commandOf, evaluate, guidanceText, guidedPilot } from "./dockingGuidance";

/*
 * Assisted docking: AUTO-ALIGN, STABILIZE, the APPROACH SPEED ASSIST, CADET's soft capture,
 * the calmer CADET checkpoint and the progressive jet buttons. Every assist flies the same
 * RCS as the pilot (authority, propellant); nothing is set, nothing docks by itself. The
 * playthroughs at the end are input-driven: simulated pilots press only what a player can
 * press (jet buttons, AUTO-ALIGN, STABILIZE), reading the state with a human reaction time.
 */
const DEG = Math.PI / 180;
const DT = 1 / 60;
const NONE = { t: [0, 0, 0], r: [0, 0, 0] };
const run = (s, cmd, d, secs, opts = {}, each = null) => {
  const events = [];
  for (let i = 0; i < Math.round(secs / DT); i++) {
    const before = { vel: s.vel.slice(), w: s.w.slice(), q: s.q.slice() };
    const e = stepDocking(s, typeof cmd === "function" ? cmd(s) : cmd, d, DT, opts);
    if (each) each(s, before);
    if (e) events.push(e);
    if (s.status === "docked" || s.status === "failed") break;
  }
  return events;
};

describe("the assists by difficulty", () => {
  test("CADET has all three, ASTRONAUT a one-shot STABILIZE, COMMANDER nothing (switching them on does nothing)", () => {
    expect(assistsOf("CADET", { align: true, speed: true })).toEqual({ align: true, stabilize: "hold", speed: true });
    expect(assistsOf("ASTRONAUT", { align: true, speed: true })).toEqual({ align: false, stabilize: "once", speed: false });
    expect(assistsOf("COMMANDER", { align: true, speed: true })).toEqual({ align: false, stabilize: null, speed: false });
    const c = checkpointState("COMMANDER");
    expect(engageStabilize(c, "COMMANDER")).toBe(false);
    expect(c.stab).toBeUndefined();
    // COMMANDER asking for every assist flies exactly as with none
    const a = checkpointState("COMMANDER");
    const b = checkpointState("COMMANDER");
    run(a, NONE, "COMMANDER", 20, { align: true, speed: true });
    run(b, NONE, "COMMANDER", 20, {});
    expect(a.pos).toEqual(b.pos);
    expect(a.q).toEqual(b.q);
  });
});

describe("AUTO-ALIGN: the autopilot turns onto the docking axis with the RCS", () => {
  test("turns gradually within the RCS's rate limit, reaches DOCKING AXIS ALIGNED, and does not translate", () => {
    const s = checkpointState("CADET", { att: [12, -8, 15], drift: [0, 0], offset: [0, 0], closing: 0 });
    const a0 = telemetry(s, "CADET").angle;
    const p0 = s.pos.slice();
    let maxStep = 0;
    const statuses = new Set();
    run(s, NONE, "CADET", 40, { align: true }, (st, before) => {
      maxStep = Math.max(maxStep, Math.acos(Math.min(1, Math.abs(vec.dot(before.q.slice(0, 3), st.q.slice(0, 3)) + before.q[3] * st.q[3]))) * 2);
      statuses.add(st.assistOut.align);
    });
    expect(a0).toBeGreaterThan(15 * DEG);
    expect(telemetry(s, "CADET").angle).toBeLessThan(1 * DEG);
    expect(maxStep).toBeLessThan(DOCKING.CADET.maxRate * 1.5 * DT * 1.01); // no jump: never faster than the RCS turns
    expect([...statuses]).toEqual(expect.arrayContaining(["active", "aligned"]));
    expect(s.assistOut.align).toBe("aligned");
    // the orbit moves it a little; the autopilot itself never pushes sideways
    expect(Math.hypot(s.pos[0] - p0[0], s.pos[2] - p0[2])).toBeLessThan(0.02);
    expect(s.prop).toBeLessThan(DOCKING.CADET.prop); // it used RCS propellant
  });
  test("a held attitude button overrides it while held", () => {
    const s = checkpointState("CADET", { att: [0, 0, 0], drift: [0, 0] });
    run(s, { t: [0, 0, 0], r: [1, 0, 0] }, "CADET", 1, { align: true });
    expect(s.assistOut.align).toBe("override");
    expect(Math.abs(telemetry(s, "CADET").pitch)).toBeGreaterThan(0.5 * DEG);
    run(s, NONE, "CADET", 20, { align: true });
    expect(s.assistOut.align).toBe("aligned");
  });
});

describe("STABILIZE: the RCS cancels the relative motion", () => {
  test("CADET: drift and an unsafe closing speed die away through thrust (never faster than the RCS can), then RELATIVE MOTION STABLE", () => {
    const s = checkpointState("CADET", { drift: [0.08, -0.06], closing: 0.9, range: 30 });
    expect(engageStabilize(s, "CADET")).toBe(true);
    const lim = assistLimit(telemetry(s, "CADET").axial);
    expect(-s.stab.v[1]).toBeCloseTo(lim, 6); // the held closing speed is the safe one
    let maxAcc = 0;
    const seen = new Set();
    run(s, NONE, "CADET", 15, {}, (st, before) => {
      maxAcc = Math.max(maxAcc, vec.len(vec.sub(st.vel, before.vel)) / DT);
      seen.add(st.assistOut.stabilize);
    });
    expect(maxAcc).toBeLessThan(DOCKING.CADET.accel * Math.sqrt(3) + 0.002); // RCS authority (+ the orbit's own pull)
    expect([...seen]).toEqual(expect.arrayContaining(["active", "stable"]));
    const m = telemetry(s, "CADET");
    expect(Math.hypot(s.vel[0], s.vel[2])).toBeLessThan(0.005);
    expect(m.closing).toBeLessThan(assistLimit(m.axial) + 0.01);
    expect(s.prop).toBeLessThan(DOCKING.CADET.prop - 0.5); // paid in propellant
  });
  test("CADET's hold keeps the orbit's drift away for minutes, and a tap sets a new steady slide", () => {
    const free = checkpointState("CADET", { drift: [0, 0], offset: [0, 0], closing: 0.2, att: [0, 0, 0] });
    const held = checkpointState("CADET", { drift: [0, 0], offset: [0, 0], closing: 0.2, att: [0, 0, 0] });
    engageStabilize(held, "CADET");
    run(free, NONE, "CADET", 60);
    run(held, NONE, "CADET", 60);
    expect(telemetry(free, "CADET").offsetR).toBeGreaterThan(0.3); // Coriolis carries the free one off the axis
    expect(telemetry(held, "CADET").offsetR).toBeLessThan(0.05);
    // a tap right: a steady slide at one tap's Δv, kept, not cancelled
    const s = checkpointState("CADET", { drift: [0, 0], offset: [0, 0], closing: 0 });
    engageStabilize(s, "CADET");
    run(s, NONE, "CADET", 3);
    run(s, { t: [1, 0, 0], r: [0, 0, 0] }, "CADET", PULSE);
    const v1 = telemetry(s, "CADET").vLat[0];
    run(s, NONE, "CADET", 20);
    expect(Math.abs(v1)).toBeGreaterThan(0.6 * DOCKING.CADET.accel * PULSE);
    expect(telemetry(s, "CADET").vLat[0]).toBeCloseTo(v1, 3);
    disengageStabilize(s);
    expect(s.stab).toBeNull();
  });
  test("ASTRONAUT: one-shot — it nulls, says RELATIVE MOTION STABLE and hands back; a translation command cancels it", () => {
    const s = checkpointState("ASTRONAUT", { drift: [0.05, 0.04] });
    engageStabilize(s, "ASTRONAUT");
    const seen = new Set();
    run(s, NONE, "ASTRONAUT", 25, {}, (st) => seen.add(st.assistOut.stabilize));
    expect(seen.has("done")).toBe(true);
    expect(s.stab).toBeNull();
    expect(Math.hypot(s.vel[0], s.vel[2])).toBeLessThan(0.006);
    const o = checkpointState("ASTRONAUT", { drift: [0.05, 0.04] });
    engageStabilize(o, "ASTRONAUT");
    run(o, { t: [0, 0, 1], r: [0, 0, 0] }, "ASTRONAUT", 0.2);
    expect(o.stab).toBeNull();
    expect(o.assistOut.stabilize).toBe("override");
  });
});

describe("APPROACH SPEED ASSIST: brakes through the RCS, never pushes forward", () => {
  test("holding FWD all the way in never closes faster than the limit for the distance", () => {
    const s = checkpointState("CADET", { offset: [0, 0], drift: [0, 0], att: [0, 0, 0], closing: 0 });
    // STABILIZE holds the axis against the orbit's drift (without it the Coriolis pull carries
    // the vehicle ~2 m off the axis on the way in, and it passes beside the probe)
    engageStabilize(s, "CADET");
    let worst = 0;
    run(s, { t: [0, 1, 0], r: [0, 0, 0] }, "CADET", 200, { align: true, speed: true }, (st) => {
      if (st.status === "approach") worst = Math.max(worst, telemetry(st, "CADET").closing - assistLimit(telemetry(st, "CADET").axial));
    });
    expect(worst).toBeLessThan(0.01);
    expect(s.status).toBe("docked"); // straight down the axis, at the assisted speed, it captures
    expect(s.lastContact.facts.closing).toBeLessThan(DOCKING.CADET.tol.vMax);
  });
  test("from a dangerous 0.9 m/s it brakes gradually (no instant stop), and with no input it never closes in by itself", () => {
    const s = checkpointState("CADET", { closing: 0.9, range: 30, offset: [0, 0], drift: [0, 0] });
    let maxDec = 0;
    const seen = new Set();
    run(s, NONE, "CADET", 6, { speed: true }, (st, before) => {
      maxDec = Math.max(maxDec, (st.vel[1] - before.vel[1]) / DT);
      seen.add(st.assistOut.speed);
    });
    expect(seen.has("limiting")).toBe(true);
    expect(maxDec).toBeLessThan(DOCKING.CADET.accel * 1.05);
    expect(telemetry(s, "CADET").closing).toBeGreaterThan(0.3); // still braking after 6 s: it took time
    run(s, NONE, "CADET", 20, { speed: true });
    expect(telemetry(s, "CADET").closing).toBeLessThan(assistLimit(telemetry(s, "CADET").axial) + 0.01);
    const still = checkpointState("CADET", { closing: 0, drift: [0, 0] });
    run(still, NONE, "CADET", 30, { speed: true, align: true });
    expect(telemetry(still, "CADET").closing).toBeLessThan(0.002);
  });
});

describe("soft capture", () => {
  // `port`: where the drogue's centre is, off the probe's axis (right, up) — not the vehicle's centre
  const near = (d, { port = [0, 0], ...over } = {}) => {
    const s = checkpointState(d, { range: 0.5, offset: [0, 0], drift: [0, 0], att: [0, 0, 0], closing: 0.08, ...over });
    const m = telemetry(s, d);
    s.pos[0] -= port[0] - m.offset[0]; // offset right = CSM −X
    s.pos[2] += port[1] - m.offset[1];
    return s;
  };
  test("CADET captures small residual errors (0.3 m off, 8° tilted, 0.1 m/s sideways): SOFT CAPTURE, then the mechanism lines up to HARD DOCK", () => {
    const s = near("CADET", { port: [0.28, 0], att: [8, 0, 0], drift: [0.1, 0] });
    const phases = [];
    const ev = run(s, NONE, "CADET", 20, {}, (st) => phases.push(dockingStatus(st, "CADET").phase));
    expect(ev.map((e) => e.kind)).toEqual(expect.arrayContaining(["capture", "docked"]));
    expect(phases).toContain("SOFT CAPTURE");
    expect(phases[phases.length - 1]).toBe("HARD DOCK CONFIRMED");
    // the same contact is refused at ASTRONAUT and COMMANDER
    for (const d of ["ASTRONAUT", "COMMANDER"]) {
      const o = near(d, { port: [0.28, 0], att: [8, 0, 0], drift: [0.1, 0] });
      const e = run(o, NONE, d, 20).map((x) => x.kind);
      expect(e).not.toContain("capture");
    }
  });
  test("CADET's envelope is still a real one: far off the axis, too fast or badly misaligned, no capture", () => {
    for (const over of [{ port: [0.5, 0] }, { closing: 0.55 }, { att: [14, 0, 0] }, { drift: [0.2, 0] }]) {
      const s = near("CADET", over);
      const e = run(s, NONE, "CADET", 15).map((x) => x.kind);
      expect([over, e.includes("capture")]).toEqual([over, false]);
    }
  });
});

describe("the CADET checkpoint and RESTART", () => {
  test("CADET starts calm and close: within a metre of the axis, barely drifting, not rotating, facing the probe", () => {
    const m = telemetry(checkpointState("CADET"), "CADET");
    expect(m.axial).toBeGreaterThan(18);
    expect(m.axial).toBeLessThan(25);
    expect(m.offsetR).toBeLessThan(1);
    expect(m.vLatR).toBeLessThan(0.01);
    expect(m.closing).toBeGreaterThan(0);
    expect(m.closing).toBeLessThan(0.05);
    expect(m.rate).toBe(0);
    expect(m.angle).toBeLessThan(6 * DEG);
    // ASTRONAUT and COMMANDER start where they did
    expect(DOCKING.ASTRONAUT.start).toEqual({ range: 34, offset: [2.6, -2.0], drift: [0.02, -0.018], closing: 0.05, att: [6, -5, 8], rate: [0, 0, 0] });
    expect(DOCKING.COMMANDER.start).toEqual({ range: 38, offset: [3.4, -2.8], drift: [0.03, -0.025], closing: 0.06, att: [9, -8, 12], rate: [0.25, -0.2, 0.3] });
  });
  test("RESTART DOCKING puts each difficulty back on its own checkpoint with the assists off", () => {
    for (const d of ["CADET", "ASTRONAUT", "COMMANDER"]) {
      const s = checkpointState(d);
      engageStabilize(s, d);
      run(s, { t: [0.5, 1, 0], r: [0, 0, 0] }, d, 10, { align: true, speed: true });
      restoreCheckpoint(s, d);
      expect(s.stab).toBeUndefined();
      expect(s.pos).toEqual(checkpointState(d).pos);
      expect(s.vel).toEqual(checkpointState(d).vel);
    }
  });
});

describe("the jet buttons", () => {
  test("a tap is the same minimum impulse as before; a held button builds up gently; FINE is a third", () => {
    expect(jetCommand(0)).toBe(1);
    expect(jetCommand(PULSE * 0.9)).toBe(1);
    expect(jetCommand(0.3)).toBe(JET_SOFT);
    expect(jetCommand(1.0)).toBeGreaterThan(JET_SOFT);
    expect(jetCommand(1.0)).toBeLessThan(1);
    expect(jetCommand(2.0)).toBe(1);
    expect(jetCommand(0, true)).toBe(FINE_SCALE);
    expect(jetCommand(5, true)).toBe(FINE_SCALE);
    // a 0.5 s press now adds about half of what it did
    const dv = (f) => {
      let v = 0;
      for (let t = 0; t < 0.5; t += 0.01) v += f(t) * 0.01;
      return v;
    };
    expect(dv((t) => jetCommand(t))).toBeLessThan(0.55 * dv(() => 1));
  });
  test("a glancing touch on the command module is one contact, not one per step", () => {
    const s = checkpointState("CADET", { range: 0.2, offset: [1.4, 0], drift: [-0.05, 0], closing: 0.03, att: [0, 0, 0] });
    const ev = run(s, NONE, "CADET", 10).filter((e) => e.kind === "collision");
    expect(ev.length).toBeLessThanOrEqual(2);
    expect(s.contacts).toBeLessThanOrEqual(2);
  });
});

/* ---- input-driven playthroughs ------------------------------------------------------------ */
// a player reading the screen `lag` s late; `kind`: "tap" (one pulse per order, then a pause)
// or "hold" (keeps the shown button down until the order changes, with the progressive jets)
function play(d, { lag = 0.7, kind = "tap", assists = true, state = null, maxT = 600, impatient = false } = {}) {
  const s = state || checkpointState(d);
  const ctx = { align: false, speed: assists && !!DOCKING[d].assists.speed };
  const g = createGuidance(d);
  const tapper = guidedPilot(d, { lag, align: false, speed: ctx.speed });
  let mode = "TRANSLATION";
  let since = {};
  let lastAssist = -9;
  let fwdSince = null;
  const hist = [];
  const dt = 1 / 30;
  let cmd = NONE;
  let hold = 0;
  let presses = 0;
  const events = [];
  while (s.t < maxT && s.status !== "docked" && s.status !== "failed") {
    hist.push(JSON.parse(JSON.stringify({ pos: s.pos, vel: s.vel, q: s.q, w: s.w, prop: s.prop, t: s.t, stab: s.stab })));
    const seen = { ...s, ...hist[Math.max(0, hist.length - 1 - Math.round(lag / dt))], status: s.status };
    if (kind === "tap") {
      if (hold <= 0) {
        cmd = tapper(seen);
        hold = PULSE;
      }
      hold -= dt;
    } else {
      const out = g.update(seen, { mode, align: ctx.align, speed: ctx.speed });
      const as = assists && (out.assist || out.alt);
      cmd = NONE;
      if (out.needMode) {
        mode = out.mode;
        since = {};
      } else if (as && seen.t - lastAssist > 2 && !s.stab) {
        lastAssist = seen.t;
        cmd = { ...NONE, assist: as };
      } else if (out.buttons.length && !out.confirm) {
        const c = commandOf(out.buttons);
        const now = {};
        out.buttons.forEach((b) => (now[b] = since[b] != null ? since[b] : s.t));
        since = now;
        const k = jetCommand(s.t - Math.min(...Object.values(now)));
        cmd = { t: c.t.map((v) => v * k), r: c.r.map((v) => v * k) };
      } else since = {};
      if (impatient && !cmd.assist && !cmd.t.some((v) => v) && !cmd.r.some((v) => v)) {
        if (fwdSince == null) fwdSince = s.t;
        cmd = { t: [0, jetCommand(s.t - fwdSince), 0], r: [0, 0, 0] };
      } else fwdSince = null;
    }
    if (cmd.assist === "stabilize" && assists) {
      if (engageStabilize(s, d)) presses++;
    }
    if (cmd.assist === "align" && assists) {
      if (!ctx.align) presses++;
      ctx.align = true;
    }
    if (cmd.t.some((v) => v) || cmd.r.some((v) => v)) presses++;
    const e = stepDocking(s, cmd, d, dt, { align: ctx.align, speed: ctx.speed });
    if (e) events.push(e);
  }
  return { s, docked: s.status === "docked", t: s.t, propUsed: 1 - s.prop / DOCKING[d].prop, events, presses };
}

describe("input-driven docking: what a player can actually do", () => {
  test("CADET, following the guidance (AUTO-ALIGN, STABILIZE, then FWD taps), docks in under three minutes on 10 % of the RCS", () => {
    for (const lag of [0.5, 0.7, 1.0]) {
      const r = play("CADET", { lag });
      expect([lag, r.docked]).toEqual([lag, true]);
      expect(r.t).toBeLessThan(180);
      expect(r.propUsed).toBeLessThan(0.1);
      expect(r.s.contacts).toBe(0);
      expect(r.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["capture", "docked"]));
    }
  });
  test("CADET, holding buttons down (the usual touch habit) and an impatient pilot leaning on FWD: both dock", () => {
    const h = play("CADET", { kind: "hold", lag: 0.8 });
    expect(h.docked).toBe(true);
    expect(h.propUsed).toBeLessThan(0.5);
    const i = play("CADET", { kind: "hold", lag: 0.6, impatient: true });
    expect(i.docked).toBe(true);
    expect(i.s.lastContact.facts.closing).toBeLessThan(0.2);
  });
  test("CADET recovers from mistakes: closing too fast, drifting sideways, turned 25° off", () => {
    for (const over of [{ closing: 0.7, range: 18 }, { drift: [0.09, -0.07] }, { att: [18, -10, 16] }]) {
      const r = play("CADET", { state: checkpointState("CADET", over) });
      expect([over, r.docked, r.s.contacts]).toEqual([over, true, 0]);
    }
  });
  test("ASTRONAUT: the guidance alone docks it (taps), and a button-holder docks with the optional STABILIZE", () => {
    const t = play("ASTRONAUT", { lag: 0.7 });
    expect(t.docked).toBe(true);
    const h = play("ASTRONAUT", { kind: "hold", lag: 0.8 });
    expect(h.docked).toBe(true);
    expect(h.propUsed).toBeGreaterThan(0.3); // it still costs real effort
  });
  test("COMMANDER stays manual and demanding: careful taps dock it; holding buttons runs the RCS dry", () => {
    const t = play("COMMANDER", { lag: 0.7 });
    expect(t.docked).toBe(true);
    expect(t.t).toBeGreaterThan(300);
    const h = play("COMMANDER", { kind: "hold", lag: 0.8 });
    expect(h.docked).toBe(false);
  });
});

describe("the guidance teaches the assisted sequence (CADET)", () => {
  test("AUTO-ALIGN first, then STABILIZE, a wait while it works, then the pilot's own approach; the speed assist's braking needs no button", () => {
    const s = checkpointState("CADET");
    s.t = 10; // after the briefing
    const g = createGuidance("CADET");
    const o1 = g.update(s, { mode: "TRANSLATION", align: false, speed: true });
    expect(o1.key).toBe("useAlign");
    expect(o1.assist).toBe("align");
    expect(o1.buttons).toEqual([]);
    // AUTO-ALIGN on: the attitude settles, then STABILIZE is next
    run(s, NONE, "CADET", 20, { align: true, speed: true });
    const keys = [];
    const g2 = createGuidance("CADET");
    keys.push(g2.update(s, { mode: "TRANSLATION", align: true, speed: true }).key);
    expect(keys).toContain("useStab");
    engageStabilize(s, "CADET");
    s.vel = [0.03, s.vel[1], -0.02]; // a drift for it to take out
    expect(createGuidance("CADET").update(s, { mode: "TRANSLATION", align: true, speed: true }).key).toBe("stabWait");
    run(s, NONE, "CADET", 15, { align: true, speed: true });
    const after = createGuidance("CADET").update(s, { mode: "TRANSLATION", align: true, speed: true });
    expect(["align", "drift", "begin", "good", "lateralWait"]).toContain(after.key);
    // too fast with the assist on: it brakes; the panel says so, and asks for nothing
    const f = checkpointState("CADET", { closing: 0.8, att: [0, 0, 0], offset: [0, 0], drift: [0, 0] });
    f.t = 10;
    const b = createGuidance("CADET").update(f, { mode: "TRANSLATION", align: true, speed: true });
    expect(b.key).toBe("assistBrake");
    expect(b.buttons).toEqual([]);
  });
  test("ASTRONAUT is offered STABILIZE as the alternative to jets for a drift; COMMANDER never", () => {
    const a = checkpointState("ASTRONAUT", { drift: [0.06, 0.05], offset: [0, 0], att: [0, 0, 0] });
    a.t = 10;
    const ev = evaluate(a, "ASTRONAUT", { mode: "TRANSLATION" }).find((c) => c.key === "drift");
    expect(ev.alt).toBe("stabilize");
    expect(ev.buttons.length).toBeGreaterThan(0);
    const c = checkpointState("COMMANDER", { drift: [0.06, 0.05], offset: [0, 0], att: [0, 0, 0], rate: [0, 0, 0] });
    c.t = 10;
    expect(evaluate(c, "COMMANDER", { mode: "TRANSLATION" }).every((x) => !x.alt && !x.assist)).toBe(true);
  });
  test("the six-step checklist ticks off from the live state", () => {
    const s = checkpointState("CADET");
    expect(assistSequence(s, "CADET", { align: false, speed: true }).map((x) => x.done)).toEqual([false, false, false, false, false, false]);
    const r = play("CADET", { lag: 0.7 });
    expect(r.docked).toBe(true);
    expect(assistSequence(r.s, "CADET", { align: true, speed: true }).every((x) => x.done)).toBe(true);
    // all six have words in both languages
    expect(SEQUENCE.en).toHaveLength(6);
    expect(SEQUENCE.pt).toHaveLength(6);
    for (const k of ["useAlign", "useStab", "stabWait", "assistBrake", "capture"]) {
      for (const lang of ["en", "pt"]) {
        const d0 = { ...evaluate(s, "CADET", { mode: "TRANSLATION", speed: true })[0].d, assistLim: 0.2 };
        const t = guidanceText({ key: k, step: 2, d: d0 }, "CADET", lang);
        expect([k, lang, t.title.length > 3, t.detail.length > 10]).toEqual([k, lang, true, true]);
      }
    }
  });
});
