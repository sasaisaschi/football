import type { MatchEngine } from '../engine/match-engine';
import type { DecisionMoment, MomentCategory, MomentKind, TeamId } from '../engine/types';
import { teamTalkMoment } from './coach';
import type { MomentDraft } from './common';
import { attackingMoment, boxDefenceMoment, breakawayMoment, transitionMoment, type PossessionTrack } from './open-play';
import { cornerMoment, freeKickMoment, penaltyMoment, throwInMoment } from './set-pieces';

/** How often open play is looked at (s): the carrier's window between control and his next swing is short. */
const CHECK_INTERVAL = 0.1;
/**
 * Moments per half for each kind of situation, within the overall limit. Without them the most frequent kind
 * crowded out the rest: counter-press moments filled every half, attacking moments never came (4 matches).
 */
const CATEGORY_LIMIT: Record<MomentCategory, number> = { attack: 3, transition: 1, defence: 2, 'set-piece': 2, coach: 1 };
/** Set pieces of one kind per half: throw-ins and free kicks are frequent, a corner or a penalty is not. */
const KIND_LIMIT: Partial<Record<MomentKind, number>> = { 'throw-in': 1, 'free-kick': 1 };
/** Categories each half keeps room for until late in the half, so that no fixed quota crowds the others out. */
const RESERVED: readonly MomentCategory[] = ['attack', 'set-piece', 'defence'];
/** From this share of the half on, reserved room is given up again (a category that did not come by then rarely will). */
const RESERVE_UNTIL = 0.75;
/**
 * A set piece may follow another moment after a third of the usual spacing: corners mostly come straight out of an
 * attack, and with the full spacing none of 8 matches × 2 × 15 min offered a single corner (measured).
 */
const SET_PIECE_SPACING = 1 / 3;

export type OrchestratorConfig = {
  userTeam: TeamId;
  /** Minimum simulated seconds between two moments, so decisions stay rare and meaningful. */
  cooldown: number;
  maxPerHalf: number;
  timeoutSeconds: number;
};

export const DEFAULT_ORCHESTRATOR: OrchestratorConfig = { userTeam: 0, cooldown: 75, maxPerHalf: 5, timeoutSeconds: 15 };

/** One opened moment, for the distribution measured over seeds and halves. */
export type MomentRecord = { id: number; kind: MomentKind; category: MomentCategory; half: 1 | 2; clock: number };

/**
 * The Orchestrator. It watches the current match state – never the future – and asks: is there a choice here that a
 * human understands and that the players can really carry out? In open play it looks every 0.1 s; at every placed
 * restart exactly once before it is taken. Recognisers propose moments from the frozen state; the orchestrator keeps
 * them rare, spread over the half and varied. It never sets an outcome.
 */
export class Orchestrator {
  readonly log: MomentRecord[] = [];
  private nextCheck = 0;
  private lastMomentAt = -Infinity;
  private momentsThisHalf = 0;
  private perCategory = emptyCounts();
  private perKind = new Map<MomentKind, number>();
  private half: 1 | 2 = 1;
  private nextId = 1;
  private lastTouchTeam: TeamId | null = null;
  private readonly track: PossessionTrack = { possessionChangedAt: -Infinity, lostSpell: 0 };
  private teamTalkDone = false;

  constructor(readonly config: OrchestratorConfig = DEFAULT_ORCHESTRATOR) {}

  /** Plug into the engine: `engine.director = orchestrator.attach()`. */
  attach() {
    return (engine: MatchEngine) => this.evaluate(engine);
  }

  evaluate(e: MatchEngine): DecisionMoment | null {
    if (e.half !== this.half) { this.half = e.half; this.momentsThisHalf = 0; this.perCategory = emptyCounts(); this.perKind.clear(); }
    const touchTeam = e.referee.lastTouch?.team ?? null;
    if (touchTeam !== this.lastTouchTeam) {
      this.track.lostSpell = e.time - this.track.possessionChangedAt;
      this.lastTouchTeam = touchTeam;
      this.track.possessionChangedAt = e.time;
    }
    if (e.phase === 'stopped') return this.beforeRestart(e);
    if (e.time < this.nextCheck) return null;
    this.nextCheck = e.time + CHECK_INTERVAL;
    if (!this.mayOpen(e, 1)) return null;
    const team = this.config.userTeam;
    const draft = (this.allowed(e, 'attack') ? attackingMoment(e, team) : null)
      ?? (this.allowed(e, 'transition') ? transitionMoment(e, team, this.track) : null)
      ?? (this.allowed(e, 'defence') ? breakawayMoment(e, team) ?? boxDefenceMoment(e, team) : null);
    return draft ? this.open(e, draft, true) : null;
  }

  /** Called by the engine once for each placed restart, before the taker can play it. */
  private beforeRestart(e: MatchEngine): DecisionMoment | null {
    const r = e.restart;
    if (!r) return null;
    const team = this.config.userTeam;
    if (r.kind === 'kickoff') {
      if (e.half !== 2 || this.teamTalkDone) return null;
      this.teamTalkDone = true;
      const talk = teamTalkMoment(e, team);
      // The half-time talk is the coach's own moment: outside the half's quota and cooldown.
      return talk ? this.open(e, talk, false) : null;
    }
    // A penalty is rare and always decisive enough: only the overall limit applies, not the spacing.
    const penalty = r.kind === 'penalty';
    if (!this.mayOpen(e, penalty ? 0 : SET_PIECE_SPACING)) return null;
    const kind: MomentKind | null = r.kind === 'throw-in' ? 'throw-in' : r.kind === 'corner' ? 'corner' : r.kind === 'free-kick' ? 'free-kick' : penalty ? 'penalty' : null;
    if (!kind || !this.allowed(e, 'set-piece', kind)) return null;
    const draft = kind === 'throw-in' ? throwInMoment(e, team) : kind === 'corner' ? cornerMoment(e, team) : kind === 'free-kick' ? freeKickMoment(e, team) : penaltyMoment(e, team);
    return draft ? this.open(e, draft, true) : null;
  }

  /** Spacing (this share of the cooldown), overall limit and pacing over the half: no more than about the share of the half already played. */
  private mayOpen(e: MatchEngine, spacing: number): boolean {
    if (e.time - this.lastMomentAt < this.config.cooldown * spacing) return false;
    if (this.momentsThisHalf >= this.config.maxPerHalf) return false;
    const share = e.clockSeconds() / (e.config.halfMinutes * 60);
    return this.momentsThisHalf < 1 + this.config.maxPerHalf * share;
  }

  /** Quota of the category (and kind), keeping room for the reserved categories not yet seen this half. */
  private allowed(e: MatchEngine, category: MomentCategory, kind?: MomentKind): boolean {
    if (this.perCategory[category] >= CATEGORY_LIMIT[category]) return false;
    if (kind && (this.perKind.get(kind) ?? 0) >= (KIND_LIMIT[kind] ?? Infinity)) return false;
    if (e.clockSeconds() >= RESERVE_UNTIL * e.config.halfMinutes * 60) return true;
    const missing = RESERVED.filter(c => c !== category && this.perCategory[c] === 0).length;
    return this.momentsThisHalf + 1 + missing <= this.config.maxPerHalf;
  }

  private open(e: MatchEngine, draft: MomentDraft, counts: boolean): DecisionMoment {
    if (counts) {
      this.lastMomentAt = e.time;
      this.momentsThisHalf++;
      this.perCategory[draft.category]++;
      this.perKind.set(draft.kind, (this.perKind.get(draft.kind) ?? 0) + 1);
    }
    const moment: DecisionMoment = { ...draft, id: this.nextId++, tick: e.tick, team: this.config.userTeam, timeoutSeconds: this.config.timeoutSeconds };
    this.log.push({ id: moment.id, kind: moment.kind, category: moment.category, half: e.half, clock: e.clockSeconds() });
    return moment;
  }
}

function emptyCounts(): Record<MomentCategory, number> {
  return { attack: 0, transition: 0, defence: 0, 'set-piece': 0, coach: 0 };
}
