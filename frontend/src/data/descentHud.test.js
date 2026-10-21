import fs from "fs";
import path from "path";
import { SPLASH_PREP, descentHud, formatAlt, formatToSplash } from "./descentHud";
import { CHUTES, createEntryState, advance, recommendBank, rollToward } from "./reentryPhysics";
import { timeScaleFor } from "./reentryGuidance";

const SRC = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const DEG = Math.PI / 180;

describe("the descent display under the parachutes", () => {
  test("none before the drogues: the entry display (FPA, lift vector, corridor) is still the right one", () => {
    expect(descentHud({ h: 9000, v: 400, gamma: -60 * DEG })).toBeNull();
  });
  test("under the drogues: altitude, descent rate, the drogues, the mains to come", () => {
    const d = descentHud({ h: 6000, v: 120, gamma: -80 * DEG, sinceDrogue: 1.5, shield: 0.42, g: 1.4 });
    expect(d.vs).toBeCloseTo(120 * Math.sin(80 * DEG), 6);
    expect(d.chute).toMatchObject({ name: "DROGUES", count: 2, state: "INFLATING" });
    expect(d.chute.inflate).toBeCloseTo(1.5 / CHUTES.drogue.inflateTime, 6);
    expect(d.chute.next).toBe("MAINS AT 3.2 KM");
    expect(d.toSplash).toBeNull(); // no estimate until the mains are full
    expect(d.capsule).toBe("NOMINAL");
    expect(d.prep.map((p) => p.state)).toEqual(["done", "pending", "pending", "pending", "pending", "pending"]);
  });
  test("under the mains: inflation, time to splashdown, the splashdown checklist in Apollo's order", () => {
    const d = descentHud({ h: 850, v: 8.5, gamma: -89.5 * DEG, sinceDrogue: 60, sinceMain: 40, shield: 0.42, g: 1 });
    expect(d.chute).toMatchObject({ name: "MAINS", count: 3, state: "FULL" });
    expect(d.toSplash).toBeCloseTo(850 / (8.5 * Math.sin(89.5 * DEG)), 6);
    expect(SPLASH_PREP.map((p) => p.id)).toEqual(["drogues", "mains", "beacon", "rcs", "release", "brace"]);
    expect(d.prep.map((p) => p.state)).toEqual(["done", "done", "done", "done", "done", "pending"]);
    const low = descentHud({ h: 90, v: 8.5, gamma: -89.5 * DEG, sinceDrogue: 60, sinceMain: 120, shield: 0.42, g: 1 });
    expect(low.prep.find((p) => p.id === "brace").state).toBe("active");
    const opening = descentHud({ h: 3150, v: 60, gamma: -89 * DEG, sinceDrogue: 50, sinceMain: 2, shield: 0.42, g: 2 });
    expect(opening.chute.state).toBe("INFLATING");
    expect(opening.prep.find((p) => p.id === "mains").state).toBe("active");
  });
  test("formatting", () => {
    expect(formatAlt(1820.4)).toBe("1,820");
    expect(formatAlt(-3)).toBe("0");
    expect(formatToSplash(161)).toBe("02:41");
    expect(formatToSplash(null)).toBe("--:--");
  });
  test("the game shows it under the parachutes, and drops the bank, roll and corridor items there", () => {
    const game = read("components/ReentryGame.jsx");
    expect(game).toMatch(/const guidanceOn = phase === "PREP" \|\| \(inEntry && !chuting\);/);
    expect(game).toMatch(/\{u && guidanceOn && \(\s*<div[^>]*data-testid="reentry-hud-right"/);
    expect(game).toMatch(/data-testid="reentry-descent-panel"/);
    expect(game).toMatch(/data-testid="reentry-splash-prep"/);
    expect(game).toMatch(/\{u && phase !== "SPLASHED" && !chuting && \(/);
    // the physics under the chutes: no lift, so bank and roll do nothing (why they are hidden)
    expect(read("data/reentryPhysics.js")).toMatch(/const lift = chutes > 0 \? 0 :/);
  });
  test("the captions sit in a corner under the parachutes and over the splashdown (same type and timing)", () => {
    const subs = read("components/CommsSubtitles.jsx");
    expect(subs).toMatch(/export function setSubtitlePlacement/);
    expect(subs).toMatch(/text-\[13px\] short:text-\[11px\] leading-snug text-white/); // the same type
    const game = read("components/ReentryGame.jsx");
    expect(game).toMatch(/const lowCaptions = chuting \|\| phase === "SPLASHED";/);
    expect(read("pages/Mission.jsx")).toMatch(/setSubtitlePlacement\("corner"\)/);
  });
});

describe("the descent's pace (presentation only: the same trajectory at any rate)", () => {
  test("fast to the cloud tops, between the clouds at 20x, slow over the last metres", () => {
    const s = createEntryState({ fpaDeg: -6.5, bankDeg: 0 });
    const rates = [];
    let n = 0;
    while (!s.outcome && n++ < 40000) {
      s.rollInput = s.v > 3000 ? rollToward(s.bank, recommendBank(s).bank) : 0;
      advance(s, 0.5);
      if (s.mainT !== null && s.t - s.mainT > 9) rates.push([s.h, timeScaleFor(s)]);
    }
    const at = (h) => rates.reduce((b, r) => (Math.abs(r[0] - h) < Math.abs(b[0] - h) ? r : b))[1];
    expect(s.outcome).toBe("SPLASHDOWN");
    expect(at(2700)).toBeCloseTo(32, 0);
    expect(at(1500)).toBe(20);
    expect(at(150)).toBeCloseTo(6, 0);
    expect(at(5)).toBeLessThan(3.2);
    // monotonic: never speeds up on the way down
    for (let i = 1; i < rates.length; i++) expect(rates[i][1]).toBeLessThanOrEqual(rates[i - 1][1] + 1e-9);
  });
  test("the trajectory is the same whatever the rate (fixed-step physics)", () => {
    const a = createEntryState({ fpaDeg: -6.5, bankDeg: 0 });
    const b = createEntryState({ fpaDeg: -6.5, bankDeg: 0 });
    // the guided entry to the drogues, then the descent stepped in big or small chunks
    for (const x of [a, b]) {
      for (let i = 0; i < 20000 && x.drogueT === null && !x.outcome; i++) {
        x.rollInput = x.v > 3000 ? rollToward(x.bank, recommendBank(x).bank) : 0;
        advance(x, 0.2);
      }
    }
    for (let i = 0; i < 10000 && !a.outcome; i++) advance(a, 0.4);
    for (let i = 0; i < 40000 && !b.outcome; i++) advance(b, 0.1);
    expect(a.outcome).toBe("SPLASHDOWN");
    expect(a.outcome).toBe(b.outcome);
    expect(a.splashV).toBeCloseTo(b.splashV, 6);
    expect(a.s).toBeCloseTo(b.s, 0);
  });
});
