import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { cloudField, CLOUD_FIELD, M_PER_UNIT } from "@/data/descentScene";

/*
 * The cumulus field (data/descentScene cloudField), drawn as volumes: one instanced mesh, one draw
 * call, a few hundred puffs at their true heights above the sea (bases 650–950 m).
 *
 * Each puff is an ellipsoid of vapour. Its mesh is only a bound (a low-poly icosahedron round
 * the ellipsoid, drawn by its back faces, so it works with the camera outside, beside or inside
 * it); every pixel then traces its own view ray through the ellipsoid, analytically:
 * - where the ray enters and leaves it, clipped at the cloud's flat base (the condensation level);
 * - how much vapour it crosses (the integral of a density highest at the centre), which gives the
 *   opacity: dense cores, thin soft edges, and a thin veil when the camera is inside a wisp;
 * - a 3D noise sampled in world space along the ray erodes the edges into billows, fixed to the
 *   cloud (it moves with it in parallax, never with the screen);
 * - the light of the scene's Sun on the surface the ray meets: the puff's own roundness blended
 *   with the whole cloud's, so the sunward side and the tops are bright, the far side and the
 *   flat base in blue-grey shadow; light glowing through thin edges towards the Sun;
 * - the haze of distance, into the sky's own horizon colour.
 * No sprite, no flat card turned to the camera. Back to front sorted, no near fade: the capsule's
 * column is kept clear of cloud (data/descentScene), so nothing ever passes through the capsule.
 */

let NOISE = null;
/** A tileable 128² value-noise texture (procedural, shared). */
export function noiseTexture() {
  if (NOISE) return NOISE;
  const N = 128;
  const data = new Uint8Array(N * N * 4);
  let s = 777;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const waves = [];
  for (let i = 0; i < 40; i++) {
    const f = 1 + Math.floor(Math.pow(r(), 1.4) * 14);
    const a = r() * Math.PI * 2;
    waves.push({ fx: Math.round(Math.cos(a) * f), fy: Math.round(Math.sin(a) * f), ph: r() * Math.PI * 2, amp: 1 / f });
  }
  let mn = Infinity;
  let mx = -Infinity;
  const h = new Float32Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let v = 0;
      for (const w of waves) v += w.amp * Math.sin(((w.fx * x + w.fy * y) / N) * Math.PI * 2 + w.ph);
      h[y * N + x] = v;
      mn = Math.min(mn, v);
      mx = Math.max(mx, v);
    }
  for (let i = 0; i < N * N; i++) {
    const v = Math.round(((h[i] - mn) / (mx - mn)) * 255);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  NOISE = t;
  return t;
}

// The bound: an icosahedron (20 faces) scaled to contain the unit sphere (1 / its inradius). The
// trace is analytic, so the bound only has to cover the puff: few, larger triangles are cheaper to
// raster than many small ones.
const BOUND_SCALE = 1.2585;

const vertexShader = `
attribute vec4 aPuff;   // centre (x, y, z: field units) and radius
attribute vec4 aCloud;  // the cloud's centre x, z, its base and top (field units)
attribute vec3 aMisc;   // vertical squash, density, seed
uniform float uFieldR;
varying vec3 vWorld;
varying vec4 vPuff;
varying vec4 vCloud;
varying vec3 vMisc;
varying float vRim;
void main() {
  vec3 o = vec3(modelMatrix[3][0], modelMatrix[3][1], modelMatrix[3][2]); // the field's offset (drift, sea level)
  vec3 c = aPuff.xyz + o;
  vec3 lp = position * ${BOUND_SCALE.toFixed(4)} * aPuff.w;
  lp.y *= aMisc.x;
  vec3 wp = c + lp;
  vWorld = wp;
  vPuff = vec4(c, aPuff.w);
  vCloud = vec4(aCloud.x + o.x, aCloud.y + o.z, aCloud.z + o.y, aCloud.w + o.y);
  vMisc = aMisc;
  // the field's rim, round the camera
  vRim = 1.0 - smoothstep(uFieldR * 0.78, uFieldR, length(c.xz - cameraPosition.xz));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

// The ray through one puff (shared by the depth pre-pass and the colour pass): where it enters and
// leaves the ellipsoid, clipped at the cloud's flat base, and the vapour it crosses (tau, 0..1).
const TRACE = `
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorld - ro);
  float r = vPuff.w;
  vec3 sq = vec3(1.0, 1.0 / vMisc.x, 1.0) / r; // into the unit sphere's space
  vec3 o = (ro - vPuff.xyz) * sq;
  vec3 d = rd * sq;
  float a = dot(d, d);
  float b = dot(o, d);
  float c = dot(o, o) - 1.0;
  float disc = b * b - a * c;
  if (disc <= 0.0) discard;
  float sd = sqrt(disc);
  float t0 = (-b - sd) / a;
  float t1 = (-b + sd) / a;
  // the cloud's flat base: only the vapour above the condensation level
  float base = vCloud.z;
  bool onBase = false;
  if (abs(rd.y) > 1e-5) {
    float tp = (base - ro.y) / rd.y;
    if (rd.y > 0.0) { if (tp > t0) { t0 = tp; onBase = true; } }
    else t1 = min(t1, tp);
  } else if (ro.y < base) discard;
  bool inside = t0 < 0.0;
  t0 = max(t0, 0.0);
  if (t1 <= t0) discard;
  // the vapour crossed: the integral of (1 - |p|²) along the ray, against the most a ray can cross (4r/3)
  float A0 = a * t0 * t0 * t0 / 3.0 + b * t0 * t0 + (c + 1.0) * t0;
  float A1 = a * t1 * t1 * t1 / 3.0 + b * t1 * t1 + (c + 1.0) * t1;
  float tau = ((t1 - t0) - (A1 - A0)) / (1.3333 * r);
`;

const fragmentShader = `
uniform sampler2D uNoise;
uniform vec3 uSun;
uniform vec3 uSkyTop;
uniform vec3 uSkyHor;
uniform vec3 uHaze;
uniform float uHazeL;
uniform float uOpacity;
uniform float uPix;  // the width of one of the buffer's pixels per unit of distance
varying vec3 vWorld;
varying vec4 vPuff;
varying vec4 vCloud;
varying vec3 vMisc;
varying float vRim;

// The clouds are drawn into their own (half-resolution) buffer, where three.js applies no tone
// mapping and no output encoding: the same ACES filmic curve and sRGB encoding as the rest of the
// scene are applied here, so the clouds composite over the frame exactly as if drawn into it.
vec3 lvRRT(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 lvAces(vec3 c) {
  const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  return clamp(O * lvRRT(I * (c / 0.6)), 0.0, 1.0);
}
vec3 lvSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// a 3D-looking noise from two skewed projections of the tileable 2D noise (two lookups)
float n3(vec3 p) {
  float a = texture2D(uNoise, p.xz + vec2(0.0, p.y * 0.71)).r;
  float b = texture2D(uNoise, p.zy * vec2(0.93, 1.0) + vec2(p.x * 0.57, 0.31)).r;
  return (a + b) * 0.5;
}

void main() {
  if (vRim < 0.002) discard;
${TRACE}  // billows: noise along the ray erodes the thin parts into a crisp, irregular, billowing edge;
  // one octave at the puff's own scale (seeded per puff), one fine, both fixed in world space
  vec3 pm = ro + rd * (0.5 * (t0 + t1));
  float nb = n3(pm / (r * 0.8) + vMisc.z * 7.31);
  // the fine billows only where a pixel can hold them (beyond, their average: no lookups, no speckle)
  float foot = t0 * uPix;
  float fineK = 1.0 - smoothstep(4.0, 16.0, foot);
  float nf = 0.5;
  if (fineK > 0.0) nf = mix(0.5, n3(pm / 21.0 + 0.37), fineK);
  float n = nb * 0.6 + nf * 0.4;
  // far away, where a puff spans a few pixels: the cloud reads as one mass, not as its puffs
  // (less of each puff's own thin edge eaten away, so no notch where two puffs meet)
  float farK = 1.0 - smoothstep(3.0, 14.0, r / max(foot, 1e-4));
  float dens = vMisc.y;
  float erode = mix(0.42, 0.75, 1.0 - dens) * mix(1.0, 0.5, farK); // a wisp is mostly eaten away: ragged
  float tv = max(0.0, tau - (n - 0.36) * erode) * dens;
  float alpha = 1.0 - exp(-24.0 * mix(1.0, 1.7, farK) * tv);
  // from inside a wisp: a veil, never a white-out
  if (inside) alpha *= 0.7;
  alpha *= vRim * uOpacity;
  if (alpha < 0.004) discard;

  // the surface the ray meets, and how it faces the Sun
  vec3 pe = ro + rd * t0;
  vec3 np = inside ? -rd : normalize((pe - vPuff.xyz) * sq * sq * r);
  float H = max(vCloud.w - base, 1.0);
  float R = max(H * 0.6, r);
  vec3 cc = vec3(vCloud.x, base + H * 0.38, vCloud.y);
  vec3 nc = normalize((pe - cc) / vec3(R, H * 0.62, R));
  vec3 nrm = normalize(mix(nc, np, mix(0.45, 0.15, farK)) + (vec3(nb, nf, 1.0 - nb) - 0.5) * 0.5);
  // the folds between billows (a puff's surface turned in towards its cloud) lie in shadow
  // (too small to see far away, where they would only draw a dark ring round each puff)
  float fold = mix(smoothstep(-0.35, 0.55, dot(np, nc)), 1.0, farK * 0.7);
  float hy = clamp((pe.y - base) / H, 0.0, 1.0);
  float diff = clamp(dot(nrm, uSun) * 0.6 + 0.4, 0.0, 1.0);
  diff *= diff * (3.0 - 2.0 * diff);
  // the cloud's own shadow: the side of the whole cloud away from the Sun
  float self = smoothstep(-0.65, 0.45, dot(nc, uSun));
  // light lost low down in the cloud (its mass above and round it), and in the billows' folds
  float ao = mix(0.45, 1.0, smoothstep(0.0, 0.7, hy)) * (0.72 + 0.4 * nb) * mix(0.5, 1.0, fold);
  vec3 sunCol = vec3(1.0, 0.96, 0.9) * 1.1;
  vec3 skyAmb = mix(uSkyHor, uSkyTop, 0.5) * 0.22 + vec3(0.18, 0.22, 0.29);
  vec3 lowAmb = vec3(0.2, 0.23, 0.28);
  vec3 amb = mix(lowAmb, skyAmb, clamp(nrm.y * 0.5 + 0.5, 0.0, 1.0));
  vec3 col = amb * ao * (0.85 + 0.3 * nf) + sunCol * diff * self * ao;
  // the flat base: grey, lit from below by the sea and through the cloud's thin edges
  if (onBase) col = vec3(0.21, 0.24, 0.29) * (0.75 + 0.5 * nf) * mix(1.25, 0.8, smoothstep(0.05, 0.5, tau)) * (0.8 + 0.2 * self);
  // thin vapour lit from behind glows (towards the Sun)
  float fwd = max(dot(rd, uSun), 0.0);
  fwd *= fwd;
  fwd *= fwd * fwd;
  col += sunCol * fwd * (1.0 - alpha) * 0.4;
  // a wisp is lighter and greyer
  col = mix(col, mix(amb, sunCol * 0.7, 0.5), (1.0 - dens) * 0.6);
  // the haze of distance
  float dist = inside ? 0.0 : t0;
  float hz = 1.0 - exp(-dist / uHazeL);
  col = mix(col, uHaze, clamp(hz, 0.0, 0.94));
  gl_FragColor = vec4(lvSRGB(lvAces(col)), alpha * (1.0 - 0.3 * hz));
}`;

// The composite: the clouds' buffer laid over the frame (premultiplied), a full-screen triangle.
const compositeVertex = `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;
const compositeFragment = `
uniform sampler2D uTex;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uTex, vUv);
}`;
/** The clouds' buffer, as a fraction of the frame's size on each side (under a fifth of the pixels). */
export const CLOUD_RESOLUTION = 0.42;
const _size = new THREE.Vector2();
const _clear = new THREE.Color();

const _v = new THREE.Vector3();

export default function CloudField({ simRef, atmo, passRef = null }) {
  const field = useMemo(() => cloudField(), []);
  const n = field.puffs.length;
  const { geo, aPuff, aCloud, aMisc, order } = useMemo(() => {
    // indexed: its 12 corners shaded once each per puff, not once per face (60)
    const ico = new THREE.IcosahedronGeometry(1, 0);
    ico.deleteAttribute("normal");
    ico.deleteAttribute("uv");
    const base = mergeVertices(ico);
    ico.dispose();
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex(base.index);
    g.attributes.position = base.attributes.position;
    const p = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    const c = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    const m = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    [p, c, m].forEach((x) => x.setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aPuff", p);
    g.setAttribute("aCloud", c);
    g.setAttribute("aMisc", m);
    g.instanceCount = n;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    return { geo: g, aPuff: p, aCloud: c, aMisc: m, order: field.puffs.map((_, i) => i) };
  }, [field, n]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uNoise: { value: noiseTexture() },
          uSun: { value: atmo.sun },
          uSkyTop: { value: atmo.top },
          uSkyHor: { value: atmo.hor },
          uHaze: { value: atmo.haze },
          uHazeL: { value: 20000 },
          uOpacity: { value: 1 },
          uFieldR: { value: CLOUD_FIELD.radius },
          uPix: { value: 0.005 },
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
        side: THREE.BackSide,
      }),
    [atmo]
  );
  // The clouds live in their own scene, drawn at reduced resolution into their own buffer before the
  // frame's main pass (CloudPass, after the camera has moved: never in the middle of the frame,
  // which on a phone's tile-based GPU would write the whole frame out to memory and read it back),
  // then laid over the sky and the sea and under the capsule and its parachutes (which the cloud
  // field's placement keeps in front of every cloud). The volumes stay soft-edged, the spacecraft sharp.
  const cloudMesh = useMemo(() => {
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.name = "cloud-field";
    return m;
  }, [geo, mat]);
  const cloudScene = useMemo(() => {
    const sc = new THREE.Scene();
    sc.add(cloudMesh);
    return sc;
  }, [cloudMesh]);
  const rt = useMemo(() => new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false }), []);
  const compMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTex: { value: rt.texture } },
        vertexShader: compositeVertex,
        fragmentShader: compositeFragment,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      }),
    [rt]
  );
  const tri = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    return g;
  }, []);
  useEffect(() => () => {
    geo.dispose();
    mat.dispose();
    rt.dispose();
    compMat.dispose();
    tri.dispose();
  }, [geo, mat, rt, compMat, tri]);
  const drawClouds = useMemo(
    () => (renderer, _scene, camera) => {
      if (!cloudMesh.visible) return;
      renderer.getDrawingBufferSize(_size);
      const w = Math.max(2, Math.ceil(_size.x * CLOUD_RESOLUTION));
      const h = Math.max(2, Math.ceil(_size.y * CLOUD_RESOLUTION));
      if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
      mat.uniforms.uPix.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / h;
      const prevTarget = renderer.getRenderTarget();
      const prevAuto = renderer.autoClear;
      const prevAlpha = renderer.getClearAlpha();
      renderer.getClearColor(_clear);
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
      renderer.autoClear = false;
      renderer.render(cloudScene, camera);
      renderer.autoClear = prevAuto;
      renderer.setClearColor(_clear, prevAlpha);
      renderer.setRenderTarget(prevTarget);
    },
    [cloudMesh, cloudScene, rt, mat]
  );
  useEffect(() => {
    if (!passRef) return undefined;
    passRef.current = drawClouds;
    return () => {
      if (passRef.current === drawClouds) passRef.current = null;
    };
  }, [passRef, drawClouds]);
  const comp = useRef();
  const frame = useRef(0);
  const dist = useMemo(() => new Float32Array(n), [n]);

  useFrame((state) => {
    const s = simRef.current;
    if (!s) return;
    const low = atmo.low;
    cloudMesh.visible = low > 0.004;
    if (comp.current) comp.current.visible = cloudMesh.visible;
    if (!cloudMesh.visible) return;
    // the field stands on the sea, which drifts by under the capsule
    cloudMesh.position.set(-atmo.drift, atmo.seaY, 0);
    cloudMesh.updateMatrixWorld();
    const U = mat.uniforms;
    U.uOpacity.value = low;
    U.uHazeL.value = 16000 + Math.min(1, Math.max(0, s.h) / 9000) * 34000;
    // back to front, every other frame (a few hundred distances)
    if (frame.current++ % 2 === 0) {
      const cam = state.camera.position;
      const P = field.puffs;
      const C = field.clouds;
      const ox = -atmo.drift;
      const oy = atmo.seaY;
      for (let i = 0; i < n; i++) {
        const q = P[i];
        _v.set(q.x + ox - cam.x, q.y + oy - cam.y, q.z - cam.z);
        dist[i] = _v.lengthSq();
      }
      order.sort((a, b) => dist[b] - dist[a]);
      const pa = aPuff.array;
      const ca = aCloud.array;
      const ma = aMisc.array;
      for (let k = 0; k < n; k++) {
        const q = P[order[k]];
        const cl = C[q.cloud];
        pa[k * 4] = q.x;
        pa[k * 4 + 1] = q.y;
        pa[k * 4 + 2] = q.z;
        pa[k * 4 + 3] = q.r;
        ca[k * 4] = cl.x;
        ca[k * 4 + 1] = cl.z;
        ca[k * 4 + 2] = cl.base;
        ca[k * 4 + 3] = cl.top;
        ma[k * 3] = q.sy;
        ma[k * 3 + 1] = q.dens;
        ma[k * 3 + 2] = q.seed;
      }
      aPuff.needsUpdate = true;
      aCloud.needsUpdate = true;
      aMisc.needsUpdate = true;
    }
  });

  // after the sky (-2) and the sea (-1), before the capsule and the parachutes
  return <mesh ref={comp} geometry={tri} material={compMat} frustumCulled={false} renderOrder={-0.5} onBeforeRender={passRef ? undefined : drawClouds} name="cloud-composite" />;
}

/**
 * The cloud field's own pass (CloudField passRef), run before the frame's main pass. Mount it after
 * the camera rig, so the clouds are drawn from this frame's camera.
 */
export function CloudPass({ passRef }) {
  useFrame((state) => {
    if (passRef.current) passRef.current(state.gl, state.scene, state.camera);
  });
  return null;
}

/**
 * The field's shadows on the sea, baked once into a 512² texture for the ocean shader (one lookup
 * per pixel, no loop): each formation's footprint cast along the Sun from its mid-height.
 * Returns { texture, size (metres across), } centred on the field's origin (ground coordinates).
 */
let SHADOW = null;
export function cloudShadowMap(sun) {
  if (SHADOW) return SHADOW;
  const { clouds } = cloudField();
  const N = 512;
  const size = CLOUD_FIELD.radius * 2.2 * M_PER_UNIT;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, N, N);
  const k = sun[1] > 0.05 ? 1 / sun[1] : 20;
  g.globalCompositeOperation = "lighter";
  clouds.forEach((cl) => {
    const mid = (cl.base + cl.top) * 0.5;
    const x = (cl.x - sun[0] * k * mid) * M_PER_UNIT;
    const z = (cl.z - sun[2] * k * mid) * M_PER_UNIT;
    const px = (x / size + 0.5) * N;
    const pz = (z / size + 0.5) * N;
    const r = ((cl.r * M_PER_UNIT * 1.05) / size) * N;
    const d = Math.round(255 * (0.45 + 0.3 * Math.min(1, (cl.top - cl.base) / 400)) * (cl.wisp ? 0.3 : 1));
    const gr = g.createRadialGradient(px, pz, 0, px, pz, r);
    gr.addColorStop(0, `rgb(${d},${d},${d})`);
    gr.addColorStop(0.55, `rgb(${Math.round(d * 0.8)},${Math.round(d * 0.8)},${Math.round(d * 0.8)})`);
    gr.addColorStop(1, "rgb(0,0,0)");
    g.fillStyle = gr;
    g.beginPath();
    g.arc(px, pz, r, 0, Math.PI * 2);
    g.fill();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  SHADOW = { texture: t, size };
  return SHADOW;
}
