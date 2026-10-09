import { useEffect, useRef, useCallback } from "react";

/**
 * useMissionAudio — Web Audio + SpeechSynthesis Apollo-style comms.
 *
 * Exposes:
 *  - init()          initialize AudioContext on first user gesture
 *  - beep()          countdown blip
 *  - squelch()       radio squelch click before speech
 *  - startRumble(intensity)  low-frequency engine rumble loop
 *  - stopRumble()
 *  - speak(text, opts) spoken comms via SpeechSynthesis
 *  - boom()          brief low thump (stage separation, touchdown)
 *  - splash()        soft water hiss (splashdown)
 *
 * Launch cinematic (all synthesized, no samples):
 *  - roarStart({onboard}) / roarSet(level, muffle) / roarStop(fade)
 *        engine roar = low rumble + impulsive crackle; `muffle` 0 is close
 *        and open-air, 1 is distant or onboard (structure-borne, no crackle)
 *  - clank(vol)      hold-down release, metallic
 *  - thud(vol)       separation, felt through the structure
 *  - hiss(dur, vol)  venting / sparklers
 *  - ambienceStart() / ambienceStop()   pad wind and ground equipment
 *  - padStart() / padStop()             restrained music drone for space
 */
export default function useMissionAudio() {
  const ctxRef = useRef(null);
  const rumbleRef = useRef(null); // { gain, source, filter }
  const enabledRef = useRef(false);
  const noiseBufferRef = useRef(null);
  const speechPrimedRef = useRef(false);
  const roarRef = useRef(null);
  const crackleRef = useRef(null);
  const ambRef = useRef(null);
  const padRef = useRef(null);

  const ensureCtx = () => {
    if (!ctxRef.current) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctxRef.current = new AC();
    }
    // "suspended" (autoplay policy) or "interrupted" (iOS call, Siri, app switch).
    if (ctxRef.current.state !== "running" && ctxRef.current.state !== "closed") {
      ctxRef.current.resume().catch(() => {});
    }
    return ctxRef.current;
  };

  const makeNoiseBuffer = (ctx) => {
    if (noiseBufferRef.current) return noiseBufferRef.current;
    const size = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, size, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
    noiseBufferRef.current = buf;
    return buf;
  };

  // Sparse impulsive bursts: the crackle of a large rocket exhaust.
  const makeCrackleBuffer = (ctx) => {
    if (crackleRef.current) return crackleRef.current;
    const size = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, size, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < size; i++) {
      if (Math.random() < 0.0035) {
        const len = 30 + Math.floor(Math.random() * 220);
        const amp = 0.3 + Math.random() * 0.7;
        for (let k = 0; k < len && i + k < size; k++) d[i + k] += (Math.random() * 2 - 1) * amp * Math.exp(-k / (len * 0.35));
      }
    }
    crackleRef.current = buf;
    return buf;
  };

  const init = useCallback(() => {
    enabledRef.current = true;
    ensureCtx();
  }, []);

  const beep = useCallback((freq = 880, duration = 0.08, vol = 0.15) => {
    if (!enabledRef.current) return;
    const ctx = ensureCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }, []);

  const squelch = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = ensureCtx();
    if (!ctx) return;
    const buf = makeNoiseBuffer(ctx);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1400;
    filter.Q.value = 8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.11);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
    src.stop(ctx.currentTime + 0.14);
  }, []);

  const boom = useCallback((vol = 0.4) => {
    if (!enabledRef.current) return;
    const ctx = ensureCtx();
    if (!ctx) return;
    const buf = makeNoiseBuffer(ctx);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 220;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
    src.stop(ctx.currentTime + 0.7);
  }, []);

  const splash = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = ensureCtx();
    if (!ctx) return;
    const buf = makeNoiseBuffer(ctx);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 800;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.8);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
    src.stop(ctx.currentTime + 2);
  }, []);

  const startRumble = useCallback((intensity = 0.5) => {
    if (!enabledRef.current) return;
    const ctx = ensureCtx();
    if (!ctx) return;
    stopRumble();
    const buf = makeNoiseBuffer(ctx);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 180;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(intensity * 0.5, ctx.currentTime + 0.4);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
    rumbleRef.current = { src, gain };
  }, []);

  const setRumble = useCallback((intensity) => {
    if (!rumbleRef.current || !ctxRef.current) return;
    const ctx = ctxRef.current;
    rumbleRef.current.gain.gain.linearRampToValueAtTime(
      Math.max(0, intensity) * 0.5,
      ctx.currentTime + 0.15
    );
  }, []);

  const stopRumble = useCallback(() => {
    if (!rumbleRef.current || !ctxRef.current) return;
    const ctx = ctxRef.current;
    const { src, gain } = rumbleRef.current;
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
    try {
      src.stop(ctx.currentTime + 0.35);
    } catch (e) {}
    rumbleRef.current = null;
  }, []);

  const roarStop = useCallback((fade = 0.4) => {
    const r = roarRef.current;
    if (!r || !ctxRef.current) return;
    const now = ctxRef.current.currentTime;
    r.master.gain.cancelScheduledValues(now);
    r.master.gain.setValueAtTime(r.master.gain.value, now);
    r.master.gain.linearRampToValueAtTime(0, now + fade);
    try {
      r.src.stop(now + fade + 0.05);
      r.crack.stop(now + fade + 0.05);
    } catch (e) {}
    roarRef.current = null;
  }, []);

  const roarStart = useCallback(({ onboard = false } = {}) => {
    if (!enabledRef.current) return;
    const ctx = ensureCtx();
    if (!ctx) return;
    roarStop(0.05);
    const src = ctx.createBufferSource();
    src.buffer = makeNoiseBuffer(ctx);
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = onboard ? 140 : 600;
    const low = ctx.createGain();
    low.gain.value = 0;
    const crack = ctx.createBufferSource();
    crack.buffer = makeCrackleBuffer(ctx);
    crack.loop = true;
    crack.playbackRate.value = 0.85 + Math.random() * 0.3;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 650;
    const cg = ctx.createGain();
    cg.gain.value = 0;
    const master = ctx.createGain();
    master.gain.value = 1;
    src.connect(lp).connect(low).connect(master);
    crack.connect(hp).connect(cg).connect(master);
    master.connect(ctx.destination);
    src.start();
    crack.start();
    roarRef.current = { src, crack, lp, low, cg, master };
  }, [roarStop]);

  const roarSet = useCallback((level, muffle = 0) => {
    const r = roarRef.current;
    const ctx = ctxRef.current;
    if (!r || !ctx) return;
    const now = ctx.currentTime;
    const m = Math.min(1, Math.max(0, muffle));
    r.lp.frequency.setTargetAtTime(140 * Math.pow(2400 / 140, 1 - m), now, 0.15);
    r.low.gain.setTargetAtTime(Math.max(0, level) * 0.6, now, 0.15);
    r.cg.gain.setTargetAtTime(Math.max(0, level) * (1 - m) * (1 - m) * 0.32, now, 0.15);
  }, []);

  const clank = useCallback((vol = 0.5) => {
    if (!enabledRef.current) return;
    const ctx = ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    [210, 517, 1190].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "triangle";
      o.frequency.value = f;
      g.gain.setValueAtTime(vol * (0.5 / (i + 1)), now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5 - i * 0.12);
      o.connect(g).connect(ctx.destination);
      o.start(now);
      o.stop(now + 0.6);
    });
    const src = ctx.createBufferSource();
    src.buffer = makeNoiseBuffer(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2400;
    bp.Q.value = 2.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * 0.6, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.2);
  }, []);

  const thud = useCallback((vol = 0.4) => {
    if (!enabledRef.current) return;
    const ctx = ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(70, now);
    o.frequency.exponentialRampToValueAtTime(38, now + 0.5);
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    o.connect(g).connect(ctx.destination);
    o.start(now);
    o.stop(now + 0.75);
  }, []);

  const hiss = useCallback((dur = 1, vol = 0.15) => {
    if (!enabledRef.current) return;
    const ctx = ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = makeNoiseBuffer(ctx);
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.12);
    g.gain.setValueAtTime(vol, now + dur);
    g.gain.linearRampToValueAtTime(0, now + dur + 0.4);
    src.connect(hp).connect(g).connect(ctx.destination);
    src.start(now);
    src.stop(now + dur + 0.5);
  }, []);

  const ambienceStop = useCallback((fade = 2) => {
    const a = ambRef.current;
    if (!a || !ctxRef.current) return;
    const now = ctxRef.current.currentTime;
    a.g.gain.setTargetAtTime(0, now, fade / 3);
    try {
      a.nodes.forEach((n) => n.stop(now + fade + 0.2));
    } catch (e) {}
    ambRef.current = null;
  }, []);

  const ambienceStart = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = ensureCtx();
    if (!ctx) return;
    ambienceStop(0.1);
    const now = ctx.currentTime;
    const wind = ctx.createBufferSource();
    wind.buffer = makeNoiseBuffer(ctx);
    wind.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 380;
    const hum = ctx.createOscillator();
    hum.frequency.value = 60;
    const hg = ctx.createGain();
    hg.gain.value = 0.15;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lg = ctx.createGain();
    lg.gain.value = 0.02;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.05, now + 2);
    lfo.connect(lg).connect(g.gain);
    wind.connect(lp).connect(g);
    hum.connect(hg).connect(g);
    g.connect(ctx.destination);
    wind.start();
    hum.start();
    lfo.start();
    ambRef.current = { g, nodes: [wind, hum, lfo] };
  }, [ambienceStop]);

  const padStop = useCallback((fade = 3) => {
    const p = padRef.current;
    if (!p || !ctxRef.current) return;
    const now = ctxRef.current.currentTime;
    p.g.gain.cancelScheduledValues(now);
    p.g.gain.setValueAtTime(p.g.gain.value, now);
    p.g.gain.linearRampToValueAtTime(0, now + fade);
    try {
      p.nodes.forEach((n) => n.stop(now + fade + 0.1));
    } catch (e) {}
    padRef.current = null;
  }, []);

  const padStart = useCallback(() => {
    if (!enabledRef.current || padRef.current) return;
    const ctx = ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.045, now + 6);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    lp.connect(g).connect(ctx.destination);
    const nodes = [];
    [110, 164.81, 220.5, 329.2].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? "triangle" : "sine";
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = 0.22 / (1 + i * 0.4);
      const l = ctx.createOscillator();
      l.frequency.value = 0.05 + i * 0.031;
      const lg = ctx.createGain();
      lg.gain.value = og.gain.value * 0.5;
      l.connect(lg).connect(og.gain);
      o.connect(og).connect(lp);
      o.start();
      l.start();
      nodes.push(o, l);
    });
    padRef.current = { g, nodes };
  }, []);

  const speak = useCallback((text, { rate = 0.95, pitch = 0.9, voice } = {}) => {
    if (!enabledRef.current || !window.speechSynthesis) return;
    // Cancel any current speech to keep comms clean
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = rate;
    utter.pitch = pitch;
    utter.volume = 0.9;
    const voices = window.speechSynthesis.getVoices();
    if (voice) {
      const v = voices.find((x) => x.name.includes(voice));
      if (v) utter.voice = v;
    } else {
      // Prefer a US English male voice for that Houston vibe
      const preferred =
        voices.find((v) => /en-US.*(Male|David|Google|Aaron)/i.test(v.name + " " + v.lang)) ||
        voices.find((v) => v.lang === "en-US");
      if (preferred) utter.voice = preferred;
    }
    window.speechSynthesis.speak(utter);
  }, []);

  const comms = useCallback(
    (text, delay = 0) => {
      setTimeout(() => {
        squelch();
        setTimeout(() => speak(text), 130);
      }, delay);
    },
    [squelch, speak]
  );

  /*
   * iOS / WebKit only lets audio start inside a user gesture, but the engine
   * rumble and comms are fired later from timers (e.g. after the countdown).
   * So the first tap or key press anywhere unlocks the AudioContext and primes
   * speech synthesis; sounds still stay silent until init() enables them.
   */
  useEffect(() => {
    try {
      // Play mission audio even when the iPhone's silent switch is on (iOS 17+).
      if (navigator.audioSession) navigator.audioSession.type = "playback";
    } catch (e) {}
    const events = ["touchend", "click", "keydown"];
    const unlock = () => {
      const ctx = ensureCtx();
      if (ctx) {
        const src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, 22050);
        src.connect(ctx.destination);
        src.start(0);
      }
      if (window.speechSynthesis && !speechPrimedRef.current) {
        speechPrimedRef.current = true;
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        window.speechSynthesis.speak(u);
      }
      if (ctx && ctx.state === "running") events.forEach((ev) => window.removeEventListener(ev, unlock, true));
    };
    events.forEach((ev) => window.addEventListener(ev, unlock, true));
    // Returning to the app after a call or app switch: resume the context.
    const onVisible = () => {
      if (document.visibilityState === "visible" && ctxRef.current && ctxRef.current.state !== "running" && ctxRef.current.state !== "closed") {
        ctxRef.current.resume().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, unlock, true));
      document.removeEventListener("visibilitychange", onVisible);
      try {
        stopRumble();
        roarStop(0.05);
        ambienceStop(0.05);
        padStop(0.05);
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        if (ctxRef.current) ctxRef.current.close();
      } catch (e) {}
      ctxRef.current = null;
      noiseBufferRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopRumble, roarStop, ambienceStop, padStop]);

  return {
    init,
    beep,
    squelch,
    boom,
    splash,
    startRumble,
    stopRumble,
    setRumble,
    speak,
    comms,
    roarStart,
    roarSet,
    roarStop,
    clank,
    thud,
    hiss,
    ambienceStart,
    ambienceStop,
    padStart,
    padStop,
  };
}
