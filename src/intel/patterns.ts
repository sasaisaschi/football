import type { DecisionMoment, DecisionSource, MatchEvent, MatchSnapshot, TeamId } from '../engine/types';
import type { MatchStatsBoard, ShotRecord } from './stats';
import type { Insight, InsightKind } from './types';

/** Window of the rolling patterns (simulated s) and how often they are looked at. */
const WINDOW = 300, LOOK_EVERY = 30;
/** Share of the window's attacking time one team needs to "be on top", and the least attacking time to say so (s). */
const ON_TOP = 0.65, ON_TOP_MIN = 90;
/** A move with this many completed passes is a spell of control. */
const CONTROL_PASSES = 8;
/** Possession changes in the last minute against the match's average rate for a "chaotic" phase. */
const CHAOS_FACTOR = 1.6, CHAOS_MIN_MINUTES = 3;
/** Thresholds for notable shots: a big chance, a big save, a fast shot (m/s). */
const BIG_CHANCE = 0.2, BIG_SAVE = 0.12, FAST_SHOT = 25;
/** A pass or restart this long before a goal without its own move can still be its origin (s). */
const ASSIST_WINDOW = 10;
/** How long a decision's consequences are followed (simulated s), as on the consequence card. */
const DECISION_FOLLOW = 12;
/** The same pattern for the same team is not repeated within this time (s). */
const REPEAT_GAP = 240;

type OpenDecision = { moment: DecisionMoment; optionId: string; by: DecisionSource; time: number; possession: TeamId | null; eventIds: number[]; actor: number };

/**
 * Stage 3 – explain: turns statistics and events into insights that say why a moment matters (the story of a goal, a
 * big save, which team is on top and why, control or chaos, a press that works, what came of the user's decision).
 * Each insight keeps the numbers and the event ids it is derived from; nothing is estimated beyond the model values
 * that are labelled as such (xG, difficulty).
 */
export class PatternDetector {
  readonly insights: Insight[] = [];
  private nextId = 1;
  private lastLook = 0;
  private readonly lastOf = new Map<string, number>();
  private readonly series: { time: number; territory: [number, number]; shots: [number, number]; xg: [number, number]; changes: number }[] = [];
  private onTop: TeamId | null = null;
  private fastestShot = 0;
  private controlMoveTime = -1;
  private decision: OpenDecision | null = null;
  private moment: DecisionMoment | null = null;

  constructor(private readonly stats: MatchStatsBoard, private readonly clockOf: (frame: MatchSnapshot) => string) {}

  private add(frame: MatchSnapshot, kind: InsightKind, team: TeamId | null, player: number | null, priority: Insight['priority'], data: Insight['data'], eventIds: number[]): Insight {
    const insight: Insight = { id: this.nextId++, tick: frame.tick, time: frame.time, clock: this.clockOf(frame), kind, team, player, priority, data, eventIds };
    this.insights.push(insight);
    return insight;
  }

  private fresh(key: string, time: number): boolean {
    const last = this.lastOf.get(key);
    if (last !== undefined && time - last < REPEAT_GAP) return false;
    this.lastOf.set(key, time);
    return true;
  }

  /** The moment the user is deciding, handed in by whoever shows it (its options and estimates are not in the events). */
  noteMoment(m: DecisionMoment): void {
    this.moment = m;
  }

  /** After the statistics have taken the event in. Returns the insights it produced. */
  onEvent(e: MatchEvent, frame: MatchSnapshot): Insight[] {
    const before = this.insights.length;
    const s = this.stats;
    const lastShot: ShotRecord | undefined = s.shots[s.shots.length - 1];
    if ((e.type === 'touch' || e.type === 'catch' || e.type === 'out') && lastShot && lastShot.eventIds[lastShot.eventIds.length - 1] === e.id) this.shotSettled(lastShot, e, frame);
    if (e.type === 'touch' && lastShot && lastShot.eventIds[1] === e.id) this.shotStruck(lastShot, frame);
    if (e.type === 'goal') this.goal(e, frame);
    if (e.type === 'half-time' || e.type === 'full-time') this.summary(e.type === 'half-time' ? 'half-summary' : 'full-summary', frame, e.id);
    if (e.type === 'decision' && this.moment?.id === e.momentId) {
      this.decision = { moment: this.moment, optionId: e.optionId, by: e.chosenBy, time: e.time, possession: frame.possession, eventIds: [e.id], actor: this.moment.focusPlayer };
    }
    this.followDecision(e, frame);
    const move = s.move;
    if (move && move.passes >= CONTROL_PASSES && move.time !== this.controlMoveTime) {
      this.controlMoveTime = move.time;
      this.add(frame, 'control', move.team, null, 2, { passes: move.passes, seconds: Math.round(e.time - move.time), origin: move.origin }, move.eventIds.slice(-CONTROL_PASSES));
    }
    return this.insights.slice(before);
  }

  private shotStruck(shot: ShotRecord, frame: MatchSnapshot): void {
    // A new record only when it is clearly faster (1 km/h), not by rounding.
    if (shot.speed >= this.fastestShot + 1 / 3.6 && shot.speed >= FAST_SHOT) {
      const previous = this.fastestShot;
      this.fastestShot = shot.speed;
      this.add(frame, 'speed', shot.team, shot.player, 1, { kmh: Math.round(shot.speed * 3.6), previousKmh: Math.round(previous * 3.6), distance: Math.round(shot.distance) }, shot.eventIds.slice(0, 2));
    } else this.fastestShot = Math.max(this.fastestShot, shot.speed);
  }

  private shotSettled(shot: ShotRecord, e: MatchEvent, frame: MatchSnapshot): void {
    const base = { xg: +shot.xg.toFixed(2), distance: Math.round(shot.distance), kmh: Math.round(shot.speed * 3.6) };
    if (shot.outcome === 'saved' && shot.xg >= BIG_SAVE && (e.type === 'touch' || e.type === 'catch')) {
      this.add(frame, 'save', (1 - shot.team) as TeamId, e.player, 2, { ...base, shooter: shot.player, caught: e.type === 'catch' }, shot.eventIds);
    } else if ((shot.outcome === 'off-target' || shot.outcome === 'blocked') && shot.xg >= BIG_CHANCE) {
      this.add(frame, 'big-chance', shot.team, shot.player, 2, { ...base, outcome: shot.outcome }, shot.eventIds);
    }
  }

  private goal(e: Extract<MatchEvent, { type: 'goal' }>, frame: MatchSnapshot): void {
    const s = this.stats;
    const shot = [...s.shots].reverse().find(x => x.outcome === 'goal' && x.eventIds.includes(e.id));
    const move = s.move && s.move.team === e.team ? s.move : null;
    // Straight from a restart of the scoring team (a penalty, a rebound off the keeper after it): that is the origin.
    const restart = !move && s.lastRestart && s.lastRestart.team === e.team && e.time - s.lastRestart.time <= ASSIST_WINDOW ? s.lastRestart : null;
    // The last pass only counts within this move (or shortly before the goal without one): never a pass from long before.
    const since = move ? move.time : e.time - ASSIST_WINDOW;
    const assist = e.scorer === null ? undefined : [...s.passes].reverse().find(p => p.completed && p.nextToucher === e.scorer && p.team === e.team && p.time >= since && (!restart || p.time >= restart.time));
    const data: Insight['data'] = {
      ownGoal: e.ownGoal, score: `${frame.score[0]}:${frame.score[1]}`,
      passes: move?.passes ?? 0, origin: move?.origin ?? restart?.kind ?? 'none', zone: move?.zone ?? 'none', seconds: move ? Math.round(e.time - move.time) : 0,
    };
    if (shot) Object.assign(data, { xg: +shot.xg.toFixed(2), distance: Math.round(shot.distance), kmh: Math.round(shot.speed * 3.6) });
    if (assist) data.assist = assist.passer;
    const ids = [...(move?.eventIds ?? []), ...(shot?.eventIds ?? []), e.id];
    this.add(frame, 'goal-story', e.team, e.scorer, 3, data, [...new Set(ids)].sort((a, b) => a - b));
  }

  private summary(kind: 'half-summary' | 'full-summary', frame: MatchSnapshot, eventId: number): void {
    const t = this.stats.teams, total = t[0].possession + t[1].possession || 1;
    const data: Insight['data'] = { score: `${frame.score[0]}:${frame.score[1]}` };
    for (const k of [0, 1] as const) {
      Object.assign(data, {
        [`possession${k}`]: Math.round((t[k].possession / total) * 100), [`shots${k}`]: t[k].shots, [`xg${k}`]: +t[k].xg.toFixed(2),
        [`passAcc${k}`]: t[k].passes ? Math.round((t[k].passesCompleted / t[k].passes) * 100) : 0, [`pressureWins${k}`]: t[k].pressureWins,
      });
    }
    this.add(frame, kind, null, null, 3, data, [eventId]);
  }

  /** What came of the user's decision, judged on the events that followed (the same rules as the consequence card). */
  private followDecision(e: MatchEvent, frame: MatchSnapshot): void {
    const d = this.decision;
    if (!d || e.id === d.eventIds[0]) return;
    const team = d.moment.team;
    const defending = d.possession !== null && d.possession !== team;
    const done = (outcome: string) => {
      const option = d.moment.options.find(o => o.id === d.optionId)!;
      this.add(frame, 'decision', team, d.actor, 3, {
        title: d.moment.title, choice: option.label, by: d.by, outcome, seconds: Math.round(e.time - d.time),
        ...(option.estimate !== undefined ? { estimate: Math.round(option.estimate * 100) } : {}),
      }, [...d.eventIds, e.id]);
      this.decision = null;
    };
    if (e.time - d.time > DECISION_FOLLOW) return done('no-clear-result');
    d.eventIds.push(e.id);
    if (d.moment.category === 'coach') {
      const fx = d.moment.options.find(o => o.id === d.optionId)!.effect;
      return done(fx.type === 'substitution' ? 'substitution' : fx.type === 'team' ? 'instruction' : 'no-change');
    }
    if (e.type === 'goal') return done(e.team === team ? 'goal' : 'conceded');
    // A shot that came of it is the outcome, even when it then went out.
    const shot = this.stats.shots[this.stats.shots.length - 1];
    if (!defending && shot && shot.team === team && shot.time >= d.time && shot.outcome !== 'open') return done(`shot-${shot.outcome}`);
    if (e.type === 'foul') return done('foul');
    if (e.type === 'out') return done(e.team === team ? 'out-ours' : 'out-theirs');
    if (e.type !== 'touch' && e.type !== 'catch') return;
    const ours = this.stats.profiles[e.player].team === team;
    if (defending && ours) return done('won-back');
    if (!defending && !ours && this.stats.turnovers.some(t => t.time >= d.time && t.winner !== team)) return done('lost');
    const pass = this.stats.passes[this.stats.passes.length - 1];
    if (!defending && pass && pass.time >= d.time && pass.passer === d.actor && pass.completed) return done('pass-arrived');
  }

  /** Rolling patterns over the last minutes, looked at every LOOK_EVERY simulated seconds. */
  look(frame: MatchSnapshot): Insight[] {
    if (frame.time - this.lastLook < LOOK_EVERY || frame.phase !== 'in-play') return [];
    this.lastLook = frame.time;
    const before = this.insights.length;
    const s = this.stats, t = s.teams;
    const point = {
      time: frame.time, territory: [t[0].territory, t[1].territory] as [number, number], shots: [t[0].shots, t[1].shots] as [number, number],
      xg: [t[0].xg, t[1].xg] as [number, number], changes: s.possessionChanges,
    };
    this.series.push(point);
    const old = [...this.series].reverse().find(p => frame.time - p.time >= WINDOW) ?? this.series[0];
    const span = frame.time - old.time;
    if (span < 120) return [];
    const minutes = +(span / 60).toFixed(1);
    const terr = [0, 1].map(k => point.territory[k] - old.territory[k]);
    const both = terr[0] + terr[1];
    for (const k of [0, 1] as const) {
      const share = both > 0 ? terr[k] / both : 0;
      if (share >= ON_TOP && both >= ON_TOP_MIN && this.onTop !== k) {
        this.onTop = k;
        this.add(frame, 'momentum', k, null, 2, { share: Math.round(share * 100), minutes, shots: point.shots[k] - old.shots[k], xg: +(point.xg[k] - old.xg[k]).toFixed(2), otherShots: point.shots[1 - k] - old.shots[1 - k] }, []);
      }
      // A press up the pitch that works clearly better than the other side's.
      const high = (team: TeamId) => s.pressures.filter(p => p.team === team && p.high && p.time >= old.time);
      const mine = high(k), theirs = high((1 - k) as TeamId);
      const wins = mine.filter(p => p.won).length, rate = mine.length ? wins / mine.length : 0;
      const otherRate = theirs.length ? theirs.filter(p => p.won).length / theirs.length : 0;
      if (wins >= 4 && rate >= otherRate + 0.1 && this.fresh(`press${k}`, frame.time)) {
        this.add(frame, 'pressing', k, null, 2, { wins, presses: mine.length, rate: Math.round(rate * 100), otherRate: Math.round(otherRate * 100), minutes }, []);
      }
      const shots = point.shots[k] - old.shots[k], xg = point.xg[k] - old.xg[k];
      if ((shots >= 3 || xg >= 0.5) && this.fresh(`danger${k}`, frame.time)) {
        this.add(frame, 'danger', k, null, 2, { shots, xg: +xg.toFixed(2), minutes }, s.shots.filter(x => x.team === k && x.time >= old.time).flatMap(x => x.eventIds.slice(0, 1)));
      }
    }
    // Control or chaos: the last minute's possession changes against the match's own average rate.
    const lastMinute = s.turnovers.filter(x => frame.time - x.time <= 60);
    const playedMinutes = (t[0].possession + t[1].possession) / 60;
    const average = playedMinutes > 0 ? s.possessionChanges / playedMinutes : 0;
    if (playedMinutes >= CHAOS_MIN_MINUTES && lastMinute.length >= average * CHAOS_FACTOR && this.fresh('chaos', frame.time)) {
      this.add(frame, 'chaos', null, null, 1, { changes: lastMinute.length, average: +average.toFixed(1) }, lastMinute.map(x => x.eventId));
    }
    return this.insights.slice(before);
  }
}
