import {
  CABIN_LOOK,
  CABIN_PANELS,
  CHECKLIST,
  COUNT,
  COUNT_DUR,
  PAD_SHOT,
  PRELAUNCH_TEXT,
  ROCKET_SCALE,
  STAGES,
  advance,
  checklistComplete,
  confirmItem,
  countAt,
  createChecklist,
  createPreLaunch,
  dueCalls,
  hatchClosedAt,
  nextItem,
  normalizeStage,
  padCameraAt,
  requestLaunch,
} from "./preLaunch";
import * as PRE from "./preLaunch";
import { LIFTOFF_T, UNIT_M } from "./launchTimeline";
import comms from "../audio/commsLines.json";

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("the simplified sequence: launch complex, command module, count", () => {
  test("three stages, starting at the launch complex — no suit room, no walk, no boarding", () => {
    expect(STAGES).toEqual(["pad", "cabin", "count"]);
    const st = createPreLaunch();
    expect(st).toEqual({ stage: "pad", launched: false });
    // nothing of the removed places is left in the experience's data
    for (const gone of ["SUIT_STEPS", "BRIEFING", "helmetAt", "doSuitStep", "TOWER_RIDE", "towerCameraAt", "WALK", "walkEye", "BOARD", "boardEye", "WHITE_ROOM", "ARM", "footfallsBetween"]) {
      expect([gone, PRE[gone]]).toEqual([gone, undefined]);
    }
    for (const l of ["en", "pt"]) {
      expect(PRELAUNCH_TEXT[l].suit).toBeUndefined();
      expect(PRELAUNCH_TEXT[l].walk).toBeUndefined();
      expect(Object.keys(PRELAUNCH_TEXT[l].stages)).toEqual(STAGES);
    }
  });
  test("pad → cabin directly (no prerequisite), the count only once the checklist is complete", () => {
    let st = createPreLaunch();
    expect(advance(st, "count", { checklistDone: true }).stage).toBe("count"); // a skip ahead is allowed by order…
    st = advance(st, "cabin");
    expect(st.stage).toBe("cabin");
    expect(advance(st, "pad")).toBe(st); // never back
    expect(advance(st, "count")).toBe(st); // …but never without the checklist
    expect(advance(st, "count", { checklistDone: true }).stage).toBe("count");
  });
  test("the launch is requested exactly once, whatever asks for it (the count, SKIP, twice)", () => {
    for (const stage of STAGES) {
      let st = createPreLaunch(stage);
      const a = requestLaunch(st);
      expect(a.launch).toBe(true);
      st = a.state;
      expect(requestLaunch(st).launch).toBe(false);
      expect(requestLaunch(requestLaunch(st).state).launch).toBe(false);
      expect(advance(st, "count", { checklistDone: true })).toBe(st); // nothing moves once launched
      expect(advance(st, "cabin")).toBe(st);
    }
  });
  test("stage names of the earlier experience are handled safely", () => {
    expect(normalizeStage("suit")).toBe("pad");
    expect(normalizeStage("tower")).toBe("pad");
    expect(normalizeStage("walkway")).toBe("cabin");
    expect(normalizeStage("cabin")).toBe("cabin");
    for (const junk of [undefined, null, "", "whiteRoom", 42, "constructor"]) expect(normalizeStage(junk)).toBe(null);
    expect(createPreLaunch("suit").stage).toBe("pad");
    expect(createPreLaunch("walkway").stage).toBe("cabin");
    expect(createPreLaunch("nonsense").stage).toBe("pad");
    // a state carrying an unknown stage never advances into a broken place
    const odd = { stage: "walkway", launched: false };
    expect(advance(odd, "cabin")).toBe(odd);
    expect(requestLaunch(odd).launch).toBe(true);
  });
});

describe("the launch complex shot", () => {
  test("a slow push in on LV-001 from the hardstand, then the cut into the cabin", () => {
    expect(18 / ROCKET_SCALE).toBeCloseTo(UNIT_M, 6); // 18 m per model unit drawn at 0.6: 30 m per scene unit
    const a = padCameraAt(0);
    const b = padCameraAt(PAD_SHOT.dur);
    expect(a.pos[1] * UNIT_M).toBeLessThan(4); // eye height on the hardstand
    expect(b.pos[1] * UNIT_M).toBeLessThan(4);
    expect(dist(a.pos, b.pos)).toBeGreaterThan(0.5); // it moves in
    let prev = a;
    for (let t = 1 / 30; t <= PAD_SHOT.dur; t += 1 / 30) {
      const c = padCameraAt(t);
      expect(dist(c.pos, prev.pos) * UNIT_M * 30).toBeLessThan(14); // a push, never a swoop
      prev = c;
    }
    expect(PAD_SHOT.dur).toBeLessThan(12); // short: the cabin is where the player acts
    expect(PAD_SHOT.cta).toBeLessThan(PAD_SHOT.dur);
    expect(PAD_SHOT.call.at).toBeLessThan(PAD_SHOT.dur);
  });
});

describe("the cabin and its checklist", () => {
  test("six items, in order, each needing the one before", () => {
    expect(CHECKLIST.map((c) => c.id)).toEqual(["pressure", "guidance", "comms", "restraints", "hatch", "launchControl"]);
    let ck = createChecklist();
    expect(confirmItem(ck, "hatch")).toBe(ck);
    CHECKLIST.forEach((c, i) => {
      expect(nextItem(ck).id).toBe(c.id);
      ck = confirmItem(ck, c.id, i);
    });
    expect(checklistComplete(ck)).toBe(true);
    expect(nextItem(ck)).toBe(null);
  });
  test("the hatch swings shut after HATCH — CLOSED, and stays shut", () => {
    let ck = createChecklist();
    for (const id of ["pressure", "guidance", "comms", "restraints"]) ck = confirmItem(ck, id, 0);
    expect(hatchClosedAt(ck, 100)).toBe(0);
    ck = confirmItem(ck, "hatch", 10);
    expect(hatchClosedAt(ck, 10)).toBe(0);
    expect(hatchClosedAt(ck, 20)).toBe(1);
  });
  test("all six console panels drawn in the cabin can be inspected, in EN and PT", () => {
    expect(CABIN_PANELS.map((p) => p.id)).toEqual(["entry", "flight", "guidance", "caution", "power", "comms"]);
    for (const p of CABIN_PANELS) for (const l of ["en", "pt"]) expect(p[l].name.length * p[l].body.length).toBeGreaterThan(0);
  });
  test("panels to inspect lie within the couch's view; the checklist names real panels", () => {
    for (const p of CABIN_PANELS) {
      expect(p.look.yaw).toBeGreaterThanOrEqual(CABIN_LOOK.yaw[0]);
      expect(p.look.yaw).toBeLessThanOrEqual(CABIN_LOOK.yaw[1]);
      expect(p.look.pitch).toBeGreaterThanOrEqual(CABIN_LOOK.pitch[0]);
      expect(p.look.pitch).toBeLessThanOrEqual(CABIN_LOOK.pitch[1]);
      expect(p.en.name).toBeTruthy();
      expect(p.pt.name).toBeTruthy();
    }
    for (const c of CHECKLIST) if (c.panel) expect(CABIN_PANELS.some((p) => p.id === c.panel)).toBe(true);
  });
});

describe("the terminal count and the handover", () => {
  test("T-45 to T-15, then the launch film (which starts at T-15) takes over", () => {
    expect(COUNT.handoff).toBe(LIFTOFF_T);
    expect(countAt(0).shown).toBe(45);
    expect(countAt(COUNT_DUR - 0.01).handoff).toBe(false);
    expect(countAt(COUNT_DUR).handoff).toBe(true);
    expect(countAt(COUNT_DUR + 50).tMinus).toBe(LIFTOFF_T);
    expect(countAt(COUNT_DUR).dip).toBe(1);
  });
  test("each call is due once, in order, all before the handover — the film says T-10 onwards", () => {
    const said = new Set();
    const order = [];
    for (let e = 0; e <= COUNT_DUR; e += 0.1) {
      for (const c of dueCalls(e, said)) {
        said.add(c.id);
        order.push([c.id, e]);
      }
    }
    expect(order.map((o) => o[0])).toEqual(COUNT.calls.map((c) => c.id));
    for (const c of COUNT.calls) expect(c.tMinus).toBeGreaterThan(LIFTOFF_T);
  });
});

describe("words and voices", () => {
  test("every line the experience says is in the catalogue, in English and Portuguese", () => {
    const ids = new Set(comms.lines.map((l) => l.id));
    const wanted = [
      PAD_SHOT.call.id,
      ...CHECKLIST.map((c) => c.call),
      "prelaunch.crewReadyLaunch",
      ...COUNT.calls.map((c) => c.id),
    ];
    for (const id of wanted) {
      expect([id, ids.has(id)]).toEqual([id, true]);
      const l = comms.lines.find((x) => x.id === id);
      for (const v of l.variants) {
        expect(v.en).toBeTruthy();
        expect(v.pt).toBeTruthy();
      }
    }
  });
  test("the removed scenes' lines are gone from the catalogue", () => {
    const ids = new Set(comms.lines.map((l) => l.id));
    for (const id of ["prelaunch.suitCheck", "prelaunch.commHouston", "prelaunch.commCrew", "prelaunch.crewReady", "prelaunch.elevator", "prelaunch.armView", "prelaunch.whiteRoom"]) {
      expect([id, ids.has(id)]).toEqual([id, false]);
    }
  });
  test("English and Portuguese have the same words on screen", () => {
    const keys = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
    expect(keys(PRELAUNCH_TEXT.pt).sort()).toEqual(keys(PRELAUNCH_TEXT.en).sort());
    expect(PRELAUNCH_TEXT.en.entry).toBe("PRE-LAUNCH EXPERIENCE");
    expect(PRELAUNCH_TEXT.en.skip).toBe("SKIP PRE-LAUNCH");
    expect(PRELAUNCH_TEXT.en.cabin.ready).toBe("CREW READY FOR LAUNCH");
  });
});
