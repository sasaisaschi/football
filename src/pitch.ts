import RAPIER from '@dimforge/rapier3d-simd-compat';
import { BALL } from './ball';
import { GROUPS } from './collision-groups';

/**
 * IFAB Law 1 reference pitch. Axes: X = length (goals at ±halfLength), Y = up, Z = width.
 * Lines belong to the area they bound; measurements are to the outer line edges.
 */
export const PITCH = {
  length: 105,
  width: 68,
  halfLength: 52.5,
  halfWidth: 34,
  lineWidth: 0.12,
  goalHalfWidth: 3.66,
  goalHeight: 2.44,
  goalDepth: 2,
  postRadius: 0.06,
  penaltyAreaDepth: 16.5,
  penaltyAreaHalfWidth: 20.16,
  goalAreaDepth: 5.5,
  goalAreaHalfWidth: 9.16,
  penaltySpot: 11,
  centerCircleRadius: 9.15,
  cornerArcRadius: 1,
  /** Grass run-off around the field of play. */
  runOff: 7,
} as const;

/** Team 0 attacks +X, team 1 attacks −X. */
export function attackDirection(team: number): 1 | -1 {
  return team === 0 ? 1 : -1;
}

export function createPitchPhysics(world: RAPIER.World): void {
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0));
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(PITCH.halfLength + PITCH.runOff, 0.1, PITCH.halfWidth + PITCH.runOff).setFriction(0.8).setCollisionGroups(GROUPS.world),
    ground,
  );
  for (const side of [-1, 1]) createGoalPhysics(world, side);
}

function createGoalPhysics(world: RAPIER.World, side: number): void {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const r = PITCH.postRadius;
  const postX = side * (PITCH.halfLength - r);
  const postZ = PITCH.goalHalfWidth + r;
  const barY = PITCH.goalHeight + r;
  const frame = (desc: RAPIER.ColliderDesc) => world.createCollider(desc.setRestitution(0.6).setFriction(0.3).setCollisionGroups(GROUPS.world), body);
  for (const z of [-postZ, postZ]) {
    frame(RAPIER.ColliderDesc.cylinder((PITCH.goalHeight + 2 * r) / 2, r).setTranslation(postX, (PITCH.goalHeight + 2 * r) / 2, z));
  }
  frame(
    RAPIER.ColliderDesc.cylinder(postZ, r)
      .setTranslation(postX, barY, 0)
      .setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }),
  );
  // Net: thin, soft panels that absorb the ball instead of letting it fly through the goal.
  const net = (hx: number, hy: number, hz: number, x: number, y: number, z: number) =>
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRestitution(0.05).setFriction(1).setCollisionGroups(GROUPS.world), body);
  const backX = side * (PITCH.halfLength + PITCH.goalDepth);
  const midX = side * (PITCH.halfLength + PITCH.goalDepth / 2);
  net(0.02, barY / 2, postZ, backX, barY / 2, 0);
  for (const z of [-postZ - 0.04, postZ + 0.04]) net(PITCH.goalDepth / 2, barY / 2, 0.02, midX, barY / 2, z);
  net(PITCH.goalDepth / 2, 0.02, postZ, midX, barY + 0.06, 0);
}

/** Law 10: the whole ball has crossed the goal line between the posts and under the crossbar. Returns the goal side or 0. */
export function goalSide(p: { x: number; y: number; z: number }): -1 | 0 | 1 {
  if (Math.abs(p.x) <= PITCH.halfLength + BALL.radius) return 0;
  if (Math.abs(p.z) >= PITCH.goalHalfWidth || p.y >= PITCH.goalHeight) return 0;
  return p.x > 0 ? 1 : -1;
}

export type OutOfPlay = { line: 'touch' | 'goal'; x: number; z: number } | null;

/** Law 9: ball out of play once it has wholly crossed a touch line or goal line (goals excluded). */
export function outOfPlay(p: { x: number; y: number; z: number }): OutOfPlay {
  const limitX = PITCH.halfLength + BALL.radius;
  const limitZ = PITCH.halfWidth + BALL.radius;
  if (Math.abs(p.z) > limitZ) return { line: 'touch', x: p.x, z: Math.sign(p.z) * PITCH.halfWidth };
  if (Math.abs(p.x) > limitX && goalSide(p) === 0) return { line: 'goal', x: Math.sign(p.x) * PITCH.halfLength, z: p.z };
  return null;
}
