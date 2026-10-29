/*
 * LUNAVIA — bundled mission-control voice pack (public/voice, built by
 * tools/voice/render.py). Fully offline: the clips ship inside the app.
 *
 * Memory: the compressed MP3s of the selected language are kept (about
 * 1.5 MB); decoded PCM is held only for the most recent few clips, because a
 * decoded clip is roughly 30x its MP3 size. Decoding a 2 s clip takes a few
 * milliseconds and is hidden behind the radio's squelch / quindar intro.
 */
const BASE = `${process.env.PUBLIC_URL || ""}/voice`;
const DECODED_MAX = 12;

export function createVoicePack({ base = BASE, fetchImpl = (u) => fetch(u) } = {}) {
  let manifest = null;
  let manifestP = null;
  const bytes = new Map(); // file -> Promise<ArrayBuffer|null>
  const decoded = new Map(); // file -> AudioBuffer (insertion order = LRU)
  const fetchErrors = new Map(); // file -> why its last load failed (diagnostics)
  const fetchStatus = new Map(); // file -> HTTP status of its last load (0 in the iPhone app)

  function loadManifest() {
    if (!manifestP) {
      manifestP = fetchImpl(`${base}/manifest.json`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((m) => {
          manifest = m;
          if (!m) manifestP = null; // retry on the next request
          return m;
        });
    }
    return manifestP;
  }

  const clips = (lang, id) => (manifest && manifest.langs && manifest.langs[lang] && manifest.langs[lang].clips[id]) || null;

  function fetchBytes(file) {
    if (!bytes.has(file)) {
      const p = fetchImpl(`${base}/${file}`)
        .then((r) => {
          fetchStatus.set(file, r.status);
          // The iPhone app's file server (Capacitor WebViewAssetHandler) answers media files such as
          // .mp3 with a bare URLResponse, which has no HTTP status: fetch() then reports status 0 and
          // ok = false although the file and its bytes are there. Status 0 with bytes is a found file
          // (a missing one makes fetch() reject; an empty one is caught below).
          if (r.ok || r.status === 0) return r.arrayBuffer();
          fetchErrors.set(file, `http-${r.status}`);
          return null;
        })
        .catch((e) => {
          fetchErrors.set(file, `fetch-error:${(e && e.message) || e}`);
          return null;
        })
        .then((data) => {
          if (data && !data.byteLength) {
            fetchErrors.set(file, "empty-file");
            data = null;
          }
          // A failed load is not remembered: the next request tries again.
          if (!data && bytes.get(file) === p) bytes.delete(file);
          return data;
        });
      bytes.set(file, p);
    }
    return bytes.get(file);
  }

  // Resolves { buffer } or { error }. Callback form: older WebKit has no promise-returning
  // decodeAudioData. Decodes a copy: WebKit detaches the bytes it is given.
  const decode = (ctx, data) =>
    new Promise((resolve) => {
      let done = false;
      const ok = (b) => !done && ((done = true), resolve(b ? { buffer: b } : { error: "decode-failed:empty" }));
      const fail = (e) => !done && ((done = true), resolve({ error: `decode-failed:${(e && (e.message || e.name)) || "error"}` }));
      try {
        const p = ctx.decodeAudioData(data.slice(0), ok, fail);
        if (p && p.catch) p.catch(fail);
      } catch (e) {
        fail(e);
      }
    });

  return {
    ready: loadManifest,
    get loaded() {
      return !!manifest;
    },
    /** Clip duration in seconds (for subtitle-only playback), or null. */
    duration(lang, id, variant = 0) {
      const c = clips(lang, id);
      return c && c[variant] ? c[variant].d : c && c[0] ? c[0].d : null;
    },
    /** Fetch every clip of a language in the background (compressed bytes only). */
    async prefetch(lang) {
      await loadManifest();
      const l = manifest && manifest.langs && manifest.langs[lang];
      if (!l) return;
      for (const id of Object.keys(l.clips)) for (const c of l.clips[id]) await fetchBytes(c.f);
    },
    /** The bundled file of a line ("en/launch.liftoff.0.mp3"), or null. */
    file(lang, id, variant = 0) {
      const c = clips(lang, id);
      const clip = c && (c[variant] || c[0]);
      return clip ? clip.f : null;
    },
    /**
     * Load and decode a line, saying what happened at each step:
     * { buffer, file, bytes, cached } or { error, file } with error one of
     * "pack-unavailable" (no manifest), "clip-missing" (no such line), "http-404" / "fetch-error:…"
     * / "empty-file" (the file), "decode-failed:…" (the format).
     */
    async load(ctx, lang, id, variant = 0) {
      await loadManifest();
      if (!manifest) return { error: "pack-unavailable", file: null };
      const c = clips(lang, id);
      const clip = c && (c[variant] || c[0]);
      if (!clip) return { error: "clip-missing", file: null };
      if (decoded.has(clip.f)) {
        const b = decoded.get(clip.f);
        decoded.delete(clip.f);
        decoded.set(clip.f, b);
        return { buffer: b, file: clip.f, cached: true };
      }
      const data = await fetchBytes(clip.f);
      if (!data) return { error: fetchErrors.get(clip.f) || "fetch-failed", file: clip.f, status: fetchStatus.get(clip.f) };
      const bytesLen = data.byteLength;
      const r = await decode(ctx, data);
      if (!r.buffer) return { error: r.error, file: clip.f, bytes: bytesLen };
      decoded.set(clip.f, r.buffer);
      while (decoded.size > DECODED_MAX) decoded.delete(decoded.keys().next().value);
      return { buffer: r.buffer, file: clip.f, bytes: bytesLen, status: fetchStatus.get(clip.f), cached: false };
    },
    /** Decoded AudioBuffer for a line, or null when the pack has no such clip. */
    async buffer(ctx, lang, id, variant = 0) {
      const r = await this.load(ctx, lang, id, variant);
      return r.buffer || null;
    },
    /** The URL the pack loads its files from (diagnostics). */
    base,
    /** Drop decoded audio (memory warning, leaving the mission). */
    trim() {
      decoded.clear();
    },
  };
}
