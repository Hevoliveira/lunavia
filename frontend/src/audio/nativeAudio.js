/*
 * LUNAVIA — the iPhone's audio session, seen from the web side.
 *
 * The game's sound is Web Audio inside the app's web view. Whether it reaches the speaker with the
 * iPhone's Silent Mode on depends on the audio session, set two ways (whichever the device honours):
 *   - the app's own session (LunaviaAudioSession.swift, window.Capacitor.Plugins.LunaviaAudio):
 *     "playback" (sound in Silent Mode) or "ambient" (follows the switch);
 *   - WebKit's Audio Session API (navigator.audioSession.type), where the web view has it.
 * The player's choice is the AUDIO setting SILENT MODE (audioSettings.silentMode). The media
 * volume buttons and the output route always stay the iPhone's own.
 */
import { getAudioSettings, subscribeAudioSettings } from "./audioSettings";

const plugin = () => (typeof window !== "undefined" && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LunaviaAudio) || null;

const withTimeout = (p, ms) => Promise.race([p, new Promise((resolve) => setTimeout(() => resolve({ error: "timeout" }), ms))]);

/** WebKit's session type for the policy ("playback" plays in Silent Mode). */
export const webSessionType = (silentMode) => (silentMode === "follow" ? "ambient" : "playback");

/** Set navigator.audioSession.type, where the web view has it. Returns what it reads back. */
export function applyWebAudioSession(silentMode = getAudioSettings().silentMode) {
  try {
    if (typeof navigator !== "undefined" && navigator.audioSession) {
      navigator.audioSession.type = webSessionType(silentMode);
      return navigator.audioSession.type;
    }
  } catch (e) {}
  return null;
}

let lastNative = null;

/** Apply the player's SILENT MODE choice to the app's session (iPhone app only). */
export function applyNativeAudioSession(silentMode = getAudioSettings().silentMode) {
  const p = plugin();
  if (!p || typeof p.configure !== "function") return Promise.resolve(null);
  return withTimeout(
    p.configure({ playInSilentMode: silentMode !== "follow" }).catch((e) => ({ error: String((e && e.message) || e) })),
    1500
  ).then((r) => (lastNative = r));
}

/** The session as the system reports it: category, media volume, output route (iPhone app only). */
export function nativeAudioStatus() {
  const p = plugin();
  if (!p || typeof p.status !== "function") return Promise.resolve(null);
  return withTimeout(p.status().catch((e) => ({ error: String((e && e.message) || e) })), 1500).then((r) => (lastNative = r));
}

export const lastNativeStatus = () => lastNative;
export const hasNativeAudio = () => !!plugin();

let installed = false;
/** Apply the policy now and whenever the player changes it. */
export function installAudioSessionPolicy() {
  if (installed) return;
  installed = true;
  let mode = getAudioSettings().silentMode;
  applyWebAudioSession(mode);
  applyNativeAudioSession(mode);
  subscribeAudioSettings((s) => {
    if (s.silentMode === mode) return;
    mode = s.silentMode;
    applyWebAudioSession(mode);
    applyNativeAudioSession(mode);
  });
}
