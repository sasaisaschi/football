import { BALL } from './ball';
import { PITCH, goalSide, outOfPlay } from './pitch';
import { Player, toTeam } from './team';

export type RestartKind = 'kickoff' | 'throw-in' | 'corner' | 'goal-kick' | 'free-kick';
export type RefState =
  | { phase: 'play' }
  | { phase: 'restart'; kind: RestartKind; team: 0 | 1; x: number; z: number; since: number; placeAt: number; placed: boolean };

export type RefDecision =
  | { type: 'goal'; scoringTeam: 0 | 1; side: -1 | 1 }
  | { type: 'out'; kind: RestartKind; team: 0 | 1; x: number; z: number }
  | { type: 'offside'; offender: Player; x: number; z: number }
  | { type: 'in-play'; kind: RestartKind; taker: Player };

/** Law 11 exceptions: no offside directly from these restarts. */
const NO_OFFSIDE_FROM = new Set<RestartKind>(['throw-in', 'corner', 'goal-kick']);

/**
 * Rules authority. It reads touches and ball positions produced by physics and decides the legal state
 * (goal, out of play, offside, restarts). It never alters a trajectory while the ball is in play.
 * Simplifications: throw-ins are taken with the foot, deliberate play vs deflection is not distinguished,
 * offside uses body centres and only "touching the ball" counts as involvement; fouls are not judged yet.
 */
export class Referee {
  state: RefState = { phase: 'restart', kind: 'kickoff', team: 0, x: 0, z: 0, since: 0, placeAt: 0, placed: false };
  lastTouch: Player | null = null;
  private offsideCandidates = new Set<Player>();
  private offsidePasser: Player | null = null;

  constructor(private readonly players: Player[]) {}

  startRestart(kind: RestartKind, team: 0 | 1, x: number, z: number, now: number, delay: number): void {
    this.state = { phase: 'restart', kind, team, x, z, since: now, placeAt: now + delay, placed: false };
    this.offsideCandidates.clear();
    this.offsidePasser = null;
  }

  /** Called for every physical ball touch, in order. */
  observeTouch(player: Player, ballX: number, ballZ: number): RefDecision | null {
    const state = this.state;
    let decision: RefDecision | null = null;
    let restartKind: RestartKind | null = null;
    if (state.phase === 'restart') {
      if (!state.placed || player.team !== state.team) return null;
      restartKind = state.kind;
      this.state = { phase: 'play' };
      decision = { type: 'in-play', kind: restartKind, taker: player };
    } else if (this.offsideCandidates.has(player) && player !== this.offsidePasser) {
      const p = player.motor.body.translation();
      this.lastTouch = player;
      return { type: 'offside', offender: player, x: p.x, z: p.z };
    }
    this.lastTouch = player;
    this.snapshotOffside(player, ballX, ballZ, restartKind);
    return decision;
  }

  private snapshotOffside(passer: Player, ballX: number, ballZ: number, restartKind: RestartKind | null): void {
    this.offsideCandidates.clear();
    this.offsidePasser = passer;
    if (restartKind && NO_OFFSIDE_FROM.has(restartKind)) return;
    const team = passer.team;
    const ballU = toTeam(team, ballX, ballZ).u;
    const opponentsU = this.players
      .filter(p => p.team !== team)
      .map(p => { const t = p.motor.body.translation(); return toTeam(team, t.x, t.z).u; })
      .sort((a, b) => b - a);
    const secondLast = opponentsU[1] ?? 1;
    for (const mate of this.players) {
      if (mate.team !== team || mate === passer) continue;
      const t = mate.motor.body.translation();
      const u = toTeam(team, t.x, t.z).u;
      if (u > 0 && u > ballU && u > secondLast) this.offsideCandidates.add(mate);
    }
  }

  /** Called after every physics step with the current ball position. */
  checkBall(ball: { x: number; y: number; z: number }): RefDecision | null {
    if (this.state.phase !== 'play') return null;
    const side = goalSide(ball);
    if (side !== 0) return { type: 'goal', scoringTeam: side > 0 ? 0 : 1, side };
    const out = outOfPlay(ball);
    if (!out) return null;
    const last = this.lastTouch?.team ?? 0;
    const other = (1 - last) as 0 | 1;
    if (out.line === 'touch') {
      const x = Math.max(-PITCH.halfLength + 1, Math.min(PITCH.halfLength - 1, out.x));
      return { type: 'out', kind: 'throw-in', team: other, x, z: Math.sign(out.z) * (PITCH.halfWidth - 0.8) };
    }
    const s = Math.sign(out.x);
    const defending: 0 | 1 = s > 0 ? 1 : 0;
    const zSide = Math.sign(out.z) || 1;
    if (last === defending) {
      return { type: 'out', kind: 'corner', team: (1 - defending) as 0 | 1, x: s * (PITCH.halfLength - 0.5), z: zSide * (PITCH.halfWidth - 0.5) };
    }
    return { type: 'out', kind: 'goal-kick', team: defending, x: s * (PITCH.halfLength - PITCH.goalAreaDepth), z: zSide * 5 };
  }
}
