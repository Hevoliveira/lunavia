#!/usr/bin/env bash
# LV-001 prototype: Blender's raw GLB -> the runtime GLB for the dev comparison route.
# Needs @gltf-transform/cli 4.x (npx gltf-transform …; GT=/path/to/gltf-transform to override).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
GT="${GT:-npx --yes @gltf-transform/cli@4.1.1}"
IN="$HERE/build/lv001_raw.glb"
OUT="${1:-$HERE/../../frontend/src/dev/lv001/lv001_prototype.glb}"
T="$HERE/build/tmp"
mkdir -p "$T"
$GT dedup "$IN" "$T/a.glb"
$GT prune "$T/a.glb" "$T/b.glb"
if [ "${FORMAT:-ktx2}" = "webp" ]; then
  # WebP textures (EXT_texture_webp): small download, but decoded to RGBA8 in GPU memory.
  $GT webp "$T/b.glb" "$T/c.glb" --quality 92 --slots "normalTexture"
  $GT webp "$T/c.glb" "$T/d.glb" --quality 86 --slots "{baseColorTexture,metallicRoughnessTexture,occlusionTexture}"
else
  # KTX2 / Basis Universal (KHR_texture_basisu): stays compressed in GPU memory (ASTC / ETC2 on
  # iPhone, transcoded by three's bundled Basis transcoder). UASTC for normal maps (no ETC1S
  # block artefacts in the shading), ETC1S for colour and ORM. Needs toktx (KTX-Software 4.x) on PATH.
  $GT uastc "$T/b.glb" "$T/c.glb" --slots "normalTexture" --level 2 --rdo 1 --zstd 18
  $GT etc1s "$T/c.glb" "$T/d.glb" --slots "{baseColorTexture,metallicRoughnessTexture,occlusionTexture}" --quality 192
fi
# meshopt geometry compression (EXT_meshopt_compression; three's MeshoptDecoder, bundled, no CDN)
$GT meshopt "$T/d.glb" "$OUT" --level medium
ls -l "$IN" "$OUT"
