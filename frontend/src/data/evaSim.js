/*
 * LUNAVIA — the lunar EVA (extravehicular activity): the astronaut's world,
 * walking, collisions and the egress and ingress sequences (pure; unit-tested).
 *
 * Every official destination has an EVA (EVA_SITES; the expeditions in data/evaMissions). Everything is
 * built from what the mission already has — the site's own terrain function
 * (data/terrainMesh lookup, the surface as drawn), its rocks (data/landingSites)
 * and the lunar module exactly where and how it landed (the landing result's
 * pose, the same transform LanderModel is drawn with) — so the astronaut walks
 * on the ground that is on screen and climbs the ladder that is drawn.
 *
 * Units: metres (x, z horizontal; y height above the landing zone's datum),
 * heading in radians (0 = +z, the LM's front; positive turns towards +x),
 * seconds. The scene draws 0.5 units per metre near the ground (touchdownFx).
 */
import { WORLD_X, LM } from "./touchdownFx";
import { surveyorColliders } from "./surveyor";
import { GROUND, PAD_H, PAD_R, PORCH_RAILS, legFrames } from "./lmDesign";

const DEG = Math.PI / 180;
export const MODEL_M = (LM.scale / WORLD_X) * 1; // metres per LanderModel model unit (4.8)
export const G_MOON = 1.62;

/** The sites with an EVA (all four official destinations; data/missionConfig). */
export { EVA_SITES, evaAvailableAt } from "./missionConfig";

/* ---- the astronaut and the suit's limits ---------------------------------------------------- */
export const SUIT = {
  height: 1.88, // boot sole to helmet top
  radius: 0.36, // collision radius (the backpack included)
  walk: 1.15, // m/s, the fastest walk (a lope: Apollo crews moved about 1 m/s)
  back: 0.42, // m/s, stepping backwards
  accel: 1.1, // m/s² (a suited body on the Moon gets going slowly …)
  decel: 1.7, // m/s² (… and needs a few steps to stop: no skating)
  turn: 105 * DEG, // rad/s, turning on the spot or while walking
  stride: 0.95, // m per step at full pace (two steps a gait cycle)
  bob: 0.055, // m, the rise of the body in the floating phase at full pace
  slopeSlow: 16, // deg: steeper ground slows the walk …
  slopeStop: 30, // deg: … and this is not walked up
};

/** The exploration area round the LM (m from its axis). */
export const AREA = { warn: 24, limit: 31, zMax: 32 };

/* ---- the lunar module where it landed --------------------------------------------------------- */
/**
 * The LM's frame from the landing pose (data/DescentGame result.pose: scene units and degrees):
 * toWorld(model) → metres, and its parts the EVA needs, in metres:
 * hatch, porch, the ladder (top, bottom, rungs), the front footpad, the boarding point.
 */
export function lmFrame(pose) {
  const bx = pose.x / WORLD_X;
  const by = (pose.padY + LM.foot) / WORLD_X;
  const bz = 0;
  const p = (pose.pitch || 0) * DEG;
  const t = -(pose.tilt || 0) * DEG;
  const cp = Math.cos(p);
  const sp = Math.sin(p);
  const ct = Math.cos(t);
  const st = Math.sin(t);
  // three.js Euler XYZ: R = Rx(pitch) · Rz(-tilt)
  const toWorld = ([x, y, z]) => {
    const mx = x * MODEL_M;
    const my = y * MODEL_M;
    const mz = z * MODEL_M;
    // Rz
    const x1 = ct * mx - st * my;
    const y1 = st * mx + ct * my;
    const z1 = mz;
    // Rx
    return [bx + x1, by + cp * y1 - sp * z1, bz + sp * y1 + cp * z1];
  };
  const L = legFrames().find((l) => l.ladder);
  const v = (vec) => [vec.x, vec.y, vec.z];
  const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const off = v(L.dir.clone().multiplyScalar(0.035));
  const topM = add(add(v(L.upper), v(L.axis), -0.05), off);
  const botM = add(add(v(L.padTop), v(L.axis), 0.14), off);
  const rungsM = [];
  for (let i = 1; i <= 7; i++) rungsM.push(topM.map((c, k) => c + (botM[k] - c) * (i / 8)));
  const padTopM = v(L.padTop); // footpad's top centre (model)
  const front = [0, 0, 1];
  const ladder = {
    top: toWorld(topM),
    bottom: toWorld(botM),
    rungs: rungsM.map(toWorld),
    // where a boot rests on a rung: the rung line, a little outboard of the rails
    axis: v(L.axis),
  };
  const groundAt = toWorld([0, GROUND, 0])[1];
  const pad = toWorld([padTopM[0], GROUND + PAD_H, padTopM[2]]);
  const base = [bx, groundAt, bz];
  // the ladder's rails (the hands slide down them), left and right as LanderModel draws them
  const side = v(L.side);
  const rails = [-1, 1].map((k) => ({ top: toWorld(add(topM, side, k * 0.045)), bottom: toWorld(add(botM, side, k * 0.045)) }));
  ladder.rails = rails;
  // the porch handrails: the front post's top and the rail's back end (data/lmDesign PORCH_RAILS)
  const handrails = PORCH_RAILS.map((r) => ({ post: toWorld(r.front), front: toWorld(r.top), back: toWorld(r.back) }));
  // the hatch's frame (both sides, a hand's height above the sill)
  const hatchFrame = [-1, 1].map((k) => toWorld([k * 0.088, 0.53, 0.292]));
  return {
    base, // the LM's axis on the ground (footpad plane)
    axis: [bx, bz],
    toWorld,
    hatch: toWorld([0, 0.545, 0.3]), // the forward hatch's centre, on the cabin's raked face
    hatchSill: toWorld([0, 0.47, 0.295]), // the sill's outer edge (the hatch's bottom)
    hatchFrame,
    deck: toWorld([0, 0.356, 0.365]), // the descent stage's top deck, a step in front of the hatch
    porch: toWorld([0, 0.343, 0.485]), // the porch deck (top), mid-depth
    porchEdge: toWorld([0, 0.343, 0.53]),
    ladder,
    handrails,
    pad, // the front footpad's top
    padR: (LM.padSize / WORLD_X) * 1, // footpad radius (m)
    front,
    // where the astronaut stands to climb: just outboard of the front footpad, facing the LM
    board: toWorld([0, GROUND, PAD_R + 0.24]),
    // the whole LM for the camera and the photo: centre and height
    centre: toWorld([0, 0.32, 0]),
    height: (LM.height / WORLD_X) * 1,
  };
}

/* ---- what the astronaut can bump into -------------------------------------------------------- */
/**
 * Colliders round the LM and among the site's boulders (metres, on the ground plane):
 * circles { x, z, r } and capsules { ax, az, bx, bz, r }.
 * - the descent stage and its outriggers: one circle round the axis;
 * - each leg, where its strut is lower than a helmet (from about 3 m out to the footpad);
 * - each footpad;
 * - every boulder within reach (debris stones are stepped over).
 */
export function colliders(site, lm, within = 45) {
  const [ax, az] = lm.axis;
  const out = { circles: [], capsules: [] };
  out.circles.push({ x: ax, z: az, r: 2.45, kind: "lm" });
  for (const deg of LM.legAngles) {
    const c = Math.cos(deg * DEG);
    const s = Math.sin(deg * DEG);
    const padR = (LM.padRadius / WORLD_X) * 1; // 4.32 m
    out.capsules.push({ ax: ax + c * 2.9, az: az + s * 2.9, bx: ax + c * padR, bz: az + s * padR, r: 0.32, kind: "leg" });
    out.circles.push({ x: ax + c * padR, z: az + s * padR, r: 0.6, kind: "pad" });
  }
  for (const r of site.rocks) {
    if (!r.boulder) continue;
    if (Math.hypot(r.x - ax, r.z - az) > within) continue;
    out.circles.push({ x: r.x, z: r.z, r: r.r * 0.92, kind: "rock" });
  }
  // fixed historical objects on the site (Apollo Legacy: Surveyor 3)
  for (const o of site.objects || []) {
    if (o.kind !== "surveyor") continue;
    const c = surveyorColliders(o);
    out.circles.push(...c.circles);
    out.capsules.push(...c.capsules);
  }
  return out;
}

/** Push a circle of radius rad at (x, z) out of every collider; returns [x, z, hit]. */
export function resolve(cols, x, z, rad = SUIT.radius) {
  let hit = null;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const c of cols.circles) {
      const dx = x - c.x;
      const dz = z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + rad;
      if (d < min) {
        const k = d > 1e-6 ? (min - d) / d : 0;
        x += d > 1e-6 ? dx * k : min;
        z += d > 1e-6 ? dz * k : 0;
        hit = hit || c.kind;
        moved = true;
      }
    }
    for (const c of cols.capsules) {
      const vx = c.bx - c.ax;
      const vz = c.bz - c.az;
      const l2 = vx * vx + vz * vz;
      const u = Math.max(0, Math.min(1, ((x - c.ax) * vx + (z - c.az) * vz) / l2));
      const px = c.ax + vx * u;
      const pz = c.az + vz * u;
      const dx = x - px;
      const dz = z - pz;
      const d = Math.hypot(dx, dz);
      const min = c.r + rad;
      if (d < min) {
        const k = d > 1e-6 ? (min - d) / d : 0;
        x += dx * k;
        z += dz * k;
        hit = hit || c.kind;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return [x, z, hit];
}

/* ---- the world -------------------------------------------------------------------------------- */
/**
 * The EVA's world for one landing: the terrain function (metres), the LM, colliders, the
 * sample's place and the photo stand. `ground(x, z)` is the drawn surface (terrainMesh lookup).
 */
export function evaWorld({ site, pose, ground, area = AREA }) {
  const lm = lmFrame(pose);
  // boulders within reach of the exploration area are obstacles (45 m for the official EVAs)
  const lim = (area && area.limit) || 0;
  const cols = colliders(site, lm, lim > 45 ? lim + 12 : 45);
  const [ax, az] = lm.axis;
  // The Sun's direction on the ground: the photo is taken with the Sun behind the photographer.
  const sunAz = site.sun.az * DEG;
  const sunH = [Math.cos(sunAz), -Math.sin(sunAz)]; // towards the Sun (x, z)
  // the designated sample: a fist-sized stone about 10 m from the ladder, front right, on open
  // ground (no boulder within 2.5 m, gentle slope), chosen once per landing
  const sample = pickSpot(site, ground, cols, ax, az, [
    [7.5, 8.5],
    [9, 6],
    [4, 10.5],
    [11, 2.5],
    [-6, 9],
  ]);
  // the photo stand: about 15 m out on the sunward side (the Sun behind the photographer), far
  // enough for the whole 7 m vehicle in the chest camera's frame; the first clear one of a fan
  const fan = [];
  for (const r of [15, 14, 16.5]) for (const a of [0, 0.35, -0.35, 0.6, -0.6]) fan.push([r * Math.cos(sunAz + a), -r * Math.sin(sunAz + a)]);
  const photo = pickSpot(site, ground, cols, ax, az, fan);
  return { site, lm, cols, ground, area, sample: { ...sample, y: ground(sample.x, sample.z) }, photo: { ...photo, y: ground(photo.x, photo.z) }, sunH };
}

/** The ground's steepest slope (deg) at (x, z). */
export function slopeAt(ground, x, z) {
  const e = 0.6;
  const dx = (ground(x + e, z) - ground(x - e, z)) / (2 * e);
  const dz = (ground(x, z + e) - ground(x, z - e)) / (2 * e);
  return Math.atan(Math.hypot(dx, dz)) / DEG;
}

function pickSpot(site, ground, cols, ax, az, offsets) {
  for (const [dx, dz] of offsets) {
    const x = ax + dx;
    const z = az + dz;
    if (Math.abs(z) > AREA.zMax - 4 || Math.hypot(dx, dz) > AREA.warn - 3) continue;
    const clear = cols.circles.every((c) => Math.hypot(x - c.x, z - c.z) > c.r + 2.5) && cols.capsules.every((c) => Math.hypot(x - (c.ax + c.bx) / 2, z - (c.az + c.bz) / 2) > 3);
    if (clear && slopeAt(ground, x, z) < 10) return { x, z };
  }
  const [dx, dz] = offsets[0];
  return { x: ax + dx, z: az + dz };
}

/* ---- walking ---------------------------------------------------------------------------------- */
/** A walker standing at (x, z) facing `heading`. */
export function createWalker(world, x, z, heading = Math.PI) {
  return {
    x,
    z,
    y: world.ground(x, z),
    heading,
    speed: 0, // signed, along the heading
    phase: 0, // gait cycle 0..1 (one cycle = two steps)
    steps: 0,
    lastFoot: null,
    distance: 0,
    hit: null,
    warn: false,
    atLimit: false,
  };
}

const wrapPi = (a) => {
  let r = a;
  while (r > Math.PI) r -= 2 * Math.PI;
  while (r < -Math.PI) r += 2 * Math.PI;
  return r;
};

/**
 * One step of walking. input: { x, y } the stick (-1..1; y up = away from the camera),
 * camYaw (the camera's heading, rad), or { turnOnly } in the photo view.
 * The stick is camera-relative: pushed towards a direction, the astronaut turns to it and
 * walks; pulled gently back (a small, opposite input) he steps backwards instead of turning.
 * Returns footstep events [{ x, z, heading, side }] for footprints and dust.
 */
export function stepWalker(w, world, input, dt) {
  const mag = Math.min(1, Math.hypot(input.x || 0, input.y || 0));
  let wantSpeed = 0;
  if (mag > 0.08 && !input.locked) {
    // world heading of the stick: up = the camera's heading, right = the camera's right
    const dir = Math.atan2(-input.x, input.y) + (input.camYaw || 0);
    const diff = wrapPi(dir - w.heading);
    const backStep = Math.abs(diff) > 2.6 && mag < 0.55 && !input.turnOnly;
    if (backStep) {
      wantSpeed = -SUIT.back * Math.min(1, mag / 0.55);
    } else {
      const turn = Math.max(-SUIT.turn * dt, Math.min(SUIT.turn * dt, diff));
      w.heading = wrapPi(w.heading + turn);
      // walk once facing roughly that way (no moonwalking sideways)
      if (!input.turnOnly) wantSpeed = SUIT.walk * mag * Math.max(0, Math.cos(diff));
    }
  }
  // the ground ahead: slopes slow the walk, steep ones stop it
  const hx = Math.sin(w.heading);
  const hz = Math.cos(w.heading);
  const sgn = Math.sign(wantSpeed || w.speed || 1);
  const ahead = world.ground(w.x + hx * 0.6 * sgn, w.z + hz * 0.6 * sgn);
  const rise = Math.atan2(ahead - w.y, 0.6) / DEG;
  if (rise > SUIT.slopeSlow) wantSpeed *= Math.max(0, 1 - (rise - SUIT.slopeSlow) / (SUIT.slopeStop - SUIT.slopeSlow));
  // nor walked down: a fresh crater's inner wall or a rille's side would leave the astronaut in a
  // pit too steep to climb out of; he stops at its edge instead (gentler ground is unchanged)
  if (-rise > SUIT.slopeStop) {
    wantSpeed = 0;
    if (-rise > SUIT.slopeStop + 8) w.speed = 0;
  }
  const dv = wantSpeed - w.speed;
  const lim = (Math.abs(wantSpeed) > Math.abs(w.speed) ? SUIT.accel : SUIT.decel) * dt;
  w.speed += Math.max(-lim, Math.min(lim, dv));
  if (Math.abs(w.speed) < 0.005 && wantSpeed === 0) w.speed = 0;

  // move, then out of the LM, its legs and the boulders
  let nx = w.x + hx * w.speed * dt;
  let nz = w.z + hz * w.speed * dt;
  // the exploration area: outward motion stops at the limit
  const [ax, az] = world.lm.axis;
  const A = world.area || AREA;
  const r0 = Math.hypot(w.x - ax, w.z - az);
  const r1 = Math.hypot(nx - ax, nz - az);
  w.atLimit = false;
  if (r1 > A.limit && r1 > r0) {
    const k = A.limit / r1;
    nx = ax + (nx - ax) * Math.max(k, r0 / r1);
    nz = az + (nz - az) * Math.max(k, r0 / r1);
    w.atLimit = true;
  }
  nz = Math.max(-A.zMax, Math.min(A.zMax, nz));
  const [rx, rz, hit] = resolve(world.cols, nx, nz);
  const moved = Math.hypot(rx - w.x, rz - w.z);
  if (hit && moved < Math.abs(w.speed * dt) * 0.35) w.speed *= 0.6; // walking into something: slow down
  w.hit = hit;
  w.x = rx;
  w.z = rz;
  w.distance += moved;
  w.warn = Math.hypot(w.x - ax, w.z - az) > A.warn;
  // feet on the ground; the gait's floating phase is drawn by the animation
  const g = world.ground(w.x, w.z);
  w.y = g;
  // gait: two steps per cycle, the cycle advancing with the distance walked
  const events = [];
  const before = w.phase;
  const stepLen = SUIT.stride * (0.55 + 0.45 * Math.min(1, Math.abs(w.speed) / SUIT.walk));
  w.phase = (w.phase + moved / (2 * stepLen)) % 1;
  const crossed = (a, b, m) => (a < m && b >= m) || (a > b && (a < m || b >= m));
  for (const [m, side] of [
    [0.0, "L"],
    [0.5, "R"],
  ]) {
    if (moved > 1e-4 && crossed(before, w.phase, m) && !(m === 0 && before === 0)) {
      // the astronaut's left is (cos h, -sin h) for a heading h (forward (sin h, cos h))
      const sx = Math.cos(w.heading) * (side === "L" ? 0.13 : -0.13);
      const sz = -Math.sin(w.heading) * (side === "L" ? 0.13 : -0.13);
      events.push({ x: w.x + sx, z: w.z + sz, y: world.ground(w.x + sx, w.z + sz), heading: w.heading, side, speed: Math.abs(w.speed) });
      w.steps++;
    }
  }
  return events;
}

/* ---- the egress and ingress (scripted, on the LM's own hardware) ----------------------------- */
// The astronaut's "root" is the point between the boot soles; poses are named for the
// animation (components/eva/Astronaut).
const lerp = (a, b, u) => a + (b - a) * u;
const lerp3 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
const smooth = (x) => {
  const u = Math.max(0, Math.min(1, x));
  return u * u * (3 - 2 * u);
};

/**
 * The egress, second by second: the hatch opens; the astronaut backs out on hands and knees to the
 * sill, lowers himself onto the deck below it, steps back across the porch between its handrails,
 * climbs down the ladder rung by rung facing the LM, drops to the footpad and steps off onto the
 * surface (FIRST STEPS), then turns round. Returns
 * { pos [x, y, z] (root, m), heading, pose, u (0..1 within the pose), hatch (0..1 open),
 *   rung (on the ladder: 0 at the porch … 8 at the bottom), up (the ingress), firstStep, done }.
 */
export const EGRESS = { hatch: 2.2, crawl: 4.0, lower: 2.2, stepBack: 1.7, firstRung: 1.4, rung: 0.82, toPad: 1.8, step: 2.6, turn: 2.2 };
export function egressAt(lm, t) {
  return ladderSequence(lm, t, false);
}

/** The ingress: up the footpad, the ladder, across the porch, up into the hatch, the hatch closed. */
export const INGRESS = { toPad: 2.6, firstRung: 1.5, rung: 0.82, lastRung: 1.4, stepBack: 1.6, lower: 2.2, crawl: 3.8, hatch: 2.0 };
export function ingressAt(lm, t) {
  return ladderSequence(lm, t, true);
}

// the eight ladder steps: the first off the porch (or up from the footpad) and the last onto the
// porch are the big ones and take longer
const STEPS_DOWN = [EGRESS.firstRung, ...Array(7).fill(EGRESS.rung)];
const STEPS_UP = [INGRESS.firstRung, ...Array(6).fill(INGRESS.rung), INGRESS.lastRung];
const sum = (a) => a.reduce((x, y) => x + y, 0);
export const egressLength = () => EGRESS.hatch + EGRESS.crawl + EGRESS.lower + EGRESS.stepBack + sum(STEPS_DOWN) + EGRESS.toPad + EGRESS.step + EGRESS.turn;
export const ingressLength = () => INGRESS.toPad + sum(STEPS_UP) + INGRESS.stepBack + INGRESS.lower + INGRESS.crawl + INGRESS.hatch;
/** Which ladder step a time s into the climb falls in: { i, u } (u 0..1 within it), or null past it. */
function ladderStep(steps, s) {
  let t = s;
  for (let i = 0; i < steps.length; i++) {
    if (t < steps[i]) return { i, u: t / steps[i] };
    t -= steps[i];
  }
  return null;
}

/** The places the sequences pass through (metres), the same for the egress and the ingress. */
export function ladderPoints(lm) {
  const facingLM = Math.atan2(lm.axis[0] - lm.board[0], lm.axis[1] - lm.board[2]); // heading towards the LM's axis
  const outward = facingLM + Math.PI;
  const ox = Math.sin(outward);
  const oz = Math.cos(outward);
  const L = lm.ladder;
  // boot positions on each rung, nudged outboard so the soles sit on the rung
  const rungs = [L.top, ...L.rungs, L.bottom].map((p) => [p[0] + ox * 0.06, p[1] + 0.02, p[2] + oz * 0.06]); // 0 = top … 8 = bottom
  const sill = lm.hatchSill; // knees on the sill's edge
  const inside = [sill[0] - ox * 0.95, sill[1], sill[2] - oz * 0.95]; // on the cabin floor
  // standing on the footpad: its dished top is highest at the centre (padSurface)
  const pad = [lm.pad[0], padSurface(lm, lm.pad[0], lm.pad[2]), lm.pad[2]];
  return { facingLM, outward, rungs, inside, sill, deck: lm.deck, porch: lm.porch, pad, ground: lm.board };
}

/**
 * The front footpad's top surface (m) at (x, z), or null off it: a shallow dome, highest at the
 * centre and falling to its rolled rim (data/lmDesign buildPad's profile).
 */
const PAD_PROFILE = [
  [0, PAD_H - 0.004],
  [0.05, PAD_H - 0.006],
  [0.094, PAD_H - 0.014],
  [LM.padSize / LM.scale, 0.018],
];
export function padSurface(lm, x, z) {
  const r = Math.hypot(x - lm.pad[0], z - lm.pad[2]) / MODEL_M;
  if (r > PAD_PROFILE[PAD_PROFILE.length - 1][0]) return null;
  let y = PAD_PROFILE[0][1];
  for (let i = 1; i < PAD_PROFILE.length; i++) {
    const [r0, y0] = PAD_PROFILE[i - 1];
    const [r1, y1] = PAD_PROFILE[i];
    if (r <= r1) {
      y = y0 + ((y1 - y0) * (r - r0)) / (r1 - r0);
      break;
    }
  }
  return lm.pad[1] + (y - PAD_H) * MODEL_M;
}

function ladderSequence(lm, t, up) {
  const P = ladderPoints(lm);
  const { facingLM, rungs, inside, sill, deck, porch, pad, ground } = P;
  const at = (pos, pose, u, extra = {}) => ({ pos, heading: facingLM, pose, u, hatch: 1, up, firstStep: !!extra.firstStep, done: false, ...extra });
  if (!up) {
    const E = EGRESS;
    let s = t;
    if (s < E.hatch) return at(inside, "crawl", 0, { hatch: smooth(s / E.hatch), hidden: true });
    s -= E.hatch;
    if (s < E.crawl) return at(lerp3(inside, sill, smooth(s / E.crawl)), "crawl", s / E.crawl);
    s -= E.crawl;
    if (s < E.lower) return at(lerp3(sill, deck, smooth(s / E.lower)), "lower", s / E.lower);
    s -= E.lower;
    if (s < E.stepBack) return at(lerp3(deck, porch, smooth(s / E.stepBack)), "stepBack", s / E.stepBack);
    s -= E.stepBack;
    const down = ladderStep(STEPS_DOWN, s);
    if (down) {
      const { i, u } = down;
      // from the porch to the first rung, then rung to rung, the last onto the rails' feet
      const a = i === 0 ? porch : rungs[i];
      const b = rungs[i + 1];
      return at(lerp3(a, b, smooth(u)), "climb", u, { rung: i + u, step: i });
    }
    s -= sum(STEPS_DOWN);
    if (s < E.toPad) return at(lerp3(rungs[8], pad, smooth(s / E.toPad)), "drop", s / E.toPad);
    s -= E.toPad;
    if (s < E.step) return at(lerp3(pad, ground, smooth(s / E.step)), "stepDown", s / E.step, { firstStep: s / E.step > 0.42 }); // the first boot lands off the footpad
    s -= E.step;
    if (s < E.turn - 1e-9) return at(ground, "turn", s / E.turn, { heading: facingLM + Math.PI * smooth(s / E.turn), firstStep: true });
    return at(ground, "idle", 0, { heading: facingLM + Math.PI, firstStep: true, done: true });
  }
  const I = INGRESS;
  let s = t;
  if (s < I.toPad) return at(lerp3(ground, pad, smooth(s / I.toPad)), "stepUp", s / I.toPad);
  s -= I.toPad;
  const climb = ladderStep(STEPS_UP, s);
  if (climb) {
    const { i, u } = climb;
    // from the footpad up to the lowest rung (a hop in lunar gravity), rung to rung, onto the porch
    const a = i === 0 ? pad : rungs[8 - i];
    const b = i === 7 ? porch : rungs[7 - i];
    return at(lerp3(a, b, smooth(u)), "climb", u, { rung: 8 - i - u, step: i });
  }
  s -= sum(STEPS_UP);
  if (s < I.stepBack) return at(lerp3(porch, deck, smooth(s / I.stepBack)), "stepBack", s / I.stepBack);
  s -= I.stepBack;
  if (s < I.lower) return at(lerp3(deck, sill, smooth(s / I.lower)), "lower", s / I.lower);
  s -= I.lower;
  if (s < I.crawl) {
    const u = smooth(s / I.crawl);
    return at(lerp3(sill, inside, u), "crawl", s / I.crawl, { hidden: u > 0.97 });
  }
  s -= I.crawl;
  if (s < I.hatch - 1e-9) return at(inside, "crawl", 1, { hatch: 1 - smooth(s / I.hatch), hidden: true }); // (the end itself counts as done)
  return at(inside, "crawl", 1, { hatch: 0, hidden: true, done: true });
}

/* ---- objectives ---------------------------------------------------------------------------------- */
export const OBJECTIVES = ["firstSteps", "sample", "photo"];
export const INTERACT = { sample: 1.5, board: 1.6 }; // m, reach for COLLECT SAMPLE and BOARD THE LM
export const SAMPLE_TIME = 5.2; // s, the collection (reach, scoop, stow)

/** What the astronaut can do where he stands: "sample" | "board" | null. */
export function interactionAt(world, w, progress) {
  if (!progress.firstSteps) return null;
  if (!progress.sample && Math.hypot(w.x - world.sample.x, w.z - world.sample.z) <= INTERACT.sample) return "sample";
  if (Math.hypot(w.x - world.lm.board[0], w.z - world.lm.board[2]) <= INTERACT.board) return "board";
  return null;
}

/** The current task, for the guidance and the marker: firstSteps → sample → photo → return. */
export function nextTask(progress) {
  if (!progress.firstSteps) return "firstSteps";
  if (!progress.sample) return "sample";
  if (!progress.photo) return "photo";
  return "return";
}

/**
 * The photo of the landing site (no device camera: the in-game viewfinder). It counts when the
 * whole lunar module is in the frame, near its centre, from 9–34 m: { ok, verdict, distance }.
 * view: { pos [x, y, z], yaw (heading of the view), pitch (rad, up +), vfov (rad), aspect }.
 */
export const PHOTO = { min: 9, max: 34, centre: 0.3 };
export function photoCheck(world, view) {
  const lm = world.lm;
  const c = lm.centre;
  const dx = c[0] - view.pos[0];
  const dz = c[2] - view.pos[2];
  const dist = Math.hypot(dx, dz);
  const bearing = Math.atan2(dx, dz);
  const dYaw = wrapPi(bearing - view.yaw);
  const hfov = 2 * Math.atan(Math.tan(view.vfov / 2) * view.aspect);
  // vertical: the LM from its footpads to its antennas
  const bottom = Math.atan2(lm.base[1] - view.pos[1], dist) - view.pitch;
  const top = Math.atan2(lm.base[1] + lm.height - view.pos[1], dist) - view.pitch;
  const halfV = view.vfov / 2;
  const half = (lm.height * 0.62) / Math.max(1, dist); // half the LM's width (rad, roughly)
  const inFrame = Math.abs(dYaw) + half < hfov / 2 && top < halfV && bottom > -halfV;
  const centred = Math.abs(dYaw) < (hfov / 2) * PHOTO.centre && Math.abs((top + bottom) / 2) < halfV * 0.55;
  let verdict = "ok";
  if (Math.abs(dYaw) > hfov / 2) verdict = "aim";
  else if (dist < PHOTO.min) verdict = "tooClose";
  else if (dist > PHOTO.max) verdict = "tooFar";
  else if (!inFrame) {
    if (top >= halfV && bottom <= -halfV) verdict = "tooClose"; // taller than the frame
    else if (top >= halfV) verdict = "tiltUp";
    else if (bottom <= -halfV) verdict = "tiltDown";
    else verdict = "frame";
  } else if (!centred) verdict = "centre";
  return { ok: verdict === "ok", verdict, distance: dist, dYaw };
}

/** EVA progress, clean, from anything (a save's or a fresh one). */
export function cleanProgress(p) {
  const o = p && typeof p === "object" ? p : {};
  return { firstSteps: !!o.firstSteps, sample: !!o.sample, photo: !!o.photo };
}
