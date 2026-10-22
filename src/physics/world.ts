import RAPIER from '@dimforge/rapier3d-simd-compat';
import { applyBallForces, createBall } from './ball';
import { BALL_SPEC } from './pitch-geometry';
import type { Legs } from './legs';
import { createPitchColliders } from './pitch-colliders';

export const PHYSICS_DT = 1 / 60;

/**
 * Counts Rapier steps of every world. A player body's position can only change in a step or by `PlayerBody.place`, so
 * a position read once stays valid until the counter moves on: the brains, legs and parts ask for the same body
 * position dozens of times per (sub)step, and each read crossed into WASM and allocated (≈ 6 % of a tick, profiled).
 */
export const physicsClock = { epoch: 0 };
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
/**
 * The four substeps are needed while the ball skids (spin builds up through the contact) and while it is fast. A ball
 * already rolling cleanly (contact point slipping < 0.1 m/s) below 10 m/s follows the same path with two: measured
 * against four on skidding, rolling, back- and side-spun, lofted and dropped balls from 4 to 32 m/s, the position
 * differed by at most 3.3 cm after 5 s (up to 60 m travelled); two above 10 m/s differed by up to 0.38 m (§10.10).
 */
const ROLLING_SUBSTEPS = 2, ROLLING_SLIP = 0.1, ROLLING_MAX_SPEED = 10;
/**
 * Boots only ever collide with the ball (groups.ts). A player whose body is further from the ball than this at the
 * start of a tick cannot reach it with a boot within the tick (leg ≈ 1.2 m, ball ≤ 40 m/s · 1/60 s ≈ 0.7 m), so his
 * boot colliders leave the broad phase until the ball comes near: no contact can change, the solver has less to do.
 */
const BOOT_REACH = 4;

export type ContactPart = 'boot' | 'head' | 'body' | 'hands';
export type BallContact = { kind: 'ball'; player: number; part: ContactPart };
export type BodyContact = { kind: 'bodies'; a: number; b: number; closingSpeed: number };
export type Contact = BallContact | BodyContact;

type Owner = { player: number; part: ContactPart; body: RAPIER.RigidBody };

/** Hooks a participant into each (sub)step: legs and hands stage their kinematic poses here. */
export type Kinematic = { update(dt: number, lastSubstep: boolean): void; strikeSpeedNow?(): number };

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
  private readonly bootsEnabled: boolean[] = [];
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
    this.bootsEnabled.push(true);
    this.kinematics.push(legs);
    for (const boot of legs.boots) this.registerCollider(boot.collider, player, 'boot');
  }

  registerKinematic(k: Kinematic): void {
    this.kinematics.push(k);
  }

  substepsNeeded(): number {
    let fastest = 0;
    for (const k of this.kinematics) if (k.strikeSpeedNow) fastest = Math.max(fastest, k.strikeSpeedNow());
    const floor = this.ballMovingOnTurf() ? (this.ballRollingSlowly() ? ROLLING_SUBSTEPS : GROUND_SUBSTEPS) : 1;
    return Math.min(MAX_SUBSTEPS, Math.max(floor, Math.ceil((fastest * PHYSICS_DT) / MAX_BOOT_TRAVEL)));
  }

  /** Rolling without slip at the contact point, below ROLLING_MAX_SPEED. */
  private ballRollingSlowly(): boolean {
    const v = this.ball.linvel(), w = this.ball.angvel(), r = BALL_SPEC.radius;
    return Math.hypot(v.x, v.z) < ROLLING_MAX_SPEED && Math.hypot(v.x + w.z * r, v.z - w.x * r) < ROLLING_SLIP;
  }

  /** Ball touching the turf and still moving (skidding or rolling). */
  ballMovingOnTurf(): boolean {
    const p = this.ball.translation();
    if (p.y > BALL_SPEC.radius + 0.03) return false;
    const v = this.ball.linvel();
    return Math.hypot(v.x, v.z) > AT_REST;
  }

  /** Advances one tick. Body impulses must already be applied for this tick. Returns contacts in order. */
  /** Boot colliders on only for players near the ball (see BOOT_REACH); toggled only when that changes. */
  private gateBoots(): void {
    const b = this.ball.translation();
    for (let i = 0; i < this.legs.length; i++) {
      const legs = this.legs[i];
      const p = legs.owner.translation();
      const near = legs.owner.body.isEnabled() && Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z) < BOOT_REACH;
      if (near === this.bootsEnabled[i]) continue;
      this.bootsEnabled[i] = near;
      for (const boot of legs.boots) boot.collider.setEnabled(near);
      legs.collidersOn = near;
    }
  }

  step(): Contact[] {
    applyBallForces(this.ball);
    this.gateBoots();
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
      for (const k of this.kinematics) k.update(dt, i === n - 1);
      this.world.step(this.queue);
      physicsClock.epoch++;
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
