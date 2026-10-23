import RAPIER from '@dimforge/rapier3d-simd-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { createRoster } from '../engine/rosters';
import { maxFacingOffset, NECK_TURN, PlayerBody } from './body';
import { PhysicsWorld } from './world';

beforeAll(async () => {
  await RAPIER.init();
});

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** An outfield player runs along +X at `speed` while he wants to face a point behind him (the ball). */
function run(speed: number, id = 9) {
  const w = new PhysicsWorld();
  const roster = createRoster(3);
  const body = new PlayerBody(w.world, roster[id], 0, 0, Math.PI / 2);
  for (let i = 0; i < 120; i++) {
    const p = body.position();
    body.drive({ target: { x: p.x + 30, z: 0 }, speed, face: { x: p.x - 20, z: 0 } }, 1 / 60);
    w.step();
  }
  return body;
}

describe('facing and running direction', () => {
  it('limits how far the body faces away from where it runs, by pace', () => {
    expect(maxFacingOffset(1.5)).toBeCloseTo(Math.PI);
    expect(maxFacingOffset(3.5)).toBeCloseTo(Math.PI / 2);
    expect(maxFacingOffset(7)).toBeCloseTo(0.35);
  });

  it('a fast run faces forwards and looks back over the shoulder; a slow one may backpedal', () => {
    const fast = run(7);
    const ahead = Math.PI / 2; // running along +X
    expect(Math.abs(wrap(fast.heading - ahead))).toBeLessThanOrEqual(maxFacingOffset(fast.speed()) + 0.05);
    // The head turns towards what he wants to see, as far as a neck can.
    expect(Math.abs(wrap(fast.gaze - fast.heading))).toBeCloseTo(NECK_TURN, 1);
    const slow = run(1.6);
    expect(Math.abs(wrap(slow.heading + Math.PI / 2))).toBeLessThan(0.1); // faces the point behind him: a backpedal
  });

  it('a keeper keeps facing the play at any pace', () => {
    const keeper = run(6, 0);
    expect(Math.abs(wrap(keeper.heading + Math.PI / 2))).toBeLessThan(0.1);
  });
});
