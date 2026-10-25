/*
 * LUNAVIA — APOLLO LEGACY's own checkpoint (one active historical scenario at a time).
 *
 * Separate from the official mission's save (lib/missionSave): its own keys in localStorage
 * (LEGACY_KEYS) and its own two slots in the iOS app's files ("la", "lb" through the same
 * LunaviaSave plugin), so opening, playing or abandoning Apollo Legacy can never overwrite or
 * close an unfinished campaign mission, and the campaign never touches this one. The same
 * guarantees as the campaign's: alternating slots with a sequence number and a checksum, the
 * newest valid copy wins, a write cut short never destroys the previous checkpoint.
 *
 *   DESCENT   scenario and difficulty chosen: the historical descent (flown again on resume)
 *   LANDED    a safe touchdown: where the LM rests and how precise it was
 *   EVA       the surface expedition under way: its record (data/evaMissions), resumed at the
 *             ladder with every objective already done kept; nothing is counted twice
 *   closed    completed (the result is in the legacy records) or abandoned
 */
import { checksum, sanitizePose } from "./missionSave";
import { LEGACY_IDS, legacyScenario } from "../data/apolloLegacy";
import { validateEvaRecordFor } from "../data/evaMissions";
import { PILOT_DIFFICULTIES } from "../data/missionConfig";

export const LEGACY_SCHEMA = 1;
export const LEGACY_KIND = "lunavia.legacy.checkpoint";
export const LEGACY_KEYS = { a: "lunavia.legacy.save.v1.a", b: "lunavia.legacy.save.v1.b" };
export const LEGACY_NATIVE_SLOTS = { a: "la", b: "lb" };
export const LCP = { DESCENT: "DESCENT", LANDED: "LANDED", EVA: "EVA" };
const ORDER = [LCP.DESCENT, LCP.LANDED, LCP.EVA];
const STATUSES = ["active", "completed", "abandoned"];
const ENVELOPE = "lunavia-legacy";
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const fin = (v) => typeof v === "number" && Number.isFinite(v);
const ID_RE = /^L-[a-z0-9]{4,16}$/;

export const newLegacyAttemptId = (now = Date.now()) => `L-${now.toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, "0")}`;

/** A legacy save checked and cleaned, or { ok: false, reason }. */
export function validateLegacy(s) {
  if (!isObj(s) || s.kind !== LEGACY_KIND || s.schema !== LEGACY_SCHEMA) return { ok: false, reason: "kind" };
  if (!STATUSES.includes(s.status)) return { ok: false, reason: "status" };
  if (typeof s.attemptId !== "string" || !ID_RE.test(s.attemptId)) return { ok: false, reason: "id" };
  const sc = legacyScenario(s.scenario);
  if (!sc || !LEGACY_IDS.includes(s.scenario)) return { ok: false, reason: "scenario" };
  if (!PILOT_DIFFICULTIES.includes(s.difficulty)) return { ok: false, reason: "difficulty" };
  if (s.status !== "active") return { ok: true, save: { kind: LEGACY_KIND, schema: LEGACY_SCHEMA, status: s.status, attemptId: s.attemptId, scenario: s.scenario, difficulty: s.difficulty, savedAt: fin(s.savedAt) ? s.savedAt : 0 } };
  if (!ORDER.includes(s.checkpoint)) return { ok: false, reason: "checkpoint" };
  const rank = ORDER.indexOf(s.checkpoint);
  let landing = null;
  if (rank >= 1) {
    const L = s.landing;
    if (!isObj(L) || L.safe !== true) return { ok: false, reason: "landing" };
    const pose = sanitizePose(L.pose, sc.siteId);
    if (!pose) return { ok: false, reason: "pose" };
    landing = { safe: true, pose };
    if (fin(L.touchdownSpeed) && L.touchdownSpeed >= 0 && L.touchdownSpeed < 50) landing.touchdownSpeed = L.touchdownSpeed;
    if (fin(L.fuelPct) && L.fuelPct >= 0 && L.fuelPct <= 100) landing.fuelPct = L.fuelPct;
    if (isObj(L.precision) && fin(L.precision.dTarget) && typeof L.precision.band === "string") {
      landing.precision = { dTarget: L.precision.dTarget, band: L.precision.band, dObject: fin(L.precision.dObject) ? L.precision.dObject : null };
    }
  }
  let eva = null;
  if (rank >= 2) {
    eva = validateEvaRecordFor(sc.eva, s.eva);
    if (!eva) return { ok: false, reason: "eva" };
  }
  return {
    ok: true,
    save: { kind: LEGACY_KIND, schema: LEGACY_SCHEMA, status: "active", attemptId: s.attemptId, scenario: s.scenario, difficulty: s.difficulty, checkpoint: s.checkpoint, landing, eva, createdAt: fin(s.createdAt) ? s.createdAt : 0, savedAt: fin(s.savedAt) ? s.savedAt : 0, build: typeof s.build === "string" ? s.build.slice(0, 40) : "" },
  };
}

export function sealLegacy(body, seq) {
  const text = JSON.stringify(body);
  return JSON.stringify({ f: ENVELOPE, v: 1, seq, len: text.length, sum: checksum(`${seq}|${text}`), body: text });
}
export function openLegacy(raw) {
  if (raw === null || raw === undefined || raw === "") return { ok: false, reason: "empty", seq: -1 };
  let env;
  try {
    env = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "corrupt", seq: -1 };
  }
  if (!isObj(env) || env.f !== ENVELOPE || typeof env.body !== "string" || !Number.isInteger(env.seq) || env.seq < 0) return { ok: false, reason: "corrupt", seq: -1 };
  if (env.body.length !== env.len || checksum(`${env.seq}|${env.body}`) !== env.sum) return { ok: false, reason: "corrupt", seq: env.seq };
  let body;
  try {
    body = JSON.parse(env.body);
  } catch {
    return { ok: false, reason: "corrupt", seq: env.seq };
  }
  if (isObj(body) && Number.isInteger(body.schema) && body.schema > LEGACY_SCHEMA) return { ok: false, reason: "unsupported", seq: env.seq };
  const v = validateLegacy(body);
  return v.ok ? { ok: true, seq: env.seq, save: v.save } : { ok: false, reason: v.reason, seq: env.seq };
}

/**
 * The store: { load(), state(), write(save), close(status), loadNative() }. `local`: { get, set }
 * (localStorage); `native`: { read(): Promise<{la, lb}>, write(slot, text) } or null.
 */
export function createLegacyStore({ local = null, native = null } = {}) {
  const raw = { a: null, b: null, na: null, nb: null };
  let st = { status: "empty", save: null, seq: -1, slot: null };
  const evaluate = () => {
    const cands = [
      ["a", raw.a],
      ["b", raw.b],
      ["a", raw.na],
      ["b", raw.nb],
    ].map(([slot, text]) => ({ slot, ...openLegacy(text) }));
    const good = cands.filter((c) => c.ok).sort((x, y) => y.seq - x.seq);
    const best = good[0];
    st = best ? { status: best.save.status, save: best.save, seq: best.seq, slot: best.slot } : { status: "empty", save: null, seq: Math.max(-1, ...cands.map((c) => c.seq)), slot: null };
    return st;
  };
  const api = {
    load() {
      for (const k of ["a", "b"]) {
        try {
          raw[k] = local ? local.get(LEGACY_KEYS[k]) : null;
        } catch {
          raw[k] = null;
        }
      }
      return evaluate();
    },
    /** The iOS app's copy (async): adopted when newer than the web view's. */
    async loadNative() {
      if (!native) return st;
      try {
        const r = await native.read();
        raw.na = r && typeof r[LEGACY_NATIVE_SLOTS.a] === "string" ? r[LEGACY_NATIVE_SLOTS.a] : null;
        raw.nb = r && typeof r[LEGACY_NATIVE_SLOTS.b] === "string" ? r[LEGACY_NATIVE_SLOTS.b] : null;
      } catch {
        /* the web view's copy stands */
      }
      return evaluate();
    },
    state: () => st,
    /** A checkpoint (validated first: an inconsistent save is never written). */
    write(save, now = Date.now()) {
      const body = { ...save, kind: LEGACY_KIND, schema: LEGACY_SCHEMA, savedAt: now };
      const v = validateLegacy(body);
      if (!v.ok) return { ok: false, reason: v.reason };
      const seq = st.seq + 1;
      const slot = st.slot === "a" ? "b" : "a";
      const text = sealLegacy(v.save, seq);
      try {
        if (local) local.set(LEGACY_KEYS[slot], text);
      } catch {
        /* storage full or blocked: the native copy may still hold it */
      }
      if (native) native.write(LEGACY_NATIVE_SLOTS[slot], text).catch?.(() => {});
      raw[slot] = text;
      raw[slot === "a" ? "na" : "nb"] = text;
      evaluate();
      return { ok: true, seq };
    },
    /** Close the active scenario (completed or abandoned): both slots, so no older one revives. */
    close(status) {
      const s = st.save;
      if (!s || s.status !== "active") return { ok: false, reason: "none" };
      const body = { kind: LEGACY_KIND, schema: LEGACY_SCHEMA, status, attemptId: s.attemptId, scenario: s.scenario, difficulty: s.difficulty };
      const r1 = api.write(body);
      if (r1.ok) api.write(body);
      return r1;
    },
  };
  return api;
}

let appStore = null;
/** The app's legacy store (localStorage + the iOS app's files, slots la/lb). */
export function legacySaveStore() {
  if (appStore) return appStore;
  let local = null;
  try {
    if (typeof window !== "undefined" && window.localStorage) local = { get: (k) => window.localStorage.getItem(k), set: (k, v) => window.localStorage.setItem(k, v) };
  } catch {
    local = null;
  }
  let native = null;
  try {
    const p = typeof window !== "undefined" && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LunaviaSave;
    if (p && typeof p.readSlots === "function" && typeof p.writeSlot === "function") native = { read: () => p.readSlots({}), write: (slot, value) => p.writeSlot({ slot, value }) };
  } catch {
    native = null;
  }
  appStore = createLegacyStore({ local, native });
  appStore.load();
  return appStore;
}
export const _resetLegacyStore = () => {
  appStore = null;
};
/** Where an active legacy save resumes: "briefing" (descent again), "landed", or "eva". */
export const legacyResumeAt = (save) => (!save || save.status !== "active" ? null : save.checkpoint === LCP.EVA ? "eva" : save.checkpoint === LCP.LANDED ? "landed" : "briefing");
