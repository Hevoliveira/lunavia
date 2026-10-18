/*
 * LUNAVIA — docking guidance: the flight instructor (pure; unit-tested).
 *
 * Reads the docking simulation's own state (data/dockingSim) and says the ONE
 * thing the pilot should do next, the control that does it, and why. It never
 * flies: it only reads. Docking is still judged by the physics alone.
 *
 * **Where the numbers come from.** Every threshold is the physics' own:
 *   - the closing-speed limit is dockingSim.closingLimit (what the HUD's
 *     REDUCE CLOSING VELOCITY warning uses);
 *   - the capture tolerances (lateral, angle, roll, closing window, lateral
 *     speed, rate) are the difficulty's DOCKING[...].tol;
 *   - a band of "close enough" is one tap's worth of change: the RCS
 *     acceleration × the minimum impulse (PULSE), so an instruction is only
 *     given when one tap can actually fix it, and clears after it has;
 *   - the target speeds (closing that falls as the ports close, lateral speed
 *     towards the axis that falls as the offset does, rotation towards the
 *     docking attitude) are the reference pilot's, the strategy the tests
 *     prove docks every difficulty.
 *
 * **Directions.** A correction is worked out in the CSM's frame (where the
 * docking axis is) and turned into the ascent stage's body axes through its
 * current attitude, then into the buttons that fire those body axes
 * (CONTROLS, the same table DockingOps builds its pad and keyboard from). So
 * "tap ◀ LEFT" is what moves the port left with the vehicle as it is, not a
 * guess from the screen.
 *
 * **One instruction at a time.** Rules are ranked (safety first: closing too
 * fast, outside the envelope near the port, rotating, then attitude, lateral
 * motion, closing speed, then the good news). Each rule has an entry
 * threshold and a lower exit threshold (hysteresis); the tracker keeps an
 * instruction for a minimum time unless a safety rule outranks it, shows a
 * short confirmation when one is executed, and never orders the opposite jet
 * on the same axis within a few seconds of the last order (it says "let it
 * settle" instead).
 */
import { DOCKING, PULSE, qConj, qRot, telemetry } from "./dockingSim";

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---- the controls, as the player sees them -------------------------------------------- */
// axis "t": body translation command t[i]; axis "r": body rotation command r[i] (dockingSim.stepDocking).
export const CONTROLS = {
  up: { mode: "TRANSLATION", axis: "t", i: 2, v: 1, label: "▲ UP", key: "KeyW", keyLabel: "W" },
  down: { mode: "TRANSLATION", axis: "t", i: 2, v: -1, label: "▼ DOWN", key: "KeyS", keyLabel: "S" },
  left: { mode: "TRANSLATION", axis: "t", i: 0, v: -1, label: "◀ LEFT", key: "KeyA", keyLabel: "A" },
  right: { mode: "TRANSLATION", axis: "t", i: 0, v: 1, label: "▶ RIGHT", key: "KeyD", keyLabel: "D" },
  fwd: { mode: "TRANSLATION", axis: "t", i: 1, v: 1, label: "▲ FWD", key: "KeyR", keyLabel: "R" },
  aft: { mode: "TRANSLATION", axis: "t", i: 1, v: -1, label: "▼ AFT", key: "KeyF", keyLabel: "F" },
  "pitch-up": { mode: "ATTITUDE", axis: "r", i: 0, v: 1, label: "⤒ PITCH", key: "ArrowUp", keyLabel: "↑" },
  "pitch-down": { mode: "ATTITUDE", axis: "r", i: 0, v: -1, label: "⤓ PITCH", key: "ArrowDown", keyLabel: "↓" },
  "yaw-left": { mode: "ATTITUDE", axis: "r", i: 2, v: 1, label: "↺ YAW", key: "ArrowLeft", keyLabel: "←" },
  "yaw-right": { mode: "ATTITUDE", axis: "r", i: 2, v: -1, label: "↻ YAW", key: "ArrowRight", keyLabel: "→" },
  "roll-left": { mode: "ATTITUDE", axis: "r", i: 1, v: -1, label: "⟲ ROLL", key: "KeyQ", keyLabel: "Q" },
  "roll-right": { mode: "ATTITUDE", axis: "r", i: 1, v: 1, label: "⟳ ROLL", key: "KeyE", keyLabel: "E" },
};
const controlFor = (axis, i, sign) => Object.keys(CONTROLS).find((k) => CONTROLS[k].axis === axis && CONTROLS[k].i === i && CONTROLS[k].v === sign);

/** The body command a set of buttons gives (what pressing them does). */
export function commandOf(buttons) {
  const t = [0, 0, 0];
  const r = [0, 0, 0];
  (buttons || []).forEach((b) => {
    const c = CONTROLS[b];
    if (c) (c.axis === "t" ? t : r)[c.i] = clamp((c.axis === "t" ? t : r)[c.i] + c.v, -1, 1);
  });
  return { t, r };
}

/**
 * The translation buttons that push the vehicle along `dir` (CSM frame), through
 * its current attitude q. `axes` limits the choice (lateral: body X and Z;
 * closing: body Y). A body axis is used when it carries at least half of the
 * largest component, so a rolled vehicle gets the diagonal it really needs.
 */
export function translationButtons(dir, q, axes = [0, 1, 2]) {
  const b = qRot(qConj(q), dir);
  const big = Math.max(...axes.map((i) => Math.abs(b[i])));
  if (big < 1e-9) return [];
  return axes.filter((i) => Math.abs(b[i]) >= 0.5 * big).map((i) => controlFor("t", i, b[i] > 0 ? 1 : -1));
}

/** The vehicle's own lateral velocity, in the pilot's screen terms (right, up), m/s. */
export function lateralVelocity(s) {
  return [-s.vel[0], s.vel[2]];
}

/* ---- the steps ------------------------------------------------------------------------- */
export const STEPS = ["ACQUIRE", "ALIGN", "VELOCITY", "APPROACH", "CONTACT"]; // STEP 1..5
export const SAFETY = 80; // rules at or above this priority interrupt anything
// The opening briefing (STEP 1), seconds from the start of an attempt; COMMANDER gets none.
export const BRIEFING_S = { CADET: 6, ASTRONAUT: 3.5, COMMANDER: 0 };

/**
 * Every rule that applies to the state now, highest priority first. `active` is the
 * key on display (its rule uses its exit threshold: hysteresis). ctx: { mode, align }.
 */
export function evaluate(s, difficulty = "ASTRONAUT", ctx = {}, active = null) {
  const cfg = DOCKING[difficulty];
  const tol = cfg.tol;
  const out = [];
  const add = (c) => out.push({ dirs: [], buttons: [], ...c });
  if (s.status === "captured") {
    // contact → capture → probe retraction (6 s) → hard dock: the checklist of STEP 5
    add({ key: "capture", pri: 100, step: 5, sev: "ok", d: { retract: clamp((s.t - (s.captureT || s.t)) / 6, 0, 1) } });
    return out;
  }
  if (s.status === "docked") {
    add({ key: "docked", pri: 100, step: 5, sev: "ok" });
    return out;
  }
  if (s.status === "failed") {
    add({ key: "failed", pri: 100, step: 5, sev: "safety", restart: true });
    return out;
  }
  const m = telemetry(s, difficulty);
  const is = (...k) => k.includes(active);
  const kick = cfg.accel * PULSE; // one tap's Δv (m/s)
  const akick = cfg.angAccel * PULSE; // one tap's rate change (rad/s)
  const axial = Math.max(0, m.axial);
  const d = { m, axial, kick };

  if (s.prop <= 0) {
    add({ key: "noProp", pri: 95, step: 3, sev: "safety", restart: true, d });
    return out;
  }
  if (s.t < (BRIEFING_S[difficulty] || 0)) add({ key: "acquire", pri: 75, step: 1, sev: "info", confirm: "acquired", d });

  // Lined up for the approach (the reference pilot's test): on the axis, tighter as the
  // ports close, and pointing at the probe. Held a little longer once approaching.
  const approaching = is("good", "standby", "begin", "latch", "slow", "brake");
  const linedThr = Math.max(0.6 * tol.lateral, 0.03 * axial) * (approaching ? 1.25 : 1);
  const lined = m.offsetR < linedThr && m.angle < 3 * tol.angle;
  d.lined = lined;
  d.linedThr = linedThr;

  /* attitude (and, with no attitude hold, rotation) */
  const err = [m.pitch, m.roll, m.yaw]; // body X, Y, Z
  const thrA = [tol.angle, tol.roll, tol.angle];
  const kA = is("att", "rot", "attWait", "autoAlign") ? 0.35 : 0.7;
  const attBad = err.some((e, i) => Math.abs(e) > kA * thrA[i]);
  const rate = Math.hypot(s.w[0], s.w[1], s.w[2]);
  // with no attitude hold, a leftover turn slowly carries the vehicle off again: null it to
  // about one tap's worth (in, at a tap or 30 % of the capture limit; out, at half a tap)
  const rateBad = !cfg.attHold && rate > (is("att", "rot", "attWait") ? 0.5 * akick : Math.max(akick, 0.3 * tol.rate));
  d.err = err;
  d.rate = rate;
  if (cfg.autoAlign && ctx.align) {
    // the autopilot turns; outside the capture tolerance, wait for it before closing in
    if (attBad) add({ key: "autoAlign", pri: m.angle > tol.angle || Math.abs(m.roll) > tol.roll ? 48 : 22, step: 2, sev: "wait", d });
  } else if (attBad || rateBad) {
    // turn towards the docking attitude at a rate that falls with the error (≤ 1°/s)
    const wantR = err.map((e) => clamp(-0.25 * e, -DEG, DEG));
    const need = wantR.map((w, i) => w - s.w[i]);
    // tap threshold with hysteresis: lower while a tap order is up, higher while waiting
    const tapAt = (is("att", "rot") ? 0.5 : is("attWait") ? 1.1 : 0.75) * akick;
    // the axis furthest out of tolerance leads; any other axis that needs a comparable
    // correction is named with it (the pad takes two fingers), so no turn runs on unwatched
    const order = [0, 1, 2].sort((a, b) => Math.abs(err[b]) / thrA[b] - Math.abs(err[a]) / thrA[a]);
    const ax = order.find((i) => Math.abs(need[i]) > tapAt);
    const axes = ax == null ? [] : order.filter((i) => Math.abs(need[i]) > tapAt && Math.abs(need[i]) >= 0.5 * Math.abs(need[ax]));
    d.ax = ax != null ? ax : order[0];
    d.axes = axes;
    // rotating faster than a capture accepts, with contact imminent: a safety order
    const unsafe = rate > tol.rate && axial < 1.5;
    if (ax != null) {
      const buttons = axes.map((i) => controlFor("r", i, need[i] > 0 ? 1 : -1));
      // inside the attitude tolerance, what is left is a turn to stop (its own hysteresis, so the
      // title does not flicker between the two)
      const errOut = err.some((e, i) => Math.abs(e) > (is("att") ? 0.35 : 0.7) * thrA[i]);
      const key = errOut ? "att" : "rot";
      add({ key, pri: unsafe ? 81 : 70, step: key === "rot" ? 3 : 2, sev: unsafe ? "safety" : "correct", buttons, mode: "ATTITUDE", d });
    } else {
      add({ key: "attWait", pri: unsafe ? 81 : 24, step: 2, sev: unsafe ? "safety" : "wait", d });
    }
  }

  /* lateral: towards the axis at a speed that falls with the offset, then stop.
     The speed is the vehicle's own (what the translation jets change), not the port's:
     a turn swings the port sideways, and that is the attitude's to stop, not a drift. */
  const vL = lateralVelocity(s);
  d.vL = vL;
  // Where the port is, for a translation: a tilted vehicle carries its port off the axis, and
  // straightening it brings the port back. Outside the attitude tolerance aim at where the port
  // will be once aligned (straight above the vehicle's centre); inside it, at the port itself.
  const tilt = clamp((Math.max(m.angle / tol.angle, Math.abs(m.roll) / tol.roll) - 0.5) / 0.5, 0, 1);
  const offC = [-s.pos[0], s.pos[2]];
  const offL = [0, 1].map((i) => m.offset[i] * (1 - tilt) + offC[i] * tilt);
  const offLR = Math.hypot(offL[0], offL[1]);
  d.offL = offL;
  const wantL = offL.map((o) => clamp(-0.05 * o, -0.06, 0.06));
  if (offLR > 0.8 * linedThr) {
    // far enough off to need a move: at least one tap's worth of speed towards the axis
    for (let i = 0; i < 2; i++) if (Math.abs(offL[i]) > 0.3 * offLR) wantL[i] = -Math.sign(offL[i]) * Math.max(Math.abs(wantL[i]), kick);
  }
  const eL = [vL[0] - wantL[0], vL[1] - wantL[1]];
  const bigL = Math.max(Math.abs(eL[0]), Math.abs(eL[1]));
  d.wantL = wantL;
  if (bigL > kick * (is("align", "drift") ? 0.5 : 1)) {
    // fire against the error (screen right/up), on the axes that carry it
    const dir2 = eL.map((e) => (Math.abs(e) >= Math.max(0.5 * kick, 0.4 * bigL) ? -Math.sign(e) : 0));
    const dirCsm = [-dir2[0], 0, dir2[1]]; // screen right = CSM −X, up = CSM +Z
    const buttons = translationButtons(dirCsm, s.q, [0, 2]);
    const toward = offLR > 0.8 * linedThr && dir2[0] * -offL[0] + dir2[1] * -offL[1] > 0;
    const unsafe = Math.hypot(vL[0], vL[1]) > tol.vLat && axial < 4;
    d.dir2 = dir2;
    add({ key: toward ? "align" : "drift", pri: unsafe ? 82 : 60, step: toward ? 2 : 3, sev: unsafe ? "safety" : "correct", buttons, mode: "TRANSLATION", d });
  } else if (!lined && offLR > 0.8 * linedThr) {
    add({ key: "lateralWait", pri: 24, step: 2, sev: "wait", d });
  }

  /* closing speed along the docking axis */
  const back = !lined && axial < (is("backoff") ? 4 : 3);
  const want = lined
    ? Math.max(tol.vMin * 1.6, Math.min(m.closingLimit * 0.6, 0.05 + 0.012 * axial, tol.vMax * 0.6))
    : back
      ? -0.04
      : Math.min(0.03, Math.max(0, m.closing));
  const bandC = Math.max(1.2 * kick, 0.2 * Math.abs(want));
  const eC = m.closing - want;
  d.want = want;
  d.lim = m.closingLimit;
  const fwd = translationButtons([0, -1, 0], s.q, [1]); // towards the probe
  const aft = translationButtons([0, 1, 0], s.q, [1]);
  if (m.closing > m.closingLimit * (is("brake") ? 0.95 : 1)) {
    add({ key: "brake", pri: 90, step: 3, sev: "safety", buttons: aft, mode: "TRANSLATION", confirm: "braked", d });
  } else if (eC > bandC * (is("slow", "backoff") ? 0.5 : 1)) {
    add({ key: back ? "backoff" : "slow", pri: back ? 85 : 50, step: back ? 4 : 3, sev: back ? "safety" : "correct", buttons: aft, mode: "TRANSLATION", d });
  } else if (eC < -Math.max(bandC, lined ? 0 : 0.02) * (is("begin", "latch", "opening") ? 0.5 : 1)) {
    const key = lined ? (axial < 3 ? "latch" : "begin") : "opening";
    add({ key, pri: key === "opening" ? 55 : 45, step: key === "opening" ? 3 : 4, sev: key === "opening" ? "correct" : "go", buttons: fwd, mode: "TRANSLATION", d });
  }

  /* the good news: cleared for the approach, contact imminent */
  const attOk = m.angle < tol.angle && Math.abs(m.roll) < tol.roll;
  if (lined && attOk) {
    const ready = m.closing >= tol.vMin && m.closing <= m.closingLimit && m.vLatR < tol.vLat && m.angle < tol.angle && Math.abs(m.roll) < tol.roll && m.rate < tol.rate && m.offsetR < tol.lateral;
    if (ready && axial < (is("standby") ? 2 : 1.5)) add({ key: "standby", pri: 30, step: 4, sev: "ok", d });
    add({ key: "good", pri: 25, step: 4, sev: "ok", d });
  }
  add({ key: "stable", pri: 1, step: lined ? 4 : 2, sev: "ok", d });
  return out.sort((a, b) => b.pri - a.pri);
}

/* ---- the tracker: one instruction at a time, without chatter --------------------------- */
const FAMILY = {
  att: "att",
  rot: "att",
  attWait: "att",
  autoAlign: "att",
  align: "lat",
  drift: "lat",
  lateralWait: "lat",
  brake: "cl",
  slow: "cl",
  backoff: "cl",
  begin: "cl",
  latch: "cl",
  opening: "cl",
};
const WAITS = ["attWait", "lateralWait", "autoAlign", "settle"];
const CONFIRM = {
  acquire: "acquired",
  brake: "braked",
  slow: "slowed",
  backoff: "backingOff",
  begin: "approachStarted",
  latch: "approachStarted",
  opening: "openingStopped",
  align: "driftStopped",
  drift: "driftStopped",
  lateralWait: "driftStopped",
  attWait: "attAligned",
  autoAlign: "attAligned",
  att: "attAligned",
  rot: "rotStopped",
};
/**
 * createGuidance(difficulty).update(state, ctx) → the instruction to show now:
 * { key, step, pri, sev, buttons, mode, needMode, how, d, confirm, switched }.
 * Time is the simulation's own clock (state.t), so it is deterministic and
 * restarts with the attempt.
 */
export function createGuidance(difficulty = "ASTRONAUT", { minHold = 1.5, confirmS = 1.1, contraS = 2.5, brakeS = 1.0 } = {}) {
  const cfg = DOCKING[difficulty];
  let cur = null; // { key, since, cand }
  let confirm = null; // { key, until }
  let lastDir = {}; // "t1" → { sign, t }: the last order on each control axis
  let quiet = {}; // family → t: after a confirmed correction its rule keeps quiet a moment
  let switches = 0;
  const reset = () => {
    cur = null;
    confirm = null;
    lastDir = {};
    quiet = {};
  };
  const dirsOf = (c) => (c.buttons || []).map((b) => ({ axis: CONTROLS[b].axis + CONTROLS[b].i, sign: CONTROLS[b].v, a: CONTROLS[b].axis, i: CONTROLS[b].i }));
  // Firing against motion already under way on that axis is braking (stopping a turn or a
  // drift the last order started), not a contradiction; a push the other way from rest is.
  const braking = (x, s) => {
    const v = x.a === "r" ? s.w[x.i] / (cfg.angAccel * PULSE) : qRot(qConj(s.q), s.vel)[x.i] / (cfg.accel * PULSE);
    return v * x.sign < -0.5;
  };
  const contradicts = (c, t, s) => dirsOf(c).some((x) => lastDir[x.axis] && lastDir[x.axis].sign !== x.sign && t - lastDir[x.axis].t < (braking(x, s) ? brakeS : contraS));
  function update(s, ctx = {}) {
    const t = s.t;
    if (cur && t < cur.since) reset(); // the clock went back: a new attempt
    // a family just confirmed stays quiet a moment (the ✓ is not followed at once by a new order
    // of the same kind), unless it is a safety order
    const cands = evaluate(s, difficulty, ctx, cur && cur.key).filter((c) => c.pri >= SAFETY || !FAMILY[c.key] || !(quiet[FAMILY[c.key]] > t));
    let pick = cands[0];
    const curC = cur && cands.find((c) => c.key === cur.key);
    // hold the current instruction a moment once it is on screen (not behind a confirmation),
    // unless safety outranks it; a "wait" also holds against its own rule's next order (the
    // turn or the slide is still being watched)
    if (cur && pick.key !== cur.key && pick.pri < SAFETY && cur.shown != null && t - cur.shown < minHold) {
      if (curC) pick = curC;
      else if (cur.key === "settle" || (WAITS.includes(cur.key) && FAMILY[pick.key] === FAMILY[cur.key])) pick = { ...cur.cand, d: pick.d };
    }
    // never the opposite jet on the same axis straight after the last order: let it settle
    if (pick.pri < SAFETY && contradicts(pick, t, s)) {
      pick = cands.find((c) => c.pri < SAFETY && !contradicts(c, t, s) && c.buttons.length) || { key: "settle", pri: 0, step: pick.step, sev: "wait", buttons: [], d: pick.d };
    }
    // the correction on display is done and the next order is about something else (its own
    // rule has no tap left to order): confirm it
    const actionLeft = cur && FAMILY[cur.key] && cands.some((c) => FAMILY[c.key] === FAMILY[cur.key] && c.buttons.length);
    const sameFamily = cur && FAMILY[cur.key] && FAMILY[pick.key] === FAMILY[cur.key];
    if (cur && !curC && !actionLeft && !sameFamily && CONFIRM[cur.key] && cur.key !== pick.key && !confirm) {
      confirm = { key: CONFIRM[cur.key], until: t + confirmS };
      if (FAMILY[cur.key]) quiet[FAMILY[cur.key]] = t + minHold;
    }
    const switched = !cur || pick.key !== cur.key;
    if (switched) {
      cur = { key: pick.key, since: t, cand: pick, shown: null };
      switches += 1;
    } else cur.cand = pick;
    dirsOf(pick).forEach((x) => (lastDir[x.axis] = { sign: x.sign, t }));
    const showConfirm = confirm && t < confirm.until && pick.pri < SAFETY && pick.key !== "capture" && pick.key !== "docked";
    if (confirm && t >= confirm.until) confirm = null;
    if (!showConfirm && cur.shown == null) cur.shown = t;
    const mode = pick.mode || null;
    return {
      key: pick.key,
      step: pick.step,
      pri: pick.pri,
      sev: pick.sev,
      buttons: pick.buttons || [],
      mode,
      needMode: !!(mode && ctx.mode && ctx.mode !== mode),
      how: mode === "ATTITUDE" && cfg.attHold ? "taps" : "tap",
      restart: !!pick.restart,
      d: pick.d || {},
      confirm: showConfirm ? confirm.key : null,
      brakes: dirsOf(pick).length > 0 && dirsOf(pick).every((x) => braking(x, s)),
      switched,
      switches,
      since: cur.since,
    };
  }
  return { update, reset, get switches() {
    return switches;
  } };
}

/* ---- words ----------------------------------------------------------------------------- */
const f2 = (v) => Math.abs(v).toFixed(2);
const f3 = (v) => v.toFixed(3);
const dg = (r) => ((r * 180) / Math.PI).toFixed(1);
const AXIS = { en: ["PITCH", "ROLL", "YAW"], pt: ["ARFAGEM", "ROLAGEM", "GUINADA"] };
export const STEP_NAMES = {
  en: ["ACQUIRE THE DOCKING TARGET", "ALIGN WITH THE DOCKING PORT", "REDUCE RELATIVE VELOCITY", "PROCEED WITH FINAL APPROACH", "DOCKING CONTACT"],
  pt: ["ADQUIRA O ALVO DE DOCKING", "ALINHE COM A PORTA DE DOCKING", "REDUZA A VELOCIDADE RELATIVA", "PROSSIGA COM A APROXIMAÇÃO FINAL", "CONTATO DE DOCKING"],
};
export const UI = {
  en: { header: "DOCKING GUIDANCE", step: "STEP", on: "GUIDANCE ON", off: "GUIDANCE OFF", restart: "RESTART DOCKING", hold: "HOLD", holdHint: "HOLD TO RESTART", then: "then", mode: "MODE → " },
  pt: { header: "GUIA DE DOCKING", step: "ETAPA", on: "GUIA LIGADO", off: "GUIA DESLIGADO", restart: "REINICIAR DOCKING", hold: "SEGURE", holdHint: "SEGURE PARA REINICIAR", then: "depois", mode: "MODE → " },
};
// where the port is, in words (screen terms)
function where(off, lang) {
  const r = Math.hypot(off[0], off[1]) || 1;
  const w = [];
  if (Math.abs(off[0]) > 0.3 * r) w.push(lang === "pt" ? (off[0] > 0 ? "à direita" : "à esquerda") : off[0] > 0 ? "right" : "left");
  if (Math.abs(off[1]) > 0.3 * r) w.push(lang === "pt" ? (off[1] > 0 ? "acima" : "abaixo") : off[1] > 0 ? "high" : "low");
  return w.join(lang === "pt" ? " e " : " and ");
}
function drifting(v, lang) {
  const r = Math.hypot(v[0], v[1]) || 1;
  const w = [];
  if (Math.abs(v[0]) > 0.3 * r) w.push(lang === "pt" ? (v[0] > 0 ? "para a direita" : "para a esquerda") : v[0] > 0 ? "right" : "left");
  if (Math.abs(v[1]) > 0.3 * r) w.push(lang === "pt" ? (v[1] > 0 ? "para cima" : "para baixo") : v[1] > 0 ? "up" : "down");
  return w.join(lang === "pt" ? " e " : " and ");
}

/** The control to use, in words: "tap ◀ LEFT", "MODE → ATT, then tap ⤓ PITCH". */
export function controlText(g, lang = "en", keyboard = false) {
  if (!g.buttons || !g.buttons.length) return "";
  const pt = lang === "pt";
  const names = g.buttons.map((b) => CONTROLS[b].label + (keyboard ? ` (${CONTROLS[b].keyLabel})` : "")).join(" + ");
  const verb = g.how === "taps" ? (pt ? "toques curtos em" : "tap repeatedly") : pt ? "toque" : "tap";
  const act = `${verb} ${names}`;
  if (g.needMode && !keyboard) return `${UI[lang].mode}${g.mode === "ATTITUDE" ? "ATT" : "TRANS"}, ${UI[lang].then} ${act}`;
  return act.charAt(0).toUpperCase() + act.slice(1);
}

/**
 * Title, explanation and supporting numbers for an instruction, by difficulty:
 * CADET is taught (what to press, and why it works that way), ASTRONAUT gets the
 * order and the number, COMMANDER the order alone.
 */
export function guidanceText(g, difficulty = "ASTRONAUT", lang = "en", ctx = {}) {
  const pt = lang === "pt";
  const L = pt ? "pt" : "en";
  const d = g.d || {};
  const m = d.m;
  const level = difficulty === "CADET" ? 2 : difficulty === "ASTRONAUT" ? 1 : 0;
  const ctl = controlText(g, L, !!ctx.keyboard);
  const many = d.axes && d.axes.length > 1;
  const ax = many ? d.axes.map((i) => AXIS[L][i]).join(pt ? " E " : " AND ") : d.ax != null ? AXIS[L][d.ax] : "";
  const axErr = d.err && d.ax != null ? (many ? d.axes.map((i) => dg(d.err[i])).join("°/") : dg(d.err[d.ax])) : "";
  const T = {
    acquire: [
      pt ? "ALVO DE DOCKING À FRENTE" : "DOCKING TARGET AHEAD",
      ctx.view === "CHASE"
        ? pt
          ? "O CSM está à frente. A linha ciano tracejada é o eixo da sonda; a laranja, o seu eixo de docking."
          : "The CSM is ahead. The dashed cyan line is its probe's axis; the orange line is your docking axis."
        : pt
          ? "O CSM está à frente. O anel ciano é a ponta da sonda; o retículo laranja é o seu eixo de docking. Mantenha o anel no retículo."
          : "The CSM is ahead. The cyan ring is its probe tip; the orange reticle is your docking axis. Keep the ring in the reticle.",
      pt ? `Alvo a ${m ? m.axial.toFixed(1) : ""} m.` : `Target at ${m ? m.axial.toFixed(1) : ""} m.`,
    ],
    autoAlign: [
      pt ? "AUTO ALIGN ALINHANDO A ATITUDE" : "AUTO ALIGN IS ALIGNING THE ATTITUDE",
      pt ? "Aguarde: o piloto automático gira a nave para o eixo de docking. A translação continua com você." : "Wait: the autopilot is turning you onto the docking axis. Translation is still yours.",
      pt ? "Aguarde." : "Wait.",
    ],
    att: [
      pt ? `REDUZA O ERRO DE ${ax}` : `REDUCE ${ax} ERROR`,
      pt
        ? `O eixo de docking está ${axErr}° fora em ${ax.toLowerCase()}. ${ctl}: a nave gira e ${difficulty === "COMMANDER" ? "continua girando até você parar" : "para quando você solta"}. Centralize o + amarelo.`
        : `Your docking axis is ${axErr}° off in ${ax.toLowerCase()}. ${ctl}: the vehicle turns, and ${difficulty === "COMMANDER" ? "keeps turning until you stop it" : "stops when you let go"}. Bring the yellow + to the centre.`,
      pt ? `${ax} ${axErr}°.` : `${ax} ${axErr}°.`,
    ],
    rot: [
      pt ? "PARE A ROTAÇÃO" : "STOP THE ROTATION",
      pt ? `A nave ainda gira a ${dg(d.rate || 0)}°/s, e no espaço nada a freia. ${ctl} contra o giro.` : `You are still turning at ${dg(d.rate || 0)}°/s, and nothing in space stops it. ${ctl} against the turn.`,
      pt ? `Giro ${dg(d.rate || 0)}°/s.` : `Turning ${dg(d.rate || 0)}°/s.`,
    ],
    attWait: [
      pt ? "GIRANDO PARA O EIXO — AGUARDE" : "TURNING ONTO THE AXIS — WAIT",
      pt ? "A rotação já leva a nave ao eixo. Aguarde e pare o giro quando o + chegar ao centro." : "The turn is already carrying you onto the axis. Wait, then stop it when the + reaches the centre.",
      pt ? "Aguarde." : "Wait.",
    ],
    align: [
      pt ? "CORRIJA O ALINHAMENTO LATERAL" : "CORRECT LATERAL ALIGNMENT",
      m && pt
        ? `A porta está ${f2(Math.hypot(...d.offL))} m ${where(d.offL, "pt")} do eixo. ${ctl} uma vez e aguarde: pela inércia, ela continua deslizando para o centro sozinha.`
        : m
          ? `The port is ${f2(Math.hypot(...d.offL))} m ${where(d.offL, "en")} of the axis. ${ctl} once, then wait: inertia keeps it sliding towards the centre on its own.`
          : "",
      m ? (pt ? `Porta ${f2(Math.hypot(...d.offL))} m ${where(d.offL, "pt")}.` : `Port ${f2(Math.hypot(...d.offL))} m ${where(d.offL, "en")}.`) : "",
    ],
    drift: [
      pt ? "REDUZA A DERIVA LATERAL" : "REDUCE LATERAL DRIFT",
      m && pt
        ? `Você deriva ${drifting(d.vL, "pt")} a ${f3(Math.hypot(...d.vL))} m/s. Soltar os controles não para a nave: ${ctl.charAt(0).toLowerCase() + ctl.slice(1)} para anular a deriva.`
        : m
          ? `You are drifting ${drifting(d.vL, "en")} at ${f3(Math.hypot(...d.vL))} m/s. Letting go does not stop you: ${ctl.charAt(0).toLowerCase() + ctl.slice(1)} to cancel the drift.`
          : "",
      m ? (pt ? `Deriva ${f3(Math.hypot(...d.vL))} m/s.` : `Drift ${f3(Math.hypot(...d.vL))} m/s.`) : "",
    ],
    lateralWait: [
      pt ? "DESLIZANDO PARA O EIXO — AGUARDE" : "SLIDING ONTO THE AXIS — WAIT",
      m && pt
        ? `A porta vai para o centro a ${f3(Math.hypot(...d.vL))} m/s. Aguarde; quando o ponto ciano chegar ao centro, anule a deriva.`
        : m
          ? `The port is moving to the centre at ${f3(Math.hypot(...d.vL))} m/s. Wait; when the cyan dot reaches the centre, cancel the drift.`
          : "",
      pt ? "Aguarde." : "Wait.",
    ],
    brake: [
      pt ? "VELOCIDADE ALTA — FREIE AGORA" : "CLOSING VELOCITY HIGH — BRAKE NOW",
      m && pt
        ? `Aproximação a ${f3(m.closing)} m/s, acima do seguro (${f3(d.lim)}) a ${m.axial.toFixed(1)} m. ${ctl} (RCS de ré) até baixar.`
        : m
          ? `Closing at ${f3(m.closing)} m/s, above the safe ${f3(d.lim)} at ${m.axial.toFixed(1)} m. ${ctl} (reverse RCS) until it drops.`
          : "",
      m ? `${f3(m.closing)} > ${f3(d.lim)} m/s.` : "",
    ],
    slow: [
      pt ? "REDUZA A VELOCIDADE DE APROXIMAÇÃO" : "REDUCE CLOSING VELOCITY",
      m && pt
        ? `Aplique RCS de ré para desacelerar: ${ctl.charAt(0).toLowerCase() + ctl.slice(1)}. A nave segue se movendo depois que você solta: é a inércia. Mire em ~${f3(d.want)} m/s.`
        : m
          ? `Apply reverse RCS thrust to slow your approach: ${ctl.charAt(0).toLowerCase() + ctl.slice(1)}. You keep moving after you let go: that is inertia. Aim for about ${f3(d.want)} m/s.`
          : "",
      m ? (pt ? `Para ~${f3(d.want)} m/s.` : `To ~${f3(d.want)} m/s.`) : "",
    ],
    backoff: [
      pt ? "FORA DO ENVELOPE — RECUE" : "OUTSIDE THE DOCKING ENVELOPE — BACK OFF",
      pt
        ? `Perto demais sem estar alinhado. ${ctl} para recuar alguns metros, corrija o alinhamento e venha de novo.`
        : `Too close without being lined up. ${ctl} to back away a few metres, fix the alignment, then come in again.`,
      pt ? "Recue." : "Back off.",
    ],
    begin: [
      pt ? "ALINHAMENTO CONFIRMADO — INICIE A APROXIMAÇÃO LENTA" : "ALIGNMENT CONFIRMED — BEGIN SLOW APPROACH",
      m && pt
        ? `${ctl} uma ou duas vezes: mire em ~${f3(d.want)} m/s, nunca acima de ${f3(d.lim)}.`
        : m
          ? `${ctl} once or twice: aim for about ${f3(d.want)} m/s, never above ${f3(d.lim)}.`
          : "",
      m ? (pt ? `Para ~${f3(d.want)} m/s.` : `To ~${f3(d.want)} m/s.`) : "",
    ],
    latch: [
      pt ? "LENTO DEMAIS PARA TRAVAR — AVANCE" : "TOO SLOW TO LATCH — CLOSE IN",
      m && pt ? `A trava precisa de pelo menos ${f3(DOCKING[difficulty].tol.vMin)} m/s no contato. ${ctl} uma vez.` : m ? `The latches need at least ${f3(DOCKING[difficulty].tol.vMin)} m/s at contact. ${ctl} once.` : "",
      m ? `≥ ${f3(DOCKING[difficulty].tol.vMin)} m/s.` : "",
    ],
    opening: [
      pt ? "DISTÂNCIA AUMENTANDO — CORRIJA O MOVIMENTO" : "TARGET DISTANCE INCREASING — CORRECT RELATIVE MOTION",
      m && pt ? `Você se afasta a ${f3(-m.closing)} m/s. ${ctl} para parar o afastamento.` : m ? `You are moving away at ${f3(-m.closing)} m/s. ${ctl} to stop the opening.` : "",
      m ? (pt ? `Afastando ${f3(-m.closing)} m/s.` : `Opening ${f3(-m.closing)} m/s.`) : "",
    ],
    good: [
      pt ? "BOM ALINHAMENTO — MANTENHA A APROXIMAÇÃO CONTROLADA" : "GOOD ALIGNMENT — MAINTAIN CONTROLLED APPROACH",
      m && pt
        ? `Liberado para a aproximação. Mãos fora dos controles, a menos que algo derive: ${f3(m.closing)} m/s, ${m.axial.toFixed(1)} m.`
        : m
          ? `Cleared for the approach. Hands off unless something drifts: ${f3(m.closing)} m/s, ${m.axial.toFixed(1)} m to go.`
          : "",
      pt ? "Liberado." : "Cleared.",
    ],
    standby: [
      pt ? "AGUARDE O CONTATO" : "STAND BY FOR CONTACT",
      pt ? "Firme: sem comandos. A sonda está entrando no cone." : "Hold steady: no inputs. The probe is about to enter the drogue.",
      pt ? "Firme." : "Steady.",
    ],
    stable: [pt ? "MOVIMENTO RELATIVO ESTABILIZADO" : "RELATIVE MOTION STABILIZED", pt ? "Tudo dentro dos limites. Mantenha." : "Everything within limits. Hold it.", ""],
    settle: [pt ? "DEIXE ESTABILIZAR — AGUARDE" : "LET IT SETTLE — WAIT", pt ? "A última correção ainda está agindo. Aguarde um instante antes da próxima." : "The last correction is still taking effect. Wait a moment before the next.", ""],
    capture: [pt ? "CONTATO — CAPTURA" : "CONTACT — CAPTURE", pt ? "Sonda travada, recolhendo. Mantenha-se parado." : "Probe latched and retracting. Hold still.", ""],
    docked: [pt ? "ACOPLAMENTO FIRME CONFIRMADO" : "HARD DOCK CONFIRMED", "", ""],
    noProp: [
      pt ? "PROPELENTE DO RCS ESGOTADO" : "RCS PROPELLANT DEPLETED",
      pt ? "Sem RCS para corrigir. Use REINICIAR DOCKING para tentar de novo com os tanques cheios." : "No RCS left to correct anything. Use RESTART DOCKING to try again with full tanks.",
      "",
    ],
    failed: [pt ? "TENTATIVA ENCERRADA" : "ATTEMPT ENDED", pt ? "Use REINICIAR DOCKING para voltar ao ponto de aproximação." : "Use RESTART DOCKING to go back to the approach checkpoint.", ""],
  };
  const C = {
    acquired: pt ? "ALVO ADQUIRIDO" : "TARGET ACQUIRED",
    braked: pt ? "VELOCIDADE ABAIXO DO LIMITE" : "CLOSING VELOCITY UNDER THE LIMIT",
    slowed: pt ? "VELOCIDADE DE APROXIMAÇÃO REDUZIDA" : "CLOSING VELOCITY REDUCED",
    backingOff: pt ? "RECUANDO" : "BACKING OFF",
    approachStarted: pt ? "APROXIMAÇÃO EM ANDAMENTO" : "APPROACH UNDER WAY",
    openingStopped: pt ? "AFASTAMENTO CONTIDO" : "OPENING STOPPED",
    driftStopped: pt ? "MOVIMENTO RELATIVO ESTABILIZADO" : "RELATIVE MOTION STABILIZED",
    attAligned: pt ? "ATITUDE ALINHADA" : "ATTITUDE ALIGNED",
    rotStopped: pt ? "ROTAÇÃO PARADA" : "ROTATION STOPPED",
  };
  const row = T[g.key] || T.stable;
  const title = row[0];
  const detail = level === 2 ? row[1] : level === 1 ? row[2] : "";
  // the telemetry behind the instruction (one short line)
  let support = "";
  if (m) {
    if (["brake", "slow", "begin", "latch", "opening", "backoff", "good", "standby"].includes(g.key))
      support = pt ? `DIST ${m.axial.toFixed(m.axial < 10 ? 2 : 1)} m · APROX ${f3(m.closing)} m/s` : `RANGE ${m.axial.toFixed(m.axial < 10 ? 2 : 1)} m · CLOSING ${f3(m.closing)} m/s`;
    else if (["align", "drift", "lateralWait"].includes(g.key))
      support = `${pt ? "PORTA" : "PORT"} ${m.offset[0] >= 0 ? "R" : "L"}${f2(m.offset[0])} ${m.offset[1] >= 0 ? "U" : "D"}${f2(m.offset[1])} m · LAT ${f3(Math.hypot(...d.vL))} m/s`;
    else if (["att", "rot", "attWait", "autoAlign"].includes(g.key)) support = `P ${dg(m.pitch)}° · Y ${dg(m.yaw)}° · R ${dg(m.roll)}° · ${dg(d.rate || 0)}°/s`;
  }
  if (g.key === "capture") {
    const pct = Math.round((d.retract || 0) * 100);
    support = pt ? `✓ CONTATO · ✓ CAPTURA · RECOLHENDO ${pct}% · ${pct >= 100 ? "✓" : "◌"} ACOPLAMENTO FIRME` : `✓ CONTACT · ✓ CAPTURE · RETRACTING ${pct}% · ${pct >= 100 ? "✓" : "◌"} HARD DOCK`;
  }
  return {
    title,
    detail,
    control: ctl,
    support,
    confirm: g.confirm ? C[g.confirm] : null,
    stepName: STEP_NAMES[L][g.step - 1],
    authorized: g.key === "good" || g.key === "standby" || g.key === "begin" || g.key === "latch",
  };
}

/**
 * A student pilot (tests, validation tooling): it does only what the guidance panel
 * says, the way a player would — the MODE switch when asked, one tap of the named
 * buttons, then a pause to see what the tap did (its reaction time and one more
 * pulse) — and nothing while the panel says to wait or shows a confirmation.
 * If it docks, the instructions alone are enough to dock.
 */
export function guidedPilot(difficulty = "ASTRONAUT", { lag = 0.25, align = DOCKING[difficulty].autoAlign } = {}) {
  const g = createGuidance(difficulty);
  let mode = "TRANSLATION";
  let next = -Infinity;
  const idle = { t: [0, 0, 0], r: [0, 0, 0] };
  const log = [];
  const pilot = (s) => {
    if (s.t < next - 1e-9 && log.length && s.t < log[log.length - 1].t) next = -Infinity; // a restart
    const out = g.update(s, { mode, align });
    log.push({ t: s.t, key: out.key, pri: out.pri, brakes: out.brakes, buttons: out.buttons.slice(), confirm: out.confirm, step: out.step });
    if (!out.buttons.length || out.confirm) return idle;
    if (out.needMode) {
      mode = out.mode; // one press of MODE
      return idle;
    }
    if (s.t < next) return idle;
    next = s.t + lag + 2 * PULSE;
    return commandOf(out.buttons);
  };
  pilot.log = log;
  pilot.guidance = g;
  return pilot;
}

/** The mission-control call (data/commsLines) that goes with an instruction, if any. */
export const GUIDANCE_VOICE = {
  acquire: "dock.g.acquired",
  brake: "dock.g.reduce",
  slow: "dock.g.reduce",
  align: "dock.g.offAxis",
  drift: "dock.g.offAxis",
  att: "dock.g.attitude",
  backoff: "dock.g.backoff",
  opening: "dock.g.opening",
  begin: "dock.g.alignGood",
  good: "dock.g.continue",
  standby: "dock.g.standby",
};
