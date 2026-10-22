import { BALL_SPEC } from '../physics/pitch-geometry';
import type { MatchEngine } from './match-engine';
import type { Vec2, Vec3 } from './types';

/**
 * Test-only dead-ball set-up: lines players up and puts the ball down, then lets play continue.
 * Equivalent to a referee's drop-ball. Never used by the running application.
 */
export function stageScenario(e: MatchEngine, players: Record<number, Vec2>, ball: Vec3, velocity: Vec3 = { x: 0, y: 0, z: 0 }, park = true): void {
  e.profiles.forEach(p => {
    // Substitutes stay on the bench; only the players on the pitch are lined up.
    if (e.referee.sentOff.has(p.id)) return;
    const target = players[p.id] ?? (park ? { x: (p.team === 0 ? -1 : 1) * (2 + (p.id % 11) * 1.5), z: -30 + (p.id % 11) } : null);
    if (!target) return;
    const facing = Math.atan2(ball.x - target.x, ball.z - target.z);
    e.bodies[p.id].place(target.x, target.z, facing);
    e.legs[p.id].snap();
    e.heads[p.id].reset();
    e.chests[p.id].reset();
    e.keepers.get(p.id)?.hands.snap();
  });
  const b = e.physics.ball;
  b.resetForces(true);
  b.setTranslation({ x: ball.x, y: Math.max(BALL_SPEC.radius, ball.y), z: ball.z }, true);
  b.setLinvel(velocity, true);
  b.setAngvel({ x: 0, y: 0, z: 0 }, true);
  e.restart = null;
  e.referee.pendingRestart = null;
  e.phase = 'in-play';
  const truth = e.truth();
  for (const brain of e.brains) brain.perception.reset(truth);
}

/** Steps the engine for `seconds` of match time; stops early at full time, at an open decision or when `until` holds. */
export function runFor(e: MatchEngine, seconds: number, until?: () => boolean): void {
  const end = e.time + seconds;
  while (e.time < end && e.phase !== 'full-time' && e.phase !== 'decision' && !(until?.() ?? false)) e.step();
}
