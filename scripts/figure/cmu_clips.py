# Retargets CMU motion capture (BVH conversion by B. Hahne, mocap.cs.cmu.edu – "free for use in research and commercial
# projects") onto the footballer rig built by build-footballer.py. Imported by build-footballer.py.
#
# Method, per frame: the trunk bones (pelvis, spine, chest, neck, head) take the source bone's rotation relative to the
# source T-pose; the limb bones (thigh, shin, foot, upper arm, forearm, hand) are aimed along the source limb, which
# keeps knee and elbow where the actor had them whatever the two rest poses are. Every clip is turned so that the actor
# runs towards the model's front (−y) and made in place (the game moves the body from the physics). Cyclic clips are
# cut to one full stride cycle from the actor's foot contacts. Mirrored copies give the other foot.
import bpy, json, math, os
from mathutils import Matrix, Quaternion, Vector

FPS = 120  # CMU capture rate
MAP = {  # rig bone -> BVH joint (and the joint its direction points to, for limbs)
    'pelvis': ('Hips', None), 'spine': ('LowerBack', None), 'chest': ('Spine1', None), 'neck': ('Neck', None), 'head': ('Head', None),
}
for side, bvh in (('L', 'Left'), ('R', 'Right')):
    MAP.update({
        f'thigh.{side}': (f'{bvh}UpLeg', f'{bvh}Leg'), f'shin.{side}': (f'{bvh}Leg', f'{bvh}Foot'), f'foot.{side}': (f'{bvh}Foot', f'{bvh}ToeBase'),
        f'upperarm.{side}': (f'{bvh}Arm', f'{bvh}ForeArm'), f'forearm.{side}': (f'{bvh}ForeArm', f'{bvh}Hand'), f'hand.{side}': (f'{bvh}Hand', f'{bvh}FingerBase'),
    })
TRUNK = ('pelvis', 'spine', 'chest', 'neck', 'head')


def import_bvh(path):
    before = set(bpy.data.objects)
    bpy.ops.import_anim.bvh(filepath=path, global_scale=1.0, frame_start=1, use_fps_scale=False, update_scene_fps=False,
                            update_scene_duration=False, rotate_mode='NATIVE', axis_forward='-Z', axis_up='Y')
    arm = [o for o in set(bpy.data.objects) - before if o.type == 'ARMATURE'][0]
    return arm


def sample(arm, frames):
    """World positions and rotations of every BVH joint for the given frames (frame 1 is the T-pose)."""
    scene = bpy.context.scene
    out = {}
    for f in frames:
        scene.frame_set(f)
        out[f] = {pb.name: (arm.matrix_world @ pb.head, (arm.matrix_world @ pb.matrix).to_quaternion()) for pb in arm.pose.bones}
    return out


def foot_contacts(data, frames, joint):
    """Frames where a foot touches down: its height falls below a quarter of its range after having been above half."""
    zs = [data[f][joint][0].z for f in frames]
    lo, hi = min(zs), max(zs)
    down, up = lo + 0.25 * (hi - lo), lo + 0.5 * (hi - lo)
    out, raised = [], False
    for f, z in zip(frames, zs):
        if z > up: raised = True
        elif z < down and raised:
            out.append(f); raised = False
    return out


def retarget(rig, bvh_path, name, start, end, mirror=False, cyclic=True, meta=None, strike=None, face_shoulders=False):
    """Bakes BVH frames start..end (inclusive) onto `rig` as action `name`; returns its metadata."""
    src = import_bvh(bvh_path)
    frames = list(range(start, end + 1))
    data = sample(src, [1] + frames)
    rest = data[1]
    # Scale: the actor's leg (hip joint to ankle in the T-pose) to the rig's leg.
    arm_data = rig.data
    rig_leg = (arm_data.bones['thigh.L'].head_local - arm_data.bones['shin.L'].tail_local).length
    src_leg = (rest['LeftUpLeg'][0] - rest['LeftFoot'][0]).length
    scale = rig_leg / src_leg
    # Facing: the direction the hips travel over the clip (cyclic), else the T-pose facing (−y after import).
    p0, p1 = data[start]['Hips'][0], data[end]['Hips'][0]
    travel = Vector((p1.x - p0.x, p1.y - p0.y))
    if strike:
        # A strike faces where the kicking foot swings through at contact (the direction the ball is sent).
        frame, foot = strike
        a, b = data[frame - 3][f'{foot}Foot'][0], data[frame + 3][f'{foot}Foot'][0]
        travel = Vector((b.x - a.x, b.y - a.y))
    heading = math.atan2(travel.x, -travel.y) if (cyclic or strike) and travel.length > 1e-3 else 0.0
    if face_shoulders:
        # Standing: the actor faces perpendicular to his shoulders (averaged over the clip); that becomes −y.
        sx = sum((data[f]['LeftArm'][0] - data[f]['RightArm'][0]).x for f in frames)
        sy = sum((data[f]['LeftArm'][0] - data[f]['RightArm'][0]).y for f in frames)
        # Shoulder axis (left minus right) of a body facing −y points to +x; facing = axis turned by −90° = (sy, −sx).
        heading = math.atan2(sy, sx)
    turn = Quaternion((0, 0, 1), -heading)  # rotate so the travel direction becomes −y
    M = Matrix.Diagonal((-1, 1, 1))
    def fix_pos(p, f):
        q = turn @ Vector((p.x - data[f]['Hips'][0].x, p.y - data[f]['Hips'][0].y, p.z))
        if mirror: q.x = -q.x
        return q * scale
    def fix_rot(r):
        q = turn @ r
        if mirror: q = Quaternion((q.w, q.x, -q.y, -q.z))
        return q
    swap = (lambda n: n.replace('Left', '#').replace('Right', 'Left').replace('#', 'Right')) if mirror else (lambda n: n)
    # The rig's rest pose in armature space.
    rest_world = {b.name: b.matrix_local.to_quaternion() for b in arm_data.bones}
    rest_dir = {b.name: (b.tail_local - b.head_local).normalized() for b in arm_data.bones}
    act = bpy.data.actions.new(name)
    rig.animation_data_create()
    rig.animation_data.action = act
    order = [b.name for b in arm_data.bones]  # parents before children
    # The T-pose reference is mirrored like the motion but not turned: turning the motion means turn · R · R0⁻¹ (a
    # world rotation); turning both would only conjugate the delta and leave the trunk's yaw where the actor had it.
    def mirror_only(r):
        return Quaternion((r.w, r.x, -r.y, -r.z)) if mirror else r.copy()
    rest_src_rot = {j: mirror_only(rest[j][1]) for j in rest}
    floor = min(min(data[f]['LeftFoot'][0].z, data[f]['RightFoot'][0].z) for f in frames) * scale
    rig_ankle = arm_data.bones['shin.L'].tail_local.z
    for i, f in enumerate(frames):
        d = data[f]
        world = {}
        for bname in order:
            joint, child = MAP[bname]
            joint = swap(joint); child = swap(child) if child else None
            if bname in TRUNK:
                delta = fix_rot(d[joint][1]) @ rest_src_rot[joint].inverted()
                world[bname] = delta @ rest_world[bname]
            else:
                v = (fix_pos(d[child][0], f) - fix_pos(d[joint][0], f)).normalized()
                world[bname] = rest_dir[bname].rotation_difference(v) @ rest_world[bname]
        for bname in order:
            b = arm_data.bones[bname]
            pb = rig.pose.bones[bname]
            if b.parent:
                parent_pose = world[b.parent.name]
                # basis = (parent_pose · parent_rest⁻¹ · bone_rest)⁻¹ · desired, rotation only
                rel = parent_pose @ rest_world[b.parent.name].inverted() @ rest_world[bname]
                pb.rotation_quaternion = rel.inverted() @ world[bname]
            else:
                pb.rotation_quaternion = rest_world[bname].inverted() @ world[bname]
                hip = fix_pos(d[joint][0], f)
                # In place: only the height of the hips moves. Measured from the clip's own floor (its lowest ankle; the
                # synthetic T-pose of the conversion is not on the same floor) and put onto the rig's ankle height.
                # The leg root (the hip joints, not the Hips joint above them) over the floor, as on the rig.
                legs_root = (fix_pos(d['LeftUpLeg'][0], f).z + fix_pos(d['RightUpLeg'][0], f).z) / 2
                rig_root = arm_data.bones['thigh.L'].head_local.z
                pb.location = rest_world[bname].inverted() @ Vector((0, 0, (legs_root - floor) - (rig_root - rig_ankle)))
                pb.keyframe_insert('location', frame=i)
            pb.keyframe_insert('rotation_quaternion', frame=i)
    # Metadata: speed of the actor over the clip (m/s, scaled to the rig) and stride for cyclic clips.
    dist = (Vector((p1.x - p0.x, p1.y - p0.y)) * scale).length
    dur = (end - start) / FPS
    info = {'name': name, 'frames': len(frames), 'duration': dur, 'speed': dist / dur if dur else 0.0, 'cycle': dist if cyclic else 0.0, 'mirror': mirror}
    if meta: info.update(meta)
    drop(src)
    return info


def drop(src):
    """Removes an imported BVH armature and its action (it must not end up in the exported model)."""
    action = src.animation_data.action if src.animation_data else None
    bpy.data.objects.remove(src, do_unlink=True)
    if action: bpy.data.actions.remove(action)


def cycle_range(bvh_path, joint='LeftFoot'):
    """One stride cycle (left contact to next left contact) from the middle of a cyclic clip."""
    src = import_bvh(bvh_path)
    act = src.animation_data.action
    f1 = int(act.frame_range[1])
    frames = list(range(2, f1 + 1))
    data = sample(src, frames)
    contacts = foot_contacts(data, frames, joint)
    if len(contacts) < 2:  # a short clip: the other foot may still give a whole cycle
        contacts = foot_contacts(data, frames, 'RightFoot' if joint == 'LeftFoot' else 'LeftFoot')
    drop(src)
    if len(contacts) < 2:
        raise RuntimeError(f'{bvh_path}: no full stride cycle found ({contacts})')
    mid = len(contacts) // 2
    a = contacts[max(0, mid - 1)]
    b = contacts[max(1, mid)]
    return a, b


def kick_peak(bvh_path):
    """Frame of the fastest foot (the strike) and which foot it is."""
    src = import_bvh(bvh_path)
    f1 = int(src.animation_data.action.frame_range[1])
    frames = list(range(2, f1 + 1))
    data = sample(src, frames)
    best = (0.0, 0, 'Right')
    for i in range(1, len(frames)):
        for foot in ('Left', 'Right'):
            v = (data[frames[i]][f'{foot}Foot'][0] - data[frames[i - 1]][f'{foot}Foot'][0]).length * FPS
            if v > best[0]: best = (v, frames[i], foot)
    drop(src)
    return best[1], best[2]


def build_clips(rig, cmu_dir):
    """All clips of the figure; returns their metadata (written next to the model for the game)."""
    # Keys are set per captured frame: the scene runs at the capture rate, so the exported clips have their real timing.
    bpy.context.scene.render.fps = FPS
    bpy.context.scene.render.fps_base = 1
    path = lambda n: os.path.join(cmu_dir, f'{n}.bvh')
    clips = []
    for name, src in (('walk', '07_01'), ('jog', '16_35'), ('run', '09_01'), ('sprint', '16_45')):
        a, b = cycle_range(path(src))
        clips.append(retarget(rig, path(src), name, a, b, meta={'source': f'CMU {src}'}))
    # Standing: the actor of 10_01 waits calmly before his kick (frames 30–270, weight shifting slightly).
    clips.append(retarget(rig, path('10_01'), 'idle', 30, 270, cyclic=False, face_shoulders=True, meta={'source': 'CMU 10_01'}))
    # Strike: from the last step before the kick to the end of the follow-through; the kicking foot is the right one,
    # the mirrored copy is the left-footed strike. `contact` is the strike frame within the clip (s).
    peak, foot = kick_peak(path('10_03'))
    start, end = peak - 36, peak + 30
    for side, mirror in (('R', foot == 'Left'), ('L', foot != 'Left')):
        clips.append(retarget(rig, path('10_03'), f'kick{side}', start, end, mirror=mirror, cyclic=False, strike=(peak, foot),
                              meta={'source': 'CMU 10_03', 'contact': (peak - start) / FPS}))
    return clips
