import type RAPIER from '@dimforge/rapier3d-simd-compat';
import type { Vec3 } from '../engine/types';
import type { PlayerBody } from '../physics/body';
import { CHEST_PART, type Head } from '../physics/head';
import type { Legs } from '../physics/legs';
import { headerIntercept } from './aerial';
import type { BrainOutput } from './brain';

/** Pace the chest sends the ball on with, towards where the player faces: it drops a stride ahead (m/s). */
const CHEST_DROP_PACE = 1;
/** How far beyond the chest-height point on the ball's line a chest control is set up: the chest meets it in front (m). */
const CHEST_SET = 0.3;

type Ball = { pos: Vec3; vel: Vec3; spin: Vec3 };

/**
 * Chest control: the chest goes out to meet the ball in front of the body and gives with it, so it drops a stride
 * ahead of the feet. Null when the ball does not arrive at chest height within reach (or a leg or the head is busy).
 */
export function chestControl(body: PlayerBody, legs: Legs, head: Head, chest: Head, ballBody: RAPIER.RigidBody, ball: Ball): BrainOutput | null {
  if (chest.busy() || head.busy() || legs.busy()) return null;
  const f = body.facing();
  const target = { x: f.x * CHEST_DROP_PACE, y: 0.5, z: f.z * CHEST_DROP_PACE };
  const plan = chest.plan(ballBody, target);
  if (!plan) return null;
  chest.start(plan, target);
  return { command: { target: body.position(), speed: body.speed(), face: ball.pos }, effort: 1, swing: { action: { kind: 'control' }, source: 'ai' } };
}

/**
 * Gets into the ball's line where it passes at chest height, a little beyond the meeting point and facing it, so the
 * chest can take it. Players only ran to where a high ball came down to the turf; at chest height they were in the
 * wrong place, the chest never fitted and most thrown-in balls bounced off their legs. Null when the ball cannot be
 * reached at chest height: then it is taken with the foot as before.
 */
export function meetAtChest(body: PlayerBody, ball: Ball): BrainOutput | null {
  const meet = headerIntercept(body.position(), body.limits.maxSpeed, ball.pos, ball.vel, CHEST_PART.rest(body.height), ball.spin);
  if (!meet) return null;
  const h = Math.hypot(ball.vel.x, ball.vel.z) || 1;
  const stand = { x: meet.at.x + (ball.vel.x / h) * CHEST_SET, z: meet.at.z + (ball.vel.z / h) * CHEST_SET };
  return { command: { target: stand, speed: body.limits.maxSpeed, face: ball.pos }, effort: 1, swing: null };
}
