import * as THREE from 'three';
import type { PlayerProfile, PlayerView, TeamProfile, Vec3 } from '../engine/types';
import { cloneBones, HAIR, Kit, kitMaterial, MODEL_HEIGHT, SKIN, type Model } from './footballer-model';
import { Motion } from './footballer-motion';

export { loadFootballer } from './footballer-model';

/**
 * The footballer figure (model: footballer-model.ts). Each frame, in layers:
 *  1. Motion capture (footballer-motion.ts): running and walking at the body's real speed with the stride phase tied
 *     to the distance covered, the strike clip while a boot swings.
 *  2. Contacts from the physics: while a boot swings, both legs are posed by two-bone IK onto the real boots (the
 *     boot decides what the ball does, so the foot is drawn exactly there).
 *  3. Situations the clips do not cover keep the physics-driven pose of before, blended in and out: sliding tackle,
 *     header and chest control (the trunk bent onto the contact part), keeper and thrower hands, a keeper's dive.
 *  4. The head turns towards the ball.
 */

/** Sliding tackle: hip height on the turf and how far the trunk leans back (m, rad). */
const SLIDE_HIP = 0.18, SLIDE_LEAN = 1.05;
const CHEST_FRONT = 0.2, HEADER_LEAN = 0.45, TURN_LEAN = 0.22, KICK_CROUCH = 0.05, NECK_YAW = 1.1;
/** The physics boot is the sole of the foot; the ankle joint sits this far above and behind it (m, model scale). */
const ANKLE_UP = 0.075, ANKLE_BACK = 0.04;

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), knee = new THREE.Vector3(), dir = new THREE.Vector3();
const q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), euler = new THREE.Euler();
const Y = new THREE.Vector3(0, 1, 0);

type Chain = { upper: THREE.Bone; lower: THREE.Bone; end: THREE.Bone; l1: number; l2: number };

export class Footballer {
  readonly root = new THREE.Group();
  private readonly skeleton: THREE.Skeleton;
  private readonly bones: Record<string, THREE.Bone> = {};
  /** Rest orientation of every bone in the figure's frame, and its rest direction (head → tail). */
  private readonly rest = new Map<THREE.Bone, { world: THREE.Quaternion; local: THREE.Quaternion; dir: THREE.Vector3 }>();
  private readonly legs: [Chain, Chain];
  private readonly arms: [Chain, Chain];
  private readonly scale: number;
  private readonly hip: number;
  private readonly pelvisRest: THREE.Vector3;
  private gait = Math.random() * 6;
  private readonly motion: Motion;
  /** Bones in parent-before-child order, and a scratch copy of their pose for blending layers. */
  private readonly list: THREE.Bone[];
  private readonly saved: THREE.Quaternion[];
  private readonly savedPelvis = new THREE.Vector3();
  /** Weight of the physics-driven pose of special situations (slide, header, hands, dive), smoothed. */
  private special = 0;
  private lastHeading: number | null = null;
  private turnLean = 0;

  constructor(readonly profile: PlayerProfile, team: TeamProfile, m: Model) {
    const keeper = profile.role === 'GK';
    this.scale = profile.heightM / MODEL_HEIGHT;
    const src = m.mesh;
    // The geometry is shared; the kit colours are this figure's (uniforms of its material).
    const geo = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'skinIndex', 'skinWeight']) geo.setAttribute(name, src.geometry.getAttribute(name));
    geo.setAttribute('bodyPart', src.geometry.getAttribute('color'));
    geo.setIndex(src.geometry.getIndex());
    const kit = new THREE.Color(keeper ? team.keeperKit : team.kit);
    const dark = new THREE.Color('#101418');
    const skin = new THREE.Color(SKIN[profile.id % SKIN.length]);
    const palette: THREE.Color[] = [];
    palette[Kit.Skin] = skin;
    palette[Kit.Shirt] = kit;
    palette[Kit.Sleeve] = keeper ? kit : skin;
    palette[Kit.Shorts] = keeper ? dark : new THREE.Color(team.shorts);
    palette[Kit.Socks] = keeper ? dark : kit;
    palette[Kit.Boots] = new THREE.Color('#15181f');
    palette[Kit.Hair] = new THREE.Color(HAIR[(profile.id * 7) % HAIR.length]);
    palette[Kit.Hands] = keeper ? new THREE.Color('#f1f4ee') : skin;
    palette[Kit.Eyes] = new THREE.Color('#2a2420');
    // Bones: a fresh copy of the skeleton for this figure.
    // Every root of the skeleton (the pelvis, and the exporter's neutral bone for unweighted vertices).
    const roots = src.skeleton.bones.filter(b => !(b.parent as THREE.Bone | null)?.isBone).map(cloneBones);
    const list: THREE.Bone[] = [];
    for (const rootBone of roots) rootBone.traverse(o => { if ((o as THREE.Bone).isBone) { list.push(o as THREE.Bone); this.bones[o.name] = o as THREE.Bone; } });
    this.list = list;
    this.saved = list.map(() => new THREE.Quaternion());
    const ordered = src.skeleton.bones.map(b => this.bones[b.name.replace('.', '')]);
    this.skeleton = new THREE.Skeleton(ordered, src.skeleton.boneInverses.map(m => m.clone()));
    const mat = kitMaterial(palette);
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    const holder = new THREE.Group();
    holder.scale.setScalar(this.scale);
    holder.add(...roots, mesh);
    mesh.bind(this.skeleton, new THREE.Matrix4());
    this.root.add(holder);
    this.addNumbers(profile, team, keeper);
    // Rest pose in the figure's frame (holder space, model metres).
    holder.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(holder.matrixWorld).invert();
    for (const b of list) {
      const mw = new THREE.Matrix4().multiplyMatrices(inv, b.matrixWorld);
      const world = new THREE.Quaternion().setFromRotationMatrix(mw);
      this.rest.set(b, { world, local: b.quaternion.clone(), dir: Y.clone().applyQuaternion(world) });
    }
    const len = (a: string, b: string) => this.bones[a].getWorldPosition(new THREE.Vector3()).distanceTo(this.bones[b].getWorldPosition(new THREE.Vector3())) / this.scale;
    const chain = (u: string, l: string, e: string): Chain => ({ upper: this.bones[u], lower: this.bones[l], end: this.bones[e], l1: len(u, l) * this.scale, l2: len(l, e) * this.scale });
    // Side 0 is the +x side of the figure frame (as the physics boots are ordered), the model's ".L".
    this.legs = [chain('thighL', 'shinL', 'footL'), chain('thighR', 'shinR', 'footR')];
    this.arms = [chain('upperarmL', 'forearmL', 'handL'), chain('upperarmR', 'forearmR', 'handR')];
    this.pelvisRest = this.bones.pelvis.position.clone();
    this.hip = this.bones.thighL.getWorldPosition(new THREE.Vector3()).y - this.root.position.y;
    this.motion = new Motion(holder, m.clips);
  }

  /** Shirt numbers on back and chest, attached to the chest bone so they bend with the trunk. */
  private addNumbers(p: PlayerProfile, team: TeamProfile, keeper: boolean): void {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const c = canvas.getContext('2d')!;
    c.fillStyle = keeper ? '#111' : team.shorts;
    c.font = '900 96px Bahnschrift, Segoe UI, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(p.number), 64, 70);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4 });
    const chest = this.bones.chest;
    // In the chest bone's frame: +Y up the spine; the model faces +Z after export.
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), mat);
    back.position.set(0, 0.03, -0.125);
    back.rotation.y = Math.PI;
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.08), mat);
    front.position.set(-0.07, 0.08, 0.118);
    chest.add(back, front);
  }

  /** Bone so that its head → tail points along `to − from` (figure frame), with the least turn from its rest pose. */
  private aim(bone: THREE.Bone, to: THREE.Vector3, from: THREE.Vector3): void {
    const r = this.rest.get(bone)!;
    dir.copy(to).sub(from).normalize();
    q.setFromUnitVectors(r.dir, dir).multiply(r.world); // wanted orientation in the figure frame
    this.setWorld(bone, q);
  }

  /** Sets a bone's orientation in the figure frame. */
  private setWorld(bone: THREE.Bone, want: THREE.Quaternion): void {
    const parent = bone.parent as THREE.Object3D;
    parent.updateMatrixWorld(true);
    q2.setFromRotationMatrix(new THREE.Matrix4().multiplyMatrices(this.invFrame, parent.matrixWorld)).invert();
    bone.quaternion.copy(q2).multiply(want);
    bone.updateMatrixWorld(true);
  }

  private invFrame = new THREE.Matrix4();

  /** A joint's position in the figure frame (metres of the model, unscaled). */
  private at(bone: THREE.Bone, out: THREE.Vector3): THREE.Vector3 {
    return bone.getWorldPosition(out).applyMatrix4(this.invFrame);
  }

  update(view: PlayerView, dt: number, look?: Vec3): void {
    this.root.visible = !view.sentOff;
    if (view.sentOff) return;
    this.root.position.set(view.position.x, Math.max(0, view.position.y - this.profile.heightM / 2), view.position.z);
    this.root.rotation.set(0, view.heading, 0);
    this.root.updateMatrixWorld(true);
    this.invFrame.copy(this.root.children[0].matrixWorld).invert();
    const right = Math.cos(view.heading) * view.velocity.x - Math.sin(view.heading) * view.velocity.z;
    const forward = Math.sin(view.heading) * view.velocity.x + Math.cos(view.heading) * view.velocity.z;
    // 1. Motion capture.
    this.motion.update(forward, right, view.swingingBoot, dt);
    this.leanIntoTurn(view, dt);
    // 3. Situations the clips do not cover: the physics-driven pose, blended.
    const dive = this.profile.role === 'GK' && Math.abs(right) > 3.2;
    const wantSpecial = view.lying > 0 || view.upperBody !== null || view.hands !== null || dive ? 1 : 0;
    this.special += (wantSpecial - this.special) * Math.min(1, dt * 10);
    if (this.special > 0.01) {
      this.save();
      this.procedural(view, dt, look);
      this.blendFromSaved(this.special, () => true);
    }
    // 2. Contacts: while a boot swings, both legs onto the physics boots.
    const strike = this.motion.strikeWeight * (1 - this.special);
    if (strike > 0.01) {
      this.save();
      this.legsOnBoots(view);
      this.blendFromSaved(strike, b => b.name.startsWith('thigh') || b.name.startsWith('shin') || b.name.startsWith('foot'));
    }
    // 4. Gaze.
    if (this.special < 0.99) this.turnHead(look);
  }

  /** Copies the current pose (all bone rotations, pelvis position). */
  private save(): void {
    this.list.forEach((b, i) => this.saved[i].copy(b.quaternion));
    this.savedPelvis.copy(this.bones.pelvis.position);
  }

  /** The pose now is a layer over the saved one: blends the chosen bones from saved to now by `w`, restores the rest. */
  private blendFromSaved(w: number, which: (b: THREE.Bone) => boolean): void {
    this.list.forEach((b, i) => { if (which(b)) b.quaternion.copy(this.saved[i].clone().slerp(b.quaternion, w)); else b.quaternion.copy(this.saved[i]); });
    this.bones.pelvis.position.lerpVectors(this.savedPelvis, this.bones.pelvis.position, which(this.bones.pelvis) ? w : 0);
    this.root.updateMatrixWorld(true);
  }

  /** Banks the body into a turn: the faster he runs and turns, the more the pelvis tilts towards the inside. */
  private leanIntoTurn(view: PlayerView, dt: number): void {
    const speed = Math.hypot(view.velocity.x, view.velocity.z);
    if (this.lastHeading !== null && dt > 0) {
      const turnRate = Math.atan2(Math.sin(view.heading - this.lastHeading), Math.cos(view.heading - this.lastHeading)) / dt;
      const target = Math.max(-TURN_LEAN, Math.min(TURN_LEAN, turnRate * speed * 0.035));
      this.turnLean += (target - this.turnLean) * Math.min(1, dt * 8);
    }
    this.lastHeading = view.heading;
    if (Math.abs(this.turnLean) < 1e-3) return;
    const pelvis = this.bones.pelvis;
    this.root.updateMatrixWorld(true);
    const now = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().multiplyMatrices(this.invFrame, pelvis.matrixWorld));
    this.setWorld(pelvis, q.setFromEuler(euler.set(0, 0, this.turnLean)).multiply(now));
  }

  /** Both legs by two-bone IK onto the physics boots, from where the hips are now; feet level. */
  private legsOnBoots(view: PlayerView): void {
    const s = this.scale;
    this.root.updateMatrixWorld(true);
    this.legs.forEach((leg, side) => {
      const hip = this.at(leg.upper, tmp.set(0, 0, 0)).clone();
      const foot = tmp2.set(view.boots[side].x, view.boots[side].y, view.boots[side].z).applyMatrix4(this.invFrame);
      foot.y += ANKLE_UP / s; foot.z -= ANKLE_BACK / s;
      this.solve(leg, hip, foot, 1);
      this.setWorld(leg.end, this.rest.get(leg.end)!.world);
    });
  }

  /**
   * The physics-driven pose of Phase E, now for the situations the clips do not cover: legs by IK onto the boots (with a
   * drawn stride for a resting leg), trunk bent onto the contact part, arms onto the physics hands.
   */
  private procedural(view: PlayerView, dt: number, look?: Vec3): void {
    const speed = Math.hypot(view.velocity.x, view.velocity.z);
    const kicking = view.swingingBoot !== -1;
    const s = this.scale;
    const right = Math.cos(view.heading) * view.velocity.x - Math.sin(view.heading) * view.velocity.z;
    const forward = Math.sin(view.heading) * view.velocity.x + Math.cos(view.heading) * view.velocity.z;
    const dive = this.profile.role === 'GK' && Math.abs(right) > 3.2 ? Math.sign(right) * Math.min(1.2, (Math.abs(right) - 3.2) * 0.9) : 0;
    let rx = Math.min(0.25, forward * 0.025), rz = -dive + this.turnLean;
    const bob = view.lying === 0 && speed > 1 ? Math.abs(Math.cos(this.gait)) * Math.min(0.035, speed * 0.005) : 0;
    const hipY = this.hip - (this.hip - SLIDE_HIP) * view.lying - (kicking ? KICK_CROUCH : 0) + bob; // metres, figure frame
    if (kicking && !view.upperBody && view.lying === 0) rx = Math.max(rx, 0.12);
    if (view.lying > 0) { rx = -SLIDE_LEAN * view.lying; rz = 0; }
    if (view.upperBody) {
      // Bent so that forehead or chest is where the physical contact part is.
      const p = tmp.set(view.upperBody.position.x, view.upperBody.position.y, view.upperBody.position.z).applyMatrix4(this.invFrame).multiplyScalar(s);
      const up = p.y - this.hip;
      const chest = view.upperBody.part === 'chest';
      rx = chest ? Math.max(-0.35, Math.min(0.15, Math.atan2(p.z - CHEST_FRONT, up))) : Math.max(-0.4, Math.min(HEADER_LEAN, Math.atan2(p.z, up)));
      rz = Math.max(-0.4, Math.min(0.4, -Math.atan2(p.x, up)));
    }
    // Pelvis: lowered with the hips, the trunk turned about it.
    const pelvis = this.bones.pelvis;
    pelvis.position.copy(this.pelvisRest);
    pelvis.position.y += (hipY - this.hip) / s;
    this.setWorld(pelvis, q.setFromEuler(euler.set(rx, 0, rz)).multiply(this.rest.get(pelvis)!.world));
    for (const b of ['spine', 'chest', 'neck', 'head']) this.bones[b].quaternion.copy(this.rest.get(this.bones[b])!.local);
    this.gait += dt * (2 + speed * 1.15);
    // Legs: two-bone IK from the hip joints onto the physics boots.
    this.legs.forEach((leg, side) => {
      const hip = this.at(leg.upper, tmp.set(0, 0, 0)).clone();
      const foot = tmp2.set(view.boots[side].x, view.boots[side].y, view.boots[side].z).applyMatrix4(this.invFrame);
      foot.y += ANKLE_UP / s; foot.z -= ANKLE_BACK / s;
      if (view.swingingBoot !== side && speed > 0.4 && view.lying === 0) {
        const phase = this.gait + (side ? Math.PI : 0);
        const stride = Math.min(0.55, speed * 0.07) / s;
        foot.z += Math.sin(phase) * stride;
        foot.y += (Math.max(0, Math.cos(phase)) * stride * 0.6 + Math.max(0, -Math.sin(phase)) * stride * 0.25);
      }
      this.solve(leg, hip, foot, 1);
      // The foot stays level with the ground, pointing where the body faces (the rest pose of the foot).
      this.setWorld(leg.end, this.rest.get(leg.end)!.world);
    });
    // Arms.
    this.bones.chest.updateMatrixWorld(true);
    const trunk = new THREE.Quaternion().setFromEuler(euler.set(rx, 0, rz));
    this.arms.forEach((arm, side) => {
      const sx = side === 0 ? 1 : -1;
      const shoulder = this.at(arm.upper, tmp.set(0, 0, 0)).clone();
      let hand: THREE.Vector3;
      if (view.hands) hand = tmp2.set(view.hands.x, view.hands.y, view.hands.z).applyMatrix4(this.invFrame).add(new THREE.Vector3(sx * 0.08 / s, 0, 0));
      else if (view.lying > 0) hand = shoulder.clone().add(new THREE.Vector3(sx * 0.25, -0.45, -0.25).applyQuaternion(trunk).divideScalar(s));
      else if (kicking) {
        const opposite = (view.swingingBoot === 0) === (side === 1);
        hand = shoulder.clone().add(new THREE.Vector3(sx * 0.3, -0.32, opposite ? 0.22 : -0.15).applyQuaternion(trunk).divideScalar(s));
      } else {
        const swing = Math.sin(this.gait + (side ? Math.PI : 0)) * Math.min(0.42, speed * 0.06);
        const lift = Math.min(0.18, speed * 0.025) * Math.max(0, Math.sin(this.gait + (side ? Math.PI : 0)));
        hand = shoulder.clone().add(new THREE.Vector3(sx * 0.07, -0.55 + lift, swing + 0.05).applyQuaternion(trunk).divideScalar(s));
      }
      this.solve(arm, shoulder, hand, -1);
    });
    this.lookAt(look);
  }

  /** The head turns towards the ball on top of the clip's head movement, within what a neck can do. */
  private turnHead(look: Vec3 | undefined): void {
    if (!look) return;
    const head = this.bones.head;
    head.updateMatrixWorld(true);
    const p = head.worldToLocal(tmp.set(look.x, look.y, look.z));
    const yaw = Math.max(-NECK_YAW, Math.min(NECK_YAW, Math.atan2(p.x, p.z))) * 0.6;
    head.quaternion.multiply(q.setFromEuler(euler.set(0, yaw, 0, 'YXZ')));
  }

  /** Two-bone IK in the figure frame; `bend` +1 puts the knee forward, −1 the elbow back. */
  private solve(c: Chain, start: THREE.Vector3, target: THREE.Vector3, bend: 1 | -1): void {
    const s = this.scale, l1 = c.l1 / s, l2 = c.l2 / s;
    const d = target.clone().sub(start);
    const dist = Math.min(d.length(), l1 + l2 - 1e-3);
    const n = d.normalize();
    const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const fwd = new THREE.Vector3(0, 0, bend);
    const perp = fwd.sub(n.clone().multiplyScalar(fwd.dot(n))).normalize();
    if (perp.lengthSq() < 1e-6) perp.set(0, 1, 0);
    knee.copy(start).addScaledVector(n, a).addScaledVector(perp, h);
    const end = start.clone().addScaledVector(n, dist);
    this.aim(c.upper, knee, start);
    this.aim(c.lower, end, this.at(c.lower, tmp.set(0, 0, 0)).clone());
  }

  /** The head turns towards the ball within what a neck can do. */
  private lookAt(look: Vec3 | undefined): void {
    const head = this.bones.head;
    head.quaternion.copy(this.rest.get(head)!.local);
    if (!look) return;
    head.updateMatrixWorld(true);
    const p = head.worldToLocal(tmp.set(look.x, look.y, look.z));
    const yaw = Math.max(-NECK_YAW, Math.min(NECK_YAW, Math.atan2(p.x, p.z)));
    const pitch = Math.max(-0.5, Math.min(0.35, -Math.atan2(p.y, Math.hypot(p.x, p.z)) * 0.5));
    head.quaternion.multiply(q.setFromEuler(euler.set(pitch, yaw, 0, 'YXZ')));
  }

  dispose(): void {
    (this.root.children[0].children.find(o => (o as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh | undefined)?.geometry.dispose();
  }
}
