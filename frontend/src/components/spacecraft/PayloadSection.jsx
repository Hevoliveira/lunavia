import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import CsmModel from "@/components/spacecraft/CsmModel";
import LanderModel from "@/components/LanderModel";
import { RCS_QUADS, RCS_THRUSTERS } from "@/data/csmDesign";
import { ADAPTER, LM_MOUNT, LM_STOWED, PROBE_STOWED, adapterRadius, probeSet } from "@/data/payloadDesign";
import { transposition } from "@/data/transposition";

/**
 * LV-001's payload section, in metres (data/payloadDesign's frame: origin on
 * the axis at the upper stage's forward bulkhead, +Y up the vehicle).
 * RocketModel draws it at 1/18 scale on top of its upper stage.
 *
 * - the spacecraft adapter: a fixed ring on the stage and four panels hinged to
 *   it, centred on the lunar module's legs;
 * - the lunar module (LanderModel, the approved model) upright inside, legs out,
 *   contact probes folded, on four mounts;
 * - the command and service module (CsmModel) on top, its high-gain antenna
 *   folded beside the engine bell.
 *
 * `ctrlRef.current` is read every frame:
 *   td: data/transposition state (separation, transposition, docking, extraction)
 *   ghost: 0..1 — the adapter turns translucent to show the lunar module inside
 *          (the pad's payload shot)
 * Until the adapter opens (or is seen through) it is drawn closed, as one
 * frustum and its orange band, and nothing inside it is drawn: the launch costs
 * what it did before (two draw calls for the adapter).
 */
const MATED = transposition(-1);
const PANEL_SPAN = Math.PI / 2;
const RING_COLOR = new THREE.Color("#FF3B00");

function panelGeometry(phi) {
  // three's cylinder angle θ points along (sin θ, 0, cos θ); the panel is centred on (cos φ, 0, sin φ).
  const h = ADAPTER.H - ADAPTER.ring;
  const g = new THREE.CylinderGeometry(ADAPTER.R1, adapterRadius(ADAPTER.ring), h, 14, 1, true, Math.PI / 2 - phi - PANEL_SPAN / 2, PANEL_SPAN);
  // Built about the hinge: origin on the panel's lower edge, at its centre.
  const r0 = adapterRadius(ADAPTER.ring);
  g.translate(-r0 * Math.cos(phi), h / 2, -r0 * Math.sin(phi));
  return g;
}
function bandGeometry(phi) {
  // LUNAVIA's orange band round the adapter's top, on each panel.
  const h = 0.29;
  const y0 = ADAPTER.H - h - ADAPTER.ring;
  const rb = adapterRadius(ADAPTER.H - h) + 0.02;
  const g = new THREE.CylinderGeometry(ADAPTER.R1 + 0.02, rb, h, 14, 1, true, Math.PI / 2 - phi - PANEL_SPAN / 2, PANEL_SPAN);
  const r0 = adapterRadius(ADAPTER.ring);
  g.translate(-r0 * Math.cos(phi), y0 + h / 2, -r0 * Math.sin(phi));
  return g;
}

let GEO = null;
function geometry() {
  if (GEO) return GEO;
  const panels = ADAPTER.panels.map((deg) => {
    const phi = (deg * Math.PI) / 180;
    const body = panelGeometry(phi);
    return { phi, body, band: bandGeometry(phi), edges: new THREE.EdgesGeometry(panelGeometry(phi), 30) };
  });
  const ring = new THREE.CylinderGeometry(adapterRadius(ADAPTER.ring), ADAPTER.R0, ADAPTER.ring, 40, 1, true).translate(0, ADAPTER.ring / 2, 0);
  const ringEdges = new THREE.EdgesGeometry(new THREE.CylinderGeometry(adapterRadius(ADAPTER.ring), ADAPTER.R0, ADAPTER.ring, 24, 1, true).translate(0, ADAPTER.ring / 2, 0), 30);
  // Four mounts under the LM's footpads: a post and two braces each, on the bulkhead.
  const mounts = [];
  ADAPTER.panels.forEach((deg) => {
    const a = (deg * Math.PI) / 180;
    const x = Math.cos(a) * LM_MOUNT.r;
    const z = Math.sin(a) * LM_MOUNT.r;
    mounts.push(new THREE.CylinderGeometry(0.16, 0.24, LM_MOUNT.h, 10).translate(x, LM_MOUNT.h / 2, z));
    mounts.push(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 14).translate(x, LM_MOUNT.h - 0.02, z));
  });
  // The adapter closed: one frustum and the band round its top.
  const bandH = 0.29;
  const closed = new THREE.CylinderGeometry(ADAPTER.R1, ADAPTER.R0, ADAPTER.H, 40, 1, true).translate(0, ADAPTER.H / 2, 0);
  const closedBand = new THREE.CylinderGeometry(ADAPTER.R1 + 0.02, adapterRadius(ADAPTER.H - bandH) + 0.02, bandH, 40, 1, true).translate(0, ADAPTER.H - bandH / 2, 0);
  GEO = { panels, ring, ringEdges, closed, closedBand, mounts: mergeGeometries(mounts.map((g) => g.toNonIndexed()), false) };
  return GEO;
}
// Which CSM thrusters each RCS command fires (exhaust direction, CSM frame).
const QUAD_X = RCS_QUADS.map((a) => Math.sin(a));
const THR = RCS_THRUSTERS.map((t) => ({ fwd: t.dir[1] > 0.5, aft: t.dir[1] < -0.5, side: QUAD_X[t.quad] > 0.5 ? 1 : QUAD_X[t.quad] < -0.5 ? -1 : 0 }));

export default function PayloadSection({ ctrlRef, materials }) {
  const G = geometry();
  // Open (or seen through) the adapter is double-sided and can fade; one pass each (forceSinglePass).
  const panelMat = useMemo(() => {
    const m = materials.panel.clone();
    m.side = THREE.DoubleSide;
    m.transparent = true;
    m.forceSinglePass = true;
    return m;
  }, [materials]);
  const bandMat = useMemo(() => {
    const m = materials.band.clone();
    m.side = THREE.DoubleSide;
    m.transparent = true;
    m.forceSinglePass = true;
    return m;
  }, [materials]);
  const openRef = useRef();
  const closedRef = useRef();
  const gl = useThree((st) => st.gl);
  const scene = useThree((st) => st.scene);
  const camera = useThree((st) => st.camera);
  useEffect(() => {
    // Compile the open adapter's and the LM's shaders now, not when the adapter first opens.
    const o = openRef.current;
    if (!o) return;
    const hidden = [];
    o.traverse((n) => {
      if (!n.visible) {
        hidden.push(n);
        n.visible = true;
      }
    });
    try {
      gl.compile(scene, camera);
    } catch {
      // compiled on first draw instead
    }
    hidden.forEach((n) => (n.visible = false));
  }, [gl, scene, camera]);
  const edgeMat = useMemo(() => new THREE.LineBasicMaterial({ color: RING_COLOR, transparent: true, opacity: 0, depthWrite: false }), []);
  const panelRefs = useRef([]);
  const edgeRefs = useRef([]);
  const ringEdgeRef = useRef();
  const csmRef = useRef();
  const lmRef = useRef();
  const rcs = useRef(RCS_THRUSTERS.map(() => 0));
  const hga = useRef(0);
  const lmFx = useRef({ thrust: 0, comp: [0, 0, 0, 0], probe: probeSet(PROBE_STOWED) });

  useFrame(() => {
    const c = (ctrlRef && ctrlRef.current) || {};
    const s = c.td || MATED;
    const ghost = c.ghost || 0;
    const open = ghost > 0.01 || s.phase !== "mated";
    if (openRef.current) openRef.current.visible = open;
    if (closedRef.current) closedRef.current.visible = !open;
    // Adapter: the panels open on their hinges, then drift off; seen through on the pad.
    const p = s.panels;
    G.panels.forEach((P, i) => {
      const g = panelRefs.current[i];
      if (!g) return;
      const r0 = adapterRadius(ADAPTER.ring);
      const out = r0 + p.out;
      g.position.set(Math.cos(P.phi) * out, ADAPTER.ring + p.up, Math.sin(P.phi) * out);
      // Outward about the hinge (the tangent): a negative turn about (-sin φ, 0, cos φ).
      g.quaternion.setFromAxisAngle(new THREE.Vector3(-Math.sin(P.phi), 0, Math.cos(P.phi)), -p.angle);
      g.visible = p.out < 400;
      const e = edgeRefs.current[i];
      if (e) e.visible = ghost > 0.01;
    });
    const op = 1 - 0.84 * ghost;
    panelMat.opacity = op;
    bandMat.opacity = op;
    panelMat.depthWrite = op > 0.95;
    bandMat.depthWrite = op > 0.95;
    edgeMat.opacity = 0.85 * ghost;
    if (ringEdgeRef.current) ringEdgeRef.current.visible = ghost > 0.01;

    // The CSM: out of the adapter, round, and back in to dock; then with the LM.
    if (csmRef.current) {
      csmRef.current.position.set(s.csm.pos[0], s.csm.pos[1], s.csm.pos[2]);
      csmRef.current.rotation.set(0, 0, s.csm.pitch);
    }
    hga.current = s.hga;
    const r = s.rcs;
    THR.forEach((t, i) => {
      let k = t.fwd ? r.fwd : t.aft ? r.aft : 0;
      // Turning couple: the +X quad's aft thruster with the -X quad's forward one (and the reverse).
      if (t.side === 1) k = Math.max(k, t.aft ? r.pitchPos : t.fwd ? r.pitchNeg : 0);
      if (t.side === -1) k = Math.max(k, t.fwd ? r.pitchPos : t.aft ? r.pitchNeg : 0);
      rcs.current[i] = k;
    });
    // The LM: inside until the adapter opens (or is seen through), then out with the CSM.
    if (lmRef.current) lmRef.current.position.set(s.lm.pos[0], s.lm.pos[1], s.lm.pos[2]);
  });

  return (
    <group name="payload">
      {/* Closed: the adapter as one frustum and its band */}
      <group ref={closedRef}>
        <mesh geometry={G.closed} material={materials.panel} />
        <mesh geometry={G.closedBand} material={materials.band} />
      </group>
      <group ref={openRef} visible={false}>
        {/* Fixed ring (stays on the upper stage) and the LM's mounts */}
        <mesh geometry={G.ring} material={panelMat} />
        <lineSegments ref={ringEdgeRef} geometry={G.ringEdges} material={edgeMat} visible={false} />
        <mesh geometry={G.mounts} material={materials.hardware} />
        {/* Four panels, hinged at the ring */}
        {G.panels.map((P, i) => (
          <group key={i} ref={(el) => (panelRefs.current[i] = el)}>
            <mesh geometry={P.body} material={panelMat} />
            <mesh geometry={P.band} material={bandMat} />
            <lineSegments ref={(el) => (edgeRefs.current[i] = el)} geometry={P.edges} material={edgeMat} visible={false} />
          </group>
        ))}
        {/* The lunar module, upright on its mounts, drogue on the axis */}
        <group ref={lmRef} position={[0, LM_STOWED.y, LM_STOWED.z]}>
          <group scale={LM_STOWED.scale}>
            <LanderModel fx={lmFx.current} />
          </group>
        </group>
      </group>
      {/* The command and service module */}
      <group ref={csmRef} position={MATED.csm.pos}>
        <CsmModel rcsRef={rcs} hgaRef={hga} />
      </group>
    </group>
  );
}
