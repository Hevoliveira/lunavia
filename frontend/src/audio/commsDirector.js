/*
 * LUNAVIA — mission-control comms director.
 *
 * Decides WHO speaks and WHEN. Pure scheduling: it owns one radio channel,
 * so no two voices ever overlap, and hands each transmission to `transmit`
 * (the audio engine, a silent subtitle-only player, or a test double).
 *
 *   Priority   CRITICAL > HIGH > NORMAL > AMBIENT. A CRITICAL or HIGH call
 *              cuts into a lower-priority transmission (the speaker is cut
 *              off, as on a real loop); otherwise calls wait their turn.
 *   Silence    after every transmission the channel stays quiet for a gap
 *              that depends on what comes next: 0.25 s before a CRITICAL
 *              call, about a second before routine traffic, several
 *              seconds before AMBIENT chatter. Lines can set their own gap.
 *   Relevance  a waiting call expires after a few seconds (telemetry has
 *              moved on), and an optional relevant() check runs again just
 *              before it is spoken.
 *   Spam       per-line and per-group cooldowns, and a line already queued
 *              or on the air is never queued twice.
 *   Blackout   during the entry plasma blackout only onboard voices (and
 *              lines marked throughBlackout) get through; anything else on
 *              the air is cut and the queue is cleared.
 *   Verbosity  "full" (CADET) hears everything; "standard" (ASTRONAUT)
 *              loses `assist` lines; "minimal" (COMMANDER) also loses
 *              `coach` advice and AMBIENT chatter.
 */

export const PRIORITY = { AMBIENT: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3 };

// Seconds of silence needed before a call of this priority starts.
const GAP = [4, 0.9, 0.45, 0.25];
// Seconds a call may wait for the channel before it is dropped as stale.
const MAX_AGE = [3, 8, 3.5, 2];

export const VERBOSITY = { CADET: "full", ASTRONAUT: "standard", COMMANDER: "minimal" };

export function allowed(line, verbosity) {
  if (verbosity === "full") return true;
  if (line.assist) return false;
  if (verbosity === "minimal" && (line.coach || line.priority === "AMBIENT")) return false;
  return true;
}

export function createDirector({ catalog, transmit, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, random = Math.random, onLog = null }) {
  const lines = {};
  catalog.lines.forEach((l) => (lines[l.id] = l));
  const onboard = (line) => (catalog.roles[line.role] || {}).radio === "onboard";

  let queue = [];
  let current = null; // { item, handle }
  let lastEnd = -Infinity;
  let timer = null;
  let seq = 0;
  let blackout = false;
  let verbosity = "full";
  const lastPlayed = new Map();
  const groupPlayed = new Map();
  const lastVariant = new Map();

  const sec = () => now() / 1000;
  const log = (type, item, extra) => onLog && onLog({ type, id: item.id, t: sec(), ...extra });
  const gapFor = (item) => (item.line.gap !== undefined ? item.line.gap : GAP[item.p]);

  function pickVariant(line) {
    const n = line.variants.length;
    if (n < 2) return 0;
    const prev = lastVariant.has(line.id) ? lastVariant.get(line.id) : -1;
    let v = Math.floor(random() * (prev < 0 ? n : n - 1));
    if (prev >= 0 && v >= prev) v += 1;
    return v;
  }

  function coolingDown(line, t) {
    const cd = line.cooldown || 0;
    if (cd && lastPlayed.has(line.id) && t - lastPlayed.get(line.id) < cd) return true;
    if (line.group && groupPlayed.has(line.group) && t - groupPlayed.get(line.group) < (cd || 6)) return true;
    return false;
  }

  function finish(item) {
    if (!current || current.item !== item) return;
    current = null;
    lastEnd = sec();
    log("end", item);
    pump();
  }

  function start(item) {
    const t = sec();
    const variant = item.variant !== undefined ? item.variant : pickVariant(item.line);
    lastVariant.set(item.line.id, variant);
    lastPlayed.set(item.line.id, t);
    if (item.line.group) groupPlayed.set(item.line.group, t);
    // Same speaker straight after their own transmission: the mic stays keyed.
    const keyed = t - lastEnd < 1.2 && item.prevRole === item.line.role;
    current = { item, handle: null };
    log("start", item, { role: item.line.role, priority: item.line.priority, variant });
    let done = false;
    const handle = transmit({ id: item.id, line: item.line, variant, keyed }, () => {
      if (done) return;
      done = true;
      finish(item);
    });
    if (current && current.item === item) current.handle = handle;
  }

  let lastRole = null;
  function pump() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (current) return;
    const t = sec();
    for (;;) {
      queue = queue.filter((q) => {
        if (q.expires < t) {
          log("stale", q);
          return false;
        }
        return true;
      });
      const ready = queue.filter((q) => q.at <= t).sort((a, b) => b.p - a.p || a.seq - b.seq);
      const next = ready[0];
      if (!next) break;
      // AMBIENT chatter only fills a quiet channel.
      if (next.p === PRIORITY.AMBIENT && queue.some((q) => q !== next && q.p > PRIORITY.AMBIENT)) {
        queue = queue.filter((q) => q !== next);
        log("drop", next, { reason: "busy" });
        continue;
      }
      const waitGap = lastEnd + gapFor(next) - t;
      if (waitGap > 0) {
        schedule(waitGap);
        return;
      }
      queue = queue.filter((q) => q !== next);
      if (next.relevant && !safe(next.relevant)) {
        log("drop", next, { reason: "irrelevant" });
        continue;
      }
      if (coolingDown(next.line, t)) {
        log("drop", next, { reason: "cooldown" });
        continue;
      }
      next.prevRole = lastRole;
      lastRole = next.line.role;
      start(next);
      return;
    }
    if (queue.length) {
      const soonest = Math.min(...queue.map((q) => q.at));
      schedule(Math.max(0.02, soonest - t));
    }
  }

  function schedule(s) {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      pump();
    }, Math.ceil(s * 1000));
  }

  const safe = (fn) => {
    try {
      return !!fn();
    } catch (e) {
      return false;
    }
  };

  function interrupt(reason) {
    if (!current) return;
    const { item, handle } = current;
    current = null;
    lastEnd = sec();
    log("cut", item, { reason });
    if (handle && handle.stop) handle.stop(reason);
  }

  return {
    /** Ask for a line. Returns false when it was filtered out immediately. */
    request(id, { delay = 0, relevant = null, variant } = {}) {
      const line = lines[id];
      if (!line) return false;
      const item = { id, line, p: PRIORITY[line.priority] ?? 1, seq: seq++, relevant, variant };
      if (!allowed(line, verbosity)) {
        log("drop", item, { reason: "verbosity" });
        return false;
      }
      if (blackout && !onboard(line) && !line.throughBlackout) {
        log("drop", item, { reason: "blackout" });
        return false;
      }
      const t = sec();
      if (coolingDown(line, t)) {
        log("drop", item, { reason: "cooldown" });
        return false;
      }
      if ((current && current.item.id === id) || queue.some((q) => q.id === id)) {
        log("drop", item, { reason: "duplicate" });
        return false;
      }
      item.at = t + delay;
      item.expires = item.at + MAX_AGE[item.p];
      queue.push(item);
      log("queue", item);
      if (current && delay === 0 && item.p >= PRIORITY.HIGH && item.p > current.item.p) interrupt("priority");
      pump();
      return true;
    },
    setBlackout(on) {
      if (blackout === !!on) return;
      blackout = !!on;
      if (!blackout) return;
      if (current && !onboard(current.item.line) && !current.item.line.throughBlackout) interrupt("blackout");
      queue = queue.filter((q) => {
        const keep = onboard(q.line) || q.line.throughBlackout;
        if (!keep) log("drop", q, { reason: "blackout" });
        return keep;
      });
      pump();
    },
    setVerbosity(v) {
      verbosity = v || "full";
    },
    /** Cut the current call and drop everything waiting; cooldowns are kept. */
    flush(reason = "flush") {
      interrupt(reason);
      queue.forEach((q) => log("drop", q, { reason }));
      queue = [];
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    /** Stop everything and forget cooldowns (new attempt, abort, leaving the page). */
    reset() {
      interrupt("reset");
      queue = [];
      lastPlayed.clear();
      groupPlayed.clear();
      lastEnd = -Infinity;
      lastRole = null;
      blackout = false;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    get busy() {
      return !!current;
    },
    get onAir() {
      return current ? current.item.id : null;
    },
    get pending() {
      return queue.map((q) => q.id);
    },
  };
}
