import { EVA_MISSIONS, EVA_SITE_IDS, REACH, actionAt, currentTarget, evaMission, evaSummary, freshEva, nextObjective, objectiveIds, photoCheckFor, planEva, validateEvaRecord } from "./evaMissions";
import { AREA, SUIT, createWalker, evaWorld, slopeAt, stepWalker } from "./evaSim";
import { getSite, SITE_IDS } from "./landingSites";
import { buildTerrain } from "./terrainMesh";
import { EVA_SITES, OFFICIAL_MISSION_IDS, TRAINING_LANDING_SITES, evaAvailableAt } from "./missionConfig";

const worlds = new Map();
/** The EVA's world for a landing at x (m along the track), as the mission builds it. */
function worldAt(siteId, xm) {
  const key = `${siteId}@${xm}`;
  if (worlds.has(key)) return worlds.get(key);
  const site = getSite(siteId);
  const terrain = buildTerrain(site);
  const ground = (x, z) => terrain.lookup(x, z);
  const pose = { x: xm * 0.5, padY: site.scale.y(site.contactGround(xm)), tilt: 0, pitch: 0, comp: [0, 0, 0, 0], probe: [0, 0, 0, 0], site: siteId };
  const world = evaWorld({ site, pose, ground, area: evaMission(siteId).area });
  const out = { site, world, plan: planEva(world) };
  worlds.set(key, out);
  return out;
}
/** Every place along the track where a landing is safe (no boulder, slope or roughness hazard). */
const safeLandings = (siteId, step = 2) => {
  const site = getSite(siteId);
  const xs = [];
  for (let x = -110; x <= 110; x += step) if (!site.evaluate(x).hazard) xs.push(x);
  return xs;
};
const targetsOf = (plan) => [plan.survey, ...plan.samples, plan.photo, plan.instrument].filter(Boolean);
const clearOf = (world, x, z) => {
  let d = Infinity;
  for (const k of world.cols.circles) d = Math.min(d, Math.hypot(x - k.x, z - k.z) - k.r);
  return d;
};

describe("four expeditions, one engine", () => {
  test("every official destination has an EVA, each its own expedition; the Training Center has none", () => {
    expect(EVA_SITE_IDS.slice().sort()).toEqual(OFFICIAL_MISSION_IDS.slice().sort());
    expect(EVA_SITES.slice().sort()).toEqual(OFFICIAL_MISSION_IDS.slice().sort());
    OFFICIAL_MISSION_IDS.forEach((id) => expect(evaAvailableAt(id)).toBe(true));
    expect(evaMission("moon-base")).toBeNull();
    expect(TRAINING_LANDING_SITES).toEqual(["tranquillitatis"]); // training lands; it never walks
  });

  test("the objective sequences of the brief, the return last", () => {
    expect(objectiveIds(EVA_MISSIONS.tranquillitatis)).toEqual(["firstSteps", "sample", "photo", "return"]);
    expect(objectiveIds(EVA_MISSIONS.hadley)).toEqual(["firstSteps", "survey", "samples", "photo", "instrument", "return"]);
    expect(objectiveIds(EVA_MISSIONS.tycho)).toEqual(["firstSteps", "survey", "samples", "photo", "instrument", "return"]);
    expect(objectiveIds(EVA_MISSIONS["far-side"])).toEqual(["firstSteps", "sample", "instrument", "photo", "data", "return"]);
    expect(EVA_MISSIONS.hadley.samples.map((s) => s.id)).toEqual(["HA-01", "HA-02"]);
    expect(EVA_MISSIONS.tycho.samples.map((s) => s.id)).toEqual(["TY-01", "TY-02"]);
    expect(EVA_MISSIONS["far-side"].samples.map((s) => s.id)).toEqual(["FS-01"]);
    expect(EVA_MISSIONS.hadley.instrument.kind).toBe("seismometer");
    expect(EVA_MISSIONS.tycho.instrument.kind).toBe("gnomon");
    expect(EVA_MISSIONS["far-side"].instrument.kind).toBe("antenna");
  });

  test("every text in English and Portuguese; the far side never names Houston", () => {
    for (const id of EVA_SITE_IDS) {
      const cfg = EVA_MISSIONS[id];
      for (const lang of ["en", "pt"]) {
        const t = cfg.text[lang];
        expect(t.title && t.expedition && t.ascentSub && t.banner && t.briefing && t.subject).toBeTruthy();
        cfg.objectives.forEach((o) => expect(t.objectives[o.id]).toBeTruthy());
        cfg.samples.forEach((s) => expect(t.samples[s.id]).toBeTruthy());
        if (cfg.survey) ["boulder", "crater", "regolith"].forEach((k) => expect(t.survey[k][0] && t.survey[k][1]).toBeTruthy());
        if (cfg.instrument) expect(t.instrument[0] && t.instrument[1]).toBeTruthy();
      }
    }
    const fs = JSON.stringify(EVA_MISSIONS["far-side"].text);
    expect(fs).not.toMatch(/HOUSTON|CAPCOM/i);
    expect(EVA_MISSIONS["far-side"].comms.earthLink).toBe(false);
  });

  test("the Sea of Tranquility keeps phase 1's record, places and voice exactly", () => {
    expect(freshEva("tranquillitatis")).toEqual({ progress: { firstSteps: false, sample: false, photo: false }, samples: [], photos: [], completed: false, distance: 0 });
    const { world, plan } = worldAt("tranquillitatis", 0);
    expect(plan.samples).toHaveLength(1);
    expect([plan.samples[0].id, plan.samples[0].x, plan.samples[0].z]).toEqual(["TQ-01", world.sample.x, world.sample.z]);
    expect([plan.photo.x, plan.photo.z, plan.photo.subject.kind]).toEqual([world.photo.x, world.photo.z, "lm"]);
    expect(plan.area).toEqual(AREA);
    const v = EVA_MISSIONS.tranquillitatis.voice;
    expect([v.authorized, v.firstSteps, v.go.sample, v.done.sample, v.go.photo, v.done.photo, v.returnLM, v.complete]).toEqual(["eva.authorized", "eva.firstStepsCapcom", "eva.goSample", "eva.sampleDone", "eva.goPhoto", "eva.photoDone", "eva.returnLM", "eva.complete"]);
  });
});

describe("placement relative to the LM where it landed", () => {
  test.each(SITE_IDS)("%s: every safe landing gets a full plan on the site's own ground (no forced placement)", (id) => {
    const xs = safeLandings(id);
    expect(xs.length).toBeGreaterThan(20);
    let fallbacks = 0;
    for (const x of xs) {
      const { world, plan } = worldAt(id, x);
      expect(plan.siteId).toBe(id); // never another destination
      const [ax, az] = world.lm.axis;
      const area = plan.area;
      for (const t of targetsOf(plan)) {
        expect(t.forced).toBeFalsy();
        const r = Math.hypot(t.x - ax, t.z - az);
        expect(r).toBeGreaterThanOrEqual(id === "tranquillitatis" ? 6 : 6.5); // never under the LM
        expect(r).toBeLessThanOrEqual(area.warn - 2 + 1e-9); // inside the bounds, short of the warning
        expect(Math.abs(t.z)).toBeLessThanOrEqual(area.zMax - 3 + 1e-9);
        expect(clearOf(world, t.x, t.z)).toBeGreaterThan(SUIT.radius); // not inside a rock or the LM
        expect(Math.abs(t.y - world.ground(t.x, t.z))).toBeLessThan(1e-6); // on the ground, not under it
        if (id !== "tranquillitatis") {
          expect(t.route && t.route.length).toBeLessThanOrEqual(70);
          expect(slopeAt(world.ground, t.x, t.z)).toBeLessThanOrEqual(16);
        }
        if (t.fallback) fallbacks++;
      }
      // two samples at clearly different places
      if (plan.samples.length === 2) expect(Math.hypot(plan.samples[0].x - plan.samples[1].x, plan.samples[0].z - plan.samples[1].z)).toBeGreaterThanOrEqual(6);
      // the instrument on level ground
      if (plan.instrument) expect(slopeAt(world.ground, plan.instrument.x, plan.instrument.z)).toBeLessThanOrEqual(EVA_MISSIONS[id].instrument.slope || 8);
    }
    // the documented fallback (open ground round the LM) is the exception, not the rule
    expect(fallbacks).toBeLessThanOrEqual(Math.ceil(xs.length * 0.05));
  });

  test("deterministic: the same landing always gives the same plan (save and resume)", () => {
    for (const id of SITE_IDS) {
      const site = getSite(id);
      const terrain = buildTerrain(site);
      const ground = (x, z) => terrain.lookup(x, z);
      const pose = { x: 0, padY: site.scale.y(site.contactGround(0)), tilt: 0, pitch: 0 };
      const strip = (p) => JSON.stringify(targetsOf(p).map((t) => [t.name || t.id, +t.x.toFixed(6), +t.z.toFixed(6)]));
      const a = planEva(evaWorld({ site, pose, ground, area: evaMission(id).area }));
      const b = planEva(evaWorld({ site, pose, ground, area: evaMission(id).area }));
      expect(strip(a)).toBe(strip(b));
    }
  });

  test("the targets move with the LM: a landing elsewhere puts them round the new place", () => {
    const zones = getSite("hadley").zones.map((z) => z.x);
    const [p0, p1] = zones.map((x) => worldAt("hadley", x).plan);
    expect(p0.instrument.x).not.toBeCloseTo(p1.instrument.x, 1);
    zones.forEach((x) => targetsOf(worldAt("hadley", x).plan).forEach((t) => expect(Math.hypot(t.x - x, t.z)).toBeLessThan(31)));
  });

  test("at the primary landing zones every target is on its scientific anchor", () => {
    const ha = worldAt("hadley", 0).plan;
    expect(ha.fallbacks).toEqual([]);
    expect(ha.survey.formation).toBe("boulder"); // the rille-edge basalt boulders
    expect(ha.samples[0].formation).toBe("boulder");
    expect(ha.samples[1].formation).toBe("crater");
    expect(ha.photo.subject).toMatchObject({ kind: "landmark", id: "MONS-HADLEY" });
    const ty = worldAt("tycho", 0).plan;
    expect(ty.fallbacks).toEqual([]);
    expect(ty.survey.formation).toBe("boulder");
    expect(ty.survey.feature.label).toMatch(/CRATER/); // an ejecta block of a fresh crater
    expect(ty.samples[0].formation).toBe("melt");
    expect(ty.photo.subject.kind).toBe("crater");
    // the crater photographed from outside its rim, never from inside it
    expect(Math.hypot(ty.photo.x - ty.photo.subject.x, ty.photo.z - ty.photo.subject.z)).toBeGreaterThan(ty.photo.subject.r + 1.5);
    expect(Math.hypot(ty.instrument.x - ty.survey.look[0], ty.instrument.z - ty.survey.look[2])).toBeLessThan(4); // the gnomon by the block
    const fs = worldAt("far-side", 0).plan;
    expect(fs.fallbacks).toEqual([]);
    expect(clearOf(worldAt("far-side", 0).world, fs.instrument.x, fs.instrument.z)).toBeGreaterThanOrEqual(3.2); // the antenna's 5 m span is clear
    expect(fs.photo.subject).toMatchObject({ kind: "landmark", id: "BASIN-RING" });
  });

  test("the documented fallback: Tycho with no crater rim in reach photographs the central peak on the horizon", () => {
    const xs = safeLandings("tycho").filter((x) => worldAt("tycho", x).plan.photo.fallback);
    for (const x of xs) {
      const p = worldAt("tycho", x).plan;
      expect(p.photo.subject.kind).toBe("horizon");
      expect(p.fallbacks).toContain("photo");
    }
  });
});

/** Walk the planned route with the real walker (stick input, collisions, slopes): where it ends. */
function walkTo(world, plan, t, reach) {
  const lm = world.lm;
  const w = createWalker(world, lm.board[0], lm.board[2], Math.atan2(lm.board[0] - lm.axis[0], lm.board[2] - lm.axis[1]));
  const pts = [...(t.route ? t.route.points : [plan.start, [t.x, t.z]])];
  const dt = 1 / 30;
  let i = 0;
  for (let n = 0; n < 30 * 140 && i < pts.length; n++) {
    const p = pts[i];
    const last = i === pts.length - 1;
    const d = Math.hypot(p[0] - w.x, p[1] - w.z);
    if (d < (last ? reach - 0.25 : 0.6)) {
      i++;
      continue;
    }
    const b = Math.atan2(p[0] - w.x, p[1] - w.z);
    stepWalker(w, world, { x: 0, y: 1, camYaw: b }, dt);
  }
  return w;
}

describe("every objective is reachable on foot", () => {
  const LANDINGS = { tranquillitatis: [0, -36.5, 41, 84], hadley: [0, -26, 10, -12], tycho: [0, 54, -47, 6], "far-side": [0, 42, -52, -6] };
  test.each(SITE_IDS)("%s: the walker gets to every target from the ladder", (id) => {
    for (const x of LANDINGS[id]) {
      const { world, plan } = worldAt(id, x);
      for (const t of targetsOf(plan)) {
        const reach = t === plan.photo ? 1.5 : t === plan.survey ? REACH.survey : t === plan.instrument ? REACH.instrument : REACH.sample;
        const w = walkTo(world, plan, t, reach);
        expect(Math.hypot(w.x - t.x, w.z - t.z)).toBeLessThanOrEqual(reach);
      }
    }
  });
});

describe("interactions: only where the astronaut stands, never automatic", () => {
  const st = (p, extra = {}) => ({ progress: p, samples: [], instruments: [], photos: [], ...extra });
  test("Hadley: inspect at the survey point, collect each stone, deploy at the site; nothing before the first steps", () => {
    const { world, plan } = worldAt("hadley", 0);
    const p = { firstSteps: false, survey: false, samples: false, photo: false, instrument: false };
    const at = (x, z) => ({ x, z });
    expect(actionAt(plan, world, at(plan.survey.x, plan.survey.z), st(p))).toBeNull();
    p.firstSteps = true;
    expect(actionAt(plan, world, at(plan.survey.x + 0.5, plan.survey.z), st(p))).toEqual({ kind: "survey" });
    expect(actionAt(plan, world, at(plan.survey.x + 6, plan.survey.z + 6), st(p))).toBeNull();
    expect(actionAt(plan, world, at(plan.samples[1].x + 0.8, plan.samples[1].z), st(p))).toEqual({ kind: "sample", id: "HA-02" });
    expect(actionAt(plan, world, at(plan.samples[1].x + 0.8, plan.samples[1].z), st(p, { samples: [{ id: "HA-02" }] }))).toBeNull();
    expect(actionAt(plan, world, at(plan.instrument.x + 1, plan.instrument.z), st(p))).toEqual({ kind: "instrument" });
    expect(actionAt(plan, world, at(world.lm.board[0], world.lm.board[2]), st(p))).toEqual({ kind: "board" });
  });

  test("far side: the data can only be confirmed at the deployed instrument", () => {
    const { world, plan } = worldAt("far-side", 0);
    const p = { firstSteps: true, sample: false, instrument: false, photo: false, data: false };
    const at = { x: plan.instrument.x + 1.2, z: plan.instrument.z };
    expect(actionAt(plan, world, at, st(p))).toEqual({ kind: "instrument" });
    p.instrument = true;
    expect(actionAt(plan, world, at, st(p))).toEqual({ kind: "data" });
    p.data = true;
    expect(actionAt(plan, world, at, st(p))).toBeNull();
  });

  test("guidance follows the sequence; with two samples it points to the nearest one left", () => {
    const { plan } = worldAt("tycho", 0);
    const cfg = plan.cfg;
    const p = { firstSteps: true, survey: true, samples: false, photo: false, instrument: false };
    expect(nextObjective(cfg, p)).toBe("samples");
    const s0 = plan.samples[0];
    const s1 = plan.samples[1];
    expect(currentTarget(plan, st(p), { x: s0.x, z: s0.z })).toMatchObject({ kind: "sample", id: s0.id });
    expect(currentTarget(plan, st(p), { x: s1.x, z: s1.z })).toMatchObject({ kind: "sample", id: s1.id });
    expect(currentTarget(plan, st(p, { samples: [{ id: s1.id }] }), { x: s1.x, z: s1.z })).toMatchObject({ kind: "sample", id: s0.id });
    expect(currentTarget(plan, st({ ...p, samples: true, photo: true, instrument: true }))).toMatchObject({ objective: "return", kind: "board" });
  });
});

describe("the photograph of each destination's subject", () => {
  const VF = 50 * (Math.PI / 180);
  const viewAt = (plan, world, { yawOff = 0, pitch = 0, dx = 0 } = {}) => {
    const s = plan.photo.subject;
    const pos = [plan.photo.x + dx, world.ground(plan.photo.x + dx, plan.photo.z) + 1.35, plan.photo.z];
    const yaw = s.kind === "horizon" ? Math.atan2(Math.cos((s.az * Math.PI) / 180), -Math.sin((s.az * Math.PI) / 180)) : Math.atan2(s.x - pos[0], s.z - pos[2]);
    return { pos, yaw: yaw + yawOff, pitch, vfov: VF, aspect: 1 };
  };
  test("Hadley: Mons Hadley from the observation point, aimed and tilted up to include the summit", () => {
    const { world, plan } = worldAt("hadley", 0);
    expect(photoCheckFor(plan, world, viewAt(plan, world, { pitch: 0.18 })).verdict).toBe("ok");
    expect(photoCheckFor(plan, world, viewAt(plan, world, { pitch: 0.18, dx: 8 })).verdict).toBe("goToPoint");
    expect(photoCheckFor(plan, world, viewAt(plan, world, { pitch: 0.18, yawOff: Math.PI })).verdict).toBe("aimSubject");
    expect(photoCheckFor(plan, world, viewAt(plan, world, { pitch: 0.18, yawOff: 0.3 })).verdict).toBe("centreSubject");
  });
  test("Tycho: the crater from its rim, tilted down to see the floor", () => {
    const { world, plan } = worldAt("tycho", 54);
    expect(photoCheckFor(plan, world, viewAt(plan, world, { pitch: -0.2 })).verdict).toBe("ok");
    expect(photoCheckFor(plan, world, viewAt(plan, world, { pitch: -0.2, yawOff: 1.2 })).verdict).toBe("aimSubject");
  });
  test("far side: the basin ring massif", () => {
    const { world, plan } = worldAt("far-side", 0);
    expect(photoCheckFor(plan, world, viewAt(plan, world, { pitch: 0.05 })).verdict).toBe("ok");
    expect(photoCheckFor(plan, world, viewAt(plan, world, { pitch: 0.05, yawOff: -2 })).verdict).toBe("aimSubject");
  });
});

describe("the saved EVA record, per destination", () => {
  test("Tranquility: exactly phase 1's rules", () => {
    const rec = (o = {}) => ({ progress: { firstSteps: true, sample: false, photo: false }, samples: [], photos: [], completed: false, distance: 12.5, ...o });
    expect(validateEvaRecord("tranquillitatis", rec())).toEqual(rec());
    const done = rec({ progress: { firstSteps: true, sample: true, photo: true }, samples: [{ id: "TQ-01", x: 7.5, z: 8.5 }], photos: [{ subject: "LM", distance: 15.2 }], completed: true });
    expect(validateEvaRecord("tranquillitatis", done)).toEqual(done);
    expect(validateEvaRecord("tranquillitatis", rec({ progress: { firstSteps: true, sample: true, photo: false } }))).toBeNull();
    expect(validateEvaRecord("tranquillitatis", rec({ samples: [{ id: "TQ-01", x: 1, z: 2 }] }))).toBeNull();
    expect(validateEvaRecord("tranquillitatis", rec({ photos: [{ subject: "CSM", distance: 14 }], progress: { firstSteps: true, sample: false, photo: true } }))).toBeNull();
    expect(validateEvaRecord("tranquillitatis", rec({ instruments: [{ id: "PSE", x: 1, z: 1 }] }))).toBeNull();
  });

  test("Hadley: two samples make the objective; one is progress; another site's sample is refused", () => {
    const base = { progress: { firstSteps: true, survey: true, samples: false, photo: false, instrument: false }, samples: [{ id: "HA-01", x: 28, z: 9 }], photos: [], instruments: [], completed: false, distance: 40 };
    expect(validateEvaRecord("hadley", base)).toEqual(base);
    expect(validateEvaRecord("hadley", { ...base, progress: { ...base.progress, samples: true } })).toBeNull();
    const two = { ...base, progress: { ...base.progress, samples: true }, samples: [...base.samples, { id: "HA-02", x: -12, z: 0 }] };
    expect(validateEvaRecord("hadley", two)).toEqual(two);
    expect(validateEvaRecord("hadley", { ...base, samples: [{ id: "TY-01", x: 1, z: 1 }] })).toBeNull();
    expect(validateEvaRecord("hadley", { ...base, samples: [base.samples[0], base.samples[0]] })).toBeNull();
    expect(validateEvaRecord("tycho", base)).toBeNull(); // never read as another destination's
  });

  test("far side: the data need the instrument; the instrument is its own", () => {
    const base = { progress: { firstSteps: true, sample: false, instrument: true, photo: false, data: false }, samples: [], photos: [], instruments: [{ id: "LFRA", x: 3, z: -12 }], completed: false, distance: 30 };
    expect(validateEvaRecord("far-side", base)).toEqual(base);
    expect(validateEvaRecord("far-side", { ...base, progress: { ...base.progress, data: true } })).toEqual({ ...base, progress: { ...base.progress, data: true } });
    expect(validateEvaRecord("far-side", { ...base, progress: { ...base.progress, instrument: false, data: true }, instruments: [] })).toBeNull();
    expect(validateEvaRecord("far-side", { ...base, instruments: [{ id: "PSE", x: 3, z: -12 }] })).toBeNull();
    expect(validateEvaRecord("far-side", { ...base, progress: { ...base.progress, firstSteps: false } })).toBeNull();
  });

  test("the summary counts objectives, not points", () => {
    expect(evaSummary("hadley", freshEva("hadley"))).toEqual({ total: 5, done: 0, complete: false });
    const all = { progress: { firstSteps: true, sample: true, instrument: true, photo: true, data: true }, completed: true };
    expect(evaSummary("far-side", all)).toEqual({ total: 5, done: 5, complete: true });
  });
});

describe("never trapped: steep crater walls and rille sides are not walked down", () => {
  test("Tycho: walking into a fresh crater stops at its wall, and the way back out is open", () => {
    const { world, plan } = worldAt("tycho", 54);
    const c = plan.photo.subject; // the crater by the photo stand
    const w = createWalker(world, plan.photo.x, plan.photo.z, 0);
    const b = Math.atan2(c.x - w.x, c.z - w.z);
    for (let i = 0; i < 30 * 25; i++) stepWalker(w, world, { x: 0, y: 1, camYaw: b }, 1 / 30);
    const depth = world.ground(plan.photo.x, plan.photo.z) - w.y;
    expect(Math.hypot(w.x - c.x, w.z - c.z)).toBeGreaterThan(c.r * 0.45); // not at the bottom
    expect(depth).toBeLessThan(1.6);
    for (let i = 0; i < 30 * 40; i++) stepWalker(w, world, { x: 0, y: 1, camYaw: Math.atan2(plan.photo.x - w.x, plan.photo.z - w.z) }, 1 / 30);
    expect(Math.hypot(w.x - plan.photo.x, w.z - plan.photo.z)).toBeLessThan(1);
  });

  test("Tranquility's walk is unchanged: nowhere in its area is steep enough for the guard", () => {
    for (const x0 of [0, -36.5, 41, 84]) {
      const { world } = worldAt("tranquillitatis", x0);
      let worst = 0;
      for (let x = x0 - 24; x <= x0 + 24; x += 1) {
        for (let z = -24; z <= 24; z += 1) {
          if (Math.hypot(x - x0, z) > AREA.warn) continue;
          for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2;
            const fall = Math.atan2(world.ground(x, z) - world.ground(x + Math.sin(a) * 0.6, z + Math.cos(a) * 0.6), 0.6) / (Math.PI / 180);
            worst = Math.max(worst, fall);
          }
        }
      }
      expect(worst).toBeLessThan(SUIT.slopeStop);
    }
  });
});
