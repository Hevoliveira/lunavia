import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import { PlanetEarth } from "@/components/planets/Planets";
import * as THREE from "three";
import { WORLD_X } from "@/data/touchdownFx";
import { FOOT_RADIUS } from "@/data/landingSites";
import { buildTerrain, hazardStrip, rockInstances, skyDirection } from "@/data/terrainMesh";

/*
 * A landing site, drawn from the same data the physics flies
 * (data/landingSites, data/terrainMesh):
 *
 *   SiteTerrain   the heightfield (one mesh, 1 m cells where the LM flies),
 *                 lit by the site's low Sun with the terrain's own shadows
 *                 baked per vertex, and a fine regolith texture;
 *   SiteRocks     every boulder and debris stone of site.rocks (two
 *                 instanced meshes); boulders cast real-time shadows;
 *   SiteSky       stars, the Earth where it hangs in that site's sky (none
 *                 on the far side), and the distant mountains on its horizon;
 *   SiteSun       the Sun (direction per site) and the soft fill light, with
 *                 a shadow map that follows the LM;
 *   SiteMarkers   the landing zones and the unsafe ground, laid on the
 *                 terrain; LandingPoint: the LM's footprint at the
 *                 predicted touchdown point, yellow when the ground there is
 *                 safe and red when it is not.
 */


/* ---- regolith detail (procedural, tileable) --------------------------------------------- */
let regolith = null;
function regolithTexture() {
  if (regolith) return regolith;
  const N = 256;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d");
  const img = g.createImageData(N, N);
  // tileable value noise
  const lattice = (s, seed) => {
    const a = new Float32Array(s * s);
    let x = seed;
    for (let i = 0; i < a.length; i++) {
      x = (x * 16807) % 2147483647;
      a[i] = x / 2147483647;
    }
    return (u, v) => {
      const fu = u * s;
      const fv = v * s;
      const i = Math.floor(fu);
      const j = Math.floor(fv);
      const tu = fu - i;
      const tv = fv - j;
      const su = tu * tu * (3 - 2 * tu);
      const sv = tv * tv * (3 - 2 * tv);
      const at = (p, q) => a[((q % s) + s) % s * s + (((p % s) + s) % s)];
      const A = at(i, j);
      const B = at(i + 1, j);
      const C = at(i, j + 1);
      const D = at(i + 1, j + 1);
      return A + (B - A) * su + (C - A) * sv + (A - B - C + D) * su * sv;
    };
  };
  const o = [lattice(8, 7), lattice(16, 11), lattice(32, 13), lattice(64, 17)];
  const v = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const w = y / N;
      v[y * N + x] = 0.42 * o[0](u, w) + 0.28 * o[1](u, w) + 0.18 * o[2](u, w) + 0.12 * o[3](u, w);
    }
  }
  // tiny craterlets: dark floors, bright rims (wrapping)
  let s = 991;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 70; k++) {
    const cx = rnd() * N;
    const cy = rnd() * N;
    const r = 2 + Math.pow(rnd(), 2.5) * 14;
    for (let dy = -r * 1.6; dy <= r * 1.6; dy++) {
      for (let dx = -r * 1.6; dx <= r * 1.6; dx++) {
        const d = Math.hypot(dx, dy) / r;
        if (d > 1.6) continue;
        const px = (((Math.round(cx + dx) % N) + N) % N);
        const py = (((Math.round(cy + dy) % N) + N) % N);
        const shade = d < 1 ? -0.16 * (1 - d * d) + 0.1 * Math.max(0, (dx - dy) / r) * (1 - d) : 0.08 * (1.6 - d) / 0.6;
        v[py * N + px] += shade;
      }
    }
  }
  for (let i = 0; i < N * N; i++) {
    const t = Math.max(0, Math.min(255, Math.round(255 * (0.5 + 0.9 * (v[i] - 0.5)))));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = t;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  regolith = new THREE.CanvasTexture(c);
  regolith.wrapS = regolith.wrapT = THREE.RepeatWrapping;
  regolith.anisotropy = 4;
  regolith.colorSpace = THREE.NoColorSpace;
  return regolith;
}

// Sunlight that reaches a surface point is multiplied by the baked terrain
// shadow (sunVis); the fill light is not.
const SUNLIT = THREE.ShaderChunk.lights_fragment_begin.replace(
  "getDirectionalLightInfo( directionalLight, directLight );",
  "getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= vSunVis;"
);

// Lambert: regolith is a rough, matte surface, and it is the cheapest lit material on a phone.
function terrainMaterial(tex) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDetail = { value: tex };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float sunVis;\nvarying float vSunVis;\nvarying vec2 vXZ;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvSunVis = sunVis;\n\tvXZ = position.xz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D uDetail;\nvarying float vSunVis;\nvarying vec2 vXZ;")
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\n\tfloat dA = texture2D( uDetail, vXZ * 0.21 ).r;\n\tfloat dB = texture2D( uDetail, vXZ * 0.037 + 0.37 ).r;\n\tdiffuseColor.rgb *= ( 0.5 + 0.68 * dA ) * ( 0.66 + 0.5 * dB );"
      )
      .replace("#include <lights_fragment_begin>", SUNLIT);
  };
  m.customProgramCacheKey = () => "lv-terrain";
  return m;
}

function rockMaterial() {
  const m = new THREE.MeshLambertMaterial({ color: "#ffffff", flatShading: true });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aSunVis;\nvarying float vSunVis;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvSunVis = aSunVis;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vSunVis;")
      .replace("#include <lights_fragment_begin>", SUNLIT);
  };
  m.customProgramCacheKey = () => "lv-rock";
  return m;
}

/* ---- terrain --------------------------------------------------------------------------- */
export function SiteTerrain({ site }) {
  const { geometry, material } = useMemo(() => {
    const t = buildTerrain(site);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(t.positions, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(t.normals, 3));
    g.setAttribute("color", new THREE.BufferAttribute(t.colors, 3));
    g.setAttribute("sunVis", new THREE.BufferAttribute(t.sunVis, 1));
    g.setIndex(new THREE.BufferAttribute(t.index, 1));
    g.computeBoundingSphere();
    return { geometry: g, material: terrainMaterial(regolithTexture()) };
  }, [site]);
  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);
  return <mesh geometry={geometry} material={material} receiveShadow frustumCulled={false} />;
}

/* ---- rocks ------------------------------------------------------------------------------- */
// A unit rock: base at y 0, top at y 1, horizontal radius 1, faceted and irregular.
// Boulders: a subdivided icosahedron (80 faces), seen close at touchdown; debris: 20 faces.
function rockGeometry(boulder, seed) {
  const g = new THREE.IcosahedronGeometry(1, boulder ? 1 : 0);
  const p = g.attributes.position;
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const jitter = new Map();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    if (!jitter.has(key)) jitter.set(key, 0.78 + 0.22 * rnd());
    const k = jitter.get(key);
    const yy = Math.max(0, (y + 0.45) / 1.45); // flat base, a little buried
    const taper = 1 - 0.3 * yy * yy;
    p.setXYZ(i, x * k * taper, Math.min(1, yy * (0.85 + 0.15 * k)), z * k * taper);
  }
  // (these polyhedra are non-indexed: every face has its own vertices, so the normals are faceted)
  g.computeVertexNormals();
  return g;
}

// Boulders near the track (seen close at touchdown) get the detailed rock; the rest the light one.
const nearTrack = (r) => Math.abs(r.rock.x) < 75 && Math.abs(r.rock.z) < 26;

function RockSet({ site, boulders, near = null }) {
  const mesh = useMemo(() => {
    const list = rockInstances(site, boulders).filter((r) => near === null || nearTrack(r) === near);
    const geo = rockGeometry(boulders && near !== false, boulders ? 4211 : 977);
    const sun = new Float32Array(list.length);
    const mat = rockMaterial();
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    const base = new THREE.Color(site.palette.rock);
    const M = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const c = new THREE.Color();
    list.forEach((r, i) => {
      e.set(r.tilt, r.rotationY, -r.tilt * 0.7);
      q.setFromEuler(e);
      M.compose(new THREE.Vector3(...r.position), q, new THREE.Vector3(...r.scale));
      m.setMatrixAt(i, M);
      c.copy(base).multiplyScalar(0.82 + 0.3 * r.tone);
      m.setColorAt(i, c);
      sun[i] = r.sunVis;
    });
    m.count = list.length;
    geo.setAttribute("aSunVis", new THREE.InstancedBufferAttribute(sun, 1));
    m.castShadow = boulders;
    m.receiveShadow = true;
    m.frustumCulled = false;
    return m;
  }, [site, boulders, near]);
  useEffect(() => () => {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }, [mesh]);
  return <primitive object={mesh} />;
}

export function SiteRocks({ site }) {
  return (
    <>
      <RockSet site={site} boulders near />
      <RockSet site={site} boulders near={false} />
      <RockSet site={site} boulders={false} />
    </>
  );
}

/* ---- sky ------------------------------------------------------------------------------------ */
const SKY_R = 1800;

function Horizon({ site }) {
  const geometry = useMemo(() => {
    if (!site.horizon || !site.horizon.length) return null;
    const D = 1500;
    const seg = 1.5; // degrees per column
    const rows = 6;
    // silhouette height (deg) across a feature, u in [-1, 1], with a ragged crest
    const crest = (h, u) => {
      const a = Math.abs(u);
      const rag = 1 + 0.06 * Math.sin(u * 37 + h.az) + 0.04 * Math.sin(u * 91 + 2 * h.az);
      if (h.kind === "peak") return h.el * Math.pow(Math.max(0, 1 - a), 1.3) * rag;
      if (h.kind === "rim") return h.el * (a < 0.75 ? 1 - 0.06 * Math.sin(u * 19) : Math.max(0, 1 - (a - 0.75) / 0.25)) * rag;
      if (h.kind === "front" || h.kind === "ridge") return h.el * (1 - a * a) * rag;
      return h.el * Math.pow(Math.max(0, 1 - a * a), 0.7) * rag; // massif
    };
    const sun = new THREE.Vector3(...skyDirection(site.sun));
    const albedo = new THREE.Color(site.palette.highland || site.palette.bright).convertSRGBToLinear();
    const pos = [];
    const nrm = [];
    const col = [];
    const idx = [];
    for (const h of site.horizon) {
      const n = Math.max(6, Math.ceil(h.w / seg));
      const base = pos.length / 3;
      for (let i = 0; i <= n; i++) {
        const u = (i / n) * 2 - 1;
        const az = ((h.az + (u * h.w) / 2) * Math.PI) / 180;
        const el = (crest(h, u) * Math.PI) / 180;
        const dx = Math.cos(az);
        const dz = -Math.sin(az);
        // the face looks back towards the site and up its own slope
        const steep = 0.55;
        const nn = new THREE.Vector3(-dx * Math.cos(steep), Math.sin(steep), -dz * Math.cos(steep)).normalize();
        // lambert from the site's Sun plus a little fill; brighter towards the crest
        const lit = 0.25 + 0.95 * Math.max(0, nn.dot(sun));
        for (let r = 0; r <= rows; r++) {
          const f = r / rows; // 0 at the foot, 1 at the crest
          const y = -90 + (D * Math.tan(el) - 6 + 90) * f;
          const rr = D - 120 * f; // the crest leans back a little
          pos.push(dx * rr, y, dz * rr);
          nrm.push(nn.x, nn.y, nn.z);
          const k = lit * (0.7 + 0.3 * f);
          col.push(albedo.r * k, albedo.g * k, albedo.b * k);
        }
      }
      for (let i = 0; i < n; i++) {
        for (let r = 0; r < rows; r++) {
          const a0 = base + i * (rows + 1) + r;
          const b0 = a0 + rows + 1;
          idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    return g;
  }, [site]);
  useEffect(() => () => geometry && geometry.dispose(), [geometry]);
  if (!geometry) return null;
  // Shading is baked in the colours (no atmosphere: far mountains are as crisp as near ones).
  return (
    <mesh geometry={geometry} frustumCulled={false} renderOrder={-1}>
      <meshBasicMaterial vertexColors side={THREE.DoubleSide} toneMapped />
    </mesh>
  );
}

function Earth({ dir, sun }) {
  // ~2x the Earth's real 1.9° from the Moon, so it reads on a phone. Lit by this site's Sun
  // (its phase follows from the geometry); no glow of its own. The shared NASA Earth.
  const r = SKY_R * Math.tan(1.9 * (Math.PI / 180));
  return <PlanetEarth radius={r} sun={sun} spin={0.01} segments={64} small position={dir.map((v) => v * SKY_R)} />;
}

/** Stars and the Earth travel with the camera (they are at infinity); the horizon stays put. */
export function SiteSky({ site }) {
  const { camera } = useThree();
  const sky = useRef();
  // On the far side the Earth is below the horizon: there is none to draw.
  const earthDir = useMemo(() => (site.earth ? skyDirection(site.earth) : null), [site]);
  const sunDir = useMemo(() => skyDirection(site.sun), [site]);
  useFrame(() => {
    if (sky.current) sky.current.position.copy(camera.position);
  });
  return (
    <>
      <group ref={sky}>
        <Stars radius={SKY_R} depth={200} count={4000} factor={40} saturation={0} fade speed={0.05} />
        {earthDir && <Earth dir={earthDir} sun={sunDir} />}
      </group>
      <Horizon site={site} />
    </>
  );
}

/* ---- sun ---------------------------------------------------------------------------------------- */
const SHADOW_BOX = 44; // scene units either side of the LM
const SHADOW_MAP = 2048;

/** The Sun and the fill light; the shadow map follows `focus()` ([x, y, z] scene units, e.g. the LM). */
export function SiteSun({ site, focus = null }) {
  const light = useRef();
  const dir = useMemo(() => new THREE.Vector3(...skyDirection(site.sun)), [site]);
  const basis = useMemo(() => {
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    return { right, up };
  }, [dir]);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    const l = light.current;
    if (!l) return;
    const cam = l.shadow.camera;
    cam.left = -SHADOW_BOX;
    cam.right = SHADOW_BOX;
    cam.top = SHADOW_BOX;
    cam.bottom = -SHADOW_BOX;
    cam.near = 1;
    cam.far = 900;
    cam.updateProjectionMatrix();
    l.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.04;
  }, []);
  useFrame(() => {
    const l = light.current;
    if (!l) return;
    // snap the shadow camera to its own texels so shadow edges do not crawl
    const f = focus ? focus() : null;
    if (f) tmp.set(f[0], f[1], f[2]);
    else tmp.set(0, 0, 0);
    const texel = (2 * SHADOW_BOX) / SHADOW_MAP;
    const a = tmp.dot(basis.right);
    const b = tmp.dot(basis.up);
    tmp.addScaledVector(basis.right, Math.round(a / texel) * texel - a).addScaledVector(basis.up, Math.round(b / texel) * texel - b);
    l.target.position.copy(tmp);
    l.position.copy(tmp).addScaledVector(dir, 400);
    l.target.updateMatrixWorld();
  });
  // Low Sun: flat ground gets sin(el) of it, so the intensity is raised to keep
  // the plain readable while sunward slopes go bright, as in Apollo imagery.
  const intensity = Math.min(7, 1.5 / Math.max(0.2, Math.sin((site.sun.el * Math.PI) / 180)));
  return (
    <>
      <ambientLight intensity={0.1} />
      <hemisphereLight args={["#5b6a80", "#5a544b", 0.42]} />
      <directionalLight ref={light} intensity={intensity} color="#fffaf1" castShadow />
    </>
  );
}

/* ---- markers ----------------------------------------------------------------------------------- */
// Lay a ring of radius r (m) round (x, z) m on the terrain, `w` m wide.
function drapedRing(site, terrain, x, z, r, w, n = 72, lift = 0.05) {
  const pos = [];
  for (let i = 0; i < n; i++) {
    for (const k of [i, i + 1]) {
      const a = (k / n) * Math.PI * 2;
      for (const rr of [r - w, r]) {
        const px = x + Math.cos(a) * rr;
        const pz = z + Math.sin(a) * rr;
        pos.push(px * WORLD_X, site.scale.y(terrain.lookup(px, pz)) + lift, pz * WORLD_X);
      }
    }
  }
  // triangles from consecutive pairs: (i inner, i outer, i+1 inner, i+1 outer)
  const tri = [];
  for (let i = 0; i < n; i++) {
    const b = i * 12;
    const v = (j) => pos.slice(b + j * 3, b + j * 3 + 3);
    tri.push(...v(0), ...v(1), ...v(3), ...v(0), ...v(3), ...v(2));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(tri, 3));
  return g;
}

const HATCH_VERT = /* glsl */ `
  attribute float aEdge;
  varying vec2 vXZ;
  varying float vEdge;
  void main() {
    vXZ = position.xz;
    vEdge = aEdge;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const HATCH_FRAG = /* glsl */ `
  uniform float uReveal;
  uniform vec3 uColor;
  varying vec2 vXZ;
  varying float vEdge;
  void main() {
    float stripe = smoothstep(0.35, 0.5, abs(fract((vXZ.x + vXZ.y) * 0.9) - 0.5) * 2.0);
    float edge = smoothstep(0.8, 1.0, vEdge);
    // opaque enough to read on ground in full shadow, as well as in sunlight
    float a = uReveal * max(0.2 + 0.36 * stripe, 0.9 * edge);
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

/** Unsafe ground along the track (the touchdown evaluation), hatched, widened to the LM's footprint. */
function HazardStrip({ site, terrain, physRef }) {
  const mesh = useMemo(() => {
    const pos = [];
    const edge = [];
    const idx = [];
    const zs = [-1, -0.5, 0, 0.5, 1];
    for (const h of hazardStrip(site)) {
      const x0 = h.x0 - 0.25;
      const x1 = h.x1 + 0.25;
      const n = Math.max(1, Math.ceil((x1 - x0) / 0.5));
      const start = pos.length / 3;
      for (let i = 0; i <= n; i++) {
        const x = x0 + ((x1 - x0) * i) / n;
        const endFrac = i === 0 || i === n ? 1 : 0;
        for (const f of zs) {
          const z = f * h.halfWidth;
          pos.push(x * WORLD_X, site.scale.y(terrain.lookup(x, z)) + 0.06, z * WORLD_X);
          edge.push(Math.max(Math.abs(f), endFrac));
        }
      }
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < zs.length - 1; k++) {
          const a = start + i * zs.length + k;
          const b = a + zs.length;
          idx.push(a, a + 1, b, a + 1, b + 1, b); // counter-clockwise seen from above
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aEdge", new THREE.Float32BufferAttribute(edge, 1));
    g.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      vertexShader: HATCH_VERT,
      fragmentShader: HATCH_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      uniforms: { uReveal: { value: 0 }, uColor: { value: new THREE.Color("#ff1f3d") } },
    });
    const mm = new THREE.Mesh(g, m);
    mm.name = "hazard-strip";
    mm.renderOrder = 2;
    mm.frustumCulled = false;
    return mm;
  }, [site, terrain]);
  useEffect(() => () => {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }, [mesh]);
  const landedAt = useRef(null);
  useFrame((state) => {
    const p = physRef && physRef.current;
    // the guidance computer's terrain map, legible from 400 m down; after
    // touchdown it has done its job and fades away
    let reveal = p ? Math.max(0, Math.min(1, (400 - p.alt) / 250)) : 1;
    if (p && p.alt <= 0) {
      if (landedAt.current == null) landedAt.current = state.clock.elapsedTime;
      reveal *= Math.max(0, 1 - (state.clock.elapsedTime - landedAt.current) / 1.2);
    }
    mesh.material.uniforms.uReveal.value = reveal;
    mesh.visible = reveal > 0.01;
  });
  return <primitive object={mesh} />;
}

function ZoneRings({ site, terrain, physRef }) {
  const rings = useMemo(
    () =>
      site.zones.map((z) => {
        const g = drapedRing(site, terrain, z.x, 0, z.r, 0.6);
        const m = new THREE.MeshBasicMaterial({
          color: z.primary ? "#FF3B00" : "#4a90e2",
          transparent: true,
          opacity: z.primary ? 0.9 : 0,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(g, m);
        mesh.renderOrder = 2;
        mesh.frustumCulled = false;
        return { zone: z, mesh };
      }),
    [site, terrain]
  );
  useEffect(() => () => rings.forEach(({ mesh }) => {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }), [rings]);
  useFrame(() => {
    const p = physRef && physRef.current;
    const reveal = p ? Math.max(0, Math.min(1, (500 - p.alt) / 300)) : 1;
    rings.forEach(({ zone, mesh }) => {
      if (!zone.primary) mesh.material.opacity = 0.85 * reveal;
      mesh.visible = zone.primary || reveal > 0.01;
    });
  });
  return (
    <>
      {rings.map(({ zone, mesh }) => (
        <primitive key={zone.label} object={mesh} />
      ))}
    </>
  );
}

/** Landing zones and unsafe ground, on the terrain. renderOrder 2: drawn after the dust. */
export function SiteMarkers({ site, physRef }) {
  const terrain = useMemo(() => buildTerrain(site), [site]);
  return (
    <group>
      <HazardStrip site={site} terrain={terrain} physRef={physRef} />
      <ZoneRings site={site} terrain={terrain} physRef={physRef} />
    </group>
  );
}

/* ---- the landing point designator: the LM's footprint where it will touch down ---------------- */
const LPD_N = 56;
export function LandingPoint({ site, physRef, predict }) {
  const terrain = useMemo(() => buildTerrain(site), [site]);
  const { ring, cross } = useMemo(() => {
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(LPD_N * 6 * 3), 3));
    const cg = new THREE.BufferGeometry();
    cg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(4 * 9 * 3), 3));
    const mat = (o) =>
      new THREE.MeshBasicMaterial({ color: "#FFDD00", transparent: true, opacity: o, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide });
    const r = new THREE.Mesh(rg, mat(0));
    const c = new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: "#FFDD00", transparent: true, opacity: 0, depthWrite: false }));
    [r, c].forEach((m) => {
      m.renderOrder = 2;
      m.frustumCulled = false;
    });
    return { ring: r, cross: c };
  }, []);
  useEffect(() => () => {
    [ring, cross].forEach((m) => {
      m.geometry.dispose();
      m.material.dispose();
    });
  }, [ring, cross]);
  const last = useRef({ x: Infinity, unsafe: null });
  useFrame(() => {
    const p = physRef.current;
    if (!p) return;
    const show = p.alt > 3;
    ring.visible = cross.visible = show;
    if (!show) return;
    const x = predict(p);
    const op = Math.max(0, Math.min(0.9, (800 - p.alt) / 400));
    ring.material.opacity = op;
    cross.material.opacity = op * 0.8;
    if (Math.abs(x - last.current.x) > 0.02) {
      const e = site.evaluate(x);
      const unsafe = !!e.hazard;
      if (unsafe !== last.current.unsafe) {
        ring.material.color.set(unsafe ? "#FF3B00" : "#FFDD00");
        cross.material.color.set(unsafe ? "#FF3B00" : "#FFDD00");
      }
      last.current = { x, unsafe };
      window.__lvLandingPoint = { x, unsafe, label: e.hazard ? e.hazard.label : e.safeZone ? e.safeZone.label : null };
      const a = ring.geometry.attributes.position.array;
      const R = FOOT_RADIUS;
      const w = 0.45;
      const at = (ang, rr) => {
        const px = x + Math.cos(ang) * rr;
        const pz = Math.sin(ang) * rr;
        return [px * WORLD_X, site.scale.y(terrain.lookup(px, pz)) + 0.08, pz * WORLD_X];
      };
      let o = 0;
      for (let i = 0; i < LPD_N; i++) {
        const a0 = (i / LPD_N) * Math.PI * 2;
        const a1 = ((i + 1) / LPD_N) * Math.PI * 2;
        const v = [at(a0, R - w), at(a0, R), at(a1, R), at(a0, R - w), at(a1, R), at(a1, R - w)];
        for (const q of v) {
          a[o++] = q[0];
          a[o++] = q[1];
          a[o++] = q[2];
        }
      }
      ring.geometry.attributes.position.needsUpdate = true;
      // the cross: two draped lines through the centre, the length of the footprint
      const c = cross.geometry.attributes.position.array;
      o = 0;
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        for (let k = 0; k < 9; k++) {
          for (const kk of [k, k + 1]) {
            const t = (kk / 9) * 2 - 1;
            const px = x + dx * t * R * 0.55;
            const pz = dz * t * R * 0.55;
            c[o++] = px * WORLD_X;
            c[o++] = site.scale.y(terrain.lookup(px, pz)) + 0.1;
            c[o++] = pz * WORLD_X;
          }
        }
      }
      cross.geometry.attributes.position.needsUpdate = true;
    }
  });
  return (
    <>
      <primitive object={ring} />
      <primitive object={cross} />
    </>
  );
}

/** Height of the drawn ground (scene units) at (x, z) metres. */
export const groundY = (site, x, z = 0) => site.scale.y(buildTerrain(site).lookup(x, z));
