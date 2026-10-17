/*
 * LUNAVIA — the spacecraft at true scale in the mission's space shots (pure, unit-tested).
 *
 * MissionScene draws two layers, composited every frame (as LaunchCinematic does):
 *  1. the planets (Earth, Moon, stars) in scene units, 1 unit ≈ 1,922 km;
 *  2. the spacecraft (data/csmDesign + the lunar module) in metres.
 * Both layers share one view direction. The planet camera stands where the
 * spacecraft is (plus the vehicle camera's offset, a few millionths of a unit),
 * so the Moon below and the Earth behind are seen at the sizes they have from
 * the spacecraft, and the spacecraft at its own 17 m. Camera distance and
 * composition make it read, never an enlarged model.
 *
 * Vehicle frame (metres): X along the flight path, Y the local vertical (away
 * from the Moon; in the cruise, the orbit-plane normal), Z = X × Y. The docked
 * stack lies along +X, lunar module leading, hatch side towards +Z.
 *
 * Wide shots, where a 17 m spacecraft would be far below one pixel, show it as
 * a sunlit glint on its path (the shots' `glint`).
 */
import { MOON_RADIUS_KM } from "./missionPhases";
import { MOON_UNITS } from "./sceneTrack";
import { undocking } from "./undocking";
import { ASSEMBLY } from "./carrier";
import { DOCK } from "./payloadDesign";
import { TD, extractionOffset, transposition } from "./transposition";

export const M_PER_UNIT = (MOON_RADIUS_KM * 1000) / MOON_UNITS; // metres per scene unit (planets drawn at 10x Earth-Moon scale)

const DEG = Math.PI / 180;
const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
export const smooth = (x) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};
const ease = (x) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * c * (c * (c * 6 - 15) + 10);
};

/**
 * The vehicle frame at a pose: { x, y, z } world unit vectors (columns of the
 * vehicle-to-world rotation). fwd need not be exactly perpendicular to up.
 */
export function vehicleFrame(fwd, up) {
  const y = norm(up);
  const x = norm(cross(cross(y, fwd), y)); // fwd with its vertical part removed
  return { x, y, z: cross(x, y) };
}
export const toWorld = (F, v) => [F.x[0] * v[0] + F.y[0] * v[1] + F.z[0] * v[2], F.x[1] * v[0] + F.y[1] * v[1] + F.z[1] * v[2], F.x[2] * v[0] + F.y[2] * v[1] + F.z[2] * v[2]];
export const toVehicle = (F, w) => [dot(F.x, w), dot(F.y, w), dot(F.z, w)];

/* ---- the stack in the vehicle frame ----------------------------------------------- */
// Stack axis (the CSM's +Y) along +X: rotate -90° about Z. Lengths in metres (data/csmDesign).
export const STACK_ROTATION = [0, 0, -Math.PI / 2];
export const STACK = { aft: -7.85, nose: 3.0, lmFar: 9.1, mid: 0.6 }; // along +X

/* ---- the outbound assembly in the vehicle frame ------------------------------------------ */
/*
 * From the translunar coast to the deployment in lunar orbit the spacecraft fly
 * as LV-001's outbound assembly (components/spacecraft/PayloadSection, data/carrier):
 * the lunar transfer carrier, the closed adapter with the lunar module inside,
 * the CSM on top. Its payload frame (metres, +Y from the carrier's engines to
 * the CSM's nose) is turned onto the vehicle frame by +90° about Z: payload +Y
 * runs along vehicle -X, payload +X is vehicle +Y (away from the Moon).
 *
 * Coast: pivoted on its centre of mass, the nose leading (yaw 0) until the
 * approach turns it engines first. Lunar orbit: placed so that, once the
 * CSM has docked with the LM and pulled it off the carrier (data/transposition),
 * the docked pair is exactly the stack drawn by SpacecraftStack (CSM origin at
 * the vehicle origin, LM along +X), with no jump when one takes over from the other.
 */
export const ASSEMBLY_ROTATION = [0, 0, Math.PI / 2];
/** Payload-frame height that sits at the vehicle origin in lunar orbit: the CSM's origin as the deployment ends. */
export const ORBIT_ANCHOR = DOCK.hardY + extractionOffset(TD.end, 1);
/** A payload-frame point (m) in the vehicle frame, in lunar orbit (no yaw). */
export const assemblyPoint = ([px, py, pz], anchor = ORBIT_ANCHOR) => [anchor - py, px, pz];
/** The assembly's extent along the vehicle's X in lunar orbit (engines first): nose (CSM probe) aft, engine exits ahead. */
export const ASSEMBLY_X = { nose: ORBIT_ANCHOR - ASSEMBLY.nose, aft: ORBIT_ANCHOR - ASSEMBLY.aft, com: ORBIT_ANCHOR - ASSEMBLY.com };

/* ---- the lunar-orbit sequence (mission) ----------------------------------------------- */
/*
 * The mission's orbit clock, in real seconds. The mission cuts from TLI cutoff
 * straight to the arrival: the clock starts at ORBIT_ENTRY (5.6). Before it,
 * behind the cut: the three-day coast and the carrier's insertion burn.
 * 5.6–10.1  ESTABLISHING  the whole Moon, the orbit and the landing site; the spacecraft a glint
 * 10.1–15.1 THE ASSEMBLY  above the lunar horizon, still integrated, a stable shot
 * 15.1–53.1 DEPLOYMENT (data/transposition, tau - deploy): the adapter opens, the
 *           CSM backs out and turns round, docks with the LM and pulls it off the carrier
 * 53.1–     the carrier backs away and is left behind; the docked pair is SpacecraftStack
 * 58.6–     PREPARATION   close on the docking tunnel: LM crew aboard, latches armed
 * 62.6      UNDOCKING     latches open; the CSM backs away on its RCS
 * 72.6–     TWO SPACECRAFT wide: the CSM stays in orbit, the LM moves on; separation burn;
 *           CAPCOM: "we're go for powered descent"
 * 77–       TITLE         the camera eases in behind the LM as it moves away:
 *           LUNAVIA, then A LAJU PRODUCTIONS GAME (data/titleReveal)
 * 84.6–     TITLE SCREEN  START MISSIONS; the orbit clock slows to a near stop
 *           (orbitClockAt) and waits for the player, with no timer
 */
export const ORBIT_SEQ = {
  loi: 0, // the clock's origin: the insertion burn, behind the cut
  arrive: 5.6, // establishing shot; the time-compressed arrival starts here (ORBIT_ENTRY)
  cut: 10.1, // to the integrated assembly
  deploy: 15.1, // the deployment starts (transposition time 0)
  swap: 15.1 + TD.end, // the docked pair is clear: SpacecraftStack takes it over
  tunnel: 58.6,
  undock: 62.6,
  pair: 72.6,
  goPdi: 75.8,
  title: 77,
  titleScreen: 84.6, // the title fully up (data/titleReveal TITLE.button)
  end: 87.4, // the title shot's camera move ends
};
/** Where the mission enters lunar orbit (the cut from TLI cutoff): the arrival, CAPCOM's welcome. */
export const ORBIT_ENTRY = ORBIT_SEQ.arrive;
/** The deployment's shots, in transposition time (data/transposition TD). */
const DEPLOY_SHOTS = { sep: 0, turn: TD.out.t1, dock: TD.approach.t0, extract: TD.extract.t0, end: TD.end };

/** Real orbital motion after the establishing shot: about 1.56 km/s at 278 km (0.044°/s). */
export const ORBIT_RATE = (Math.sqrt(4902.8 / (MOON_RADIUS_KM * 1.16)) / (MOON_RADIUS_KM * 1.16)) / DEG; // deg/s

/*
 * The title screen waits for the player: past ORBIT_SEQ.titleScreen the orbit
 * clock runs ever slower (it tends to titleScreen + TITLE_SCREEN_K), so the LM
 * and the CSM come to rest in frame, the Moon steady below, however long the
 * screen stays up. real: seconds since lunar orbit began.
 */
export const TITLE_SCREEN_K = 6;
export function orbitClockAt(real) {
  const T = ORBIT_SEQ.titleScreen;
  if (real <= T) return real;
  return T + TITLE_SCREEN_K * (1 - Math.exp(-(real - T) / TITLE_SCREEN_K));
}
/** Its inverse: the real seconds at which the orbit clock reads tau (tau < titleScreen + K). */
export function orbitRealAt(tau) {
  const T = ORBIT_SEQ.titleScreen;
  if (tau <= T) return tau;
  return T - TITLE_SCREEN_K * Math.log(1 - (tau - T) / TITLE_SCREEN_K);
}
/** Real seconds the title screen's camera takes to drift to its wide hold (the CSM in view). */
export const TITLE_DRIFT = 36;

// The docked LM's centre along the stack (vehicle +X, metres), for shots that follow it.
export const LM_CENTRE_X = 7.0;

// The two framings either side of the title shot, LM-relative (metres): where the
// TWO SPACECRAFT shot leaves the camera, and where it settles behind the LM with
// the LM in the right third and room for the title on the left.
const PAIR_END = { pos: [-4, 8.5, 30], look: [2.5, 1.2, 0] };
const TITLE_LM_X = LM_CENTRE_X + undocking(ORBIT_SEQ.title - ORBIT_SEQ.undock).lmY;
const TITLE_FROM = { pos: [PAIR_END.pos[0] - TITLE_LM_X, PAIR_END.pos[1], PAIR_END.pos[2]], look: [PAIR_END.look[0] - TITLE_LM_X, PAIR_END.look[1], PAIR_END.look[2]] };
export const TITLE_HOLD = { pos: [-11, 6, 19], look: [-6, -3, -4] };
// The title screen's wide hold, LM-relative: from ahead of the LM, looking back along the
// orbit and down to the lunar horizon, the CSM some 20 m behind it, between the title and the LM.
export const TITLE_WIDE = { pos: [20, 7, 14], look: [-34, -12, 3] };

/*
 * From one LM-relative framing to another by circling the LM (origin): azimuth,
 * elevation and distance interpolated, and the view kept at an interpolated
 * angle off the line to the LM, so the LM holds its place in frame.
 */
function aroundLm(a, b, e) {
  if (e <= 0) return a;
  if (e >= 1) return b;
  const sph = (p) => {
    const r = Math.hypot(p[0], p[1], p[2]);
    return { r, az: Math.atan2(p[2], p[0]), el: Math.asin(p[1] / r) };
  };
  const angles = (v) => ({ yaw: Math.atan2(v[2], v[0]), pitch: Math.atan2(v[1], Math.hypot(v[0], v[2])) });
  const off = (c) => {
    const view = angles(c.look.map((x, i) => x - c.pos[i]));
    const toLm = angles(c.pos.map((x) => -x));
    let dy = view.yaw - toLm.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    return { dy, dp: view.pitch - toLm.pitch };
  };
  const A = sph(a.pos);
  const B = sph(b.pos);
  let daz = B.az - A.az;
  daz = Math.atan2(Math.sin(daz), Math.cos(daz));
  const r = A.r + (B.r - A.r) * e;
  const az = A.az + daz * e;
  const el = A.el + (B.el - A.el) * e;
  const pos = [r * Math.cos(el) * Math.cos(az), r * Math.sin(el), r * Math.cos(el) * Math.sin(az)];
  const oa = off(a);
  const ob = off(b);
  const toLm = angles(pos.map((x) => -x));
  const yaw = toLm.yaw + oa.dy + (ob.dy - oa.dy) * e;
  const pitch = toLm.pitch + oa.dp + (ob.dp - oa.dp) * e;
  const d = [Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw)];
  return { pos, look: [pos[0] + 30 * d[0], pos[1] + 30 * d[1], pos[2] + 30 * d[2]] };
}

// Deployment cameras: payload-frame framings (metres) turned into the vehicle frame,
// e the docked pair's extraction offset.
const P = (pos, look) => ({ pos: assemblyPoint(pos), look: assemblyPoint(look) });

export const ORBIT_SHOTS = [
  {
    id: "establish",
    start: ORBIT_SEQ.arrive,
    len: ORBIT_SEQ.cut - ORBIT_SEQ.arrive,
    wide: true,
    asm: true,
    caption: "LUNAR ORBIT",
    sub: "LUNAR ORBIT INSERTION COMPLETE · LM AND CSM STILL INTEGRATED",
  },
  {
    id: "assembly",
    start: ORBIT_SEQ.cut,
    len: ORBIT_SEQ.deploy - ORBIT_SEQ.cut,
    asm: true,
    caption: "LV-001 IN LUNAR ORBIT",
    sub: "OUTBOUND ASSEMBLY · TRANSFER CARRIER · LM INSIDE THE ADAPTER · CSM",
    // Held steady above the lunar horizon: a slow push along the integrated assembly.
    cam: (u) => ({ pos: lerp([-9, 12, 34], [-6, 11, 30.5], ease(u)), look: lerp([5.5, -3.5, 0], [6, -3, 0], ease(u)) }),
  },
  {
    id: "deploySep",
    start: ORBIT_SEQ.deploy + DEPLOY_SHOTS.sep,
    len: DEPLOY_SHOTS.turn - DEPLOY_SHOTS.sep,
    asm: true,
    kicker: "DEPLOYMENT · LUNAR ORBIT",
    caption: "ADAPTER OPENS",
    sub: "THE CSM SEPARATES · PANELS JETTISONED · THE LUNAR MODULE RODE INSIDE",
    // From above, between two panels, so the LM is uncovered rather than hidden by a panel.
    cam: (u) => P([19, 8 + 3 * u, 20], [0, 10.5 + 1.5 * u, 0]),
  },
  {
    id: "deployTurn",
    start: ORBIT_SEQ.deploy + DEPLOY_SHOTS.turn,
    len: DEPLOY_SHOTS.dock - DEPLOY_SHOTS.turn,
    asm: true,
    kicker: "DEPLOYMENT · LUNAR ORBIT",
    caption: "TRANSPOSITION",
    sub: "THE CSM TURNS ROUND TO FACE THE LUNAR MODULE",
    cam: (u) => P([22, 13 + 2 * u, 27], [-1.5, 14, 0]),
  },
  {
    id: "deployDock",
    start: ORBIT_SEQ.deploy + DEPLOY_SHOTS.dock,
    len: DEPLOY_SHOTS.extract - DEPLOY_SHOTS.dock,
    asm: true,
    kicker: "DEPLOYMENT · LUNAR ORBIT",
    caption: "DOCKING",
    sub: "THE CSM'S PROBE INTO THE LUNAR MODULE'S DROGUE · TWELVE LATCHES",
    // Closing in: the probe, the drogue, then the rings meeting.
    cam: (u) => P([13 - 2 * u, 7.5 - u, 14 - 2 * u], [0, 9 - u, 0]),
  },
  {
    id: "deployExtract",
    start: ORBIT_SEQ.deploy + DEPLOY_SHOTS.extract,
    len: DEPLOY_SHOTS.end - DEPLOY_SHOTS.extract,
    asm: true,
    kicker: "DEPLOYMENT · LUNAR ORBIT",
    caption: "LUNAR MODULE EXTRACTED",
    sub: "MOUNTS RELEASED · THE CSM PULLS IT OFF THE CARRIER · HIGH-GAIN ANTENNA OUT",
    // The docked pair rises off the carrier; the camera rises with it.
    cam: (u, e) => P([19, 6 + 0.5 * e, 20], [0, 9 + 0.7 * e, 0]),
  },
  {
    id: "leave",
    start: ORBIT_SEQ.swap,
    len: ORBIT_SEQ.tunnel - ORBIT_SEQ.swap,
    caption: "CARRIER LEFT BEHIND",
    sub: "CSM AND LM DOCKED · THE TRANSFER CARRIER BACKS AWAY ON ITS RCS",
    // The docked pair, LM first; the carrier and its ring drifting away beyond the LM.
    cam: (u) => ({ pos: lerp([-8, 10, 33], [-6, 9.5, 31], ease(u)), look: lerp([7, -2.5, 0], [9, -2.5, 0], ease(u)) }),
  },
  {
    id: "tunnel",
    start: ORBIT_SEQ.tunnel,
    caption: "UNDOCKING PREPARATION",
    sub: "LM CREW ABOARD · TUNNEL CLOSED · LATCHES ARMED",
    cam: (u) => ({ pos: lerp([0.6, 4.8, 13], [1.4, 4.3, 11.2], ease(u)), look: [3.2, -1.3, 0] }),
    len: ORBIT_SEQ.undock - ORBIT_SEQ.tunnel,
  },
  {
    id: "undock",
    start: ORBIT_SEQ.undock,
    caption: "UNDOCKING",
    sub: "LATCHES RELEASED · CSM BACKING AWAY ON RCS",
    cam: (u) => ({ pos: lerp([-2, 7.5, 21], [0, 8, 24], ease(u)), look: lerp([2.5, -2.6, 0], [3.6, -2.6, 0], ease(u)) }),
    len: ORBIT_SEQ.pair - ORBIT_SEQ.undock,
  },
  {
    id: "pair",
    start: ORBIT_SEQ.pair,
    caption: "TWO SPACECRAFT",
    sub: "THE CSM REMAINS IN LUNAR ORBIT · THE LUNAR MODULE PREPARES FOR DESCENT",
    cam: (u) => ({ pos: lerp([-9, 12.5, 33], PAIR_END.pos, ease(u)), look: lerp([4, -4.2, 0], PAIR_END.look, ease(u)) }),
    len: ORBIT_SEQ.title - ORBIT_SEQ.pair,
  },
  {
    id: "title",
    start: ORBIT_SEQ.title,
    follow: "lm",
    caption: null,
    // No cut: from where the two-spacecraft shot stopped, the camera eases in behind
    // the LM as it moves away, the CSM receding beyond it (data/titleReveal).
    cam: (u) => ({ pos: lerp(TITLE_FROM.pos, TITLE_HOLD.pos, ease(u)), look: lerp(TITLE_FROM.look, TITLE_HOLD.look, ease(u)) }),
    len: ORBIT_SEQ.end - ORBIT_SEQ.title,
  },
  {
    id: "titleScreen",
    start: ORBIT_SEQ.end,
    follow: "lm",
    caption: null,
    // The title screen (then the descent setup over it): from where the title shot settled, a
    // very slow drift in real time (the orbit clock is all but stopped) to the wide hold, then held.
    drift: TITLE_DRIFT,
    cam: (u) => aroundLm(TITLE_HOLD, TITLE_WIDE, ease(u)),
    len: Infinity,
  },
];

/**
 * The orbit shot's vehicle-frame camera at tau, for the LM's displacement lmY
 * (data/undocking): shots that follow the LM are offset to it. e: the docked
 * pair's extraction offset during the deployment.
 */
export function orbitShotCamera(shot, u, lmY, e = 0) {
  const c = shot.cam(u, e);
  if (shot.follow !== "lm") return c;
  const x = LM_CENTRE_X + lmY;
  return { pos: [c.pos[0] + x, c.pos[1], c.pos[2]], look: [c.look[0] + x, c.look[1], c.look[2]] };
}


/**
 * The shot at orbit time tau, with its own progress u (0..1). A drifting shot (the title
 * screen) runs on real seconds since lunar orbit began (real; by default orbitRealAt(tau)).
 */
export function orbitShotAt(tau, real = null) {
  let s = ORBIT_SHOTS[0];
  for (const x of ORBIT_SHOTS) if (tau >= x.start) s = x;
  let u = s.len && isFinite(s.len) ? Math.min(1, (tau - s.start) / s.len) : 0;
  if (s.drift) {
    const r = real != null ? real : orbitRealAt(Math.min(tau, ORBIT_SEQ.titleScreen + TITLE_SCREEN_K * 0.999999));
    u = Math.min(1, Math.max(0, (r - orbitRealAt(s.start)) / s.drift));
  }
  return { shot: s, u };
}

/*
 * The carrier once the docked pair has left it (seconds after ORBIT_SEQ.swap):
 * it keeps the 0.9 m/s the extraction opened, and its forward RCS backs it
 * further off; seen leaving, then no longer drawn from the tunnel shot on.
 */
const LEAVE = { t0: 0.6, ramp: 2.0, v: 1.2 };
const smoothInt = (u) => (u <= 0 ? 0 : u >= 1 ? 0.5 + (u - 1) : u * u * u - (u * u * u * u) / 2);
export function carrierDrift(dt) {
  if (dt <= 0) return { x: 0, retro: 0 };
  const { t0, ramp, v } = LEAVE;
  const x = TD.extract.v * dt + v * ramp * smoothInt((dt - t0) / ramp);
  const w = (dt - t0) / ramp;
  const retro = w <= 0 || w >= 1 ? 0 : Math.min(1, w / 0.1, (1 - w) / 0.15);
  return { x, retro };
}

/**
 * The outbound assembly in lunar orbit at tau: what PayloadSection draws and
 * how. { on: carrier (and adapter) drawn, craft: the CSM and the LM drawn by it
 * (else by SpacecraftStack), td: data/transposition state, x: the payload
 * group's shift along vehicle +X, e: the docked pair's extraction offset,
 * engines, retro }.
 */
export function deployState(tau) {
  const td = transposition(tau - ORBIT_SEQ.deploy);
  const d = carrierDrift(tau - ORBIT_SEQ.swap);
  const e = extractionOffset(tau - ORBIT_SEQ.deploy, 1);
  return { on: tau < ORBIT_SEQ.tunnel, craft: tau < ORBIT_SEQ.swap, td, x: d.x, e, engines: 0, retro: d.retro };
}

/** Undocking choreography time for orbit time tau (negative = still docked). */
export const undockTime = (tau) => tau - ORBIT_SEQ.undock;

/* ---- the return: close on the spacecraft (mission time) ---------- */
/*
 * The return opens close on the CSM alone, the Moon behind it at its true
 * apparent size for the spacecraft's real distance. (The scene's map-scale
 * planets, 10x oversized for the Earth-Moon views, are never seen from close
 * by.) No translunar travel is shown on the way out: the mission cuts from TLI
 * cutoff straight to lunar orbit (ORBIT_ENTRY).
 *
 * radialFrame: Z away from the planet behind the shot, Y the orbit-plane normal
 * (world +Y), X = Y × Z along the stack. The planet is at -Z, beyond the stack.
 */
export function radialFrame(awayFromPlanet) {
  const z = norm([awayFromPlanet[0], 0, awayFromPlanet[2]]);
  const y = [0, 1, 0];
  return { x: cross(y, z), y, z };
}
/** Where to stand so that a planet of drawn radius R appears as it does from distanceKm (radius radiusKm). */
export const trueSizeDistance = (R, distanceKm, radiusKm) => (R * distanceKm) / radiusKm;

/** Distance from the Moon's centre (km) as the CSM leaves it after TEI (close return shot). */
export const returnDistanceKm = (t) => 1837 + 2.2 * Math.pow(Math.max(0, t - 504000), 0.95);

export const RETURN_CLOSE_END = 560000; // mission s
export const RETURN_SHOT = { caption: "TRANSEARTH COAST", sub: "THE CSM HEADS HOME · THE LUNAR MODULE STAYED BEHIND" };
export function returnCamera(u) {
  return { pos: lerp([5, 4, 22], [2.5, 3, 17], ease(u)), look: [-2.4, -0.8, 0] };
}

export const _test = { norm, cross, dot };
