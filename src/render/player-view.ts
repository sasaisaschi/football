import * as THREE from 'three';
import type { PlayerProfile, PlayerView, TeamProfile } from '../engine/types';

/**
 * Stylised footballer. Both legs are solved with two-bone IK towards the real physics boots, keeper arms
 * towards the real hand collider. Only the running cycle of a resting leg is purely visual: the resting boot
 * collider stays under the hip, so the drawn stride never touches anything.
 */
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), knee = new THREE.Vector3();
/** Sliding tackle: hip height on the turf and how far the trunk leans back (m, rad). */
const SLIDE_HIP = 0.18, SLIDE_LEAN = 1.05;

type Limb = { upper: THREE.Mesh; lower: THREE.Mesh; end: THREE.Mesh | null; l1: number; l2: number };

export class PlayerFigure {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly legs: [Limb, Limb];
  private readonly arms: [Limb, Limb];
  private readonly hip: number;
  private gait = Math.random() * 6;
  private readonly hipOffset = 0.11;

  constructor(readonly profile: PlayerProfile, team: TeamProfile) {
    const h = profile.heightM;
    this.hip = h * 0.51;
    const keeper = profile.role === 'GK';
    const kit = new THREE.MeshStandardMaterial({ color: keeper ? team.keeperKit : team.kit, roughness: 0.7 });
    const shorts = new THREE.MeshStandardMaterial({ color: team.shorts, roughness: 0.8 });
    const tone = ['#e2b48f', '#c48b63', '#8d5a3c', '#5b3a29'][profile.id % 4];
    const skin = new THREE.MeshStandardMaterial({ color: tone, roughness: 0.75 });
    const socks = new THREE.MeshStandardMaterial({ color: keeper ? '#202020' : team.kit, roughness: 0.8 });
    const boots = new THREE.MeshStandardMaterial({ color: '#111318', roughness: 0.4 });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D) => {
      const m = new THREE.Mesh(geo, mat); m.castShadow = true; parent.add(m); return m;
    };
    const torso = add(new THREE.CylinderGeometry(0.21, 0.16, h * 0.3, 10), kit, this.body);
    torso.position.y = h * 0.66;
    const hipsMesh = add(new THREE.CylinderGeometry(0.17, 0.18, h * 0.1, 10), shorts, this.body);
    hipsMesh.position.y = this.hip + h * 0.02;
    const neck = add(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 8), skin, this.body);
    neck.position.y = h * 0.83;
    const head = add(new THREE.SphereGeometry(0.11, 14, 12), skin, this.body);
    head.position.y = h * 0.9;
    const hair = add(new THREE.SphereGeometry(0.115, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), new THREE.MeshStandardMaterial({ color: ['#1c130d', '#3b2a1e', '#0d0d0d', '#6b4a2b'][profile.id % 4] }), this.body);
    hair.position.y = h * 0.905;
    const legLen = h * 0.53;
    const makeLimb = (l1: number, l2: number, r1: number, r2: number, m1: THREE.Material, m2: THREE.Material, end: THREE.Mesh | null): Limb => {
      const upper = add(new THREE.CylinderGeometry(r1, r1 * 0.85, l1, 8).translate(0, -l1 / 2, 0), m1, this.root);
      const lower = add(new THREE.CylinderGeometry(r2, r2 * 0.8, l2, 8).translate(0, -l2 / 2, 0), m2, this.root);
      if (end) this.root.add(end);
      return { upper, lower, end, l1, l2 };
    };
    const boot = () => { const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.26), boots); b.castShadow = true; return b; };
    this.legs = [makeLimb(legLen * 0.5, legLen * 0.5, 0.075, 0.055, skin, socks, boot()), makeLimb(legLen * 0.5, legLen * 0.5, 0.075, 0.055, skin, socks, boot())];
    const armLen = h * 0.38;
    const glove = keeper ? new THREE.MeshStandardMaterial({ color: '#f2f2f2' }) : skin;
    const hand = () => { const m = new THREE.Mesh(new THREE.SphereGeometry(keeper ? 0.065 : 0.045, 8, 6), glove); m.castShadow = true; return m; };
    this.arms = [makeLimb(armLen * 0.5, armLen * 0.5, 0.05, 0.04, kit, keeper ? kit : skin, hand()), makeLimb(armLen * 0.5, armLen * 0.5, 0.05, 0.04, kit, keeper ? kit : skin, hand())];
    const number = document.createElement('canvas');
    number.width = 128; number.height = 128;
    const c = number.getContext('2d')!;
    c.fillStyle = keeper ? '#111' : team.shorts; c.font = '900 92px Bahnschrift, Segoe UI, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(profile.number), 64, 70);
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(number), transparent: true, depthWrite: false }));
    decal.position.set(0, h * 0.68, -0.205);
    decal.rotation.y = Math.PI;
    this.body.add(decal);
    this.root.add(this.body);
  }

  /** Pose from an interpolated physics view. `dt` only drives the decorative running cycle. */
  update(view: PlayerView, dt: number): void {
    this.root.visible = !view.sentOff;
    if (view.sentOff) return;
    const speed = Math.hypot(view.velocity.x, view.velocity.z);
    // The capsule's height above standing is a jump: the whole figure leaves the ground with it.
    this.root.position.set(view.position.x, Math.max(0, view.position.y - this.profile.heightM / 2), view.position.z);
    this.root.rotation.set(0, view.heading, 0);
    // Lean into acceleration and sideways for dives (keeper flying sideways).
    const right = Math.cos(view.heading) * view.velocity.x - Math.sin(view.heading) * view.velocity.z;
    const forward = Math.sin(view.heading) * view.velocity.x + Math.cos(view.heading) * view.velocity.z;
    const dive = this.profile.role === 'GK' && Math.abs(right) > 3.2 ? Math.sign(right) * Math.min(1.2, (Math.abs(right) - 3.2) * 0.9) : 0;
    this.body.rotation.set(Math.min(0.25, forward * 0.025), 0, -dive);
    // Sliding tackle: the trunk leans back about the hip, which sinks towards the turf; the legs follow the boots.
    const hipY = this.hip - (this.hip - SLIDE_HIP) * view.lying;
    if (view.lying > 0) {
      const a = SLIDE_LEAN * view.lying;
      this.body.rotation.set(-a, 0, 0);
      this.body.position.set(0, hipY - this.hip * Math.cos(a), this.hip * Math.sin(a));
    } else this.body.position.set(0, 0, 0);
    if (view.upperBody) {
      // Header or chest control: the trunk bends so that forehead or chest is where the physical contact part is.
      this.root.updateMatrixWorld(true);
      const p = this.root.worldToLocal(tmp.set(view.upperBody.position.x, view.upperBody.position.y, view.upperBody.position.z));
      this.body.rotation.set(Math.max(-0.6, Math.min(0.9, Math.atan2(p.z, p.y))), 0, Math.max(-0.5, Math.min(0.5, -Math.atan2(p.x, p.y))));
    }
    this.gait += dt * (2 + speed * 1.15);
    this.root.updateMatrixWorld(true);
    for (const side of [0, 1] as const) {
      const s = side === 1 ? 1 : -1;
      const hipLocal = tmp.set(-s * this.hipOffset, hipY, 0);
      const foot = tmp2.set(view.boots[side].x, view.boots[side].y, view.boots[side].z);
      this.root.worldToLocal(foot);
      if (view.swingingBoot !== side && speed > 0.4 && view.lying === 0) {
        // Visual stride only.
        const phase = this.gait + (side ? Math.PI : 0);
        const stride = Math.min(0.45, speed * 0.06);
        foot.z += Math.sin(phase) * stride;
        foot.y += Math.max(0, Math.cos(phase)) * stride * 0.5;
      }
      solve(this.legs[side], hipLocal, foot, 1);
    }
    const shoulderY = this.profile.heightM * 0.79;
    for (const side of [0, 1] as const) {
      const s = side === 1 ? 1 : -1;
      const shoulder = tmp.set(-s * 0.24, shoulderY, 0);
      let handTarget: THREE.Vector3;
      if (view.hands) {
        handTarget = tmp2.set(view.hands.x, view.hands.y, view.hands.z);
        this.root.worldToLocal(handTarget);
        handTarget.x += -s * 0.08;
      } else {
        const swing = Math.sin(this.gait + (side ? 0 : Math.PI)) * Math.min(0.35, speed * 0.05);
        handTarget = tmp2.set(-s * 0.32, shoulderY - 0.62, swing + 0.05);
      }
      solve(this.arms[side], shoulder, handTarget, -1);
    }
  }
}

/** Two-bone IK in the figure's local frame. `bend` +1 puts the knee forward, −1 the elbow backward. */
function solve(limb: Limb, start: THREE.Vector3, target: THREE.Vector3, bend: 1 | -1): void {
  const s = start.clone();
  const d = target.clone().sub(s);
  const dist = Math.min(d.length(), limb.l1 + limb.l2 - 1e-3);
  const dir = d.normalize();
  const a = (limb.l1 * limb.l1 - limb.l2 * limb.l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, limb.l1 * limb.l1 - a * a));
  // Bend direction: perpendicular to the limb in the plane containing the figure's forward axis.
  const forward = new THREE.Vector3(0, 0, bend);
  const perp = forward.sub(dir.clone().multiplyScalar(forward.dot(dir))).normalize();
  if (perp.lengthSq() < 1e-6) perp.copy(UP);
  knee.copy(s).addScaledVector(dir, a).addScaledVector(perp, h);
  place(limb.upper, s, knee);
  const end = s.clone().addScaledVector(dir, dist);
  place(limb.lower, knee, end);
  if (limb.end) { limb.end.position.copy(end); limb.end.position.y = Math.max(limb.end.position.y, 0.035); limb.end.rotation.set(0, 0, 0); }
}

function place(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
  mesh.position.copy(from);
  const v = to.clone().sub(from).normalize();
  mesh.quaternion.setFromUnitVectors(DOWN, v);
}
