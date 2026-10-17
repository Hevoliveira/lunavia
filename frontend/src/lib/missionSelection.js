/*
 * The official mission chosen before launch, and the official missions' log,
 * kept on this device only (localStorage), separate from the Flight Training
 * Center's records (lib/trainingProgress). Every access is guarded: without
 * storage the game works the same and simply does not remember.
 */
import { normalizeSelection } from "../data/missionConfig";

const SELECTION_KEY = "lunavia.mission.selection.v1";
const LOG_KEY = "lunavia.mission.log.v1";
const LOG_MAX = 50;

const read = (key) => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
const write = (key, value) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // not kept; it still applies to this session
  }
};

/** The last official selection { siteId, difficulty } (the defaults on a fresh device). */
export const loadSelection = () => normalizeSelection(read(SELECTION_KEY));
export function saveSelection(sel) {
  const s = normalizeSelection(sel);
  write(SELECTION_KEY, s);
  return s;
}

/** Official missions flown, newest last: { id, siteId, difficulty, at, landing?, completed }. */
export function loadMissionLog() {
  const l = read(LOG_KEY);
  return Array.isArray(l) ? l : [];
}

/** A new official flight in the log (at launch); returns its id. */
export function logMissionStart({ siteId, difficulty }) {
  const log = loadMissionLog();
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  log.push({ id, mode: "official", siteId, difficulty, at: Date.now(), landing: null, completed: false });
  write(LOG_KEY, log.slice(-LOG_MAX));
  return id;
}

/** The landing of flight `id`: success or failure and its telemetry (the last attempt counts). */
export function logMissionLanding(id, result) {
  const log = loadMissionLog();
  const e = log.find((x) => x.id === id);
  if (!e || !result) return log;
  const n = (v) => (typeof v === "number" && Number.isFinite(v) ? +v.toFixed(2) : null);
  const b = result.breakdown || {};
  e.landing = {
    success: !result.crashed,
    grade: result.crashed ? null : result.grade || null,
    score: n(result.score),
    zone: result.zone || null,
    vy: n(b.vy && b.vy.value),
    vx: n(b.vx && b.vx.value),
    tilt: n(b.tilt && b.tilt.value),
    distance: n(b.accuracy && b.accuracy.distance),
    fuelPct: n(result.fuelPct),
    terrain: (result.terrain && result.terrain.site) || null,
    attempts: ((e.landing && e.landing.attempts) || 0) + 1,
  };
  write(LOG_KEY, log);
  return log;
}

/** Flight `id` came home (splashdown). */
export function logMissionComplete(id) {
  const log = loadMissionLog();
  const e = log.find((x) => x.id === id);
  if (e) {
    e.completed = true;
    e.completedAt = Date.now();
    write(LOG_KEY, log);
  }
  return log;
}

/** The latest flight to a destination (for the mission cards). */
export const lastFlight = (log, siteId) => [...log].reverse().find((e) => e.siteId === siteId) || null;
