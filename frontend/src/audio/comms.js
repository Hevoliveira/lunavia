/*
 * LUNAVIA — mission-control comms hub (one per app).
 *
 *   say(id, { delay, relevant })   request a line from commsLines.json
 *   setBlackout(on) / setLink(q)   entry plasma: radio cut-off and link quality
 *   setEarthLink(on)               false on the far side: no line of sight to the
 *                                  Earth, so only onboard voices and cabin calls
 *                                  (as in the blackout), without the static burst
 *   setVerbosity(level)            "full" | "standard" | "minimal"
 *   setMuted(on)                   page-level mute (Training "MUTE INSTRUCTOR")
 *   flush() / reset()              drop pending calls (new attempt, abort)
 *   subscribe(fn)                  { type: "start" | "end", ... } for subtitles
 *
 * The voice plays through the app's one audio engine (audioEngine.js). Before
 * each transmission a stopped context (iOS: suspended or interrupted) is asked
 * to resume; only if it will not (no gesture yet, the system refuses) does the
 * call run as a subtitle on the clip's own timing, and the reason is recorded
 * (diagnose(), TEST RADIO). When a clip is missing from the bundled pack and
 * there is no Web Audio at all, the device's speech synthesis says the line.
 */
import catalog from "./commsLines.json";
import { createDirector } from "./commsDirector";
import { createVoicePack } from "./voicePack";
import { playTransmission, staticBurst } from "./radio";
import { getAudioSettings, setAudioSettings, subscribeAudioSettings } from "./audioSettings";
import { duck as duckEffects, engineDiagnosis, ensureRunning, getEngine } from "./audioEngine";

const listeners = new Set();
const pack = createVoicePack();
let attached = false; // a mission page wants the radio (useMissionAudio)
let muted = false;
let lastOutcome = null; // { id, voiced, reason, at }
let link = 1;
let blackout = false;
let onAirHandle = null;

const emit = (e) => listeners.forEach((fn) => fn(e));
/** Effects bus gain while someone speaks (measured: the launch roar masked the calls at 0.6). */
export const DUCK = { normal: 0.35, critical: 0.25 };
const estimate = (text) => Math.max(0.8, text.split(/\s+/).length * 0.36 + 0.3);

function log(e) {
  if (typeof window !== "undefined" && window.__lvCommsLog) window.__lvCommsLog.push({ ...e, wall: Date.now() });
}

const FALLBACK_RESPELL = { en: [[/\bLUNAVIA\b/g, "Lunavia"]], pt: [[/\bLUNAVIA\b/g, "Lunavia"], [/\bTLI\b/g, "tê éle i"]] };

function speakFallback(text, lang, { onStart, onEnd }) {
  const synth = typeof window !== "undefined" && window.speechSynthesis;
  if (!synth) {
    onStart();
    const t = setTimeout(onEnd, estimate(text) * 1000);
    return { stop: () => clearTimeout(t) };
  }
  let said = text;
  (FALLBACK_RESPELL[lang] || []).forEach(([re, rep]) => (said = said.replace(re, rep)));
  const u = new SpeechSynthesisUtterance(said.replace(/\.\.\./g, ","));
  const want = lang === "pt" ? /^pt(-|_)BR/i : /^en(-|_)US/i;
  const voices = synth.getVoices();
  u.voice = voices.find((v) => want.test(v.lang)) || voices.find((v) => v.lang.slice(0, 2) === lang) || null;
  u.lang = lang === "pt" ? "pt-BR" : "en-US";
  u.volume = getAudioSettings().voiceVolume;
  // Guard: some engines never fire onend (interrupted audio session).
  const guard = setTimeout(onEnd, (estimate(text) + 3) * 1000);
  u.onstart = onStart;
  u.onend = u.onerror = () => {
    clearTimeout(guard);
    onEnd();
  };
  synth.speak(u);
  return {
    stop() {
      clearTimeout(guard);
      synth.cancel();
    },
  };
}

const engineNow = () => {
  const e = getEngine();
  return e ? { ctx: e.ctx, out: e.voice } : null;
};

function transmit({ id, line, variant, keyed }, done) {
  const s = getAudioSettings();
  const lang = s.voiceLang;
  const text = line.variants[variant] || line.variants[0];
  const role = catalog.roles[line.role] || {};
  const wanted = s.voice && !muted;
  let engine = engineNow();
  let voiced = false;
  let ended = false;
  let ducked = false;
  let handle = null;
  let stopped = false;
  const begin = (dur) => {
    if (voiced) {
      // Effects dip under Houston (-9 dB, -12 dB for a critical call) so the voice stays clear of
      // the engines; they come back as soon as the transmission ends.
      duckEffects(true, line.priority === "CRITICAL" ? DUCK.critical : DUCK.normal);
      ducked = true;
    }
    emit({ type: "start", id, role: line.role, label: role.label, priority: line.priority, text, dur, voiced });
  };
  const end = () => {
    if (ended) return;
    ended = true;
    if (ducked) duckEffects(false);
    if (onAirHandle === api) onAirHandle = null;
    emit({ type: "end", id });
    done();
  };
  const api = {
    stop(reason) {
      stopped = true;
      if (handle) handle.stop(reason);
      end();
    },
    setLink(q) {
      if (handle && handle.setLink) handle.setLink(q);
    },
  };
  onAirHandle = api;

  const silent = (reason) => {
    // Subtitle-only playback on the clip's own timing; why it was not heard is recorded.
    voiced = false;
    lastOutcome = { id, voiced: false, reason, at: Date.now() };
    const dur = pack.duration(lang, id, variant) || estimate(text[lang]);
    begin(dur);
    log({ type: "silent", id, lang, reason });
    const t = setTimeout(end, dur * 1000 + 250);
    handle = { stop: () => clearTimeout(t) };
  };
  if (!wanted) {
    silent(!s.voice ? "voice-off" : "muted");
    return api;
  }
  if (!engine) {
    // No Web Audio engine yet (no gesture) or none on this device
    if (!getEngineAvailable()) {
      begin(estimate(text[lang]));
      log({ type: "fallback", id, lang, reason: "no-web-audio" });
      handle = speakFallback(text[lang], lang, { onStart: () => {}, onEnd: end });
      return api;
    }
    silent("no-gesture-yet");
    return api;
  }

  // A stopped context (iOS: suspended / interrupted) is asked to resume before the call.
  ensureRunning(engine.ctx.state === "running" ? 0 : 700).then((running) => {
    if (stopped || ended) return;
    engine = engineNow();
    if (!running || !engine) {
      silent(`context-${engine ? engine.ctx.state : "none"}`);
      return;
    }
    voice(engine);
  });

  function voice(engine) {
    pack.buffer(engine.ctx, lang, id, variant).then((buffer) => {
      if (stopped || ended) return;
      if (!buffer) {
        // Clip missing or undecodable: the call is carried by its subtitle (recorded).
        silent(pack.loaded ? "clip-missing" : "pack-unavailable");
        return;
      }
      voiced = true;
      lastOutcome = { id, voiced: true, reason: "played", at: Date.now() };
      handle = playTransmission(engine.ctx, engine.out, {
        buffer,
        profile: role.radio,
        critical: line.priority === "CRITICAL",
        fx: s.radioFx,
        link: role.radio === "onboard" ? 1 : link,
        keyed,
        quindar: line.role === "CAPCOM" && (line.priority === "NORMAL" || line.priority === "AMBIENT"),
        gain: line.role === "COMPUTER" ? 0.75 : 1,
        onStart: () => {
          begin(buffer.duration);
          log({ type: "voice", id, lang });
        },
        onEnd: end,
      });
    });
  }
  return api;
}

const getEngineAvailable = () => typeof window !== "undefined" && !!(window.AudioContext || window.webkitAudioContext);

const director = createDirector({ catalog, transmit, onLog: log });

let lifecycleBound = false;
function bindLifecycle() {
  if (lifecycleBound || typeof document === "undefined") return;
  lifecycleBound = true;
  // Backgrounded or locked: whatever was being said is no longer current.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      director.flush("hidden");
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    }
  });
  subscribeAudioSettings((s) => {
    if (attached) pack.prefetch(s.voiceLang);
  });
}

const comms = {
  catalog,
  // Nothing is said while the app is in the background; it would be stale on return.
  say: (id, opts) => (typeof document !== "undefined" && document.visibilityState === "hidden" ? false : director.request(id, opts)),
  setBlackout(on) {
    const was = blackout;
    blackout = !!on;
    director.setBlackout(blackout);
    const e = engineNow();
    if (blackout && !was && e && e.ctx.state === "running" && getAudioSettings().radioFx && getAudioSettings().voice && !muted) staticBurst(e.ctx, e.out);
  },
  setEarthLink(on) {
    blackout = !on;
    director.setBlackout(blackout);
  },
  setLink(q) {
    link = Math.min(1, Math.max(0, q));
    if (onAirHandle) onAirHandle.setLink(link);
  },
  setVerbosity: (v) => director.setVerbosity(v),
  setMuted(on) {
    muted = !!on;
    if (muted) director.flush("muted");
  },
  flush: () => director.flush(),
  reset() {
    director.reset();
    blackout = false;
    link = 1;
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** A mission page wants the radio: lifecycle bound, the selected language's clips fetched. */
  attach() {
    attached = true;
    bindLifecycle();
    pack.prefetch(getAudioSettings().voiceLang);
  },
  /** Leaving the page: nothing it queued may be heard on the next one. */
  detach() {
    attached = false;
    comms.reset();
    pack.trim();
  },
  /**
   * TEST RADIO from the audio settings (a tap, so audio may start): a short Houston call through
   * the same engine, radio chain and voice pack as the mission. Resolves with what happened:
   * { voiced, reason, state } — "played", or why not ("voice-off", "context-suspended", …).
   */
  radioCheck() {
    getEngine({ create: true });
    bindLifecycle();
    director.flush("check");
    lastOutcome = null;
    return new Promise((resolve) => {
      const off = comms.subscribe((e) => {
        if (e.id !== "settings.radioCheck" || e.type !== "end") return;
        off();
        resolve({ ...(lastOutcome || { voiced: false, reason: "not-started" }), state: engineDiagnosis().state });
      });
      // The muted Training page mute does not apply to a test the player asked for.
      const wasMuted = muted;
      muted = false;
      const ok = director.request("settings.radioCheck");
      muted = wasMuted;
      if (!ok) {
        off();
        resolve({ voiced: false, reason: "not-queued", state: engineDiagnosis().state });
      }
    });
  },
  get onAir() {
    return director.onAir;
  },
  /** Why the voice is (or is not) heard right now — for TEST RADIO and the validation tooling. */
  diagnose() {
    const s = getAudioSettings();
    const e = engineDiagnosis();
    return { engine: e.exists, ctxState: e.exists ? e.state : null, engineStats: e, voice: s.voice, muted, voiceVolume: s.voiceVolume, lang: s.voiceLang, packLoaded: pack.loaded, last: lastOutcome };
  },
};

export default comms;

// QA hook (validation harness / Safari Web Inspector): set window.__lvDebug before load.
if (typeof window !== "undefined" && window.__lvDebug) {
  window.__lvComms = comms;
  window.__lvAudioSettings = { get: getAudioSettings, set: setAudioSettings };
}
