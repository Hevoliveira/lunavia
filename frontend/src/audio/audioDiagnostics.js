/*
 * LUNAVIA — AUDIO DIAGNOSTICS: three playback tests through the game's own audio output, the
 * engine's state, and a copyable report (pages/AudioDiagnostics.jsx).
 *
 * What software can and cannot know. A test reports what the audio system says:
 *   PLAYBACK REQUESTED   the sound was handed to the engine
 *   PLAYBACK STARTED     the engine is running, its clock moved past the sound's start and
 *                        signal was measured at the engine's output (before the iPhone)
 *   PLAYBACK COMPLETED / INTERRUPTED / FAILED, AUDIO CONTEXT SUSPENDED, FILE NOT FOUND,
 *   DECODE FAILED
 * None of these proves the sound left the speaker: Silent Mode, the media volume or the output
 * route can still stop it after the engine. Only the player can say "I heard it".
 *
 * Every test must start inside the player's tap: run() creates / resumes the engine synchronously
 * before anything is awaited.
 */
import catalog from "./commsLines.json";
import { getEngine, resumeEngine, engineDiagnosis } from "./audioEngine";
import { playTransmission } from "./radio";
import { getAudioSettings } from "./audioSettings";
import comms, { getRadioTrace, voicePack } from "./comms";
import { lastNativeStatus, nativeAudioStatus, hasNativeAudio } from "./nativeAudio";
import { BUILD_COMMIT, BUILD_TIME, IS_NATIVE, bundleName } from "../lib/buildInfo";

export const HOUSTON_TEST_ID = "launch.liftoff";

const r2 = (x) => Math.round(x * 100) / 100;
const db = (x) => (x > 0 ? Math.round(20 * Math.log10(x)) : -Infinity);

/* ---- an output meter on the engine's master (signal measured before the device) ---- */
let meter = null;
function outputMeter(e) {
  if (meter && meter.ctx === e.ctx) return meter;
  const a = e.ctx.createAnalyser();
  a.fftSize = 1024;
  // WebKit only renders nodes that lead to the destination: pull the analyser through a muted gain.
  const sink = e.ctx.createGain();
  sink.gain.value = 0;
  e.master.connect(a);
  a.connect(sink).connect(e.ctx.destination);
  const buf = new Float32Array(a.fftSize);
  meter = {
    ctx: e.ctx,
    peak() {
      a.getFloatTimeDomainData(buf);
      let p = 0;
      for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i]));
      return p;
    },
  };
  return meter;
}

/** Watch the output for `ms`: the highest peak seen, and whether the engine clock moved. */
function watch(e, ms, startAt) {
  const m = outputMeter(e);
  const t0 = e.ctx.currentTime;
  let peak = 0;
  return new Promise((resolve) => {
    const iv = setInterval(() => (peak = Math.max(peak, m.peak())), 40);
    setTimeout(() => {
      clearInterval(iv);
      resolve({ peak, clockFrom: t0, clockTo: e.ctx.currentTime, passedStart: e.ctx.currentTime > (startAt ?? t0), state: e.ctx.state });
    }, ms);
  });
}

/* ---- one test run: an event log with timestamps and a final status ---- */
function makeRun(name) {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const run = { name, at: new Date().toISOString(), events: [], status: "RUNNING", detail: {} };
  run.ev = (label, info) => {
    const ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);
    run.events.push({ ms, label, info: info || "" });
  };
  return run;
}

/** Synchronous start inside the tap: create / resume the engine. Returns the engine or null. */
function startInGesture(run) {
  const before = engineDiagnosis();
  const e = getEngine({ create: true });
  if (!e) {
    run.ev("PLAYBACK FAILED", "no Web Audio on this device");
    run.status = "PLAYBACK FAILED";
    return null;
  }
  run.ev("AUDIO ENGINE", `${before.exists ? "existing" : "created now"} · context ${e.ctx.state}`);
  if (e.ctx.state !== "running") {
    resumeEngine();
    // WebKit starts the output once something is played inside the gesture
    try {
      const s = e.ctx.createBufferSource();
      s.buffer = e.ctx.createBuffer(1, 1, 22050);
      s.connect(e.ctx.destination);
      s.start(0);
    } catch (err) {}
  }
  return e;
}

/** Wait (briefly) for a running context; logs AUDIO CONTEXT SUSPENDED when it will not run. */
async function waitRunning(run, e, ms = 1200) {
  const end = Date.now() + ms;
  while (e.ctx.state !== "running" && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 50));
  }
  if (e.ctx.state !== "running") {
    run.ev(`AUDIO CONTEXT ${e.ctx.state.toUpperCase()}`, "the system did not start audio");
    run.status = `AUDIO CONTEXT ${e.ctx.state.toUpperCase()}`;
    return false;
  }
  run.ev("AUDIO CONTEXT RUNNING", `${e.ctx.sampleRate} Hz`);
  return true;
}

function judge(run, w, minPeak = 0.003) {
  run.detail.peakDb = db(w.peak);
  run.detail.clock = `${r2(w.clockFrom)} → ${r2(w.clockTo)} s`;
  if (w.state !== "running") {
    run.ev("PLAYBACK INTERRUPTED", `context ${w.state}`);
    run.status = "PLAYBACK INTERRUPTED";
    return false;
  }
  if (!w.passedStart) {
    run.ev("PLAYBACK FAILED", "the audio clock did not move: nothing is being rendered");
    run.status = "PLAYBACK FAILED";
    return false;
  }
  if (w.peak < minPeak) {
    run.ev("PLAYBACK FAILED", `no signal at the engine output (peak ${db(w.peak)} dBFS)`);
    run.status = "PLAYBACK FAILED";
    return false;
  }
  run.ev("PLAYBACK STARTED", `signal at the engine output, peak ${db(w.peak)} dBFS; clock ${run.detail.clock}`);
  return true;
}

/* ---- TEST 1: test tone (three beeps, 1.2 s) on the master output ---- */
export function runToneTest() {
  const run = makeRun("TEST 1 · TEST TONE");
  const e = startInGesture(run);
  if (!e) return Promise.resolve(run);
  return (async () => {
    if (!(await waitRunning(run, e))) return run;
    const { ctx } = e;
    const t = ctx.currentTime + 0.05;
    const g = ctx.createGain();
    g.gain.value = 0;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = 880;
    [0, 0.4, 0.8].forEach((d) => {
      g.gain.setValueAtTime(0, t + d);
      g.gain.linearRampToValueAtTime(0.5, t + d + 0.01);
      g.gain.setValueAtTime(0.5, t + d + 0.28);
      g.gain.linearRampToValueAtTime(0, t + d + 0.3);
    });
    o.connect(g).connect(e.master);
    let ended = false;
    o.onended = () => (ended = true);
    try {
      o.start(t);
      o.stop(t + 1.15);
    } catch (err) {
      run.ev("PLAYBACK FAILED", String(err && err.message));
      run.status = "PLAYBACK FAILED";
      return run;
    }
    run.ev("PLAYBACK REQUESTED", "880 Hz, 3 beeps, 1.2 s, on the master output");
    const w = await watch(e, 700, t);
    if (!judge(run, w)) return run;
    await new Promise((r) => setTimeout(r, 650));
    run.ev(ended ? "PLAYBACK COMPLETED" : "PLAYBACK INTERRUPTED", ended ? "the tone ended normally" : `no end event (context ${ctx.state})`);
    run.status = ended ? "PLAYBACK COMPLETED" : "PLAYBACK INTERRUPTED";
    setTimeout(() => g.disconnect(), 200);
    return run;
  })();
}

/* ---- TEST 2: a game sound effect (through the effects bus, SOUND EFFECTS volume) ---- */
export function runSfxTest(playEffect, label = "hold-down release (clank)") {
  const run = makeRun("TEST 2 · SOUND EFFECT");
  const e = startInGesture(run);
  if (!e) return Promise.resolve(run);
  return (async () => {
    if (!(await waitRunning(run, e))) return run;
    run.detail.sfxVolume = getAudioSettings().sfxVolume;
    if (getAudioSettings().sfxVolume === 0) run.ev("NOTE", "SOUND EFFECTS volume is 0 in AUDIO");
    const at = e.ctx.currentTime;
    try {
      playEffect();
    } catch (err) {
      run.ev("PLAYBACK FAILED", String(err && err.message));
      run.status = "PLAYBACK FAILED";
      return run;
    }
    run.ev("PLAYBACK REQUESTED", `${label}, effects bus at ${Math.round(e.sfx.gain.value * 100)}%`);
    const w = await watch(e, 900, at);
    if (!judge(run, w)) return run;
    run.ev("PLAYBACK COMPLETED", "effect window over");
    run.status = "PLAYBACK COMPLETED";
    return run;
  })();
}

/* ---- TEST 3: a bundled Houston recording, through the mission's own radio path ---- */
export function runHoustonTest({ id = HOUSTON_TEST_ID } = {}) {
  const run = makeRun("TEST 3 · HOUSTON VOICE");
  const e = startInGesture(run);
  if (!e) return Promise.resolve(run);
  return (async () => {
    const s = getAudioSettings();
    const lang = s.voiceLang;
    const line = catalog.lines.find((l) => l.id === id);
    const role = (line && catalog.roles[line.role]) || {};
    run.detail = { id, lang, voiceSetting: s.voice ? "ON" : "OFF", voiceVolume: s.voiceVolume, radioFx: s.radioFx };
    if (!s.voice) run.ev("NOTE", "MISSION CONTROL VOICE is OFF in AUDIO (missions will be subtitles only); this test plays anyway");
    if (s.voiceVolume === 0) run.ev("NOTE", "VOICE VOLUME is 0 in AUDIO");
    const file = voicePack.file(lang, id);
    run.ev("FILE", file ? `${voicePack.base}/${file}` : "not in the voice manifest");
    const r = await voicePack.load(e.ctx, lang, id);
    if (!r.buffer) {
      const nf = /^http-|fetch-|empty-file|clip-missing|pack-unavailable/.test(r.error || "");
      const label = /^decode-failed/.test(r.error || "") ? "DECODE FAILED" : nf ? "FILE NOT FOUND" : "PLAYBACK FAILED";
      run.ev(label, r.error);
      run.status = label;
      return run;
    }
    run.detail.file = r.file;
    run.ev("FILE FOUND", `${r.cached ? "already decoded" : `${r.bytes} bytes, status ${r.status}`}`);
    run.ev("DECODE OK", `${r2(r.buffer.duration)} s, ${r.buffer.sampleRate} Hz, ${r.buffer.numberOfChannels} ch`);
    if (!(await waitRunning(run, e))) return run;
    let started = false;
    let ended = false;
    let startAt = null;
    let handle;
    try {
      handle = playTransmission(e.ctx, e.voice, {
        buffer: r.buffer,
        profile: role.radio,
        critical: line && line.priority === "CRITICAL",
        fx: s.radioFx,
        link: 1,
        quindar: line && line.role === "CAPCOM" && (line.priority === "NORMAL" || line.priority === "AMBIENT"),
        gain: 1,
        onStart: () => {
          started = true;
          startAt = e.ctx.currentTime;
        },
        onEnd: () => (ended = true),
      });
    } catch (err) {
      run.ev("PLAYBACK FAILED", String(err && err.message));
      run.status = "PLAYBACK FAILED";
      return run;
    }
    run.ev("PLAYBACK REQUESTED", `mission radio path (${role.radio || "space"}${s.radioFx ? ", radio effects" : ", clean"}), voice bus at ${Math.round(e.voice.gain.value * 100)}%`);
    const intro = 0.45;
    await new Promise((res) => setTimeout(res, intro * 1000));
    const w = await watch(e, Math.min(1500, r.buffer.duration * 1000), e.ctx.currentTime);
    if (!started) run.ev("NOTE", "the radio's start callback had not fired yet");
    if (!judge(run, w)) {
      if (handle) handle.stop("reset");
      return run;
    }
    const left = Math.max(0, (r.buffer.duration + 0.6) * 1000 - (intro * 1000 + 1500));
    await new Promise((res) => setTimeout(res, left + 300));
    run.ev(ended ? "PLAYBACK COMPLETED" : "PLAYBACK INTERRUPTED", ended ? `the transmission ended (${r2(r.buffer.duration)} s)` : `no end (context ${e.ctx.state})`);
    run.status = ended ? "PLAYBACK COMPLETED" : "PLAYBACK INTERRUPTED";
    run.detail.startedAt = startAt;
    return run;
  })();
}

/* ---- EXTRA: the same recording through the web view's media player (not the game engine) ---- */
export function runMediaElementTest({ id = HOUSTON_TEST_ID } = {}) {
  const run = makeRun("EXTRA · HOUSTON VIA MEDIA PLAYER");
  const lang = getAudioSettings().voiceLang;
  return (async () => {
    // The tap's activation must reach play(): the element is created and played synchronously
    // when the file name is already known, otherwise right after the manifest loads.
    if (!voicePack.loaded) await voicePack.ready();
    const file = voicePack.file(lang, id);
    if (!file) {
      run.ev("FILE NOT FOUND", "not in the voice manifest");
      run.status = "FILE NOT FOUND";
      return run;
    }
    const url = `${voicePack.base}/${file}`;
    const a = new Audio();
    a.preload = "auto";
    a.src = url;
    a.volume = 1;
    let ended = false;
    let errored = null;
    a.addEventListener("playing", () => run.ev("PLAYBACK STARTED", `media element playing (${url})`));
    a.addEventListener("ended", () => (ended = true));
    a.addEventListener("error", () => (errored = a.error ? `media error ${a.error.code}${a.error.message ? ": " + a.error.message : ""}` : "media error"));
    run.ev("PLAYBACK REQUESTED", url);
    let p;
    try {
      p = a.play();
    } catch (err) {
      run.ev("PLAYBACK FAILED", String(err && err.message));
      run.status = "PLAYBACK FAILED";
      return run;
    }
    const res = await Promise.resolve(p).then(
      () => null,
      (err) => `${(err && err.name) || "Error"}: ${(err && err.message) || ""}`
    );
    if (res) {
      run.ev("PLAYBACK FAILED", res);
      run.status = /NotSupported/.test(res) ? "DECODE FAILED" : "PLAYBACK FAILED";
      return run;
    }
    const until = Date.now() + 9000;
    while (!ended && !errored && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
    if (errored) {
      run.ev(/code 4|media error 4/.test(errored) ? "DECODE FAILED" : "PLAYBACK FAILED", errored);
      run.status = "PLAYBACK FAILED";
    } else {
      run.ev(ended ? "PLAYBACK COMPLETED" : "PLAYBACK INTERRUPTED", ended ? `${r2(a.duration)} s` : "no end event");
      run.status = ended ? "PLAYBACK COMPLETED" : "PLAYBACK INTERRUPTED";
    }
    return run;
  })();
}

/* ---- status ---- */
export function audioStatus() {
  const e = getEngine();
  const d = engineDiagnosis();
  const s = getAudioSettings();
  let session = null;
  try {
    if (typeof navigator !== "undefined" && navigator.audioSession) session = { type: navigator.audioSession.type, state: navigator.audioSession.state };
  } catch (err) {}
  const c = comms.diagnose();
  return {
    build: `BUILD ${BUILD_COMMIT}${BUILD_TIME ? " · " + BUILD_TIME : ""}`,
    bundle: bundleName(),
    platform: IS_NATIVE ? "iOS app (Capacitor)" : "web browser",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    webAudio: typeof window !== "undefined" && !!(window.AudioContext || window.webkitAudioContext),
    engine: d.exists ? "initialized" : "not initialized (starts on the first tap)",
    ctxState: d.exists ? d.state : "none",
    sampleRate: d.sampleRate,
    baseLatency: e && e.ctx.baseLatency != null ? r2(e.ctx.baseLatency * 1000) + " ms" : null,
    clock: e ? r2(e.ctx.currentTime) : null,
    createdBy: d.createdBy,
    gestures: d.gestures,
    resumes: d.resumes,
    resumeFailures: d.resumeFailures,
    interruptions: d.interruptions,
    masterGain: e ? r2(e.master.gain.value) : null,
    voiceBusGain: e ? r2(e.voice.gain.value) : null,
    sfxBusGain: e ? r2(e.sfx.gain.value) : null,
    duckGain: e ? r2(e.duck.gain.value) : null,
    settings: { voice: s.voice, voiceLang: s.voiceLang, voiceVolume: s.voiceVolume, sfxVolume: s.sfxVolume, radioFx: s.radioFx, subtitles: s.subtitles, silentMode: s.silentMode },
    webSession: session,
    nativeSession: hasNativeAudio() ? lastNativeStatus() : "not available (browser, or an app build without the audio plugin)",
    voicePack: c.packLoaded ? "manifest loaded" : "manifest not loaded yet",
    lastRadio: c.last,
  };
}

export const refreshNative = () => nativeAudioStatus();

/* ---- the radio trace of this session, one line per transmission ---- */
export function radioTraceRows() {
  const rows = [];
  const open = new Map();
  for (const e of getRadioTrace()) {
    if (!e.id) continue;
    if (e.type === "queue") {
      const r = { id: e.id, queued: e.wall, page: e.page, ctxAtQueue: e.ctx, result: "QUEUED", file: null, lang: null, end: null };
      rows.push(r);
      open.set(e.id, r);
      continue;
    }
    let r = open.get(e.id);
    if (!r) {
      r = { id: e.id, queued: null, page: e.page, ctxAtQueue: null, result: "", file: null, lang: null, end: null };
      rows.push(r);
      open.set(e.id, r);
    }
    if (e.type === "start") r.started = e.wall;
    else if (e.type === "request") {
      r.requested = e.wall;
      r.file = e.file;
      r.lang = e.lang;
      r.ctx = e.ctx;
    } else if (e.type === "voice") {
      r.result = "PLAYBACK STARTED";
      r.file = e.file || r.file;
      r.lang = e.lang;
      r.ctx = e.ctx;
    } else if (e.type === "silent") {
      r.result = `SILENT (${e.reason})`;
      r.file = e.file || r.file;
      r.lang = e.lang;
      r.ctx = r.ctx || e.ctx;
    } else if (e.type === "fallback") r.result = `SPEECH FALLBACK (${e.reason})`;
    else if (e.type === "cut") r.end = `INTERRUPTED (${e.reason})`;
    else if (e.type === "drop" || e.type === "stale") {
      r.result = r.result && r.result !== "QUEUED" ? r.result : `DROPPED (${e.reason || "stale"})`;
      open.delete(e.id);
    } else if (e.type === "end") {
      if (!r.end) r.end = "COMPLETED";
      open.delete(e.id);
    }
  }
  return rows;
}

const hhmmss = (w) => (w ? new Date(w).toISOString().slice(11, 23) : "—");

/** The report the player copies and sends: no personal data, no secrets. */
export function diagnosticsReport(results) {
  const st = audioStatus();
  const lines = [];
  lines.push("LUNAVIA AUDIO DIAGNOSTICS");
  lines.push(`${st.build} · ${st.bundle} · ${st.platform}`);
  lines.push(`device: ${st.userAgent}`);
  lines.push(`report time: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("ENGINE");
  lines.push(`  web audio: ${st.webAudio ? "yes" : "NO"} · engine: ${st.engine} · context: ${st.ctxState} · ${st.sampleRate || "-"} Hz · latency ${st.baseLatency || "-"} · clock ${st.clock ?? "-"} s`);
  lines.push(`  created by: ${st.createdBy || "-"} · taps seen: ${st.gestures} · resumes: ${st.resumes} (failed ${st.resumeFailures}) · interruptions: ${st.interruptions}`);
  lines.push(`  gains: master ${st.masterGain ?? "-"} · radio (voice bus) ${st.voiceBusGain ?? "-"} · effects bus ${st.sfxBusGain ?? "-"} · duck ${st.duckGain ?? "-"}`);
  lines.push(`  settings: voice ${st.settings.voice ? "ON" : "OFF"} (${st.settings.voiceLang}) · voice volume ${Math.round(st.settings.voiceVolume * 100)} · effects volume ${Math.round(st.settings.sfxVolume * 100)} · radio fx ${st.settings.radioFx ? "ON" : "OFF"} · silent mode: ${st.settings.silentMode === "follow" ? "FOLLOW IPHONE" : "PLAY SOUND"}`);
  lines.push(`  web audio session: ${st.webSession ? `${st.webSession.type} / ${st.webSession.state}` : "not available in this web view"}`);
  const n = st.nativeSession;
  if (n && typeof n === "object") {
    lines.push(`  iPhone session: ${n.category || "-"} (${n.mode || "-"})${n.mixWithOthers ? " mix" : ""} · media volume ${n.outputVolume != null ? Math.round(n.outputVolume * 100) + "%" : "-"} · output ${n.outputs || "-"} · other audio ${n.otherAudioPlaying ? "yes" : "no"} · iOS ${n.ios || "-"}${n.error ? " · error: " + n.error : ""}`);
  } else lines.push(`  iPhone session: ${n || "not read yet"}`);
  lines.push(`  voice pack: ${st.voicePack}`);
  lines.push("");
  lines.push("TESTS");
  const all = Object.values(results || {}).filter(Boolean);
  if (!all.length) lines.push("  (no test run yet)");
  all.forEach((r) => {
    lines.push(`  ${r.name}: ${r.status}  [${r.at}]`);
    r.events.forEach((e) => lines.push(`    +${e.ms} ms  ${e.label}${e.info ? " — " + e.info : ""}`));
  });
  lines.push("");
  const rows = radioTraceRows();
  lines.push(`HOUSTON RADIO THIS SESSION (${rows.length} calls)`);
  rows.slice(-80).forEach((r) => {
    lines.push(`  ${hhmmss(r.queued || r.requested)}  ${r.id}  [${r.lang || "-"}]  ${r.file || "-"}  ctx ${r.ctx || r.ctxAtQueue || "-"}  ${r.result || "-"}  ${r.end || ""}  (${r.page || ""})`);
  });
  return lines.join("\n");
}
