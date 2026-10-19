import RAPIER from '@dimforge/rapier3d-simd-compat';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/match-engine';
import type { MatchSnapshot } from '../engine/types';
import { PITCH } from '../physics/pitch-geometry';
import { CameraDirector } from './camera-director';
import { atStake } from './time-lapse';

beforeAll(async () => {
  await RAPIER.init();
});

/** The main broadcast shot settled on a ball at rest at (x, z); returns the camera (16:9 like the browser test). */
function settledOn(x: number, z: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 900);
  const director = new CameraDirector(camera);
  const s = { ball: { position: { x, y: 0.11, z }, velocity: { x: 0, y: 0, z: 0 } }, players: [], moment: null } as unknown as MatchSnapshot;
  for (let i = 0; i < 600; i++) director.update(s, i / 60, 1 / 60);
  camera.updateMatrixWorld();
  return camera;
}
/** Vertical screen position, −1 bottom … +1 top. */
const screenY = (camera: THREE.PerspectiveCamera, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).project(camera).y;

describe('broadcast camera', () => {
  it('shows a throw-in at the near touchline in full: the thrower\'s feet and the ball above his head', () => {
    // The thrower stands 0.32 m behind the line; the status line covers the bottom 10 % of the image.
    const camera = settledOn(10, PITCH.halfWidth - 0.11);
    for (const y of [0, 2.4]) expect(screenY(camera, 10, y, PITCH.halfWidth + 0.32)).toBeGreaterThan(-0.8);
  });

  it('shows a throw-in at the far touchline in full', () => {
    const camera = settledOn(-10, -(PITCH.halfWidth - 0.11));
    for (const y of [0, 2.4]) {
      const sy = screenY(camera, -10, y, -(PITCH.halfWidth + 0.32));
      expect(sy).toBeGreaterThan(-0.8);
      expect(sy).toBeLessThan(0.95);
    }
  });
});

describe('time-lapse', () => {
  it('only in quiet open play: not at a set piece, not for a ball in the air, not in a challenge', () => {
    const e = new MatchEngine({ seed: 3, halfMinutes: 45 });
    const base = e.snapshot();
    const quiet: MatchSnapshot = { ...base, phase: 'in-play', ball: { ...base.ball, position: { x: 0, y: 0.11, z: 20 } } };
    expect(atStake(quiet, e.profiles)).toBe(false);
    expect(atStake({ ...quiet, phase: 'stopped' }, e.profiles)).toBe(true);
    expect(atStake({ ...quiet, ball: { ...quiet.ball, position: { x: 0, y: 2, z: 20 } } }, e.profiles)).toBe(true);
    // A player of each team at the ball: a challenge.
    const a = e.profiles.find(p => p.team === 0)!.id, b = e.profiles.find(p => p.team === 1)!.id;
    const players = quiet.players.map(p => (p.id === a ? { ...p, position: { x: 0.8, y: 0.9, z: 20 } } : p.id === b ? { ...p, position: { x: -1, y: 0.9, z: 20.5 } } : p));
    expect(atStake({ ...quiet, players }, e.profiles)).toBe(true);
  });
});
