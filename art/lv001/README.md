# LV-001 — Blender visual prototype

A **visual prototype** of LUNAVIA's LV-001, built in Blender 4.2 from code. It is **not** used by
the game: the production rocket is still `frontend/src/components/RocketModel.jsx`. The prototype
is shown only at the development route `/dev/lv001` (A = current rocket, B = this prototype), in
the game's own renderer.

The vehicle is LV-001 — not a Saturn V. Silhouette, overall dimensions, stage stations, the five
first-stage engines and their positions, the separation planes, the payload, the LUNAVIA
lettering, the white / orange / black scheme and the escape tower all come from `RocketModel.jsx`
(the scripts use its model units). There are no national markings.

## Files

| File | What it is |
| --- | --- |
| `build_lv001.py` | The asset: textures, materials, every mesh, the hierarchy, the Cycles bakes, the `.blend`, the raw GLB, `stats.json` |
| `lv001_mesh.py` | Mesh helpers (lathe, swept tubes, bevelled boxes, surfaces; three.js frame and model units → Blender metres) |
| `lv001_tex.py` | Texture authoring (numpy + Pillow): painted stage skins, tileable stringer / corrugated / foil / quilt / hardware sets, bell maps, AO merge |
| `optimize.sh` | Raw GLB → runtime GLB (gltf-transform: dedup, prune, KTX2 textures, meshopt) |
| `render_diag.py` | Diagnostic Cycles renders (geometry checks only — not evidence; the comparison images come from the game) |
| `build/lv001_prototype.blend` | The editable source, with its textures in `build/textures/` (paths relative) |
| `../../frontend/src/dev/lv001/lv001_prototype.glb` | The runtime asset (dev route only) |

## Rebuild

```sh
# Blender 4.2 as a Python module (pip install bpy==4.2.0 in a Python 3.11 venv), plus numpy and Pillow
python art/lv001/build_lv001.py          # ~2 min on 4 CPU cores (the bakes)
# gltf-transform 4.x and toktx (KTX-Software 4.3) on PATH
art/lv001/optimize.sh                    # writes frontend/src/dev/lv001/lv001_prototype.glb
python art/lv001/render_diag.py out full aft engines   # optional
```

`LV_FAST=1` skips the bakes (for geometry iteration). `FORMAT=webp art/lv001/optimize.sh` writes
WebP textures instead of KTX2 (smaller download, but RGBA8 in GPU memory).

## Hierarchy (GLB node names)

```
LV001                                (scale 1/18: metres → RocketModel units)
├── Stage1                           ← RocketModel stage1Ref (falls away at separation)
│   ├── S1_Tank                      painted skin, unique UVs (LUNAVIA lettering, bands, frames)
│   ├── S1_Intertank                 corrugated black band
│   ├── S1_Skirt                     thrust-section skirt (stringers, aft lip, inner wall)
│   ├── S1_Fins                      four fins, roots on the skirt surface
│   ├── S1_Raceway, S1_Fittings      systems tunnel, umbilical plates, fill / vent fittings
│   ├── S1_HeatShield                quilted base heat shield + flame curtains
│   ├── S1_ThrustStructure           thrust ring and beams (hidden), forward bulkhead
│   ├── S1_Interstage                ribbed interstage, frangible joint, retro motors, vents, hatches
│   └── S1_Engine_C, S1_Engine_1..4  each: _Bell, _BellInner, _Hardware (turbopump, ducts, manifolds)
├── Stage2                           ← stays with the vehicle
│   ├── S2_Body, S2_AftSkirt, S2_RCS, S2_Forward (forward dome, seen after carrier separation)
│   └── S2_Engine                    _Bell, _BellInner, _Hardware
├── Payload                          ← RocketModel payloadRef (moves with stageGap)
│   ├── Payload_Interface            separation ring + bolt fittings
│   └── PayloadSection_Mount         empty at SPACECRAFT.slaBase: the runtime PayloadSection goes here
└── LES                              ← RocketModel lesRef (jettisoned)
    ├── LES_Cover, LES_Tower
    └── LES_Beacon                   empty: the runtime's emissive beacon position
```

## Integration interface (for any future production use — not done here)

* **Units / frame:** after the root's 1/18 the GLB is in RocketModel units, y up, base of the
  skirt at y ≈ 0.03, the same origin as RocketModel. Place it exactly where RocketModel goes
  (`scale={ROCKET_SCALE}`, the film's `BASE_Y`).
* **Separation:** drive the `Stage1`, `LES` and `Payload` nodes with RocketModel's own formulas
  (`sep`, `showStage1`, `les`, `stageGap` from `ctrlRef`) — `frontend/src/dev/lv001/Lv001Prototype.jsx`
  does exactly this, with RocketModel's numbers. Separation planes are unchanged: the interstage
  (y 2.48–2.86) leaves with stage 1, the upper stage starts at y 2.86, the carrier / payload at
  y 4.145, the LES cover at the CM / SM interface.
* **Engines:** `S1_Engine_C` at (0, −0.06, 0) ×1.03 and `S1_Engine_1..4` at radius 0.235,
  45° + i·90°, y −0.06 — RocketModel's `ENGINES` transforms (the outboard engines are also yawed so
  their turbopumps face outward). `S2_Engine` at y 2.5. Plumes, halos and engine lights are not part
  of the asset: keep RocketModel's plume groups (same positions). Thrust glow = emissive on
  `M_Bell1` / `M_Bell1Inner` / `M_Bell2` / `M_Bell2Inner` (the dev component sets RocketModel's
  colours and intensities).
* **Payload:** not remodelled — LUNAVIA's runtime `PayloadSection` (CSM, adapter, LM, carrier) is
  mounted at `SPACECRAFT.slaBase` with `SPACECRAFT.M`, as RocketModel does.
* **Loaders:** `GLTFLoader` + `MeshoptDecoder` + `KTX2Loader` (three's bundled Basis transcoder,
  served from the app bundle — no CDN).

## Materials (PBR, glTF metallic-roughness)

Base colour (sRGB) + ORM (R occlusion, G roughness, B metalness) + tangent-space normal map
(OpenGL convention, tangents exported).

| Material | Maps | Notes |
| --- | --- | --- |
| `M_S1_Paint`, `M_S2_Paint` | unique 1024² / 1024×512 | painted aluminium + clearcoat 0.3; weld lands, rivets, oil-canning and access panels in the normal map; Cycles AO from fittings / raceway / RCS in ORM.R |
| `M_Bell1`, `M_Bell2` | 512×256 colour / ORM, 1024×512 normal | **normal and tube-gap AO baked in Cycles from a high-poly tube wall (120 / 144 tubes, ~0.3 M quads) onto the runtime bell**; F-1 extension shingles; restrained heat tint at the exit |
| `M_Bell1Inner`, `M_Bell2Inner` | shared 256² + the bells' normal maps | soot-dark interior with the tube wall |
| `M_Intertank`, `M_Skirt`, `M_Interstage` | 512² tileable | corrugation / hat-section stringers |
| `M_HeatShield` | 512² | quilted blankets |
| `M_Foil` | 256² tileable | crinkled turbopump insulation |
| `M_Hardware` | 256² tileable | brushed / anodised metal |
| `M_White`, `M_Orange`, `M_Silver`, `M_LES`, `M_Cavity` | factors | LV-001's own colours |

No lighting or shadow is baked into any colour map; occlusion lives only in ORM.R (small-scale,
persistent: tube gaps, fittings, raceway, RCS modules). The bell AO is baked with the
neighbouring engines hidden, because the five bells share one material.
