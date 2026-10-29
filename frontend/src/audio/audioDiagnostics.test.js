/*
 * AUDIO DIAGNOSTICS, the Silent Mode policy and the radio trace, with a fake WebKit-like
 * AudioContext (jsdom has no Web Audio). These tests check what each test REPORTS for each
 * failure the iPhone can produce (context the system will not start, no signal, file missing,
 * undecodable file) — not the sound itself.
 */
jest.mock("./radio", () => ({
  playTransmission: jest.fn((ctx, out, opts) => {
    global.__signal = 0.3;
    const t1 = setTimeout(() => opts.onStart && opts.onStart(), 5);
    const t2 = setTimeout(() => {
      global.__signal = 0;
      opts.onEnd && opts.onEnd();
    }, 1200);
    return { stop: () => (clearTimeout(t1), clearTimeout(t2), opts.onEnd && opts.onEnd()), setLink() {} };
  }),
  staticBurst: jest.fn(),
}));
jest.mock("./voicePack", () => ({
  createVoicePack: () => {
    const state = { result: null };
    global.__packState = state;
    return {
      base: "/voice",
      ready: () => Promise.resolve({}),
      loaded: true,
      duration: () => 0.1,
      prefetch: () => Promise.resolve(),
      file: (lang, id) => `${lang}/${id}.0.mp3`,
      load: (ctx, lang, id) => Promise.resolve(state.result || { buffer: { duration: 1.0, sampleRate: 24000, numberOfChannels: 1 }, file: `${lang}/${id}.0.mp3`, bytes: 9000 }),
      buffer: () => Promise.resolve({ duration: 0.1 }),
      trim() {},
    };
  },
}));

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
  linearRampToValueAtTime() {}
  exponentialRampToValueAtTime() {}
}
const node = (extra = {}) => ({ connect: (n) => n, disconnect() {}, ...extra });
let resumeAllowed = true;
let clockRuns = true;
class FakeAudioContext {
  constructor() {
    this.state = "suspended";
    this.sampleRate = 48000;
    this.baseLatency = 0.005;
    this.destination = node();
    this.onstatechange = null;
    this.t0 = Date.now();
  }
  get currentTime() {
    return this.state === "running" && clockRuns ? (Date.now() - this.t0) / 1000 : 0;
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
  createAnalyser() {
    return node({
      fftSize: 1024,
      getFloatTimeDomainData(buf) {
        buf.fill(global.__signal || 0);
      },
    });
  }
  createOscillator() {
    const o = node({
      frequency: new FakeParam(440),
      type: "sine",
      start() {
        global.__signal = 0.4;
      },
      stop(when) {
        setTimeout(() => {
          global.__signal = 0;
          o.onended && o.onended();
        }, 1000);
      },
    });
    return o;
  }
  createBufferSource() {
    return node({ start() {}, stop() {} });
  }
  createBuffer() {
    return {};
  }
}

let D;
let E;
let settings;
let comms;
beforeEach(() => {
  jest.resetModules();
  resumeAllowed = true;
  clockRuns = true;
  global.__signal = 0;
  window.AudioContext = FakeAudioContext;
  window.localStorage.clear();
  delete window.Capacitor;
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  D = require("./audioDiagnostics");
  E = require("./audioEngine");
  settings = require("./audioSettings");
  comms = require("./comms").default;
  settings.setAudioSettings({ voice: true, voiceLang: "en" });
});
afterEach(() => {
  comms.reset();
  E._resetEngineForTests();
});

describe("TEST 1 · TEST TONE", () => {
  test("reports REQUESTED, STARTED (clock moving, signal at the output) and COMPLETED", async () => {
    const run = await D.runToneTest();
    const labels = run.events.map((e) => e.label);
    expect(labels).toEqual(expect.arrayContaining(["PLAYBACK REQUESTED", "PLAYBACK STARTED", "PLAYBACK COMPLETED"]));
    expect(run.status).toBe("PLAYBACK COMPLETED");
  }, 8000);
  test("a context the system will not start is AUDIO CONTEXT SUSPENDED, never 'started'", async () => {
    resumeAllowed = false;
    const run = await D.runToneTest();
    expect(run.status).toBe("AUDIO CONTEXT SUSPENDED");
    expect(run.events.map((e) => e.label)).not.toContain("PLAYBACK STARTED");
  }, 8000);
  test("no signal reaching the output is PLAYBACK FAILED, even though the API call succeeded", async () => {
    const real = FakeAudioContext.prototype.createOscillator;
    FakeAudioContext.prototype.createOscillator = function () {
      const o = real.call(this);
      o.start = () => {};
      return o;
    };
    const run = await D.runToneTest();
    FakeAudioContext.prototype.createOscillator = real;
    expect(run.status).toBe("PLAYBACK FAILED");
    expect(run.events.find((e) => e.label === "PLAYBACK FAILED").info).toMatch(/no signal/);
  }, 8000);
  test("a frozen audio clock (nothing rendered) is PLAYBACK FAILED", async () => {
    clockRuns = false;
    const run = await D.runToneTest();
    expect(run.status).toBe("PLAYBACK FAILED");
  }, 8000);
});

describe("TEST 2 · SOUND EFFECT", () => {
  test("plays the game effect it is given and checks the output", async () => {
    const effect = jest.fn(() => (global.__signal = 0.2));
    const run = await D.runSfxTest(effect);
    expect(effect).toHaveBeenCalledTimes(1);
    expect(run.status).toBe("PLAYBACK COMPLETED");
  }, 8000);
});

describe("TEST 3 · HOUSTON VOICE", () => {
  test("the bundled clip is found, decoded and played through the mission radio path on the voice bus", async () => {
    const radio = require("./radio");
    const run = await D.runHoustonTest();
    const labels = run.events.map((e) => e.label);
    expect(labels).toEqual(expect.arrayContaining(["FILE FOUND", "DECODE OK", "PLAYBACK REQUESTED", "PLAYBACK STARTED", "PLAYBACK COMPLETED"]));
    expect(run.events.find((e) => e.label === "FILE").info).toBe("/voice/en/launch.liftoff.0.mp3");
    expect(radio.playTransmission).toHaveBeenCalledTimes(1);
    expect(radio.playTransmission.mock.calls[0][1]).toBe(E.getEngine().voice);
  }, 8000);
  test("Portuguese voice loads the Portuguese file", async () => {
    settings.setAudioSettings({ voiceLang: "pt" });
    const run = await D.runHoustonTest();
    expect(run.events.find((e) => e.label === "FILE").info).toBe("/voice/pt/launch.liftoff.0.mp3");
  }, 8000);
  test("a missing file is FILE NOT FOUND; an undecodable one is DECODE FAILED", async () => {
    global.__packState.result = { error: "http-404", file: "en/launch.liftoff.0.mp3" };
    expect((await D.runHoustonTest()).status).toBe("FILE NOT FOUND");
    global.__packState.result = { error: "decode-failed:EncodingError", file: "en/launch.liftoff.0.mp3", bytes: 10 };
    expect((await D.runHoustonTest()).status).toBe("DECODE FAILED");
  }, 8000);
  test("voice OFF in AUDIO is reported (the test still plays)", async () => {
    settings.setAudioSettings({ voice: false });
    const run = await D.runHoustonTest();
    expect(run.events.some((e) => e.label === "NOTE" && /OFF/.test(e.info))).toBe(true);
    expect(run.status).toBe("PLAYBACK COMPLETED");
  }, 8000);
});

describe("Silent Mode policy", () => {
  test("PLAY SOUND (default) asks for a playback session; FOLLOW IPHONE for ambient — natively and in WebKit", async () => {
    const configure = jest.fn(() => Promise.resolve({ category: "AVAudioSessionCategoryPlayback" }));
    window.Capacitor = { Plugins: { LunaviaAudio: { configure, status: () => Promise.resolve({}) } } };
    navigator.audioSession = { type: "auto", state: "inactive" };
    E.installAudioUnlock();
    expect(configure).toHaveBeenLastCalledWith({ playInSilentMode: true });
    expect(navigator.audioSession.type).toBe("playback");
    settings.setAudioSettings({ silentMode: "follow" });
    expect(configure).toHaveBeenLastCalledWith({ playInSilentMode: false });
    expect(navigator.audioSession.type).toBe("ambient");
    delete navigator.audioSession;
  });
  test("the setting is kept and sanitized", () => {
    expect(settings.getAudioSettings().silentMode).toBe("play");
    settings.setAudioSettings({ silentMode: "nonsense" });
    expect(settings.getAudioSettings().silentMode).toBe("play");
  });
});

describe("the radio trace (mission calls, for COPY DIAGNOSTICS)", () => {
  test("each call is recorded with its file, language, context state and result; and silent calls say why", async () => {
    E.getEngine({ create: true });
    await E.ensureRunning(50);
    comms.say("launch.liftoff");
    await new Promise((r) => setTimeout(r, 1700));
    settings.setAudioSettings({ voice: false });
    comms.say("launch.towerClear");
    await new Promise((r) => setTimeout(r, 1600));
    const rows = D.radioTraceRows();
    const lift = rows.find((r) => r.id === "launch.liftoff");
    expect(lift).toMatchObject({ result: "PLAYBACK STARTED", lang: "en", file: "en/launch.liftoff.0.mp3", ctx: "running", end: "COMPLETED" });
    expect(rows.find((r) => r.id === "launch.towerClear").result).toBe("SILENT (voice-off)");
    const text = D.diagnosticsReport({});
    expect(text).toMatch(/LUNAVIA AUDIO DIAGNOSTICS/);
    expect(text).toMatch(/BUILD /);
    expect(text).toMatch(/launch\.liftoff .*PLAYBACK STARTED/);
  }, 8000);
});
