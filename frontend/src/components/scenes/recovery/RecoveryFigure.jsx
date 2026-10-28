import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/*
 * The people of the recovery (OCEAN RECOVERY): simple jointed figures at true human size (about
 * 1.78 m), posed by the director each frame. Two kinds, never an EVA suit:
 *  - "swimmer": a recovery swimmer in a black wetsuit with hood, mask, snorkel and fins;
 *  - "crew": an astronaut in light-blue flight coveralls (no helmet, no backpack), as the crews
 *    came out of the command module, with an orange life vest.
 * Metres; the root is the pelvis. pose: angles (rad) for the trunk, head, shoulders, elbows, hips
 * and knees, set from the director (see POSES and posed()).
 */

const SEG = {
  pelvis: 0.24,
  torso: 0.52,
  neck: 0.08,
  head: 0.115,
  upperArm: 0.3,
  foreArm: 0.29,
  thigh: 0.44,
  shin: 0.43,
  shoulderW: 0.21,
  hipW: 0.1,
};

/** Named poses: { lean (trunk pitch, + forward), twist, head, arms: [[sh, el, side] l, r], legs: [[hip, knee] l, r] }. */
export const POSES = {
  stand: { lean: 0, head: 0, arms: [[0.1, 0.2, 0.12], [0.1, 0.2, 0.12]], legs: [[0, 0], [0, 0]] },
  tread: { lean: 0.15, head: -0.1, arms: [[0.9, 0.7, 0.6], [0.9, 0.7, 0.6]], legs: [[0.4, 0.8], [0.15, 0.4]] },
  swim: { lean: 0.08, head: -1.0, arms: [[2.6, 0.2, 0.15], [0.2, 0.4, 0.15]], legs: [[0.05, 0.25], [-0.05, 0.1]] },
  work: { lean: 0.35, head: -0.25, arms: [[1.35, 0.5, 0.3], [1.2, 0.7, 0.25]], legs: [[0.3, 0.6], [0.2, 0.4]] },
  sit: { lean: -0.05, head: 0.05, arms: [[0.35, 0.9, 0.2], [0.35, 0.9, 0.2]], legs: [[1.45, 1.35], [1.45, 1.45]] },
  emerge: { lean: 0.4, head: -0.15, arms: [[1.25, 0.45, 0.35], [1.25, 0.45, 0.35]], legs: [[1.2, 1.4], [1.2, 1.4]] },
  crouch: { lean: 0.45, head: -0.2, arms: [[0.9, 0.9, 0.25], [0.9, 0.9, 0.25]], legs: [[1.6, 2.0], [1.6, 2.0]] },
  basket: { lean: 0.1, head: 0.1, arms: [[0.6, 1.2, 0.18], [0.6, 1.2, 0.18]], legs: [[1.55, 1.6], [1.55, 1.6]] },
  fall: { lean: -0.1, head: 0.1, arms: [[0.3, 0.2, 0.6], [0.3, 0.2, 0.6]], legs: [[0.1, 0.15], [-0.05, 0.1]] },
};
const lerpPose = (a, b, k) => ({
  lean: a.lean + (b.lean - a.lean) * k,
  head: a.head + (b.head - a.head) * k,
  arms: a.arms.map((x, i) => x.map((v, j) => v + (b.arms[i][j] - v) * k)),
  legs: a.legs.map((x, i) => x.map((v, j) => v + (b.legs[i][j] - v) * k)),
});
/** A pose between two named ones (k 0..1), with a swim stroke or a gentle sculling added. */
export function posed(from, to = from, k = 0, stroke = null, mode = null) {
  const p = lerpPose(POSES[from], POSES[to], k);
  if (stroke != null) {
    if (mode === "swim") {
      // crawl: the arms alternate a full turn, the legs flutter
      p.arms[0][0] = 1.3 + 1.6 * Math.sin(stroke);
      p.arms[1][0] = 1.3 + 1.6 * Math.sin(stroke + Math.PI);
      p.legs[0][0] = 0.12 * Math.sin(stroke * 2);
      p.legs[1][0] = -0.12 * Math.sin(stroke * 2);
    } else {
      // treading water / steadying: a slow scull
      p.arms[0][2] += 0.15 * Math.sin(stroke);
      p.arms[1][2] += 0.15 * Math.sin(stroke + 1.3);
      p.legs[0][0] += 0.18 * Math.sin(stroke * 0.8);
      p.legs[1][0] -= 0.18 * Math.sin(stroke * 0.8);
    }
  }
  return p;
}

const LOOKS = {
  swimmer: { suit: "#15181b", skin: "#c99b7a", trim: "#2b3036", accent: "#f0c419", vest: null },
  crew: { suit: "#93a9bf", skin: "#d1a585", trim: "#55606b", accent: "#e8622c", vest: "#e06a2a" },
};

function useParts(kind) {
  return useMemo(() => {
    const L = LOOKS[kind];
    const m = (c, r = 0.75) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0.02 });
    const mat = {
      suit: m(L.suit, kind === "swimmer" ? 0.45 : 0.85),
      skin: m(L.skin, 0.7),
      trim: m(L.trim, 0.6),
      accent: m(L.accent, 0.6),
      vest: L.vest ? m(L.vest, 0.7) : null,
      glass: new THREE.MeshStandardMaterial({ color: "#1d2b33", roughness: 0.15, metalness: 0.4 }),
    };
    const cap = (r, len) => new THREE.CapsuleGeometry(r, len, 4, 10);
    const geo = {
      pelvis: cap(0.135, 0.08).rotateZ(Math.PI / 2),
      torso: cap(0.165, SEG.torso - 0.24),
      vest: new THREE.CapsuleGeometry(0.19, 0.2, 4, 10),
      head: new THREE.SphereGeometry(SEG.head, 14, 10),
      neck: cap(0.055, 0.04),
      upperArm: cap(0.055, SEG.upperArm - 0.1),
      foreArm: cap(0.047, SEG.foreArm - 0.08),
      hand: new THREE.SphereGeometry(0.05, 8, 6),
      thigh: cap(0.08, SEG.thigh - 0.14),
      shin: cap(0.065, SEG.shin - 0.12),
      foot: new THREE.BoxGeometry(0.09, 0.07, 0.25),
      fin: new THREE.BoxGeometry(0.17, 0.02, 0.5),
      mask: new THREE.BoxGeometry(0.17, 0.07, 0.04),
      snorkel: new THREE.CylinderGeometry(0.013, 0.013, 0.28, 6),
      hair: new THREE.SphereGeometry(SEG.head * 1.03, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    };
    return { mat, geo };
  }, [kind]);
}

/**
 * One figure. stateRef.current: { visible, pos [scene], yaw, pitch (whole body, + face down), pose,
 * scale } (the director writes it; pose from posed()).
 */
export default function RecoveryFigure({ kind = "swimmer", stateRef }) {
  const { mat, geo } = useParts(kind);
  useEffect(
    () => () => {
      Object.values(geo).forEach((x) => x.dispose());
      Object.values(mat).forEach((m) => m && m.dispose());
    },
    [mat, geo]
  );
  const R = useRef({});
  const set = (k) => (el) => (R.current[k] = el);
  useFrame(() => {
    const s = stateRef.current;
    const J = R.current;
    if (!J.root || !s) return;
    J.root.visible = !!s.visible;
    if (!s.visible) return;
    J.root.position.set(s.pos[0], s.pos[1], s.pos[2]);
    J.root.rotation.set(s.pitch || 0, s.yaw || 0, s.roll || 0, "YXZ");
    J.root.scale.setScalar(s.scale || 1);
    const p = s.pose || POSES.stand;
    J.trunk.rotation.x = p.lean;
    J.head.rotation.x = p.head;
    [0, 1].forEach((i) => {
      const side = i === 0 ? -1 : 1;
      const [sh, el, ab] = p.arms[i];
      // shoulder: forward swing (x) and out to the side (z)
      J[`sh${i}`].rotation.set(-sh, 0, side * ab);
      J[`el${i}`].rotation.set(-el, 0, 0);
      const [hip, knee] = p.legs[i];
      J[`hip${i}`].rotation.set(-hip, 0, side * 0.04);
      J[`knee${i}`].rotation.set(knee, 0, 0);
    });
  });
  const swimmer = kind === "swimmer";
  // a limb hangs down its -y from the joint
  const limb = (g, len, m) => <mesh geometry={g} material={m} position={[0, -len / 2, 0]} />;
  return (
    <group ref={set("root")} visible={false}>
      <mesh geometry={geo.pelvis} material={mat.suit} />
      {/* the trunk pivots at the waist */}
      <group ref={set("trunk")} position={[0, 0.08, 0]}>
        <mesh geometry={geo.torso} material={mat.suit} position={[0, SEG.torso / 2, 0]} />
        {mat.vest && <mesh geometry={geo.vest} material={mat.vest} position={[0, SEG.torso * 0.62, 0.02]} scale={[1, 1, 0.82]} />}
        <mesh geometry={geo.neck} material={swimmer ? mat.suit : mat.skin} position={[0, SEG.torso + 0.04, 0]} />
        <group ref={set("head")} position={[0, SEG.torso + SEG.neck + 0.02, 0]}>
          <mesh geometry={geo.head} material={swimmer ? mat.suit : mat.skin} position={[0, SEG.head, 0]} />
          {swimmer ? (
            <>
              {/* the face under the mask, the mask, the snorkel */}
              <mesh geometry={geo.mask} material={mat.glass} position={[0, SEG.head * 1.05, SEG.head * 0.92]} />
              <mesh geometry={geo.snorkel} material={mat.accent} position={[SEG.head * 0.9, SEG.head * 1.5, 0.02]} />
            </>
          ) : (
            <mesh geometry={geo.hair} material={mat.trim} position={[0, SEG.head * 1.05, -0.01]} />
          )}
        </group>
        {[0, 1].map((i) => {
          const side = i === 0 ? -1 : 1;
          return (
            <group key={i} ref={set(`sh${i}`)} position={[side * SEG.shoulderW, SEG.torso - 0.06, 0]}>
              {limb(geo.upperArm, SEG.upperArm, mat.suit)}
              <group ref={set(`el${i}`)} position={[0, -SEG.upperArm, 0]}>
                {limb(geo.foreArm, SEG.foreArm, mat.suit)}
                <mesh geometry={geo.hand} material={swimmer ? mat.suit : mat.skin} position={[0, -SEG.foreArm - 0.03, 0]} />
              </group>
            </group>
          );
        })}
      </group>
      {[0, 1].map((i) => {
        const side = i === 0 ? -1 : 1;
        return (
          <group key={i} ref={set(`hip${i}`)} position={[side * SEG.hipW, -0.04, 0]}>
            {limb(geo.thigh, SEG.thigh, mat.suit)}
            <group ref={set(`knee${i}`)} position={[0, -SEG.thigh, 0]}>
              {limb(geo.shin, SEG.shin, mat.suit)}
              {swimmer ? (
                <mesh geometry={geo.fin} material={mat.trim} position={[0, -SEG.shin - 0.03, 0.17]} />
              ) : (
                <mesh geometry={geo.foot} material={mat.trim} position={[0, -SEG.shin - 0.03, 0.07]} />
              )}
            </group>
          </group>
        );
      })}
    </group>
  );
}
