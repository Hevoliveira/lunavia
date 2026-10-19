#!/usr/bin/env python3
"""
LUNAVIA — build the mobile planet textures from the NASA source maps.

Sources (downloaded into SRC; see public/textures/planets/SOURCES.md for
provenance and usage rights):
  lroc_color_poles_8k.tif   NASA SVS CGI Moon Kit (LRO LROC WAC colour, 8192x4096)
  ldem_16_uint.tif          NASA SVS CGI Moon Kit (LRO LOLA elevation, 16 px/deg, uint16, 0.5 m units)
  earth-blue-marble.jpg     NASA Visible Earth Blue Marble (with bathymetry), 4096x2048
  water_4k.png              land/water mask derived from NASA Blue Marble, 4096x2048
  fair_clouds_4k.png        cloud layer derived from NASA Blue Marble clouds, 4096x2048 (alpha)
  earth_lights_2048.png     NASA Visible Earth "Earth's City Lights", 2048x1024

Outputs (OUT = frontend/public/textures/planets):
  moon_color_4k.jpg         LROC colour, 4096x2048
  moon_normal_2k.jpg        surface normals from LOLA, 2048x1024, encoded in the local
                            (east, north, up) frame: rgb = n * 0.5 + 0.5
  earth_day_4k.jpg          Blue Marble, 4096x2048
  earth_aux_4k.jpg          R = water mask, G = city lights, B = cloud density (4096x2048)
  earth_day_1k.jpg,
  earth_aux_1k.jpg          the same two at 1024x512, for an Earth seen only as a small disc

Usage: python3 prepare_textures.py SRC OUT
"""
import sys

import numpy as np
import tifffile
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
SRC, OUT = sys.argv[1], sys.argv[2]
MOON_R_M = 1737400.0


def save_jpg(arr, path, q=88):
    Image.fromarray(arr).save(path, quality=q, optimize=True, progressive=False, subsampling=0)
    print("wrote", path, arr.shape)


# ---- Moon colour ------------------------------------------------------------------------
col = tifffile.imread(f"{SRC}/lroc_color_poles_8k.tif")
if col.dtype != np.uint8:
    col = (col.astype(np.float32) / col.max() * 255).astype(np.uint8)
col = np.array(Image.fromarray(col[..., :3]).resize((4096, 2048), Image.LANCZOS))
save_jpg(col, f"{OUT}/moon_color_4k.jpg", 88)

# ---- Moon normals from LOLA elevation ----------------------------------------------------
dem = tifffile.imread(f"{SRC}/ldem_16_uint.tif").astype(np.float64) * 0.5  # metres
H, W = dem.shape
lat = (0.5 - (np.arange(H) + 0.5) / H) * np.pi  # +90 at the top row
dlon = 2 * np.pi / W
dlat = np.pi / H
# central differences, wrapping in longitude
dx = (np.roll(dem, -1, axis=1) - np.roll(dem, 1, axis=1)) / (2 * MOON_R_M * np.maximum(np.cos(lat), 0.02)[:, None] * dlon)
up = np.vstack([dem[:1], dem[:-1]])
dn = np.vstack([dem[1:], dem[-1:]])
dy = (up - dn) / (2 * MOON_R_M * dlat)  # north
K = 2.0  # relief exaggeration: subtle, so the limb stays round
n = np.dstack([-K * dx, -K * dy, np.ones_like(dem)])
n /= np.linalg.norm(n, axis=2, keepdims=True)
enc = ((n * 0.5 + 0.5) * 255).clip(0, 255).astype(np.uint8)
enc = np.array(Image.fromarray(enc).resize((2048, 1024), Image.LANCZOS))
save_jpg(enc, f"{OUT}/moon_normal_2k.jpg", 92)

# ---- Earth day -------------------------------------------------------------------------
day = np.array(Image.open(f"{SRC}/earth-blue-marble.jpg").convert("RGB"))
save_jpg(day, f"{OUT}/earth_day_4k.jpg", 88)

# ---- Earth aux: water, city lights, clouds ----------------------------------------------
water = np.array(Image.open(f"{SRC}/water_4k.png").convert("L").resize((4096, 2048), Image.LANCZOS))
lights_rgb = np.array(Image.open(f"{SRC}/earth_lights_2048.png").convert("RGB").resize((4096, 2048), Image.BICUBIC)).astype(np.float32)
# the lights are warm points over a faint blue land tint: keep the warm light only
lights = np.clip(np.minimum(lights_rgb[..., 0], lights_rgb[..., 1]) - 22.0, 0, None) * 1.25
lights = np.clip(lights, 0, 255).astype(np.uint8)
clouds = np.array(Image.open(f"{SRC}/fair_clouds_4k.png").convert("RGBA").getchannel("A").resize((4096, 2048), Image.LANCZOS))
aux = np.dstack([water, lights, clouds]).astype(np.uint8)
save_jpg(aux, f"{OUT}/earth_aux_4k.jpg", 90)

# ---- the Earth at 1k (the lunar sky, the far-side intro) ----------------------------------
save_jpg(np.array(Image.fromarray(day).resize((1024, 512), Image.LANCZOS)), f"{OUT}/earth_day_1k.jpg", 90)
save_jpg(np.array(Image.fromarray(aux).resize((1024, 512), Image.LANCZOS)), f"{OUT}/earth_aux_1k.jpg", 92)
