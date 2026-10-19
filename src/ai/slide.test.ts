import { describe, expect, it } from 'vitest';
import { slideDirection } from './slide';

// The defender's own goal is at −X (ownGoalSide −1); the carrier breaks towards it along −X.
const carrierVel = { x: -6, z: 0 };
const ball = { pos: { x: -20.9, z: 0 }, vel: { x: -6, z: 0 } };

describe('when a defender slides', () => {
  it('in a race beside the carrier breaking towards goal: along his run to the ball', () => {
    const dir = slideDirection({ x: -20, z: 1 }, { x: -6, z: -0.6 }, ball, { x: -20.5, z: 0 }, carrierVel, -1);
    expect(dir).not.toBeNull();
    expect(dir!.x).toBeLessThan(-0.8);
  });

  it('not from behind, not against a carrier coming at him, not in his own penalty area', () => {
    // Behind the carrier, chasing along his line.
    expect(slideDirection({ x: -18.4, z: 0 }, { x: -6.5, z: 0 }, ball, { x: -20.5, z: 0 }, carrierVel, -1)).toBeNull();
    // Goal-side of a carrier running at him: he jockeys.
    expect(slideDirection({ x: -23.5, z: 0.3 }, { x: 4, z: 0 }, { pos: { x: -21.5, z: 0 }, vel: { x: -6, z: 0 } }, { x: -21, z: 0 }, carrierVel, -1)).toBeNull();
    // The same race inside his own penalty area.
    expect(slideDirection({ x: -40, z: 1 }, { x: -6, z: -0.6 }, { pos: { x: -40.9, z: 0 }, vel: { x: -6, z: 0 } }, { x: -40.5, z: 0 }, carrierVel, -1)).toBeNull();
  });
});
