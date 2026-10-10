/*
 * LUNAVIA — lunar descent comms, driven by telemetry.
 *
 * Called with the same live values the descent HUD shows; returns the calls
 * Mission Control would make now. Warnings come from the shared descent
 * assessment (descentProfile.assessDescent), so the voice never contradicts
 * the HUD. A condition must hold for a moment before it is called (no
 * chatter on a one-frame spike), and every warning re-checks itself just
 * before it is spoken. Verbosity, cooldowns and the radio channel are the
 * director's job; this module only decides what is worth saying.
 *
 * d = { t, alt, vx, xPos, profile, hazard, distanceToLZ, outcome }
 *     outcome: null | "landed" | "crashed"
 * Returns [{ id, delay?, relevant? }].
 */
import { OK, CAUTION, DANGER } from "../data/descentProfile";

export function createDescentMonitor() {
  let latest = null;
  let prevAlt = null;
  let ended = false;
  let warned = false;
  const fired = new Set();
  const since = {};

  const once = (key) => (fired.has(key) ? false : (fired.add(key), true));
  // true once `cond` has held for `hold` seconds
  const held = (key, cond, t, hold) => {
    if (!cond) {
      delete since[key];
      return false;
    }
    if (since[key] === undefined) since[key] = t;
    return t - since[key] >= hold;
  };
  const live = (fn) => () => !ended && latest && fn(latest);

  return function update(d) {
    if (!d || ended) return [];
    latest = d;
    const out = [];
    const p = d.profile;

    if (d.outcome) {
      ended = true;
      if (d.outcome === "landed") out.push({ id: "descent.touchdown", delay: 0.7 }, { id: "descent.touchdownFlight", delay: 0.2 });
      else out.push({ id: "descent.crash", delay: 1.4 }, { id: "descent.crashFlight", delay: 0.3 });
      return out;
    }

    const crossed = (h) => prevAlt !== null && prevAlt > h && d.alt <= h;
    const near = (h) => live((x) => x.alt > h * 0.55);
    if (crossed(500)) out.push({ id: "descent.goLanding", relevant: near(500) });
    if (crossed(200) && once("a200")) {
      if (p.vyState === OK) out.push({ id: "descent.alt200good", relevant: near(200) });
      else if (p.vyState === CAUTION) out.push({ id: "descent.alt200", relevant: near(200) });
    }
    if (crossed(100) && once("a100")) {
      if (p.fuelState === OK) out.push({ id: "descent.alt100fuelGood", relevant: near(100) });
      else if (p.fuelState === CAUTION) out.push({ id: "descent.alt100fuelTight", relevant: near(100) });
    }
    if (crossed(30) && p.vyState < DANGER && once("a30")) out.push({ id: "descent.alt30", relevant: near(30) });
    if (crossed(4) && once("contact")) out.push({ id: "descent.contact" });
    prevAlt = d.alt;

    // Descent rate: too fast for the height left
    if (held("vy", p.vyState === DANGER && d.alt > 4, d.t, 0.35)) {
      out.push({ id: "descent.rateHigh", relevant: live((x) => x.profile.vyState >= CAUTION && x.alt > 4) });
      warned = true;
    }
    // Braking burn due now (still coasting)
    if (Number.isFinite(p.brakeTime) && p.brakeTime < 1 && !p.burning && d.alt > 30) {
      out.push({ id: "descent.brakeNow", relevant: live((x) => !x.profile.burning) });
    }
    // Lateral drift that the remaining time can barely null
    if (held("vx", p.vxState >= CAUTION && d.alt > 3, d.t, 0.6)) {
      out.push({ id: "descent.drift", relevant: live((x) => x.profile.vxState >= CAUTION) });
      warned = true;
    }
    // Moving away from the landing zone while there is height to fix it
    const away = d.distanceToLZ > 25 && Math.sign(d.vx) === Math.sign(d.xPos) && Math.abs(d.vx) > 0.8 && d.alt > 60;
    if (held("away", away, d.t, 1.5)) out.push({ id: "descent.driftAway", relevant: live((x) => x.distanceToLZ > 20) });
    // Projected touchdown on rough ground
    if (held("hazard", d.hazard && d.alt > 8, d.t, 0.6)) {
      out.push({ id: "descent.hazard", relevant: live((x) => x.hazard) });
      warned = true;
    }
    // Fuel: status calls, once each
    if (p.fuelState === CAUTION && once("fuelTight")) out.push({ id: "descent.fuelTight", relevant: live((x) => x.profile.fuelState >= CAUTION) });
    if (p.fuelState === DANGER && once("fuelCritical")) out.push({ id: "descent.fuelCritical", relevant: live((x) => x.alt > 2) });
    // Attitude: the onboard computer's alarm
    if (held("tilt", p.tiltState === DANGER, d.t, 0.3)) out.push({ id: "descent.attitude", relevant: live((x) => x.profile.tiltState >= CAUTION) });

    // After a warning, a word when the descent is back under control
    const calm = p.vyState === OK && p.vxState === OK && p.tiltState === OK && !d.hazard;
    if (warned && held("calm", calm, d.t, 2.5) && d.alt > 15) {
      warned = false;
      out.push({ id: "descent.steady", relevant: live((x) => x.profile.vyState === OK && x.profile.vxState === OK) });
    }
    return out;
  };
}
