import type { PlayerProfile, RestartKind, SetPiecePlan, TeamId, Vec2 } from './types';
import { PITCH } from '../physics/pitch-geometry';
import { restartDistance } from '../rules/referee';

/** A dead-ball situation the engine is preparing. */
export type RestartState = {
  kind: RestartKind;
  team: TeamId;
  spot: Vec2;
  /** Sim time at which the referee places the ball (gives players time to react, e.g. goal celebrations). */
  placeAt: number;
  placed: boolean;
  placedAt: number;
  taker: number;
  /** The orchestrator has looked at this placed restart once (it may stop play before it is taken, never twice). */
  consulted: boolean;
  /** The computer's coaches have looked at this stoppage for substitutions (once). */
  benchSeen: boolean;
  /** A free kick awarded for a foul or handball may be shot at goal; one for offside or a back-pass is indirect (Law 13). */
  direct: boolean;
  /** Defending (or attacking) plans chosen for this restart, per team. */
  plans: Partial<Record<TeamId, SetPiecePlan>>;
};

/** Delay before the ball is placed, per restart reason. */
export const PLACE_DELAY: Record<RestartKind, number> = {
  kickoff: 0, 'throw-in': 1.2, corner: 1.6, 'goal-kick': 1.6, 'free-kick': 1.8, penalty: 2.5, 'drop-ball': 1,
};
/** After this long the restart is taken even if an opponent is still too close (the referee waves play on). */
export const RESTART_TIMEOUT = 9;
/**
 * Time a taker gives both sides to set up a corner or a free kick near goal (s): runners into the box, the wall, the
 * marking. Taken as soon as the opponents were 9.15 m away, a corner came before anybody was in position (measured).
 */
const SET_UP: Partial<Record<RestartKind, number>> = { corner: 3.5, 'free-kick': 2.5 };
/** Free kicks further than this from the goal they attack need no set-up (m). */
const SET_UP_RANGE = 35;

/** Taker: keeper for goal kicks, the best finisher for penalties, otherwise the nearest outfield player. */
export function chooseTaker(kind: RestartKind, team: TeamId, spot: Vec2, profiles: PlayerProfile[], positions: Map<number, Vec2>, sentOff: Set<number>): number {
  const squad = profiles.filter(p => p.team === team && !sentOff.has(p.id));
  if (kind === 'goal-kick') return squad.find(p => p.role === 'GK')!.id;
  if (kind === 'penalty') return squad.filter(p => p.role !== 'GK').sort((a, b) => b.abilities.shooting - a.abilities.shooting)[0].id;
  if (kind === 'kickoff') return (squad.find(p => p.role === 'ST') ?? squad[1]).id;
  let best = squad[0].id, bestD = Infinity;
  for (const p of squad) {
    if (p.role === 'GK') continue;
    const q = positions.get(p.id)!;
    const d = Math.hypot(q.x - spot.x, q.z - spot.z);
    if (d < bestD) { bestD = d; best = p.id; }
  }
  return best;
}

/** Laws 8 and 13–17: are all opponents far enough away (and for a kick-off, everybody in their own half)? */
export function restartReady(r: RestartState, profiles: PlayerProfile[], positions: Map<number, Vec2>, signOf: (team: TeamId) => 1 | -1, now: number, sentOff: Set<number>): boolean {
  if (!r.placed) return false;
  if (now - r.placedAt > RESTART_TIMEOUT) return true;
  const setUp = SET_UP[r.kind] ?? 0;
  const nearGoal = r.kind !== 'free-kick' || PITCH.halfLength - Math.abs(r.spot.x) + Math.abs(r.spot.z) * 0.5 < SET_UP_RANGE;
  if (setUp && nearGoal && now - r.placedAt < setUp) return false;
  // Law 13: 9.15 m (a few centimetres of body sway allowed; the former 0.5 m let a defender stand 8.7 m away).
  const min = restartDistance(r.kind) - 0.1;
  for (const p of profiles) {
    if (sentOff.has(p.id)) continue;
    const q = positions.get(p.id)!;
    if (r.kind === 'kickoff' && signOf(p.team) * q.x > 0.5 && p.id !== r.taker) return false;
    if (p.team !== r.team && Math.hypot(q.x - r.spot.x, q.z - r.spot.z) < min) return false;
    // Law 14: everybody but taker and keeper outside the area; Law 16: opponents outside it at a goal kick.
    if ((r.kind === 'penalty' && p.id !== r.taker && p.role !== 'GK') || (r.kind === 'goal-kick' && p.team !== r.team)) {
      const inArea = Math.abs(q.z) < PITCH.penaltyAreaHalfWidth && Math.sign(r.spot.x) * q.x > PITCH.halfLength - PITCH.penaltyAreaDepth;
      if (inArea) return false;
    }
  }
  return true;
}

/** A restart spot inside the pitch (a foul or out-of-play position can lie on or beyond a line). */
export function clampSpot(s: Vec2): Vec2 {
  return { x: Math.max(-PITCH.halfLength + 0.3, Math.min(PITCH.halfLength - 0.3, s.x)), z: Math.max(-PITCH.halfWidth + 0.3, Math.min(PITCH.halfWidth - 0.3, s.z)) };
}
