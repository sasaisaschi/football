import type { MatchSnapshot, TeamId } from '../engine/types';

/** Seconds of calm before time-lapse starts. */
export const CALM_SECONDS = 3;
/** Beyond this distance from the halfway line play is near a box (m). */
const MIDDLE_THIRD = 22;
/** A ball this high is in the air: a cross, a clearance, a header (m). */
const AIRBORNE = 1;
/** Players of both teams this close to the ball: a challenge (m). */
const CHALLENGE = 2.5;

/** Is the ball being challenged for: a player of each team close to it? */
export function contested(s: MatchSnapshot, profiles: readonly { team: TeamId }[]): boolean {
  const near = [false, false];
  for (const p of s.players) {
    if (p.sentOff) continue;
    if (Math.hypot(p.position.x - s.ball.position.x, p.position.z - s.ball.position.z) < CHALLENGE) near[profiles[p.id].team] = true;
  }
  return near[0] && near[1];
}

/**
 * Is something happening that must be watched at normal pace: play near a box, a set piece or any dead ball, a ball
 * in the air, or a challenge for the ball. Time-lapse is only for the rest. Before, challenges in midfield and every
 * set piece (after 2 s) ran at three times the pace.
 */
export function atStake(s: MatchSnapshot, profiles: readonly { team: TeamId }[]): boolean {
  const b = s.ball.position;
  return Math.abs(b.x) > MIDDLE_THIRD || s.phase !== 'in-play' || b.y > AIRBORNE || contested(s, profiles);
}
