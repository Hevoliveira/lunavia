"""
LV-001 prototype — texture authoring (numpy + Pillow), in each part's UV space.

Conventions (glTF): base colour sRGB; ORM = R ambient occlusion, G roughness, B metalness (linear);
normal maps tangent-space, OpenGL (+V up). Images are written top row = v 1 (Blender/glTF UV v
runs upward). No lighting is painted into any base colour: occlusion lives only in ORM.R, and only
persistent small-scale occlusion (baked separately in Cycles).
"""
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
rng = np.random.default_rng(1969)


def save_rgb(arr, path):
    Image.fromarray(np.clip(arr * 255 + 0.5, 0, 255).astype(np.uint8), "RGB").save(path)


def normal_from_height(h, strength, wrap_u=True, wrap_v=False):
    """Tangent-space normal map from a height field h[row, col] (row 0 = v 1)."""
    if wrap_u:
        dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    else:
        dx = np.gradient(h, axis=1)
    if wrap_v:
        dr = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    else:
        dr = np.gradient(h, axis=0)
    dv = -dr  # rows go down, v goes up
    n = np.dstack([-dx * strength, -dv * strength, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


def blur(a, r):
    if r <= 0:
        return a
    im = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8))
    return np.asarray(im.filter(ImageFilter.GaussianBlur(r))).astype(np.float32) / 255.0


def smooth_noise(H, W, cells, seed=0, wrap=True):
    """Bilinear value noise with `cells` lattice cells across the width (tileable in u)."""
    r = np.random.default_rng(seed)
    ch = max(2, int(round(cells * H / W)))
    g = r.random((ch + 1, cells + 1))
    if wrap:
        g[:, -1] = g[:, 0]
    y = np.linspace(0, ch, H, endpoint=False)
    x = np.linspace(0, cells, W, endpoint=False)
    yi = np.floor(y).astype(int)
    xi = np.floor(x).astype(int)
    fy = (y - yi)[:, None]
    fx = (x - xi)[None, :]
    fy = fy * fy * (3 - 2 * fy)
    fx = fx * fx * (3 - 2 * fx)
    a = g[yi][:, xi]
    b = g[yi][:, xi + 1]
    c = g[yi + 1][:, xi]
    d = g[yi + 1][:, xi + 1]
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy


def stage_skin(path_prefix, W, H, y0, y1, cols, frames, bands, label=None, panels=(), soot=0.0, stencils=(), circ=None):
    """A stage's painted skin, u round the stage (u 0 = +x), v along it from y0 to y1 (model units).
    frames: [y] structural frames (a raised weld land with rivet rows); bands: [(y_a, y_b, rgb)];
    label: (text, u_centre, v_centre, height_v); panels: [(u, y, w_u, h_y)] access panels."""
    yy = np.linspace(y1, y0, H)[:, None] * np.ones((1, W))  # row 0 = top (y1)
    uu = np.linspace(0, 1, W, endpoint=False)[None, :] * np.ones((H, 1))
    vpx = H / (y1 - y0)  # pixels per model unit along v
    # ---- base colour: off-white paint, panels a touch apart, large soft tone variation
    base = np.ones((H, W, 3), np.float32) * np.array([0.925, 0.918, 0.89], np.float32)
    tone = smooth_noise(H, W, 9, seed=3) - 0.5
    base *= (1 + 0.035 * tone)[:, :, None]
    panel_id = np.floor(uu * cols) + 31 * np.floor((yy - y0) * 4)
    pv = (np.sin(panel_id * 12.9898) * 43758.5453) % 1.0
    base *= (1 + 0.012 * (pv - 0.5))[:, :, None]
    # ---- height: panel seams (faint), frames (weld land + rivets), oil-canning, access panels
    h = np.zeros((H, W), np.float32)
    du = (uu * cols) % 1.0
    seam = np.exp(-((np.minimum(du, 1 - du) * W / cols) / 1.1) ** 2)
    h -= 0.25 * seam
    for fy in frames:
        d = (yy - fy) * vpx
        h += 0.9 * np.exp(-(d / 3.5) ** 2)  # weld land
        h -= 0.45 * np.exp(-(d / 1.2) ** 2)  # the weld groove in it
        for off in (-5.5, 5.5):
            rows = np.exp(-((d - off) / 0.9) ** 2)
            riv = (np.cos(uu * 2 * np.pi * W / 7.0) > 0.86).astype(np.float32)
            h += 0.5 * rows * riv
    oil = smooth_noise(H, W, cols * 2, seed=5)
    h += 0.35 * (oil - 0.5)
    for (pu, py, pw, ph) in panels:
        inside = (np.abs(((uu - pu + 0.5) % 1.0) - 0.5) < pw / 2) & (np.abs(yy - py) < ph / 2)
        edge = inside & ~((np.abs(((uu - pu + 0.5) % 1.0) - 0.5) < pw / 2 - 2.0 / W) & (np.abs(yy - py) < ph / 2 - 2.0 / vpx))
        h -= 0.9 * edge
        base[edge] *= 0.82
    base *= (1 - 0.05 * seam)[:, :, None]
    for fy in frames:
        base *= (1 - 0.12 * np.exp(-(((yy - fy) * vpx) / 1.3) ** 2))[:, :, None]
    # ---- bands (painted), label, stencils
    for (ya, yb, rgb) in bands:
        m = (yy >= ya) & (yy <= yb)
        base[m] = np.array(rgb, np.float32)
    if soot > 0:
        fade = np.clip(1 - (yy - y0) / ((y1 - y0) * 0.22), 0, 1) ** 1.6
        r1 = np.random.default_rng(8)
        streak = np.interp(uu[0], np.linspace(0, 1, 181), np.r_[r1.random(180), 0])[None, :]
        streak = blur(np.repeat(streak, 8, 0), 1.2)[:1]
        reach = 0.5 + 0.5 * np.interp(uu[0], np.linspace(0, 1, 61), np.r_[r1.random(60), 0])[None, :]
        k = np.clip(fade * 1.6 * reach - 0.25, 0, 1) * (0.55 + 0.45 * streak)
        base *= (1 - soot * 0.32 * k)[:, :, None]
        base[..., 2] *= 1 - 0.03 * soot * k  # a slightly warm grime
    img = Image.fromarray(np.clip(base * 255, 0, 255).astype(np.uint8), "RGB")
    dr = ImageDraw.Draw(img)
    # texels per model unit round the stage vs along it; text is drawn square in world space
    aspect = (W / circ) / vpx if circ else 1.0
    if label:
        text, uc, yc, hy = label
        fs = int(hy * vpx / max(1, len(text)) * 1.55)
        font = ImageFont.truetype(FONT, fs)
        tw = int(dr.textlength(text, font=font)) + 8
        tim = Image.new("RGBA", (tw, fs + 12), (0, 0, 0, 0))
        ImageDraw.Draw(tim).text((4, 2), text, font=font, fill=(24, 25, 28, 255))
        tim = tim.rotate(90, expand=True)  # reads bottom to top, like LV-001's
        tim = tim.resize((max(1, int(tim.width * aspect)), tim.height), Image.LANCZOS)
        cx = int(uc * W)
        cy = int((y1 - yc) * vpx)
        for dxw in (0, -W, W):
            img.paste(tim, (cx - tim.width // 2 + dxw, cy - tim.height // 2), tim)
    sfont = ImageFont.truetype(FONT, max(9, int(0.012 * vpx)))
    for (txt, su, sy) in stencils:
        dr.text((int(su * W), int((y1 - sy) * vpx)), txt, font=sfont, fill=(40, 40, 40))
    base = np.asarray(img).astype(np.float32) / 255.0
    save_rgb(base, path_prefix + "_base.png")
    # ---- normal and ORM
    nrm = normal_from_height(blur(np.clip(h * 0.5 + 0.5, 0, 1), 0.6) * 2 - 1, 1.6)
    save_rgb(nrm, path_prefix + "_normal.png")
    rough = 0.46 + 0.05 * (pv - 0.5) + 0.06 * (tone) + 0.12 * seam
    rough = np.clip(rough, 0.3, 0.75)
    orm = np.dstack([np.ones_like(rough), rough, np.zeros_like(rough)])
    save_rgb(orm, path_prefix + "_orm.png")
    return path_prefix


def stringer_tile(path_prefix, W=512, H=512, ribs=16, color=(0.23, 0.24, 0.255), metal=0.55, rough=0.5, rib_w=0.32, wear=0.0):
    """Tileable stringer / corrugated skin: `ribs` vertical hat-section stringers across the tile."""
    u = np.linspace(0, 1, W, endpoint=False)[None, :] * np.ones((H, 1))
    f = (u * ribs) % 1.0
    prof = np.clip(1 - np.abs(f - 0.5) / (rib_w / 2), 0, 1)
    prof = np.where(prof > 0, 0.6 + 0.4 * np.sqrt(prof), 0)  # flat-topped hat section
    h = prof + 0.15 * (smooth_noise(H, W, 24, seed=11) - 0.5)
    nrm = normal_from_height(blur(h, 0.8), 2.4, wrap_u=True, wrap_v=True)
    save_rgb(nrm, path_prefix + "_normal.png")
    n = smooth_noise(H, W, 16, seed=13)
    base = np.ones((H, W, 3), np.float32) * np.array(color, np.float32) * (0.9 + 0.2 * n)[:, :, None]
    base *= (0.94 + 0.08 * prof)[:, :, None]
    if wear:
        base = base * (1 - wear) + wear * np.array([0.55, 0.56, 0.57]) * prof[:, :, None]
    save_rgb(base, path_prefix + "_base.png")
    orm = np.dstack([1 - 0.25 * (1 - prof) * (prof < 0.01), np.clip(rough + 0.12 * (n - 0.5), 0.2, 0.9), np.full_like(n, metal)])
    save_rgb(orm, path_prefix + "_orm.png")


def quilt_unique(path_prefix, W=512, H=512):
    """The heat shield's quilted blankets, planar UV across the disc."""
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    q = 18.0
    fx = (x / W * q) % 1.0
    fy = (y / H * q) % 1.0
    pillow = np.sin(fx * np.pi) * np.sin(fy * np.pi)
    h = pillow ** 0.6 + 0.12 * (smooth_noise(H, W, 40, seed=21) - 0.5)
    save_rgb(normal_from_height(blur(h, 0.7), 3.0, wrap_u=False), path_prefix + "_normal.png")
    n = smooth_noise(H, W, 10, seed=22)
    base = np.ones((H, W, 3), np.float32) * np.array([0.2, 0.19, 0.18]) * (0.85 + 0.3 * n)[:, :, None]
    save_rgb(base, path_prefix + "_base.png")
    save_rgb(np.dstack([np.ones_like(n), 0.85 + 0.1 * (n - 0.5), np.full_like(n, 0.05)]), path_prefix + "_orm.png")


def foil_tile(path_prefix, W=256, H=256):
    """Crinkled insulation foil (turbopump wraps)."""
    h = np.zeros((H, W), np.float32)
    for k, c in enumerate((6, 13, 27, 55)):
        h += smooth_noise(H, W, c, seed=40 + k) / (k + 1)
    h = np.abs(h - h.mean()) * 2
    save_rgb(normal_from_height(h, 5.0, wrap_u=True, wrap_v=False), path_prefix + "_normal.png")
    base = np.ones((H, W, 3), np.float32) * np.array([0.78, 0.75, 0.66]) * (0.85 + 0.25 * h[:, :, None] / max(1e-6, h.max()))
    save_rgb(base, path_prefix + "_base.png")
    save_rgb(np.dstack([np.ones_like(h), 0.28 + 0.15 * h / max(1e-6, h.max()), np.full_like(h, 0.9)]), path_prefix + "_orm.png")


def bell_maps(path_prefix, W=1024, H=512, dark=(0.11, 0.105, 0.1), tint=(0.32, 0.24, 0.17)):
    """Engine bell colour and ORM along the nozzle (v 0 = exit rim, v 1 = chamber): dark metal,
    heat-tinted towards the exit; the tube wall's normal map is baked from geometry in Cycles."""
    v = np.linspace(1, 0, H)[:, None] * np.ones((1, W))
    n = smooth_noise(H, W, 48, seed=31)
    dark = np.array(dark)
    tint = np.array(tint)  # straw / bronze heat tint towards the exit
    k = (np.clip((0.28 - v) / 0.28, 0, 1) ** 1.5)[:, :, None]
    base = dark * (1 - k) + tint * k
    base = base * (0.88 + 0.24 * n[:, :, None])
    save_rgb(base.astype(np.float32), path_prefix + "_base.png")
    rough = 0.3 + 0.16 * k[:, :, 0] + 0.08 * (n - 0.5)
    save_rgb(np.dstack([np.ones_like(n), rough, np.full_like(n, 0.9)]), path_prefix + "_orm.png")


def bell_inner_maps(path_prefix, W=256, H=256):
    """Inside of a bell (same v as the outer wall: v 0 at the exit): dark sooted metal, a little
    lighter towards the exit, rougher than the outside."""
    v = np.linspace(1, 0, H)[:, None] * np.ones((1, W))
    n = smooth_noise(H, W, 24, seed=33)
    g = 0.07 + 0.09 * (1 - v) ** 1.5  # soot-dark metal (metallic base colour = reflectance)
    base = np.dstack([g, g * 0.97, g * 0.94]) * (0.85 + 0.3 * n)[:, :, None]
    save_rgb(base.astype(np.float32), path_prefix + "_base.png")
    save_rgb(np.dstack([np.ones_like(n), 0.6 + 0.1 * (n - 0.5), np.full_like(n, 0.55)]), path_prefix + "_orm.png")


def noise_tile(path_prefix, W=256, H=256, base_rgb=(0.4, 0.42, 0.45), rough=0.45, metal=0.8, amp=0.15, seed=50):
    n = smooth_noise(H, W, 12, seed=seed) * 0.6 + smooth_noise(H, W, 40, seed=seed + 1) * 0.4
    base = np.ones((H, W, 3), np.float32) * np.array(base_rgb) * (1 - amp / 2 + amp * n)[:, :, None]
    save_rgb(base, path_prefix + "_base.png")
    save_rgb(np.dstack([np.ones_like(n), np.clip(rough + 0.2 * (n - 0.5), 0.1, 1), np.full_like(n, metal)]), path_prefix + "_orm.png")
    save_rgb(normal_from_height(blur(n, 1.0), 1.2, wrap_u=True, wrap_v=True), path_prefix + "_normal.png")


def merge_ao(orm_path, ao_path, strength=1.0, detail_path=None):
    """Write a baked AO image (times an optional detail AO) into an ORM texture's R channel."""
    orm = np.asarray(Image.open(orm_path).convert("RGB")).astype(np.float32) / 255.0
    ao = np.asarray(Image.open(ao_path).convert("L").resize((orm.shape[1], orm.shape[0]))).astype(np.float32) / 255.0
    if detail_path:
        ao = ao * np.asarray(Image.open(detail_path).convert("L").resize((orm.shape[1], orm.shape[0]), Image.BILINEAR)).astype(np.float32) / 255.0
    orm[:, :, 0] = np.clip(1 - strength * (1 - ao), 0, 1)
    save_rgb(orm, orm_path)
