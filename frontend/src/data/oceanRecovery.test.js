import { BASKET_POINT, CAPSULE, COLLAR, HATCH_DIR, HELI, HELI_PLACES, HOIST_LOCAL, RAFT, RAFT_SEATS, RECOVERY, RECOVERY_CALLS, RECOVERY_CUES, SHIP, SHOTS, T, cameraAt, captionAt, collarAt, crewAboard, crewAt, dipAt, finaleAt, hatchAt, heliAt, heliToWorld, hoistAt, raftAt, shotAt, swimmerAt } from "./oceanRecovery";
import { FLOAT, M_PER_UNIT } from "./descentScene";
import { CM_PROFILE } from "./csmDesign";

const STEP = 1 / 30;
const times = () => {
  const out = [];
  for (let n = 0; n * STEP <= RECOVERY.duration; n++) out.push(n / 30);
  return out;
};
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("the cinematic: 45–75 s, its shots in order, the sequence the brief asks for", () => {
  test("duration and shot order", () => {
    expect(RECOVERY.duration).toBeGreaterThanOrEqual(45);
    expect(RECOVERY.duration).toBeLessThanOrEqual(75);
    expect(SHOTS.map((s) => s.id)).toEqual(["A", "B", "C", "D", "E", "F"]);
    for (let i = 1; i < SHOTS.length; i++) expect(SHOTS[i].from).toBe(SHOTS[i - 1].to);
    expect(shotAt(0).id).toBe("A");
    expect(shotAt(RECOVERY.duration).id).toBe("F");
  });
  test("capsule afloat → approach → swimmers → collar → egress → hoist → departure → ship → WELCOME HOME", () => {
    const order = [T.heliIn, T.hoverDrop, T.jump[0], T.collarWrap[0], T.collarFill[1], T.raftFill[0], T.hatch[0], T.egress[0][0], T.egress[2][1], T.lower[0], T.lift[0], T.aboard[1], T.depart, T.words[0][0], T.words[2][0], T.end];
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
    expect(T.heliIn).toBeGreaterThanOrEqual(3); // quiet first: the helicopter enters far out, a speck
    expect(finaleAt(RECOVERY.duration)).toEqual(["crewRecovered", "welcomeHome", "accomplished"]);
    expect(finaleAt(T.words[0][0] - 0.1)).toEqual([]);
  });
});

describe("the helicopter: an SH-3-size machine flown, never teleported", () => {
  test("its speed and acceleration stay those of a helicopter (≤ 80 m/s, ≤ 0.5 g)", () => {
    let prev = null;
    let maxV = 0;
    let maxA = 0;
    let pv = null;
    for (const t of times()) {
      const h = heliAt(t);
      if (!h.visible) continue;
      if (prev) {
        const v = dist3(h.pos, prev) / STEP;
        maxV = Math.max(maxV, v);
        if (pv !== null) maxA = Math.max(maxA, Math.abs(v - pv) / STEP);
        pv = v;
      }
      prev = h.pos;
    }
    expect(maxV).toBeLessThan(80);
    expect(maxA).toBeLessThan(0.5 * 9.81);
  });
  test("it appears far out (on the horizon), comes in, slows and hovers; it never touches the sea", () => {
    const first = heliAt(T.heliIn);
    expect(Math.hypot(first.pos[0], first.pos[2])).toBeGreaterThan(380);
    expect(heliAt(T.heliIn - 0.5).visible).toBe(false);
    const hover = heliAt(T.hoverDrop + 0.5);
    expect(Math.hypot(...hover.vel)).toBeLessThan(0.5);
    for (const t of times()) {
      const h = heliAt(t);
      if (!h.visible) continue;
      expect(h.pos[1]).toBeGreaterThan(3.5); // the hull well clear of the water
      // close to the capsule only high enough, and never right over it
      const d = Math.hypot(h.pos[0], h.pos[2]);
      if (h.pos[1] < 20) expect(d).toBeGreaterThan(6.5);
      expect(Math.abs(h.pitch)).toBeLessThan(0.25);
      expect(Math.abs(h.roll)).toBeLessThan(0.21);
    }
  });
  test("the rotor clears the capsule's apex by a wide margin in the hoist hover", () => {
    const h = heliAt((T.lower[0] + T.lift[0]) / 2);
    expect(h.pos[1] + HELI.mastH - CAPSULE.apex).toBeGreaterThan(10);
  });
  test("it leaves towards the recovery ship", () => {
    const a = heliAt(T.depart + 3);
    const b = heliAt(T.end);
    const go = [b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]];
    const toShip = [SHIP.pos[0] - a.pos[0], SHIP.pos[2] - a.pos[2]];
    const cos = (go[0] * toShip[0] + go[1] * toShip[1]) / (Math.hypot(...go) * Math.hypot(...toShip));
    expect(cos).toBeGreaterThan(0.95);
  });
  test("scale: about 17 m long, an 18.9 m rotor: 4–5 capsule diameters", () => {
    expect(HELI.length / 3.9).toBeGreaterThan(4);
    expect((2 * HELI.rotorR) / 3.9).toBeGreaterThan(4.5);
  });
});

describe("the swimmers", () => {
  test("they jump from the door, fall about 1 s, then swim at a swimmer's pace to the capsule", () => {
    for (const i of [0, 1]) {
      expect(swimmerAt(i, T.jump[i] - 0.05).visible).toBe(false);
      let prev = null;
      for (const t of times()) {
        const s = swimmerAt(i, t);
        if (!s.visible) continue;
        if (prev && s.mode !== "fall" && prev.mode !== "fall") expect(dist2(s.pos, prev.pos) / STEP).toBeLessThan(3.2);
        prev = s;
      }
      const at = swimmerAt(i, T.atCapsule[i] + 0.1);
      expect(at.mode).toBe("work");
      // at the collar: just outside it
      const r = Math.hypot(at.pos[0], at.pos[2]);
      expect(r).toBeGreaterThan(COLLAR.ringR + COLLAR.tubeR);
      expect(r).toBeLessThan(COLLAR.ringR + COLLAR.tubeR + 1.2);
    }
  });
});

describe("the collar, the raft, the hatch", () => {
  test("the collar fits the hull at the waterline and is fitted before it inflates", () => {
    // the hull's radius at the waterline (data/csmDesign profile, the floating depth)
    const wl = FLOAT.waterlineY * M_PER_UNIT;
    const [a, b] = [CM_PROFILE[1], CM_PROFILE[2]];
    const hullR = a[0] + ((b[0] - a[0]) * (wl - a[1])) / (b[1] - a[1]);
    expect(Math.abs(hullR - CAPSULE.waterR)).toBeLessThan(0.1);
    expect(COLLAR.ringR - COLLAR.tubeR).toBeGreaterThanOrEqual(hullR - 0.02); // no intersection with the hull
    expect(collarAt(T.collarWrap[0] - 1).visible).toBe(false);
    expect(collarAt(T.collarFill[0]).wrap).toBeGreaterThan(0.9);
    expect(collarAt(T.collarFill[0]).fill).toBeLessThan(0.05);
    expect(collarAt(T.end).fill).toBe(1);
  });
  test("the raft lies beside the hatch, outside the collar", () => {
    const r = Math.hypot(...RAFT.centre);
    expect(r - RAFT.width / 2).toBeGreaterThan(COLLAR.ringR + COLLAR.tubeR);
    const cos = (RAFT.centre[0] * HATCH_DIR[0] + RAFT.centre[1] * HATCH_DIR[1]) / r;
    expect(cos).toBeGreaterThan(0.99);
    expect(raftAt(T.hatch[0]).fill).toBe(1);
  });
  test("the hatch opens only after the collar and the raft", () => {
    expect(hatchAt(T.collarFill[1])).toBe(0);
    expect(hatchAt(T.raftFill[1])).toBe(0);
    expect(hatchAt(T.egress[0][0])).toBe(1);
  });
});

describe("the crew: three out of the hatch, three lifted", () => {
  test("one at a time, in order, through the hatch to the raft", () => {
    for (const i of [0, 1, 2]) {
      expect(crewAt(i, T.hatch[1]).where).toBe("inside");
      expect(crewAt(i, T.egress[i][0] + 0.3).where).toBe("hatch");
      expect(crewAt(i, T.egress[i][1] + 0.05).where).toBe("raft");
    }
    // never two in the hatch at once
    for (const t of times()) expect([0, 1, 2].filter((i) => ["hatch", "out"].includes(crewAt(i, t).where)).length).toBeLessThanOrEqual(1);
  });
  test("the first is lifted in the basket; all three aboard before the helicopter leaves", () => {
    expect(crewAt(0, (T.lift[0] + T.lift[1]) / 2).where).toBe("lift");
    expect(crewAboard(T.depart)).toBe(3);
    expect(crewAboard(T.lift[0])).toBe(0);
  });
  test("the seats are in the raft", () => {
    for (const s of RAFT_SEATS) expect(Math.hypot(s[0] - RAFT.centre[0], s[1] - RAFT.centre[1])).toBeLessThan(RAFT.length / 2);
  });
});

describe("the hoist", () => {
  test("the hook is right over the basket point in the hoist hover; the cable reaches the water", () => {
    const t = (T.lower[1] + T.lift[0]) / 2;
    const ho = hoistAt(t);
    expect(dist2(ho.hook, [BASKET_POINT[0], 0, BASKET_POINT[1]])).toBeLessThan(0.05);
    expect(ho.basket[1]).toBeCloseTo(1.25, 1); // the bridle's apex: the basket's rim just out of the water
    expect(ho.visible && ho.inWater).toBe(true);
    // the hook is on the helicopter
    const h = heliAt(t);
    expect(dist3(ho.hook, heliToWorld(h.pos, h.yaw, HOIST_LOCAL))).toBeLessThan(1e-9);
  });
  test("lift speed is a hoist's (under 5 m/s, the helicopter's own drift included), the basket never jumps", () => {
    let prev = null;
    for (const t of times()) {
      const ho = hoistAt(t);
      if (!ho.visible) {
        prev = null;
        continue;
      }
      if (prev) expect(dist3(ho.basket, prev) / STEP).toBeLessThan(5);
      prev = ho.basket;
    }
  });
  test("the basket is occupied only while lifted", () => {
    expect(hoistAt(T.lower[1]).occupied).toBe(false);
    expect(hoistAt(T.lift[0] + 1).occupied).toBe(true);
  });
});

describe("the recovery ship and the camera", () => {
  test("the carrier is far out (4–8 km), never near the capsule", () => {
    const d = Math.hypot(SHIP.pos[0], SHIP.pos[2]);
    expect(d).toBeGreaterThan(4000);
    expect(d).toBeLessThan(8000);
    expect(SHIP.length).toBeGreaterThan(200);
  });
  test("the camera moves smoothly (no jumps), stays over the sea, keeps the horizon level (no roll)", () => {
    let prev = null;
    for (const t of times()) {
      const c = cameraAt(t);
      expect(c.pos[1]).toBeGreaterThan(0.9);
      expect(c.fov).toBeGreaterThan(30);
      expect(c.fov).toBeLessThan(60);
      if (prev) expect(dist3(c.pos, prev.pos) / STEP).toBeLessThan(25);
      prev = c;
    }
  });
  test("the helicopter is in frame through its approach (B), the hoist (E) and its departure (F)", () => {
    const inFrame = (t) => {
      const c = cameraAt(t);
      const h = heliAt(t).pos;
      const look = [c.look[0] - c.pos[0], c.look[1] - c.pos[1], c.look[2] - c.pos[2]];
      const to = [h[0] - c.pos[0], h[1] - c.pos[1], h[2] - c.pos[2]];
      const cos = (look[0] * to[0] + look[1] * to[1] + look[2] * to[2]) / (Math.hypot(...look) * Math.hypot(...to));
      return Math.acos(cos) < ((c.fov / 2) * Math.PI) / 180 * 1.5; // within the frame (landscape width)
    };
    for (let t = 9; t < 19; t += 0.5) expect([t, inFrame(t)]).toEqual([t, true]);
    for (let t = T.lower[0]; t < T.aboard[0]; t += 0.5) expect([t, inFrame(t)]).toEqual([t, true]);
    for (let t = T.depart; t < T.end; t += 0.5) expect([t, inFrame(t)]).toEqual([t, true]);
  });
  test("the capsule is in frame in every shot until the finale's wide pull-back", () => {
    for (const t of [3, 12, 25, 40, 55, 66, 72]) {
      const c = cameraAt(t);
      const look = [c.look[0] - c.pos[0], c.look[1] - c.pos[1], c.look[2] - c.pos[2]];
      const to = [-c.pos[0], 1 - c.pos[1], -c.pos[2]];
      const cos = (look[0] * to[0] + look[1] * to[1] + look[2] * to[2]) / (Math.hypot(...look) * Math.hypot(...to));
      expect([t, Math.acos(cos) < ((c.fov / 2) * Math.PI) / 180 * 1.6]).toEqual([t, true]);
    }
  });
});

describe("words: readable with the sound off; dramatized calls", () => {
  test("the equipment sounds fall on what is seen: water entry, collar, hatch, winch", () => {
    const at = (id) => RECOVERY_CUES.filter((c) => c.id === id);
    // each splash when that swimmer reaches the water (out of the fall)
    at("splash").forEach((c, i) => {
      expect(swimmerAt(i, c.t - 0.02).mode).toBe("fall");
      expect(swimmerAt(i, c.t + 0.02).mode).not.toBe("fall");
    });
    expect(at("inflate")[0].t).toBe(T.collarFill[0]);
    expect(hatchAt(at("hatch")[0].t)).toBe(0);
    expect(hatchAt(at("hatch")[0].t + 1)).toBeGreaterThan(0);
    const [down, up] = at("winch");
    expect(hoistAt(down.t + down.dur / 2).cable).toBeGreaterThan(hoistAt(down.t + 0.2).cable);
    expect(hoistAt(up.t + up.dur / 2).cable).toBeLessThan(hoistAt(up.t + 0.2).cable);
    RECOVERY_CUES.forEach((c) => expect(c.t + (c.dur || 0)).toBeLessThan(RECOVERY.duration));
  });
  test("a caption for each stage; the calls in time order within the cinematic", () => {
    for (const t of [3, 12, 24, 30, 35, 42, 52]) expect(captionAt(t)).not.toBeNull();
    for (let i = 1; i < RECOVERY_CALLS.length; i++) expect(RECOVERY_CALLS[i].t).toBeGreaterThan(RECOVERY_CALLS[i - 1].t);
    expect(RECOVERY_CALLS[RECOVERY_CALLS.length - 1].t).toBeLessThan(RECOVERY.duration);
  });
  test("the montage's dip to black is short and complete", () => {
    expect(dipAt(T.montage[0] - 0.1)).toBe(0);
    expect(dipAt((T.montage[0] + T.montage[1]) / 2)).toBeGreaterThan(0.95);
    expect(dipAt(T.montage[1] + 0.5)).toBe(0);
  });
  test("the places are what the scene was told (HELI_PLACES)", () => {
    expect(HELI_PLACES.HOIST_ALT).toBeGreaterThan(10);
  });
});
