/*
 * COUNTDOWN TO LAUNCH — the launch complex up close: worn paint and grime for its steel, decks and
 * tanks, applied to clones of LaunchComplex's materials in the pre-launch pad shot only (the launch
 * film keeps the complex's own materials).
 */
import * as THREE from "three";

function canvasTex(w, h, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  t.anisotropy = 4;
  return t;
}
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/* ---- the launch complex up close (pre-launch only) ------------------------------------------- */
/**
 * Worn paint and grime for the tower's steel, seen from the hardstand: a tileable
 * grey-scale texture applied in world space (triplanar), so long members are not smeared by their
 * own UVs. Multiplies the base colour (0.72..1.08) and roughens the worn patches.
 */
function grimeTexture() {
  return canvasTex(
    256,
    256,
    (g, w, h) => {
      g.fillStyle = "#d6d6d6";
      g.fillRect(0, 0, w, h);
      const r = rng(97);
      // paint mottling
      for (let i = 0; i < 260; i++) {
        const x = r() * w;
        const y = r() * h;
        const rad = 4 + r() * 22;
        const grd = g.createRadialGradient(x, y, 0, x, y, rad);
        const v = r() < 0.5 ? 200 : 236;
        grd.addColorStop(0, `rgba(${v},${v},${v},0.5)`);
        grd.addColorStop(1, `rgba(${v},${v},${v},0)`);
        g.fillStyle = grd;
        g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      // rust-dark streaks running down from the joints
      for (let i = 0; i < 70; i++) {
        const x = r() * w;
        const y = r() * h;
        const len = 20 + r() * 70;
        const grd = g.createLinearGradient(x, y, x, y + len);
        grd.addColorStop(0, "rgba(90,82,74,0.45)");
        grd.addColorStop(1, "rgba(90,82,74,0)");
        g.fillStyle = grd;
        g.fillRect(x, y, 1 + r() * 2.5, len);
      }
      // speckle
      for (let i = 0; i < 2500; i++) {
        g.fillStyle = `rgba(0,0,0,${r() * 0.12})`;
        g.fillRect(r() * w, r() * h, 1, 1);
      }
    },
    { repeat: [1, 1], srgb: false }
  );
}
/**
 * Clone a launch-complex material with the grime applied in world space. `metres` is the size of
 * one repeat; `unit` the scene's metres per unit. The original material is left untouched.
 */
export function withGrime(base, tex, { metres = 2.5, unit = 30, strength = 1 } = {}) {
  const m = base.clone();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGrime = { value: tex };
    sh.uniforms.uGrimeScale = { value: unit / metres };
    sh.uniforms.uGrimeK = { value: strength };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGwPos;\nvarying vec3 vGwN;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvGwPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGwN = normalize(mat3(modelMatrix) * objectNormal);");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D uGrime;\nuniform float uGrimeScale;\nuniform float uGrimeK;\nvarying vec3 vGwPos;\nvarying vec3 vGwN;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
vec3 gw = abs(normalize(vGwN)); gw = gw / (gw.x + gw.y + gw.z);
vec3 gp = vGwPos * uGrimeScale;
float gv = texture2D(uGrime, gp.yz).r * gw.x + texture2D(uGrime, gp.xz).r * gw.y + texture2D(uGrime, gp.xy).r * gw.z;
float lvGrime = mix(1.0, 0.72 + 0.42 * gv, uGrimeK);
diffuseColor.rgb *= lvGrime;`
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + (1.0 - lvGrime) * 0.6, 0.0, 1.0);");
  };
  m.customProgramCacheKey = () => `lv-grime-${base.uuid}`;
  return m;
}
export const grimeTex = grimeTexture;
