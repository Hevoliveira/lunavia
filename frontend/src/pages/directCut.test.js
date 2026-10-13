import fs from "fs";
import path from "path";
import { ORBIT_ENTRY, ORBIT_SEQ, orbitShotAt } from "../data/orbitSequence";
import { TLI_CUT } from "../data/launchTimeline";

/*
 * The direct cut (a cinematic editing decision): the Earth departure ends 2 s
 * after GUIDANCE's "Cutoff." and the mission resumes on the arrival in lunar
 * orbit, CAPCOM's welcome. No translunar travel is shown or run in the
 * background, and nothing of it is left waiting on a timer.
 */
const SRC = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

describe("direct cut from TLI cutoff to lunar orbit", () => {
  const mission = read("pages/Mission.jsx");
  const launch = read("components/scenes/LaunchCinematic.jsx");
  const scene = read("components/MissionScene.jsx");

  test("the mission has no cruise state: the launch completes (or is skipped) straight into lunar orbit, on the arrival", () => {
    expect(mission).not.toMatch(/STATES\.SPACE|SPACE: "space"|cruiseClock|setSpaceTime|coastShotAt|mccLevel/);
    const complete = mission.slice(mission.indexOf("const handleLaunchComplete"), mission.indexOf("const handleSkipLaunch"));
    expect(complete).toMatch(/orbitRealRef\.current = ORBIT_ENTRY/);
    expect(complete).toMatch(/setState\(STATES\.ORBIT\)/);
    // SKIP takes the same path
    const skip = mission.slice(mission.indexOf("const handleSkipLaunch"), mission.indexOf("const handleSkipOrbit"));
    expect(skip).toMatch(/handleLaunchComplete\(\)/);
    // the launch hands over to the lunar-orbit scene directly; its textures are loaded during the launch
    expect(mission).toMatch(/onComplete=\{handleLaunchComplete\}/);
    expect(mission).toMatch(/preloadMissionScene\(\)/);
  });

  test("lunar orbit opens on the establishing shot, where CAPCOM welcomes the crew; no insertion-burn cue is left", () => {
    expect(orbitShotAt(ORBIT_ENTRY).shot.id).toBe("establish");
    expect(mission).toMatch(/\{ t: ORBIT_SEQ\.arrive \+ 0\.6, cue: "arrival" \}/);
    expect(ORBIT_SEQ.arrive + 0.6).toBeGreaterThan(ORBIT_ENTRY);
    expect(mission).not.toMatch(/loiOn|loiOff|ORBIT_SEQ\.ignition|ORBIT_SEQ\.cutoff/);
    expect(read("audio/commsLines.json")).toMatch(/"orbit\.arrival".*Lunar orbit insertion looks good\. Welcome to the Moon\./);
  });

  test("the launch film ends on its own clock 2 s after the call has ended, with a fade of at most 0.5 s", () => {
    expect(launch).toMatch(/comms\.subscribe/);
    // timed on the real clock from the end of the call
    expect(launch).toMatch(/performance\.now\(\) \/ 1000 - C\.lineEndWall - TL\.TLI_CUT\.hold/);
    expect(launch).toMatch(/TL\.tliCutHoldEnd\(null\)/);
    expect(launch).toMatch(/hooks\.onComplete\(\)/);
    expect(TLI_CUT.hold).toBe(2);
    expect(TLI_CUT.fade).toBeLessThanOrEqual(0.5);
    // no separation or farewell cameras, sounds or calls after TLI
    expect(launch).not.toMatch(/SEP_CAMS|case "carrierSep"|launch\.lunarTransfer|stageSepRcs/);
  });

  test("the lunar-orbit scene keeps no cruise or approach branch", () => {
    expect(scene).not.toMatch(/coastShotAt|coastAttitude|cruiseCamera|deepCamera|approachCloseCamera|mccLevel|CISLUNAR/);
  });
});
