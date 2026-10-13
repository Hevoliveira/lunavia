/*
 * LUNAVIA — lunar module undocking in lunar orbit (pure, unit-tested).
 *
 * One choreography, used by the mission's lunar orbit:
 *
 *  0. The lunar module's landing gear is readied: its contact probes, folded
 *     since launch (data/payloadDesign), swing down (PROBES, before release).
 *  1. Docked. Tunnel cleared, the twelve latches armed; nothing moves.
 *  2. Release (t = latch). The latches open and the command and service
 *     module backs away on its service-module RCS: the forward-facing
 *     thrusters fire for RAMP seconds, building SEP_V of relative speed.
 *     No spring, no jolt: the gap opens smoothly from zero.
 *  3. Station keeping. The lunar module rolls slowly about its long axis
 *     (the inspection of its landing gear), a short RCS pulse to start the
 *     roll and another to stop it. Rate at most ROLL_RATE.
 *  4. Separation burn. The command and service module adds BURN_V on its
 *     RCS, and the two drift apart for the rest of the scene.
 *
 * Both spacecraft keep their orbit; only their relative motion is drawn.
 * Positions are along the docked stack's axis (metres, +: towards the lunar
 * module), shared about the stack's centre of mass by the two masses, so
 * nothing jumps when the latches let go.
 */

import { PROBE_DEPLOYED, PROBE_STOWED } from "./payloadDesign";

export const MASS = { csm: 28.8, lm: 15.1 }; // tonnes (Apollo-class)
// The contact probes swing down from their launch position, seconds relative to release.
export const PROBES = [-9, -6];
export const UNDOCK = {
  latch: 0, // release, seconds from the start of the choreography
  ramp: 1.6, // s of RCS to build the separation speed
  sepV: 0.35, // m/s relative after release
  rollStart: 4.5,
  rollEnd: 14.5,
  roll: Math.PI / 2, // lunar module roll about its axis (rad)
  burn: 13, // separation burn start
  burnLen: 3.2,
  burnV: 0.8, // m/s added (Apollo's separation burn was about 0.8 m/s)
};
export const ROLL_RATE = (UNDOCK.roll / (UNDOCK.rollEnd - UNDOCK.rollStart)) * 1.5; // peak of a smooth ramp

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};
// Integral of smooth over [0, u] (u may exceed 1).
const smoothInt = (u) => (u <= 0 ? 0 : u >= 1 ? 0.5 + (u - 1) : u * u * u - (u * u * u * u) / 2);

/** Relative speed (m/s) at t. */
export function relSpeed(t) {
  return UNDOCK.sepV * smooth((t - UNDOCK.latch) / UNDOCK.ramp) + UNDOCK.burnV * smooth((t - UNDOCK.burn) / UNDOCK.burnLen);
}

/** Gap between the docking rings (m) at t: 0 until the release, then the integral of relSpeed. */
export function gapAt(t) {
  return UNDOCK.sepV * UNDOCK.ramp * smoothInt((t - UNDOCK.latch) / UNDOCK.ramp) + UNDOCK.burnV * UNDOCK.burnLen * smoothInt((t - UNDOCK.burn) / UNDOCK.burnLen);
}

/** Lunar module roll about its long axis (rad) at t. */
export function rollAt(t) {
  return UNDOCK.roll * smooth((t - UNDOCK.rollStart) / (UNDOCK.rollEnd - UNDOCK.rollStart));
}

/** RCS firing level 0..1 for a window [t0, t0+len], with soft edges (a pulse train would read as flicker). */
const pulse = (t, t0, len) => (t < t0 || t > t0 + len ? 0 : Math.min(1, (t - t0) / 0.15, (t0 + len - t) / 0.15));

/**
 * The choreography at t (s; negative = still docked):
 * { gap, csmY, lmY, lmRoll, csmRcs, lmRollRcs, latched, phase }.
 * csmY / lmY: each vehicle's displacement along the axis from its docked place.
 * csmRcs: level of the command and service module's forward-facing thrusters.
 * lmRollRcs: +1..-1, the lunar module's roll thrusters (start and stop pulses).
 */
/** The docked stack in the translunar coast: as extracted from the rocket, probes still folded. */
export const COAST = -60;

export function undocking(t) {
  const gap = gapAt(t);
  const share = MASS.csm / (MASS.csm + MASS.lm);
  const csmRcs = Math.max(pulse(t, UNDOCK.latch, UNDOCK.ramp), pulse(t, UNDOCK.burn, UNDOCK.burnLen));
  const half = (UNDOCK.rollEnd - UNDOCK.rollStart) * 0.12;
  const lmRollRcs = pulse(t, UNDOCK.rollStart, half) - pulse(t, UNDOCK.rollEnd - half, half);
  const phase = t < UNDOCK.latch ? "docked" : t < UNDOCK.ramp ? "release" : t < UNDOCK.burn ? "stationkeeping" : "separating";
  return {
    gap,
    lmProbe: PROBE_STOWED + (PROBE_DEPLOYED - PROBE_STOWED) * smooth((t - PROBES[0]) / (PROBES[1] - PROBES[0])),
    csmY: -gap * (1 - share),
    lmY: gap * share,
    lmRoll: rollAt(t),
    csmRcs,
    lmRollRcs,
    latched: t < UNDOCK.latch,
    phase,
  };
}
