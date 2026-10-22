import type { PlayerProfile, SetPiecePlan, TeamId, Vec2 } from '../engine/types';
import { PITCH } from '../physics/pitch-geometry';
import type { Truth } from './perception';
import { FORWARDS } from './shape';

/**
 * Where the defending side stands at a free kick or a corner. Every defender works the same assignment out from what
 * everybody sees at a dead ball (the true positions), so the team agrees without a central controller – like the
 * attacking corner routine. The bodies still have to get there, and once the ball is played they react as always.
 */

/** Law 13: defenders at least 9.15 m from the ball; the wall stands just beyond. */
const WALL_DISTANCE = 9.8;
/** Shoulder to shoulder in a wall (m). */
const WALL_SPACING = 0.62;
/** A direct free kick closer than this to goal gets a wall by default (m). */
export const WALL_RANGE = 30;
const DEFAULT_WALL = 3;

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

/** Greedy assignment of players to spots, nearest pairs first; deterministic for equal inputs. */
function assign(players: { id: number; pos: Vec2 }[], spots: Vec2[]): Map<number, Vec2> {
  const out = new Map<number, Vec2>();
  const pairs: { id: number; s: number; d: number }[] = [];
  players.forEach(p => spots.forEach((s, i) => pairs.push({ id: p.id, s: i, d: dist(p.pos, s) })));
  pairs.sort((a, b) => a.d - b.d || a.id - b.id || a.s - b.s);
  const usedSpot = new Set<number>();
  for (const pr of pairs) {
    if (out.has(pr.id) || usedSpot.has(pr.s)) continue;
    out.set(pr.id, spots[pr.s]);
    usedSpot.add(pr.s);
  }
  return out;
}

function outfield(profiles: readonly PlayerProfile[], truth: Truth, team: TeamId, exclude: ReadonlySet<number> = new Set()): { id: number; pos: Vec2 }[] {
  const on = new Map(truth.players.map(p => [p.id, p.pos]));
  return profiles.filter(p => p.team === team && p.role !== 'GK' && on.has(p.id) && !exclude.has(p.id)).map(p => ({ id: p.id, pos: on.get(p.id)! }));
}

/**
 * The wall at a free kick from `spot` against the goal at x = goalX: its centre 9.6 m from the ball on the line to the
 * near-post half of the goal (the keeper covers the far side), the players side by side across that line.
 */
export function wallSpots(spot: Vec2, goalX: number, size: number): Vec2[] {
  const near = Math.sign(spot.z) || 1;
  const aim = { x: goalX, z: near * PITCH.goalHalfWidth * 0.45 };
  const d = dist(spot, aim) || 1;
  const ux = (aim.x - spot.x) / d, uz = (aim.z - spot.z) / d;
  const centre = { x: spot.x + ux * WALL_DISTANCE, z: spot.z + uz * WALL_DISTANCE };
  // Across the line, towards the near post first.
  const px = -uz, pz = ux, towardsNear = pz * near > 0 ? 1 : -1;
  return Array.from({ length: size }, (_, i) => {
    const off = (i - (size - 1) / 2) * WALL_SPACING * towardsNear;
    return { x: centre.x + px * off, z: centre.z + pz * off };
  });
}

/** Which defenders form the wall and where (empty: no wall). Default without a plan: three at a direct kick in range. */
export function freeKickWall(profiles: readonly PlayerProfile[], truth: Truth, team: TeamId, spot: Vec2, goalX: number, direct: boolean, plan: SetPiecePlan | undefined): Map<number, Vec2> {
  const size = plan?.kind === 'wall' ? plan.size : direct && dist(spot, { x: goalX, z: 0 }) < WALL_RANGE ? DEFAULT_WALL : 0;
  if (size > 0) return assign(outfield(profiles, truth, team), wallSpots(spot, goalX, size));
  if (plan?.kind !== 'wall') return new Map();
  // No wall by choice: the three nearest defenders drop onto the six-yard line instead of lining up in front of the
  // ball (pushed back to 9.15 m from it, they otherwise formed a wall by accident).
  const g = Math.sign(goalX), s = Math.sign(spot.z) || 1;
  return assign(outfield(profiles, truth, team).sort((a, b) => dist(a.pos, spot) - dist(b.pos, spot) || a.id - b.id).slice(0, 3),
    [{ x: goalX - g * 5.5, z: s * 3 }, { x: goalX - g * 5.5, z: -s * 2 }, { x: goalX - g * 11, z: 0 }]);
}

/**
 * Corner defence (corner from `spot` at the goal x = goalX):
 *  - man: every attacker in or near the box gets the nearest free defender, a metre goal-side of him;
 *  - zone: defenders hold fixed zones – both posts, three along the six-yard line, penalty spot, edge of the box;
 *  - counter: zones, but the two most advanced forwards wait at the halfway line for the clearance.
 */
export function cornerDefence(profiles: readonly PlayerProfile[], truth: Truth, team: TeamId, spot: Vec2, goalX: number, scheme: 'man' | 'zone' | 'counter'): Map<number, Vec2> {
  const g = Math.sign(goalX), s = Math.sign(spot.z) || 1;
  const defenders = outfield(profiles, truth, team);
  const out = new Map<number, Vec2>();
  let free = defenders;
  if (scheme === 'counter') {
    const forwards = defenders.filter(d => FORWARDS.has(profiles[d.id].role)).sort((a, b) => g * a.pos.x - g * b.pos.x).slice(0, 2);
    forwards.forEach((f, i) => out.set(f.id, { x: -g * 3, z: (i === 0 ? -1 : 1) * 12 }));
    free = defenders.filter(d => !out.has(d.id));
  }
  if (scheme === 'man') {
    const attackers = truth.players.filter(p => profiles[p.id].team !== team && profiles[p.id].role !== 'GK' && Math.abs(goalX - p.pos.x) < 22 && Math.abs(p.pos.z) < 24);
    const remaining = [...free];
    for (const a of [...attackers].sort((x, y) => x.id - y.id)) {
      if (!remaining.length) break;
      remaining.sort((x, y) => dist(x.pos, a.pos) - dist(y.pos, a.pos) || x.id - y.id);
      const d = remaining.shift()!;
      const gx = goalX - a.pos.x, gz = -a.pos.z, gd = Math.hypot(gx, gz) || 1;
      out.set(d.id, { x: a.pos.x + (gx / gd) * 1, z: a.pos.z + (gz / gd) * 1 });
    }
    return out;
  }
  const zones: Vec2[] = [
    { x: goalX - g * 0.6, z: s * (PITCH.goalHalfWidth - 0.4) },
    { x: goalX - g * 0.6, z: -s * (PITCH.goalHalfWidth - 0.4) },
    { x: goalX - g * 5.5, z: s * 3 },
    { x: goalX - g * 5.5, z: 0 },
    { x: goalX - g * 5.5, z: -s * 3 },
    { x: goalX - g * 11, z: 0 },
    { x: goalX - g * 17, z: -s * 2 },
  ];
  for (const [id, pos] of assign(free, zones)) out.set(id, pos);
  return out;
}
