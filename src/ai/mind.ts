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

export type JudgedAction = 'pass' | 'dribble' | 'shot';
export type MindView = { traits: Traits; confidence: number; recent: { action: JudgedAction; ok: boolean }[] };

export class PlayerMind {
  confidence: number;
  readonly recent: { action: JudgedAction; ok: boolean; time: number }[] = [];

  constructor(readonly traits: Traits) {
    this.confidence = traits.confidence;
  }

  record(action: JudgedAction, ok: boolean, time: number): void {
    const c = this.confidence;
    const moved = ok ? c + GAIN * (1 - c) : c - LOSS * c;
    this.confidence = moved + RELAX * (this.traits.confidence - moved);
    this.recent.push({ action, ok, time });
    if (this.recent.length > RECENT) this.recent.shift();
  }

  /**
   * Added to an option's value in the player's own choice. Individual, risky actions (shot, dribble) gain with
   * appetite for risk and with confidence, lose with team orientation; a pass gains with team orientation.
   */
  bias(kind: OptionKind): number {
    const t = this.traits;
    if (kind === 'shot' || kind === 'dribble') return (t.risk - 0.5) * 0.006 + (this.confidence - 0.5) * 0.014 - (t.teamplay - 0.5) * 0.004;
    if (kind === 'pass') return (t.teamplay - 0.5) * 0.004 - (this.confidence - 0.5) * 0.003;
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
  private open: { player: number; action: JudgedAction; time: number; contacted: boolean } | null = null;

  constructor(private readonly profiles: readonly PlayerProfile[], private readonly minds: readonly PlayerMind[]) {}

  onEvent(e: MatchEvent): void {
    if (this.open && e.time - this.open.time > OPEN_FOR) this.open = null;
    const o = this.open;
    switch (e.type) {
      case 'swing':
        if (e.action === 'pass' || e.action === 'dribble' || e.action === 'shot') {
          // The dribbler gets to swing at the ball again after his touch: that carry kept the ball.
          if (o && o.player === e.player && o.action === 'dribble' && o.contacted) this.settle(true, e.time);
          this.open = { player: e.player, action: e.action, time: e.time, contacted: false };
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
        else this.settle(mate, e.time);
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

  private settle(ok: boolean, time: number): void {
    const o = this.open!;
    this.minds[o.player].record(o.action, ok, time);
    this.open = null;
  }
}
