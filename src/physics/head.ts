import RAPIER from '@dimforge/rapier3d-simd-compat';
import type { Vec3 } from '../engine/types';
import type { PlayerBody } from './body';
import { BALL_PHYSICS, airAcceleration } from './ball';
import { BALL_SPEC } from './pitch-geometry';
import { GROUPS } from './groups';

/**
 * A planned contact of the upper body with a ball in the air: the forehead for a header, the chest for a chest
 * control. A kinematic sphere that exists only during the action moves along a planned line through the ball, and
 * Rapier resolves the contact. Like the boots, it can only touch the ball. Outside these actions the torso capsule
 * is all there is (a ball dropping on a player who does not play it bounces off him).
 */
export type PartSpec = {
  radius: number;
  restitution: number;
  /** Height of the part's centre on a standing player (m). */
  rest: (height: number) => number;
  /** How far the contact may lie below / above the standing height: crouching, and for a header a jump (m). */
  below: number;
  above: number;
  /** Forward reach in front of the body axis (lean, m). */
  lean: { min: number; max: number };
  /** Fastest the part moves into the ball, and fastest it gives with an arriving ball (m/s). */
  maxSpeed: number;
  maxGive: number;
  /** May the player jump to reach the contact? The body then really leaves the ground. */
  jump: boolean;
};

/** Forehead: just below the top of the head; neck, trunk and a step into the ball; a jump of up to 35 cm. */
export const HEAD_PART: PartSpec = {
  radius: 0.11, restitution: 0.5, rest: h => h - 0.12, below: 0.25, above: 0.35, lean: { min: 0.15, max: 0.6 }, maxSpeed: 7, maxGive: 3, jump: true,
};
/**
 * Chest: pushed out in front of the torso, it gives with the ball so that it drops at the feet. The chest yields
 * more than a head (lower restitution) and can give faster, but pushes the ball on only gently.
 */
export const CHEST_PART: PartSpec = {
  radius: 0.15, restitution: 0.3, rest: h => h * 0.72, below: 0.25, above: 0.1, lean: { min: 0.2, max: 0.4 }, maxSpeed: 3, maxGive: 7, jump: false,
};
/** The part moves at its strike velocity for this long before the contact and after it (s). */
const STRIKE_LEAD = 0.06, FOLLOW = 0.06;
/** Fastest move of the part into its run-up position (m/s). */
const SET_SPEED = 5;
/** The contact is re-planned until this long before the strike starts (s). */
const REFINE_LEAD = 0.03;
/** Clearance the ball keeps from the torso on its way to the part (m). */
const TORSO_MARGIN = 0.05;
/** Pace of a ball arriving for a header or chest control, counted into the substep budget (m/s). */
const ARRIVING_BALL_PACE = 20;
/** Below this rise a contact is reached by stretching, not by a jump (m). */
const MIN_JUMP = 0.03;

export type HeaderPlan = {
  /** World positions of the part: start of the run-up, contact, end of the follow-through. */
  start: Vec3; contact: Vec3; end: Vec3;
  /** Time from now to the start of the strike and its speed along the contact normal. */
  strikeAt: number; speed: number; normal: Vec3;
  /** Height the body has to jump to at the contact (0: no jump), and the time from now to the contact. */
  rise: number; contactAt: number;
};

export class Head {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private readonly e: number;
  private header: { plan: HeaderPlan; t: number; from: Vec3; target: Vec3; jumped: boolean } | null = null;

  constructor(world: RAPIER.World, private readonly owner: PlayerBody, readonly spec: PartSpec = HEAD_PART) {
    this.e = (spec.restitution + BALL_PHYSICS.restitution) / 2;
    const r = this.rest();
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(r.x, r.y, r.z));
    this.collider = world.createCollider(
      // No grip: the contact is planned to change the ball's velocity only along its normal.
      RAPIER.ColliderDesc.ball(spec.radius).setRestitution(spec.restitution).setFriction(0).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setCollisionGroups(GROUPS.boot).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    this.collider.setEnabled(false);
  }

  /** How high the body is off the ground (a jump), m. */
  private lift(): number {
    return Math.max(0, this.owner.translation().y - this.owner.height / 2);
  }

  /** The part at rest: on the body axis at its height, carried up when the body is in the air. */
  rest(): Vec3 {
    const p = this.owner.translation();
    return { x: p.x, y: this.spec.rest(this.owner.height) + this.lift(), z: p.z };
  }

  busy(): boolean {
    return this.header !== null;
  }

  /** Is the body still bound to the run the contact was planned for (until the part has met the ball)? */
  committed(): boolean {
    const h = this.header;
    return !!h && h.t < h.plan.strikeAt + STRIKE_LEAD + 0.03;
  }

  /**
   * Plans a contact that sends the ball off with velocity `target`. The ball is followed on its flight (gravity,
   * drag and the lift of its spin) and met at the first moment within `[minT, maxT]` at which it is in reach of the
   * part. The contact normal points from the ball's arriving velocity to the wanted one (a contact without grip only
   * changes the velocity along its normal); the part's speed along it follows from the restitution, negative when it
   * gives. A contact above standing height needs a jump that takes off in time. Null when the ball never comes within
   * reach or the contact needs more pace than the part has.
   */
  plan(ball: RAPIER.RigidBody, target: Vec3, minT = 0.15, maxT = 0.7): HeaderPlan | null {
    const s = this.spec;
    const bp = ball.translation(), bv = ball.linvel();
    const p = this.owner.translation(), v = this.owner.linvel();
    const g = BALL_PHYSICS.gravity, dt = 1 / 60;
    const c = { x: bp.x, y: bp.y, z: bp.z }, V = { x: bv.x, y: bv.y, z: bv.z }, w = ball.angvel();
    const standing = s.rest(this.owner.height);
    for (let t = dt; t <= maxT; t += dt) {
      const a = airAcceleration(V, w);
      V.x += a.x * dt; V.y += (a.y - g) * dt; V.z += a.z * dt;
      c.x += V.x * dt; c.y += V.y * dt; c.z += V.z * dt;
      if (t < minT) continue;
      const dx = target.x - V.x, dy = target.y - V.y, dz = target.z - V.z, dl = Math.hypot(dx, dy, dz);
      if (dl < 0.5) continue;
      const n = { x: dx / dl, y: dy / dl, z: dz / dl };
      const along = (target.x * n.x + target.y * n.y + target.z * n.z + this.e * (V.x * n.x + V.y * n.y + V.z * n.z)) / (1 + this.e);
      if (along < -s.maxGive || along > s.maxSpeed) continue;
      const gap = s.radius + BALL_SPEC.radius;
      const contact = { x: c.x - n.x * gap, y: c.y - n.y * gap, z: c.z - n.z * gap };
      // Reach: in front of the body where it will be then, from a crouch up to a stretch or a jump.
      const bx = p.x + v.x * t, bz = p.z + v.z * t;
      const lean = Math.hypot(contact.x - bx, contact.z - bz);
      if (lean < s.lean.min || lean > s.lean.max || contact.y < standing - s.below || contact.y > standing + s.above) continue;
      const rise = s.jump && contact.y > standing + MIN_JUMP ? contact.y - standing : 0;
      if (!s.jump && contact.y > standing + MIN_JUMP && contact.y > standing + s.above) continue;
      // A jump must take off in time: the body reaches its highest point at the contact.
      if (rise > 0 && t < Math.sqrt((2 * rise) / g) + 0.05) continue;
      // The ball must not graze the torso on its way: in front of it, or above the (jumping) head.
      if (Math.hypot(c.x - bx, c.z - bz) < this.owner.radius + BALL_SPEC.radius + TORSO_MARGIN && c.y < this.owner.height + rise + BALL_SPEC.radius) continue;
      const lead = along * STRIKE_LEAD;
      const start = { x: contact.x - n.x * lead, y: contact.y - n.y * lead, z: contact.z - n.z * lead };
      const strikeAt = t - STRIKE_LEAD;
      const r = this.rest();
      if (strikeAt <= 0 || Math.hypot(start.x - r.x, start.y - r.y, start.z - r.z) / SET_SPEED > strikeAt) continue;
      const follow = along * FOLLOW;
      return { start, contact, end: { x: contact.x + n.x * follow, y: contact.y + n.y * follow, z: contact.z + n.z * follow }, strikeAt, speed: along, normal: n, rise, contactAt: t };
    }
    return null;
  }

  /** Closing speed around the contact (part plus ball), so the world splits the tick finely enough. */
  strikeSpeedNow(): number {
    const h = this.header;
    return h && h.t > h.plan.strikeAt - 0.1 ? Math.abs(h.plan.speed) + ARRIVING_BALL_PACE : 0;
  }

  /**
   * Tracks the ball until the strike starts: the contact is planned again from the ball's current state, as a
   * player keeps his eyes on it. Small differences over the long look-ahead otherwise put the contact a tick late
   * and on the wrong part of the ball. Keeps the old plan if no new one fits, and once the player has jumped (his
   * flight can no longer change).
   */
  refine(ball: RAPIER.RigidBody, target: Vec3): void {
    const h = this.header;
    if (!h || h.jumped || h.t >= h.plan.strikeAt - REFINE_LEAD) return;
    const plan = this.plan(ball, target, 0, h.plan.strikeAt - h.t + STRIKE_LEAD + 0.15);
    if (!plan) return;
    const now = this.body.translation();
    this.header = { plan, t: 0, from: { x: now.x, y: now.y, z: now.z }, target, jumped: false };
  }

  start(plan: HeaderPlan, target: Vec3): void {
    this.header = { plan, t: 0, from: this.rest(), target, jumped: false };
    this.collider.setEnabled(true);
  }

  /** Stages the part's next pose, and takes off for a jump in time. Call before every physics (sub)step. */
  update(dt: number): void {
    const h = this.header;
    if (!h) { this.stage(this.rest()); return; }
    h.t += dt;
    const { plan } = h;
    if (plan.rise > 0 && !h.jumped) {
      // Take-off so that the highest point of the jump comes at the contact: v₀ = √(2·g·rise), up for v₀/g.
      const v0 = Math.sqrt(2 * BALL_PHYSICS.gravity * plan.rise);
      if (h.t >= plan.contactAt - v0 / BALL_PHYSICS.gravity) {
        const v = this.owner.linvel();
        this.owner.body.setLinvel({ x: v.x, y: v0, z: v.z }, true);
        this.owner.velocityChanged();
        h.jumped = true;
      }
    }
    let pos: Vec3;
    if (h.t < plan.strikeAt) {
      const k = Math.min(1, h.t / plan.strikeAt);
      pos = { x: h.from.x + (plan.start.x - h.from.x) * k, y: h.from.y + (plan.start.y - h.from.y) * k, z: h.from.z + (plan.start.z - h.from.z) * k };
    } else {
      const dt2 = h.t - plan.strikeAt;
      if (dt2 > STRIKE_LEAD + FOLLOW) { this.header = null; this.collider.setEnabled(false); this.stage(this.rest()); return; }
      const s = dt2 * plan.speed;
      pos = { x: plan.start.x + plan.normal.x * s, y: plan.start.y + plan.normal.y * s, z: plan.start.z + plan.normal.z * s };
    }
    this.stage(pos);
  }

  /** The ball velocity the current action aims for, if any. */
  aim(): Vec3 | null {
    return this.header?.target ?? null;
  }

  /** World position of the part while it is in action (for the presentation), else null. */
  active(): Vec3 | null {
    if (!this.header) return null;
    const t = this.body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  /** Cancels the action (the ball was played by someone else, a restart). */
  reset(): void {
    this.header = null;
    this.collider.setEnabled(false);
    const r = this.rest();
    this.body.setTranslation(r, true);
  }

  private stage(p: Vec3): void {
    this.body.setNextKinematicTranslation(p);
  }
}
