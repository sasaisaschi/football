import type { Vec2, Vec3 } from '../engine/types';
import { BALL_PHYSICS } from '../physics/ball';
import { PITCH } from '../physics/pitch-geometry';
import { MAX_THROW_SPEED } from '../physics/throw-hands';
import type { Picture } from './options';

/** Body axis behind the touchline: the capsule clears the line, the feet stay on or behind it (Law 15), m. */
const STAND_OUT = 0.32;
/** Launch angle of a throw-in (rad) and the height the ball should arrive at, chest of the receiver (m). */
const THROW_ANGLE = 0.35, ARRIVE_HEIGHT = 1.1;
/** Release height above the thrower's head top (m). */
const RELEASE_ABOVE = 0.35;
/** Receivers closer than this are not worth a throw (m). */
const MIN_THROW = 4;

/** Where the thrower stands for a throw-in at `spot`, and which way the pitch lies. */
export function throwInStand(spot: Vec2): { stand: Vec2; infield: Vec2 } {
  const out = Math.sign(spot.z) || 1;
  return { stand: { x: spot.x, z: out * (PITCH.halfWidth + STAND_OUT) }, infield: { x: 0, z: -out } };
}

/**
 * The throw: to the team-mate with the most room around him that the arms can reach, thrown at chest height. A
 * throw is in the air from above the head, so it is judged by its flight (gravity only), not by a rolling pass.
 * With nobody in range the ball goes into the space ahead, a few metres infield.
 */
export function chooseThrow(pic: Picture, height: number): Vec3 {
  const from = { x: pic.ball.pos.x, z: pic.ball.pos.z };
  const h0 = height + RELEASE_ABOVE;
  let best: { v: Vec3; score: number } | null = null;
  for (const m of pic.mates) {
    if (m.profile.role === 'GK') continue;
    const target = { x: m.pos.x + m.vel.x * 0.8, z: m.pos.z + m.vel.z * 0.8 };
    if (Math.abs(target.z) > PITCH.halfWidth - 1 || Math.abs(target.x) > PITCH.halfLength - 1) continue;
    const v = throwTo(from, target, h0);
    if (!v) continue;
    let room = 8;
    for (const o of pic.opponents) room = Math.min(room, Math.hypot(o.pos.x - target.x, o.pos.z - target.z));
    const score = room + 0.08 * pic.sign * (target.x - from.x);
    if (!best || score > best.score) best = { v, score };
  }
  if (best) return best.v;
  const space = { x: Math.max(-PITCH.halfLength + 2, Math.min(PITCH.halfLength - 2, from.x + pic.sign * 8)), z: from.z - Math.sign(from.z) * 6 };
  return throwTo(from, space, h0)!;
}

/** Velocity of a throw from height h0 that arrives at chest height at `to`; null if out of range. */
function throwTo(from: Vec2, to: Vec2, h0: number): Vec3 | null {
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  if (d < MIN_THROW) return null;
  const g = BALL_PHYSICS.gravity, c = Math.cos(THROW_ANGLE), tan = Math.tan(THROW_ANGLE);
  // From h0 to ARRIVE_HEIGHT over d at the throw angle: v² = g·d² / (2·cos²θ·(h0 − h1 + d·tanθ)).
  const v2 = (g * d * d) / (2 * c * c * (h0 - ARRIVE_HEIGHT + d * tan));
  if (v2 <= 0 || Math.sqrt(v2) > MAX_THROW_SPEED) return null;
  const v = Math.sqrt(v2), hx = (to.x - from.x) / d, hz = (to.z - from.z) / d;
  return { x: hx * v * c, y: v * Math.sin(THROW_ANGLE), z: hz * v * c };
}
