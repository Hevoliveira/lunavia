/*
 * One atmosphere for the descent: the sky's colour in any direction, used by the sky dome, by the
 * sea (what it reflects, and the haze it fades into) and by the clouds (their ambient light and
 * the haze between them and the camera). With one function the far sea, the far clouds and the
 * sky meet at the horizon in the same colour: no drawn line.
 *
 * The including shader declares: uniform vec3 uSkyTop, uSkyHor, uSun; uniform float uGlow.
 */
export const SKY_GLSL = `
vec3 skyColor(vec3 d) {
  float y = d.y;
  float k = pow(clamp(y, 0.0, 1.0), 0.45);
  vec3 c = mix(uSkyHor, uSkyTop, k);
  // the brighter band of haze just over the horizon, and its warmer side towards the Sun
  float sd = max(dot(normalize(vec3(d.x, 0.0, d.z) + 1e-5), normalize(vec3(uSun.x, 0.0, uSun.z) + 1e-5)), 0.0);
  c += (uSkyHor * (0.07 + 0.06 * sd)) * exp(-max(y, 0.0) * 28.0) * uGlow;
  // below the horizon: the haze over the sea
  c = mix(c, uSkyHor * 0.92, smoothstep(0.0, -0.08, y));
  // a soft brightening round the Sun (no flare)
  float s = max(dot(d, uSun), 0.0);
  c += vec3(1.0, 0.93, 0.82) * (pow(s, 6.0) * 0.16 + pow(s, 64.0) * 0.35) * uGlow;
  return c;
}`;

/*
 * Drawn into a render target (where three.js applies no tone mapping and no output encoding), a
 * pass applies the scene's own ACES filmic curve and sRGB encoding itself, so that it composites
 * over the frame exactly as if drawn into it.
 */
export const TONE_GLSL = `
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
}`;

/*
 * The haze's e-folding length (scene units, 3.9 m) seen from altitude h (m), for the sea and the
 * clouds alike: about 22 km low over the sea (a visual range of some 85 km in clean maritime air,
 * Koschmieder: V = 3.9 L), longer from higher up, where the sight line leaves the hazy boundary
 * layer sooner (as before above 9 km, where the low world crossfades into the orbital Earth).
 */
export function hazeLength(h) {
  const x = Math.min(1, Math.max(0, h) / 9000);
  return 5650 + 44350 * Math.pow(x, 1.5);
}
