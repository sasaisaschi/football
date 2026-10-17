import type { Vec2 } from '../engine/types';
import { PITCH } from '../physics/pitch-geometry';
import { toTeam } from './shape';

/** How many team-mates come to offer themselves to the player on the ball. */
const SUPPORTERS = 2;
/** Distances from the ball at which a supporter offers himself (m): short enough for a safe ground pass. */
const RINGS = [9, 13];
/** Directions around the ball (rad, 0 = straight towards the opponents' goal). */
const ANGLES = Array.from({ length: 12 }, (_, i) => -Math.PI + (i * Math.PI) / 6);
/** Two supporters do not offer themselves in the same place (m). */
const SPREAD = 7;

export type SupportView = {
  self: { id: number; pos: Vec2 };
  sign: 1 | -1;
  ball: Vec2;
  /** Outfield team-mates as I see them (without me). */
  mates: { id: number; pos: Vec2 }[];
  opponents: Vec2[];
  offsideLineU: number;
  /** My place in the team shape; a supporter does not wander far from it. */
  shape: Vec2;
};

function laneGap(a: Vec2, b: Vec2, opponents: Vec2[]): number {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
  let gap = 6;
  for (const o of opponents) {
    const t = Math.max(0, Math.min(1, ((o.x - a.x) * dx + (o.z - a.z) * dz) / l2));
    gap = Math.min(gap, Math.hypot(a.x + dx * t - o.x, a.z + dz * t - o.z));
  }
  return gap;
}

/** How good a spot is to receive a short pass from the ball: open lane, room around it, some progress. */
function spotScore(v: SupportView, spot: Vec2, from: Vec2, shape: Vec2): number {
  let room = 6;
  for (const o of v.opponents) room = Math.min(room, Math.hypot(o.x - spot.x, o.z - spot.z));
  const d = Math.hypot(spot.x - v.ball.x, spot.z - v.ball.z) || 1;
  const forward = (v.sign * (spot.x - v.ball.x)) / d;
  return laneGap(v.ball, spot, v.opponents) + 0.6 * room + 0.8 * forward
    - 0.08 * Math.hypot(spot.x - shape.x, spot.z - shape.z) - 0.1 * Math.hypot(spot.x - from.x, spot.z - from.z);
}

function bestSpot(v: SupportView, from: Vec2, shape: Vec2, avoid: Vec2 | null): Vec2 | null {
  const ballU = toTeam(v.sign, v.ball).u;
  let best: { spot: Vec2; score: number } | null = null;
  for (const r of RINGS) {
    for (const a of ANGLES) {
      const spot = { x: v.ball.x + v.sign * Math.cos(a) * r, z: v.ball.z + Math.sin(a) * r };
      if (Math.abs(spot.x) > PITCH.halfLength - 2 || Math.abs(spot.z) > PITCH.halfWidth - 2) continue;
      const u = toTeam(v.sign, spot).u;
      if (u > v.offsideLineU - 0.01 && u > ballU) continue;
      if (avoid && Math.hypot(spot.x - avoid.x, spot.z - avoid.z) < SPREAD) continue;
      const score = spotScore(v, spot, from, shape);
      if (!best || score > best.score) best = { spot, score };
    }
  }
  return best?.spot ?? null;
}

/**
 * Support play: when a team-mate has the ball, the two outfield players nearest to it (besides him) move into
 * open passing lanes at short range, so the player under pressure has a safe pass instead of a dribble into
 * his marker or a long ball. Decentralised: every player works out from his own picture whether he is one of
 * them and, with the same rule, which spot the other one takes. Returns my spot, or null if I am not needed.
 */
export function supportSpot(v: SupportView): Vec2 | null {
  const dist = (p: Vec2) => Math.hypot(p.x - v.ball.x, p.z - v.ball.z);
  const all = [{ id: v.self.id, pos: v.self.pos }, ...v.mates].sort((a, b) => dist(a.pos) - dist(b.pos) || a.id - b.id);
  // The nearest one is on the ball; the next ones support.
  const supporters = all.slice(1, 1 + SUPPORTERS);
  const rank = supporters.findIndex(s => s.id === v.self.id);
  if (rank < 0) return null;
  let taken: Vec2 | null = null;
  for (let i = 0; i <= rank; i++) {
    const s = supporters[i];
    const shape = s.id === v.self.id ? v.shape : s.pos;
    const spot = bestSpot(v, s.pos, shape, taken);
    if (i === rank) return spot;
    taken = spot;
  }
  return null;
}
