import fs from "fs";
import path from "path";
import {
  ATTITUDE_TURN,
  BURN_ACCEL,
  PERIGEE_KM,
  PTC_RATE,
  PTC_YAW,
  RETURN_CAPTIONS,
  RETURN_CUES,
  RETURN_LEN,
  RETURN_SEQ,
  SEP_LONG_AGO,
  SLEW_RAMP,
  SM_SEP,
  burnOffset,
  earthDistanceKm,
  earthFrame,
  returnCamera,
  returnMissionTime,
  returnShotAt,
  returnState,
  slew,
  smOffset,
  spsLevel,
  teiFrame,
  toVehicle,
  _test,
} from "./earthReturn";
import { EARTH_RADIUS_KM } from "./missionPhases";
import { EARTH_UNITS } from "./sceneTrack";

const { norm, cross, dot } = _test;
const SRC = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
// The scene's one Sun (components/MissionScene SUN_POS)
const SUN = norm([30, 10, -20]);
const MOON = [16.5, 0, 9.4];
const DT = 1 / 60;
const times = (a = 0, b = RETURN_LEN, dt = DT) => {
  const out = [];
  for (let t = a; t <= b + 1e-9; t += dt) out.push(+t.toFixed(5));
  return out;
};
const nose = (yaw) => [Math.cos(yaw), 0, -Math.sin(yaw)];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const frameAt = (t) => (returnShotAt(t).shot === "tei" ? teiFrame(t, MOON, SUN) : earthFrame(t, SUN));

describe("the return to Earth: one sequence, in order", () => {
  test("TEI preparation, the turn, the burn, cutoff, the coast, the Earth approach, the entry attitude", () => {
    const steps = [];
    times(0, RETURN_LEN - 1e-6, 0.1).forEach((t) => {
      const { step } = returnShotAt(t);
      if (steps[steps.length - 1] !== step) steps.push(step);
    });
    expect(steps).toEqual(["teiPrep", "teiTurn", "teiBurn", "teiCutoff", "coast", "approach", "entryAttitude"]);
    const shots = [];
    times(0, RETURN_LEN - 1e-6, 0.1).forEach((t) => {
      const { shot } = returnShotAt(t);
      if (shots[shots.length - 1] !== shot) shots.push(shot);
    });
    expect(shots).toEqual(["tei", "coast", "approach"]);
    // concise: well under a minute, and every step has a caption
    expect(RETURN_LEN).toBeLessThan(50);
    steps.forEach((s) => expect(RETURN_CAPTIONS[s].title).toBeTruthy());
  });

  test("the HUD clock runs forward from TEI at T+140 h to entry interface at T+193 h", () => {
    expect(returnMissionTime(RETURN_SEQ.ignition)).toBe(504000);
    expect(returnMissionTime(RETURN_LEN)).toBe(695000);
    let prev = -1;
    times().forEach((t) => {
      const m = returnMissionTime(t);
      expect(m).toBeGreaterThan(prev);
      prev = m;
    });
  });
});

describe("TEI: a finite burn on the service propulsion engine, along the axis", () => {
  test("the engine runs only between ignition and cutoff (no continuous burn home)", () => {
    times().forEach((t) => {
      const k = spsLevel(t);
      if (t < RETURN_SEQ.ignition || t >= RETURN_SEQ.cutoff + 0.3) expect(k).toBe(0);
      if (t >= RETURN_SEQ.ignition + 0.36 && t < RETURN_SEQ.cutoff) expect(k).toBe(1);
      expect(returnState(t).sps).toBe(k);
    });
    // nothing fires during the coast and the approach but the RCS
    times(RETURN_SEQ.coast, RETURN_LEN).forEach((t) => expect(returnState(t).sps).toBe(0));
    const burn = RETURN_SEQ.cutoff - RETURN_SEQ.ignition;
    expect(burn).toBeGreaterThan(5);
    expect(burn).toBeLessThan(12);
  });

  test("the nose is prograde through the burn and the CSM accelerates nose first (the plume aft, along -axis)", () => {
    times(RETURN_SEQ.ignition, RETURN_SEQ.cutoff + 0.3).forEach((t) => {
      const st = returnState(t);
      expect(Math.abs(wrap(st.yaw))).toBeLessThan(1e-9); // nose = +X, prograde
      expect(st.yawRcs).toBe(0); // no turning under thrust
    });
    // displacement along +X (the nose) with a constant acceleration while the engine runs, then a constant rate
    const a = (t) => (burnOffset(t + DT) - 2 * burnOffset(t) + burnOffset(t - DT)) / (DT * DT);
    expect(a(RETURN_SEQ.ignition + 4)).toBeCloseTo(BURN_ACCEL, 6);
    expect(a(RETURN_SEQ.cutoff + 2)).toBeCloseTo(0, 6);
    expect(burnOffset(RETURN_SEQ.ignition - 1)).toBe(0);
    // the thrust (opposite the plume, which leaves the SPS exit down the CSM's -axis) is along the nose:
    // the CSM's +Y is laid along the shot's +X (STACK_ROTATION), the SPS exit at the aft end
    expect(read("components/spacecraft/SpacecraftStack.jsx")).toMatch(/<group position=\{\[0, SPS\.exit, 0\]\}>/);
    expect(read("data/orbitSequence.js")).toMatch(/export const STACK_ROTATION = \[0, 0, -Math\.PI \/ 2\];/);
  });

  test("before the burn, an RCS slew from retrograde to prograde: the couple fires only while the rate changes", () => {
    expect(returnState(0).yaw).toBeCloseTo(Math.PI, 9);
    expect(returnState(RETURN_SEQ.turn[1]).yaw).toBeCloseTo(0, 9);
    const [t0, t1] = RETURN_SEQ.turn;
    const edges = [t0, t0 + SLEW_RAMP, t1 - SLEW_RAMP, t1];
    times(t0 - 0.5, t1 + 0.5).forEach((t) => {
      if (edges.some((e) => Math.abs(t - e) < 1.5 * DT)) return; // the finite difference straddles a phase change
      const a = returnState(t - DT).yaw;
      const b = returnState(t).yaw;
      const c = returnState(t + DT).yaw;
      const acc = (c - 2 * b + a) / (DT * DT);
      const tq = returnState(t).yawRcs;
      // torque sign = angular acceleration's (away from the ramp edges)
      if (Math.abs(acc) > 0.05) expect(Math.sign(acc)).toBe(tq);
      if (tq === 0) expect(Math.abs(acc)).toBeLessThan(0.05 + 1e-6);
      expect(Math.abs(c - b) / DT).toBeLessThan(0.6); // a believable rate, no snap
    });
  });

  test("the TEI frame is a circular lunar orbit: X prograde (the way the frame moves), Y radially out, over the sunlit side", () => {
    const f0 = teiFrame(5, MOON, SUN);
    const f1 = teiFrame(5.01, MOON, SUN);
    const v = norm([f1.origin[0] - f0.origin[0], f1.origin[1] - f0.origin[1], f1.origin[2] - f0.origin[2]]);
    expect(dot(v, f0.frame.x)).toBeGreaterThan(0.999);
    const up = norm([f0.origin[0] - MOON[0], 0, f0.origin[2] - MOON[2]]);
    expect(dot(up, f0.frame.y)).toBeGreaterThan(0.999);
    expect(dot(SUN, f0.frame.y)).toBeGreaterThan(0.5); // daylight below
  });
});

describe("the coast: engine off, a deliberate attitude, not pointed along the path", () => {
  test("passive thermal control: the long axis held broadside to the Sun while the CSM rolls slowly about it", () => {
    times(RETURN_SEQ.coast, RETURN_SEQ.entryTurn[0]).forEach((t) => {
      const st = returnState(t);
      expect(st.yaw).toBeCloseTo(PTC_YAW, 9);
      expect(st.yawRcs).toBe(0);
      expect(st.rollRcs).toBe(0);
      expect(st.roll).toBeCloseTo(PTC_RATE * (t - RETURN_SEQ.coast), 9);
      // the axis perpendicular to the Sun (within 6°) ...
      const F = earthFrame(t, SUN);
      const sv = toVehicle(F.frame, SUN);
      const ax = nose(st.yaw);
      expect(Math.abs(dot(ax, norm([sv[0], 0, sv[2]])))).toBeLessThan(Math.sin((6 * Math.PI) / 180));
    });
    // ... and that is not along the path: the coast does not force nose-first flight
    expect(Math.abs(PTC_YAW)).toBeGreaterThan(0.3);
  });

  test("attitude changes are smooth everywhere: no step in yaw or roll inside a shot", () => {
    let prev = null;
    times().forEach((t) => {
      const st = returnState(t);
      const { shot } = returnShotAt(t);
      if (prev && prev.shot === shot) {
        expect(Math.abs(st.yaw - prev.yaw)).toBeLessThan(0.02);
        expect(Math.abs(st.roll - prev.roll)).toBeLessThan(0.02);
      }
      prev = { ...st, shot };
    });
  });
});

describe("the Earth approach and the entry attitude", () => {
  test("the Earth grows, at its true apparent size for the distance", () => {
    let prev = Infinity;
    times(RETURN_SEQ.coast, RETURN_LEN).forEach((t) => {
      const D = earthDistanceKm(t);
      expect(D).toBeLessThan(prev + 1e-6);
      prev = D;
      const F = earthFrame(t, SUN);
      const d = Math.hypot(...F.origin);
      expect(Math.asin(EARTH_UNITS / d)).toBeCloseTo(Math.asin(EARTH_RADIUS_KM / D), 9);
    });
    expect(earthDistanceKm(RETURN_LEN)).toBeLessThan(25000);
  });

  test("the flight path skims the atmosphere, the Earth below it; at the hand-over the nose is along the path, roll stopped", () => {
    const F = earthFrame(RETURN_LEN, SUN);
    const toEarth = norm(F.origin.map((x) => -x));
    // the path's closest approach to the Earth's centre is the perigee
    const D = earthDistanceKm(RETURN_LEN);
    const sinA = Math.sqrt(1 - dot(F.frame.x, toEarth) ** 2);
    expect(D * sinA).toBeCloseTo(PERIGEE_KM, 3);
    expect(toVehicle(F.frame, toEarth)[1]).toBeLessThan(0); // below the path
    const st = returnState(RETURN_LEN);
    expect(st.yaw).toBeCloseTo(0, 9); // SM aft, CM nose first: the reentry's EARTH APPROACH attitude
    expect(st.rollRcs).toBe(0);
    expect(returnState(RETURN_LEN - 0.1).roll).toBeCloseTo(st.roll, 9); // the roll has stopped
    // the reentry's approach flies the CSM apex first, then separates the SM and turns the CM
    expect(read("components/scenes/ReentryScene.jsx")).toMatch(/if \(v\.phase === "APPROACH"\) smQuatRef\.current\.copy\(apexFwd\);/);
  });
});

describe("the cameras", () => {
  test("the CSM travels screen-left in every shot home (as the reentry's approach), and the camera is on its sunlit side", () => {
    times(0, RETURN_LEN, 0.25).forEach((t) => {
      const c = returnCamera(t);
      const f = norm([c.look[0] - c.pos[0], c.look[1] - c.pos[1], c.look[2] - c.pos[2]]);
      const right = norm(cross(f, [0, 1, 0]));
      expect(right[0]).toBeLessThan(-0.3); // +X (the way the CSM goes) is on the left of the frame
      const sv = toVehicle(frameAt(t).frame, SUN);
      expect(Math.sign(c.pos[2])).toBe(Math.sign(sv[2]));
    });
  });

  test("the camera never enters the spacecraft (more than 5 m from its hull)", () => {
    times(0, RETURN_LEN, 0.1).forEach((t) => {
      const st = returnState(t);
      const c = returnCamera(t).pos;
      const ax = nose(st.yaw);
      const pivot = [-2.0 + st.x, 0, 0];
      // the CSM: from the SPS exit (-7.85 m along its axis, relative to the stack origin) to the nose (+3.0)
      const a = -7.85 - -2.0;
      const b = 3.0 - -2.0;
      const rel = [c[0] - pivot[0], c[1] - pivot[1], c[2] - pivot[2]];
      const s = Math.min(b, Math.max(a, dot(rel, ax)));
      const q = [pivot[0] + ax[0] * s, pivot[1] + ax[1] * s, pivot[2] + ax[2] * s];
      expect(Math.hypot(c[0] - q[0], c[1] - q[1], c[2] - q[2]) - 1.95).toBeGreaterThan(5);
    });
  });
});

describe("the service module's separation and the capsule's turn (the reentry's ENTRY PREP)", () => {
  test("the SM backs away along its own axis (behind the CM) and leaves; the CM turns only once it is clear", () => {
    let prev = smOffset(0);
    for (let t = 0.1; t < SM_SEP.gone; t += 0.1) {
      const o = smOffset(t);
      expect(o[1]).toBeLessThan(prev[1]); // ever further aft
      expect(Math.abs(o[0]) + Math.abs(o[2])).toBeLessThan(Math.abs(o[1])); // mostly along its axis
      prev = o;
    }
    // clear by about a capsule length (0.9 units) before the turn begins
    expect(-smOffset(ATTITUDE_TURN.after)[1]).toBeGreaterThan(1.2);
    expect(SEP_LONG_AGO).toBeGreaterThan(SM_SEP.gone);
    const game = read("components/ReentryGame.jsx");
    expect(game).toMatch(/v\.attitudeU = Math\.min\(1, Math\.max\(0, \(v\.sepT - ATTITUDE_TURN\.after\) \/ ATTITUDE_TURN\.len\)\);/);
  });
});

describe("the mission page and Mission Control", () => {
  test("the return is driven by data/earthReturn, can be skipped, and hands over to the reentry", () => {
    const page = read("pages/Mission.jsx");
    expect(page).toMatch(/returnClock=\{returnRealRef\}/);
    expect(page).toMatch(/if \(rt >= RETURN_LEN\) \{[\s\S]*?setState\(STATES\.REENTRY\);/);
    expect(page).toMatch(/data-testid="skip-return"/);
    const scene = read("components/MissionScene.jsx");
    expect(scene).toMatch(/v\.sps = st\.sps;/);
    expect(scene).toMatch(/stackState\.current\.sps = v\.sps \|\| 0;/);
    // the old broadside close shot is gone
    expect(scene).not.toMatch(/returnClose/);
  });

  test("every call on the way home is a catalogued line, voiced in English and Portuguese", () => {
    const cat = JSON.parse(read("audio/commsLines.json"));
    const man = JSON.parse(fs.readFileSync(path.join(SRC, "../public/voice/manifest.json"), "utf8"));
    const ids = RETURN_CUES.filter((c) => c.line).map((c) => c.line);
    expect(ids).toEqual(["return.goTei", "return.teiIgnition", "return.teiCutoff", "return.coast"]);
    ids.forEach((id) => {
      const line = cat.lines.find((l) => l.id === id);
      expect(line).toBeTruthy();
      line.variants.forEach((v) => expect(v.en && v.pt).toBeTruthy());
      ["en", "pt"].forEach((lang) => expect(man.langs[lang].clips[id].length).toBeGreaterThan(0));
    });
    // the engine's sound starts and stops with the burn
    const burn = RETURN_CUES.find((c) => c.sound === "burn");
    const stop = RETURN_CUES.find((c) => c.sound === "burnStop");
    expect(burn.t).toBe(RETURN_SEQ.ignition);
    expect(stop.t).toBe(RETURN_SEQ.cutoff);
  });
});

describe("slew", () => {
  test("starts and ends at rest, at the requested angles", () => {
    const s = (t) => slew(t, 2, 8, 1, -1);
    expect(s(1).angle).toBe(1);
    expect(s(9).angle).toBe(-1);
    expect(s(2).rate).toBe(0);
    expect(s(8 - 1e-9).rate).toBeLessThan(1e-6);
    expect(s(5).angle).toBeCloseTo(0, 9);
  });
});
