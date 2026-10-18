import RAPIER from '@dimforge/rapier3d-simd-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { BALL_SPEC } from '../physics/pitch-geometry';
import { PhysicsWorld } from '../physics/world';
import { aerialIntercept, CONTROL_HEIGHT } from './aerial';

beforeAll(async () => {
  await RAPIER.init();
});

/** Where the simulated ball first comes down to a playable height after being in the air. */
function physicsDrop(speed: number, elevation: number) {
  const w = new PhysicsWorld();
  w.ball.setTranslation({ x: 0, y: BALL_SPEC.radius, z: 0 }, true);
  w.ball.setLinvel({ x: speed * Math.cos(elevation), y: speed * Math.sin(elevation), z: 0 }, true);
  let up = false;
  for (let i = 1; i < 60 * 5; i++) {
    w.step();
    const p = w.ball.translation(), v = w.ball.linvel();
    if (p.y > 1) up = true;
    if (up && v.y < 0 && p.y <= CONTROL_HEIGHT) return { t: i / 60, x: p.x };
  }
  throw new Error('ball never came down');
}

describe('meeting a ball in the air', () => {
  it('predicts where a lofted pass first comes down to a playable height, as the physics has it', () => {
    for (const [speed, el] of [[15, 0.42], [22, 0.42], [18, 0.3]]) {
      const drop = physicsDrop(speed, el);
      // A player standing right there meets it on its way down.
      const meet = aerialIntercept({ x: drop.x, z: 0 }, 8, { x: 0, y: BALL_SPEC.radius, z: 0 }, { x: speed * Math.cos(el), y: speed * Math.sin(el), z: 0 })!;
      expect(Math.abs(meet.at.x - drop.x)).toBeLessThan(1.5);
      expect(Math.abs(meet.t - drop.t)).toBeLessThan(0.15);
    }
  });

  it('sends a player who is far away to a later point of the flight he can still reach', () => {
    const ball = { x: 0, y: BALL_SPEC.radius, z: 0 }, vel = { x: 15 * Math.cos(0.42), y: 15 * Math.sin(0.42), z: 0 };
    const near = aerialIntercept({ x: 16, z: 0 }, 8, ball, vel)!;
    const far = aerialIntercept({ x: 16, z: 15 }, 8, ball, vel)!;
    expect(far.t).toBeGreaterThan(near.t);
    expect(far.at.x).toBeGreaterThan(near.at.x);
  });

  it('leaves a ball on the ground to the rolling-ball estimate', () => {
    expect(aerialIntercept({ x: 5, z: 0 }, 8, { x: 0, y: BALL_SPEC.radius, z: 0 }, { x: 8, y: 0, z: 0 })).toBeNull();
  });
});
