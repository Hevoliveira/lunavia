import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { M_PER_UNIT, SPLASH } from "@/data/descentScene";

/*
 * The splash at contact (viewRef.current.splash: { on, x, y, z, t }: the heat shield's first point
 * in the water, in scene units, and seconds since contact). Nothing is drawn before contact.
 * - droplets thrown up and out from the rim of the contact, flying ballistically under real gravity
 *   (9.81 m/s² at the scene's scale) and falling back into the sea;
 * - a low crown of spray rising round the heat shield and collapsing (a noise-broken sheet);
 * - a little mist, drifting and thinning.
 * The ring of ripples and the foam are on the sea itself (Ocean's shader).
 */

const DROPS = 300;
const GRAV = 9.81 / M_PER_UNIT;

export default function Splash({ viewRef, noise }) {
  const drops = useRef();
  const crown = useRef();
  const group = useRef();
  const dropGeo = useMemo(() => {
    let s = 4242;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const p0 = new Float32Array(DROPS * 3);
    const v0 = new Float32Array(DROPS * 4);
    for (let i = 0; i < DROPS; i++) {
      const a = r() * Math.PI * 2;
      const rad = 0.35 + r() * 0.3;
      p0[i * 3] = Math.cos(a) * rad;
      p0[i * 3 + 1] = 0;
      p0[i * 3 + 2] = Math.sin(a) * rad;
      // m/s → units/s: out 1.5–6 m/s, up 2.5–9 m/s; small drops faster
      const out = (1.5 + r() * 4.5) / M_PER_UNIT;
      const up = (2.5 + Math.pow(r(), 1.5) * 6.5) / M_PER_UNIT;
      v0[i * 4] = Math.cos(a) * out;
      v0[i * 4 + 1] = up;
      v0[i * 4 + 2] = Math.sin(a) * out;
      v0[i * 4 + 3] = 0.6 + r() * 0.9; // size
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p0, 3));
    g.setAttribute("aVel", new THREE.BufferAttribute(v0, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    return g;
  }, []);
  const dropMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uT: { value: 0 }, uScale: { value: 300 } },
        vertexShader: `
          attribute vec4 aVel;
          uniform float uT;
          uniform float uScale;
          varying float vA;
          void main() {
            float t = uT;
            vec3 p = position + aVel.xyz * t;
            p.y -= 0.5 * ${GRAV.toFixed(4)} * t * t;
            vA = step(0.0, p.y + 0.02) * (1.0 - smoothstep(${(SPLASH.dropletLife * 0.6).toFixed(2)}, ${SPLASH.dropletLife.toFixed(2)}, t));
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = aVel.w * 0.065 * uScale / (0.83 * max(0.1, -mv.z));
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          varying float vA;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            float a = smoothstep(0.5, 0.15, length(c)) * vA;
            if (a < 0.02) discard;
            gl_FragColor = vec4(vec3(0.94, 0.97, 1.0), a * 0.9);
          }`,
        transparent: true,
        depthWrite: false,
      }),
    []
  );
  const crownGeo = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 48, 6, true).translate(0, 0.5, 0), []);
  const crownMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uT: { value: 0 }, uNoise: { value: noise } },
        vertexShader: `
          uniform float uT;
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vec3 p = position;
            // the sheet flares outward as it rises
            float flare = 1.0 + p.y * 0.55;
            p.xz *= flare;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: `
          uniform float uT;
          uniform sampler2D uNoise;
          varying vec2 vUv;
          void main() {
            float n = texture2D(uNoise, vec2(vUv.x * 3.0, vUv.y * 0.8 - uT * 0.4)).r;
            float n2 = texture2D(uNoise, vec2(vUv.x * 9.0 + 0.3, vUv.y * 2.0)).r;
            // ragged top, thinning sheet, droplet streaks
            float top = smoothstep(0.9, 0.2, vUv.y + (n - 0.5) * 1.1);
            float streak = smoothstep(0.45, 0.8, n2);
            float life = 1.0 - smoothstep(0.5, 1.6, uT);
            float foot = smoothstep(0.0, 0.18, vUv.y); // it rises out of the water
            float a = top * foot * (0.12 + 0.62 * streak) * life * smoothstep(0.0, 0.08, uT);
            if (a < 0.02) discard;
            gl_FragColor = vec4(vec3(0.93, 0.96, 0.99), a);
          }`,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [noise]
  );
  useEffect(() => () => [dropGeo, dropMat, crownGeo, crownMat].forEach((x) => x.dispose()), [dropGeo, dropMat, crownGeo, crownMat]);

  useFrame((state) => {
    const sp = viewRef.current.splash;
    const on = !!(sp && sp.on && sp.t < 3);
    if (group.current) group.current.visible = on;
    if (!on) return;
    group.current.position.set(sp.x, sp.y, sp.z);
    dropMat.uniforms.uT.value = sp.t;
    dropMat.uniforms.uScale.value = state.size.height;
    crownMat.uniforms.uT.value = sp.t;
    if (crown.current) {
      // rises to its height in 0.45 s, then falls back
      const t = sp.t;
      const up = Math.sin(Math.min(1, t / 0.9) * Math.PI);
      crown.current.scale.set(0.55 + 0.9 * Math.min(1, t / 0.7), Math.max(0.01, SPLASH.crownH * up), 0.55 + 0.9 * Math.min(1, t / 0.7));
    }
  });

  return (
    <group ref={group} visible={false} name="splash">
      <points ref={drops} geometry={dropGeo} material={dropMat} frustumCulled={false} renderOrder={4} />
      <mesh ref={crown} geometry={crownGeo} material={crownMat} renderOrder={3} />
    </group>
  );
}
