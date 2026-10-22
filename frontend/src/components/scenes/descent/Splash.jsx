import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { M_PER_UNIT } from "@/data/descentScene";

/*
 * The spray at contact (viewRef.current.splash: { on, x, y, z, t }: the heat shield's first point
 * in the water, in scene units, and seconds since contact). Nothing is drawn before contact, and
 * nothing after a few seconds: what stays is in the water itself (Ocean: the rebound, the ripples,
 * the churn and the foam round the hull).
 *
 * As the Apollo splashdown photographs show it, the water thrown up is white spray in masses, not
 * separate drops: the heat shield's leading edge strikes first, so most of the water goes up on
 * that side, in a ragged burst taller than the capsule, and a low white skirt runs out along the
 * sea all round. Here:
 * - spray masses: soft volumes of spray (camera-facing, their outline broken by noise, lit like a
 *   volume: white towards the Sun, grey-blue on the shaded side), thrown out and up from round the
 *   rim, slowed by the air, falling back under real gravity, swelling and thinning into mist;
 * - the skirt: low, fast masses running out over the water and settling;
 * - a few fine drops at the burst's edges, each as thin as a drop really is on screen (a fraction
 *   of a pixel: faint), never confetti.
 * No crown, no ring, no disc.
 */

const MASSES = 64;
const SKIRT = 26;
const DROPS = 140;
const GRAV = 9.81 / M_PER_UNIT;
// the leading edge's side (where the shield strikes first), as the capsule swings in
const LEAD = 2.3;

function rng(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// position under gravity with air drag (k per second): v (1 - e^(-kt)) / k, gravity against the drag
const DRAG_GLSL = `
vec3 flight(vec3 p0, vec3 v, float t, float k) {
  float e = (1.0 - exp(-k * t)) / k;
  vec3 p = p0 + v * e;
  p.y -= ${GRAV.toFixed(4)} / k * (t - e);
  return p;
}`;

const massVertex = `
attribute vec4 aP0;    // start (units, relative to the contact) and launch delay (s)
attribute vec4 aV;     // velocity (units/s) and radius (units)
attribute vec4 aS;     // seed, drag (1/s), swell, density
uniform float uT;
varying vec2 vQ;
varying float vA;
varying float vSeed;
varying float vAge;
${DRAG_GLSL}
void main() {
  float t = uT - aP0.w;
  float on = step(0.0, t);
  t = max(t, 0.0);
  float k = aS.y;
  vec3 p = flight(aP0.xyz, aV.xyz, t, k);
  // swelling as it spreads and slows (spray becoming mist)
  float r = aV.w * (0.55 + aS.z * (1.0 - exp(-t / 0.55)));
  // a mass that has fallen back is in the sea: it fades as it meets the water
  float above = smoothstep(-0.25, 0.15, p.y + r * 0.4);
  float life = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.8, 2.6, t));
  vA = on * life * above * aS.w;
  vQ = position.xy;
  vSeed = aS.x;
  vAge = t;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  // its motion on screen just now: a fast mass of spray is drawn out along it (a jet)
  vec2 sv = (mv.xyz - (modelViewMatrix * vec4(flight(aP0.xyz, aV.xyz, max(0.0, t - 0.05), k), 1.0)).xyz).xy / 0.05;
  float sl = length(sv);
  vec2 along = sl > 1e-4 ? sv / sl : vec2(0.0, 1.0);
  vec2 across = vec2(along.y, -along.x); // (a rotation, not a mirror: the quad keeps its winding)
  float stretch = 1.0 + min(sl * 0.55, 1.8);
  mv.xy += (across * position.x + along * (position.y * stretch)) * r;
  gl_Position = projectionMatrix * mv;
}`;

const massFragment = `
uniform sampler2D uNoise;
uniform vec3 uSun;
varying vec2 vQ;
varying float vA;
varying float vSeed;
varying float vAge;
void main() {
  float r = length(vQ);
  if (r > 1.0 || vA < 0.01) discard;
  // the outline broken into clumps and streaks (noise stretched along the jet, two scales,
  // drifting as it ages): ragged, never a smooth puff
  float n = texture2D(uNoise, vQ * vec2(0.9, 0.35) + vec2(vSeed, vSeed * 1.7) + vAge * 0.04).r * 0.55
          + texture2D(uNoise, vQ * vec2(2.4, 1.1) + vec2(vSeed * 2.3, vSeed) - vAge * 0.06).r * 0.45;
  float body = smoothstep(0.95, 0.5, r + (n - 0.5) * 1.15);
  // spray thins as it ages: dense early, broken mist late
  float a = body * vA * mix(1.0, 0.5, smoothstep(0.4, 2.2, vAge)) * (0.6 + 0.7 * n);
  if (a < 0.01) discard;
  // lit as a volume: the side towards the Sun white, the other grey-blue (the sea's and sky's light)
  vec3 nv = vec3(vQ, sqrt(max(0.0, 1.0 - r * r)));
  vec3 sv = normalize((viewMatrix * vec4(uSun, 0.0)).xyz);
  float lit = clamp(dot(nv, sv) * 0.6 + 0.45, 0.0, 1.0);
  // light through the thin spray, looking towards the Sun
  float through = pow(max(-sv.z, 0.0), 2.0) * (1.0 - body) * 0.5;
  vec3 col = mix(vec3(0.5, 0.58, 0.65), vec3(0.97, 0.97, 0.95), lit) + through;
  col *= 0.8 + 0.25 * max(uSun.y, 0.0);
  gl_FragColor = vec4(col, min(a, 0.92));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const dropVertex = `
attribute vec4 aP0;    // start (units) and launch delay (s)
attribute vec4 aV;     // velocity (units/s) and diameter (m)
uniform float uT;
uniform float uAspect;
uniform float uViewH;
varying float vA;
varying vec2 vQ;
${DRAG_GLSL}
void main() {
  float t = uT - aP0.w;
  float on = step(0.0, t);
  t = max(t, 0.0);
  vec3 p1 = flight(aP0.xyz, aV.xyz, t, 0.35);
  vec3 p0 = flight(aP0.xyz, aV.xyz, max(0.0, t - 0.035), 0.35); // a short streak of its motion
  vec4 c1 = projectionMatrix * modelViewMatrix * vec4(p1, 1.0);
  vec4 c0 = projectionMatrix * modelViewMatrix * vec4(p0, 1.0);
  vec2 dir = (c1.xy / c1.w - c0.xy / c0.w) * vec2(uAspect, 1.0);
  float len = length(dir);
  dir = len > 1e-5 ? dir / len : vec2(0.0, 1.0);
  vec2 side = vec2(-dir.y, dir.x);
  side.x /= uAspect;
  vec4 c = mix(c0, c1, position.x);
  // as wide as a drop is on screen (at least 1.2 px, its true coverage as its opacity)
  float px = aV.w / ${M_PER_UNIT.toFixed(2)} * projectionMatrix[1][1] * 0.5 * uViewH / c1.w;
  float w = max(px, 1.2);
  c.xy += side * position.y * (w / uViewH) * c.w;
  vQ = position.xy;
  float life = 1.0 - smoothstep(1.0, 1.8, t);
  vA = on * life * step(-0.02, p1.y) * min(1.0, px / 1.2);
  gl_Position = c;
}`;

const dropFragment = `
uniform vec3 uSun;
varying float vA;
varying vec2 vQ;
void main() {
  float a = vA * (1.0 - vQ.y * vQ.y) * (0.4 + 0.6 * vQ.x);
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.92, 0.95, 0.97) * (0.8 + 0.25 * max(uSun.y, 0.0)), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function massGeometry() {
  const R = rng(9137);
  const n = MASSES + SKIRT;
  const quad = new THREE.PlaneGeometry(2, 2);
  const g = new THREE.InstancedBufferGeometry();
  g.index = quad.index;
  g.attributes.position = quad.attributes.position;
  const p0 = new Float32Array(n * 4);
  const vv = new Float32Array(n * 4);
  const ss = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const skirt = i >= MASSES;
    // most of the water goes up on the leading edge's side; the skirt runs out all round
    const a = skirt ? (i / SKIRT) * Math.PI * 2 + (R() - 0.5) * 0.5 : LEAD + (R() - 0.5) * Math.PI * (R() < 0.7 ? 0.9 : 2.0);
    const lead = Math.max(0, Math.cos(a - LEAD));
    const rad = 0.42 + R() * 0.12;
    p0[i * 4] = Math.cos(a) * rad;
    p0[i * 4 + 1] = skirt ? 0.02 : 0.05 + R() * 0.12;
    p0[i * 4 + 2] = Math.sin(a) * rad;
    p0[i * 4 + 3] = Math.pow(R(), 2) * (skirt ? 0.08 : 0.16);
    // the burst steep and fast on the leading side (degrees, m/s), the skirt low and fast
    const elev = (skirt ? 6 + R() * 12 : 38 + R() * 42 * (0.5 + 0.5 * lead)) * (Math.PI / 180);
    const speed = skirt ? 6 + R() * 4 : (4.5 + R() * 4) * (0.7 + 0.5 * lead);
    // the tall ones less outward (the shield's edge throws the water up past the hull)
    const out = skirt ? 1 : 0.55 + 0.45 * R();
    vv[i * 4] = (Math.cos(a) * Math.cos(elev) * speed * out) / M_PER_UNIT;
    vv[i * 4 + 1] = (Math.sin(elev) * speed) / M_PER_UNIT;
    vv[i * 4 + 2] = (Math.sin(a) * Math.cos(elev) * speed * out) / M_PER_UNIT;
    vv[i * 4 + 3] = (skirt ? 0.35 + R() * 0.35 : 0.3 + R() * 0.55) / M_PER_UNIT; // radius at launch, m
    ss[i * 4] = R() * 7.3; // seed
    ss[i * 4 + 1] = skirt ? 1.8 + R() * 0.8 : 0.9 + R() * 0.6; // drag, 1/s
    ss[i * 4 + 2] = skirt ? 1.4 + R() * 0.6 : 1.1 + R() * 1.0; // swell
    ss[i * 4 + 3] = skirt ? 0.55 + R() * 0.3 : 0.6 + R() * 0.35; // density
  }
  g.setAttribute("aP0", new THREE.InstancedBufferAttribute(p0, 4));
  g.setAttribute("aV", new THREE.InstancedBufferAttribute(vv, 4));
  g.setAttribute("aS", new THREE.InstancedBufferAttribute(ss, 4));
  g.instanceCount = n;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
  return g;
}

function dropGeometry() {
  const R = rng(4242);
  const base = new THREE.PlaneGeometry(1, 2).translate(0.5, 0, 0); // x: 0 tail .. 1 head, y: -1..1 across
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.attributes.position = base.attributes.position;
  const p0 = new Float32Array(DROPS * 4);
  const vv = new Float32Array(DROPS * 4);
  for (let i = 0; i < DROPS; i++) {
    const a = LEAD + (R() - 0.5) * Math.PI * (R() < 0.6 ? 1.0 : 2.0);
    const rad = 0.45 + R() * 0.1;
    p0[i * 4] = Math.cos(a) * rad;
    p0[i * 4 + 1] = 0.05;
    p0[i * 4 + 2] = Math.sin(a) * rad;
    p0[i * 4 + 3] = Math.pow(R(), 2) * 0.2;
    const elev = (20 + R() * 55) * (Math.PI / 180);
    const speed = 5 + R() * 7;
    vv[i * 4] = (Math.cos(a) * Math.cos(elev) * speed) / M_PER_UNIT;
    vv[i * 4 + 1] = (Math.sin(elev) * speed) / M_PER_UNIT;
    vv[i * 4 + 2] = (Math.sin(a) * Math.cos(elev) * speed) / M_PER_UNIT;
    vv[i * 4 + 3] = 0.012 + Math.pow(R(), 2) * 0.03; // a clump of drops across, m
  }
  g.setAttribute("aP0", new THREE.InstancedBufferAttribute(p0, 4));
  g.setAttribute("aV", new THREE.InstancedBufferAttribute(vv, 4));
  g.instanceCount = DROPS;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
  return g;
}

export default function Splash({ viewRef, noise, sun }) {
  const group = useRef();
  const massGeo = useMemo(massGeometry, []);
  const dropGeo = useMemo(dropGeometry, []);
  const massMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uT: { value: 0 }, uNoise: { value: noise }, uSun: { value: sun } },
        vertexShader: massVertex,
        fragmentShader: massFragment,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [noise, sun]
  );
  const dropMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uT: { value: 0 }, uAspect: { value: 1 }, uViewH: { value: 800 }, uSun: { value: sun } },
        vertexShader: dropVertex,
        fragmentShader: dropFragment,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [sun]
  );
  useEffect(() => () => [massGeo, dropGeo, massMat, dropMat].forEach((x) => x.dispose()), [massGeo, dropGeo, massMat, dropMat]);

  useFrame((state) => {
    const sp = viewRef.current.splash;
    const on = !!(sp && sp.on && sp.t < 3.5);
    if (group.current) group.current.visible = on;
    if (!on) return;
    group.current.position.set(sp.x, sp.y, sp.z);
    massMat.uniforms.uT.value = sp.t;
    dropMat.uniforms.uT.value = sp.t;
    dropMat.uniforms.uAspect.value = state.size.width / Math.max(1, state.size.height);
    dropMat.uniforms.uViewH.value = state.gl.domElement.height;
  });

  return (
    <group ref={group} visible={false} name="splash">
      <mesh geometry={massGeo} material={massMat} frustumCulled={false} renderOrder={3} />
      <mesh geometry={dropGeo} material={dropMat} frustumCulled={false} renderOrder={4} />
    </group>
  );
}

/** The burst's make-up (for the tests). */
export const SPLASH_SPRAY = { masses: MASSES, skirt: SKIRT, drops: DROPS };
