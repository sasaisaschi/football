import RAPIER from '@dimforge/rapier3d-simd-compat';
import type { Vec3 } from '../engine/types';
import type { PlayerBody } from './body';
import { BALL_SPEC } from './pitch-geometry';

/**
 * Both hands of the player taking a throw-in (Law 15), as one kinematic body. They move at limited speed to the
 * ball, pick it up with a real joint, hold it behind the head and then bring it forward over the head along the
 * throw: the ball is let go at the release point and leaves with the pace of the hands. Nothing sets the ball's
 * velocity; the joint carries it. The hands have no collider: the ball is never struck, only held and released.
 */
const HANDS_RADIUS = 0.1;
/** Fastest the hands move while picking up and lifting the ball (m/s). */
const CARRY_SPEED = 4;
/** The ball is gripped once the hands are this close to touching it (m). */
const GRIP = 0.03;
/**
 * Hand positions above the head top (m): high enough that the ball, hanging below the hands, clears the torso
 * capsule; the ball is raised in front of the body, then brought back over the head (straight from the turf to
 * behind the head it was jammed between hands and torso and broke loose).
 */
const HOLD_UP = 0.35;
/** In front of the body axis while lifting, and behind it before the throw (m). */
const FRONT = 0.45, WIND_BACK = 0.12;
/** Length of the throwing movement over the head, up to the release (m). */
const THROW_PATH = 0.5;
/** Fastest pace of a throw-in: long throws reach 15–18 m/s (m/s). */
export const MAX_THROW_SPEED = 16;

type Phase = 'idle' | 'reach' | 'lift' | 'raise' | 'held' | 'throw';

export class ThrowHands {
  readonly body: RAPIER.RigidBody;
  private joint: RAPIER.ImpulseJoint | null = null;
  private owner: PlayerBody | null = null;
  private phase: Phase = 'idle';
  /** Hands relative to the thrower's ground point. */
  private rel: Vec3 = { x: 0, y: 0, z: 0 };
  private throwVel: Vec3 = { x: 0, y: 0, z: 0 };
  private released = false;
  /** The infield direction the thrower faces. */
  private infield = { x: 0, z: 1 };

  constructor(private readonly world: RAPIER.World, private readonly ball: RAPIER.RigidBody) {
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -5, 0));
  }

  busy(): boolean {
    return this.phase !== 'idle';
  }

  /** Is the ball held behind the head, ready to be thrown? */
  ready(): boolean {
    return this.phase === 'held';
  }

  thrower(): PlayerBody | null {
    return this.owner;
  }

  /** The thrower starts to take the ball: hands down to it from where his arms hang. */
  begin(owner: PlayerBody, infield: { x: number; z: number }): void {
    this.owner = owner;
    this.infield = infield;
    this.phase = 'reach';
    this.released = false;
    this.rel = { x: infield.x * 0.25, y: owner.height * 0.45, z: infield.z * 0.25 };
    const p = owner.translation();
    this.body.setTranslation({ x: p.x + this.rel.x, y: this.rel.y, z: p.z + this.rel.z }, true);
  }

  /** Throws with the ball leaving at velocity `v`: from behind the head, forward over it, released at its pace. */
  throwBall(v: Vec3): void {
    if (this.phase !== 'held') return;
    this.throwVel = v;
    this.phase = 'throw';
  }

  /** True once, on the step the ball has left the hands. */
  takeRelease(): boolean {
    if (!this.released) return false;
    this.released = false;
    return true;
  }

  /** Lets go of everything (the referee took the ball back, a new restart). */
  reset(): void {
    if (this.joint) { this.world.removeImpulseJoint(this.joint, true); this.joint = null; }
    this.phase = 'idle';
    this.owner = null;
    this.released = false;
    this.body.setTranslation({ x: 0, y: -5, z: 0 }, true);
  }

  /** Hands in the world while they are in use (for the presentation), else null. */
  world3(): Vec3 | null {
    if (this.phase === 'idle') return null;
    const t = this.body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  /** Moves the hands one (sub)step. Call before every physics (sub)step. */
  update(dt: number): void {
    const o = this.owner;
    if (!o || this.phase === 'idle') return;
    const p = o.translation(), v = o.linvel();
    const b = this.ball.translation();
    const behind: Vec3 = { x: -this.infield.x * WIND_BACK, y: o.height + HOLD_UP, z: -this.infield.z * WIND_BACK };
    const above: Vec3 = { x: this.infield.x * FRONT, y: o.height + HOLD_UP, z: this.infield.z * FRONT };
    if (this.phase === 'reach') {
      // Above the ball, coming down onto it.
      const target = { x: b.x - p.x, y: b.y + BALL_SPEC.radius + HANDS_RADIUS, z: b.z - p.z };
      this.moveTowards(target, CARRY_SPEED * dt);
      const h = { x: p.x + this.rel.x, y: this.rel.y, z: p.z + this.rel.z };
      if (Math.hypot(h.x - b.x, h.y - b.y, h.z - b.z) <= BALL_SPEC.radius + HANDS_RADIUS + GRIP) {
        // The ball hangs below the hands: a spherical joint at the point where they hold it.
        const gap = BALL_SPEC.radius + HANDS_RADIUS;
        this.joint = this.world.createImpulseJoint(RAPIER.JointData.spherical({ x: 0, y: -gap, z: 0 }, { x: 0, y: 0, z: 0 }), this.body, this.ball, true);
        this.phase = 'lift';
      }
    } else if (this.phase === 'lift') {
      if (this.moveTowards(above, CARRY_SPEED * dt)) this.phase = 'raise';
    } else if (this.phase === 'raise') {
      if (this.moveTowards(behind, CARRY_SPEED * dt)) this.phase = 'held';
    } else if (this.phase === 'held') {
      this.moveTowards(behind, CARRY_SPEED * dt);
    } else {
      // Forward over the head along the throw, at the throw's pace relative to the ground.
      const speed = Math.hypot(this.throwVel.x, this.throwVel.y, this.throwVel.z) || 1;
      const step = speed * dt;
      const rel = { x: this.throwVel.x / speed, y: this.throwVel.y / speed, z: this.throwVel.z / speed };
      // The body stands still at a throw-in; its own motion is taken out so the hands move at the throw's pace.
      this.rel = { x: this.rel.x + rel.x * step - v.x * dt, y: this.rel.y + rel.y * step, z: this.rel.z + rel.z * step - v.z * dt };
      const travelled = Math.hypot(this.rel.x - behind.x, this.rel.y - behind.y, this.rel.z - behind.z);
      if (travelled >= THROW_PATH && this.joint) {
        this.world.removeImpulseJoint(this.joint, true);
        this.joint = null;
        this.released = true;
        this.phase = 'idle';
        this.owner = null;
      }
    }
    this.body.setNextKinematicTranslation({ x: p.x + this.rel.x, y: this.rel.y, z: p.z + this.rel.z });
  }

  /** Moves the hands towards `target` (relative) by at most `step`; true once there. */
  private moveTowards(target: Vec3, step: number): boolean {
    const d = { x: target.x - this.rel.x, y: target.y - this.rel.y, z: target.z - this.rel.z };
    const n = Math.hypot(d.x, d.y, d.z);
    const k = n > step ? step / n : 1;
    this.rel = { x: this.rel.x + d.x * k, y: this.rel.y + d.y * k, z: this.rel.z + d.z * k };
    return n <= step;
  }
}
