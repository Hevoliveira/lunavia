/*
 * LUNAVIA — the official mission's checkpoint: one save slot, kept on this
 * device, so an unfinished mission can be closed and resumed later without
 * flying its completed phases again.
 *
 * What is kept is one small versioned document (SAVE_SCHEMA) describing the
 * flight at its latest safe checkpoint, in the order the mission flies them:
 *
 *   DESCENT_READY      A  destination and pilot difficulty chosen, before powered descent
 *   LANDING_COMPLETE   B  a safe touchdown (the lunar module's pose on the terrain)
 *   DOCKING_READY      C  ascent and rendezvous flown: the player's docking
 *   DOCKING_COMPLETE   D  hard dock and crew transfer: the way home
 *   REENTRY_READY      E  the Earth approach: the reentry
 *   MISSION_COMPLETE   F  splashdown (the save is closed; RESUME goes away)
 *
 * plus what the flight's scoring has measured so far (data/flightScoring: the
 * phase snapshots, failed dockings, lost capsules), the docking's attempt
 * history, and what the player was doing when the save was last touched
 * (`activity`), so an interruption can be told apart from a clean stop.
 *
 * Where it lives: on the iPhone, in the app's own files (the LunaviaSave
 * plugin in ios/App/App/MissionSaveStore.swift writes each slot atomically
 * into Application Support), and, everywhere, in localStorage. Both hold the
 * same two alternating slots (a, b): a new checkpoint is always written to
 * the slot that does not hold the latest valid one, so a write cut short by
 * the app being killed can never destroy the previous checkpoint. Each slot
 * is an envelope with a sequence number and a checksum of its body; on load
 * every copy is checked and the newest valid one wins. Closing a mission
 * (splashdown, ABORT, START NEW MISSION) writes a closing record to both
 * slots, so an older checkpoint can never come back to life.
 *
 * Nothing here depends on a shutdown callback: a checkpoint is on disk as
 * soon as it is reached.
 */
import { OFFICIAL_MISSION_IDS, PILOT_DIFFICULTIES } from "../data/missionConfig";

export const SAVE_SCHEMA = 1;
export const SAVE_KIND = "lunavia.mission.checkpoint";
const ENVELOPE = "lunavia-save";
export const SLOT_KEYS = { a: "lunavia.mission.save.v1.a", b: "lunavia.mission.save.v1.b" };
export const DAMAGED_KEY = "lunavia.mission.save.v1.damaged";
const SLOTS = ["a", "b"];
const MAX_BODY = 64 * 1024;

export const CP = {
  DESCENT_READY: "DESCENT_READY",
  LANDING_COMPLETE: "LANDING_COMPLETE",
  DOCKING_READY: "DOCKING_READY",
  DOCKING_COMPLETE: "DOCKING_COMPLETE",
  REENTRY_READY: "REENTRY_READY",
  MISSION_COMPLETE: "MISSION_COMPLETE",
};
export const CHECKPOINT_ORDER = [CP.DESCENT_READY, CP.LANDING_COMPLETE, CP.DOCKING_READY, CP.DOCKING_COMPLETE, CP.REENTRY_READY, CP.MISSION_COMPLETE];
export const cpRank = (cp) => CHECKPOINT_ORDER.indexOf(cp);
/** The checkpoints a mission can be resumed from (MISSION_COMPLETE closes it). */
export const RESUMABLE = CHECKPOINT_ORDER.slice(0, 5);

/** What the player was doing when the save was last touched. */
export const ACTIVITIES = ["briefing", "descent", "result", "ascent", "rendezvous", "docking", "dockFailed", "transfer", "return", "reentry", "ended"];
const STATUSES = ["active", "completed", "abandoned"];

export const CHECKPOINT_TEXT = {
  DESCENT_READY: { en: "LUNAR DESCENT READY", pt: "DESCIDA LUNAR PRONTA" },
  LANDING_COMPLETE: { en: "LUNAR LANDING COMPLETE", pt: "POUSO LUNAR CONCLUÍDO" },
  DOCKING_READY: { en: "DOCKING READY", pt: "ACOPLAMENTO PRONTO" },
  DOCKING_COMPLETE: { en: "DOCKING COMPLETE", pt: "ACOPLAMENTO CONCLUÍDO" },
  REENTRY_READY: { en: "EARTH REENTRY READY", pt: "REENTRADA NA TERRA PRONTA" },
  MISSION_COMPLETE: { en: "MISSION COMPLETE", pt: "MISSÃO CONCLUÍDA" },
};
export const checkpointText = (cp, lang = "en") => (CHECKPOINT_TEXT[cp] ? CHECKPOINT_TEXT[cp][lang === "pt" ? "pt" : "en"] : "");

/* ---- integrity ------------------------------------------------------------------------- */
/** FNV-1a (32 bit) of a string, as 8 hex digits. */
export function checksum(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The stored form of one slot: the body as a string, with its sequence number and checksum. */
export function sealEnvelope(body, seq) {
  const text = JSON.stringify(body);
  return JSON.stringify({ f: ENVELOPE, v: 1, seq, len: text.length, sum: checksum(`${seq}|${text}`), body: text });
}

/**
 * One stored slot, checked: { ok, seq, save, reason }. reason is one of
 * "empty", "corrupt" (not an envelope, checksum or length wrong), "unsupported"
 * (written by a newer version of the game), "outdated" (an older save format),
 * "invalid" (a well-formed save whose contents cannot be flown).
 */
export function openEnvelope(raw) {
  if (raw === null || raw === undefined || raw === "") return { ok: false, reason: "empty", seq: -1 };
  if (typeof raw !== "string" || raw.length > MAX_BODY * 2) return { ok: false, reason: "corrupt", seq: -1 };
  let env;
  try {
    env = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "corrupt", seq: -1 };
  }
  if (!env || typeof env !== "object" || env.f !== ENVELOPE || typeof env.body !== "string" || !Number.isInteger(env.seq) || env.seq < 0) {
    return { ok: false, reason: "corrupt", seq: -1 };
  }
  if (env.body.length !== env.len || checksum(`${env.seq}|${env.body}`) !== env.sum) return { ok: false, reason: "corrupt", seq: env.seq };
  let body;
  try {
    body = JSON.parse(env.body);
  } catch {
    return { ok: false, reason: "corrupt", seq: env.seq };
  }
  if (!body || typeof body !== "object") return { ok: false, reason: "corrupt", seq: env.seq };
  if (body.kind !== SAVE_KIND) return { ok: false, reason: "invalid", seq: env.seq };
  if (Number.isInteger(body.schema) && body.schema > SAVE_SCHEMA) return { ok: false, reason: "unsupported", seq: env.seq };
  if (body.schema !== SAVE_SCHEMA) return { ok: false, reason: "outdated", seq: env.seq };
  const v = validateSave(body);
  if (!v.ok) return { ok: false, reason: "invalid", detail: v.reason, seq: env.seq };
  return { ok: true, seq: env.seq, save: v.save };
}

/* ---- validation ------------------------------------------------------------------------ */
const fin = (v) => typeof v === "number" && Number.isFinite(v);
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const ID_RE = /^[a-z0-9]{4,16}-[a-z0-9]{1,8}$/;
export const isFlightId = (id) => typeof id === "string" && ID_RE.test(id);

/**
 * The lunar module's resting pose after a safe landing (DescentGame's result.pose), or
 * null when anything about it is not a sane position on that destination's terrain: the
 * ascent then starts from the site's own landing point instead of from a bad pose.
 */
export function sanitizePose(pose, siteId) {
  if (!isObj(pose)) return null;
  const four = (a, lim) => Array.isArray(a) && a.length === 4 && a.every((x) => fin(x) && Math.abs(x) <= lim);
  if (pose.site !== siteId) return null;
  if (![pose.x, pose.padY, pose.tilt, pose.pitch].every(fin)) return null;
  if (Math.abs(pose.x) > 5000 || Math.abs(pose.padY) > 5000 || Math.abs(pose.tilt) > 45 || Math.abs(pose.pitch) > 45) return null;
  if (!four(pose.comp, 10) || !four(pose.probe, 10)) return null;
  const out = { x: pose.x, padY: pose.padY, tilt: pose.tilt, pitch: pose.pitch, comp: pose.comp.slice(), probe: pose.probe.slice(), site: siteId };
  if (fin(pose.groundY) && Math.abs(pose.groundY) <= 5000) out.groundY = pose.groundY;
  if (fin(pose.xPos) && Math.abs(pose.xPos) <= 100000) out.xPos = pose.xPos;
  return out;
}

const strList = (a, max = 50) => Array.isArray(a) && a.length <= max && a.every((x) => typeof x === "string" && x.length <= 40);

/** The flight's scoring state (data/flightScoring `flight`), checked against the save it is in. */
function validFlight(f, id, siteId, difficulty) {
  if (!isObj(f) || f.id !== id || f.siteId !== siteId || f.difficulty !== difficulty) return false;
  if (![f.landing, f.docking, f.reentry].every((x) => x === null || x === undefined || isObj(x))) return false;
  if (!strList(f.dockFailures) || !strList(f.entryLosses)) return false;
  if (!(f.ended === null || f.ended === undefined || typeof f.ended === "string")) return false;
  if (f.landing && (f.landing.difficulty !== difficulty || typeof f.landing.safe !== "boolean")) return false;
  if (f.docking && (f.docking.difficulty !== difficulty || typeof f.docking.success !== "boolean" || !intIn(f.docking.attempts, 1, 999) || !intIn(f.docking.restarts, 0, 999))) return false;
  if (f.reentry && f.reentry.difficulty !== difficulty) return false;
  return true;
}

/**
 * A save document checked field by field; returns { ok, save } (a clean copy holding only
 * known fields) or { ok: false, reason }. A checkpoint is only accepted when the flight
 * really reached it: LANDING_COMPLETE needs a safe landing, DOCKING_COMPLETE and
 * REENTRY_READY a hard dock. A closed save (completed or abandoned) only needs to say
 * which flight it closed.
 */
export function validateSave(s) {
  if (!isObj(s)) return { ok: false, reason: "not-an-object" };
  if (s.kind !== SAVE_KIND || s.schema !== SAVE_SCHEMA) return { ok: false, reason: "kind" };
  if (!isFlightId(s.attemptId)) return { ok: false, reason: "attemptId" };
  if (!STATUSES.includes(s.status)) return { ok: false, reason: "status" };
  if (!CHECKPOINT_ORDER.includes(s.checkpoint)) return { ok: false, reason: "checkpoint" };
  if (!fin(s.savedAt) || s.savedAt <= 0) return { ok: false, reason: "savedAt" };
  const base = { schema: SAVE_SCHEMA, kind: SAVE_KIND, attemptId: s.attemptId, status: s.status, checkpoint: s.checkpoint, savedAt: s.savedAt, build: typeof s.build === "string" ? s.build.slice(0, 40) : "" };
  const m = s.mission;
  const missionOk = isObj(m) && OFFICIAL_MISSION_IDS.includes(m.siteId) && PILOT_DIFFICULTIES.includes(m.difficulty);
  if (s.status !== "active") {
    // a closed mission: only which flight it was (and where, when known)
    return { ok: true, save: { ...base, mission: missionOk ? { siteId: m.siteId, difficulty: m.difficulty } : null } };
  }
  if (!missionOk) return { ok: false, reason: "mission" };
  if (s.checkpoint === CP.MISSION_COMPLETE) return { ok: false, reason: "complete-but-active" };
  const { siteId, difficulty } = m;
  if (!validFlight(s.flight, s.attemptId, siteId, difficulty)) return { ok: false, reason: "flight" };
  const f = s.flight;
  const rank = cpRank(s.checkpoint);
  if (rank >= cpRank(CP.LANDING_COMPLETE) && !(f.landing && f.landing.safe === true)) return { ok: false, reason: "no-safe-landing" };
  if (rank >= cpRank(CP.DOCKING_COMPLETE) && !(f.docking && f.docking.success === true)) return { ok: false, reason: "no-hard-dock" };
  if (rank < cpRank(CP.DOCKING_COMPLETE) && f.docking && f.docking.success === true) return { ok: false, reason: "docked-before-docking" };
  if (f.reentry && f.reentry.splashdown === true) return { ok: false, reason: "splashed-but-active" };
  if (f.ended) return { ok: false, reason: "ended-but-active" };
  const d = s.docking;
  let docking = null;
  if (d !== null && d !== undefined) {
    if (!isObj(d) || !intIn(d.attempts, 1, 999) || !intIn(d.restarts, 0, 999) || !intIn(d.contacts, 0, 99999)) return { ok: false, reason: "docking" };
    docking = { attempts: d.attempts, restarts: d.restarts, contacts: d.contacts };
  }
  const a = s.activity;
  let activity = null;
  if (a !== null && a !== undefined) {
    if (!isObj(a) || !ACTIVITIES.includes(a.phase)) return { ok: false, reason: "activity" };
    activity = { phase: a.phase, engaged: !!a.engaged, at: fin(a.at) ? a.at : s.savedAt };
  }
  const pose = rank >= cpRank(CP.LANDING_COMPLETE) && isObj(s.landing) ? sanitizePose(s.landing.pose, siteId) : null;
  const flight = JSON.parse(JSON.stringify({
    id: f.id,
    siteId,
    difficulty,
    landing: f.landing || null,
    docking: f.docking || null,
    reentry: f.reentry || null,
    dockFailures: f.dockFailures.slice(),
    entryLosses: f.entryLosses.slice(),
    ended: null,
    flown: !!f.flown,
  }));
  return {
    ok: true,
    save: {
      ...base,
      createdAt: fin(s.createdAt) ? s.createdAt : s.savedAt,
      mission: { siteId, difficulty },
      activity,
      landing: rank >= cpRank(CP.LANDING_COMPLETE) ? { pose } : null,
      docking,
      flight,
    },
  };
}

/**
 * A checkpoint document for flight `flight` (data/flightScoring `flight`, copied):
 * what the mission page writes when the flight reaches a checkpoint or when its
 * activity changes.
 */
export function makeCheckpoint({ checkpoint, flight, activity = null, pose = null, docking = null, createdAt = null, now = Date.now(), build = "" }) {
  return {
    schema: SAVE_SCHEMA,
    kind: SAVE_KIND,
    attemptId: flight.id,
    status: "active",
    checkpoint,
    mission: { siteId: flight.siteId, difficulty: flight.difficulty },
    activity: activity ? { phase: activity.phase, engaged: !!activity.engaged, at: now } : null,
    landing: cpRank(checkpoint) >= cpRank(CP.LANDING_COMPLETE) ? { pose: pose || null } : null,
    docking: docking ? { attempts: docking.attempts, restarts: docking.restarts, contacts: docking.contacts } : null,
    flight: JSON.parse(JSON.stringify(flight)),
    createdAt: createdAt || now,
    savedAt: now,
    build,
  };
}

/** The record that closes flight `attemptId`'s save (splashdown, ABORT, START NEW MISSION). */
export function makeClosing({ attemptId, status, mission = null, checkpoint = CP.MISSION_COMPLETE, now = Date.now(), build = "" }) {
  return { schema: SAVE_SCHEMA, kind: SAVE_KIND, attemptId, status, checkpoint, mission, savedAt: now, build };
}

/* ---- the store ------------------------------------------------------------------------- */
/**
 * The two-slot store over its backends. `local` is synchronous (localStorage:
 * get/set/remove); `native` (the iPhone app's files) is asynchronous and optional:
 * read() → { a, b } strings, write(slot, text) → Promise.
 *
 * state(): {
 *   status   "none" (nothing saved), "active" (a mission to resume), "closed" (the
 *            last mission was finished or abandoned), "damaged" (saves exist but none
 *            can be used), "unsupported" (written by a newer version of the game);
 *   save     the save in use (status "active" or "closed");
 *   fallback true when a newer copy was unreadable and an older checkpoint is used;
 *   problems the unreadable copies' reasons ("corrupt", "outdated", "invalid", …);
 *   ready    true once the native copies have been read (or there are none).
 * }
 */
export function createSaveStore({ local, native = null, onChange = null } = {}) {
  const raw = { local: { a: null, b: null }, native: { a: null, b: null } };
  let nativeReady = !native;
  let st = null;
  let writeChain = Promise.resolve();
  const listeners = new Set();
  if (onChange) listeners.add(onChange);

  const readLocal = () => {
    SLOTS.forEach((k) => {
      try {
        raw.local[k] = local ? local.get(SLOT_KEYS[k]) : null;
      } catch {
        raw.local[k] = null;
      }
    });
  };

  const evaluate = () => {
    const opened = [];
    ["local", "native"].forEach((src) => SLOTS.forEach((slot) => opened.push({ src, slot, text: raw[src][slot], ...openEnvelope(raw[src][slot]) })));
    const good = opened.filter((o) => o.ok);
    const bad = opened.filter((o) => !o.ok && o.reason !== "empty");
    let best = null;
    good.forEach((o) => {
      if (!best || o.seq > best.seq) best = o;
    });
    const maxSeq = opened.reduce((m, o) => Math.max(m, o.seq), -1);
    let status = "none";
    if (best) status = best.save.status === "active" ? "active" : "closed";
    else if (bad.some((o) => o.reason === "unsupported")) status = "unsupported";
    else if (bad.length) status = "damaged";
    // an older checkpoint is restored when a copy known to be newer is unreadable, or when the
    // other slot (the one the latest write went to) has copies and none of them can be read: a
    // write cut short leaves no readable sequence number, but it is always that slot's
    const slotLost = (slot) => opened.some((o) => o.slot === slot && o.reason !== "empty") && opened.every((o) => o.slot !== slot || !o.ok);
    const fallback = !!best && (bad.some((o) => o.seq > best.seq) || SLOTS.some((slot) => slot !== best.slot && slotLost(slot)));
    st = {
      status,
      save: best ? best.save : null,
      seq: best ? best.seq : -1,
      slot: best ? best.slot : null,
      maxSeq,
      fallback,
      problems: [...new Set(bad.map((o) => o.reason))],
      damagedText: !best && bad.length ? bad[0].text : null,
      ready: nativeReady,
    };
    return st;
  };

  const notify = () => listeners.forEach((fn) => {
    try {
      fn(st);
    } catch {
      // a listener's problem is not the store's
    }
  });

  // keep one copy of an unusable save aside (diagnostics), never overwriting an earlier one
  const keepDamaged = () => {
    if (!st || !st.damagedText || !local) return;
    try {
      if (local.get(DAMAGED_KEY) === null) local.set(DAMAGED_KEY, st.damagedText);
    } catch {
      // nowhere to keep it
    }
  };

  const api = {
    /** The state from the synchronous (local) copies. */
    load() {
      readLocal();
      evaluate();
      keepDamaged();
      return st;
    },
    /** Read the native copies too (the iPhone app's files) and pick the newest valid save. */
    async refresh(timeoutMs = 2500) {
      readLocal();
      if (native) {
        try {
          const r = await Promise.race([native.read(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs))]);
          raw.native.a = r && typeof r.a === "string" ? r.a : null;
          raw.native.b = r && typeof r.b === "string" ? r.b : null;
        } catch {
          // the local copies still stand
        }
      }
      nativeReady = true;
      evaluate();
      keepDamaged();
      notify();
      return st;
    },
    state() {
      return st || api.load();
    },
    /**
     * Write a checkpoint (or a closing record). Nothing invalid is ever written: a
     * document that fails validation leaves the stored save exactly as it was.
     * Returns { ok, seq } or { ok: false, reason }.
     */
    write(doc) {
      const v = validateSave(doc);
      if (!v.ok) return { ok: false, reason: v.reason };
      const cur = api.state();
      const seq = Math.max(cur.maxSeq, cur.seq) + 1;
      const text = sealEnvelope(v.save, seq);
      if (text.length > MAX_BODY * 2) return { ok: false, reason: "too-large" };
      // a checkpoint goes to the slot not holding the latest valid save; a closing record to both
      const targets = v.save.status === "active" ? [cur.slot === "a" ? "b" : "a"] : ["a", "b"];
      targets.forEach((slot) => {
        try {
          if (local) local.set(SLOT_KEYS[slot], text);
          raw.local[slot] = text;
        } catch {
          // storage full or unavailable: the native copy still takes it
        }
      });
      if (native) {
        targets.forEach((slot) => {
          writeChain = writeChain
            .then(() => native.write(slot, text))
            .then(() => {
              raw.native[slot] = text;
            })
            .catch(() => {
              // the local copy stands
            });
        });
      }
      evaluate();
      notify();
      return { ok: true, seq, save: v.save };
    },
    /** Resolves once every native write queued so far has finished. */
    flush() {
      return writeChain;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return api;
}

/* ---- the app's store --------------------------------------------------------------------- */
const browserLocal = {
  get: (k) => window.localStorage.getItem(k),
  set: (k, v) => window.localStorage.setItem(k, v),
  remove: (k) => window.localStorage.removeItem(k),
};

/** The LunaviaSave plugin of the iOS app (absent in a browser). */
function nativeBackend() {
  if (typeof window === "undefined") return null;
  const p = () => {
    try {
      const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LunaviaSave;
      return plugin && typeof plugin.readSlots === "function" && typeof plugin.writeSlot === "function" ? plugin : null;
    } catch {
      return null;
    }
  };
  if (!p()) return null;
  return {
    read: () => p().readSlots({}),
    write: (slot, value) => p().writeSlot({ slot, value }),
  };
}

let appStore = null;
/** The one store of this app (localStorage + the iOS app's files). */
export function missionSaveStore() {
  if (!appStore) {
    let local = null;
    try {
      if (typeof window !== "undefined" && window.localStorage) local = browserLocal;
    } catch {
      local = null;
    }
    appStore = createSaveStore({ local, native: nativeBackend() });
    appStore.load();
  }
  return appStore;
}
/** Tests only: forget the app store so the next call builds it again. */
export const _resetAppStore = () => {
  appStore = null;
};

/* ---- resuming ------------------------------------------------------------------------------ */
/** Where each checkpoint resumes (the mission page's state) and what the player sees named. */
export const RESUME_AT = {
  DESCENT_READY: { state: "briefing", text: { en: "POWERED DESCENT · READINESS", pt: "DESCIDA MOTORIZADA · PRONTIDÃO" } },
  LANDING_COMPLETE: { state: "ascent", text: { en: "LUNAR SURFACE · ASCENT PREPARATION", pt: "SUPERFÍCIE LUNAR · PREPARAÇÃO DA DECOLAGEM" } },
  DOCKING_READY: { state: "docking", text: { en: "RENDEZVOUS COMPLETE · MANUAL DOCKING", pt: "ENCONTRO CONCLUÍDO · ACOPLAMENTO MANUAL" } },
  DOCKING_COMPLETE: { state: "return", text: { en: "TRANS-EARTH INJECTION", pt: "INJEÇÃO TRANSTERRESTRE" } },
  REENTRY_READY: { state: "reentry", text: { en: "EARTH REENTRY", pt: "REENTRADA NA TERRA" } },
};

/** What was under way, per checkpoint, that a resume has to fly again (a maneuver, not a film). */
const INTERRUPTED = {
  DESCENT_READY: (a) => a.phase === "descent",
  LANDING_COMPLETE: (a) => a.phase === "ascent" || a.phase === "rendezvous",
  DOCKING_READY: (a) => a.phase === "docking" && a.engaged,
  DOCKING_COMPLETE: () => false,
  REENTRY_READY: (a) => a.phase === "reentry",
};

/**
 * How a validated active save is resumed (pure): the mission state to open, whether
 * a maneuver was cut short by the interruption (it is flown again from the
 * checkpoint, never counted as done), and, for the docking, the attempt history
 * to carry on with. A docking attempt the player had started counts as a restart
 * (exactly as RESTART DOCKING would: reported, then a new attempt), so closing
 * the app can never turn a messy approach into a clean first attempt; an attempt
 * that had already failed carries on as its retry.
 */
export function resumePlan(save) {
  if (!save || save.status !== "active" || !RESUME_AT[save.checkpoint]) return null;
  const a = save.activity || { phase: null, engaged: false };
  const interrupted = !!INTERRUPTED[save.checkpoint](a);
  const plan = { checkpoint: save.checkpoint, state: RESUME_AT[save.checkpoint].state, interrupted, docking: null, restartReport: null };
  if (save.checkpoint === CP.DOCKING_READY) {
    const d = save.docking || { attempts: 1, restarts: 0, contacts: 0 };
    if (interrupted) {
      plan.restartReport = { success: false, failure: "restart", attempts: d.attempts, restarts: d.restarts + 1, contacts: d.contacts };
      plan.docking = { attempts: d.attempts + 1, restarts: d.restarts + 1, contacts: d.contacts };
    } else if (a.phase === "dockFailed") {
      plan.docking = { attempts: d.attempts + 1, restarts: d.restarts + 1, contacts: d.contacts };
    } else {
      plan.docking = { ...d };
    }
  }
  return plan;
}

/** True when `state` holds a mission the player can resume. */
export const canResume = (state) => !!state && state.status === "active" && !!state.save && RESUMABLE.includes(state.save.checkpoint);
