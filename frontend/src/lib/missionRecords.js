/*
 * LUNAVIA — official mission records and achievements, kept on this device
 * (localStorage, as the rest of the game's progress; the iOS app's WebView
 * keeps it across app restarts and updates). No account, server or sync.
 *
 * One versioned document, separate from the training records
 * (lib/trainingProgress) and next to the official missions' log
 * (lib/missionSelection, the mission history):
 *   categories    one per destination × pilot difficulty (12): attempts,
 *                 successful missions, the best score and medal, the best
 *                 landing, docking and reentry, clean and restarted dockings,
 *                 the achievements earned there;
 *   achievements  each unlocked once: when, on which flight and where.
 *
 * Loading is defensive: missing data starts empty (and takes over what the
 * mission log already proves: see importLegacy), damaged data is kept aside
 * under a backup key and never overwritten, data written by a newer version
 * of the game is read but never written back.
 */
import { ACHIEVEMENT_IDS, DESTINATIONS, PHASE_MAX, SCORING_VERSION, betterMedal, categoryKey, medalRank, newAchievements } from "../data/missionScoring";
import { loadMissionLog } from "./missionSelection";

export const RECORDS_KEY = "lunavia.mission.records.v1";
export const RECORDS_SCHEMA = 1;
const DIFFS = ["CADET", "ASTRONAUT", "COMMANDER"];
const MARKS_MAX = 300;

export const emptyRecords = () => ({ schema: RECORDS_SCHEMA, categories: {}, achievements: {}, counted: [], finished: [], docked: [], legacyImported: false });
export const emptyCategory = () => ({
  attempts: 0,
  successes: 0,
  legacyCompleted: 0,
  bestTotal: null,
  bestMedal: null,
  bestLanding: null,
  bestDocking: null,
  bestFirstAttemptDocking: null,
  bestReentry: null,
  dockings: 0,
  firstAttemptDockings: 0,
  restartedDockings: 0,
  achievements: [],
});

/* ---- validation ---------------------------------------------------------------------- */
const fin = (v) => typeof v === "number" && Number.isFinite(v);
const int = (v) => (fin(v) && v >= 0 ? Math.floor(v) : 0);
const VALID_KEYS = new Set(DESTINATIONS.flatMap((s) => DIFFS.map((d) => categoryKey(s, d))));
const best = (b, max) => (b && typeof b === "object" && fin(b.score) && b.score >= 0 && b.score <= max ? { ...b } : null);

function sanitizeCategory(c) {
  const e = emptyCategory();
  if (!c || typeof c !== "object") return e;
  ["attempts", "successes", "legacyCompleted", "dockings", "firstAttemptDockings", "restartedDockings"].forEach((k) => (e[k] = int(c[k])));
  e.bestTotal = best(c.bestTotal, 1000);
  e.bestMedal = medalRank(c.bestMedal) >= 0 ? c.bestMedal : null;
  e.bestLanding = best(c.bestLanding, PHASE_MAX.landing);
  e.bestDocking = best(c.bestDocking, PHASE_MAX.docking);
  e.bestFirstAttemptDocking = best(c.bestFirstAttemptDocking, PHASE_MAX.docking);
  e.bestReentry = best(c.bestReentry, PHASE_MAX.reentry);
  e.achievements = Array.isArray(c.achievements) ? [...new Set(c.achievements.filter((a) => ACHIEVEMENT_IDS.includes(a)))] : [];
  return e;
}

/** A clean records document from anything (unknown categories and achievements are dropped). */
export function sanitizeRecords(raw) {
  const r = emptyRecords();
  if (!raw || typeof raw !== "object") return r;
  Object.entries(raw.categories || {}).forEach(([k, c]) => {
    if (VALID_KEYS.has(k)) r.categories[k] = sanitizeCategory(c);
  });
  Object.entries(raw.achievements || {}).forEach(([id, a]) => {
    if (ACHIEVEMENT_IDS.includes(id) && a && typeof a === "object") r.achievements[id] = { at: fin(a.at) ? a.at : null, siteId: a.siteId || null, difficulty: a.difficulty || null, flightId: a.flightId || null, ...(a.legacy ? { legacy: true } : {}) };
  });
  r.counted = Array.isArray(raw.counted) ? raw.counted.filter((x) => typeof x === "string").slice(-MARKS_MAX) : [];
  r.finished = Array.isArray(raw.finished) ? raw.finished.filter((x) => typeof x === "string").slice(-MARKS_MAX) : [];
  r.docked = Array.isArray(raw.docked) ? raw.docked.filter((x) => typeof x === "string").slice(-MARKS_MAX) : [];
  r.legacyImported = !!raw.legacyImported;
  return r;
}

export const category = (rec, siteId, difficulty) => rec.categories[categoryKey(siteId, difficulty)] || emptyCategory();
const own = (rec, siteId, difficulty) => {
  const k = categoryKey(siteId, difficulty);
  if (!rec.categories[k]) rec.categories[k] = emptyCategory();
  return rec.categories[k];
};
const mark = (list, id) => {
  if (list.includes(id)) return false;
  list.push(id);
  if (list.length > MARKS_MAX) list.splice(0, list.length - MARKS_MAX);
  return true;
};

/* ---- the official missions' log before scoring --------------------------------------------- */
/**
 * Flights logged before mission scoring existed (no `scoring` on them) still
 * prove some things, and only those are taken over: that the flight was flown
 * (an attempt), a safe landing (FIRST FOOTPRINT), a docking (FIRST CONTACT, and
 * FIRST-ATTEMPT DOCKING when the log says so), a splashdown (WELCOME HOME).
 * No score, medal or mission achievement is invented for them.
 */
export function importLegacy(rec, log) {
  if (rec.legacyImported) return rec;
  rec.legacyImported = true;
  (Array.isArray(log) ? log : []).forEach((e) => {
    if (!e || typeof e !== "object" || e.scoring || !VALID_KEYS.has(categoryKey(e.siteId, e.difficulty)) || typeof e.id !== "string") return;
    if (!e.landing) return; // never flown
    const c = own(rec, e.siteId, e.difficulty);
    if (mark(rec.counted, e.id)) c.attempts += 1;
    const at = fin(e.completedAt) ? e.completedAt : fin(e.at) ? e.at : null;
    const unlock = (id) => {
      if (rec.achievements[id]) return;
      rec.achievements[id] = { at, siteId: e.siteId, difficulty: e.difficulty, flightId: e.id, legacy: true };
      if (!c.achievements.includes(id)) c.achievements.push(id);
    };
    if (e.landing.success) unlock("FIRST_FOOTPRINT");
    if (e.docking && e.docking.success) {
      c.dockings += 1;
      if (e.docking.firstAttempt) c.firstAttemptDockings += 1;
      else c.restartedDockings += 1;
      unlock("FIRST_CONTACT");
      if (e.docking.firstAttempt) unlock("FIRST_ATTEMPT_DOCKING");
    }
    if (e.completed) {
      unlock("WELCOME_HOME");
      if (e.landing.success && e.docking && e.docking.success) c.legacyCompleted += 1;
    }
  });
  return rec;
}

/* ---- storage --------------------------------------------------------------------------- */
const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** The records on this device (never throws; without storage, empty records that are simply not kept). */
export function loadRecords() {
  const st = storage();
  if (!st) return emptyRecords();
  let raw = null;
  try {
    raw = st.getItem(RECORDS_KEY);
  } catch {
    return emptyRecords();
  }
  if (raw === null) {
    const r = importLegacy(emptyRecords(), loadMissionLog());
    saveRecords(r);
    return r;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || !fin(parsed.schema)) {
    // damaged: keep the original aside (once), start again from what the log proves
    try {
      if (st.getItem(`${RECORDS_KEY}.damaged`) === null) st.setItem(`${RECORDS_KEY}.damaged`, raw);
    } catch {
      // nowhere to keep it
    }
    const r = importLegacy(emptyRecords(), loadMissionLog());
    saveRecords(r);
    return r;
  }
  if (parsed.schema > RECORDS_SCHEMA) return { ...sanitizeRecords(parsed), readOnly: true };
  return sanitizeRecords(parsed);
}

export function saveRecords(rec) {
  if (!rec || rec.readOnly) return rec;
  const st = storage();
  try {
    if (st) st.setItem(RECORDS_KEY, JSON.stringify({ ...rec, schema: RECORDS_SCHEMA }));
  } catch {
    // not kept; it still applies to this session
  }
  return rec;
}

/* ---- updates (pure on a records document; the store functions below load and save) ---------- */
const unlockAll = (rec, ids, flight, at) => {
  const c = own(rec, flight.siteId, flight.difficulty);
  ids.forEach((id) => {
    rec.achievements[id] = { at, siteId: flight.siteId, difficulty: flight.difficulty, flightId: flight.id };
    if (!c.achievements.includes(id)) c.achievements.push(id);
  });
  return ids;
};
const stamp = (flight, at, score) => ({ score, version: SCORING_VERSION, flightId: flight.id, at });

/** A flight's descent has begun: one mission attempt at its destination and difficulty (once per flight). */
export function applyFlightStart(rec, flight) {
  if (mark(rec.counted, flight.id)) own(rec, flight.siteId, flight.difficulty).attempts += 1;
  return rec;
}

/** A graded landing of an official flight (scoreLanding). Returns the achievements it unlocked. */
export function applyLanding(rec, flight, L, at = Date.now()) {
  if (!L || !L.safe) return [];
  const c = own(rec, flight.siteId, flight.difficulty);
  if (!c.bestLanding || L.score > c.bestLanding.score) c.bestLanding = { ...stamp(flight, at, L.score), vy: L.snapshot.vy, distance: L.snapshot.distance };
  return unlockAll(rec, newAchievements("landing", { landing: L }, rec.achievements), flight, at);
}

/**
 * An official flight's MANUAL ASCENT into a stable orbit (its record: mode, success, accuracy):
 * its own achievements only — the 1,000-point score does not include the ascent.
 */
export function applyAscent(rec, flight, ascent, at = Date.now()) {
  if (!ascent || ascent.mode !== "manual" || ascent.success !== true) return [];
  return unlockAll(rec, newAchievements("ascent", { ascent, siteId: flight.siteId, unlocked: rec.achievements }, rec.achievements), flight, at);
}

/**
 * The end of an official flight's lunar EVA (components/eva/LunarEva's record): the expedition's
 * achievement when every objective was done and the astronaut is back in the LM (FIRST STEPS at
 * the Sea of Tranquility, and one for each of the other three; all four: LUNAR FIELD SCIENTIST).
 * Nothing else in the records changes (the EVA is not part of the 1,000-point score). Once only,
 * however often it is resumed.
 */
export function applyEva(rec, flight, eva, at = Date.now()) {
  if (!eva || !eva.completed) return [];
  return unlockAll(rec, newAchievements("eva", { eva, siteId: flight.siteId, unlocked: rec.achievements }, rec.achievements), flight, at);
}

/**
 * The hard dock of an official flight (scoreDocking). Counted once per flight: a
 * flight resumed from a mission checkpoint (lib/missionSave) that docks again never
 * adds a second docking to the category.
 */
export function applyDocking(rec, flight, D, at = Date.now()) {
  if (!D || !D.success) return [];
  if (!Array.isArray(rec.docked)) rec.docked = [];
  if (!mark(rec.docked, flight.id)) return [];
  const c = own(rec, flight.siteId, flight.difficulty);
  c.dockings += 1;
  if (D.firstAttempt) c.firstAttemptDockings += 1;
  else c.restartedDockings += 1;
  if (!c.bestDocking || D.score > c.bestDocking.score) c.bestDocking = { ...stamp(flight, at, D.score), attempts: D.snapshot.attempts, firstAttempt: D.firstAttempt };
  if (D.firstAttempt && (!c.bestFirstAttemptDocking || D.score > c.bestFirstAttemptDocking.score)) c.bestFirstAttemptDocking = stamp(flight, at, D.score);
  return unlockAll(rec, newAchievements("docking", { docking: D }, rec.achievements), flight, at);
}

/** The splashdown of an official flight (scoreReentry). */
export function applyReentry(rec, flight, R, at = Date.now()) {
  if (!R || !R.splashdown) return [];
  const c = own(rec, flight.siteId, flight.difficulty);
  if (!c.bestReentry || R.score > c.bestReentry.score) c.bestReentry = { ...stamp(flight, at, R.score), peakG: R.snapshot.peakG };
  return unlockAll(rec, newAchievements("reentry", { reentry: R }, rec.achievements), flight, at);
}

/**
 * The end of a completed official flight (scoreMission). Returns the previous
 * personal best of its category, whether this is a new one, and the mission
 * achievements it unlocked. Applied once per flight.
 */
export function applyMission(rec, flight, M, at = Date.now()) {
  const c = own(rec, flight.siteId, flight.difficulty);
  const prev = c.bestTotal ? { ...c.bestTotal } : null;
  const prevMedal = c.bestMedal;
  if (!mark(rec.finished, flight.id)) return { prev, prevMedal, newBest: false, unlocked: [], repeat: true };
  if (!M.eligible) return { prev, prevMedal, newBest: false, unlocked: [] };
  c.successes += 1;
  const newBest = !prev || M.total > prev.score;
  if (newBest) c.bestTotal = { ...stamp(flight, at, M.total), medal: M.medal, landing: M.landing.score, docking: M.docking.score, reentry: M.reentry.score };
  c.bestMedal = betterMedal(c.bestMedal, M.medal);
  const unlocked = unlockAll(rec, newAchievements("mission", { mission: M, records: rec }, rec.achievements), flight, at);
  return { prev, prevMedal, newBest, unlocked };
}

/** Load, apply, save. */
export function updateRecords(fn) {
  const rec = loadRecords();
  const out = fn(rec);
  saveRecords(rec);
  return { records: rec, out };
}

/** The achievements a flight unlocked (for its debrief), in catalogue order. */
export const unlockedBy = (rec, flightId) => ACHIEVEMENT_IDS.filter((id) => rec.achievements[id] && rec.achievements[id].flightId === flightId && !rec.achievements[id].legacy);
