import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { cloudField, CLOUD_FIELD, M_PER_UNIT } from "@/data/descentScene";

/*
 * The cumulus field (data/descentScene cloudField): one instanced mesh of soft puffs (a few hundred
 * quads, one draw call), back-to-front sorted, at their true heights above the sea (bases 650–950 m).
 *
 * Each puff is an impostor shaded per pixel as a sphere of vapour lit by the scene's Sun in WORLD
 * space (not a photograph turned to the camera): the side facing the Sun bright, the far side and
 * the cloud's base in a blue-grey shadow, a noise-broken edge so no outline is round, the haze of
 * distance, and a fade where the camera comes close, so a puff never fills the screen or pops.
 * The capsule descends between the towers of the nearest formation.
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

const vertexShader = `
attribute vec4 aPuff;   // centre (x, y, z, units, relative to the field) and radius
attribute vec3 aShade;  // height in its cloud (0 base .. 1 top), seed, the cloud's base height (units)
uniform float uFieldR;
varying vec2 vUv;
varying vec3 vShade;
varying float vDist;
varying float vFade;
varying vec3 vWorld;
varying float vBaseDy;
void main() {
  vec4 c = modelMatrix * vec4(aPuff.xyz, 1.0);
  vec4 mv = viewMatrix * c;
  float r = aPuff.w;
  vUv = position.xy;
  mv.xy += position.xy * r;
  vShade = aShade;
  float d = -mv.z;
  vDist = length(mv.xyz);
  // the camera coming close (into the cloud): thin out, never fill the screen
  float nearF = smoothstep(r * 0.7, r * 2.6, d);
  // the field's rim, round the camera
  vec3 cw = c.xyz - cameraPosition;
  float rim = 1.0 - smoothstep(uFieldR * 0.78, uFieldR, length(cw.xz));
  vFade = nearF * rim * step(0.0, d);
  // this corner's height above the cloud's flat base (the world up, through the camera's axes)
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 wp = c.xyz + (camRight * position.x + camUp * position.y) * r;
  vBaseDy = (wp.y - (modelMatrix * vec4(0.0, aShade.z, 0.0, 1.0)).y) / r;
  vWorld = c.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const fragmentShader = `
uniform sampler2D uNoise;
uniform vec3 uSun;
uniform mat3 uViewInv;
uniform vec3 uHaze;
uniform float uHazeL;
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vShade;
varying float vDist;
varying float vFade;
varying vec3 vWorld;
varying float vBaseDy;
void main() {
  float r = length(vUv);
  if (r > 1.12) discard; // the quad's corners: never inside the puff
  float seed = vShade.y;
  vec2 nuv = vUv * 0.42 + vec2(seed * 7.13, seed * 3.71);
  float n1 = texture2D(uNoise, nuv).r;
  float n2 = texture2D(uNoise, nuv * 2.7 + 0.31).r;
  float n = n1 * 0.65 + n2 * 0.35;
  // a broken, billowing edge
  float edge = r * (0.86 + (n - 0.5) * 0.6);
  // zero well inside the quad, whatever the noise: no straight edges
  float a = smoothstep(1.0, 0.42, edge) * smoothstep(1.0, 0.72, r);
  // cumulus have flat bases (the condensation level): cut, softly
  a *= smoothstep(-0.02, 0.18, vBaseDy + (n - 0.5) * 0.08);
  if (a < 0.01) discard;
  // a sphere of vapour: its normal in view space, turned into the world
  vec3 nv = normalize(vec3(vUv * 1.05, sqrt(max(0.0, 1.0 - r * r)) + 0.15));
  vec3 nw = normalize(uViewInv * nv);
  nw = normalize(nw + (vec3(n1, n2, n1 * n2) - 0.5) * 0.45);
  float diff = dot(nw, uSun) * 0.5 + 0.5;
  float h = vShade.x;
  // lit tops, the base in shadow, light scattered through the edges
  float baseDark = smoothstep(0.0, 0.9, vBaseDy);
  float lit = clamp(diff * 0.6 + h * 0.45 - 0.15, 0.0, 1.0) * (0.55 + 0.45 * baseDark);
  lit = lit * (0.78 + 0.22 * n);
  vec3 shadowCol = vec3(0.39, 0.44, 0.53);
  vec3 sunCol = vec3(1.0, 0.985, 0.95);
  vec3 col = mix(shadowCol, sunCol, lit);
  col += vec3(0.08, 0.07, 0.05) * smoothstep(0.55, 1.0, r) * max(dot(normalize(vWorld - cameraPosition), uSun), 0.0);
  // the haze of distance
  float hz = 1.0 - exp(-vDist / uHazeL);
  col = mix(col, uHaze, clamp(hz, 0.0, 0.92));
  gl_FragColor = vec4(col, a * vFade * uOpacity * (0.96 - 0.35 * hz));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const _v = new THREE.Vector3();

export default function CloudField({ simRef, atmo }) {
  const mesh = useRef();
  const field = useMemo(() => cloudField(), []);
  const n = field.puffs.length;
  const { geo, aPuff, aShade, order } = useMemo(() => {
    const base = new THREE.PlaneGeometry(2, 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.attributes.position = base.attributes.position;
    g.attributes.uv = base.attributes.uv;
    const p = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    const s = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    p.setUsage(THREE.DynamicDrawUsage);
    s.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("aPuff", p);
    g.setAttribute("aShade", s);
    g.instanceCount = n;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    return { geo: g, aPuff: p, aShade: s, order: field.puffs.map((_, i) => i) };
  }, [field, n]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uNoise: { value: noiseTexture() },
          uSun: { value: atmo.sun },
          uViewInv: { value: new THREE.Matrix3() },
          uHaze: { value: atmo.haze },
          uHazeL: { value: 20000 },
          uOpacity: { value: 1 },
          uFieldR: { value: CLOUD_FIELD.radius },
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
      }),
    [atmo]
  );
  useEffect(() => () => {
    geo.dispose();
    mat.dispose();
  }, [geo, mat]);
  const frame = useRef(0);
  const dist = useMemo(() => new Float32Array(n), [n]);

  useFrame((state) => {
    const s = simRef.current;
    if (!s || !mesh.current) return;
    const low = atmo.low;
    mesh.current.visible = low > 0.004;
    if (!mesh.current.visible) return;
    // the field stands on the sea, which drifts by under the capsule
    mesh.current.position.set(-atmo.drift, atmo.seaY, 0);
    mesh.current.updateMatrixWorld();
    const U = mat.uniforms;
    U.uOpacity.value = low;
    U.uHazeL.value = 16000 + Math.min(1, Math.max(0, s.h) / 9000) * 34000;
    U.uViewInv.value.setFromMatrix4(state.camera.matrixWorld);
    // back to front, every other frame (a few hundred distances)
    if (frame.current++ % 2 === 0) {
      const cam = state.camera.position;
      const P = field.puffs;
      const ox = -atmo.drift;
      const oy = atmo.seaY;
      for (let i = 0; i < n; i++) {
        const q = P[i];
        _v.set(q.x + ox - cam.x, q.y + oy - cam.y, q.z - cam.z);
        dist[i] = _v.lengthSq();
      }
      order.sort((a, b) => dist[b] - dist[a]);
      const pa = aPuff.array;
      const sa = aShade.array;
      for (let k = 0; k < n; k++) {
        const q = P[order[k]];
        pa[k * 4] = q.x;
        pa[k * 4 + 1] = q.y;
        pa[k * 4 + 2] = q.z;
        pa[k * 4 + 3] = q.r;
        sa[k * 3] = q.h01;
        sa[k * 3 + 1] = q.seed;
        sa[k * 3 + 2] = field.clouds[q.cloud].base;
      }
      aPuff.needsUpdate = true;
      aShade.needsUpdate = true;
    }
  });

  return <mesh ref={mesh} geometry={geo} material={mat} frustumCulled={false} renderOrder={2} name="cloud-field" />;
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
    const d = Math.round(255 * (0.45 + 0.3 * Math.min(1, (cl.top - cl.base) / 400)));
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
