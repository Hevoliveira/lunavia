/*
 * Training records, kept on this device only (localStorage, separate from the
 * full mission). No account, backend or sync. In the iOS app the WebView's
 * localStorage survives closing and reopening the app; it is removed with the
 * app, and iOS may clear it under severe storage pressure. Every access is
 * guarded: without storage, training works the same and records are simply
 * not kept.
 */
const KEY = "lunavia.training.v2";

export const progressKey = (discipline, scenarioId, difficulty) => `${discipline}.${scenarioId}.${difficulty}`;

export function loadProgress() {
  try {
    const raw = window.localStorage.getItem(KEY);
    const p = raw ? JSON.parse(raw) : {};
    return p && typeof p === "object" && !Array.isArray(p) ? p : {};
  } catch {
    return {};
  }
}

const GRADE_ORDER = ["S", "A", "B", "C", "D"];
const betterGrade = (a, b) => (!a ? b : !b ? a : GRADE_ORDER.indexOf(b) < GRADE_ORDER.indexOf(a) ? b : a);
const max = (a, b) => (a === null || a === undefined ? b : b === null || b === undefined ? a : Math.max(a, b));
const min = (a, b) => (a === null || a === undefined ? b : b === null || b === undefined ? a : Math.min(a, b));

/**
 * Record one finished attempt. `rec` comes from the debrief:
 * { success, landed, rank, label, grade?, fuelPct?, accuracy?, peakG? }.
 * Personal bests count safe landings / survived entries only.
 */
export function recordAttempt(discipline, scenarioId, difficulty, rec) {
  const p = loadProgress();
  const k = progressKey(discipline, scenarioId, difficulty);
  const e = p[k] || { attempts: 0, successes: 0, best: null };
  e.attempts += 1;
  if (rec.success) {
    e.successes += 1;
    if (!e.best || rec.rank > e.best.rank) e.best = { rank: rec.rank, label: rec.label };
  }
  if (rec.landed) {
    e.bestGrade = betterGrade(e.bestGrade, rec.grade);
    e.bestFuel = max(e.bestFuel, rec.fuelPct);
    e.bestAccuracy = min(e.bestAccuracy, rec.accuracy);
    e.bestPeakG = min(e.bestPeakG, rec.peakG);
  }
  e.last = Date.now();
  p[k] = e;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // storage unavailable: the attempt still counts for this session's UI
  }
  return p;
}

export function totals(p) {
  let attempts = 0;
  let successes = 0;
  let completed = 0;
  Object.values(p).forEach((e) => {
    attempts += e.attempts || 0;
    successes += e.successes || 0;
    if (e.successes > 0) completed += 1;
  });
  return { attempts, successes, completed };
}

/** Personal bests for one discipline and difficulty, across its scenarios. */
export function bestsFor(p, discipline, difficulty, scenarioIds) {
  const out = { attempts: 0, successes: 0, bestGrade: null, bestFuel: null, bestAccuracy: null, bestPeakG: null, passed: [] };
  scenarioIds.forEach((id) => {
    const e = p[progressKey(discipline, id, difficulty)];
    if (!e) return;
    out.attempts += e.attempts || 0;
    out.successes += e.successes || 0;
    out.bestGrade = betterGrade(out.bestGrade, e.bestGrade);
    out.bestFuel = max(out.bestFuel, e.bestFuel);
    out.bestAccuracy = min(out.bestAccuracy, e.bestAccuracy);
    out.bestPeakG = min(out.bestPeakG, e.bestPeakG);
    if (e.successes > 0) out.passed.push(id);
  });
  return out;
}
