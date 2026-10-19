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
  void main() {
    vec3 n = normalize(vWN);
    vec3 v = normalize(cameraPosition - vWP);
    float mu0 = dot(n, uSun);
    float mu = max(dot(n, v), 0.0);
    vec3 day = texture2D(uDay, vUv).rgb;
    vec3 aux = texture2D(uAux, vUv).rgb;
    float water = aux.r;
    // cloud shadow: the cloud shell above this point (it turns with the shell)
    float shadow = texture2D(uAux, vUv + vec2(uCloudU, 0.0)).b * smoothstep(-0.05, 0.2, mu0);
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
  void main() {
    vec3 n = normalize(vWN);
    vec3 v = normalize(cameraPosition - vWP);
    float d = texture2D(uAux, vUv + vec2(uCloudU, 0.0)).b;
    // thin veils stay faint, thick decks go opaque
    float a = smoothstep(0.04, 0.85, d);
    float mu0 = dot(n, uSun);
    float lit = smoothstep(-0.06, 0.25, mu0) * (0.35 + 0.65 * max(mu0, 0.0));
    vec3 sunCol = mix(vec3(1.0, 0.6, 0.38), vec3(1.0), smoothstep(0.0, 0.3, mu0));
    // thick cloud is a little brighter; thin cloud takes a grey cast
    vec3 c = mix(vec3(0.74, 0.77, 0.82), vec3(0.97), smoothstep(0.3, 0.95, d)) * sunCol * lit;
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
  uniform vec3 uSun;
  uniform float uDetail;
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
    vec3 n = normalize(normalize(vEast) * nl.x + normalize(vNorth) * nl.y + ng * nl.z);
    vec3 v = normalize(cameraPosition - vWP);
    vec3 alb = texture2D(uColor, vUv).rgb;
    if (uDetail > 0.0) {
      float dA = texture2D(uDetailMap, vUv * vec2(360.0, 180.0)).r;
      float dB = texture2D(uDetailMap, vUv * vec2(1500.0, 750.0)).r;
      alb *= mix(1.0, 0.55 + 0.9 * (dA * 0.6 + dB * 0.4), uDetail);
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

let DETAIL_TEX = null;
/** Fine regolith detail (small craters and grain), tiling; for the views close to the surface. */
export function moonDetailTexture() {
  if (DETAIL_TEX) return DETAIL_TEX;
  const N = 256;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d");
  if (!g) return null; // no 2D canvas (tests): the detail stays off
  g.fillStyle = "rgb(128,128,128)";
  g.fillRect(0, 0, N, N);
  let s = 19;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 260; i++) {
    const x = r() * N;
    const y = r() * N;
    const rad = 1.5 + Math.pow(r(), 3) * 14;
    for (const [ox, oy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]]) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      gr.addColorStop(0, "rgba(70,70,70,0.55)");
      gr.addColorStop(0.75, "rgba(110,110,110,0.25)");
      gr.addColorStop(0.92, "rgba(190,190,190,0.45)");
      gr.addColorStop(1, "rgba(128,128,128,0)");
      g.fillStyle = gr;
      g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    }
  }
  for (let i = 0; i < 9000; i++) {
    const v = 100 + Math.floor(r() * 60);
    g.fillStyle = `rgba(${v},${v},${v},0.35)`;
    g.fillRect(r() * N, r() * N, 1, 1);
  }
  DETAIL_TEX = new THREE.CanvasTexture(c);
  DETAIL_TEX.wrapS = DETAIL_TEX.wrapT = THREE.RepeatWrapping;
  DETAIL_TEX.anisotropy = 2;
  return DETAIL_TEX;
}

/** The Moon's material; `sun` a THREE.Vector3 (world direction towards the Sun), shared by reference. */
export function createMoonMaterial({ sun, exposure = 1, albedo = 1.25, relief = 0.8, earthshine = 0.004 }) {
  return new THREE.ShaderMaterial({
    vertexShader: MOON_VERT,
    fragmentShader: MOON_FRAG,
    uniforms: {
      uColor: { value: planetTexture("moonColor") },
      uNormal: { value: planetTexture("moonNormal") },
      uDetailMap: { value: typeof document !== "undefined" ? moonDetailTexture() : null },
      uSun: { value: sun },
      uDetail: { value: 0 },
      uRelief: { value: relief },
      uAlbedo: { value: albedo },
      uEarthshine: { value: earthshine },
      uExposure: { value: exposure },
    },
  });
}
