#!/usr/bin/env python3
"""
LUNAVIA — visual-regression checks on the shipped planet textures.

  python3 check_textures.py [DIR]   (default: frontend/public/textures/planets)

Checks, each printed ok/FAIL (exit code 1 on any failure):
  - every texture exists, is a power-of-two equirectangular map (2:1) and decodes;
  - geography: landmarks fall where they belong in the shared projection
    (longitude -180..180 left to right, latitude +90 at the top), so no map is
    shifted, mirrored or upside down:
      Earth: Sahara sandy, central Atlantic and Pacific dark water, Greenland and
      Antarctica icy, the water mask agrees, Europe/US lit at night, oceans unlit;
      Moon: Mare Imbrium and Mare Crisium dark against the southern highlands,
      the near side darker on average (maria) than the far side;
  - seams: the left and right edges of each map meet (no visible meridian seam);
  - Moon normals: point outwards (no inverted normals), with gentle relief;
  - no blank maps (each channel varies).
"""
import os
import sys

import numpy as np
from PIL import Image

D = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "..", "public", "textures", "planets")
fails = []


def check(ok, msg):
    print(("  ok    " if ok else "  FAIL  ") + msg)
    if not ok:
        fails.append(msg)


def load(name):
    return np.asarray(Image.open(os.path.join(D, name)).convert("RGB")).astype(np.float32) / 255.0


def at(img, lat, lon, r=3):
    h, w = img.shape[:2]
    y = int((90 - lat) / 180 * h)
    x = int((lon + 180) / 360 * w) % w
    return img[max(0, y - r) : y + r + 1, max(0, x - r) : x + r + 1].reshape(-1, img.shape[2]).mean(0)


maps = {n: load(n) for n in ["earth_day_4k.jpg", "earth_aux_4k.jpg", "earth_day_1k.jpg", "earth_aux_1k.jpg", "moon_color_4k.jpg", "moon_normal_2k.jpg"]}
print("sizes")
for n, m in maps.items():
    h, w = m.shape[:2]
    check(w == 2 * h and (w & (w - 1)) == 0, f"{n}: {w}x{h}, power of two, 2:1")
    check(all(m[..., c].std() > 0.02 for c in range(3)), f"{n}: not blank (every channel varies)")

day, aux, moon, nrm = maps["earth_day_4k.jpg"], maps["earth_aux_4k.jpg"], maps["moon_color_4k.jpg"], maps["moon_normal_2k.jpg"]
print("earth geography")
s = at(day, 23, 12)
check(s[0] > s[2] + 0.1, f"Sahara (23N 12E) is sandy {s.round(2)}")
for name, (la, lo) in {"central Atlantic": (0, -30), "central Pacific": (0, -150), "Indian Ocean": (-20, 80)}.items():
    c = at(day, la, lo)
    check(c[2] > c[0] and c.mean() < 0.35, f"{name} ({la}, {lo}) is dark water {c.round(2)}")
    check(at(aux, la, lo)[0] > 0.8, f"{name}: the water mask says water")
for name, (la, lo) in {"Greenland": (74, -40), "Antarctica": (-80, 0)}.items():
    c = at(day, la, lo)
    check(c.mean() > 0.7, f"{name} is ice {c.round(2)}")
check(at(aux, 23, 12)[0] < 0.2, "the water mask says land in the Sahara")
lights_land = max(at(aux, 51.5, -0.1, 6)[1], at(aux, 40.7, -74, 6)[1], at(aux, 35.7, 139.7, 6)[1])
check(lights_land > 0.25, f"city lights in London / New York / Tokyo ({lights_land:.2f})")
check(at(aux, 0, -150, 8)[1] < 0.05 and at(aux, -30, -20, 8)[1] < 0.05, "no city lights in mid-ocean")
print("moon geography")
imb, cri, high = at(moon, 33, -16, 6).mean(), at(moon, 17, 59, 4).mean(), at(moon, -30, 10, 6).mean()
check(imb < high - 0.12, f"Mare Imbrium (33N 16W) {imb:.2f} darker than the southern highlands {high:.2f}")
check(cri < high - 0.12, f"Mare Crisium (17N 59E) {cri:.2f} darker than the highlands")
h, w = moon.shape[:2]
near = moon[h // 4 : 3 * h // 4, w // 4 : 3 * w // 4].mean()
far = np.concatenate([moon[h // 4 : 3 * h // 4, : w // 4], moon[h // 4 : 3 * h // 4, 3 * w // 4 :]], axis=1).mean()
check(near < far - 0.02, f"near side (maria) darker on average than the far side ({near:.2f} < {far:.2f})")
print("1k Earth = the 4k Earth, smaller")
for n in ["earth_day", "earth_aux"]:
    big = np.asarray(Image.open(os.path.join(D, n + "_4k.jpg")).convert("RGB").resize((1024, 512), Image.LANCZOS)).astype(np.float32) / 255.0
    diff = np.abs(big - maps[n + "_1k.jpg"]).mean()
    check(diff < 0.02, f"{n}_1k.jpg matches {n}_4k.jpg downsampled (mean difference {diff:.3f})")
print("seams")
for n, m in maps.items():
    edge = np.abs(m[:, 0] - m[:, -1]).mean()
    inner = np.abs(m[:, m.shape[1] // 2] - m[:, m.shape[1] // 2 + 1]).mean()
    check(edge < max(0.02, inner * 3), f"{n}: left/right edges meet ({edge:.3f}, neighbouring columns {inner:.3f})")
print("moon normals")
n = nrm * 2 - 1
z = n[..., 2]
check(z.min() > 0.0, f"every normal points outwards (min up component {z.min():.2f})")
check(0.9 < z.mean() < 0.9999, f"gentle relief (mean up component {z.mean():.3f})")
print("\n" + (f"{len(fails)} failure(s)" if fails else "all planet textures pass"))
sys.exit(1 if fails else 0)
