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
  engageCenter,
  engageStabilize,
  fineStep,
  jetCommand,
  restoreCheckpoint,
  stepDocking,
  telemetry,
  vec,
} from "./dockingSim";
import { copilotSteps, copilotText, createGuidance, commandOf, evaluate, guidanceText, guidedPilot } from "./dockingGuidance";

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
    expect(assistsOf("CADET", { align: true, speed: true })).toEqual({ align: true, center: "hold", stabilize: "hold", speed: true });
    expect(assistsOf("ASTRONAUT", { align: true, speed: true })).toEqual({ align: false, center: "once", stabilize: "once", speed: false });
    expect(assistsOf("COMMANDER", { align: true, speed: true })).toEqual({ align: false, center: null, stabilize: null, speed: false });
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
    expect(lim).toBeGreaterThan(0.3);
    expect(s.stab.v).toEqual([0, 0, 0]); // matched to the CSM: no sideways motion and no closing (the pilot sets the approach)
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
    expect(m.closing).toBeLessThan(0.01);
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
  const ctx = { align: false, speed: assists && !!DOCKING[d].assists.speed, fine: false };
  const g = createGuidance(d);
  const tapper = guidedPilot(d, { lag, align: false, speed: ctx.speed, alt: kind === "tap" ? false : true });
  let lastFine = -9;
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
      const out = g.update(seen, { mode, align: ctx.align, speed: ctx.speed, fine: ctx.fine });
      const as = assists && (out.assist || out.alt);
      const pressed = (a) => (a === "stabilize" && s.stab) || (a === "center" && s.center) || (a === "fine" && ctx.fine) || (a === "align" && ctx.align);
      cmd = NONE;
      if (out.needMode) {
        mode = out.mode;
        since = {};
      } else if (as && seen.t - lastAssist > 2 && !pressed(as)) {
        lastAssist = seen.t;
        cmd = { ...NONE, assist: as };
      } else if (out.fine && !out.confirm) {
        // FINE APPROACH with FWD held down: a step every 0.35 s (as the buttons repeat)
        if (seen.t - lastFine > 0.35) {
          lastFine = seen.t;
          cmd = { ...NONE, fine: out.fine };
        }
      } else if (out.buttons.length && !out.confirm) {
        const c = commandOf(out.buttons);
        const now = {};
        out.buttons.forEach((b) => (now[b] = since[b] != null ? since[b] : s.t));
        since = now;
        const k = jetCommand(s.t - Math.min(...Object.values(now)));
        cmd = { t: c.t.map((v) => v * k), r: c.r.map((v) => v * k) };
      } else since = {};
      if (impatient && !cmd.assist && !cmd.fine && !cmd.t.some((v) => v) && !cmd.r.some((v) => v)) {
        if (ctx.fine && s.stab) {
          // leaning on FWD in FINE APPROACH: a step up every 0.35 s
          if (seen.t - lastFine > 0.35) {
            lastFine = seen.t;
            cmd = { ...NONE, fine: 1 };
          }
        } else {
          if (fwdSince == null) fwdSince = s.t;
          cmd = { t: [0, jetCommand(s.t - fwdSince), 0], r: [0, 0, 0] };
        }
      } else fwdSince = null;
    }
    if (cmd.assist === "stabilize" && assists) {
      if (engageStabilize(s, d)) presses++;
    }
    if (cmd.assist === "align" && assists) {
      if (!ctx.align) presses++;
      ctx.align = true;
    }
    if (cmd.assist === "center" && assists && !s.center) {
      if (engageCenter(s, d)) presses++;
    }
    if (cmd.assist === "fine" && assists) {
      if (!ctx.fine) presses++;
      ctx.fine = true;
    }
    if (cmd.fine && assists) {
      fineStep(s, d, cmd.fine, { speed: ctx.speed });
      presses++;
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
    expect(h.propUsed).toBeGreaterThan(0.15); // it still costs real effort
  });
  test("COMMANDER stays manual and demanding: careful taps dock it; holding buttons runs the RCS dry", () => {
    const t = play("COMMANDER", { lag: 0.7 });
    expect(t.docked).toBe(true);
    expect(t.t).toBeGreaterThan(300);
    const h = play("COMMANDER", { kind: "hold", lag: 0.8 });
    expect(h.docked).toBe(false);
  });
});

describe("CADET's docking copilot: AUTO-ALIGN → AUTO-CENTER → MATCH VELOCITY → FINE APPROACH → SOFT CAPTURE", () => {
  const ctx0 = { mode: "TRANSLATION", speed: true };
  test("the guidance asks for each assist in turn, waits while it works, and never asks for sideways taps while AUTO-CENTER flies", () => {
    const s = checkpointState("CADET");
    s.t = 10; // after the briefing
    const ctx = { ...ctx0, align: false, fine: false };
    const top = () => createGuidance("CADET").update(s, ctx);
    expect(top().key).toBe("useAlign");
    expect(top().assist).toBe("align");
    ctx.align = true;
    run(s, NONE, "CADET", 15, { align: true, speed: true });
    // oriented, but still off the centreline: AUTO-CENTER is next
    expect(telemetry(s, "CADET").angle).toBeLessThan(1 * DEG);
    expect(telemetry(s, "CADET").offsetR).toBeGreaterThan(0.5);
    expect(top().key).toBe("useCenter");
    expect(top().assist).toBe("center");
    engageCenter(s, "CADET");
    const keys = new Set();
    for (let k = 0; k < 40 && !(s.center && s.center.centeredSince != null); k++) {
      run(s, NONE, "CADET", 1, { align: true, speed: true });
      const o = top();
      keys.add(o.key);
      expect(["align", "drift", "lateralWait"]).not.toContain(o.key);
    }
    expect(keys.has("centerWait")).toBe(true);
    expect(s.center.centeredSince).not.toBeNull();
    expect(top().key).toBe("useStab");
    engageStabilize(s, "CADET");
    run(s, NONE, "CADET", 6, { align: true, speed: true });
    expect(top().key).toBe("useFine");
    ctx.fine = true;
    const b = top();
    expect(b.key).toBe("begin");
    expect(b.fine).toBe(1);
    expect(b.buttons).toEqual(["fwd"]);
  });
  test("ASTRONAUT is offered AUTO-CENTER and MATCH VELOCITY as alternatives to the jets; COMMANDER never anything", () => {
    const a = checkpointState("ASTRONAUT", { att: [0, 0, 0] });
    a.t = 10;
    const ev = evaluate(a, "ASTRONAUT", { mode: "TRANSLATION" });
    const al = ev.find((c) => c.key === "align");
    expect(al.alt).toBe("center");
    expect(al.buttons.length).toBeGreaterThan(0);
    const dr = checkpointState("ASTRONAUT", { drift: [0.06, 0.05], offset: [0, 0], att: [0, 0, 0] });
    dr.t = 10;
    expect(evaluate(dr, "ASTRONAUT", { mode: "TRANSLATION" }).find((c) => c.key === "drift").alt).toBe("stabilize");
    const c = checkpointState("COMMANDER", { drift: [0.06, 0.05], att: [0, 0, 0], rate: [0, 0, 0] });
    c.t = 10;
    expect(evaluate(c, "COMMANDER", { mode: "TRANSLATION" }).every((x) => !x.alt && !x.assist)).toBe(true);
    expect(engageCenter(checkpointState("COMMANDER"), "COMMANDER")).toBe(false);
  });
  test("the five steps come from the telemetry, say why a step is not done, and step back when the vehicle drifts out of tolerance", () => {
    const s = checkpointState("CADET");
    let cp = copilotSteps(s, "CADET", { speed: true });
    expect(cp.active).toBe(1);
    expect(cp.reason.key).toBe("align");
    expect(copilotText(cp, "en").why).toMatch(/Docking axis .*° off/);
    // aligned: step 2, with the offset and the side
    run(s, NONE, "CADET", 15, { align: true, speed: true });
    cp = copilotSteps(s, "CADET", { speed: true });
    expect(cp.active).toBe(2);
    expect(copilotText(cp, "en").why).toMatch(/Port 0\.\d\d m (right|left)/);
    expect(copilotText(cp, "pt").why).toMatch(/Porta 0,?\.?\d+/);
    engageCenter(s, "CADET");
    run(s, NONE, "CADET", 40, { align: true, speed: true });
    engageStabilize(s, "CADET");
    run(s, NONE, "CADET", 8, { align: true, speed: true });
    cp = copilotSteps(s, "CADET", { speed: true }, cp.done);
    expect(cp.active).toBe(4);
    expect(cp.reason.key).toBe("approach");
    // knocked off the centreline (a stray push): back to step 2 at once — no timer, no stickiness
    disengageStabilize(s);
    s.center = null;
    s.pos[0] += 0.8;
    cp = copilotSteps(s, "CADET", { speed: true }, cp.done);
    expect(cp.active).toBe(2);
    // a fresh drift with the port centred: step 3 says what is wrong
    const d = checkpointState("CADET", { offset: [0, 0], att: [0, 0, 0], drift: [0.04, 0], closing: 0.05 });
    const c3 = copilotSteps(d, "CADET", { speed: true });
    expect(c3.active).toBe(3);
    expect(c3.reason.key).toBe("matchDrift");
    // words for every step in both languages
    for (const key of ["align", "center", "matchFast", "matchOpening", "matchRotating", "matchDrift", "approach", "capture"]) {
      for (const lang of ["en", "pt"]) {
        const t = copilotText({ active: 2, reason: { key, angle: 0.1, need: 0.05, off: [0.3, -0.1], r: 0.32, closing: 0.1, lim: 0.2, rate: 0.01, vLat: 0.02, axial: 5, set: 0.08, retract: 0.4 } }, lang);
        expect([key, lang, t.why.length > 8]).toEqual([key, lang, true]);
      }
    }
  });
});

describe("AUTO-CENTER and FINE APPROACH: translation by the RCS, never a jump", () => {
  test("the assists never fly the final approach: every assist on, no FWD from the pilot, and the vehicle holds station (even from a fast, drifting start)", () => {
    for (const over of [{}, { offset: [1.4, -1.1], drift: [0.035, -0.025], closing: 0.18, att: [9, -6, 10] }]) {
      const s = checkpointState("CADET", over);
      const ctx = { align: true, speed: true, fine: true };
      engageCenter(s, "CADET");
      engageStabilize(s, "CADET");
      const ax0 = telemetry(s, "CADET").axial;
      run(s, NONE, "CADET", 180, ctx);
      const m = telemetry(s, "CADET");
      expect(s.status).toBe("approach");
      expect(Math.abs(m.closing)).toBeLessThan(0.005);
      expect(ax0 - m.axial).toBeLessThan(ax0 * 0.25); // it stopped the closing, it did not finish it
      expect(m.offsetR).toBeLessThan(0.1); // but it is centred and ready
    }
  });
  test("AUTO-CENTER slides the port onto the axis through thrust, within the RCS's authority, and keeps it there", () => {
    const s = checkpointState("CADET", { att: [0, 0, 0], drift: [0, 0], offset: [0.9, -0.7], closing: 0 });
    const r0 = telemetry(s, "CADET").offsetR;
    engageCenter(s, "CADET");
    let maxAcc = 0;
    let maxV = 0;
    const seen = new Set();
    const ax0 = telemetry(s, "CADET").axial;
    run(s, NONE, "CADET", 40, { align: true }, (st, before) => {
      maxAcc = Math.max(maxAcc, vec.len(vec.sub(st.vel, before.vel)) / DT);
      maxV = Math.max(maxV, Math.hypot(st.vel[0], st.vel[2]));
      seen.add(st.assistOut.center);
    });
    expect(r0).toBeGreaterThan(1);
    expect(telemetry(s, "CADET").offsetR).toBeLessThan(0.1);
    expect(maxAcc).toBeLessThan(DOCKING.CADET.accel * Math.sqrt(3) + 0.002);
    expect(maxV).toBeLessThan(0.065);
    expect([...seen]).toEqual(expect.arrayContaining(["active", "centered"]));
    expect(Math.abs(telemetry(s, "CADET").axial - ax0)).toBeLessThan(0.3); // no forward motion from it
    expect(s.prop).toBeLessThan(DOCKING.CADET.prop);
    // it keeps the port centred for minutes against the orbit's drift
    run(s, NONE, "CADET", 120, { align: true });
    expect(telemetry(s, "CADET").offsetR).toBeLessThan(0.1);
  });
  test("a sideways command from the pilot switches AUTO-CENTER off; ASTRONAUT's centres once and hands back", () => {
    const s = checkpointState("CADET", { att: [0, 0, 0], drift: [0, 0] });
    engageCenter(s, "CADET");
    run(s, { t: [1, 0, 0], r: [0, 0, 0] }, "CADET", 0.2, { align: true });
    expect(s.center).toBeNull();
    expect(s.assistOut.center).toBe("override");
    const a = checkpointState("ASTRONAUT", { att: [0, 0, 0], drift: [0, 0], offset: [0.8, 0.5] });
    engageCenter(a, "ASTRONAUT");
    const seen = new Set();
    let atDone = null;
    run(a, NONE, "ASTRONAUT", 60, {}, (st) => {
      seen.add(st.assistOut.center);
      if (st.assistOut.center === "done" && atDone == null) atDone = telemetry(st, "ASTRONAUT").offsetR;
    });
    expect(seen.has("done")).toBe(true);
    expect(a.center).toBeNull();
    expect(atDone).toBeLessThan(0.1); // centred when it handed back (the orbit then drifts it again: ASTRONAUT's to manage)
  });
  test("FINE APPROACH: each press sets the held closing speed exactly 0.02 m/s, never past the safe speed; the RCS reaches it", () => {
    const s = checkpointState("CADET", { att: [0, 0, 0], drift: [0, 0], offset: [0, 0], closing: 0 });
    expect(fineStep(s, "CADET", 1, { speed: true })).toBeNull(); // no MATCH VELOCITY hold: nothing to set
    engageStabilize(s, "CADET");
    expect(fineStep(s, "CADET", 1, { speed: true })).toBeCloseTo(0.02, 9);
    expect(fineStep(s, "CADET", 1, { speed: true })).toBeCloseTo(0.04, 9);
    expect(fineStep(s, "CADET", -1, { speed: true })).toBeCloseTo(0.02, 9);
    for (let k = 0; k < 4; k++) fineStep(s, "CADET", 1, { speed: true });
    expect(fineStep(s, "CADET", 1, { speed: true })).toBeCloseTo(0.12, 9);
    let maxAcc = 0;
    run(s, NONE, "CADET", 10, { speed: true, align: true }, (st, before) => (maxAcc = Math.max(maxAcc, Math.abs(st.vel[1] - before.vel[1]) / DT)));
    expect(telemetry(s, "CADET").closing).toBeCloseTo(0.12, 2);
    expect(maxAcc).toBeLessThan(DOCKING.CADET.accel * 1.05);
    // never above the safe speed for the distance
    for (let k = 0; k < 40; k++) fineStep(s, "CADET", 1, { speed: true });
    expect(-s.stab.v[1]).toBeLessThanOrEqual(assistLimit(telemetry(s, "CADET").axial) + 1e-9);
    // never below zero
    for (let k = 0; k < 40; k++) fineStep(s, "CADET", -1, { speed: true });
    expect(-s.stab.v[1]).toBe(0);
    // ASTRONAUT and COMMANDER: FINE scales the jets instead
    const a = checkpointState("ASTRONAUT");
    engageStabilize(a, "ASTRONAUT");
    expect(fineStep(a, "ASTRONAUT", 1, {})).toBeNull();
  });
});

describe("the straightforward beginner sequence, from the real checkpoint", () => {
  // Five presses and then FWD: AUTO-ALIGN, AUTO-CENTER (once aligned), MATCH VELOCITY (once
  // centred), FINE APPROACH, then FWD presses up to a modest speed — and nothing else.
  function beginner(lag = 1.0) {
    const s = checkpointState("CADET");
    const ctx = { align: false, speed: true, fine: false };
    let t = 0;
    const log = [];
    const step = (secs) => {
      for (let i = 0; i < Math.round(secs * 30); i++) {
        stepDocking(s, NONE, "CADET", 1 / 30, ctx);
        t += 1 / 30;
        if (s.status === "docked" || s.status === "failed") return true;
      }
      return false;
    };
    ctx.align = true;
    log.push(["AUTO-ALIGN", +s.t.toFixed(1)]);
    step(lag);
    let cp;
    while (s.t < 120 && (cp = copilotSteps(s, "CADET", ctx)).active < 2) step(0.5);
    engageCenter(s, "CADET");
    log.push(["AUTO-CENTER", +s.t.toFixed(1)]);
    while (s.t < 240 && copilotSteps(s, "CADET", ctx).done[1] !== true) step(0.5);
    step(lag);
    engageStabilize(s, "CADET");
    log.push(["MATCH VELOCITY", +s.t.toFixed(1)]);
    while (s.t < 300 && !(s.stab && s.stab.stableSince != null)) step(0.5);
    step(lag);
    ctx.fine = true;
    log.push(["FINE APPROACH", +s.t.toFixed(1)]);
    let fwd = 0;
    // FWD presses to about a fifth of a metre per second, one per second; then hands off
    while (s.t < 600 && s.status === "approach" && -s.stab.v[1] < 0.2 - 1e-9) {
      fineStep(s, "CADET", 1, ctx);
      fwd++;
      if (step(1)) break;
    }
    log.push([`FWD × ${fwd}`, +s.t.toFixed(1)]);
    step(600 - s.t);
    return { s, log, fwd };
  }
  test("AUTO-ALIGN → AUTO-CENTER → MATCH VELOCITY → FINE APPROACH and a few FWD presses dock CADET from its real checkpoint, with no contact and little RCS", () => {
    for (const lag of [0.5, 1.5]) {
      const { s, log, fwd } = beginner(lag);
      expect([lag, s.status]).toEqual([lag, "docked"]);
      expect(s.contacts).toBe(0);
      expect(fwd).toBeLessThanOrEqual(10);
      expect(s.prop / DOCKING.CADET.prop).toBeGreaterThan(0.9);
      expect(s.t).toBeLessThan(240);
      expect(s.lastContact.facts.closing).toBeLessThan(DOCKING.CADET.tol.vMax);
      // the capture is the physics' own judgement: inside the soft-capture envelope
      expect(s.lastContact.facts.lateral).toBeLessThan(DOCKING.CADET.tol.lateral);
      if (lag === 0.5) console.log("beginner sequence", JSON.stringify(log), "docked at", s.t.toFixed(0), "s, RCS left", ((100 * s.prop) / DOCKING.CADET.prop).toFixed(0), "%");
    }
  });
  test("the assists never make an impossible state: no capture outside the envelope, no speed above the RCS's reach, prop never negative", () => {
    // random starts around the CADET checkpoint, the beginner sequence each time
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
    for (let k = 0; k < 12; k++) {
      const s = checkpointState("CADET", { offset: [1.5 * r(), 1.5 * r()], drift: [0.03 * r(), 0.03 * r()], att: [8 * r(), 8 * r(), 8 * r()], closing: 0.05 + 0.05 * r() });
      const ctx = { align: true, speed: true, fine: true };
      engageCenter(s, "CADET");
      engageStabilize(s, "CADET");
      let last = null;
      for (let i = 0; i < 400 * 30 && s.status === "approach"; i++) {
        if (i % 30 === 0 && copilotSteps(s, "CADET", ctx).active >= 4 && -s.stab.v[1] < 0.15) fineStep(s, "CADET", 1, ctx);
        const before = s.vel.slice();
        stepDocking(s, NONE, "CADET", 1 / 30, ctx);
        expect(vec.len(vec.sub(s.vel, before)) * 30).toBeLessThan(DOCKING.CADET.accel * Math.sqrt(3) + 0.003);
        expect(s.prop).toBeGreaterThanOrEqual(0);
        last = s;
      }
      for (let i = 0; i < 20 * 30 && s.status === "captured"; i++) stepDocking(s, NONE, "CADET", 1 / 30, ctx);
      expect([k, last.status]).toEqual([k, "docked"]);
      const f = s.lastContact.facts;
      const t = DOCKING.CADET.tol;
      expect(f.lateral <= t.lateral && f.angle <= t.angle && f.closing <= t.vMax && f.closing >= t.vMin && f.vLat <= t.vLat).toBe(true);
    }
  });
});
