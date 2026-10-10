import fs from "fs";
import path from "path";
import catalog from "./commsLines.json";
import { createDirector, allowed, PRIORITY } from "./commsDirector";
import { createDescentMonitor } from "./descentComms";
import { createReentryMonitor } from "./reentryComms";
import { DIFFICULTY, evaluateGround } from "../data/landingPhysics";
import { initialState, stepFrame, gradeTouchdown, CONTACT_ALT } from "../data/landerSim";
import { humanPilot, guidedStrategy } from "../data/landerPilots";
import { assessDescent, predictTouchdownX } from "../data/descentProfile";
import { createEntryState, advance, predict, classifyPrediction, recommendBank, rollToward } from "../data/reentryPhysics";
import { timeScaleFor, inBlackout } from "../data/reentryGuidance";

const PUBLIC = path.join(__dirname, "..", "..", "public", "voice");
const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, "manifest.json"), "utf8"));
const LINE = Object.fromEntries(catalog.lines.map((l) => [l.id, l]));

/* Deterministic clock + timers for the director */
function fakeClock() {
  let t = 0;
  let id = 0;
  let timers = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => {
      const h = ++id;
      timers.push({ h, at: t + ms, fn });
      return h;
    },
    clearTimer: (h) => (timers = timers.filter((x) => x.h !== h)),
    advance(ms) {
      const end = t + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const n = timers[0];
        if (!n || n.at > end) break;
        timers.shift();
        t = n.at;
        n.fn();
      }
      t = end;
    },
  };
}

/** Director wired to a fake radio that "plays" each clip for its real duration. */
function rig({ verbosity = "full", lang = "en" } = {}) {
  const clock = fakeClock();
  const aired = []; // { id, start, end, cut, keyed, variant }
  const dir = createDirector({
    catalog,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    random: () => 0.99,
    transmit({ id, variant, keyed }, done) {
      const rec = { id, variant, keyed, start: clock.now() / 1000, end: null, cut: false };
      aired.push(rec);
      const d = manifest.langs[lang].clips[id][variant].d;
      const h = clock.setTimer(() => {
        rec.end = clock.now() / 1000;
        done();
      }, d * 1000 + 300);
      return {
        stop() {
          clock.clearTimer(h);
          rec.end = clock.now() / 1000;
          rec.cut = true;
          done();
        },
      };
    },
  });
  dir.setVerbosity(verbosity);
  return { dir, clock, aired };
}

const overlaps = (aired) => aired.some((a, i) => i > 0 && a.start < aired[i - 1].end - 1e-9);

describe("line catalog and voice pack", () => {
  test("every line is complete in English and Portuguese, with a known role and priority", () => {
    for (const l of catalog.lines) {
      expect(catalog.roles[l.role]).toBeDefined();
      expect(PRIORITY[l.priority]).toBeDefined();
      expect(l.variants.length).toBeGreaterThan(0);
      for (const v of l.variants) {
        expect(v.en && v.en.trim()).toBeTruthy();
        expect(v.pt && v.pt.trim()).toBeTruthy();
      }
    }
    expect(new Set(catalog.lines.map((l) => l.id)).size).toBe(catalog.lines.length);
  });

  test("the bundled pack has a clip for every line, variant and language", () => {
    for (const lang of ["en", "pt"]) {
      for (const l of catalog.lines) {
        const clips = manifest.langs[lang].clips[l.id];
        expect(clips).toHaveLength(l.variants.length);
        for (const c of clips) {
          expect(c.d).toBeGreaterThan(0.3);
          expect(c.d).toBeLessThan(9);
          expect(fs.statSync(path.join(PUBLIC, c.f)).size).toBeGreaterThan(1000);
        }
      }
    }
  });

  test("every line id the app asks for exists in the catalog", () => {
    const src = path.join(__dirname, "..");
    const files = [
      "audio/descentComms.js",
      "audio/reentryComms.js",
      "components/scenes/LaunchCinematic.jsx",
      "pages/Mission.jsx",
      "components/DescentGame.jsx",
      "components/ReentryGame.jsx",
    ];
    const ids = new Set();
    for (const f of files) {
      const text = fs.readFileSync(path.join(src, f), "utf8");
      for (const m of text.matchAll(/["'`]((?:launch|cruise|orbit|descent|reentry)\.[A-Za-z0-9]+)["'`]/g)) ids.add(m[1]);
    }
    expect(ids.size).toBeGreaterThan(30);
    for (const id of ids) expect([id, !!LINE[id]]).toEqual([id, true]);
  });
});

describe("comms director", () => {
  test("one voice at a time: queued calls wait for the channel and a gap of silence", () => {
    const { dir, clock, aired } = rig();
    dir.request("launch.towerClear");
    dir.request("launch.maxQ");
    dir.request("launch.meco");
    clock.advance(20000);
    expect(aired.map((a) => a.id)).toEqual(["launch.towerClear", "launch.maxQ", "launch.meco"]);
    expect(overlaps(aired)).toBe(false);
    for (let i = 1; i < aired.length; i++) expect(aired[i].start - aired[i - 1].end).toBeGreaterThanOrEqual(0.9 - 1e-6);
  });

  test("a CRITICAL call cuts a routine transmission; HIGH waits behind CRITICAL", () => {
    const { dir, clock, aired } = rig();
    dir.request("cruise.ambient");
    clock.advance(10);
    expect(dir.onAir).toBe("cruise.ambient");
    clock.advance(500);
    dir.request("descent.rateHigh");
    dir.request("descent.drift");
    clock.advance(15000);
    expect(aired[0]).toMatchObject({ id: "cruise.ambient", cut: true });
    expect(aired[1].id).toBe("descent.rateHigh");
    expect(aired[1].start - aired[0].end).toBeLessThan(0.3);
    expect(aired[1].cut).toBe(false);
    expect(aired[2].id).toBe("descent.drift");
    expect(overlaps(aired)).toBe(false);
  });

  test("cooldowns and duplicates stop spam", () => {
    const { dir, clock, aired } = rig();
    for (let i = 0; i < 40; i++) {
      dir.request("descent.rateHigh");
      clock.advance(250);
    }
    clock.advance(5000);
    // 10 s of continuous requests, cooldown 7 s after each start
    expect(aired.length).toBeLessThanOrEqual(2);
    expect(aired.every((a) => a.id === "descent.rateHigh")).toBe(true);
    // never the same wording twice in a row
    expect(aired[1].variant).not.toBe(aired[0].variant);
  });

  test("stale calls expire and irrelevant calls are dropped before they are spoken", () => {
    const { dir, clock, aired } = rig();
    dir.request("launch.orbit");
    dir.request("descent.hazard", { relevant: () => false });
    dir.request("descent.alt30"); // NORMAL: may wait up to 8 s
    clock.advance(30000);
    expect(aired.map((a) => a.id)).toEqual(["launch.orbit", "descent.alt30"]);
    const r2 = rig();
    r2.dir.request("reentry.los"); // ~5 s
    r2.clock.advance(100);
    r2.dir.request("descent.fuelTight"); // HIGH: expires after 3.5 s of waiting... but cuts NORMAL
    r2.clock.advance(20000);
    expect(r2.aired[1].id).toBe("descent.fuelTight");
  });

  test("AMBIENT chatter needs a quiet channel", () => {
    const { dir, clock, aired } = rig();
    dir.request("launch.towerClear");
    dir.request("cruise.ambient");
    clock.advance(20000);
    expect(aired.map((a) => a.id)).toEqual(["launch.towerClear"]);
  });

  test("blackout cuts the ground and lets only onboard voices through", () => {
    const { dir, clock, aired } = rig();
    dir.request("reentry.ei");
    clock.advance(400);
    dir.setBlackout(true);
    expect(aired[0].cut).toBe(true);
    expect(dir.request("reentry.heating")).toBe(false);
    expect(dir.request("reentry.gWarning")).toBe(true);
    clock.advance(5000);
    dir.setBlackout(false);
    dir.request("reentry.aos");
    clock.advance(10000);
    expect(aired.map((a) => a.id)).toEqual(["reentry.ei", "reentry.gWarning", "reentry.aos"]);
  });

  test("verbosity: COMMANDER hears no coaching or chatter, ASTRONAUT no extra help", () => {
    const coach = catalog.lines.filter((l) => l.coach);
    const assist = catalog.lines.filter((l) => l.assist);
    expect(coach.length).toBeGreaterThan(4);
    expect(assist.length).toBeGreaterThan(3);
    for (const l of coach) expect([allowed(l, "minimal"), allowed(l, "standard"), allowed(l, "full")]).toEqual([false, true, true]);
    for (const l of assist) expect([allowed(l, "minimal"), allowed(l, "standard"), allowed(l, "full")]).toEqual([false, false, true]);
    // status calls and alarms are for everyone
    for (const id of ["descent.fuelCritical", "descent.attitude", "reentry.gWarning", "descent.touchdown", "reentry.splashdown"]) expect(allowed(LINE[id], "minimal")).toBe(true);
  });

  test("the same speaker continuing keeps the mic keyed (no second click)", () => {
    const { dir, clock, aired } = rig();
    dir.request("launch.count10");
    clock.advance(1000);
    dir.request("launch.count9");
    clock.advance(1000);
    dir.request("launch.count8");
    clock.advance(3000);
    expect(aired.map((a) => a.keyed)).toEqual([false, true, true]);
  });
});

/* ---------------------------------------------------------------------- */
/* Descent: fly the real lander physics and feed the monitor at 15 Hz     */

function flyDescent(difficulty, strategy, { init, maxTime = 200 } = {}) {
  const cfg = DIFFICULTY[difficulty];
  const p = { ...initialState(cfg), ...(init || {}) };
  const pilot = strategy ? humanPilot(cfg, strategy, { lag: 0.3, seed: 2 }) : () => ({});
  const mon = createDescentMonitor();
  const req = [];
  let acc = 0;
  const frame = 1 / 60;
  const feed = (outcome) => {
    const profile = assessDescent({ ...p, cfg });
    const hazard = !!evaluateGround(predictTouchdownX(p, cfg)).hazard;
    mon({ t: p.t, alt: p.alt, vx: p.vx, xPos: p.xPos, profile, hazard, distanceToLZ: Math.abs(p.xPos), outcome }).forEach((r) => req.push({ ...r, t: p.t }));
  };
  while (p.t < maxTime) {
    const inp = pilot({ ...p }, p.t) || {};
    stepFrame(p, inp, cfg, frame);
    acc += frame;
    if (acc >= 1 / 15) {
      acc = 0;
      feed(null);
    }
    if (p.alt <= CONTACT_ALT) break;
  }
  const result = gradeTouchdown(p, cfg);
  feed(result.crashed ? "crashed" : "landed");
  return { req, result, ids: req.map((r) => r.id) };
}

describe("descent monitor (real lander physics)", () => {
  test("a good guided landing gets the milestone calls in order and no warnings spam", () => {
    const { ids, result } = flyDescent("ASTRONAUT", guidedStrategy());
    expect(result.crashed).toBe(false);
    const order = ["descent.alt100fuelGood", "descent.alt30", "descent.contact", "descent.touchdown"].map((id) => ids.indexOf(id));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(ids.some((id) => /^descent\.alt200/.test(id))).toBe(true);
    expect(ids.filter((id) => id === "descent.rateHigh").length).toBeLessThanOrEqual(3);
    expect(ids).not.toContain("descent.crash");
  });

  test("falling without braking calls the descent rate, then the crash", () => {
    const { ids, result } = flyDescent("ASTRONAUT", null);
    expect(result.crashed).toBe(true);
    expect(ids).toContain("descent.rateHigh");
    expect(ids.indexOf("descent.rateHigh")).toBeLessThan(ids.indexOf("descent.crash"));
    expect(ids).not.toContain("descent.touchdown");
  });

  test("low fuel is called once as tight and once as critical", () => {
    const cfg = DIFFICULTY.ASTRONAUT;
    const { ids } = flyDescent("ASTRONAUT", guidedStrategy(), { init: { fuel: cfg.initialFuel * 0.3 } });
    expect(ids.filter((id) => id === "descent.fuelTight").length).toBeLessThanOrEqual(1);
    expect(ids.filter((id) => id === "descent.fuelCritical").length).toBeLessThanOrEqual(1);
    expect(ids.some((id) => /descent\.fuel(Tight|Critical)/.test(id))).toBe(true);
  });

  test("monitor + director over a whole descent: no overlaps, no stale warnings after touchdown", () => {
    const { req } = flyDescent("CADET", null, { init: { alt: 260, vy: -14 } });
    const { dir, clock, aired } = rig();
    let last = 0;
    for (const r of req) {
      clock.advance((r.t - last) * 1000);
      last = r.t;
      dir.request(r.id, { delay: r.delay || 0, relevant: r.relevant });
    }
    clock.advance(30000);
    expect(overlaps(aired)).toBe(false);
    const crash = aired.findIndex((a) => a.id === "descent.crash");
    expect(crash).toBeGreaterThan(-1);
    expect(aired.slice(crash).every((a) => /crash/.test(a.id))).toBe(true);
  });
});

/* ---------------------------------------------------------------------- */
/* Reentry: fly the entry physics the way ReentryGame does                */

function flyEntry({ fpa, bank = 0, guided = true, prediction = true }) {
  const s = createEntryState({ fpaDeg: fpa, bankDeg: bank });
  const mon = createReentryMonitor();
  const out = [];
  let realT = 0;
  let pred = null;
  let cue = null;
  let lastPred = -1;
  let lastCue = -1;
  const dt = 1 / 15;
  while (realT < 900) {
    if (guided && s.v > 3000 && s.drogueT === null && !s.outcome) {
      if (realT - lastCue > 0.6) {
        cue = recommendBank(s).bank;
        lastCue = realT;
      }
      s.rollInput = rollToward(s.bank, cue);
    } else s.rollInput = 0;
    advance(s, dt * timeScaleFor(s));
    realT += dt;
    if (prediction && !s.outcome && s.v > 3000 && s.drogueT === null && realT - lastPred > 0.35) {
      pred = classifyPrediction(predict(s));
      lastPred = realT;
    } else if (s.v <= 3000) pred = s.outcome ? pred : "NOMINAL";
    const phase = s.outcome ? (s.outcome === "SPLASHDOWN" ? "SPLASHED" : "FAILED") : "ENTRY";
    const m = mon({
      phase,
      realT,
      vel: s.v,
      g: s.gLoad,
      q: s.heatRate,
      overheat: s.overheat,
      blackout: phase === "ENTRY" && inBlackout(s),
      pred: prediction ? pred : null,
      climbing: s.gamma > 0 && s.v > 7800,
      drogue: s.drogue,
      main: s.main,
      outcome: s.outcome,
    });
    m.requests.forEach((r) => out.push({ ...r, t: realT, blackout: m.blackout }));
    out.push({ link: m.link, blackout: m.blackout, t: realT });
    if (s.outcome) break;
  }
  return { s, out, ids: out.filter((r) => r.id).map((r) => r.id) };
}

describe("reentry monitor (real entry physics)", () => {
  test("nominal guided entry: EI, blackout with a degrading link, AOS, chutes, splashdown", () => {
    const { s, out, ids } = flyEntry({ fpa: -6.5 });
    expect(s.outcome).toBe("SPLASHDOWN");
    for (const id of ["reentry.ei", "reentry.aos", "reentry.drogues", "reentry.mains", "reentry.splashdown"]) expect(ids).toContain(id);
    expect(ids.indexOf("reentry.aos")).toBeLessThan(ids.indexOf("reentry.drogues"));
    const links = out.filter((r) => r.link !== undefined);
    expect(links.some((r) => r.blackout)).toBe(true);
    expect(links.some((r) => !r.blackout && r.link < 0.8)).toBe(true); // strained before LOS
    expect(links[links.length - 1].link).toBe(1);
    // nothing from the ground is asked for while in blackout
    const ground = out.filter((r) => r.id && r.blackout && catalog.roles[LINE[r.id].role].radio !== "onboard" && !LINE[r.id].throughBlackout);
    expect(ground).toEqual([]);
  });

  test("shallow entry held lift-up: skip-out warning, then the skip-out calls", () => {
    const { s, ids } = flyEntry({ fpa: -5.0, bank: 0, guided: false });
    expect(s.outcome).toBe("SKIP_OUT");
    expect(ids).toContain("reentry.shallow");
    expect(ids.slice(-2)).toEqual(["reentry.skipOut", "reentry.corridorLost"]);
  });

  test("steep entry held lift-down: overload warning and the onboard alarms", () => {
    const { s, ids } = flyEntry({ fpa: -7.6, bank: 180, guided: false });
    expect(["STRUCTURAL", "THERMAL"]).toContain(s.outcome);
    expect(ids).toContain("reentry.steep");
    expect(ids.some((id) => id === "reentry.gWarning" || id === "reentry.heatWarning")).toBe(true);
    expect(ids[ids.length - 1]).toBe("reentry.los");
  });

  test("without the prediction (COMMANDER) there is no lift advice", () => {
    const { ids } = flyEntry({ fpa: -5.0, bank: 0, guided: false, prediction: false });
    expect(ids).not.toContain("reentry.shallow");
    expect(ids).not.toContain("reentry.steep");
  });
});
