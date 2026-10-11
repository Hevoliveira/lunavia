// LUNAVIA voice QA — Playwright init script (ctx.addInitScript({ path })).
// Records the exact mix the app sends to the speakers: every connection to
// ctx.destination is mirrored into a mono capture tap. Also turns on the comms
// QA hook (window.__lvComms, __lvAudioSettings), logs every comms event in
// window.__lvCommsLog and which subtitle is on screen in window.__lvSubs.
// window.__lvRec = true starts capturing; window.__lvTake() returns
// { sr, b64 (PCM16 mono), gaps } where gaps counts capture buffers lost to a
// blocked main thread (a capture artefact, not something a player hears).
window.__lvDebug = true;
window.__lvCommsLog = [];
(() => {
  const AC = window.AudioContext || window.webkitAudioContext;
  const orig = AudioNode.prototype.connect;
  window.AudioContext = window.webkitAudioContext = class extends AC {
    constructor(o) {
      super(o);
      const tap = this.createGain();
      const sp = this.createScriptProcessor(4096, 1, 1);
      const mute = this.createGain();
      mute.gain.value = 0;
      this.__tap = tap; this.__mute = mute; this.__chunks = [];
      this.__gaps = 0; let lastPT = null;
      sp.onaudioprocess = (e) => {
        if (lastPT !== null && e.playbackTime - lastPT > (4096 / this.sampleRate) * 1.5 && window.__lvRec) this.__gaps++;
        lastPT = e.playbackTime;
        if (window.__lvRec) this.__chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      orig.call(tap, sp); orig.call(sp, mute); orig.call(mute, this.destination);
      (window.__lvCtxs = window.__lvCtxs || []).push(this);
    }
  };
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = orig.call(this, dest, ...rest);
    const c = this.context;
    if (c && c.__tap && dest === c.destination && this !== c.__mute) orig.call(this, c.__tap);
    return r;
  };
  window.__lvTake = () => {
    const c = (window.__lvCtxs || []).find((x) => x.state !== "closed" && x.__chunks.length) || (window.__lvCtxs || [])[0];
    if (!c) return null;
    const n = c.__chunks.reduce((a, b) => a + b.length, 0);
    const pcm = new Int16Array(n); let o = 0;
    for (const ch of c.__chunks) { for (let i = 0; i < ch.length; i++) pcm[o++] = Math.max(-1, Math.min(1, ch[i])) * 32767; }
    c.__chunks = [];
    const gaps = c.__gaps; c.__gaps = 0;
    let bin = ""; const u8 = new Uint8Array(pcm.buffer);
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return { sr: c.sampleRate, b64: btoa(bin), gaps };
  };
})();
// Subtitle observer: which line is on screen, and when.
window.__lvSubs = [];
setInterval(() => {
  const el = document.querySelector('[data-testid="comms-subtitle"]');
  const line = el ? el.dataset.line : null;
  const last = window.__lvSubs[window.__lvSubs.length - 1];
  if (!last || last.line !== line) window.__lvSubs.push({ wall: Date.now(), line, text: el ? el.innerText : null });
}, 40);
