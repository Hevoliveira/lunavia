"""
Diagnostic Blender renders of the LV-001 prototype (geometry / material checks only — the
visual evidence for the comparison comes from LUNAVIA's own renderer, /dev/lv001).

    python art/lv001/render_diag.py [out_dir] [view ...]
"""
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "build", "diag")
WANT = sys.argv[2:]
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=os.path.join(HERE, "build", "lv001_prototype.blend"))
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.samples = int(os.environ.get("LV_SAMPLES", "24"))
sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = 900, 1100
sc.view_settings.view_transform = "AgX"
w = sc.world
w.use_nodes = True
bg = w.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.42, 0.55, 0.75, 1)
bg.inputs["Strength"].default_value = 0.5
sun_d = bpy.data.lights.new("Sun", "SUN")
sun_d.energy = 4.0
sun_d.angle = math.radians(1.0)
sun = bpy.data.objects.new("Sun", sun_d)
sc.collection.objects.link(sun)
# LUNAVIA's pad sun direction, (10, 8, 8) in three's frame -> Blender (x, -z, y)
d = Vector((10, -8, 8)).normalized()
sun.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
cam_d = bpy.data.cameras.new("Cam")
cam = bpy.data.objects.new("Cam", cam_d)
sc.collection.objects.link(cam)
sc.camera = cam
U = 18.0


def tb(p):
    return Vector((p[0] * U, -p[2] * U, p[1] * U))


VIEWS = {
    # name: (camera pos, target, lens mm) in model units, three frame
    "full": ((-4.2, 2.2, 6.0), (0, 2.6, 0), 50),
    "aft": ((0.9, -0.5, 1.0), (0, 0.2, 0), 40),
    "aft_up": ((0.25, -0.45, 0.35), (0, 0.15, 0), 24),
    "engines": ((0.42, -0.12, 0.42), (0, 0.1, 0), 30),
    "label": ((2.2, 1.5, 0.4), (0, 1.5, 0), 50),
    "mid": ((-1.4, 1.5, 1.8), (0, 1.4, 0), 50),
    "inter": ((-0.9, 2.8, 1.2), (0, 2.68, 0), 50),
    "top": ((-0.8, 5.2, 1.1), (0, 4.9, 0), 50),
    "s2aft": ((0.9, 2.2, 0.9), (0, 2.75, 0), 40),
}
hide = os.environ.get("LV_HIDE", "")
for n in hide.split(","):
    if n and n in bpy.data.objects:
        o = bpy.data.objects[n]
        o.hide_render = True
        for c in o.children_recursive:
            c.hide_render = True
for name, (pos, tgt, lens) in VIEWS.items():
    if WANT and name not in WANT:
        continue
    cam.location = tb(pos)
    dirv = tb(tgt) - tb(pos)
    cam.rotation_euler = dirv.to_track_quat("-Z", "Y").to_euler()
    cam_d.lens = lens
    cam_d.clip_start = 0.05
    cam_d.clip_end = 1000
    sc.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True)
    print("wrote", sc.render.filepath, flush=True)
