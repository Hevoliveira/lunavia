import { AREA, EGRESS, EVA_SITES, INGRESS, SUIT, createWalker, egressAt, egressLength, evaAvailableAt, evaWorld, ingressAt, ingressLength, interactionAt, lmFrame, nextTask, photoCheck, resolve, stepWalker } from "./evaSim";
import { getSite } from "./landingSites";
import { buildTerrain } from "./terrainMesh";
import { OFFICIAL_MISSION_IDS } from "./missionConfig";

const site = getSite("tranquillitatis");
const terrain = buildTerrain(site);
const ground = (x, z) => terrain.lookup(x, z);
const poseAt = (xm = 0, tilt = 0, pitch = 0) => ({ x: xm * 0.5, padY: site.scale.y(site.contactGround(xm)), tilt, pitch, comp: [0, 0, 0, 0], probe: [0, 0, 0, 0], site: site.id });
const world = evaWorld({ site, pose: poseAt(0), ground });
const run = (w, input, secs, dt = 1 / 60) => {
  const ev = [];
  const n = Math.round(secs / dt);
  for (let i = 0; i < n; i++) ev.push(...stepWalker(w, world, input, dt));
  return ev;
};
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

describe("phase 1: one EVA site", () => {
  test("only the Sea of Tranquility has an EVA; the other three missions keep their flow", () => {
    expect(EVA_SITES).toEqual(["tranquillitatis"]);
    OFFICIAL_MISSION_IDS.forEach((id) => expect(evaAvailableAt(id)).toBe(id === "tranquillitatis"));
  });
});

describe("the lunar module where it landed", () => {
  const lm = world.lm;
  test("hatch, porch, ladder and footpad at the heights the drawn LM has them", () => {
    const g = lm.base[1];
    expect(lm.porch[1] - g).toBeGreaterThan(3.0);
    expect(lm.porch[1] - g).toBeLessThan(3.6);
    expect(lm.hatchSill[1]).toBeGreaterThan(lm.porch[1]); // the sill just above the porch deck
    expect(lm.hatch[1]).toBeGreaterThan(lm.hatchSill[1]);
    expect(lm.ladder.top[1] - g).toBeGreaterThan(2.6);
    expect(lm.ladder.bottom[1] - g).toBeGreaterThan(0.5); // the last rung well above the pad, as on the LM
    expect(lm.ladder.bottom[1] - g).toBeLessThan(1.0);
    expect(lm.pad[1] - g).toBeGreaterThan(0.1);
    expect(lm.pad[1] - g).toBeLessThan(0.3);
    // eight steps of about 0.34 m from the porch to the bottom rung
    const all = [lm.ladder.top, ...lm.ladder.rungs, lm.ladder.bottom];
    for (let i = 1; i < all.length; i++) {
      const d = Math.hypot(all[i][0] - all[i - 1][0], all[i][1] - all[i - 1][1], all[i][2] - all[i - 1][2]);
      expect(d).toBeGreaterThan(0.3);
      expect(d).toBeLessThan(0.4);
      expect(all[i][1]).toBeLessThan(all[i - 1][1]);
    }
    // the deck a step below the hatch's sill; the porch handrails at about waist height either side
    expect(lm.hatchSill[1] - lm.deck[1]).toBeGreaterThan(0.4);
    expect(lm.hatchSill[1] - lm.deck[1]).toBeLessThan(0.7);
    expect(lm.deck[2]).toBeGreaterThan(lm.hatchSill[2] + 0.3); // room to stand in front of the hatch
    lm.handrails.forEach((r) => {
      expect(r.front[1] - lm.porch[1]).toBeGreaterThan(0.8);
      expect(r.front[1] - lm.porch[1]).toBeLessThan(1.2);
      expect(Math.abs(r.front[0] - lm.axis[0])).toBeGreaterThan(0.4); // wider than the suit
    });
    expect(lm.ladder.rails.length).toBe(2);
    // the ladder on the front leg (+z), leaning out towards the footpad
    expect(lm.ladder.bottom[2]).toBeGreaterThan(lm.ladder.top[2]);
    expect(lm.board[2] - lm.axis[1]).toBeGreaterThan(5);
    expect(Math.abs(lm.board[0] - lm.axis[0])).toBeLessThan(0.01);
  });
  test("the LM's own landing pose moves and tilts the hardware with it (no teleport)", () => {
    const a = lmFrame(poseAt(12));
    expect(a.axis[0]).toBeCloseTo(12, 6);
    expect(a.board[0]).toBeCloseTo(12, 6);
    const tilted = lmFrame(poseAt(0, 0, 4)); // +pitch lowers the +z side (the ladder's)
    expect(tilted.porch[1]).toBeLessThan(lm.porch[1]);
  });
});

describe("walking on the Moon", () => {
  test("the walk builds up and slows down like a suited body: no instant speed, no skating", () => {
    const w = createWalker(world, world.lm.board[0], world.lm.board[2] + 3, 0);
    run(w, { x: 0, y: 1, camYaw: 0 }, 0.5);
    expect(w.speed).toBeLessThanOrEqual(SUIT.accel * 0.5 + 1e-6);
    run(w, { x: 0, y: 1, camYaw: 0 }, 5);
    expect(w.speed).toBeCloseTo(SUIT.walk, 2);
    const at = [w.x, w.z];
    run(w, { x: 0, y: 0 }, 3);
    const slid = Math.hypot(w.x - at[0], w.z - at[1]);
    expect(w.speed).toBe(0);
    expect(slid).toBeLessThan(0.5); // stops within a step or so
    expect(slid).toBeGreaterThan(0.2); // but not dead on the spot
  });
  test("turning is limited; a gentle pull back steps backwards without turning", () => {
    const w = createWalker(world, 5, 10, 0);
    run(w, { x: 1, y: 0, camYaw: 0 }, 0.25); // stick right: heading -90° (the camera's right)
    expect(Math.abs(w.heading)).toBeLessThanOrEqual(SUIT.turn * 0.26);
    const w2 = createWalker(world, 5, 10, 0);
    run(w2, { x: 0, y: -0.4, camYaw: 0 }, 2);
    expect(w2.heading).toBeCloseTo(0, 6);
    expect(w2.speed).toBeLessThan(0);
    expect(w2.z).toBeLessThan(10);
  });
  test("feet stay on the drawn ground; walking leaves alternating footprints", () => {
    const w = createWalker(world, 3, 8, Math.PI / 2);
    const ev = run(w, { x: -1, y: 0, camYaw: 0 }, 12);
    expect(Math.abs(w.y - ground(w.x, w.z))).toBeLessThan(1e-9);
    expect(ev.length).toBeGreaterThan(8);
    for (let i = 1; i < ev.length; i++) expect(ev[i].side).not.toBe(ev[i - 1].side);
    expect(Math.abs(w.steps * SUIT.stride - w.distance)).toBeLessThan(w.distance * 0.35);
  });
  test("never through the lunar module, its legs or a boulder", () => {
    const [ax, az] = world.lm.axis;
    const w = createWalker(world, ax + 12, az + 0.5, -Math.PI / 2);
    run(w, { x: 0, y: 1, camYaw: -Math.PI / 2 }, 25); // straight at the LM
    expect(Math.hypot(w.x - ax, w.z - az)).toBeGreaterThan(2.45 + SUIT.radius - 0.01);
    // every boulder: a walker placed inside one is pushed out
    world.cols.circles.filter((c) => c.kind === "rock").forEach((c) => {
      const [x, z] = resolve(world.cols, c.x + 0.05, c.z);
      expect(Math.hypot(x - c.x, z - c.z)).toBeGreaterThanOrEqual(c.r + SUIT.radius - 1e-6);
    });
    expect(world.cols.circles.filter((c) => c.kind === "rock").length).toBeGreaterThan(5); // the boulder fields 20 m west
  });
  test("the exploration area: a warning, then no further out; never off the drawn patch", () => {
    const [ax, az] = world.lm.axis;
    const w = createWalker(world, ax + 6, az + 6, Math.PI / 4);
    let warned = false;
    for (let t = 0; t < 70; t += 1 / 30) {
      stepWalker(w, world, { x: -0.7, y: 0.7, camYaw: 0 }, 1 / 30);
      warned = warned || w.warn;
    }
    expect(warned).toBe(true);
    expect(w.atLimit).toBe(true);
    expect(Math.hypot(w.x - ax, w.z - az)).toBeLessThanOrEqual(AREA.limit + 0.05);
    expect(Math.abs(w.z)).toBeLessThanOrEqual(AREA.zMax);
    // and back in, freely
    run(w, { x: 0.7, y: -0.7, camYaw: 0 }, 10);
    expect(Math.hypot(w.x - ax, w.z - az)).toBeLessThan(AREA.limit - 3);
  });
});

describe("egress and ingress on the LM's own hatch and ladder", () => {
  const lm = world.lm;
  test("the egress: hatch opens, out onto the porch, eight rungs down, the footpad, the surface, then a turn", () => {
    const T = egressLength();
    expect(T).toBeGreaterThan(15);
    expect(T).toBeLessThan(26);
    const a0 = egressAt(lm, 0);
    expect(a0.hidden).toBe(true);
    expect(a0.hatch).toBe(0);
    expect(egressAt(lm, EGRESS.hatch).hatch).toBeCloseTo(1, 6);
    let prev = egressAt(lm, 0).pos;
    let firstStepAt = null;
    let lastClimbY = Infinity;
    for (let t = 0; t <= T + 0.5; t += 0.05) {
      const s = egressAt(lm, t);
      // continuous: never a jump between frames (no teleport)
      expect(Math.hypot(s.pos[0] - prev[0], s.pos[1] - prev[1], s.pos[2] - prev[2])).toBeLessThan(0.12);
      if (s.pose === "climb") {
        expect(s.pos[1]).toBeLessThanOrEqual(lastClimbY + 1e-9);
        lastClimbY = s.pos[1];
      }
      if (s.firstStep && firstStepAt == null) firstStepAt = t;
      prev = s.pos;
    }
    const end = egressAt(lm, T + 1);
    expect(end.done).toBe(true);
    expect(dist2(end.pos, lm.board)).toBeLessThan(1e-9);
    expect(end.pos[1]).toBeCloseTo(lm.board[1], 6); // on the ground
    expect(firstStepAt).toBeGreaterThan(T - EGRESS.turn - EGRESS.step);
    // facing out, away from the LM, ready to walk
    expect(Math.cos(end.heading)).toBeGreaterThan(0.99);
  });
  test("the ingress: up the footpad and the ladder, in through the hatch, the hatch closed", () => {
    const T = ingressLength();
    const a0 = ingressAt(lm, 0);
    expect(dist2(a0.pos, lm.board)).toBeLessThan(1e-9);
    let prev = a0.pos;
    for (let t = 0; t <= T + 0.5; t += 0.05) {
      const s = ingressAt(lm, t);
      expect(Math.hypot(s.pos[0] - prev[0], s.pos[1] - prev[1], s.pos[2] - prev[2])).toBeLessThan(0.12);
      prev = s.pos;
    }
    const end = ingressAt(lm, T + 0.1);
    expect(end.done).toBe(true);
    expect(end.hidden).toBe(true);
    expect(end.hatch).toBe(0);
    // the exact end is the end (summing the phases in floating point must not leave it short)
    expect(ingressAt(lm, ingressLength()).done).toBe(true);
    expect(egressAt(lm, egressLength()).done).toBe(true);
    expect(ingressAt(lm, INGRESS.toPad + INGRESS.firstRung + 6 * INGRESS.rung + INGRESS.lastRung + 0.1).pose).toBe("stepBack");
    expect(ingressAt(lm, INGRESS.toPad + INGRESS.firstRung + 6 * INGRESS.rung + INGRESS.lastRung + INGRESS.stepBack + 0.1).pose).toBe("lower");
  });
});

describe("the three objectives", () => {
  test("the sample sits on open ground near the LM; the photo stand has the Sun behind the photographer", () => {
    const [ax, az] = world.lm.axis;
    const ds = Math.hypot(world.sample.x - ax, world.sample.z - az);
    expect(ds).toBeGreaterThan(7);
    expect(ds).toBeLessThan(AREA.warn - 2);
    world.cols.circles.forEach((c) => expect(Math.hypot(world.sample.x - c.x, world.sample.z - c.z)).toBeGreaterThan(c.r + 2));
    // from the photo stand, the LM lies roughly away from the Sun
    const toLm = [ax - world.photo.x, az - world.photo.z];
    const dot = (toLm[0] * world.sunH[0] + toLm[1] * world.sunH[1]) / Math.hypot(...toLm);
    expect(dot).toBeLessThan(-0.6);
  });
  test("one task at a time: first steps, the sample, the photo, then back to the LM", () => {
    expect(nextTask({})).toBe("firstSteps");
    expect(nextTask({ firstSteps: true })).toBe("sample");
    expect(nextTask({ firstSteps: true, sample: true })).toBe("photo");
    expect(nextTask({ firstSteps: true, sample: true, photo: true })).toBe("return");
    const w = createWalker(world, world.sample.x + 0.6, world.sample.z, 0);
    expect(interactionAt(world, w, {})).toBeNull();
    expect(interactionAt(world, w, { firstSteps: true })).toBe("sample");
    expect(interactionAt(world, w, { firstSteps: true, sample: true })).toBeNull();
    const b = createWalker(world, world.lm.board[0], world.lm.board[2] + 0.8, 0);
    expect(interactionAt(world, b, { firstSteps: true })).toBe("board");
  });
  test("the landing-site photo needs the whole LM in frame, from the right distance", () => {
    const lm = world.lm;
    const view = (x, z, yawOff = 0, pitch = 6 * (Math.PI / 180)) => {
      const yaw = Math.atan2(lm.centre[0] - x, lm.centre[2] - z) + yawOff;
      return { pos: [x, ground(x, z) + 1.35, z], yaw, pitch, vfov: (50 * Math.PI) / 180, aspect: 1 };
    };
    const at = world.photo;
    expect(photoCheck(world, view(at.x, at.z)).ok).toBe(true);
    expect(photoCheck(world, view(at.x, at.z, Math.PI)).verdict).toBe("aim");
    expect(photoCheck(world, view(at.x, at.z, 0.22)).ok).toBe(false); // off centre
    const near = [lm.axis[0] + 6, lm.axis[1] + 4];
    expect(["tooClose", "frame"]).toContain(photoCheck(world, view(near[0], near[1])).verdict);
    expect(photoCheck(world, view(lm.axis[0] + 30, lm.axis[1] + 20)).verdict).toBe("tooFar");
  });
});
