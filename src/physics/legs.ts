import RAPIER from '@dimforge/rapier3d-simd-compat';
import type { Vec3 } from '../engine/types';
import type { PlayerBody } from './body';
import { BALL_SPEC } from './pitch-geometry';
import { GROUPS } from './groups';
import { BALL_PHYSICS } from './ball';

/**
 * Two kinematic boots per player. A boot only moves along a planned, bounded leg swing; Rapier resolves the
 * actual boot/ball contact. If the ball is not where the boot arrives, nothing happens (an air shot).
 *
 * Known approximation: a kinematic boot has unbounded mass, so the ball leaves at ≈ (1 + e)·boot speed
 * (e = 0.575, Rapier's average of boot and ball restitution) instead of the ≈ 1.2–1.35 of a real foot with finite effective mass.
 */
export const BOOT = { radius: 0.05, halfLength: 0.1, restitution: 0.5, friction: 0.7 } as const;
/** Effective boot/ball restitution: Rapier averages the two coefficients (0.5 and the ball's 0.65). */
export const BOOT_RESTITUTION = (BOOT.restitution + BALL_PHYSICS.restitution) / 2;
/** Share of the ball's slip across the boot that the contact removes (measured in Rapier: ≈ 0.55–0.85, pace-dependent). */
export const BOOT_GRIP = 0.7;
/** Highest launch angle reachable by striking under the ball centre without the boot entering the turf. */
export const MAX_ELEVATION = 0.45;
/** Fastest boot speed relative to the hip (elite instep kicks ≈ 20–25 m/s). */
export const MAX_BOOT_SPEED = 24;
/**
 * The standing knee flexes during a kick and lowers the hip by about 10 cm. Without it a 0.53·h leg under a
 * 0.51·h hip reaches only ≈ 0.5 m forward at ball height, a band of ≈ 10 cm beyond the body clearance.
 */
export const KICK_HIP_DROP = 0.1;
/** How far the boot gives with the ball after a cushioning contact (m). */
const CUSHION_GIVE = 0.08;
/** Boot travel past the planned contact point after which the swing no longer needs the planned body pace (m). */
const CONTACT_MARGIN = 0.1;

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
  cushion: { windup: 0.1, back: 0.04, follow: 0.12, followTime: 0.08, recover: 0.12 },
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

  /** Hip joint while kicking: the standing knee flexes, so the hip sits KICK_HIP_DROP below its standing height. */
  hip(side: Side): Vec3 {
    const r = this.rest(side);
    return { x: r.x, y: this.hipHeight - KICK_HIP_DROP, z: r.z };
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
   * Is the body still bound to the run the swing was planned for? Only until the boot has passed the contact
   * point: the plan assumes the body's pace up to the contact, afterwards the player steers freely again while the
   * leg swings through and recovers (no new swing until it has).
   */
  committed(): boolean {
    const s = this.swing;
    if (!s) return false;
    if (s.phase === 'windup') return true;
    return s.phase === 'strike' && s.t * s.plan.strikeSpeed < len(sub(s.plan.contact, s.plan.windupEnd)) + CONTACT_MARGIN;
  }

  /**
   * Plans a swing in the frame travelling with the body. Returns null when the leg cannot reach the predicted
   * contact point or the body faces away — the player then has to keep shaping up instead of kicking.
   */
  plan(ball: RAPIER.RigidBody, req: StrikeRequest, err: StrikeError = NO_ERROR): StrikePlan | null {
    const tech = TECH[req.technique];
    const bodyP = this.owner.body.translation(), bodyV = this.owner.body.linvel();
    const ballP = ball.translation(), ballV = ball.linvel();
    
    // Ball velocity the boot will meet (gravity acts on a ball in the air during the wind-up).
    const airborne = ballP.y > BALL_SPEC.radius + 0.02;
    const meetV = (t: number): Vec3 => ({ x: ballV.x, y: ballV.y - (airborne ? BALL_PHYSICS.gravity * t : 0), z: ballV.z });
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
      // A contact pushes along its normal; across it the ball keeps its own motion except for what the grip of
      // the boot takes off. So the player meets a moving ball off-line (the intuitive "aim off"): the normal is
      // chosen so that impulse plus the remaining cross motion add up to the wanted velocity.
      const v = meetV(tech.windup + tech.back / 10);
      const s = req.ballSpeed * err.speed;
      let target = { x: Math.sin(a) * Math.cos(el) * s, y: Math.sin(el) * s, z: Math.cos(a) * Math.cos(el) * s };
      if (el === 0 && !airborne) {
        const rolled = rolledLaunch(ball.angvel(), { x: Math.sin(a), z: Math.cos(a) }, s);
        if (!rolled) return null;
        target = { x: rolled.x, y: 0, z: rolled.z };
      }
      let n = { x: target.x - v.x, y: target.y - v.y, z: target.z - v.z };
      for (let i = 0; i < 4; i++) {
        const nl = Math.hypot(n.x, n.y, n.z) || 1;
        const along = (v.x * n.x + v.y * n.y + v.z * n.z) / nl;
        const keep = 1 - BOOT_GRIP;
        n = {
          x: target.x - keep * (v.x - (along * n.x) / nl),
          y: target.y - keep * (v.y - (along * n.y) / nl),
          z: target.z - keep * (v.z - (along * n.z) / nl),
        };
      }
      const wh = Math.hypot(n.x, n.z);
      if (wh < 0.3) return null;
      // Lift comes only from striking below the ball centre, so the normal's elevation is bounded.
      const nel = Math.min(MAX_ELEVATION, Math.max(0, Math.atan2(n.y, wh)));
      direction = { x: n.x / wh, y: 0, z: n.z / wh };
      normal = { x: direction.x * Math.cos(nel), y: Math.sin(nel), z: direction.z * Math.cos(nel) };
      const incoming = v.x * normal.x + v.y * normal.y + v.z * normal.z;
      const impulse = target.x * normal.x + target.y * normal.y + target.z * normal.z - incoming;
      // The boot travels level: its normal speed is the horizontal speed times cos(elevation).
      worldBootSpeed = (impulse / (1 + BOOT_RESTITUTION) + incoming) / Math.cos(nel);
    }
    // In the body's frame the boot has to supply what the running body does not already carry. A cushion
    // simply gives with the ball along its line.
    const swingX = direction.x * worldBootSpeed - bodyV.x, swingZ = direction.z * worldBootSpeed - bodyV.z;
    const cushion = req.technique === 'cushion';
    const swingLen = cushion ? swingX * direction.x + swingZ * direction.z : Math.hypot(swingX, swingZ);
    if (!cushion && (swingLen < 0.3 || swingX * direction.x + swingZ * direction.z <= 0)) return null;
    const path: Vec3 = cushion ? direction : { x: swingX / swingLen, y: 0, z: swingZ / swingLen };
    // The boot meets the ball along its velocity relative to the ball; it is held along that line so the
    // striking surface, not the side of the boot, arrives first.
    const mx = direction.x * worldBootSpeed - ballV.x, mz = direction.z * worldBootSpeed - ballV.z, ml = Math.hypot(mx, mz);
    const meet: Vec3 = cushion || ml < 0.3 ? direction : { x: mx / ml, y: 0, z: mz / ml };
    // More pace than a leg can produce is capped: the swing still happens, the ball is simply slower.
    const strikeSpeed = Math.min(MAX_BOOT_SPEED, Math.max(0.6, swingLen));

    const reach = BOOT.radius + BALL_SPEC.radius;
    const contactTime = tech.windup + tech.back / strikeSpeed + err.timing;
    const relBall: Vec3 = {
      x: ballP.x + ballV.x * contactTime - (bodyP.x + bodyV.x * contactTime),
      y: Math.max(BALL_SPEC.radius, ballP.y + ballV.y * contactTime - 4.9 * contactTime * contactTime * (ballP.y > BALL_SPEC.radius + 0.02 ? 1 : 0)),
      z: ballP.z + ballV.z * contactTime - (bodyP.z + bodyV.z * contactTime),
    };
    const lateral = { x: normal.z, y: 0, z: -normal.x };
    const ln = Math.hypot(lateral.x, lateral.z) || 1;
    // An instep strikes with the front of the boot, which leads the capsule centre by its half length.
    let contact = add(relBall, normal, -reach);
    if (req.technique === 'instep') contact = add(contact, meet, -BOOT.halfLength);
    contact = add(contact, { x: lateral.x / ln, y: 0, z: lateral.z / ln }, err.lateral);
    contact.y = Math.max(BOOT.radius * 0.7, contact.y + err.vertical);

    const windupEnd = add(contact, path, -tech.back);
    // A cushion gives with the ball only briefly: the boot need not travel on a quarter of a metre at walking pace
    // (that kept a receiver from playing the dead ball for half a second).
    const strikeEnd = add(contact, path, req.technique === 'cushion' ? CUSHION_GIVE : 0.25);
    const followEnd = add(strikeEnd, path, tech.follow * 0.5);
    followEnd.y += 0.15;

    // The own body must not run into the ball before the boot gets there (it would deflect it first).
    const rx = ballP.x - bodyP.x, rz = ballP.z - bodyP.z;
    const vx = ballV.x - bodyV.x, vz = ballV.z - bodyV.z;
    const tMin = Math.max(0, Math.min(contactTime, -(rx * vx + rz * vz) / (vx * vx + vz * vz || 1)));
    // Margin covers the rolling deceleration (≈ 0.7 m/s²) the straight-line estimate ignores.
    // Near the turf the capsule's rounded bottom leaves a little more room than its full radius.
    const touching = this.owner.radius + BALL_SPEC.radius, below = Math.max(0, this.owner.radius - ballP.y);
    const margin = 0.03 + 0.35 * contactTime * contactTime;
    if (Math.hypot(rx + vx * tMin, rz + vz * tMin) < Math.sqrt(touching * touching - below * below) + margin) return null;

    const hip = this.hip(req.side);
    if (len(sub(contact, hip)) > this.legLength) return null;
    if (len(sub(windupEnd, hip)) > this.legLength * 1.08) return null;
    if (contact.y > this.hipHeight * 0.75) return null; // volleys above waist height are not modelled yet
    const f = this.owner.facing();
    if (contact.x * f.x + contact.z * f.z < -0.1) return null;

    const axis = req.technique === 'instep' ? meet : { x: direction.z, y: 0, z: -direction.x };
    return {
      technique: req.technique, side: req.side, windupEnd, contact, strikeEnd, followEnd, direction: path,
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

/**
 * A struck ground ball keeps its spin; turf friction then pulls it towards the line the spin rolls along
 * until it rolls again: final = launch − 2/7·(launch − w), with w = r·(−ω_z, ω_x) the spin's rolling pace.
 * The launch velocity of pace `speed` whose rolling direction ends up along `dir`; null if the spin is too
 * strong to be turned that far with this pace.
 */
export function rolledLaunch(spin: Vec3, dir: { x: number; z: number }, speed: number): { x: number; z: number } | null {
  const wx = -spin.z * BALL_SPEC.radius, wz = spin.x * BALL_SPEC.radius;
  const dw = dir.x * wx + dir.z * wz;
  // |7k·dir − 2w| = 5·speed, solved for the larger k (rolling on along dir).
  const disc = 784 * dw * dw - 196 * (4 * (wx * wx + wz * wz) - 25 * speed * speed);
  if (disc < 0) return null;
  const k = (28 * dw + Math.sqrt(disc)) / 98;
  if (k <= 0) return null;
  return { x: (7 * k * dir.x - 2 * wx) / 5, z: (7 * k * dir.z - 2 * wz) / 5 };
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
