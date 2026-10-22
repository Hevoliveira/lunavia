/*
 * LUNAVIA — one official flight's scoring, driven by the mission's own events
 * (pure; unit-tested). The mission page calls it as the phases end:
 *
 *   beginDescent()     BEGIN PDI (also after RETRY DESCENT): a new scored attempt,
 *                      every earlier snapshot of the flight is dropped
 *   landed(result)     the graded touchdown (safe or not)
 *   docking(result)    each docking outcome DockingOps reports: a failed attempt or
 *                      a restart (kept as the attempt history), or the hard dock
 *   entryLost(data)    a capsule lost on entry (RETRY ENTRY may follow)
 *   splashdown(data)   the entry that splashed down
 *
 * Each phase keeps exactly one snapshot: the attempt that ended it. Nothing is
 * carried from a previous attempt or a previous flight, and nothing is summed
 * across attempts, so repeating a checkpoint can never add points.
 */
import { dockingSnapshot, landingSnapshot, reentrySnapshot, scoreDocking, scoreLanding, scoreMission, scoreReentry } from "./missionScoring";

/**
 * The same flight's scoring again, from the state a mission checkpoint kept
 * (lib/missionSave: `flight`, already validated). Only the snapshots the flight
 * had measured come back; nothing is re-scored differently, added or reset.
 */
export function restoreFlightScoring(saved) {
  const api = createFlightScoring({ id: saved.id, siteId: saved.siteId, difficulty: saved.difficulty });
  const f = api.flight;
  const copy = (v) => (v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : null);
  f.landing = copy(saved.landing);
  f.docking = copy(saved.docking);
  f.reentry = copy(saved.reentry);
  f.dockFailures = Array.isArray(saved.dockFailures) ? saved.dockFailures.slice() : [];
  f.entryLosses = Array.isArray(saved.entryLosses) ? saved.entryLosses.slice() : [];
  f.ended = null;
  if (saved.flown) f.flown = true;
  return api;
}

export function createFlightScoring({ id, siteId, difficulty }) {
  const f = { id, siteId, difficulty, landing: null, docking: null, reentry: null, dockFailures: [], entryLosses: [], ended: null };
  const api = {
    flight: f,
    beginDescent() {
      f.landing = null;
      f.docking = null;
      f.reentry = null;
      f.dockFailures = [];
      f.entryLosses = [];
      f.ended = null;
    },
    landed(result) {
      f.landing = landingSnapshot(result, f);
      f.docking = null;
      f.reentry = null;
      return scoreLanding(f.landing);
    },
    docking(r) {
      if (!r) return null;
      if (!r.success) {
        if (r.failure && r.failure !== "restart") f.dockFailures.push(r.failure);
        // flown, not docked (0 points) until an attempt captures
        f.docking = dockingSnapshot({ ...r, success: false, capture: null, failures: f.dockFailures.slice() }, f);
        return null;
      }
      f.docking = dockingSnapshot({ ...r, failures: f.dockFailures.slice() }, f);
      return scoreDocking(f.docking);
    },
    entryLost(d) {
      if (!d || !d.outcome) return;
      f.entryLosses.push(d.outcome);
      // flown, capsule lost (0 points) until an entry splashes down
      f.reentry = reentrySnapshot({ ...d, losses: f.entryLosses.slice(), attempts: Math.max(d.attempts || 1, f.entryLosses.length) }, f);
    },
    splashdown(d) {
      // the losses this flight has seen (ReentryGame reports them too: the larger list wins)
      const losses = d && Array.isArray(d.losses) && d.losses.length >= f.entryLosses.length ? d.losses : f.entryLosses;
      f.reentry = reentrySnapshot({ ...d, losses, attempts: Math.max(d.attempts || 1, losses.length + 1) }, f);
      return scoreReentry(f.reentry);
    },
    mission() {
      return scoreMission(f);
    },
    /** How the flight ended, from what it reached: the history's status. */
    status(how = "ended") {
      const m = scoreMission(f);
      if (m.completed) return m.eligible ? "complete" : "complete-after-loss";
      if (how === "aborted") return "aborted";
      if (!m.gates[0].ok) return "failed-landing";
      if (!m.gates[1].ok) return "failed-docking";
      return "failed-reentry";
    },
    /** What the history keeps: the snapshots (re-scored identically on demand) and the result. */
    summary(status) {
      const m = scoreMission(f);
      return {
        version: m.version,
        status,
        snaps: { landing: f.landing, docking: f.docking, reentry: f.reentry },
        landing: m.landing ? m.landing.score : null,
        docking: m.docking ? m.docking.score : null,
        reentry: m.reentry ? m.reentry.score : null,
        total: m.total,
        medal: m.medal,
        eligible: m.eligible,
        completed: m.completed,
      };
    },
  };
  return api;
}
