import fs from "fs";
import path from "path";
import * as THREE from "three";
import { PLANET_TEXTURES, createEarthMaterials, createMoonMaterial, planetTexture } from "./planetMaterials";
import { SITE_DEFS } from "../../data/landingSites";

/*
 * The photorealistic Earth and Moon: one renderer, NASA textures, one Sun per scene.
 * (Texture content — geography, seams, normals — is checked by
 * scripts/planets/check_textures.py; the shaders are compiled and drawn in the
 * browser validation.)
 */
const SRC = path.resolve(__dirname, "../..");
const PUBLIC = path.resolve(SRC, "../public");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

describe("one planet renderer, NASA textures, shipped offline", () => {
  test("every texture exists in public/ (bundled with the iOS app) and is credited in SOURCES.md", () => {
    const sources = fs.readFileSync(path.join(PUBLIC, "textures/planets/SOURCES.md"), "utf8");
    Object.values(PLANET_TEXTURES).forEach((url) => {
      const file = url.replace(/^.*\/textures\//, "textures/");
      expect(fs.existsSync(path.join(PUBLIC, file))).toBe(true);
      expect(sources).toContain(path.basename(file));
      // local files only: nothing fetched from the network at run time
      expect(url).not.toMatch(/^https?:/);
    });
    expect(sources).toMatch(/Lunar Reconnaissance Orbiter/);
    expect(sources).toMatch(/Blue Marble/);
    expect(sources).toMatch(/City Lights/);
  });
  test("the old three.js example textures are gone, and nothing refers to them", () => {
    const old = ["earth_atmos_2048", "earth_clouds_1024", "earth_normal_2048", "earth_specular_2048", "moon_1024"];
    old.forEach((n) => expect(fs.readdirSync(path.join(PUBLIC, "textures/planets")).some((f) => f.startsWith(n))).toBe(false));
    walk(SRC)
      .filter((f) => /\.(js|jsx)$/.test(f) && !f.endsWith("planets.test.js"))
      .forEach((f) => old.forEach((n) => expect([f, fs.readFileSync(f, "utf8").includes(n)]).toEqual([f, false])));
  });
  test("each texture is loaded once and shared by every scene (no duplicate GPU copies)", () => {
    expect(planetTexture("moonColor")).toBe(planetTexture("moonColor"));
    const a = createMoonMaterial({ sun: new THREE.Vector3(1, 0, 0) });
    const b = createMoonMaterial({ sun: new THREE.Vector3(0, 1, 0) });
    expect(a.uniforms.uColor.value).toBe(b.uniforms.uColor.value);
    const e = createEarthMaterials({ sun: new THREE.Vector3(1, 0, 0), radius: 10 });
    expect(e.surface.uniforms.uAux.value).toBe(e.clouds.uniforms.uAux.value);
    // colour maps decoded as sRGB by the GPU; data maps (water, lights, clouds, normals) linear
    expect(planetTexture("earthDay").colorSpace).toBe(THREE.SRGBColorSpace);
    expect(planetTexture("moonNormal").colorSpace).toBe(THREE.NoColorSpace);
    expect(planetTexture("earthAux").colorSpace).toBe(THREE.NoColorSpace);
    expect(planetTexture("earthDay").generateMipmaps).toBe(true);
    // an Earth seen only as a small disc uses the 1k maps (no 4k upload for it)
    const small = createEarthMaterials({ sun: new THREE.Vector3(1, 0, 0), radius: 1, small: true });
    expect(small.surface.uniforms.uDay.value).toBe(planetTexture("earthDaySmall"));
    expect(small.clouds.uniforms.uAux.value).toBe(planetTexture("earthAuxSmall"));
    expect(planetTexture("earthDaySmall").colorSpace).toBe(THREE.SRGBColorSpace);
    expect(read("components/scenes/LunarSite.jsx")).toMatch(/<PlanetEarth [^>]*\bsmall\b/);
    expect(read("components/training/FarSideIntro.jsx")).toMatch(/<PlanetEarth [^>]*\bsmall\b/);
  });
  test("every scene that shows the Earth or the Moon draws them with the shared renderer", () => {
    const users = {
      "components/MissionScene.jsx": ["PlanetEarth", "PlanetMoon"],
      "components/DockingOps.jsx": ["PlanetMoon"],
      "components/scenes/LunarSite.jsx": ["PlanetEarth"],
      "components/scenes/ReentryScene.jsx": ["PlanetEarth"],
      "components/training/FarSideIntro.jsx": ["PlanetEarth", "PlanetMoon"],
      "components/scenes/launch/environment.js": ['planetTexture("earthDay")', 'planetTexture("earthAux")'],
    };
    Object.entries(users).forEach(([f, names]) => names.forEach((n) => expect([f, read(f).includes(n)]).toEqual([f, true])));
  });
});

describe("one Sun: the planets are lit by the same direction as the spacecraft, with no ambient light", () => {
  test("the materials share the scene's sun vector by reference and have no ambient term", () => {
    const sun = new THREE.Vector3(0.3, 0.4, 0.5).normalize();
    const e = createEarthMaterials({ sun, radius: 1 });
    const m = createMoonMaterial({ sun });
    expect(e.surface.uniforms.uSun.value).toBe(sun);
    expect(e.clouds.uniforms.uSun.value).toBe(sun);
    expect(e.atmosphere.uniforms.uSun.value).toBe(sun);
    expect(m.uniforms.uSun.value).toBe(sun);
    // ShaderMaterials: the scene's ambient and hemisphere fills never reach the planets
    [e.surface, e.clouds, e.atmosphere, m].forEach((mat) => {
      expect(mat.isShaderMaterial).toBe(true);
      expect(mat.lights).toBe(false);
      expect(mat.fragmentShader).not.toMatch(/ambientLightColor|hemisphereLights/);
    });
    // the night side: city lights on the Earth only where the Sun is down; a trace of earthshine on the Moon
    expect(e.surface.fragmentShader).toMatch(/float night = 1\.0 - smoothstep\(-0\.12, 0\.04, mu0\)/);
    expect(m.uniforms.uEarthshine.value).toBeLessThanOrEqual(0.005);
  });
  test("the atmosphere is a thin limb, not a halo (about 115 km on the Earth's 6,371)", () => {
    const e = createEarthMaterials({ sun: new THREE.Vector3(1, 0, 0), radius: 6371 });
    expect(e.atmosphere.uniforms.uH.value / 6371).toBeCloseTo(0.018, 6);
    expect(e.atmosphere.side).toBe(THREE.BackSide);
    expect(e.atmosphere.fragmentShader).toMatch(/if \(b < uR \|\| tc < 0\.0\) discard;/); // only rays that skirt the planet
  });
  test("each scene passes the Sun that lights its spacecraft", () => {
    const mission = read("components/MissionScene.jsx");
    expect(mission).toMatch(/<PlanetEarth radius=\{EARTH_UNITS\} sun=\{SUN_DIR\}/);
    expect(mission).toMatch(/<PlanetMoon radius=\{MOON_UNITS\} sun=\{SUN_DIR\}/);
    expect(mission).toMatch(/v\.sunV = toVehicle\(frame, SUN_W\)/); // the spacecraft layer's Sun
    const dock = read("components/DockingOps.jsx");
    expect(dock).toMatch(/sun=\{SUN_DIR\}/);
    expect(dock).toMatch(/directionalLight position=\{SUN_DIR\.clone\(\)\.multiplyScalar\(100\)/);
    const re = read("components/scenes/ReentryScene.jsx");
    expect(re).toMatch(/const REENTRY_SUN = \[-6, 7, 5\]/);
    expect(re).toMatch(/directionalLight position=\{\[-6, 7, 5\]\}/);
    const site = read("components/scenes/LunarSite.jsx");
    expect(site).toMatch(/const sunDir = useMemo\(\(\) => skyDirection\(site\.sun\)/);
    expect(site).toMatch(/<Earth dir=\{earthDir\} sun=\{sunDir\} \/>/);
  });
});

describe("geography and the far side", () => {
  test("no Earth above the far-side horizon (Silent Horizon); the near-side sites keep theirs", () => {
    const far = SITE_DEFS.find((s) => s.id === "far-side");
    expect(far.earth).toBeNull();
    SITE_DEFS.filter((s) => s.id !== "far-side").forEach((s) => expect(s.earth && s.earth.el).toBeGreaterThan(0));
    expect(read("components/scenes/LunarSite.jsx")).toMatch(/\{earthDir && <Earth/);
  });
  test("the Moon keeps its orientation: the same globe rotation per mission as before", () => {
    const mission = read("components/MissionScene.jsx");
    expect(mission).toMatch(/const quaternion = useMemo\(\(\) => moonQuaternionFor\(view\), \[view\]\)/);
    expect(mission).toMatch(/quaternion=\{quaternion\}/);
  });
});
