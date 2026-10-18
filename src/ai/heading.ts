import type { Vec2, Vec3 } from '../engine/types';
import { BALL_PHYSICS } from '../physics/ball';
import { PITCH } from '../physics/pitch-geometry';
import type { Picture } from './options';
import { toTeam } from './shape';

/** Distance to the opponents' goal within which a header goes at goal (m). */
const HEADER_SHOT_RANGE = 14;
/** Pace of a headed clearance and its rise (m/s, rad). */
const CLEAR_PACE = 13, CLEAR_RISE = 0.6;
/** Pace of a header at goal (m/s); the head adds little to a ball's own pace. */
const HEADER_SHOT_PACE = 12;
/** A team-mate this close is a target for a headed lay-off (m). */
const LAY_OFF = { min: 5, max: 18 } as const;
/** An opponent this close makes a ball in the air a contest: it is headed instead of waited for (m). */
export const CONTESTED = 3;

export type HeaderChoice = { velocity: Vec3; purpose: 'clear' | 'shot' | 'lay-off' | 'down' };

/**
 * What a player does with a ball he meets with his head, from his own picture: clear it when the opponents played
 * it into our half, go for goal in their area, lay it off to a free team-mate nearby, or else head it down to his
 * feet. Returns the velocity the ball should leave his head with; the head and the contact decide the rest.
 */
export function chooseHeader(pic: Picture, ownBall: boolean, contactHeight: number): HeaderChoice {
  const at: Vec2 = { x: pic.ball.pos.x, z: pic.ball.pos.z };
  const sign = pic.sign;
  const u = toTeam(sign, at).u;
  const goalX = sign * PITCH.halfLength;
  if (!ownBall && u < 0) {
    const away = { x: sign, z: at.z >= 0 ? 0.4 : -0.4 }, n = Math.hypot(away.x, away.z);
    const h = CLEAR_PACE * Math.cos(CLEAR_RISE);
    return { velocity: { x: (away.x / n) * h, y: CLEAR_PACE * Math.sin(CLEAR_RISE), z: (away.z / n) * h }, purpose: 'clear' };
  }
  if (Math.hypot(goalX - at.x, at.z) < HEADER_SHOT_RANGE) {
    const keeper = pic.opponents.find(o => o.profile.role === 'GK');
    const side = keeper && keeper.pos.z > at.z * 0.25 ? -1 : 1;
    const aim = { x: goalX, z: side * (PITCH.goalHalfWidth - 0.7) };
    const d = Math.hypot(aim.x - at.x, aim.z - at.z), t = d / HEADER_SHOT_PACE;
    // Aimed down to about half a metre at the line: a header that bounces in front of the keeper.
    const vy = (0.5 - contactHeight + 0.5 * BALL_PHYSICS.gravity * t * t) / t;
    return { velocity: { x: ((aim.x - at.x) / d) * HEADER_SHOT_PACE, y: vy, z: ((aim.z - at.z) / d) * HEADER_SHOT_PACE }, purpose: 'shot' };
  }
  let best: { pos: Vec2; score: number } | null = null;
  for (const m of pic.mates) {
    const d = Math.hypot(m.pos.x - at.x, m.pos.z - at.z);
    if (d < LAY_OFF.min || d > LAY_OFF.max) continue;
    let room = 6;
    for (const o of pic.opponents) room = Math.min(room, Math.hypot(o.pos.x - m.pos.x, o.pos.z - m.pos.z));
    const score = room + 0.05 * sign * (m.pos.x - at.x);
    if (room > 2 && (!best || score > best.score)) best = { pos: m.pos, score };
  }
  if (best) {
    const d = Math.hypot(best.pos.x - at.x, best.pos.z - at.z), pace = Math.min(11, 3 + 0.5 * d), rise = 0.35;
    const h = pace * Math.cos(rise);
    return { velocity: { x: ((best.pos.x - at.x) / d) * h, y: pace * Math.sin(rise), z: ((best.pos.z - at.z) / d) * h }, purpose: 'lay-off' };
  }
  // Down to the own feet: the ball drops a stride in front, away from the nearest pressure.
  const f = { x: pic.pos.x - at.x, z: pic.pos.z - at.z }, fl = Math.hypot(f.x, f.z) || 1;
  return { velocity: { x: (f.x / fl) * 1.2, y: -0.5, z: (f.z / fl) * 1.2 }, purpose: 'down' };
}
