import type { BrainContext } from '../ai/brain';
import type { MatchEngine } from '../engine/match-engine';
import type { DecisionMoment, DecisionOption, TeamId, Vec2 } from '../engine/types';

/** A moment as a recogniser proposes it; the orchestrator adds id, tick, team and countdown. */
export type MomentDraft = Omit<DecisionMoment, 'id' | 'tick' | 'team' | 'timeoutSeconds'>;

export const playerName = (e: MatchEngine, id: number) => `${e.profiles[id].name} (${e.profiles[id].number})`;

export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

/** Player of `team` who currently has the ball at his feet (last toucher, close to a slow ball). */
export function carrier(e: MatchEngine, team: TeamId): number | null {
  const t = e.referee.lastTouch;
  if (!t || t.team !== team || e.phase !== 'in-play') return null;
  const ball = e.ballPos(), v = e.physics.ball.linvel();
  const p = e.bodies[t.player].position();
  if (Math.hypot(ball.x - p.x, ball.z - p.z) > 1.6 || Math.hypot(v.x, v.z) > 9 || ball.y > 0.5) return null;
  return t.player;
}

/** The context a player's brain would get now, for evaluating his options exactly as he would. */
export function brainContext(e: MatchEngine, player: number): BrainContext {
  const team = e.profiles[player].team;
  const r = e.restart;
  return {
    now: e.time, truth: e.truth(), sign: e.sign(team), instruction: e.instructions[team], possession: e.possession(),
    ball: e.physics.ball, profiles: e.profiles,
    restart: r ? { kind: r.kind, team: r.team, taker: r.taker, spot: r.spot, minDistance: 0, ownHalfOnly: r.kind === 'kickoff', ready: false, held: false } : null,
    handsAllowed: false, ballHeldBy: e.snapshot().ball.heldBy, sentOff: e.referee.sentOff,
  };
}

/** Opponents of `team` nearest to a point, closest first. */
export function nearestOf(e: MatchEngine, team: TeamId, at: Vec2, n: number): number[] {
  return e.profiles
    .filter(p => p.team === team && !e.referee.sentOff.has(p.id))
    .map(p => ({ id: p.id, d: dist(e.bodies[p.id].position(), at) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map(p => p.id);
}

/** Everybody the user has to see: the actor, all players an option names, and the nearest opponents to the ball. */
export function participantsFor(e: MatchEngine, team: TeamId, actor: number, options: DecisionOption[], extra: number[] = []): number[] {
  const ids = new Set<number>([actor, ...extra]);
  for (const o of options) {
    const v = o.visual;
    if (v?.ball?.receiver !== undefined) ids.add(v.ball.receiver);
    for (const r of v?.runs ?? []) ids.add(r.player);
    if (v) ids.add(v.actor);
  }
  const b = e.ballPos();
  for (const id of nearestOf(e, (1 - team) as TeamId, { x: b.x, z: b.z }, 3)) ids.add(id);
  return [...ids];
}
