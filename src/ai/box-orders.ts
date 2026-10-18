import type RAPIER from '@dimforge/rapier3d-simd-compat';
import type { BallAction, PlayerProfile, Vec2 } from '../engine/types';
import type { Rng } from '../engine/rng';
import type { BodyCommand, PlayerBody } from '../physics/body';
import type { Legs } from '../physics/legs';
import { PITCH } from '../physics/pitch-geometry';
import { tackle, tackleApproach } from './challenge';
import { trySwing } from './execution';
import { pressureOn, type Picture } from './options';

/**
 * Coach orders for one defender against a ball carrier in front of the own box (box-defence moment). Each is a
 * different way of using the body; none of them decides whether the ball is won or the shot is blocked.
 */

/** The carrier has lost the ball (shot, pass or poke) once it is this far from him: the order is over (m). */
const ORDER_REACH = 2.5;
/** Jockeying distance goal-side of the carrier: out of reach of his first touch, close enough to cut him off (m). */
const JOCKEY_GAP = 3.5;
/** Block point: on the ball's line to the goal centre, near enough to cover the angle of a shot (m). */
const BLOCK_GAP = 1.8;

type Ball = { pos: Vec2; vel: Vec2 };
type Out = { command: BodyCommand; effort: number; swing: { action: BallAction; source: 'ai' | 'user' } | null };

/** Is the order still about a carrier with the ball at his feet? */
export function carrierHasBall(carrier: Vec2, ball: Ball): boolean {
  return Math.hypot(ball.pos.x - carrier.x, ball.pos.z - carrier.z) < ORDER_REACH;
}

/** Does a body stand in the way from `from` to `to` (closer than the target, within a body and a leg of the line)? */
export function bodyInLine(from: Vec2, to: Vec2, body: Vec2): boolean {
  const dx = to.x - from.x, dz = to.z - from.z, l = Math.hypot(dx, dz) || 1;
  const along = ((body.x - from.x) * dx + (body.z - from.z) * dz) / l;
  if (along <= 0 || along >= l) return false;
  return Math.abs((body.x - from.x) * dz - (body.z - from.z) * dx) / l < 0.6;
}

function towardsGoal(p: Vec2, sign: 1 | -1, gap: number): Vec2 {
  const gx = -sign * PITCH.halfLength - p.x, gz = -p.z, gd = Math.hypot(gx, gz) || 1;
  return { x: p.x + (gx / gd) * gap, z: p.z + (gz / gd) * gap };
}

/**
 * Hold: stay goal-side at a jockeying distance and delay. He only closes the gap at the carrier's own pace plus
 * a little, so he cannot be beaten by one touch, and the cover has time to arrive.
 */
export function jockey(self: Vec2, carrier: Vec2, carrierVel: Vec2, ball: Ball, sign: 1 | -1, maxSpeed: number): Out {
  const spot = towardsGoal(carrier, sign, JOCKEY_GAP);
  const hold = { x: spot.x + carrierVel.x * 0.3, z: spot.z + carrierVel.z * 0.3 };
  const gap = Math.hypot(hold.x - self.x, hold.z - self.z);
  const pace = Math.min(maxSpeed, Math.hypot(carrierVel.x, carrierVel.z) + gap * 0.6);
  return { command: { target: hold, speed: pace, face: ball.pos }, effort: 1, swing: null };
}

/** Block: get into the ball's line to the goal at full speed and stand there square to the ball; no challenge. */
export function blockLane(ball: Ball, sign: 1 | -1, maxSpeed: number): Out {
  return { command: { target: towardsGoal(ball.pos, sign, BLOCK_GAP), speed: maxSpeed, face: ball.pos }, effort: 1, swing: null };
}

export type PressKit = {
  body: PlayerBody; legs: Legs; ballBody: RAPIER.RigidBody; profile: PlayerProfile; rng: Rng; sign: 1 | -1; picture: () => Picture;
};

/**
 * Press: close down at full speed and step in. In reach of the ball he pokes it away from the carrier, unless
 * the carrier's body is between him and the ball (that would be a foul from behind, not a tackle).
 */
export function pressCarrier(kit: PressKit, carrier: Vec2 & { id: number }, ball: Ball): Out {
  const self = kit.body.position();
  const max = kit.body.limits.maxSpeed;
  const distance = Math.hypot(ball.pos.x - self.x, ball.pos.z - self.z);
  if (distance > 2.2) return { command: { target: ball.pos, speed: max, face: ball.pos }, effort: 1, swing: null };
  if (bodyInLine(self, ball.pos, carrier)) {
    // Round him to the goal side of the ball instead of through him.
    return { command: { target: towardsGoal(ball.pos, kit.sign, 0.9), speed: max, face: ball.pos }, effort: 1, swing: null };
  }
  const pic = kit.picture();
  const action = tackle(self, ball.pos, carrier, kit.sign, pic.mates.map(m => m.pos), pic.opponents.filter(o => o.id !== carrier.id).map(o => o.pos));
  const plan = distance < 1.3 && trySwing(kit.body, kit.legs, kit.ballBody, action, { pressure: pressureOn(pic), profile: kit.profile, rng: kit.rng });
  return { command: tackleApproach(self, ball.pos, max), effort: 1, swing: plan ? { action, source: 'user' } : null };
}
