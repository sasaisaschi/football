import * as THREE from 'three';
import type { DecisionMoment, MatchSnapshot } from '../engine/types';
import { PITCH } from '../physics/pitch-geometry';

/** Renders the 3D scene from a camera into a canvas of the given pixel size (main.ts, before the frame's own render). */
export type Capture = (camera: THREE.PerspectiveCamera, width: number, height: number) => Promise<HTMLCanvasElement>;

/** Pixel sizes of the renders: the player card's portrait and an option card's picture (twice their CSS size). */
const PORTRAIT = { w: 160, h: 200 }, THUMB = { w: 300, h: 210 };

/**
 * The live pictures of the decision bar, rendered from the frozen scene itself (no stock images): the acting player
 * from the front, each pass's receiver from behind his run, and for a shot the goal with its keeper and the yellow
 * target, as the reference picture's cards show them.
 */
export async function scenePictures(m: DecisionMoment, s: MatchSnapshot, capture: Capture): Promise<{ portrait: HTMLCanvasElement | null; thumbs: Map<string, HTMLCanvasElement> }> {
  const cam = (fov: number, from: THREE.Vector3, to: THREE.Vector3) => {
    const c = new THREE.PerspectiveCamera(fov, 1, 0.1, 400);
    c.position.copy(from);
    c.lookAt(to);
    c.updateMatrixWorld(true);
    return c;
  };
  const actor = s.players[m.focusPlayer];
  const f = { x: Math.sin(actor.heading), z: Math.cos(actor.heading) };
  const portrait = await capture(cam(24, new THREE.Vector3(actor.position.x + f.x * 2.4, 1.45, actor.position.z + f.z * 2.4), new THREE.Vector3(actor.position.x, 1.22, actor.position.z)), PORTRAIT.w, PORTRAIT.h);
  const thumbs = new Map<string, HTMLCanvasElement>();
  const ball = s.ball.position;
  for (const o of m.options) {
    const b = o.visual?.ball;
    if (!b) continue;
    if (b.receiver !== undefined) {
      const r = s.players[b.receiver].position;
      const dx = r.x - ball.x, dz = r.z - ball.z, d = Math.hypot(dx, dz) || 1;
      // Behind and a little beside his run, so the ring under him and his shirt number are seen.
      const from = new THREE.Vector3(r.x - (dx / d) * 4.2 - (dz / d) * 1.4, 2.1, r.z - (dz / d) * 4.2 + (dx / d) * 1.4);
      thumbs.set(o.id, await capture(cam(34, from, new THREE.Vector3(r.x, 0.85, r.z)), THUMB.w, THUMB.h));
    } else if (b.kind === 'shot') {
      const side = Math.sign(b.to.x) || 1, line = side * PITCH.halfLength;
      // In front of the goal and off to one side: frame, net, keeper and the target glow.
      const from = new THREE.Vector3(line - side * 11, 2.4, b.to.z * 0.3 + (b.to.z >= 0 ? -4.5 : 4.5));
      thumbs.set(o.id, await capture(cam(36, from, new THREE.Vector3(line, 1.0, b.to.z * 0.55)), THUMB.w, THUMB.h));
    }
  }
  return { portrait, thumbs };
}
