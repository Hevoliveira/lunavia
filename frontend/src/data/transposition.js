/*
 * Transposition, docking and extraction (pure, unit-tested): how the CSM takes
 * the lunar module out of LV-001's adapter, condensed.
 *
 * LUNAVIA flies it in lunar orbit, after the lunar transfer carrier's
 * insertion burn (data/carrier, data/orbitSequence ORBIT_SEQ.deploy), never
 * near the Earth: the lunar module and the CSM stay in the outbound assembly
 * all the way to the Moon.
 *
 * Time tau is seconds since the sequence starts. Positions are in the payload
 * frame (data/payloadDesign, metres): the carrier stays put, the spacecraft
 * move.
 *
 *  0.3 s   pyros: the CSM is free of the adapter, which opens on its hinges
 *  ...     the CSM backs off on its RCS; the four panels swing out and are
 *          jettisoned, uncovering the lunar module standing on the carrier
 *  5-17    the CSM turns round (180°, about +Z) to face the LM
 *  17.5-   it closes in, nose first, until its probe touches the LM's drogue
 *  28.5    capture latches; the probe retracts and pulls the two together
 *  30.8    hard dock: twelve latches
 *  31.5    the LM's mounts release; the docked pair backs away from the carrier
 *  34.5-38 the CSM's high-gain antenna swings out
 *
 * Speeds and turn rates are continuous (no jolt). Each RCS level is set by the
 * acceleration it produces, so the thrusters fire only while something speeds
 * up or slows down.
 */
import { ADAPTER, CSM_MATED, DOCK, LM_STOWED, adapterRadius } from "./payloadDesign";
import { PROBE_L } from "./csmDesign";

export const TD = {
  sep: 0.3,
  // Spring-jettisoned panels (Apollo's left at ~2.4 m/s): they clear the scene well before the docking.
  panels: { open: [0.4, 3.4], release: 3.6, v: 1.6, rise: 0.25, spinDeg: 8 },
  out: { t0: 0.3, t1: 6.0, d: 4.6 },
  pitch: { t0: 5.0, t1: 17.0 },
  approach: { t0: 17.5, t1: 28.5 },
  retract: { t0: 28.5, t1: 30.8 },
  extract: { t0: 31.5, ramp: 3.0, v: 0.9 },
  hga: { t0: 34.5, t1: 38.0 },
  end: 38.0,
  // After the sequence the docked pair keeps backing away at the real 0.9 m/s; a
  // caller showing that time-compressed passes its compression.
  coastCompression: 1,
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};
// Integral of smooth over [0, x] (x in 0..1): the distance covered while speed ramps up.
const smoothInt = (x) => {
  const c = clamp01(x);
  return c * c * c - (c * c * c * c) / 2;
};

/** How far the docked pair has backed away from the carrier (m). */
export function extractionOffset(t, k = TD.coastCompression) {
  const { t0, ramp, v } = TD.extract;
  if (t <= t0) return 0;
  const x = (t - t0) / ramp;
  if (x < 1) return v * ramp * smoothInt(x);
  const atEnd = v * ramp * 0.5 + v * (Math.min(t, TD.end) - t0 - ramp);
  if (t <= TD.end) return atEnd;
  return atEnd + v * k * (t - TD.end);
}

/** Height of the CSM's origin (payload frame, m). */
export function csmY(t) {
  const out = CSM_MATED.y + TD.out.d * smooth((t - TD.out.t0) / (TD.out.t1 - TD.out.t0));
  if (t < TD.approach.t0) return out;
  const start = CSM_MATED.y + TD.out.d;
  if (t < TD.approach.t1) return DOCK.contactY + (start - DOCK.contactY) * (1 - smooth((t - TD.approach.t0) / (TD.approach.t1 - TD.approach.t0)));
  if (t < TD.retract.t1) return DOCK.hardY + PROBE_L * (1 - smooth((t - TD.retract.t0) / (TD.retract.t1 - TD.retract.t0)));
  return DOCK.hardY + extractionOffset(t);
}

/** The CSM's turn about +Z (rad): 0 nose up the vehicle, π nose down at the LM. */
export const csmPitch = (t) => Math.PI * smooth((t - TD.pitch.t0) / (TD.pitch.t1 - TD.pitch.t0));

/** The LM's height (payload frame, m): on its mounts until they release, then with the CSM. */
export const lmY = (t) => LM_STOWED.y + (t >= TD.extract.t0 ? extractionOffset(t) : 0);

/** Each adapter panel: hinge angle out from the closed cone (rad), and its drift after jettison. */
export function panelState(t) {
  const P = TD.panels;
  const open = (ADAPTER.openDeg * Math.PI) / 180;
  if (t < P.release) return { angle: open * smooth((t - P.open[0]) / (P.open[1] - P.open[0])), out: 0, up: 0, attached: true };
  const d = t - P.release;
  return { angle: open + ((P.spinDeg * Math.PI) / 180) * d, out: P.v * d, up: P.rise * d, attached: false };
}

/** The high-gain antenna: 0 folded (launch) → 1 deployed. */
export const hgaDeploy = (t) => smooth((t - TD.hga.t0) / (TD.hga.t1 - TD.hga.t0));

export function phaseAt(t) {
  if (t < TD.sep) return "mated";
  if (t < TD.pitch.t0) return "separation";
  if (t < TD.approach.t0) return "transposition";
  if (t < TD.retract.t0) return "approach";
  if (t < TD.retract.t1) return "capture";
  if (t < TD.extract.t0) return "docked";
  if (t <= TD.end) return "extraction";
  return "coast";
}

const H = 0.02;
const accel = (f, t) => (f(t + H) - 2 * f(t) + f(t - H)) / (H * H);
const A_FULL = 0.25; // m/s² for a full puff
const ALPHA_FULL = 0.05; // rad/s² for a full puff

/**
 * The whole state at tau: positions (payload frame, m), the CSM's turn, the
 * panels, docking status, antenna, and RCS levels 0..1 in the CSM's frame:
 * fwd / aft (thrusters whose exhaust goes towards the nose / the engine) and
 * pitchPos / pitchNeg (the couple that turns the CSM about +Z either way).
 */
export function transposition(t) {
  const theta = csmPitch(t);
  // Thrust along the CSM's own axis: the world acceleration seen in its frame.
  // The probe pulls the two together during retraction (no RCS then).
  const ay = t >= TD.retract.t0 && t < TD.retract.t1 ? 0 : accel(csmY, t);
  const along = ay * Math.cos(theta);
  const alpha = accel(csmPitch, t);
  return {
    phase: phaseAt(t),
    csm: { pos: [0, csmY(t), 0], pitch: theta },
    lm: { pos: [0, lmY(t), LM_STOWED.z], attached: t < TD.extract.t0 ? "adapter" : "csm" },
    docked: t >= TD.retract.t1,
    captured: t >= TD.retract.t0,
    panels: panelState(t),
    hga: hgaDeploy(t),
    rcs: {
      aft: clamp01(along / A_FULL),
      fwd: clamp01(-along / A_FULL),
      pitchPos: clamp01(alpha / ALPHA_FULL),
      pitchNeg: clamp01(-alpha / ALPHA_FULL),
    },
  };
}

/** Clearance (m) between the LM's footpads and the adapter ring's inner wall as the LM rises out of it. */
export function extractionClearance(padOuter, padY) {
  return adapterRadius(Math.min(ADAPTER.ring, Math.max(0, padY))) - padOuter;
}
