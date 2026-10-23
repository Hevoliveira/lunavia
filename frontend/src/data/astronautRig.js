/*
 * LUNAVIA — the astronaut's rig: proportions, poses and the inverse kinematics that put boots on
 * the ground and on the LM's rungs and gloves on its rails (pure; core three.js math only;
 * unit-tested). components/eva/Astronaut draws the suit on these segments.
 *
 * The root is the point between the boot soles; +z is the way the astronaut faces, +x his left,
 * metres. A pose "spec" says where the pelvis is and how it and the torso are turned, and where
 * the ankles and wrists should be (root frame); solveRig() turns that into every segment's
 * position and orientation, solving each leg and arm as a two-bone chain, so a planted boot stays
 * planted whatever the body does above it.
 *
 * The suit limits everything: a pressurised suit holds the arms a little forward and out, the
 * knees a little bent, and does not bend much at the waist — the crew used long-handled tools and
 * a chest-mounted camera for that reason. On the Moon the walk is an easy lope: longer steps with
 * a short float between them, the body leaning forward under the backpack, little arm swing.
 */
import * as THREE from "three";
import { SUIT, ladderPoints } from "./evaSim";

export const BODY = {
  hipY: 0.955, // standing hip-joint height (the suit's neutral: knees a touch bent)
  hipW: 0.115, // hip joints either side of the pelvis
  thigh: 0.44,
  shin: 0.43,
  ankle: 0.1, // sole to ankle joint
  waist: 0.07, // hip line to the torso's pivot
  shoulderY: 0.47, // torso pivot to the shoulder joints
  shoulderW: 0.235,
  upperArm: 0.29,
  forearm: 0.27,
  helmet: [0, 0.665, 0.02], // torso pivot to the helmet's centre (the helmet is fixed to the suit)
  helmetR: 0.19,
  footX: 0.13, // the boots either side of the root
  toe: 0.2, // ankle to the ball of the foot
  chest: [0, 0.31, 0.29], // torso pivot to the chest camera's lens (the photo view)
};
export const SEGMENTS = ["pelvis", "torso", "thighL", "shinL", "footL", "thighR", "shinR", "footR", "upperArmL", "forearmL", "handL", "upperArmR", "forearmR", "handR"];

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, u) => a + (b - a) * u;
const smooth = (x) => {
  const u = clamp(x, 0, 1);
  return u * u * (3 - 2 * u);
};
const mod1 = (x) => x - Math.floor(x);
/** How far the ankle rises when the boot pitches by p (toe down +) about the ball or the heel. */
export const pivotLift = (p) => BODY.ankle * (Math.cos(p) - 1) + (p >= 0 ? (BODY.toe + 0.05) * Math.sin(p) : 0.09 * Math.sin(-p));
const TAU = Math.PI * 2;

/* ---- frames ------------------------------------------------------------------------------------ */
/** World (m) → root frame, for a root at `root` facing `heading`. */
export function toLocal(root, heading, p) {
  const dx = p[0] - root[0];
  const dy = p[1] - root[1];
  const dz = p[2] - root[2];
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return [dx * c - dz * s, dy, dx * s + dz * c];
}
/** Root frame → world (m). */
export function toWorld(root, heading, p) {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return [root[0] + p[0] * c + p[2] * s, root[1] + p[1], root[2] - p[0] * s + p[2] * c];
}

/* ---- specs ------------------------------------------------------------------------------------- */
/** The neutral stance. All positions are in the root frame (m); rotations [pitch, yaw, roll] (rad). */
export function baseSpec() {
  return {
    pelvis: [0, BODY.hipY, 0],
    pelvisRot: [0.03, 0, 0],
    torsoRot: [0.06, 0, 0],
    feet: [
      [BODY.footX, BODY.ankle, 0.02],
      [-BODY.footX, BODY.ankle, 0.02],
    ],
    footRot: [
      [0, 0.06, 0],
      [0, -0.06, 0],
    ],
    hands: [
      [0.31, 1.03, 0.17],
      [-0.31, 1.03, 0.17],
    ],
    wrist: [0.15, 0.15],
    grip: [0.35, 0.35],
    kneePole: [0, 0, 1],
    elbowPole: [0.45, -0.3, -0.45], // where the elbows point, torso frame (x outward for each arm)
    tool: 0, // the sample scoop in the right hand (0 = stowed)
  };
}

/** Numbers and nested arrays blended from a to b. */
export function blendSpec(a, b, u) {
  if (typeof a === "number") return lerp(a, b, u);
  if (Array.isArray(a)) return a.map((v, i) => blendSpec(v, b[i], u));
  const out = {};
  for (const k of Object.keys(a)) out[k] = b[k] === undefined ? a[k] : blendSpec(a[k], b[k], u);
  return out;
}

/**
 * Idle: standing at ease in the suit. Breathing (~4 s), the weight shifting slowly from boot to
 * boot with the hips (the loaded side rising, the torso rolling back to keep the helmet level), a
 * slow look round, and the arms, gloves and wrists never quite still. Every motion is small and
 * slow: a pressurised suit damps everything.
 */
export function standSpec(t = 0) {
  const s = baseSpec();
  const br = Math.sin(t * 1.55);
  const sway = Math.sin(t * 0.37);
  const look = Math.sin(t * 0.23 + 1.3) * (0.6 + 0.4 * Math.sin(t * 0.11));
  s.pelvis[0] = 0.014 * sway;
  s.pelvis[1] += 0.004 * br - 0.005 * Math.abs(sway);
  s.pelvisRot[2] = 0.022 * sway;
  s.torsoRot[0] += 0.012 * br;
  s.torsoRot[1] = 0.075 * look;
  s.torsoRot[2] = -0.016 * sway;
  s.hands[0] = [0.31 + 0.012 * Math.sin(t * 0.61 + 0.4), 1.03 + 0.007 * br, 0.17 + 0.016 * Math.sin(t * 0.47)];
  s.hands[1] = [-0.31 - 0.011 * Math.sin(t * 0.53 + 2), 1.03 + 0.007 * br, 0.17 + 0.014 * Math.sin(t * 0.41 + 1)];
  s.grip = [0.35 + 0.07 * Math.sin(t * 0.29), 0.35 + 0.07 * Math.sin(t * 0.31 + 1.7)];
  s.wrist = [0.15 + 0.06 * Math.sin(t * 0.33), 0.15 + 0.06 * Math.sin(t * 0.27 + 0.8)];
  return s;
}

/**
 * The walk (and the lunar lope at pace), driven by the walker's gait phase (data/evaSim
 * stepWalker: the phase advances with the distance walked, so planted boots do not slide).
 * speed signed (m/s, negative backwards); turnPhase drives a shuffle when turning on the spot;
 * groundAt(x, z) gives the ground's height in the root frame under a foot (default flat).
 */
export function walkSpec({ phase = 0, speed = 0, turnPhase = 0, turning = 0, t = 0, groundAt = null }) {
  const s = standSpec(t);
  const sf = clamp(Math.abs(speed) / SUIT.walk, 0, 1);
  const dir = speed < 0 ? -1 : 1;
  const w = smooth(Math.abs(speed) / 0.22); // walking rather than standing
  const L = SUIT.stride * (0.55 + 0.45 * sf); // step length, as stepWalker counts it
  const d = lerp(0.62, 0.44, sf); // each boot's share of the cycle on the ground (< 0.5: a short float)
  const e = L * d * w; // half the distance a planted boot travels under the body
  const lift = (0.04 + 0.06 * sf) * w;
  // the heel comes down first (toe up), the boot rolls flat, then onto its ball at toe-off;
  // walking backwards the toe comes down first
  const strike = dir > 0 ? -0.15 * sf * w : 0.08 * sf * w;
  // turning on the spot: small alternating steps
  const tw = (1 - w) * smooth(Math.abs(turning) / 0.4);
  const g = (x, z) => (groundAt ? groundAt(x, z) : 0);
  const feet = [];
  const pitch = [];
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? 1 : -1;
    const q = mod1(phase - (i === 0 ? 0 : 0.5));
    let z;
    let y;
    let p;
    if (q < d) {
      const u = q / d;
      z = dir * e * (1 - 2 * u);
      // heel strike rolling flat, then heel off at the end of the stance: onto the ball
      p = strike * (1 - smooth(u / 0.16)) + 0.32 * sf * w * smooth((u - 0.72) / 0.28);
      y = pivotLift(p);
    } else {
      const u = (q - d) / (1 - d);
      z = dir * e * (-1 + 2 * smooth(u));
      p = 0.32 * sf * w * (1 - smooth(u / 0.35)) - 0.12 * w * Math.sin(Math.PI * u) + strike * smooth((u - 0.55) / 0.45);
      y = lift * Math.sin(Math.PI * u) + Math.max(0, pivotLift(p));
    }
    // the shuffle
    const tq = mod1(turnPhase - (i === 0 ? 0 : 0.5));
    if (tw > 0 && tq < 0.5) y += 0.05 * tw * Math.sin(tq * TAU);
    const x = side * (BODY.footX + 0.01 * sf);
    feet.push([x, BODY.ankle + y + g(x, z), z + 0.02 * (1 - w)]);
    pitch.push(p);
  }
  s.feet = feet;
  s.footRot = [
    [pitch[0], 0.06 * (1 - w) + 0.02, 0],
    [pitch[1], -0.06 * (1 - w) - 0.02, 0],
  ];
  // the body: a little lower and leaning in at pace, rising in the float between steps, and the
  // knees giving a little as each boot takes the weight (the suit is heavy even at 1/6 g)
  const bob = 0.72 * SUIT.bob * sf * w * (0.5 - 0.5 * Math.cos(2 * TAU * (phase - d / 2)));
  const take = (q) => (q < 0.2 ? Math.sin((Math.PI * q) / 0.2) : 0);
  const dip = 0.013 * sf * w * (take(mod1(phase)) + take(mod1(phase - 0.5)));
  const gy = (g(BODY.hipW, 0) + g(-BODY.hipW, 0)) / 2;
  let y = BODY.hipY - 0.03 * sf * w + bob - dip + gy;
  // never stretch a leg straight: the hips come down to where both boots can be reached
  const R = (BODY.thigh + BODY.shin) * 0.985;
  for (let i = 0; i < 2; i++) {
    const hx = (i === 0 ? 1 : -1) * BODY.hipW;
    const [fx, fy, fz] = feet[i];
    const h2 = (fx - hx) ** 2 + fz ** 2;
    y = Math.min(y, fy + Math.sqrt(Math.max(0, R * R - h2)));
  }
  const yaw = -0.07 * Math.cos(TAU * phase) * sf * w * dir;
  // the hips over the boot that carries the weight, rolling with it
  const shift = 0.013 * sf * w * Math.cos(TAU * (phase - d / 2));
  const roll = 0.025 * Math.sin(TAU * phase) * sf * w;
  s.pelvis = [s.pelvis[0] * (1 - w) + shift, y + (s.pelvis[1] - BODY.hipY) * (1 - w), -0.02 * sf * w * dir];
  s.pelvisRot = [0.03 + 0.05 * sf * w, yaw + s.pelvisRot[1] * (1 - w), roll + s.pelvisRot[2] * (1 - w)];
  s.torsoRot = [s.torsoRot[0] + 0.12 * sf * w * (dir > 0 ? 1 : 0.25), -0.6 * yaw + s.torsoRot[1] * (1 - w), -0.5 * roll + s.torsoRot[2] * (1 - w)];
  // the arms: held forward by the suit, a swing opposite the legs a beat behind them, each hand
  // rising a little and coming in towards the midline as it comes forward
  const A = 0.13 * sf * w;
  const sw = Math.cos(TAU * (phase - 0.035)) * dir;
  const fwdL = Math.max(0, -sw);
  const fwdR = Math.max(0, sw);
  const hy = 1.03 + y - BODY.hipY + 0.02 * sf * w;
  const walkHands = [
    [0.31 - 0.02 * sf * w * fwdL, hy + 0.025 * sf * w * fwdL, 0.17 + 0.05 * sf * w - A * sw],
    [-0.31 + 0.02 * sf * w * fwdR, hy + 0.025 * sf * w * fwdR, 0.17 + 0.05 * sf * w + A * sw],
  ];
  s.hands = s.hands.map((h, i) => h.map((v, k) => lerp(v, walkHands[i][k], w)));
  s.wrist = [lerp(s.wrist[0], 0.15 + 0.08 * fwdL, w), lerp(s.wrist[1], 0.15 + 0.08 * fwdR, w)];
  return s;
}

/**
 * On hands and knees (in the cabin, backing out of the hatch): the root between the knees, the
 * body forward over the hands. phase drives a slow crawl (diagonal pairs move together).
 */
export function crawlSpec(phase = 0, dir = -1) {
  const s = baseSpec();
  const step = (k) => {
    const q = mod1(phase - k);
    return q < 0.6 ? [dir * 0.07 * (1 - (2 * q) / 0.6), 0] : [dir * 0.07 * (-1 + 2 * smooth((q - 0.6) / 0.4)), 0.035 * Math.sin((Math.PI * (q - 0.6)) / 0.4)];
  };
  const [kz0, ky0] = step(0);
  const [kz1, ky1] = step(0.5);
  s.pelvis = [0, 0.5, -0.04];
  s.pelvisRot = [0.55, 0, 0];
  s.torsoRot = [0.74, 0, 0];
  s.feet = [
    [BODY.footX, 0.11 + ky0, -0.42 + kz0],
    [-BODY.footX, 0.11 + ky1, -0.42 + kz1],
  ];
  s.footRot = [
    [1.2, 0, 0],
    [1.2, 0, 0],
  ];
  s.kneePole = [0, -0.85, 0.5];
  s.hands = [
    [0.21, 0.09 + ky1, 0.6 + kz1],
    [-0.21, 0.09 + ky0, 0.6 + kz0],
  ];
  s.wrist = [-1.1, -1.1];
  s.grip = [0.1, 0.1];
  s.elbowPole = [0, -0.2, -1];
  return s;
}

/**
 * Taking the sample with the long-handled scoop (u 0..1 over evaSim SAMPLE_TIME): the scoop comes
 * off the leg pocket, the astronaut leans and bends his knees as far as the suit lets him, scoops
 * the stone, lifts it and tips it into the sample bag at his left hip, then stows the scoop.
 * stone: the stone in the root frame. Returns the spec and where the scoop's head is.
 */
export const SCOOP = { length: 0.86 };
export function sampleSpec(u, stone, t = 0) {
  const s = standSpec(t);
  const bend = smooth(u / 0.18) * (1 - smooth((u - 0.52) / 0.14)); // down to the stone and back up
  s.pelvis[1] -= 0.13 * bend;
  s.pelvis[2] -= 0.05 * bend;
  s.pelvisRot[0] += 0.18 * bend;
  s.torsoRot[0] += 0.3 * bend;
  // the scoop's head: to the stone, along the ground under it, up with it, to the bag
  const bag = [0.24, 0.98, 0.1];
  const stoneUp = [stone[0], stone[1] + 0.04, stone[2]];
  const scoopDrag = [stone[0], stone[1] + 0.035, stone[2] + 0.09];
  const lifted = [-0.05, 1.08, 0.48];
  const head = (() => {
    if (u < 0.12) return null; // still on the leg
    if (u < 0.3) return lerp3([-0.2, 0.55, 0.45], stoneUp, smooth((u - 0.12) / 0.18));
    if (u < 0.42) return lerp3(stoneUp, scoopDrag, smooth((u - 0.3) / 0.12));
    if (u < 0.62) return lerp3(scoopDrag, lifted, smooth((u - 0.42) / 0.2));
    if (u < 0.8) return lerp3(lifted, [bag[0] - 0.02, bag[1] + 0.12, bag[2] + 0.16], smooth((u - 0.62) / 0.18));
    if (u < 0.92) return lerp3([bag[0] - 0.02, bag[1] + 0.12, bag[2] + 0.16], [-0.2, 0.55, 0.45], smooth((u - 0.8) / 0.12));
    return null;
  })();
  // the right hand holds the handle's end: back from the head along a line rising towards the body
  const hold = head ? handOnHandle(head, s, u) : [-0.31, 1.03, 0.17];
  const reach = smooth(u / 0.12) * (1 - smooth((u - 0.9) / 0.1));
  s.hands[1] = lerp3([-0.31, 1.03, 0.17], hold, reach);
  // the left hand opens the bag while the stone goes in
  const open = smooth((u - 0.6) / 0.1) * (1 - smooth((u - 0.84) / 0.08));
  s.hands[0] = lerp3(s.hands[0], [0.2, 1.06, 0.26], open);
  s.grip = [0.35 + 0.45 * open, 0.35 + 0.55 * reach];
  s.wrist = [0.15, 0.15 + 0.5 * reach];
  s.tool = reach;
  s.scoop = head ? { head, hold } : null;
  s.stoneIn = u >= 0.36 && u < 0.78 ? "scoop" : u >= 0.78 ? "bag" : "ground";
  return s;
}
function handOnHandle(head, s, u) {
  // the handle rises from the head back towards the body at about 60° from horizontal
  const shoulder = [-BODY.shoulderW, s.pelvis[1] + BODY.waist + BODY.shoulderY * 0.95, 0.12];
  const dx = shoulder[0] - head[0];
  const dz = shoulder[2] - head[2];
  const dh = Math.hypot(dx, dz) || 1;
  const dirH = [dx / dh, dz / dh];
  const elev = lerp(0.95, 1.2, smooth((u - 0.42) / 0.2)); // steeper once lifted
  const L = SCOOP.length;
  return [head[0] + dirH[0] * Math.cos(elev) * L, head[1] + Math.sin(elev) * L, head[2] + dirH[1] * Math.cos(elev) * L];
}
const lerp3 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];

/** Aiming the chest-mounted camera: both hands on it, the torso tilting with the aim (pitch rad). */
export function photoSpec(pitch = 0, t = 0) {
  const s = standSpec(t);
  const p = clamp(pitch, -0.25, 0.25);
  s.torsoRot[0] = 0.06 - p * 0.9;
  s.pelvisRot[0] = 0.03 - p * 0.3;
  // the camera on the chest bracket, in the root frame (approximately, for the hands)
  const cy = s.pelvis[1] + BODY.waist + BODY.chest[1] * Math.cos(s.torsoRot[0]);
  const cz = BODY.chest[2] + BODY.chest[1] * Math.sin(s.torsoRot[0]) - 0.02;
  s.hands = [
    [0.1, cy - 0.04, cz],
    [-0.1, cy - 0.04, cz],
  ];
  s.wrist = [-0.4, -0.4];
  s.grip = [0.7, 0.7];
  return s;
}

/* ---- the egress and ingress on the LM's hardware ------------------------------------------------ */
// What the egress/ingress frames (data/evaSim egressAt/ingressAt) look like on the body. Every place
// a boot or a glove touches is taken from the LM as it landed (lmFrame), in world metres, then
// brought into the root frame.
const PLACES = new WeakMap();
function places(lm) {
  if (PLACES.has(lm)) return PLACES.get(lm);
  const P = ladderPoints(lm);
  const out = [Math.sin(P.outward), 0, Math.cos(P.outward)];
  const up = [0, 1, 0];
  // the astronaut faces the LM on the ladder and the porch: his left (cos h, -sin h)
  const h = P.facingLM;
  const left = [Math.cos(h), 0, -Math.sin(h)];
  const onLeft = (pts) => (dot(sub(pts[0], P.porch), left) > dot(sub(pts[1], P.porch), left) ? [pts[0], pts[1]] : [pts[1], pts[0]]);
  const rails = onLeft(lm.ladder.rails.map((r) => r.top)).map((top) => lm.ladder.rails.find((r) => r.top === top));
  const handrails = onLeft(lm.handrails.map((r) => r.front)).map((f) => lm.handrails.find((r) => r.front === f));
  const frame = onLeft(lm.hatchFrame);
  const ladderUp = norm(sub(lm.ladder.top, lm.ladder.bottom));
  // away from the ladder, square to it, on the climber's side
  const away = norm(sub(out, scale(ladderUp, dot(out, ladderUp))));
  const v = { P, out, up, left, rails, handrails, frame, ladderUp, away, lean: Math.acos(clamp(ladderUp[1], -1, 1)) };
  PLACES.set(lm, v);
  return v;
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addv = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => scale(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));

/** Where a boot rests on a rung (ankle, world m): side 0 left, 1 right. */
function bootOnRung(V, rung, side) {
  const s = side === 0 ? 1 : -1;
  return addv(addv(addv(rung, V.left, s * 0.1), V.out, 0.07), V.up, BODY.ankle - 0.02);
}
/** A glove on a line a→b at height y (clamped to the line's ends), nudged off it. */
function gloveAtHeight(a, b, y, off) {
  const f = clamp((y - a[1]) / (b[1] - a[1] || 1e-6), 0, 1);
  return addv(lerp3(a, b, f), off);
}
const GRIP_ABOVE = 0.92; // the gloves hold about this far above the boot on the other side
/** On the ladder rail (side) at height y. */
function gloveOnRailAt(V, y, side) {
  const r = V.rails[side];
  return gloveAtHeight(r.bottom, r.top, y, addv(scale(V.away, 0.06), V.left, (side === 0 ? 1 : -1) * 0.03));
}
/** On the porch handrail's front post (side) at height y. */
function gloveOnPost(V, y, side) {
  const r = V.handrails[side];
  return gloveAtHeight(r.post, r.front, y, scale(V.out, 0.05));
}
/** A glove on a porch handrail, f from its front post (0) to its back end (1). */
function gloveOnHandrail(V, f, side) {
  const r = V.handrails[side];
  return addv(addv(r.front, sub(r.back, r.front), clamp(f, 0, 1)), V.up, 0.05);
}
/** A boot standing at p (ankle, world m), `back` metres outward of it. */
function bootAt(V, p, side, back = 0) {
  return addv(addv(addv(p, V.left, (side === 0 ? 1 : -1) * BODY.footX), V.up, BODY.ankle), V.out, back);
}
/**
 * Scripted footfalls (world m): plan[i] = { start, moves: [[u0, u1, to], …] } for each boot; between
 * moves a boot stays put, and while moving it lifts clear (`lift` m) and lands flat.
 */
function footfalls(plan, u, lift = 0.07) {
  return plan.map(({ start, moves }) => {
    let at = start;
    for (const [u0, u1, to] of moves) {
      if (u <= u0) return at;
      if (u < u1) {
        const k = (u - u0) / (u1 - u0);
        const p = lerp3(at, to, smooth(k));
        p[1] += lift * Math.sin(Math.PI * k);
        return p;
      }
      at = to;
    }
    return at;
  });
}
/** The hips over the boots (world m): height from the boots, never stretching a leg straight. */
function hipsOver(V, feetW, dip = 0, lean = [0, 0, 0]) {
  const mid = lerp3(feetW[0], feetW[1], 0.5);
  const hips = addv(addv(mid, V.up, BODY.hipY - BODY.ankle - dip), lean);
  const R = (BODY.thigh + BODY.shin) * 0.985;
  for (const f of feetW) {
    const h2 = (f[0] - hips[0]) ** 2 + (f[2] - hips[2]) ** 2 - BODY.hipW * BODY.hipW * 0.6;
    hips[1] = Math.min(hips[1], f[1] + Math.sqrt(Math.max(0, R * R - Math.max(0, h2))));
  }
  return hips;
}
const REST = [
  [0.31, 1.03, 0.17],
  [-0.31, 1.03, 0.17],
];

const CLIMB_HIPS = [0.6, 0.2]; // on the ladder: the hips up it from the boots, and out from it (m)

/**
 * The spec for one frame of the egress or ingress. f: the frame from evaSim (pos, heading, pose,
 * u, rung, step, up); t: the clock (for idle breathing).
 */
export function sequenceSpec(lm, f, t = 0) {
  const V = places(lm);
  const root = f.pos;
  const h = f.heading;
  const L = (p) => toLocal(root, h, p);
  const u = f.u;
  const P = V.P;
  const fromWorld = (spec) => specLocal(spec, root, h);
  switch (f.pose) {
    case "crawl": {
      // backing out (egress) or in (ingress): three crawl cycles between the cabin floor and the sill
      const total = Math.hypot(P.sill[0] - P.inside[0], P.sill[2] - P.inside[2]);
      const d = Math.hypot(root[0] - P.inside[0], root[2] - P.inside[2]);
      return crawlSpec((3 * d) / total, f.up ? 1 : -1);
    }
    case "lower": {
      // from kneeling on the sill to standing on the deck below it, hands on the hatch frame
      const k = f.up ? 1 - u : u; // 0 on the sill, 1 on the deck
      const c = crawlSpec(0, f.up ? 1 : -1);
      const A = specWorld(c, P.sill, h);
      const st = standSpec(t);
      st.torsoRot[0] = 0.16;
      const B = specWorld(st, P.deck, h);
      B.feet = [0, 1].map((side) => bootAt(V, P.deck, side));
      B.hands = [addv(V.frame[0], V.out, 0.04), addv(V.frame[1], V.out, 0.04)];
      // legs first: the boots go down to the deck while the knees leave the sill, then the body rises
      const body = smooth((k - 0.25) / 0.75);
      const W = blendSpec(A, B, body);
      W.feet = A.feet.map((a, i) => {
        const kk = smooth((k - i * 0.1) / 0.55);
        const p = lerp3(a, B.feet[i], kk);
        p[1] += 0.06 * Math.sin(Math.PI * kk);
        return p;
      });
      W.hands = A.hands.map((a, i) => lerp3(a, B.hands[i], smooth((k - 0.1 - i * 0.08) / 0.6)));
      W.pelvis = lerp3(A.pelvis, hipsOver(V, B.feet, 0.02, scale(V.out, 0.04)), body);
      const out = fromWorld(W);
      out.kneePole = blendSpec(c.kneePole, [0, 0, 1], body);
      out.footRot = blendSpec(c.footRot, baseSpec().footRot, smooth(k / 0.7));
      out.wrist = blendSpec(c.wrist, [-0.2, -0.2], body);
      out.grip = [0.4 + 0.4 * body, 0.4 + 0.4 * body];
      out.elbowPole = c.elbowPole;
      return out;
    }
    case "stepBack": {
      // across the porch between the handrails, facing the LM (egress: backwards; ingress: forwards)
      const k = f.up ? 1 - u : u; // 0 at the deck, 1 at the porch
      const deck = [0, 1].map((side) => bootAt(V, P.deck, side));
      const porch = [0, 1].map((side) => bootAt(V, P.porch, side));
      const feetW = f.up
        ? footfalls(
            [
              { start: porch[0], moves: [[0.08, 0.46, deck[0]]] },
              { start: porch[1], moves: [[0.5, 0.88, deck[1]]] },
            ],
            u
          )
        : footfalls(
            [
              { start: deck[0], moves: [[0.08, 0.46, porch[0]]] },
              { start: deck[1], moves: [[0.5, 0.88, porch[1]]] },
            ],
            u
          );
      const st = standSpec(t);
      st.torsoRot[0] = 0.14;
      const W = specWorld(st, root, h);
      W.feet = feetW;
      W.pelvis = hipsOver(V, feetW, 0.02, scale(V.out, 0.03));
      // gloves from the hatch frame onto the handrails, then sliding along them
      W.hands = [0, 1].map((side) => {
        const rail = gloveOnHandrail(V, 0.9 - 0.9 * k, side);
        const frame = addv(V.frame[side], V.out, 0.04);
        return lerp3(frame, rail, smooth(k / 0.22));
      });
      const out = fromWorld(W);
      out.grip = [0.8, 0.8];
      out.wrist = [-0.3, -0.3];
      out.footRot = baseSpec().footRot;
      return out;
    }
    case "climb": {
      // boots rung to rung, the lead side first; gloves on the rails about three rungs above
      const i = f.step;
      const down = !f.up;
      const from = down ? (i === 0 ? null : P.rungs[i]) : i === 0 ? null : P.rungs[8 - i];
      const to = down ? P.rungs[i + 1] : i === 7 ? null : P.rungs[7 - i];
      const lead = i % 2;
      const prog = (side) => smooth(side === lead ? u / 0.55 : (u - 0.42) / 0.55);
      const feetW = [0, 1].map((side) => {
        const a = from ? bootOnRung(V, from, side) : down ? bootAt(V, P.porch, side) : bootAt(V, P.pad, side);
        const b = to ? bootOnRung(V, to, side) : bootAt(V, P.porch, side);
        const k = prog(side);
        // the boot swings clear of the rung: out and (going up) over it
        const arc = Math.sin(Math.PI * k) * (down ? 0.05 : 0.09);
        return addv(addv(lerp3(a, b, k), V.away, arc), V.up, down ? 0 : arc * 0.7);
      });
      // the gloves: each follows the boot on the other side, about a metre above it; near the top on
      // the porch handrails' posts, lower down on the ladder's rails; one hand moves across at a time
      const reach = [false, false];
      const handsW = [0, 1].map((side) => {
        const k = prog(1 - side);
        const y = feetW[1 - side][1] + GRIP_ABOVE;
        const post = gloveOnPost(V, y, side);
        const rail = gloveOnRailAt(V, y, side);
        // the rung (step) on which this hand moves across: going down after the second rung,
        // going up before the last two
        const across = down ? 2 + side : 5 + (1 - side);
        if (i < across) return down ? post : rail;
        if (i > across) return down ? rail : post;
        // the move across takes the whole step: a deliberate reach, not a snatch
        const a = down ? post : rail;
        const b = down ? rail : post;
        const kk = smooth((u - 0.05) / 0.9);
        if (kk > 0 && kk < 1) reach[side] = true;
        return addv(lerp3(a, b, kk), V.away, 0.1 * Math.sin(Math.PI * kk));
      });
      handsW.reach = reach;
      const avgFoot = lerp3(feetW[0], feetW[1], 0.5);
      const c = baseSpec();
      const W = specWorld(c, root, h);
      W.pelvis = addv(addv(avgFoot, V.ladderUp, CLIMB_HIPS[0]), V.away, CLIMB_HIPS[1]);
      W.feet = feetW;
      W.hands = handsW;
      const climbing = fromWorld(W);
      climbing.pelvisRot = [V.lean * 0.55, 0, 0];
      climbing.torsoRot = [V.lean * 0.5, 0, 0];
      climbing.footRot = [
        [-0.05, 0.05, 0],
        [-0.05, -0.05, 0],
      ];
      climbing.grip = [0.85, 0.85];
      climbing.wrist = [-0.25, -0.25];
      climbing.elbowPole = [0.55, -0.25, -0.35];
      climbing.reach = handsW.reach;
      // stepping off the porch or the footpad onto the ladder (or onto the porch from it): from standing
      const edge = (down && i === 0) || (!down && i === 0) ? smooth(u * 1.7) : !down && i === 7 ? 1 - smooth((u - 0.4) * 1.7) : 1;
      if (edge >= 1) return climbing;
      const st = standSpec(t);
      const onPad = !down && i === 0;
      st.torsoRot[0] = onPad ? 0.45 : 0.14;
      const SW = specWorld(st, root, h);
      SW.feet = feetW;
      SW.pelvis = hipsOver(V, feetW, onPad ? 0.06 : 0.02, scale(V.out, onPad ? -0.06 : 0.03));
      SW.hands = handsW;
      const standing = fromWorld(SW);
      standing.grip = [0.8, 0.8];
      standing.wrist = [-0.3, -0.3];
      const out = blendSpec(standing, climbing, edge);
      out.feet = climbing.feet;
      out.reach = climbing.reach;
      return out;
    }
    case "drop": {
      // off the rails' feet to the footpad: a short, slow drop in lunar gravity, knees taking it
      const top = [0, 1].map((side) => bootOnRung(V, P.rungs[8], side));
      const pad = [0, 1].map((side) => bootAt(V, P.pad, side));
      // a free fall in lunar gravity: 0.6 m takes most of a second (data/evaSim EGRESS.toPad)
      const ft = clamp((u - 0.1) / 0.45, 0, 1);
      const feetW = [0, 1].map((side) => {
        const p = lerp3(top[side], pad[side], smooth(ft)); // across
        p[1] = lerp(top[side][1], pad[side][1], ft * ft); // and down, falling
        return addv(p, V.away, 0.04 * Math.sin(Math.PI * ft));
      });
      const land = Math.sin(Math.PI * clamp((u - 0.55) / 0.42, 0, 1));
      const startHips = addv(addv(lerp3(top[0], top[1], 0.5), V.ladderUp, CLIMB_HIPS[0]), V.away, CLIMB_HIPS[1]);
      const endHips = hipsOver(V, pad, 0.17 * land, scale(V.out, -0.04));
      const st = standSpec(t);
      const W = specWorld(st, root, h);
      W.feet = feetW;
      W.pelvis = lerp3(startHips, endHips, smooth((u - 0.05) / 0.55));
      W.hands = [0, 1].map((side) => gloveOnRailAt(V, feetW[1 - side][1] + GRIP_ABOVE, side));
      const out = fromWorld(W);
      const k = smooth((u - 0.05) / 0.55);
      out.pelvisRot = [lerp(V.lean * 0.55, 0.03 + 0.15 * land, k), 0, 0];
      out.torsoRot = [lerp(V.lean * 0.5, 0.06 + 0.25 * land, k), 0, 0];
      const release = smooth((u - 0.72) / 0.28);
      out.hands = out.hands.map((p, side) => lerp3(p, [REST[side][0], REST[side][1] - 0.16 * land, REST[side][2]], release));
      out.grip = [0.85 * (1 - release), 0.85 * (1 - release)];
      out.wrist = [-0.25 * (1 - release), -0.25 * (1 - release)];
      out.elbowPole = blendSpec([0.55, -0.25, -0.35], baseSpec().elbowPole, release);
      out.reach = [release > 0 && release < 1, release > 0 && release < 1];
      return out;
    }
    case "stepDown":
    case "stepUp": {
      // off the footpad onto the surface, backwards — the first boot on the Moon — then the other
      // beside it; or (stepUp) up onto the footpad from the surface, forwards, reaching for the rails
      const back = f.pose === "stepDown";
      const pad = [0, 1].map((side) => bootAt(V, P.pad, side));
      const ground = [0, 1].map((side) => bootAt(V, P.ground, side));
      const mid = bootAt(V, P.pad, 0, lm.padR + 0.12); // just off the footpad's rim
      mid[1] = P.ground[1] + BODY.ankle;
      const plan = back
        ? [
            { start: pad[0], moves: [[0.1, 0.42, mid], [0.8, 0.98, ground[0]]] },
            { start: pad[1], moves: [[0.46, 0.82, ground[1]]] },
          ]
        : [
            { start: ground[0], moves: [[0.04, 0.3, mid], [0.68, 0.96, pad[0]]] },
            { start: ground[1], moves: [[0.3, 0.68, pad[1]]] },
          ];
      const feetW = footfalls(plan, u, back ? 0.06 : 0.1);
      const st = standSpec(t);
      st.torsoRot[0] = back ? 0.08 : lerp(0.08, 0.45, smooth((u - 0.6) / 0.4));
      const W = specWorld(st, root, h);
      W.feet = feetW;
      W.pelvis = hipsOver(V, feetW, back ? 0.02 : 0.02 + 0.04 * smooth((u - 0.6) / 0.4), scale(V.out, back ? 0 : -0.06 * smooth((u - 0.6) / 0.4)));
      const out = fromWorld(W);
      out.footRot = baseSpec().footRot;
      if (back) {
        out.hands = REST.map((p) => p.slice()); // the drop let go of the rails
      } else {
        const k = smooth((u - 0.62) / 0.38);
        out.hands = [0, 1].map((side) => lerp3(REST[side], L(gloveOnRailAt(V, P.pad[1] + BODY.ankle + GRIP_ABOVE, side)), k));
        out.grip = [0.35 + 0.45 * k, 0.35 + 0.45 * k];
        out.wrist = [0.15 - 0.45 * k, 0.15 - 0.45 * k];
      }
      return out;
    }
    case "turn":
      return walkSpec({ phase: 0, speed: 0, turnPhase: u * 4, turning: 1, t });
    default:
      return standSpec(t);
  }
}

/** A spec's positions (pelvis, feet, hands) into world metres for a root, and back. */
export function specWorld(spec, root, heading) {
  return { ...spec, pelvis: toWorld(root, heading, spec.pelvis), feet: spec.feet.map((p) => toWorld(root, heading, p)), hands: spec.hands.map((p) => toWorld(root, heading, p)) };
}
export function specLocal(spec, root, heading) {
  return { ...spec, pelvis: toLocal(root, heading, spec.pelvis), feet: spec.feet.map((p) => toLocal(root, heading, p)), hands: spec.hands.map((p) => toLocal(root, heading, p)) };
}

/* ---- solving ------------------------------------------------------------------------------------ */
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const ONE = new THREE.Vector3(1, 1, 1);
const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

/** Two-bone IK: root S, target T, bone lengths a, b, bend towards `pole`. Returns { joint, end, reached }. */
export function ik2(S, T, a, b, pole) {
  const d = T.clone().sub(S);
  const len = d.length();
  const L = clamp(len, Math.abs(a - b) + 1e-4, a + b - 1e-4);
  const dir = len > 1e-6 ? d.multiplyScalar(1 / len) : new THREE.Vector3(0, -1, 0);
  const end = S.clone().addScaledVector(dir, L);
  const cosA = clamp((a * a + L * L - b * b) / (2 * a * L), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const perp = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (perp.lengthSq() < 1e-10) perp.set(0, 0, 1).addScaledVector(dir, -dir.z);
  perp.normalize();
  const joint = S.clone().addScaledVector(dir, a * cosA).addScaledVector(perp, a * sinA);
  return { joint, end, reached: Math.abs(len - L) < 1e-3 };
}

/**
 * Where an elbow points (world). For an arm reaching straight forward the elbow points down (and a
 * little out); for any other reach that direction is swung with the arm (the shortest rotation from
 * forward to the arm's direction), so the elbow turns smoothly with the hand: back and out for a
 * hanging arm, down and back for one reaching out, down and forward for one reaching up the ladder.
 * Only a reach straight behind the shoulder is undefined, and no pose asks for one. The spec's
 * elbowPole (outward mirrored per arm) adds a light bias.
 */
const _inv = new THREE.Quaternion();
const _swing = new THREE.Quaternion();
const FORWARD = new THREE.Vector3(0, 0, 1);
function elbowPole(ep, side, shoulder, target, torQ) {
  _inv.copy(torQ).invert();
  const d = target.clone().sub(shoulder).applyQuaternion(_inv);
  if (d.lengthSq() < 1e-8) d.set(0, -1, 0);
  d.normalize();
  _swing.setFromUnitVectors(FORWARD, d);
  const pole = new THREE.Vector3(side * 0.3, -1, 0).normalize().applyQuaternion(_swing);
  const bias = new THREE.Vector3(side * (ep[0] + 0.45), ep[1], ep[2]).normalize();
  bias.addScaledVector(d, -bias.dot(d));
  pole.addScaledVector(bias, 0.2);
  if (pole.lengthSq() < 1e-8) pole.set(side, 0, 0);
  return pole.normalize().applyQuaternion(torQ);
}

/** The orientation whose +Y runs from `to` back to `from` (a segment hanging down its -Y) and whose +Z faces `front`. */
function segmentQuat(from, to, front) {
  const Y = from.clone().sub(to).normalize();
  const Z = front.clone().addScaledVector(Y, -front.dot(Y));
  if (Z.lengthSq() < 1e-10) Z.set(0, 0, 1).addScaledVector(Y, -Y.z);
  Z.normalize();
  const X = new THREE.Vector3().crossVectors(Y, Z);
  return new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(X, Y, Z));
}

/**
 * Every segment's position and orientation (root frame) for a spec:
 * { pelvis, torso, thighL, shinL, footL, …, handR: { p: Vector3, q: Quaternion } } plus the
 * joints (knees, elbows, ankles, wrists, shoulders, hips) and whether each limb reached its target.
 */
export function solveRig(spec) {
  const out = {};
  const pelQ = new THREE.Quaternion().setFromEuler(_e.set(spec.pelvisRot[0], spec.pelvisRot[1], spec.pelvisRot[2], "YXZ"));
  const pelP = V3(spec.pelvis);
  out.pelvis = { p: pelP, q: pelQ };
  const pelM = new THREE.Matrix4().compose(pelP, pelQ, ONE);
  const torQl = new THREE.Quaternion().setFromEuler(_e.set(spec.torsoRot[0], spec.torsoRot[1], spec.torsoRot[2], "YXZ"));
  const torP = new THREE.Vector3(0, BODY.waist, 0).applyMatrix4(pelM);
  const torQ = pelQ.clone().multiply(torQl);
  out.torso = { p: torP, q: torQ };
  const torM = new THREE.Matrix4().compose(torP, torQ, ONE);
  const joints = { reached: {} };
  // legs
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? 1 : -1;
    const tag = i === 0 ? "L" : "R";
    const hip = new THREE.Vector3(side * BODY.hipW, 0, 0).applyMatrix4(pelM);
    const pole = V3(spec.kneePole).add(new THREE.Vector3(side * 0.12, 0, 0)).applyQuaternion(pelQ);
    const { joint: knee, end: ankle, reached } = ik2(hip, V3(spec.feet[i]), BODY.thigh, BODY.shin, pole);
    out[`thigh${tag}`] = { p: hip, q: segmentQuat(hip, knee, pole) };
    out[`shin${tag}`] = { p: knee, q: segmentQuat(knee, ankle, pole) };
    const fr = spec.footRot[i];
    const yaw = spec.pelvisRot[1] * 0.5 + fr[1];
    out[`foot${tag}`] = { p: ankle, q: new THREE.Quaternion().setFromEuler(_e.set(fr[0], yaw, fr[2], "YXZ")) };
    joints[`hip${tag}`] = hip;
    joints[`knee${tag}`] = knee;
    joints[`ankle${tag}`] = ankle;
    joints.reached[`leg${tag}`] = reached;
  }
  // arms
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? 1 : -1;
    const tag = i === 0 ? "L" : "R";
    const sh = new THREE.Vector3(side * BODY.shoulderW, BODY.shoulderY, -0.01).applyMatrix4(torM);
    const pole = elbowPole(spec.elbowPole, side, sh, V3(spec.hands[i]), torQ);
    const { joint: elbow, end: wrist, reached } = ik2(sh, V3(spec.hands[i]), BODY.upperArm, BODY.forearm, pole);
    const front = pole.clone().negate();
    out[`upperArm${tag}`] = { p: sh, q: segmentQuat(sh, elbow, front) };
    const fq = segmentQuat(elbow, wrist, front);
    out[`forearm${tag}`] = { p: elbow, q: fq };
    out[`hand${tag}`] = { p: wrist, q: fq.clone().multiply(_q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), spec.wrist[i])) };
    joints[`shoulder${tag}`] = sh;
    joints[`elbow${tag}`] = elbow;
    joints[`wrist${tag}`] = wrist;
    joints.reached[`arm${tag}`] = reached;
  }
  out.joints = joints;
  out.grip = spec.grip;
  out.tool = spec.tool || 0;
  out.scoop = spec.scoop || null;
  out.stoneIn = spec.stoneIn || null;
  out.reach = spec.reach || [false, false];
  return out;
}

/** The lowest point of a boot's sole (root frame, m) for a solved foot. */
export function soleLow(seg) {
  let low = Infinity;
  for (const [x, y, z] of [
    [0.06, -BODY.ankle, BODY.toe + 0.05],
    [-0.06, -BODY.ankle, BODY.toe + 0.05],
    [0.06, -BODY.ankle, -0.09],
    [-0.06, -BODY.ankle, -0.09],
  ]) {
    low = Math.min(low, new THREE.Vector3(x, y, z).applyQuaternion(seg.q).add(seg.p).y);
  }
  return low;
}

/** The chest camera's lens and view direction (root frame) for a solved rig: the photo view. */
export function chestCamera(rig) {
  const lens = new THREE.Vector3(...BODY.chest).applyQuaternion(rig.torso.q).add(rig.torso.p);
  const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(rig.torso.q);
  return { lens, dir };
}
