import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { M_PER_UNIT } from "@/data/descentScene";
import { CUMULUS, COLUMN, cumulusCells, weatherMap, cloudNoise3D } from "@/data/cumulusField";
import { SKY_GLSL, TONE_GLSL, hazeLength } from "./atmosphere";

/*
 * The cumulus over the recovery area (data/cumulusField), drawn as a layer of vapour, not as
 * objects. One full-screen pass, at reduced resolution into its own buffer, traces each pixel's
 * ray through the cloud layer (820 m to 2.45 km, on the curved Earth) and, step by step:
 * - asks the weather map whether a cloud stands there, how far inside it, and how tall it grows;
 * - shapes the cloud from that: a flat base at the condensation level, a footprint narrowing
 *   towards a rounded top (a dome), its outline broken into lobes and eroded into cauliflower
 *   billows by a tileable 3D noise (the vapour's own shape, not a sphere's);
 * - lights it: the sunlight left after crossing the cloud towards the Sun (three samples, several
 *   scattering orders, the bright rim towards the Sun), and the sky's light from above, the sea's
 *   dimmer light from below (grey-blue bases);
 * - and fades it into the same sky colour as the sea with distance.
 * The capsule descends in clear air (the field keeps its distance from the splashdown column), so
 * the last of the descent and the recovery see the clouds where they belong: in the distance.
 */

const vertexShader = `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const fragmentShader = `
uniform sampler2D uWeather;
uniform highp sampler3D uNoise;
uniform vec3 uCamM;      // the camera in the field's frame (metres; y its height above the sea)
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform float uBase;
uniform float uTopMin;
uniform float uTopMax;
uniform float uMapM;
uniform vec2 uColumn;
uniform vec2 uWindOff;   // how far the wind has carried the field (m)
uniform float uHazeL;    // metres
uniform float uOpacity;
uniform float uREarth;
uniform float uPix;      // metres a buffer pixel spans per metre of distance
uniform vec3 uSun;
uniform vec3 uSkyTop;
uniform vec3 uSkyHor;
uniform float uGlow;
uniform float uFull;     // 1: every pixel this frame; 0: half of them, in a checkerboard
uniform float uPhase;    // which half
varying vec2 vUv;
${SKY_GLSL}
${TONE_GLSL}

const float SIGMA = 0.045; // extinction in a cloud's heart, per metre

// the first t > 0 at which the ray's height (on the curved Earth) crosses Y, or -1
float crossAt(float y0, vec3 rd, float Y) {
  float a = dot(rd.xz, rd.xz) / (2.0 * uREarth);
  float b = rd.y;
  float c = y0 - Y;
  if (a < 1e-12) {
    if (abs(b) < 1e-9) return -1.0;
    float t = -c / b;
    return t > 0.0 ? t : -1.0;
  }
  float disc = b * b - 4.0 * a * c;
  if (disc < 0.0) return -1.0;
  float s = sqrt(disc);
  float t1 = (-b - s) / (2.0 * a);
  float t2 = (-b + s) / (2.0 * a);
  if (t1 > 0.0) return t1;
  if (t2 > 0.0) return t2;
  return -1.0;
}

// the cloud's density (0..1) at ground position xz (m) and height h (m)
float density(vec2 xz, float h, float t, out float hf) {
  vec2 g = xz - uWindOff;
  vec4 w = textureLod(uWeather, (g - uColumn) / uMapM + 0.5, 0.0);
  hf = 0.0;
  if (w.r < 0.004) return 0.0;
  float top = uTopMin + w.g * (uTopMax - uTopMin);
  // each cloud's own condensation level, within a few tens of metres of the others' (never one
  // razor-flat plane across the whole sky)
  float base = uBase + (w.b - 0.5) * 90.0;
  hf = (h - base) / (top - base);
  if (hf <= -0.05 || hf >= 1.0) return 0.0;
  vec3 q = vec3(g.x, h, g.y);
  // each noise read filtered to what a pixel at this distance spans (no aliasing, no speckle)
  float pix = t * uPix;
  // the cloud's lobes: its footprint, broken up, narrowing as a dome towards a rounded top; a flat base
  vec4 nb = textureLod(uNoise, q / 2600.0, log2(max(pix / 81.0, 1.0)));
  // the base flat but ragged: it rises and sags a little with the vapour
  hf -= (nb.g - 0.5) * 0.06;
  if (hf <= 0.0) return 0.0;
  // and the turrets: lobes at a third of the scale (cauliflower), where a pixel can hold them
  float lobes = textureLod(uNoise, q / 900.0 + 0.53, log2(max(pix / 28.0, 1.0))).r;
  float shape = w.r + (nb.r - 0.5) * 0.5 + (nb.b - 0.5) * 0.2 + (lobes - 0.5) * 0.3 * (0.4 + 0.6 * hf);
  // widest a little above the base (the body bulges out over a flat, slightly narrower base), a dome above
  float thr = 0.06 + 0.9 * hf * hf + 0.22 * (1.0 - smoothstep(0.0, 0.22, hf));
  float d = smoothstep(thr, thr + 0.16, shape) * smoothstep(0.0, 0.05, hf);
  if (d <= 0.0) return 0.0;
  // the billows: the edge eroded into cauliflower, at the scale of the cloud's turrets, and finer
  // close by (only where a pixel can show it)
  float n2 = textureLod(uNoise, q / 1300.0 + 0.21, log2(max(pix / 41.0, 1.0))).g;
  float e = smoothstep(0.3, 0.8, n2) * 0.42 * (1.0 - smoothstep(20000.0, 45000.0, t));
  float fine = 1.0 - smoothstep(2500.0, 7000.0, t);
  if (fine > 0.0) e += smoothstep(0.3, 0.8, textureLod(uNoise, q / 420.0 + 0.37, log2(max(pix / 13.0, 1.0))).g) * 0.16 * fine;
  // eroded where the cloud thins (its edges and top), its core kept whole
  d = clamp((d - e * (1.0 - d * 0.6)) / max(1.0 - e, 0.05), 0.0, 1.0);
  return d;
}
// the same without the billows, for the light's path towards the Sun
float densityLite(vec2 xz, float h, float lod) {
  vec2 g = xz - uWindOff;
  vec4 w = textureLod(uWeather, (g - uColumn) / uMapM + 0.5, 0.0);
  if (w.r < 0.004) return 0.0;
  float top = uTopMin + w.g * (uTopMax - uTopMin);
  float base = uBase + (w.b - 0.5) * 90.0;
  float hf = (h - base) / (top - base);
  if (hf <= 0.0 || hf >= 1.0) return 0.0;
  vec4 nb = textureLod(uNoise, vec3(g.x, h, g.y) / 2600.0, lod);
  // widest a little above the base (the body bulges out over a flat, slightly narrower base), a dome above
  float thr = 0.06 + 0.9 * hf * hf + 0.22 * (1.0 - smoothstep(0.0, 0.22, hf));
  return smoothstep(thr, thr + 0.16, w.r + (nb.r - 0.5) * 0.55 + (nb.b - 0.5) * 0.25);
}
float hg(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5);
}

void main() {
  // a checkerboard update while the view holds still: each frame traces half the pixels, the other
  // half keeps the last frame's (the clouds change too slowly to tell). In 2 x 2 blocks: a GPU
  // shades pixels in 2 x 2 quads, so only a whole quad left out saves its work
  if (uFull < 0.5 && mod(floor(gl_FragCoord.x * 0.5) + floor(gl_FragCoord.y * 0.5) + uPhase, 2.0) > 0.5) discard;
  if (uOpacity < 0.004) { gl_FragColor = vec4(0.0); return; }
  vec4 vp = uProjInv * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rd = normalize(mat3(uCamWorld) * (vp.xyz / vp.w));
  vec3 ro = uCamM;
  float y0 = ro.y;
  float topMax = uTopMax;
  // where the ray is in the layer (and where it meets the sea, which hides what lies beyond)
  float tSea = crossAt(y0, rd, 0.0);
  float lowB = uBase - 50.0; // the lowest of the bases
  float tB = crossAt(y0, rd, lowB);
  float tT = crossAt(y0, rd, topMax);
  float tIn;
  float tOut;
  if (y0 < lowB) {
    if (tB < 0.0) { gl_FragColor = vec4(0.0); return; }
    tIn = tB;
    tOut = tT > 0.0 ? tT : 90000.0;
  } else if (y0 <= topMax) {
    tIn = 0.0;
    tOut = tB > 0.0 ? min(tB, tT > 0.0 ? tT : 1e9) : (tT > 0.0 ? tT : 90000.0);
  } else {
    if (tT < 0.0) { gl_FragColor = vec4(0.0); return; }
    tIn = tT;
    tOut = tB > 0.0 ? tB : tIn + 8000.0;
  }
  if (tSea > 0.0) tOut = min(tOut, tSea);
  tOut = min(tOut, 90000.0);
  if (tOut <= tIn) { gl_FragColor = vec4(0.0); return; }

  // long strides to find a cloud; there, its surface found exactly between the last two samples
  // (bisection: the same point for neighbouring pixels, so no slicing and no dither), then fine
  // steps through it
  float t = tIn;
  float tPrev = tIn;
  float rxz = length(rd.xz);
  bool fine = false;
  int empty = 0;
  float T = 1.0;
  vec3 L = vec3(0.0);
  float tw = 0.0;
  float tsum = 0.0;
  float cosT = dot(rd, uSun);
  float ph = mix(hg(cosT, 0.62), hg(cosT, -0.18), 0.32);
  vec3 sunCol = vec3(1.0, 0.965, 0.91) * 3.1 * (0.35 + 0.65 * uGlow);
  vec3 skyAmb = mix(uSkyHor, uSkyTop, 0.6) * 0.62;
  // the light from below: the sea and the haze over it (a cumulus' base is grey, never slate)
  vec3 seaAmb = uSkyHor * 0.36 + vec3(0.02, 0.03, 0.045);
  for (int i = 0; i < 112; i++) {
    if (t >= tOut || T < 0.02) break;
    float dt = fine ? clamp(t * 0.0022, 5.0, 60.0) : clamp(t * 0.01, 15.0, 260.0);
    vec3 p = ro + rd * t;
    float hz = t * rxz;
    float h = p.y + hz * hz / (2.0 * uREarth);
    float hf;
    float d = density(p.xz, h, t, hf);
    if (d > 0.001 && !fine) {
      float a = tPrev;
      float b = t;
      for (int j = 0; j < 6; j++) {
        float tm = 0.5 * (a + b);
        vec3 pm = ro + rd * tm;
        float hzm = tm * rxz;
        float hfm;
        if (density(pm.xz, pm.y + hzm * hzm / (2.0 * uREarth), tm, hfm) > 0.001) b = tm; else a = tm;
      }
      fine = true;
      empty = 0;
      tPrev = t = max(tIn, a);
      continue;
    }
    if (d > 0.001) {
      empty = 0;
      float st = d * SIGMA;
      // the sunlight left after crossing the cloud towards the Sun
      float tau = 0.0;
      float lod = log2(max(t * uPix / 81.0, 1.0)) + 1.0;
      tau += densityLite(p.xz + uSun.xz * 110.0, h + uSun.y * 110.0, lod) * 230.0;
      tau += densityLite(p.xz + uSun.xz * 520.0, h + uSun.y * 520.0, lod + 1.0) * 690.0;
      tau *= SIGMA;
      // several orders of scattering (each fainter, less forward, less absorbed)
      float ms = 0.0;
      float a = 1.0;
      float b = 1.0;
      float c = 1.0;
      for (int k = 0; k < 3; k++) {
        ms += a * exp(-tau * b) * mix(hg(cosT, 0.62 * c), hg(cosT, -0.18 * c), 0.32);
        a *= 0.5;
        b *= 0.3;
        c *= 0.5;
      }
      // a thin edge facing the Sun gets less (the "powder" darkening of real cumulus)
      float powder = 1.0 - exp(-st * 140.0);
      vec3 Lsun = sunCol * ms * mix(0.55, 1.0, powder) * 0.55;
      // the sky's light, less of it where the cloud rises above this point (creases and undersides go grey)
      float above = densityLite(p.xz, h + 160.0, lod);
      vec3 amb = mix(seaAmb, skyAmb, smoothstep(0.0, 0.8, hf)) * (0.6 + 0.4 * d) * (1.0 - 0.3 * above);
      vec3 S = st * (Lsun + amb);
      float Tr = exp(-st * dt);
      L += T * (S - S * Tr) / st;
      float wgt = T * (1.0 - Tr);
      tw += wgt;
      tsum += wgt * t;
      T *= Tr;
      tPrev = t;
      t += dt;
    } else if (fine) {
      // out of the cloud again: back to long strides after a few empty steps
      tPrev = t;
      t += dt;
      if (++empty > 4) fine = false;
    } else {
      // clear air: stride on. Where the weather map's coarse level (the mean cover over a texel as
      // wide as the stride) shows no cloud anywhere along the next long stride, take it whole
      // (empty-space skipping: the horizon rays cross tens of kilometres of open sky)
      tPrev = t;
      if (hf <= 0.0) {
        float big = clamp(t * 0.1, 250.0, 6000.0);
        vec3 pm = ro + rd * (t + 0.5 * big);
        float lodB = log2(max(big * rxz, 1.0) / ${(CUMULUS.mapM / CUMULUS.mapN).toFixed(2)});
        float any = textureLod(uWeather, (pm.xz - uWindOff - uColumn) / uMapM + 0.5, lodB).r;
        t += any < 0.002 ? big : clamp(t * 0.035, 60.0, 1400.0);
      } else t += dt * 1.5;
    }
  }
  float alpha = 1.0 - T;
  if (alpha < 0.003) { gl_FragColor = vec4(0.0); return; }
  vec3 col = L / alpha;
  // the haze between the camera and the cloud: towards the very sky behind it
  float tm = tsum / max(tw, 1e-5);
  float f = clamp(1.0 - exp(-tm / uHazeL), 0.0, 1.0);
  col = mix(col, skyColor(rd), f);
  alpha *= uOpacity * (1.0 - 0.3 * f);
  gl_FragColor = vec4(lvSRGB(lvAces(col)) * alpha, alpha);
}`;

// The composite: the clouds' buffer laid over the frame (premultiplied), a full-screen triangle.
const compositeFragment = `
uniform sampler2D uTex;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  // a light 4-tap filter as it is enlarged (the buffer is a fraction of the frame)
  vec4 c = texture2D(uTex, vUv) * 0.4;
  c += texture2D(uTex, vUv + vec2(uTexel.x, 0.0) * 0.6) * 0.15;
  c += texture2D(uTex, vUv - vec2(uTexel.x, 0.0) * 0.6) * 0.15;
  c += texture2D(uTex, vUv + vec2(0.0, uTexel.y) * 0.6) * 0.15;
  c += texture2D(uTex, vUv - vec2(0.0, uTexel.y) * 0.6) * 0.15;
  gl_FragColor = c;
}`;

/** The clouds' buffer, as a fraction of the frame's size on each side. */
export const CLOUD_RESOLUTION = 0.34;
const _size = new THREE.Vector2();
const _clear = new THREE.Color();

/** The field's textures (made once, in steps after the scene opens: never one long stall). */
let TEX = null;
function buildTextures() {
  const N = CUMULUS.mapN;
  const weather = new THREE.DataTexture(weatherMap(), N, N, THREE.RGBAFormat);
  weather.minFilter = THREE.LinearMipmapLinearFilter;
  weather.magFilter = THREE.LinearFilter;
  weather.wrapS = weather.wrapT = THREE.ClampToEdgeWrapping;
  weather.generateMipmaps = true;
  weather.needsUpdate = true;
  const nN = 32;
  const noise = new THREE.Data3DTexture(cloudNoise3D(nN), nN, nN, nN);
  noise.format = THREE.RGBAFormat;
  noise.minFilter = THREE.LinearMipmapLinearFilter;
  noise.magFilter = THREE.LinearFilter;
  noise.generateMipmaps = true;
  noise.wrapS = noise.wrapT = noise.wrapR = THREE.RepeatWrapping;
  noise.unpackAlignment = 1;
  noise.needsUpdate = true;
  TEX = { weather, noise };
  return TEX;
}

export const WIND = { x: 3.2, z: 1.1 }; // m/s, the field's drift

export default function CumulusLayer({ simRef, atmo, passRef = null }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uWeather: { value: null },
          uNoise: { value: null },
          uCamM: { value: new THREE.Vector3() },
          uProjInv: { value: new THREE.Matrix4() },
          uCamWorld: { value: new THREE.Matrix4() },
          uBase: { value: CUMULUS.baseM },
          uTopMin: { value: CUMULUS.topMinM },
          uTopMax: { value: CUMULUS.topMaxM },
          uMapM: { value: CUMULUS.mapM },
          uColumn: { value: new THREE.Vector2(COLUMN.x, COLUMN.z) },
          uWindOff: { value: new THREE.Vector2() },
          uHazeL: { value: 60000 },
          uOpacity: { value: 1 },
          uREarth: { value: 6371000 },
          uPix: { value: 0.005 },
          uSun: { value: atmo.sun },
          uSkyTop: { value: atmo.top },
          uSkyHor: { value: atmo.hor },
          uGlow: { value: 1 },
          uFull: { value: 1 },
          uPhase: { value: 0 },
        },
        vertexShader,
        fragmentShader,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.NoBlending,
      }),
    [atmo]
  );
  const tri = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    return g;
  }, []);
  const passMesh = useMemo(() => {
    const m = new THREE.Mesh(tri, mat);
    m.frustumCulled = false;
    m.name = "cumulus-layer";
    return m;
  }, [tri, mat]);
  const passScene = useMemo(() => {
    const sc = new THREE.Scene();
    sc.add(passMesh);
    return sc;
  }, [passMesh]);
  const passCam = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), []);
  const rt = useMemo(() => new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false }), []);
  const compMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTex: { value: rt.texture }, uTexel: { value: new THREE.Vector2(0.5, 0.5) } },
        vertexShader,
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
  useEffect(
    () => () => {
      mat.dispose();
      tri.dispose();
      rt.dispose();
      compMat.dispose();
    },
    [mat, tri, rt, compMat]
  );
  // the field's textures, made in steps after the scene has opened (the clouds are only seen
  // well after the entry's first seconds)
  const ready = useRef(!!TEX);
  useEffect(() => {
    if (TEX) {
      ready.current = true;
      return undefined;
    }
    let alive = true;
    const steps = [() => cumulusCells(), () => weatherMap(), () => cloudNoise3D(), () => buildTextures()];
    let i = 0;
    let id = 0;
    const run = () => {
      if (!alive) return;
      steps[i++]();
      if (i < steps.length) id = setTimeout(run, 40);
      else ready.current = true;
    };
    id = setTimeout(run, 120);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, []);

  const drawClouds = useMemo(() => {
    // the last traced view: while the camera turns by less than about half a buffer pixel, half the
    // pixels are traced each frame (a checkerboard); any larger turn, a resize or a new lens traces all
    const last = { valid: false, dir: new THREE.Vector3(), fov: 0, phase: 0 };
    const dir = new THREE.Vector3();
    return (renderer, _scene, camera) => {
      if (!passMesh.visible) {
        last.valid = false;
        return;
      }
      renderer.getDrawingBufferSize(_size);
      const w = Math.max(2, Math.ceil(_size.x * CLOUD_RESOLUTION));
      const h = Math.max(2, Math.ceil(_size.y * CLOUD_RESOLUTION));
      if (rt.width !== w || rt.height !== h) {
        rt.setSize(w, h);
        compMat.uniforms.uTexel.value.set(1 / w, 1 / h);
        last.valid = false;
      }
      const U = mat.uniforms;
      camera.updateMatrixWorld();
      U.uProjInv.value.copy(camera.projectionMatrixInverse);
      U.uCamWorld.value.copy(camera.matrixWorld);
      U.uPix.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / h;
      camera.getWorldDirection(dir);
      const still = last.valid && last.dir.angleTo(dir) < U.uPix.value * 0.5 && Math.abs(camera.fov - last.fov) < 0.02;
      const full = !still || (typeof window !== "undefined" && window.__lvCloudsFull === true);
      U.uFull.value = full ? 1 : 0;
      last.phase = 1 - last.phase;
      U.uPhase.value = last.phase;
      last.dir.copy(dir);
      last.fov = camera.fov;
      last.valid = true;
      U.uCamM.value.set((camera.position.x + atmo.drift) * M_PER_UNIT, (camera.position.y - atmo.seaY) * M_PER_UNIT, camera.position.z * M_PER_UNIT);
      const prevTarget = renderer.getRenderTarget();
      const prevAuto = renderer.autoClear;
      const prevAlpha = renderer.getClearAlpha();
      renderer.getClearColor(_clear);
      renderer.setRenderTarget(rt);
      if (full) {
        renderer.setClearColor(0x000000, 0);
        renderer.clear(true, false, false);
      }
      renderer.autoClear = false;
      renderer.render(passScene, passCam);
      renderer.autoClear = prevAuto;
      renderer.setClearColor(_clear, prevAlpha);
      renderer.setRenderTarget(prevTarget);
    };
  }, [passMesh, passScene, passCam, rt, mat, compMat, atmo]);
  useEffect(() => {
    if (!passRef) return undefined;
    passRef.current = drawClouds;
    return () => {
      if (passRef.current === drawClouds) passRef.current = null;
    };
  }, [passRef, drawClouds]);

  const comp = useRef();
  useFrame((state) => {
    const s = simRef.current;
    if (!s) return;
    const low = atmo.low;
    const on = low > 0.004 && ready.current;
    passMesh.visible = on;
    if (comp.current) comp.current.visible = on;
    if (!on) return;
    const U = mat.uniforms;
    if (!U.uWeather.value) {
      U.uWeather.value = TEX.weather;
      U.uNoise.value = TEX.noise;
    }
    // the sea reads the same map for the clouds' shadows
    atmo.cloudMap = TEX.weather;
    U.uOpacity.value = low;
    U.uGlow.value = atmo.glow ?? 1;
    // the haze: thicker low over the sea, long sight lines from high up (as the sea's)
    U.uHazeL.value = hazeLength(s.h) * M_PER_UNIT;
    const t = state.clock.elapsedTime;
    U.uWindOff.value.set(WIND.x * t, WIND.z * t);
    atmo.windOff = U.uWindOff.value;
  });

  // after the sky (-2) and the sea (-1), before the capsule and the parachutes
  return <mesh ref={comp} geometry={tri} material={compMat} frustumCulled={false} renderOrder={-0.5} onBeforeRender={passRef ? undefined : drawClouds} name="cloud-composite" />;
}

/**
 * The cloud layer's own pass (CumulusLayer passRef), run before the frame's main pass. Mount it
 * after the camera rig, so the clouds are drawn from this frame's camera.
 */
export function CloudPass({ passRef }) {
  useFrame((state) => {
    if (passRef.current) passRef.current(state.gl, state.scene, state.camera);
  });
  return null;
}
