/*
 * LUNAVIA — mission-control comms hub (one per app).
 *
 *   say(id, { delay, relevant })   request a line from commsLines.json
 *   setBlackout(on) / setLink(q)   entry plasma: radio cut-off and link quality
 *   setVerbosity(level)            "full" | "standard" | "minimal"
 *   setMuted(on)                   page-level mute (Training "MUTE INSTRUCTOR")
 *   flush() / reset()              drop pending calls (new attempt, abort)
 *   subscribe(fn)                  { type: "start" | "end", ... } for subtitles
 *
 * useMissionAudio attaches its AudioContext and voice bus. Without one (no
 * user gesture yet, voice off, context interrupted by a call) the director
 * still runs on the clip timings, so subtitles stay in sync and the pacing is
 * the same; the voice is simply not heard. When a clip is missing from the
 * bundled pack the line falls back to the device's speech synthesis.
 */
import catalog from "./commsLines.json";
import { createDirector } from "./commsDirector";
import { createVoicePack } from "./voicePack";
import { playTransmission, staticBurst } from "./radio";
import { getAudioSettings, subscribeAudioSettings } from "./audioSettings";

const listeners = new Set();
const pack = createVoicePack();
let engine = null; // { ctx, out, duck(on, depth) }
let muted = false;
let link = 1;
let blackout = false;
let onAirHandle = null;

const emit = (e) => listeners.forEach((fn) => fn(e));
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

function transmit({ id, line, variant, keyed }, done) {
  const s = getAudioSettings();
  const lang = s.voiceLang;
  const text = line.variants[variant] || line.variants[0];
  const role = catalog.roles[line.role] || {};
  const voiced = s.voice && !muted && !!engine && engine.ctx.state === "running";
  let ended = false;
  let ducked = false;
  let handle = null;
  let stopped = false;
  const begin = (dur) => {
    if (engine && engine.duck && voiced) {
      engine.duck(true, line.priority === "CRITICAL" ? 0.42 : 0.6);
      ducked = true;
    }
    emit({ type: "start", id, role: line.role, label: role.label, priority: line.priority, text, dur });
  };
  const end = () => {
    if (ended) return;
    ended = true;
    if (ducked && engine && engine.duck) engine.duck(false);
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

  if (!voiced) {
    // Subtitle-only (or fully silent) playback on the clip's own timing.
    const dur = pack.duration(lang, id, variant) || estimate(text[lang]);
    begin(dur);
    const t = setTimeout(end, dur * 1000 + 250);
    handle = { stop: () => clearTimeout(t) };
    return api;
  }

  pack.buffer(engine.ctx, lang, id, variant).then((buffer) => {
    if (stopped || ended) return;
    if (!buffer || !engine) {
      handle = speakFallback(text[lang], lang, { onStart: () => begin(estimate(text[lang])), onEnd: end });
      return;
    }
    handle = playTransmission(engine.ctx, engine.out, {
      buffer,
      profile: role.radio,
      critical: line.priority === "CRITICAL",
      fx: s.radioFx,
      link: role.radio === "onboard" ? 1 : link,
      keyed,
      quindar: line.role === "CAPCOM" && (line.priority === "NORMAL" || line.priority === "AMBIENT"),
      gain: line.role === "COMPUTER" ? 0.75 : 1,
      onStart: () => begin(buffer.duration),
      onEnd: end,
    });
  });
  return api;
}

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
    if (engine) pack.prefetch(s.voiceLang);
  });
}

const comms = {
  catalog,
  say: (id, opts) => director.request(id, opts),
  setBlackout(on) {
    const was = blackout;
    blackout = !!on;
    director.setBlackout(blackout);
    if (blackout && !was && engine && getAudioSettings().radioFx && getAudioSettings().voice && !muted) staticBurst(engine.ctx, engine.out);
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
  attach(e) {
    engine = e;
    bindLifecycle();
    pack.prefetch(getAudioSettings().voiceLang);
  },
  detach(ctx) {
    if (engine && (!ctx || engine.ctx === ctx)) {
      comms.reset();
      engine = null;
      pack.trim();
    }
  },
  get onAir() {
    return director.onAir;
  },
};

export default comms;
