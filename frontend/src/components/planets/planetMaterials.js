import * as THREE from "three";

/*
 * LUNAVIA — the Earth and the Moon, one renderer for every scene.
 *
 * Textures are NASA imagery (public/textures/planets/SOURCES.md), loaded once
 * and shared by every scene that draws a planet (no duplicate copies on the
 * GPU). The materials take the Sun's direction as a uniform: each scene passes
 * the same direction that lights its spacecraft, so planets and vehicles are
 * lit by one Sun. There is no ambient term on either body; the night side of
 * the Earth shows only its city lights, the Moon's only a trace of earthshine.
 *
 *   Earth   Blue Marble day colour, Lambert sunlight reddened at the terminator,
 *           a sun glint on water only, cloud shadows, city lights on the night
 *           side only (never through daylight, never over water), and a thin
 *           blue aerial haze towards the limb on the day side.
 *   Clouds  a separate shell just above the surface (it parallaxes against the
 *           ground as the camera moves), NASA cloud density, lit by the Sun with
 *           a soft terminator.
 *   Atmosphere  a thin shell around the limb: brightness from how much air a
 *           ray grazes (closest approach to the surface), lit only where the
 *           Sun is up, reddening into the terminator. No full-disc halo.
 *   Moon    LRO colour with LOLA relief as per-pixel normals, lunar-Lambert
 *           photometry (the near-uniform full Moon and the sharp terminator of
 *           real photographs), an optional fine regolith detail for close views.
 */

const PUB = process.env.PUBLIC_URL || "";
export const PLANET_TEXTURES = {
  earthDay: `${PUB}/textures/planets/earth_day_4k.jpg`,
  earthAux: `${PUB}/textures/planets/earth_aux_4k.jpg`,
  // the same maps at 1k, for an Earth that is only a small disc (the lunar sky, the far-side
  // intro): a scene that shows nothing bigger never uploads the 4k maps
  earthDaySmall: `${PUB}/textures/planets/earth_day_1k.jpg`,
  earthAuxSmall: `${PUB}/textures/planets/earth_aux_1k.jpg`,
  moonColor: `${PUB}/textures/planets/moon_color_4k.jpg`,
  moonNormal: `${PUB}/textures/planets/moon_normal_2k.jpg`,
};

/* ---- one shared copy of each texture ------------------------------------------------- */
const CACHE = new Map();
const loader = typeof window !== "undefined" ? new THREE.TextureLoader() : null;
/**
 * The shared texture for a key of PLANET_TEXTURES. Colour maps are decoded as
 * sRGB by the GPU; data maps (water, lights, clouds, normals) stay linear.
 * Mipmapped, trilinear, a little anisotropy (set per renderer by planetAnisotropy).
 */
export function planetTexture(key) {
  if (CACHE.has(key)) return CACHE.get(key);
  const t = loader.load(PLANET_TEXTURES[key], () => {
    if (typeof window !== "undefined") window.__lvPlanetTextures = { ...(window.__lvPlanetTextures || {}), [key]: { w: t.image.width, h: t.image.height } }; // validation tooling
  });
  t.colorSpace = ["earthDay", "earthDaySmall", "moonColor"].includes(key) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  CACHE.set(key, t);
  if (typeof window !== "undefined") window.__lvPlanetTextureCache = CACHE; // validation tooling (filtering cost)
  return t;
}
/** Start loading everything (during the launch), so a cut never waits for a texture. */
export function preloadPlanetTextures() {
  Object.keys(PLANET_TEXTURES).forEach(planetTexture);
}

/* ---- shared GLSL ------------------------------------------------------------------------ */
const WORLD_VERT = `
  varying vec3 vWP;
  varying vec3 vWN;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWP = wp.xyz;
    vWN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

/* ---- Earth -------------------------------------------------------------------------------- */
// The NASA cloud map (earth_aux B) stores most cloud systems faintly (median 0.04, 90th
// percentile 0.53): mapped linearly they vanish and the planet reads almost clear. This curve
// shows the real fronts, storm belts and tropical clusters as opaque, and the thin cloud between
// them as a faint veil. Shared by the globe and the launch film's Earth (launch/environment).
export const CLOUD_COVER_GLSL = `
  float cloudCover(float d) { return max(smoothstep(0.05, 0.36, d), 0.25 * smoothstep(0.015, 0.08, d)); }
`;
const EARTH_FRAG = `
  uniform sampler2D uDay;
  uniform sampler2D uAux;
  uniform vec3 uSun;
  uniform float uCloudU;    // the cloud shell's rotation, as a texture offset (shadows follow it)
  uniform float uOpacity;
  uniform float uExposure;
  varying vec3 vWP;
  varying vec3 vWN;
  varying vec2 vUv;
  ${CLOUD_COVER_GLSL}
  void main() {
    vec3 n = normalize(vWN);
    vec3 v = normalize(cameraPosition - vWP);
    float mu0 = dot(n, uSun);
    float mu = max(dot(n, v), 0.0);
    vec3 day = texture2D(uDay, vUv).rgb;
    vec3 aux = texture2D(uAux, vUv).rgb;
    float water = aux.r;
    // cloud shadow: the cloud shell above this point (it turns with the shell)
    float shadow = cloudCover(texture2D(uAux, vUv + vec2(uCloudU, 0.0)).b) * smoothstep(-0.05, 0.2, mu0);
    float lit = max(mu0, 0.0);
    // sunlight through more air near the terminator: warmer, dimmer
    vec3 sunCol = mix(vec3(1.0, 0.62, 0.38), vec3(1.0), smoothstep(0.0, 0.3, mu0));
    vec3 col = day * lit * sunCol * (1.0 - 0.42 * shadow) * 1.08;
    // sun glint on water only (a broad sheen and a tight core)
    vec3 h = normalize(uSun + v);
    float nh = max(dot(n, h), 0.0);
    float fres = 0.02 + 0.98 * pow(1.0 - mu, 5.0);
    col += water * lit * sunCol * (pow(nh, 220.0) * 1.6 + pow(nh, 30.0) * 0.06) * (0.4 + fres) * (1.0 - shadow);
    // aerial haze: a thin blue veil, thicker towards the limb, on the day side
    float path = pow(1.0 - mu, 2.6);
    vec3 haze = vec3(0.16, 0.32, 0.72) * (0.05 + 0.55 * path) * smoothstep(-0.12, 0.35, mu0);
    col = col * (1.0 - 0.35 * path) + haze;
    // city lights: night side only, land only, under no cloud
    float night = 1.0 - smoothstep(-0.12, 0.04, mu0);
    col += vec3(1.0, 0.72, 0.42) * aux.g * aux.g * night * (1.0 - water) * (1.0 - 0.85 * shadow) * 0.85;
    gl_FragColor = vec4(col * uExposure, uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const CLOUD_FRAG = `
  uniform sampler2D uAux;
  uniform vec3 uSun;
  uniform float uCloudU;
  uniform float uOpacity;
  uniform float uExposure;
  varying vec3 vWP;
  varying vec3 vWN;
  varying vec2 vUv;
  ${CLOUD_COVER_GLSL}
  void main() {
    vec3 n = normalize(vWN);
    vec3 v = normalize(cameraPosition - vWP);
    float d = texture2D(uAux, vUv + vec2(uCloudU, 0.0)).b;
    // thin veils stay faint, thick decks go opaque
    float a = cloudCover(d);
    float mu0 = dot(n, uSun);
    float lit = smoothstep(-0.06, 0.25, mu0) * (0.35 + 0.65 * max(mu0, 0.0));
    vec3 sunCol = mix(vec3(1.0, 0.6, 0.38), vec3(1.0), smoothstep(0.0, 0.3, mu0));
    // thick cloud is a little brighter; thin cloud takes a grey cast
    vec3 c = mix(vec3(0.74, 0.77, 0.82), vec3(0.97), smoothstep(0.08, 0.6, d)) * sunCol * lit;
    float mu = max(dot(n, v), 0.0);
    a *= mix(0.55, 1.0, smoothstep(0.0, 0.25, mu)); // seen edge-on near the limb they thin out
    gl_FragColor = vec4(c * uExposure * 1.05, a * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const ATMO_FRAG = `
  uniform vec3 uSun;
  uniform vec3 uCentre;
  uniform float uR;
  uniform float uH;        // atmosphere thickness (scene units)
  uniform float uOpacity;
  uniform float uExposure;
  varying vec3 vWP;
  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWP - ro);
    vec3 oc = uCentre - ro;
    float tc = dot(oc, rd);
    vec3 q = ro + rd * max(tc, 0.0);
    float b = length(q - uCentre);
    // only the rays that miss the planet (the limb) and pass through the air
    if (b < uR || tc < 0.0) discard;
    float h = (b - uR) / uH;
    float dens = exp(-h * 3.2) * (1.0 - smoothstep(0.8, 1.0, h));
    vec3 up = normalize(q - uCentre);
    float s = dot(up, uSun);
    float sunUp = smoothstep(-0.25, 0.15, s);
    vec3 blue = vec3(0.30, 0.55, 1.0);
    vec3 twilight = vec3(1.0, 0.45, 0.18);
    vec3 col = mix(twilight, blue, smoothstep(-0.05, 0.3, s)) * dens * sunUp;
    // forward scattering when looking towards the Sun through the limb
    col *= 1.0 + 1.5 * pow(max(dot(rd, uSun), 0.0), 8.0);
    gl_FragColor = vec4(col * uExposure * 0.9, 1.0) * uOpacity;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * The Earth's three materials: { surface, clouds, atmosphere, uniforms }. `sun` is
 * a THREE.Vector3 (world direction towards the Sun), shared by reference.
 */
export function createEarthMaterials({ sun, radius, exposure = 1, small = false }) {
  const day = planetTexture(small ? "earthDaySmall" : "earthDay");
  const aux = planetTexture(small ? "earthAuxSmall" : "earthAux");
  const shared = { uSun: { value: sun }, uCloudU: { value: 0 }, uOpacity: { value: 1 }, uExposure: { value: exposure } };
  const surface = new THREE.ShaderMaterial({
    vertexShader: WORLD_VERT,
    fragmentShader: EARTH_FRAG,
    uniforms: { ...shared, uDay: { value: day }, uAux: { value: aux } },
  });
  const clouds = new THREE.ShaderMaterial({
    vertexShader: WORLD_VERT,
    fragmentShader: CLOUD_FRAG,
    uniforms: { ...shared, uAux: { value: aux } },
    transparent: true,
    depthWrite: false,
  });
  const atmosphere = new THREE.ShaderMaterial({
    vertexShader: WORLD_VERT,
    fragmentShader: ATMO_FRAG,
    uniforms: { uSun: shared.uSun, uOpacity: { value: 1 }, uExposure: shared.uExposure, uCentre: { value: new THREE.Vector3() }, uR: { value: radius }, uH: { value: radius * 0.018 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
  });
  return { surface, clouds, atmosphere, uniforms: shared, atmoUniforms: atmosphere.uniforms };
}

/* ---- Moon --------------------------------------------------------------------------------- */
// The local frame on the sphere, in world space: east along increasing u (three's
// SphereGeometry), north, up.
const MOON_VERT = `
  varying vec3 vWP;
  varying vec3 vWN;
  varying vec3 vEast;
  varying vec3 vNorth;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 up = normalize(position);
    vec3 east = cross(vec3(0.0, 1.0, 0.0), up);
    float el = length(east);
    east = el > 1e-4 ? east / el : vec3(1.0, 0.0, 0.0);
    vec3 north = cross(up, east);
    mat3 m = mat3(modelMatrix);
    vWN = normalize(m * up);
    vEast = normalize(m * east);
    vNorth = normalize(m * north);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWP = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const MOON_FRAG = `
  uniform sampler2D uColor;
  uniform sampler2D uNormal;
  uniform sampler2D uDetailMap;
  uniform sampler2D uDetailNormal;
  uniform vec3 uSun;
  uniform float uDetail;
  uniform float uContrast;
  uniform float uRelief;
  uniform float uAlbedo;
  uniform float uEarthshine;
  uniform float uExposure;
  varying vec3 vWP;
  varying vec3 vWN;
  varying vec3 vEast;
  varying vec3 vNorth;
  varying vec2 vUv;
  void main() {
    vec3 ng = normalize(vWN);
    vec3 nl = texture2D(uNormal, vUv).rgb * 2.0 - 1.0;
    nl.xy *= uRelief;
    vec3 E = normalize(vEast);
    vec3 N = normalize(vNorth);
    vec3 n = normalize(E * nl.x + N * nl.y + ng * nl.z);
    vec3 v = normalize(cameraPosition - vWP);
    vec3 alb = texture2D(uColor, vUv).rgb;
    // Crisper LRO colour: a light unsharp mask at the map's own texel scale (it vanishes under
    // minification, so a small disc does not sparkle)
    vec2 tx = vec2(1.0 / 4096.0, 1.0 / 2048.0);
    vec3 blur = 0.25 * (texture2D(uColor, vUv + vec2(tx.x, 0.0)).rgb + texture2D(uColor, vUv - vec2(tx.x, 0.0)).rgb
      + texture2D(uColor, vUv + vec2(0.0, tx.y)).rgb + texture2D(uColor, vUv - vec2(0.0, tx.y)).rgb);
    alb = max(alb + (alb - blur) * 0.6, 0.0);
    // Maria against highlands: the Hapke-normalised mosaic is flatter than the Moon's real albedo
    // contrast; lift it around the map's median (linear 0.34) so the seas read dark, not grey
    float lum = dot(alb, vec3(0.2126, 0.7152, 0.0722));
    alb *= pow(max(lum, 0.004) / 0.34, uContrast - 1.0);
    if (uDetail > 0.0) {
      // Below the maps' resolution (2.7 km per texel), close to the surface: small craters in the
      // albedo and in the relief, at two scales with an irrational ratio so the tiles never line up
      vec2 uA = vUv * vec2(360.0, 180.0);
      vec2 uB = vUv.yx * vec2(1310.0, 2620.0) + 0.37;
      float dA = texture2D(uDetailMap, uA).r;
      float dB = texture2D(uDetailMap, uB).r;
      alb *= mix(1.0, 0.5 + 1.0 * (dA * 0.55 + dB * 0.45), uDetail);
      vec2 pA = texture2D(uDetailNormal, uA).xy * 2.0 - 1.0;
      vec2 pB = (texture2D(uDetailNormal, uB).yx * 2.0 - 1.0);
      vec2 pert = (pA * 0.65 + pB * 0.45) * uDetail;
      n = normalize(n + E * pert.x + N * pert.y);
    }
    // Slopes facing away from the Sun fall into shade softly: the relief map is a few km per
    // texel, so a hard cut would draw its texel steps as black dashes along crater walls.
    float mu0 = max((dot(n, uSun) + 0.12) / 1.12, 0.0);
    // ...and keep a little of the smooth sphere's light, so single texels never read as black specks
    mu0 = mix(mu0, max(dot(ng, uSun), 0.0), 0.2);
    float mu = max(dot(n, v), 0.0);
    // the terminator follows the true sphere (relief cannot light the night side)
    float day = smoothstep(-0.02, 0.04, dot(ng, uSun));
    // lunar-Lambert: Lommel-Seeliger (bright to the limb at full Moon) blended with Lambert
    float L = 0.62;
    float i = 2.0 * L * mu0 / (mu0 + mu + 0.05) + (1.0 - L) * mu0;
    vec3 col = alb * uAlbedo * i * day;
    // a trace of earthshine on the night side (no ambient light anywhere else)
    col += alb * uEarthshine * (1.0 - day);
    gl_FragColor = vec4(col * uExposure, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

let DETAIL = null;
/**
 * A tiling field of small craters (power-law sizes, bowl floors, raised rims, a few bright young
 * ones), as a height field: its albedo (grey around 0.5) and its surface normals. Generated once.
 */
function moonCraterField() {
  if (DETAIL) return DETAIL;
  const N = 512;
  const h = new Float32Array(N * N);
  const a = new Float32Array(N * N).fill(0.5);
  let s = 19;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const crater = (cx, cy, rad, depth, fresh) => {
    const R2 = rad * 1.6;
    for (let y = Math.floor(cy - R2); y <= Math.ceil(cy + R2); y++) {
      for (let x = Math.floor(cx - R2); x <= Math.ceil(cx + R2); x++) {
        const d = Math.hypot(x - cx, y - cy) / rad;
        if (d > 1.6) continue;
        const i = ((y + N) % N) * N + ((x + N) % N);
        // bowl inside, rim at d = 1, ejecta falling off outside
        const z = d < 1 ? depth * (d * d - 1) + depth * 0.25 * Math.pow(d, 6) : depth * 0.25 * Math.exp(-(d - 1) * 4.5);
        h[i] += z;
        if (fresh) a[i] += d < 1 ? -0.06 + 0.22 * Math.pow(d, 4) : 0.14 * Math.exp(-(d - 1) * 3);
        else a[i] += d < 0.8 ? -0.03 : d < 1.1 ? 0.04 : 0;
      }
    }
  };
  for (let i = 0; i < 900; i++) {
    const rad = 1.2 + Math.pow(r(), 3.2) * 34;
    crater(r() * N, r() * N, rad, rad * (0.22 + r() * 0.12), r() < 0.08);
  }
  // fine grain
  for (let i = 0; i < N * N; i++) {
    h[i] += (r() - 0.5) * 0.35;
    a[i] += (r() - 0.5) * 0.05;
  }
  const nrm = new Uint8Array(N * N * 4);
  const alb = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const dx = h[y * N + ((x + 1) % N)] - h[y * N + ((x - 1 + N) % N)];
      const dy = h[((y + 1) % N) * N + x] - h[((y - 1 + N) % N) * N + x];
      // a DataTexture is not flipped: row y grows with v, i.e. northwards on the sphere's map
      const nx = -dx * 0.5;
      const ny = -dy * 0.5;
      const l = Math.hypot(nx, ny, 1);
      nrm.set([((nx / l) * 0.5 + 0.5) * 255, ((ny / l) * 0.5 + 0.5) * 255, ((1 / l) * 0.5 + 0.5) * 255, 255], i * 4);
      const g = Math.max(0, Math.min(255, a[i] * 255));
      alb.set([g, g, g, 255], i * 4);
    }
  }
  const tex = (data) => {
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 2;
    t.needsUpdate = true;
    return t;
  };
  DETAIL = { albedo: tex(alb), normal: tex(nrm) };
  return DETAIL;
}
/** Fine regolith detail (small craters and grain), tiling; for the views close to the surface. */
export function moonDetailTexture() {
  return moonCraterField().albedo;
}
/** The same crater field's surface normals (local east, north, up), tiling. */
export function moonDetailNormalTexture() {
  return moonCraterField().normal;
}

/** The Moon's material; `sun` a THREE.Vector3 (world direction towards the Sun), shared by reference. */
export function createMoonMaterial({ sun, exposure = 1, albedo = 1.12, relief = 0.8, earthshine = 0.004 }) {
  return new THREE.ShaderMaterial({
    vertexShader: MOON_VERT,
    fragmentShader: MOON_FRAG,
    uniforms: {
      uColor: { value: planetTexture("moonColor") },
      uNormal: { value: planetTexture("moonNormal") },
      uDetailMap: { value: typeof document !== "undefined" ? moonDetailTexture() : null },
      uDetailNormal: { value: typeof document !== "undefined" ? moonDetailNormalTexture() : null },
      uContrast: { value: 1.42 },
      uSun: { value: sun },
      uDetail: { value: 0 },
      uRelief: { value: relief },
      uAlbedo: { value: albedo },
      uEarthshine: { value: earthshine },
      uExposure: { value: exposure },
    },
  });
}
