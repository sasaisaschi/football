import RAPIER from '@dimforge/rapier3d-simd-compat';
import type { Vec3 } from '../engine/types';
import type { PlayerBody } from './body';
import { BALL_SPEC } from './pitch-geometry';
import { GROUPS } from './groups';

/**
 * Goalkeeper hands: one kinematic collider for both hands that moves at limited speed inside the arm's reach.
 * A dive is a bounded sideways push of the keeper's body. A catch is a real Rapier joint between hands and
 * ball, created only when the ball arrives slowly enough to be held; otherwise the hands simply parry it.
 */
export const HANDS = { radius: 0.15, maxSpeed: 9, armReach: 0.78, restitution: 0.25, friction: 1 } as const;

/** Dive kinematics: the torso falls sideways about the feet; afterwards the keeper has to get up again. */
const DIVE = { maxTilt: 1.4, fallTime: 0.3, lowestShoulder: 0.3, recover: 1.4 } as const;

export class KeeperHands {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  /** Hands position relative to the keeper's ground point. */
  rel: Vec3;
  target: Vec3;
  private joint: RAPIER.ImpulseJoint | null = null;
  heldSince = 0;
  diveUntil = 0;
  recoverUntil = 0;
  /** Time since the current dive started (−1 when standing) and its horizontal direction. */
  private diveTime = -1;
  private diveDir = { x: 0, z: 0 };

  constructor(private readonly world: RAPIER.World, private readonly keeper: PlayerBody) {
    this.rel = this.restRel();
    this.target = { ...this.rel };
    const p = keeper.translation();
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x + this.rel.x, this.rel.y, p.z + this.rel.z));
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.ball(HANDS.radius)
        .setRestitution(HANDS.restitution)
        .setFriction(HANDS.friction)
        .setCollisionGroups(GROUPS.hands)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    this.collider.setEnabled(false);
  }

  shoulderHeight(): number {
    return this.keeper.height * 0.82;
  }

  /**
   * Shoulder relative to the keeper's ground point. In a dive the body falls sideways about the feet, so the
   * shoulder swings out and down (up to ~80° in 0.3 s) and the arms reach low balls beside him.
   */
  shoulder(): Vec3 {
    const h = this.shoulderHeight();
    if (this.diveTime < 0) return { x: 0, y: h, z: 0 };
    const tilt = Math.min(DIVE.maxTilt, (this.diveTime / DIVE.fallTime) * DIVE.maxTilt);
    const out = h * Math.sin(tilt);
    return { x: this.diveDir.x * out, y: Math.max(DIVE.lowestShoulder, h * Math.cos(tilt)), z: this.diveDir.z * out };
  }

  restRel(): Vec3 {
    const f = this.keeper.facing();
    return { x: f.x * 0.3, y: this.keeper.height * 0.6, z: f.z * 0.3 };
  }

  /** Hands may only be used inside the own penalty area while the ball is in play (Law 12 handling). */
  setActive(active: boolean): void {
    if (this.collider.isEnabled() !== active) this.collider.setEnabled(active);
  }

  active(): boolean {
    return this.collider.isEnabled();
  }

  holding(): boolean {
    return this.joint !== null;
  }

  /** Reach a world point if the arms allow it; the target is clamped to the reach envelope around the shoulders. */
  reachFor(world: Vec3): void {
    const p = this.keeper.translation();
    const rel = { x: world.x - p.x, y: world.y, z: world.z - p.z };
    const shoulder = this.shoulder();
    const dx = rel.x - shoulder.x, dy = rel.y - shoulder.y, dz = rel.z - shoulder.z;
    const d = Math.hypot(dx, dy, dz);
    const k = d > HANDS.armReach + 0.25 ? (HANDS.armReach + 0.25) / d : 1;
    this.target = { x: shoulder.x + dx * k, y: Math.max(HANDS.radius, shoulder.y + dy * k), z: shoulder.z + dz * k };
  }

  /** Can the hands get to a world point from the current posture (without diving)? */
  withinReach(world: Vec3): boolean {
    const p = this.keeper.translation();
    const sh = this.shoulder();
    return Math.hypot(world.x - p.x - sh.x, world.y - sh.y, world.z - p.z - sh.z) <= HANDS.armReach + 0.25 - HANDS.radius;
  }

  /** True once the hands have reached their current target (within `tolerance` metres). */
  arrived(tolerance: number): boolean {
    return Math.hypot(this.target.x - this.rel.x, this.target.y - this.rel.y, this.target.z - this.rel.z) <= tolerance;
  }

  relax(): void {
    this.target = this.restRel();
  }

  /** Fastest sideways push of a dive (m/s) for a keeper of the given power (0…1). */
  static diveSpeed(power: number): number {
    return 3.2 + 2 * power;
  }

  /**
   * A dive: one bounded push sideways (and slightly up), after which the keeper needs time to get up. speed is
   * what the keeper chooses, never more than his power allows.
   */
  dive(towards: { x: number; z: number }, now: number, power: number, speed = KeeperHands.diveSpeed(power)): void {
    const p = this.keeper.translation();
    const dx = towards.x - p.x, dz = towards.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    speed = Math.min(speed, KeeperHands.diveSpeed(power));
    const v = this.keeper.linvel();
    this.keeper.body.setLinvel({ x: v.x * 0.3 + (dx / d) * speed, y: v.y, z: v.z * 0.3 + (dz / d) * speed }, true);
    this.keeper.velocityChanged();
    this.diveUntil = now + 0.55;
    this.recoverUntil = now + DIVE.recover;
    this.diveDir = { x: dx / d, z: dz / d };
    this.diveTime = 0;
  }

  /** Catch: attach the ball to the hands with a spherical joint (the ball can still spin, it cannot leave). */
  catchBall(ball: RAPIER.RigidBody, now: number): void {
    if (this.joint) return;
    const h = this.body.translation(), b = ball.translation();
    const d = Math.hypot(b.x - h.x, b.y - h.y, b.z - h.z) || 1;
    const gap = HANDS.radius + BALL_SPEC.radius;
    const anchor = { x: ((b.x - h.x) / d) * gap, y: ((b.y - h.y) / d) * gap, z: ((b.z - h.z) / d) * gap };
    this.joint = this.world.createImpulseJoint(RAPIER.JointData.spherical(anchor, { x: 0, y: 0, z: 0 }), this.body, ball, true);
    this.heldSince = now;
  }

  release(): void {
    if (!this.joint) return;
    this.world.removeImpulseJoint(this.joint, true);
    this.joint = null;
  }

  /** Puts the hands back in front of the chest immediately (after the keeper was placed). */
  snap(): void {
    this.rel = this.restRel();
    this.target = { ...this.rel };
    const p = this.keeper.translation();
    this.body.setTranslation({ x: p.x + this.rel.x, y: this.rel.y, z: p.z + this.rel.z }, true);
  }

  /** Moves the hands towards their target at limited speed. Call before every physics (sub)step. */
  update(dt: number): void {
    if (this.diveTime >= 0) this.diveTime = this.diveTime + dt < DIVE.recover ? this.diveTime + dt : -1;
    const step = HANDS.maxSpeed * dt;
    const d = { x: this.target.x - this.rel.x, y: this.target.y - this.rel.y, z: this.target.z - this.rel.z };
    const n = Math.hypot(d.x, d.y, d.z);
    const k = n > step ? step / n : 1;
    this.rel = { x: this.rel.x + d.x * k, y: this.rel.y + d.y * k, z: this.rel.z + d.z * k };
    const p = this.keeper.translation();
    this.body.setNextKinematicTranslation({ x: p.x + this.rel.x, y: this.rel.y, z: p.z + this.rel.z });
  }

  world3(): Vec3 {
    const t = this.body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }
}
