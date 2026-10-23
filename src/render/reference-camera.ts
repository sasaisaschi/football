import * as THREE from 'three';
import type { Vec3 } from '../engine/types';
import { cameraAllowed, type Framing, type SafeArea } from './framing';

/**
 * The client's reference picture as a camera rule (the graphics standard of every open-play scene). Fitted to the
 * reference image by least squares on its pitch markings (posts, crossbar, six-yard box, penalty area corners, the
 * arc's ends) together with the players' heights (the picture's lines alone are not consistent with its figure
 * sizes; the fit is scripts/reference/camera-fit.mjs). Expressed in the attack frame of the ball: `back` metres
 * behind the ball (away from the goal attacked), `right` metres to the attackers' right, `height` metres up; it looks
 * at a point `ahead` metres towards goal and `inside` metres towards the pitch centre line of the ball. Vertical field
 * of view 22.6°. In the reference the ball carrier stands just below the middle of the picture and the goal is at the
 * top right.
 */
export const REFERENCE = { back: 16.9, right: 27.5, height: 12.2, ahead: 4.35, inside: 5.4, fov: 22.6 } as const;

/** The reference pose for a ball, attacking towards +x (`sign` 1) or −x (−1); `scale` > 1 moves the camera back along its line of sight. */
export function referencePose(ball: { x: number; z: number }, sign: 1 | -1, scale = 1): Framing {
  const target = new THREE.Vector3(ball.x + REFERENCE.ahead * sign, 0, ball.z - REFERENCE.inside * sign);
  const position = new THREE.Vector3(ball.x - REFERENCE.back * sign, REFERENCE.height, ball.z + REFERENCE.right * sign);
  // Further back along the same line of sight: the angle stays the reference's, only the distance grows.
  if (scale !== 1) position.sub(target).multiplyScalar(scale).add(target);
  return { position, target };
}

/**
 * The camera may not stand inside a stand: it is moved towards the ball along its line of sight until the stadium
 * allows it there (the ball near the touchline on the camera's side puts the reference position over the terraces).
 */
export function allowedPose(f: Framing): Framing {
  const p = f.position.clone();
  for (let i = 0; i < 60 && !cameraAllowed(p); i++) p.lerp(f.target, 0.04);
  return { position: p, target: f.target };
}

const camera = new THREE.PerspectiveCamera();
const v = new THREE.Vector3();

function fits(points: readonly Vec3[], safe: SafeArea): boolean {
  camera.updateMatrixWorld(true);
  for (const p of points) {
    v.set(p.x, p.y, p.z).project(camera);
    if (v.z > 1 || v.x < safe.left || v.x > safe.right || v.y < safe.bottom || v.y > safe.top) return false;
  }
  return true;
}

/**
 * The frozen decision in the reference composition: the same angle and lens as the reference, moved back only as far
 * as needed for every relevant point (players involved, option targets) to lie in the free part of the picture; if
 * the ball alone in the reference spot cannot show them all, the view is also shifted a little towards them.
 */
export function frameReference(points: readonly Vec3[], ball: Vec3, sign: 1 | -1, aspect: number, safe: SafeArea): Framing {
  camera.fov = REFERENCE.fov;
  camera.aspect = aspect;
  camera.near = 0.5;
  camera.far = 600;
  camera.updateProjectionMatrix();
  const centre = points.reduce((c, p) => ({ x: c.x + p.x / points.length, z: c.z + p.z / points.length }), { x: 0, z: 0 });
  let best: { cost: number; f: Framing } | null = null;
  for (const pan of [0, 0.15, 0.3, 0.45, 0.6, 0.8, 1]) {
    const anchor = { x: ball.x + (centre.x - ball.x) * pan, z: ball.z + (centre.z - ball.z) * pan };
    const at = (scale: number) => {
      const f = allowedPose(referencePose(anchor, sign, scale));
      camera.position.copy(f.position);
      camera.lookAt(f.target);
      return f;
    };
    at(3);
    if (!fits(points, safe)) continue;
    let lo = 1, hi = 3;
    at(1);
    if (fits(points, safe)) hi = 1;
    else for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; at(mid); if (fits(points, safe)) hi = mid; else lo = mid; }
    const f = at(hi);
    // Closer is better (the players stay as large as in the reference); turning the view a little is cheaper than that.
    const cost = hi * (1 + pan * 0.2);
    if (!best || cost < best.cost) best = { cost, f };
  }
  return best?.f ?? allowedPose(referencePose(ball, sign, 3));
}
