import * as THREE from "three";
import { ADAPTER, CSM_MATED, DOCK, LM_HEIGHTS, LM_MOUNT, LM_STOWED, PROBE_STOWED, SPS_EXIT_MATED, UPPER_STAGE, adapterRadius, spsRadius, toRocketUnits } from "./payloadDesign";
import { CM_R, DOCK_Y, HGA, PROBE_L, SM_BOTTOM, buildHGA, hgaRotation } from "./csmDesign";
import { GROUND, PAD_H, PAD_SIZE, PROBE_L as LM_PROBE_L, buildBody, legFrames } from "./lmDesign";

const M = LM_STOWED.scale;
/** A point of the LM (its own model units) in the payload frame (m). */
const lmPoint = (p) => [p.x * M, LM_STOWED.y + p.y * M, p.z * M + LM_STOWED.z];

/** Every point of the stowed lunar module: body, legs, footpads (rims), folded probes. */
function stowedLmPoints() {
  const out = [];
  Object.values(buildBody()).forEach((g) => {
    const a = g.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) out.push(lmPoint(new THREE.Vector3(a[i], a[i + 1], a[i + 2])));
  });
  legFrames().forEach((L) => {
    [L.upper, L.padTop, ...L.sec, ...L.lock, L.lockAt].forEach((p) => out.push(lmPoint(p)));
    // Footpad rim: PAD_SIZE round the pad centre, at the pad's bottom
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      out.push(lmPoint(new THREE.Vector3(L.padTop.x + Math.cos(a) * PAD_SIZE, L.padTop.y - PAD_H, L.padTop.z + Math.sin(a) * PAD_SIZE)));
    }
    if (L.probe) {
      // LanderModel: from under the pad, along (dir sin b, -cos b), PROBE_L long
      const b = PROBE_STOWED;
      const root = new THREE.Vector3(L.padTop.x, L.padTop.y - PAD_H, L.padTop.z);
      for (let k = 0; k <= 8; k++) {
        const s = (k / 8) * LM_PROBE_L;
        out.push(lmPoint(root.clone().add(new THREE.Vector3(L.dir.x * Math.sin(b) * s, -Math.cos(b) * s, L.dir.z * Math.sin(b) * s))));
      }
    }
  });
  return out;
}

/** The CSM's folded (or deployed) high-gain antenna in the payload frame at launch. */
function hgaPoints(deploy) {
  const q = new THREE.Quaternion(...hgaRotation(deploy));
  const root = new THREE.Vector3(...HGA.root);
  const out = [];
  Object.values(buildHGA()).forEach((g) => {
    const a = g.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) {
      const v = new THREE.Vector3(a[i], a[i + 1], a[i + 2]).applyQuaternion(q).add(root);
      out.push([v.x, CSM_MATED.y + v.y, v.z, v.y]); // payload frame + the CSM-frame height
    }
  });
  return out;
}

describe("LV-001's payload: the spacecraft that fly to the Moon are inside the rocket", () => {
  test("the adapter joins the upper stage to the service module", () => {
    expect(ADAPTER.R0).toBeCloseTo(UPPER_STAGE.R, 9);
    expect(ADAPTER.R1 - CM_R).toBeGreaterThan(0);
    expect(ADAPTER.R1 - CM_R).toBeLessThan(0.06);
    // The CSM sits on it: its service module's base on the adapter's top
    expect(CSM_MATED.y + SM_BOTTOM).toBeCloseTo(ADAPTER.H, 9);
    // RocketModel's stations (model units, 1 = 18 m) follow from the same numbers
    expect(toRocketUnits([0, 0, 0])[1]).toBeCloseTo(4.22, 9);
    expect(toRocketUnits([0, ADAPTER.H, 0])[1]).toBeCloseTo(4.84, 6);
  });

  test("the lunar module fits inside the adapter, clear of its wall, standing on its mounts", () => {
    const pts = stowedLmPoints();
    let wall = Infinity;
    let low = Infinity;
    let high = -Infinity;
    pts.forEach(([x, y, z]) => {
      wall = Math.min(wall, adapterRadius(y) - Math.hypot(x, z));
      low = Math.min(low, y);
      high = Math.max(high, y);
    });
    expect(wall).toBeGreaterThan(0.15);
    expect(low).toBeGreaterThanOrEqual(LM_MOUNT.h - 0.01); // the footpads rest on the mounts, nothing below
    expect(high).toBeLessThan(SPS_EXIT_MATED - 0.5); // below the CSM's engine bell
    expect(high).toBeLessThanOrEqual(LM_HEIGHTS.top + 1e-6); // TOP: the highest point the LM is allowed
  });

  test("its drogue is on the vehicle's axis, facing up at the CSM's engine", () => {
    // LM_DROGUE in LM units (0, 0.905, -0.03): moved into the payload frame
    const d = lmPoint(new THREE.Vector3(0, 0.905, -0.03));
    expect(d[0]).toBeCloseTo(0, 9);
    expect(d[2]).toBeCloseTo(0, 9);
    expect(d[1]).toBeCloseTo(LM_HEIGHTS.drogue, 9);
    expect(SPS_EXIT_MATED - LM_HEIGHTS.drogue).toBeGreaterThan(1.0);
  });

  test("with its probes hanging the lunar module would not fit: they are folded for launch", () => {
    // Hanging probes reach 1.7 m below the footpads, into the upper stage
    expect(LM_HEIGHTS.pads - LM_PROBE_L * M).toBeLessThan(0);
    expect(PROBE_STOWED).toBeGreaterThan(Math.PI); // folded up along the leg
  });

  test("the CSM's engine bell and its folded high-gain antenna fit in the adapter, above the lunar module", () => {
    const folded = hgaPoints(0);
    let wall = Infinity;
    let bell = Infinity;
    let low = Infinity;
    folded.forEach(([x, y, z, yc]) => {
      const r = Math.hypot(x, z);
      if (y <= ADAPTER.H) wall = Math.min(wall, adapterRadius(y) - r);
      const nr = spsRadius(yc);
      if (nr) bell = Math.min(bell, r - nr);
      low = Math.min(low, y);
    });
    expect(wall).toBeGreaterThan(0.05);
    expect(bell).toBeGreaterThan(0.03);
    expect(low).toBeGreaterThan(LM_HEIGHTS.top + 0.5);
    // The bell itself: inside the adapter
    expect(adapterRadius(SPS_EXIT_MATED)).toBeGreaterThan(1.12 + 0.5);
  });

  test("deployed, the antenna would pierce the adapter: it is only swung out after extraction", () => {
    const deployed = hgaPoints(1);
    const worst = Math.min(...deployed.filter(([, y]) => y <= ADAPTER.H).map(([x, y, z]) => adapterRadius(y) - Math.hypot(x, z)));
    expect(worst).toBeLessThan(-1);
  });

  test("docking geometry: the probe meets the drogue, then the rings meet", () => {
    expect(DOCK.contactY - DOCK.hardY).toBeCloseTo(PROBE_L, 9);
    expect(DOCK.hardY - DOCK_Y).toBeCloseTo(LM_HEIGHTS.drogue, 9);
  });

  test("the footpads clear the adapter ring as the lunar module rises out", () => {
    expect(adapterRadius(ADAPTER.ring) - LM_HEIGHTS.padOuter).toBeGreaterThan(0.15);
    expect(LM_HEIGHTS.pads).toBeCloseTo(LM_MOUNT.h, 9);
    expect(GROUND).toBeLessThan(0);
  });
});
