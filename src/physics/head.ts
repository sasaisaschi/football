import RAPIER from '@dimforge/rapier3d-simd-compat';
import type { Vec3 } from '../engine/types';
import type { PlayerBody } from './body';
import { BALL_PHYSICS, airAcceleration } from './ball';
import { BALL_SPEC } from './pitch-geometry';
import { GROUPS } from './groups';

/**
 * Heading. A kinematic sphere for the forehead that exists only during a header: it moves along a planned line
 * through the ball, and Rapier resolves the contact. Like the boots, it can only touch the ball. Outside a header
 * the torso capsule is all there is (a ball dropping on a player who does not head it bounces off him).
 */
export const HEAD = { radius: 0.11, restitution: 0.5 } as const;
/** Effective head/ball restitution (Rapier averages the two coefficients). */
export const HEAD_RESTITUTION = (HEAD.restitution + BALL_PHYSICS.restitution) / 2;
/** Fastest the forehead moves through the ball: neck, trunk and a step into it (m/s). */
export const MAX_HEAD_SPEED = 7;
/** How far the forehead reaches in front of the body axis (lean, m) and how high above standing height (jump, m). */
const LEAN = { min: 0.15, max: 0.6 } as const;
const JUMP = 0.35;
/** The forehead sits this far below the top of the head. */
const FOREHEAD_DROP = 0.12;
/** The forehead moves at its strike velocity for this long before the contact and after it (s). */
const STRIKE_LEAD = 0.06, FOLLOW = 0.06;
/** Fastest the head gives with an arriving ball (m/s). */
const MAX_GIVE = 3;
/** Fastest move of the forehead into its run-up position (m/s). */
const SET_SPEED = 5;
/** The header is re-planned until this long before the strike starts (s). */
const REFINE_LEAD = 0.03;
/** Clearance the ball keeps from the torso at a header (m). */
const TORSO_MARGIN = 0.05;
/** Pace of a ball arriving for a header, counted into the substep budget (m/s). */
const HEADER_BALL_PACE = 20;

export type HeaderPlan = {
  /** World positions of the forehead: start of the run-up, contact, end of the follow-through. */
  start: Vec3; contact: Vec3; end: Vec3;
  /** Time from now to the start of the strike and its speed along the contact normal. */
  strikeAt: number; speed: number; normal: Vec3;
};

export class Head {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private header: { plan: HeaderPlan; t: number; from: Vec3; target: Vec3 } | null = null;

  constructor(world: RAPIER.World, private readonly owner: PlayerBody) {
    const r = this.rest();
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(r.x, r.y, r.z));
    this.collider = world.createCollider(
      // No grip: the header is planned as a contact that changes the ball's velocity only along its normal.
      RAPIER.ColliderDesc.ball(HEAD.radius).setRestitution(HEAD.restitution).setFriction(0).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setCollisionGroups(GROUPS.boot).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    this.collider.setEnabled(false);
  }

  /** Forehead at rest: on the body axis, just below the top of the head. */
  rest(): Vec3 {
    const p = this.owner.body.translation();
    return { x: p.x, y: this.owner.height - FOREHEAD_DROP, z: p.z };
  }

  busy(): boolean {
    return this.header !== null;
  }

  /** Is the body still bound to the run the header was planned for (until the forehead has met the ball)? */
  committed(): boolean {
    const h = this.header;
    return !!h && h.t < h.plan.strikeAt + STRIKE_LEAD + 0.03;
  }

  /**
   * Plans a header that sends the ball off with velocity `target`. The ball is followed on its flight (gravity
   * only, over these fractions of a second) and met at the first moment within `[minT, maxT]` at which it is in
   * reach of the forehead. The contact normal points from the ball's arriving velocity to the wanted one (a
   * contact without grip only changes the velocity along its normal); the forehead's speed along it follows from
   * the restitution. Null when the ball never comes within reach or the header would need more pace than a head has.
   */
  plan(ball: RAPIER.RigidBody, target: Vec3, minT = 0.15, maxT = 0.7): HeaderPlan | null {
    const bp = ball.translation(), bv = ball.linvel();
    const p = this.owner.body.translation(), v = this.owner.body.linvel();
    const g = BALL_PHYSICS.gravity, dt = 1 / 60;
    // The ball's flight with gravity, drag and the lift of its spin, in the world's tick.
    const c = { x: bp.x, y: bp.y, z: bp.z }, V = { x: bv.x, y: bv.y, z: bv.z }, w = ball.angvel();
    for (let t = dt; t <= maxT; t += dt) {
      const a = airAcceleration(V, w);
      V.x += a.x * dt; V.y += (a.y - g) * dt; V.z += a.z * dt;
      c.x += V.x * dt; c.y += V.y * dt; c.z += V.z * dt;
      if (t < minT) continue;
      const dx = target.x - V.x, dy = target.y - V.y, dz = target.z - V.z, dl = Math.hypot(dx, dy, dz);
      if (dl < 0.5) continue;
      const n = { x: dx / dl, y: dy / dl, z: dz / dl };
      const along = (target.x * n.x + target.y * n.y + target.z * n.z + HEAD_RESTITUTION * (V.x * n.x + V.y * n.y + V.z * n.z)) / (1 + HEAD_RESTITUTION);
      // Negative: the head gives with the ball (a ball that would bounce off a still head too fast).
      if (along < -MAX_GIVE || along > MAX_HEAD_SPEED) continue;
      const gap = HEAD.radius + BALL_SPEC.radius;
      const contact = { x: c.x - n.x * gap, y: c.y - n.y * gap, z: c.z - n.z * gap };
      // Reach: in front of the body where it will be then, at head height or up to a jump above it.
      const bx = p.x + v.x * t, bz = p.z + v.z * t;
      const lean = Math.hypot(contact.x - bx, contact.z - bz);
      const standing = this.owner.height - FOREHEAD_DROP;
      if (lean < LEAN.min || lean > LEAN.max || contact.y < standing - 0.25 || contact.y > standing + JUMP) continue;
      // The ball must not graze the torso on its way to the forehead: in front of it, or above the head (a jump).
      if (Math.hypot(c.x - bx, c.z - bz) < this.owner.radius + BALL_SPEC.radius + TORSO_MARGIN && c.y < this.owner.height + BALL_SPEC.radius) continue;
      const lead = along * STRIKE_LEAD;
      const start = { x: contact.x - n.x * lead, y: contact.y - n.y * lead, z: contact.z - n.z * lead };
      const strikeAt = t - STRIKE_LEAD;
      const r = this.rest();
      if (strikeAt <= 0 || Math.hypot(start.x - r.x, start.y - r.y, start.z - r.z) / SET_SPEED > strikeAt) continue;
      const follow = along * FOLLOW;
      return { start, contact, end: { x: contact.x + n.x * follow, y: contact.y + n.y * follow, z: contact.z + n.z * follow }, strikeAt, speed: along, normal: n };
    }
    return null;
  }

  /** Closing speed around the contact (forehead plus ball), so the world splits the tick finely enough. */
  strikeSpeedNow(): number {
    const h = this.header;
    return h && h.t > h.plan.strikeAt - 0.1 ? h.plan.speed + HEADER_BALL_PACE : 0;
  }

  /**
   * Tracks the ball until the strike starts: the header is planned again from the ball's current state, as a
   * player keeps his eyes on it. Small differences over the long look-ahead otherwise put the contact a tick late
   * and on the wrong part of the ball. Keeps the old plan if no new one fits.
   */
  refine(ball: RAPIER.RigidBody, target: Vec3): void {
    const h = this.header;
    if (!h || h.t >= h.plan.strikeAt - REFINE_LEAD) return;
    const plan = this.plan(ball, target, 0, h.plan.strikeAt - h.t + STRIKE_LEAD + 0.15);
    if (!plan) return;
    const now = this.body.translation();
    this.header = { plan, t: 0, from: { x: now.x, y: now.y, z: now.z }, target };
  }

  start(plan: HeaderPlan, target: Vec3): void {
    this.header = { plan, t: 0, from: this.rest(), target };
    this.collider.setEnabled(true);
  }

  /** Stages the forehead's next pose. Call before every physics (sub)step. */
  update(dt: number): void {
    const h = this.header;
    if (!h) { this.stage(this.rest()); return; }
    h.t += dt;
    const { plan } = h;
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

  /** The ball velocity the current header aims for, if any. */
  aim(): Vec3 | null {
    return this.header?.target ?? null;
  }

  /** Cancels a header (the ball was played by someone else, a restart). */
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
