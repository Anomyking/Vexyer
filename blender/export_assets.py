"""
Rebuilds the portfolio models from the proportions in your sketch scene and exports five
Meshopt-compressed GLB packs.

Run headless:      blender -b -P blender/export_assets.py -- public/models
or from Blender:   Scripting tab -> open this file -> Run Script (writes next to the .blend)

It builds everything in a temporary scene, so your sketch scene is never modified.
Node names are part of the contract with src/assets/procedural.ts - keep them.
"""
import math
import os
import sys
import traceback

import bmesh
import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0]) if argv else os.path.join(os.path.dirname(bpy.data.filepath) or os.getcwd(), "portfolio_assets")
os.makedirs(OUT, exist_ok=True)

import random

random.seed(11)

scene = bpy.data.scenes.new("__export_tmp")
vl = scene.view_layers[0]
col = scene.collection
meshes, objs, mats = [], [], []


def material(name, rgba, metal, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = rgba
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    mats.append(m)
    return m


M_SLAB = material("ex_slab", (0.06, 0.07, 0.09, 1), 0.6, 0.35)
M_RING = material("ex_ring", (0.72, 0.74, 0.8, 1), 0.85, 0.32)
M_CORE = material("ex_core", (0.1, 0.32, 0.95, 1), 0.2, 0.15)
M_FRAME = material("ex_frame", (0.04, 0.05, 0.06, 1), 0.7, 0.4)
M_GLASS = material("ex_glass", (0.7, 0.85, 1.0, 1), 0.0, 0.05)
M_CLOUD = material("ex_cloud", (1, 1, 1, 1), 0.0, 1.0)
M_PAPER = material("ex_paper", (0.97, 0.97, 0.95, 1), 0.0, 0.8)


def make(name, bm, mat, smooth=False, loc=(0, 0, 0), rot=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = smooth
    me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    col.objects.link(o)
    o.location, o.rotation_euler = loc, rot
    meshes.append(me)
    objs.append(o)
    return o


def box(sx, sy, sz, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0, calc_uvs=True)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts[:])
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=1)
    return bm


def loft(levels):
    """Block lofted through (z, width, depth, twist) levels: the modified-cube ring element."""
    bm = bmesh.new()
    rings = []
    for z, w, d, rot in levels:
        c, s = math.cos(rot), math.sin(rot)
        pts = [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]
        rings.append([bm.verts.new((x * c - y * s, x * s + y * c, z)) for x, y in pts])
    for a, b in zip(rings, rings[1:]):
        for i in range(4):
            bm.faces.new((a[i], a[(i + 1) % 4], b[(i + 1) % 4], b[i]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def uvsphere(bm, radius, u, v, offset=(0, 0, 0)):
    n0 = len(bm.verts)
    try:
        bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=radius)
    except TypeError:  # older API
        bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, diameter=radius)
    bmesh.ops.translate(bm, vec=offset, verts=bm.verts[n0:])


def crystal(sx, sy, sz, jitter, sub=1):
    bm = bmesh.new()
    try:
        bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    except TypeError:
        bmesh.ops.create_icosphere(bm, subdivisions=sub, diameter=1.0)
    for v in bm.verts:
        v.co *= 1 + random.uniform(-jitter, jitter)
        v.co.x *= sx
        v.co.y *= sy
        v.co.z *= sz
    return bm


try:
    # --- hero: four slabs in the sketch's pinwheel arrangement
    sketch = [(8.771, 0.613), (2.659, -6.415), (-1.927, 5.245), (-8.039, -1.783)]
    cx = sum(p[0] for p in sketch) / 4
    cy = sum(p[1] for p in sketch) / 4
    hero = [make(f"hero_{i}", box(7.4, 7.4, 0.7, 0.14), M_SLAB, False, (x - cx, y - cy, 0), (0, 0, 0.746)) for i, (x, y) in enumerate(sketch)]

    # --- portfolio: ring element (+ low-poly), core sphere (+ low-poly), screen frame
    ring = make("ring_segment", loft([(-1.7, 1.15, 1.5, -0.22), (0, 0.55, 0.8, 0.0), (1.7, 1.15, 1.5, 0.22)]), M_RING)
    ring_lo = make("ring_segment_lo", loft([(-1.7, 1.0, 1.3, 0), (1.7, 1.0, 1.3, 0)]), M_RING)
    bm = bmesh.new(); uvsphere(bm, 3.4, 24, 16); core = make("core_sphere", bm, M_CORE, True)
    bm = bmesh.new(); uvsphere(bm, 3.4, 12, 8); core_lo = make("core_sphere_lo", bm, M_CORE, True)
    frame = make("screen_frame", box(6.8, 4.4, 0.18, 0.05), M_FRAME)

    # --- sky: the sketch's row of seven graduated spheres, merged into one cloud bank
    row = [(-14.84, 1.809), (-11.707, 3.212), (-7.967, 4.151), (-0.779, 7.369), (6.872, 4.151), (10.612, 3.212), (13.744, 1.809)]
    bm = bmesh.new()
    for x, r in row:
        uvsphere(bm, r, 10, 6, (x, 0, 0))
    cloud = make("cloud_bank", bm, M_CLOUD, True)
    bm = bmesh.new()
    for x, r in row:
        uvsphere(bm, r, 7, 5, (x, 0, 0))
    cloud_lo = make("cloud_bank_lo", bm, M_CLOUD, True)

    # --- glass: two elongated shards, three interactive fragments, one debris piece
    shard_a = make("shard_a", crystal(0.55, 0.55, 10.0, 0.12), M_GLASS)
    shard_b = make("shard_b", crystal(0.5, 0.5, 9.0, 0.12), M_GLASS)
    frags = [make("frag_0", crystal(1.5, 1.2, 1.9, 0.22), M_GLASS), make("frag_1", crystal(1.2, 1.9, 1.3, 0.22), M_GLASS), make("frag_2", crystal(1.7, 1.3, 1.1, 0.22), M_GLASS)]
    debris = make("frag_debris", crystal(0.4, 0.3, 0.5, 0.25, 0), M_GLASS)

    # --- paper plane (nose points +Y in Blender)
    bm = bmesh.new()
    N = bm.verts.new((0, 3.2, 0)); T = bm.verts.new((0, -2.6, 0.2)); K = bm.verts.new((0, -2.6, -1.0))
    L = bm.verts.new((-2.4, -2.6, 0.55)); R = bm.verts.new((2.4, -2.6, 0.55)); KF = bm.verts.new((0, 0.9, -0.2))
    for f in [(N, T, L), (N, R, T), (N, K, KF), (KF, K, T), (N, KF, T)]:
        bm.faces.new(f)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    plane = make("paper_plane", bm, M_PAPER)
    plane.modifiers.new("solid", "SOLIDIFY").thickness = 0.05

    groups = {"hero": hero, "portfolio": [ring, ring_lo, core, core_lo, frame], "sky": [cloud, cloud_lo], "glass": [shard_a, shard_b, *frags, debris], "plane": [plane]}
    for name, members in groups.items():
        for o in scene.objects:
            o.select_set(False, view_layer=vl)
        for o in members:
            o.select_set(True, view_layer=vl)
        vl.objects.active = members[0]
        path = os.path.join(OUT, f"{name}.glb")
        # temp_override works headless (no window) and in the UI, and leaves your scene untouched
        with bpy.context.temp_override(scene=scene, view_layer=vl):
            bpy.ops.export_scene.gltf(
                filepath=path, export_format="GLB", use_selection=True, use_active_scene=True,
                export_apply=True, export_yup=True, export_image_format="NONE",
                export_cameras=False, export_lights=False,
                export_meshopt_compression_enable=True,  # Blender 4.4+/5.x. Remove this line on older versions.
            )
        print(f"[export] {path}  {os.path.getsize(path)} bytes")
except Exception:
    traceback.print_exc()
finally:
    for o in objs:
        bpy.data.objects.remove(o)
    for m in meshes:
        bpy.data.meshes.remove(m)
    for m in mats:
        bpy.data.materials.remove(m)
    bpy.data.scenes.remove(scene)
