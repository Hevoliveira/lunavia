/*
 * LUNAVIA — radio transmission player (Web Audio).
 *
 * Plays one dry voice clip through a restrained radio chain built for that
 * transmission and torn down afterwards:
 *
 *   space    air-to-ground loop (CAPCOM, crew): 300–3100 Hz, light drive,
 *            compression, a low static bed; routine CAPCOM calls carry the
 *            Apollo Quindar tones (2525 Hz in, 2475 Hz out), urgent ones
 *            only a squelch click.
 *   ground   flight-control loops (FLIGHT, GUIDANCE): wider and cleaner.
 *   onboard  the spacecraft's own computer voice: speaker-like, no static,
 *            a soft two-note attention chime.
 *
 * Critical calls get less drive and static so they stay intelligible. `link`
 * (0..1) degrades the air-to-ground path as the entry plasma builds: more
 * static, a narrower band and brief dropouts. With radio effects off the voice
 * is played clean with only gentle levelling.
 */
const PROFILES = {
  space: { hp: 300, lp: 3100, peak: [1700, 4], drive: 1.8, noise: 0.011, comp: [-26, 5], intro: "click" },
  ground: { hp: 220, lp: 3900, peak: [2000, 2.5], drive: 1.0, noise: 0.004, comp: [-24, 3.5], intro: "click" },
  onboard: { hp: 160, lp: 7000, peak: [2600, 1.5], drive: 0, noise: 0, comp: [-22, 2.5], intro: "chime" },
};

let noiseBuf = null;
function noise(ctx) {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const n = ctx.sampleRate * 2;
  noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

const curves = new Map();
function driveCurve(k) {
  const key = Math.round(k * 10);
  if (!curves.has(key)) {
    const n = 1024;
    const c = new Float32Array(n);
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(k * x) / norm;
    }
    curves.set(key, c);
  }
  return curves.get(key);
}

function tone(ctx, out, freq, t, dur, vol) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.008);
  g.gain.setValueAtTime(vol, t + dur - 0.02);
  g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
  return [o, g];
}

function click(ctx, out, t, vol, { freq = 1400, q = 6, dur = 0.09 } = {}) {
  const s = ctx.createBufferSource();
  s.buffer = noise(ctx);
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(out);
  s.start(t, Math.random());
  s.stop(t + dur + 0.02);
  return [s, f, g];
}

/** A burst of static as the link drops (loss of signal at blackout). */
export function staticBurst(ctx, out, dur = 0.9, vol = 0.05) {
  const t = ctx.currentTime + 0.01;
  const s = ctx.createBufferSource();
  s.buffer = noise(ctx);
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = 1900;
  f.Q.value = 0.6;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.03);
  g.gain.setTargetAtTime(0.0001, t + 0.12, dur / 4);
  s.connect(f).connect(g).connect(out);
  s.start(t, Math.random());
  s.stop(t + dur + 0.1);
  setTimeout(() => [s, f, g].forEach((n) => n.disconnect()), (dur + 0.4) * 1000);
}

/**
 * opts: { buffer, profile: "space"|"ground"|"onboard", critical, fx, link,
 *         keyed (mic already open: no intro), quindar, gain, onStart, onEnd }
 * Returns { stop(reason), setLink(q) }.
 */
export function playTransmission(ctx, out, opts) {
  const P = PROFILES[opts.profile] || PROFILES.space;
  const fx = opts.fx !== false;
  const link = Math.min(1, Math.max(0, opts.link ?? 1));
  const crit = !!opts.critical;
  const nodes = [];
  const add = (...n) => (nodes.push(...n), n[0]);
  const t0 = ctx.currentTime + 0.03;

  // Intro: quindar tone, squelch click or onboard chime
  let intro = 0;
  if (fx && !opts.keyed) {
    if (opts.quindar) {
      nodes.push(...tone(ctx, out, 2525, t0, 0.25, 0.045));
      intro = 0.33;
    } else if (P.intro === "click") {
      nodes.push(...click(ctx, out, t0, 0.16));
      intro = 0.11;
    } else if (P.intro === "chime") {
      nodes.push(...tone(ctx, out, 1046.5, t0, 0.09, 0.05), ...tone(ctx, out, 784, t0 + 0.1, 0.12, 0.05));
      intro = 0.27;
    }
  }
  const vStart = t0 + intro;
  const vEnd = vStart + opts.buffer.duration;

  const src = add(ctx.createBufferSource());
  src.buffer = opts.buffer;
  const vGain = add(ctx.createGain());
  vGain.gain.value = opts.gain ?? 1;
  let chainIn = vGain;
  src.connect(vGain);

  let noiseGain = null;
  if (fx) {
    const hp = add(ctx.createBiquadFilter());
    hp.type = "highpass";
    hp.frequency.value = P.hp;
    hp.Q.value = 0.7;
    const lp = add(ctx.createBiquadFilter());
    lp.type = "lowpass";
    lp.frequency.value = P.lp * (0.72 + 0.28 * link);
    lp.Q.value = 0.8;
    const pk = add(ctx.createBiquadFilter());
    pk.type = "peaking";
    pk.frequency.value = P.peak[0];
    pk.gain.value = P.peak[1];
    pk.Q.value = 1;
    chainIn.connect(hp);
    hp.connect(lp).connect(pk);
    let last = pk;
    const drive = P.drive * (crit ? 0.5 : 1);
    if (drive > 0) {
      const sh = add(ctx.createWaveShaper());
      sh.curve = driveCurve(1 + drive);
      sh.oversample = "2x";
      last.connect(sh);
      last = sh;
    }
    const comp = add(ctx.createDynamicsCompressor());
    comp.threshold.value = P.comp[0];
    comp.ratio.value = P.comp[1];
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    comp.knee.value = 6;
    // Level-matched to the clean path, so RADIO EFFECTS on/off does not jump in loudness.
    const makeup = add(ctx.createGain());
    makeup.gain.value = 0.95;
    last.connect(comp).connect(makeup).connect(out);

    // Static bed under the transmission, and dropouts on a weak link
    const nl = P.noise * (crit ? 0.45 : 1) * (1 + 5 * (1 - link));
    if (nl > 0) {
      const ns = add(ctx.createBufferSource());
      ns.buffer = noise(ctx);
      ns.loop = true;
      const nf = add(ctx.createBiquadFilter());
      nf.type = "bandpass";
      nf.frequency.value = 1800;
      nf.Q.value = 0.5;
      noiseGain = add(ctx.createGain());
      noiseGain.gain.setValueAtTime(0, t0);
      noiseGain.gain.linearRampToValueAtTime(nl, t0 + 0.03);
      noiseGain.gain.setValueAtTime(nl, vEnd);
      noiseGain.gain.linearRampToValueAtTime(0, vEnd + 0.08);
      ns.connect(nf).connect(noiseGain).connect(out);
      ns.start(t0, Math.random());
      ns.stop(vEnd + 0.4);
    }
    if (link < 0.8 && opts.profile !== "onboard") {
      const n = Math.round(opts.buffer.duration * (1 - link) * 5);
      for (let i = 0; i < n; i++) {
        const at = vStart + Math.random() * opts.buffer.duration;
        const len = 0.05 + Math.random() * 0.09;
        const floor = (opts.gain ?? 1) * (0.15 + 0.5 * link);
        vGain.gain.setValueAtTime(opts.gain ?? 1, at);
        vGain.gain.linearRampToValueAtTime(floor, at + 0.01);
        vGain.gain.setValueAtTime(floor, at + len);
        vGain.gain.linearRampToValueAtTime(opts.gain ?? 1, at + len + 0.01);
      }
    }
  } else {
    // Clean: gentle levelling only
    const comp = add(ctx.createDynamicsCompressor());
    comp.threshold.value = -20;
    comp.ratio.value = 2;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    const lift = add(ctx.createGain());
    lift.gain.value = 1.35;
    chainIn.connect(comp).connect(lift).connect(out);
  }
  src.start(vStart);

  // Outro: quindar out-tone, or the squelch tail as the mic is released
  let tail = 0.05;
  if (fx && P.intro === "click" && !opts.quindar) {
    nodes.push(...click(ctx, out, vEnd + 0.02, 0.07, { freq: 2300, q: 2, dur: 0.07 }));
    tail = 0.11;
  } else if (fx && opts.quindar) {
    nodes.push(...tone(ctx, out, 2475, vEnd + 0.08, 0.25, 0.045));
    tail = 0.35;
  }

  let ended = false;
  const timers = [];
  const cleanup = () => {
    timers.forEach(clearTimeout);
    setTimeout(() => nodes.forEach((n) => {
      try {
        n.disconnect();
      } catch (e) {}
    }), 400);
  };
  const end = () => {
    if (ended) return;
    ended = true;
    cleanup();
    opts.onEnd && opts.onEnd();
  };
  const ms = (t) => Math.max(0, (t - ctx.currentTime) * 1000);
  timers.push(setTimeout(() => opts.onStart && opts.onStart(), ms(vStart)));
  timers.push(setTimeout(end, ms(vEnd + tail)));

  return {
    stop(reason) {
      if (ended) return;
      const t = ctx.currentTime;
      try {
        vGain.gain.cancelScheduledValues(t);
        vGain.gain.setValueAtTime(vGain.gain.value, t);
        vGain.gain.linearRampToValueAtTime(0, t + 0.04);
        if (noiseGain) {
          noiseGain.gain.cancelScheduledValues(t);
          noiseGain.gain.setValueAtTime(noiseGain.gain.value, t);
          noiseGain.gain.linearRampToValueAtTime(0, t + 0.05);
        }
        src.stop(t + 0.06);
        if (fx && reason !== "reset") nodes.push(...click(ctx, out, t + 0.03, 0.1, { freq: 2000, q: 3, dur: 0.06 }));
      } catch (e) {}
      end();
    },
    setLink(q) {
      if (!noiseGain || ended) return;
      const nl = P.noise * (crit ? 0.45 : 1) * (1 + 5 * (1 - Math.min(1, Math.max(0, q))));
      noiseGain.gain.setTargetAtTime(nl, ctx.currentTime, 0.1);
    },
  };
}
