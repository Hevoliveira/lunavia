import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { planetTexture } from "@/components/planets/planetMaterials";
import { M_PER_UNIT, R_EARTH_U, WAVES, waveSpeed, CLOUD_FIELD } from "@/data/descentScene";

/*
 * The open sea below the capsule (data/descentScene: one scale, 1 unit = 3.9 m).
 *
 * Geometry: a polar grid centred under the camera (fine near the middle, coarse far out, 4 m to
 * 450 km), following it, the surface falling away with the Earth's curvature, so the horizon is
 * the sea's own and the grid's rim lies beyond it, lost in the haze: no edge, no tiling square.
 *
 * Shading (one shader, per pixel), many scales, each only where the pixel can hold it:
 * - the swell and wind waves of data/descentScene WAVES (real sizes; the floating capsule rides
 *   the same sum), displaced near the camera, as analytic normals everywhere they resolve;
 * - four shorter wind waves (9 m down to 2 m) and three scales of procedural detail normals,
 *   each faded out by the pixel's own footprint on the sea (no moiré, no shimmer, no visible
 *   repeat: the detail tiles are of unrelated sizes and turned against each other);
 * - gusts: slow, broad patches of rougher and smoother water (cat's paws), so the surface is
 *   never uniform and never a mirror;
 * - Fresnel: deep blue water looking down, the sky's reflection towards the horizon; roughness
 *   growing with distance; scattered small whitecaps on the steepest crests (a slight sea);
 * - the shadows of the 3D cumulus field, and beyond it the NASA Blue Marble cloud cover;
 * - haze into the sky's horizon colour with distance;
 * - the splash, all in the water itself: the surface pushed down and rebounding in a low swell
 *   ring, broken ripples running out and dying, aerated water churned white round the impact,
 *   then a ragged lace of foam round the floating capsule and its waterline, fading slowly.
 *   No drawn circle, no disc.
 */

const SEGMENTS = 96;
const RINGS = 120;
const R_MIN = 1.0;
const R_MAX = 115000;

function polarGrid() {
  const pos = [];
  const idx = [];
  pos.push(0, 0, 0);
  const k = Math.log(R_MAX / R_MIN) / (RINGS - 1);
  for (let i = 0; i < RINGS; i++) {
    const r = R_MIN * Math.exp(k * i);
    for (let j = 0; j < SEGMENTS; j++) {
      const a = (j / SEGMENTS) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }
  for (let j = 0; j < SEGMENTS; j++) idx.push(0, 1 + ((j + 1) % SEGMENTS), 1 + j);
  for (let i = 0; i < RINGS - 1; i++) {
    for (let j = 0; j < SEGMENTS; j++) {
      const a = 1 + i * SEGMENTS + j;
      const b = 1 + i * SEGMENTS + ((j + 1) % SEGMENTS);
      const c = 1 + (i + 1) * SEGMENTS + j;
      const d = 1 + (i + 1) * SEGMENTS + ((j + 1) % SEGMENTS);
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R_MAX * 2); // it follows the camera
  return g;
}

/** A tileable noise normal map (256², procedural; made once, no file to load); its height in alpha. */
let DETAIL = null;
function detailNormals() {
  if (DETAIL) return DETAIL;
  const N = 256;
  const h = new Float32Array(N * N);
  // a sum of random periodic waves (integer frequencies on the tile: it wraps seamlessly)
  let s = 12345;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const waves = [];
  for (let i = 0; i < 64; i++) {
    const f = 2 + Math.floor(Math.pow(r(), 1.5) * 30);
    const a = r() * Math.PI * 2;
    waves.push({ fx: Math.round(Math.cos(a) * f), fy: Math.round(Math.sin(a) * f), ph: r() * Math.PI * 2, amp: 1 / Math.pow(f, 1.15) });
  }
  let mn = Infinity;
  let mx = -Infinity;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let v = 0;
      for (const w of waves) v += w.amp * Math.sin(((w.fx * x + w.fy * y) / N) * Math.PI * 2 + w.ph);
      h[y * N + x] = v;
      mn = Math.min(mn, v);
      mx = Math.max(mx, v);
    }
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = h[y * N + ((x + 1) % N)] - h[y * N + ((x + N - 1) % N)];
      const dy = h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x];
      const nx = -dx * 3.2;
      const ny = -dy * 3.2;
      const l = Math.hypot(nx, ny, 1);
      const o = (y * N + x) * 4;
      data[o] = Math.round(((nx / l) * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round(((ny / l) * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      data[o + 3] = Math.round(((h[y * N + x] - mn) / (mx - mn)) * 255);
    }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 2; // the sea is seen at grazing angles: keep its detail crisp, not smeared
  t.generateMipmaps = true;
  t.needsUpdate = true;
  DETAIL = t;
  return t;
}

const WAVE_GLSL = WAVES.map((w, i) => {
  const k = (2 * Math.PI) / w.len;
  return `const vec4 W${i} = vec4(${Math.cos(w.dir).toFixed(5)}, ${Math.sin(w.dir).toFixed(5)}, ${k.toFixed(6)}, ${(k * waveSpeed(w.len)).toFixed(6)});
const vec3 A${i} = vec3(${w.amp.toFixed(4)}, ${w.steep.toFixed(3)}, ${w.len.toFixed(1)});`;
}).join("\n");
const WAVE_SUM = (fn) => WAVES.map((_, i) => fn(i)).join("\n");
/** GLSL: the sea's height (m) at m (metres, drift included) and time t: the very waves drawn here. */
export const SEA_HEIGHT_GLSL = `
float seaHeight(vec2 m, float t) {
  float h = 0.0;
  ${WAVES.map((w) => {
    const k = (2 * Math.PI) / w.len;
    return `h += ${w.amp.toFixed(4)} * sin(${k.toFixed(6)} * dot(vec2(${Math.cos(w.dir).toFixed(5)}, ${Math.sin(w.dir).toFixed(5)}), m) - ${(k * waveSpeed(w.len)).toFixed(6)} * t);`;
  }).join("\n  ")}
  return h;
}`;

/*
 * The short wind waves (normals only): wavelength (m), direction (rad), slope amplitude (a·k).
 * A slight sea's spectrum: directions spread round the wind, slopes gentle (under 0.1 each).
 */
const SHORT = [
  [8.9, 1.35, 0.06],
  [4.9, 0.05, 0.065],
  [3.1, 0.95, 0.07],
  [2.0, 1.75, 0.075],
];
const SHORT_GLSL = SHORT.map(([len, dir, slope], i) => {
  const k = (2 * Math.PI) / len;
  return `const vec4 S${i} = vec4(${Math.cos(dir).toFixed(5)}, ${Math.sin(dir).toFixed(5)}, ${k.toFixed(5)}, ${(k * waveSpeed(len)).toFixed(5)});`;
}).join("\n");

// The splash in the water (m, s): the rebound ring, the ripples, the churn, the foam round the hull.
const SPLASH_SEA = { reboundSpeed: 4.2, reboundAmp: 0.32, rippleSpeed: 2.6, hullR: 1.75 };

const vertexShader = `
uniform vec3 uCam;
uniform float uSeaY;
uniform vec2 uDrift;
uniform float uTime;
uniform vec4 uSplash;  // x, z (m), seconds since contact, on
${WAVE_GLSL}
varying vec2 vXZ;      // world position on the sea, metres (drift included)
varying vec3 vPos;     // scene position
varying float vDist;   // horizontal distance from the camera, units
varying float vCrest;  // the swell's height here (m), for the whitecaps
varying float vGust;   // broad, slow patches of rougher and smoother water (cat's paws)
varying float vCover;  // the NASA cloud cover beyond the 3D cumulus field
uniform sampler2D uDetail;
uniform sampler2D uCover;
uniform vec2 uCoverUV;     // the recovery area's place on the NASA map
uniform vec2 uCoverScale;  // map uv per metre
#include <logdepthbuf_pars_vertex>
void main() {
  vec2 xz = position.xz + uCam.xz;
  float d = length(position.xz);
  vec2 m = (xz + uDrift) * ${M_PER_UNIT.toFixed(2)};
  vec3 disp = vec3(0.0);
  ${WAVE_SUM(
    (i) => `{ float ph = W${i}.z * dot(W${i}.xy, m) - W${i}.w * uTime; float c = cos(ph);
    disp.xz += W${i}.xy * (A${i}.y * A${i}.x * c); disp.y += A${i}.x * sin(ph); }`
  )}
  vCrest = disp.y;
  vGust = texture2D(uDetail, m / 1300.0 + vec2(0.0021, 0.0013) * uTime).a;
  // the splash: the water pushed down at the impact, rebounding in a low ring that runs out and dies
  if (uSplash.w > 0.5) {
    float r = length(m - uSplash.xy);
    float t = uSplash.z;
    float front = r - ${SPLASH_SEA.reboundSpeed.toFixed(2)} * t;
    float ring = exp(-front * front / 9.0) * cos(front * 0.9);
    float pit = -exp(-r * r / 6.0) * sin(min(t / 0.9, 1.0) * 3.14159) ;
    disp.y += ${SPLASH_SEA.reboundAmp.toFixed(2)} * exp(-t / 2.2) * (ring / (1.0 + r * 0.15) + pit);
  }
  // beyond the 3D field, the NASA cloud cover: read here, per vertex (it changes over kilometres and
  // the grid's vertices out there are about that far apart), not by every pixel of the distant sea
  vCover = 0.0;
  if (d > ${(CLOUD_FIELD.radius * 0.6).toFixed(0)}.0) {
    float c0 = textureLod(uCover, uCoverUV + m * uCoverScale, 0.0).b;
    float brk = textureLod(uDetail, m / 2300.0, 6.0).x;
    vCover = smoothstep(0.55, 0.85, c0 * 0.85 + brk * 0.45);
  }
  float near = smoothstep(900.0, 150.0, d);
  vec3 p = vec3(xz.x, uSeaY, xz.y) + disp / ${M_PER_UNIT.toFixed(2)} * near;
  p.y -= d * d / ${(2 * R_EARTH_U).toFixed(1)};
  vXZ = m;
  vPos = p;
  vDist = d;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  #include <logdepthbuf_vertex>
}`;

const fragmentShader = `
uniform float uTime;
uniform float uFade;
uniform vec3 uSun;
uniform vec3 uSkyTop;
uniform vec3 uSkyHor;
uniform vec3 uHaze;
uniform float uHazeL;
uniform sampler2D uDetail;
uniform sampler2D uShadow; // the cumulus field's shadows on the sea (baked once)
uniform float uShadowSize; // metres across
uniform vec4 uSplash;      // x, z (m), seconds since contact, on
uniform vec3 uHull;        // the floating capsule's axis on the sea (x, z m), afloat (0/1)
${WAVE_GLSL}
${SHORT_GLSL}
varying vec2 vXZ;
varying vec3 vPos;
varying float vDist;
varying float vCrest;
varying float vGust;
varying float vCover;
#include <logdepthbuf_pars_fragment>

vec3 sky(vec3 r) {
  // the sky as the sea sees it: rough water blurs its gradient
  float k = pow(clamp(r.y, 0.0, 1.0), 0.55) * 0.9;
  vec3 c = mix(uSkyHor, uSkyTop, k);
  float sd = max(dot(r, uSun), 0.0);
  sd *= sd;
  sd *= sd;
  return c + vec3(1.0, 0.92, 0.8) * (sd * sd * 0.18);
}
// a wave of length L resolves only where the pixel is well under it
float keep(float L, float fp) { return 1.0 - smoothstep(L * 0.18, L * 0.5, fp); }

void main() {
  #include <logdepthbuf_fragment>
  vec2 m = vXZ;
  // the pixel's footprint on the sea (m): how much detail it can hold
  vec2 fw = fwidth(m);
  float fp = sqrt(fw.x * fw.y) * 1.5 + 0.15 * max(fw.x, fw.y);
  // gusts: broad, slow patches of rougher and smoother water
  float gust = vGust;
  float rough = 0.6 + 0.8 * smoothstep(0.25, 0.75, gust);
  // the swell and wind waves (analytic)
  vec2 g = vec2(0.0);
  // (each wave skipped outright where keep() is 0: the pixel covers half its length or more)
  ${WAVE_SUM((i) => `if (fp < ${(WAVES[i].len * 0.5).toFixed(2)}) { float ph = W${i}.z * dot(W${i}.xy, m) - W${i}.w * uTime; g += W${i}.xy * (A${i}.x * W${i}.z * cos(ph)) * keep(A${i}.z, fp); }`)}
  g *= 1.0 - 0.6 * smoothstep(80.0, 3000.0, vDist); // the swell's long lines soften far off
  // the short wind waves, longest first and nested: once one is too fine for the pixel, so are the
  // shorter ones, and none is computed (from altitude, none of them)
  ${SHORT.map(([len, , slope], i) => `if (fp < ${(len * 0.5).toFixed(2)}) { float ph = S${i}.z * dot(S${i}.xy, m) - S${i}.w * uTime + ${(i * 1.7).toFixed(2)}; g += S${i}.xy * (${slope.toFixed(3)} * cos(ph)) * keep(${len.toFixed(2)}, fp) * rough;`).join("\n  ")}
  ${SHORT.map(() => "}").join("")}
  // procedural detail at three unrelated scales
  float wcNoise = 0.5;
  // wind ripples: each scale sampled in the wind's frame (along it, across it), stretched across the
  // wind (crests 2.2x as long as they are apart), and its slope turned back into the world with
  // the same stretch: the water tilts mostly along the wind, as wind ripples do (no isotropic mottling)
  if (fp < 1.2) {
    const mat2 R1 = mat2(0.8139, -0.5810, 0.5810, 0.8139);
    const mat2 R2 = mat2(0.5570, -0.8305, 0.8305, 0.5570);
    const vec2 ST = vec2(1.0, 1.0 / 2.2);
    vec2 u1 = (R1 * m) * (ST / 7.3) + vec2(0.024, 0.004) * uTime;
    vec2 u2 = (R2 * m) * (ST / 2.35) + vec2(0.04, -0.006) * uTime;
    vec4 d1 = texture2D(uDetail, u1);
    vec3 d2 = texture2D(uDetail, u2).xyz * 2.0 - 1.0;
    wcNoise = d1.a;
    g += (((d1.xy * 2.0 - 1.0) * ST) * R1 * (0.1 * keep(2.2, fp)) + (d2.xy * ST) * R2 * (0.18 * keep(0.7, fp))) * rough;
    if (fp < 0.12) {
      const mat2 R3 = mat2(0.6967, -0.7174, 0.7174, 0.6967);
      vec3 d3 = texture2D(uDetail, (R3 * m) * (ST / 0.91) + vec2(0.06, 0.01) * uTime).xyz * 2.0 - 1.0;
      g += ((d3.xy * ST) * R3) * (0.15 * keep(0.28, fp)) * rough;
    }
  }

  // the splash: broken ripples running out and dying, the churn round the impact
  float churn = 0.0;
  float foam = 0.0;
  vec2 sp = m - uSplash.xy;
  float spR = length(sp);
  if (uSplash.w > 0.5 && uSplash.z < 8.0 && spR < ${SPLASH_SEA.rippleSpeed.toFixed(2)} * uSplash.z + 12.0) {
    float r = spR;
    float t = uSplash.z;
    float brk = texture2D(uDetail, m / 4.3).a;
    float ang = atan(sp.y, sp.x);
    float lobes = 0.55 + 0.45 * sin(ang * 5.0 + brk * 6.0);
    float front = r - ${SPLASH_SEA.rippleSpeed.toFixed(2)} * t;
    float packet = exp(-front * front / (2.5 + t)) * exp(-t / 2.4) * (1.0 - smoothstep(5.0, 8.0, t)) * lobes * (0.4 + 0.9 * brk);
    g += normalize(sp + 1e-4) * sin(front * 3.1) * packet * 0.5 * keep(2.0, fp);
    // white water churned up round the impact, settling within seconds
    churn = smoothstep(4.2 + 1.5 * brk, 0.8, r) * exp(-t / 1.4) * smoothstep(0.0, 0.15, t) * (0.45 + 0.55 * brk);
  }
  // foam round the floating capsule: a ragged lace hugging the hull at its waterline
  vec2 hp = m - uHull.xy;
  if (uHull.z > 0.5 && dot(hp, hp) < 64.0) {
    float r = length(hp);
    float t = uSplash.z;
    float lace1 = texture2D(uDetail, m / 1.7 + vec2(0.0, 0.03) * uTime).a;
    float lace2 = texture2D(uDetail, mat2(0.6, 0.8, -0.8, 0.6) * m / 0.75).a;
    float lace = smoothstep(0.52, 0.72, lace1 * 0.6 + lace2 * 0.5);
    float reach = ${SPLASH_SEA.hullR.toFixed(2)} + 0.9 + 1.6 * lace1 + 2.5 * exp(-t / 5.0);
    float zone = smoothstep(reach, ${SPLASH_SEA.hullR.toFixed(2)} + 0.15, r);
    // the waterline itself: a thin bright line where the swell laps the hull
    float lap = 0.5 + 0.5 * sin(uTime * 1.9 + atan(hp.y, hp.x) * 3.0 + lace1 * 5.0);
    float line = smoothstep(${(SPLASH_SEA.hullR + 0.55).toFixed(2)}, ${(SPLASH_SEA.hullR + 0.05).toFixed(2)}, r - 0.3 * lace2) * (0.35 + 0.4 * lap);
    foam = max(zone * lace * (0.3 + 0.5 * exp(-t / 9.0)), line);
  }

  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 v = normalize(cameraPosition - vPos);
  float ndv = max(dot(n, v), 0.0);
  float far = smoothstep(80.0, 3000.0, vDist); // 0 near by .. 1 far away
  float f1 = 1.0 - ndv;
  float f2 = f1 * f1;
  float fres = 0.02 + 0.98 * f2 * f2 * f1;
  fres *= 1.0 - 0.3 * far; // rough at a distance: less of a mirror
  vec3 r = reflect(-v, n);
  r.y = abs(r.y);
  vec3 refl = sky(r) * 0.74;
  // the water itself: deep blue, lifted where light comes through the crests
  float crest = clamp(g.x * uSun.x + g.y * uSun.z, 0.0, 1.0);
  vec3 body = vec3(0.003, 0.03, 0.1) + vec3(0.0, 0.045, 0.06) * crest * (1.0 - far) + vec3(0.003, 0.016, 0.045) * max(uSun.y, 0.0);
  vec3 col = mix(body, refl, fres);
  // the Sun's glint: sharp near, a wide glitter path far away
  vec3 h = normalize(v + uSun);
  float shin = mix(1400.0, 80.0, far) / rough;
  float spec = pow(max(dot(n, h), 0.0), shin) * (shin + 8.0) / 25.0;
  col += vec3(1.0, 0.95, 0.86) * spec * 0.06;
  // whitecaps: a few small breaking crests where the swell peaks and the wind gusts
  float wc = smoothstep(0.6, 0.82, vCrest) * smoothstep(0.74, 0.88, wcNoise) * smoothstep(0.55, 0.85, gust);
  float wcFar = 1.0 - smoothstep(1.5, 9.0, fp);
  foam = max(foam, wc * 0.75 * wcFar);

  // cloud shadows (the 3D field) and, beyond it, the NASA cloud cover (from the vertices)
  float farCover = smoothstep(${(CLOUD_FIELD.radius * 0.6).toFixed(0)}.0, ${(CLOUD_FIELD.radius * 1.05).toFixed(0)}.0, vDist);
  float shade = 0.0;
  // (the shadow map ends at the field's rim, past which farCover is 1: nothing to read out there)
  if (farCover < 0.999) shade = texture2D(uShadow, m / uShadowSize + 0.5).r;
  float cover = vCover;
  shade = max(shade, cover * 0.7 * farCover);
  col *= 1.0 - 0.5 * shade;
  vec3 cloudLit = vec3(0.86, 0.89, 0.93) * (0.75 + 0.25 * max(uSun.y, 0.0));
  col = mix(col, cloudLit, cover * farCover * 0.35);

  // aerated water and foam: white, a little blue-green in the churn
  col = mix(col, vec3(0.55, 0.72, 0.74), clamp(churn, 0.0, 1.0) * 0.75);
  col = mix(col, vec3(0.9, 0.94, 0.95) * (0.8 + 0.2 * max(uSun.y, 0.0)), clamp(foam, 0.0, 1.0));
  // haze: into the sky's own horizon colour with distance
  float hz = 1.0 - exp(-vDist / uHazeL);
  col = mix(col, uHaze, clamp(hz, 0.0, 1.0));
  gl_FragColor = vec4(col, uFade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// The recovery area on the NASA map: the central Pacific, 13° N 169° W (Apollo 11's splashdown area).
const SITE = { lat: 13.3, lon: -169.2 };

export default function Ocean({ simRef, viewRef, atmo, cloudShadows }) {
  const mesh = useRef();
  const geo = useMemo(() => polarGrid(), []);
  const mat = useMemo(() => {
    const cover = planetTexture("earthAux");
    const latR = (SITE.lat * Math.PI) / 180;
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uCam: { value: new THREE.Vector3() },
        uSeaY: { value: 0 },
        uDrift: { value: new THREE.Vector2() },
        uTime: { value: 0 },
        uFade: { value: 1 },
        uSun: { value: atmo.sun },
        uSkyTop: { value: atmo.top },
        uSkyHor: { value: atmo.hor },
        uHaze: { value: atmo.haze },
        uHazeL: { value: 20000 },
        uDetail: { value: detailNormals() },
        uCover: { value: cover },
        uCoverUV: { value: new THREE.Vector2((SITE.lon + 180) / 360, 1 - (90 - SITE.lat) / 180) },
        uCoverScale: { value: new THREE.Vector2(1 / (2 * Math.PI * 6371e3 * Math.cos(latR)), -1 / (Math.PI * 6371e3)) },
        uShadow: { value: cloudShadows.texture },
        uShadowSize: { value: cloudShadows.size },
        uSplash: { value: new THREE.Vector4(0, 0, 0, 0) },
        uHull: { value: new THREE.Vector3(0, 0, 0) },
      },
      vertexShader,
      fragmentShader,
      transparent: false,
      depthWrite: true,
    });
    return m;
  }, [atmo, cloudShadows]);
  useEffect(() => () => {
    geo.dispose();
    mat.dispose();
  }, [geo, mat]);

  useFrame((state) => {
    const s = simRef.current;
    const v = viewRef.current;
    if (!s || !mesh.current) return;
    const low = atmo.low;
    mesh.current.visible = low > 0.004;
    if (!mesh.current.visible) return;
    const U = mat.uniforms;
    U.uCam.value.copy(state.camera.position);
    U.uSeaY.value = atmo.seaY;
    U.uDrift.value.set(atmo.drift, 0);
    U.uTime.value = state.clock.elapsedTime;
    U.uFade.value = low;
    // thicker haze low over the sea; long sight lines from high up
    U.uHazeL.value = 16000 + Math.min(1, Math.max(0, s.h) / 9000) * 34000;
    // crossfading with the orbital Earth above 15 km: blended, writing no depth
    const fading = low < 0.999;
    if (mat.transparent !== fading) {
      mat.transparent = fading;
      mat.depthWrite = !fading;
      mat.needsUpdate = true;
    }
    const sp = v.splash;
    if (sp && sp.on) {
      U.uSplash.value.set(sp.x * M_PER_UNIT + atmo.drift * M_PER_UNIT, sp.z * M_PER_UNIT, sp.t, 1);
      // the capsule floats at the scene's origin
      U.uHull.value.set(atmo.drift * M_PER_UNIT, 0, 1);
    } else {
      U.uSplash.value.w = 0;
      U.uHull.value.z = 0;
    }
  });

  return <mesh ref={mesh} geometry={geo} material={mat} frustumCulled={false} renderOrder={-1} name="ocean" />;
}
