// LUNAVIA voice QA: record listening reels through the app's own comms + radio chain.
//
//   node tools/voice/qa/serve.js frontend/build 3100 &
//   NODE_PATH=$(npm root -g) URL=http://localhost:3100 node tools/voice/qa/reels.js <outdir>
//   python3 tools/voice/qa/analyze.py <outdir>      (levels, clipping, quindar, overlaps → MP3)
//
// Runs on a page without a 3D scene (/manifesto) so the capture is not disturbed by
// WebGL load: an AudioContext is attached to the comms hub by hand, and tap.js
// mirrors everything sent to the speakers into a capture buffer.
const { chromium } = require("playwright");
const fs = require("fs");
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const URL = process.env.URL || "http://localhost:3100";
const REELS = {
  cast: ["launch.orbit", "orbit.goPdi", "descent.alt100fuelGood", "descent.attitude", "descent.pdiStart"],
  moods: ["cruise.ambient", "descent.rateHigh", "descent.drift", "descent.fuelCritical", "descent.contact", "descent.touchdown", "descent.touchdownFlight", "descent.crash", "descent.crashFlight"],
  reentry: ["reentry.prepGo", "reentry.blackoutExpected", "reentry.ei", "@link0.45", "reentry.heating", "@blackout", "reentry.gWarning", "@aos", "reentry.aos", "reentry.drogues", "reentry.mains", "reentry.splashdown", "reentry.splashFlight"],
  launch: ["launch.count10", "launch.count9", "launch.count8", "launch.count7", "launch.engineStart", "launch.liftoff", "launch.towerClear", "launch.maxQ", "launch.staging", "launch.lunarTransfer"],
};
(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript({ path: __dirname + "/tap.js" });
  await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto(URL + "/manifesto", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const ac = new AudioContext();
    await ac.resume();
    const out = ac.createGain();
    out.connect(ac.destination);
    window.__lvComms.attach({ ctx: ac, out, duck: null });
  });
  const summary = {};
  const variants = (process.env.VARIANTS || "en:fx,pt:fx,en:dry,pt:dry").split(",");
  for (const v of variants) {
    const [lang, mode] = v.split(":");
    for (const [name, ids] of Object.entries(REELS)) {
      if (mode === "dry" && name !== "cast" && name !== "moods") continue;
      await page.evaluate(([lang, fx]) => window.__lvAudioSettings.set({ voiceLang: lang, subLang: lang, radioFx: fx, voice: true, voiceVolume: 0.9 }), [lang, mode === "fx"]);
      await page.evaluate(() => { window.__lvComms.reset(); window.__lvCommsLog.length = 0; window.__lvTake(); window.__lvRec = true; });
      await page.waitForTimeout(400);
      for (const id of ids) {
        if (id.startsWith("@")) {
          await page.evaluate((cmd) => {
            const c = window.__lvComms;
            if (cmd === "@blackout") { c.setLink(0); c.setBlackout(true); }
            else if (cmd === "@aos") { c.setBlackout(false); c.setLink(0.75); }
            else c.setLink(parseFloat(cmd.slice(5)));
          }, id);
          if (id === "@blackout") await page.waitForTimeout(1600);
          continue;
        }
        await page.evaluate((id) => window.__lvComms.say(id), id);
        await page.waitForFunction((id) => window.__lvCommsLog.some((e) => e.id === id && ["end", "drop", "stale", "cut"].includes(e.type)), id, { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(id.startsWith("launch.count") ? 300 : 650);
      }
      await page.waitForTimeout(600);
      const take = await page.evaluate(() => { window.__lvRec = false; return window.__lvTake(); });
      const log = await page.evaluate(() => window.__lvCommsLog.slice());
      const file = `${OUT}/${name}-${lang}-${mode}`;
      fs.writeFileSync(file + ".pcm16", Buffer.from(take.b64, "base64"));
      fs.writeFileSync(file + ".json", JSON.stringify({ sr: take.sr, log }, null, 1));
      summary[`${name}-${lang}-${mode}`] = {
        aired: log.filter((e) => e.type === "start").map((e) => e.id),
        dropped: log.filter((e) => ["drop", "stale"].includes(e.type)).map((e) => `${e.id}:${e.reason || e.type}`),
      };
      console.log(name, lang, mode, JSON.stringify(summary[`${name}-${lang}-${mode}`]));
    }
  }
  fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 1));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
