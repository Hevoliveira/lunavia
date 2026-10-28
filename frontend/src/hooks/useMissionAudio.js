import { useEffect, useRef, useCallback } from "react";
import comms from "@/audio/comms";
import { getAudioSettings, subscribeAudioSettings } from "@/audio/audioSettings";

/**
 * useMissionAudio — mission sound effects (Web Audio) and the
 * mission-control voice (src/audio/comms: bundled neural voice clips through
 * a live radio chain, scheduled by priority).
 *
 * Mix: every effect goes to an SFX bus (SFX VOLUME), voices to a voice bus
 * (VOICE VOLUME). While someone is speaking the SFX bus is ducked by a few dB,
 * never silenced.
 *
 * Exposes:
 *  - init()          initialize AudioContext on first user gesture
 *  - say(id, opts)   mission-control call from src/audio/commsLines.json
 *  - commsFlush() / commsReset()   drop pending calls (abort, retry)
 *  - setBlackout(on) / setEarthLink(on) / setRadioLink(q) / setVerbosity(level)
 *  - beep()          countdown blip
 *  - squelch()       radio squelch click
 *  - startRumble(intensity)  low-frequency engine rumble loop
 *  - stopRumble()
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
  const recRef = useRef(null); // OCEAN RECOVERY: { g, sea, rotor, nodes }
  const preRef = useRef(null); // COUNTDOWN TO LAUNCH: the current place's bed { kind, g, nodes }
  const busRef = useRef(null); // { sfx, duck, voice }
  const relockRef = useRef(null);

  const ensureCtx = () => {
    if (!ctxRef.current) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      const ctx = new AC();
      ctxRef.current = ctx;
      const st = getAudioSettings();
      const sfx = ctx.createGain();
      sfx.gain.value = st.sfxVolume;
      const duck = ctx.createGain();
      const voice = ctx.createGain();
      voice.gain.value = st.voiceVolume;
      sfx.connect(duck).connect(ctx.destination);
      voice.connect(ctx.destination);
      busRef.current = { sfx, duck, voice };
      comms.attach({
        ctx,
        out: voice,
        duck(on, depth = 0.6) {
          const now = ctx.currentTime;
          duck.gain.cancelScheduledValues(now);
          duck.gain.setValueAtTime(duck.gain.value, now);
          if (on) duck.gain.setTargetAtTime(depth, now, 0.04);
          else duck.gain.setTargetAtTime(1, now + 0.15, 0.25);
        },
      });
      // A phone call, Siri or an alarm interrupts the session; WebKit may need
      // a fresh tap before it plays again, so listen for one.
      ctx.onstatechange = () => {
        if (ctx.state !== "running" && ctx.state !== "closed" && relockRef.current) relockRef.current();
      };
    }
    // "suspended" (autoplay policy) or "interrupted" (iOS call, Siri, app switch).
    if (ctxRef.current.state !== "running" && ctxRef.current.state !== "closed") {
      ctxRef.current.resume().catch(() => {});
    }
    return ctxRef.current;
  };

  const sfxOut = (ctx) => (busRef.current ? busRef.current.sfx : ctx.destination);

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
    osc.connect(gain).connect(sfxOut(ctx));
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
    src.connect(filter).connect(gain).connect(sfxOut(ctx));
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
    src.connect(filter).connect(gain).connect(sfxOut(ctx));
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
    src.connect(filter).connect(gain).connect(sfxOut(ctx));
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
    src.connect(filter).connect(gain).connect(sfxOut(ctx));
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
      r.subs.forEach((o) => o.stop(now + fade + 0.05));
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
    // Sub-bass: the chest-deep rumble felt more than heard, slowly beating.
    const sub = ctx.createGain();
    sub.gain.value = 0;
    const subs = [31, 43.5].map((f) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      o.connect(sub);
      o.start();
      return o;
    });
    src.connect(lp).connect(low).connect(master);
    crack.connect(hp).connect(cg).connect(master);
    sub.connect(master);
    master.connect(sfxOut(ctx));
    src.start();
    crack.start();
    roarRef.current = { src, crack, lp, low, cg, sub, subs, master };
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
    r.sub.gain.setTargetAtTime(Math.max(0, level) * (1 - 0.5 * m) * 0.22, now, 0.25);
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
      o.connect(g).connect(sfxOut(ctx));
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
    src.connect(bp).connect(g).connect(sfxOut(ctx));
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
    o.connect(g).connect(sfxOut(ctx));
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
    src.connect(hp).connect(g).connect(sfxOut(ctx));
    src.start(now);
    src.stop(now + dur + 0.5);
  }, []);

  // CONTACT LIGHT: a probe reaches the surface. A panel relay click and a
  // soft annunciator tone, quiet enough to sit under the crew's call.
  const contactLight = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = makeNoiseBuffer(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 3200;
    bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.22, now + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
    src.connect(bp).connect(g).connect(sfxOut(ctx));
    src.start(now);
    src.stop(now + 0.05);
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 1320;
    og.gain.setValueAtTime(0.0001, now + 0.04);
    og.gain.linearRampToValueAtTime(0.06, now + 0.05);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    o.connect(og).connect(sfxOut(ctx));
    o.start(now + 0.04);
    o.stop(now + 0.18);
  }, []);

  // ENGINE STOP at touchdown: the descent engine's rumble ends at once (no
  // slow fade), with the thunk of the valves closing and a short pressure bleed.
  const engineStop = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (rumbleRef.current) {
      const { src, gain } = rumbleRef.current;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.06);
      try {
        src.stop(now + 0.08);
      } catch (e) {}
      rumbleRef.current = null;
    }
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(110, now + 0.03);
    o.frequency.exponentialRampToValueAtTime(52, now + 0.22);
    g.gain.setValueAtTime(0.0001, now + 0.03);
    g.gain.linearRampToValueAtTime(0.26, now + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
    o.connect(g).connect(sfxOut(ctx));
    o.start(now + 0.03);
    o.stop(now + 0.3);
    const n = ctx.createBufferSource();
    n.buffer = makeNoiseBuffer(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1800;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, now + 0.05);
    ng.gain.linearRampToValueAtTime(0.05, now + 0.08);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    n.connect(hp).connect(ng).connect(sfxOut(ctx));
    n.start(now + 0.05);
    n.stop(now + 0.5);
  }, []);

  // Touchdown on the footpads: a structural thud sized by how hard it was
  // (impact 0..1 of the safe limit) and a light creak of the struts.
  const touchdown = useCallback((impact = 0.5) => {
    if (!enabledRef.current) return;
    const ctx = ensureCtx();
    if (!ctx) return;
    const k = Math.min(1, Math.max(0, impact));
    const now = ctx.currentTime + 0.06;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(64, now);
    o.frequency.exponentialRampToValueAtTime(34, now + 0.45);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.16 + 0.3 * k, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    o.connect(g).connect(sfxOut(ctx));
    o.start(now);
    o.stop(now + 0.65);
    const c = ctx.createOscillator();
    const cg = ctx.createGain();
    c.type = "triangle";
    c.frequency.setValueAtTime(340, now + 0.05);
    c.frequency.linearRampToValueAtTime(300, now + 0.35);
    cg.gain.setValueAtTime(0.0001, now + 0.05);
    cg.gain.linearRampToValueAtTime(0.03 + 0.06 * k, now + 0.07);
    cg.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
    c.connect(cg).connect(sfxOut(ctx));
    c.start(now + 0.05);
    c.stop(now + 0.4);
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
    g.connect(sfxOut(ctx));
    wind.start();
    hum.start();
    lfo.start();
    ambRef.current = { g, nodes: [wind, hum, lfo] };
  }, [ambienceStop]);

  /*
   * OCEAN RECOVERY's sound (procedural, no recordings): the sea washing round the capsule, and the
   * helicopter's rotor: a low thud of the five blades (about 17 slaps a second) over a filtered
   * turbine whine. recoverySet({ rotor 0..1, sea 0..1 }) follows the helicopter's distance.
   */
  const recoveryStop = useCallback((fade = 1.2) => {
    const r = recRef.current;
    if (!r || !ctxRef.current) return;
    const now = ctxRef.current.currentTime;
    r.g.gain.cancelScheduledValues(now);
    r.g.gain.setValueAtTime(r.g.gain.value, now);
    r.g.gain.linearRampToValueAtTime(0, now + fade);
    try {
      r.nodes.forEach((n) => n.stop(now + fade + 0.1));
    } catch (e) {}
    recRef.current = null;
  }, []);
  const recoveryStart = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = ensureCtx();
    if (!ctx) return;
    recoveryStop(0.05);
    const now = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(1, now + 2);
    g.connect(sfxOut(ctx));
    // the sea: broadband noise, low-passed, slowly swelling
    const seaSrc = ctx.createBufferSource();
    seaSrc.buffer = makeNoiseBuffer(ctx);
    seaSrc.loop = true;
    const seaLp = ctx.createBiquadFilter();
    seaLp.type = "lowpass";
    seaLp.frequency.value = 520;
    const sea = ctx.createGain();
    sea.gain.value = 0.05;
    const swell = ctx.createOscillator();
    swell.frequency.value = 0.11;
    const swellG = ctx.createGain();
    swellG.gain.value = 0.025;
    swell.connect(swellG).connect(sea.gain);
    seaSrc.connect(seaLp).connect(sea).connect(g);
    // the rotor: band-passed noise chopped at the blade rate, and the turbines' whine
    const rSrc = ctx.createBufferSource();
    rSrc.buffer = makeNoiseBuffer(ctx);
    rSrc.loop = true;
    const rBp = ctx.createBiquadFilter();
    rBp.type = "lowpass";
    rBp.frequency.value = 260;
    const chop = ctx.createGain();
    chop.gain.value = 0.5;
    const blade = ctx.createOscillator();
    blade.type = "square";
    blade.frequency.value = 17;
    const bladeG = ctx.createGain();
    bladeG.gain.value = 0.5;
    blade.connect(bladeG).connect(chop.gain);
    const whine = ctx.createOscillator();
    whine.type = "sawtooth";
    whine.frequency.value = 1180;
    const whineLp = ctx.createBiquadFilter();
    whineLp.type = "bandpass";
    whineLp.frequency.value = 1180;
    whineLp.Q.value = 6;
    const whineG = ctx.createGain();
    whineG.gain.value = 0.012;
    const rotor = ctx.createGain();
    rotor.gain.value = 0;
    rSrc.connect(rBp).connect(chop).connect(rotor);
    whine.connect(whineLp).connect(whineG).connect(rotor);
    rotor.connect(g);
    [seaSrc, swell, rSrc, blade, whine].forEach((n) => n.start());
    recRef.current = { g, sea, rotor, nodes: [seaSrc, swell, rSrc, blade, whine] };
  }, [recoveryStop]);
  const recoverySet = useCallback(({ rotor = null, sea = null } = {}) => {
    const r = recRef.current;
    if (!r || !ctxRef.current) return;
    const now = ctxRef.current.currentTime;
    if (rotor != null) r.rotor.gain.setTargetAtTime(Math.max(0, Math.min(1, rotor)) * 0.5, now, 0.25);
    if (sea != null) r.sea.gain.setTargetAtTime(Math.max(0, Math.min(1, sea)) * 0.06, now, 0.5);
  }, []);

  /*
   * OCEAN RECOVERY's equipment, one-shots on the recovery's own bus (they go with it): "splash" a
   * swimmer entering the water, "inflate" the collar's hiss, "hatch" the latch's clank and thump,
   * "winch" the hoist's motor (dur s). Procedural, no recordings.
   */
  const recoveryCue = useCallback((kind, dur = 3) => {
    const r = recRef.current;
    const ctx = ctxRef.current;
    if (!r || !ctx) return;
    const now = ctx.currentTime;
    const noise = (len, type, freq, q, peak, attack, out = r.g) => {
      const src = ctx.createBufferSource();
      src.buffer = makeNoiseBuffer(ctx);
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(peak, now + attack);
      g.gain.exponentialRampToValueAtTime(0.0005, now + len);
      src.connect(f).connect(g).connect(out);
      src.start(now);
      src.stop(now + len + 0.05);
      return { f, g };
    };
    if (kind === "splash") {
      noise(0.9, "lowpass", 900, 0.7, 0.16, 0.02);
    } else if (kind === "inflate") {
      const { f } = noise(dur, "highpass", 2400, 0.8, 0.05, 0.4);
      f.frequency.linearRampToValueAtTime(3600, now + dur);
    } else if (kind === "hatch") {
      // two latch clicks, then the door's low thump as it swings free
      [0, 0.18].forEach((d) => {
        const src = ctx.createBufferSource();
        src.buffer = makeNoiseBuffer(ctx);
        const f = ctx.createBiquadFilter();
        f.type = "bandpass";
        f.frequency.value = 2300;
        f.Q.value = 4;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0005, now + d);
        g.gain.linearRampToValueAtTime(0.18, now + d + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0005, now + d + 0.09);
        src.connect(f).connect(g).connect(r.g);
        src.start(now + d);
        src.stop(now + d + 0.12);
      });
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(95, now + 0.45);
      o.frequency.exponentialRampToValueAtTime(55, now + 0.9);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0005, now + 0.45);
      og.gain.linearRampToValueAtTime(0.2, now + 0.47);
      og.gain.exponentialRampToValueAtTime(0.0005, now + 1.0);
      o.connect(og).connect(r.g);
      o.start(now + 0.45);
      o.stop(now + 1.05);
    } else if (kind === "winch") {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(210, now);
      o.frequency.linearRampToValueAtTime(260, now + Math.min(0.6, dur / 2));
      o.frequency.setValueAtTime(260, now + Math.max(0.6, dur - 0.5));
      o.frequency.linearRampToValueAtTime(190, now + dur);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 700;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.03, now + 0.3);
      g.gain.setValueAtTime(0.03, now + Math.max(0.3, dur - 0.4));
      g.gain.linearRampToValueAtTime(0, now + dur);
      o.connect(lp).connect(g).connect(r.g);
      o.start(now);
      o.stop(now + dur + 0.05);
    }
  }, []);

  /*
   * COUNTDOWN TO LAUNCH's sound (procedural, no recordings). prelaunchBed(kind) crossfades to the
   * place's bed: "room" (the suit room's air handling), "pad" (wind and the vehicle's venting),
   * "arm" (the wind 90 m up, the arm's creaks), "cabin" (the cabin's fans and the suit loops).
   * prelaunchCue(kind, dur) plays a one-shot on it: "step" (a boot on the arm's steel floor),
   * "elevator" (the car's motor for dur s), "helmet" (the neck ring's lock and the oxygen's hiss),
   * "switch", "hatch" (the latch's clank and the door's thump). prelaunchStop() fades all out.
   */
  const prelaunchStop = useCallback((fade = 1.0) => {
    const r = preRef.current;
    if (!r || !ctxRef.current) return;
    const now = ctxRef.current.currentTime;
    r.g.gain.cancelScheduledValues(now);
    r.g.gain.setValueAtTime(r.g.gain.value, now);
    r.g.gain.linearRampToValueAtTime(0, now + fade);
    try {
      r.nodes.forEach((n) => n.stop(now + fade + 0.1));
    } catch (e) {}
    preRef.current = null;
  }, []);
  const prelaunchBed = useCallback(
    (kind) => {
      if (!enabledRef.current) return;
      const ctx = ensureCtx();
      if (!ctx) return;
      if (preRef.current && preRef.current.kind === kind) return;
      prelaunchStop(1.2);
      const now = ctx.currentTime;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(1, now + 1.5);
      g.connect(sfxOut(ctx));
      const nodes = [];
      const noise = (type, freq, q, level) => {
        const src = ctx.createBufferSource();
        src.buffer = makeNoiseBuffer(ctx);
        src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        f.Q.value = q;
        const lv = ctx.createGain();
        lv.gain.value = level;
        src.connect(f).connect(lv).connect(g);
        src.start();
        nodes.push(src);
        return lv;
      };
      const tone = (freq, level, type = "sine") => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = freq;
        const lv = ctx.createGain();
        lv.gain.value = level;
        o.connect(lv).connect(g);
        o.start();
        nodes.push(o);
        return lv;
      };
      const lfo = (target, rate, depth) => {
        const o = ctx.createOscillator();
        o.frequency.value = rate;
        const d = ctx.createGain();
        d.gain.value = depth;
        o.connect(d).connect(target.gain);
        o.start();
        nodes.push(o);
      };
      if (kind === "room") {
        noise("lowpass", 260, 0.7, 0.05);
        tone(60, 0.008);
        tone(120, 0.004);
      } else if (kind === "pad") {
        lfo(noise("lowpass", 380, 0.6, 0.05), 0.13, 0.03);
        lfo(noise("bandpass", 2600, 1.4, 0.012), 0.31, 0.008); // the venting
        tone(48, 0.006, "triangle");
      } else if (kind === "arm") {
        lfo(noise("lowpass", 520, 0.6, 0.075), 0.17, 0.05);
        lfo(noise("bandpass", 1500, 3, 0.01), 0.07, 0.008);
      } else if (kind === "cabin") {
        noise("bandpass", 900, 0.8, 0.025);
        noise("lowpass", 180, 0.7, 0.03);
        tone(400, 0.0025);
      }
      preRef.current = { kind, g, nodes };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prelaunchStop]
  );
  const prelaunchCue = useCallback((kind, dur = 3) => {
    const r = preRef.current;
    const ctx = ctxRef.current;
    if (!r || !ctx) return;
    const now = ctx.currentTime;
    const burst = (at, len, type, freq, q, peak) => {
      const src = ctx.createBufferSource();
      src.buffer = makeNoiseBuffer(ctx);
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0005, now + at);
      g.gain.linearRampToValueAtTime(peak, now + at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0005, now + at + len);
      src.connect(f).connect(g).connect(r.g);
      src.start(now + at);
      src.stop(now + at + len + 0.05);
    };
    const thump = (at, f0, f1, len, peak) => {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(f0, now + at);
      o.frequency.exponentialRampToValueAtTime(f1, now + at + len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0005, now + at);
      g.gain.linearRampToValueAtTime(peak, now + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0005, now + at + len);
      o.connect(g).connect(r.g);
      o.start(now + at);
      o.stop(now + at + len + 0.05);
    };
    if (kind === "step") {
      thump(0, 90, 55, 0.16, 0.09);
      burst(0.005, 0.07, "bandpass", 1900, 2.5, 0.05);
    } else if (kind === "switch") {
      burst(0, 0.03, "bandpass", 3200, 4, 0.12);
    } else if (kind === "helmet") {
      burst(0, 0.05, "bandpass", 2400, 4, 0.14);
      burst(0.12, 0.05, "bandpass", 2100, 4, 0.12);
      burst(0.25, 1.4, "highpass", 3000, 0.7, 0.03);
    } else if (kind === "hatch") {
      thump(0, 110, 50, 0.5, 0.2);
      burst(0.4, 0.06, "bandpass", 2200, 4, 0.16);
      burst(0.62, 0.06, "bandpass", 2000, 4, 0.16);
      thump(0.9, 70, 45, 0.35, 0.12);
    } else if (kind === "elevator") {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(70, now);
      o.frequency.linearRampToValueAtTime(95, now + 1.2);
      o.frequency.setValueAtTime(95, now + Math.max(1.2, dur - 1.2));
      o.frequency.linearRampToValueAtTime(65, now + dur);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 320;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.05, now + 0.8);
      g.gain.setValueAtTime(0.05, now + Math.max(0.8, dur - 0.8));
      g.gain.linearRampToValueAtTime(0, now + dur);
      o.connect(lp).connect(g).connect(r.g);
      o.start(now);
      o.stop(now + dur + 0.05);
      thump(dur - 0.3, 80, 50, 0.4, 0.08); // the car settling at the landing
    }
  }, []);

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
    lp.connect(g).connect(sfxOut(ctx));
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

  const say = useCallback((id, opts) => comms.say(id, opts), []);
  const commsFlush = useCallback(() => comms.flush(), []);
  const commsReset = useCallback(() => comms.reset(), []);
  const setBlackout = useCallback((on) => comms.setBlackout(on), []);
  const setEarthLink = useCallback((on) => comms.setEarthLink(on), []);
  const setRadioLink = useCallback((q) => comms.setLink(q), []);
  const setVerbosity = useCallback((v) => comms.setVerbosity(v), []);

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
    const listen = () => events.forEach((ev) => window.addEventListener(ev, unlock, true));
    relockRef.current = listen;
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
    listen();
    const offSettings = subscribeAudioSettings((st) => {
      const b = busRef.current;
      const ctx = ctxRef.current;
      if (!b || !ctx) return;
      b.sfx.gain.setTargetAtTime(st.sfxVolume, ctx.currentTime, 0.05);
      b.voice.gain.setTargetAtTime(st.voiceVolume, ctx.currentTime, 0.05);
    });
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
      offSettings();
      relockRef.current = null;
      try {
        comms.detach(ctxRef.current);
        stopRumble();
        roarStop(0.05);
        ambienceStop(0.05);
        padStop(0.05);
        recoveryStop(0.05);
        prelaunchStop(0.05);
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        if (ctxRef.current) {
          ctxRef.current.onstatechange = null;
          ctxRef.current.close();
        }
      } catch (e) {}
      ctxRef.current = null;
      busRef.current = null;
      noiseBufferRef.current = null;
      crackleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopRumble, roarStop, ambienceStop, padStop, recoveryStop, prelaunchStop]);

  return {
    init,
    beep,
    squelch,
    boom,
    splash,
    startRumble,
    stopRumble,
    setRumble,
    say,
    commsFlush,
    commsReset,
    setBlackout,
    setEarthLink,
    setRadioLink,
    setVerbosity,
    roarStart,
    roarSet,
    roarStop,
    clank,
    thud,
    hiss,
    contactLight,
    engineStop,
    touchdown,
    ambienceStart,
    ambienceStop,
    padStart,
    padStop,
    recoveryStart,
    recoverySet,
    recoveryCue,
    prelaunchBed,
    prelaunchCue,
    prelaunchStop,
    recoveryStop,
  };
}
