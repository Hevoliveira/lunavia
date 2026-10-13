/*
 * LUNAVIA's Lunar Transfer Carrier (pure, unit-tested).
 *
 * LUNAVIA's own mission architecture keeps the lunar module and the command
 * and service module together with their launch hardware until lunar orbit:
 *
 *   pad → staging → Earth orbit → TLI (upper stage)
 *   → the upper stage separates from the carrier and is discarded near Earth
 *   → the outbound assembly coasts to the Moon:
 *        carrier (propulsion, the LM's deck)
 *        adapter (four closed panels, the LM inside, upright on its mounts)
 *        CSM (on top, its engine bell inside the adapter, antenna folded)
 *   → the carrier's engines put the assembly into lunar orbit
 *   → in lunar orbit: the panels open, the CSM turns round, docks with the LM
 *     and pulls it off the carrier (data/transposition), the carrier is left
 *     behind; then the LM undocks (data/undocking).
 *
 * Why a carrier: LV-001 has two stages, and the lunar module stands on the
 * upper stage's forward bulkhead. After TLI the only engines would be the
 * upper stage's (24.5 m long; it must not go to the Moon) and the CSM's, whose
 * bell reaches down into the adapter 0.9 m above the lunar module (it cannot
 * fire with the LM inside). So the top 1.35 m of the upper stage's cylinder is
 * a separate module: the carrier. Same diameter, so LV-001's outline does not
 * change; it carries the deck the LM's mounts stand on (the LM does not move),
 * the adapter's fixed ring, a toroidal tank of storable propellant, four small
 * engines nested in the upper stage's forward skirt, and RCS.
 *
 * Units: metres, tonnes, seconds; the payload frame of data/payloadDesign
 * (origin on the axis at the carrier's deck, +Y up the vehicle).
 */
import { CSM_MATED, LM_HEIGHTS, ROCKET_M_PER_UNIT, UPPER_STAGE } from "./payloadDesign";
import { CM_TOP, PROBE_L } from "./csmDesign";
import { MASS as SPACECRAFT_MASS } from "./undocking";

const G0 = 9.80665;

export const CARRIER = {
  H: 1.35, // the top of LV-001's upper-stage cylinder: deck at y = 0, aft bulkhead at y = -H
  R: UPPER_STAGE.R,
  bandH: 0.06 * ROCKET_M_PER_UNIT, // LV-001's black band under the adapter (1.08 m); the skin below it is the stage's white
  deckY: 0,
  tank: { R: 3.35, r: 0.5, y: -0.7 }, // toroidal tank: major radius, tube radius, centre height
  engines: {
    count: 4,
    azDeg: [45, 135, 225, 315], // between the LM's legs (and the adapter panels)
    r: 3.3, // radial position of each engine's axis
    throatR: 0.13,
    exitR: 0.34,
    mountY: -1.35, // on the aft bulkhead
    exitY: -2.2, // nozzle exits, nested in the upper stage's forward skirt at launch
    thrustKN: 27,
    isp: 316, // s, storable propellants (hypergolic)
  },
  rcs: { azDeg: [0, 90, 180, 270], y: -0.68 }, // four quads on the skirt
  mass: { dry: 4.2, propellant: 18.0 }, // t
};

/** The upper stage's forward bulkhead, once the carrier has gone (dome apex and rim, payload frame). */
export const STAGE_FORWARD = { apexY: -2.45, rimY: -3.05, R: CARRIER.R };

export const ADAPTER_MASS = 2.2; // t: four panels and the fixed ring
/** Mass of the outbound assembly at lunar orbit insertion (t). */
export const ASSEMBLY_MASS = SPACECRAFT_MASS.csm + SPACECRAFT_MASS.lm + ADAPTER_MASS + CARRIER.mass.dry + CARRIER.mass.propellant;
/** Lunar orbit insertion, from the translunar trajectory into a 110 km x 110 km-class orbit (m/s), and midcourse corrections. */
export const LOI_DV = 910;
export const MIDCOURSE_DV = 20;

/** The carrier's Δv capacity with the whole assembly (m/s). */
export const deltaVCapacity = () => CARRIER.engines.isp * G0 * Math.log(ASSEMBLY_MASS / (ASSEMBLY_MASS - CARRIER.mass.propellant));
/** Propellant volume (m³, mixed density 1.2 t/m³) and the toroidal tank's volume. */
export const propellantVolume = () => CARRIER.mass.propellant / 1.2;
export const tankVolume = () => 2 * Math.PI * Math.PI * CARRIER.tank.R * CARRIER.tank.r * CARRIER.tank.r;
/** LOI burn duration (s) with all four engines. */
export const loiBurnSeconds = () => {
  const F = CARRIER.engines.count * CARRIER.engines.thrustKN * 1000;
  const mdot = F / (CARRIER.engines.isp * G0); // kg/s
  const m0 = ASSEMBLY_MASS * 1000;
  const mf = m0 / Math.exp(LOI_DV / (CARRIER.engines.isp * G0));
  return (m0 - mf) / mdot;
};

/** The outbound assembly's extent along the axis (payload frame): engine exits to the probe's tip. */
export const ASSEMBLY = {
  aft: CARRIER.engines.exitY,
  nose: CSM_MATED.y + CM_TOP + PROBE_L,
  // Centre of mass (payload frame y, m): carrier with its propellant, adapter, LM, CSM.
  com: (() => {
    const parts = [
      [CARRIER.mass.dry + CARRIER.mass.propellant, -0.7],
      [ADAPTER_MASS, 4.5],
      [SPACECRAFT_MASS.lm, LM_HEIGHTS.pads + 3.2],
      [SPACECRAFT_MASS.csm, CSM_MATED.y - 1.6],
    ];
    const m = parts.reduce((a, p) => a + p[0], 0);
    return parts.reduce((a, p) => a + p[0] * p[1], 0) / m;
  })(),
};

/*
 * Upper-stage separation after TLI (launch cinematic, tau = seconds since the
 * shot opens). Pyros at `t0`; the carrier's RCS pushes the assembly forward,
 * building `v` of relative speed over `ramp` seconds, then it coasts; after
 * `coastFrom` the film runs the clock 40x (the farewell), so the spent stage
 * falls behind quickly on screen.
 */
export const STAGE_SEP = { t0: 0.6, ramp: 2.4, v: 0.5, coastFrom: 7.5, compression: 40 };
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothInt = (u) => (u <= 0 ? 0 : u >= 1 ? 0.5 + (u - 1) : u * u * u - (u * u * u * u) / 2);
/** Gap between the upper stage's forward ring and the carrier's aft bulkhead (m). */
export function stageGap(t) {
  const { t0, ramp, v, coastFrom, compression } = STAGE_SEP;
  const real = (x) => v * ramp * smoothInt((x - t0) / ramp);
  if (t <= coastFrom) return real(t);
  return real(coastFrom) + v * compression * (t - coastFrom);
}
/** The carrier's forward RCS during the separation push (0..1): firing while the speed builds. */
export const stageSepRcs = (t) => {
  const { t0, ramp } = STAGE_SEP;
  const u = (t - t0) / ramp;
  return u <= 0 || u >= 1 ? 0 : Math.min(1, u / 0.1, (1 - u) / 0.15);
};

/** Soft start and shutdown of the carrier's engines for a burn [on, off] (0..1). */
export const burnLevel = (t, on, off) => {
  const s = (x) => {
    const c = clamp01(x);
    return c * c * (3 - 2 * c);
  };
  return Math.min(s((t - on) / 0.35), 1 - s((t - off) / 0.5));
};
