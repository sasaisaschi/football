import { describe, expect, it } from 'vitest';
import type { PlayerView } from '../engine/types';
import { lerpPlayers } from './interpolate';

function player(x: number, id = 0): PlayerView {
  return {
    id, position: { x, y: 0.9, z: 0 }, velocity: { x: 1, y: 0, z: 0 }, heading: 0,
    boots: [{ x: x + 0.12, y: 0.05, z: 0 }, { x: x - 0.12, y: 0.05, z: 0 }],
    swingingBoot: -1, hands: null, upperBody: null, lying: 0, booked: 'none', sentOff: false,
  };
}

describe('3D scene frame interpolation', () => {
  it('moves from the first tick continuously through both halves of a frame', () => {
    const a = [player(0)], b = [player(1)];
    for (const alpha of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const p = lerpPlayers(a, b, alpha)[0];
      expect(p.position.x).toBeCloseTo(alpha);
      expect(p.boots[0].x).toBeCloseTo(0.12 + alpha);
      expect(p.boots[1].x).toBeCloseTo(-0.12 + alpha);
    }
  });

  it('keeps each player paired with their next-tick state', () => {
    const out = lerpPlayers([player(0, 0), player(10, 1)], [player(2, 0), player(11, 1)], 0.25);
    expect(out.map(p => p.position.x)).toEqual([0.5, 10.25]);
  });

  it('does not animate a player teleported to a restart location across the pitch', () => {
    expect(lerpPlayers([player(0)], [player(12)], 0.25)[0].position.x).toBe(12);
  });
});
