import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import CsmModel, { RcsPuffs } from "@/components/spacecraft/CsmModel";
import LanderModel from "@/components/LanderModel";
import { dockedLmPose, LM_M_PER_UNIT, RCS_THRUSTERS as CSM_RCS } from "@/data/csmDesign";
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
 * `lm` / `csm`: draw either vehicle (false hides it; e.g. the CSM alone after
 * the lunar module has left the scene).
 */
const LM_SCALE = LM_M_PER_UNIT;
const FWD = CSM_RCS.map((t) => t.dir[1] > 0.5); // forward-facing thrusters: exhaust towards the LM, push the CSM back

export default function SpacecraftStack({ stateRef = null, lm = true, csm = true, shadows = false }) {
  const csmRef = useRef();
  const lmRef = useRef();
  const lmRollRef = useRef();
  const csmRcs = useRef(CSM_RCS.map(() => 0));
  const lmRcs = useRef(LM_RCS.map(() => 0));
  const docked = useMemo(() => dockedLmPose(0), []);
  const lmFx = useRef({ thrust: 0, comp: [0, 0, 0, 0], probe: probeSet(PROBE_STOWED) });

  useFrame(() => {
    const s = (stateRef && stateRef.current) || null;
    const csmY = s ? s.csmY : 0;
    const lmY = s ? s.lmY : 0;
    if (csmRef.current) csmRef.current.position.y = csmY;
    if (lmRef.current) lmRef.current.position.y = docked.position[1] + lmY;
    if (lmRollRef.current) lmRollRef.current.rotation.y = s ? s.lmRoll : 0;
    const k = s ? s.csmRcs : 0;
    FWD.forEach((on, i) => (csmRcs.current[i] = on ? k : 0));
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
