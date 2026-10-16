import RAPIER from '@dimforge/rapier3d-simd-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { BALL, applyBallDrag, createBall } from './ball';
import { PITCH, createPitchPhysics, goalSide, outOfPlay } from './pitch';

beforeAll(async () => {
  await RAPIER.init();
});

function shoot(from: { x: number; y: number; z: number }, velocity: { x: number; y: number; z: number }, seconds = 1.5) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  createPitchPhysics(world);
  const ball = createBall(world);
  ball.setTranslation(from, true);
  ball.setLinvel(velocity, true);
  let scored: number = 0;
  for (let t = 0; t < seconds; t += 1 / 60) {
    applyBallDrag(ball);
    world.step();
    scored ||= goalSide(ball.translation());
  }
  return { ball, scored };
}

describe('goal and out-of-play geometry (Laws 9 and 10)', () => {
  const r = BALL.radius;
  it('counts a goal only when the whole ball is over the line', () => {
    expect(goalSide({ x: PITCH.halfLength + r - 0.01, y: r, z: 0 })).toBe(0);
    expect(goalSide({ x: PITCH.halfLength + r + 0.01, y: r, z: 0 })).toBe(1);
    expect(goalSide({ x: -PITCH.halfLength - r - 0.01, y: r, z: 1 })).toBe(-1);
  });
  it('rejects balls wide of the posts or over the bar', () => {
    expect(goalSide({ x: PITCH.halfLength + 0.5, y: r, z: PITCH.goalHalfWidth + 0.2 })).toBe(0);
    expect(goalSide({ x: PITCH.halfLength + 0.5, y: PITCH.goalHeight + 0.2, z: 0 })).toBe(0);
  });
  it('detects touch line and goal line exits', () => {
    expect(outOfPlay({ x: 0, y: r, z: PITCH.halfWidth + r - 0.01 })).toBeNull();
    expect(outOfPlay({ x: 10, y: r, z: PITCH.halfWidth + r + 0.01 })?.line).toBe('touch');
    expect(outOfPlay({ x: PITCH.halfLength + r + 0.01, y: r, z: 10 })?.line).toBe('goal');
    expect(outOfPlay({ x: PITCH.halfLength + r + 0.01, y: r, z: 0 })).toBeNull();
  });
});

describe('goal frame physics', () => {
  it('a shot into the goal is caught by the net and counted', () => {
    const { ball, scored } = shoot({ x: 40, y: 0.5, z: 0 }, { x: 25, y: 1, z: 0 });
    expect(scored).toBe(1);
    expect(ball.translation().x).toBeLessThan(PITCH.halfLength + PITCH.goalDepth + 0.2);
  });
  it('a shot onto the post rebounds instead of passing through', () => {
    const postZ = PITCH.goalHalfWidth + PITCH.postRadius;
    const { ball, scored } = shoot({ x: 45, y: 1, z: postZ }, { x: 28, y: 0, z: 0 }, 0.6);
    expect(scored).toBe(0);
    expect(ball.linvel().x).toBeLessThan(0);
  });
  it('a shot onto the crossbar rebounds', () => {
    const { ball } = shoot({ x: 45, y: PITCH.goalHeight + PITCH.postRadius, z: 0 }, { x: 28, y: 0, z: 0 }, 0.4);
    expect(ball.linvel().x).toBeLessThan(0);
  });
});
