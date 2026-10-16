import RAPIER from '@dimforge/rapier3d-simd-compat';
import { GROUPS } from './collision-groups';

/** Upright capsule body: 1.80 m tall, 75 kg. Rotation is locked; facing is the explicit `heading`. */
export const BODY = { radius: 0.3, halfHeight: 0.6, mass: 75, centerY: 0.9 } as const;

/**
 * Gameplay locomotion parameters, bounded by published sprint ranges
 * (elite top speed ≈ 9–10 m/s, initial acceleration ≈ 6–8 m/s²). Not individually calibrated yet.
 */
export type MotorProfile = {
  maxSpeed: number;
  /** Acceleration at standstill; falls linearly to zero at maxSpeed. */
  accel0: number;
  maxDecel: number;
  /** Maximum sideways (centripetal) acceleration while changing direction. */
  maxLateral: number;
  /** Turn rate when standing; shrinks with speed. */
  turnRate: number;
};

export const OUTFIELD: MotorProfile = { maxSpeed: 8.6, accel0: 7.2, maxDecel: 7.5, maxLateral: 7, turnRate: 9 };
export const KEEPER: MotorProfile = { maxSpeed: 7.4, accel0: 8, maxDecel: 8.5, maxLateral: 8.5, turnRate: 10 };

export type Motor = {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  /** Facing angle in radians: direction (sin h, cos h) in the X/Z plane. */
  heading: number;
  profile: MotorProfile;
};

export type MotorCommand = {
  targetX: number;
  targetZ: number;
  /** Desired cruising speed; braking is applied automatically near the target. */
  speed: number;
  /** Optional point to face instead of the running direction. */
  faceX?: number;
  faceZ?: number;
};

export function createMotor(world: RAPIER.World, x: number, z: number, heading: number, profile: MotorProfile): Motor {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(x, BODY.centerY, z).lockRotations(),
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.capsule(BODY.halfHeight, BODY.radius)
      .setMass(BODY.mass)
      // Locomotion is the motor's job: no sliding friction against the turf.
      .setFriction(0)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setRestitution(0)
      .setCollisionGroups(GROUPS.body),
    body,
  );
  return { body, collider, heading, profile };
}

export function headingVector(heading: number): { x: number; z: number } {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/**
 * Converts a movement wish into a bounded impulse: limited forward acceleration that fades with speed,
 * limited braking, limited sideways acceleration (no instant reversal) and a speed-dependent turn rate.
 */
export function driveMotor(motor: Motor, cmd: MotorCommand, dt: number): void {
  const { body, profile } = motor;
  const p = body.translation();
  const v = body.linvel();
  const dx = cmd.targetX - p.x, dz = cmd.targetZ - p.z;
  const distance = Math.hypot(dx, dz);
  // Arrive with physically possible braking: v² = 2·a·d.
  const arrive = Math.sqrt(2 * profile.maxDecel * 0.8 * Math.max(0, distance - 0.15));
  const desiredSpeed = Math.min(cmd.speed, profile.maxSpeed, arrive);
  const wantX = distance > 1e-3 ? (dx / distance) * desiredSpeed : 0;
  const wantZ = distance > 1e-3 ? (dz / distance) * desiredSpeed : 0;

  const speed = Math.hypot(v.x, v.z);
  let dvx = wantX - v.x, dvz = wantZ - v.z;
  if (speed > 0.2) {
    const ux = v.x / speed, uz = v.z / speed;
    const along = dvx * ux + dvz * uz;
    const latX = dvx - along * ux, latZ = dvz - along * uz;
    const accelLimit = profile.accel0 * Math.max(0.05, 1 - speed / profile.maxSpeed);
    const alongClamped = Math.max(-profile.maxDecel * dt, Math.min(accelLimit * dt, along));
    const lat = Math.hypot(latX, latZ);
    const latScale = lat > profile.maxLateral * dt ? (profile.maxLateral * dt) / lat : 1;
    dvx = alongClamped * ux + latX * latScale;
    dvz = alongClamped * uz + latZ * latScale;
  } else {
    const len = Math.hypot(dvx, dvz);
    const limit = profile.accel0 * dt;
    if (len > limit) { dvx *= limit / len; dvz *= limit / len; }
  }
  body.applyImpulse({ x: dvx * BODY.mass, y: 0, z: dvz * BODY.mass }, true);

  // Facing: explicit look target, otherwise the running direction once moving.
  let wanted = motor.heading;
  if (cmd.faceX !== undefined && cmd.faceZ !== undefined) {
    const fx = cmd.faceX - p.x, fz = cmd.faceZ - p.z;
    if (Math.hypot(fx, fz) > 0.05) wanted = Math.atan2(fx, fz);
  } else if (speed > 0.6) {
    wanted = Math.atan2(v.x, v.z);
  }
  const maxTurn = (profile.turnRate / (1 + speed / 3)) * dt;
  const delta = angleDelta(motor.heading, wanted);
  motor.heading += Math.max(-maxTurn, Math.min(maxTurn, delta));
}

export function placeMotor(motor: Motor, x: number, z: number, heading: number): void {
  motor.body.setTranslation({ x, y: BODY.centerY, z }, true);
  motor.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  motor.heading = heading;
}
