/*
 * LUNAVIA — the one audio engine of the app (Web Audio).
 *
 * One AudioContext for the whole app, created inside a real player gesture (iOS / WebKit only
 * lets audio start there) and kept for the app's lifetime: pages and scenes share it, so moving
 * between them never leaves the radio attached to a closed or never-started context.
 *
 *   master ← sfx bus (SFX VOLUME) ← duck (dipped while someone speaks)
 *   master ← voice bus (VOICE VOLUME) ← voice leveller (steady radio loudness)
 *
 * iOS puts a context into "suspended" or "interrupted" after a notification sound, Siri, a call,
 * an app switch or the screen lock. The engine tries to bring it back by itself (returning to
 * the app, focus, a retry while the page is visible) and on every later tap, and the radio asks
 * it to resume before each transmission (ensureRunning), instead of silently dropping the voice.
 * No autoplay before a gesture, nothing bypassed: a context the system will not resume stays
 * silent and the subtitles carry the call.
 */
import { getAudioSettings, subscribeAudioSettings } from "./audioSettings";

let engine = null; // { ctx, master, sfx, duck, voice, leveller }
const stateListeners = new Set();
let installed = false;
let retryTimer = null;
const stats = { created: 0, resumes: 0, resumeFailures: 0, interruptions: 0, lastState: null };

const AC = () => (typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : null);

function emitState() {
  const st = engine ? engine.ctx.state : "none";
  if (st !== stats.lastState && (st === "interrupted" || st === "suspended") && stats.lastState === "running") stats.interruptions += 1;
  stats.lastState = st;
  stateListeners.forEach((fn) => {
    try {
      fn(st);
    } catch (e) {}
  });
}

function build() {
  const Ctor = AC();
  if (!Ctor) return null;
  try {
    // Play mission audio as an app's media (iOS 17+ WebKit Audio Session API, where available).
    if (navigator.audioSession) navigator.audioSession.type = "playback";
  } catch (e) {}
  let ctx;
  try {
    ctx = new Ctor({ latencyHint: "interactive" });
  } catch (e) {
    try {
      ctx = new Ctor();
    } catch (e2) {
      return null;
    }
  }
  stats.created += 1;
  const st = getAudioSettings();
  const master = ctx.createGain();
  master.connect(ctx.destination);
  const sfx = ctx.createGain();
  sfx.gain.value = st.sfxVolume;
  const duck = ctx.createGain();
  sfx.connect(duck).connect(master);
  // The radio's own leveller: transmissions land at one loudness whatever the clip, and a
  // strong one never clips over the engines.
  const leveller = ctx.createDynamicsCompressor();
  leveller.threshold.value = -20;
  leveller.knee.value = 8;
  leveller.ratio.value = 3;
  leveller.attack.value = 0.004;
  leveller.release.value = 0.25;
  const makeup = ctx.createGain();
  makeup.gain.value = 1.4;
  const voice = ctx.createGain();
  voice.gain.value = st.voiceVolume;
  voice.connect(leveller).connect(makeup).connect(master);
  engine = { ctx, master, sfx, duck, voice, leveller };
  // QA only (window.__lvDebug): level meters on the two paths, for the mix checks
  if (typeof window !== "undefined" && window.__lvDebug) {
    const meter = (from) => {
      const a = ctx.createAnalyser();
      a.fftSize = 2048;
      from.connect(a);
      const buf = new Float32Array(a.fftSize);
      return () => {
        a.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        return 10 * Math.log10(sum / buf.length + 1e-12);
      };
    };
    const mv = meter(makeup);
    const ms = meter(duck);
    window.__lvAudioMeter = () => ({ voiceDb: mv(), sfxDb: ms(), duck: duck.gain.value });
  }
  ctx.onstatechange = () => {
    emitState();
    if (ctx.state !== "running" && ctx.state !== "closed") scheduleRetry();
  };
  subscribeAudioSettings((s) => {
    if (!engine || engine.ctx !== ctx) return;
    sfx.gain.setTargetAtTime(s.sfxVolume, ctx.currentTime, 0.05);
    voice.gain.setTargetAtTime(s.voiceVolume, ctx.currentTime, 0.05);
  });
  emitState();
  return engine;
}

/** The engine; created only when `create` (call that from inside a player gesture). */
export function getEngine({ create = false } = {}) {
  if (!engine && create) build();
  if (engine && engine.ctx.state === "closed") {
    engine = null;
    if (create) build();
  }
  return engine;
}

/** Try to (re)start the context; resolves true when it is running. Never throws. */
export function resumeEngine() {
  if (!engine) return Promise.resolve(false);
  const ctx = engine.ctx;
  if (ctx.state === "running") return Promise.resolve(true);
  if (ctx.state === "closed") return Promise.resolve(false);
  stats.resumes += 1;
  let p;
  try {
    p = ctx.resume();
  } catch (e) {
    p = null;
  }
  return Promise.resolve(p)
    .then(() => ctx.state === "running")
    .catch(() => false)
    .then((ok) => {
      if (!ok) stats.resumeFailures += 1;
      emitState();
      return ok;
    });
}

/**
 * Resolve true once the context runs, false after `timeoutMs` (the radio then plays the call as a
 * subtitle). A context that is already running answers at once.
 */
export function ensureRunning(timeoutMs = 600) {
  if (!engine) return Promise.resolve(false);
  if (engine.ctx.state === "running") return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve(v);
    };
    const t = setTimeout(() => finish(engine && engine.ctx.state === "running"), timeoutMs);
    resumeEngine().then((ok) => ok && finish(true));
  });
}

function scheduleRetry() {
  if (retryTimer || typeof document === "undefined") return;
  let n = 0;
  const tick = () => {
    retryTimer = null;
    if (!engine || engine.ctx.state === "running" || engine.ctx.state === "closed") return;
    if (document.visibilityState === "visible") resumeEngine();
    // a few quick tries after an interruption ends, then a slow watch until a tap resumes it
    n += 1;
    retryTimer = setTimeout(tick, n < 6 ? 500 : 3000);
  };
  retryTimer = setTimeout(tick, 250);
}

/**
 * Install the gesture and lifecycle listeners once. The first tap, click or key creates the
 * context (inside the gesture); every later one resumes it if iOS stopped it. Returning to the
 * app (visibility, pageshow, focus) also tries to resume it.
 */
export function installAudioUnlock() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const onGesture = () => {
    const e = getEngine({ create: true });
    if (!e) return;
    if (e.ctx.state !== "running") {
      resumeEngine();
      // WebKit starts the output only once something is played inside the gesture
      try {
        const src = e.ctx.createBufferSource();
        src.buffer = e.ctx.createBuffer(1, 1, 22050);
        src.connect(e.ctx.destination);
        src.start(0);
      } catch (err) {}
    }
  };
  ["touchend", "click", "keydown", "pointerup"].forEach((ev) => window.addEventListener(ev, onGesture, true));
  const back = () => {
    if (document.visibilityState === "visible" && engine && engine.ctx.state !== "running") resumeEngine();
  };
  document.addEventListener("visibilitychange", back);
  window.addEventListener("pageshow", back);
  window.addEventListener("focus", back);
}

export function onEngineState(fn) {
  stateListeners.add(fn);
  return () => stateListeners.delete(fn);
}

/** Dip the effects under a transmission (depth = gain while ducked) and bring them back. */
export function duck(on, depth = 0.5) {
  if (!engine) return;
  const { ctx, duck: d } = engine;
  const now = ctx.currentTime;
  d.gain.cancelScheduledValues(now);
  d.gain.setValueAtTime(d.gain.value, now);
  if (on) d.gain.setTargetAtTime(depth, now, 0.05);
  else d.gain.setTargetAtTime(1, now + 0.2, 0.3);
}

export function engineDiagnosis() {
  return { exists: !!engine, state: engine ? engine.ctx.state : "none", sampleRate: engine ? engine.ctx.sampleRate : null, ...stats };
}

/** Tests only: forget the engine (the context is closed). */
export function _resetEngineForTests() {
  if (engine) {
    try {
      engine.ctx.close();
    } catch (e) {}
  }
  engine = null;
  installed = false;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  stateListeners.clear();
  Object.assign(stats, { created: 0, resumes: 0, resumeFailures: 0, interruptions: 0, lastState: null });
}
