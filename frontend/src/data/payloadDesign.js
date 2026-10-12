/*
 * LV-001's payload: how the expedition's two spacecraft ride inside the launch
 * vehicle, and how they come out of it (pure; core three.js only, unit-tested).
 *
 * The rocket carries the actual spacecraft that fly to the Moon:
 *
 *   escape tower + boost cover   (jettisoned at T+59.3 s)
 *   command module  ┐
 *   service module  ┘ the CSM (data/csmDesign), its engine bell and folded
 *                     high-gain antenna reaching down into the adapter
 *   spacecraft adapter: a fixed ring on the upper stage and four panels
 *   lunar module      (data/lmDesign), upright inside the adapter, legs out,
 *                     contact probes folded, standing on four mounts on the
 *                     upper stage's forward bulkhead, its drogue on the axis
 *                     and facing the CSM's engine
 *   upper stage       (orbit insertion and the TLI burn)
 *   first stage
 *
 * After TLI (data/transposition): the panels open and are jettisoned, the CSM
 * moves out, turns round, docks with the LM and pulls it out of the adapter;
 * the upper stage is left behind. The docked pair is then exactly the stack
 * flown to the Moon (csmDesign dockedLmPose).
 *
 * Units are metres. The payload frame's origin is on the vehicle's axis at the
 * upper stage's forward bulkhead (the adapter's base); +Y runs up the vehicle
 * towards the command module's nose. RocketModel draws this frame at 1/18
 * scale on top of its upper stage (toRocketUnits).
 */
import { CM_R, DOCK_Y, LM_DROGUE, LM_M_PER_UNIT, PROBE_L, SM_BOTTOM, SPS } from "./csmDesign";
import { GROUND, PAD_R, PAD_SIZE, TOP } from "./lmDesign";
import { LM } from "./touchdownFx";

/** RocketModel's model units: 1 unit = 18 m. */
export const ROCKET_M_PER_UNIT = 18;
/** The upper stage's forward bulkhead (the payload frame's origin), in RocketModel units, and its radius (m). */
export const UPPER_STAGE = { topUnits: 4.22, R: 0.302 * ROCKET_M_PER_UNIT };

/**
 * Spacecraft adapter: a frustum from the upper stage (radius R0) to the service
 * module (R1), H tall. The lowest `ring` metres stay on the stage; above them
 * four panels, hinged at the ring, centred on the lunar module's legs.
 */
export const ADAPTER = {
  H: 0.62 * ROCKET_M_PER_UNIT,
  R0: UPPER_STAGE.R,
  R1: CM_R + 0.036,
  ring: 1.0,
  panels: [0, 90, 180, 270], // panel centres, degrees (the LM's leg azimuths: 0° = +X, 90° = +Z)
  openDeg: 45,
};
/** Inner radius of the adapter at height y (m). */
export const adapterRadius = (y) => ADAPTER.R0 + ((ADAPTER.R1 - ADAPTER.R0) * y) / ADAPTER.H;

/** Mount posts under the lunar module's footpads (stay on the upper stage). */
export const LM_MOUNT = { h: 0.35, r: PAD_R * LM_M_PER_UNIT };

/** Contact-probe bend (radians, data/touchdownFx probeBend convention) folded up along the leg, and hanging. */
export const PROBE_STOWED = Math.PI + 0.42;
export const PROBE_DEPLOYED = 0;

/**
 * The lunar module in the adapter (payload frame, m): upright, its footpads on
 * the mounts, its drogue on the vehicle's axis, facing up at the CSM's engine.
 * No yaw: the CSM turns about +Z, so after docking the LM's attitude relative
 * to the CSM is exactly the docked one.
 */
export const LM_STOWED = {
  y: LM_MOUNT.h - GROUND * LM_M_PER_UNIT,
  z: -LM_DROGUE.z * LM_M_PER_UNIT,
  scale: LM_M_PER_UNIT,
};
/** Heights (payload frame, m) of the stowed LM's footpad bottoms, drogue ring and highest point. */
export const LM_HEIGHTS = {
  pads: LM_STOWED.y + GROUND * LM_M_PER_UNIT,
  drogue: LM_STOWED.y + LM_DROGUE.y * LM_M_PER_UNIT,
  top: LM_STOWED.y + TOP * LM_M_PER_UNIT,
  padOuter: (PAD_R + PAD_SIZE) * LM_M_PER_UNIT,
};

/** The CSM on the adapter (payload frame, m): its origin (CM/SM interface) on the axis, the service module's base on the adapter's top. */
export const CSM_MATED = { y: ADAPTER.H - SM_BOTTOM };
/** The CSM's engine exit in the payload frame at launch (it reaches down into the adapter). */
export const SPS_EXIT_MATED = CSM_MATED.y + SPS.exit;

/** Docking geometry along the axis (payload frame, CSM turned round): where the probe first touches the drogue, and hard dock. */
export const DOCK = {
  contactY: LM_HEIGHTS.drogue + DOCK_Y + PROBE_L,
  hardY: LM_HEIGHTS.drogue + DOCK_Y,
};

/** Payload-frame metres → RocketModel units. */
export const toRocketUnits = ([x, y, z]) => [x / ROCKET_M_PER_UNIT, UPPER_STAGE.topUnits + y / ROCKET_M_PER_UNIT, z / ROCKET_M_PER_UNIT];

/** Engine bell radius of the CSM at height y in the CSM's own frame (0 outside the bell). */
export function spsRadius(y) {
  if (y > SPS.mount || y < SPS.exit - 0.05) return 0;
  if (y > SPS.throat) return 0.45;
  const u = (y - SPS.throat) / (SPS.exit - SPS.throat);
  return 0.3 + (SPS.exitR + 0.03 - 0.3) * (1 - Math.pow(1 - u, 1.8));
}

/** The LM's contact probes per leg (LanderModel's fx.probe), all at one bend. */
export const probeSet = (b) => LM.probes.map((on) => (on ? b : 0));
