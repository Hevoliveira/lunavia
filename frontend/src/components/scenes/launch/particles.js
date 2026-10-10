import * as THREE from "three";

/*
 * GPU particle pools for the launch cinematic. One instanced draw call per
 * pool; the CPU only writes newly emitted particles into a ring buffer (a few
 * hundred floats per frame) and the vertex shader integrates every particle
 * from its spawn state:
 *
 *   p(age) = p0 + v0 (1 - e^(-k·age)) / k + ½ a·g·age² + wind·age
 *
 * so smoke emitted at the pad stays at the pad while the vehicle climbs, and
 * nothing is simulated per particle on the CPU. Sprites face the camera and
 * spin slowly; smoke is lit by the sun from above and by the exhaust glow.
 */

function rng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

// Billowy puff: soft radial falloff broken up by a few octaves of value noise.
function makePuffTexture(seed = 5) {
  const N = 128;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(N, N);
  const r = rng(seed);
  const G = 16;
  const grid = Array.from({ length: (G + 1) * (G + 1) }, () => r());
  const val = (x, y, f) => {
    const gx = (x * f) % G;
    const gy = (y * f) % G;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;
    const g = (a, b) => grid[(b % G) * (G + 1) + (a % G)];
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    return (g(ix, iy) * (1 - sx) + g(ix + 1, iy) * sx) * (1 - sy) + (g(ix, iy + 1) * (1 - sx) + g(ix + 1, iy + 1) * sx) * sy;
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      const d = Math.hypot(u - 0.5, v - 0.5) * 2;
      const n = val(u, v, 4) * 0.55 + val(u, v, 8) * 0.3 + val(u, v, 16) * 0.15;
      const edge = 1 - THREE.MathUtils.smoothstep(d, 0.35 + n * 0.35, 1.0);
      const a = Math.max(0, edge * (0.55 + n * 0.6));
      const i = (y * N + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(255, a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function makeGlowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const VERT = `
  attribute vec3 aP;      // spawn position
  attribute vec3 aV;      // spawn velocity
  attribute vec4 aT;      // birth, life, size0, size1
  attribute vec4 aC;      // colour, alpha
  attribute vec3 aS;      // seed, drag, accel factor
  uniform float uTime;
  uniform vec3 uAccel;
  uniform vec3 uWind;
  uniform vec3 uGlowPos;
  uniform vec3 uGlowColor;
  uniform float uGlow;
  uniform float uGlowRange;
  uniform vec3 uAmbient;
  uniform float uMaxScreen; // largest sprite, as a fraction of the distance (≈ screen height share × 2 tan(fov/2))
  uniform float uNearFade;  // sprites closer than this fade out
  varying vec2 vUv;
  varying vec4 vCol;
  varying float vShade;
  void main() {
    float age = uTime - aT.x;
    float n = age / aT.y;
    if (age < 0.0 || n > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float k = max(aS.y, 0.001);
    vec3 p = aP + aV * (1.0 - exp(-k * age)) / k + uAccel * (0.5 * aS.z * age * age) + uWind * age;
    float size = mix(aT.z, aT.w, 1.0 - exp(-3.2 * n));
    float a = aC.a * smoothstep(0.0, 0.06, n) * (1.0 - smoothstep(0.5, 1.0, n));
    vec3 glow = uGlowColor * uGlow * exp(-length(p - uGlowPos) / uGlowRange);
    vCol = vec4(aC.rgb * uAmbient + glow, a);
    float r = aS.x * 6.2831 + age * (aS.x - 0.5) * 0.5;
    float cr = cos(r), sr = sin(r);
    vec2 q = vec2(cr * position.x - sr * position.y, sr * position.x + cr * position.y);
    vShade = position.y + 0.5;
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    // Fill-rate guard for phones: a sprite never covers more than a fixed share
    // of the screen (thinned instead), and sprites at the lens dissolve.
    float dist = max(-mv.z, 1e-3);
    float maxSize = uMaxScreen * dist;
    if (size > maxSize) { vCol.a *= maxSize / size; size = maxSize; }
    vCol.a *= smoothstep(uNearFade, uNearFade * 2.5, dist);
    mv.xy += q * size;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG_SMOKE = `
  uniform sampler2D uTex;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec4 vCol;
  varying float vShade;
  void main() {
    float a = texture2D(uTex, vUv).a * vCol.a * uOpacity;
    if (a < 0.004) discard;
    // Sunlit tops, shadowed undersides: a cheap volumetric cue
    vec3 c = vCol.rgb * mix(0.68, 1.08, vShade);
    gl_FragColor = vec4(c, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const FRAG_FIRE = `
  uniform sampler2D uTex;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec4 vCol;
  varying float vShade;
  void main() {
    float a = texture2D(uTex, vUv).a * vCol.a * uOpacity;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vCol.rgb * a, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class ParticlePool {
  constructor({ count, kind = "smoke", accel = [0, 0.15, 0], seed = 1 }) {
    this.count = count;
    this.cursor = 0;
    this.rand = rng(seed);
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute("position", base.getAttribute("position"));
    g.setAttribute("uv", base.getAttribute("uv"));
    g.instanceCount = count;
    const mk = (n) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(count * n), n);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aP = mk(3);
    this.aV = mk(3);
    this.aT = mk(4);
    this.aC = mk(4);
    this.aS = mk(3);
    // Unborn particles: born in the far future
    for (let i = 0; i < count; i++) this.aT.array[i * 4] = 1e9;
    g.setAttribute("aP", this.aP);
    g.setAttribute("aV", this.aV);
    g.setAttribute("aT", this.aT);
    g.setAttribute("aC", this.aC);
    g.setAttribute("aS", this.aS);
    this.geometry = g;
    const fire = kind === "fire";
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: fire ? FRAG_FIRE : FRAG_SMOKE,
      transparent: true,
      depthWrite: false,
      blending: fire ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uAccel: { value: new THREE.Vector3(...accel) },
        uWind: { value: new THREE.Vector3(0.05, 0, 0.02) },
        uGlowPos: { value: new THREE.Vector3() },
        uGlowColor: { value: new THREE.Color(1.0, 0.55, 0.22) },
        uGlow: { value: 0 },
        uGlowRange: { value: 2.5 },
        uAmbient: { value: new THREE.Color(1, 1, 1) },
        uTex: { value: fire ? makeGlowTexture() : makePuffTexture(seed + 3) },
        uOpacity: { value: 1 },
        uMaxScreen: { value: 0.27 },
        uNearFade: { value: 0.25 },
      },
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = fire ? 6 : 5;
    this.dirtyFrom = Infinity;
    this.dirtyTo = -1;
    this.wrapped = false;
  }

  /** p, v: [x,y,z]; size: [start, end]; col: [r,g,b]; s: [drag, accelFactor] */
  emit(time, p, v, life, size0, size1, r, g, b, alpha, drag = 0.6, accelK = 1) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    if (this.cursor === 0) this.wrapped = true;
    this.aP.array.set(p, i * 3);
    this.aV.array.set(v, i * 3);
    const T = this.aT.array;
    T[i * 4] = time;
    T[i * 4 + 1] = life;
    T[i * 4 + 2] = size0;
    T[i * 4 + 3] = size1;
    const C = this.aC.array;
    C[i * 4] = r;
    C[i * 4 + 1] = g;
    C[i * 4 + 2] = b;
    C[i * 4 + 3] = alpha;
    const S = this.aS.array;
    S[i * 3] = this.rand();
    S[i * 3 + 1] = drag;
    S[i * 3 + 2] = accelK;
    if (i < this.dirtyFrom) this.dirtyFrom = i;
    if (i > this.dirtyTo) this.dirtyTo = i;
  }

  reset() {
    for (let i = 0; i < this.count; i++) this.aT.array[i * 4] = 1e9;
    this.cursor = 0;
    this.dirtyFrom = 0;
    this.dirtyTo = this.count - 1;
  }

  // Upload only the slots written this frame.
  flush(time) {
    this.material.uniforms.uTime.value = time;
    if (this.dirtyTo < 0) return;
    const from = this.dirtyFrom;
    const n = this.dirtyTo - from + 1;
    [[this.aP, 3], [this.aV, 3], [this.aT, 4], [this.aC, 4], [this.aS, 3]].forEach(([a, k]) => {
      a.clearUpdateRanges();
      a.addUpdateRange(from * k, n * k);
      a.needsUpdate = true;
    });
    this.dirtyFrom = Infinity;
    this.dirtyTo = -1;
  }

  alive(time) {
    let n = 0;
    const T = this.aT.array;
    for (let i = 0; i < this.count; i++) {
      const age = time - T[i * 4];
      if (age >= 0 && age <= T[i * 4 + 1]) n++;
    }
    return n;
  }

  /** Validation: summed projected sprite area / screen area (average layers per pixel). */
  overdraw(time, camera, width, height) {
    const T = this.aT.array;
    const P = this.aP.array;
    const V = this.aV.array;
    const S = this.aS.array;
    const acc = this.material.uniforms.uAccel.value;
    const wind = this.material.uniforms.uWind.value;
    const f = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const v = new THREE.Vector3();
    let area = 0;
    for (let i = 0; i < this.count; i++) {
      const age = time - T[i * 4];
      const life = T[i * 4 + 1];
      if (age < 0 || age > life) continue;
      const k = Math.max(S[i * 3 + 1], 0.001);
      const e = (1 - Math.exp(-k * age)) / k;
      const g = 0.5 * S[i * 3 + 2] * age * age;
      v.set(P[i * 3] + V[i * 3] * e + acc.x * g + wind.x * age, P[i * 3 + 1] + V[i * 3 + 1] * e + acc.y * g + wind.y * age, P[i * 3 + 2] + V[i * 3 + 2] * e + acc.z * g + wind.z * age);
      v.applyMatrix4(camera.matrixWorldInverse);
      const z = -v.z;
      if (z < camera.near) continue;
      const n = age / life;
      const maxSize = this.material.uniforms.uMaxScreen.value * z;
      const size = Math.min(maxSize, T[i * 4 + 2] + (T[i * 4 + 3] - T[i * 4 + 2]) * (1 - Math.exp(-3.2 * n)));
      if (z < this.material.uniforms.uNearFade.value) continue;
      const r = (size * 0.5 * f) / z;
      const sx = (v.x * f) / z;
      const sy = (v.y * f) / z;
      const w = Math.max(0, Math.min(sx + r, width / 2) - Math.max(sx - r, -width / 2));
      const h = Math.max(0, Math.min(sy + r, height / 2) - Math.max(sy - r, -height / 2));
      area += w * h;
    }
    return area / (width * height);
  }

  dispose() {
    this.geometry.dispose();
    this.material.uniforms.uTex.value.dispose();
    this.material.dispose();
  }
}
