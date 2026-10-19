import type { Vec2 } from '../engine/types';
import { inPenaltyArea } from '../physics/pitch-geometry';

/** Slowest run a slide starts from (m/s): a slide is a lunge, not a fall from a standstill. */
const MIN_RUN = 3.5;
/** The ball must be this far ahead when the slide starts: beyond a poke, within the slide (≈ 2 m in 0.4 s) plus the stretched leg (m). */
const REACH = { min: 1.3, max: 3.5 } as const;
/** Where the ball will be when the leg gets there (s). */
const LEAD = 0.35;
/** Largest angle between the run and the ball: the slide goes along the run (rad). */
const MAX_TURN = 0.6;
/** Cosine beyond which the defender is at the carrier's back (the referee's "from behind" starts at −0.5). */
const BEHIND = -0.6;
/**
 * A carrier breaking away: at least this fast overall and towards the defender's goal (m/s). Triggered whenever a
 * carrier merely got past, defenders slid 120–250 times per 90 minutes (real: about 10–15).
 */
const BREAK_PACE = 4, BREAK_TOWARDS_GOAL = 2;
/** The defender counts as level with the carrier up to this far goal-side of him (m). */
const LEVEL = 1;

/**
 * Last resort against a carrier level with or past the defender, breaking towards goal: slide along the run and
 * stretch a leg to the ball. Only when running already, the ball within the leg's reach but beyond a poke, never
 * from behind (the referee would see the man taken, not the ball) and never in the own penalty area (a penalty).
 * Returns the slide direction, or null.
 */
export function slideDirection(self: Vec2, vel: Vec2, ball: { pos: Vec2; vel: Vec2 }, carrier: Vec2, carrierVel: Vec2, ownGoalSide: 1 | -1): Vec2 | null {
  const run = Math.hypot(vel.x, vel.z);
  if (run < MIN_RUN || inPenaltyArea(self.x, self.z, ownGoalSide)) return null;
  // Level or beaten: the carrier is (about) as near the own goal as the defender, and breaking towards it.
  if ((carrier.x - self.x) * ownGoalSide <= -LEVEL) return null;
  if (Math.hypot(carrierVel.x, carrierVel.z) < BREAK_PACE || carrierVel.x * ownGoalSide < BREAK_TOWARDS_GOAL) return null;
  const at = { x: ball.pos.x + ball.vel.x * LEAD, z: ball.pos.z + ball.vel.z * LEAD };
  const dx = at.x - self.x, dz = at.z - self.z, d = Math.hypot(dx, dz);
  if (d < REACH.min || d > REACH.max) return null;
  const turn = Math.acos(Math.max(-1, Math.min(1, (dx * vel.x + dz * vel.z) / (d * run))));
  if (turn > MAX_TURN) return null;
  // From behind: the defender is at the carrier's back, in the direction he came from.
  const cx = self.x - carrier.x, cz = self.z - carrier.z, cd = Math.hypot(cx, cz) || 1;
  const cs = Math.hypot(carrierVel.x, carrierVel.z);
  if (cs > 1 && (cx * carrierVel.x + cz * carrierVel.z) / (cd * cs) < BEHIND) return null;
  // Only when he is getting past; a carrier running at the defender is jockeyed, not tackled on the ground.
  if ((carrierVel.x * -cx + carrierVel.z * -cz) / cd <= 0) return null;
  return { x: dx / d, z: dz / d };
}
