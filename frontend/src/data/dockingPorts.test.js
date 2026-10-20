import { buildCM, CM_TOP, LM_DROGUE, LM_M_PER_UNIT, PROBE_L as CSM_PROBE_L } from "./csmDesign";
import { buildStages } from "./lmDesign";
import {
  ASC_CENTRE_U,
  DIFFICULTY_KEYS,
  DOCKING,
  DOCK_Y,
  DROGUE_R,
  LM_UNIT,
  PORT_B,
  PROBE_TIP,
  PULSE,
  STEP,
  checkpointState,
  portState,
  qAxisAngle,
  qMul,
  qNorm,
  qRot,
  referencePilot,
  restoreCheckpoint,
  stepDocking,
  telemetry,
  engageStabilize,
  engageCenter,
  fineStep,
} from "./dockingSim";
import { CONTROLS, commandOf, createGuidance, evaluate, guidedPilot } from "./dockingGuidance";
import { ORBIT_DEFAULT, VIEWS, orbitDrag, orbitZoom, project, throughCockpitWindow, viewCamera } from "./dockingViews";
import {
  ACTIVE_PORT,
  CSM_CENTRE,
  TARGET_PORT,
  TARGET_RING_R,
  actionWords,
  approachStatus,
  captureReadiness,
  contactCause,
  corridorGeometry,
  corridorRadius,
  focusOrbit,
  markerPlacement,
  occluded,
  portAlignment,
  portFrames,
  portsMidpoint,
  thrustDirection,
} from "./dockingPorts";

const DEG = Math.PI / 180;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const VIEWPORTS = [
  { w: 667, h: 375 },
  { w: 852, h: 393 },
  { w: 932, h: 430 },
];
// a seeded random, so every run tests the same states
function rng(seed = 7) {
  let x = seed;
  return () => ((x = (x * 16807) % 2147483647) / 2147483647);
}
const verts = (geo) => {
  const p = geo.attributes.position;
  const out = [];
  for (let i = 0; i < p.count; i++) out.push([p.getX(i), p.getY(i), p.getZ(i)]);
  return out;
};

describe("1. the two physical docking ports: the models and the physics agree", () => {
  test("the CSM's probe tip in the 3D model is the physics' PROBE_TIP; the docking ring is at DOCK_Y", () => {
    const cm = buildCM({ probe: true });
    const top = Math.max(...verts(cm.metal).map((v) => v[1]));
    expect(Math.abs(top - PROBE_TIP[1])).toBeLessThan(1e-6);
    expect(CM_TOP).toBe(DOCK_Y);
    expect(CSM_PROBE_L).toBeCloseTo(PROBE_TIP[1] - DOCK_Y, 9);
    // the anodised ring (black torus) around the tunnel's top: its centre ring radius is TARGET_RING_R
    const ring = verts(cm.black).filter((v) => Math.abs(v[1] - (CM_TOP - 0.02)) < 0.04 && Math.abs(Math.hypot(v[0], v[2]) - TARGET_RING_R) < 0.04);
    expect(ring.length).toBeGreaterThan(50);
    expect(TARGET_PORT.ring).toEqual([0, DOCK_Y, 0]);
    expect(TARGET_PORT.tip).toEqual(PROBE_TIP);
  });
  test("the ascent stage's drogue ring in the 3D model is the physics' PORT_B, with the drogue's mouth radius", () => {
    const { ascent } = buildStages();
    const ring = verts(ascent.black).filter((v) => Math.abs(v[1] - LM_DROGUE.y) < 0.012 && Math.abs(Math.hypot(v[0], v[2] - LM_DROGUE.z) - 0.088) < 0.012);
    expect(ring.length).toBeGreaterThan(40);
    const cy = ring.reduce((a, v) => a + v[1], 0) / ring.length;
    const cz = ring.reduce((a, v) => a + v[2], 0) / ring.length;
    // model units → the body frame used by the physics (from the ascent stage's centre, metres)
    const body = [0, (cy - ASC_CENTRE_U[1]) * LM_UNIT, (cz - ASC_CENTRE_U[2]) * LM_UNIT];
    expect(dist(body, PORT_B)).toBeLessThan(0.01);
    expect(Math.abs(0.088 * LM_UNIT - DROGUE_R)).toBeLessThan(1e-9);
    expect(LM_M_PER_UNIT).toBe(LM_UNIT);
    expect(ACTIVE_PORT.ringB).toEqual(PORT_B);
    expect(ACTIVE_PORT.mouthR).toBe(DROGUE_R);
  });
  test("docked, the drogue ring sits on the CSM's docking ring (the two interfaces that connect)", () => {
    const s = checkpointState("ASTRONAUT");
    s.pos = [0, DOCK_Y + PORT_B[1], 0];
    s.q = [0, 0, 1, 0];
    const f = portFrames(s);
    expect(dist(f.active.ring, TARGET_PORT.ring)).toBeLessThan(1e-9);
    expect(f.active.axis[1]).toBeCloseTo(-1, 9); // face to face
  });
  test("the ascent stage's port can reach the CSM's port: every difficulty's reference pilot captures", () => {
    for (const d of DIFFICULTY_KEYS) {
      const r = flyCollect(d, referencePilot(d, { lag: 0 }));
      expect(r.event && r.event.kind).toBe("capture");
    }
  });
});

describe("2–3. the target marker points at the receiving port, not the CSM's centre", () => {
  test("in every view and iPhone size, the marker is drawn where the probe tip projects", () => {
    for (const d of DIFFICULTY_KEYS) {
      const s = checkpointState(d);
      for (const v of VIEWS) {
        const cam = viewCamera(v, s);
        for (const vp of VIEWPORTS) {
          const m = markerPlacement(cam, TARGET_PORT.tip, vp);
          const p = project(cam, TARGET_PORT.tip, vp.w / vp.h);
          if (m.state === "offscreen") continue;
          expect(Math.abs(m.x - (p.x * 0.5 + 0.5) * vp.w)).toBeLessThan(1e-6);
          expect(Math.abs(m.y - (-p.y * 0.5 + 0.5) * vp.h)).toBeLessThan(1e-6);
          // and not where the CSM's centre is: seen from the side the two are far apart on screen
          // (head-on, along the docking axis, they lie on one line of sight)
          const side = viewCamera("ORBIT", s, focusOrbit(s));
          const a = markerPlacement(side, TARGET_PORT.tip, vp);
          const c = markerPlacement(side, CSM_CENTRE, vp);
          expect(Math.hypot(c.x - a.x, c.y - a.y)).toBeGreaterThan(20);
        }
      }
    }
    expect(dist(TARGET_PORT.tip, CSM_CENTRE)).toBeGreaterThan(5);
  });
  test("the marker stays on the port as the vehicle moves and turns (it is recomputed from the state)", () => {
    const s = checkpointState("COMMANDER");
    const vp = VIEWPORTS[0];
    for (let k = 0; k < 30; k++) {
      s.pos = [s.pos[0] + 0.05, s.pos[1] - 0.4, s.pos[2] - 0.03];
      s.q = qNorm(qMul(s.q, qAxisAngle([0.3, 0.2, 1], 0.5 * DEG)));
      const cam = viewCamera("NAV", s);
      const m = markerPlacement(cam, PROBE_TIP, vp);
      const p = project(cam, PROBE_TIP, vp.w / vp.h);
      expect(Math.abs(m.x - (p.x * 0.5 + 0.5) * vp.w)).toBeLessThan(1e-6);
    }
  });
  test("it grows more precise as the range closes: the bracket tightens on the ring", () => {
    const vp = VIEWPORTS[1];
    const sizes = [30, 15, 6, 2].map((range) => markerPlacement(viewCamera("NAV", checkpointState("ASTRONAUT", { range, offset: [0, 0], att: [0, 0, 0] })), PROBE_TIP, vp).r);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThan(sizes[i - 1]);
  });
  test("off screen: an edge arrow pointing the right way; hidden behind a hull: marked hidden", () => {
    const s = checkpointState("ASTRONAUT");
    const vp = VIEWPORTS[0];
    // a camera looking away from the CSM (360°, behind the ascent stage looking further out)
    const cam = { pos: [0, 80, 0], q: viewCamera("NAV", { ...s, q: [0, 0, 0, 1], pos: [0, 70, 0] }).q, fov: 50 };
    const m = markerPlacement(cam, PROBE_TIP, vp);
    expect(m.state).toBe("offscreen");
    expect(m.x).toBeGreaterThanOrEqual(0);
    expect(m.x).toBeLessThanOrEqual(vp.w);
    // the probe tip seen from the far side of the CSM (behind the service module): hidden by the hull
    expect(occluded([0, -25, 0], PROBE_TIP, s)).toBe(true);
    expect(occluded([0, 30, 0], PROBE_TIP, s, { lm: false })).toBe(false);
    // the drogue seen from behind the ascent stage (the 360° start): hidden by the ascent stage itself
    const cam360 = viewCamera("ORBIT", s, ORBIT_DEFAULT);
    expect(occluded(cam360.pos, portState(s).port, s)).toBe(true);
    // from the side (FOCUS DOCKING PORTS), both ports are in plain view
    const camF = viewCamera("ORBIT", s, focusOrbit(s));
    expect(occluded(camF.pos, portState(s).port, s)).toBe(false);
    expect(occluded(camF.pos, PROBE_TIP, s)).toBe(false);
  });
  test("COCKPIT: the marker is drawn on the port only while the port is seen through the docking window", () => {
    let inside = 0;
    let outside = 0;
    const r = rng(3);
    for (let k = 0; k < 200; k++) {
      const s = checkpointState("ASTRONAUT", { range: 2 + r() * 30, offset: [(r() - 0.5) * 6, (r() - 0.5) * 6], att: [(r() - 0.5) * 30, 0, (r() - 0.5) * 30] });
      const cam = viewCamera("COCKPIT", s);
      const through = throughCockpitWindow(cam, PROBE_TIP);
      const m = markerPlacement(cam, PROBE_TIP, { ...VIEWPORTS[0], inWindow: through });
      if (m.state === "offscreen") continue;
      expect(m.state).toBe(through ? "visible" : "window");
      through ? inside++ : outside++;
    }
    expect(inside).toBeGreaterThan(10);
    expect(outside).toBeGreaterThan(10);
  });
});

describe("4. the approach corridor is attached to the receiving port", () => {
  test("it starts at the probe tip and runs out along the port's axis, narrowing to the capture ring", () => {
    for (const d of DIFFICULTY_KEYS) {
      const c = corridorGeometry(d);
      expect(c.from).toEqual(PROBE_TIP);
      expect(c.to[1] - PROBE_TIP[1]).toBeCloseTo(40, 9);
      expect(c.capture.radius).toBe(DOCKING[d].tol.lateral);
      for (let i = 1; i < c.sections.length; i++) expect(c.sections[i].radius).toBeGreaterThanOrEqual(c.sections[i - 1].radius);
      c.sections.forEach((x) => expect(dist(x.centre, [0, PROBE_TIP[1] + x.axial, 0])).toBeLessThan(1e-9));
    }
  });
  test("it follows the port frame's orientation (a turned port turns the corridor)", () => {
    const q = qAxisAngle([1, 0, 0], 30 * DEG);
    const frame = { ...TARGET_PORT, axis: qRot(q, TARGET_PORT.axis), right: qRot(q, TARGET_PORT.right), up: qRot(q, TARGET_PORT.up) };
    const c = corridorGeometry("ASTRONAUT", frame);
    const dir = [c.to[0] - c.from[0], c.to[1] - c.from[1], c.to[2] - c.from[2]].map((v) => v / 40);
    expect(dist(dir, frame.axis)).toBeLessThan(1e-9);
  });
  test("its radius is the guidance's own 'lined up' threshold (one corridor, not a second rule)", () => {
    for (const d of DIFFICULTY_KEYS)
      for (const range of [0.5, 3, 8, 20, 35]) {
        const s = checkpointState(d, { range, offset: [0, 0], att: [0, 0, 0], drift: [0, 0], closing: 0 });
        s.t = 20;
        const top = evaluate(s, d, { mode: "TRANSLATION", align: false }, null).find((c) => c.d && c.d.linedThr != null);
        expect(corridorRadius(telemetry(s, d).axial, d)).toBeCloseTo(top.d.linedThr, 9);
      }
  });
});

describe("5–7. alignment and closing speed come from the port frames", () => {
  test("a real lateral displacement moves the offset by the same amount, the right way", () => {
    const s = checkpointState("ASTRONAUT", { offset: [0, 0], att: [0, 0, 0] });
    const a0 = portAlignment(s);
    s.pos = [s.pos[0] - 0.5, s.pos[1], s.pos[2] + 0.3]; // CSM −X is screen right, +Z is up
    const a1 = portAlignment(s);
    expect(a1.lateral - a0.lateral).toBeCloseTo(0.5, 9);
    expect(a1.vertical - a0.vertical).toBeCloseTo(0.3, 9);
  });
  test("a real attitude change moves the angular error, and the port (not the centre) is measured", () => {
    const s = checkpointState("ASTRONAUT", { offset: [0, 0], att: [0, 0, 0] });
    const a0 = portAlignment(s);
    s.q = qNorm(qMul(s.q, qAxisAngle([1, 0, 0], 4 * DEG)));
    const a1 = portAlignment(s);
    expect(a1.angle - a0.angle).toBeCloseTo(4 * DEG, 6);
    // pitching swings the port sideways while the centre stays put: the offset is the port's
    expect(Math.abs(a1.vertical - a0.vertical)).toBeGreaterThan(0.08);
  });
  test("closing speed is the port's own along the docking axis (relative velocity, with rotation)", () => {
    const s = checkpointState("ASTRONAUT");
    s.vel = [0.01, -0.123, 0.02];
    s.w = [0, 0, 0];
    expect(portAlignment(s).closing).toBeCloseTo(0.123, 9);
    s.w = [0.01, 0, 0];
    const { vPort } = portState(s);
    expect(portAlignment(s).closing).toBeCloseTo(-vPort[1], 12);
  });
});

describe("8. the directional words and the 360° arrow follow the flight controls", () => {
  test("the words name what the buttons do (body axes); never a screen guess", () => {
    expect(actionWords({ key: "align", buttons: ["right", "up"] })).toBe("MOVE RIGHT · TRANSLATE UP");
    expect(actionWords({ key: "slow", buttons: ["aft"] })).toBe("REDUCE CLOSING VELOCITY");
    expect(actionWords({ key: "att", buttons: ["yaw-left", "pitch-up"] })).toBe("CORRECT YAW · CORRECT PITCH");
    expect(actionWords({ key: "align", buttons: ["left"] }, "pt")).toBe("MOVA PARA A ESQUERDA");
  });
  test("one tap of what the guidance names, pushed along the arrow, reduces the error it names (400 rolled states)", () => {
    const r = rng(11);
    let checked = 0;
    for (let k = 0; k < 400; k++) {
      const d = DIFFICULTY_KEYS[k % 3];
      const roll = (r() - 0.5) * 80;
      const s = checkpointState(d, { range: 6 + r() * 20, offset: [(r() - 0.5) * 3, (r() - 0.5) * 3], drift: [0, 0], att: [0, roll, 0], rate: [0, 0, 0], closing: 0.03 });
      s.t = 20;
      if (d === "CADET") {
        // CADET flies with STABILIZE holding (settled): its lateral orders are the same jets
        engageStabilize(s, d);
        s.stab.v = s.vel.slice();
        s.stab.stableSince = 0;
      }
      const g = createGuidance(d).update(s, { mode: "TRANSLATION", align: d === "CADET" });
      if (g.key !== "align" && g.key !== "drift") continue;
      const dir = thrustDirection(s, g.buttons);
      // the arrow is the buttons' body push turned through the attitude
      const cmd = commandOf(g.buttons).t;
      const want = qRot(s.q, cmd.map((v) => v / Math.hypot(...cmd)));
      expect(dist(dir, want)).toBeLessThan(1e-9);
      // and that push moves the port towards the axis (screen right = −X, up = +Z)
      const off = g.d.offL;
      const push = [-dir[0], dir[2]];
      if (g.key === "align") expect(push[0] * -off[0] + push[1] * -off[1]).toBeGreaterThan(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(60);
  });
  test("the CONTROLS table is what the words are built from (every button has a word)", () => {
    Object.keys(CONTROLS).forEach((b) => expect(actionWords({ key: "x", buttons: [b] })).not.toBe(""));
  });
});

describe("9. unsafe approaches are recognised, and the physics agrees", () => {
  test("turned away, behind the probe, or drifting outside the drogue in the last metres", () => {
    const d = "ASTRONAUT";
    const away = checkpointState(d, { range: 10, att: [0, 0, 0] });
    away.q = qNorm(qMul(away.q, qAxisAngle([1, 0, 0], 100 * DEG)));
    away.t = 10;
    expect(approachStatus(away, d).unsafe).toBe("facing");
    const behind = checkpointState(d, { range: -1.5, offset: [2.5, 0], att: [0, 0, 0] });
    behind.t = 10;
    expect(approachStatus(behind, d).unsafe).toBe("behind");
    const miss = checkpointState(d, { range: 2, offset: [0.1, 0], drift: [0.12, 0], closing: 0.1, att: [0, 0, 0] });
    miss.t = 10;
    expect(approachStatus(miss, d).unsafe).toBe("miss");
    expect(approachStatus(miss, d).key).toBe("unsafe");
  });
  test("every coasting approach flagged as a miss fails to capture", () => {
    const r = rng(5);
    let flagged = 0;
    for (let k = 0; k < 300; k++) {
      const d = DIFFICULTY_KEYS[k % 3];
      const s = checkpointState(d, { range: 0.5 + r() * 2.4, offset: [(r() - 0.5) * 0.6, (r() - 0.5) * 0.6], drift: [(r() - 0.5) * 0.3, (r() - 0.5) * 0.3], closing: 0.03 + r() * 0.25, att: [0, 0, 0], rate: [0, 0, 0] });
      s.t = 10;
      if (approachStatus(s, d).unsafe !== "miss") continue;
      flagged++;
      const e = coast(s, d);
      expect(e && e.kind).not.toBe("capture");
    }
    expect(flagged).toBeGreaterThan(30);
  });
});

describe("10. the readiness display agrees with the physics' capture judgement", () => {
  test("never ready before a contact the physics rejects (2,400 random final approaches, all difficulties)", () => {
    const r = rng(17);
    const tally = { ready: 0, captured: 0, readyAndCaptured: 0, contacts: 0, capturedInCorridor: 0, readyInCorridor: 0 };
    for (let k = 0; k < 2400; k++) {
      const d = DIFFICULTY_KEYS[k % 3];
      const tol = DOCKING[d].tol;
      const j = (x) => (r() - 0.5) * 2 * x;
      const s = checkpointState(d, {
        range: 0.15 + r() * 0.5,
        offset: [j(0.9 * tol.lateral), j(0.9 * tol.lateral)],
        drift: [j(0.9 * tol.vLat), j(0.9 * tol.vLat)],
        closing: tol.vMin * 0.6 + r() * tol.vMax * 1.1,
        att: [j(0.9 * tol.angle) / DEG, j(1.0 * tol.roll) / DEG, j(0.9 * tol.angle) / DEG],
        rate: [j(0.6 * tol.rate) / DEG, 0, j(0.6 * tol.rate) / DEG],
      });
      s.t = 20;
      let before = null;
      let e = null;
      let inCorr = false;
      for (let n = 0; n < 2400 && !e; n++) {
        const rd = captureReadiness(s, d);
        before = rd.ready;
        inCorr = rd.items.corridor.ok;
        e = stepDocking(s, null, d, STEP);
      }
      if (!e || !["capture", "deflected", "outside", "damage"].includes(e.kind)) continue;
      tally.contacts++;
      if (before) tally.ready++;
      if (e.kind === "capture") tally.captured++;
      if (before && e.kind === "capture") tally.readyAndCaptured++;
      if (inCorr && e.kind === "capture") tally.capturedInCorridor++;
      if (inCorr && before && e.kind === "capture") tally.readyInCorridor++;
      if (k === 2399) console.log("readiness agreement", JSON.stringify(tally));
      // the rule: ready one step before contact ⇒ the physics captures
      if (before) expect(e.kind).toBe("capture");
    }
    expect(tally.contacts).toBeGreaterThan(1500);
    expect(tally.ready).toBeGreaterThan(100);
    // and it is not a display that only says no: inside the corridor (where the guidance leads the
    // pilot) most captures were announced as ready. Outside it the guidance asks for a correction
    // first, so READY stays off even where the latches might still have held.
    expect(tally.readyInCorridor / tally.capturedInCorridor).toBeGreaterThan(0.6);
  });
  test("on the reference and guided pilots' flights the readiness is up at the capture, all difficulties", () => {
    for (const d of DIFFICULTY_KEYS) {
      for (const pilot of [referencePilot(d, { lag: 0 }), guidedPilot(d, { lag: 0.25 })]) {
        const r = flyCollect(d, pilot);
        expect(r.event.kind).toBe("capture");
        expect(r.readyBefore).toBe(true);
        expect(r.statusBefore).toBe("authorized");
      }
    }
  });
  test("the guidance's STAND BY FOR CONTACT uses the same readiness", () => {
    const d = "ASTRONAUT";
    const s = checkpointState(d, { range: 1.0, offset: [0, 0], drift: [0, 0], closing: 0.08, att: [0, 0, 0], rate: [0, 0, 0] });
    s.t = 20;
    expect(captureReadiness(s, d).ready).toBe(true);
    expect(evaluate(s, d, { mode: "TRANSLATION" }, null).some((c) => c.key === "standby")).toBe(true);
    s.vel = [0.2, s.vel[1], 0]; // drifting: not ready, and no stand-by
    expect(captureReadiness(s, d).ready).toBe(false);
    expect(evaluate(s, d, { mode: "TRANSLATION" }, null).some((c) => c.key === "standby")).toBe(false);
  });
  test("the status names what is wrong, in priority order", () => {
    const d = "ASTRONAUT";
    const at = (o) => {
      const s = checkpointState(d, { att: [0, 0, 0], rate: [0, 0, 0], drift: [0, 0], ...o });
      s.t = 20;
      return approachStatus(s, d).key;
    };
    expect(at({ range: 20, closing: 1.0, offset: [0, 0] })).toBe("reduce");
    expect(at({ range: 20, closing: 0.05, offset: [3, 0] })).toBe("lateral");
    expect(at({ range: 20, closing: 0.05, offset: [0, 0], att: [8, 0, 0] })).toBe("attitude");
    expect(at({ range: 20, closing: 0.05, offset: [3, 0], att: [8, 0, 0] })).toBe("alignPorts");
    expect(at({ range: 20, closing: 0.05, offset: [0.3, 0] })).toBe("aligned"); // in the corridor, not yet in the capture tolerance
    expect(at({ range: 1, closing: 0.08, offset: [0, 0] })).toBe("authorized");
    const s = checkpointState(d);
    s.t = 0.5;
    expect(approachStatus(s, d).key).toBe("acquired");
  });
});

describe("11. a failed contact says why, with the measured value against the limit", () => {
  test("deflections name every reason; misses, impacts and collisions name their cause", () => {
    const d = "ASTRONAUT";
    const tol = DOCKING[d].tol;
    const c = contactCause({ kind: "deflected", reasons: ["OFF AXIS", "TOO FAST", "ROTATING"], facts: { lateral: 0.31, closing: 0.35, rate: 1.5 * DEG, angle: 0, roll: 0, vLat: 0 } }, null, d);
    expect(c.lines).toEqual(["LATERAL OFFSET 0.31 m > 0.20 m", `IMPACT VELOCITY 0.350 > ${tol.vMax.toFixed(3)} m/s`, "ROTATION 1.5 > 1.0 °/s"]);
    expect(contactCause({ kind: "outside", facts: { lateral: 0.6 } }, null, d).lines[0]).toMatch(/0\.60 m > 0\.42 m/);
    expect(contactCause({ kind: "damage", facts: { closing: 0.7 } }, null, d).title).toBe("EXCESSIVE IMPACT VELOCITY");
    // a real collision: drive the ascent stage's cabin into the CM's cone and ask the physics
    const s = checkpointState(d, { range: 1.0, offset: [1.6, 0], drift: [0, 0], closing: 0.05, att: [0, 0, 0] });
    let e = null;
    for (let n = 0; n < 6000 && !e; n++) e = stepDocking(s, { t: [0, 1, 0], r: [0, 0, 0] }, d, STEP);
    expect(e.kind).toBe("collision");
    const cc = contactCause(e, s, d);
    expect(cc.lines[0]).toMatch(/NON-DOCKING SURFACE/);
    expect(contactCause(e, s, d, "pt").lines[0]).toMatch(/NÃO É A PORTA/);
  });
  test("real deflections from the physics map to their causes", () => {
    const d = "COMMANDER";
    const s = checkpointState(d, { range: 0.3, offset: [0.25, 0], drift: [0, 0], closing: 0.1, att: [0, 0, 0], rate: [0, 0, 0] });
    let e = null;
    for (let n = 0; n < 2000 && !e; n++) e = stepDocking(s, null, d, STEP);
    expect(e.kind).toBe("deflected");
    expect(contactCause(e, s, d).lines[0]).toMatch(/^LATERAL OFFSET 0\.\d\d m > 0\.14 m$/);
  });
});

describe("16. FOCUS DOCKING PORTS frames the two real interfaces, and moves only the camera", () => {
  test("both ports in frame, near the middle, along the whole approach, every size", () => {
    for (const d of DIFFICULTY_KEYS) {
      const r = flyCollect(d, referencePilot(d, { lag: 0 }), { keep: 40 });
      for (const s of r.samples) {
        const o = focusOrbit(s);
        const cam = viewCamera("ORBIT", s, o);
        for (const vp of VIEWPORTS) {
          for (const p of [portState(s).port, PROBE_TIP]) {
            const m = markerPlacement(cam, p, vp);
            expect(m.state).not.toBe("offscreen");
            expect(m.x).toBeGreaterThan(0.08 * vp.w);
            expect(m.x).toBeLessThan(0.92 * vp.w);
            expect(m.y).toBeGreaterThan(0.08 * vp.h);
            expect(m.y).toBeLessThan(0.92 * vp.h);
          }
        }
        // the camera looks at the point between the ports
        expect(dist(cam.target, portsMidpoint(s))).toBeLessThan(1e-9);
      }
    }
  });
  test("it stays freely controllable (drag and pinch keep the focus) and RESET returns to the default", () => {
    const s = checkpointState("ASTRONAUT");
    const o = orbitZoom(orbitDrag(focusOrbit(s), 120, -40), 1.4);
    expect(o.focus).toBe("ports");
    expect(o.az).not.toBe(focusOrbit(s).az);
    expect(viewCamera("ORBIT", s, ORBIT_DEFAULT).target).toEqual(s.pos);
  });
  test("framing never touches the simulation", () => {
    const s = checkpointState("COMMANDER");
    const before = JSON.stringify(s);
    focusOrbit(s);
    viewCamera("ORBIT", s, focusOrbit(s));
    approachStatus(s, "COMMANDER");
    captureReadiness(s, "COMMANDER");
    portFrames(s);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("17. RESTART DOCKING resets the visual guidance", () => {
  test("after a restart the status, readiness and corridor are the checkpoint's again", () => {
    const d = "ASTRONAUT";
    const fresh = checkpointState(d);
    const s = checkpointState(d);
    let prev = null;
    for (let n = 0; n < 3000; n++) {
      stepDocking(s, { t: [1, 1, 0], r: [0, 0, 0] }, d, STEP);
      prev = approachStatus(s, d, prev);
    }
    restoreCheckpoint(s, d);
    const a = approachStatus(s, d, null);
    const b = approachStatus(fresh, d, null);
    expect(a.key).toBe(b.key);
    expect(a.corridor).toBe(b.corridor);
    expect(JSON.stringify(captureReadiness(s, d))).toBe(JSON.stringify(captureReadiness(fresh, d)));
  });
});

/* ---- helpers ---- */
function coast(s, d, maxN = 4000) {
  let e = null;
  for (let n = 0; n < maxN && !e; n++) e = stepDocking(s, null, d, STEP);
  return e;
}
// Fly a pilot at the physics step, recording the readiness and the status just before the first contact.
function flyCollect(d, pilot, { keep = 0 } = {}) {
  const s = checkpointState(d);
  let cmd = { t: [0, 0, 0], r: [0, 0, 0] };
  let next = 0;
  let prev = null;
  let readyBefore = null;
  let statusBefore = null;
  const samples = [];
  const align = DOCKING[d].autoAlign;
  for (let n = 0; n < 120 * 900; n++) {
    if (s.t >= next) {
      cmd = pilot(s);
      next = s.t + PULSE;
      if (cmd.assist === "stabilize" && !s.stab) engageStabilize(s, d); // the pilot pressed MATCH VELOCITY
      if (cmd.assist === "center" && !s.center) engageCenter(s, d); // … AUTO-CENTER
      if (cmd.fine) fineStep(s, d, cmd.fine, {}); // … FWD in FINE APPROACH
    }
    readyBefore = captureReadiness(s, d).ready;
    prev = approachStatus(s, d, prev);
    statusBefore = prev.key;
    if (keep && n % 600 === 0) samples.push(JSON.parse(JSON.stringify(s)));
    const e = stepDocking(s, cmd, d, STEP, { align });
    if (e && e.kind !== "collision") return { event: e, readyBefore, statusBefore, samples };
    if (s.status === "failed") return { event: e, readyBefore, statusBefore, samples };
  }
  return { event: null, readyBefore, statusBefore, samples };
}

describe("the docking physics: RCS, propellant and tolerances are the documented values", () => {
  test("RCS authority, propellant, start states and capture tolerances are the documented values", () => {
    // CADET's soft-capture envelope (assisted docking); ASTRONAUT and COMMANDER as before
    expect(DOCKING.CADET).toMatchObject({ accel: 0.1, prop: 30, attHold: true, autoAlign: true, tol: { lateral: 0.36, vMin: 0.01, vMax: 0.45, vLat: 0.13 } });
    expect(DOCKING.ASTRONAUT).toMatchObject({ accel: 0.08, prop: 18, attHold: true, autoAlign: false, tol: { lateral: 0.2, vMin: 0.025, vMax: 0.3, vLat: 0.07 } });
    expect(DOCKING.COMMANDER).toMatchObject({ accel: 0.07, prop: 12, attHold: false, autoAlign: false, tol: { lateral: 0.14, vMin: 0.03, vMax: 0.22, vLat: 0.05 } });
    expect([DOCKING.CADET.tol.angle, DOCKING.ASTRONAUT.tol.angle, DOCKING.COMMANDER.tol.angle].map((a) => +(a / DEG).toFixed(6))).toEqual([9, 5, 3.5]);
    expect(DROGUE_R).toBeCloseTo(0.4224, 6);
    expect(PORT_B[1]).toBeCloseTo(1.464, 6);
  });
});
