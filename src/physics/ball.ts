import RAPIER from '@dimforge/rapier3d-simd-compat';
import { BALL_SPEC } from './pitch-geometry';
import { GROUPS } from './groups';

/**
 * Ball model. Rapier integrates the rigid body and resolves every contact; this module only adds the
 * aerodynamic and rolling forces Rapier does not know about. Coefficients are literature ranges, not yet
 * calibrated against our own measurements:
 * - drag: Cd ≈ 0.45 below ~9 m/s falling to ≈ 0.25 above ~14 m/s (drag crisis of a size-5 ball)
 * - Magnus lift: C_L = 1 / (2 + 1/S), spin parameter S = r·|ω| / |v|
 * - rolling resistance on turf: μ_r ≈ 0.065 (≈ 0.64 m/s² deceleration)
 */
export const BALL_PHYSICS = {
  restitution: 0.65,
  friction: 0.6,
  angularDamping: 0.15,
  airDensity: 1.225,
  cdSlow: 0.45,
  cdFast: 0.25,
  crisisFrom: 9,
  crisisTo: 14,
  rollingResistance: 0.065,
  gravity: 9.81,
} as const;

const AREA = Math.PI * BALL_SPEC.radius * BALL_SPEC.radius;

export function createBall(world: RAPIER.World): RAPIER.RigidBody {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, BALL_SPEC.radius, 0)
      .setCcdEnabled(true)
      .setAngularDamping(BALL_PHYSICS.angularDamping),
  );
  world.createCollider(
    RAPIER.ColliderDesc.ball(BALL_SPEC.radius)
      .setMass(BALL_SPEC.mass)
      .setRestitution(BALL_PHYSICS.restitution)
      .setFriction(BALL_PHYSICS.friction)
      .setCollisionGroups(GROUPS.ball)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    body,
  );
  return body;
}

export function dragCoefficient(speed: number): number {
  const { cdSlow, cdFast, crisisFrom, crisisTo } = BALL_PHYSICS;
  const t = Math.max(0, Math.min(1, (speed - crisisFrom) / (crisisTo - crisisFrom)));
  return cdSlow + (cdFast - cdSlow) * t * t * (3 - 2 * t);
}

export function isRolling(ball: RAPIER.RigidBody): boolean {
  return ball.translation().y < BALL_SPEC.radius + 0.015 && Math.abs(ball.linvel().y) < 0.4;
}

/**
 * Recomputes all non-contact forces from the current state. Rapier keeps user forces between steps,
 * so they are reset first; otherwise they would accumulate tick after tick.
 */
export function applyBallForces(ball: RAPIER.RigidBody): void {
  ball.resetForces(true);
  const v = ball.linvel();
  const speed = Math.hypot(v.x, v.y, v.z);
  if (speed < 1e-3) return;
  const q = 0.5 * BALL_PHYSICS.airDensity * AREA * speed;
  let fx = -q * dragCoefficient(speed) * v.x;
  let fy = -q * dragCoefficient(speed) * v.y;
  let fz = -q * dragCoefficient(speed) * v.z;
  if (isRolling(ball)) {
    const horizontal = Math.hypot(v.x, v.z);
    if (horizontal > 0.02) {
      const f = BALL_PHYSICS.rollingResistance * BALL_SPEC.mass * BALL_PHYSICS.gravity;
      fx -= (f * v.x) / horizontal;
      fz -= (f * v.z) / horizontal;
    }
  } else {
    const w = ball.angvel();
    const spin = Math.hypot(w.x, w.y, w.z);
    if (spin > 0.5) {
      const s = (BALL_SPEC.radius * spin) / speed;
      const cl = 1 / (2 + 1 / s);
      // Direction ω̂ × v̂, magnitude ½ρA·C_L·v².
      const k = (q * speed * cl) / (spin * speed);
      fx += k * (w.y * v.z - w.z * v.y);
      fy += k * (w.z * v.x - w.x * v.z);
      fz += k * (w.x * v.y - w.y * v.x);
    }
  }
  ball.addForce({ x: fx, y: fy, z: fz }, true);
}
