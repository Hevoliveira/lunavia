import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { M_PER_UNIT, SPLASH } from "@/data/descentScene";

/*
 * The spray at contact (viewRef.current.splash: { on, x, y, z, t }: the heat shield's first point
 * in the water, in scene units, and seconds since contact). Nothing is drawn before contact, and
 * nothing after a few seconds: what stays is in the water itself (Ocean: the rebound, the ripples,
 * the churn and the foam round the hull).
 * - jets of water thrown out and up round the heat shield's rim, fastest low and outward (the
 *   Apollo impact photographs: a ragged radial burst), each drawn as a short streak along its own
 *   motion, flying ballistically under real gravity (9.81 m/s² at the scene's scale) and falling
 *   back into the sea;
 * - a mist of fine spray that billows out, drifts and thins.
 * No crown, no ring, no disc.
 */

const JETS = 520;
const MIST = 64;
const GRAV = 9.81 / M_PER_UNIT;

function rng(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const jetVertex = `
attribute vec4 aP0;    // start (x, y, z units, relative to the contact) and launch delay (s)
attribute vec4 aV;     // velocity (units/s) and size (m)
uniform float uT;
uniform float uLife;
uniform float uAspect;
varying float vA;
varying vec2 vQ;
vec3 at(float t) {
  vec3 p = aP0.xyz + aV.xyz * t;
  p.y -= 0.5 * ${GRAV.toFixed(4)} * t * t;
  return p;
}
void main() {
  float t = uT - aP0.w;
  float on = step(0.0, t);
  t = max(t, 0.0);
  vec3 p1 = at(t);
  vec3 p0 = at(max(0.0, t - 0.07)); // the streak: where it was a moment ago
  vec4 c1 = projectionMatrix * modelViewMatrix * vec4(p1, 1.0);
  vec4 c0 = projectionMatrix * modelViewMatrix * vec4(p0, 1.0);
  vec2 s1 = c1.xy / c1.w;
  vec2 s0 = c0.xy / c0.w;
  vec2 dir = s1 - s0;
  dir.x *= uAspect;
  float len = length(dir);
  dir = len > 1e-5 ? dir / len : vec2(0.0, 1.0);
  vec2 side = vec2(-dir.y, dir.x);
  side.x /= uAspect;
  vec4 c = mix(c0, c1, position.x);
  float w = aV.w / ${M_PER_UNIT.toFixed(2)} * projectionMatrix[1][1];
  c.xy += side * position.y * w;
  vQ = position.xy;
  // alive above the water, thinning as it falls back
  float life = 1.0 - smoothstep(uLife * 0.55, uLife, t);
  vA = on * life * step(-0.02, p1.y) * (0.55 + 0.45 * smoothstep(0.0, 0.08, t));
  gl_Position = c;
}`;

const jetFragment = `
uniform vec3 uSun;
varying float vA;
varying vec2 vQ;
void main() {
  float a = vA * smoothstep(1.0, 0.2, abs(vQ.y)) * (0.35 + 0.65 * vQ.x);
  if (a < 0.02) discard;
  vec3 col = vec3(0.9, 0.94, 0.97) * (0.82 + 0.25 * max(uSun.y, 0.0));
  gl_FragColor = vec4(col, a * 0.85);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const mistVertex = `
attribute vec4 aM;     // direction (x, z), speed (units/s), size (units)
uniform float uT;
uniform float uScale;
varying float vA;
varying float vSeed;
void main() {
  float t = uT;
  float grow = 1.0 - exp(-t / 0.5);
  vec3 p = vec3(aM.x * (0.5 + aM.z * grow * 1.4), 0.1 + 0.55 * grow * aM.w * 3.0 - 0.06 * t, aM.y * (0.5 + aM.z * grow * 1.4));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = aM.w * (0.6 + 1.4 * grow) * uScale * ${(1 / 0.83).toFixed(3)} / max(0.1, -mv.z);
  vA = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.6, 2.6, t));
  vSeed = aM.x * 13.0 + aM.y * 7.0;
  gl_Position = projectionMatrix * mv;
}`;

const mistFragment = `
uniform sampler2D uNoise;
uniform vec3 uSun;
varying float vA;
varying float vSeed;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float n = texture2D(uNoise, gl_PointCoord * 0.7 + vSeed).r;
  float a = smoothstep(0.5, 0.1, length(c) + (n - 0.5) * 0.45) * vA * 0.5;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.9, 0.93, 0.96) * (0.85 + 0.2 * max(uSun.y, 0.0)), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export default function Splash({ viewRef, noise, sun }) {
  const group = useRef();
  const jetGeo = useMemo(() => {
    const R = rng(4242);
    const base = new THREE.PlaneGeometry(1, 2).translate(0.5, 0, 0); // x: 0 tail .. 1 head, y: -1..1 across
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.attributes.position = base.attributes.position;
    const p0 = new Float32Array(JETS * 4);
    const vv = new Float32Array(JETS * 4);
    for (let i = 0; i < JETS; i++) {
      // round the rim, bunched into ragged radial jets
      const lobe = Math.floor(R() * 14);
      const a = (lobe / 14) * Math.PI * 2 + (R() - 0.5) * 0.35;
      const rad = 0.42 + R() * 0.16;
      p0[i * 4] = Math.cos(a) * rad;
      p0[i * 4 + 1] = 0.02;
      p0[i * 4 + 2] = Math.sin(a) * rad;
      p0[i * 4 + 3] = Math.pow(R(), 2) * 0.22; // most leave at once, a few a little later
      // m/s: low and fast outward, or steeper and slower; a few tall ones
      const elev = (12 + Math.pow(R(), 1.4) * 58) * (Math.PI / 180);
      const speed = (5.5 + R() * 8.5) * (1 - 0.35 * Math.sin(elev));
      vv[i * 4] = (Math.cos(a) * Math.cos(elev) * speed) / M_PER_UNIT;
      vv[i * 4 + 1] = (Math.sin(elev) * speed) / M_PER_UNIT;
      vv[i * 4 + 2] = (Math.sin(a) * Math.cos(elev) * speed) / M_PER_UNIT;
      vv[i * 4 + 3] = 0.08 + Math.pow(R(), 2.2) * 0.3; // width, m
    }
    g.setAttribute("aP0", new THREE.InstancedBufferAttribute(p0, 4));
    g.setAttribute("aV", new THREE.InstancedBufferAttribute(vv, 4));
    g.instanceCount = JETS;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    return g;
  }, []);
  const mistGeo = useMemo(() => {
    const R = rng(777);
    const m = new Float32Array(MIST * 4);
    for (let i = 0; i < MIST; i++) {
      const a = (i / MIST) * Math.PI * 2 + R() * 0.4;
      m[i * 4] = Math.cos(a);
      m[i * 4 + 1] = Math.sin(a);
      m[i * 4 + 2] = 0.25 + R() * 0.55;
      m[i * 4 + 3] = 0.22 + Math.pow(R(), 1.5) * 0.45;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MIST * 3), 3));
    g.setAttribute("aM", new THREE.BufferAttribute(m, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    return g;
  }, []);
  const jetMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uT: { value: 0 }, uLife: { value: SPLASH.dropletLife }, uAspect: { value: 1 }, uSun: { value: sun } },
        vertexShader: jetVertex,
        fragmentShader: jetFragment,
        transparent: true,
        depthWrite: false,
      }),
    [sun]
  );
  const mistMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uT: { value: 0 }, uScale: { value: 300 }, uNoise: { value: noise }, uSun: { value: sun } },
        vertexShader: mistVertex,
        fragmentShader: mistFragment,
        transparent: true,
        depthWrite: false,
      }),
    [noise, sun]
  );
  useEffect(() => () => [jetGeo, mistGeo, jetMat, mistMat].forEach((x) => x.dispose()), [jetGeo, mistGeo, jetMat, mistMat]);

  useFrame((state) => {
    const sp = viewRef.current.splash;
    const on = !!(sp && sp.on && sp.t < 3.5);
    if (group.current) group.current.visible = on;
    if (!on) return;
    group.current.position.set(sp.x, sp.y, sp.z);
    jetMat.uniforms.uT.value = sp.t;
    jetMat.uniforms.uAspect.value = state.size.width / Math.max(1, state.size.height);
    mistMat.uniforms.uT.value = sp.t;
    mistMat.uniforms.uScale.value = state.size.height;
  });

  return (
    <group ref={group} visible={false} name="splash">
      <mesh geometry={jetGeo} material={jetMat} frustumCulled={false} renderOrder={4} />
      <points geometry={mistGeo} material={mistMat} frustumCulled={false} renderOrder={3} />
    </group>
  );
}
