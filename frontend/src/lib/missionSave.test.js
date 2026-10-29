import fs from "fs";
import path from "path";
import {
  CP,
  CHECKPOINT_ORDER,
  DAMAGED_KEY,
  SAVE_KIND,
  SAVE_SCHEMA,
  SLOT_KEYS,
  canResume,
  checkpointText,
  checksum,
  cleanEva,
  createSaveStore,
  makeCheckpoint,
  makeClosing,
  openEnvelope,
  resumePlan,
  sanitizePose,
  sealEnvelope,
  validateSave,
  RESUME_AT,
  CABIN_RESUME_TEXT,
  resumeText,
  ACTIVITIES,
} from "./missionSave";
import { createFlightScoring, restoreFlightScoring } from "../data/flightScoring";
import { DIFFICULTY } from "../data/landingPhysics";
import { getSite, SITE_IDS } from "../data/landingSites";
import { simulate } from "../data/landerSim";
import { humanPilot, precisionStrategy } from "../data/landerPilots";
import { DOCKING, flyDocking } from "../data/dockingSim";
import { guidedPilot } from "../data/dockingGuidance";
import { createEntryState, advance, recommendBank, rollToward, OUTCOME } from "../data/reentryPhysics";
import { TARGET_FPA, timeScaleFor } from "../data/reentryGuidance";
import { OFFICIAL_MISSION_IDS, PILOT_DIFFICULTIES } from "../data/missionConfig";
import { scoreDocking, scoreLanding } from "../data/missionScoring";
import { applyDocking, applyEva, applyFlightStart, applyLanding, applyMission, applyReentry, emptyRecords, loadRecords, saveRecords, updateRecords } from "./missionRecords";
import { loadMissionLog, logMissionResumed, logMissionStart } from "./missionSelection";

/* ---- backends: a Map standing in for localStorage, and an iPhone app's files (async) --------------- */
const memLocal = (map = new Map()) => ({
  map,
  get: (k) => (map.has(k) ? map.get(k) : null),
  set: (k, v) => map.set(k, v),
  remove: (k) => map.delete(k),
});
const memNative = (files = { a: null, b: null }, { failWrites = false, hang = false } = {}) => ({
  files,
  read: () => (hang ? new Promise(() => {}) : Promise.resolve({ a: files.a || undefined, b: files.b || undefined })),
  write: (slot, text) => (failWrites ? Promise.reject(new Error("disk full")) : Promise.resolve().then(() => (files[slot] = text))),
});

/* ---- deterministic flights ---------------------------------------------------------------------- */
const landed = (difficulty) => ({ crashed: false, failureReasons: [], zone: "PRIMARY LZ", fuelLeft: DIFFICULTY[difficulty].initialFuel * 0.4, initialFuel: DIFFICULTY[difficulty].initialFuel, time: 60, fuelPct: 40, breakdown: { vy: { value: 0.9 }, vx: { value: 0.3 }, tilt: { value: 2 }, accuracy: { distance: 3 } } });
const docked = (difficulty, o = {}) => {
  const t = DOCKING[difficulty].tol;
  return { success: true, attempts: 1, restarts: 0, attemptContacts: 0, propLeft: DOCKING[difficulty].prop * 0.7, capture: { closing: t.vMin, lateral: 0.02, angle: 0.01, roll: 0.01, vLat: 0.005, rate: 0.001 }, ...o };
};
const splash = { outcome: OUTCOME.SPLASHDOWN, eiFpa: TARGET_FPA, peakG: 8.4, peakHeatRate: 180, heatLoad: 15000, overheat: 0, shieldPct: 50, bankAgreement: 1, splashV: 8.6, attempts: 1, losses: [] };
const poseFor = (siteId, x = 3.5) => {
  const site = getSite(siteId);
  return { x, padY: site.contactGround ? site.scale.y(site.contactGround(0)) : 0, groundY: 0, tilt: 1.2, pitch: -0.4, comp: [0.1, 0.12, 0.09, 0.1], probe: [0, 0, 0, 0], xPos: 7, site: siteId };
};
let nextId = 0;
const newFlight = (siteId = "hadley", difficulty = "ASTRONAUT") => {
  const sc = createFlightScoring({ id: `mg${(1000 + nextId++).toString(36)}x-ab12`, siteId, difficulty });
  return sc;
};
const at = (cp, sc, extra = {}) => makeCheckpoint({ checkpoint: cp, flight: sc.flight, now: 1_800_000_000_000 + nextId, build: "test", ...extra });

/** A flight carried to checkpoint `cp` as the mission page carries it. */
function flightTo(cp, siteId = "hadley", difficulty = "ASTRONAUT") {
  const sc = newFlight(siteId, difficulty);
  const r = cpIndex(cp);
  if (r >= 1) {
    sc.beginDescent();
    sc.flight.flown = true;
    sc.landed(landed(difficulty));
  }
  if (r >= cpIndex(CP.DOCKING_COMPLETE)) sc.docking(docked(difficulty));
  return sc;
}
const cpIndex = (cp) => CHECKPOINT_ORDER.indexOf(cp);
const docOf = (cp, sc, extra = {}) =>
  at(cp, sc, {
    pose: cpIndex(cp) >= cpIndex(CP.LANDING_COMPLETE) ? poseFor(sc.flight.siteId) : null,
    docking: cpIndex(cp) >= cpIndex(CP.DOCKING_READY) ? { attempts: 1, restarts: 0, contacts: 0 } : null,
    ...extra,
  });

beforeEach(() => window.localStorage.clear());

describe("the save format: envelope, checksum, schema", () => {
  test("a checkpoint survives sealing and opening unchanged (FNV-1a checksum over sequence and body)", () => {
    const sc = flightTo(CP.LANDING_COMPLETE);
    const doc = docOf(CP.LANDING_COMPLETE, sc, { activity: { phase: "result" } });
    const v = validateSave(doc);
    expect(v.ok).toBe(true);
    const text = sealEnvelope(v.save, 7);
    const o = openEnvelope(text);
    expect(o.ok).toBe(true);
    expect(o.seq).toBe(7);
    expect(o.save).toEqual(v.save);
    expect(o.save.landing.pose).toEqual(sanitizePose(poseFor("hadley"), "hadley"));
    expect(checksum("abc")).toBe(checksum("abc"));
    expect(checksum("abc")).not.toBe(checksum("abd"));
  });

  test("every kind of damage is told apart and none of them throws", () => {
    const sc = flightTo(CP.DESCENT_READY);
    const good = sealEnvelope(validateSave(docOf(CP.DESCENT_READY, sc)).save, 3);
    expect(openEnvelope(null).reason).toBe("empty");
    expect(openEnvelope("").reason).toBe("empty");
    expect(openEnvelope("{not json").reason).toBe("corrupt");
    expect(openEnvelope(good.slice(0, good.length - 20)).reason).toBe("corrupt"); // a write cut short
    const flipped = good.replace('\\"siteId\\":\\"hadley\\"', '\\"siteId\\":\\"tycho!\\"');
    expect(flipped).not.toBe(good);
    expect(openEnvelope(flipped).reason).toBe("corrupt"); // checksum
    const env = JSON.parse(good);
    const reseal = (body) => sealEnvelope(body, 4);
    const body = JSON.parse(env.body);
    expect(openEnvelope(reseal({ ...body, schema: SAVE_SCHEMA + 1 })).reason).toBe("unsupported");
    expect(openEnvelope(reseal({ ...body, schema: 0 })).reason).toBe("outdated");
    expect(openEnvelope(reseal({ ...body, kind: "something.else" })).reason).toBe("invalid");
    expect(openEnvelope(reseal({ ...body, checkpoint: "EVA_READY" })).reason).toBe("invalid"); // unsupported checkpoint
    expect(openEnvelope(reseal({ ...body, mission: { siteId: "mars", difficulty: "ASTRONAUT" } })).reason).toBe("invalid");
    expect(openEnvelope(reseal({ ...body, mission: { siteId: "hadley", difficulty: "PILOT" } })).reason).toBe("invalid");
    expect(openEnvelope(reseal({ ...body, attemptId: "../../etc" })).reason).toBe("invalid");
    expect(openEnvelope(JSON.stringify([1, 2, 3])).reason).toBe("corrupt");
    expect(openEnvelope(12).reason).toBe("corrupt");
  });

  test("a checkpoint is only accepted when the flight really reached it", () => {
    const a = flightTo(CP.DESCENT_READY);
    // LANDING_COMPLETE without a safe landing, DOCKING_COMPLETE without a hard dock: refused
    expect(validateSave(docOf(CP.LANDING_COMPLETE, a)).reason).toBe("no-safe-landing");
    const crashed = flightTo(CP.DESCENT_READY);
    crashed.beginDescent();
    crashed.landed({ ...landed("ASTRONAUT"), crashed: true, failureReasons: ["vy"] });
    expect(validateSave(docOf(CP.LANDING_COMPLETE, crashed)).reason).toBe("no-safe-landing");
    const b = flightTo(CP.LANDING_COMPLETE);
    expect(validateSave(docOf(CP.DOCKING_COMPLETE, b)).reason).toBe("no-hard-dock");
    expect(validateSave(docOf(CP.REENTRY_READY, b)).reason).toBe("no-hard-dock");
    // a docked flight cannot claim to be before its docking, a splashed one cannot be active
    const d = flightTo(CP.DOCKING_COMPLETE);
    expect(validateSave(docOf(CP.DOCKING_READY, d)).reason).toBe("docked-before-docking");
    d.splashdown(splash);
    expect(validateSave(docOf(CP.REENTRY_READY, d)).reason).toBe("splashed-but-active");
    // MISSION_COMPLETE is never an active checkpoint (it closes the save)
    expect(validateSave(docOf(CP.MISSION_COMPLETE, flightTo(CP.DOCKING_COMPLETE))).reason).toBe("complete-but-active");
    // the scoring state must be this flight's, at this destination and difficulty
    const other = flightTo(CP.LANDING_COMPLETE, "tycho", "COMMANDER");
    const doc = docOf(CP.LANDING_COMPLETE, b);
    expect(validateSave({ ...doc, flight: other.flight }).reason).toBe("flight");
    expect(validateSave({ ...doc, docking: { attempts: 0, restarts: 0, contacts: 0 } }).reason).toBe("docking");
    expect(validateSave({ ...doc, activity: { phase: "spacewalk" } }).reason).toBe("activity");
  });

  test("a lunar module pose that is not a sane position on that terrain is dropped (the site's own landing point is used)", () => {
    expect(sanitizePose(poseFor("tycho"), "tycho")).not.toBeNull();
    expect(sanitizePose(poseFor("tycho"), "hadley")).toBeNull(); // another destination's terrain
    expect(sanitizePose({ ...poseFor("tycho"), x: NaN }, "tycho")).toBeNull();
    expect(sanitizePose({ ...poseFor("tycho"), tilt: 80 }, "tycho")).toBeNull();
    expect(sanitizePose({ ...poseFor("tycho"), comp: [1, 2] }, "tycho")).toBeNull();
    expect(sanitizePose({ ...poseFor("tycho"), padY: 1e9 }, "tycho")).toBeNull();
    expect(sanitizePose(null, "tycho")).toBeNull();
    const sc = flightTo(CP.LANDING_COMPLETE, "tycho");
    const v = validateSave(docOf(CP.LANDING_COMPLETE, sc, { pose: { ...poseFor("tycho"), x: Infinity } }));
    expect(v.ok).toBe(true);
    expect(v.save.landing.pose).toBeNull();
  });
});

describe("the two-slot store (A/B alternating, newest valid wins)", () => {
  test("A missing save is no save; nothing is invented", () => {
    const store = createSaveStore({ local: memLocal() });
    expect(store.load()).toMatchObject({ status: "none", save: null });
    expect(canResume(store.state())).toBe(false);
  });

  test("checkpoints alternate between the slots and the latest is restored after a reopen", () => {
    const local = memLocal();
    const store = createSaveStore({ local });
    store.load();
    const sc = flightTo(CP.DESCENT_READY);
    expect(store.write(docOf(CP.DESCENT_READY, sc)).ok).toBe(true);
    const sA = local.get(SLOT_KEYS.a);
    expect(sA).not.toBeNull();
    sc.beginDescent();
    sc.flight.flown = true;
    sc.landed(landed("ASTRONAUT"));
    store.write(docOf(CP.LANDING_COMPLETE, sc));
    expect(local.get(SLOT_KEYS.a)).toBe(sA); // the previous checkpoint is untouched
    expect(local.get(SLOT_KEYS.b)).not.toBeNull();
    store.write(docOf(CP.DOCKING_READY, sc, { activity: { phase: "docking" } }));
    expect(local.get(SLOT_KEYS.a)).not.toBe(sA);
    // close and reopen: a new store over the same storage
    const again = createSaveStore({ local }).load();
    expect(again.status).toBe("active");
    expect(again.save.checkpoint).toBe(CP.DOCKING_READY);
    expect(again.save.attemptId).toBe(sc.flight.id);
    expect(again.fallback).toBe(false);
  });

  test("an interrupted write (the newest slot torn) restores the previous checkpoint, flagged as a fallback", () => {
    const local = memLocal();
    const store = createSaveStore({ local });
    store.load();
    const sc = flightTo(CP.LANDING_COMPLETE);
    store.write(docOf(CP.LANDING_COMPLETE, sc));
    store.write(docOf(CP.DOCKING_READY, sc));
    const newest = local.get(SLOT_KEYS.b);
    local.set(SLOT_KEYS.b, newest.slice(0, Math.floor(newest.length / 2)));
    const s = createSaveStore({ local }).load();
    expect(s.status).toBe("active");
    expect(s.save.checkpoint).toBe(CP.LANDING_COMPLETE);
    expect(s.problems).toContain("corrupt");
    expect(s.fallback).toBe(true); // the torn slot was the newer write
    // a checksum-valid newer copy with bad contents is a fallback too
    local.set(SLOT_KEYS.b, sealEnvelope({ ...validateSave(docOf(CP.DOCKING_READY, sc)).save, mission: { siteId: "mars", difficulty: "ASTRONAUT" } }, 99));
    const s2 = createSaveStore({ local }).load();
    expect(s2.save.checkpoint).toBe(CP.LANDING_COMPLETE);
    expect(s2.fallback).toBe(true);
  });

  test("a copy naming a pre-launch place (the suit room, the walk: never a checkpoint) is set aside, the real save kept", () => {
    // nothing in COUNTDOWN TO LAUNCH writes the save; a copy that names one of its places can only be
    // foreign or tampered, and must neither crash the load nor replace the mission it sits beside
    const local = memLocal();
    const store = createSaveStore({ local });
    store.load();
    const sc = flightTo(CP.LANDING_COMPLETE);
    store.write(docOf(CP.LANDING_COMPLETE, sc));
    const good = local.get(SLOT_KEYS.a);
    for (const stale of ["suit", "tower", "walkway", "PRELAUNCH", "SUIT_ROOM", "WHITE_ROOM_BOARDING"]) {
      local.set(SLOT_KEYS.b, sealEnvelope({ ...validateSave(docOf(CP.LANDING_COMPLETE, sc)).save, checkpoint: stale }, 99));
      expect(openEnvelope(local.get(SLOT_KEYS.b)).reason).toBe("invalid");
      let s;
      expect(() => (s = createSaveStore({ local }).load())).not.toThrow();
      expect(s.status).toBe("active");
      expect(s.save.checkpoint).toBe(CP.LANDING_COMPLETE);
      expect(canResume(s)).toBe(true);
      expect(local.get(SLOT_KEYS.a)).toBe(good); // the mission's own copy is untouched
    }
  });
  test("a damaged copy of the older slot is no fallback; the newest slot lost everywhere is", async () => {
    const local = memLocal();
    const native = memNative();
    const st = createSaveStore({ local, native });
    await st.refresh();
    const sc = flightTo(CP.LANDING_COMPLETE);
    st.write(docOf(CP.LANDING_COMPLETE, sc)); // slot a
    st.write(docOf(CP.DOCKING_READY, sc)); // slot b
    await st.flush();
    native.files.a = "garbage"; // the older slot's app copy damaged, its web copy fine
    const s = await createSaveStore({ local, native }).refresh();
    expect(s.save.checkpoint).toBe(CP.DOCKING_READY);
    expect(s.fallback).toBe(false);
    local.set(SLOT_KEYS.b, "torn");
    native.files.b = "torn";
    const s2 = await createSaveStore({ local, native }).refresh();
    expect(s2.save.checkpoint).toBe(CP.LANDING_COMPLETE);
    expect(s2.fallback).toBe(true);
  });

  test("nothing invalid is ever written: a bad document leaves the stored save exactly as it was", () => {
    const local = memLocal();
    const store = createSaveStore({ local });
    store.load();
    const sc = flightTo(CP.LANDING_COMPLETE);
    store.write(docOf(CP.LANDING_COMPLETE, sc));
    const before = new Map(local.map);
    expect(store.write({ ...docOf(CP.DOCKING_COMPLETE, sc) }).ok).toBe(false); // no hard dock yet
    expect(store.write(null).ok).toBe(false);
    expect(store.write({ hello: "world" }).ok).toBe(false);
    expect(local.map).toEqual(before);
    expect(createSaveStore({ local }).load().save.checkpoint).toBe(CP.LANDING_COMPLETE);
  });

  test("a closed mission cannot come back: the closing record goes to both slots", () => {
    const local = memLocal();
    const store = createSaveStore({ local });
    store.load();
    const sc = flightTo(CP.DOCKING_COMPLETE);
    store.write(docOf(CP.DOCKING_COMPLETE, sc));
    store.write(docOf(CP.REENTRY_READY, sc));
    store.write(makeClosing({ attemptId: sc.flight.id, status: "completed", mission: { siteId: "hadley", difficulty: "ASTRONAUT" }, now: 1_900_000_000_000 }));
    const s = createSaveStore({ local }).load();
    expect(s.status).toBe("closed");
    expect(canResume(s)).toBe(false);
    // even with one slot destroyed, the other closing record still stands
    local.set(SLOT_KEYS.a, "garbage");
    expect(canResume(createSaveStore({ local }).load())).toBe(false);
    local.remove(SLOT_KEYS.a);
    expect(canResume(createSaveStore({ local }).load())).toBe(false);
  });

  test("when no copy can be used, the save is reported damaged (or from a newer version) and kept aside, never thrown", () => {
    const local = memLocal();
    local.set(SLOT_KEYS.a, "{\"f\":\"lunavia-save\",\"v\":1,\"seq\":3,\"len\":5,\"sum\":\"0\",\"body\":\"hello\"}");
    local.set(SLOT_KEYS.b, "\u0000\u0001");
    const s = createSaveStore({ local }).load();
    expect(s.status).toBe("damaged");
    expect(canResume(s)).toBe(false);
    expect(local.get(DAMAGED_KEY)).not.toBeNull();
    const kept = local.get(DAMAGED_KEY);
    createSaveStore({ local }).load();
    expect(local.get(DAMAGED_KEY)).toBe(kept); // the first damaged copy is never overwritten
    // a save written by a newer version of the game: reported as such, kept
    const sc = flightTo(CP.DESCENT_READY);
    const future = sealEnvelope({ ...validateSave(docOf(CP.DESCENT_READY, sc)).save, schema: SAVE_SCHEMA + 1 }, 5);
    const l2 = memLocal();
    l2.set(SLOT_KEYS.a, future);
    expect(createSaveStore({ local: l2 }).load().status).toBe("unsupported");
    expect(l2.get(SLOT_KEYS.a)).toBe(future);
    // a storage that throws on every access
    const broken = { get: () => { throw new Error("denied"); }, set: () => { throw new Error("denied"); }, remove: () => {} };
    const bs = createSaveStore({ local: broken });
    expect(bs.load().status).toBe("none");
    expect(bs.write(docOf(CP.DESCENT_READY, sc)).ok).toBe(true); // kept in memory for this session
  });

  test("a new mission after a damaged save writes a clean checkpoint that wins", () => {
    const local = memLocal();
    local.set(SLOT_KEYS.a, "{broken");
    local.set(SLOT_KEYS.b, "{broken");
    const store = createSaveStore({ local });
    expect(store.load().status).toBe("damaged");
    const sc = flightTo(CP.DESCENT_READY, "far-side", "COMMANDER");
    expect(store.write(docOf(CP.DESCENT_READY, sc)).ok).toBe(true);
    const s = createSaveStore({ local }).load();
    expect(s.status).toBe("active");
    expect(s.save.mission).toEqual({ siteId: "far-side", difficulty: "COMMANDER" });
  });
});

describe("the iPhone app's own copy (native files) and the web view's copy", () => {
  test("each write reaches both; the app's files alone are enough to resume (web storage cleared)", async () => {
    const local = memLocal();
    const native = memNative();
    const store = createSaveStore({ local, native });
    await store.refresh();
    const sc = flightTo(CP.DOCKING_COMPLETE, "tycho", "CADET");
    store.write(docOf(CP.DOCKING_COMPLETE, sc, { activity: { phase: "transfer" } }));
    await store.flush();
    expect(native.files.a).toBe(local.get(SLOT_KEYS.a));
    // iOS purges the web view's data; the app's files remain
    const s = await createSaveStore({ local: memLocal(), native }).refresh();
    expect(s.status).toBe("active");
    expect(s.save.checkpoint).toBe(CP.DOCKING_COMPLETE);
    expect(s.save.mission).toEqual({ siteId: "tycho", difficulty: "CADET" });
  });

  test("the newest valid copy wins across both stores; a failing or hanging native side never blocks the game", async () => {
    const local = memLocal();
    const native = memNative();
    const store = createSaveStore({ local, native });
    await store.refresh();
    const sc = flightTo(CP.LANDING_COMPLETE);
    store.write(docOf(CP.LANDING_COMPLETE, sc));
    await store.flush();
    // the web copy is older than the app's files (e.g. restored from an old state)
    const old = new Map(local.map);
    store.write(docOf(CP.DOCKING_READY, sc));
    await store.flush();
    const s = await createSaveStore({ local: memLocal(old), native }).refresh();
    expect(s.save.checkpoint).toBe(CP.DOCKING_READY);
    // native writes failing: the web copy carries on
    const failing = createSaveStore({ local: memLocal(), native: memNative({ a: null, b: null }, { failWrites: true }) });
    await failing.refresh();
    expect(failing.write(docOf(CP.LANDING_COMPLETE, sc)).ok).toBe(true);
    await failing.flush();
    expect(failing.state().status).toBe("active");
    // the native read hanging: the local copy is used once the timeout passes
    const hanging = createSaveStore({ local, native: memNative({}, { hang: true }) });
    const h = await hanging.refresh(50);
    expect(h.status).toBe("active");
    expect(h.ready).toBe(true);
  });

  test("the Swift store writes each slot atomically and is registered before the web view loads", () => {
    const ios = path.resolve(__dirname, "../../ios/App");
    const swift = fs.readFileSync(path.join(ios, "App/MissionSaveStore.swift"), "utf8");
    expect(swift).toMatch(/jsName = "LunaviaSave"/);
    expect(swift).toMatch(/CAPPluginMethod\(name: "readSlots"/);
    expect(swift).toMatch(/CAPPluginMethod\(name: "writeSlot"/);
    expect(swift).toMatch(/data\.write\(to: url, options: \.atomic\)/);
    expect(swift).toMatch(/applicationSupportDirectory/);
    const scene = fs.readFileSync(path.join(ios, "App/SceneDelegate.swift"), "utf8");
    expect(scene).toMatch(/override func capacitorDidLoad\(\) \{\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*bridge\?\.registerPluginInstance\(LunaviaSavePlugin\(\)\)/);
    const pbx = fs.readFileSync(path.join(ios, "App.xcodeproj/project.pbxproj"), "utf8");
    // in the App target: the file, its build file, the App group and the Sources phase
    expect(pbx.match(/isa = PBXFileReference; lastKnownFileType = sourcecode\.swift; path = MissionSaveStore\.swift;/g)).toHaveLength(1);
    expect(pbx.match(/MissionSaveStore\.swift in Sources \*\/ = \{isa = PBXBuildFile/g)).toHaveLength(1);
    expect(pbx.match(/\t\t\t\t[0-9A-F]{24} \/\* MissionSaveStore\.swift \*\/,\n/g)).toHaveLength(1);
    expect(pbx.match(/\t\t\t\t[0-9A-F]{24} \/\* MissionSaveStore\.swift in Sources \*\/,\n/g)).toHaveLength(1);
    // nothing in the Swift package depends on node_modules (the release ZIP opens directly in Xcode)
    const spm = fs.readFileSync(path.join(ios, "CapApp-SPM/Package.swift"), "utf8");
    expect(spm).not.toMatch(/node_modules/);
  });
});

describe("resuming a checkpoint", () => {
  const plan = (cp, activity, docking) => {
    const sc = flightTo(cp);
    const v = validateSave(docOf(cp, sc, { activity, docking }));
    expect(v.ok).toBe(true);
    return resumePlan(v.save);
  };

  test("each checkpoint opens its own phase; completed phases are never flown again", () => {
    expect(plan(CP.DESCENT_READY, { phase: "briefing" }).state).toBe("briefing");
    expect(plan(CP.LANDING_COMPLETE, { phase: "result" }).state).toBe("ascent");
    expect(plan(CP.DOCKING_READY, { phase: "docking" }, { attempts: 1, restarts: 0, contacts: 0 }).state).toBe("docking");
    expect(plan(CP.DOCKING_COMPLETE, { phase: "transfer" }).state).toBe("return");
    expect(plan(CP.REENTRY_READY, { phase: "reentry" }).state).toBe("reentry");
    Object.keys(RESUME_AT).forEach((cp) => ["en", "pt"].forEach((l) => expect(RESUME_AT[cp].text[l].length).toBeGreaterThan(5)));
    CHECKPOINT_ORDER.forEach((cp) => ["en", "pt"].forEach((l) => expect(checkpointText(cp, l).length).toBeGreaterThan(5)));
    expect(checkpointText(CP.DOCKING_COMPLETE, "pt")).toBe("ACOPLAMENTO CONCLUÍDO");
  });

  test("the LM CABIN (schema 5): a save made inside the cabin reopens it, at the landing or after the EVA", () => {
    const p1 = plan(CP.LANDING_COMPLETE, { phase: "cabin" });
    expect(p1.state).toBe("cabin");
    expect(p1.interrupted).toBe(false); // nothing was under way: the cabin is a safe place
    const sc = flightTo(CP.EVA_COMPLETE, "tranquillitatis", "ASTRONAUT");
    const eva = { mission: "tranquillitatis", progress: { firstSteps: true, sample: true, photo: true }, samples: [{ id: "TQ-01", x: 7.5, z: 8.5 }], photos: [{ subject: "LM", distance: 15.2 }], completed: true };
    const v = validateSave(docOf(CP.EVA_COMPLETE, sc, { activity: { phase: "cabin" }, eva }));
    if (v.ok) expect(resumePlan(v.save).state).toBe("cabin");
    // anywhere else "cabin" means nothing special: the checkpoint's own phase
    expect(plan(CP.DESCENT_READY, { phase: "cabin" }).state).toBe("briefing");
    expect(resumeText({ ...validateSave(docOf(CP.LANDING_COMPLETE, flightTo(CP.LANDING_COMPLETE), { activity: { phase: "cabin" } })).save }, "pt")).toBe(CABIN_RESUME_TEXT.pt);
    expect(resumeText({ ...validateSave(docOf(CP.LANDING_COMPLETE, flightTo(CP.LANDING_COMPLETE), { activity: { phase: "result" } })).save }, "en")).toBe(RESUME_AT.LANDING_COMPLETE.text.en);
    expect(ACTIVITIES).toContain("cabin");
  });

  test("a maneuver cut short is flown again and flagged; films are not", () => {
    expect(plan(CP.DESCENT_READY, { phase: "descent" }).interrupted).toBe(true);
    expect(plan(CP.DESCENT_READY, { phase: "briefing" }).interrupted).toBe(false);
    expect(plan(CP.LANDING_COMPLETE, { phase: "ascent" }).interrupted).toBe(true);
    expect(plan(CP.LANDING_COMPLETE, { phase: "rendezvous" }).interrupted).toBe(true);
    expect(plan(CP.DOCKING_COMPLETE, { phase: "return" }).interrupted).toBe(false);
    expect(plan(CP.REENTRY_READY, { phase: "reentry" }).interrupted).toBe(true);
  });

  test("an interrupted docking attempt counts as a restart: closing the app never yields a first-attempt docking", () => {
    const touched = plan(CP.DOCKING_READY, { phase: "docking", engaged: true }, { attempts: 1, restarts: 0, contacts: 2 });
    expect(touched.interrupted).toBe(true);
    expect(touched.restartReport).toEqual({ success: false, failure: "restart", attempts: 1, restarts: 1, contacts: 2 });
    expect(touched.docking).toEqual({ attempts: 2, restarts: 1, contacts: 2 });
    // untouched (only the handover title or the views): the same attempt carries on
    const fresh = plan(CP.DOCKING_READY, { phase: "docking", engaged: false }, { attempts: 1, restarts: 0, contacts: 0 });
    expect(fresh.docking).toEqual({ attempts: 1, restarts: 0, contacts: 0 });
    expect(fresh.restartReport).toBeNull();
    // closed on the failure panel: the retry, exactly as RETRY would count it
    const failed = plan(CP.DOCKING_READY, { phase: "dockFailed" }, { attempts: 2, restarts: 1, contacts: 3 });
    expect(failed.docking).toEqual({ attempts: 3, restarts: 2, contacts: 3 });
    expect(failed.restartReport).toBeNull();
    // the docking scored after such a resume is not a first attempt
    const sc = flightTo(CP.LANDING_COMPLETE);
    sc.docking(touched.restartReport);
    const D = sc.docking(docked("ASTRONAUT", { attempts: touched.docking.attempts, restarts: touched.docking.restarts }));
    expect(D.success).toBe(true);
    expect(D.firstAttempt).toBe(false);
  });

  test("closed and invalid saves have no resume plan", () => {
    expect(resumePlan(null)).toBeNull();
    expect(resumePlan(validateSave(makeClosing({ attemptId: "mgabcd1-x1", status: "completed", now: 5 })).save)).toBeNull();
  });
});

describe("scoring, records and the history across a close and reopen", () => {
  test("the restored scoring re-scores identically; nothing is added, reset or duplicated", () => {
    const sc = flightTo(CP.DOCKING_COMPLETE, "tycho", "COMMANDER");
    const L0 = scoreLanding(sc.flight.landing);
    const D0 = scoreDocking(sc.flight.docking);
    const v = validateSave(docOf(CP.DOCKING_COMPLETE, sc));
    const back = restoreFlightScoring(v.save.flight);
    expect(scoreLanding(back.flight.landing)).toEqual(L0);
    expect(scoreDocking(back.flight.docking)).toEqual(D0);
    expect(back.flight.id).toBe(sc.flight.id);
    expect(back.flight.flown).toBe(true);
    // the uninterrupted flight and the resumed one end with the same mission score
    sc.splashdown(splash);
    back.splashdown(splash);
    expect(back.mission()).toEqual(sc.mission());
  });

  test("records count each flight once however often it is resumed (attempt, docking, mission)", () => {
    const sc = flightTo(CP.DOCKING_COMPLETE, "hadley", "ASTRONAUT");
    const L = scoreLanding(sc.flight.landing);
    const D = scoreDocking(sc.flight.docking);
    let rec = emptyRecords();
    for (let i = 0; i < 3; i++) {
      // the same flight's events delivered again (a resume, a duplicate completion)
      applyFlightStart(rec, sc.flight);
      applyLanding(rec, sc.flight, L);
      applyDocking(rec, sc.flight, D);
    }
    sc.splashdown(splash);
    const M = sc.mission();
    applyReentry(rec, sc.flight, M.reentry);
    const first = applyMission(rec, sc.flight, M);
    const dup = applyMission(rec, sc.flight, M);
    const c = rec.categories["hadley|ASTRONAUT"];
    expect(c.attempts).toBe(1);
    expect(c.dockings).toBe(1);
    expect(c.firstAttemptDockings).toBe(1);
    expect(c.successes).toBe(1);
    expect(first.newBest).toBe(true);
    expect(dup.repeat).toBe(true);
    // the docked marks survive a save and load of the records
    saveRecords(rec);
    rec = loadRecords();
    expect(rec.docked).toContain(sc.flight.id);
    updateRecords((r) => applyDocking(r, sc.flight, D));
    expect(loadRecords().categories["hadley|ASTRONAUT"].dockings).toBe(1);
  });

  test("a legitimate personal best is never lowered by a resumed flight", () => {
    const rec = emptyRecords();
    const a = flightTo(CP.DOCKING_COMPLETE);
    a.splashdown(splash);
    const Ma = a.mission();
    applyMission(rec, a.flight, Ma);
    const best = rec.categories["hadley|ASTRONAUT"].bestTotal.score;
    const b = flightTo(CP.LANDING_COMPLETE);
    b.docking({ ...docked("ASTRONAUT", { attempts: 3, restarts: 2, propLeft: 1 }) });
    b.splashdown({ ...splash, peakG: 11 });
    applyMission(rec, b.flight, b.mission());
    expect(rec.categories["hadley|ASTRONAUT"].bestTotal.score).toBe(best);
  });

  test("the mission log keeps the same entry for a resumed flight, and rebuilds it if the log was cleared", () => {
    const id = logMissionStart({ siteId: "tycho", difficulty: "CADET" });
    logMissionResumed(id, { siteId: "tycho", difficulty: "CADET", at: 1 });
    let e = loadMissionLog().find((x) => x.id === id);
    expect(e.resumes).toBe(1);
    expect(loadMissionLog().filter((x) => x.id === id)).toHaveLength(1);
    window.localStorage.clear();
    logMissionResumed(id, { siteId: "tycho", difficulty: "CADET", at: 1234, flown: true });
    e = loadMissionLog().find((x) => x.id === id);
    expect(e).toMatchObject({ id, siteId: "tycho", difficulty: "CADET", at: 1234, flown: true, restored: true, resumes: 1 });
  });
});

/* ---- J: the four official missions × the three pilot difficulties, flown with the real simulations ---- */
function flyEntry(fpa, lag = 0.6) {
  const s = createEntryState({ fpaDeg: fpa, bankDeg: 0 });
  let realT = 0;
  let lastCue = -1;
  let target = 0;
  const pending = [];
  const dt = 1 / 30;
  while (!s.outcome && realT < 600) {
    realT += dt;
    if (s.v > 3000 && s.drogueT === null && realT - lastCue > 0.6) {
      lastCue = realT;
      pending.push({ at: realT + lag, cue: recommendBank(s).bank });
    }
    while (pending.length && pending[0].at <= realT) target = pending.shift().cue;
    s.rollInput = s.v > 3000 ? rollToward(s.bank, target) : 0;
    advance(s, dt * timeScaleFor(s));
  }
  return { outcome: s.outcome, eiFpa: fpa, peakG: s.peak.g, peakHeatRate: s.peak.heatRate, heatLoad: s.heatLoad, overheat: s.overheat, shieldPct: 40, bankAgreement: 1, splashV: s.splashV, attempts: 1, losses: [] };
}

describe("J. every destination × difficulty: close and reopen at every checkpoint", () => {
  const entry = flyEntry(TARGET_FPA);
  const dockings = Object.fromEntries(
    PILOT_DIFFICULTIES.map((d) => {
      const r = flyDocking(d, guidedPilot(d, { lag: 0.35 }), { lag: 0.35, maxT: 1200 });
      const cap = r.events.find((e) => e.kind === "capture");
      return [d, { success: r.docked, attempts: 1, restarts: 0, contacts: r.state.contacts, attemptContacts: r.state.contacts, propLeft: r.state.prop, capture: cap ? cap.facts : null }];
    })
  );

  test("the four destinations and three difficulties are the ones the game offers", () => {
    expect(OFFICIAL_MISSION_IDS.slice().sort()).toEqual(SITE_IDS.slice().sort());
    expect(PILOT_DIFFICULTIES).toEqual(["CADET", "ASTRONAUT", "COMMANDER"]);
    expect(entry.outcome).toBe(OUTCOME.SPLASHDOWN);
  });

  OFFICIAL_MISSION_IDS.forEach((siteId) =>
    PILOT_DIFFICULTIES.forEach((difficulty) =>
      test(`${siteId} · ${difficulty}`, () => {
        const local = memLocal();
        const reopen = () => createSaveStore({ local }).load();
        let store = createSaveStore({ local });
        store.load();
        const cfg = DIFFICULTY[difficulty];
        const site = getSite(siteId);
        // the same flight flown without interruption, for comparison
        const straight = createFlightScoring({ id: "mgstraight-0", siteId, difficulty });
        const landing = simulate(cfg, humanPilot(cfg, precisionStrategy(), { lag: 0.25, seed: 1 }), { site }).result;
        expect(landing.crashed).toBe(false);
        straight.beginDescent();
        straight.landed(landing);
        straight.docking(dockings[difficulty]);
        straight.splashdown(entry);

        // A: chosen, before powered descent
        let sc = createFlightScoring({ id: `mg${siteId.length}${difficulty.length}abc-${difficulty[0].toLowerCase()}1`, siteId, difficulty });
        const id = sc.flight.id;
        expect(store.write(at(CP.DESCENT_READY, sc, { activity: { phase: "briefing" } })).ok).toBe(true);
        let s = reopen();
        expect(s.save).toMatchObject({ checkpoint: CP.DESCENT_READY, attemptId: id, mission: { siteId, difficulty } });
        expect(resumePlan(s.save).state).toBe("briefing");
        sc = restoreFlightScoring(s.save.flight);
        // B: a safe touchdown (the pose comes back on the same terrain)
        sc.beginDescent();
        sc.flight.flown = true;
        sc.landed(landing);
        store = createSaveStore({ local });
        store.load();
        expect(store.write(at(CP.LANDING_COMPLETE, sc, { pose: poseFor(siteId, 2.25), activity: { phase: "result" } })).ok).toBe(true);
        s = reopen();
        expect(s.save.checkpoint).toBe(CP.LANDING_COMPLETE);
        expect(s.save.landing.pose).toMatchObject({ x: 2.25, site: siteId });
        expect(resumePlan(s.save).state).toBe("ascent");
        sc = restoreFlightScoring(s.save.flight);
        expect(scoreLanding(sc.flight.landing)).toEqual(scoreLanding(straight.flight.landing));
        // C: ascent and rendezvous flown
        store.write(at(CP.DOCKING_READY, sc, { pose: s.save.landing.pose, docking: { attempts: 1, restarts: 0, contacts: 0 }, activity: { phase: "docking" } }));
        s = reopen();
        const pc = resumePlan(s.save);
        expect(pc).toMatchObject({ state: "docking", docking: { attempts: 1, restarts: 0 } });
        sc = restoreFlightScoring(s.save.flight);
        // D: hard dock and crew transfer
        sc.docking(dockings[difficulty]);
        store.write(at(CP.DOCKING_COMPLETE, sc, { pose: s.save.landing.pose, docking: { attempts: 1, restarts: 0, contacts: dockings[difficulty].contacts }, activity: { phase: "transfer" } }));
        s = reopen();
        expect(s.save.checkpoint).toBe(CP.DOCKING_COMPLETE);
        expect(resumePlan(s.save).state).toBe("return");
        sc = restoreFlightScoring(s.save.flight);
        expect(scoreDocking(sc.flight.docking)).toEqual(scoreDocking(straight.flight.docking));
        expect(scoreDocking(sc.flight.docking).firstAttempt).toBe(true);
        // E: the Earth approach
        store.write(at(CP.REENTRY_READY, sc, { pose: s.save.landing.pose, docking: s.save.docking, activity: { phase: "reentry" } }));
        s = reopen();
        expect(resumePlan(s.save).state).toBe("reentry");
        sc = restoreFlightScoring(s.save.flight);
        // F: splashdown closes the save
        sc.splashdown(entry);
        store.write(makeClosing({ attemptId: id, status: "completed", mission: { siteId, difficulty } }));
        s = reopen();
        expect(s.status).toBe("closed");
        expect(canResume(s)).toBe(false);
        // four reopens later, the mission scores exactly as if it had never been closed
        expect(sc.mission().total).toBe(straight.mission().total);
        expect(sc.mission().medal).toBe(straight.mission().medal);
        expect(SAVE_KIND).toBe("lunavia.mission.checkpoint");
      })
    )
  );
});

/* ---- the lunar EVA (schema 2, the four expeditions schema 3): EVA_READY and EVA_COMPLETE -------------- */
describe("the lunar EVA's checkpoints", () => {
  const evaRec = (o = {}) => ({ progress: { firstSteps: true, sample: false, photo: false }, samples: [], photos: [], completed: false, distance: 12.5, ...o });
  const done = () => evaRec({ progress: { firstSteps: true, sample: true, photo: true }, samples: [{ id: "TQ-01", x: 7.5, z: 8.5 }], photos: [{ subject: "LM", distance: 15.2 }], completed: true });
  const tq = (cp) => flightTo(cp, "tranquillitatis", "ASTRONAUT");

  test("EVA_READY and EVA_COMPLETE sit between the landing and the docking, and both can be resumed", () => {
    expect(CHECKPOINT_ORDER.indexOf(CP.EVA_READY)).toBe(CHECKPOINT_ORDER.indexOf(CP.LANDING_COMPLETE) + 1);
    expect(CHECKPOINT_ORDER.indexOf(CP.EVA_COMPLETE)).toBe(CHECKPOINT_ORDER.indexOf(CP.EVA_READY) + 1);
    // (schema 4: the manual ascent's ORBITAL INSERTION COMPLETE sits between them and the docking)
    expect(CHECKPOINT_ORDER.indexOf(CP.ORBIT_INSERTION)).toBe(CHECKPOINT_ORDER.indexOf(CP.EVA_COMPLETE) + 1);
    expect(CHECKPOINT_ORDER.indexOf(CP.DOCKING_READY)).toBe(CHECKPOINT_ORDER.indexOf(CP.ORBIT_INSERTION) + 1);
    expect(SAVE_SCHEMA).toBe(5);
    [CP.EVA_READY, CP.EVA_COMPLETE].forEach((cp) => ["en", "pt"].forEach((l) => expect(checkpointText(cp, l).length).toBeGreaterThan(5)));
  });

  test("an EVA at every destination, each with its own record, only after a safe landing, consistent", () => {
    const sc = tq(CP.EVA_READY);
    expect(validateSave(docOf(CP.EVA_READY, sc, { eva: evaRec() })).ok).toBe(true);
    // the other three destinations: their own expedition's record, never the Sea of Tranquility's
    const ha = { progress: { firstSteps: true, survey: true, samples: false, photo: false, instrument: false }, samples: [{ id: "HA-01", x: 28.2, z: 9.3 }], photos: [], instruments: [], completed: false, distance: 61 };
    const okHa = validateSave(docOf(CP.EVA_READY, flightTo(CP.EVA_READY, "hadley"), { eva: ha }));
    expect(okHa.ok).toBe(true);
    expect(okHa.save.eva).toEqual(ha);
    expect(validateSave(docOf(CP.EVA_READY, flightTo(CP.EVA_READY, "hadley"), { eva: done() })).reason).toBe("eva"); // TQ-01 is not Hadley's
    const fs = { progress: { firstSteps: true, sample: true, instrument: true, photo: false, data: false }, samples: [{ id: "FS-01", x: 11.9, z: 2 }], photos: [], instruments: [{ id: "LFRA", x: -11.2, z: -4.4 }], completed: false, distance: 48 };
    expect(validateSave(docOf(CP.EVA_READY, flightTo(CP.EVA_READY, "far-side"), { eva: fs })).ok).toBe(true);
    expect(validateSave(docOf(CP.EVA_READY, flightTo(CP.EVA_READY, "far-side"), { eva: { ...fs, instruments: [], progress: { ...fs.progress, instrument: false, data: true } } })).reason).toBe("eva");
    // no landing, no EVA
    expect(validateSave(docOf(CP.EVA_READY, tq(CP.DESCENT_READY), { eva: evaRec() })).reason).toBe("no-safe-landing");
    // an EVA under way needs its record; one marked complete belongs to EVA_COMPLETE
    expect(validateSave(docOf(CP.EVA_READY, sc)).reason).toBe("eva");
    expect(validateSave(docOf(CP.EVA_READY, sc, { eva: done() })).reason).toBe("eva");
    expect(validateSave(docOf(CP.EVA_COMPLETE, sc, { eva: evaRec() })).reason).toBe("eva");
    expect(validateSave(docOf(CP.EVA_COMPLETE, sc, { eva: done() })).ok).toBe(true);
    // never an EVA record before the EVA, nor one left unfinished after it
    expect(validateSave(docOf(CP.LANDING_COMPLETE, sc, { eva: evaRec() })).reason).toBe("eva");
    expect(validateSave(docOf(CP.DOCKING_READY, sc, { eva: evaRec() })).reason).toBe("eva");
    expect(validateSave(docOf(CP.DOCKING_READY, sc, { eva: done() })).ok).toBe(true);
  });

  test("no objective claimed without what it produced, none twice, nothing before the first steps", () => {
    expect(cleanEva(evaRec({ progress: { firstSteps: true, sample: true, photo: false } }))).toBeNull(); // no sample
    expect(cleanEva(evaRec({ samples: [{ id: "TQ-01", x: 1, z: 2 }] }))).toBeNull(); // a sample without the objective
    expect(cleanEva(evaRec({ progress: { firstSteps: true, sample: true, photo: false }, samples: [{ id: "TQ-01", x: 1, z: 2 }, { id: "TQ-02", x: 3, z: 4 }] }))).toBeNull(); // two samples
    expect(cleanEva(evaRec({ progress: { firstSteps: false, sample: false, photo: true }, photos: [{ subject: "LM", distance: 14 }] }))).toBeNull();
    expect(cleanEva(evaRec({ photos: [{ subject: "CSM", distance: 14 }], progress: { firstSteps: true, sample: false, photo: true } }))).toBeNull();
    expect(cleanEva({ progress: {} })).toEqual({ progress: { firstSteps: false, sample: false, photo: false }, samples: [], photos: [], completed: false, distance: 0 });
    // what is kept is only what is known
    const c = cleanEva({ ...done(), extra: "x", samples: [{ id: "TQ-01", x: 7.5, z: 8.5, junk: 1 }] });
    expect(c.samples).toEqual([{ id: "TQ-01", x: 7.5, z: 8.5 }]);
    expect(c.extra).toBeUndefined();
  });

  test("resuming: EVA_READY reopens the EVA with its objectives; EVA_COMPLETE the ascent, never the landing", () => {
    const sc = tq(CP.EVA_READY);
    const mid = validateSave(docOf(CP.EVA_READY, sc, { eva: evaRec({ progress: { firstSteps: true, sample: true, photo: false }, samples: [{ id: "TQ-01", x: 7.5, z: 8.5 }] }), activity: { phase: "eva" } }));
    const p1 = resumePlan(mid.save);
    expect(p1.state).toBe("eva");
    expect(p1.interrupted).toBe(false);
    expect(p1.eva.progress).toEqual({ firstSteps: true, sample: true, photo: false });
    expect(p1.eva.samples.length).toBe(1);
    expect(canResume({ status: "active", save: mid.save })).toBe(true);
    const fin = validateSave(docOf(CP.EVA_COMPLETE, sc, { eva: done(), activity: { phase: "eva" } }));
    const p2 = resumePlan(fin.save);
    expect(p2.state).toBe("ascent");
    expect(p2.eva.completed).toBe(true);
    // a liftoff under way when the app was closed is flown again (the ascent is a maneuver)
    const lift = resumePlan(validateSave(docOf(CP.EVA_COMPLETE, sc, { eva: done(), activity: { phase: "ascent" } })).save);
    expect(lift.interrupted).toBe(true);
    expect(lift.state).toBe("ascent");
  });

  test("schema 1 saves (before the EVA) are still read; none of them can hold an EVA; a newer schema is left alone", () => {
    const sc = flightTo(CP.LANDING_COMPLETE);
    const v1 = { ...validateSave(docOf(CP.LANDING_COMPLETE, sc)).save, schema: 1 };
    delete v1.eva;
    const opened = openEnvelope(sealEnvelope(v1, 4));
    expect(opened.ok).toBe(true);
    expect(resumePlan(opened.save).state).toBe("ascent");
    expect(opened.save.eva).toBeNull();
    const tqv = tq(CP.EVA_READY);
    expect(validateSave({ ...docOf(CP.EVA_READY, tqv, { eva: evaRec() }), schema: 1 }).reason).toBe("kind");
    expect(openEnvelope(sealEnvelope({ ...docOf(CP.EVA_READY, tqv, { eva: evaRec() }), schema: SAVE_SCHEMA + 1 }, 5)).reason).toBe("unsupported");
    // a schema 2 save (phase 1) is still read, its EVA the Sea of Tranquility's; it never held another destination's
    const v2 = openEnvelope(sealEnvelope({ ...docOf(CP.EVA_READY, tqv, { eva: evaRec() }), schema: 2 }, 6));
    expect(v2.ok).toBe(true);
    expect(v2.save.eva).toEqual(evaRec());
    expect(validateSave({ ...docOf(CP.EVA_READY, flightTo(CP.EVA_READY, "hadley"), { eva: { progress: { firstSteps: true }, samples: [], photos: [], instruments: [], completed: false, distance: 1 } }), schema: 2 }).reason).toBe("kind");
  });

  test("the store keeps the EVA's progress across a reopen, and a closed mission cannot bring it back", () => {
    const local = memLocal();
    const store = createSaveStore({ local });
    const sc = tq(CP.EVA_READY);
    expect(store.write(docOf(CP.LANDING_COMPLETE, sc)).ok).toBe(true);
    expect(store.write(docOf(CP.EVA_READY, sc, { eva: evaRec() })).ok).toBe(true);
    expect(store.write(docOf(CP.EVA_READY, sc, { eva: evaRec({ progress: { firstSteps: true, sample: true, photo: false }, samples: [{ id: "TQ-01", x: 7.5, z: 8.5 }] }) })).ok).toBe(true);
    const reopened = createSaveStore({ local });
    reopened.load();
    const st = reopened.state();
    expect(st.status).toBe("active");
    expect(st.save.checkpoint).toBe(CP.EVA_READY);
    expect(st.save.eva.progress.sample).toBe(true);
    expect(st.save.eva.samples).toEqual([{ id: "TQ-01", x: 7.5, z: 8.5 }]);
    reopened.write(makeClosing({ attemptId: sc.flight.id, status: "abandoned", mission: { siteId: "tranquillitatis", difficulty: "ASTRONAUT" } }));
    const again = createSaveStore({ local });
    again.load();
    expect(again.state().status).toBe("closed");
  });
});

describe("the lunar EVA in the records", () => {
  test("FIRST STEPS once per player, only for a completed EVA, however often it is applied (a resume re-applies it)", () => {
    const rec = emptyRecords();
    const flight = { id: "ev12x-ab12", siteId: "tranquillitatis", difficulty: "ASTRONAUT" };
    const half = { progress: { firstSteps: true, sample: true, photo: false }, completed: true };
    expect(applyEva(rec, flight, half)).toEqual([]);
    expect(applyEva(rec, flight, { progress: { firstSteps: true, sample: true, photo: true }, completed: false })).toEqual([]);
    const full = { progress: { firstSteps: true, sample: true, photo: true }, completed: true };
    expect(applyEva(rec, flight, full)).toEqual(["FIRST_EVA"]);
    expect(applyEva(rec, flight, full)).toEqual([]);
    expect(applyEva(rec, { ...flight, id: "ev99x-ab12" }, full)).toEqual([]);
    expect(rec.achievements.FIRST_EVA.flightId).toBe(flight.id);
    expect(rec.categories["tranquillitatis|ASTRONAUT"].achievements).toEqual(["FIRST_EVA"]);
    // nothing else in the records moves: no attempt, no success, no score
    const c = rec.categories["tranquillitatis|ASTRONAUT"];
    expect([c.attempts, c.successes, c.bestTotal]).toEqual([0, 0, null]);
  });
});


/* ---- the MANUAL ASCENT (schema 4): the ascent record and ORBITAL INSERTION COMPLETE ------------------ */
describe("the manual ascent's checkpoint", () => {
  const { simulate, guidanceProgram, cutoffRecord, STAGE } = require("../data/manualAscent");
  const flown = simulate(guidanceProgram, { difficulty: "ASTRONAUT" }).state;
  const e = flown.evaluation;
  const outcome = (o = {}) => ({ success: true, apo: e.apo, peri: e.peri, fuelKg: e.fuelKg, fuelPct: e.fuelPct, accuracy: e.accuracy, cutoffBy: "pilot", burn: e.burn, cut: cutoffRecord(flown), ...o });
  const asc = (o = {}) => ({ mode: "manual", attempts: 2, outcome: outcome(), ...o });

  test("ORBITAL INSERTION COMPLETE: a manual ascent's orbit, judged again from its cutoff, resumes at the rendezvous", () => {
    const sc = flightTo(CP.ORBIT_INSERTION);
    const v = validateSave(docOf(CP.ORBIT_INSERTION, sc, { ascent: asc(), activity: { phase: "rendezvous" } }));
    expect(v.ok).toBe(true);
    expect(v.save.ascent.mode).toBe("manual");
    expect(v.save.ascent.attempts).toBe(2);
    expect(v.save.ascent.outcome.apo).toBeCloseTo(e.apo, 3);
    expect(v.save.ascent.outcome.accuracy.grade).toBe("PRECISE");
    const plan = resumePlan(v.save);
    expect(plan.state).toBe("insertion");
    expect(plan.interrupted).toBe(false);
    expect(RESUME_AT.ORBIT_INSERTION.state).toBe("insertion");
    ["en", "pt"].forEach((l) => expect(checkpointText(CP.ORBIT_INSERTION, l).length).toBeGreaterThan(10));
    // and it survives sealing and opening
    expect(openEnvelope(sealEnvelope(v.save, 3)).ok).toBe(true);
  });
  test("a save cannot claim an orbit the physics does not accept", () => {
    const sc = flightTo(CP.ORBIT_INSERTION);
    const bad = (o) => validateSave(docOf(CP.ORBIT_INSERTION, sc, { ascent: asc({ outcome: outcome(o) }) })).reason;
    expect(bad({ cut: { ...cutoffRecord(flown), vt: 1500 } })).toBe("ascent"); // suborbital: periapsis below the surface
    expect(bad({ cut: { ...cutoffRecord(flown), vt: 1800 } })).toBe("ascent"); // apoapsis above the CSM
    expect(bad({ cut: { ...cutoffRecord(flown), prop: STAGE.prop + 1 } })).toBe("ascent"); // more propellant than loaded
    expect(bad({ cut: null })).toBe("ascent");
    expect(bad({ success: false })).toBe("ascent");
    // the claimed numbers are not trusted: they are recomputed from the cutoff state
    const v = validateSave(docOf(CP.ORBIT_INSERTION, sc, { ascent: asc({ outcome: outcome({ apo: 96000, accuracy: { grade: "PRECISE", miss: 0 }, fuelKg: 999 }) }) }));
    expect(v.save.ascent.outcome.fuelKg).toBeCloseTo(flown.prop, 6);
  });
  test("ORBIT_INSERTION needs the insertion; an insertion only at ORBIT_INSERTION or later", () => {
    const sc = flightTo(CP.ORBIT_INSERTION);
    expect(validateSave(docOf(CP.ORBIT_INSERTION, sc)).reason).toBe("ascent");
    expect(validateSave(docOf(CP.ORBIT_INSERTION, sc, { ascent: asc({ outcome: null }) })).reason).toBe("ascent");
    const early = flightTo(CP.LANDING_COMPLETE);
    expect(validateSave(docOf(CP.LANDING_COMPLETE, early, { ascent: asc() })).reason).toBe("ascent");
    // the attempts alone are kept at the ascent preparation (no fuel or attempt reset by a reload)
    const v = validateSave(docOf(CP.LANDING_COMPLETE, early, { ascent: { mode: "manual", attempts: 3, outcome: null }, activity: { phase: "manualAscent" } }));
    expect(v.ok).toBe(true);
    expect(v.save.ascent.attempts).toBe(3);
    // a manual ascent cut short by closing the app is flown again from the ascent preparation
    const plan = resumePlan(v.save);
    expect(plan.state).toBe("ascent");
    expect(plan.interrupted).toBe(true);
    // the docking checkpoint after a manual insertion keeps it (the guided route has none)
    const later = flightTo(CP.DOCKING_READY);
    expect(validateSave(docOf(CP.DOCKING_READY, later, { ascent: asc() })).ok).toBe(true);
    expect(validateSave(docOf(CP.DOCKING_READY, later)).ok).toBe(true);
    expect(validateSave(docOf(CP.DOCKING_READY, later, { ascent: { mode: "warp", attempts: 1, outcome: null } })).reason).toBe("ascent");
    expect(validateSave(docOf(CP.DOCKING_READY, later, { ascent: { mode: "manual", attempts: -1, outcome: null } })).reason).toBe("ascent");
  });
  test("schema 3 saves (before the manual ascent) are still read", () => {
    const sc = flightTo(CP.DOCKING_READY);
    const v3 = { ...validateSave(docOf(CP.DOCKING_READY, sc)).save, schema: 3 };
    delete v3.ascent;
    const o = openEnvelope(sealEnvelope(v3, 9));
    expect(o.ok).toBe(true);
    expect(o.save.ascent).toBeNull();
    expect(resumePlan(o.save).state).toBe("docking");
  });
});
