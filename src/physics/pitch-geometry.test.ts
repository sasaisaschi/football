import { describe, expect, it } from 'vitest';
import { createRng } from '../engine/rng';
import { BALL_SPEC, PITCH, attackSign, ballOut, goalCrossed, inPenaltyArea } from './pitch-geometry';

describe('IFAB geometry (Laws 1, 9, 10)', () => {
  const r = BALL_SPEC.radius;
  it('uses a 105 × 68 m field with a 7.32 × 2.44 m goal', () => {
    expect(PITCH.length).toBe(105);
    expect(PITCH.width).toBe(68);
    expect(PITCH.goalHalfWidth * 2).toBeCloseTo(7.32);
    expect(PITCH.penaltyAreaHalfWidth * 2).toBeCloseTo(7.32 + 2 * 16.5);
  });
  it('counts a goal only when the whole ball is over the line, between posts, under the bar', () => {
    expect(goalCrossed({ x: PITCH.halfLength + r - 0.001, y: r, z: 0 })).toBe(0);
    expect(goalCrossed({ x: PITCH.halfLength + r + 0.001, y: r, z: 0 })).toBe(1);
    expect(goalCrossed({ x: -PITCH.halfLength - r - 0.001, y: 1, z: -3 })).toBe(-1);
    expect(goalCrossed({ x: PITCH.halfLength + 0.5, y: 2.5, z: 0 })).toBe(0);
    expect(goalCrossed({ x: PITCH.halfLength + 0.5, y: 1, z: 3.7 })).toBe(0);
  });
  it('distinguishes touch-line and goal-line exits', () => {
    expect(ballOut({ x: 0, y: r, z: PITCH.halfWidth + r - 0.001 })).toBeNull();
    expect(ballOut({ x: 0, y: r, z: -PITCH.halfWidth - r - 0.001 })).toEqual({ line: 'touch', side: -1 });
    expect(ballOut({ x: PITCH.halfLength + r + 0.01, y: r, z: 10 })).toEqual({ line: 'goal', side: 1 });
    expect(ballOut({ x: PITCH.halfLength + r + 0.01, y: r, z: 0 })).toBeNull();
  });
  it('switches ends at half-time and knows the penalty areas', () => {
    expect(attackSign(0, 1)).toBe(1);
    expect(attackSign(0, 2)).toBe(-1);
    expect(attackSign(1, 1)).toBe(-1);
    expect(inPenaltyArea(40, 0, 1)).toBe(true);
    expect(inPenaltyArea(30, 0, 1)).toBe(false);
    expect(inPenaltyArea(-40, 0, 1)).toBe(false);
  });
});

describe('seeded randomness', () => {
  it('repeats exactly from a seed and from a saved state', () => {
    const a = createRng(42), b = createRng(42);
    const seqA = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(seqA);
    const saved = a.state();
    const after = a.next();
    expect(createRng(0, saved).next()).toBe(after);
    expect(createRng(43).next()).not.toBe(createRng(42).next());
  });
});
