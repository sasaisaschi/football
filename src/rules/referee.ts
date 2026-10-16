import type { PlayerProfile, RestartKind, TeamId, Vec2, Vec3 } from '../engine/types';
import { PITCH, attackSign, ballOut, goalCrossed, inPenaltyArea } from '../physics/pitch-geometry';

/**
 * Independent rules authority. It only reads what happened (ball contacts, body contacts, ball position)
 * and decides the legal state: goals, out of play, offside, fouls, cards and restarts. It never changes a
 * trajectory; the engine merely places a dead ball where the referee says the game restarts.
 *
 * Simplifications (documented in PROJECT_REPORT.md): throw-ins are taken with the foot; offside involvement
 * is "plays the ball"; deliberate play vs. deflection is not distinguished; fouls are judged from body
 * contacts (closing speed, who challenged, whether the ball was played first).
 */

export type Touch = { player: number; team: TeamId; part: 'boot' | 'body' | 'hands'; time: number; position: Vec3 };
export type Decision =
  | { type: 'goal'; team: TeamId; scorer: number | null; ownGoal: boolean }
  | { type: 'restart'; kind: RestartKind; team: TeamId; spot: Vec2; reason: 'out' | 'offside' | 'foul' | 'handball' | 'back-pass' }
  | { type: 'offside'; player: number; spot: Vec2 }
  | { type: 'foul'; offender: number; victim: number; spot: Vec2; penalty: boolean; card: 'none' | 'yellow' | 'red'; reason: string; advantage: boolean }
  | { type: 'in-play'; kind: RestartKind; taker: number };

export type PlayerState = { pos: Vec2; vel: Vec2; heading: number; hasTacticalFoulIntent: boolean };

const NO_OFFSIDE_FROM: ReadonlySet<RestartKind> = new Set(['throw-in', 'corner', 'goal-kick']);

export class Referee {
  lastTouch: Touch | null = null;
  private offsideCandidates = new Set<number>();
  private offsidePasser = -1;
  /** Restart that the next touch by `team` puts into play. */
  pendingRestart: { kind: RestartKind; team: TeamId } | null = { kind: 'kickoff', team: 0 };
  readonly yellow = new Set<number>();
  readonly sentOff = new Set<number>();
  /** Last ball contact per player, for "played the ball first" when judging challenges. */
  private readonly lastBallContact = new Map<number, number>();
  /** Set when a keeper released the ball; he may not handle it again until someone else touches it. */
  keeperReleased: number | null = null;

  constructor(private readonly profiles: PlayerProfile[]) {}

  /** Every ball contact, in order. `positions` is the true position of all players at that moment. */
  onBallContact(touch: Touch, half: 1 | 2, positions: Map<number, Vec2>): Decision[] {
    const out: Decision[] = [];
    this.lastBallContact.set(touch.player, touch.time);
    const profile = this.profiles[touch.player];
    if (this.keeperReleased !== null && touch.player !== this.keeperReleased) this.keeperReleased = null;

    if (touch.part === 'hands') {
      const goalSide = (-attackSign(touch.team, half)) as 1 | -1;
      if (profile.role !== 'GK' || !inPenaltyArea(touch.position.x, touch.position.z, goalSide)) {
        out.push({ type: 'restart', kind: 'free-kick', team: (1 - touch.team) as TeamId, spot: { x: touch.position.x, z: touch.position.z }, reason: 'handball' });
        return out;
      }
      const last = this.lastTouch;
      if (last && last.team === touch.team && last.player !== touch.player && last.part === 'boot') {
        out.push({ type: 'restart', kind: 'free-kick', team: (1 - touch.team) as TeamId, spot: { x: touch.position.x, z: touch.position.z }, reason: 'back-pass' });
        return out;
      }
    }

    if (this.pendingRestart) {
      if (this.pendingRestart.team !== touch.team) return out;
      const kind = this.pendingRestart.kind;
      this.pendingRestart = null;
      out.push({ type: 'in-play', kind, taker: touch.player });
      this.lastTouch = touch;
      this.snapshotOffside(touch, half, positions, kind);
      return out;
    }

    if (this.offsideCandidates.has(touch.player) && touch.player !== this.offsidePasser) {
      const p = positions.get(touch.player)!;
      this.lastTouch = touch;
      this.offsideCandidates.clear();
      out.push({ type: 'offside', player: touch.player, spot: p });
      return out;
    }
    this.lastTouch = touch;
    this.snapshotOffside(touch, half, positions, null);
    return out;
  }

  /** Law 11 at the moment a team-mate plays the ball: in the opponents' half, ahead of ball and second-last opponent. */
  private snapshotOffside(touch: Touch, half: 1 | 2, positions: Map<number, Vec2>, restart: RestartKind | null): void {
    this.offsideCandidates.clear();
    this.offsidePasser = touch.player;
    if (restart && NO_OFFSIDE_FROM.has(restart)) return;
    const sign = attackSign(touch.team, half);
    const u = (p: Vec2) => sign * p.x;
    const ballU = sign * touch.position.x;
    const defenders = this.profiles.filter(p => p.team !== touch.team && !this.sentOff.has(p.id)).map(p => u(positions.get(p.id)!)).sort((a, b) => b - a);
    const secondLast = defenders[1] ?? PITCH.halfLength;
    for (const p of this.profiles) {
      if (p.team !== touch.team || p.id === touch.player || this.sentOff.has(p.id)) continue;
      const pu = u(positions.get(p.id)!);
      if (pu > 0 && pu > ballU && pu > secondLast) this.offsideCandidates.add(p.id);
    }
  }

  /** Law 12 from a body contact. `a` and `b` are the two players; closing speed was measured before impact. */
  onBodyContact(a: number, b: number, closingSpeed: number, now: number, half: 1 | 2, ball: Vec3, states: Map<number, PlayerState>, keeperHolding: number | null): Decision | null {
    const pa = this.profiles[a], pb = this.profiles[b];
    if (pa.team === pb.team || closingSpeed < 1.6) return null;
    const sa = states.get(a)!, sb = states.get(b)!;
    // The challenger is the one moving into the other.
    const towards = (s: PlayerState, o: PlayerState) => {
      const dx = o.pos.x - s.pos.x, dz = o.pos.z - s.pos.z, d = Math.hypot(dx, dz) || 1;
      return (s.vel.x * dx + s.vel.z * dz) / d;
    };
    const [offender, victim] = towards(sa, sb) >= towards(sb, sa) ? [a, b] : [b, a];
    const vs = states.get(victim)!, os = states.get(offender)!;
    const victimNearBall = Math.hypot(ball.x - vs.pos.x, ball.z - vs.pos.z) < 2.2;
    const victimOnBall = (this.lastTouch?.player === victim && now - this.lastTouch.time < 0.6) || victimNearBall;
    const tactical = os.hasTacticalFoulIntent;
    if (!victimOnBall && !tactical && keeperHolding !== victim) return null;
    const playedBallFirst = now - (this.lastBallContact.get(offender) ?? -9) < 0.35;
    if (playedBallFirst && closingSpeed < 6 && !tactical) return null;
    // From behind: the challenger arrives from the victim's back half.
    const hx = Math.sin(vs.heading), hz = Math.cos(vs.heading);
    const ox = os.pos.x - vs.pos.x, oz = os.pos.z - vs.pos.z, od = Math.hypot(ox, oz) || 1;
    const fromBehind = (ox * hx + oz * hz) / od < -0.5;
    // Two players going for the same ball is a contest, not a foul, unless it is clumsy, fast or from behind.
    const contest = Math.hypot(ball.x - os.pos.x, ball.z - os.pos.z) < 1.6;
    const threshold = fromBehind ? 2.8 : contest ? 5.6 : 4;
    const careless = closingSpeed >= threshold || tactical || keeperHolding === victim;
    if (!careless) return null;

    const offenderTeam = this.profiles[offender].team;
    const victimTeam = this.profiles[victim].team;
    const ownGoalSide = (-attackSign(offenderTeam, half)) as 1 | -1;
    const penalty = inPenaltyArea(vs.pos.x, vs.pos.z, ownGoalSide);
    const attackDir = attackSign(victimTeam, half);
    const toGoal = Math.hypot(attackDir * PITCH.halfLength - vs.pos.x, vs.pos.z);
    const heading = (vs.vel.x * attackDir) > 2;
    const coverBehind = this.profiles.some(p => {
      if (p.team !== offenderTeam || p.id === offender || this.sentOff.has(p.id) || p.role === 'GK') return false;
      const s = states.get(p.id);
      return !!s && attackDir * s.pos.x > attackDir * vs.pos.x;
    });
    const dogso = toGoal < 28 && Math.abs(vs.pos.z) < 18 && heading && !coverBehind;
    let card: 'none' | 'yellow' | 'red' = 'none';
    let reason = 'Foulspiel';
    if (closingSpeed > 6.5) { card = 'yellow'; reason = 'rücksichtsloses Einsteigen'; }
    if (dogso && !(penalty && playedBallFirst)) { card = 'red'; reason = 'Verhinderung einer offensichtlichen Torchance'; }
    else if (tactical || (heading && toGoal < 45)) { card = card === 'none' ? 'yellow' : card; reason = tactical ? 'taktisches Foul' : 'Unterbinden eines aussichtsreichen Angriffs'; }
    if (card === 'yellow' && this.yellow.has(offender)) card = 'red';
    if (card === 'yellow') this.yellow.add(offender);
    if (card === 'red') this.sentOff.add(offender);
    // Advantage: play on when the fouled team keeps the ball in the attacking half and no red card is due.
    const advantage = !penalty && card !== 'red' && this.lastTouch?.team === victimTeam && attackDir * ball.x > 10;
    return { type: 'foul', offender, victim, spot: { ...vs.pos }, penalty, card, reason, advantage };
  }

  /** After every tick: goal or ball out of play (only while the ball is in play). */
  checkBall(ball: Vec3, half: 1 | 2): Decision | null {
    const side = goalCrossed(ball);
    if (side !== 0) {
      const team = (attackSign(0, half) === side ? 0 : 1) as TeamId;
      const scorer = this.lastTouch?.player ?? null;
      const ownGoal = this.lastTouch ? this.lastTouch.team !== team : false;
      return { type: 'goal', team, scorer, ownGoal };
    }
    const out = ballOut(ball);
    if (!out) return null;
    const lastTeam = this.lastTouch?.team ?? 0;
    const other = (1 - lastTeam) as TeamId;
    if (out.line === 'touch') {
      const x = Math.max(-PITCH.halfLength + 0.5, Math.min(PITCH.halfLength - 0.5, ball.x));
      return { type: 'restart', kind: 'throw-in', team: other, spot: { x, z: out.side * (PITCH.halfWidth - 0.6) }, reason: 'out' };
    }
    const defending = (attackSign(0, half) === out.side ? 1 : 0) as TeamId;
    const zSide = ball.z >= 0 ? 1 : -1;
    if (lastTeam === defending) {
      return { type: 'restart', kind: 'corner', team: (1 - defending) as TeamId, spot: { x: out.side * (PITCH.halfLength - 0.5), z: zSide * (PITCH.halfWidth - 0.5) }, reason: 'out' };
    }
    return { type: 'restart', kind: 'goal-kick', team: defending, spot: { x: out.side * (PITCH.halfLength - PITCH.goalAreaDepth), z: zSide * 4 }, reason: 'out' };
  }

  /** The engine calls this when a dead ball has been placed for a restart. */
  awaitRestart(kind: RestartKind, team: TeamId): void {
    this.pendingRestart = { kind, team };
    this.offsideCandidates.clear();
  }
}

/** Distance opponents must keep at a restart (Laws 13–17). */
export function restartDistance(kind: RestartKind): number {
  return kind === 'throw-in' ? 2 : kind === 'drop-ball' ? 4 : 9.15;
}

/** Spot for a penalty kick (Law 14) against the team defending `goalSide`. */
export function penaltySpot(goalSide: 1 | -1): Vec2 {
  return { x: goalSide * (PITCH.halfLength - PITCH.penaltyMark), z: 0 };
}
