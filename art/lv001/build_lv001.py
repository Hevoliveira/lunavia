"""
LV-001 next-generation visual prototype — Blender 4.2 build script (bpy as a Python module).

    python art/lv001/build_lv001.py            # full build: textures, geometry, Cycles bakes, .blend, GLB
    LV_FAST=1 python art/lv001/build_lv001.py  # skip the bakes (geometry / layout iteration)

Writes art/lv001/build/: lv001_prototype.blend (editable source, textures alongside in textures/),
lv001_raw.glb (Blender's export) and bake images. optimize.sh then makes the runtime GLB.

The vehicle is LUNAVIA's LV-001 — its silhouette, stations, stage split, engine count and
placement, separation planes, markings and colours come from frontend/src/components/RocketModel.jsx
(coordinates below are in its model units). Engineering inspiration only: no national markings.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402  (bpy first: it makes bmesh / mathutils importable)
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import lv001_tex as T  # noqa: E402
from lv001_mesh import U, Builder, bezier, empty, look_y, polar, rot_y, rot_z, surface, to_blender  # noqa: E402

OUT = os.environ.get("LV_OUT", os.path.join(HERE, "build"))
TEX = os.path.join(OUT, "textures")
FAST = os.environ.get("LV_FAST") == "1"
os.makedirs(TEX, exist_ok=True)

# ---- stations (model units), from RocketModel.jsx / data/payloadDesign / data/carrier ----------------
SC = dict(slaBase=4.22, slaR1=0.110333, csm=5.109444, cmTop=5.275194, towerBase=5.287194, towerTop=5.487194, tip=5.825194)
SF = dict(rim=4.22 - 5.8 / 18, apex=4.22 - 5.2 / 18, R=0.302, top=4.22 - 1.35 / 18)  # upper stage forward dome / skirt
RW = math.pi / 6  # systems raceway azimuth
OUTBOARD = [math.pi / 4 + i * math.pi / 2 for i in range(4)]
QUAD = [i * math.pi / 2 for i in range(4)]


def rs(y):
    """Thrust-section skirt outer radius at height y (frustum 0.45 at y 0.04 -> 0.38 at y 0.48)."""
    return 0.45 - 0.07 * (y - 0.04) / 0.44


def ri(y):
    """Interstage outer radius (0.38 at y 2.48 -> 0.352 at y 2.86)."""
    return 0.38 - 0.028 * (y - 2.48) / 0.38


def rs2(y):
    """Upper stage outer radius (0.34 at y 2.86 -> 0.302 at y 4.145)."""
    return 0.34 - 0.038 * (y - 2.86) / 1.285


def bell_r(th, ex, u):
    return th + (ex - th) * (1 - (1 - u) ** 1.9)


# =============================================================================================
# scene
# =============================================================================================
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.unit_settings.system = "METRIC"
world = bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
world.light_settings.distance = 1.2  # AO bake reach, metres: persistent small-scale occlusion only

# =============================================================================================
# textures (numpy / Pillow) — see lv001_tex.py
# =============================================================================================
print("textures …", flush=True)
C1 = 2 * math.pi * 0.38
T.stage_skin(
    os.path.join(TEX, "s1_skin"), 1024, 1024, 0.48, 2.48, cols=16,
    frames=[0.9, 1.5, 2.1, 0.62 - 0.05, 1.095 - 0.02, 1.225 + 0.02, 2.25 - 0.04],
    bands=[(0.59, 0.65, (1.0, 0.23, 0.0)), (2.25, 2.35, (1.0, 0.23, 0.0))],
    label=("LUNAVIA", 0.0, 1.52, 0.56),
    panels=[(1 - 2.0 / (2 * math.pi), 0.85, 0.07 / C1 * 1.0, 0.1), (1 - 4.1 / (2 * math.pi), 1.25, 0.06 / C1, 0.08), (1 - 1.2 / (2 * math.pi), 1.95, 0.06 / C1, 0.07),
            (1 - 3.0 / (2 * math.pi), 2.38, 0.05 / C1, 0.08), (1 - 5.3 / (2 * math.pi), 0.72, 0.05 / C1, 0.06), (0.62, 1.7, 0.03, 0.05), (0.8, 0.98, 0.025, 0.04)],
    soot=1.0, circ=C1,
    stencils=[("LOX FILL", 0.55, 2.0), ("GN2 PURGE", 0.7, 1.3), ("NO STEP", 0.35, 2.42), ("RP-1", 0.88, 0.86), ("GSE 4A", 0.62, 0.75), ("VENT", 0.45, 1.8)],
)
C2 = 2 * math.pi * 0.321
T.stage_skin(
    os.path.join(TEX, "s2_skin"), 1024, 512, 2.86, 4.145, cols=12,
    frames=[3.2, 3.6, 2.9, 4.03],
    bands=[(4.065, 4.135, (1.0, 0.23, 0.0))],
    panels=[(0.3, 3.4, 0.03, 0.06), (0.71, 3.75, 0.035, 0.05), (0.08, 3.05, 0.03, 0.05)],
    circ=C2, stencils=[("LH2", 0.6, 3.5), ("VENT", 0.2, 3.9), ("NO STEP", 0.85, 3.05)],
)
T.stringer_tile(os.path.join(TEX, "corrugated"), ribs=16, color=(0.085, 0.088, 0.1), metal=0.25, rough=0.6, rib_w=0.5)
T.stringer_tile(os.path.join(TEX, "skirt"), ribs=16, color=(0.23, 0.24, 0.255), metal=0.6, rough=0.5, rib_w=0.22)
T.stringer_tile(os.path.join(TEX, "interstage"), ribs=16, color=(0.56, 0.58, 0.61), metal=0.7, rough=0.42, rib_w=0.22, wear=0.1)
T.quilt_unique(os.path.join(TEX, "quilt"))
T.foil_tile(os.path.join(TEX, "foil"))
T.noise_tile(os.path.join(TEX, "hardware"), base_rgb=(0.37, 0.39, 0.42), rough=0.38, metal=0.85, seed=50)
T.bell_maps(os.path.join(TEX, "bell1"), 512, 256, dark=(0.3, 0.3, 0.315), tint=(0.42, 0.35, 0.28))
T.bell_maps(os.path.join(TEX, "bell2"), 512, 256, dark=(0.4, 0.405, 0.42), tint=(0.48, 0.43, 0.38))
T.bell_inner_maps(os.path.join(TEX, "bellin"))


# =============================================================================================
# materials (Principled BSDF; glTF: base colour, ORM, normal; occlusion via glTF Material Output)
# =============================================================================================
def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexlin(h):
    h = h.lstrip("#")
    return tuple(srgb_to_lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


def gltf_group():
    g = bpy.data.node_groups.get("glTF Material Output")
    if g:
        return g
    g = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    g.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    return g


def load(path, noncolor=False):
    im = bpy.data.images.load(path, check_existing=True)
    im.colorspace_settings.name = "Non-Color" if noncolor else "sRGB"
    return im


MAT = {}


def make_mat(name, tex=None, color="#ffffff", rough=0.5, metal=0.0, coat=0.0, coat_rough=0.3, nstr=1.0, normal=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    bsdf = N["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*hexlin(color), 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if coat:
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = coat_rough
    if tex:
        b = N.new("ShaderNodeTexImage")
        b.image = load(os.path.join(TEX, tex + "_base.png"))
        b.location = (-700, 300)
        L.new(b.outputs["Color"], bsdf.inputs["Base Color"])
        o = N.new("ShaderNodeTexImage")
        o.image = load(os.path.join(TEX, tex + "_orm.png"), True)
        o.location = (-900, 0)
        sep = N.new("ShaderNodeSeparateColor")
        sep.location = (-600, 0)
        L.new(o.outputs["Color"], sep.inputs["Color"])
        L.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
        L.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
        g = N.new("ShaderNodeGroup")
        g.node_tree = gltf_group()
        g.location = (0, -400)
        L.new(sep.outputs["Red"], g.inputs["Occlusion"])
    npath = normal or (tex and os.path.join(TEX, tex + "_normal.png"))
    if npath and os.path.exists(npath):
        n = N.new("ShaderNodeTexImage")
        n.image = load(npath, True)
        n.location = (-700, -300)
        nm = N.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = nstr
        nm.location = (-300, -300)
        L.new(n.outputs["Color"], nm.inputs["Color"])
        L.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    MAT[name] = m
    return m


make_mat("M_S1_Paint", "s1_skin", coat=0.3, coat_rough=0.32)
make_mat("M_S2_Paint", "s2_skin", coat=0.3, coat_rough=0.32)
make_mat("M_Intertank", "corrugated")
make_mat("M_Skirt", "skirt")
make_mat("M_Interstage", "interstage")
make_mat("M_HeatShield", "quilt")
make_mat("M_Foil", "foil")
make_mat("M_Hardware", "hardware")
make_mat("M_Bell1", "bell1", normal=os.path.join(TEX, "bell1_normal.png"))
make_mat("M_Bell2", "bell2", normal=os.path.join(TEX, "bell2_normal.png"))
make_mat("M_Bell1Inner", "bellin", normal=os.path.join(TEX, "bell1_normal.png"))
make_mat("M_Bell2Inner", "bellin", normal=os.path.join(TEX, "bell2_normal.png"))
make_mat("M_White", color="#e4e2db", rough=0.52, metal=0.08, coat=0.3, coat_rough=0.32)
make_mat("M_Orange", color="#FF3B00", rough=0.52, metal=0.1)
make_mat("M_Silver", color="#c7cbd1", rough=0.3, metal=0.85)
make_mat("M_LES", color="#e4e4e1", rough=0.45, metal=0.35)
make_mat("M_Cavity", color="#0e0e10", rough=0.92, metal=0.1)

# =============================================================================================
# hierarchy
# =============================================================================================
root = empty("LV001")
stage1 = empty("Stage1", root)
stage2 = empty("Stage2", root)
payload = empty("Payload", root)
les_g = empty("LES", root)
OBJ = {}


def put(b, parent, **kw):
    ob = b.build(MAT, parent=parent, **kw)
    OBJ[ob.name] = ob
    return ob


def ring(b, y, R, r, mat, segs=64, rsegs=8):
    b.torus((0, y, 0), R, r, mat, segs=segs, rsegs=rsegs)


def plate(b, a, y, r, size, mat, bevel=0.0015, tilt=0.0):
    """A small rectangular plate on a body of revolution: size (radial, height, width)."""
    R = rot_y(a) @ rot_z(tilt) if tilt else rot_y(a)
    b.box(size, polar(r + size[0] / 2, y, a), mat, rot=R, bevel=bevel, seg=1)


def tube(b, pts, r, mat, segs=10, caps=True):
    b.sweep(pts, r, mat, segs=segs, caps=caps)


# =============================================================================================
# STAGE 1
# =============================================================================================
print("stage 1 …", flush=True)
# ---- tank skin (unique UVs: the painted skin, LUNAVIA lettering, bands) -----------------------
b = Builder("S1_Tank")
prof = [(0.38, 0.48)]
for (ya, yb, rr) in [(0.59, 0.65, 0.3846), (0.889, 0.911, 0.3836), (1.489, 1.511, 0.3836), (2.089, 2.111, 0.3836), (2.25, 2.35, 0.3846)]:
    ch = 0.003
    prof += [(0.38, ya - ch), (rr, ya), (rr, yb), (0.38, yb + ch)]
prof.append((0.38, 2.48))
b.lathe(prof, "M_S1_Paint", segs=128, v_of=lambda p: (p[1] - 0.48) / 2.0)
put(b, stage1)

# ---- intertank (corrugated) ----------------------------------------------------------------
b = Builder("S1_Intertank")
b.lathe([(0.3795, 1.088), (0.386, 1.095), (0.3862, 1.1), (0.3862, 1.22), (0.386, 1.225), (0.3795, 1.232)], "M_Intertank", segs=128, uv_u=8, v_len=0.30)
for y in (1.098, 1.222):
    ring(b, y, 0.387, 0.0022, "M_Hardware", segs=96, rsegs=4)
put(b, stage1)

# ---- thrust-section skirt: aft lip, inner wall down from the heat shield, stringered outer skin ------
b = Builder("S1_Skirt")
p = [(rs(0.245) - 0.006, 0.245), (rs(0.04) - 0.006, 0.04), (rs(0.04) - 0.004, 0.032), (rs(0.04) + 0.002, 0.028), (rs(0.04) + 0.007, 0.032),
     (rs(0.04) + 0.008, 0.042), (rs(0.04) + 0.005, 0.05), (rs(0.06), 0.06)]
p += [(rs(y), y) for y in (0.2, 0.35, 0.46)]
p += [(0.3812, 0.474), (0.38, 0.48)]
b.lathe(p, "M_Skirt", segs=128, uv_u=4, v_len=0.65)
# access door and two umbilical-style panels on the skirt
for a, y in ((0.5, 0.22), (3.6, 0.3)):
    plate(b, a, y, rs(y) - 0.001, (0.004, 0.09, 0.07), "M_Hardware", tilt=0.158)
put(b, stage1)

# ---- fins: root on the skirt surface, rounded leading edges ---------------------------------
b = Builder("S1_Fins")
for a in QUAD:
    bm = bmesh.new()
    P = [(rs(0.47) - 0.004, 0.47), (0.545, 0.302), (0.545, 0.117), (rs(0.05) - 0.004, 0.05)]
    t = 0.011
    vf = [bm.verts.new((r, y, t)) for r, y in P]
    vb = [bm.verts.new((r, y, -t)) for r, y in P]
    bm.faces.new(vf)
    bm.faces.new(list(reversed(vb)))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new([vf[j], vf[i], vb[i], vb[j]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    root_edges = {e for e in bm.edges if all(abs(v.co.x - (rs(v.co.y) - 0.004)) < 1e-6 for v in e.verts)}
    bmesh.ops.bevel(bm, geom=[e for e in bm.edges if e not in root_edges], offset=0.0045, segments=3, profile=0.5, affect="EDGES", clamp_overlap=True)
    b.add_bm(bm, (0, 0, 0), "M_White", rot=rot_y(a), smooth=True)
    bm.free()
put(b, stage1)

# ---- systems raceway with fairings, rails and clamp straps -----------------------------------
b = Builder("S1_Raceway")
ys = [0.6, 0.615, 0.63, 0.645, 0.66] + [0.66 + k * (2.27 - 0.66) / 40 for k in range(1, 40)] + [2.27, 2.285, 2.3, 2.315, 2.33]


def taper(y):
    return min(1.0, max(0.0, (y - 0.6) / 0.06), max(0.0, (2.33 - y) / 0.06)) ** 0.7


with b.push(rot_y(RW)):
    rows = []
    for k in range(17):
        ph = -math.pi / 2 + math.pi * k / 16
        rows.append([(0.381 + 0.036 * taper(y) * math.cos(ph), y, 0.034 * math.sin(ph)) for y in ys])
    surface(b, rows, "M_Hardware", hint=lambda q: (q.x - 0.37, 0, q.z))
    for s in (-1, 1):
        b.box((0.006, 1.6, 0.007), (0.384, 1.465, s * 0.0375), "M_Hardware", bevel=0.0012)
    y = 0.72
    while y < 2.25:
        rows = []
        for k in range(17):
            ph = -math.pi / 2 + math.pi * k / 16
            rr = 0.0385
            rows.append([(0.381 + (0.036 + 0.0025) * math.cos(ph), yy, rr * math.sin(ph)) for yy in (y - 0.006, y + 0.006)])
        surface(b, rows, "M_Hardware", hint=lambda q: (q.x - 0.37, 0, q.z))
        y += 0.16
put(b, stage1)

# ---- umbilical carrier plates facing the tower (+x) and other tank fittings -------------------
b = Builder("S1_Fittings")
for y in (0.78, 2.2):
    b.box((0.012, 0.07, 0.09), (0.386, y, 0), "M_Hardware", bevel=0.002, seg=2)
    for dz in (-0.025, 0.0, 0.025):
        b.cyl((0.392, y + 0.012, dz), (0.402, y + 0.012, dz), 0.008, "M_Hardware", segs=12)
        b.cyl((0.392, y - 0.018, dz), (0.399, y - 0.018, dz), 0.005, "M_Cavity", segs=10)
# vent / fill fittings
for a, y in ((2.6, 2.4), (4.6, 0.7)):
    plate(b, a, y, 0.38, (0.008, 0.05, 0.04), "M_Hardware", bevel=0.002)
put(b, stage1)

# ---- heat shield (quilted) with flame curtains round each engine ----------------------------
ENG = [(0.0, 0.0, 1.03, 0.0)] + [(0.235 * math.cos(a), 0.235 * math.sin(a), 1.0, a) for a in OUTBOARD]  # x, z, scale, yaw
F1 = dict(L=0.3, th=0.034, ex=0.108, W=0.0025)

b = Builder("S1_HeatShield")
bm = bmesh.new()
Rs = rs(0.245) - 0.0055
outer = [bm.verts.new((math.cos(2 * math.pi * k / 128), 0, math.sin(2 * math.pi * k / 128))) for k in range(128)]
edges = [bm.edges.new((outer[k], outer[(k + 1) % 128])) for k in range(128)]
for (x, z, k, _) in ENG:
    hv = [bm.verts.new(((x + 0.066 * math.cos(2 * math.pi * i / 40)) / Rs, 0, (z + 0.066 * math.sin(2 * math.pi * i / 40)) / Rs)) for i in range(40)]
    edges += [bm.edges.new((hv[i], hv[(i + 1) % 40])) for i in range(40)]
bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=edges)
for f in bm.faces:
    f.normal_update()
    if f.normal.y > 0:
        f.normal_flip()
b.add_bm(bm, (0, 0.245, 0), "M_HeatShield", rot=Matrix.Diagonal((Rs, 1, Rs)), smooth=False)
bm.free()
for (x, z, k, _) in ENG:
    # curtain: from the hole edge down to the bell wall, with folds
    ly = 0.268
    yb = -0.06 + k * ly
    rb = k * (bell_r(F1["th"], F1["ex"], 1 - ly / F1["L"]) + F1["W"]) - 0.0008
    prof = []
    for i in range(9):
        t = i / 8
        y = yb + (0.245 - yb) * t
        r = rb + (0.066 - rb) * t ** 0.8 + 0.0032 * math.sin(t * math.pi * 5) * math.sin(t * math.pi)
        prof.append((r, y))
    with b.push(None, (x, 0, z)):
        b.lathe(prof, "M_HeatShield", segs=32, uv_u=2)
put(b, stage1)

# ---- thrust structure (inside the skirt, above the heat shield: low detail) ------------------
b = Builder("S1_ThrustStructure")
ring(b, 0.41, 0.3, 0.012, "M_Hardware", segs=40, rsegs=6)
for r in (0, math.pi / 2):
    R = rot_y(r + math.pi / 4)
    with b.push(R):
        b.box((0.72, 0.006, 0.035), (0, 0.348, 0), "M_Hardware")
        b.box((0.72, 0.006, 0.035), (0, 0.312, 0), "M_Hardware")
        b.box((0.72, 0.036, 0.005), (0, 0.33, 0), "M_Hardware")
for q in QUAD:
    a = q + math.pi / 4
    tube(b, [polar(0.3, 0.41, a), polar(0.375, 0.47, a)], 0.011, "M_Hardware", segs=6)
# forward bulkhead seen from the interstage once the stages part
b.lathe([(0.0, 2.492), (0.2, 2.489), (0.33, 2.484), (0.3795, 2.48)], "M_Cavity", segs=64)
put(b, stage1)

# ---- interstage: flange, ribbed frustum, frangible separation joint, retro motors, vents, hatches --
b = Builder("S1_Interstage")
p = [(0.3795, 2.48), (0.3832, 2.483), (0.3832, 2.497), (ri(2.5) + 0.0005, 2.5)]
p += [(ri(y), y) for y in (2.6, 2.7, 2.8)]
p += [(ri(2.836), 2.836), (ri(2.84) + 0.002, 2.84)]
b.lathe(p, "M_Interstage", segs=128, uv_u=4, v_len=0.575)
b.lathe([(ri(2.84) + 0.002, 2.84), (0.349, 2.842), (0.349, 2.853)], "M_Cavity", segs=128)  # the frangible joint
b.lathe([(0.349, 2.853), (0.3545, 2.854), (0.3545, 2.86), (0.342, 2.86)], "M_Hardware", segs=128)  # top flange, closes the gap to stage 2
b.lathe([(0.342, 2.858), (ri(2.84) - 0.005, 2.84), (ri(2.5) - 0.005, 2.5), (0.37, 2.49)], "M_Cavity", segs=64)  # inner wall
for q in QUAD:  # retro-rocket fairings and nozzles
    a = q + math.pi / 4
    rc = ri(2.6) + 0.006
    with b.push(rot_y(a), (rc * math.cos(a), 0, rc * math.sin(a))):
        b.lathe([(0.0, 2.5), (0.01, 2.503), (0.018, 2.515), (0.0215, 2.535), (0.0215, 2.655), (0.0185, 2.672), (0.0135, 2.68), (0.0, 2.681)], "M_White", segs=24)
        ring(b, 2.6, 0.0215, 0.0016, "M_Hardware", segs=24, rsegs=5)
        with b.push(rot_z(-0.35), (0.0, 2.676, 0)):
            b.lathe([(0.0065, 0.0), (0.0155, 0.032), (0.0168, 0.0345), (0.0145, 0.034), (0.0055, 0.003)], "M_Hardware", segs=16)
            b.lathe([(0.0, 0.004), (0.0055, 0.003)], "M_Cavity", segs=16)
for i in range(8):  # vent ports
    a = i / 8 * 2 * math.pi + math.pi / 8
    y = 2.74
    plate(b, a, y, ri(y) - 0.0015, (0.004, 0.034, 0.054), "M_Hardware", bevel=0.001, tilt=0.0737)
    for k in range(4):
        plate(b, a, y - 0.0115 + k * 0.0077, ri(y) + 0.0022, (0.0018, 0.0035, 0.044), "M_Cavity", bevel=0.0, tilt=0.0737)
for a in (0.4, 3.5):  # access hatches
    plate(b, a, 2.6, ri(2.6) - 0.0015, (0.0045, 0.1, 0.085), "M_Hardware", bevel=0.0015, tilt=0.0737)
    with b.push(rot_y(a)):
        b.cyl((ri(2.6) + 0.004, 2.648, -0.03), (ri(2.6) + 0.004, 2.648, 0.03), 0.0028, "M_Hardware", segs=8)
put(b, stage1)


# ---- F-1 class engines (1 centre + 4 outboard), each its own object group --------------------
def bell_outer_profile(th, ex, L, W, n=26):
    """Outer wall, exit rim to chamber dome (bottom -> top)."""
    p = [(ex, 0.0), (ex + 0.0004, -0.0016), (ex + W * 0.5, -0.0028), (ex + W + 0.0016, -0.002), (ex + W + 0.0022, 0.0006), (ex + W + 0.0016, 0.0028), (ex + W, 0.0042)]
    for k in range(n + 1):
        u = 1 - k / n
        y = L * (1 - u)
        if y < 0.0062:
            continue
        p.append((bell_r(th, ex, u) + W, y))
    p += [(th * 1.08 + W, L * 1.03), (th * 1.2 + W, L * 1.07), (th * 1.26 + W, L * 1.12), (th * 1.26 + W, L * 1.16), (th * 1.1 + W, L * 1.19), (th * 0.85, L * 1.21), (th * 0.4, L * 1.225), (0.0, L * 1.228)]
    return p


def bell_inner_profile(th, ex, L, n=20):
    p = [(0.0, L * 1.05), (th * 0.9, L * 1.045), (th * 1.05, L * 1.02)]
    for k in range(n + 1):
        u = k / n
        p.append((bell_r(th, ex, u), L * (1 - u)))
    return p


def outer_v(prof):
    """v (normalised arc length, as lathe() assigns it) along an outer profile, as a function of y."""
    L = [0.0]
    for i in range(1, len(prof)):
        L.append(L[-1] + math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]))
    ys = [p[1] for p in prof]
    vs = [l / L[-1] for l in L]

    def f(p):
        y = p[1]
        for i in range(len(ys) - 1):
            if ys[i] <= y <= ys[i + 1] and ys[i + 1] > ys[i]:
                t = (y - ys[i]) / (ys[i + 1] - ys[i])
                return vs[i] + (vs[i + 1] - vs[i]) * t
        return 0.0 if y < ys[1] else 1.0

    return f


def f1_engine(idx, x, z, k, yaw):
    L, th, ex, W = F1["L"], F1["th"], F1["ex"], F1["W"]
    name = "S1_Engine_C" if idx == 0 else f"S1_Engine_{idx}"
    g = empty(name, stage1, (x, -0.06, z))
    g.rotation_euler = (0, 0, -yaw)
    g.scale = (k, k, k)
    b = Builder(name + "_Bell")
    b.lathe(bell_outer_profile(th, ex, L, W, n=22), "M_Bell1", segs=48)
    put(b, g)
    b = Builder(name + "_BellInner")
    b.lathe(bell_inner_profile(th, ex, L, n=14), "M_Bell1Inner", segs=32, v_of=outer_v(bell_outer_profile(th, ex, L, W, n=22)))
    put(b, g)
    b = Builder(name + "_Hardware")
    rb = lambda u: bell_r(th, ex, u) + W  # noqa: E731
    # hat band and the turbine exhaust manifold at the nozzle extension joint
    u = 0.4
    ring(b, L * (1 - u), rb(u) + 0.0032, 0.0034, "M_Hardware", segs=48, rsegs=6)
    ym = L * (1 - 0.55)
    ring(b, ym, 0.104, 0.0075, "M_Hardware", segs=48, rsegs=8)
    ring(b, ym - 0.004, rb(0.57) + 0.0015, 0.0022, "M_Hardware", segs=48, rsegs=5)
    # regenerative-coolant inlet manifold near the throat
    yi = 0.226
    ri_ = rb(1 - yi / L) + 0.0075
    ring(b, yi, ri_, 0.0068, "M_Hardware", segs=40, rsegs=6)
    # gimbal block and injector dome
    b.lathe([(0.0, 0.352), (0.04, 0.353), (0.046, 0.358), (0.046, 0.372), (0.037, 0.378), (0.037, 0.398), (0.031, 0.404), (0.0, 0.405)], "M_Hardware", segs=16)
    b.box((0.016, 0.03, 0.1), (0, 0.392, 0), "M_Hardware", bevel=0.002)
    # turbopump: foil-wrapped turbine below, pump housing and volutes above
    P = Vector((0.1, 0.0, 0.0))
    with b.push(None, tuple(P)):
        b.lathe([(0.0, 0.208), (0.012, 0.209), (0.019, 0.214), (0.021, 0.222), (0.021, 0.244)], "M_Foil", segs=16, uv_u=2)
        b.lathe([(0.021, 0.244), (0.0245, 0.246), (0.0245, 0.252), (0.02, 0.254), (0.02, 0.278), (0.024, 0.28), (0.024, 0.286), (0.019, 0.288), (0.016, 0.296), (0.0, 0.297)], "M_Hardware", segs=16)
        b.cyl((0.0, 0.266, 0.0), (0.0, 0.266, 0.032), 0.009, "M_Hardware", segs=8)  # pump volute outlet
        b.cyl((0.0, 0.262, 0.0), (0.03, 0.262, 0.0), 0.008, "M_Hardware", segs=8)
        for dy in (0.231, 0.27):
            ring(b, dy, 0.0215 if dy < 0.244 else 0.0205, 0.0016, "M_Hardware", segs=24, rsegs=5)
    # suction line up to the heat shield
    tube(b, [(0.1, 0.296, 0.0), (0.1, 0.305 + 0.012, 0.0)], 0.011, "M_Hardware", segs=12, caps=False)
    with b.push(None, (0.1, 0, 0)):
        b.lathe([(0.011, 0.296), (0.0155, 0.297), (0.0155, 0.301), (0.011, 0.302)], "M_Hardware", segs=16)
    # turbine exhaust duct to the manifold
    tube(b, bezier((0.1, 0.209, 0.0), (0.104, 0.19, 0.0), (0.104, ym + 0.004, 0.0), 10), 0.0075, "M_Foil", segs=8)
    # pump discharge ducts to the coolant inlet manifold
    for s in (-1, 1):
        a = s * 0.62
        end = (ri_ * math.cos(a), yi + 0.004, ri_ * math.sin(a))
        start = (0.1 - 0.012, 0.262, s * 0.016)
        tube(b, bezier(start, (0.093, 0.255, s * 0.05), (end[0] + 0.012, yi + 0.02, end[2] + s * 0.01), 12, p3=end), 0.0058, "M_Hardware", segs=8)
    # gas generator and its feed
    gg = (0.082, 0.232, -0.036)
    with b.push(None, gg):
        b.lathe([(0.0, -0.013), (0.008, -0.012), (0.011, -0.006), (0.011, 0.006), (0.008, 0.012), (0.0, 0.013)], "M_Hardware", segs=16)
    tube(b, bezier((gg[0], gg[1] + 0.012, gg[2]), (0.088, 0.255, -0.03), (0.1, 0.26, -0.022), 8), 0.0035, "M_Hardware", segs=8)
    tube(b, bezier((gg[0] + 0.006, gg[1] - 0.01, gg[2] + 0.006), (0.096, 0.215, -0.02), (0.1, 0.214, -0.019), 8), 0.004, "M_Hardware", segs=8)
    # instrumentation lines down the bell
    for a in (1.9, -2.3):
        pts = []
        for kk in range(13):
            u = 0.2 + 0.3 * kk / 12
            yy = L * (1 - u)
            off = rb(u) + 0.0028 + 0.0058 * math.exp(-(((u - 0.4) / 0.035) ** 2))  # over the hat band
            pts.append((off * math.cos(a), yy, off * math.sin(a)))
        tube(b, pts, 0.0016, "M_Hardware", segs=6)
    put(b, g)
    return g


ENGINES = [f1_engine(i, x, z, k, yaw) for i, (x, z, k, yaw) in enumerate(ENG)]

# =============================================================================================
# STAGE 2 (upper stage) — body, aft skirt and thrust cone, J-2 class engine, RCS, forward dome
# =============================================================================================
print("stage 2 …", flush=True)
b = Builder("S2_Body")
prof = [(0.34, 2.86)]
for (ya, yb, dr) in [(2.895, 2.905, 0.0025), (3.189, 3.211, 0.0042), (3.595, 3.605, 0.0025), (4.025, 4.035, 0.0025), (4.065, 4.135, 0.0018)]:
    ch = 0.003
    prof += [(rs2(ya - ch), ya - ch), (rs2(ya) + dr, ya), (rs2(yb) + dr, yb), (rs2(yb + ch), yb + ch)]
prof.append((0.302, 4.145))
b.lathe(prof, "M_S2_Paint", segs=128, v_of=lambda p: (p[1] - 2.86) / 1.285)
put(b, stage2)

b = Builder("S2_AftSkirt")
b.lathe([(0.07, 2.86), (0.12, 2.86), (0.2, 2.906), (0.326, 2.976), (0.33, 2.98)], "M_Skirt", segs=96, uv_u=3, v_len=0.4)
b.lathe([(0.33, 2.98), (0.33, 2.862), (0.34, 2.86)], "M_Cavity", segs=96)
for q in QUAD:  # thrust-cone longerons
    with b.push(rot_y(q + math.pi / 8)):
        tube(b, [(0.125, 2.857, 0.0), (0.326, 2.973, 0.0)], 0.005, "M_Hardware", segs=6)
put(b, stage2)

J2 = dict(L=0.36, th=0.05, ex=0.2, W=0.0025)
g2 = empty("S2_Engine", stage2, (0, 2.5, 0))
b = Builder("S2_Engine_Bell")
b.lathe(bell_outer_profile(J2["th"], J2["ex"], J2["L"], J2["W"], n=24), "M_Bell2", segs=64)
put(b, g2)
b = Builder("S2_Engine_BellInner")
b.lathe(bell_inner_profile(J2["th"], J2["ex"], J2["L"], n=16), "M_Bell2Inner", segs=40, v_of=outer_v(bell_outer_profile(J2["th"], J2["ex"], J2["L"], J2["W"], n=24)))
put(b, g2)
b = Builder("S2_Engine_Hardware")
L2, th2, ex2, W2 = J2["L"], J2["th"], J2["ex"], J2["W"]
rb2 = lambda u: bell_r(th2, ex2, u) + W2  # noqa: E731
for u in (0.66, 0.85):
    ring(b, L2 * (1 - u), rb2(u) + 0.0034, 0.0036, "M_Hardware", segs=56, rsegs=6)
ym2 = L2 * (1 - 0.45)
ring(b, ym2, rb2(0.45) + 0.0105, 0.0085, "M_Hardware", segs=56, rsegs=6)
yi2 = 0.32
rI2 = rb2(1 - yi2 / L2) + 0.0085
ring(b, yi2, rI2, 0.0072, "M_Hardware", segs=56, rsegs=8)
for (a, rr, h) in ((0.0, 0.03, 0.09), (math.pi, 0.026, 0.082)):  # LOX and fuel turbopumps
    with b.push(rot_y(a), (0.165 * math.cos(a), 0, 0.165 * math.sin(a))):
        b.lathe([(0.0, 0.3 - h / 2), (rr * 0.6, 0.3 - h / 2 + 0.001), (rr, 0.3 - h / 2 + 0.008), (rr, 0.3 + h / 2 - 0.012), (rr * 1.15, 0.3 + h / 2 - 0.008), (rr * 1.15, 0.3 + h / 2 - 0.002), (0.0, 0.3 + h / 2)], "M_Hardware", segs=16)
        b.lathe([(rr + 0.0005, 0.3 - h / 2 + 0.01), (rr + 0.0035, 0.3 - h / 2 + 0.014), (rr + 0.0035, 0.3 - 0.01), (rr + 0.0005, 0.3 - 0.006)], "M_Foil", segs=16, uv_u=2)
        tube(b, [(0.0, 0.3 + h / 2, 0.0), (0.0, 0.392, 0.0)], 0.009, "M_Hardware", segs=8, caps=False)  # suction line to the thrust cone
        tube(b, [(0.0, 0.3 - h / 2, 0.0), (0.0, ym2 + 0.012, 0.0)], 0.0075, "M_Foil", segs=8)  # turbine exhaust
    for s in (-1, 1):
        a2 = a + s * 0.5
        end = (rI2 * math.cos(a2), yi2 + 0.004, rI2 * math.sin(a2))
        st = (0.165 * math.cos(a) - 0.02 * math.cos(a) - s * 0.012 * math.sin(a), 0.3, 0.165 * math.sin(a) - 0.02 * math.sin(a) + s * 0.012 * math.cos(a))
        mid = (0.15 * math.cos(a + s * 0.3), 0.31, 0.15 * math.sin(a + s * 0.3))
        tube(b, bezier(st, mid, end, 10), 0.0062, "M_Hardware", segs=8)
gg2 = (0.0, 0.29, 0.172)
with b.push(None, gg2):
    b.lathe([(0.0, -0.02), (0.012, -0.018), (0.02, -0.008), (0.02, 0.008), (0.012, 0.018), (0.0, 0.02)], "M_Hardware", segs=16)
tube(b, bezier((0.0, 0.31, 0.172), (0.08, 0.33, 0.17), (0.155, 0.32, 0.03), 10), 0.005, "M_Hardware", segs=8)
b.lathe([(0.0, 0.44), (0.062, 0.441), (0.08, 0.452), (0.08, 0.49), (0.06, 0.5), (0.0, 0.501)], "M_Hardware", segs=16)  # gimbal / thrust mount
for a in (1.2, -1.9):
    pts = [((rb2(u) + 0.003) * math.cos(a), L2 * (1 - u), (rb2(u) + 0.003) * math.sin(a)) for u in [0.49 + 0.15 * kk / 8 for kk in range(9)]]
    tube(b, pts, 0.0018, "M_Hardware", segs=6)
put(b, g2)

b = Builder("S2_RCS")
for q in QUAD:
    a = q + math.pi / 4
    y = 3.95
    r0 = rs2(y)
    with b.push(rot_y(a), (0, 0, 0)):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co = Vector((v.co.x * 0.034, v.co.y * 0.085, v.co.z * 0.064))
            if v.co.x > 0:  # taper the outer face into a fairing
                v.co.y *= 0.82
                v.co.z *= 0.86
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.005, segments=2, profile=0.5, affect="EDGES", clamp_overlap=True)
        b.add_bm(bm, (r0 + 0.014, y, 0), "M_Hardware", smooth=True)
        bm.free()
        for (d, off) in (((1, 0, 0), (0.033, 0.012, 0.0)), ((0, 1, 0), (0.02, 0.036, 0.0)), ((0, -1, 0), (0.02, -0.036, 0.0)), ((0, 0, 1), (0.02, 0.0, 0.028)), ((0, 0, -1), (0.02, 0.0, -0.028))):
            with b.push(look_y(d), (r0 + 0.014 + off[0], y + off[1], off[2])):
                b.lathe([(0.0035, 0.0), (0.0075, 0.014), (0.0068, 0.0145), (0.003, 0.002)], "M_Hardware", segs=12)
put(b, stage2)

b = Builder("S2_Forward")
dome = []
for i in range(13):
    u = i / 12
    dome.append((SF["R"] * 0.995 * math.sin((1 - u) * math.pi / 2), SF["rim"] + (SF["apex"] - SF["rim"]) * math.cos((1 - u) * math.pi / 2)))
b.lathe(dome, "M_Skirt", segs=64, uv_u=2, v_len=0.3)
b.lathe([(SF["R"] * 0.985, SF["top"]), (SF["R"] * 0.985, SF["rim"])], "M_Cavity", segs=64)
ring(b, SF["top"] - 0.002, SF["R"] * 0.99, 0.004, "M_Hardware", segs=96, rsegs=6)
put(b, stage2)

# =============================================================================================
# PAYLOAD interface (moves with the payload: the stage-to-carrier ring and its bolt fittings).
# The carrier, adapter, LM and CSM themselves stay LUNAVIA's runtime PayloadSection.
# =============================================================================================
b = Builder("Payload_Interface")
b.lathe([(0.3, SC["slaBase"]), (0.3025, SC["slaBase"] + 0.002), (0.3025, SC["slaBase"] + 0.018), (0.3, SC["slaBase"] + 0.02)], "M_Silver", segs=128)
for i in range(16):
    a = i / 16 * 2 * math.pi
    plate(b, a, 4.235, 0.296, (0.014, 0.018, 0.01), "M_Hardware", bevel=0.0012)
put(b, payload)
pl_mount = empty("PayloadSection_Mount", payload, (0, SC["slaBase"], 0))

# =============================================================================================
# LES — boost protective cover and launch escape tower
# =============================================================================================
print("LES …", flush=True)
b = Builder("LES_Cover")
cov = [(SC["slaR1"] + 0.004, SC["csm"] + 0.004), (SC["slaR1"] + 0.0045, SC["csm"] + 0.009), (SC["slaR1"] + 0.004, SC["csm"] + 0.016)]
for k in range(1, 9):
    t = k / 8
    cov.append((SC["slaR1"] + 0.004 + (0.04 - SC["slaR1"] - 0.004) * t, SC["csm"] + 0.016 + (SC["cmTop"] - 0.004 - SC["csm"] - 0.016) * t))
cov += [(0.036, SC["cmTop"] + 0.012), (0.03, SC["cmTop"] + 0.014), (0.0, SC["cmTop"] + 0.015)]
b.lathe(cov, "M_LES", segs=96)
for i in range(4):  # cover seams / tower-leg wells
    a = math.pi / 4 + i * math.pi / 2
    surface(b, [[polar(cov[2][0] + 0.0012 + (cov[-4][0] - cov[2][0]) * t, cov[2][1] + (cov[-4][1] - cov[2][1]) * t, a + s * 0.006) for t in (0.0, 1.0)] for s in (-1, 1)], "M_Hardware", hint=lambda q, a=a: polar(1, 0.5, a))
put(b, les_g)

b = Builder("LES_Tower")
T0, T1 = SC["towerBase"], SC["towerTop"]


def cover_y(r):  # height of the cover's cone at radius r
    r0, y0 = SC["slaR1"] + 0.004, SC["csm"] + 0.016
    r1, y1 = 0.04, SC["cmTop"] - 0.004
    return y0 + (y1 - y0) * (r - r0) / (r1 - r0)


def LEG(a, u):
    r = 0.05 - u * 0.02
    return (math.cos(a) * r, T0 + (T1 - T0) * u, math.sin(a) * r)


legA = [q + math.pi / 4 for q in QUAD]
for a in legA:
    rf = 0.052
    foot = (math.cos(a) * rf, cover_y(rf) + 0.002, math.sin(a) * rf)
    tube(b, [foot, LEG(a, 0), LEG(a, 1)], 0.0045, "M_LES", segs=8)
    with b.push(None, foot):
        b.lathe([(0.0, -0.003), (0.008, -0.003), (0.008, 0.002), (0.005, 0.004), (0.0, 0.0045)], "M_Hardware", segs=10)
for u in (0, 1 / 3, 2 / 3, 1):
    for i, a in enumerate(legA):
        tube(b, [LEG(a, u), LEG(legA[(i + 1) % 4], u)], 0.0028, "M_LES", segs=6)
for (u0, u1) in ((0, 1 / 3), (1 / 3, 2 / 3), (2 / 3, 1)):
    for i, a in enumerate(legA):
        bq = legA[(i + 1) % 4]
        tube(b, [LEG(a, u0), LEG(bq, u1)], 0.0021, "M_LES", segs=5)
        tube(b, [LEG(bq, u0), LEG(a, u1)], 0.0021, "M_LES", segs=5)
Tt = T1
ring(b, Tt + 0.005, 0.034, 0.004, "M_Hardware", segs=32, rsegs=6)
# escape motor, pitch-control motor and nose; orange band at the tower-jettison motor
mot = [(0.0, Tt - 0.004), (0.03, Tt - 0.003), (0.0345, Tt + 0.004), (0.0345, Tt + 0.014), (0.032, Tt + 0.02)]
mot += [(0.032 - 0.0035 * t, Tt + 0.02 + 0.17 * t) for t in (0.5, 1.0)]
b.lathe(mot, "M_LES", segs=40)
b.lathe([(0.0285, Tt + 0.19), (0.0287, Tt + 0.2), (0.0287, Tt + 0.21), (0.0283, Tt + 0.214)], "M_Orange", segs=40)
nose = [(0.0283, Tt + 0.214), (0.0281, Tt + 0.24), (0.026, Tt + 0.262), (0.021, Tt + 0.288), (0.0145, Tt + 0.31), (0.009, Tt + 0.324), (0.0055, Tt + 0.329)]
b.lathe(nose, "M_LES", segs=40)
b.lathe([(0.0055, Tt + 0.329), (0.009, Tt + 0.333), (0.0105, Tt + 0.339), (0.009, Tt + 0.345), (0.005, Tt + 0.349), (0.0, Tt + 0.35)], "M_Silver", segs=24)
for i in (0, 1):  # canards
    with b.push(rot_y(i * math.pi)):
        b.box((0.042, 0.018, 0.003), (0.047, Tt + 0.262, 0), "M_LES", bevel=0.0008)
for a in QUAD:  # escape motor nozzles, canted
    with b.push(rot_y(a) @ rot_z(math.pi + 0.5), (0.03 * math.cos(a), Tt + 0.004, 0.03 * math.sin(a))):
        b.lathe([(0.0045, 0.0), (0.0115, 0.026), (0.0105, 0.0268), (0.0038, 0.002)], "M_Hardware", segs=12)
put(b, les_g)

# beacon position marker (runtime keeps its own emissive beacon)
empty("LES_Beacon", les_g, (0, SC["tip"] - 0.14, 0.031))

# =============================================================================================
# bakes (Cycles): bell tube walls high -> low (tangent-space normal), AO for persistent occlusion
# =============================================================================================


def new_image(name, w, h, noncolor=True, color=(0.5, 0.5, 1.0, 1.0)):
    im = bpy.data.images.new(name, w, h, alpha=False, float_buffer=False)
    im.generated_color = color
    if noncolor:
        im.colorspace_settings.name = "Non-Color"
    return im


def select_only(objs, active):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active


def bake_bell_normal(tag, prof_args, segs, n_tubes, ext_u, out_png, size=(1024, 512)):
    th, ex, L, W = prof_args
    lo = Builder("BAKE_lo_" + tag)
    lo.lathe(bell_outer_profile(th, ex, L, W, n=22 if tag == "bell1" else 24), "BAKE_" + tag, segs=segs)
    hi = Builder("BAKE_hi_" + tag)
    prof = []
    for (r, y) in bell_outer_profile(th, ex, L, W, n=220):
        u = 1 - y / L if 0.0062 <= y <= L else None
        prof.append((r, y, u))
    NA = n_tubes * 10
    rows = []
    for j in range(NA + 1):
        th_a = 2 * math.pi * j / NA
        row = []
        for (r, y, u) in prof:
            f = (th_a * n_tubes / (2 * math.pi)) % 1.0
            tr = math.pi * r / n_tubes
            if u is None:
                d = 0.0
            elif u < ext_u:
                d = tr * (math.sqrt(max(0.0, 1 - (2 * f - 1) ** 2)) - 0.62)
            else:  # nozzle extension: overlapping shingles
                d = 0.0011 * (1 - ((y / 0.017) % 1.0)) - 0.0005
            rr = r + d
            row.append((rr * math.cos(th_a), y, rr * math.sin(th_a)))
        rows.append(row)
    mat_bake = bpy.data.materials.new("BAKE_" + tag)
    mat_bake.use_nodes = True
    img = new_image("bake_" + tag, *size)
    node = mat_bake.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = img
    mat_bake.node_tree.nodes.active = node
    MAT["BAKE_" + tag] = mat_bake
    lo_ob = lo.build(MAT)
    surface(hi, rows, "BAKE_" + tag, hint=lambda q: (q.x, 0, q.z))
    hi_ob = hi.build(MAT, merge=False)
    for o in (lo_ob, hi_ob):
        o.data.polygons.foreach_set("use_smooth", [True] * len(o.data.polygons))
    select_only([hi_ob, lo_ob], lo_ob)
    scene.cycles.samples = 4
    scene.render.bake.use_selected_to_active = True
    scene.render.bake.cage_extrusion = 0.12
    scene.render.bake.max_ray_distance = 0.3
    scene.render.bake.margin = 6
    scene.render.bake.normal_space = "TANGENT"
    bpy.ops.object.bake(type="NORMAL")
    img.filepath_raw = out_png
    img.file_format = "PNG"
    img.save()
    ao = new_image("bakeao_" + tag, size[0] // 2, size[1] // 2, color=(1, 1, 1, 1))
    node.image = ao
    scene.cycles.samples = 48
    world.light_settings.distance = 0.15  # tube-gap scale only
    bpy.ops.object.bake(type="AO")
    world.light_settings.distance = 1.2
    ao.filepath_raw = out_png.replace("_normal.png", "_tubeao.png")
    ao.file_format = "PNG"
    ao.save()
    for o in (lo_ob, hi_ob):
        bpy.data.objects.remove(o, do_unlink=True)


def bake_ao(ob, out_png, size, samples=96, hide=()):
    """AO into ob's UVs. `hide`: objects left out (e.g. the neighbouring engines, whose occlusion
    would be wrong on bells that share one material)."""
    for o in hide:
        o.hide_render = True
    img = new_image("ao_" + ob.name, *size, color=(1, 1, 1, 1))
    added = []
    for slot in ob.material_slots:
        nt = slot.material.node_tree
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = img
        nt.nodes.active = n
        added.append((nt, n))
    select_only([ob], ob)
    scene.render.bake.use_selected_to_active = False
    scene.render.bake.margin = 8
    scene.cycles.samples = samples
    bpy.ops.object.bake(type="AO")
    img.filepath_raw = out_png
    img.file_format = "PNG"
    img.save()
    for nt, n in added:
        nt.nodes.remove(n)
    for o in hide:
        o.hide_render = False


if not FAST:
    print("bake: bell tube walls …", flush=True)
    bake_bell_normal("bell1", (F1["th"], F1["ex"], F1["L"], F1["W"]), 48, 120, 0.62, os.path.join(TEX, "bell1_normal.png"))
    bake_bell_normal("bell2", (J2["th"], J2["ex"], J2["L"], J2["W"]), 64, 144, 2.0, os.path.join(TEX, "bell2_normal.png"))
    print("bake: AO …", flush=True)
    bake_ao(OBJ["S1_Tank"], os.path.join(OUT, "ao_s1.png"), (1024, 1024))
    bake_ao(OBJ["S2_Body"], os.path.join(OUT, "ao_s2.png"), (1024, 512))
    others = [o for o in bpy.data.objects if o.name.startswith("S1_Engine_") and not o.name.startswith("S1_Engine_C")]
    bake_ao(OBJ["S1_Engine_C_Bell"], os.path.join(OUT, "ao_bell1.png"), (512, 256), hide=[o for o in others if o.type == "MESH"])
    bake_ao(OBJ["S2_Engine_Bell"], os.path.join(OUT, "ao_bell2.png"), (512, 256))
    T.merge_ao(os.path.join(TEX, "s1_skin_orm.png"), os.path.join(OUT, "ao_s1.png"), 0.85)
    T.merge_ao(os.path.join(TEX, "s2_skin_orm.png"), os.path.join(OUT, "ao_s2.png"), 0.85)
    T.merge_ao(os.path.join(TEX, "bell1_orm.png"), os.path.join(OUT, "ao_bell1.png"), 0.8, os.path.join(TEX, "bell1_tubeao.png"))
    T.merge_ao(os.path.join(TEX, "bell2_orm.png"), os.path.join(OUT, "ao_bell2.png"), 0.8, os.path.join(TEX, "bell2_tubeao.png"))
    for m in ("BAKE_bell1", "BAKE_bell2"):
        bpy.data.materials.remove(MAT.pop(m))
    # the bell materials now pick up the baked normal maps
    for name, tex, nrm in (("M_Bell1", "bell1", "bell1"), ("M_Bell2", "bell2", "bell2"), ("M_Bell1Inner", "bellin", "bell1"), ("M_Bell2Inner", "bellin", "bell2")):
        old = MAT.pop(name)
        old.name = name + "_old"
        nm = make_mat(name, tex, normal=os.path.join(TEX, nrm + "_normal.png"))
        for ob in bpy.data.objects:
            for s in ob.material_slots:
                if s.material == old:
                    s.material = nm
        bpy.data.materials.remove(old)
    for im in bpy.data.images:
        if im.filepath:
            im.reload()

# =============================================================================================
# save, report, export
# =============================================================================================
for im in list(bpy.data.images):
    if im.users == 0:
        bpy.data.images.remove(im)
blend = os.path.join(OUT, "lv001_prototype.blend")
bpy.ops.wm.save_as_mainfile(filepath=blend, relative_remap=True, compress=True)

stats = {"objects": {}, "triangles": 0}
for ob in bpy.data.objects:
    if ob.type != "MESH":
        continue
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    stats["objects"][ob.name] = {"tris": tris, "materials": [s.material.name for s in ob.material_slots], "parent": ob.parent.name if ob.parent else None}
    stats["triangles"] += tris
stats["draw_calls"] = sum(len(v["materials"]) for v in stats["objects"].values())
stats["materials"] = sorted({m for v in stats["objects"].values() for m in v["materials"]})
with open(os.path.join(OUT, "stats.json"), "w") as f:
    json.dump(stats, f, indent=1)
print("triangles", stats["triangles"], "draw calls", stats["draw_calls"], "materials", len(stats["materials"]))

# export in RocketModel units: the root node carries the 1/18 scale
root.scale = (1 / U, 1 / U, 1 / U)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, "lv001_raw.glb"),
    export_format="GLB",
    export_yup=True,
    export_apply=False,
    export_tangents=True,
    export_image_format="AUTO",
    export_materials="EXPORT",
    export_extras=False,
    export_cameras=False,
    export_lights=False,
    use_selection=False,
)
root.scale = (1, 1, 1)
print("done", flush=True)
os._exit(0)  # skip bpy's teardown (it can segfault at interpreter exit in module builds)
