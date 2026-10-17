import type { BallAction, Vec2 } from '../engine/types';
import type { BodyCommand } from '../physics/body';

type Tackle = Extract<BallAction, { kind: 'tackle' }>;

/** How far the poke turns away from the line defender → ball (rad); the inside of the foot reaches ≈ 1.1. */
const POKE_TURN = 0.9;
/** Pace of a poke: enough to take the ball out of the carrier's stride, not a pass. */
const POKE_SPEED = 4;

/**
 * Tackle on a ball still at an opponent's feet: a short poke with the inside of the foot to the side of the
 * carrier, away from his body, towards where team-mates are nearer than opponents. Whether the poke reaches
 * the ball, and where it goes, is decided by the boot/ball contact.
 */
export function tackle(self: Vec2, ball: Vec2, carrier: Vec2, sign: 1 | -1, mates: Vec2[], opponents: Vec2[]): Tackle {
  const base = Math.atan2(ball.z - self.z, ball.x - self.x);
  const nearest = (ps: Vec2[], p: Vec2) => ps.reduce((m, q) => Math.min(m, Math.hypot(q.x - p.x, q.z - p.z)), 12);
  let best: { dir: Vec2; score: number } | null = null;
  for (const turn of [-POKE_TURN, POKE_TURN]) {
    const dir = { x: Math.cos(base + turn), z: Math.sin(base + turn) };
    const landing = { x: ball.x + dir.x * 3, z: ball.z + dir.z * 3 };
    const away = Math.hypot(landing.x - carrier.x, landing.z - carrier.z);
    const score = away + 0.5 * (nearest(opponents, landing) - nearest(mates, landing)) + 0.5 * sign * dir.x;
    if (!best || score > best.score) best = { dir, score };
  }
  return { kind: 'tackle', direction: best!.dir, speed: POKE_SPEED };
}

/** Close in on the ball and stop a stride short of it, facing it, so the foot can reach in. */
export function tackleApproach(self: Vec2, ball: Vec2, maxSpeed: number): BodyCommand {
  const dx = self.x - ball.x, dz = self.z - ball.z, d = Math.hypot(dx, dz) || 1;
  const target = { x: ball.x + (dx / d) * 0.6, z: ball.z + (dz / d) * 0.6 };
  return { target, speed: Math.min(maxSpeed, 2 + d * 2), face: ball };
}
