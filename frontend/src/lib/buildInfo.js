/*
 * Build identity and runtime platform.
 *
 * BUILD_COMMIT / BUILD_TIME are inlined by craco.config.js when the bundle is
 * built, so the label always describes the web bundle actually running (on
 * the iPhone: the one copied into the app), not the Git branch it came from.
 * A trailing "+" on the commit means the build included uncommitted changes.
 */

export const BUILD_COMMIT = process.env.REACT_APP_BUILD_COMMIT || "dev";
export const BUILD_TIME = process.env.REACT_APP_BUILD_TIME || "";

// Capacitor's iOS bridge defines window.Capacitor before any page script runs.
export const IS_NATIVE =
  typeof window !== "undefined" &&
  !!(
    (window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform()) ||
    (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bridge)
  );

/** Fingerprint of the running JS bundle, e.g. "main.7013b6f6.js". */
export function bundleName() {
  if (typeof document === "undefined") return "";
  const el = document.querySelector('script[src*="/static/js/main."]');
  const m = el && el.getAttribute("src").match(/main\.[0-9a-f]+\.js/);
  return m ? m[0] : "dev-server";
}

/** ["LUNAVIA iOS", "BUILD 1a2b3c4", "2026-10-09 03:10 UTC"] (time omitted in dev). */
export function buildLabelParts() {
  return [`LUNAVIA ${IS_NATIVE ? "iOS" : "WEB"}`, `BUILD ${BUILD_COMMIT}`, BUILD_TIME].filter(Boolean);
}
