# LV-001 3D prototype — evaluation of the NASA Saturn V model (step 1–3)

Isolated experiment on `claude/lv001-3d-prototype` (from `claude/nasa-visual-upgrade` 0a191f2,
BUILD 1317851). Nothing in the game changes here.

## The NASA model

| | |
|---|---|
| Source | NASA 3D Resources, `3D Models/Saturn V/Saturn V.glb` (github.com/nasa/NASA-3D-Resources, master). The same model is offered at science.nasa.gov/3d-resources/saturn-v (that host is not reachable from this environment). |
| File | 927,212 bytes, SHA-256 `6c44497bce54ee0b09d0edb8e33a6f484762a320dab1c54b383e434f5bba06b5`; the uploaded copy and the GitHub file are byte-identical. Not committed (source only). |
| Format | glTF 2.0 binary, exported by Khronos glTF Blender I/O 4.2.57 (a Maya scene originally: `pCylinder1`, `polySurface`, `blinn*SG`). Extensions: KHR_materials_specular, EXT_texture_webp (PNG fallbacks). |
| Rights | NASA 3D Resources: free, no copyright; NASA insignia and identifiers excepted (see the repository's usage guidelines). |
| Geometry | 22 meshes, 34,814 triangles, 22,416 vertices. About 30,000 triangles are the five engine bells (≈ 6,000 each). The whole vehicle body — every stage, interstage and the escape tower — is ONE mesh of ≈ 2,100 triangles. Fins: flat plates (16 triangles each). |
| Hierarchy | 23 flat nodes, no stage grouping: the stages cannot separate without re-cutting the mesh. 23 animation clips (one per node, transform keys; not stage separation). |
| UVs | Present (TEXCOORD_0) but used only to place markings. |
| Materials | 13 Blinn-converted materials: flat colours, metalness 0, roughness 0.41, all double-sided. No normal, roughness, metalness or occlusion maps. |
| Textures | Four 1000 × 1000 images (≈ 20 KB each) that are almost empty: tiny "USA" / "UNITED STATES" lettering and US flags. One flag texture's navy background covers a whole section of the first stage (a mapping flaw, visible in `cmp-full.jpg`). |
| Dimensions | 12.99 units tall, body Ø ≈ 1.27, fin span 2.01: arbitrary units, and a height/diameter ratio of 10.2 (the Saturn V's is 11.0). |
| Real-time suitability | Cheap to draw (≈ 35k triangles, 13 materials) but low fidelity: hard-edged cylinders, no surface definition, no engine plumbing, thrust structure, heat shield or umbilicals. |

## Compared with LV-001 (BUILD 1317851)

| | NASA Saturn V GLB | LV-001 (RocketModel.jsx) |
|---|---|---|
| Triangles | 34.8k | ≈ 34k (pre-launch view; 53 meshes, batched) |
| Body | one mesh, plain cylinders | per-stage lathe/cylinder parts, interstage stringers, intertank corrugation, raceway, access panels, retro rockets, umbilical plates |
| Engines | five plain bells | five F-1-class bells with tube-wall texture, hat bands, manifolds, turbopumps, gimbal actuators, thrust structure, quilted heat shield; J-2-class upper-stage engine |
| Materials | flat Blinn colours | PBR paint with clearcoat, bump/roughness maps, metallic hardware, insulated surfaces |
| Staging / animation | no hierarchy | stage 1, stage 2, payload, escape tower as groups; engines, plumes, separation, LES jettison driven per frame |
| Identity | Saturn V roll pattern, "USA", flags | LUNAVIA white / orange / black, no national markings |

Side by side under the launch film's lighting and tone mapping: `cmp-full.jpg`, `cmp-aft2.jpg`,
`cmp-mid.jpg`; the NASA engines in wireframe: `nasa-aft-wireframe.jpg`; its textures: `nasa-textures.jpg`.

## Assessment

- **B. Adapt components from the NASA model — not recommended.** Every component is less detailed than
  LV-001's own (the engines are the only dense part, and they are plain bells); its materials carry
  no maps; its markings are national insignia; the body is a single mesh with no stage split.
- **A. Improve the existing model with external tools** — possible but limited: LV-001 is generated in
  code, so a modelling tool can only work on an export, and every change would have to be carried
  back into code by hand.
- **C. A new LV-001 visual mesh built in a professional mesh workflow — recommended.** Blender (as the
  `bpy` 4.2 Python module, installable here) can model LV-001 at its exact stations and stage split,
  bevel edges, UV-unwrap, and bake ambient occlusion and normal maps from a high-detail version onto a
  game-weight mesh, exported as GLB with PBR textures (compressed with gltf-transform). RocketModel
  would keep its interface (ctrlRef, plumes, separation, LES) and swap only the visible meshes, so
  timing, physics and cameras are untouched. The NASA photographs and drawings in
  `docs/visual-references` remain the engineering reference; the NASA GLB is not used.
