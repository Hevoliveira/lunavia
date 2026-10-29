// Steady-state frame time and counts: /dev/lv001 A vs B, full scene and vehicle only (solo).
const { chromium } = require("playwright");
const URL = process.env.LV_URL || "http://localhost:3497";
const ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const out = {};
  for (const solo of ["0", "1"]) for (const v of (process.env.VIEWS || "1,3").split(",")) for (const m of ["a", "b"]) {
    const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
    await page.goto(`${URL}/dev/lv001?model=${m}&view=${v}&dpr=1&label=0&solo=${solo}`);
    await page.waitForFunction(() => window.__lvCompare && window.__lvCompare.frameSamples >= 60, null, { timeout: 900000 });
    const st = await page.evaluate(() => window.__lvCompare);
    const k = `${m} view${v} solo${solo}`;
    out[k] = { calls: st.calls, tris: st.tris, programs: st.programs, textures: st.textures, texMB: +(st.texBytes / 1048576).toFixed(1), geoMB: +(st.geoBytes / 1048576).toFixed(2), frameMs: +st.frameMs.toFixed(1), firstFrameMs: Math.round(st.firstFrameMs), fetchMs: Math.round(st.fetchMs), parseMs: Math.round(st.parseMs) };
    console.log(k, JSON.stringify(out[k]));
    await page.close();
  }
  require("fs").writeFileSync(process.env.OUTF || "perf.json", JSON.stringify(out, null, 1));
  await browser.close();
})();
