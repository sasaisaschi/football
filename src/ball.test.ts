import RAPIER from '@dimforge/rapier3d-simd-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { BALL, applyBallDrag, createBall } from './ball';

beforeAll(async () => {
  await RAPIER.init();
});

describe('ball drag', () => {
  it('slows a flying ball without ever reversing it (no accumulated force)', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    world.timestep = 1 / 60;
    const ball = createBall(world);
    ball.setLinvel({ x: 25, y: 0, z: 0 }, true);
    let previous = 25;
    for (let i = 0; i < 600; i++) {
      applyBallDrag(ball);
      world.step();
      const vx = ball.linvel().x;
      expect(vx).toBeGreaterThan(0);
      expect(vx).toBeLessThanOrEqual(previous + 1e-9);
      previous = vx;
    }
    const force = ball.userForce();
    expect(Math.hypot(force.x, force.y, force.z)).toBeLessThan(0.5);
  });

  it('applies the expected quadratic drag magnitude at 20 m/s', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const ball = createBall(world);
    ball.setLinvel({ x: 20, y: 0, z: 0 }, true);
    applyBallDrag(ball);
    const expected = 0.5 * BALL.airDensity * BALL.dragCoefficient * Math.PI * BALL.radius ** 2 * 400;
    expect(ball.userForce().x).toBeCloseTo(-expected, 5);
  });
});
