# Builds public/models/footballer.glb from Blender's "Human Base Meshes" bundle (Blender Foundation, CC0 1.0).
# Reproducible: the base mesh is taken as published, centred, reduced, given a skeleton with automatic weights and a
# per-vertex kit region (shirt, shorts, socks, boots, skin, hair, ...), and exported as a skinned glTF. No animation is
# baked in: the game poses the skeleton from the physics (render/footballer.ts).
#
# Usage (Blender 4.2+):
#   blender -b <bundle>/human_base_meshes_bundle.blend --python scripts/figure/build-footballer.py -- <out.glb> [preview-dir]
# Bundle: https://www.blender.org/download/demo-files/ → Human Base Meshes v1.4.1 (CC0).
import bpy, bmesh, math, os, sys
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.getcwd(), 'public', 'models', 'footballer.glb')
PREVIEW = argv[1] if len(argv) > 1 and argv[1] != '-' else None
# CMU motion capture (BVH, see cmu_clips.py) and where the clip metadata for the game goes.
CMU_DIR = argv[2] if len(argv) > 2 else None
CLIPS_JSON = argv[3] if len(argv) > 3 else None
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
DECIMATE = 0.5  # ≈ 10 000 triangles per figure

# Joint positions (m) of the centred model, standing on z = 0, facing −y; +x is the model's left. Read off front and
# side renders of the base mesh (scripts/figure/README.md).
J = {
    'pelvis': (0, 0, 0.95), 'spine': (0, 0, 1.07), 'chest': (0, 0, 1.25), 'neck': (0, 0, 1.45), 'head': (0, -0.01, 1.55), 'top': (0, -0.01, 1.70),
}
for side, sx in (('L', 1), ('R', -1)):
    J.update({
        f'hip.{side}': (sx * 0.095, 0, 0.91), f'knee.{side}': (sx * 0.115, -0.012, 0.50), f'ankle.{side}': (sx * 0.165, 0.0, 0.085), f'toe.{side}': (sx * 0.18, -0.12, 0.02),
        f'shoulder.{side}': (sx * 0.17, 0.005, 1.37), f'elbow.{side}': (sx * 0.28, 0.01, 1.06), f'wrist.{side}': (sx * 0.37, -0.005, 0.84), f'fingers.{side}': (sx * 0.40, -0.02, 0.74),
    })
BONES = [  # name, head, tail, parent
    ('pelvis', 'pelvis', 'spine', None), ('spine', 'spine', 'chest', 'pelvis'), ('chest', 'chest', 'neck', 'spine'),
    ('neck', 'neck', 'head', 'chest'), ('head', 'head', 'top', 'neck'),
]
for s in ('L', 'R'):
    BONES += [
        (f'thigh.{s}', f'hip.{s}', f'knee.{s}', 'pelvis'), (f'shin.{s}', f'knee.{s}', f'ankle.{s}', f'thigh.{s}'), (f'foot.{s}', f'ankle.{s}', f'toe.{s}', f'shin.{s}'),
        (f'upperarm.{s}', f'shoulder.{s}', f'elbow.{s}', 'chest'), (f'forearm.{s}', f'elbow.{s}', f'wrist.{s}', f'upperarm.{s}'), (f'hand.{s}', f'wrist.{s}', f'fingers.{s}', f'forearm.{s}'),
    ]

# 1. The base mesh at its published resolution (no multires detail), plus its eyes, centred.
src = bpy.data.objects['GEO-body_male_realistic']
scene = bpy.data.scenes.new('footballer')
bpy.context.window.scene = scene
parts = []
for name in ('GEO-body_male_realistic', 'GEO-body_male_realistic.eye.L', 'GEO-body_male_realistic.eye.R'):
    o = bpy.data.objects[name]
    me = o.data.copy()
    me.transform(o.matrix_world)
    ob = bpy.data.objects.new(name.replace('GEO-', 'part-'), me)
    scene.collection.objects.link(ob)
    parts.append(ob)
body = parts[0]
bm_xs = [v.co.x for v in body.data.vertices]
feet_y = [v.co.y for v in body.data.vertices if v.co.z < 0.08]
offset = Vector((-(min(bm_xs) + max(bm_xs)) / 2, -(min(feet_y) + max(feet_y)) / 2, -min(v.co.z for v in body.data.vertices)))
for ob in parts:
    ob.data.transform(Matrix.Translation(offset))
    ob.data['is_eye'] = ob is not body
for ob in parts:
    ob.select_set(True)
bpy.context.view_layer.objects.active = body
eye_verts_before = len(body.data.vertices)
bpy.ops.object.join()
mesh = body
eye_from = eye_verts_before  # vertices appended by the join are the eyes

# Mark the eye vertices before reducing (the decimate keeps attributes).
eye_attr = mesh.data.attributes.new('is_eye', 'FLOAT', 'POINT')
for i, v in enumerate(mesh.data.vertices):
    eye_attr.data[i].value = 1.0 if i >= eye_from else 0.0

# 2. Fewer triangles: 22 figures are drawn at once.
dec = mesh.modifiers.new('decimate', 'DECIMATE')
dec.ratio = DECIMATE
bpy.ops.object.modifier_apply(modifier='decimate')
bpy.ops.object.shade_smooth()

# 3. Skeleton and automatic weights.
arm_data = bpy.data.armatures.new('skeleton')
rig = bpy.data.objects.new('footballer', arm_data)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
for name, h, t, parent in BONES:
    b = arm_data.edit_bones.new(name)
    b.head, b.tail = Vector(J[h]), Vector(J[t])
    b.roll = 0
    if parent:
        b.parent = arm_data.edit_bones[parent]
        b.use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')
mesh.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')

# 4. Body part per vertex (vertex colour R = (part + 0.5) / 16) from the dominant bone. The kit colours are not baked:
# the game's shader cuts shirt, shorts, socks and boots inside each part at fixed heights (render/footballer.ts), so
# the hems are straight lines instead of following the triangles. The same heights shape the cloth here.
TORSO, NECK, HEAD, UPPERARM, FOREARM, HAND, THIGH, SHIN, FOOT, EYE = range(10)
PART = {'pelvis': TORSO, 'spine': TORSO, 'chest': TORSO, 'neck': NECK, 'head': HEAD}
for side in ('L', 'R'):
    PART.update({f'upperarm.{side}': UPPERARM, f'forearm.{side}': FOREARM, f'hand.{side}': HAND, f'thigh.{side}': THIGH, f'shin.{side}': SHIN, f'foot.{side}': FOOT})
groups = {g.index: g.name for g in mesh.vertex_groups}
eye_layer = mesh.data.attributes['is_eye']
colours = mesh.data.color_attributes.new('kit', 'BYTE_COLOR', 'POINT')
counts = [0] * 10

def ramp(z, at, width=0.012):
    """0 below `at`, 1 above, a short smooth step (a hem) in between."""
    t = max(0.0, min(1.0, (z - at + width / 2) / width))
    return t * t * (3 - 2 * t)

def cloth(part, co):
    """How far the cloth (or hair) stands off the skin here (m): shirt, wide shorts flaring to the hem, socks, boots."""
    z = co.z
    if part == TORSO: return 0.011 * ramp(z, 0.99) + (0.016 + 0.012 * max(0.0, (0.86 - z) / 0.16)) * (1 - ramp(z, 0.99))
    if part == THIGH: return (0.016 + 0.012 * max(0.0, (0.86 - z) / 0.16)) * ramp(z, 0.70)
    if part == SHIN: return 0.009 * (1 - ramp(z, 0.115)) + 0.005 * ramp(z, 0.115) * (1 - ramp(z, 0.45))
    if part == FOOT: return 0.009
    if part == UPPERARM: return 0.011 * ramp(z, 1.215)
    if part == NECK: return 0.011 * (1 - ramp(z, 1.44))
    if part == HEAD: return 0.009 if (z > 1.615 or (co.y > 0.005 and z > 1.5)) else 0.0
    return 0.0

parts_of = []
for v in mesh.data.vertices:
    best = max(v.groups, key=lambda g: g.weight, default=None)
    part = EYE if eye_layer.data[v.index].value > 0.5 else PART.get(groups.get(best.group, 'pelvis') if best else 'pelvis', TORSO)
    counts[part] += 1
    parts_of.append(part)
    colours.data[v.index].color = ((part + 0.5) / 16, 0, 0, 1)
offsets = [cloth(parts_of[v.index], v.co) for v in mesh.data.vertices]
for v in mesh.data.vertices:
    v.co += v.normal * offsets[v.index]
print('parts torso/neck/head/upperarm/forearm/hand/thigh/shin/foot/eye', counts, 'triangles', sum(len(p.vertices) - 2 for p in mesh.data.polygons))
mesh.data.attributes.remove(mesh.data.attributes['is_eye'])
for uv in list(mesh.data.uv_layers):
    mesh.data.uv_layers.remove(uv)

# 5. Optional preview renders (front, side) for the record.
if PREVIEW:
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 1.9
    scene.collection.objects.link(cam); scene.camera = cam
    scene.render.engine = 'BLENDER_WORKBENCH'; scene.render.resolution_x = scene.render.resolution_y = 700
    scene.display.shading.color_type = 'VERTEX'  # shows the body parts
    for name, loc, rot in (('front', (0, -5, 0.85), (math.pi / 2, 0, 0)), ('side', (5, 0, 0.85), (math.pi / 2, 0, math.pi / 2))):
        cam.location, cam.rotation_euler = loc, rot
        scene.render.filepath = os.path.join(PREVIEW, f'footballer-{name}.png')
        bpy.ops.render.render(write_still=True)

# 6. Motion clips (CMU mocap retargeted onto this rig).
clips = []
if CMU_DIR:
    import cmu_clips, json
    clips = cmu_clips.build_clips(rig, CMU_DIR)
    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    if CLIPS_JSON:
        with open(CLIPS_JSON, 'w') as f:
            json.dump({'source': 'CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), BVH conversion by B. Hahne; free for research and commercial use', 'clips': clips}, f, indent=1)
    print('clips', [(c['name'], round(c['speed'], 2), round(c['duration'], 2)) for c in clips])

# 7. Export the skinned figure.
for o in scene.objects:
    o.select_set(o in (mesh, rig))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_skins=True, export_animations=bool(clips), export_animation_mode='ACTIONS', export_morph=False,
                          export_texcoords=False, export_normals=True, export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_materials='NONE', export_yup=True)
print('written', OUT, os.path.getsize(OUT), 'bytes')
