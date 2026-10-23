import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { soleLow, toWorld } from "@/data/astronautRig";
import { softDiscTexture } from "./evaTextures";

const rng = (seed) => {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
};

/**
 * The astronaut's grounding (metres, inside the EVA's 0.5-units-per-metre group): soft contact
 * shadows under each boot, darkest when the boot is down and fading as it lifts, and a wide faint
 * one under the body. The low Sun throws the real shadow metres away, so without these the
 * astronaut seems to hover; three small transparent quads, no extra shadow pass.
 */
const smooth = (x) => {
  const u = Math.max(0, Math.min(1, x));
  return u * u * (3 - 2 * u);
};
const _q = new THREE.Quaternion();
const _n = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _yaw = new THREE.Quaternion();

/** The ground's normal at (x, z) from three height samples (m). */
function groundNormal(ground, x, z, out) {
  const h = 0.25;
  const y0 = ground(x, z);
  const yx = ground(x + h, z);
  const yz = ground(x, z + h);
  return out.set(-(yx - y0) / h, 1, -(yz - y0) / h).normalize();
}

export function ContactShadows({ sim }) {
  const refs = [useRef(), useRef(), useRef()];
  const parts = useMemo(() => {
    const tex = softDiscTexture();
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mk = () => new THREE.MeshBasicMaterial({ map: tex, color: "#000000", transparent: true, opacity: 0, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    return { geo, mats: [mk(), mk(), mk()] };
  }, []);

  useFrame(() => {
    const a = sim.astro;
    const show = !!(a && a.rig && !a.hidden);
    refs.forEach((r) => r.current && (r.current.visible = show));
    if (!show) return;
    const ground = sim.world.ground;
    const rig = a.rig;
    // the boots: [x, z] ahead of the ankle by the sole's middle; how high the sole is off the ground
    ["L", "R"].forEach((s, i) => {
      const m = refs[i].current;
      if (!m) return;
      const ank = rig.joints[`ankle${s}`];
      const foot = rig[`foot${s}`];
      const [x, , z] = toWorld(a.pos, a.heading, [ank.x, 0, ank.z + 0.07]);
      const gy = ground(x, z);
      const h = Math.max(0, a.pos[1] + soleLow(foot) - gy);
      const k = 1 - smooth(h / 0.3);
      m.material.opacity = 0.62 * k;
      m.position.set(x, gy + 0.012, z);
      _yaw.setFromAxisAngle(_up, a.heading + (s === "L" ? 0.06 : -0.06));
      _q.setFromUnitVectors(_up, groundNormal(ground, x, z, _n));
      m.quaternion.copy(_q).multiply(_yaw);
      const sz = 1 + h * 1.6;
      m.scale.set(0.26 * sz, 1, 0.44 * sz);
    });
    // the body
    const m = refs[2].current;
    if (m) {
      const pel = rig.pelvis.p;
      const [x, , z] = toWorld(a.pos, a.heading, [pel.x, 0, pel.z - 0.04]);
      const gy = ground(x, z);
      const lift = Math.max(0, a.pos[1] - gy);
      m.material.opacity = 0.3 * (1 - smooth(lift / 0.8));
      m.position.set(x, gy + 0.01, z);
      _yaw.setFromAxisAngle(_up, a.heading);
      _q.setFromUnitVectors(_up, groundNormal(ground, x, z, _n));
      m.quaternion.copy(_q).multiply(_yaw);
      m.scale.set(0.9, 1, 0.95);
    }
  });

  return (
    <>
      {parts.mats.map((mat, i) => (
        <mesh key={i} ref={refs[i]} geometry={parts.geo} material={mat} renderOrder={3} frustumCulled={false} />
      ))}
    </>
  );
}

/**
 * Pebbles and small stones on the ground a walking astronaut sees (metres): ~900 of them from the
 * LM's footpads out to ~26 m, densest in the first metres round the LM and the ladder, 4–26 cm
 * across, half buried, each its own tone. One instanced draw, no shadow pass of their own (they
 * receive the LM's and the astronaut's shadows). Kept off the footpads, the ladder's foot and the
 * sample stone. The swept ground right round the descent engine holds fewer.
 */
export function NearPebbles({ sim, color = "#8f877b", count = 900 }) {
  const mesh = useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const p = geo.attributes.position;
    const r = rng(4447);
    const seen = new Map();
    for (let i = 0; i < p.count; i++) {
      const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      if (!seen.has(key)) seen.set(key, 0.7 + 0.45 * r());
      const k = seen.get(key);
      p.setXYZ(i, p.getX(i) * k, Math.max(-0.35, p.getY(i)) * k * 0.62, p.getZ(i) * k);
    }
    geo.computeVertexNormals();
    // the faces away from the low Sun still get light bounced off the bright regolith round them
    const mat = new THREE.MeshLambertMaterial({ color: "#ffffff", flatShading: true, emissive: "#24211d" });
    const m = new THREE.InstancedMesh(geo, mat, count);
    const w = sim.world;
    const lm = sim.lm;
    const [ax, az] = lm.axis;
    const keep = [{ x: lm.pad[0], z: lm.pad[2], r: lm.padR + 0.3 }, { x: lm.board[0], z: lm.board[2], r: 0.5 }, { x: w.sample.x, z: w.sample.z, r: 0.7 }];
    const base = new THREE.Color(color);
    const M = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const c = new THREE.Color();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    let n = 0;
    for (let tries = 0; n < count && tries < count * 6; tries++) {
      // distance from the LM's axis: most within 12 m
      const d = 2.6 + 23 * Math.pow(r(), 1.7);
      const a = r() * Math.PI * 2;
      const x = ax + Math.sin(a) * d;
      const z = az + Math.cos(a) * d;
      if (keep.some((k) => Math.hypot(x - k.x, z - k.z) < k.r)) continue;
      if (d < 6 && r() < 0.5) continue; // the engine swept the first metres
      const size = 0.02 + 0.11 * Math.pow(r(), 2.4);
      const y = w.ground(x, z);
      e.set(r() * 0.6, r() * Math.PI * 2, r() * 0.6);
      q.setFromEuler(e);
      pos.set(x, y + size * 0.05, z);
      scl.set(size * (0.8 + 0.5 * r()), size * (0.7 + 0.5 * r()), size * (0.8 + 0.5 * r()));
      m.setMatrixAt(n, M.compose(pos, q, scl));
      c.copy(base).multiplyScalar(0.62 + 0.55 * r());
      m.setColorAt(n, c);
      n++;
    }
    m.count = n;
    m.castShadow = false;
    m.receiveShadow = true;
    m.frustumCulled = false;
    return m;
  }, [sim, color, count]);
  return <primitive object={mesh} />;
}
