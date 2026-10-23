import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { frameReference, REFERENCE, referencePose } from './reference-camera';

describe('reference camera', () => {
  it('stands behind the ball on the attackers\u2019 right, raised, and looks past the ball towards goal', () => {
    const ball = { x: 32.4, z: 16.3 };
    const f = referencePose(ball, 1);
    // The pose fitted to the client's picture.
    expect(f.position.x).toBeCloseTo(15.5, 1);
    expect(f.position.y).toBeCloseTo(REFERENCE.height, 5);
    expect(f.position.z).toBeCloseTo(43.8, 1);
    expect(f.target.x).toBeGreaterThan(ball.x);
    // Attacking the other way mirrors it.
    const g = referencePose(ball, -1);
    expect(g.position.x).toBeCloseTo(ball.x + REFERENCE.back, 5);
    expect(g.position.z).toBeCloseTo(ball.z - REFERENCE.right, 5);
  });

  it('keeps the reference distance when everything fits, and moves back along the same line of sight when not', () => {
    const ball = { x: 32, y: 0.11, z: 10 };
    const safe = { left: -0.85, right: 0.97, bottom: -0.5, top: 0.8 };
    const close = frameReference([ball, { x: 36, y: 0, z: 8 }], ball, 1, 16 / 9, safe);
    expect(close.position.distanceTo(referencePose(ball, 1).position)).toBeLessThan(0.5);
    const wide = frameReference([ball, { x: 10, y: 0, z: -25 }], ball, 1, 16 / 9, safe);
    const dir = (f: { position: THREE.Vector3; target: THREE.Vector3 }) => f.target.clone().sub(f.position).normalize();
    expect(dir(wide).angleTo(dir(close))).toBeLessThan(0.02);
    expect(wide.position.distanceTo(wide.target)).toBeGreaterThan(close.position.distanceTo(close.target));
  });
});
