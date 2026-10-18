import type { PlayerProfile, Vec2 } from '../engine/types';
import type { BodyCommand } from '../physics/body';
import { PITCH } from '../physics/pitch-geometry';
import type { BrainContext, PlayerBrain } from './brain';
import { DEFENDERS, MIDFIELDERS, keeperShape, offsideLineU, shapeTarget, toTeam } from './shape';
import { supportSpot } from './support';

/** Distance from the own goal within which a second defender covers the ball's line to goal (m). */
const COVER_ZONE = 24;

/**
 * Off the ball: the place in the team shape, offering for a pass, covering the line to goal, pressing as the
 * second man or marking, and keeping the distance at restarts.
 */
export function offBallCommand(b: PlayerBrain, ctx: BrainContext, ball: { pos: Vec2; vel: Vec2 }): BodyCommand {
  const role = b.profile.role;
  const self = b.body.position();
  const own = ctx.possession === b.profile.team && teamOnBall(b, ctx, ball);
  const opponents = ctx.profiles.filter(p => p.team !== b.profile.team).map(p => ({ p, pos: b.perception.playerNow(p.id, ctx.now) })).filter(o => o.pos) as { p: PlayerProfile; pos: Vec2 }[];
  if (role === 'GK') return { target: keeperShape(ctx.sign, ball.pos), speed: 6, face: ball.pos };
  let target = shapeTarget(role, {
    sign: ctx.sign, ball: ball.pos, inPossession: own, instruction: ctx.instruction,
    offsideLineU: offsideLineU(ctx.sign, opponents.map(o => o.pos)),
  });
  if (own && !ctx.restart) {
    const mates: { id: number; pos: Vec2 }[] = [];
    for (const p of ctx.profiles) {
      if (p.team !== b.profile.team || p.id === b.profile.id || p.role === 'GK') continue;
      const pos = b.perception.playerNow(p.id, ctx.now);
      if (pos) mates.push({ id: p.id, pos });
    }
    const spot = supportSpot({
      self: { id: b.profile.id, pos: self }, sign: ctx.sign, ball: ball.pos, mates, opponents: opponents.map(o => o.pos),
      offsideLineU: offsideLineU(ctx.sign, opponents.map(o => o.pos)), shape: target,
    });
    if (spot) return { target: spot, speed: b.body.limits.maxSpeed * 0.85, face: ball.pos };
  }
  if (!own && ctx.possession !== null && !ctx.restart && (DEFENDERS.has(role) || MIDFIELDERS.has(role))) {
    // Near the own goal the defender closest to the ball's line to goal (besides whoever goes for the ball)
    // covers that line a few metres in front of the ball: he blocks the shot and the way through.
    const goalX = -ctx.sign * PITCH.halfLength;
    const toGoal = Math.hypot(goalX - ball.pos.x, ball.pos.z) || 1;
    if (toGoal < COVER_ZONE) {
      const lane = { x: ball.pos.x + ((goalX - ball.pos.x) / toGoal) * 3, z: ball.pos.z + (-ball.pos.z / toGoal) * 3 };
      if (coversLane(b, ctx, lane, ball.pos)) return { target: lane, speed: b.body.limits.maxSpeed, face: ball.pos };
    }
  }
  if (!own && ctx.possession !== null) {
    // Second player presses when the coach asks for it; defenders mark attackers in their zone goal-side.
    const ballU = toTeam(ctx.sign, ball.pos).u;
    const nearBall = Math.hypot(ball.pos.x - self.x, ball.pos.z - self.z);
    if (ctx.instruction.press !== 'low' && nearBall < (ctx.instruction.press === 'high' ? 16 : 10) && MIDFIELDERS.has(role) && ballU > -0.2) {
      // Second presser: close the passing lane goal-side of the ball, not the ball itself.
      const goalX = -ctx.sign * PITCH.halfLength;
      const gx = goalX - ball.pos.x, gz = -ball.pos.z, gd = Math.hypot(gx, gz) || 1;
      target = { x: ball.pos.x + (gx / gd) * 4 + (target.x - ball.pos.x) * 0.2, z: ball.pos.z + (gz / gd) * 4 + (target.z - ball.pos.z) * 0.2 };
    } else if (DEFENDERS.has(role) || MIDFIELDERS.has(role)) {
      let mark: Vec2 | null = null, best = 9;
      for (const o of opponents) {
        const d = Math.hypot(o.pos.x - target.x, o.pos.z - target.z);
        if (d < best) { best = d; mark = o.pos; }
      }
      if (mark) {
        const goalX = -ctx.sign * PITCH.halfLength;
        const gx = goalX - mark.x, gz = -mark.z, gd = Math.hypot(gx, gz) || 1;
        target = { x: mark.x + (gx / gd) * 1.6, z: mark.z + (gz / gd) * 1.6 };
      }
    }
  }
  if (ctx.restart) target = keepRestartDistance(target, b.profile, ctx);
  const gap = Math.hypot(target.x - self.x, target.z - self.z);
  const speed = gap > 10 ? b.body.limits.maxSpeed * 0.92 : gap > 3 ? 5.5 : 3;
  return { target, speed, face: ball.pos };
}

/** Am I the outfield team-mate nearest to `lane`, leaving out the one nearest to the ball (he goes for it)? */
function coversLane(b: PlayerBrain, ctx: BrainContext, lane: Vec2, ballPos: Vec2): boolean {
  const self = b.body.position();
  const mates = [{ id: b.profile.id, pos: self }];
  for (const p of ctx.profiles) {
    if (p.team !== b.profile.team || p.id === b.profile.id || p.role === 'GK') continue;
    const pos = b.perception.playerNow(p.id, ctx.now);
    if (pos) mates.push({ id: p.id, pos });
  }
  const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
  const onBall = mates.reduce((a, b) => (dist(b.pos, ballPos) < dist(a.pos, ballPos) ? b : a));
  if (onBall.id === b.profile.id) return false;
  return mates.every(m => m.id === b.profile.id || m.id === onBall.id || dist(m.pos, lane) >= dist(self, lane));
}

/**
 * Does one of us have the ball, as far as I can see: the player nearest to it is a team-mate (or me)? A
 * touch alone (a block, a poke) does not make the team push out while the ball is still loose.
 */
function teamOnBall(b: PlayerBrain, ctx: BrainContext, ball: { pos: Vec2 }): boolean {
  if (ctx.restart) return true;
  const self = b.body.position();
  let mine = Math.hypot(ball.pos.x - self.x, ball.pos.z - self.z), theirs = Infinity;
  for (const p of ctx.profiles) {
    if (p.id === b.profile.id) continue;
    const pos = b.perception.playerNow(p.id, ctx.now);
    if (!pos) continue;
    const d = Math.hypot(ball.pos.x - pos.x, ball.pos.z - pos.z);
    if (p.team === b.profile.team) mine = Math.min(mine, d); else theirs = Math.min(theirs, d);
  }
  return mine < theirs;
}

/** Laws 8, 13, 15–17: kick-off halves, 9.15 m (2 m at throw-ins) from the ball at restarts. */
export function keepRestartDistance(target: Vec2, profile: PlayerProfile, ctx: BrainContext): Vec2 {
  const r = ctx.restart!;
  let { x, z } = target;
  if (r.ownHalfOnly && ctx.sign * x > -0.3) x = -ctx.sign * 0.3;
  if ((r.kind === 'penalty' && profile.id !== r.taker && profile.role !== 'GK') || (r.kind === 'goal-kick' && profile.team !== r.team)) {
    // Everybody else outside the penalty area (Law 14); opponents at a goal kick (Law 16).
    const edge = PITCH.halfLength - PITCH.penaltyAreaDepth - 1;
    if (Math.sign(r.spot.x) * x > edge && Math.abs(z) < PITCH.penaltyAreaHalfWidth + 1) x = Math.sign(r.spot.x) * edge;
  }
  if (profile.team !== r.team) {
    const dx = x - r.spot.x, dz = z - r.spot.z, d = Math.hypot(dx, dz);
    const min = r.minDistance + 0.6;
    if (d < min) {
      if (d > 0.01) { x = r.spot.x + (dx / d) * min; z = r.spot.z + (dz / d) * min; }
      else x = r.spot.x - ctx.sign * min;
    }
  }
  return { x, z };
}
