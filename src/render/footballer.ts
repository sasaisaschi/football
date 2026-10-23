import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { PlayerProfile, PlayerView, TeamProfile, Vec3 } from '../engine/types';

/**
 * The footballer figure: a skinned body from Blender's "Human Base Meshes" (Blender Foundation, CC0 1.0), rigged and
 * exported by scripts/figure/build-footballer.py. It plays no canned animation: every frame its skeleton is posed from
 * the physics view – both legs by two-bone IK onto the real boots, keeper and thrower arms onto the real hands, the
 * trunk bent so that forehead or chest are where the physical contact part is. Only the stride of a resting leg, the
 * arm swing, lean and gaze are presentation around that.
 */

/** Height of the model as built (m); each figure is scaled to its player's height. */
const MODEL_HEIGHT = 1.684;
/** Kit colours of a figure, in the order of the material's colour uniform. */
const enum Kit { Skin, Shirt, Sleeve, Shorts, Socks, Boots, Hair, Hands, Eyes }

/**
 * Standard material whose base colour is the kit: the body part comes per vertex from the model (R = (part + 0.5) / 16,
 * scripts/figure/build-footballer.py), and inside a part the shader cuts shirt, shorts, socks and boots at fixed
 * heights of the model in its rest pose, so hems are straight lines whatever the triangles are. The cuts are the same
 * heights at which the build script lets the cloth stand off the skin. Heights in model metres (y up, face towards +z).
 */
function kitMaterial(palette: THREE.Color[]): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0 });
  mat.onBeforeCompile = shader => {
    shader.uniforms.kitColours = { value: palette };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 bodyPart;
flat varying int vPart;
varying vec3 vRest;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vPart = int(bodyPart.r * 16.0);
vRest = position;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 kitColours[9];
flat varying int vPart;
varying vec3 vRest;
int kit() {
  float y = vRest.y;
  if (vPart == 0) return y < 0.99 ? 3 : 1;                 // torso: shorts, shirt
  if (vPart == 1) return y < 1.44 ? 1 : 0;                 // neck: collar, skin
  if (vPart == 2) return (y > 1.615 || (vRest.z < -0.005 && y > 1.5)) ? 6 : 0; // head: hair, face
  if (vPart == 3) return y > 1.215 ? 1 : 2;                // upper arm: sleeve of the shirt, then arm
  if (vPart == 4) return 2;                                // forearm (a keeper's long sleeve)
  if (vPart == 5) return 7;                                // hand (a keeper's glove)
  if (vPart == 6) return y > 0.99 ? 1 : y > 0.70 ? 3 : 0;  // thigh: (hip under the shirt), shorts, knee
  if (vPart == 7) return y < 0.115 ? 5 : y < 0.45 ? 4 : 0; // shin: boot, sock, knee
  if (vPart == 8) return 5;                                // foot: boot
  return 8;                                                // eyes
}`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( kitColours[kit()], opacity );');
  };
  mat.customProgramCacheKey = () => 'footballer-kit';
  return mat;
}
const SKIN = ['#e3b08c', '#c58a62', '#8f5b3c', '#5a3826'];
const HAIR = ['#1c130d', '#3b2a1e', '#0d0d0d', '#6b4a2b', '#a9814c'];
/** Sliding tackle: hip height on the turf and how far the trunk leans back (m, rad). */
const SLIDE_HIP = 0.18, SLIDE_LEAN = 1.05;
const CHEST_FRONT = 0.2, HEADER_LEAN = 0.45, TURN_LEAN = 0.22, KICK_CROUCH = 0.05, NECK_YAW = 1.1;
/** The physics boot is the sole of the foot; the ankle joint sits this far above and behind it (m, model scale). */
const ANKLE_UP = 0.075, ANKLE_BACK = 0.04;

type Model = { scene: THREE.Group; mesh: THREE.SkinnedMesh };
let model: Promise<Model> | null = null;

/** Loads the figure once (public/models/footballer.glb); a failure is an error, there is no stand-in figure. */
export function loadFootballer(url: string): Promise<Model> {
  model ??= new GLTFLoader().loadAsync(url).then(gltf => {
    let mesh: THREE.SkinnedMesh | null = null;
    gltf.scene.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh; });
    if (!mesh) throw new Error(`${url}: no skinned mesh`);
    return { scene: gltf.scene, mesh };
  });
  return model;
}

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
    const speed = Math.hypot(view.velocity.x, view.velocity.z);
    if (this.lastHeading !== null && dt > 0) {
      const turnRate = Math.atan2(Math.sin(view.heading - this.lastHeading), Math.cos(view.heading - this.lastHeading)) / dt;
      const target = Math.max(-TURN_LEAN, Math.min(TURN_LEAN, turnRate * speed * 0.035));
      this.turnLean += (target - this.turnLean) * Math.min(1, dt * 8);
    }
    this.lastHeading = view.heading;
    const kicking = view.swingingBoot !== -1;
    this.root.position.set(view.position.x, Math.max(0, view.position.y - this.profile.heightM / 2), view.position.z);
    this.root.rotation.set(0, view.heading, 0);
    this.root.updateMatrixWorld(true);
    const holder = this.root.children[0];
    this.invFrame.copy(holder.matrixWorld).invert();
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

/** A deep copy of a bone hierarchy (names kept, without the dot that glTF loaders strip). */
function cloneBones(b: THREE.Bone): THREE.Bone {
  const c = b.clone(false) as THREE.Bone;
  c.name = b.name.replace('.', '');
  for (const child of b.children) if ((child as THREE.Bone).isBone) c.add(cloneBones(child as THREE.Bone));
  return c;
}
