import {
  ASCENT_DIFFICULTY,
  BURN_MAX,
  CSI_BEHIND,
  DT,
  INSERT_SPEED,
  MDOT,
  MU,
  R_MOON,
  STAGE,
  TARGET,
  VERTICAL_RISE,
  accuracyOf,
  advance,
  coastToApoapsis,
  createAscent,
  cutoffDue,
  cutoffRecord,
  evaluateInsertion,
  guidancePitch,
  guidanceProgram,
  minOrbitSpeed,
  orbitOf,
  referenceFlight,
  rendezvousFromCutoff,
  simulate,
  stepOf,
  telemetry,
  toLvlh,
  unrecoverable,
} from "./manualAscent";
import { ASCENT } from "./lunarAscent";
import { COAST, planRendezvous, rangeOf } from "./rendezvous";
import { ORBIT_R, checkpointState, frames } from "./dockingSim";

const D = Math.PI / 180;
// a pilot's hand on the pitch control: towards a pitch (deg), as a player holding PITCH DOWN/UP would
const toward = (s, deg, k = 0.5) => Math.max(-1, Math.min(1, (deg - s.pitch / D) * k));
const guided = (s) => (s.t < VERTICAL_RISE ? 0 : Math.max(-1, Math.min(1, (guidancePitch(s).pitch - s.pitch) * 4)));
const twoStep = (P1, A, P2) => (s) => {
  const o = orbitOf(s.r, s.vr, s.vt);
  if (s.t >= VERTICAL_RISE && o.ha >= A * 1000) s.__late = true;
  return { pitch: s.t < VERTICAL_RISE ? 0 : toward(s, s.__late ? P2 : P1), cutoff: cutoffDue(s) };
};
const fly = (program, difficulty = "ASTRONAUT") => simulate(program, { difficulty }).state;

describe("the ascent stage on the pad", () => {
  test("is the ascent stage alone (the descent stage stays on the Moon) with the guided liftoff's engine", () => {
    const s = createAscent("ASTRONAUT");
    expect(s.mass).toBe(ASCENT.mass0);
    expect(STAGE.thrust).toBe(ASCENT.thrust);
    expect(STAGE.isp).toBe(ASCENT.isp);
    expect(s.r).toBe(R_MOON);
    expect(s.engine).toBe("armed");
    expect(BURN_MAX).toBeGreaterThan(440);
    expect(BURN_MAX).toBeLessThan(480);
  });
  test("nothing moves until ENGINE IGNITION", () => {
    const s = createAscent("ASTRONAUT");
    for (let i = 0; i < 300; i++) advance(s, { pitch: 1 }, 1 / 60);
    expect(s.r).toBe(R_MOON);
    expect(s.prop).toBe(STAGE.prop);
    expect(s.t).toBe(0);
    expect(s.status).toBe("pad");
  });
});

describe("physics", () => {
  test("ignition: the stage accelerates upwards at thrust/mass − gravity", () => {
    const s = createAscent("ASTRONAUT");
    advance(s, { ignite: true }, DT);
    for (let i = 0; i < 5 / DT; i++) advance(s, {}, DT);
    const g = MU / (R_MOON * R_MOON);
    const a0 = STAGE.thrust / STAGE.mass0 - g;
    expect(s.lifted).toBe(true);
    expect(s.vr).toBeGreaterThan(a0 * 5 * 0.98);
    expect(s.vr).toBeLessThan(a0 * 5 * 1.1); // a little more as the mass falls
    expect(s.r - R_MOON).toBeGreaterThan(0.5 * a0 * 25 * 0.95);
    expect(s.vt).toBeCloseTo(0, 6); // vertical rise: no horizontal speed
  });
  test("propellant flows at thrust / (Isp·g0) and the mass falls with it", () => {
    const s = createAscent("ASTRONAUT");
    advance(s, { ignite: true }, DT);
    for (let i = 0; i < 100 / DT; i++) advance(s, {}, DT);
    const burned = STAGE.prop - s.prop;
    expect(burned).toBeCloseTo(MDOT * s.t, 0);
    expect(STAGE.mass0 - s.mass).toBeCloseTo(burned, 6);
  });
  test("gravity: after cutoff the stage decelerates by μ/r² − vt²/r", () => {
    const s = createAscent("ASTRONAUT");
    advance(s, { ignite: true }, DT);
    for (let i = 0; i < 30 / DT; i++) advance(s, {}, DT);
    // copy the state and coast it one second by the same equations (engine off)
    const c = { ...s, engine: "cutoff", status: "flight", cfg: s.cfg };
    const vr0 = c.vr;
    const g = MU / (c.r * c.r) - (c.vt * c.vt) / c.r;
    // coast with the raw step through advance: the engine is already off, so it is judged at
    // once; integrate by hand instead
    let r = c.r;
    let vr = c.vr;
    for (let i = 0; i < 50; i++) {
      vr += -(MU / (r * r)) * 0.02;
      r += vr * 0.02;
    }
    expect(vr - vr0).toBeCloseTo(-g * 1, 2);
  });
  test("attitude changes the trajectory: a flatter pitch builds horizontal speed, a steeper one height", () => {
    const at = (P) => {
      const s = createAscent("ASTRONAUT");
      advance(s, { ignite: true }, DT);
      while (s.t < 120) advance(s, { pitch: s.t < VERTICAL_RISE ? 0 : toward(s, P) }, DT);
      return telemetry(s);
    };
    const steep = at(40);
    const flat = at(65);
    expect(flat.vt).toBeGreaterThan(steep.vt + 60);
    expect(steep.alt).toBeGreaterThan(flat.alt + 3000);
    expect(steep.vr).toBeGreaterThan(flat.vr);
  });
  test("the engine has no throttle: the burn always lasts BURN_MAX at full thrust", () => {
    const s = fly((s) => ({ pitch: guided(s) })); // the guidance, never cut off
    expect(s.cutoffBy).toBe("depleted");
    expect(s.cutoffAt).toBeGreaterThan(BURN_MAX - 0.05);
    expect(s.cutoffAt).toBeLessThan(BURN_MAX + 0.05);
    expect(s.prop).toBe(0);
  });
  test("the same inputs fly the same trajectory at any frame rate", () => {
    // breakpoints just before a 0.1-s frame boundary (both runs switch on the same step)
    const program = (t) => ({ pitch: t < 10.09 ? 0 : t < 40.09 ? 1 : t < 60.09 ? 0.4 : 0 });
    const run = (frame) => {
      const s = createAscent("ASTRONAUT");
      advance(s, { ignite: true }, DT);
      const frames = Math.round(150 / frame);
      for (let i = 0; i < frames; i++) advance(s, program(i * frame), frame);
      return s;
    };
    const a = run(0.02);
    const b = run(0.1); // 5 steps per frame, inputs constant over each 0.1 s (the program's breakpoints are on it)
    expect(b.r).toBeCloseTo(a.r, 3);
    expect(b.vt).toBeCloseTo(a.vt, 5);
    expect(b.pitch).toBeCloseTo(a.pitch, 8);
  });
  test("deterministic: the same program gives the same flight twice", () => {
    const a = fly(twoStep(50, 30, 90));
    const b = fly(twoStep(50, 30, 90));
    expect(b.r).toBe(a.r);
    expect(b.th).toBe(a.th);
    expect(b.prop).toBe(a.prop);
    expect(b.status).toBe(a.status);
  });
});

describe("guidance and the reference flight", () => {
  test("the target comes from the rendezvous: apoapsis 14 km below the CSM's 110-km orbit", () => {
    expect(ORBIT_R - R_MOON).toBeCloseTo(110000, 6);
    expect(TARGET.apo).toBeCloseTo(96000, 6);
    expect(TARGET.apoLimit).toBeLessThan(ORBIT_R - R_MOON);
    expect(INSERT_SPEED).toBeGreaterThan(1680);
    expect(INSERT_SPEED).toBeLessThan(1700);
  });
  test("the guidance flown perfectly reaches 18 × 96 km in about seven minutes with propellant to spare", () => {
    const r = referenceFlight();
    expect(r.cutoffAt).toBeGreaterThan(400);
    expect(r.cutoffAt).toBeLessThan(450);
    expect(r.apo / 1000).toBeCloseTo(96, 0);
    expect(r.peri / 1000).toBeCloseTo(18, 0);
    expect(r.fuelKg).toBeGreaterThan(100);
  });
  test("the vertical rise first, then a pitchover past 45°", () => {
    const s = createAscent("ASTRONAUT");
    advance(s, { ignite: true }, DT);
    while (s.t < VERTICAL_RISE - 0.5) advance(s, { pitch: guided(s) }, DT);
    expect(Math.abs(s.pitch / D)).toBeLessThan(0.5);
    while (s.t < 30) advance(s, { pitch: guided(s) }, DT);
    expect(s.pitch / D).toBeGreaterThan(40);
    expect(s.pitch / D).toBeLessThan(65);
  });
  test("the flight's steps follow the ascent", () => {
    const seen = new Set();
    simulate((s) => {
      seen.add(stepOf(s));
      return guidanceProgram(s);
    });
    ["VERTICAL", "PITCH", "HORIZONTAL", "INSERTION"].forEach((k) => expect(seen.has(k)).toBe(true));
  });
});

describe("insertion: stable orbits accepted, invalid ones rejected", () => {
  test("the reference insertion is a stable orbit the rendezvous can fly", () => {
    const s = fly(guidanceProgram);
    expect(s.status).toBe("orbit");
    const e = s.evaluation;
    expect(e.ok).toBe(true);
    expect(e.peri).toBeGreaterThanOrEqual(TARGET.safePeri);
    expect(e.apo).toBeLessThanOrEqual(TARGET.apoLimit);
    expect(e.rendezvous.dv).toBeLessThan(e.rendezvous.budget);
    expect(e.accuracy.grade).toBe("PRECISE");
  });
  test("PREMATURE CUTOFF: cut off before orbital speed, it is not an orbit", () => {
    const s = fly((s) => ({ pitch: guided(s), cutoff: s.t >= 300 }));
    expect(s.status).toBe("failed");
    expect(s.failure.kind).toBe("premature");
    expect(s.evaluation.peri).toBeLessThan(0); // the orbit intersects the Moon
  });
  test("INSUFFICIENT VELOCITY at the target apoapsis: a constant 60° pitch cut on apoapsis 96 km falls back", () => {
    const s = fly((s) => ({ pitch: s.t < VERTICAL_RISE ? 0 : toward(s, 60), cutoff: orbitOf(s.r, s.vr, s.vt).ha >= TARGET.apo }));
    expect(s.failure.kind).toBe("premature");
    expect(s.evaluation.apo / 1000).toBeCloseTo(96, 0);
    expect(s.evaluation.peri).toBeLessThan(TARGET.safePeri);
  });
  test("SURFACE IMPACT: pitched to the horizon too early", () => {
    const s = fly((s) => ({ pitch: s.t < 3 ? 0 : toward(s, 92) }));
    expect(s.failure.kind).toBe("impact");
    expect(s.t).toBeLessThan(120);
  });
  test("FUEL EXHAUSTION: never cut off on a steep climb, the propellant runs out below orbit", () => {
    const s = fly((s) => ({ pitch: s.t < VERTICAL_RISE ? 0 : toward(s, 20) }));
    expect(["depleted", "unrecoverable"]).toContain(s.failure.kind);
    if (s.failure.kind === "depleted") expect(s.prop).toBe(0);
  });
  test("UNRECOVERABLE: the speed still missing is more than the engine has left (a strict bound)", () => {
    const s = fly((s) => ({ pitch: s.t < VERTICAL_RISE ? 0 : toward(s, 10) }));
    expect(s.status).toBe("failed");
    // whichever way it ended, the reference flight at the same time was never called lost
    const ok = createAscent("ASTRONAUT");
    advance(ok, { ignite: true }, DT);
    while (ok.status === "flight" && ok.engine === "on") {
      advance(ok, guidanceProgram(ok), DT);
      expect(unrecoverable(ok)).toBe(false);
    }
  });
  test("minOrbitSpeed is the slowest stable orbit through the point (vis-viva)", () => {
    const r = R_MOON + 50000;
    const v = minOrbitSpeed(r);
    const o = orbitOf(r, 0, v);
    expect(o.hp).toBeCloseTo(TARGET.safePeri, -1);
    expect(orbitOf(r, 0, v - 5).hp).toBeLessThan(TARGET.safePeri);
  });
  test("APOAPSIS ABOVE THE CSM: never cut off on the guidance, the orbit climbs past the CSM's", () => {
    const s = fly((s) => ({ pitch: guided(s) }));
    expect(s.failure.kind).toBe("apoHigh");
    expect(s.evaluation.apo).toBeGreaterThan(ORBIT_R - R_MOON);
  });
  test("PHASING: a stable but low orbit gains too fast and passes the CSM before the rendezvous", () => {
    const s = fly((s) => ({ pitch: guided(s), cutoff: orbitOf(s.r, s.vr, s.vt).ha >= 60000 && orbitOf(s.r, s.vr, s.vt).hp > TARGET.safePeri }));
    expect(s.evaluation.peri).toBeGreaterThan(TARGET.safePeri);
    expect(s.failure.kind).toBe("phasing");
  });
  test("RENDEZVOUS PROPELLANT: a stable orbit with no propellant left for the rendezvous is rejected", () => {
    // a low (70-km apoapsis) orbit: its rendezvous needs ~38 m/s
    const s = fly((s) => ({ pitch: guided(s), cutoff: orbitOf(s.r, s.vr, s.vt).ha >= 70000 && orbitOf(s.r, s.vr, s.vt).hp > TARGET.safePeri }));
    expect(s.status).toBe("orbit"); // with its propellant left (~180 kg): accepted
    expect(s.evaluation.rendezvous.dv).toBeGreaterThan(32);
    // the same orbit with the ascent propellant gone: only the RCS reserve (30 m/s) is left
    const dry = evaluateInsertion({ ...s, prop: 0, mass: s.mass - s.prop, engine: "depleted" });
    expect(dry.rendezvous.budget).toBeCloseTo(30, 6);
    expect(dry.ok).toBe(false);
    expect(dry.failure).toBe("rendezvous");
    // and the same flight's rendezvous Δv is the same either way (the orbit decides it)
    expect(dry.rendezvous.dv).toBeCloseTo(s.evaluation.rendezvous.dv, 6);
  });
  test("accuracy: miss in km from apoapsis 96 km and any periapsis below 18 km", () => {
    expect(accuracyOf(96000, 18000)).toEqual({ miss: 0, grade: "PRECISE" });
    expect(accuracyOf(100000, 18000).grade).toBe("GOOD");
    expect(accuracyOf(85000, 18000).grade).toBe("FAIR");
    expect(accuracyOf(70000, 18000).grade).toBe("WIDE");
    expect(accuracyOf(96000, 16000).miss).toBe(2);
  });
});

describe("different inputs, different coherent outcomes", () => {
  test("four pilots, four orbits (all measured)", () => {
    const A = fly(guidanceProgram);
    const B = fly(twoStep(50, 30, 90));
    const C = fly(twoStep(45, 20, 85));
    const E = fly((s) => ({ pitch: guided(s), cutoff: orbitOf(s.r, s.vr, s.vt).ha >= 104000 && orbitOf(s.r, s.vr, s.vt).hp > TARGET.safePeri }));
    [A, B, C, E].forEach((s) => expect(s.status).toBe("orbit"));
    const peri = [A, B, C, E].map((s) => Math.round(s.evaluation.peri / 1000));
    expect(new Set(peri).size).toBeGreaterThanOrEqual(3);
    expect(E.evaluation.apo).toBeGreaterThan(A.evaluation.apo + 6000);
    // a flatter early climb (C) leaves more propellant than a higher periapsis (B) costs
    expect(B.evaluation.peri).toBeGreaterThan(C.evaluation.peri);
    expect(B.prop).toBeLessThan(C.prop);
    // and each orbit has its own rendezvous
    const dv = [A, B, C, E].map((s) => s.evaluation.rendezvous.dv.toFixed(1));
    expect(new Set(dv).size).toBe(4);
  });
});

describe("pilot difficulties", () => {
  const release = (difficulty) => {
    const s = createAscent(difficulty);
    advance(s, { ignite: true }, DT);
    while (s.t < 12) advance(s, {}, DT);
    while (s.t < 14) advance(s, { pitch: 1 }, DT); // two seconds on PITCH DOWN
    const p0 = s.pitch;
    while (s.t < 18) advance(s, {}, DT); // released
    return { s, turned: (s.pitch - p0) / D, rate: telemetry(s).rate };
  };
  test("ASTRONAUT and CADET: attitude hold — released, the pitch stays where it was left", () => {
    for (const d of ["ASTRONAUT", "CADET"]) {
      const { turned, rate } = release(d);
      expect(Math.abs(turned)).toBeLessThan(1);
      expect(Math.abs(rate)).toBeLessThan(0.2);
    }
  });
  test("COMMANDER: no attitude hold — released, the stage keeps turning until the pilot stops it", () => {
    const { turned, rate } = release("COMMANDER");
    expect(rate).toBeGreaterThan(5);
    expect(turned).toBeGreaterThan(20);
  });
  test("CADET: once the pilot starts the pitch program, the pitch assist flies it and the cutoff is automatic", () => {
    const s = fly((s) => ({ pitch: s.t > VERTICAL_RISE && s.t < VERTICAL_RISE + 1 ? 1 : 0, assist: true }), "CADET");
    expect(s.status).toBe("orbit");
    expect(s.cutoffBy).toBe("auto");
    expect(s.evaluation.accuracy.grade).toBe("PRECISE");
  });
  test("CADET: without the pilot's pitch-over, the assist does not start (it stays vertical)", () => {
    const s = createAscent("CADET");
    advance(s, { ignite: true }, DT);
    while (s.t < 40) advance(s, { assist: true }, DT);
    expect(s.pitchProgram).toBe(false);
    expect(Math.abs(s.pitch / D)).toBeLessThan(1);
  });
  test("ASTRONAUT: no pitch assist; the automatic cutoff only when armed", () => {
    expect(ASCENT_DIFFICULTY.ASTRONAUT.pitchAssist).toBe(false);
    const free = fly((s) => ({ pitch: guided(s), assist: true }));
    expect(free.cutoffBy).not.toBe("auto"); // not armed: it burns on
    const armed = fly((s) => ({ pitch: guided(s), autoCutoff: true }));
    expect(armed.cutoffBy).toBe("auto");
    expect(armed.status).toBe("orbit");
  });
  test("COMMANDER: no cue, no automatic cutoff, and still flyable by hand (rate damping by the pilot)", () => {
    expect(ASCENT_DIFFICULTY.COMMANDER.cue).toBe(false);
    const s = createAscent("COMMANDER");
    advance(s, { ignite: true }, DT);
    expect(telemetry(s).guidance).toBe(null);
    const done = fly((s) => {
      const t = telemetry(s);
      const want = s.t < VERTICAL_RISE ? 0 : guidancePitch(s).pitch / D;
      return { pitch: Math.max(-1, Math.min(1, (want - t.pitch) * 0.3 - t.rate * 0.8)), cutoff: cutoffDue(s), autoCutoff: true };
    }, "COMMANDER");
    expect(done.status).toBe("orbit");
    expect(done.cutoffBy).toBe("pilot");
  });
  test("RCS propellant is used by the attitude control", () => {
    const s = fly(twoStep(50, 30, 90));
    expect(s.rcs).toBeLessThan(STAGE.rcsProp);
    expect(s.rcs).toBeGreaterThan(STAGE.rcsProp * 0.5);
  });
});

describe("the handoff to the rendezvous", () => {
  test("the guided rendezvous is unchanged (no co-elliptic burn, TPI at COAST)", () => {
    const p = planRendezvous("ASTRONAUT");
    expect(p.manual).toBe(false);
    expect(p.burns.map((b) => b.kind)).toEqual(["TPI", "MCC", "GATE", "BRAKING"]);
    expect(p.tpiAt).toBe(COAST);
  });
  test("from the pilot's cutoff: an exact coast to apoapsis, CSI 14 km below and CSI_BEHIND behind, then the same docking checkpoint", () => {
    const s = fly(guidanceProgram);
    const cut = cutoffRecord(s);
    const c = coastToApoapsis(cut);
    expect(c.csi[0] / 1000).toBeCloseTo(-14, 0);
    expect(c.csi[1] / 1000).toBeCloseTo(CSI_BEHIND / 1000, 0);
    expect(c.csiAt).toBeGreaterThan(3000);
    // the coast starts on the stage's own state at cutoff
    toLvlh(s).forEach((v, i) => expect(c.coast(0)[i]).toBeCloseTo(v, 3));
    for (const d of ["CADET", "ASTRONAUT", "COMMANDER"]) {
      const p = rendezvousFromCutoff(d, cut);
      expect(p.feasible).toBe(true);
      expect(p.burns.map((b) => b.kind)).toEqual(["CSI", "TPI", "MCC", "GATE", "BRAKING"]);
      expect(p.minRange).toBeGreaterThan(1000);
      const end = p.sample(p.total);
      const cp = checkpointState(d);
      frames.toL(cp.pos).forEach((v, i) => expect(end[i]).toBeCloseTo(v, 6));
      // the last kilometre from behind, as the guided rendezvous
      const near = p.sample(p.total - 300);
      expect(near[1]).toBeLessThan(0);
      expect(rangeOf(p.sample(p.total - 60)).range).toBeLessThan(rangeOf(p.sample(p.csiAt)).range);
    }
  });
  test("the rendezvous plan is rebuilt identically from the saved cutoff record", () => {
    const s = fly(twoStep(50, 30, 90));
    const a = rendezvousFromCutoff("ASTRONAUT", cutoffRecord(s));
    const b = rendezvousFromCutoff("ASTRONAUT", JSON.parse(JSON.stringify(cutoffRecord(s))));
    expect(b.total).toBe(a.total);
    expect(b.totalDv).toBe(a.totalDv);
    expect(b.sample(1234)).toEqual(a.sample(1234));
  });
});

describe("the NAV display's trajectory", () => {
  const { orbitPath, planePos } = require("./manualAscent");
  test("a circular orbit's path stays at its radius all the way round", () => {
    const r = R_MOON + 96000;
    const pts = orbitPath(r, 0.3, 0, Math.sqrt(MU / r), 90);
    expect(pts.length).toBe(91);
    pts.forEach(([x, y]) => expect(Math.hypot(x, y)).toBeCloseTo(r, -1));
    // it goes downrange (clockwise from the site): the next point has a larger downrange angle
    const a0 = Math.atan2(pts[0][0], pts[0][1]);
    const a1 = Math.atan2(pts[1][0], pts[1][1]);
    expect(a1).toBeGreaterThan(a0);
  });
  test("the reference insertion's path reaches its apoapsis and periapsis heights", () => {
    const s = simulate(guidanceProgram).state;
    const pts = orbitPath(s.r, s.th, s.vr, s.vt, 360);
    const rs = pts.map(([x, y]) => Math.hypot(x, y) - R_MOON);
    expect(Math.max(...rs) / 1000).toBeCloseTo(s.evaluation.apo / 1000, 0);
    expect(Math.min(...rs) / 1000).toBeCloseTo(s.evaluation.peri / 1000, 0);
    expect(planePos(s.r, s.th)).toEqual(pts[0]);
  });
  test("a suborbital path ends on the surface", () => {
    const r = R_MOON + 10000;
    const pts = orbitPath(r, 0.01, 50, 900, 200);
    const last = pts[pts.length - 1];
    expect(Math.hypot(last[0], last[1])).toBeLessThanOrEqual(R_MOON + 1);
    expect(pts.length).toBeLessThan(200);
  });
});

describe("time to go to the cutoff, and the apoapsis window", () => {
  const { cutoffTgo } = require("./manualAscent");
  test("TGO predicts the guidance's own cutoff to within a few tenths of a second", () => {
    const s = createAscent("ASTRONAUT");
    advance(s, { ignite: true }, DT);
    let predicted = null;
    while (s.status === "flight" && s.engine === "on") {
      if (predicted == null && orbitOf(s.r, s.vr, s.vt).ha > 0.6 * TARGET.apo) {
        const tgo = cutoffTgo(s);
        if (tgo != null) predicted = s.t + tgo;
      }
      advance(s, guidanceProgram(s), DT);
    }
    expect(predicted).not.toBe(null);
    expect(Math.abs(predicted - s.cutoffAt)).toBeLessThan(0.5);
  });
  test("every stable orbit below the limit can be reached by the rendezvous (apoapsis ~70 to 106 km)", () => {
    for (const A of [70, 80, 96, 104, 105.5]) {
      const s = fly((s) => ({ pitch: guided(s), cutoff: orbitOf(s.r, s.vr, s.vt).ha >= A * 1000 && orbitOf(s.r, s.vr, s.vt).hp > TARGET.safePeri }));
      expect(s.status).toBe("orbit");
    }
  });
  test("a too-low orbit is rejected with its reason: it has passed the CSM or comes too near it", () => {
    const s = fly((s) => ({ pitch: guided(s), cutoff: orbitOf(s.r, s.vr, s.vt).ha >= 55000 && orbitOf(s.r, s.vr, s.vt).hp > TARGET.safePeri }));
    expect(s.failure.kind).toBe("phasing");
    expect(["ahead", "close"]).toContain(s.evaluation.rendezvous.reason); // it has passed the CSM, or arrives too near it
  });
});
