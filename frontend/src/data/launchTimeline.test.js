import {
  SHOTS, EVENTS, DURATION, LIFTOFF_T, MILESTONES, metAt, formatMet, trajectoryAt, padHeight,
  stage1Thrust, upperThrust, sepProgress, eventTime, shotAt, airDensity, sunAt, rollAt, stage1Visible,
  tliCountdown, orbitPhase, RCS_WINDOWS, ULLAGE, LES_JETTISON, lesJettison, payloadReveal, TLI_CUT, tliCutHoldEnd,
} from "./launchTimeline";
import catalog from "../audio/commsLines.json";
import manifest from "../../public/voice/manifest.json";

describe("launch timeline", () => {
  test("shots tile the whole sequence without gaps or overlaps", () => {
    expect(SHOTS[0].start).toBe(0);
    for (let i = 1; i < SHOTS.length; i++) expect(SHOTS[i].start).toBe(SHOTS[i - 1].end);
    expect(SHOTS[SHOTS.length - 1].end).toBe(DURATION);
    SHOTS.forEach((s) => expect(s.end - s.start).toBeGreaterThanOrEqual(3));
  });

  test("events are ordered, inside the sequence, and never gate on input", () => {
    for (let i = 1; i < EVENTS.length; i++) expect(EVENTS[i].t).toBeGreaterThan(EVENTS[i - 1].t);
    EVENTS.forEach((e) => {
      expect(e.t).toBeGreaterThanOrEqual(0);
      expect(e.t).toBeLessThan(DURATION);
      expect(e).not.toHaveProperty("requiresInput");
    });
    const order = MILESTONES.map(eventTime);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
  });

  test("ignition precedes liftoff by a visible delay; the vehicle does not move before release", () => {
    expect(LIFTOFF_T - eventTime("engineStart")).toBeGreaterThanOrEqual(5);
    expect(padHeight(LIFTOFF_T - 0.01)).toBe(0);
    expect(padHeight(LIFTOFF_T + 1)).toBeLessThan(0.1); // ~2 m in the first second: heavy, slow
    expect(padHeight(eventTime("towerClear"))).toBeGreaterThan(4.6); // base above the 4.7-unit tower top
    expect(padHeight(eventTime("towerClear") - 1.5)).toBeLessThan(4.7);
  });

  test("mission clock: countdown in real time, then monotonic", () => {
    expect(metAt(0)).toBe(-15);
    expect(metAt(LIFTOFF_T)).toBe(0);
    let prev = -Infinity;
    for (let t = 0; t <= DURATION; t += 0.1) {
      const m = metAt(t);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
    expect(formatMet(metAt(eventTime("orbit")))).toBe("T+00:10:00");
    // TLI on the second orbit, close to Apollo's T+2:44 and Artemis-class timing
    expect(metAt(eventTime("tli"))).toBeGreaterThan(2.6 * 3600);
    expect(metAt(eventTime("tli"))).toBeLessThan(3 * 3600);
    expect(formatMet(-10)).toBe("T-00:00:10");
  });

  test("ascent, orbit insertion, TLI and lunar transfer stay distinct", () => {
    const meco = trajectoryAt(eventTime("meco"));
    const orbit = trajectoryAt(eventTime("orbit") + 2);
    const tliEnd = trajectoryAt(eventTime("lunarTransfer") - 0.3);
    const away = trajectoryAt(DURATION);
    expect(meco.altKm).toBeGreaterThan(55);
    expect(meco.speedKmps).toBeLessThan(3); // far from orbital speed at staging
    expect(orbit.altKm).toBeCloseTo(185, 0);
    expect(orbit.speedKmps).toBeCloseTo(7.8, 1); // circular LEO
    expect(tliEnd.speedKmps).toBeGreaterThan(10.4); // above LEO, escape-class after TLI
    expect(away.altKm).toBeGreaterThan(5000); // climbing away from the parking orbit as the film ends
    // The whole parking orbit is flown at 185 km, at orbital speed
    for (let t = eventTime("orbit") + 0.5; t < eventTime("tli"); t += 0.5) {
      expect(trajectoryAt(t).altKm).toBeCloseTo(185, 0);
      expect(trajectoryAt(t).speedKmps).toBeCloseTo(7.8, 1);
    }
    // Altitude never decreases through the flight regime
    let prev = 0;
    for (let t = 32; t <= DURATION; t += 0.25) {
      const a = trajectoryAt(t).altKm;
      expect(a).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = a;
    }
  });

  test("engine schedule: MECO before separation, upper stage lights only after a clear gap", () => {
    expect(stage1Thrust(eventTime("engineStart") - 0.1)).toBe(0);
    expect(stage1Thrust(LIFTOFF_T - 1)).toBeCloseTo(1, 5); // full thrust before release
    expect(stage1Thrust(eventTime("meco") + 1)).toBe(0);
    expect(upperThrust(eventTime("separation"))).toBe(0);
    expect(sepProgress(eventTime("usIgnition"))).toBeGreaterThan(0.4);
    expect(upperThrust(eventTime("usIgnition") + 1)).toBe(1);
    expect(upperThrust(eventTime("orbit") + 2)).toBe(0); // coasting in parking orbit
    expect(upperThrust(eventTime("tli") + 1)).toBe(1);
    expect(upperThrust(DURATION)).toBe(0);
    let prev = 0;
    for (let t = 40; t <= DURATION; t += 0.1) {
      const s = sepProgress(t);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  test("shot lookup and atmosphere", () => {
    expect(shotAt(0).id).toBe("wide");
    expect(shotAt(eventTime("separation")).id).toBe("sepJoint");
    expect(shotAt(eventTime("tli")).id).toBe("tli");
    expect(shotAt(DURATION - 0.01).id).toBe("departure");
    expect(airDensity(0)).toBe(1);
    expect(airDensity(65)).toBeLessThan(0.001);
  });

  test("Earth orbit is a sequence of distinct compositions, not one shot", () => {
    const orbitShots = SHOTS.filter((s) => s.start >= eventTime("orbit") && s.end <= eventTime("tli") + 0.5);
    expect(orbitShots.map((s) => s.id)).toEqual(["orbitWide", "orbitClose", "orbitLimb", "finalPass", "tliPrep", "tliCount"]);
    // Within each shot the ground moves (orbital motion), at a readable rate
    orbitShots.forEach((s) => {
      const a = trajectoryAt(s.start + 0.2).downrangeKm;
      const b = trajectoryAt(s.end - 0.2).downrangeKm;
      const rate = (b - a) / (s.end - s.start - 0.4);
      expect(rate).toBeGreaterThan(15);
      expect(rate).toBeLessThan(200);
    });
  });

  test("orbital day, sunset, night pass and a sunrise TLI", () => {
    const at = (id, u) => {
      const s = SHOTS.find((x) => x.id === id);
      return sunAt(s.start + (s.end - s.start) * u);
    };
    expect(at("orbitWide", 0.5).lit).toBe(1);
    expect(at("orbitWide", 0.5).elev).toBeGreaterThan(0.3); // Sun high over the day side
    expect(at("finalPass", 0.1).lit).toBe(1);
    expect(at("finalPass", 0.9).red).toBeGreaterThan(0.5); // reddened, low over the limb
    expect(at("finalPass", 0.5).elev).toBeLessThan(0); // the ground below is already in night
    expect(at("tliCount", 0.2).lit).toBe(0); // anticipation in the dark, just before sunrise
    expect(at("tliPrep", 0.3).lit).toBe(0); // in Earth's shadow
    expect(sunAt(eventTime("tli")).lit).toBeGreaterThan(0.5); // the burn starts at sunrise
    // Roll to burn attitude during the night pass, complete before ignition
    expect(rollAt(eventTime("tliPrep") - 1)).toBe(0);
    expect(rollAt(eventTime("tli"))).toBeCloseTo(Math.PI, 5);
  });

  test("TLI finale: roll, ullage, a 3-2-1 hold, ignition, then the vehicle leaves", () => {
    const shot = (id) => SHOTS.find((x) => x.id === id);
    // Order of the finale beats
    expect(SHOTS.slice(-5).map((s) => s.id)).toEqual(["finalPass", "tliPrep", "tliCount", "tli", "departure"]);
    // RCS roll inside the night pass; ullage just before ignition
    RCS_WINDOWS.forEach(([a, b]) => {
      expect(a).toBeGreaterThanOrEqual(shot("tliPrep").start);
      expect(b).toBeLessThanOrEqual(shot("tliPrep").end);
    });
    expect(ULLAGE[0]).toBeGreaterThan(shot("tliCount").start);
    expect(ULLAGE[1]).toBeGreaterThan(eventTime("tli"));
    // Countdown 3, 2, 1 in the anticipation shot, nothing outside it
    const ign = eventTime("tli");
    expect(tliCountdown(ign - 2.9)).toBe(3);
    expect(tliCountdown(ign - 1.5)).toBe(2);
    expect(tliCountdown(ign - 0.4)).toBe(1);
    expect(tliCountdown(ign + 0.1)).toBe(null);
    expect(tliCountdown(ign - 3.2)).toBe(null);
    expect(ign - 3).toBeGreaterThanOrEqual(shot("tliCount").start);
    expect(ign).toBeGreaterThan(shot("tli").start); // ignition just after the cut
    // The burn is still on as the departure shot opens, then cuts off
    expect(upperThrust(shot("departure").start + 0.2)).toBe(1);
    expect(upperThrust(eventTime("lunarTransfer") + 0.5)).toBe(0);
    // Leaving: altitude rises through the departure shot
    expect(trajectoryAt(shot("departure").end - 0.1).altKm).toBeGreaterThan(trajectoryAt(shot("departure").start).altKm);
  });

  test("the film ends on the departure, 2 s after GUIDANCE's \"Cutoff.\" is over: no translunar travel, no deployment near the Earth", () => {
    const shot = (id) => SHOTS.find((x) => x.id === id);
    // No deployment near the Earth: no transposition, docking or extraction shot or event
    const earthSide = /^td|transposition|docking|dock|extract|panels|hga|capture/i;
    SHOTS.forEach((x) => expect(x.id).not.toMatch(earthSide));
    EVENTS.forEach((e) => expect(e.id).not.toMatch(earthSide));
    EVENTS.filter((e) => e.t > eventTime("tli")).forEach((e) => {
      expect(`${e.caption || ""} ${e.sub || ""}`).not.toMatch(/EXTRACT|TRANSPOSITION|DOCKING|DOCKED|PANELS OPEN|ADAPTER OPEN/);
    });
    // No translunar travel: nothing after the departure shot; its last event is the lunar-transfer caption
    expect(SHOTS[SHOTS.length - 1].id).toBe("departure");
    SHOTS.forEach((x) => expect(x.id).not.toMatch(/carrierSep|farewell|coast|cruise|deep|approach/i));
    expect(EVENTS[EVENTS.length - 1].id).toBe("lunarTransfer");
    EVENTS.forEach((e) => expect(`${e.caption || ""} ${e.sub || ""} ${e.kicker || ""}`).not.toMatch(/SEPARATION.*CARRIER|TRANSLUNAR COAST|LEFT BEHIND/));
    // The cut: the call is GUIDANCE's "Cutoff.", at TLI cutoff, the upper stage's burn over
    const line = catalog.lines.find((l) => l.id === TLI_CUT.line);
    expect(line.role).toBe("GUIDANCE");
    expect(line.variants[0].en).toBe("Cutoff.");
    expect(upperThrust(eventTime("tliCutoff") + 0.8)).toBe(0);
    // held exactly 2 s after the call ends, then a fade of at most 0.5 s
    expect(TLI_CUT.hold).toBe(2);
    expect(TLI_CUT.fade).toBeGreaterThan(0);
    expect(TLI_CUT.fade).toBeLessThanOrEqual(0.5);
    expect(tliCutHoldEnd(101.1)).toBeCloseTo(103.1, 9);
    // never said (filtered, or the film seeked past it): the clip's own length stands in for it
    const clip = Math.max(...["en", "pt"].map((l) => manifest.langs[l].clips[TLI_CUT.line][0].d));
    expect(clip).toBeGreaterThan(0.5);
    expect(TLI_CUT.fallbackLine).toBeGreaterThanOrEqual(clip);
    expect(tliCutHoldEnd(null)).toBeCloseTo(eventTime("tliCutoff") + TLI_CUT.delay + TLI_CUT.fallbackLine + 2, 9);
    // the hold stays on the departure shot, and its camera move is the one it always had
    expect(shotAt(tliCutHoldEnd(null)).id).toBe("departure");
    expect(tliCutHoldEnd(102.9)).toBeLessThanOrEqual(DURATION - TLI_CUT.fade);
    expect(shot("departure").camEnd).toBe(103.5);
    // The mission clock as the film ends: about three hours after launch
    expect(metAt(tliCutHoldEnd(null)) / 3600).toBeGreaterThan(2.5);
    expect(metAt(tliCutHoldEnd(null)) / 3600).toBeLessThan(3.5);
    // The pad opens on the payload: the spacecraft on top and the lunar module inside the adapter
    expect(SHOTS[1].id).toBe("payload");
    // ... seen through the adapter for about two seconds of that shot, and never elsewhere
    const p = SHOTS[1];
    expect(payloadReveal(p.start + 2)).toBeCloseTo(1, 6);
    expect(payloadReveal(p.start)).toBe(0);
    expect(payloadReveal(p.end)).toBe(0);
    for (let t = 0; t < DURATION; t += 0.1) if (t < p.start || t >= p.end) expect(payloadReveal(t)).toBe(0);
    expect(EVENTS.find((e) => e.id === "payload").sub).toMatch(/LUNAR MODULE INSIDE THE ADAPTER/);
  });

  test("orbit progress: revolution count and position against day and night", () => {
    expect(orbitPhase(eventTime("orbit") + 1).rev).toBe(1);
    expect(orbitPhase(eventTime("finalPass")).rev).toBe(1);
    expect(orbitPhase(eventTime("tliPrep")).rev).toBe(2);
    // Final pass ends on the sunset side, TLI is on the sunrise side
    const end = orbitPhase(SHOTS.find((x) => x.id === "finalPass").end - 0.1).phi;
    expect(end).toBeGreaterThan(90);
    expect(end).toBeLessThan(120);
    const tli = orbitPhase(eventTime("tli")).tliPhi;
    expect(tli).toBeGreaterThan(240);
    expect(tli).toBeLessThan(270);
  });

  test("the spent stage stays in the picture through the separation shots", () => {
    ["stages", "stage1Cam", "usIgnition"].forEach((id) => {
      const s = SHOTS.find((x) => x.id === id);
      expect(stage1Visible(s.end - 0.1)).toBe(true);
    });
    expect(stage1Visible(eventTime("orbit"))).toBe(false);
  });
});

describe("launch escape tower", () => {
  test("jettisoned once the upper stage burns steadily, before orbit, with its own caption", () => {
    expect(LES_JETTISON).toBeGreaterThan(eventTime("usIgnition") + 3);
    expect(LES_JETTISON).toBeLessThan(eventTime("orbit"));
    expect(upperThrust(LES_JETTISON)).toBeGreaterThan(0.9);
    expect(eventTime("lesJettison")).toBe(LES_JETTISON);
    expect(EVENTS.find((e) => e.id === "lesJettison").caption).toMatch(/ESCAPE TOWER/);
    expect(lesJettison(LES_JETTISON - 1)).toBe(0);
    expect(lesJettison(LES_JETTISON + 2)).toBeCloseTo(2, 9);
  });

  test("gone from every orbit, TLI and departure shot: none of the spacecraft's hardware is left behind on it", () => {
    SHOTS.filter((s) => s.start >= 61).forEach((s) => expect(lesJettison(s.start)).toBeGreaterThan(1.5));
  });
});
