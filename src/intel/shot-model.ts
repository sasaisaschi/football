import { goalAngle } from '../ai/options';
import type { Vec2 } from '../engine/types';
import { PITCH } from '../physics/pitch-geometry';

/**
 * Expected goals of a shot from where it was struck: distance and opening angle of the goal mouth, the same curve the
 * players use for their own shooting decisions (ai/options.ts, without their view of blockers and pressure). Calibrated
 * to common open-play values: ≈ 0.26 at 11 m, 0.12 at 16 m, 0.065 at 20 m, 0.03 at 25 m (central). A model value,
 * labelled as such wherever it is shown.
 */
export function shotXg(from: Vec2, attackSign: 1 | -1): number {
  const dist = Math.hypot(attackSign * PITCH.halfLength - from.x, from.z);
  return Math.min(0.75, 1.1 * goalAngle(attackSign, from) * Math.exp(-dist / 11));
}

/** Distance to the goal a team attacks (m). */
export function goalDistance(from: Vec2, attackSign: 1 | -1): number {
  return Math.hypot(attackSign * PITCH.halfLength - from.x, from.z);
}
