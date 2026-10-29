/* The voice pack says why a clip could not be loaded: these are the reasons AUDIO DIAGNOSTICS
 * and the radio trace report (FILE NOT FOUND, DECODE FAILED, …). */
import { createVoicePack } from "./voicePack";

const manifest = { langs: { en: { clips: { "launch.liftoff": [{ d: 3.8, f: "en/launch.liftoff.0.mp3" }] } } } };
const res = (ok, status, body) => ({ ok, status, json: () => Promise.resolve(body), arrayBuffer: () => Promise.resolve(body) });
const ctx = (decodeOk) => ({
  decodeAudioData: (data, ok, fail) => (decodeOk ? ok({ duration: 3.8, sampleRate: 24000, numberOfChannels: 1 }) : fail(new Error("EncodingError"))),
});

test("found and decoded: the buffer, its file and its size", async () => {
  const pack = createVoicePack({ base: "/voice", fetchImpl: (u) => Promise.resolve(u.endsWith("manifest.json") ? res(true, 200, manifest) : res(true, 200, new ArrayBuffer(4096))) });
  const r = await pack.load(ctx(true), "en", "launch.liftoff");
  expect(r).toMatchObject({ file: "en/launch.liftoff.0.mp3", bytes: 4096, cached: false });
  expect(r.buffer.duration).toBe(3.8);
  expect((await pack.load(ctx(true), "en", "launch.liftoff")).cached).toBe(true);
  expect(pack.file("en", "launch.liftoff")).toBe("en/launch.liftoff.0.mp3");
});

test("each failure has its own reason", async () => {
  const make = (fileRes) => createVoicePack({ base: "/voice", fetchImpl: (u) => (u.endsWith("manifest.json") ? Promise.resolve(res(true, 200, manifest)) : fileRes()) });
  expect((await make(() => Promise.resolve(res(false, 404))).load(ctx(true), "en", "launch.liftoff")).error).toBe("http-404");
  expect((await make(() => Promise.resolve(res(true, 200, new ArrayBuffer(0)))).load(ctx(true), "en", "launch.liftoff")).error).toBe("empty-file");
  expect((await make(() => Promise.reject(new Error("offline"))).load(ctx(true), "en", "launch.liftoff")).error).toBe("fetch-error:offline");
  expect((await make(() => Promise.resolve(res(true, 200, new ArrayBuffer(64)))).load(ctx(false), "en", "launch.liftoff")).error).toBe("decode-failed:EncodingError");
  expect((await make(() => Promise.resolve(res(true, 200, new ArrayBuffer(64)))).load(ctx(true), "en", "no.such.line")).error).toBe("clip-missing");
  const none = createVoicePack({ base: "/voice", fetchImpl: () => Promise.resolve(res(false, 404)) });
  expect((await none.load(ctx(true), "en", "launch.liftoff")).error).toBe("pack-unavailable");
});
