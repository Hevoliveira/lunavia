import fs from "fs";
import path from "path";
import { TITLE, startLabel, titleCards, titleVisible } from "./titleReveal";
import { LM_CENTRE_X, ORBIT_SEQ, TITLE_DRIFT, TITLE_SCREEN_K, orbitClockAt, orbitRealAt, orbitShotAt, orbitShotCamera, undockTime } from "./orbitSequence";
import { undocking } from "./undocking";

const DEG = Math.PI / 180;
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

describe("the title, inside the mission", () => {
  test("after the deployment, the real undocking and the go for powered descent: LUNAVIA, then A LAJU PRODUCTIONS GAME, then START MISSIONS", () => {
    // CAPCOM's call is about 2.2 s (English) to 3.3 s (Portuguese) long; LUNAVIA comes in as it ends
    expect(TITLE.reveal).toBeGreaterThanOrEqual(ORBIT_SEQ.goPdi + 3.4);
    expect(ORBIT_SEQ.goPdi).toBeGreaterThan(ORBIT_SEQ.undock + 10);
    expect(ORBIT_SEQ.undock).toBeGreaterThan(ORBIT_SEQ.swap);
    expect(TITLE.credit).toBeGreaterThan(TITLE.reveal + 2);
    expect(TITLE.button).toBeGreaterThan(TITLE.credit + 2);
    expect(TITLE.button).toBe(ORBIT_SEQ.titleScreen);
    expect(TITLE.music).toBeGreaterThan(ORBIT_SEQ.goPdi);
    // all of it over the shots that follow the LM, from before the reveal on
    for (let tau = TITLE.reveal; tau <= TITLE.reveal + 120; tau += 0.1) expect(["title", "titleScreen"]).toContain(orbitShotAt(tau).shot.id);
  });

  test("nothing on screen before the reveal; once up, the title, the credit and the button stay up", () => {
    expect(titleCards(0).veil).toBe(0);
    expect(titleCards(TITLE.reveal - 0.01).title).toBe(0);
    expect(titleCards(TITLE.credit - 0.01).credit).toBe(0);
    expect(titleCards(TITLE.button - 0.01).button).toBe(0);
    expect(titleVisible(TITLE.reveal - 0.01)).toBe(false);
    for (let tau = TITLE.button + 0.8; tau < 4000; tau += 0.5) {
      const c = titleCards(tau);
      expect(c.title).toBeCloseTo(1, 9);
      expect(c.credit).toBeCloseTo(1, 9);
      expect(c.button).toBeCloseTo(1, 9);
      expect(titleVisible(tau)).toBe(true);
    }
  });

  test("the title screen holds: the orbit clock slows to a stop, so nothing replays and the LM and CSM come to rest", () => {
    const T = ORBIT_SEQ.titleScreen;
    expect(orbitClockAt(T)).toBe(T);
    expect(orbitClockAt(T - 3)).toBe(T - 3);
    for (const r of [T - 2, T + 1, T + 5, T + 20]) expect(orbitRealAt(orbitClockAt(r))).toBeCloseTo(r, 6);
    let prev = orbitClockAt(T);
    for (let r = T; r < T + 3600; r += 0.25) {
      const tau = orbitClockAt(r);
      expect(tau).toBeGreaterThanOrEqual(prev); // never back: no second undocking
      expect(tau).toBeLessThanOrEqual(T + TITLE_SCREEN_K);
      expect(orbitShotAt(tau).shot.id).not.toMatch(/undock|tunnel|deploy|loi/);
      prev = tau;
    }
    // continuous speed at the hand-over, then all but still within half a minute
    expect((orbitClockAt(T + 0.01) - T) / 0.01).toBeCloseTo(1, 2);
    const rest = (r) => orbitClockAt(r + 1) - orbitClockAt(r);
    expect(rest(T + 30)).toBeLessThan(0.01);
    expect(rest(T + 90)).toBeLessThan(1e-6);
    // 90 s on the title screen: the LM and the CSM have stopped moving apart
    const gap = (r) => undocking(undockTime(orbitClockAt(r))).gap;
    expect(gap(T + 90) - gap(T + 60)).toBeLessThan(0.05);
    expect(gap(T + 90)).toBeGreaterThan(10); // the CSM at a plausible distance
    expect(gap(T + 90)).toBeLessThan(40);
  });

  test("START MISSIONS / INICIAR MISSÕES by the subtitle language", () => {
    expect(startLabel("en")).toBe("START MISSIONS");
    expect(startLabel("pt")).toBe("INICIAR MISSÕES");
    expect(startLabel(undefined)).toBe("START MISSIONS");
  });

  const project = (cam, p, aspect) => {
    const T = Math.tan(22.5 * DEG);
    const f = cam.look.map((x, i) => x - cam.pos[i]);
    const fl = Math.hypot(...f);
    const fn = f.map((x) => x / fl);
    const r = [-fn[2], 0, fn[0]].map((x) => x / Math.hypot(fn[0], fn[2]));
    const d = p.map((x, i) => x - cam.pos[i]);
    const z = d[0] * fn[0] + d[1] * fn[1] + d[2] * fn[2];
    return { x: 0.5 + (d[0] * r[0] + d[2] * r[2]) / z / (T * aspect) / 2, z };
  };
  test.each([
    ["iPhone SE", 667 / 375],
    ["iPhone 15", 852 / 393],
    ["iPhone Pro Max", 932 / 430],
  ])("on %s the lunar module stays in the right part of the frame, clear of the title, through the title screen's drift", (_, aspect) => {
    for (let real = TITLE.reveal; real <= ORBIT_SEQ.titleScreen + TITLE_DRIFT + 60; real += 0.5) {
      const tau = orbitClockAt(real);
      const { shot, u } = orbitShotAt(tau, real);
      const lmY = undocking(undockTime(tau)).lmY;
      const cam = orbitShotCamera(shot, u, lmY);
      const lm = project(cam, [LM_CENTRE_X + lmY, 0, 0], aspect);
      expect(lm.z).toBeGreaterThan(15);
      expect(lm.x).toBeGreaterThan(0.6);
      expect(lm.x).toBeLessThan(0.92);
    }
  });

  test("the title screen settles on a wide hold: the LM near, the CSM at a plausible distance beyond it, both in frame; the drift is slow", () => {
    const real = ORBIT_SEQ.titleScreen + TITLE_DRIFT + 30;
    const tau = orbitClockAt(real);
    const { shot, u } = orbitShotAt(tau, real);
    expect(shot.id).toBe("titleScreen");
    expect(u).toBe(1);
    const s = undocking(undockTime(tau));
    const cam = orbitShotCamera(shot, u, s.lmY);
    for (const aspect of [667 / 375, 852 / 393, 932 / 430]) {
      const lm = project(cam, [LM_CENTRE_X + s.lmY, 0, 0], aspect);
      const csm = project(cam, [s.csmY - 2, 0, 0], aspect);
      expect(csm.z).toBeGreaterThan(lm.z + 15); // further away
      expect(csm.x).toBeGreaterThan(0.42);
      expect(csm.x).toBeLessThan(lm.x - 0.1);
    }
    // camera speed and turn rate in real seconds
    let prev = null;
    for (let r = ORBIT_SEQ.titleScreen; r < ORBIT_SEQ.titleScreen + TITLE_DRIFT + 10; r += 0.1) {
      const t = orbitClockAt(r);
      const sh = orbitShotAt(t, r);
      const c = orbitShotCamera(sh.shot, sh.u, undocking(undockTime(t)).lmY);
      if (prev) {
        expect(Math.hypot(...c.pos.map((x, i) => x - prev.pos[i])) / 0.1).toBeLessThan(4.5);
        const f0 = prev.look.map((x, i) => x - prev.pos[i]);
        const f1 = c.look.map((x, i) => x - c.pos[i]);
        const cos = f0.reduce((a, x, i) => a + x * f1[i], 0) / Math.hypot(...f0) / Math.hypot(...f1);
        expect(Math.acos(Math.min(1, cos)) / DEG / 0.1).toBeLessThan(6);
      }
      prev = c;
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
    expect(read("pages/Mission.jsx")).toMatch(/<MissionTitle clockRef=\{orbitClockRef\} ready=\{state === STATES.TITLE\} onStart=\{handleStartMissions\}/);
    expect(read("pages/Training.jsx")).not.toMatch(/MissionTitle|titleReveal/);
  });
});
