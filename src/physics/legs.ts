import RAPIER from '@dimforge/rapier3d-simd-compat';
import type { Vec3 } from '../engine/types';
import type { PlayerBody } from './body';
import { BALL_SPEC } from './pitch-geometry';
import { GROUPS } from './groups';

/**
 * Two kinematic boots per player. A boot only moves along a planned, bounded leg swing; Rapier resolves the
 * actual boot/ball contact. If the ball is not where the boot arrives, nothing happens (an air shot).
 *
 * Known approximation: a kinematic boot has unbounded mass, so the ball leaves at ≈ (1 + e)·boot speed
 * (e ≈ 0.45 measured in Rapier) instead of the ≈ 1.2–1.35 of a real foot with finite effective mass.
 */
export const BOOT = { radius: 0.05, halfLength: 0.1, restitution: 0.5, friction: 0.7 } as const;
export const BOOT_RESTITUTION = 0.45;
/** Highest launch angle reachable by striking under the ball centre without the boot entering the turf. */
export const MAX_ELEVATION = 0.45;
/** Fastest boot speed relative to the hip (elite instep kicks ≈ 20–25 m/s). */
export const MAX_BOOT_SPEED = 24;

export type Technique = 'instep' | 'inside' | 'cushion';
export type Side = 0 | 1; // 0 = left, 1 = right

export type StrikeRequest = {
  technique: Technique;
  side: Side;
  /** Unit horizontal direction the ball should leave in (kicks); ignored for cushion. */
  dirX: number;
  dirZ: number;
  elevation: number;
  ballSpeed: number;
};

/** Motor noise of one swing. It shifts the boot path, never the ball. */
export type StrikeError = { lateral: number; vertical: number; angle: number; speed: number; timing: number };
export const NO_ERROR: StrikeError = { lateral: 0, vertical: 0, angle: 0, speed: 1, timing: 0 };

type Phase = 'windup' | 'strike' | 'follow' | 'recover';
export type StrikePlan = {
  technique: Technique;
  side: Side;
  windupEnd: Vec3;
  contact: Vec3;
  strikeEnd: Vec3;
  followEnd: Vec3;
  direction: Vec3;
  windupTime: number;
  strikeSpeed: number;
  followTime: number;
  recoverTime: number;
  axis: Vec3;
};

const TECH = {
  instep: { windup: 0.2, back: 0.5, follow: 0.3, followTime: 0.12, recover: 0.25 },
  inside: { windup: 0.14, back: 0.32, follow: 0.2, followTime: 0.1, recover: 0.2 },
  cushion: { windup: 0.1, back: 0.04, follow: 0.22, followTime: 0.16, recover: 0.2 },
} as const;

type Boot = { body: RAPIER.RigidBody; collider: RAPIER.Collider; rel: Vec3 };

const add = (a: Vec3, b: Vec3, s = 1): Vec3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
const smooth = (t: number) => t * t * (3 - 2 * t);

export class Legs {
  readonly boots: [Boot, Boot];
  readonly hipHeight: number;
  readonly hipOffset = 0.11;
  readonly legLength: number;
  swing: { plan: StrikePlan; phase: Phase; t: number; from: Vec3 } | null = null;

  constructor(world: RAPIER.World, private readonly owner: PlayerBody) {
    this.hipHeight = owner.height * 0.51;
    this.legLength = owner.height * 0.53;
    const make = (side: Side): Boot => {
      const rel = this.rest(side);
      const p = owner.body.translation();
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x + rel.x, rel.y, p.z + rel.z));
      const collider = world.createCollider(
        RAPIER.ColliderDesc.capsule(BOOT.halfLength, BOOT.radius)
          .setRestitution(BOOT.restitution)
          .setFriction(BOOT.friction)
          .setCollisionGroups(GROUPS.boot)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body,
      );
      return { body, collider, rel };
    };
    this.boots = [make(0), make(1)];
  }

  /** Resting boot under its hip, inside the torso footprint. Side 1 (right) is to the right of the facing. */
  rest(side: Side): Vec3 {
    const f = this.owner.facing();
    const s = side === 1 ? 1 : -1;
    return { x: -f.z * s * this.hipOffset, y: BOOT.radius, z: f.x * s * this.hipOffset };
  }

  hip(side: Side): Vec3 {
    const r = this.rest(side);
    return { x: r.x, y: this.hipHeight, z: r.z };
  }

  /** Side whose boot is closer to a world point, judged across the facing direction. */
  sideTowards(x: number, z: number): Side {
    const p = this.owner.body.translation();
    const f = this.owner.facing();
    const right = (x - p.x) * -f.z + (z - p.z) * f.x;
    return right >= 0 ? 1 : 0;
  }

  busy(): boolean {
    return this.swing !== null;
  }

  /**
   * Plans a swing in the frame travelling with the body. Returns null when the leg cannot reach the predicted
   * contact point or the body faces away — the player then has to keep shaping up instead of kicking.
   */
  plan(ball: RAPIER.RigidBody, req: StrikeRequest, err: StrikeError = NO_ERROR): StrikePlan | null {
    const tech = TECH[req.technique];
    const bodyP = this.owner.body.translation(), bodyV = this.owner.body.linvel();
    const ballP = ball.translation(), ballV = ball.linvel();
    
    let direction: Vec3, normal: Vec3, worldBootSpeed: number;
    if (req.technique === 'cushion') {
      const h = Math.hypot(ballV.x, ballV.z);
      if (h < 0.5) return null;
      direction = { x: ballV.x / h, y: 0, z: ballV.z / h };
      normal = { x: -direction.x, y: 0, z: -direction.z };
      // Retreating at e/(1+e) of the ball's pace leaves it nearly dead after the touch.
      worldBootSpeed = (h * BOOT_RESTITUTION) / (1 + BOOT_RESTITUTION);
    } else {
      const a = Math.atan2(req.dirX, req.dirZ) + err.angle;
      const el = Math.min(Math.max(0, req.elevation), MAX_ELEVATION);
      // The boot travels level; lift comes only from striking below the ball centre.
      direction = { x: Math.sin(a), y: 0, z: Math.cos(a) };
      normal = { x: Math.sin(a) * Math.cos(el), y: Math.sin(el), z: Math.cos(a) * Math.cos(el) };
      const incoming = ballV.x * normal.x + ballV.y * normal.y + ballV.z * normal.z;
      worldBootSpeed = (req.ballSpeed * err.speed + BOOT_RESTITUTION * incoming) / ((1 + BOOT_RESTITUTION) * Math.cos(el));
    }
    const bodyAlong = bodyV.x * direction.x + bodyV.z * direction.z;
    const strikeSpeed = Math.min(MAX_BOOT_SPEED, Math.max(0.6, worldBootSpeed - bodyAlong));
    // More pace than a leg can produce is capped: the swing still happens, the ball is simply slower.

    const reach = BOOT.radius + BALL_SPEC.radius;
    const contactTime = tech.windup + tech.back / strikeSpeed + err.timing;
    const relBall: Vec3 = {
      x: ballP.x + ballV.x * contactTime - (bodyP.x + bodyV.x * contactTime),
      y: Math.max(BALL_SPEC.radius, ballP.y + ballV.y * contactTime - 4.9 * contactTime * contactTime * (ballP.y > BALL_SPEC.radius + 0.02 ? 1 : 0)),
      z: ballP.z + ballV.z * contactTime - (bodyP.z + bodyV.z * contactTime),
    };
    const lateral = { x: normal.z, y: 0, z: -normal.x };
    const ln = Math.hypot(lateral.x, lateral.z) || 1;
    let contact = add(relBall, normal, -reach);
    contact = add(contact, { x: lateral.x / ln, y: 0, z: lateral.z / ln }, err.lateral);
    contact.y = Math.max(BOOT.radius * 0.7, contact.y + err.vertical);

    const windupEnd = add(contact, direction, -tech.back);
    const strikeEnd = add(contact, direction, 0.25);
    const followEnd = add(strikeEnd, direction, tech.follow * 0.5);
    followEnd.y += 0.15;

    const hip = this.hip(req.side);
    if (len(sub(contact, hip)) > this.legLength) return null;
    if (len(sub(windupEnd, hip)) > this.legLength * 1.08) return null;
    if (contact.y > this.hipHeight * 0.75) return null; // volleys above waist height are not modelled yet
    const f = this.owner.facing();
    if (contact.x * f.x + contact.z * f.z < -0.1) return null;

    const h = Math.hypot(direction.x, direction.z) || 1;
    const axis = req.technique === 'instep'
      ? { x: direction.x / h, y: 0, z: direction.z / h }
      : { x: direction.z / h, y: 0, z: -direction.x / h };
    return {
      technique: req.technique, side: req.side, windupEnd, contact, strikeEnd, followEnd, direction,
      windupTime: tech.windup + Math.max(0, err.timing), strikeSpeed, followTime: tech.followTime, recoverTime: tech.recover, axis,
    };
  }

  /** Moves both boots to rest under the hips immediately (after the body was placed while the ball was dead). */
  snap(): void {
    this.swing = null;
    const p = this.owner.body.translation();
    for (const side of [0, 1] as const) {
      const boot = this.boots[side];
      boot.rel = this.rest(side);
      boot.body.setTranslation({ x: p.x + boot.rel.x, y: boot.rel.y, z: p.z + boot.rel.z }, true);
    }
  }

  start(plan: StrikePlan): void {
    this.swing = { plan, phase: 'windup', t: 0, from: { ...this.boots[plan.side].rel } };
  }

  /** Boot speed of an active wind-up/strike (0 otherwise); used to size physics substeps. */
  strikeSpeedNow(): number {
    const s = this.swing;
    return s && (s.phase === 'windup' || s.phase === 'strike') ? s.plan.strikeSpeed : 0;
  }

  /** Advances the swing and stages the next kinematic boot poses. Call before every physics (sub)step. */
  update(dt: number): void {
    const swing = this.swing;
    for (const side of [0, 1] as const) {
      if (swing && swing.plan.side === side) continue;
      const boot = this.boots[side];
      boot.rel = this.rest(side);
      this.stage(boot, boot.rel, { ...this.owner.facing(), y: 0 });
    }
    if (!swing) return;
    const { plan } = swing;
    swing.t += dt;
    let rel: Vec3;
    if (swing.phase === 'windup') {
      const k = Math.min(1, swing.t / plan.windupTime);
      rel = lerp(swing.from, plan.windupEnd, smooth(k));
      rel.y += Math.sin(Math.PI * k) * 0.12;
      if (k >= 1) this.next('strike', plan.windupEnd);
    } else if (swing.phase === 'strike') {
      // Constant boot speed through the ball: decelerating in the contact step would hand over only part of it.
      const k = Math.min(1, (swing.t * plan.strikeSpeed) / len(sub(plan.strikeEnd, plan.windupEnd)));
      rel = lerp(plan.windupEnd, plan.strikeEnd, k);
      if (k >= 1) this.next('follow', plan.strikeEnd);
    } else if (swing.phase === 'follow') {
      const k = Math.min(1, swing.t / plan.followTime);
      rel = lerp(plan.strikeEnd, plan.followEnd, 1 - (1 - k) * (1 - k));
      if (k >= 1) this.next('recover', plan.followEnd);
    } else {
      const k = Math.min(1, swing.t / plan.recoverTime);
      rel = lerp(swing.from, this.rest(plan.side), smooth(k));
      if (k >= 1) this.swing = null;
    }
    const boot = this.boots[plan.side];
    boot.rel = rel;
    this.stage(boot, rel, plan.axis);
  }

  bootWorld(side: Side): Vec3 {
    const t = this.boots[side].body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  private next(phase: Phase, from: Vec3): void {
    if (!this.swing) return;
    this.swing.phase = phase;
    this.swing.t = 0;
    this.swing.from = { ...from };
  }

  private stage(boot: Boot, rel: Vec3, axis: Vec3): void {
    const p = this.owner.body.translation();
    boot.body.setNextKinematicTranslation({ x: p.x + rel.x, y: rel.y, z: p.z + rel.z });
    boot.body.setNextKinematicRotation(rotationFromY(axis));
  }
}

/** Quaternion turning the capsule's local Y axis onto `axis`. */
function rotationFromY(axis: Vec3): RAPIER.Rotation {
  const n = Math.hypot(axis.x, axis.y, axis.z) || 1;
  const ax = axis.x / n, ay = axis.y / n, az = axis.z / n;
  const w = 1 + ay;
  if (w < 1e-6) return { x: 1, y: 0, z: 0, w: 0 };
  const m = Math.hypot(az, w, ax);
  return { x: az / m, y: 0, z: -ax / m, w: w / m };
}
