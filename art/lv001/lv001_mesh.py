"""
LV-001 prototype — mesh building helpers for Blender 4.2 (bpy as a Python module).

Coordinates in these scripts are written in LV-001 model units in LUNAVIA's frame (y up, +x towards
the tower, +z south), the same numbers RocketModel.jsx uses, and stored in Blender in metres
(1 model unit = 18 m, data/payloadDesign ROCKET_M_PER_UNIT) and in Blender's z-up frame:
three (x, y, z) -> Blender (x, -z, y), which the glTF exporter turns back into y up. The export's
root node scales by 1/18, so the GLB is in RocketModel units.
"""
import math

import bpy  # noqa: I001  (bpy first: it makes bmesh / mathutils importable)
import bmesh
from mathutils import Matrix, Vector

U = 18.0  # metres per LV-001 model unit


def to_blender(p):
    return Vector((p[0] * U, -p[2] * U, p[1] * U))


class Builder:
    """Accumulates geometry for one object: vertices, faces with material slots, UVs, smoothing."""

    def __init__(self, name):
        self.name = name
        self.verts = []
        self.faces = []  # (vertex indices, material index, smooth)
        self.uvs = []  # per face: list of (u, v)
        self.mats = []  # material names, in slot order
        self.xf = []  # stack of (3x3 Matrix, offset) applied to every vertex (three frame, model units)

    def push(self, R=None, t=(0, 0, 0)):
        self.xf.append((R or Matrix.Identity(3), Vector(t)))
        return self

    def pop(self):
        self.xf.pop()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.pop()

    def _xf(self, p):
        q = Vector(p)
        for R, t in reversed(self.xf):
            q = R @ q + t
        return q

    def slot(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def add_vert(self, p):
        self.verts.append(to_blender(self._xf(p)))
        return len(self.verts) - 1

    def add_face(self, idx, uv, mat, smooth=True):
        self.faces.append((idx, self.slot(mat), smooth))
        self.uvs.append(uv)

    # ---- primitives (three frame, metres) ---------------------------------------------------
    def lathe(self, prof, mat, segs=64, a0=0.0, a1=2 * math.pi, v_len=None, smooth=True, uv_u=1.0, mats=None, inward=False, v_of=None):
        """Revolve a profile [(r, y), ...] round the y axis. u runs round (0..uv_u), v along the
        profile by arc length (0..1, or metres / v_len). `mats` gives one material per profile span."""
        n = len(prof)
        L = [0.0]
        for i in range(1, n):
            L.append(L[-1] + math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]))
        tot = v_len or (L[-1] or 1.0)
        rows = []
        for j in range(segs + 1):
            a = a0 + (a1 - a0) * j / segs
            ca, sa = math.cos(a), math.sin(a)
            rows.append([self.add_vert((r * ca, y, r * sa)) for (r, y) in prof])
        for j in range(segs):
            for i in range(n - 1):
                a, b, c, d = rows[j][i], rows[j + 1][i], rows[j + 1][i + 1], rows[j][i + 1]
                # u runs clockwise seen from above, so a texture reads unmirrored from outside
                u0, u1 = uv_u * (1 - j / segs), uv_u * (1 - (j + 1) / segs)
                if v_of:
                    v0, v1 = v_of(prof[i]), v_of(prof[i + 1])
                else:
                    v0, v1 = L[i] / tot, L[i + 1] / tot
                m = mats[i] if mats else mat
                if prof[i][0] < 1e-6 and prof[i + 1][0] < 1e-6:
                    continue
                if inward:
                    self.add_face([a, b, c, d], [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], m, smooth)
                else:
                    self.add_face([a, d, c, b], [(u0, v0), (u0, v1), (u1, v1), (u1, v0)], m, smooth)

    def sweep(self, pts, radius, mat, segs=10, smooth=True, caps=True, radii=None):
        """A tube along a polyline (parallel-transport frames)."""
        P = [Vector(p) for p in pts]
        T = []
        for i in range(len(P)):
            if i == 0:
                t = P[1] - P[0]
            elif i == len(P) - 1:
                t = P[-1] - P[-2]
            else:
                t = (P[i + 1] - P[i - 1])
            T.append(t.normalized())
        ref = Vector((0, 1, 0)) if abs(T[0].y) < 0.9 else Vector((1, 0, 0))
        N = T[0].cross(ref).normalized()
        rings = []
        Lacc = [0.0]
        for i in range(len(P)):
            if i > 0:
                Lacc.append(Lacc[-1] + (P[i] - P[i - 1]).length)
                b = T[i - 1].cross(T[i])
                if b.length > 1e-6:
                    ang = math.acos(max(-1, min(1, T[i - 1].dot(T[i]))))
                    N = (Matrix.Rotation(ang, 3, b.normalized()) @ N).normalized()
            B = T[i].cross(N).normalized()
            r = radii[i] if radii else radius
            ring = []
            for k in range(segs + 1):
                a = 2 * math.pi * k / segs
                q = P[i] + (N * math.cos(a) + B * math.sin(a)) * r
                ring.append(self.add_vert(q))
            rings.append(ring)
        tot = Lacc[-1] or 1
        for i in range(len(P) - 1):
            for k in range(segs):
                a, b, c, d = rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]
                self.add_face([a, b, c, d], [(k / segs, Lacc[i] / tot), ((k + 1) / segs, Lacc[i] / tot), ((k + 1) / segs, Lacc[i + 1] / tot), (k / segs, Lacc[i + 1] / tot)], mat, smooth)
        if caps:
            for i, sgn in ((0, -1), (len(P) - 1, 1)):
                c = self.add_vert(P[i])
                for k in range(segs):
                    a, b = rings[i][k], rings[i][k + 1]
                    f = [a, b, c] if sgn < 0 else [b, a, c]
                    self.add_face(f, [(0, 0), (1, 0), (0.5, 1)], mat, False)

    def box(self, size, center, mat, rot=None, bevel=0.0, seg=1):
        """A box (sx, sy, sz) at center, optionally bevelled, rotated by a 3x3 Matrix (three frame)."""
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
        if bevel > 0:
            bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=seg, profile=0.5, affect="EDGES", clamp_overlap=True)
        self.add_bm(bm, center, mat, rot)
        bm.free()

    def add_bm(self, bm, center, mat, rot=None, smooth=False):
        R = rot or Matrix.Identity(3)
        c = Vector(center)
        base = len(self.verts)
        for v in bm.verts:
            p = R @ Vector(v.co) + c
            self.verts.append(to_blender(self._xf(p)))
        bm.verts.index_update()
        for f in bm.faces:
            idx = [base + v.index for v in f.verts]
            # planar box-style UVs from the face normal
            n = f.normal
            uv = []
            for v in f.verts:
                co = v.co
                if abs(n.x) >= abs(n.y) and abs(n.x) >= abs(n.z):
                    uv.append((co.z, co.y))
                elif abs(n.y) >= abs(n.z):
                    uv.append((co.x, co.z))
                else:
                    uv.append((co.x, co.y))
            self.add_face(idx, uv, mat, smooth)

    def cyl(self, a, b, r, mat, segs=12, caps=True, smooth=True):
        self.sweep([a, b], r, mat, segs=segs, smooth=smooth, caps=caps)

    def torus(self, center, R, r, mat, segs=48, rsegs=8, y_axis=True):
        pts = []
        for k in range(segs + 1):
            a = 2 * math.pi * k / segs
            pts.append((center[0] + R * math.cos(a), center[1], center[2] + R * math.sin(a)))
        self.sweep(pts, r, mat, segs=rsegs, caps=False)

    # ---- write ----------------------------------------------------------------------------
    def build(self, materials, sharp_deg=32.0, parent=None, merge=True):
        me = bpy.data.meshes.new(self.name)
        me.from_pydata([tuple(v) for v in self.verts], [], [f[0] for f in self.faces])
        uvl = me.uv_layers.new(name="UVMap")
        li = 0
        for fi, poly in enumerate(me.polygons):
            poly.material_index = self.faces[fi][1]
            poly.use_smooth = self.faces[fi][2]
            for k, loop_index in enumerate(poly.loop_indices):
                uvl.data[loop_index].uv = self.uvs[fi][k]
            li += 1
        for m in self.mats:
            me.materials.append(materials[m])
        me.validate()
        # sharp edges by angle (smooth shading elsewhere)
        bm = bmesh.new()
        bm.from_mesh(me)
        if merge:
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
        ngons = [f for f in bm.faces if len(f.verts) > 4]
        if ngons:  # glTF tangents (normal maps) need tris/quads
            bmesh.ops.triangulate(bm, faces=ngons, quad_method="BEAUTY", ngon_method="BEAUTY")
        lim = math.radians(sharp_deg)
        for e in bm.edges:
            if len(e.link_faces) == 2:
                if e.link_faces[0].normal.angle(e.link_faces[1].normal, 0) > lim:
                    e.smooth = False
                if e.link_faces[0].material_index != e.link_faces[1].material_index:
                    e.smooth = False
        bm.to_mesh(me)
        bm.free()
        me.update()
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        if parent is not None:
            ob.parent = parent
        return ob


def empty(name, parent=None, at=(0, 0, 0)):
    ob = bpy.data.objects.new(name, None)
    ob.location = to_blender(at)
    bpy.context.scene.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def rot_y(a):
    """Rotation about LUNAVIA's y axis (three frame), as a 3x3 matrix applied in the three frame."""
    c, s = math.cos(a), math.sin(a)
    # maps +x to (cos a, 0, sin a), the same sense as polar()
    return Matrix(((c, 0, -s), (0, 1, 0), (s, 0, c)))


def polar(r, y, a):
    return (r * math.cos(a), y, r * math.sin(a))


def rot_z(a):
    """Rotation about LUNAVIA's z axis (three frame): tilts +y towards -x for a > 0."""
    c, s = math.cos(a), math.sin(a)
    return Matrix(((c, -s, 0), (s, c, 0), (0, 0, 1)))


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return Matrix(((1, 0, 0), (0, c, -s), (0, s, c)))


def look_y(d):
    """3x3 rotation taking +y to the direction d."""
    d = Vector(d).normalized()
    y = Vector((0, 1, 0))
    if (d - y).length < 1e-9:
        return Matrix.Identity(3)
    if (d + y).length < 1e-9:
        return rot_x(math.pi)
    return y.rotation_difference(d).to_matrix()


def surface(b, rows, mat, uvs=None, hint=None, smooth=True):
    """Quads between consecutive rows of points (three frame, before b's transforms). `hint(p)`
    gives an outward direction at p; faces are flipped as a whole if they face the other way."""
    P = [[Vector(p) for p in row] for row in rows]
    nr, nc = len(P), len(P[0])
    if uvs is None:
        uvs = [[(j / (nc - 1), i / (nr - 1)) for j in range(nc)] for i in range(nr)]
    flip = False
    if hint is not None:
        votes = 0
        for i in range(nr - 1):
            for j in range(nc - 1):
                a, bq, c = P[i][j], P[i][j + 1], P[i + 1][j]
                n = (bq - a).cross(c - a)
                if n.length > 1e-12:
                    votes += 1 if n.dot(Vector(hint((a + bq + c) / 3))) > 0 else -1
        flip = votes < 0
    idx = [[b.add_vert(p) for p in row] for row in P]
    for i in range(nr - 1):
        for j in range(nc - 1):
            f = [idx[i][j], idx[i][j + 1], idx[i + 1][j + 1], idx[i + 1][j]]
            uv = [uvs[i][j], uvs[i][j + 1], uvs[i + 1][j + 1], uvs[i + 1][j]]
            if flip:
                f.reverse()
                uv.reverse()
            b.add_face(f, uv, mat, smooth)


def bezier(p0, p1, p2, n=10, p3=None):
    out = []
    for k in range(n + 1):
        t = k / n
        if p3 is None:
            q = [(1 - t) ** 2 * a + 2 * (1 - t) * t * bb + t * t * c for a, bb, c in zip(p0, p1, p2)]
        else:
            q = [(1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * bb + 3 * (1 - t) * t * t * c + t ** 3 * d for a, bb, c, d in zip(p0, p1, p2, p3)]
        out.append(tuple(q))
    return out
