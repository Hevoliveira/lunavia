import * as THREE from "three";
import { TD, csmY, csmPitch, extractionClearance, extractionOffset, hgaDeploy, lmY, panelState, phaseAt, transposition } from "./transposition";
import { ADAPTER, CSM_MATED, DOCK, LM_HEIGHTS, LM_STOWED, SPS_EXIT_MATED } from "./payloadDesign";
import { CM_R, DOCK_Y, PROBE_L, SM_BOTTOM, SPS, dockedLmPose } from "./csmDesign";

const DEG = Math.PI / 180;
const steps = (a, b, dt = 0.02) => {
  const out = [];
  for (let t = a; t <= b + 1e-9; t += dt) out.push(t);
  return out;
};
const mat = (pos, rotZ, scale = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rotZ)), new THREE.Vector3(scale, scale, scale));
/** The LM's pose relative to the CSM (CSM frame) at tau. */
function lmInCsm(t) {
  const s = transposition(t);
  const csm = mat(s.csm.pos, s.csm.pitch);
  const lm = mat(s.lm.pos, 0, LM_STOWED.scale);
  return new THREE.Matrix4().copy(csm).invert().multiply(lm);
}

describe("transposition, docking and extraction", () => {
  test("before the sequence everything is as launched: CSM on the adapter, LM inside, panels closed", () => {
    const s = transposition(-1);
    expect(s.phase).toBe("mated");
    expect(s.csm.pos[1]).toBeCloseTo(CSM_MATED.y, 9);
    expect(s.csm.pitch).toBe(0);
    expect(s.lm.pos[1]).toBe(LM_STOWED.y);
    expect(s.lm.attached).toBe("adapter");
    expect(s.panels.angle).toBe(0);
    expect(s.hga).toBe(0);
  });

  test("the steps come in Apollo's order", () => {
    const seen = [];
    steps(-1, TD.end + 2, 0.05).forEach((t) => {
      const p = phaseAt(t);
      if (seen[seen.length - 1] !== p) seen.push(p);
    });
    expect(seen).toEqual(["mated", "separation", "transposition", "approach", "capture", "docked", "extraction", "coast"]);
  });

  test("no jumps and no jolts: positions, speeds and turn rate are continuous and modest", () => {
    let prev = null;
    steps(-1, TD.end, 0.01).forEach((t) => {
      const y = csmY(t);
      const th = csmPitch(t);
      if (prev) {
        const v = (y - prev.y) / 0.01;
        const w = (th - prev.th) / 0.01;
        expect(Math.abs(v)).toBeLessThan(1.6); // m/s: RCS speeds
        expect(Math.abs(w)).toBeLessThan(25 * DEG); // under 25°/s
        if (prev.v != null && Math.abs(t - TD.retract.t0) > 0.02) expect(Math.abs(v - prev.v)).toBeLessThan(0.01); // no step in speed
        prev = { y, th, v };
      } else prev = { y, th, v: null };
    });
  });

  test("the CSM backs out of the adapter before it turns, and turns well clear of the lunar module", () => {
    // Its engine is out of the adapter by the time the turn starts
    expect(csmY(TD.pitch.t0) + SPS.exit).toBeGreaterThan(ADAPTER.H + 1);
    expect(csmY(0) + SPS.exit).toBeCloseTo(SPS_EXIT_MATED, 6);
    // Every extreme point of the CSM, through the turn, stays above the LM
    const pts = [
      [0, SPS.exit], [SPS.exitR, SPS.exit], [-SPS.exitR, SPS.exit],
      [CM_R, SM_BOTTOM], [-CM_R, SM_BOTTOM], [CM_R, 0.23], [-CM_R, 0.23],
      [0, DOCK_Y + PROBE_L],
    ];
    steps(0, TD.approach.t0, 0.05).forEach((t) => {
      const th = csmPitch(t);
      const y0 = csmY(t);
      pts.forEach(([x, y]) => {
        const wy = y0 + x * Math.sin(th) + y * Math.cos(th);
        // 0.8 m between the LM's antennas and the engine as launched; at least 1 m once it turns
        expect(wy).toBeGreaterThan(LM_HEIGHTS.top + (t < TD.pitch.t0 ? 0.75 : 1.0));
      });
    });
    expect(csmPitch(TD.pitch.t1)).toBeCloseTo(Math.PI, 9);
  });

  test("the probe meets the drogue on the axis, then the rings meet: the docked pose is the stack's", () => {
    // Contact: the probe's tip (CSM turned round) at the LM's drogue, closing slowly
    const tip = csmY(TD.approach.t1) - (DOCK_Y + PROBE_L);
    expect(tip).toBeCloseTo(LM_HEIGHTS.drogue, 9);
    expect(Math.abs(csmY(TD.approach.t1 - 0.05) - csmY(TD.approach.t1)) / 0.05).toBeLessThan(0.05);
    // Hard dock: the LM relative to the CSM is exactly the pose the stack flies with (csmDesign dockedLmPose)
    const rel = lmInCsm(TD.retract.t1);
    const want = dockedLmPose(0);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    rel.decompose(p, q, sc);
    expect(p.x).toBeCloseTo(want.position[0], 6);
    expect(p.y).toBeCloseTo(want.position[1], 6);
    expect(p.z).toBeCloseTo(want.position[2], 6);
    const wq = new THREE.Quaternion().setFromEuler(new THREE.Euler(...want.rotation));
    expect(Math.abs(q.dot(wq))).toBeCloseTo(1, 6);
    expect(sc.x).toBeCloseTo(want.scale, 6);
  });

  test("docked, the two move as one: the relative pose never changes again", () => {
    const ref = lmInCsm(TD.retract.t1).elements;
    steps(TD.retract.t1, TD.end + 5, 0.25).forEach((t) => {
      lmInCsm(t).elements.forEach((v, i) => expect(v).toBeCloseTo(ref[i], 6));
      expect(transposition(t).docked).toBe(true);
    });
  });

  test("the lunar module stays on its mounts until extraction, then rises out of the adapter ring without touching it", () => {
    steps(-1, TD.extract.t0 - 0.01, 0.25).forEach((t) => expect(lmY(t)).toBe(LM_STOWED.y));
    let prev = -Infinity;
    steps(TD.extract.t0, TD.end, 0.05).forEach((t) => {
      const padY = LM_HEIGHTS.pads + extractionOffset(t);
      if (padY < ADAPTER.ring) expect(extractionClearance(LM_HEIGHTS.padOuter, padY)).toBeGreaterThan(0.15);
      expect(lmY(t)).toBeGreaterThanOrEqual(prev);
      prev = lmY(t);
    });
    // Out of the ring by the end of the extraction shot, with room to spare
    expect(LM_HEIGHTS.pads + extractionOffset(TD.end)).toBeGreaterThan(ADAPTER.ring + 3);
  });

  test("the carrier is left behind: the gap only grows, at the real 0.9 m/s after the sequence (faster only if time-compressed)", () => {
    let prev = 0;
    steps(TD.extract.t0, TD.end + 6, 0.1).forEach((t) => {
      const e = extractionOffset(t);
      expect(e).toBeGreaterThanOrEqual(prev);
      prev = e;
    });
    expect(extractionOffset(TD.end + 6) - extractionOffset(TD.end)).toBeCloseTo(TD.extract.v * 6, 9);
    expect(extractionOffset(TD.end + 6, 40) - extractionOffset(TD.end, 40)).toBeGreaterThan(150);
  });

  test("the adapter panels swing open, are jettisoned and drift away; they never close again", () => {
    expect(panelState(0).angle).toBe(0);
    expect(panelState(TD.panels.open[1]).angle).toBeCloseTo((ADAPTER.openDeg * Math.PI) / 180, 9);
    let prev = panelState(0);
    steps(0, TD.end, 0.05).forEach((t) => {
      const p = panelState(t);
      expect(p.angle).toBeGreaterThanOrEqual(prev.angle - 1e-12);
      expect(p.out).toBeGreaterThanOrEqual(prev.out);
      prev = p;
    });
    expect(panelState(TD.panels.release - 0.01).attached).toBe(true);
    expect(panelState(TD.panels.release + 0.01).attached).toBe(false);
    expect(panelState(TD.pitch.t0).angle).toBeGreaterThan(40 * DEG); // open before the CSM turns
  });

  test("RCS: thrusters fire while the CSM speeds up, slows down or turns, and only then", () => {
    let fired = 0;
    steps(0, TD.end, 0.05).forEach((t) => {
      const s = transposition(t);
      const any = s.rcs.aft + s.rcs.fwd + s.rcs.pitchPos + s.rcs.pitchNeg;
      if (any > 0) fired++;
      // a hold with nothing changing: nothing fires
      if (t > TD.retract.t1 + 0.1 && t < TD.extract.t0 - 0.1) expect(any).toBe(0);
    });
    expect(fired).toBeGreaterThan(50);
    // The turn starts and stops on opposite couples
    expect(transposition(TD.pitch.t0 + 1).rcs.pitchPos).toBeGreaterThan(0);
    expect(transposition(TD.pitch.t1 - 1).rcs.pitchNeg).toBeGreaterThan(0);
    // Backing out of the adapter: thrust towards the nose
    expect(transposition(TD.out.t0 + 0.5).rcs.aft).toBeGreaterThan(0);
  });

  test("the high-gain antenna stays folded until the lunar module is out, then swings out", () => {
    expect(hgaDeploy(TD.extract.t0)).toBe(0);
    expect(hgaDeploy(TD.end)).toBe(1);
  });
});
