import type { MatchEvent, PlayerProfile, Traits } from '../engine/types';
import type { OptionKind } from './options';

/**
 * A player's character and recent experience. Traits are stable (from the roster seed); confidence moves with what
 * really happened to his own actions in this match, updated deterministically from match events. Both only shift how
 * a player weighs his options – never how well a kick is struck or what the ball does (that stays physics).
 *
 * Bounds (documented in PROJECT_REPORT.md §10.9): the bias is at most ≈ 0.01 expected threat, the scale of the coach's
 * risk setting and of the differences between close options; a clear best option is never overturned.
 */

/** How strongly one success (failure) moves confidence towards 1 (0). */
const GAIN = 0.12, LOSS = 0.16;
/** Confidence relaxes towards the player's own baseline with every further action. */
const RELAX = 0.05;
/** An action still open after this long (s) is not judged (the ball went somewhere unclear). */
const OPEN_FOR = 4;
/** Recent actions remembered for the form line. */
const RECENT = 6;

/** Share of judged actions that succeed in an average match (passes ≈ 78 %, dribbles and shots less): ≈ 0.76. */
const TYPICAL_SUCCESS = 0.76;

/**
 * Where confidence settles for a player with this baseline after many actions at the typical success rate: the fixed
 * point of `record` (gain, loss, relaxation towards the baseline), worked out in closed form.
 */
export function neutralConfidence(baseline: number): number {
  const p = TYPICAL_SUCCESS;
  const keep = (1 - RELAX) * (1 - p * GAIN - (1 - p) * LOSS);
  return ((1 - RELAX) * p * GAIN + RELAX * baseline) / (1 - keep);
}

export type JudgedAction = 'pass' | 'dribble' | 'shot';
export type MindView = { traits: Traits; confidence: number; recent: { action: JudgedAction; ok: boolean }[] };

/** Trust between two team-mates moves by these steps for a pass that arrived (passer, receiver) or went astray. */
const BOND_GAIN = 0.1, BOND_RECEIVED = 0.05, BOND_LOSS = 0.08;
/** How much trust in a receiver is worth in a pass's value (at most ≈ 0.003 expected threat). */
const BOND_WEIGHT = 0.003;
/** Population mean of the baseline confidence (rosters.ts): a higher baseline leans towards solo actions. */
const BASELINE_MEAN = 0.55;

export class PlayerMind {
  confidence: number;
  /** Baseline confidence: the trait, or what earlier matches made of it (agent-memory.ts). */
  baseline: number;
  readonly recent: { action: JudgedAction; ok: boolean; time: number }[] = [];
  /** Trust in team-mates (−1 … 1) from passes between them in this and earlier matches. */
  readonly bonds = new Map<number, number>();

  constructor(readonly traits: Traits) {
    this.baseline = traits.confidence;
    this.confidence = traits.confidence;
  }

  /** Starts from a baseline developed in earlier matches. */
  setBaseline(baseline: number): void {
    this.baseline = baseline;
    this.confidence = baseline;
  }

  bond(mate: number): number {
    return this.bonds.get(mate) ?? 0;
  }

  /** Trust moves towards +1 (or −1) by a step, never beyond. */
  adjustBond(mate: number, step: number): void {
    const b = this.bond(mate);
    this.bonds.set(mate, step >= 0 ? b + step * (1 - b) : b + step * (1 + b));
  }

  /** A pass of mine towards `receiver` arrived (true) or not: trust in him follows. */
  passTo(receiver: number, ok: boolean): void {
    this.adjustBond(receiver, ok ? BOND_GAIN : -BOND_LOSS);
  }

  /** Extra value of passing to a team-mate: more for one I trust. */
  bondBias(receiver: number): number {
    return this.bond(receiver) * BOND_WEIGHT;
  }

  record(action: JudgedAction, ok: boolean, time: number): void {
    const c = this.confidence;
    const moved = ok ? c + GAIN * (1 - c) : c - LOSS * c;
    this.confidence = moved + RELAX * (this.baseline - moved);
    this.recent.push({ action, ok, time });
    if (this.recent.length > RECENT) this.recent.shift();
  }

  /**
   * Added to an option's value in the player's own choice. Individual, risky actions (shot, dribble) gain with
   * appetite for risk and with confidence, lose with team orientation; a pass gains with team orientation.
   */
  bias(kind: OptionKind): number {
    const t = this.traits;
    // Form is how far confidence stands above or below where it settles for an average run of actions. Measured from
    // 0.5 it leaned every player towards solo actions, because confidence settles near 0.66: more dribbles, more
    // turnovers and throw-ins (24 seeds, §10.10).
    const form = this.confidence - neutralConfidence(this.baseline);
    // A self-assured player (high baseline, also grown over earlier matches) leans a little towards solo actions.
    const assured = (this.baseline - BASELINE_MEAN) * 0.006;
    if (kind === 'shot' || kind === 'dribble') return (t.risk - 0.5) * 0.006 + form * 0.014 - (t.teamplay - 0.5) * 0.004 + assured;
    if (kind === 'pass') return (t.teamplay - 0.5) * 0.004 - form * 0.003;
    if (kind === 'shield' || kind === 'clear') return -(t.risk - 0.5) * 0.004;
    return 0;
  }

  /** How much of the coach's risk setting the player takes on: 0.5 (undisciplined) … 1.5 (follows it to the letter). */
  compliance(): number {
    return 0.5 + this.traits.discipline;
  }

  view(): MindView {
    return { traits: { ...this.traits }, confidence: this.confidence, recent: this.recent.map(r => ({ action: r.action, ok: r.ok })) };
  }
}

/**
 * Judges each player's own ball actions from the event stream, in order: a pass is good when a team-mate touches the
 * ball next, a dribble when the dribbler or a team-mate does, a shot when it is on target (goal, keeper). Anything the
 * opponents touch first or that goes out is a failure. Pure function of the events, so a replay gives the same minds.
 */
export class ExperienceTracker {
  private open: { player: number; action: JudgedAction; time: number; contacted: boolean; receiver?: number } | null = null;

  constructor(private readonly profiles: readonly PlayerProfile[], private readonly minds: readonly PlayerMind[]) {}

  onEvent(e: MatchEvent): void {
    if (this.open && e.time - this.open.time > OPEN_FOR) this.open = null;
    const o = this.open;
    switch (e.type) {
      case 'swing':
        if (e.action === 'pass' || e.action === 'dribble' || e.action === 'shot') {
          // The dribbler gets to swing at the ball again after his touch: that carry kept the ball.
          if (o && o.player === e.player && o.action === 'dribble' && o.contacted) this.settle(true, e.time);
          this.open = { player: e.player, action: e.action, time: e.time, contacted: false, receiver: e.receiver };
        }
        return;
      case 'touch': {
        const cur = this.open;
        if (!cur) return;
        if (e.player === cur.player) {
          // His own contact with the ball is the action itself; what counts is who has it next.
          cur.contacted = true;
          return;
        }
        const mate = this.profiles[e.player].team === this.profiles[cur.player].team;
        if (cur.action === 'shot') this.settle(!mate && this.profiles[e.player].role === 'GK', e.time);
        else this.settle(mate, e.time, mate ? e.player : undefined);
        return;
      }
      case 'goal':
        if (this.open?.action === 'shot') this.settle(true, e.time);
        else this.open = null;
        return;
      case 'catch':
        if (this.open?.action === 'shot') this.settle(true, e.time);
        return;
      case 'out': case 'offside': case 'foul':
        if (this.open) this.settle(e.type === 'foul' && this.profiles[e.victim].team === this.profiles[this.open.player].team, e.time);
        return;
      default:
    }
  }

  /** `got`: the team-mate who received a pass that arrived. Trust grows both ways; a lost pass costs trust in its target. */
  private settle(ok: boolean, time: number, got?: number): void {
    const o = this.open!;
    const passer = this.minds[o.player];
    passer.record(o.action, ok, time);
    if (o.action === 'pass') {
      if (ok && got !== undefined) { passer.passTo(got, true); this.minds[got].adjustBond(o.player, BOND_RECEIVED); }
      else if (!ok && o.receiver !== undefined) passer.passTo(o.receiver, false);
    }
    this.open = null;
  }
}
