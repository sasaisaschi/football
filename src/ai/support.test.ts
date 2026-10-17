import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../engine/types';
import { supportSpot, type SupportView } from './support';

/** Team attacks +X. Player 1 is on the ball at the centre spot, 2 and 3 are nearest, 4 is far away. */
const players: Record<number, Vec2> = { 1: { x: -0.5, z: 0 }, 2: { x: -8, z: 6 }, 3: { x: -6, z: -9 }, 4: { x: -35, z: 20 } };
const view = (self: number, opponents: Vec2[], offsideLineU = 0.6): SupportView => ({
  self: { id: self, pos: players[self] },
  sign: 1,
  ball: { x: 0, z: 0 },
  mates: Object.entries(players).filter(([id]) => Number(id) !== self).map(([id, pos]) => ({ id: Number(id), pos })),
  opponents,
  offsideLineU,
  shape: players[self],
});
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
const laneGap = (spot: Vec2, o: Vec2) => {
  const t = Math.max(0, Math.min(1, (o.x * spot.x + o.z * spot.z) / (spot.x * spot.x + spot.z * spot.z)));
  return Math.hypot(spot.x * t - o.x, spot.z * t - o.z);
};

describe('support play', () => {
  it('the two nearest team-mates offer themselves at short range in different places; the carrier and far players do not', () => {
    const opponents = [{ x: 3, z: 1 }];
    expect(supportSpot(view(1, opponents))).toBeNull();
    expect(supportSpot(view(4, opponents))).toBeNull();
    const a = supportSpot(view(2, opponents))!, b = supportSpot(view(3, opponents))!;
    for (const s of [a, b]) {
      expect(dist(s, { x: 0, z: 0 })).toBeGreaterThan(8.5);
      expect(dist(s, { x: 0, z: 0 })).toBeLessThan(13.5);
    }
    expect(dist(a, b)).toBeGreaterThanOrEqual(7);
  });

  it('chooses an open passing lane, never one an opponent stands in, and stays onside', () => {
    // Opponents close the lanes ahead-left and ahead; the offside line is level with the ball.
    const opponents = [{ x: 5, z: 4 }, { x: 6, z: 0 }, { x: 5, z: -4 }];
    for (const self of [2, 3]) {
      const s = supportSpot(view(self, opponents, 0))!;
      expect(s.x).toBeLessThanOrEqual(0.6);
      for (const o of opponents) expect(laneGap(s, o)).toBeGreaterThan(1.5);
    }
  });
});
