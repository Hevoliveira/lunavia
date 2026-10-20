import fs from "fs";
import path from "path";

/*
 * The game's order, read from the source (as directCut.test does): opening
 * LUNAVIA shows THE ROAD TO THE MOON; LAUNCH SEQUENCE — INITIATE plays the
 * expedition (launch → lunar orbit → deployment and undocking → title → START
 * MISSIONS), then the menu (MISSIONS / TRAINING);
 * MISSIONS → destination → pilot difficulty → the descent at that destination,
 * with no second launch. Training flies the Sea of Tranquility only.
 */
const SRC = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const between = (src, a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a) + a.length));

describe("startup screen, then the expedition, then the game menu", () => {
  const mission = read("pages/Mission.jsx");
  const app = read("App.js");

  test("opening LUNAVIA (/) shows THE ROAD TO THE MOON and waits: only LAUNCH SEQUENCE — INITIATE starts the launch", () => {
    expect(app).toMatch(/<Route path="\/" element=\{<Mission key="opening" entry="opening" \/>\} \/>/);
    expect(mission).toMatch(/const ENTRY_STATE = \{ opening: STATES\.CONTROL, menu: STATES\.MENU, missions: STATES\.SELECT \}/);
    expect(mission).toMatch(/\{state === STATES\.CONTROL && <ControlRoomView onLaunch=\{handleLaunch\} \/>\}/);
    // the launch starts in one place only, from the startup state, once
    expect((mission.match(/setState\(STATES\.LAUNCH\)/g) || []).length).toBe(1);
    const launch = between(mission, "const handleLaunch = () => {", "};");
    expect(launch).toMatch(/if \(stateRef\.current !== STATES\.CONTROL\) return;\s+stateRef\.current = STATES\.LAUNCH;/);
    // no autoplay: nothing on mount, no timer or resume event starts it
    expect(mission).not.toMatch(/visibilitychange|appStateChange|addEventListener\("resume"/);
    const view = read("components/scenes/ControlRoomView.jsx");
    expect(view).toMatch(/THE ROAD<br \/>/);
    expect(view).toMatch(/LV-001 · READY FOR LAUNCH/);
    expect(view).toMatch(/LAUNCH SEQUENCE — INITIATE/);
    expect(view).toMatch(/LV-001 ARTEMIS-CLASS/);
    expect(view).toMatch(/onClick=\{startCountdown\}/); // the 1.1-s GO follows the press only
    // the launch film itself is the approved one, ending in the direct cut
    expect(mission).toMatch(/<LaunchCinematic audio=\{audio\} onComplete=\{handleLaunchComplete\} onSkip=\{handleSkipLaunch\} onCutAhead=\{handleCutAhead\} \/>/);
  });

  test("START MISSIONS on the title screen opens MISSIONS / TRAINING: no landing, no relaunch, nothing reset", () => {
    const start = between(mission, "const handleStartMissions", "const handleTraining");
    expect(start).toMatch(/setState\(STATES\.MENU\)/);
    expect(start).not.toMatch(/BRIEFING|LAUNCH|MANUAL_DESCENT|resetMission/);
    expect(mission).toMatch(/<ModeMenu onMissions=\{\(\) => setState\(STATES\.SELECT\)\} onTraining=\{handleTraining\} \/>/);
    expect(between(mission, "const handleTraining", "};")).toMatch(/navigate\("\/training"\)/);
    const menu = read("components/missions/ModeMenu.jsx");
    expect(menu).toMatch(/"mode-missions"[^\n]*"MISSIONS"/);
    expect(menu).toMatch(/"mode-training"[^\n]*"TRAINING"/);
  });

  test("MISSIONS: four destinations, then the pilot difficulty, with no unlocks; then that destination's briefing (no second launch)", () => {
    const select = read("components/missions/MissionSelect.jsx");
    expect(select).toMatch(/OFFICIAL_MISSIONS\.map/);
    expect(select).toMatch(/data-testid=\{`mission-start-\$\{site\.id\}`\}/);
    expect(select).toMatch(/<DifficultySelect/);
    expect(select).not.toMatch(/\bLock\b|isLocked|locked:|unlockedBy|requires:/);
    const confirm = between(mission, "const handleConfirmMission", "// End of the Earth departure");
    expect(confirm).toMatch(/setSelection\(next\)/);
    expect(confirm).toMatch(/setState\(STATES\.BRIEFING\)/);
    expect(confirm).not.toMatch(/STATES\.LAUNCH/);
    expect((mission.match(/setSelection\(/g) || []).length).toBe(1);
    expect((mission.match(/<MissionSelect/g) || []).length).toBe(1);
  });

  test("the chosen destination and difficulty fly the descent; a restart returns to the same briefing", () => {
    expect(mission).toMatch(/createMissionConfig\(\{ mode: MODE\.OFFICIAL, \.\.\.selection \}\)/);
    expect(mission).toMatch(/<DescentGame\s+difficulty=\{difficulty\}\s+site=\{mission\.siteId\}/);
    expect(mission).toMatch(/<PdiBriefing difficulty=\{difficulty\} mission=\{mission\} onBegin=\{handleBeginPdi\}/);
    expect(between(mission, "const handleRestartDescent", "const handleMissionComplete")).toMatch(/setState\(STATES\.BRIEFING\)/);
  });

  test("ABORT and the end of a mission come back to the menu, never through the opening again", () => {
    const reset = between(mission, "const resetMission", "// GO FOR PDI");
    expect(reset).toMatch(/setState\(STATES\.MENU\)/);
    expect(reset).not.toMatch(/STATES\.LAUNCH/);
    expect(read("pages/Training.jsx")).toMatch(/navigate\("\/menu"\)/);
    expect(app).toMatch(/<Route path="\/menu" element=\{<Mission key="menu" entry="menu" \/>\} \/>/);
    expect(read("components/Navbar.jsx")).toMatch(/link\("\/missions", "Missions", "nav-mission"\)/);
  });

  test("Silent Horizon: loss of signal behind the Moon before the descent; no call to Houston from the far side", () => {
    expect(mission).toMatch(/if \(missionRef\.current\.comms\.farSide\) setState\(STATES\.FAR_SIDE\)/);
    expect(mission).toMatch(/<FarSideIntro audio=\{audio\} briefing=\{mission\.briefing\} onDone=\{enterDescent\} \/>/);
    expect(mission).toMatch(/if \(!missionRef\.current\.comms\.farSide\) audio\.say\("descent\.pdiStart"/);
  });

  test("official results are logged apart from training: destination, pilot difficulty, landing and completion", () => {
    expect(mission).toMatch(/flightIdRef\.current = logMissionStart\(next\)/);
    expect(mission).toMatch(/logMissionLanding\(flightIdRef\.current, result\)/);
    expect(mission).toMatch(/logMissionComplete\(flightIdRef\.current\)/);
  });
});

describe("Flight Training Center: lunar landing at the Sea of Tranquility only", () => {
  const training = read("pages/Training.jsx");
  test("no destination choice for lunar landing training; the other three destinations are not offered", () => {
    expect(training).toMatch(/const siteId = TRAINING_LANDING_SITE;/);
    expect(training).not.toMatch(/SITE_DEFS|SITE_IDS|MissionCard|setSiteId|training-site-\$\{|FarSideIntro/);
    expect(training).toMatch(/SEA OF TRANQUILITY — LUNAR LANDING TRAINING/);
  });
  test("reentry training is still offered, and training still flies straight to the problem", () => {
    expect(training).toMatch(/EARTH REENTRY SIMULATOR/);
    expect(training).toMatch(/<ReentryGame/);
    expect(training).not.toMatch(/LaunchCinematic|MissionScene/);
  });
});

describe("after the landing: lunar ascent, rendezvous and the player's docking, then home", () => {
  const mission = read("pages/Mission.jsx");
  const ascent = read("components/LunarAscent.jsx");
  const dock = read("components/DockingOps.jsx");
  test("a successful landing continues to the lunar surface (ascent preparation), never straight home", () => {
    const cont = between(mission, "const handleContinueFromResult", "// Liftoff film over");
    expect(cont).toMatch(/if \(!descentResult \|\| descentResult\.crashed\) return;/);
    expect(cont).toMatch(/setState\(STATES\.ASCENT\)/);
    expect(cont).not.toMatch(/STATES\.RETURN/);
    // the return (trans-Earth injection) is reached only from a completed docking
    expect((mission.match(/setState\(STATES\.RETURN\)/g) || []).length).toBe(1);
    expect(between(mission, "const handleDockingComplete", "const handleDockingResult")).toMatch(/setState\(STATES\.RETURN\)/);
    expect(between(mission, "const handleAscentComplete", "const handleDockingComplete")).toMatch(/setState\(STATES\.DOCKING\)/);
  });
  test("the ascent starts at the landing's own site and pose, and only from INITIATE LUNAR ASCENT", () => {
    expect(mission).toMatch(/<LunarAscent\s+siteId=\{mission\.siteId\}\s+pose=\{landingRef\.current && landingRef\.current\.pose\}/);
    expect(ascent).toMatch(/useState\("prep"\)/);
    expect(ascent).toMatch(/LUNAR SURFACE — ASCENT PREPARATION/);
    expect(ascent).toMatch(/INITIATE LUNAR ASCENT/);
    expect((ascent.match(/setStage\("countdown"\)/g) || []).length).toBe(1);
    expect(between(ascent, "const initiate = () => {", "};")).toMatch(/if \(stage !== "prep"\) return;/);
    // the stages separate: the descent stage stays (LanderModel with the ascent stage on its own)
    expect(ascent).toMatch(/<LanderModel scale=\{LM\.scale\} fx=\{fx\} ascent=\{ascRef\.current\} \/>/);
  });
  test("docking is the simulation's: stepped every frame from the player's input, judged only by its contact rules; retries restart at the checkpoint", () => {
    expect(dock).toMatch(/const e = stepDocking\(s, inp, difficulty, dt, \{ align: alignRef\.current, speed: speedRef\.current \}\);/);
    expect(dock).not.toMatch(/status = "docked"|phase: "docked"|kind: "docked"/); // the component never declares a dock itself
    // every attempt (the first, a retry after a failure, RESTART DOCKING) starts from the full checkpoint state
    expect(between(dock, "const startDocking = () => {", "};")).toMatch(/restoreCheckpoint\(s, difficulty(, undefined, trainingStart)?\);/);
    expect(dock).toMatch(/RETRY FROM RENDEZVOUS CHECKPOINT/);
  });
  test("RESTART DOCKING: always there during the approach, guarded, and it restarts only the docking", () => {
    expect(dock).toMatch(/<HoldButton testId="dock-restart" label=\{ui\.restart\}/);
    const restart = between(dock, "const restartDocking = () => {", "\n  };");
    expect(restart).toMatch(/ph === "failed" \|\| \(ph === "docking" && s\.status === "approach"\)/); // never once captured
    expect(restart).toMatch(/startDocking\(\);/);
    expect(restart).not.toMatch(/rendezvous|setPhase\(|plan\.|onComplete/); // no rendezvous, ascent or landing replay
    expect(restart).toMatch(/attemptsRef\.current \+= 1/); // a new attempt in the log
    // no jet carried over: held buttons cleared, keys still down ignored until released
    const start = between(dock, "const startDocking = () => {", "\n  };");
    expect(start).toMatch(/held\.current\.clear\(\);/);
    expect(start).toMatch(/keysBlocked\.current = new Set\(keysDown\.current\);/);
    expect(start).toMatch(/guidanceRef\.current\.reset\(\);/);
    // the guidance panel is drawn from data/dockingGuidance, which only reads the state
    expect(dock).toMatch(/<GuidancePanel\s+g=\{g\}/);
  });
  test("four docking views on one simulation: NAV (as before), WINDOW, COCKPIT, 360°", () => {
    const cabin = read("components/DockingCabin.jsx");
    expect(dock).toMatch(/useState\("NAV"\)/); // NAV first
    // NAV keeps the docking camera it always had: on the port's axis, looking up it
    expect(dock).toMatch(/P = \[port\[0\] - axis\[0\] \* 0\.25, port\[1\] - axis\[1\] \* 0\.25, port\[2\] - axis\[2\] \* 0\.25\];/);
    // the other three: their own cameras (data/dockingViews), their own 3D (DockingCabin), the 360° gestures
    expect(dock).toMatch(/const cam = viewCamera\(v, s, orbitRef\.current\);/);
    expect(dock).toMatch(/<WindowFrame simRef=\{simRef\}/);
    expect(dock).toMatch(/<Cockpit simRef=\{simRef\}/);
    expect(dock).toMatch(/view === "ORBIT" && <OrbitPad orbitRef=\{orbitRef\} \/>/);
    expect(cabin).toMatch(/export function WindowFrame/);
    expect(cabin).toMatch(/export function Cockpit/);
    // a view switch only sets the view: it never touches the simulation, the inputs or the attempt
    const setView = between(dock, "const setView = (v) => {", "\n  };");
    expect(setView).not.toMatch(/simRef|held\.|startDocking|restore|stepDocking|press\(/);
    // the gestures only move the camera
    const pad = between(dock, "function OrbitPad({ orbitRef }) {", "\n}\n");
    expect(pad).not.toMatch(/simRef|press\(|inputRef|held/);
    expect(mission).toMatch(/<DockingOps\s+difficulty=\{difficulty\}\s+farSide=\{mission\.comms\.farSide\}/);
    expect(mission).toMatch(/onResult=\{handleDockingResult\}/);
  });
});

describe("mission scoring: measured at the end of each phase, shown only after the mission", () => {
  const mission = read("pages/Mission.jsx");
  test("each phase is scored from its own result, once, by the flight's scoring (never during flight)", () => {
    expect(between(mission, "const handleConfirmMission", "// End of the Earth departure")).toMatch(/scoringRef\.current = createFlightScoring\(\{ id: flightIdRef\.current, \.\.\.next \}\)/);
    expect(between(mission, "const enterDescent = () => {", "setState(STATES.MANUAL_DESCENT);")).toMatch(/sc\.beginDescent\(\);/);
    expect(between(mission, "const handleDescentEnd", "// RESTART on the results")).toMatch(/const L = sc\.landed\(result\);/);
    expect(between(mission, "const handleDockingResult", "// ABORT, END MISSION")).toMatch(/sc\.docking\(r\)/);
    expect(between(mission, "const handleMissionComplete", "// A capsule lost on entry")).toMatch(/const R = sc\.splashdown\(data\);[\s\S]*const M = sc\.mission\(\);/);
    expect(mission).toMatch(/onFailed=\{handleEntryLost\}/);
    // the active flight views never see a score
    ["components/DescentGame.jsx", "components/DockingOps.jsx", "components/ReentryGame.jsx", "components/DockingCabin.jsx", "data/dockingViews.js"].forEach((f) => {
      expect(read(f)).not.toMatch(/missionScoring|flightScoring|missionRecords|MissionDebrief/);
    });
    // the debrief: after MISSION COMPLETE (which stays), or a failed mission's END MISSION
    expect(mission).toMatch(/\{\(\(state === STATES\.COMPLETE && debriefOpen\) \|\| state === STATES\.DEBRIEF\) && debrief && \(/);
    expect(mission).toMatch(/data-testid="complete-overlay"/);
    expect(mission).toMatch(/MISSION COMPLETE/);
    expect(read("components/scoring/MissionDebrief.jsx")).not.toMatch(/setTimeout\([^)]*on(Menu|Missions|Close|Records)/); // never dismisses itself
    // FLIGHT RECORDS leaves the page directly: no reset to the menu (which would mount the lunar-orbit scene) on the way out
    expect(between(mission, "onRecords={() => {", "}}")).not.toMatch(/resetMission|setState/);
  });
  test("the approved menus stay as they were: MISSIONS / TRAINING, all four destinations open", () => {
    const menu = read("components/missions/ModeMenu.jsx");
    expect((menu.match(/choice\("/g) || []).length).toBe(2);
    const select = read("components/missions/MissionSelect.jsx");
    expect(select).toMatch(/to="\/records"/);
    expect(select).not.toMatch(/\bLock\b|isLocked|locked:|unlockedBy|requires:|disabled=\{/);
    expect(read("App.js")).toMatch(/<Route path="\/records" element=\{<Records \/>\} \/>/);
  });
});
