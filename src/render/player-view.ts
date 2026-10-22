import * as THREE from 'three';
import type { PlayerProfile, PlayerView, TeamProfile } from '../engine/types';
import type { Vec3 } from '../engine/types';
import { bodyGeometry, bootGeometry, forearmGeometry, headGeometry, NECK, shinGeometry, thighGeometry, upperArmGeometry, type FigureColours } from './figure-geometry';

/**
 * Footballer figure (procedural geometry, see figure-geometry.ts). Both legs are solved with two-bone IK towards the
 * real physics boots, keeper and thrower arms towards the real hand collider. Only the running cycle of a resting leg is purely visual: the resting boot
 * collider stays under the hip, so the drawn stride never touches anything.
 */
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), knee = new THREE.Vector3();
/** Sliding tackle: hip height on the turf and how far the trunk leans back (m, rad). */
const SLIDE_HIP = 0.18, SLIDE_LEAN = 1.05;
/** The drawn chest's surface in front of the body axis (torso radius, m). */
const CHEST_FRONT = 0.21;
/** Most a header bends the trunk forward; the rest of the reach is neck and a step (rad). Up to 0.8 the players in a duel bowed like a scrum. */
const HEADER_LEAN = 0.45;
const trunk = new THREE.Quaternion(), euler = new THREE.Euler();
/** Most a running turn banks the body; how far the hip drops on the standing leg in a strike; neck turn (rad, m). */
const TURN_LEAN = 0.22, KICK_CROUCH = 0.05, NECK_YAW = 1.1;

type Limb = { upper: THREE.Mesh; lower: THREE.Mesh; end: THREE.Mesh | null; l1: number; l2: number };

/** One material for every figure: colours come from the vertices (kit, trim, skin), so a figure costs few draw calls. */
const SHARED = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68, metalness: 0 });
const SKIN = ['#e6b996', '#c99068', '#93603f', '#5e3c2a'];
const HAIR = ['#1c130d', '#3b2a1e', '#0d0d0d', '#6b4a2b', '#b48a52'];

export class PlayerFigure {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly legs: [Limb, Limb];
  private readonly arms: [Limb, Limb];
  private readonly hip: number;
  private gait = Math.random() * 6;
  private readonly hipOffset = 0.105;
  private readonly head: THREE.Mesh;
  private lastHeading: number | null = null;
  /** Smoothed sideways lean into a turn (rad). */
  private turnLean = 0;

  constructor(readonly profile: PlayerProfile, team: TeamProfile) {
    const h = profile.heightM;
    this.hip = h * 0.51;
    const keeper = profile.role === 'GK';
    const colours: FigureColours = {
      kit: new THREE.Color(keeper ? team.keeperKit : team.kit),
      trim: new THREE.Color(keeper ? '#101418' : team.shorts),
      shorts: new THREE.Color(keeper ? '#101418' : team.shorts),
      socks: new THREE.Color(keeper ? '#101418' : team.kit),
      skin: new THREE.Color(SKIN[profile.id % SKIN.length]),
      hair: new THREE.Color(HAIR[(profile.id * 7) % HAIR.length]),
      boot: new THREE.Color('#15181f'),
      glove: new THREE.Color('#f4f6f2'),
    };
    const mesh = (geo: THREE.BufferGeometry, parent: THREE.Object3D) => {
      const m = new THREE.Mesh(geo, SHARED); m.castShadow = true; parent.add(m); return m;
    };
    mesh(bodyGeometry(h, this.hip, colours, keeper), this.body);
    this.head = mesh(headGeometry(h, colours), this.body);
    this.head.position.y = h * NECK;
    const legLen = h * 0.53;
    const leg = (): Limb => ({
      upper: mesh(thighGeometry(legLen * 0.5, colours), this.root),
      lower: mesh(shinGeometry(legLen * 0.5, colours), this.root),
      end: mesh(bootGeometry(colours), this.root),
      l1: legLen * 0.5, l2: legLen * 0.5,
    });
    this.legs = [leg(), leg()];
    const armLen = h * 0.38;
    const arm = (): Limb => ({
      upper: mesh(upperArmGeometry(armLen * 0.5, colours, keeper), this.root),
      lower: mesh(forearmGeometry(armLen * 0.5, colours, keeper), this.root),
      end: null,
      l1: armLen * 0.5, l2: armLen * 0.5,
    });
    this.arms = [arm(), arm()];
    // Shirt number on the back and, smaller, on the chest.
    const number = document.createElement('canvas');
    number.width = 128; number.height = 128;
    const c = number.getContext('2d')!;
    c.fillStyle = keeper ? '#111' : team.shorts; c.font = '900 96px Bahnschrift, Segoe UI, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(profile.number), 64, 70);
    const tex = new THREE.CanvasTexture(number);
    tex.colorSpace = THREE.SRGBColorSpace;
    const decalMat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24), decalMat);
    back.position.set(0, h * 0.66, -0.152);
    back.rotation.y = Math.PI;
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.09), decalMat);
    front.position.set(0.07, h * 0.71, 0.147);
    this.body.add(back, front);
    this.root.add(this.body);
  }

  /**
   * Pose from an interpolated physics view. `dt` only drives the decorative running cycle; `look` is the ball, which
   * the head follows. Everything that touches the ball (boots, hands, forehead, chest) is placed where physics has it;
   * the rest (stride, arm swing, lean, gaze) is presentation around it.
   */
  update(view: PlayerView, dt: number, look?: Vec3): void {
    this.root.visible = !view.sentOff;
    if (view.sentOff) return;
    const speed = Math.hypot(view.velocity.x, view.velocity.z);
    // Lean into a turn: the faster he runs and turns, the more the body banks towards the inside.
    if (this.lastHeading !== null && dt > 0) {
      const turnRate = Math.atan2(Math.sin(view.heading - this.lastHeading), Math.cos(view.heading - this.lastHeading)) / dt;
      const target = Math.max(-TURN_LEAN, Math.min(TURN_LEAN, turnRate * speed * 0.035));
      this.turnLean += (target - this.turnLean) * Math.min(1, dt * 8);
    }
    this.lastHeading = view.heading;
    const kicking = view.swingingBoot !== -1;
    // The capsule's height above standing is a jump: the whole figure leaves the ground with it.
    this.root.position.set(view.position.x, Math.max(0, view.position.y - this.profile.heightM / 2), view.position.z);
    this.root.rotation.set(0, view.heading, 0);
    // Lean into acceleration and sideways for dives (keeper flying sideways).
    const right = Math.cos(view.heading) * view.velocity.x - Math.sin(view.heading) * view.velocity.z;
    const forward = Math.sin(view.heading) * view.velocity.x + Math.cos(view.heading) * view.velocity.z;
    const dive = this.profile.role === 'GK' && Math.abs(right) > 3.2 ? Math.sign(right) * Math.min(1.2, (Math.abs(right) - 3.2) * 0.9) : 0;
    // Trunk posture: a rotation of the upper body about a pivot. Running lean and a keeper's dive turn about the
    // feet; header, chest control and sliding tackle about the hip, which stays on the legs (in a slide it sinks to
    // the turf). Shoulders and hanging arms turn with the trunk, so the figure stays in one piece.
    let rx = Math.min(0.25, forward * 0.025), rz = -dive + this.turnLean, pivot = 0;
    // Running: the body rises and falls a little with each stride; striking the ball, the standing leg bends.
    const bob = view.lying === 0 && speed > 1 ? Math.abs(Math.cos(this.gait)) * Math.min(0.035, speed * 0.005) : 0;
    const hipY = this.hip - (this.hip - SLIDE_HIP) * view.lying - (kicking ? KICK_CROUCH : 0) + bob;
    if (kicking && !view.upperBody && view.lying === 0) rx = Math.max(rx, 0.12);
    if (view.lying > 0) { rx = -SLIDE_LEAN * view.lying; rz = 0; pivot = this.hip; }
    if (view.upperBody) {
      // Bent so that forehead or chest is where the physical contact part is: towards the forehead for a header;
      // for a chest control only slightly, and backwards as the chest gives with the ball.
      this.root.updateMatrixWorld(true);
      const p = this.root.worldToLocal(tmp.set(view.upperBody.position.x, view.upperBody.position.y, view.upperBody.position.z));
      const up = p.y - this.hip;
      const chest = view.upperBody.part === 'chest';
      rx = chest ? Math.max(-0.35, Math.min(0.15, Math.atan2(p.z - CHEST_FRONT, up))) : Math.max(-0.4, Math.min(HEADER_LEAN, Math.atan2(p.z, up)));
      rz = Math.max(-0.4, Math.min(0.4, -Math.atan2(p.x, up)));
      pivot = this.hip;
    }
    trunk.setFromEuler(euler.set(rx, 0, rz));
    // Offset so that the pivot point (0, pivot, 0) of the trunk ends up at (0, pivot, 0), lowered to hipY in a slide.
    const pivotLocal = tmp.set(0, pivot, 0);
    this.body.quaternion.copy(trunk);
    this.body.position.copy(pivotLocal).sub(pivotLocal.clone().applyQuaternion(trunk));
    this.body.position.y += hipY - this.hip;
    this.gait += dt * (2 + speed * 1.15);
    this.root.updateMatrixWorld(true);
    for (const side of [0, 1] as const) {
      const s = side === 1 ? 1 : -1;
      const hipLocal = tmp.set(-s * this.hipOffset, hipY, 0);
      const foot = tmp2.set(view.boots[side].x, view.boots[side].y, view.boots[side].z);
      this.root.worldToLocal(foot);
      if (view.swingingBoot !== side && speed > 0.4 && view.lying === 0) {
        // Visual stride only: longer and with more knee lift the faster he runs; the trailing heel comes up.
        const phase = this.gait + (side ? Math.PI : 0);
        const stride = Math.min(0.55, speed * 0.07);
        foot.z += Math.sin(phase) * stride;
        foot.y += Math.max(0, Math.cos(phase)) * stride * 0.6 + Math.max(0, -Math.sin(phase)) * stride * 0.25;
      }
      solve(this.legs[side], hipLocal, foot, 1);
    }
    const shoulderY = this.profile.heightM * 0.81 - 0.075;
    for (const side of [0, 1] as const) {
      const s = side === 1 ? 1 : -1;
      const shoulder = tmp.set(-s * 0.215, shoulderY, 0).applyQuaternion(trunk).add(this.body.position);
      let handTarget: THREE.Vector3;
      if (view.hands) {
        handTarget = tmp2.set(view.hands.x, view.hands.y, view.hands.z);
        this.root.worldToLocal(handTarget);
        handTarget.x += -s * 0.08;
      } else if (view.lying > 0) {
        // On the ground in a slide: the arms go back and out for support.
        handTarget = tmp2.set(-s * 0.42, shoulderY - 0.45, -0.25).applyQuaternion(trunk).add(this.body.position);
      } else if (kicking) {
        // Balance in a strike: the arm opposite the kicking leg swings out and forward, the other one out and back.
        const opposite = (view.swingingBoot === 0) === (side === 1);
        handTarget = tmp2.set(-s * 0.5, shoulderY - 0.32, opposite ? 0.22 : -0.15).applyQuaternion(trunk).add(this.body.position);
      } else {
        // Running arms swing against the legs, more and with a bent elbow at speed.
        const swing = Math.sin(this.gait + (side ? 0 : Math.PI)) * Math.min(0.42, speed * 0.06);
        const lift = Math.min(0.18, speed * 0.025) * Math.max(0, Math.sin(this.gait + (side ? 0 : Math.PI)));
        handTarget = tmp2.set(-s * 0.27, shoulderY - 0.62 + lift, swing + 0.05).applyQuaternion(trunk).add(this.body.position);
      }
      solve(this.arms[side], shoulder, handTarget, -1);
    }
    this.lookAt(look);
  }

  /** The head turns (and tilts) towards the ball within what a neck can do; otherwise it looks ahead. */
  private lookAt(look: Vec3 | undefined): void {
    if (!look) { this.head.rotation.set(0, 0, 0); return; }
    this.head.updateMatrixWorld(true);
    const p = this.body.worldToLocal(tmp.set(look.x, look.y, look.z));
    const dx = p.x - this.head.position.x, dy = p.y - this.head.position.y, dz = p.z - this.head.position.z;
    const yaw = Math.max(-NECK_YAW, Math.min(NECK_YAW, Math.atan2(dx, dz)));
    const pitch = Math.max(-0.5, Math.min(0.35, -Math.atan2(dy, Math.hypot(dx, dz)) * 0.7));
    this.head.rotation.set(pitch, yaw, 0, 'YXZ');
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
  if (limb.end) { limb.end.position.copy(end); limb.end.position.y = Math.max(limb.end.position.y, 0.04); limb.end.rotation.set(0, 0, 0); }
}

function place(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
  mesh.position.copy(from);
  const v = to.clone().sub(from).normalize();
  mesh.quaternion.setFromUnitVectors(DOWN, v);
}
