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
 */
export default function useMissionAudio() {
  const ctxRef = useRef(null);
  const rumbleRef = useRef(null); // { gain, source, filter }
  const enabledRef = useRef(false);
  const noiseBufferRef = useRef(null);

  const ensureCtx = () => {
    if (!ctxRef.current) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctxRef.current = new AC();
    }
    if (ctxRef.current.state === "suspended") {
      ctxRef.current.resume();
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

  useEffect(() => {
    return () => {
      try {
        stopRumble();
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        if (ctxRef.current) ctxRef.current.close();
      } catch (e) {}
    };
  }, [stopRumble]);

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
  };
}
