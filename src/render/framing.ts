import * as THREE from 'three';
import type { Vec3 } from '../engine/types';
import { STANDS } from '../physics/pitch-colliders';

/** Part of the image left free by the interface, in normalised device coordinates (−1 … 1). */
export type SafeArea = { left: number; right: number; bottom: number; top: number };
export type Framing = { position: THREE.Vector3; target: THREE.Vector3 };

/** Rise of the terraces behind the stand front (m per m), their first row height and depth (stadium-view.ts). */
const TERRACE_RISE = 0.42 / 0.8, TERRACE_BASE = 1, TERRACE_DEPTH = 30 * 0.8;
/** Underside of the stand roofs, which reach 4 m in front of the stands (m). */
const ROOF_UNDERSIDE = TERRACE_BASE + 30 * 0.42 + 9 - 0.3, ROOF_REACH = 4;
/** Clearance the camera keeps above the terraces, below the roofs and inside the back walls; highest point over the open pitch (m). */
const CLEARANCE = 4, OPEN_SKY = 38;
const AZIMUTHS = 16;
const ELEVATIONS = [0.55, 0.68, 0.82];

const camera = new THREE.PerspectiveCamera();
const v = new THREE.Vector3();

/**
 * May a camera stand here and see the pitch? Inside the back walls, above the terraces, and under a roof wherever a
 * roof is overhead (a camera above the roof would only see the roof).
 */
export function cameraAllowed(p: THREE.Vector3): boolean {
  const beyond = Math.max(Math.abs(p.x) - STANDS.x, Math.abs(p.z) - STANDS.z);
  if (beyond > TERRACE_DEPTH - 2) return false;
  if (beyond > 0 && p.y < TERRACE_BASE + beyond * TERRACE_RISE + CLEARANCE) return false;
  const underRoof = beyond > -ROOF_REACH;
  return underRoof ? p.y < ROOF_UNDERSIDE - 1 : p.y < OPEN_SKY;
}

/** Do all points project inside the safe area (and in front of the camera)? */
function fits(points: readonly Vec3[], safe: SafeArea): boolean {
  for (const p of points) {
    v.set(p.x, p.y, p.z).project(camera);
    if (v.z > 1 || v.x < safe.left || v.x > safe.right || v.y < safe.bottom || v.y > safe.top) return false;
  }
  return true;
}

function place(target: THREE.Vector3, azimuth: number, elevation: number, distance: number): void {
  camera.position.set(
    target.x + Math.cos(azimuth) * Math.cos(elevation) * distance,
    target.y + Math.sin(elevation) * distance,
    target.z + Math.sin(azimuth) * Math.cos(elevation) * distance,
  );
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
}

/**
 * The camera for a decision moment: every point that matters (ball, actor, receivers, run targets, nearby opponents)
 * inside the part of the image the interface leaves free, the camera above the terraces and under the roof, never
 * behind the stands. Among the views that fit, the tightest wins, with a preference for looking along the attack
 * (behind the actor) so that passing lanes open up instead of overlapping, and for the broadcast side.
 */
export function frameMoment(points: readonly Vec3[], attackDir: 1 | -1, aspect: number, fovDeg: number, safe: SafeArea): Framing {
  camera.fov = fovDeg;
  camera.aspect = aspect;
  camera.near = 0.5;
  camera.far = 600;
  camera.updateProjectionMatrix();
  const box = new THREE.Box3().setFromPoints(points.map(p => new THREE.Vector3(p.x, p.y, p.z)));
  const target = box.getCenter(new THREE.Vector3());
  target.y = Math.min(1, target.y);
  let best: { score: number; position: THREE.Vector3 } | null = null;
  for (let a = 0; a < AZIMUTHS; a++) {
    const azimuth = (a / AZIMUTHS) * Math.PI * 2;
    const dirX = Math.cos(azimuth), dirZ = Math.sin(azimuth);
    for (const elevation of ELEVATIONS) {
      let lo = 6, hi = 140;
      place(target, azimuth, elevation, hi);
      if (!fits(points, safe)) continue;
      for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        place(target, azimuth, elevation, mid);
        if (fits(points, safe)) hi = mid; else lo = mid;
      }
      // A little margin beyond the tightest fit.
      place(target, azimuth, elevation, hi * 1.06);
      const p = camera.position;
      if (p.y < 4 || !cameraAllowed(p)) continue;
      // Behind the actor looking up the pitch reads best; straight down the line of play from in front, worst.
      const along = -dirX * attackDir;
      const score = hi * (1.25 - 0.25 * along) * (dirZ > 0 ? 0.92 : 1);
      if (!best || score < best.score) best = { score, position: p.clone() };
    }
  }
  if (!best) {
    // Nothing fits: the broadcast gantry's position, as wide as the stadium allows.
    return { position: new THREE.Vector3(target.x * 0.6, ROOF_UNDERSIDE - 2, STANDS.z + 2), target };
  }
  return { position: best.position, target };
}

/** Projects a point with a given camera framing (for tests and the overlap check of the interface). */
export function projectWith(f: Framing, aspect: number, fovDeg: number, p: Vec3): THREE.Vector3 {
  camera.fov = fovDeg;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  camera.position.copy(f.position);
  camera.lookAt(f.target);
  camera.updateMatrixWorld(true);
  return new THREE.Vector3(p.x, p.y, p.z).project(camera);
}
