// Screenshots of /dev/lv001 (A and B, six views) from LUNAVIA's renderer in Chromium (SwiftShader).
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const URL = process.env.LV_URL || "http://localhost:3497";
const OUT = process.env.OUT || path.join(__dirname, "out");
const W = Number(process.env.W || 1280);
const H = Number(process.env.H || 800);
fs.mkdirSync(OUT, { recursive: true });
const ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const views = (process.env.VIEWS || "1,2,3,4,5,6").split(",");
const models = (process.env.MODELS || "a,b").split(",");
const extra = process.env.EXTRA || "";
(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const stats = {};
  for (const m of models) {
    for (const v of views) {
      const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      const errs = [];
      page.on("pageerror", (e) => errs.push(String(e)));
      page.on("console", (msg) => msg.type() === "error" && errs.push(msg.text()));
      const t0 = Date.now();
      await page.goto(`${URL}/dev/lv001?model=${m}&view=${v}&dpr=1&label=${process.env.LABEL || "1"}${extra}`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.__lvCompare && window.__lvCompare.ready, null, { timeout: 240000 });
      await page.waitForTimeout(Number(process.env.SETTLE || 2500));
      const st = await page.evaluate(() => window.__lvCompare);
      await page.evaluate(() => (window.__lvFreeze = true));
      await page.waitForTimeout(1500);
      st.wallMs = Date.now() - t0;
      const tag = `${m}${v}${process.env.TAG || ""}`;
      const url = await page.evaluate(() => document.querySelector("canvas").toDataURL("image/png"));
      fs.writeFileSync(path.join(OUT, `${tag}.png`), Buffer.from(url.split(",")[1], "base64"));
      stats[tag] = { ...st, errors: errs.slice(0, 5) };
      console.log(tag, JSON.stringify(stats[tag]));
      await page.close();
    }
  }
  fs.writeFileSync(path.join(OUT, `stats${process.env.TAG || ""}.json`), JSON.stringify(stats, null, 1));
  await browser.close();
})();
