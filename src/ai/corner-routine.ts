import type { PlayerProfile, TeamId, Vec2 } from '../engine/types';
import { PITCH } from '../physics/pitch-geometry';

/**
 * Corner routine of the attacking side: who occupies which zone while the corner is being prepared. Before, the
 * attackers simply kept their open-play shape at a corner, so hardly anybody was in the box to aim for. The routine is
 * a positioning intent like any other run: the bodies still have to get there, opponents mark them and the delivery is
 * a real lofted strike.
 */
export type CornerSlot = 'near-post' | 'far-post' | 'penalty-spot' | 'edge' | 'short';
export const CORNER_SLOTS: readonly CornerSlot[] = ['near-post', 'far-post', 'penalty-spot', 'edge', 'short'];

/** Radius of a zone that counts as reached (m). */
export const ZONE_RADIUS = 2.5;

/** Where a slot is for a corner taken from `spot` (on the goal line, at either flag). */
export function cornerSlotSpot(slot: CornerSlot, spot: Vec2): Vec2 {
  const gx = Math.sign(spot.x) * PITCH.halfLength;
  const g = Math.sign(spot.x), s = Math.sign(spot.z) || 1;
  switch (slot) {
    case 'near-post': return { x: gx - g * 4, z: s * 2.5 };
    case 'far-post': return { x: gx - g * 5.5, z: -s * 3.5 };
    case 'penalty-spot': return { x: gx - g * 11, z: -s * 0.5 };
    case 'edge': return { x: gx - g * 18.5, z: -s * 3 };
    case 'short': return { x: gx - g * 9, z: s * (PITCH.halfWidth - 3) };
  }
}

/**
 * Tall players attack the posts and the penalty spot, a central midfielder waits at the edge of the area, the wide
 * player on the corner's side offers short. The taker and the keeper are left out, everybody else keeps the shape.
 */
export function cornerAssignment(profiles: readonly PlayerProfile[], team: TeamId, taker: number, sentOff: ReadonlySet<number>, spot: Vec2, attackSign: 1 | -1): Map<number, CornerSlot> {
  const out = new Map<number, CornerSlot>();
  const free = (p: PlayerProfile) => p.team === team && p.id !== taker && !sentOff.has(p.id) && !out.has(p.id);
  const aerial = profiles.filter(p => free(p) && (p.role === 'ST' || p.role === 'RCB' || p.role === 'LCB')).sort((a, b) => b.heightM - a.heightM);
  const order: CornerSlot[] = ['far-post', 'penalty-spot', 'near-post'];
  aerial.forEach((p, i) => { if (i < order.length) out.set(p.id, order[i]); });
  const edge = ['CM', 'LCM', 'RCM'].map(r => profiles.find(p => p.role === r && free(p))).find(p => !!p);
  if (edge) out.set(edge.id, 'edge');
  // The team's right touchline is −Z when attacking +X (team frame v < 0).
  const rightSide = attackSign * spot.z < 0;
  const wide = (rightSide ? ['RW', 'RB'] : ['LW', 'LB']).map(r => profiles.find(p => p.role === r && free(p))).find(p => !!p);
  if (wide) out.set(wide.id, 'short');
  return out;
}
