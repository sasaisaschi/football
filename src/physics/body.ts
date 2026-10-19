import RAPIER from '@dimforge/rapier3d-simd-compat';
import type { PlayerProfile, Vec2 } from '../engine/types';
import { GROUPS } from './groups';

/**
 * Locomotion limits derived from abilities. Ranges follow published elite tracking data:
 * top speed 8.0–9.9 m/s, initial acceleration 5.5–8 m/s², braking up to ~8 m/s².
 */
export type MotorLimits = {
  maxSpeed: number;
  accel0: number;
  maxBrake: number;
  maxLateral: number;
  turnRate: number;
};

export function motorLimits(p: PlayerProfile): MotorLimits {
  const a = p.abilities;
  const keeper = p.role === 'GK';
  return {
    maxSpeed: (keeper ? 7.2 : 8.0) + 1.9 * a.pace,
    accel0: 5.5 + 2.5 * a.acceleration,
    maxBrake: 6 + 2 * a.agility,
    maxLateral: 5.5 + 2.5 * a.agility,
    turnRate: 7 + 5 * a.agility,
  };
}

/**
 * Sliding tackle: a lunge along the run, decelerating on the grass, a moment on the ground, then getting up (s, m/s²).
 * While down the body is a low capsule lying along the slide: legs and hips at ground height.
 */
const SLIDE = { decel: 5, maxTime: 0.9, down: 0.45, rise: 0.35, radius: 0.14 } as const;

export type BodyCommand = {
  target: Vec2;
  /** Desired cruising speed; braking towards the target follows v² = 2·a·d. */
  speed: number;
  /** Optional point to face; otherwise the body turns into its running direction. */
  face?: Vec2;
};

/**
 * One footballer's torso as an upright Rapier capsule. Rotation is locked and represented by `heading`,
 * so the body can face somewhere other than where it runs (e.g. jockeying, shaping to shoot).
 */
export class PlayerBody {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly limits: MotorLimits;
  readonly radius: number;
  readonly height: number;
  readonly mass: number;
  heading: number;
  private slideState: { dir: Vec2; t: number; phase: 'slide' | 'down' | 'rise' } | null = null;

  constructor(world: RAPIER.World, profile: PlayerProfile, x: number, z: number, heading: number) {
    this.limits = motorLimits(profile);
    this.height = profile.heightM;
    this.mass = profile.massKg;
    this.radius = 0.27;
    this.heading = heading;
    const halfHeight = this.height / 2 - this.radius;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, this.height / 2, z).lockRotations().setCanSleep(false),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, this.radius)
        .setMass(this.mass)
        // Feet carry the body; the capsule must not drag on the turf.
        .setFriction(0)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitution(0.1)
        .setCollisionGroups(GROUPS.body)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
  }

  position(): Vec2 {
    const t = this.body.translation();
    return { x: t.x, z: t.z };
  }

  velocity(): Vec2 {
    const v = this.body.linvel();
    return { x: v.x, z: v.z };
  }

  speed(): number {
    const v = this.body.linvel();
    return Math.hypot(v.x, v.z);
  }

  facing(): Vec2 {
    return { x: Math.sin(this.heading), z: Math.cos(this.heading) };
  }

  /**
   * Turns a movement wish into a bounded velocity change for this tick: forward acceleration that fades
   * towards top speed, limited braking, limited sideways acceleration and a speed-dependent turn rate.
   * `effort` (0…1) scales the limits, e.g. while the boot is mid-swing.
   */
  drive(cmd: BodyCommand, dt: number, effort = 1): void {
    if (this.slideState) { this.slideStep(dt); return; }
    const L = this.limits;
    const p = this.body.translation();
    const v = this.body.linvel();
    const dx = cmd.target.x - p.x, dz = cmd.target.z - p.z;
    const distance = Math.hypot(dx, dz);
    const arrive = Math.sqrt(2 * L.maxBrake * 0.75 * Math.max(0, distance - 0.1));
    const want = Math.min(cmd.speed, L.maxSpeed, arrive);
    const wx = distance > 1e-4 ? (dx / distance) * want : 0;
    const wz = distance > 1e-4 ? (dz / distance) * want : 0;
    const speed = Math.hypot(v.x, v.z);
    let dvx = wx - v.x, dvz = wz - v.z;
    if (speed > 0.3) {
      const ux = v.x / speed, uz = v.z / speed;
      const along = dvx * ux + dvz * uz;
      const lx = dvx - along * ux, lz = dvz - along * uz;
      const accel = L.accel0 * Math.max(0.04, 1 - speed / L.maxSpeed) * effort;
      // Effort 0 means airborne or committed (e.g. a dive): the body neither pushes nor brakes.
      const a = Math.max(-L.maxBrake * effort * dt, Math.min(accel * dt, along));
      const lat = Math.hypot(lx, lz);
      const latMax = L.maxLateral * effort * dt;
      const k = lat > latMax ? latMax / lat : 1;
      dvx = a * ux + lx * k;
      dvz = a * uz + lz * k;
    } else {
      const n = Math.hypot(dvx, dvz);
      const limit = L.accel0 * effort * dt;
      if (n > limit) { dvx *= limit / n; dvz *= limit / n; }
    }
    this.body.applyImpulse({ x: dvx * this.mass, y: 0, z: dvz * this.mass }, true);

    let wanted = this.heading;
    if (cmd.face) {
      const fx = cmd.face.x - p.x, fz = cmd.face.z - p.z;
      if (Math.hypot(fx, fz) > 0.05) wanted = Math.atan2(fx, fz);
    } else if (speed > 0.8) {
      wanted = Math.atan2(v.x, v.z);
    }
    const turn = (L.turnRate / (1 + speed / 3)) * dt;
    const delta = Math.atan2(Math.sin(wanted - this.heading), Math.cos(wanted - this.heading));
    this.heading += Math.max(-turn, Math.min(turn, delta));
  }

  /**
   * Starts a sliding tackle along `dir` at `speed` (never faster than the player can run). The torso capsule lies
   * down along the slide: what an opponent runs into is the sliding legs and hips.
   */
  startSlide(dir: Vec2, speed: number): void {
    const n = Math.hypot(dir.x, dir.z) || 1, d = { x: dir.x / n, z: dir.z / n };
    const v = Math.min(speed, this.limits.maxSpeed);
    this.body.setLinvel({ x: d.x * v, y: 0, z: d.z * v }, true);
    this.heading = Math.atan2(d.x, d.z);
    // Capsule axis (local Y) turned onto the slide direction: 90° about the horizontal axis across it.
    const s = Math.SQRT1_2;
    this.collider.setRadius(SLIDE.radius);
    this.collider.setHalfHeight(this.height * 0.36 - SLIDE.radius);
    this.collider.setRotationWrtParent({ x: d.z * s, y: 0, z: -d.x * s, w: s });
    this.collider.setTranslationWrtParent({ x: d.x * 0.2, y: -(this.height / 2 - SLIDE.radius), z: d.z * 0.2 });
    this.slideState = { dir: d, t: 0, phase: 'slide' };
  }

  /** In a sliding tackle, on the ground after it or getting up: the player cannot act. */
  sliding(): boolean {
    return this.slideState !== null;
  }

  /** On the ground: sliding or lying after the slide (the legs are stretched out along it). */
  down(): boolean {
    return this.slideState !== null && this.slideState.phase !== 'rise';
  }

  /** Direction of the current slide, if any. */
  slideDirection(): Vec2 | null {
    return this.slideState?.dir ?? null;
  }

  /** How far down the player is, 0 standing … 1 lying (for the presentation). */
  lying(): number {
    const s = this.slideState;
    if (!s) return 0;
    if (s.phase === 'slide') return Math.min(1, s.t / 0.15);
    if (s.phase === 'down') return 1;
    return Math.max(0, 1 - s.t / SLIDE.rise);
  }

  /** Sliding on the grass: only friction acts, then he lies, then gets up. */
  private slideStep(dt: number): void {
    const s = this.slideState!;
    s.t += dt;
    const v = this.body.linvel();
    const speed = Math.hypot(v.x, v.z);
    const k = speed > 1e-3 ? Math.max(0, speed - SLIDE.decel * dt) / speed : 0;
    this.body.applyImpulse({ x: (v.x * k - v.x) * this.mass, y: 0, z: (v.z * k - v.z) * this.mass }, true);
    if (s.phase === 'slide' && (speed < 0.5 || s.t > SLIDE.maxTime)) { s.phase = 'down'; s.t = 0; }
    else if (s.phase === 'down' && s.t > SLIDE.down) { this.standUp(); s.phase = 'rise'; s.t = 0; }
    else if (s.phase === 'rise' && s.t > SLIDE.rise) this.slideState = null;
  }

  private standUp(): void {
    this.collider.setRadius(this.radius);
    this.collider.setHalfHeight(this.height / 2 - this.radius);
    this.collider.setRotationWrtParent({ x: 0, y: 0, z: 0, w: 1 });
    this.collider.setTranslationWrtParent({ x: 0, y: 0, z: 0 });
  }

  /** Used only by the referee/engine to line players up while the ball is dead (kickoff set-up, reset). */
  place(x: number, z: number, heading: number): void {
    if (this.slideState) { this.standUp(); this.slideState = null; }
    this.body.setTranslation({ x, y: this.height / 2, z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.heading = heading;
  }
}
