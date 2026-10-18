import RAPIER from '@dimforge/rapier3d-simd-compat';
import { applyBallForces, createBall } from './ball';
import { BALL_SPEC } from './pitch-geometry';
import type { Legs } from './legs';
import { createPitchColliders } from './pitch-colliders';

export const PHYSICS_DT = 1 / 60;
/** Largest boot travel per (sub)step. Rapier's CCD does not sweep kinematic bodies, so fast strikes need substeps. */
const MAX_BOOT_TRAVEL = 0.06;
const MAX_SUBSTEPS = 8;
/**
 * Rapier's friction contact lets a sphere gain at most ≈ 0.74 rad of spin per step, so at 60 Hz a struck ball
 * could never spin up to rolling above ≈ 5 m/s and skidded far too long. Four substeps (240 Hz) give the
 * textbook transition to rolling at 5/7 of the launch pace, and the rolling deceleration also depends on the step
 * size. They are needed while the ball moves on the turf; in flight or at rest one step per tick is enough.
 */
const GROUND_SUBSTEPS = 4;
/** Ball speed (m/s) below which a ball on the turf is treated as at rest. */
const AT_REST = 0.2;

export type ContactPart = 'boot' | 'head' | 'body' | 'hands';
export type BallContact = { kind: 'ball'; player: number; part: ContactPart };
export type BodyContact = { kind: 'bodies'; a: number; b: number; closingSpeed: number };
export type Contact = BallContact | BodyContact;

type Owner = { player: number; part: ContactPart; body: RAPIER.RigidBody };

/** Hooks a participant into each (sub)step: legs and hands stage their kinematic poses here. */
export type Kinematic = { update(dt: number): void; strikeSpeedNow?(): number };

/**
 * The only Rapier world of a match. Fixed 1/60 s ticks (four substeps while the ball skids on the turf); while any boot is in a fast wind-up or strike the
 * tick is split into substeps so the boot moves at most 6 cm per substep.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly ball: RAPIER.RigidBody;
  readonly ballHandle: number;
  private readonly owners = new Map<number, Owner>();
  private readonly kinematics: Kinematic[] = [];
  private readonly legs: Legs[] = [];
  private readonly queue = new RAPIER.EventQueue(true);
  /** Body velocities at the start of the tick, so contact closing speeds are measured before the impact. */
  private readonly preVelocity = new Map<number, { x: number; z: number }>();

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = PHYSICS_DT;
    createPitchColliders(this.world);
    this.ball = createBall(this.world);
    this.ballHandle = this.ball.collider(0).handle;
  }

  registerCollider(collider: RAPIER.Collider, player: number, part: ContactPart): void {
    this.owners.set(collider.handle, { player, part, body: collider.parent()! });
  }

  registerLegs(legs: Legs, player: number): void {
    this.legs.push(legs);
    this.kinematics.push(legs);
    for (const boot of legs.boots) this.registerCollider(boot.collider, player, 'boot');
  }

  registerKinematic(k: Kinematic): void {
    this.kinematics.push(k);
  }

  substepsNeeded(): number {
    let fastest = 0;
    for (const k of this.kinematics) if (k.strikeSpeedNow) fastest = Math.max(fastest, k.strikeSpeedNow());
    const floor = this.ballMovingOnTurf() ? GROUND_SUBSTEPS : 1;
    return Math.min(MAX_SUBSTEPS, Math.max(floor, Math.ceil((fastest * PHYSICS_DT) / MAX_BOOT_TRAVEL)));
  }

  /** Ball touching the turf and still moving (skidding or rolling). */
  ballMovingOnTurf(): boolean {
    const p = this.ball.translation();
    if (p.y > BALL_SPEC.radius + 0.03) return false;
    const v = this.ball.linvel();
    return Math.hypot(v.x, v.z) > AT_REST;
  }

  /** Advances one tick. Body impulses must already be applied for this tick. Returns contacts in order. */
  step(): Contact[] {
    applyBallForces(this.ball);
    for (const o of this.owners.values()) {
      if (o.part !== 'body') continue;
      const v = o.body.linvel();
      this.preVelocity.set(o.player, { x: v.x, z: v.z });
    }
    const n = this.substepsNeeded();
    const dt = PHYSICS_DT / n;
    this.world.timestep = dt;
    const contacts: Contact[] = [];
    for (let i = 0; i < n; i++) {
      for (const k of this.kinematics) k.update(dt);
      this.world.step(this.queue);
      this.queue.drainCollisionEvents((h1, h2, started) => {
        if (!started) return;
        const c = this.classify(h1, h2);
        if (c) contacts.push(c);
      });
    }
    this.world.timestep = PHYSICS_DT;
    return contacts;
  }

  private classify(h1: number, h2: number): Contact | null {
    if (h1 === this.ballHandle || h2 === this.ballHandle) {
      const owner = this.owners.get(h1 === this.ballHandle ? h2 : h1);
      return owner ? { kind: 'ball', player: owner.player, part: owner.part } : null;
    }
    const a = this.owners.get(h1), b = this.owners.get(h2);
    if (!a || !b || a.part !== 'body' || b.part !== 'body') return null;
    const pa = a.body.translation(), pb = b.body.translation();
    const va = this.preVelocity.get(a.player) ?? a.body.linvel();
    const vb = this.preVelocity.get(b.player) ?? b.body.linvel();
    const dx = pb.x - pa.x, dz = pb.z - pa.z;
    const d = Math.hypot(dx, dz) || 1;
    const closingSpeed = ((va.x - vb.x) * dx + (va.z - vb.z) * dz) / d;
    return { kind: 'bodies', a: a.player, b: b.player, closingSpeed };
  }
}
