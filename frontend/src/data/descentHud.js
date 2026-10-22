/*
 * The descent display under the parachutes (pure; drawn by ReentryGame).
 *
 * Once the drogues are out, the entry guidance is over: the parachutes carry no lift, so the
 * bank, the roll, the flight-path angle and the entry corridor no longer mean anything
 * (data/reentryPhysics: lift = 0 under the chutes). What the crew watches now is how high they
 * are, how fast they come down, the parachutes, the capsule, and the splashdown checklist.
 * Everything here is read from the simulation's state; nothing is decided by it.
 */
import { CHUTES } from "./reentryPhysics";

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** Apollo's splashdown preparation under the parachutes, in the order the crew ran it. */
export const SPLASH_PREP = [
  { id: "drogues", label: "DROGUES DEPLOYED" },
  { id: "mains", label: "MAINS 3/3 OPEN" },
  { id: "beacon", label: "VHF RECOVERY BEACON ON" },
  { id: "rcs", label: "RCS PROPELLANT DUMPED" },
  { id: "release", label: "MAIN RELEASE ARMED" },
  { id: "brace", label: "BRACE FOR SPLASHDOWN" },
];

/**
 * The descent readout, or null before the drogues (the entry display is still the right one).
 * Input (sim units): h (m), v (m/s), gamma (rad), sinceDrogue / sinceMain (sim s since each
 * deployment, or null), shield (0..1 of the heat-shield budget used), g.
 */
export function descentHud({ h, v, gamma, sinceDrogue = null, sinceMain = null, shield = 0, g = 1 }) {
  if (sinceDrogue === null && sinceMain === null) return null;
  const vs = Math.max(0, v * Math.sin(-gamma)); // descent rate, m/s (down)
  const mains = sinceMain !== null;
  const inflate = mains ? clamp01(sinceMain / CHUTES.main.inflateTime) : clamp01(sinceDrogue / CHUTES.drogue.inflateTime);
  const full = inflate >= 1;
  const chute = mains
    ? { name: "MAINS", count: 3, state: full ? "FULL" : "INFLATING", inflate }
    : { name: "DROGUES", count: 2, state: full ? "OPEN" : "INFLATING", inflate, next: `MAINS AT ${(CHUTES.main.maxAlt / 1000).toFixed(1)} KM` };
  // time to the water at the present rate (sim seconds), once the mains are full
  const toSplash = mains && full && vs > 0.5 ? Math.max(0, h) / vs : null;
  const state = (done, active = false) => (done ? "done" : active ? "active" : "pending");
  const prep = {
    drogues: state(true),
    mains: state(mains && full, mains),
    beacon: state(mains && sinceMain > 10, mains && sinceMain > 4),
    rcs: state(mains && sinceMain > 28, mains && sinceMain > 10),
    release: state(mains && h < 1000, mains && h < 1500),
    brace: state(false, mains && h < 150),
  };
  const capsule = shield >= 0.8 || g > 4 ? "CHECK" : "NOMINAL";
  return { vs, chute, toSplash, prep: SPLASH_PREP.map((p) => ({ ...p, state: prep[p.id] })), capsule, shieldPct: Math.round(shield * 100), g };
}

/** "1,820 m" / "640 m" / "45 m" */
export const formatAlt = (h) => `${Math.max(0, Math.round(h)).toLocaleString("en-US")}`;
/** "T−02:41" */
export const formatToSplash = (s) => (s === null ? "--:--" : `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`);
