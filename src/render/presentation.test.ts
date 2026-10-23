import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { MatchSnapshot } from '../engine/types';
import { PITCH } from '../physics/pitch-geometry';
import { CameraDirector } from './camera-director';

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
