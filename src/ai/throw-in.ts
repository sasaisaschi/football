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
  const best = aiThrowTarget(pic, height);
  if (best) return throwTo(from, best.target, h0)!;
  const space = { x: Math.max(-PITCH.halfLength + 2, Math.min(PITCH.halfLength - 2, from.x + pic.sign * 8)), z: from.z - Math.sign(from.z) * 6 };
  return throwTo(from, space, h0)!;
}

/** The receiver the thrower would pick himself: most room around him, a little credit for ground gained. */
export function aiThrowTarget(pic: Picture, height: number): { id: number; target: Vec2; room: number; gain: number } | null {
  let best: { id: number; target: Vec2; room: number; gain: number } | null = null, score = -Infinity;
  for (const t of throwTargets(pic, height)) {
    const s = t.room + 0.08 * t.gain;
    if (s > score) { score = s; best = t; }
  }
  return best;
}

/**
 * A throw to one chosen team-mate, led by his run like the AI's own choice. Out of range or too close, it goes as far as
 * the arms allow (or the shortest worthwhile throw) in his direction: the decision stands, the execution may fall short.
 */
export function throwToMate(pic: Picture, height: number, receiver: number): Vec3 {
  const from = { x: pic.ball.pos.x, z: pic.ball.pos.z };
  const h0 = height + RELEASE_ABOVE;
  const m = pic.mates.find(o => o.id === receiver);
  if (!m) return chooseThrow(pic, height);
  const target = { x: m.pos.x + m.vel.x * 0.8, z: m.pos.z + m.vel.z * 0.8 };
  const exact = throwTo(from, target, h0);
  if (exact) return exact;
  const d = Math.hypot(target.x - from.x, target.z - from.z) || 1;
  for (const k of [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3]) {
    const reach = d > MIN_THROW ? d * k : MIN_THROW + 0.5;
    const v = throwTo(from, { x: from.x + ((target.x - from.x) / d) * reach, z: from.z + ((target.z - from.z) / d) * reach }, h0);
    if (v) return v;
  }
  return chooseThrow(pic, height);
}

/** Throw-in receivers the thrower can reach from here, with the throw and the room around the receiver. */
export function throwTargets(pic: Picture, height: number): { id: number; target: Vec2; room: number; gain: number }[] {
  const from = { x: pic.ball.pos.x, z: pic.ball.pos.z };
  const h0 = height + RELEASE_ABOVE;
  const out: { id: number; target: Vec2; room: number; gain: number }[] = [];
  for (const m of pic.mates) {
    if (m.profile.role === 'GK') continue;
    const target = { x: m.pos.x + m.vel.x * 0.8, z: m.pos.z + m.vel.z * 0.8 };
    if (Math.abs(target.z) > PITCH.halfWidth - 1 || Math.abs(target.x) > PITCH.halfLength - 1) continue;
    if (!throwTo(from, target, h0)) continue;
    let room = 8;
    for (const o of pic.opponents) room = Math.min(room, Math.hypot(o.pos.x - target.x, o.pos.z - target.z));
    out.push({ id: m.id, target, room, gain: pic.sign * (target.x - from.x) });
  }
  return out;
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
