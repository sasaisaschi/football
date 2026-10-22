import type { MatchEngine } from '../engine/match-engine';
import type { PlayerProfile, Role, SubReason, TeamId } from '../engine/types';
import { neutralConfidence } from './mind';
import { DEFENDERS, FORWARDS, MIDFIELDERS } from './shape';

export type BenchChange = { off: number; on: number; role?: Role; reason: SubReason };

/** Out of form: confidence this far below the player's neutral level, with at least this many of his last actions failed. */
const POOR_FORM = -0.15, FAILED = 3;
/** From which share of the second half a change for form or a card, chasing a game or protecting a lead is made. */
const FORM_FROM = 0.5, CHASE_FROM = 0.55, PROTECT_FROM = 0.7;
/** Changes per stoppage: two at most, as coaches usually do. */
const PER_STOPPAGE = 2;
/** Least time between two of his substitution occasions, as a share of a half (three changes in two minutes looked like panic). */
const OCCASION_GAP = 0.1;

const lineOf = (r: Role) => (DEFENDERS.has(r) ? 'def' : MIDFIELDERS.has(r) ? 'mid' : FORWARDS.has(r) ? 'fwd' : 'gk');

/**
 * The coach of a team the user does not control. At each stoppage he looks at what is known in the match – a keeper
 * sent off, players' form from their real actions, yellow cards, the score and the time – and makes changes through
 * the same Law 3 substitution as the user (`MatchEngine.substitute`). Deterministic: no randomness, same match → same
 * changes. Chasing a game and protecting a lead happen once per match.
 */
export class BenchManager {
  private readonly used = new Set<SubReason>();
  /** Match clock (s, counted through both halves) of his last occasion. */
  private lastOccasion = -Infinity;

  constructor(readonly team: TeamId) {}

  /** The changes he wants at this stoppage, already checked against the bench, the limits and each other. */
  decide(e: MatchEngine): BenchChange[] {
    if (!e.canSubstitute(this.team)) return [];
    const team = this.team;
    const onPitch = e.profiles.filter(p => p.team === team && !e.referee.sentOff.has(p.id));
    const field = onPitch.filter(p => p.role !== 'GK');
    const bench = e.benchOf(team);
    const outfieldBench = bench.filter(p => p.role !== 'GK');
    const changes: BenchChange[] = [];
    const taken = new Set<number>();
    const add = (off: PlayerProfile | undefined, on: PlayerProfile | undefined, reason: SubReason, role?: Role) => {
      if (!off || !on || taken.has(off.id) || taken.has(on.id) || changes.length >= PER_STOPPAGE) return;
      if (e.substitutions[team] + changes.length >= 5) return;
      taken.add(off.id).add(on.id);
      changes.push({ off: off.id, on: on.id, reason, ...(role ? { role } : {}) });
    };
    const form = (p: PlayerProfile) => e.minds[p.id].confidence - neutralConfidence(e.minds[p.id].baseline);
    const free = (list: PlayerProfile[]) => list.filter(p => !taken.has(p.id));
    const sameLine = (off: PlayerProfile) => free(outfieldBench).find(b => lineOf(b.role) === lineOf(off.role)) ?? free(outfieldBench)[0];

    // A keeper sent off: the substitute keeper goes in goal for an outfield player, at any time (the most forward one).
    if (!onPitch.some(p => p.role === 'GK')) {
      const keeper = bench.find(p => p.role === 'GK');
      const forward = [...field].sort((a, b) => order(b.role) - order(a.role) || form(a) - form(b))[0];
      add(forward, keeper, 'keeper', 'GK');
    }
    if (e.half !== 2) return changes;
    const share = e.clockSeconds() / (e.config.halfMinutes * 60);
    if (this.clock(e) - this.lastOccasion < OCCASION_GAP * e.config.halfMinutes * 60) return changes;
    const halfTime = share < 0.01;
    const [ours, theirs] = team === 0 ? e.score : [e.score[1], e.score[0]];

    if (halfTime || share >= FORM_FROM) {
      // One change for form per stoppage: the worst of those out of form (three at once in one minute looked like panic).
      const poor = [...field].sort((a, b) => form(a) - form(b)).find(p => form(p) <= POOR_FORM && e.minds[p.id].recent.filter(r => !r.ok).length >= FAILED);
      if (poor) add(poor, sameLine(poor), 'form');
      const booked = field.filter(p => e.referee.yellow.has(p.id) && lineOf(p.role) === 'def');
      for (const p of booked) add(p, sameLine(p), 'card');
    }
    if (share >= CHASE_FROM && ours < theirs && !this.used.has('chase')) {
      const mid = free(field).filter(p => lineOf(p.role) === 'mid').sort((a, b) => form(a) - form(b))[0];
      const striker = free(outfieldBench).filter(b => lineOf(b.role) === 'fwd').sort((a, b) => b.abilities.shooting - a.abilities.shooting)[0];
      add(mid, striker, 'chase');
    }
    if (share >= PROTECT_FROM && ours > theirs && !this.used.has('protect')) {
      const fwd = free(field).filter(p => lineOf(p.role) === 'fwd').sort((a, b) => form(a) - form(b))[0];
      const stopper = free(outfieldBench).filter(b => lineOf(b.role) !== 'fwd').sort((a, b) => b.abilities.tackling - a.abilities.tackling)[0];
      add(fwd, stopper, 'protect');
    }
    return changes;
  }

  private clock(e: MatchEngine): number {
    return e.clockSeconds() + (e.half === 2 ? e.config.halfMinutes * 60 : 0);
  }

  /** Makes this stoppage's changes; each one is a real Law 3 substitution. */
  atStoppage(e: MatchEngine): void {
    const changes = this.decide(e);
    if (changes.length) this.lastOccasion = this.clock(e);
    for (const c of changes) {
      if (!e.canSubstitute(this.team)) return;
      e.substitute(c.off, c.on, c.role, c.reason);
      if (c.reason === 'chase' || c.reason === 'protect') this.used.add(c.reason);
    }
  }
}

/** How far forward a role plays (the keeper's replacement leaves from the front). */
function order(r: Role): number {
  return lineOf(r) === 'fwd' ? 3 : lineOf(r) === 'mid' ? 2 : lineOf(r) === 'def' ? 1 : 0;
}
