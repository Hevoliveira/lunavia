import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { useFrame, useThree } from "@react-three/fiber";
import PayloadSection from "@/components/spacecraft/PayloadSection";
import { payloadMaterials, SPACECRAFT } from "@/components/RocketModel";
import { ROCKET_M_PER_UNIT } from "@/data/payloadDesign";
import glbUrl from "./lv001_prototype.glb";

// three's own Basis Universal transcoder, emitted by webpack with this dev chunk (no CDN, nothing
// in public/): KTX2Loader asks for it by file name, the URL modifier hands it the bundled files.
const BASIS_JS = new URL("three/examples/jsm/libs/basis/basis_transcoder.js", import.meta.url).href;
const BASIS_WASM = new URL("three/examples/jsm/libs/basis/basis_transcoder.wasm", import.meta.url).href;

/*
 * DEVELOPMENT ONLY — the LV-001 Blender prototype (art/lv001), loaded from its GLB, for the
 * side-by-side comparison at /dev/lv001. Not used by the game.
 *
 * Integration interface (the same contract as RocketModel): the GLB's top-level nodes
 * Stage1 / Stage2 / Payload / LES are re-parented here into model-unit groups and driven by
 * `ctrlRef.current` exactly as RocketModel drives its stage1Ref / lesRef / payloadRef
 * (sep, showStage1, les, stageGap). The payload itself is LUNAVIA's runtime PayloadSection,
 * mounted at SPACECRAFT.slaBase as in RocketModel. Engine plumes stay RocketModel's (not part of
 * this prototype); the engine nodes S1_Engine_C / S1_Engine_1..4 sit at RocketModel's ENGINES
 * transforms, and the bell materials' emissive follows `glow` / `upper` as RocketModel's do.
 */

const DEFAULT_CTRL = { engines: [0, 0, 0, 0, 0], glow: 0, sep: 0, upper: 0, showStage1: true, expand: 0, les: 0, stageGap: 0 };

let LOAD = null;
export const lv001LoadStats = { fetchMs: 0, parseMs: 0, bytes: 0 };

function loadPrototype(gl) {
  if (LOAD) return LOAD;
  LOAD = (async () => {
    const t0 = performance.now();
    const res = await fetch(glbUrl);
    const buf = await res.arrayBuffer();
    const t1 = performance.now();
    await MeshoptDecoder.ready;
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((u) => (u.endsWith("basis_transcoder.js") ? BASIS_JS : u.endsWith("basis_transcoder.wasm") ? BASIS_WASM : u));
    const ktx2 = new KTX2Loader(manager).setTranscoderPath("/").detectSupport(gl);
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.setKTX2Loader(ktx2);
    const gltf = await new Promise((ok, fail) => loader.parse(buf, "", ok, fail));
    const t2 = performance.now();
    Object.assign(lv001LoadStats, { fetchMs: t1 - t0, parseMs: t2 - t1, bytes: buf.byteLength });
    return gltf;
  })();
  return LOAD;
}

function partsFrom(gltf, anisotropy) {
  const root = gltf.scene.getObjectByName("LV001");
  const parts = {};
  [...root.children].forEach((child) => {
    const g = new THREE.Group();
    g.name = child.name;
    child.scale.multiplyScalar(root.scale.x); // metres -> model units (the root's 1/18)
    g.add(child);
    parts[child.name] = g;
  });
  const mats = {};
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; // as the launch film does for the vehicle's meshes
    const m = o.material;
    mats[m.name] = m;
    ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap"].forEach((k) => {
      if (m[k]) {
        m[k].anisotropy = anisotropy;
        m[k].needsUpdate = true;
      }
    });
  });
  // runtime glow, as RocketModel's bell materials
  if (mats.M_Bell1) mats.M_Bell1.emissive = new THREE.Color("#ff7a1e");
  if (mats.M_Bell1Inner) mats.M_Bell1Inner.emissive = new THREE.Color("#ff9a3c");
  if (mats.M_Bell2) mats.M_Bell2.emissive = new THREE.Color("#a8461c");
  if (mats.M_Bell2Inner) mats.M_Bell2Inner.emissive = new THREE.Color("#b9d2ff");
  return { parts, mats };
}

export default function Lv001Prototype({ scale = 1, ctrlRef = null, anisotropy = 8, onReady }) {
  const gl = useThree((s) => s.gl);
  const [model, setModel] = useState(null);
  const payloadRef = useRef();
  useEffect(() => {
    let live = true;
    loadPrototype(gl).then((gltf) => {
      if (live) setModel(partsFrom(gltf, anisotropy));
    });
    return () => {
      live = false;
    };
  }, [anisotropy, gl]);
  const payloadMats = useMemo(() => (model ? payloadMaterials(model.mats.M_Bell2 || null) : null), [model]);
  useEffect(() => {
    if (model && onReady) onReady(model);
  }, [model, onReady]);

  useFrame(() => {
    if (!model) return;
    const c = (ctrlRef && ctrlRef.current) || DEFAULT_CTRL;
    const P = model.parts;
    // stage 1 separation: identical to RocketModel
    const s = c.sep || 0;
    const e = 1 - (1 - Math.min(1, s)) * (1 - Math.min(1, s));
    if (P.Stage1) {
      const far = Math.max(0, s - 1);
      P.Stage1.visible = c.showStage1 !== false;
      P.Stage1.position.set(e * 0.55 + far * 0.5, -e * 2.3 - far * far * 3.2 - far * 1.4, 0);
      P.Stage1.rotation.z = s * 0.42;
      P.Stage1.rotation.x = s * 0.16;
    }
    if (P.LES) {
      const j = c.les || 0;
      P.LES.visible = j < 3;
      P.LES.position.set(0.06 * j * j, 1.6 * j * j, -0.03 * j * j);
      P.LES.rotation.set(0.05 * j * j, 0, -0.12 * j * j);
    }
    if (payloadRef.current) payloadRef.current.position.y = (c.stageGap || 0) / ROCKET_M_PER_UNIT;
    const eng = c.engines || DEFAULT_CTRL.engines;
    const thrust = (eng[0] + eng[1] + eng[2] + eng[3] + eng[4]) / 5;
    const glow = c.glow ?? thrust;
    const M = model.mats;
    if (M.M_Bell1) M.M_Bell1.emissiveIntensity = 0.55 * glow;
    if (M.M_Bell1Inner) M.M_Bell1Inner.emissiveIntensity = 1.4 * glow;
    if (M.M_Bell2) M.M_Bell2.emissiveIntensity = (c.upper || 0) * 0.12;
    if (M.M_Bell2Inner) M.M_Bell2Inner.emissiveIntensity = (c.upper || 0) * 1.2;
  });

  if (!model) return null;
  const P = model.parts;
  return (
    <group scale={scale}>
      <primitive object={P.Stage1} />
      <primitive object={P.Stage2} />
      <group ref={payloadRef}>
        {P.Payload && <primitive object={P.Payload} />}
        <group position={[0, SPACECRAFT.slaBase, 0]} scale={SPACECRAFT.M}>
          <PayloadSection ctrlRef={ctrlRef} materials={payloadMats} />
        </group>
      </group>
      <primitive object={P.LES} />
    </group>
  );
}
