import { LCP, LEGACY_KEYS, LEGACY_NATIVE_SLOTS, createLegacyStore, legacyResumeAt, newLegacyAttemptId, openLegacy, sealLegacy, validateLegacy } from "./legacySave";
import { SLOT_KEYS } from "./missionSave";
import { freshEvaFor } from "../data/evaMissions";
import { legacyScenario } from "../data/apolloLegacy";
import { getSite } from "../data/landingSites";

const memory = () => {
  const m = new Map();
  return { m, get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) };
};
const poseAt = (siteId, x = 0) => {
  const site = getSite(siteId);
  return { x: x * 0.5, padY: site.scale.y(site.contactGround(x)), tilt: 1, pitch: 0, comp: [0, 0, 0, 0], probe: [0, 0, 0, 0], site: siteId };
};
const base = (scenario = "apollo12") => ({ status: "active", attemptId: newLegacyAttemptId(1_700_000_000_000), scenario, difficulty: "ASTRONAUT", checkpoint: LCP.DESCENT, createdAt: 1 });

describe("Apollo Legacy's save: its own slots, never the campaign's", () => {
  test("separate keys and native slots from the official mission", () => {
    expect(Object.values(LEGACY_KEYS).some((k) => Object.values(SLOT_KEYS).includes(k))).toBe(false);
    expect(Object.values(LEGACY_NATIVE_SLOTS)).toEqual(["la", "lb"]);
  });
  test("checkpoints validate in order: DESCENT, LANDED (a safe pose), EVA (a consistent record)", () => {
    expect(validateLegacy({ ...base(), kind: "lunavia.legacy.checkpoint", schema: 1 }).ok).toBe(true);
    const landed = { ...base(), kind: "lunavia.legacy.checkpoint", schema: 1, checkpoint: LCP.LANDED, landing: { safe: true, pose: poseAt("oceanus"), precision: { dTarget: 3, band: "PINPOINT", dObject: 151 }, touchdownSpeed: 0.8 } };
    const v = validateLegacy(landed);
    expect(v.ok).toBe(true);
    expect(v.save.landing.precision.band).toBe("PINPOINT");
    expect(validateLegacy({ ...landed, landing: { safe: false, pose: poseAt("oceanus") } }).ok).toBe(false);
    expect(validateLegacy({ ...landed, landing: { safe: true, pose: poseAt("hadley") } }).ok).toBe(false); // another site's pose
    const eva = freshEvaFor(legacyScenario("apollo12").eva);
    expect(validateLegacy({ ...landed, checkpoint: LCP.EVA, eva }).ok).toBe(true);
    expect(validateLegacy({ ...landed, checkpoint: LCP.EVA, eva: { ...eva, retrieved: [{ id: "TV-CAMERA" }] } }).ok).toBe(false); // retrieved without its objective
    expect(validateLegacy({ ...base("apollo99"), kind: "lunavia.legacy.checkpoint", schema: 1 }).ok).toBe(false);
  });
  test("alternating slots, newest wins; a torn write never loses the previous checkpoint", () => {
    const local = memory();
    const st = createLegacyStore({ local });
    st.load();
    expect(st.write(base()).ok).toBe(true);
    const landed = { ...base(), checkpoint: LCP.LANDED, landing: { safe: true, pose: poseAt("oceanus") } };
    expect(st.write(landed).ok).toBe(true);
    expect(st.state().save.checkpoint).toBe(LCP.LANDED);
    // damage the newest slot: the older one stands
    local.set(LEGACY_KEYS[st.state().slot], "garbage");
    const again = createLegacyStore({ local });
    expect(again.load().save.checkpoint).toBe(LCP.DESCENT);
  });
  test("an inconsistent save is never written; closing it keeps it closed", () => {
    const local = memory();
    const st = createLegacyStore({ local });
    st.load();
    expect(st.write({ ...base(), checkpoint: LCP.EVA }).ok).toBe(false);
    st.write(base());
    st.close("completed");
    const re = createLegacyStore({ local });
    expect(re.load().status).toBe("completed");
    expect(legacyResumeAt(re.state().save)).toBeNull();
  });
  test("the campaign's checkpoint in the same storage is never read or touched", () => {
    const local = memory();
    local.set(SLOT_KEYS.a, "the campaign's own slot");
    const st = createLegacyStore({ local });
    st.load();
    st.write(base());
    st.close("abandoned");
    expect(local.get(SLOT_KEYS.a)).toBe("the campaign's own slot");
    expect(local.get(SLOT_KEYS.b)).toBeNull();
  });
  test("the iOS app's copy is used when newer", async () => {
    const local = memory();
    const text = sealLegacy(validateLegacy({ ...base("apollo15"), kind: "lunavia.legacy.checkpoint", schema: 1 }).save, 7);
    const native = { read: async () => ({ a: "campaign", la: text, lb: null }), write: async () => {} };
    const st = createLegacyStore({ local, native });
    expect(st.load().status).toBe("empty");
    const s = await st.loadNative();
    expect(s.save.scenario).toBe("apollo15");
    expect(openLegacy("{").ok).toBe(false);
    expect(legacyResumeAt(s.save)).toBe("briefing");
  });
});
