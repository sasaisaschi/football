import { describe, expect, it } from 'vitest';
import type { PlayerView } from '../engine/types';
import { lerpPlayer } from './interpolate';

const at = (x: number, z = 0): PlayerView => ({
  id: 0, position: { x, y: 0.9, z }, velocity: { x: 6, y: 0, z: 0 }, heading: Math.PI / 2,
  boots: [{ x: x + 0.1, y: 0.05, z }, { x: x - 0.1, y: 0.05, z }], swingingBoot: -1, hands: null, upperBody: null, lying: 0, booked: 'none', sentOff: false,
});

describe('player between two ticks', () => {
  it('moves evenly over the whole interval, boots with the body', () => {
    const a = at(0), b = at(0.1);
    for (const t of [0.25, 0.5, 0.75]) {
      const p = lerpPlayer(a, b, t);
      expect(p.position.x).toBeCloseTo(0.1 * t, 6);
      expect(p.boots[0].x).toBeCloseTo(0.1 + 0.1 * t, 6);
    }
  });

  it('does not slide a player who was placed (restart)', () => {
    expect(lerpPlayer(at(0), at(20), 0.3).position.x).toBe(20);
  });
});
