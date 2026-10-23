import type { DecisionMoment } from '../engine/types';

/**
 * The phases of one manager session:
 *
 *   prep ─▶ manager ─▶ build-up ─▶ decide ─▶ consequence ─▶ manager …
 *              │  ▲                                  │
 *              │  └──────────── coach ◀──────────────┘ (substitution dialog, no 3D)
 *              └─▶ interval (half-time screen; the team talk is decided in it) ─▶ manager … ─▶ final
 *
 * A consequence may lead straight into the next build-up when the next moment follows within it. Every moment is
 * decided exactly once; a scene cannot open while another moment is open. Illegal transitions throw, so a broken
 * sequence shows up as an error instead of a silently lost decision.
 */
export type SessionPhase = 'prep' | 'manager' | 'build-up' | 'decide' | 'consequence' | 'coach' | 'interval' | 'final';

/** Moments shown as a 3D scene; the coach's moments (team talk, substitution) are manager screens. */
export const isSceneMoment = (m: DecisionMoment) => m.category !== 'coach';

export class SessionFlow {
  phase: SessionPhase = 'prep';
  /** The moment currently open (between its scene or dialog opening and its decision). */
  open: DecisionMoment | null = null;
  private readonly decided = new Set<number>();
  /** Every transition, for the browser check. */
  readonly log: { phase: SessionPhase; moment?: number }[] = [];

  private allowed(phase: SessionPhase, from: readonly SessionPhase[]): void {
    if (!from.includes(this.phase)) throw new Error(`Session: ${this.phase} → ${phase} is not allowed`);
  }

  private go(phase: SessionPhase, from: readonly SessionPhase[], moment?: number): void {
    this.allowed(phase, from);
    this.phase = phase;
    this.log.push(moment === undefined ? { phase } : { phase, moment });
  }

  kickOff(): void { this.go('manager', ['prep']); }

  /** A scene moment's build-up starts in 3D. */
  sceneBegins(m: DecisionMoment): void {
    if (!isSceneMoment(m)) throw new Error('Session: a coach moment has no scene');
    this.allowed('build-up', ['manager', 'consequence']);
    this.claim(m);
    this.go('build-up', ['manager', 'consequence'], m.id);
  }

  /** The build-up has reached the frozen moment: the options are offered. */
  frozen(): void { this.go('decide', ['build-up'], this.open?.id); }

  /** A coach moment opens as a manager dialog, or inside the half-time screen (team talk). */
  coachMoment(m: DecisionMoment): void {
    if (isSceneMoment(m)) throw new Error('Session: a scene moment needs its scene');
    if (this.phase !== 'interval') this.allowed('coach', ['manager']);
    this.claim(m);
    if (this.phase === 'interval') { this.log.push({ phase: 'interval', moment: m.id }); return; }
    this.go('coach', ['manager'], m.id);
  }

  /** The open moment is decided (by the user, by delegation or by the countdown) – exactly once. */
  decide(momentId: number): void {
    const m = this.open;
    if (!m || m.id !== momentId) throw new Error(`Session: moment ${momentId} is not open`);
    if (this.decided.has(momentId)) throw new Error(`Session: moment ${momentId} was already decided`);
    this.decided.add(momentId);
    this.open = null;
    if (this.phase === 'decide') this.go('consequence', ['decide'], momentId);
    else if (this.phase === 'coach') this.go('manager', ['coach'], momentId);
    else if (this.phase !== 'interval') throw new Error(`Session: no decision possible in ${this.phase}`);
  }

  /** The consequence has been shown: back to the manager view. */
  sceneEnds(): void { this.go('manager', ['consequence']); }

  halfTime(): void { this.go('interval', ['manager']); }

  /** The half-time screen closes; a team talk must have been decided by then. */
  secondHalf(): void {
    if (this.open) throw new Error('Session: the team talk is still open');
    this.go('manager', ['interval']);
  }

  fullTime(): void { this.go('final', ['manager']); }

  get decisions(): number { return this.decided.size; }

  private claim(m: DecisionMoment): void {
    if (this.open) throw new Error(`Session: moment ${this.open.id} is still open`);
    if (this.decided.has(m.id)) throw new Error(`Session: moment ${m.id} was already decided`);
    this.open = m;
  }
}
