import fs from "fs";
import path from "path";

/*
 * The official missions' flow, read from the source (as directCut.test does):
 * MISSIONS → destination → pilot difficulty → mission control → launch → … →
 * START MISSIONS → the descent at the destination chosen before launch.
 * Training flies the Sea of Tranquility only.
 */
const SRC = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

describe("official missions in the main game", () => {
  const mission = read("pages/Mission.jsx");
  const select = read("components/missions/MissionSelect.jsx");
  const app = read("App.js");

  test("MISSIONS is part of the main game: /missions, the main menu and the navigation lead to it", () => {
    expect(app).toMatch(/<Route path="\/missions" element=\{<Mission \/>\} \/>/);
    expect(read("pages/Landing.jsx")).toMatch(/to="\/missions"\s+data-testid="hero-cta-mission"/);
    expect(read("components/Navbar.jsx")).toMatch(/link\("\/missions", "Missions", "nav-mission"\)/);
    expect(mission).toMatch(/location\.pathname === "\/missions" \? STATES\.SELECT : STATES\.CONTROL/);
  });

  test("the selection screen offers the four official missions, then the pilot difficulty, with no unlocks", () => {
    expect(select).toMatch(/OFFICIAL_MISSIONS\.map/);
    expect(select).toMatch(/data-testid=\{`mission-start-\$\{site\.id\}`\}/);
    expect(select).toMatch(/START MISSION/);
    expect(select).toMatch(/<DifficultySelect/);
    expect(select).not.toMatch(/\bLock\b|isLocked|locked:|unlockedBy|requires:/);
  });

  test("the choice is one frozen mission config held from launch to splashdown; it changes only on MISSIONS, before launch", () => {
    expect(mission).toMatch(/createMissionConfig\(\{ mode: MODE\.OFFICIAL, \.\.\.selection \}\)/);
    expect((mission.match(/setSelection\(/g) || []).length).toBe(1); // handleConfirmMission only
    expect(mission).toMatch(/const handleConfirmMission = \(sel\) => \{\s+setSelection\(saveSelection\(sel\)\);\s+setState\(STATES\.CONTROL\);/);
    expect(mission).toMatch(/onChangeMission=\{\(\) => setState\(STATES\.SELECT\)\}/);
    // the descent flies the destination; the orbit is shown over it
    expect(mission).toMatch(/<DescentGame\s+difficulty=\{difficulty\}\s+site=\{mission\.siteId\}/);
    expect(mission).toMatch(/orbitView=\{mission\.orbitView\}/);
  });

  test("START MISSIONS continues to the destination's descent briefing: no second selection, no relaunch", () => {
    const start = mission.slice(mission.indexOf("const handleStartMissions"), mission.indexOf("const enterDescent"));
    expect(start).toMatch(/setState\(STATES\.BRIEFING\)/);
    expect(mission).not.toMatch(/STATES\.DIFFICULTY|DifficultySelect/);
    // the only selection screen is MISSIONS, before launch
    expect((mission.match(/<MissionSelect/g) || []).length).toBe(1);
    expect(mission).toMatch(/\{state === STATES\.SELECT && \(\s*<MissionSelect/);
    expect(mission).toMatch(/<PdiBriefing difficulty=\{difficulty\} mission=\{mission\} onBegin=\{handleBeginPdi\} \/>/);
    // a restarted landing goes back to the same briefing
    const restart = mission.slice(mission.indexOf("const handleRestartDescent"), mission.indexOf("const handleMissionComplete"));
    expect(restart).toMatch(/setState\(STATES\.BRIEFING\)/);
  });

  test("Silent Horizon: loss of signal behind the Moon before the descent; no call to Houston from the far side", () => {
    expect(mission).toMatch(/if \(missionRef\.current\.comms\.farSide\) setState\(STATES\.FAR_SIDE\)/);
    expect(mission).toMatch(/<FarSideIntro audio=\{audio\} briefing=\{mission\.briefing\} onDone=\{enterDescent\} \/>/);
    expect(mission).toMatch(/if \(!missionRef\.current\.comms\.farSide\) audio\.say\("descent\.pdiStart"/);
  });

  test("official results are logged apart from training: destination, pilot difficulty, landing and completion", () => {
    expect(mission).toMatch(/logMissionStart\(\{ siteId: m\.siteId, difficulty: m\.difficulty \}\)/);
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
