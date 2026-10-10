/*
 * Training progress, kept on this device only (localStorage). No account,
 * backend or sync. Storage can be unavailable (private mode, cleared data):
 * every access is guarded and training works the same without it.
 */
const KEY = "lunavia.training.v1";

export const progressKey = (discipline, scenarioId, difficulty) => `${discipline}.${scenarioId}.${difficulty}`;

export function loadProgress() {
  try {
    const raw = window.localStorage.getItem(KEY);
    const p = raw ? JSON.parse(raw) : {};
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

/** Record one finished attempt. `entry` = { success, rank, label } (higher rank is better). */
export function recordAttempt(discipline, scenarioId, difficulty, entry) {
  const p = loadProgress();
  const k = progressKey(discipline, scenarioId, difficulty);
  const e = p[k] || { attempts: 0, successes: 0, best: null };
  e.attempts += 1;
  if (entry.success) {
    e.successes += 1;
    if (!e.best || entry.rank > e.best.rank) e.best = { rank: entry.rank, label: entry.label };
  }
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
