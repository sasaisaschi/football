import type { Vec3 } from '../engine/types';

/**
 * IFAB Laws of the Game, Law 1 (2025/26) reference pitch. Lines are part of the area they bound,
 * so field dimensions are measured to the outer edges of the lines.
 */
export const PITCH = {
  length: 105,
  width: 68,
  halfLength: 52.5,
  halfWidth: 34,
  lineWidth: 0.12,
  goalHalfWidth: 3.66,
  goalHeight: 2.44,
  postRadius: 0.06,
  goalDepth: 2,
  penaltyAreaDepth: 16.5,
  penaltyAreaHalfWidth: 20.16,
  goalAreaDepth: 5.5,
  goalAreaHalfWidth: 9.16,
  penaltyMark: 11,
  centreCircleRadius: 9.15,
  cornerArcRadius: 1,
  runOff: 6,
} as const;

/** Law 2: size-5 ball, circumference 68–70 cm, 410–450 g. */
export const BALL_SPEC = { radius: 0.11, mass: 0.43 } as const;

/** Direction a team attacks in a given half: team 0 attacks +X in the first half. */
export function attackSign(team: 0 | 1, half: 1 | 2): 1 | -1 {
  return (team === 0) === (half === 1) ? 1 : -1;
}

/** Law 10: the whole ball has passed over the goal line between the posts and under the crossbar. */
export function goalCrossed(p: Vec3): -1 | 0 | 1 {
  if (Math.abs(p.x) <= PITCH.halfLength + BALL_SPEC.radius) return 0;
  if (Math.abs(p.z) >= PITCH.goalHalfWidth || p.y >= PITCH.goalHeight) return 0;
  return p.x > 0 ? 1 : -1;
}

/** Law 9: the whole ball has crossed a touch line or a goal line (outside the goal). */
export function ballOut(p: Vec3): { line: 'touch' | 'goal'; side: -1 | 1 } | null {
  if (Math.abs(p.z) > PITCH.halfWidth + BALL_SPEC.radius) return { line: 'touch', side: p.z > 0 ? 1 : -1 };
  if (Math.abs(p.x) > PITCH.halfLength + BALL_SPEC.radius && goalCrossed(p) === 0) return { line: 'goal', side: p.x > 0 ? 1 : -1 };
  return null;
}

export function inPenaltyArea(x: number, z: number, goalSide: -1 | 1): boolean {
  return goalSide * x >= PITCH.halfLength - PITCH.penaltyAreaDepth && goalSide * x <= PITCH.halfLength && Math.abs(z) <= PITCH.penaltyAreaHalfWidth;
}
