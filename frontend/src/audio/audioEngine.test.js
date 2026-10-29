/*
 * The app's audio engine and the radio's playback decisions, with a fake WebKit-like AudioContext
 * (jsdom has no Web Audio). The radio chain and the voice pack are stubbed: these tests are about
 * WHEN a call is voiced, what happens to a stopped (suspended / interrupted) context, and why a
 * call goes unheard — not about the sound itself (the browser runs cover that).
 */
jest.mock("./radio", () => ({
  playTransmission: jest.fn((ctx, out, opts) => {
    const t1 = setTimeout(() => opts.onStart && opts.onStart(), 5);
    const t2 = setTimeout(() => opts.onEnd && opts.onEnd(), 30);
    return { stop: () => (clearTimeout(t1), clearTimeout(t2), opts.onEnd && opts.onEnd()), setLink() {} };
  }),
  staticBurst: jest.fn(),
}));
jest.mock("./voicePack", () => ({
  createVoicePack: () => {
    const state = { missing: new Set() };
    global.__packState = state;
    return {
      ready: () => Promise.resolve({}),
      loaded: true,
      duration: () => 0.05,
      prefetch: () => Promise.resolve(),
      buffer: (ctx, lang, id) => Promise.resolve(state.missing.has(id) ? null : { duration: 0.05 }),
      load: (ctx, lang, id) => Promise.resolve(state.missing.has(id) ? { error: "clip-missing", file: null } : { buffer: { duration: 0.05 }, file: `${lang}/${id}.0.mp3` }),
      file: (lang, id) => `${lang}/${id}.0.mp3`,
      trim() {},
    };
  },
}));

const flush = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

class FakeParam {
  constructor(v = 1) {
    this.value = v;
  }
  setTargetAtTime(v) {
    this.value = v;
  }
  setValueAtTime(v) {
    this.value = v;
  }
  cancelScheduledValues() {}
  linearRampToValueAtTime(v) {
    this.value = v;
  }
}
const node = (extra = {}) => ({ connect: (n) => n, disconnect() {}, ...extra });
let created = [];
let resumeAllowed = true;
class FakeAudioContext {
  constructor() {
    this.state = "suspended"; // as WebKit before resume() inside a gesture
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.destination = node();
    this.onstatechange = null;
    created.push(this);
  }
  setState(s) {
    this.state = s;
    if (this.onstatechange) this.onstatechange();
  }
  resume() {
    if (resumeAllowed && this.state !== "closed") this.setState("running");
    return Promise.resolve();
  }
  close() {
    this.setState("closed");
    return Promise.resolve();
  }
  createGain() {
    return node({ gain: new FakeParam(1) });
  }
  createDynamicsCompressor() {
    return node({ threshold: new FakeParam(), knee: new FakeParam(), ratio: new FakeParam(), attack: new FakeParam(), release: new FakeParam() });
  }
  createBufferSource() {
    return node({ start() {}, stop() {} });
  }
  createBuffer() {
    return {};
  }
}

let E;
let comms;
let settings;
let radio;
beforeEach(() => {
  jest.resetModules();
  created = [];
  resumeAllowed = true;
  window.AudioContext = FakeAudioContext;
  window.localStorage.clear();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  E = require("./audioEngine");
  comms = require("./comms").default;
  settings = require("./audioSettings");
  radio = require("./radio");
  settings.setAudioSettings({ voice: true, voiceLang: "en", subLang: "en" });
  window.__lvCommsLog = [];
});
afterEach(() => {
  comms.reset();
  E._resetEngineForTests();
  delete window.__lvCommsLog;
});
const outcomes = () => window.__lvCommsLog.filter((e) => ["voice", "silent", "fallback"].includes(e.type)).map((e) => `${e.type}${e.reason ? ":" + e.reason : ""}:${e.id}`);

describe("the audio engine: one context, started by the player", () => {
  test("no context before a gesture; the first tap creates exactly one, later taps reuse it", async () => {
    E.installAudioUnlock();
    expect(E.getEngine()).toBe(null);
    window.dispatchEvent(new Event("touchend"));
    await flush();
    expect(created.length).toBe(1);
    expect(E.getEngine().ctx.state).toBe("running");
    window.dispatchEvent(new Event("click"));
    window.dispatchEvent(new Event("keydown"));
    await flush();
    expect(created.length).toBe(1);
    E.installAudioUnlock(); // idempotent
    window.dispatchEvent(new Event("touchend"));
    expect(created.length).toBe(1);
  });
  test("an interrupted context (iOS: call, Siri, notification) is resumed by the next tap or the return to the app", async () => {
    E.installAudioUnlock();
    window.dispatchEvent(new Event("touchend"));
    await flush();
    const ctx = E.getEngine().ctx;
    ctx.setState("interrupted");
    window.dispatchEvent(new Event("touchend"));
    await flush();
    expect(ctx.state).toBe("running");
    ctx.setState("suspended");
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(ctx.state).toBe("running");
    expect(E.engineDiagnosis().interruptions).toBe(2);
  });
  test("ensureRunning resumes a stopped context, and gives up (false) after its timeout when the system refuses", async () => {
    E.getEngine({ create: true });
    expect(await E.ensureRunning(50)).toBe(true);
    E.getEngine().ctx.setState("interrupted");
    resumeAllowed = false;
    expect(await E.ensureRunning(40)).toBe(false);
    resumeAllowed = true;
    expect(await E.ensureRunning(40)).toBe(true);
  });
  test("the engine survives the page that started it (no closed context left behind)", async () => {
    const e = E.getEngine({ create: true });
    await E.ensureRunning(20);
    expect(E.getEngine()).toBe(e);
    e.ctx.close();
    expect(E.getEngine()).toBe(null);
    expect(E.getEngine({ create: true }).ctx.state).not.toBe("closed");
  });
});

describe("Houston's calls: voiced whenever the system lets audio play", () => {
  test("a call made while iOS has the context interrupted is resumed and voiced, not dropped to a subtitle", async () => {
    E.getEngine({ create: true });
    await E.ensureRunning(20);
    E.getEngine().ctx.setState("interrupted");
    comms.say("launch.liftoff");
    await wait(80);
    expect(outcomes()).toEqual(["voice:launch.liftoff"]);
    expect(radio.playTransmission).toHaveBeenCalledTimes(1);
  });
  test("when the system refuses, the call runs as a subtitle and the reason is recorded", async () => {
    E.getEngine({ create: true });
    resumeAllowed = false;
    comms.say("launch.liftoff");
    await wait(900);
    expect(outcomes()).toEqual(["silent:context-suspended:launch.liftoff"]);
    expect(comms.diagnose().last).toMatchObject({ id: "launch.liftoff", voiced: false, reason: "context-suspended" });
  });
  test("voice off, before any gesture, and a missing clip: each recorded with its own reason", async () => {
    // (the director keeps ~0.9 s of silence between routine calls)
    settings.setAudioSettings({ voice: false });
    comms.say("launch.meco");
    await wait(1400);
    settings.setAudioSettings({ voice: true });
    comms.say("launch.staging");
    await wait(1400);
    E.getEngine({ create: true });
    global.__packState.missing.add("launch.orbit");
    comms.say("launch.orbit");
    await wait(1400);
    expect(outcomes()).toEqual(["silent:voice-off:launch.meco", "silent:no-gesture-yet:launch.staging", "silent:clip-missing:launch.orbit"]);
  }, 10000);
  test("Portuguese voice plays the Portuguese clip (language mapping)", async () => {
    settings.setAudioSettings({ voiceLang: "pt" });
    E.getEngine({ create: true });
    comms.say("descent.touchdown");
    await wait(80);
    expect(window.__lvCommsLog.find((e) => e.type === "voice")).toMatchObject({ id: "descent.touchdown", lang: "pt" });
  });
  test("no duplicate: the same call asked twice while it is on the air or queued plays once", async () => {
    E.getEngine({ create: true });
    comms.say("launch.liftoff");
    comms.say("launch.liftoff");
    await wait(100);
    expect(outcomes()).toEqual(["voice:launch.liftoff"]);
  });
  test("backgrounding drops what was queued: nothing stale is replayed on return", async () => {
    E.getEngine({ create: true });
    comms.attach();
    comms.say("launch.maxQ");
    comms.say("launch.meco");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(comms.say("launch.staging")).toBe(false); // nothing is said in the background
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await wait(300);
    expect(outcomes().filter((o) => o.includes("meco") || o.includes("staging"))).toEqual([]);
  });
  test("leaving the page (detach) cuts the call on the air and forgets the queue", async () => {
    E.getEngine({ create: true });
    comms.attach();
    comms.say("launch.maxQ");
    comms.say("launch.meco", { delay: 0.05 });
    comms.detach();
    await wait(300);
    expect(comms.onAir).toBe(null);
    expect(outcomes().some((o) => o.includes("meco"))).toBe(false);
  });
});

describe("TEST RADIO", () => {
  test("plays a short Houston call through the same engine and reports it played", async () => {
    const r = await comms.radioCheck();
    expect(r).toMatchObject({ voiced: true, reason: "played", state: "running" });
    expect(created.length).toBe(1);
    expect(radio.playTransmission).toHaveBeenCalledTimes(1);
  });
  test("reports why when nothing was heard (voice off; the device did not start audio)", async () => {
    settings.setAudioSettings({ voice: false });
    expect(await comms.radioCheck()).toMatchObject({ voiced: false, reason: "voice-off" });
    settings.setAudioSettings({ voice: true });
    resumeAllowed = false;
    expect(await comms.radioCheck()).toMatchObject({ voiced: false, reason: "context-suspended" });
  });
  test("works on the Training page with MUTE INSTRUCTOR on (the player asked for it)", async () => {
    comms.setMuted(true);
    expect(await comms.radioCheck()).toMatchObject({ voiced: true });
    comms.setMuted(false);
  });
  test("its message tells the player what to do, in EN and PT", () => {
    const { radioCheckMessage } = require("./radioCheckText");
    expect(radioCheckMessage({ voiced: true }).ok).toBe(true);
    expect(radioCheckMessage({ voiced: false, reason: "context-interrupted" }).text).toMatch(/SILENT MODE/);
    expect(radioCheckMessage({ voiced: false, reason: "context-interrupted" }, "pt").text).toMatch(/MODO SILENCIOSO/);
    expect(radioCheckMessage({ voiced: false, reason: "voice-off" }).text).toMatch(/OFF/);
  });
});
