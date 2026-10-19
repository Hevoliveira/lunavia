import { DOCKING, DIFFICULTY_KEYS, PULSE, checkpointState, engageStabilize, flyDocking, referencePilot, stepDocking, telemetry, qMul, qAxisAngle, qNorm } from "./dockingSim";
import { CONTROLS, commandOf, createGuidance, evaluate, guidanceText, guidedPilot, lateralVelocity, translationButtons, SAFETY } from "./dockingGuidance";

const DEG = Math.PI / 180;
// CADET is evaluated as it is flown: AUTO-ALIGN on and STABILIZE holding (already settled on
// the state's own velocity); its assist sequence is tested in dockingAssist.test.js
const top = (s, d, ctx = {}) => evaluate(s, d, { mode: "TRANSLATION", align: d === "CADET", ...ctx })[0];
const at = (d, over) => {
  const s = checkpointState(d, over);
  s.t = 30; // past the opening briefing
  if (d === "CADET") {
    engageStabilize(s, d);
    s.stab.v = s.vel.slice();
    s.stab.stableSince = 0;
  }
  return s;
};

describe("following the guidance alone docks", () => {
  // from a quick pilot to a slow one (a second and more between seeing and tapping)
  test.each(DIFFICULTY_KEYS.flatMap((d) => [[d, 0.25], [d, 0.4], [d, 0.9], [d, 1.2]]))("%s, reaction time %ss", (d, lag) => {
    const pilot = guidedPilot(d, { lag });
    const r = flyDocking(d, pilot, { lag, maxT: 1800 });
    if (!r.docked) console.log(d, lag, r.state.status, r.state.failure, r.events.slice(-3), pilot.log.slice(-5));
    expect(r.docked).toBe(true);
    expect(r.state.prop).toBeGreaterThan(0);
    // every step was taught on the way (CADET and ASTRONAUT start with the briefing)
    const steps = new Set(pilot.log.map((x) => x.step));
    [2, 3, 4].forEach((k) => expect(steps.has(k)).toBe(true));
    if (d !== "COMMANDER") expect(steps.has(1)).toBe(true);
  });
});

describe("what the guidance detects", () => {
  test("closing faster than the physics' limit: brake, with AFT", () => {
    for (const d of DIFFICULTY_KEYS) {
      const s = at(d, { offset: [0, 0], drift: [0, 0], att: [0, 0, 0], rate: [0, 0, 0], range: 10, closing: 0.9 });
      const c = top(s, d);
      expect(c.key).toBe("brake");
      expect(c.pri).toBeGreaterThanOrEqual(SAFETY);
      expect(c.buttons).toEqual(["aft"]);
      expect(telemetry(s, d).closing).toBeGreaterThan(telemetry(s, d).closingLimit);
    }
  });
  test("lateral drift: the jet against it", () => {
    const d = "ASTRONAUT";
    // on the axis, lined up, drifting right (screen) at 0.05 m/s: CSM −X
    const s = at(d, { offset: [0, 0], drift: [-0.05, 0], att: [0, 0, 0], range: 12, closing: 0.15 });
    const c = top(s, d);
    expect(c.key).toBe("drift");
    expect(c.buttons).toEqual(["left"]);
  });
  test("off the axis and not moving: correct lateral alignment, towards the axis", () => {
    const d = "ASTRONAUT";
    // port 2 m left of the axis (CSM +X) and 1 m high (CSM +Z)
    const s = at(d, { offset: [2, 1], drift: [0, 0], att: [0, 0, 0], range: 25, closing: 0.02 });
    const m = telemetry(s, d);
    expect(m.offset[0]).toBeLessThan(0);
    expect(m.offset[1]).toBeGreaterThan(0);
    const c = top(s, d);
    expect(c.key).toBe("align");
    expect(c.buttons.sort()).toEqual(["down", "right"]);
  });
  test("attitude out of tolerance: the attitude correction, in ATT mode", () => {
    const d = "COMMANDER";
    const s = at(d, { offset: [0, 0], drift: [0, 0], att: [6, 0, 0], rate: [0, 0, 0], range: 20, closing: 0.05 });
    const c = top(s, d);
    expect(c.key).toBe("att");
    expect(c.mode).toBe("ATTITUDE");
    expect(c.buttons).toHaveLength(1);
    expect(CONTROLS[c.buttons[0]].axis).toBe("r");
    expect(CONTROLS[c.buttons[0]].i).toBe(0); // pitch
  });
  test("CADET's auto align: wait, no attitude order", () => {
    const s = at("CADET", { offset: [0, 0], drift: [0, 0], att: [8, 0, 0], range: 20, closing: 0.05 });
    const cs = evaluate(s, "CADET", { mode: "TRANSLATION", align: true });
    expect(cs.find((c) => c.key === "att")).toBeUndefined();
    expect(cs.find((c) => c.key === "autoAlign")).toBeDefined();
  });
  test("lined up and slow: authorized to begin the approach (FWD); at speed: cleared, hands off", () => {
    for (const d of DIFFICULTY_KEYS) {
      const slow = at(d, { offset: [0, 0], drift: [0, 0], att: [0, 0, 0], rate: [0, 0, 0], range: 12, closing: 0 });
      expect(top(slow, d).key).toBe("begin");
      expect(top(slow, d).buttons).toEqual(["fwd"]);
      const want = evaluate(slow, d, {})[0].d.want;
      const ok = at(d, { offset: [0, 0], drift: [0, 0], att: [0, 0, 0], rate: [0, 0, 0], range: 12, closing: want });
      expect(top(ok, d).key).toBe("good");
      expect(top(ok, d).buttons).toEqual([]);
    }
  });
  test("close in and inside the capture tolerances: stand by for contact", () => {
    for (const d of DIFFICULTY_KEYS) {
      const s = at(d, { offset: [0, 0], drift: [0, 0], att: [0, 0, 0], rate: [0, 0, 0], range: 1.0, closing: 0.06 });
      expect(top(s, d).key).toBe("standby");
    }
  });
  test("close in and not lined up: back off (AFT), a safety order", () => {
    const d = "ASTRONAUT";
    const s = at(d, { offset: [0.5, 0], drift: [0, 0], att: [0, 0, 0], range: 2, closing: 0.05 });
    const c = top(s, d);
    expect(c.key).toBe("backoff");
    expect(c.buttons).toEqual(["aft"]);
    expect(c.pri).toBeGreaterThanOrEqual(SAFETY);
  });
  test("moving away: correct the relative motion (FWD)", () => {
    const d = "ASTRONAUT";
    const s = at(d, { offset: [2, 0], drift: [-0.05 * 2, 0], att: [0, 0, 0], range: 20, closing: -0.08 });
    const cs = evaluate(s, d, { mode: "TRANSLATION" });
    const c = cs.find((x) => x.key === "opening");
    expect(c).toBeDefined();
    expect(c.buttons).toEqual(["fwd"]);
  });
  test("COMMANDER: rotating faster than a capture accepts, with contact imminent, is a safety order against the turn", () => {
    const s = at("COMMANDER", { offset: [0, 0], drift: [0, 0], att: [0, 0, 0], rate: [0, 0, 1.2], range: 1.0, closing: 0.05 });
    const c = top(s, "COMMANDER");
    expect(c.key === "rot" || c.key === "att").toBe(true);
    expect(c.pri).toBeGreaterThanOrEqual(SAFETY);
    expect(c.buttons).toEqual(["yaw-right"]); // yaw rate +Z → the −Z jet
  });
  test("a turn swings the port sideways: that is not a drift to translate against", () => {
    // ASTRONAUT on the axis, no translation drift, yawing at 1.5°/s: the port moves sideways
    const s = at("ASTRONAUT", { offset: [0, 0], drift: [0, 0], att: [0, 0, 0], rate: [0, 0, 1.5], range: 12, closing: 0.15 });
    expect(telemetry(s, "ASTRONAUT").vLatR).toBeGreaterThan(0.03); // 1.5°/s × the port 1.46 m from the centre
    const cs = evaluate(s, "ASTRONAUT", {});
    expect(cs.find((c) => c.key === "drift" || c.key === "align")).toBeUndefined();
  });
  test("CADET: while AUTO ALIGN is still outside the capture tolerance, no approach is authorized", () => {
    const s = at("CADET", { offset: [0, 0], drift: [0, 0], att: [10, 0, 0], range: 12, closing: 0 });
    const c = evaluate(s, "CADET", { mode: "TRANSLATION", align: true })[0];
    expect(c.key).toBe("autoAlign");
    const probe = at("CADET", { offset: [0, 0], drift: [0, 0], att: [0, 0, 0], range: 12, closing: 0 });
    const want = evaluate(probe, "CADET", { align: true }).find((c) => c.key === "begin").d.want;
    const ok = at("CADET", { offset: [0, 0], drift: [0, 0], att: [0, 0, 0], range: 12, closing: want });
    expect(evaluate(ok, "CADET", { align: true })[0].key).toBe("good");
  });
  test("STEP 5: contact, capture, retraction progress, then hard dock", () => {
    const s = at("ASTRONAUT", {});
    s.status = "captured";
    s.captureT = s.t - 3;
    const o = createGuidance("ASTRONAUT").update(s, {});
    expect(o.step).toBe(5);
    const x = guidanceText(o, "ASTRONAUT", "en");
    expect(x.title).toBe("SOFT CAPTURE");
    expect(x.support).toMatch(/✓ CONTACT · ✓ SOFT CAPTURE · RETRACTING 50% · ◌ HARD DOCK/);
  });
  test("captured, docked, no propellant", () => {
    const s = at("ASTRONAUT", {});
    s.status = "captured";
    expect(top(s, "ASTRONAUT").key).toBe("capture");
    s.status = "docked";
    expect(top(s, "ASTRONAUT").key).toBe("docked");
    const p = at("ASTRONAUT", {});
    p.prop = 0;
    expect(top(p, "ASTRONAUT").key).toBe("noProp");
  });
});

describe("the directions are the physics' own", () => {
  // Seeded states all around the approach, including rolled and yawed vehicles: one
  // tap of what the guidance names must reduce the very error it names.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const measure = (key, s, d) => {
    const c = evaluate(s, d, {})[0];
    const m = telemetry(s, d);
    if (key === "align" || key === "drift") { const v = lateralVelocity(s); return Math.hypot(v[0] - c.d.wantL[0], v[1] - c.d.wantL[1]); }
    if (["brake", "slow", "backoff", "begin", "latch", "opening"].includes(key)) return Math.abs(m.closing - c.d.want);
    return null;
  };
  test("one tap of the named buttons reduces the named error (translation), with roll up to 40°", () => {
    let checked = 0;
    for (let k = 0; k < 400; k++) {
      const d = DIFFICULTY_KEYS[k % 3];
      const s = at(d, {
        range: 3 + 30 * Math.abs(rnd()),
        offset: [2.5 * rnd(), 2.5 * rnd()],
        drift: [0.08 * rnd(), 0.08 * rnd()],
        closing: 0.25 * rnd(),
        att: [3 * rnd(), 40 * rnd(), 3 * rnd()],
        rate: [0, 0, 0],
      });
      const c = evaluate(s, d, {}).find((x) => x.buttons.length && x.mode === "TRANSLATION");
      if (!c) continue;
      const before = measure(c.key, s, d);
      if (before == null) continue;
      // isolate the effect of the jets: same step with and without the tap
      const a = JSON.parse(JSON.stringify(s));
      const b = JSON.parse(JSON.stringify(s));
      stepDocking(a, commandOf(c.buttons), d, PULSE, { meanMotion: 0 });
      stepDocking(b, { t: [0, 0, 0], r: [0, 0, 0] }, d, PULSE, { meanMotion: 0 });
      const ea = measureWith(c, a, d);
      const eb = measureWith(c, b, d);
      expect(ea).toBeLessThan(eb);
      checked++;
    }
    expect(checked).toBeGreaterThan(150);
  });
  function measureWith(c, s, d) {
    const m = telemetry(s, d);
    if (c.key === "align" || c.key === "drift") { const v = lateralVelocity(s); return Math.hypot(v[0] - c.d.wantL[0], v[1] - c.d.wantL[1]); }
    return Math.abs(m.closing - c.d.want);
  }
  test("one tap of the named attitude jet turns towards the docking attitude (or against the turn)", () => {
    let checked = 0;
    for (let k = 0; k < 300; k++) {
      const d = k % 2 ? "COMMANDER" : "ASTRONAUT";
      const s = at(d, { range: 20, offset: [0, 0], drift: [0, 0], closing: 0.05, att: [12 * rnd(), 15 * rnd(), 12 * rnd()], rate: d === "COMMANDER" ? [0.8 * rnd(), 0.8 * rnd(), 0.8 * rnd()] : [0, 0, 0] });
      const c = evaluate(s, d, {}).find((x) => x.mode === "ATTITUDE" && x.buttons.length);
      if (!c) continue;
      const i = CONTROLS[c.buttons[0]].i;
      const want = Math.max(-DEG, Math.min(DEG, -0.25 * c.d.err[i]));
      const a = JSON.parse(JSON.stringify(s));
      stepDocking(a, commandOf(c.buttons), d, PULSE, { meanMotion: 0 });
      expect(Math.abs(want - a.w[i])).toBeLessThan(Math.abs(want - s.w[i]));
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });
  test("a rolled vehicle gets the body axes the push really needs", () => {
    // rolled 90° about its docking axis: screen-right needs the body's ±Z jets, not ±X
    const s = at("ASTRONAUT", { att: [0, 90, 0] });
    const b = translationButtons([-1, 0, 0], s.q, [0, 2]);
    expect(b.length).toBe(1);
    expect(["up", "down"]).toContain(b[0]);
    const s0 = at("ASTRONAUT", { att: [0, 0, 0] });
    expect(translationButtons([-1, 0, 0], s0.q, [0, 2])).toEqual(["right"]);
    expect(translationButtons([0, -1, 0], s0.q, [1])).toEqual(["fwd"]);
  });
});

describe("one instruction at a time, without chatter", () => {
  const flights = [];
  beforeAll(() => {
    for (const d of DIFFICULTY_KEYS) {
      const p = guidedPilot(d, { lag: 0.3 });
      const r = flyDocking(d, p, { lag: 0.3, maxT: 1500 });
      flights.push({ d, log: p.log, t: r.t, who: "student" });
      // the guidance watching the reference pilot fly (it does not follow it)
      const g = createGuidance(d);
      const ref = referencePilot(d, { lag: 0.3 });
      const log = [];
      const watch = (s) => {
        const o = g.update(s, { mode: "TRANSLATION", align: DOCKING[d].autoAlign });
        log.push({ t: s.t, key: o.key, pri: o.pri, brakes: o.brakes, buttons: o.buttons.slice(), confirm: o.confirm });
        return ref(s);
      };
      const r2 = flyDocking(d, watch, { lag: 0.3, maxT: 1500 });
      flights.push({ d, log, t: r2.t, who: "reference" });
    }
  });
  test("no flip-flop: an instruction is held at least 1.5 s unless safety interrupts", () => {
    for (const f of flights) {
      const shown = [];
      // what the panel shows: the confirmation while it is up, else the instruction
      f.log.forEach((x) => {
        const k = x.confirm ? `✓${x.confirm}` : x.key;
        if (!shown.length || shown[shown.length - 1].key !== k) shown.push({ key: k, t: x.t });
      });
      // A → B → A inside 1.5 s never happens
      for (let i = 2; i < shown.length; i++) {
        if (shown[i].key === shown[i - 2].key) expect(shown[i].t - shown[i - 2].t).toBeGreaterThan(1.4);
      }
      // a calm rate of change: well under one new instruction every 2 s on average
      expect(shown.length / Math.max(1, f.t)).toBeLessThan(0.5);
    }
  });
  test("never the opposite jet on the same axis within 2.5 s (outside safety); 1 s when it only brakes the last order's motion", () => {
    for (const f of flights) {
      const last = {};
      for (const x of f.log) {
        for (const b of x.buttons) {
          const c = CONTROLS[b];
          const ax = c.axis + c.i;
          if (last[ax] && last[ax].v !== c.v && x.pri < SAFETY) expect(x.t - last[ax].t).toBeGreaterThanOrEqual((x.brakes ? 1.0 : 2.5) - 1e-6);
          last[ax] = { v: c.v, t: x.t };
        }
      }
    }
  });
  test("a confirmation follows executed corrections", () => {
    for (const f of flights.filter((x) => x.who === "student")) expect(f.log.some((x) => x.confirm)).toBe(true);
  });
});

describe("the guidance only reads", () => {
  test("evaluating and tracking never change the simulation state", () => {
    for (const d of DIFFICULTY_KEYS) {
      const s = at(d, { range: 6, offset: [0.4, -0.3], drift: [0.02, 0.01], closing: 0.3, att: [4, 3, -5], rate: [0.2, 0, 0.1] });
      const before = JSON.stringify(s);
      const g = createGuidance(d);
      for (let k = 0; k < 20; k++) g.update(s, { mode: "TRANSLATION", align: true });
      evaluate(s, d, {});
      expect(JSON.stringify(s)).toBe(before);
    }
  });
  test("a restart (the clock going back) starts the guidance afresh", () => {
    const d = "CADET";
    const g = createGuidance(d);
    const s = at(d, { closing: 0.9, range: 10, offset: [0, 0], drift: [0, 0], att: [0, 0, 0] });
    expect(g.update(s, {}).key).toBe("brake");
    const fresh = checkpointState(d);
    const o = g.update(fresh, {});
    expect(o.step).toBe(1); // the briefing again, nothing carried over
    expect(o.confirm).toBeNull();
  });
});

describe("difficulty levels of instruction", () => {
  const s = at("ASTRONAUT", { offset: [0, 0], drift: [0, 0], att: [0, 0, 0], range: 10, closing: 0.9 });
  test("CADET is taught, ASTRONAUT gets the order and the number, COMMANDER the order alone", () => {
    const g = createGuidance("CADET");
    const cad = guidanceText(g.update({ ...s }, { mode: "TRANSLATION" }), "CADET", "en");
    const ast = guidanceText(createGuidance("ASTRONAUT").update({ ...s }, { mode: "TRANSLATION" }), "ASTRONAUT", "en");
    const cmd = guidanceText(createGuidance("COMMANDER").update({ ...s }, { mode: "TRANSLATION" }), "COMMANDER", "en");
    [cad, ast, cmd].forEach((x) => {
      expect(x.title).toMatch(/BRAKE/);
      expect(x.control).toMatch(/AFT/);
      expect(x.stepName).toBe("REDUCE RELATIVE VELOCITY");
    });
    expect(cad.detail.length).toBeGreaterThan(ast.detail.length);
    expect(ast.detail.length).toBeGreaterThan(0);
    expect(cmd.detail).toBe("");
  });
  test("Portuguese", () => {
    const x = guidanceText(createGuidance("CADET").update({ ...s }, { mode: "TRANSLATION" }), "CADET", "pt");
    expect(x.title).toMatch(/FREIE/);
    expect(x.stepName).toBe("REDUZA A VELOCIDADE RELATIVA");
    expect(x.control).toMatch(/AFT/);
  });
  test("a mode switch is named when the order needs the other mode", () => {
    const sa = at("ASTRONAUT", { offset: [0, 0], drift: [0, 0], att: [8, 0, 0], range: 20, closing: 0.05 });
    const o = createGuidance("ASTRONAUT").update(sa, { mode: "TRANSLATION" });
    expect(o.needMode).toBe(true);
    expect(guidanceText(o, "ASTRONAUT", "en").control).toMatch(/^MODE → ATT, then/);
  });
  test("the briefing (STEP 1) opens CADET and ASTRONAUT attempts, not COMMANDER's", () => {
    expect(createGuidance("CADET").update(checkpointState("CADET"), {}).step).toBe(1);
    expect(createGuidance("ASTRONAUT").update(checkpointState("ASTRONAUT"), {}).step).toBe(1);
    expect(createGuidance("COMMANDER").update(checkpointState("COMMANDER"), {}).step).not.toBe(1);
  });
});
