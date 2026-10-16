import RAPIER from '@dimforge/rapier3d-simd-compat';
import { GROUPS } from './collision-groups';

/** Size-5 match ball: circumference 0.69 m, mass 0.43 kg (IFAB Law 2 range 0.68–0.70 m, 410–450 g). */
export const BALL = {
  radius: 0.11,
  mass: 0.43,
  restitution: 0.58,
  friction: 0.6,
  /** Damping stands in for rolling resistance until a calibrated rolling model exists. */
  linearDamping: 0.13,
  angularDamping: 0.18,
  dragCoefficient: 0.25,
  airDensity: 1.225,
} as const;

export function createBall(world: RAPIER.World, x = 0, z = 0): RAPIER.RigidBody {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, BALL.radius + 0.02, z)
      .setCcdEnabled(true)
      .setLinearDamping(BALL.linearDamping)
      .setAngularDamping(BALL.angularDamping),
  );
  world.createCollider(
    RAPIER.ColliderDesc.ball(BALL.radius).setMass(BALL.mass).setRestitution(BALL.restitution).setFriction(BALL.friction)
      .setCollisionGroups(GROUPS.ball).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    body,
  );
  return body;
}

/**
 * Quadratic air drag F = -½·ρ·Cd·A·|v|·v. Rapier user forces persist across steps,
 * so the force is reset and recomputed from the current velocity every tick.
 */
export function applyBallDrag(ball: RAPIER.RigidBody): void {
  ball.resetForces(true);
  const v = ball.linvel();
  const speed = Math.hypot(v.x, v.y, v.z);
  if (speed < 0.05) return;
  const k = 0.5 * BALL.airDensity * BALL.dragCoefficient * Math.PI * BALL.radius * BALL.radius * speed;
  ball.addForce({ x: -k * v.x, y: -k * v.y, z: -k * v.z }, true);
}

export function placeBall(ball: RAPIER.RigidBody, x: number, z: number): void {
  ball.resetForces(true);
  ball.setTranslation({ x, y: BALL.radius + 0.02, z }, true);
  ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
  ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
}
