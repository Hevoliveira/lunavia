import fs from "fs";
import path from "path";
import { TITLE, titleCards, titleVisible } from "./titleReveal";
import { LM_CENTRE_X, ORBIT_SEQ, orbitShotAt, orbitShotCamera, undockTime } from "./orbitSequence";
import { undocking } from "./undocking";

const DEG = Math.PI / 180;
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

describe("the title, inside the mission", () => {
  test("after the real undocking and the go for powered descent: LUNAVIA, then A LAJU PRODUCTIONS GAME, then the descent setup", () => {
    // FLIGHT's call is about 2.2 s (English) to 3.3 s (Portuguese) long; LUNAVIA comes in as it ends
    expect(TITLE.reveal).toBeGreaterThanOrEqual(ORBIT_SEQ.goPdi + 2.4);
    expect(ORBIT_SEQ.goPdi).toBeGreaterThan(ORBIT_SEQ.undock + 10);
    expect(TITLE.credit).toBeGreaterThan(TITLE.reveal);
    expect(TITLE.out).toBeGreaterThan(TITLE.credit + 2);
    expect(TITLE.gone).toBeLessThan(ORBIT_SEQ.end);
    // all of it over the shot that follows the LM, which starts before the reveal
    for (let tau = TITLE.reveal; tau <= TITLE.gone; tau += 0.1) expect(orbitShotAt(tau).shot.id).toBe("title");
  });

  test("nothing on screen before the reveal or once gone; fully up in between", () => {
    expect(titleCards(0).veil).toBe(0);
    expect(titleCards(TITLE.reveal - 0.01).title).toBe(0);
    expect(titleCards(TITLE.credit - 0.01).credit).toBe(0);
    const held = titleCards(TITLE.out - 0.01);
    expect(held.title).toBeCloseTo(1, 6);
    expect(held.credit).toBeCloseTo(1, 6);
    expect(titleCards(TITLE.gone).veil).toBe(0);
    expect(titleCards(ORBIT_SEQ.end).veil).toBe(0);
    expect(titleVisible(TITLE.reveal + 1)).toBe(true);
    expect(titleVisible(ORBIT_SEQ.end)).toBe(false);
  });

  test("SKIP TO DESCENT jumps past it, and it never returns while the orbit keeps flying behind the descent setup", () => {
    for (let tau = ORBIT_SEQ.end; tau < 4000; tau += 0.5) expect(titleCards(tau).veil).toBe(0);
  });

  test.each([
    ["iPhone SE", 667 / 375],
    ["iPhone 15", 852 / 393],
    ["iPhone Pro Max", 932 / 430],
  ])("on %s the lunar module is in the right part of the frame, clear of the title on the left", (_, aspect) => {
    const T = Math.tan(22.5 * DEG);
    for (let tau = TITLE.reveal; tau <= ORBIT_SEQ.end + 20; tau += 0.5) {
      const { shot, u } = orbitShotAt(tau);
      const lmY = undocking(undockTime(tau)).lmY;
      const cam = orbitShotCamera(shot, u, lmY);
      const f = cam.look.map((x, i) => x - cam.pos[i]);
      const fl = Math.hypot(...f);
      const fn = f.map((x) => x / fl);
      const r = [-fn[2], 0, fn[0]].map((x) => x / Math.hypot(fn[0], fn[2]));
      const lm = [LM_CENTRE_X + lmY - cam.pos[0], -cam.pos[1], -cam.pos[2]];
      const z = lm[0] * fn[0] + lm[1] * fn[1] + lm[2] * fn[2];
      const x = 0.5 + (lm[0] * r[0] + lm[2] * r[2]) / z / (T * aspect) / 2;
      expect(x).toBeGreaterThan(0.6);
      expect(x).toBeLessThan(0.92);
    }
  });

  test("the home screen no longer plays anything by itself, and nothing records that it was seen", () => {
    const landing = read("pages/Landing.jsx");
    expect(landing).not.toMatch(/Opening|openingDue|hero-opening/);
    expect(landing).toMatch(/LUNAVIA · A LAJU PRODUCTIONS GAME/);
    const src = ["pages/Landing.jsx", "pages/Mission.jsx", "pages/Training.jsx", "components/MissionTitle.jsx", "components/opening/TitleLoop.jsx"].map(read).join("\n");
    expect(src).not.toMatch(/lunavia\.opening\.seen/);
    ["pages/Landing.jsx", "components/MissionTitle.jsx", "components/opening/TitleLoop.jsx"].forEach((p) => expect(read(p)).not.toMatch(/localStorage/));
    // the title belongs to the mission's lunar orbit, never to the Training Center
    expect(read("pages/Mission.jsx")).toMatch(/<MissionTitle clockRef=\{orbitClockRef\}/);
    expect(read("pages/Training.jsx")).not.toMatch(/MissionTitle|titleReveal/);
  });
});
