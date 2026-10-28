import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { createEarthMaterials, createMoonMaterial } from "@/components/planets/planetMaterials";

/*
 * The Earth and the Moon as scene components (shared NASA textures and shaders:
 * components/planets/planetMaterials). `sun` is the direction towards the Sun in
 * world space (array or THREE.Vector3) — the same one that lights the scene's
 * spacecraft.
 */

const toVec = (s, out) => (s && s.isVector3 ? out.copy(s) : out.set(s[0], s[1], s[2])).normalize();
const _c = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * The Earth: surface, cloud shell and atmospheric limb. `spin` turns the surface
 * (rad/s), `cloudDrift` moves the clouds over it (texture turns per second),
 * `opacityRef` (optional ref holding 0..1) fades the whole planet, `limbRef` the
 * atmospheric limb alone. `small`: the 1k maps, for an Earth seen only as a small disc.
 */
export function PlanetEarth({ radius, sun, spin = 0, cloudDrift = 0.0004, segments = 128, exposure = 1, clouds = true, atmosphere = true, opacityRef = null, limbRef = null, rotation = [0, 0, 0], onBodyRef = null, small = false, ...group }) {
  const sunV = useMemo(() => new THREE.Vector3(), []);
  toVec(sun, sunV);
  const mats = useMemo(() => createEarthMaterials({ sun: sunV, radius, exposure, small }), [sunV, radius, exposure, small]);
  useEffect(() => () => [mats.surface, mats.clouds, mats.atmosphere].forEach((m) => m.dispose()), [mats]);
  const root = useRef();
  const body = useRef();
  const shell = useRef();
  useEffect(() => {
    if (onBodyRef) onBodyRef.current = body.current;
  }, [onBodyRef]);
  useFrame((_, dt) => {
    if (body.current && spin) body.current.rotation.y += dt * spin;
    mats.uniforms.uCloudU.value = (mats.uniforms.uCloudU.value + dt * cloudDrift) % 1;
    const o = opacityRef ? opacityRef.current : 1;
    mats.uniforms.uOpacity.value = o;
    // the limb: faded with the planet, and by limbRef (e.g. off once the camera is inside the air)
    const lo = o * (limbRef ? limbRef.current : 1);
    mats.atmoUniforms.uOpacity.value = lo;
    if (shell.current) shell.current.visible = lo > 0.01;
    const fading = o < 0.999;
    if (mats.surface.transparent !== fading) {
      mats.surface.transparent = fading;
      mats.surface.needsUpdate = true;
    }
    if (shell.current && root.current) {
      // the limb shader works in world units: the planet's centre and radius as drawn
      root.current.getWorldPosition(_c);
      root.current.getWorldScale(_s);
      const r = radius * _s.x;
      mats.atmoUniforms.uCentre.value.copy(_c);
      mats.atmoUniforms.uR.value = r;
      mats.atmoUniforms.uH.value = r * 0.018;
    }
  });
  return (
    <group ref={root} {...group}>
      <group ref={body} rotation={rotation}>
        <mesh material={mats.surface} name="earth-surface">
          <sphereGeometry args={[radius, segments, Math.round(segments / 2)]} />
        </mesh>
        {clouds && (
          <mesh material={mats.clouds} renderOrder={1} name="earth-clouds">
            <sphereGeometry args={[radius * 1.004, Math.round(segments * 0.75), Math.round(segments * 0.375)]} />
          </mesh>
        )}
      </group>
      {atmosphere && (
        <mesh ref={shell} material={mats.atmosphere} renderOrder={2} name="earth-atmosphere">
          <sphereGeometry args={[radius * 1.018, 96, 48]} />
        </mesh>
      )}
    </group>
  );
}

/**
 * The Moon. `detail` (optional function (camera, worldCentre) → 0..1) fades in the fine
 * regolith detail for close views. `quaternion` orients the lunar globe.
 */
export function PlanetMoon({ radius, sun, segments = 160, exposure = 1, albedo = 1.12, relief = 0.8, earthshine = 0.004, detail = null, ...mesh }) {
  const sunV = useMemo(() => new THREE.Vector3(), []);
  toVec(sun, sunV);
  const mat = useMemo(() => createMoonMaterial({ sun: sunV, exposure, albedo, relief, earthshine }), [sunV, exposure, albedo, relief, earthshine]);
  useEffect(() => {
    // validation tooling: the live Moon materials (shader cost measurements)
    const live = typeof window !== "undefined" ? (window.__lvMoonMaterials = window.__lvMoonMaterials || new Set()) : null;
    if (live) live.add(mat);
    return () => {
      if (live) live.delete(mat);
      mat.dispose();
    };
  }, [mat]);
  const ref = useRef();
  useFrame(({ camera }) => {
    if (detail && ref.current) {
      ref.current.getWorldPosition(_c);
      mat.uniforms.uDetail.value = detail(camera, _c);
    }
  });
  return (
    <mesh ref={ref} material={mat} name="moon" {...mesh}>
      <sphereGeometry args={[radius, segments, Math.round(segments * 0.75)]} />
    </mesh>
  );
}
