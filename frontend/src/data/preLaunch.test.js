import {
  ARM,
  BOARD,
  CABIN_LOOK,
  CABIN_PANELS,
  CHECKLIST,
  CM_ON_PAD,
  COUNT,
  COUNT_DUR,
  EYE,
  PRELAUNCH_TEXT,
  ROCKET_SCALE,
  STAGES,
  SUIT_STEPS,
  TOWER,
  TOWER_RIDE,
  WALK,
  WALK_LEN,
  WHITE_ROOM,
  advance,
  boardEye,
  checklistComplete,
  confirmItem,
  countAt,
  createChecklist,
  createPreLaunch,
  doSuitStep,
  dueCalls,
  footfallsBetween,
  hatchClosedAt,
  helmetAt,
  nextItem,
  requestLaunch,
  towerCameraAt,
  walkEye,
} from "./preLaunch";
import { LIFTOFF_T, UNIT_M } from "./launchTimeline";
import comms from "../audio/commsLines.json";

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("the pad at the launch film's scale", () => {
  test("the command module's hatch is at the crew access arm of the launch complex (≈ 93 m)", () => {
    // components/scenes/LaunchComplex: the crew access arm at y = 3.12 units
    expect(Math.abs(CM_ON_PAD.hatch.y - 3.12 * UNIT_M)).toBeLessThan(1.2);
    expect(CM_ON_PAD.hatch.r).toBeGreaterThan(1.3);
    expect(CM_ON_PAD.hatch.r).toBeLessThan(1.6);
    expect(18 / ROCKET_SCALE).toBeCloseTo(UNIT_M, 6); // 18 m per model unit drawn at 0.6: 30 m per scene unit
  });
  test("the arm runs from the tower to the white room, its floor under the hatch's sill", () => {
    expect(ARM.start).toBeGreaterThan(TOWER.face);
    expect(ARM.end).toBeLessThan(TOWER.face);
    const sill = CM_ON_PAD.hatch.y - CM_ON_PAD.hatch.h / 2;
    expect(sill - ARM.floor).toBeGreaterThan(0.4);
    expect(sill - ARM.floor).toBeLessThan(0.9);
    expect(WHITE_ROOM.x0).toBeGreaterThan(CM_ON_PAD.hatch.r); // the white room stands off the hull
    expect(ARM.height).toBeGreaterThan(EYE + 0.4); // head room in a suit and helmet
  });
});

describe("the suit room", () => {
  test("SUIT CHECK, COMMUNICATIONS CHECK, CREW READY, in that order, then the briefing", () => {
    let st = createPreLaunch();
    expect(st.stage).toBe("suit");
    expect(doSuitStep(st, "crewReady")).toBe(st); // out of order: nothing
    for (const s of SUIT_STEPS) st = doSuitStep(st, s.id);
    expect(st.suitDone).toEqual(["suitCheck", "commCheck", "crewReady"]);
    expect(st.briefing).toBe(true);
  });
  test("the helmets go on one after the other during SUIT CHECK and stay locked", () => {
    expect(helmetAt(0, null)).toBe(0);
    expect(helmetAt(0, 3)).toBe(1);
    expect(helmetAt(2, 3)).toBeLessThan(0.5);
    expect(helmetAt(2, SUIT_STEPS[0].dur)).toBe(1);
    // the call that says the helmets are locked comes after the last one is down and locked
    const lockedCall = SUIT_STEPS[0].calls.find((c) => c.id === "prelaunch.suitCheck");
    expect(helmetAt(2, lockedCall.at)).toBe(1);
    expect(helmetAt(2, lockedCall.at - 0.5)).toBe(1);
  });
});

describe("the stages follow each other and never go back", () => {
  test("the tower only after the crew is ready; the count only once the checklist is complete", () => {
    let st = createPreLaunch();
    expect(advance(st, "tower")).toBe(st);
    for (const s of SUIT_STEPS) st = doSuitStep(st, s.id);
    st = advance(st, "tower");
    expect(st.stage).toBe("tower");
    expect(advance(st, "suit")).toBe(st);
    st = advance(advance(st, "walkway"), "cabin");
    expect(st.stage).toBe("cabin");
    expect(advance(st, "count")).toBe(st);
    expect(advance(st, "count", { checklistDone: true }).stage).toBe("count");
    expect(STAGES).toEqual(["suit", "tower", "walkway", "cabin", "count"]);
  });
  test("the launch is requested exactly once, whatever asks for it (the count, SKIP, twice)", () => {
    let st = createPreLaunch();
    const a = requestLaunch(st);
    expect(a.launch).toBe(true);
    st = a.state;
    expect(requestLaunch(st).launch).toBe(false);
    expect(requestLaunch(requestLaunch(st).state).launch).toBe(false);
    expect(advance(st, "count", { checklistDone: true })).toBe(st); // nothing moves once launched
  });
});

describe("the tower ride", () => {
  test("arrival low on the hardstand, then the elevator rising smoothly to the arm's level", () => {
    const a = towerCameraAt(0);
    expect(a.pos[1] * UNIT_M).toBeLessThan(4);
    const end = towerCameraAt(TOWER_RIDE.dur);
    expect(Math.abs(end.pos[1] * UNIT_M - (ARM.floor + EYE))).toBeLessThan(0.05);
    let prev = towerCameraAt(0);
    for (let t = 1 / 30; t <= TOWER_RIDE.dur; t += 1 / 30) {
      const c = towerCameraAt(t);
      // < 14 m/s: a push and an elevator, never a swoop; the one cut is hidden in the dip to black
      if (c.shot === prev.shot) expect(dist(c.pos, prev.pos) * UNIT_M * 30).toBeLessThan(14);
      else expect(c.dip).toBeGreaterThan(0.9);
      prev = c;
    }
  });
  test("the elevator ends at the tower, where the walk begins (no jump between them)", () => {
    const end = towerCameraAt(TOWER_RIDE.dur);
    const start = walkEye(0);
    expect(Math.abs(end.pos[1] * UNIT_M - start[1])).toBeLessThan(0.1);
    expect(Math.abs(end.pos[0] * UNIT_M - start[0])).toBeLessThan(0.01);
    expect(Math.abs(end.pos[2] * UNIT_M - start[2])).toBeLessThan(0.01);
  });
});

describe("the walk and the boarding", () => {
  test("along the arm to the white room, pausing at the view and at the hatch", () => {
    expect(walkEye(0)[0]).toBeCloseTo(ARM.start, 5);
    expect(walkEye(WALK_LEN)[0]).toBeCloseTo(WALK.stops[1].x, 5);
    expect(walkEye(1e9)[0]).toBeCloseTo(WALK.stops[1].x, 5);
    expect(WALK.stops[0].x).toBeLessThan(ARM.start);
    expect(WALK.stops[0].x).toBeGreaterThan(ARM.end);
    expect(WALK.stops[1].x).toBeLessThan(WHITE_ROOM.x1);
    expect(WALK_LEN / WALK.speed).toBeLessThan(40); // a walk, not a trek
    expect(footfallsBetween(0, 7.2)).toBe(10);
  });
  test("boarding goes to the hatch, never through the hull, and dips before the cabin takes over", () => {
    const h = CM_ON_PAD.hatch;
    for (let t = 0; t <= BOARD.dur; t += 0.1) {
      const e = boardEye(t);
      expect(e.pos[0]).toBeGreaterThan(h.r);
    }
    expect(BOARD.dip[1]).toBe(BOARD.dur);
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
      ...SUIT_STEPS.flatMap((s) => s.calls.map((c) => c.id)),
      "prelaunch.briefing",
      ...WALK.stops.map((s) => s.call),
      "prelaunch.elevator",
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
  test("English and Portuguese have the same words on screen", () => {
    const keys = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
    expect(keys(PRELAUNCH_TEXT.pt).sort()).toEqual(keys(PRELAUNCH_TEXT.en).sort());
    expect(PRELAUNCH_TEXT.en.entry).toBe("PRE-LAUNCH EXPERIENCE");
    expect(PRELAUNCH_TEXT.en.skip).toBe("SKIP PRE-LAUNCH");
    expect(PRELAUNCH_TEXT.en.cabin.ready).toBe("CREW READY FOR LAUNCH");
  });
});
