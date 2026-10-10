import * as THREE from "three";

/*
 * Environment layer of the launch cinematic, at true scale.
 *
 * 1 env unit = 6371 / R km, with the Earth a sphere of radius R centred on
 * the origin and the launch site (LC-39, 28.57°N 80.65°W) at its top: +Y is
 * local up at the pad, +X east (downrange), -Z north.
 *
 * Sky, planet surface, atmospheric haze, the limb, the Sun and the stars
 * are one full-screen shader that ray-traces the planet and its atmosphere
 * (single scattering, Rayleigh + Mie), so the horizon is exact at every
 * altitude — flat-looking from the pad, a thin blue limb from orbit — with
 * no geometry and no depth-precision issues. Low clouds near the site are
 * one instanced draw call at their true altitude.
 */

export const R = 2000;
export const KM_PER_UNIT = 6371 / R;
const ATM_TOP_KM = 100;
const SITE_LAT = (28.57 * Math.PI) / 180;
const SITE_LON = (-80.65 * Math.PI) / 180;

const PUB = process.env.PUBLIC_URL || "";

// Env frame (east, up, south) → Earth-fixed axes, for texture lookups.
function siteToEcef() {
  const cl = Math.cos(SITE_LAT);
  const sl = Math.sin(SITE_LAT);
  const co = Math.cos(SITE_LON);
  const so = Math.sin(SITE_LON);
  const E = new THREE.Vector3(-so, co, 0);
  const U = new THREE.Vector3(cl * co, cl * so, sl);
  const N = new THREE.Vector3(-sl * co, -sl * so, cl);
  // columns: images of env X (east), env Y (up), env Z (south = -north)
  return new THREE.Matrix3().set(E.x, U.x, -N.x, E.y, U.y, -N.y, E.z, U.z, -N.z);
}

const SKY_VERT = `
  varying vec2 vNdc;
  void main() {
    vNdc = position.xy;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

const SKY_FRAG = `
  precision highp float;
  uniform mat4 uInvProj;
  uniform mat4 uCamWorld;
  uniform vec3 uUp;        // unit vector from the planet centre to the camera
  uniform float uCamR;     // camera distance from the planet centre
  uniform float uCamH;     // camera altitude (env units, precise)
  uniform vec3 uSun;
  uniform float uR;
  uniform float uRa;
  uniform float uKm;
  uniform float uSunI;
  uniform float uHaze;     // extra low-altitude haze (Mie) multiplier
  uniform float uDetail;   // 0..1: procedural cloud / land detail below texture resolution
  uniform mat3 uToEcef;
  uniform sampler2D uDay;
  uniform sampler2D uSpec;
  uniform sampler2D uClouds;
  varying vec2 vNdc;

  const vec3 BR = vec3(5.8e-3, 13.5e-3, 33.1e-3);
  const float BM = 3.0e-3;
  const float HR = 8.0;
  const float HM = 1.2;
  const int STEPS = 10;

  // Ray/sphere with the camera expressed as (r, up) for precision near the surface.
  vec2 hitSphere(float mu, float h, float rs) {
    float b = uCamR * mu;
    float c = (h - (rs - uR)) * (uCamR + rs);
    float d = b * b - c;
    if (d < 0.0) return vec2(-1.0);
    d = sqrt(d);
    return vec2(-b - d, -b + d);
  }

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  // Sine-free hash and value noise on the unit sphere (stable at large
  // arguments on mobile GPUs).
  float h3(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(h3(i), h3(i + vec3(1.0, 0.0, 0.0)), f.x), mix(h3(i + vec3(0.0, 1.0, 0.0)), h3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(h3(i + vec3(0.0, 0.0, 1.0)), h3(i + vec3(1.0, 0.0, 1.0)), f.x), mix(h3(i + vec3(0.0, 1.0, 1.0)), h3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }
  // Fade a noise octave out where it would alias (feature smaller than ~2 px).
  float octave(vec3 e, float k, float px) {
    return mix(0.5, vnoise(e * k), 1.0 - smoothstep(0.35, 0.7, px * k));
  }

  vec3 stars(vec3 d) {
    vec2 sp = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0)));
    vec2 g = sp * vec2(180.0, 180.0);
    vec2 c = floor(g);
    float h = hash(c);
    if (h < 0.93) return vec3(0.0);
    vec2 f = fract(g) - vec2(hash(c + 3.1), hash(c + 7.7));
    float s = smoothstep(0.08, 0.0, length(f)) * (h - 0.93) * 14.0;
    return vec3(0.85, 0.9, 1.0) * s;
  }

  void main() {
    vec4 v = uInvProj * vec4(vNdc, 1.0, 1.0);
    v /= v.w;
    vec3 rd = normalize((uCamWorld * vec4(v.xyz, 0.0)).xyz);
    float mu = dot(rd, uUp);
    vec2 ta = hitSphere(mu, uCamH, uRa);
    vec2 tp = hitSphere(mu, uCamH, uR);
    bool hitP = tp.x > 0.0;
    vec3 ro = uUp * uCamR;

    vec3 col = vec3(0.0);
    vec3 trans = vec3(1.0);
    if (ta.y > 0.0) {
      float t0 = max(ta.x, 0.0);
      float t1 = hitP ? tp.x : ta.y;
      float ds = (t1 - t0) / float(STEPS);
      float dsKm = ds * uKm;
      float odR = 0.0, odM = 0.0;
      vec3 sumR = vec3(0.0), sumM = vec3(0.0);
      for (int i = 0; i < STEPS; i++) {
        float s = t0 + ds * (float(i) + 0.5);
        vec3 p = ro + rd * s;
        float r = length(p);
        float hk = max(0.0, (r - uR) * uKm);
        float dR = exp(-hk / HR) * dsKm;
        float dM = exp(-hk / HM) * dsKm * uHaze;
        odR += dR;
        odM += dM;
        // Optical depth towards the Sun (Chapman-style approximation)
        float cs = dot(p / r, uSun);
        float k = 1.0 / max(cs + 0.12, 0.03);
        float sR = exp(-hk / HR) * HR * k;
        float sM = exp(-hk / HM) * HM * k * uHaze;
        vec3 att = exp(-(BR * (odR + sR) + BM * 1.1 * (odM + sM)));
        // The planet's own shadow: no sunlight once the Sun is below this
        // point's geometric horizon (keeps the night side dark from orbit)
        float hz = sqrt(max(0.0, 1.0 - (uR * uR) / (r * r)));
        float sh = smoothstep(-hz - 0.015, -hz + 0.015, cs);
        sumR += dR * att * sh;
        sumM += dM * att * sh;
      }
      float c = dot(rd, uSun);
      float pR = 0.0597 * (1.0 + c * c);
      float g = 0.76;
      float pM = 0.1194 * ((1.0 - g * g) * (1.0 + c * c)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * c, 1.5));
      col = uSunI * (sumR * BR * pR + sumM * BM * pM);
      trans = exp(-(BR * odR + BM * 1.1 * odM));
    }

    // From orbit the single-scattering veil over the ground reads far too
    // pale (multiple scattering and the eye's adaptation are not modelled):
    // thin it and let the surface carry the image, as in orbital photography.
    float orb = smoothstep(30.0, 150.0, uCamH * uKm);
    if (hitP) {
      col *= mix(1.0, 0.55, orb);
      vec3 p = ro + rd * tp.x;
      vec3 n = normalize(p);
      vec3 e = uToEcef * n;
      float lat = asin(clamp(e.z, -1.0, 1.0));
      float lon = atan(e.y, e.x);
      vec2 uv = vec2(lon / 6.2831853 + 0.5, lat / 3.1415927 + 0.5);
      // Seam-safe derivatives at the antimeridian
      vec2 uv2 = vec2(fract(uv.x + 0.5) - 0.5, uv.y);
      vec2 dx = dFdx(uv), dy = dFdy(uv), dx2 = dFdx(uv2), dy2 = dFdy(uv2);
      if (abs(dx2.x) + abs(dy2.x) < abs(dx.x) + abs(dy.x)) { dx = dx2; dy = dy2; }
      vec3 day = textureGrad(uDay, uv, dx, dy).rgb;
      day = pow(day, vec3(2.2));
      float ocean = textureGrad(uSpec, uv, dx, dy).r;
      vec4 cl = textureGrad(uClouds, uv, dx * 2.0, dy * 2.0);
      float cloud = clamp(cl.r * cl.a * 1.15, 0.0, 1.0);
      // Detail below the textures' resolution, seen from orbit: break the
      // blurred cloud map into crisp formations (~15 km and ~4 km features)
      // and add relief to the land. px: size of a pixel on the sphere.
      float px = length(fwidth(e));
      float n1 = 0.5, n2 = 0.5;
      float land = 1.0 - ocean;
      float cloudLit = 1.0;
      if (uDetail > 0.0) {
        n1 = octave(e, 420.0, px);
        n2 = octave(e, 1500.0, px);
        float n3 = octave(e, 90.0, px);
        float dn = (n3 - 0.5) * 0.5 + (n1 - 0.5) * 0.35 + (n2 - 0.5) * 0.15;
        cloud = mix(cloud, smoothstep(0.3, 0.7, cloud + dn * 0.9), uDetail);
        cloudLit = mix(1.0, 0.82 + 0.3 * n1, uDetail);
        day *= mix(1.0, 0.82 + 0.36 * n2, land * uDetail);
      }
      float sdl = dot(n, uSun);
      float ndl = max(sdl, 0.0);
      vec3 surf = day * ndl * 1.25;
      vec3 hv = normalize(uSun - rd);
      // Sun glint: a tight, rippled highlight from orbit
      float glint = pow(max(dot(n, hv), 0.0), mix(140.0, 2400.0, orb)) * mix(6.0, 2.4, orb);
      surf += ocean * vec3(1.0, 0.92, 0.8) * glint * mix(1.0, 0.2 + 1.6 * n2, uDetail) * ndl;
      // Clouds keep a little skylight on the day side only; the night side is dark
      surf = mix(surf, vec3(0.95) * cloudLit * (ndl * 1.1 + 0.03 * smoothstep(-0.02, 0.12, sdl)), cloud);
      // Sunlight reaching the ground is reddened by the same atmosphere
      float k = 1.0 / max(ndl + 0.12, 0.03);
      vec3 sunT = exp(-(BR * HR + BM * 1.1 * HM * uHaze) * k);
      col += surf * sunT * trans * uSunI * 0.085 * mix(1.0, 1.3, orb);
      // City lights on the night side: land only, not deserts or ice, dimmed
      // under cloud; clustered by a regional density field.
      float night = 1.0 - smoothstep(-0.14, 0.02, sdl);
      if (night > 0.0 && land > 0.0) {
        float lum = dot(day, vec3(0.3, 0.59, 0.11));
        float pop = smoothstep(0.52, 0.8, octave(e, 160.0, px) * 0.65 + octave(e, 45.0, px) * 0.35);
        float town = smoothstep(0.62, 0.92, octave(e, 2600.0, px));
        float lights = land * pop * mix(0.22, town, 1.0 - smoothstep(0.2, 0.6, px * 2600.0));
        lights *= (1.0 - smoothstep(0.06, 0.16, lum)) * (1.0 - cloud * 0.85);
        col += vec3(1.0, 0.72, 0.4) * lights * night * trans * 0.55;
      }
    } else {
      // Single scattering over-yellows long, low horizontal paths; real skies
      // are whitened there by multiple scattering. Pull the low-altitude
      // horizon band towards a neutral, slightly blue white.
      float muH = -sqrt(max(0.0, 1.0 - (uR * uR) / (uCamR * uCamR)));
      float near = 1.0 - smoothstep(0.0, 0.22, mu - muH);
      float lowAlt = 1.0 - smoothstep(15.0, 60.0, uCamH * uKm);
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, lum * vec3(0.9, 0.96, 1.08), 0.75 * near * lowAlt);
      float sd = dot(rd, uSun);
      col += trans * vec3(1.0, 0.94, 0.84) * smoothstep(0.99985, 0.99995, sd) * 60.0;
      // Lens glare round the Sun: a tight core and a faint wide halo
      col += trans * vec3(1.0, 0.9, 0.75) * (pow(max(sd, 0.0), 4000.0) * 1.6 + pow(max(sd, 0.0), 160.0) * 0.06);
      // The limb seen from orbit: layered twilight colours where the
      // terminator crosses it (red low down, through amber and white, to blue
      // above), and the faint green airglow layer near 95 km on the night side.
      if (orb > 0.0 && mu < 0.0) {
        float ht = (uCamR * sqrt(max(0.0, 1.0 - mu * mu)) - uR) * uKm;
        float ts = dot(normalize(ro - rd * (uCamR * mu)), uSun);
        float twi = exp(-pow(ts / 0.1, 2.0)) * (0.35 + 0.65 * smoothstep(-0.2, 0.9, dot(rd, uSun)));
        vec3 band = mix(vec3(0.95, 0.24, 0.05), vec3(1.0, 0.6, 0.2), smoothstep(1.0, 9.0, ht));
        band = mix(band, vec3(1.0, 0.9, 0.7), smoothstep(9.0, 16.0, ht));
        band = mix(band, vec3(0.3, 0.5, 1.0), smoothstep(16.0, 34.0, ht));
        col += band * exp(-ht / 11.0) * twi * 0.9 * orb;
        float nightSide = 1.0 - smoothstep(-0.18, 0.02, ts);
        col += vec3(0.32, 0.95, 0.45) * exp(-pow((ht - 95.0) / 4.5, 2.0)) * nightSide * 0.045 * orb;
      }
      float dark = 1.0 - smoothstep(0.004, 0.06, dot(col, vec3(0.3, 0.5, 0.2)));
      col += stars(rd) * dark;
    }
    // From orbit, a restrained starburst (lens diffraction spikes) when the
    // Sun itself is in view above the limb.
    if (orb > 0.0 && hitSphere(dot(uSun, uUp), uCamH, uR).x < 0.0) {
      vec3 d = rd - uSun;
      vec2 q = vec2(dot(d, normalize(uCamWorld[0].xyz)), dot(d, normalize(uCamWorld[1].xyz)));
      q = vec2(0.866 * q.x - 0.5 * q.y, 0.5 * q.x + 0.866 * q.y);
      float spikes = exp(-abs(q.y) * 900.0) * exp(-abs(q.x) * 32.0) + exp(-abs(q.x) * 900.0) * exp(-abs(q.y) * 32.0);
      col += vec3(1.0, 0.92, 0.8) * spikes * smoothstep(0.0, 0.5, dot(rd, uSun)) * orb * 0.6;
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/* Cumulus near the site and cirrus higher up: horizontal quads at true altitude. */
function makeCloudTexture() {
  const N = 256;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const ctx = c.getContext("2d");
  let s = 91;
  const r = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * N * 0.3;
    const x = N / 2 + Math.cos(a) * d;
    const y = N / 2 + Math.sin(a) * d;
    const rr = N * (0.06 + r() * 0.12);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
    g.addColorStop(0, `rgba(255,255,255,${0.25 + r() * 0.3})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
  }
  return new THREE.CanvasTexture(c);
}

const CLOUD_VERT = `
  attribute vec4 aC; // x, z (env units, site frame), altitude (env units), size
  attribute float aSeed;
  uniform float uR;
  varying vec2 vUv;
  varying float vDist;
  varying float vSeed;
  void main() {
    vUv = uv;
    vSeed = aSeed;
    vec3 up = normalize(vec3(aC.x, uR, aC.y));
    vec3 east = normalize(cross(up, vec3(0.0, 0.0, -1.0)));
    vec3 south = cross(east, up);
    float a = aSeed * 6.2831;
    vec2 q = vec2(cos(a) * position.x - sin(a) * position.y, sin(a) * position.x + cos(a) * position.y) * aC.w;
    vec3 p = up * (uR + aC.z) + east * q.x + south * q.y;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vDist = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const CLOUD_FRAG = `
  uniform sampler2D uTex;
  uniform vec3 uLit;
  uniform vec3 uHazeCol;
  uniform float uOpacity;
  uniform float uKm;
  varying vec2 vUv;
  varying float vDist;
  varying float vSeed;
  void main() {
    float a = texture2D(uTex, vUv).a * uOpacity * (0.75 + 0.25 * vSeed);
    if (a < 0.004) discard;
    float haze = 1.0 - exp(-vDist * uKm / 45.0);
    vec3 c = mix(uLit, uHazeCol, haze);
    gl_FragColor = vec4(c, a * (1.0 - haze * 0.6));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function buildClouds() {
  const base = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute("position", base.getAttribute("position"));
  g.setAttribute("uv", base.getAttribute("uv"));
  const N = 84;
  const aC = new Float32Array(N * 4);
  const aSeed = new Float32Array(N);
  let s = 17;
  const r = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < N; i++) {
    const cirrus = i >= 60;
    const ang = r() * Math.PI * 2;
    const distKm = (cirrus ? 6 + r() * 70 : 4 + r() * 45) * (i % 7 === 0 ? 0.4 : 1);
    const altKm = cirrus ? 9.5 + r() * 2 : 1.6 + r() * 1.4;
    const sizeKm = cirrus ? 9 + r() * 16 : 2.2 + r() * 4.5;
    aC.set([(Math.cos(ang) * distKm) / KM_PER_UNIT, (Math.sin(ang) * distKm) / KM_PER_UNIT, altKm / KM_PER_UNIT, sizeKm / KM_PER_UNIT], i * 4);
    aSeed[i] = r();
  }
  g.setAttribute("aC", new THREE.InstancedBufferAttribute(aC, 4));
  g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(aSeed, 1));
  g.instanceCount = N;
  const m = new THREE.ShaderMaterial({
    vertexShader: CLOUD_VERT,
    fragmentShader: CLOUD_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uR: { value: R },
      uKm: { value: KM_PER_UNIT },
      uTex: { value: makeCloudTexture() },
      uLit: { value: new THREE.Color(1.0, 0.99, 0.97) },
      uHazeCol: { value: new THREE.Color(0.72, 0.8, 0.9) },
      uOpacity: { value: 0.85 },
    },
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return mesh;
}

export function createEnvironment() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.002, 12000);
  const loader = new THREE.TextureLoader();
  const tex = (f, srgb) => {
    const t = loader.load(`${PUB}/textures/planets/${f}`);
    t.colorSpace = THREE.NoColorSpace; // decoded manually in the shader
    t.wrapS = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  };
  const day = tex("earth_atmos_2048.jpg");
  const spec = tex("earth_specular_2048.jpg");
  const clouds = tex("earth_clouds_1024.png");
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uUp: { value: new THREE.Vector3(0, 1, 0) },
      uCamR: { value: R },
      uCamH: { value: 0 },
      uSun: { value: new THREE.Vector3(10, 8, 8).normalize() },
      uR: { value: R },
      uRa: { value: R + ATM_TOP_KM / KM_PER_UNIT },
      uKm: { value: KM_PER_UNIT },
      uSunI: { value: 22 },
      uHaze: { value: 1 },
      uDetail: { value: 0 },
      uToEcef: { value: siteToEcef() },
      uDay: { value: day },
      uSpec: { value: spec },
      uClouds: { value: clouds },
    },
  });
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);
  const cloudMesh = buildClouds();
  scene.add(cloudMesh);

  const _v = new THREE.Vector3();
  return {
    scene,
    camera,
    /**
     * Follow the main (vehicle-layer) camera. camPos: env-space position;
     * camQuat: env-space orientation; main: the vehicle camera (projection
     * and view offset are copied); altKm: camera altitude; sun: env-space
     * sun direction.
     */
    update({ camPos, camQuat, main, altKm, sun }) {
      camera.position.copy(camPos);
      camera.quaternion.copy(camQuat);
      camera.fov = main.fov;
      camera.aspect = main.aspect;
      if (main.view && main.view.enabled) {
        const v = main.view;
        camera.setViewOffset(v.fullWidth, v.fullHeight, v.offsetX, v.offsetY, v.width, v.height);
      } else camera.clearViewOffset();
      // Near plane follows altitude: metres at the pad, kilometres in orbit
      camera.near = Math.max(0.0005, Math.min(0.5, (altKm / KM_PER_UNIT) * 0.02));
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      const u = skyMat.uniforms;
      u.uInvProj.value.copy(camera.projectionMatrixInverse);
      u.uCamWorld.value.copy(camera.matrixWorld);
      const r = camPos.length();
      u.uUp.value.copy(_v.copy(camPos).divideScalar(r));
      u.uCamR.value = R + altKm / KM_PER_UNIT;
      u.uCamH.value = altKm / KM_PER_UNIT;
      u.uSun.value.copy(sun);
      // Boundary-layer haze: thick at the pad; from orbit it would wash the
      // surface out into a white veil, so it thins with camera altitude.
      u.uHaze.value = 0.55 * (1 - 0.6 * THREE.MathUtils.smoothstep(altKm, 30, 150));
      // Sub-texture detail only matters once the ground is far below
      u.uDetail.value = THREE.MathUtils.smoothstep(altKm, 40, 120);
      // Clouds fade when the camera is far above them (seen through the planet shader)
      cloudMesh.material.uniforms.uOpacity.value = 0.85 * (1 - THREE.MathUtils.smoothstep(altKm, 14, 34));
      cloudMesh.visible = altKm < 35;
    },
    dispose() {
      [day, spec, clouds, cloudMesh.material.uniforms.uTex.value].forEach((t) => t.dispose());
      skyMat.dispose();
      sky.geometry.dispose();
      cloudMesh.geometry.dispose();
      cloudMesh.material.dispose();
    },
  };
}
