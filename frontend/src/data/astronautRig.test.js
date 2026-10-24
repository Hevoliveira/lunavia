import * as THREE from "three";
import { BODY, chestCamera, consoleSpec, deploySpec, inspectSpec, photoSpec, sampleSpec, sequenceSpec, soleLow, solveRig, standSpec, toLocal, toWorld, walkSpec } from "./astronautRig";
import { EGRESS, SUIT, createWalker, egressAt, egressLength, evaWorld, ingressAt, ingressLength, padSurface, stepWalker } from "./evaSim";
import { getSite } from "./landingSites";
import { buildTerrain } from "./terrainMesh";

const site = getSite("tranquillitatis");
const terrain = buildTerrain(site);
const ground = (x, z) => terrain.lookup(x, z);
const world = evaWorld({ site, pose: { x: 0, padY: site.scale.y(site.contactGround(0)), tilt: 0, pitch: 0 }, ground });
const lm = world.lm;
const W = (f, p) => toWorld(f.pos, f.heading, [p.x, p.y, p.z]);

function bonesKept(rig) {
  for (const s of ["L", "R"]) {
    const j = rig.joints;
    expect(j[`hip${s}`].distanceTo(j[`knee${s}`])).toBeCloseTo(BODY.thigh, 5);
    expect(j[`knee${s}`].distanceTo(j[`ankle${s}`])).toBeCloseTo(BODY.shin, 5);
    expect(j[`shoulder${s}`].distanceTo(j[`elbow${s}`])).toBeCloseTo(BODY.upperArm, 5);
    expect(j[`elbow${s}`].distanceTo(j[`wrist${s}`])).toBeCloseTo(BODY.forearm, 5);
  }
}
const kneeAngle = (rig, s) => {
  const j = rig.joints;
  const a = j[`hip${s}`].clone().sub(j[`knee${s}`]).normalize();
  const b = j[`ankle${s}`].clone().sub(j[`knee${s}`]).normalize();
  return Math.PI - Math.acos(a.dot(b)); // 0 straight
};

describe("the suited body", () => {
  test("standing: 1.88 m to the helmet's top, boots flat on the ground, knees a touch bent", () => {
    const rig = solveRig(standSpec(0));
    bonesKept(rig);
    const helmet = new THREE.Vector3(...BODY.helmet).applyQuaternion(rig.torso.q).add(rig.torso.p);
    expect(helmet.y + BODY.helmetR).toBeGreaterThan(SUIT.height - 0.04);
    expect(helmet.y + BODY.helmetR).toBeLessThan(SUIT.height + 0.04);
    expect(Math.abs(soleLow(rig.footL))).toBeLessThan(0.01);
    expect(Math.abs(soleLow(rig.footR))).toBeLessThan(0.01);
    ["L", "R"].forEach((s) => {
      expect(kneeAngle(rig, s)).toBeGreaterThan(0.05);
      expect(kneeAngle(rig, s)).toBeLessThan(0.4);
      expect(rig.joints.reached[`leg${s}`]).toBe(true);
    });
  });

  test("walking at every pace: planted boots do not slide, nothing sinks into the ground, a modest float", () => {
    for (const pace of [0.35, 0.7, 1]) {
      const w = createWalker(world, 6, 12, Math.PI / 2);
      const dt = 1 / 60;
      let planted = [null, null];
      let maxSlide = 0;
      let lowY = Infinity;
      let highY = -Infinity;
      for (let n = 0; n < 60 * 8; n++) {
        stepWalker(w, world, { x: -pace, y: 0, camYaw: 0 }, dt);
        if (n < 60 * 3) continue; // up to speed
        const spec = walkSpec({ phase: w.phase, speed: w.speed, t: n * dt });
        const rig = solveRig(spec);
        bonesKept(rig);
        const f = { pos: [w.x, w.y, w.z], heading: w.heading };
        // stance: the boot on the ground (heel down)
        ["L", "R"].forEach((s, i) => {
          const sole = soleLow(rig[`foot${s}`]);
          expect(sole).toBeGreaterThan(-0.015);
          const onGround = sole < 0.004 && spec.footRot[i][0] < 0.01;
          const p = W(f, rig.joints[`ankle${s}`]);
          if (onGround) {
            if (!planted[i]) planted[i] = p;
            maxSlide = Math.max(maxSlide, Math.hypot(p[0] - planted[i][0], p[2] - planted[i][2]));
          } else planted[i] = null;
          expect(rig.joints.reached[`leg${s}`]).toBe(true);
        });
        lowY = Math.min(lowY, rig.pelvis.p.y);
        highY = Math.max(highY, rig.pelvis.p.y);
      }
      expect(maxSlide).toBeLessThan(0.035);
      expect(highY - lowY).toBeLessThan(SUIT.bob + 0.035); // a lope, not bouncing
      expect(highY - lowY).toBeGreaterThan(0.005);
    }
  });

  test("knees bend forwards and elbows backwards, within what a suit allows", () => {
    for (let ph = 0; ph < 1; ph += 0.05) {
      const rig = solveRig(walkSpec({ phase: ph, speed: SUIT.walk }));
      ["L", "R"].forEach((s) => {
        const j = rig.joints;
        const mid = j[`hip${s}`].clone().lerp(j[`ankle${s}`], 0.5);
        expect(j[`knee${s}`].z).toBeGreaterThan(mid.z - 0.005);
        expect(kneeAngle(rig, s)).toBeLessThan(1.6);
        expect(j[`elbow${s}`].z).toBeLessThan(j[`wrist${s}`].z);
      });
    }
  });
});

describe("the motion", () => {
  test("walking forwards the heel comes down first and rolls flat; the toe pushes off at the end", () => {
    const d = 0.44; // each boot's share of the cycle on the ground at full pace
    const at = (q) => walkSpec({ phase: q, speed: SUIT.walk }).footRot[0][0]; // the left boot: stance from phase 0
    expect(at(0.001)).toBeLessThan(-0.1); // toe up at heel strike
    expect(Math.abs(at(d * 0.3))).toBeLessThan(0.02); // flat mid-stance
    expect(at(d * 0.98)).toBeGreaterThan(0.2); // onto the ball at toe-off
    const rig = solveRig(walkSpec({ phase: 0.001, speed: SUIT.walk }));
    expect(Math.abs(soleLow(rig.footL))).toBeLessThan(0.01); // the heel on the ground, not in it
  });

  test("standing is never quite still, and never more than a suit allows", () => {
    const xs = [];
    const yaws = [];
    for (let t = 0; t < 40; t += 0.5) {
      const s = standSpec(t);
      xs.push(s.pelvis[0]);
      yaws.push(s.torsoRot[1]);
      const rig = solveRig(s);
      expect(Math.abs(soleLow(rig.footL))).toBeLessThan(0.01);
      expect(Math.abs(soleLow(rig.footR))).toBeLessThan(0.01);
      expect(rig.joints.reached.legL && rig.joints.reached.legR).toBe(true);
    }
    const span = (a) => Math.max(...a) - Math.min(...a);
    expect(span(xs)).toBeGreaterThan(0.015); // the weight shifts from boot to boot
    expect(span(xs)).toBeLessThan(0.04);
    expect(span(yaws)).toBeGreaterThan(0.06); // a slow look round
    expect(span(yaws)).toBeLessThan(0.2);
  });
});

describe("the egress and the ingress on the LM's hardware", () => {
  const run = (at, T) => {
    const frames = [];
    for (let t = 0; t <= T + 0.2; t += 1 / 30) {
      const f = at(lm, t);
      frames.push({ t, f, rig: solveRig(sequenceSpec(lm, f, t)) });
    }
    return frames;
  };
  const egress = run(egressAt, egressLength());
  const ingress = run(ingressAt, ingressLength());
  const NAMES = ["pelvis", "torso", "footL", "footR", "handL", "handR", "shinL", "shinR", "forearmL", "forearmR"];

  test.each([
    ["egress", egress],
    ["ingress", ingress],
  ])("%s: every part of the body moves smoothly (no pops, no teleport)", (name, frames) => {
    let worst = 0;
    let at = "";
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1];
      const b = frames[i];
      bonesKept(b.rig);
      for (const n of NAMES) {
        const pa = W(a.f, a.rig[n].p);
        const pb = W(b.f, b.rig[n].p);
        const d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
        if (d > worst) {
          worst = d;
          at = `${n} ${b.f.pose} t=${b.t.toFixed(2)}`;
        }
      }
    }
    // 1/30 s: nothing faster than about 2.7 m/s (a knee in a big step), nothing jumping
    expect({ worst: +worst.toFixed(3), at }).toEqual({ worst: expect.any(Number), at: expect.any(String) });
    expect(worst).toBeLessThan(0.09);
  });

  test("on the ladder: boots on the rungs, gloves round the rails", () => {
    const P = (f) => f.f;
    let checked = 0;
    for (const fr of egress) {
      const f = P(fr);
      if (f.pose !== "climb" || f.step === 0) continue;
      // both boots planted at the start of each rung
      if (f.u < 0.045) {
        ["L", "R"].forEach((s) => {
          const ank = W(f, fr.rig.joints[`ankle${s}`]);
          const near = lm.ladder.rungs.concat([lm.ladder.bottom, lm.ladder.top]).some((r) => Math.hypot(ank[0] - r[0], ank[2] - r[2]) < 0.2 && ank[1] - r[1] > 0.04 && ank[1] - r[1] < 0.14);
          expect(near).toBe(true);
        });
        checked++;
      }
      ["L", "R"].forEach((s) => expect(fr.rig.joints.reached[`leg${s}`]).toBe(true));
      // gloves round the rails or the porch posts (except while one moves across between them)
      ["L", "R"].forEach((s, i) => {
        if (fr.rig.reach[i]) return;
        const wr = W(f, fr.rig.joints[`wrist${s}`]);
        const d = Math.min(...lm.ladder.rails.map((r) => distToSeg(wr, r.top, r.bottom)), ...lm.handrails.map((r) => distToSeg(wr, r.front, r.back)), ...lm.handrails.map((r) => distToSeg(wr, r.post, r.front)));
        expect(d).toBeLessThan(0.12);
      });
    }
    expect(checked).toBeGreaterThanOrEqual(6);
  });

  test("on the surface: the first boot off the footpad lands on the ground; nothing goes below it", () => {
    let first = null;
    for (const fr of egress) {
      const f = fr.f;
      if (!["stepDown", "turn", "idle"].includes(f.pose)) continue;
      ["L", "R"].forEach((s) => {
        const seg = fr.rig[`foot${s}`];
        const ank = W(f, seg.p);
        const low = f.pos[1] + soleLow(seg);
        const padY = padSurface(lm, ank[0], ank[2]);
        const onPad = padY != null;
        const g = onPad ? padY : ground(ank[0], ank[2]);
        expect(low).toBeGreaterThan(g - 0.025);
        if (!onPad && first == null && low - g < 0.01) first = fr.t;
      });
    }
    expect(first).not.toBeNull();
    const tFirst = egress.find((fr) => fr.f.firstStep).t;
    expect(Math.abs(first - tFirst)).toBeLessThan(0.35); // FIRST STEPS when the boot is down
    expect(first).toBeLessThan(egressLength() - EGRESS.turn);
  });

  test("hidden in the cabin until the hatch is open; back inside before it closes", () => {
    expect(egress.filter((fr) => fr.f.hidden).every((fr) => fr.f.hatch < 1 || fr.t < EGRESS.hatch + 0.05)).toBe(true);
    const lastI = ingress[ingress.length - 1];
    expect(lastI.f.hidden).toBe(true);
    expect(lastI.f.hatch).toBe(0);
    // while the hatch closes, all of the body is behind the cabin's face (the hatch plane)
    const facing = egress[0].f.heading;
    ingress
      .filter((fr) => fr.f.hatch < 1)
      .forEach((fr) => {
        ["pelvis", "torso", "footL", "footR"].forEach((n) => {
          const p = W(fr.f, fr.rig[n].p);
          const ahead = toLocal(lm.hatchSill, facing, p)[2]; // + into the cabin
          expect(ahead).toBeGreaterThan(0.1);
        });
      });
  });
});

describe("the sample and the photograph", () => {
  test("the scoop's head reaches the stone, lifts it and tips it into the bag at the hip", () => {
    const stone = [-0.05, 0.03, 0.85];
    let touched = false;
    let inBag = false;
    for (let u = 0; u <= 1; u += 0.01) {
      const spec = sampleSpec(u, stone);
      const rig = solveRig(spec);
      bonesKept(rig);
      if (spec.scoop && Math.hypot(spec.scoop.head[0] - stone[0], spec.scoop.head[2] - stone[2]) < 0.06 && Math.abs(spec.scoop.head[1] - stone[1]) < 0.06) touched = true;
      if (spec.stoneIn === "bag") inBag = true;
      if (u > 0.2 && u < 0.75) {
        // the right glove holds the handle's end
        expect(rig.joints.wristR.distanceTo(new THREE.Vector3(...spec.hands[1]))).toBeLessThan(0.08);
      }
    }
    expect(touched).toBe(true);
    expect(inBag).toBe(true);
    expect(sampleSpec(1, stone).tool).toBeCloseTo(0, 6); // the scoop stowed again
  });
  test("the chest camera looks where the body is turned and tilts with the aim", () => {
    const level = chestCamera(solveRig(photoSpec(0)));
    const up = chestCamera(solveRig(photoSpec(0.2)));
    expect(level.dir.z).toBeGreaterThan(0.98);
    expect(up.dir.y).toBeGreaterThan(level.dir.y + 0.1);
    expect(level.lens.y).toBeGreaterThan(1.2);
    expect(level.lens.y).toBeLessThan(1.5);
  });
});

describe("the expeditions' poses: survey, instrument, receiver", () => {
  test("inspecting a rock: a lean towards it and a pointing glove, the boots planted throughout", () => {
    const look = [0.4, 0.5, 1.6];
    let pointed = false;
    for (let u = 0; u <= 1; u += 0.02) {
      const rig = solveRig(inspectSpec(u, look));
      bonesKept(rig);
      expect(Math.abs(soleLow(rig.footL))).toBeLessThan(0.02);
      expect(Math.abs(soleLow(rig.footR))).toBeLessThan(0.02);
      if (rig.joints.wristR.z > 0.5) pointed = true;
    }
    expect(pointed).toBe(true);
    // upright again at the end
    expect(solveRig(inspectSpec(1, look)).torso.p.y).toBeCloseTo(solveRig(standSpec(0)).torso.p.y, 2);
  });

  test("deploying: the package goes down in both gloves, is let go near the ground, and he stands back up", () => {
    let lowest = Infinity;
    let released = null;
    for (let u = 0; u <= 1; u += 0.01) {
      const spec = deploySpec(u);
      const rig = solveRig(spec);
      bonesKept(rig);
      expect(Math.abs(soleLow(rig.footL))).toBeLessThan(0.03);
      expect(Math.abs(soleLow(rig.footR))).toBeLessThan(0.03);
      if (spec.pack) {
        lowest = Math.min(lowest, spec.pack[1]);
        // both gloves on the package
        const mid = rig.joints.wristL.clone().add(rig.joints.wristR).multiplyScalar(0.5);
        expect(Math.abs(mid.x)).toBeLessThan(0.08);
      } else if (released === null) released = u;
    }
    expect(lowest).toBeLessThan(0.55);
    expect(released).toBeGreaterThan(0.3);
    expect(released).toBeLessThan(0.42);
    expect(solveRig(deploySpec(1)).torso.p.y).toBeCloseTo(solveRig(standSpec(0)).torso.p.y, 2);
  });

  test("at the receiver's panel: both gloves forward at waist height", () => {
    const rig = solveRig(consoleSpec(0));
    bonesKept(rig);
    expect(rig.joints.wristL.z).toBeGreaterThan(0.3);
    expect(rig.joints.wristR.z).toBeGreaterThan(0.3);
  });
});

function distToSeg(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const u = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l2));
  return Math.hypot(ap[0] - ab[0] * u, ap[1] - ab[1] * u, ap[2] - ab[2] * u);
}
