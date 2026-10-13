import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import CsmModel, { RcsPuffs } from "@/components/spacecraft/CsmModel";
import LanderModel, { plumeMaterial } from "@/components/LanderModel";
import { dockedLmPose, LM_M_PER_UNIT, RCS_THRUSTERS as CSM_RCS, SPS } from "@/data/csmDesign";
import { RCS_THRUSTERS as LM_RCS } from "@/data/lmDesign";
import { PROBE_STOWED, probeSet } from "@/data/payloadDesign";

/**
 * The expedition's spacecraft as one assembly (metres, the CSM's frame:
 * +Y along the stack from the service module's engine to the command
 * module's nose and on to the docked lunar module).
 *
 * The lunar module is the approved landing model (LanderModel) at true size,
 * docked upside down on the command module's probe (data/csmDesign
 * dockedLmPose). Nothing is swapped at undocking: the same two models move
 * apart.
 *
 * `stateRef.current` (optional), read every frame:
 *   { csmY, lmY, lmRoll, csmRcs, lmRollRcs, lmProbe } — see data/undocking.
 *   The LM's contact probes stay folded, as launched, until lmProbe swings them down.
 *   yawRcs (-1..1): the service module's couple that turns the stack about the
 *   CSM's X axis (+: the +Z quad's aft and the -Z quad's forward thrusters).
 *   sps (0..1): the service module's main engine (lunar orbit insertion).
 * `lm` / `csm`: draw either vehicle (false hides it; e.g. the CSM alone after
 * the lunar module has left the scene).
 */
const LM_SCALE = LM_M_PER_UNIT;
const FWD = CSM_RCS.map((t) => t.dir[1] > 0.5); // forward-facing thrusters: exhaust towards the LM, push the CSM back
// The turning couple about the CSM's X axis: quads 0 (+Z) and 2 (-Z), firing fore and aft in opposition.
const YAW_POS = CSM_RCS.map((t) => (t.quad === 0 && t.dir[1] < -0.5) || (t.quad === 2 && t.dir[1] > 0.5));
const YAW_NEG = CSM_RCS.map((t) => (t.quad === 0 && t.dir[1] > 0.5) || (t.quad === 2 && t.dir[1] < -0.5));

/**
 * The SPS engine's plume, from its exit plane down the CSM's -Y: in vacuum a
 * hypergolic engine's exhaust is faint and widens fast (two additive-looking
 * cones, the lunar module's plume shader). `levelRef.current` 0..1.
 */
function SpsPlume({ levelRef }) {
  const G = useMemo(
    () => ({
      outer: new THREE.CylinderGeometry(SPS.exitR * 0.96, 3.6, 1, 32, 1, true).translate(0, -0.5, 0),
      core: new THREE.CylinderGeometry(SPS.exitR * 0.7, 0.1, 1, 24, 1, true).translate(0, -0.5, 0),
    }),
    []
  );
  const outerMat = useMemo(() => plumeMaterial(0.42, "#ffe8d0", "#ff9a66", false), []);
  const coreMat = useMemo(() => plumeMaterial(1.2, "#ffffff", "#ffc48a", true), []);
  const outer = useRef();
  const core = useRef();
  useFrame((state) => {
    const k = (levelRef && levelRef.current) || 0;
    const on = k > 0.02;
    const t = state.clock.elapsedTime;
    if (!outer.current) return;
    outer.current.visible = on;
    core.current.visible = on;
    if (!on) return;
    outer.current.scale.set(0.85 + 0.15 * k, 10 * (0.35 + 0.65 * k) * (1 + 0.04 * Math.sin(t * 47)), 0.85 + 0.15 * k);
    core.current.scale.set(1, 3.4 * (0.35 + 0.65 * k), 1);
    outerMat.uniforms.uThrust.value = k;
    outerMat.uniforms.uTime.value = t;
    coreMat.uniforms.uThrust.value = k;
    coreMat.uniforms.uTime.value = t;
  });
  return (
    <group position={[0, SPS.exit, 0]}>
      <mesh ref={outer} geometry={G.outer} material={outerMat} visible={false} renderOrder={2} />
      <mesh ref={core} geometry={G.core} material={coreMat} visible={false} renderOrder={3} />
    </group>
  );
}

export default function SpacecraftStack({ stateRef = null, lm = true, csm = true, shadows = false }) {
  const csmRef = useRef();
  const lmRef = useRef();
  const lmRollRef = useRef();
  const csmRcs = useRef(CSM_RCS.map(() => 0));
  const lmRcs = useRef(LM_RCS.map(() => 0));
  const docked = useMemo(() => dockedLmPose(0), []);
  const lmFx = useRef({ thrust: 0, comp: [0, 0, 0, 0], probe: probeSet(PROBE_STOWED) });
  const sps = useRef(0);

  useFrame(() => {
    const s = (stateRef && stateRef.current) || null;
    const csmY = s ? s.csmY : 0;
    const lmY = s ? s.lmY : 0;
    if (csmRef.current) csmRef.current.position.y = csmY;
    if (lmRef.current) lmRef.current.position.y = docked.position[1] + lmY;
    if (lmRollRef.current) lmRollRef.current.rotation.y = s ? s.lmRoll : 0;
    const k = s ? s.csmRcs : 0;
    const yaw = (s && s.yawRcs) || 0;
    FWD.forEach((on, i) => (csmRcs.current[i] = Math.max(on ? k : 0, yaw > 0 && YAW_POS[i] ? yaw : yaw < 0 && YAW_NEG[i] ? -yaw : 0)));
    sps.current = (s && s.sps) || 0;
    const b = s && s.lmProbe != null ? s.lmProbe : PROBE_STOWED;
    if (lmFx.current.probe[0] !== b) lmFx.current.probe = probeSet(b);
    const r = s ? s.lmRollRcs : 0;
    LM_RCS.forEach((t, i) => (lmRcs.current[i] = t.roll && Math.sign(t.roll) === Math.sign(r) ? Math.abs(r) : 0));
  });

  return (
    <group name="stack">
      {csm && (
        <group ref={csmRef}>
          <CsmModel rcsRef={csmRcs} castShadow={shadows} receiveShadow={shadows} />
          <SpsPlume levelRef={sps} />
        </group>
      )}
      {lm && (
        <group ref={lmRef} position={[0, docked.position[1], 0]}>
          {/* Roll about the drogue's axis (the stack axis), then the docked attitude. */}
          <group ref={lmRollRef}>
            <group position={[0, 0, docked.position[2]]} rotation={docked.rotation} scale={LM_SCALE}>
              <LanderModel fx={lmFx.current} />
              <RcsPuffs thrusters={LM_RCS} levelsRef={lmRcs} length={0.3} />
            </group>
          </group>
        </group>
      )}
    </group>
  );
}
