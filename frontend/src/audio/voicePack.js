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

  function loadManifest() {
    if (!manifestP) {
      manifestP = fetchImpl(`${base}/manifest.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((m) => (manifest = m))
        .catch(() => (manifest = null));
    }
    return manifestP;
  }

  const clips = (lang, id) => (manifest && manifest.langs && manifest.langs[lang] && manifest.langs[lang].clips[id]) || null;

  function fetchBytes(file) {
    if (!bytes.has(file)) {
      bytes.set(
        file,
        fetchImpl(`${base}/${file}`)
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .catch(() => null)
      );
    }
    return bytes.get(file);
  }

  const decode = (ctx, data) =>
    new Promise((resolve) => {
      // Callback form: older WebKit has no promise-returning decodeAudioData.
      try {
        const p = ctx.decodeAudioData(data.slice(0), resolve, () => resolve(null));
        if (p && p.catch) p.catch(() => resolve(null));
      } catch (e) {
        resolve(null);
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
    /** Decoded AudioBuffer for a line, or null when the pack has no such clip. */
    async buffer(ctx, lang, id, variant = 0) {
      await loadManifest();
      const c = clips(lang, id);
      const clip = c && (c[variant] || c[0]);
      if (!clip) return null;
      if (decoded.has(clip.f)) {
        const b = decoded.get(clip.f);
        decoded.delete(clip.f);
        decoded.set(clip.f, b);
        return b;
      }
      const data = await fetchBytes(clip.f);
      if (!data) return null;
      const b = await decode(ctx, data);
      if (!b) return null;
      decoded.set(clip.f, b);
      while (decoded.size > DECODED_MAX) decoded.delete(decoded.keys().next().value);
      return b;
    },
    /** Drop decoded audio (memory warning, leaving the mission). */
    trim() {
      decoded.clear();
    },
  };
}
