import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { M_PER_UNIT, R_EARTH_U, WAVES, waveSpeed } from "@/data/descentScene";
import { BAND_A, BAND_B, MSS_UNRESOLVED, WIND, oceanBand, packBand } from "@/data/oceanSpectrum";
import { CUMULUS, COLUMN } from "@/data/cumulusField";
import { SKY_GLSL, hazeLength } from "./atmosphere";
import { noiseTexture } from "./noise2d";

/*
 * The open sea below the capsule (data/descentScene: one scale, 1 unit = 3.9 m).
 *
 * Geometry: a polar grid centred under the camera (fine near the middle, coarse far out, 4 m to
 * 450 km), following it, the surface falling away with the Earth's curvature, so the horizon is
 * the sea's own and the grid's rim lies beyond it, lost in the haze: no edge, no tiling square.
 * The long swell (data/descentScene WAVES) displaces it near the camera; the floating capsule
 * rides the same swell.
 *
 * Shading (one shader, per pixel), the way the real sea's light works:
 * - the wind sea is a random sea from a wave spectrum (data/oceanSpectrum: two bands, each a
 *   seamless tile sampled twice at unrelated scales and angles, drifting downwind), its slopes
 *   calibrated to Cox & Munk's measurements of the real sea;
 * - what a pixel cannot resolve is not lost: the tiles store each texel's mean square slope, so
 *   the slope variance filtered out with distance becomes roughness (the sea grows smoother in
 *   texture and wider in its glitter towards the horizon, as in photographs; no stripes, no moiré);
 * - Fresnel: dark navy water looking down, the sky's reflection towards the horizon, the rougher
 *   sea reflecting a higher (bluer) part of the sky; the Sun's glitter from the same slope
 *   statistics; a little green-blue light through the crests towards the Sun;
 * - the cumulus' shadows from the very weather map the clouds are drawn from;
 * - haze into the sky's own colour at the horizon (descent/atmosphere): sea and sky meet softly;
 * - the splash, in the water itself: ragged churned white water that spreads and breaks up, small
 *   broken ripples, then a thin broken foam lace and a lapping meniscus round the floating hull.
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


// The splash in the water (m, s): the rebound, the ripples, the churn, the foam round the hull.
const SPLASH_SEA = { reboundSpeed: 4.2, reboundAmp: 0.18, rippleSpeed: 2.4, hullR: 1.8 };

// The wind sea's two bands, each sampled twice: [rotation (rad), stretch, drift speed (m/s)].
// The second sample of each is turned and stretched against the first (no repeat lines up).
const SAMPLES = {
  A: [
    [0.0, 1.0, 1.9],
    [0.72, 0.79, 1.4],
  ],
  B: [
    [0.21, 1.0, 0.8],
    [-0.58, 0.71, 0.55],
  ],
};
// weights so that the two samples together keep the band's calibrated mean square slope
const sampleConsts = (band, list) => {
  const inv = list.reduce((a, [, k]) => a + 1 / (k * k), 0);
  const w = 1 / Math.sqrt(inv);
  return list.map(([rot, k, v]) => {
    const c = Math.cos(rot);
    const sn = Math.sin(rot);
    // the tile's own wind direction, carried along by the rotation: its drift in tile units per second
    const ang = WIND.dir;
    return {
      mat: `mat2(${c.toFixed(5)}, ${(-sn).toFixed(5)}, ${sn.toFixed(5)}, ${c.toFixed(5)})`,
      scale: (1 / (band.L * k)).toFixed(6),
      drift: `vec2(${((Math.cos(ang) * v) / (band.L * k)).toFixed(6)}, ${((Math.sin(ang) * v) / (band.L * k)).toFixed(6)})`,
      wk: (w / k).toFixed(5), // slope weight (the stretch flattens the slopes by k)
      wk2: ((w * w) / (k * k)).toFixed(5),
      wh: w.toFixed(5),
    };
  });
};
const SA = sampleConsts(BAND_A, SAMPLES.A);
const SB = sampleConsts(BAND_B, SAMPLES.B);
// The second sample of a band only breaks up its repeat, which shows only where the texture's detail
// is resolved: farther out (gate: the pixel's footprint, m) its share of the slopes is roughness.
const bandGLSL = (tex, S, out, band, gate) =>
  S.map((c, i) => {
    const body = `vec4 b = texture2D(${tex}, (R_${out}${i} * m) * ${c.scale} + ${c.drift} * uTime);
    s += (b.xy * R_${out}${i}) * (${c.wk} * rough * f2);
    varU += max(b.w - dot(b.xy, b.xy), 0.0) * (${c.wk2} * rough * rough * f2);
    ${out === "A" ? `crest += b.z * ${c.wh} * f2;` : ""}`;
    if (i === 0) return `  { float f2 = 1.0; ${body} }`;
    return `  { float f2 = 1.0 - smoothstep(${(gate * 0.6).toFixed(2)}, ${gate.toFixed(2)}, fp);
    if (f2 > 0.0) { ${body} }
    varU += (1.0 - f2) * ${(Number(c.wk2) * band.mss).toFixed(6)} * rough * rough; }`;
  }).join("\n");
const matGLSL = (S, out) => S.map((c, i) => `const mat2 R_${out}${i} = ${c.mat};`).join("\n");

const vertexShader = `
uniform vec3 uCam;
uniform float uSeaY;
uniform vec2 uDrift;
uniform float uTime;
uniform vec4 uSplash;  // x, z (m), seconds since contact, on
uniform sampler2D uNoise2;
uniform sampler2D uCloudMap;  // the cumulus' weather map (their shadows)
uniform float uCloudOn;
uniform float uCloudMapM;
uniform vec2 uColumn;
uniform vec2 uWindOff;
uniform float uCloudMid;      // the clouds' middle height (m), where their shadows are cast from
uniform vec3 uSun;
uniform vec3 uSkyTop;
uniform vec3 uSkyHor;
uniform float uGlow;
${WAVE_GLSL}
varying vec2 vXZ;      // world position on the sea, metres (drift included)
varying vec3 vPos;     // scene position
varying float vDist;   // horizontal distance from the camera, units
varying float vGust;   // broad, slow patches of rougher and smoother water (cat's paws)
varying float vShadow; // a cumulus' shadow here (hundreds of metres across: per vertex is enough)
varying vec3 vHaze;    // the sky's colour at the horizon this way (the haze the far sea fades into)
${SKY_GLSL}
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
  vGust = textureLod(uNoise2, m / 1500.0 + vec2(0.0021, 0.0013) * uTime, 0.0).r;
  // the splash: the water pushed down at the impact, rebounding unevenly as it runs out and dies
  if (uSplash.w > 0.5 && uSplash.z < 8.0) {
    vec2 sp = m - uSplash.xy;
    float r = length(sp);
    float t = uSplash.z;
    float front = r - ${SPLASH_SEA.reboundSpeed.toFixed(2)} * t;
    float uneven = 0.55 + 0.45 * sin(atan(sp.y, sp.x) * 3.0 + 1.3) * sin(atan(sp.y, sp.x) * 5.0 + 0.4);
    float ring = exp(-front * front / 6.0) * cos(front * 1.1) * uneven;
    float pit = -exp(-r * r / 5.0) * sin(min(t / 0.8, 1.0) * 3.14159);
    disp.y += ${SPLASH_SEA.reboundAmp.toFixed(2)} * exp(-t / 1.6) * (ring / (1.0 + r * 0.2) + pit);
  }
  float near = smoothstep(900.0, 150.0, d);
  vec3 p = vec3(xz.x, uSeaY, xz.y) + disp / ${M_PER_UNIT.toFixed(2)} * near;
  p.y -= d * d / ${(2 * R_EARTH_U).toFixed(1)};
  vXZ = m;
  vPos = p;
  vDist = d;
  vShadow = 0.0;
  if (uCloudOn > 0.5) {
    vec2 g = m - uWindOff - uSun.xz / max(uSun.y, 0.2) * uCloudMid;
    vShadow = smoothstep(0.06, 0.5, textureLod(uCloudMap, (g - uColumn) / uCloudMapM + 0.5, 1.5).r);
  }
  vec2 dir = length(position.xz) > 1e-3 ? normalize(position.xz) : vec2(1.0, 0.0);
  vHaze = skyColor(normalize(vec3(dir.x, 1e-4, dir.y)));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  #include <logdepthbuf_vertex>
}`;

const fragmentShader = `
uniform float uTime;
uniform float uFade;
uniform vec3 uSun;
uniform vec3 uSkyTop;
uniform vec3 uSkyHor;
uniform float uGlow;
uniform float uHazeL;
uniform sampler2D uBandA;
uniform sampler2D uBandB;
uniform sampler2D uNoise2;
uniform vec4 uSplash;         // x, z (m), seconds since contact, on
uniform vec3 uHull;           // the floating capsule's axis on the sea (x, z m), afloat (0/1)
${WAVE_GLSL}
${matGLSL(SA, "A")}
${matGLSL(SB, "B")}
varying vec2 vXZ;
varying vec3 vPos;
varying float vDist;
varying float vGust;
varying float vShadow;
varying vec3 vHaze;
${SKY_GLSL}
#include <logdepthbuf_pars_fragment>

// an analytic wave of length L resolves only where the pixel is well under it (fp: the pixel's
// footprint along the wave's own direction of travel: at a grazing angle the pixel is long towards
// the horizon and narrow across it, and a wave crossing the view needs the long side)
float keep(float L, float fp) { return 1.0 - smoothstep(L * 0.12, L * 0.4, fp); }

void main() {
  #include <logdepthbuf_fragment>
  vec2 m = vXZ;
  // the pixel's footprint on the sea (m)
  vec2 fw = fwidth(m);
  float fp = sqrt(fw.x * fw.y) * 1.5 + 0.15 * max(fw.x, fw.y);
  // gusts: broad patches of rougher and smoother water (the mean square slope still the measured one)
  float rough = 0.8 + 0.4 * smoothstep(0.2, 0.8, vGust);
  vec2 s = vec2(0.0);
  float varU = ${MSS_UNRESOLVED.toFixed(5)}; // the slopes no texel resolves (Cox & Munk's remainder)
  float crest = 0.0;
  // the swell (analytic), and the slope it leaves unresolved where too fine for the pixel
  vec2 mx = dFdx(m);
  vec2 my = dFdy(m);
  ${WAVE_SUM(
    (i) => `{ float kk = keep(A${i}.z, abs(dot(W${i}.xy, mx)) + abs(dot(W${i}.xy, my))); float sl = A${i}.x * W${i}.z;
    if (kk > 0.0) { float ph = W${i}.z * dot(W${i}.xy, m) - W${i}.w * uTime; s += W${i}.xy * (sl * cos(ph)) * kk; }
    varU += (1.0 - kk) * 0.5 * sl * sl; }`
  )}
  // the wind sea, band A (1.8-25 m): resolved slopes, and what the filtering left as roughness
  if (fp < 20.0) {
${bandGLSL("uBandA", SA, "A", BAND_A, 3.0)}
  } else varU += ${BAND_A.mss.toFixed(5)} * rough * rough;
  // band B (ripples, 8 cm-1.8 m): drawn only where a pixel resolves them; beyond, their slopes are roughness
  if (fp < 0.9) {
${bandGLSL("uBandB", SB, "B", BAND_B, 0.6)}
  } else varU += ${BAND_B.mss.toFixed(5)} * rough * rough;

  // the splash: churned white water, ragged, spreading and breaking up; small broken ripples
  float churn = 0.0;
  float foam = 0.0;
  vec2 sp = m - uSplash.xy;
  float spR = length(sp);
  vec2 hp = m - uHull.xy;
  float hr = length(hp);
  // the foam's small-scale noise, only where there is foam (round the splash and the hull)
  float n1 = 0.5;
  float n2 = 0.5;
  if ((uSplash.w > 0.5 && spR < 16.0) || (uHull.z > 0.5 && hr < 7.0)) {
    n1 = texture2D(uNoise2, m / 2.7 + vec2(0.0, 0.04) * uTime).r;
    n2 = texture2D(uNoise2, m / 0.83 - vec2(0.03, 0.0) * uTime).r;
  }
  if (uSplash.w > 0.5 && uSplash.z < 9.0 && spR < 16.0) {
    float t = uSplash.z;
    float reach = 2.2 + 3.6 * (1.0 - exp(-t / 1.3)) + 2.2 * (n1 - 0.5);
    float patchy = smoothstep(0.35, 0.65, n1 * 0.55 + n2 * 0.45 + 0.25 * exp(-t / 1.5));
    churn = smoothstep(reach, reach * 0.45, spR) * patchy * exp(-t / 2.2) * smoothstep(0.0, 0.1, t);
    float front = spR - ${SPLASH_SEA.rippleSpeed.toFixed(2)} * t;
    float packet = exp(-front * front / (1.4 + t)) * exp(-t / 2.0) * (1.0 - smoothstep(5.0, 8.0, t)) * (0.35 + 0.65 * n1);
    s += normalize(sp + 1e-4) * sin(front * 4.2) * packet * 0.16;
  }
  // round the floating hull: a thin, broken foam lace and the lapping meniscus at the waterline
  if (uHull.z > 0.5 && hr < 7.0) {
    float t = uSplash.z;
    // (broken and sparse: streaks of foam, never a ring painted round the hull)
    float lace = smoothstep(0.66, 0.84, n2 * 0.6 + n1 * 0.4 + 0.08 * crest);
    float reach = ${SPLASH_SEA.hullR.toFixed(2)} + 0.25 + 1.2 * n1 + 1.4 * exp(-t / 6.0);
    float zone = smoothstep(reach, ${SPLASH_SEA.hullR.toFixed(2)}, hr);
    float lap = 0.5 + 0.5 * sin(uTime * 1.7 + atan(hp.y, hp.x) * 4.0 + n1 * 6.0);
    float line = smoothstep(${(SPLASH_SEA.hullR + 0.3).toFixed(2)}, ${SPLASH_SEA.hullR.toFixed(2)}, hr - 0.22 * n2) * (0.12 + 0.3 * lap) * smoothstep(0.4, 0.65, n2);
    foam = max(zone * lace * (0.1 + 0.4 * exp(-t / 6.0)), line);
  }

  vec3 n = normalize(vec3(-s.x, 1.0, -s.y));
  vec3 v = normalize(cameraPosition - vPos);
  float ndv = max(dot(n, v), 0.002);
  float sig2 = varU;
  // Fresnel (water, n = 1.33), held below a mirror's at grazing angles by the facets' masking
  float f1 = 1.0 - ndv;
  float f2 = f1 * f1;
  float F = min(0.02 + 0.98 * f2 * f2 * f1, 0.78);
  // the sky it reflects: the rougher the sea, the higher (bluer, darker) the sky it sees
  vec3 r = reflect(-v, n);
  r.y = abs(r.y);
  vec3 refl = skyColor(normalize(r + vec3(0.0, 1.3 * sqrt(sig2), 0.0)));
  // the cumulus' shadow here (from the clouds' own weather map, cast along the Sun)
  float shadow = vShadow;
  // the water itself: deep navy, a little green-blue light through the crests towards the Sun
  vec3 body = vec3(0.0045, 0.026, 0.06) * (0.5 + 0.5 * uGlow) * (1.0 - 0.3 * shadow);
  float crestN = clamp(crest / 0.32, 0.0, 1.0);
  float toward = pow(max(dot(normalize(vec3(-v.x, 0.0, -v.z) + 1e-5), normalize(vec3(uSun.x, 0.0, uSun.z) + 1e-5)), 0.0), 3.0);
  body += vec3(0.0, 0.045, 0.042) * crestN * crestN * toward * (1.0 - smoothstep(80.0, 3000.0, vDist)) * (1.0 - shadow);
  vec3 col = (1.0 - F) * body + F * refl;
  // the Sun's glitter: the slopes facing it, from the same slope statistics (Cox & Munk)
  vec3 hv = normalize(v + uSun);
  float hn = max(dot(hv, n), 1e-3);
  float hn2 = hn * hn;
  float sc2 = max(sig2 * 0.5, 2e-4);
  float D = exp(-((1.0 - hn2) / hn2) / (2.0 * sc2)) / (6.2831853 * sc2 * hn2 * hn2);
  float vh = max(dot(v, hv), 0.0);
  float vh1 = 1.0 - vh;
  float Fs = 0.02 + 0.98 * vh1 * vh1 * vh1 * vh1 * vh1;
  float spec = min(Fs * D / (4.0 * ndv), 80.0) * max(uSun.y, 0.0);
  col += vec3(1.0, 0.95, 0.86) * spec * 0.55 * uGlow * (1.0 - shadow);
  // a few small whitecaps on the highest crests of the wind sea, near enough to be seen
  // (a 6 m/s breeze breaks very few: on the highest crests, in the gusts; rare, small, soft-edged)
  float wc = smoothstep(0.36, 0.5, crest) * smoothstep(0.55, 0.85, vGust) * (1.0 - smoothstep(1.0, 6.0, fp));
  // aerated water and foam: white, a little blue-green in the churn
  col = mix(col, vec3(0.6, 0.72, 0.74) * (0.7 + 0.3 * uGlow), clamp(churn, 0.0, 1.0) * 0.8);
  col = mix(col, vec3(0.88, 0.92, 0.93) * (0.72 + 0.28 * uGlow) * (1.0 - 0.3 * shadow), clamp(max(foam, wc * 0.45), 0.0, 1.0));
  // haze: into the sky's own colour at the horizon in this direction
  float hz = 1.0 - exp(-vDist / uHazeL);
  col = mix(col, vHaze, clamp(hz, 0.0, 1.0));
  gl_FragColor = vec4(col, uFade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// The wind-sea bands as textures: half-float RGBA (sx, sz, h, sx² + sz²) with their mip chain made
// here (box-filtered: the mean slope and mean square slope of each footprint), so no device has to
// build mipmaps of a float texture itself.
function toHalf(f32) {
  const out = new Uint16Array(f32.length);
  for (let i = 0; i < f32.length; i++) out[i] = THREE.DataUtils.toHalfFloat(f32[i]);
  return out;
}
function bandTexture(band) {
  const b = oceanBand(band);
  let level = packBand(b);
  let n = b.N;
  const levels = [{ data: toHalf(level), width: n, height: n }];
  while (n > 1) {
    const h = n >> 1;
    const next = new Float32Array(h * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < h; x++)
        for (let c = 0; c < 4; c++) {
          const a = (i, j) => level[((2 * y + j) * n + (2 * x + i)) * 4 + c];
          next[(y * h + x) * 4 + c] = (a(0, 0) + a(1, 0) + a(0, 1) + a(1, 1)) * 0.25;
        }
    level = next;
    n = h;
    levels.push({ data: toHalf(level), width: n, height: n });
  }
  const t = new THREE.DataTexture(levels[0].data, b.N, b.N, THREE.RGBAFormat, THREE.HalfFloatType);
  t.mipmaps = levels;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 2;
  t.needsUpdate = true;
  return t;
}
let BANDS = null;
function flatBand() {
  const t = new THREE.DataTexture(toHalf(new Float32Array([0, 0, 0, 0])), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  t.needsUpdate = true;
  return t;
}

export default function Ocean({ simRef, viewRef, atmo }) {
  const mesh = useRef();
  const geo = useMemo(() => polarGrid(), []);
  const flat = useMemo(() => flatBand(), []);
  const blank = useMemo(() => {
    const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    t.needsUpdate = true;
    return t;
  }, []);
  const mat = useMemo(() => {
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
        uGlow: { value: 1 },
        uHazeL: { value: 20000 },
        uBandA: { value: BANDS ? BANDS.A : flat },
        uBandB: { value: BANDS ? BANDS.B : flat },
        uNoise2: { value: noiseTexture() },
        uCloudMap: { value: blank },
        uCloudOn: { value: 0 },
        uCloudMapM: { value: CUMULUS.mapM },
        uColumn: { value: new THREE.Vector2(COLUMN.x, COLUMN.z) },
        uWindOff: { value: new THREE.Vector2() },
        uCloudMid: { value: (CUMULUS.baseM + CUMULUS.topMinM) / 2 + 150 },
        uSplash: { value: new THREE.Vector4(0, 0, 0, 0) },
        uHull: { value: new THREE.Vector3(0, 0, 0) },
      },
      vertexShader,
      fragmentShader,
      transparent: false,
      depthWrite: true,
    });
    return m;
  }, [atmo, flat, blank]);
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
      flat.dispose();
      blank.dispose();
    },
    [geo, mat, flat, blank]
  );
  // the wind sea's bands, made in steps after the scene has opened (cached for the next scene)
  useEffect(() => {
    if (BANDS) return undefined;
    let alive = true;
    let A = null;
    const id1 = setTimeout(() => {
      if (alive) A = bandTexture(BAND_A);
    }, 200);
    const id2 = setTimeout(() => {
      if (!alive || !A) return;
      BANDS = { A, B: bandTexture(BAND_B) };
      mat.uniforms.uBandA.value = BANDS.A;
      mat.uniforms.uBandB.value = BANDS.B;
    }, 320);
    return () => {
      alive = false;
      clearTimeout(id1);
      clearTimeout(id2);
    };
  }, [mat]);

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
    U.uGlow.value = atmo.glow ?? 1;
    if (BANDS && U.uBandA.value !== BANDS.A) {
      U.uBandA.value = BANDS.A;
      U.uBandB.value = BANDS.B;
    }
    if (atmo.cloudMap) {
      U.uCloudMap.value = atmo.cloudMap;
      U.uCloudOn.value = 1;
      if (atmo.windOff) U.uWindOff.value.copy(atmo.windOff);
    }
    // thicker haze low over the sea; long sight lines from high up
    U.uHazeL.value = hazeLength(s.h);
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
