import { useSyncExternalStore } from "react";

/*
 * Player audio settings, persisted on the device (localStorage). Read by the
 * mission audio engine, the comms system and the subtitles; edited from the
 * AUDIO panel in the navigation bar.
 *
 *   voice        MISSION CONTROL VOICE on / off (subtitles still work when off)
 *   voiceLang    "en" | "pt"   language the controllers speak
 *   subtitles    on / off
 *   subLang      "en" | "pt"   subtitle language, independent of the voice
 *   voiceVolume  0..1
 *   sfxVolume    0..1          engines, separations, ambience, tones
 *   radioFx      radio processing (band-limit, static, squelch, quindar)
 */
const KEY = "lunavia.audio.v1";

const browserLang = () => {
  try {
    return /^pt/i.test(navigator.language || "") ? "pt" : "en";
  } catch (e) {
    return "en";
  }
};

export const DEFAULTS = Object.freeze({
  voice: true,
  voiceLang: "en",
  subtitles: true,
  subLang: "en",
  voiceVolume: 0.9,
  sfxVolume: 0.8,
  radioFx: true,
});

const LANGS = ["en", "pt"];
const clamp01 = (x, d) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : d);

function sanitize(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const lang = browserLang();
  return {
    voice: typeof r.voice === "boolean" ? r.voice : DEFAULTS.voice,
    voiceLang: LANGS.includes(r.voiceLang) ? r.voiceLang : lang,
    subtitles: typeof r.subtitles === "boolean" ? r.subtitles : DEFAULTS.subtitles,
    subLang: LANGS.includes(r.subLang) ? r.subLang : LANGS.includes(r.voiceLang) ? r.voiceLang : lang,
    voiceVolume: clamp01(r.voiceVolume, DEFAULTS.voiceVolume),
    sfxVolume: clamp01(r.sfxVolume, DEFAULTS.sfxVolume),
    radioFx: typeof r.radioFx === "boolean" ? r.radioFx : DEFAULTS.radioFx,
  };
}

function load() {
  try {
    return sanitize(JSON.parse(window.localStorage.getItem(KEY) || "null"));
  } catch (e) {
    return sanitize(null);
  }
}

let current = null;
const listeners = new Set();

export function getAudioSettings() {
  if (!current) current = load();
  return current;
}

export function setAudioSettings(patch) {
  current = sanitize({ ...getAudioSettings(), ...patch });
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch (e) {}
  listeners.forEach((fn) => fn(current));
  return current;
}

export function subscribeAudioSettings(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useAudioSettings() {
  return useSyncExternalStore(subscribeAudioSettings, getAudioSettings, getAudioSettings);
}
