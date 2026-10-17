import RAPIER from '@dimforge/rapier3d-simd-compat';
import { GROUPS } from './groups';
import { PITCH } from './pitch-geometry';

/** Turf friction and restitution (the ball's own coefficients are averaged with these by Rapier). */
export const TURF = { friction: 0.8, restitution: 0.55 } as const;

export type BoardLayout = { x: number; z: number; height: number };
/** Advertising boards around the run-off: the ball stops there physically instead of rolling forever. */
export const BOARDS: BoardLayout = { x: PITCH.halfLength + PITCH.runOff - 0.5, z: PITCH.halfWidth + PITCH.runOff - 1, height: 0.9 };

/** Static world: turf, goal frames (posts and crossbar on the goal line), soft nets, perimeter boards. */
export function createPitchColliders(world: RAPIER.World): void {
  const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const add = (desc: RAPIER.ColliderDesc) => world.createCollider(desc.setCollisionGroups(GROUPS.world), fixed);
  add(
    RAPIER.ColliderDesc.cuboid(PITCH.halfLength + PITCH.runOff + 3, 0.5, PITCH.halfWidth + PITCH.runOff + 3)
      .setTranslation(0, -0.5, 0)
      .setFriction(TURF.friction)
      .setRestitution(TURF.restitution),
  );
  for (const side of [-1, 1]) {
    const r = PITCH.postRadius;
    // Posts stand on the goal line; their inner edges are 7.32 m apart, the crossbar's lower edge is at 2.44 m.
    const postX = side * (PITCH.halfLength - r);
    const postZ = PITCH.goalHalfWidth + r;
    const height = PITCH.goalHeight + 2 * r;
    for (const z of [-postZ, postZ]) {
      add(RAPIER.ColliderDesc.cylinder(height / 2, r).setTranslation(postX, height / 2, z).setRestitution(0.7).setFriction(0.2));
    }
    add(
      RAPIER.ColliderDesc.cylinder(postZ + r, r)
        .setTranslation(postX, PITCH.goalHeight + r, 0)
        .setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 })
        .setRestitution(0.7)
        .setFriction(0.2),
    );
    const net = (hx: number, hy: number, hz: number, x: number, y: number, z: number) =>
      add(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRestitution(0.05).setFriction(1.2));
    const depth = PITCH.goalDepth;
    const top = PITCH.goalHeight + 2 * r;
    net(0.03, top / 2, postZ + r, side * (PITCH.halfLength + depth), top / 2, 0);
    for (const z of [-(postZ + r + 0.03), postZ + r + 0.03]) net(depth / 2, top / 2, 0.03, side * (PITCH.halfLength + depth / 2), top / 2, z);
    net(depth / 2, 0.03, postZ + r, side * (PITCH.halfLength + depth / 2), top + 0.03, 0);
  }
  const board = (hx: number, hz: number, x: number, z: number) =>
    add(RAPIER.ColliderDesc.cuboid(hx, BOARDS.height / 2, hz).setTranslation(x, BOARDS.height / 2, z).setRestitution(0.3).setFriction(0.5));
  for (const s of [-1, 1]) {
    board(BOARDS.x, 0.1, 0, s * BOARDS.z);
    board(0.1, BOARDS.z, s * BOARDS.x, 0);
  }
  // Front wall of the stands behind the boards: a ball cleared over the boards lands in the crowd, not in the void.
  const wall = (hx: number, hz: number, x: number, z: number) =>
    add(RAPIER.ColliderDesc.cuboid(hx, STANDS.height / 2, hz).setTranslation(x, STANDS.height / 2, z).setRestitution(0.2).setFriction(0.8));
  for (const s of [-1, 1]) {
    wall(STANDS.x + 1, 0.5, 0, s * (STANDS.z + 0.5));
    wall(0.5, STANDS.z + 1, s * (STANDS.x + 0.5), 0);
  }
}

/** Inner face of the stands (spectator area) around the run-off. */
export const STANDS = { x: PITCH.halfLength + PITCH.runOff + 1.5, z: PITCH.halfWidth + PITCH.runOff + 1.5, height: 14 } as const;
