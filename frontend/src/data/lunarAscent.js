/*
 * LUNAVIA — lunar liftoff: the ascent stage's first seconds (pure; tested).
 *
 * The ascent engine (≈ 15.6 kN) lifts the ascent stage (≈ 4.8 t at
 * liftoff) off the descent stage, which stays at the landing site as its
 * launch pad. Lunar gravity 1.62 m/s², no air: the stage rises vertically for
 * ten seconds, pitches over towards the direction of flight and keeps
 * accelerating as it burns propellant (the full burn reaches orbit in about
 * seven minutes; the film shows the first ~22 s, then the guidance's orbit
 * insertion). Integrated in metres from ignition; the scene converts.
 */
export const G_MOON = 1.62;
export const ASCENT = {
  thrust: 15600, // N
  mass0: 4800, // kg at liftoff
  isp: 311, // s (vacuum)
  vertical: 10, // s of vertical rise
  pitchEnd: 16, // s: pitchover complete
  pitch: 52, // degrees from vertical after pitchover
  film: 22, // s of liftoff shown
  orbitTime: 434, // s, full ascent burn to orbit insertion
};
const G0 = 9.80665;

/** State at t seconds after ignition: altitude, downrange (m), velocities (m/s), pitch (rad), acceleration. */
export function ascentAt(t, dt = 0.02) {
  let alt = 0;
  let x = 0;
  let vy = 0;
  let vx = 0;
  let m = ASCENT.mass0;
  const mdot = ASCENT.thrust / (ASCENT.isp * G0);
  let pitch = 0;
  let a = 0;
  for (let tt = 0; tt < t - 1e-9; tt += dt) {
    const h = Math.min(dt, t - tt);
    pitch = pitchAt(tt) ;
    a = ASCENT.thrust / m;
    vy += (a * Math.cos(pitch) - G_MOON) * h;
    vx += a * Math.sin(pitch) * h;
    alt += vy * h;
    x += vx * h;
    m -= mdot * h;
  }
  return { t, alt, x, vy, vx, pitch: pitchAt(t), accel: ASCENT.thrust / m, mass: m };
}

/** Pitch from vertical (rad): vertical rise, then a smooth pitchover. */
export function pitchAt(t) {
  if (t <= ASCENT.vertical) return 0;
  const u = Math.min(1, (t - ASCENT.vertical) / (ASCENT.pitchEnd - ASCENT.vertical));
  return ((u * u * (3 - 2 * u)) * ASCENT.pitch * Math.PI) / 180;
}

/** The countdown before ignition (s): systems checks, then 5 … 1, PROCEED. */
export const COUNTDOWN = 6;
