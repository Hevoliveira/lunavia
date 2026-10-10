/*
 * LV-001 Earth departure: the automatic launch cinematic as data.
 *
 * Everything runs on one cinematic clock `t` (seconds since the sequence
 * starts at T-15). The countdown and the first seconds of flight run in real
 * time; documentary cuts then compress the flight, and the mission clock
 * (MET) jumps across them, as a broadcast would. No step needs player input.
 *
 * Two scales are used for rendering (see LaunchCinematic):
 *  - PAD regime: true scale around the pad, 1 scene unit = 30 m. The vehicle
 *    (104 m) rises out of the complex at pad scale.
 *  - FLIGHT regime: the vehicle stays at its own scale near the origin while
 *    sky, clouds and planet are drawn in an environment layer that follows
 *    this trajectory at true scale, so the vehicle is never oversized
 *    against the Earth.
 */

export const UNIT_M = 30; // metres per pad-scale scene unit
export const LIFTOFF_T = 15; // countdown starts at T-15
export const DURATION = 108;

// Camera shots, in order. Hard cuts between shots, smooth motion within.
export const SHOTS = [
  { id: "wide", start: 0, end: 4, regime: "pad", name: "LAUNCH COMPLEX 39" },
  { id: "lowAngle", start: 4, end: 7.5, regime: "pad", name: "LV-001 ON THE PAD" },
  { id: "engines", start: 7.5, end: 14.2, regime: "pad", name: "ENGINE SECTION" },
  { id: "trench", start: 14.2, end: 19, regime: "pad", name: "FLAME TRENCH" },
  { id: "tower", start: 19, end: 25, regime: "pad", name: "TOWER CLEARANCE" },
  { id: "wideAscent", start: 25, end: 32, regime: "pad", name: "ASCENT" },
  { id: "highAlt", start: 32, end: 43, regime: "flight", name: "ATMOSPHERIC ASCENT" },
  { id: "meco", start: 43, end: 46.5, regime: "flight", name: "MAIN ENGINE CUTOFF" },
  { id: "sepJoint", start: 46.5, end: 49.5, regime: "flight", name: "SEPARATION PLANE" },
  { id: "stages", start: 49.5, end: 53, regime: "flight", name: "STAGE SEPARATION" },
  { id: "stage1Cam", start: 53, end: 57, regime: "flight", name: "ONBOARD · STAGE 1 CAMERA" },
  { id: "usIgnition", start: 57, end: 61, regime: "flight", name: "UPPER STAGE" },
  { id: "limb", start: 61, end: 65, regime: "flight", name: "LEAVING THE ATMOSPHERE" },
  { id: "orbitWide", start: 65, end: 70.5, regime: "flight", name: "EARTH ORBIT" },
  { id: "orbitClose", start: 70.5, end: 75.5, regime: "flight", name: "PARKING ORBIT · 185 KM" },
  { id: "orbitLimb", start: 75.5, end: 80, regime: "flight", name: "ATMOSPHERIC LIMB" },
  // The finale: the last Earth pass, preparation in darkness, a held breath,
  // ignition at sunrise, then the vehicle leaving and the Earth receding.
  { id: "finalPass", start: 80, end: 85.5, regime: "flight", name: "FINAL EARTH PASS" },
  { id: "tliPrep", start: 85.5, end: 89.5, regime: "flight", name: "TLI PREPARATION" },
  { id: "tliCount", start: 89.5, end: 92.5, regime: "flight", name: "GO FOR TLI" },
  { id: "tli", start: 92.5, end: 99, regime: "flight", name: "TRANSLUNAR INJECTION" },
  { id: "departure", start: 99, end: 103.5, regime: "flight", name: "LEAVING EARTH ORBIT" },
  { id: "farewell", start: 103.5, end: DURATION, regime: "flight", name: "LUNAR TRANSFER" },
];

// Mission events. Captions describe what happens; none of them waits for input.
export const EVENTS = [
  { t: 1.0, id: "venting" },
  { t: 7.4, id: "sparklers" },
  { t: 8.5, id: "engineStart", caption: "MAIN ENGINE START", sub: "FIVE-ENGINE CLUSTER · STAGGERED START" },
  { t: 11.6, id: "fullThrust" },
  { t: LIFTOFF_T, id: "liftoff", caption: "LIFTOFF", sub: "HOLD-DOWN ARMS RELEASED" },
  { t: 22.6, id: "towerClear", caption: "TOWER CLEARED", sub: "ROLL AND PITCH PROGRAM" },
  { t: 34, id: "maxQ", caption: "MAX-Q", sub: "MAXIMUM AERODYNAMIC PRESSURE" },
  { t: 44, id: "meco", caption: "MAIN ENGINE CUTOFF", sub: "STAGE 1 BURNOUT · 65 KM" },
  { t: 47, id: "separation", caption: "STAGE SEPARATION", sub: "SEPARATION MOTORS FIRING" },
  { t: 54.5, id: "usIgnition", caption: "UPPER STAGE IGNITION", sub: "VACUUM ENGINE · THRUST NOMINAL" },
  { t: 65, id: "orbit", caption: "EARTH ORBIT", sub: "UPPER STAGE CUTOFF · 185 KM PARKING ORBIT", kicker: "EARTH ORBIT · REV 1" },
  { t: 80.3, id: "finalPass", caption: "FINAL EARTH PASS", sub: "LAST SUNSET IN EARTH ORBIT · TLI ON THE NEXT REVOLUTION", kicker: "EARTH ORBIT · REV 1" },
  { t: 85.7, id: "tliPrep", caption: "TLI PREPARATION", sub: "NIGHT PASS · ROLL TO BURN ATTITUDE", kicker: "EARTH ORBIT · REV 2" },
  { t: 89.6, id: "tliCount" },
  { t: 92.6, id: "tli", caption: "TRANSLUNAR INJECTION", sub: "UPPER STAGE RESTART AT SUNRISE · Δv 3.1 KM/S", kicker: "DEPARTURE FOR THE MOON" },
  { t: 100, id: "tliCutoff" },
  { t: 100.3, id: "lunarTransfer", caption: "LUNAR TRANSFER", sub: "TLI CUTOFF · ON COURSE FOR THE MOON · 3-DAY COAST", kicker: "DEPARTURE FOR THE MOON" },
];

export const eventTime = (id) => EVENTS.find((e) => e.id === id).t;

export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const smooth = (x) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

export function shotAt(t) {
  for (let i = SHOTS.length - 1; i >= 0; i--) if (t >= SHOTS[i].start) return SHOTS[i];
  return SHOTS[0];
}

/* Monotone cubic (Fritsch–Carlson) through [t, v] keys: smooth, no overshoot. */
function monotone(keys) {
  const n = keys.length;
  const xs = keys.map((k) => k[0]);
  const ys = keys.map((k) => k[1]);
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      m[i] = k * a * d[i];
      m[i + 1] = k * b * d[i];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const u = (x - xs[i]) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * ys[i + 1] + (u3 - u2) * h * m[i + 1];
  };
}

// Flight regime keys (cinematic seconds → value)
const ALT_ASCENT = monotone([
  [32, 9], [35, 14], [43, 58], [47, 68], [54.5, 84], [57, 95], [61, 125], [65, 185],
  [92.6, 185], [96, 230], [99, 320], [100, 340], [103.5, 370],
]);
// The last cut jumps ~20 min ahead: the spacecraft is already 6 000 km out
// and the Earth recedes to a half-lit globe as the shot runs.
const FAREWELL = 103.5;
const ALT_KM = (t) => (t < FAREWELL ? ALT_ASCENT(t) : 6000 * Math.exp(0.317 * (t - FAREWELL)));
// Leaving orbit the trajectory climbs away from the Earth, so the vehicle,
// following its velocity, pitches up from the local horizontal.
const PITCH_DEG = monotone([[32, 24], [43, 58], [47, 62], [54.5, 66], [65, 88], [85, 90], [99, 92]]);
const pitchDeg = (t) => (t < 99 ? PITCH_DEG(t) : 78);
const SPEED_KMPS = monotone([
  [32, 0.35], [35, 0.45], [43, 2.1], [44, 2.3], [54.5, 2.4], [65, 7.8], [92.6, 7.8],
  [100, 10.8], [103.5, 10.2], [105, 8.4], [108, 5.4],
]);

/*
 * Ascent: one continuous downrange curve. In orbit every shot is a separate
 * moment of the parking orbit (the cuts jump ahead along it, as the mission
 * clock does), and within a shot the ground moves at 3-4x real speed so the
 * orbital motion reads without blurring. Positions are the angle travelled
 * round the orbit from the launch site (deg): insertion over the Atlantic,
 * the West African coast and the Sahel in daylight, orbital sunset over the
 * Indian Ocean, and TLI at sunrise over the Pacific on the second orbit.
 */
const DOWNRANGE_ASCENT = monotone([[32, 1.5], [43, 55], [47, 75], [54.5, 130], [61, 330], [65, 800]]);
const ORBIT_ARC = [
  // shot start, angle at start (deg), angular rate (deg/s), MET at start (s), MET rate
  { t: 65, a: 7.2, rate: 0.2, met: 600, metRate: 15 },
  { t: 70.5, a: 57, rate: 0.25, met: 1330, metRate: 15 },
  { t: 75.5, a: 72, rate: 0.2, met: 1550, metRate: 15 },
  // Final pass: sunset on the vehicle (157.5 deg at 185 km) as the shot ends
  { t: 80, a: 150, rate: 1.33, met: 2700, metRate: 20 },
  // Second revolution: night pass, then sunrise on the vehicle at 665.2 deg
  { t: 85.5, a: 659.5, rate: 0.8, met: 10050, metRate: 15 },
  { t: 89.5, a: 663.4, rate: 0.6, met: 10200, metRate: 15 },
  // The burn carries the vehicle out of the night: the terminator sweeps
  // beneath it and the Earth ahead lights up while the engine runs.
  { t: 92.5, a: 665.25, rate: 2.0, met: 10260, metRate: 50 },
  { t: 99, a: 678.6, rate: 0.4, met: 10600, metRate: 30 },
  { t: 103.5, a: 690, rate: 0.6, met: 11000, metRate: 220 },
];
function orbitSeg(t) {
  let seg = ORBIT_ARC[0];
  for (const s of ORBIT_ARC) if (t >= s.t) seg = s;
  return seg;
}
export function downrangeAt(t) {
  if (t < 65) return DOWNRANGE_ASCENT(t);
  const s = orbitSeg(t);
  return ((s.a + s.rate * (t - s.t)) * Math.PI / 180) * 6371;
}

// Mission elapsed time shown on screen. Real time through the countdown and
// the first seconds of flight; broadcast-style jumps at the cuts after that.
const MET_ASCENT = monotone([[32, 58], [34, 72], [43, 148], [44, 150], [47, 152], [54.5, 158], [61, 300], [65, 600]]);
export function metAt(t) {
  if (t < 32) return t - LIFTOFF_T;
  if (t < 65) return MET_ASCENT(t);
  const s = orbitSeg(t);
  return s.met + s.metRate * (t - s.t);
}

export function formatMet(s) {
  const sign = s < 0 ? "T-" : "T+";
  const a = Math.abs(Math.round(s));
  const h = Math.floor(a / 3600);
  const m = Math.floor((a % 3600) / 60);
  const sec = a % 60;
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/* Pad regime: height of the vehicle above its hold-down position, in scene
 * units. Thrust-to-weight ~1.4 at liftoff: a slow, heavy rise that clears the
 * tower ~7.6 s after release, then accelerates as propellant burns off. */
export function padHeight(t) {
  const tau = Math.max(0, t - LIFTOFF_T);
  return 0.072 * tau * tau + 0.0002 * tau ** 4;
}

// Pitch (radians from vertical) in the pad regime: vertical until T+10 s.
export function padPitch(t) {
  const tau = t - LIFTOFF_T;
  return (8 * Math.PI) / 180 * smooth((tau - 10) / 7);
}

// Sideways drift (downrange, +X) from the pitch program in the pad regime.
export function padDownrange(t) {
  const tau = t - LIFTOFF_T;
  if (tau <= 10) return 0;
  return (padHeight(t) - padHeight(LIFTOFF_T + 10)) * Math.tan(padPitch(t)) * 0.5;
}

/* Small elastic lean of the stack at engine start (the "twang"): the off-axis
 * thrust build-up bends the vehicle against the hold-downs; it returns upright
 * at release. Radians about the downrange axis. */
export function twang(t) {
  const a = smooth((t - 8.6) / 2.4) * (1 - smooth((t - 12.2) / 2.6));
  return -0.0055 * a;
}

export function trajectoryAt(t) {
  if (t < 32) {
    const h = padHeight(t);
    return {
      regime: "pad",
      altKm: (h * UNIT_M) / 1000,
      downrangeKm: (padDownrange(t) * UNIT_M) / 1000,
      pitch: padPitch(t),
      speedKmps: t > LIFTOFF_T ? ((0.144 * (t - LIFTOFF_T) + 0.0008 * (t - LIFTOFF_T) ** 3) * UNIT_M) / 1000 : 0,
    };
  }
  return {
    regime: "flight",
    altKm: ALT_KM(t),
    downrangeKm: downrangeAt(t),
    pitch: (pitchDeg(t) * Math.PI) / 180,
    roll: rollAt(t),
    speedKmps: SPEED_KMPS(t),
  };
}

// Roll about the vehicle axis (rad): the attitude manoeuvre to the TLI burn
// attitude, flown on RCS during the night pass before the burn.
export function rollAt(t) {
  return Math.PI * smooth((t - 86) / 3);
}

// RCS firings that start and stop the roll, and the ullage motors that settle
// the propellant before the TLI restart.
export const RCS_WINDOWS = [[86, 86.8], [88.3, 89.1]];
export const ULLAGE = [91.0, 92.65];

// TLI ignition countdown shown in the anticipation shot (3, 2, 1), else null.
export function tliCountdown(t) {
  const ign = eventTime("tli");
  return t >= ign - 3 && t < ign ? Math.ceil(ign - t) : null;
}

/*
 * Where the vehicle is on its orbit, for the small orbit diagram: revolution
 * number and the angle from the sub-solar point (deg, +90 = sunset side).
 */
const SUBSOLAR_DEG = (Math.atan2(10, 8) * 180) / Math.PI;
export function orbitPhase(t) {
  const a = (downrangeAt(t) / 6371) * (180 / Math.PI);
  return {
    rev: Math.floor(a / 360) + 1,
    phi: ((a - SUBSOLAR_DEG) % 360 + 360) % 360,
    tliPhi: (((downrangeAt(eventTime("tli")) / 6371) * (180 / Math.PI) - SUBSOLAR_DEG) % 360 + 360) % 360,
  };
}

// Relative air density (exponential atmosphere, 8 km scale height).
export const airDensity = (altKm) => Math.exp(-Math.max(0, altKm) / 8);

/* Engine schedules ------------------------------------------------------ */

const ENGINE_START = 8.5;
const MECO = 44;
const SEP = 47;
const US_IGNITION = 54.5;
const SECO = 65;
const TLI = 92.6;
const TLI_CUTOFF = 100;

// Per-engine stage 1 thrust (centre engine first, outboard pairs 0.25 s apart).
export function stage1EngineThrust(t, out = [0, 0, 0, 0, 0]) {
  for (let i = 0; i < 5; i++) {
    const start = ENGINE_START + (i === 0 ? 0 : 0.25 * Math.ceil(i / 2) + 0.05 * i);
    const up = clamp01((t - start) / 1.6);
    // Shutdown transient: thrust tails off in ~0.6 s
    const down = t < MECO ? 1 : Math.max(0, 1 - (t - MECO) / 0.6) ** 2;
    out[i] = up * up * (3 - 2 * up) * down;
  }
  return out;
}

export function stage1Thrust(t) {
  const e = stage1EngineThrust(t);
  return (e[0] + e[1] + e[2] + e[3] + e[4]) / 5;
}

// Residual glow of the stage 1 nozzles after shutdown (cooling over ~5 s).
export function stage1Glow(t) {
  if (t < MECO) return stage1Thrust(t);
  return Math.exp(-(t - MECO) / 1.8);
}

export function upperThrust(t) {
  const burn = (t0, t1) => clamp01((t - t0) / 0.7) * (t < t1 ? 1 : Math.max(0, 1 - (t - t1) / 0.5));
  if (t < SECO + 1) return burn(US_IGNITION, SECO);
  return burn(TLI, TLI_CUTOFF);
}

/* Separation progress handed to RocketModel (0 = mated). The joint opens and
 * the separation motors fire in the first second; the gap then grows slowly
 * until the upper stage lights, and quickly once it is under thrust. */
export function sepProgress(t) {
  if (t < SEP) return 0;
  if (t < SEP + 1) return 0.14 * (t - SEP);
  if (t < US_IGNITION) return 0.14 + (0.42 - 0.14) * ((t - SEP - 1) / (US_IGNITION - SEP - 1));
  if (t < 58.5) return 0.42 + 0.58 * ((t - US_IGNITION) / (58.5 - US_IGNITION));
  return 1 + (t - 58.5) * 0.28;
}

// The spent stage is seen receding through the upper-stage ignition shot,
// then is out of the picture.
export const stage1Visible = (t) => t < 61;

/*
 * Sunlight on the vehicle. The Sun is fixed in the Earth frame (SUN_DIR, the
 * same direction the pad scene is lit from), so as the vehicle travels round
 * the orbit the local Sun elevation changes, and the vehicle - higher than
 * the ground - keeps the Sun until it sinks below the limb (horizon dip).
 * Returns { elev, dip (rad), lit 0..1, red 0..1 (sunset reddening) }.
 */
export const SUN_DIR = (() => {
  const l = Math.hypot(10, 8, 8);
  return [10 / l, 8 / l, 8 / l];
})();
export function sunAt(t) {
  const tr = trajectoryAt(t);
  const th = tr.downrangeKm / 6371;
  const up = [Math.sin(th), Math.cos(th), 0];
  const elev = Math.asin(up[0] * SUN_DIR[0] + up[1] * SUN_DIR[1]);
  const dip = Math.acos(6371 / (6371 + Math.max(0, tr.altKm)));
  const above = (elev + dip) * (180 / Math.PI); // Sun height above the limb, deg
  return { elev, dip, lit: smooth((above + 0.4) / 0.8), red: 1 - smooth((above - 0.3) / 4) };
}

/* Validation helper: the order of required mission milestones. */
export const MILESTONES = ["engineStart", "liftoff", "towerClear", "maxQ", "meco", "separation", "usIgnition", "orbit", "finalPass", "tliPrep", "tli", "lunarTransfer"];
