import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { planetTexture } from "@/components/planets/planetMaterials";
import { M_PER_UNIT, R_EARTH_U, WAVES, waveSpeed, CLOUD_FIELD, SPLASH } from "@/data/descentScene";

/*
 * The open sea below the capsule (data/descentScene: one scale, 1 unit = 3.9 m).
 *
 * Geometry: a polar grid centred under the camera (fine near the middle, coarse far out, 4 m to
 * 450 km), following it, the surface falling away with the Earth's curvature, so the horizon is
 * the sea's own and the grid's rim lies beyond it, lost in the haze: no edge, no tiling square.
 *
 * Shading (one shader, per pixel):
 * - the swell and wind waves of data/descentScene WAVES (real sizes; the floating capsule rides
 *   the same sum), displaced near the camera and as normals everywhere they resolve;
 * - two scales of detail normals (a procedural tileable noise map, offset and rotated so it never
 *   visibly repeats), faded with distance where they would only shimmer;
 * - Fresnel: dark navy water looking down, the sky's reflection towards the horizon; the Sun's
 *   glint, sharp near by and widening into a glitter path far away (roughness by distance);
 * - the shadows of the 3D cumulus field, and beyond it the NASA Blue Marble cloud cover (the same
 *   map the Earth wears in orbit), so the view from 20 km matches the planet seen from space;
 * - haze into the sky's horizon colour with distance (the sky dome's own colours);
 * - the splash: the impact ring running outward, the foam patch and its slow fade.
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

/** A tileable noise normal map (256², procedural; made once, no file to load). */
let DETAIL = null;
function detailNormals() {
  if (DETAIL) return DETAIL;
  const N = 256;
  const h = new Float32Array(N * N);
  // a sum of random periodic waves (integer frequencies on the tile: it wraps seamlessly)
  let s = 12345;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const waves = [];
  for (let i = 0; i < 48; i++) {
    const f = 2 + Math.floor(Math.pow(r(), 1.6) * 22);
    const a = r() * Math.PI * 2;
    waves.push({ fx: Math.round(Math.cos(a) * f), fy: Math.round(Math.sin(a) * f), ph: r() * Math.PI * 2, amp: 1 / Math.pow(f, 1.1) });
  }
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let v = 0;
      for (const w of waves) v += w.amp * Math.sin(((w.fx * x + w.fy * y) / N) * Math.PI * 2 + w.ph);
      h[y * N + x] = v;
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
      data[o + 3] = 255;
    }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  DETAIL = t;
  return t;
}

const WAVE_GLSL = WAVES.map((w, i) => {
  const k = (2 * Math.PI) / w.len;
  return `const vec4 W${i} = vec4(${Math.cos(w.dir).toFixed(5)}, ${Math.sin(w.dir).toFixed(5)}, ${k.toFixed(6)}, ${(k * waveSpeed(w.len)).toFixed(6)});
const vec2 A${i} = vec2(${w.amp.toFixed(4)}, ${w.steep.toFixed(3)});`;
}).join("\n");
const WAVE_SUM = (fn) => WAVES.map((_, i) => fn(i)).join("\n");

const vertexShader = `
uniform vec3 uCam;
uniform float uSeaY;
uniform vec2 uDrift;
uniform float uTime;
${WAVE_GLSL}
varying vec2 vXZ;      // world position on the sea, metres (drift included)
varying vec3 vPos;     // scene position
varying float vDist;   // horizontal distance from the camera, units
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
uniform sampler2D uCover;
uniform vec2 uCoverUV;     // the recovery area's place on the NASA map
uniform vec2 uCoverScale;  // map uv per metre
uniform sampler2D uShadow; // the cumulus field's shadows on the sea (baked once)
uniform float uShadowSize; // metres across
uniform vec4 uSplash;      // x, z (m), seconds since contact, on
${WAVE_GLSL}
varying vec2 vXZ;
varying vec3 vPos;
varying float vDist;
#include <logdepthbuf_pars_fragment>

vec3 sky(vec3 r) {
  float k = pow(clamp(r.y, 0.0, 1.0), 0.45);
  vec3 c = mix(uSkyHor, uSkyTop, k);
  float sd = max(dot(r, uSun), 0.0);
  return c + vec3(1.0, 0.92, 0.8) * (pow(sd, 8.0) * 0.18);
}

void main() {
  #include <logdepthbuf_fragment>
  vec2 m = vXZ;
  // the waves' normal (analytic)
  vec2 g = vec2(0.0);
  ${WAVE_SUM((i) => `{ float ph = W${i}.z * dot(W${i}.xy, m) - W${i}.w * uTime; g += W${i}.xy * (A${i}.x * W${i}.z * cos(ph)); }`)}
  float far = smoothstep(60.0, 2500.0, vDist); // 0 near by .. 1 far away
  g *= 1.0 - 0.9 * far; // waves too fine for the pixel: let the roughness carry them
  // detail: two scales, turned against each other, faded with distance (skipped where invisible)
  float dk = exp(-vDist / 260.0);
  if (dk > 0.02) {
    vec2 u1 = m / 9.0 + vec2(0.021, 0.013) * uTime;
    vec2 u2 = mat2(0.8, -0.6, 0.6, 0.8) * m / 3.1 + vec2(-0.017, 0.031) * uTime;
    vec3 d1 = texture2D(uDetail, u1).xyz * 2.0 - 1.0;
    vec3 d2 = texture2D(uDetail, u2).xyz * 2.0 - 1.0;
    g += (d1.xy * 0.22 + d2.xy * 0.14) * dk;
  }

  // the splash: the impact ring running out, its ripples and foam
  float foam = 0.0;
  if (uSplash.w > 0.5) {
    vec2 sp = m - uSplash.xy;
    float r = length(sp);
    float t = uSplash.z;
    float rr = ${(SPLASH.ringSpeed * M_PER_UNIT).toFixed(2)} * t;
    float fall = exp(-t / 7.0);
    float ring = exp(-pow((r - rr) / (0.7 + 0.12 * t), 2.0));
    float rip = sin((r - rr) * 2.4) * ring * fall * 0.45;
    g += normalize(sp + 1e-4) * rip;
    // the ring's foam, broken up: spray falling back, not a drawn circle
    float brkF = texture2D(uDetail, m / 2.5).x;
    foam += ring * fall * 0.3 * smoothstep(0.35, 0.75, brkF) * exp(-t / 2.5);
    foam += smoothstep(4.5 + 0.3 * t, 0.0, r) * exp(-t / 14.0) * 0.6 * smoothstep(0.0, 0.25, t) * (0.55 + 0.45 * texture2D(uDetail, m / 3.7).y);
  }

  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 v = normalize(cameraPosition - vPos);
  float ndv = max(dot(n, v), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  fres *= 1.0 - 0.35 * far; // rough at a distance: less of a mirror
  vec3 r = reflect(-v, n);
  r.y = abs(r.y);
  vec3 refl = sky(r) * 0.82;
  // the water itself: deep navy, lifted a little where light comes through the crests
  float crest = clamp(g.x * uSun.x + g.y * uSun.z, 0.0, 1.0);
  vec3 body = vec3(0.005, 0.026, 0.07) + vec3(0.0, 0.05, 0.06) * crest * (1.0 - far) + vec3(0.006, 0.02, 0.045) * max(uSun.y, 0.0);
  vec3 col = mix(body, refl, fres);
  // the Sun's glint: sharp near, a wide glitter path far away
  vec3 h = normalize(v + uSun);
  float shin = mix(900.0, 70.0, far);
  float spec = pow(max(dot(n, h), 0.0), shin) * (shin + 8.0) / 25.0;
  col += vec3(1.0, 0.95, 0.86) * spec * 0.06;

  // cloud shadows (the 3D field) and, beyond it, the NASA cloud cover
  float shade = texture2D(uShadow, m / uShadowSize + 0.5).r;
  float farCover = smoothstep(${(CLOUD_FIELD.radius * 0.6).toFixed(0)}.0, ${(CLOUD_FIELD.radius * 1.05).toFixed(0)}.0, vDist);
  float cover = 0.0;
  if (farCover > 0.001) {
    float c0 = texture2D(uCover, uCoverUV + m * uCoverScale).b;
    float brk = texture2D(uDetail, m / 2300.0).x;
    cover = smoothstep(0.55, 0.85, c0 * 0.85 + brk * 0.45);
  }
  shade = max(shade, cover * 0.7 * farCover);
  col *= 1.0 - 0.5 * shade;
  vec3 cloudLit = vec3(0.86, 0.89, 0.93) * (0.75 + 0.25 * max(uSun.y, 0.0));
  col = mix(col, cloudLit, cover * farCover * 0.35);

  col = mix(col, vec3(0.93, 0.97, 0.98), clamp(foam, 0.0, 1.0));
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
    if (sp && sp.on) U.uSplash.value.set(sp.x * M_PER_UNIT + atmo.drift * M_PER_UNIT, sp.z * M_PER_UNIT, sp.t, 1);
    else U.uSplash.value.w = 0;
  });

  return <mesh ref={mesh} geometry={geo} material={mat} frustumCulled={false} renderOrder={-1} name="ocean" />;
}
