import fs from "fs";
import path from "path";
import { DOCKING, PULSE, checkpointState, engageCenter, engageStabilize, fineStep, restoreCheckpoint, stepDocking, telemetry } from "./dockingSim";
import { guidedPilot } from "./dockingGuidance";
import { DOCKING_SCENARIOS, LANDING_SCENARIOS, REENTRY_SCENARIOS, difficultyFor, findScenario, scenarioList } from "./trainingScenarios";
import { dockingDebrief } from "./trainingDebrief";

/*
 * DOCKING TRAINING (Training Center): the mission's own docking simulation from a training
 * checkpoint, immediate retries, a debrief, and no mission rewards.
 */
const SRC = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

// a student following the panel, pressing the assists it names (input only)
function fly(d, over, { lag = 0.7, maxT = 900 } = {}) {
  const s = checkpointState(d, over || {});
  const ctx = { align: false, speed: !!DOCKING[d].assists.speed, fine: false };
  const p = guidedPilot(d, { lag, align: false, speed: ctx.speed });
  const hist = [];
  let cmd = { t: [0, 0, 0], r: [0, 0, 0] };
  let hold = 0;
  const dt = 1 / 30;
  while (s.t < maxT && s.status !== "docked" && s.status !== "failed") {
    hist.push(JSON.parse(JSON.stringify({ pos: s.pos, vel: s.vel, q: s.q, w: s.w, t: s.t, stab: s.stab, center: s.center })));
    if (hold <= 0) {
      cmd = p({ ...s, ...hist[Math.max(0, hist.length - 1 - Math.round(lag / dt))], status: s.status });
      hold = PULSE;
      if (cmd.assist === "align") ctx.align = true;
      if (cmd.assist === "center" && !s.center) engageCenter(s, d);
      if (cmd.assist === "stabilize" && !s.stab) engageStabilize(s, d);
      if (cmd.assist === "fine") ctx.fine = true;
      if (cmd.fine) fineStep(s, d, cmd.fine, ctx);
    }
    hold -= dt;
    stepDocking(s, cmd, d, dt, ctx);
  }
  return s;
}

describe("DOCKING TRAINING", () => {
  test("a third discipline beside lunar landing and Earth reentry, which keep their scenarios", () => {
    expect(scenarioList("docking")).toBe(DOCKING_SCENARIOS);
    expect(scenarioList("landing")).toBe(LANDING_SCENARIOS);
    expect(scenarioList("reentry")).toBe(REENTRY_SCENARIOS);
    expect(DOCKING_SCENARIOS.map((s) => s.id)).toEqual(["approach", "drift", "commander"]);
    expect(difficultyFor(findScenario("docking", "commander"), "CADET")).toBe("COMMANDER");
    // it teaches the six things the brief lists
    const taught = new Set(DOCKING_SCENARIOS.flatMap((s) => s.teaches));
    ["Relative motion", "Attitude alignment", "Lateral alignment", "Velocity matching", "Final approach", "Docking contact"].forEach((t) => expect(taught.has(t)).toBe(true));
    const page = read("pages/Training.jsx");
    expect(page).toMatch(/docking: \{\s+title: "ORBITAL DOCKING TRAINING"/);
    expect(page).toMatch(/landing: \{/);
    expect(page).toMatch(/reentry: \{/);
  });
  test("every scenario is dockable from its own start, by following the panel (each difficulty it is offered at)", () => {
    for (const sc of DOCKING_SCENARIOS) {
      for (const d of sc.lock ? [sc.lock] : ["CADET", "ASTRONAUT", "COMMANDER"]) {
        const s = fly(d, sc.start(d));
        expect([sc.id, d, s.status]).toEqual([sc.id, d, "docked"]);
      }
    }
  });
  test("it starts at the checkpoint (no ascent or rendezvous), and RESTART DOCKING returns to the scenario's own start", () => {
    const over = findScenario("docking", "drift").start("ASTRONAUT");
    const s = checkpointState("ASTRONAUT", over);
    const m = telemetry(s, "ASTRONAUT");
    expect(m.axial).toBeGreaterThan(30);
    expect(m.closing).toBeCloseTo(0.18, 2);
    for (let i = 0; i < 600; i++) stepDocking(s, { t: [0.3, 1, 0], r: [0, 0, 0] }, "ASTRONAUT", 1 / 60);
    restoreCheckpoint(s, "ASTRONAUT", undefined, over);
    expect(s.pos).toEqual(checkpointState("ASTRONAUT", over).pos);
    expect(s.vel).toEqual(checkpointState("ASTRONAUT", over).vel);
    expect(s.prop).toBe(DOCKING.ASTRONAUT.prop);
    // DockingOps: training goes straight to the docking and back to that start on restart
    const ops = read("components/DockingOps.jsx");
    expect(ops).toMatch(/if \(training\) \{\s+setPhase\("handover"\);/);
    expect(ops).toMatch(/restoreCheckpoint\(s, difficulty, undefined, trainingStart\)/);
    expect(ops).toMatch(/if \(!training\) setTimeout\(\(\) => setPhase\("transfer"\), 4200\);/);
  });
  test("the debrief reads the physics' own capture facts against the difficulty's limits, and ranks faster dockings higher", () => {
    const s = fly("CADET", null);
    const result = { success: true, attempts: 1, restarts: 0, contacts: 0, propLeft: s.prop, time: s.t, attemptTime: s.t, capture: s.lastContact.facts, attemptContacts: 0 };
    const db = dockingDebrief(result, "CADET");
    expect(db.success).toBe(true);
    expect(db.title).toMatch(/HARD DOCK CONFIRMED/);
    expect(db.rows.find((r) => r.testId === "debrief-dock-closing").ok).toBe(true);
    expect(db.rows.find((r) => r.testId === "debrief-dock-lateral").ok).toBe(true);
    expect(db.recommendations.length).toBeGreaterThan(0);
    const slow = dockingDebrief({ ...result, attemptTime: s.t + 60 }, "CADET");
    expect(db.record.rank).toBeGreaterThan(slow.record.rank);
  });
  test("training grants no mission rewards: the Training Center never touches the mission log, scores, medals or achievements", () => {
    const page = read("pages/Training.jsx");
    expect(page).not.toMatch(/from "@\/(lib\/missionRecords|data\/missionScoring|components\/scoring)/);
    expect(page).toMatch(/recordAttempt\(/); // its own training store only
    expect(page).toMatch(/<DockingOps key=\{runKey\} difficulty=\{run\.difficulty\} audio=\{audio\} training=\{/);
  });
});
