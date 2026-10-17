import fs from "fs";
import path from "path";

/*
 * The game's order, read from the source (as directCut.test does): opening
 * LUNAVIA plays the expedition first (launch → lunar orbit → deployment and
 * undocking → title → START MISSIONS), then the menu (MISSIONS / TRAINING);
 * MISSIONS → destination → pilot difficulty → the descent at that destination,
 * with no second launch. Training flies the Sea of Tranquility only.
 */
const SRC = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const between = (src, a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a) + a.length));

describe("opening first, then the game menu", () => {
  const mission = read("pages/Mission.jsx");
  const app = read("App.js");

  test("opening LUNAVIA (/) starts the launch: no menu, no mission control, no input before it", () => {
    expect(app).toMatch(/<Route path="\/" element=\{<Mission key="opening" entry="opening" \/>\} \/>/);
    expect(mission).toMatch(/const ENTRY_STATE = \{ opening: STATES\.LAUNCH, menu: STATES\.MENU, missions: STATES\.SELECT \}/);
    expect(mission).toMatch(/useState\(\(\) => ENTRY_STATE\[entry\] \|\| STATES\.LAUNCH\)/);
    expect(mission).not.toMatch(/ControlRoomView|STATES\.CONTROL/);
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
