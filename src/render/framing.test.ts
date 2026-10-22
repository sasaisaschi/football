import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../engine/types';
import { PITCH } from '../physics/pitch-geometry';
import { STANDS } from '../physics/pitch-colliders';
import { cameraAllowed, frameMoment, projectWith, type SafeArea } from './framing';

/** 1600 × 900 with the decision panel on the right (≈ 400 px) and the score bar on top. */
const ASPECT = 16 / 9, FOV = 36;
const SAFE: SafeArea = { left: -0.94, right: 0.42, bottom: -0.86, top: 0.72 };

/** A player as head and feet, so the whole body has to be in the picture. */
const body = (x: number, z: number): Vec3[] => [{ x, y: 0, z }, { x, y: 1.9, z }];

const cases: Record<string, Vec3[]> = {
  'throw-in at the near touchline': [...body(14, PITCH.halfWidth + 0.32), { x: 14, y: 2.3, z: PITCH.halfWidth + 0.3 }, ...body(24, 27), ...body(9, 24), ...body(22, 25)],
  'throw-in at the far touchline': [...body(-20, -PITCH.halfWidth - 0.32), ...body(-12, -27), ...body(-28, -25)],
  'corner at the near flag': [...body(52.5, 34), ...body(48.5, 2.5), ...body(47, -3.5), ...body(34, -3), ...body(43.5, 31), ...body(51.5, 0), ...body(47, 2)],
  'attack in the box': [...body(36, -2), ...body(44, -12), ...body(43, 9), ...body(40, -4), ...body(41, 5), ...body(51.5, 0)],
  'box defence at the own goal': [...body(-31, 2), ...body(-35, 1), ...body(-51, 0), ...body(-29, 8)],
  'breakaway towards the own goal': [...body(-22, -10), ...body(-25, -9), ...body(-51, 0), ...body(-18, -6), ...body(-30, -12)],
  'counter-press in the opponents half': [...body(25, 14), ...body(26, 15), ...body(22, 10), ...body(30, 20), ...body(20, 18)],
};

describe('decision camera framing', () => {
  for (const [name, points] of Object.entries(cases)) {
    it(`${name}: every relevant point inside the free part of the image, camera inside the bowl`, () => {
      const attack = points[0].x < 0 ? -1 : 1;
      const f = frameMoment(points, attack as 1 | -1, ASPECT, FOV, SAFE);
      for (const p of points) {
        const s = projectWith(f, ASPECT, FOV, p);
        expect(s.x).toBeGreaterThanOrEqual(SAFE.left);
        expect(s.x).toBeLessThanOrEqual(SAFE.right);
        expect(s.y).toBeGreaterThanOrEqual(SAFE.bottom);
        expect(s.y).toBeLessThanOrEqual(SAFE.top);
      }
      // Above the terraces where it stands, under the roofs, never behind the back walls.
      expect(cameraAllowed(f.position)).toBe(true);
      expect(Math.abs(f.position.x)).toBeLessThan(STANDS.x + 24);
      expect(Math.abs(f.position.z)).toBeLessThan(STANDS.z + 24);
      expect(f.position.y).toBeGreaterThan(4);
    });
  }
});

describe('decision camera framing on a narrow screen', () => {
  it('when not everything fits above the bottom panel, the ball and the acting player still do', () => {
    // 800 × 900 with the panel over the lower 42 %: box defence with the shot line to the goal.
    const aspect = 800 / 900, safe: SafeArea = { left: -0.92, right: 0.84, bottom: -0.05, top: 0.75 };
    const points: Vec3[] = [{ x: -30.6, y: 0.11, z: 2 }, ...body(-35, 1), ...body(-31, 2), ...body(-51, 0), ...body(-22, -14), ...body(-40, 18), { x: -52.5, y: 1.2, z: 0 }];
    const f = frameMoment(points, -1, aspect, FOV, safe);
    expect(cameraAllowed(f.position)).toBe(true);
    for (const p of points.slice(0, 3)) {
      const s = projectWith(f, aspect, FOV, p);
      expect(s.x).toBeGreaterThanOrEqual(safe.left);
      expect(s.x).toBeLessThanOrEqual(safe.right);
      expect(s.y).toBeGreaterThanOrEqual(safe.bottom);
      expect(s.y).toBeLessThanOrEqual(safe.top);
    }
  });
});
