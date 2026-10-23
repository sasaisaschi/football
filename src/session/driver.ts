import type { DecisionMoment, DecisionSource, MatchEvent } from '../engine/types';
import { isSceneMoment, SessionFlow } from './flow';
import { buildUpStep, BUILD_UP, consequenceStep, HZ, INTERVAL_PACE, MANAGER_PACE, managerCap, managerStep, readyForMoment, type SimState } from './pacing';
import { Timeline } from './timeline';

/** What the session needs from the simulation (the worker client in the browser, a runner in tests). */
export interface SimSource {
  readonly produced: number;
  readonly momentTick: number | null;
  readonly moment: DecisionMoment | null;
  readonly done: boolean;
  readonly events: readonly MatchEvent[];
  resolve(optionId: string, by: DecisionSource): void;
}

/** What the presentation does at each step of the session (manager screens, 3D scene). */
export interface SessionHooks {
  event(e: MatchEvent): void;
  observe(tick: number): void;
  sceneBegins(m: DecisionMoment, fromTick: number): void;
  frozen(m: DecisionMoment): void;
  coach(m: DecisionMoment): void;
  interval(): void;
  sceneEnds(): void;
  final(): void;
  /** Has the consequence of the last decision been observed (the consequence card has its result)? */
  consequenceSettled(): boolean;
}

/** The consequence is shown at least this long, at most this long, and held this long after its result (simulated s). */
const CONSEQUENCE_MIN = 4, CONSEQUENCE_MAX = 14, CONSEQUENCE_HOLD = 2.5;
/** Without a team talk the half-time screen may close once the second half has started this long ago (s). */
const NO_TALK_AFTER = 2;

/**
 * Drives one manager session: the flow (flow.ts), the shown match time (timeline.ts) at the right pace (pacing.ts),
 * and the handover between manager view and 3D scene. It reads the simulation and decides nothing in the match; a
 * decision goes to the simulation exactly once through `decide`.
 */
export class SessionDriver {
  readonly flow = new SessionFlow();
  readonly timeline: Timeline;
  paused = false;
  private halfTimeAt: number | null = null;
  private intervalShown = false;
  private secondHalfKickoff: number | null = null;
  private decidedAt = 0;
  private settledAt: number | null = null;
  private sceneMoment: DecisionMoment | null = null;

  constructor(private readonly sim: SimSource, private readonly hooks: SessionHooks) {
    this.timeline = new Timeline(sim.events, e => this.onEvent(e), t => hooks.observe(t));
  }

  get tick(): number { return this.timeline.tick; }
  get moment(): DecisionMoment | null { return this.sceneMoment; }

  kickOff(): void { this.flow.kickOff(); }

  private state(): SimState {
    const m = this.sim.moment;
    return { produced: this.sim.produced, momentTick: m ? this.sim.momentTick : null, sceneMoment: !!m && isSceneMoment(m), done: this.sim.done };
  }

  private onEvent(e: MatchEvent): void {
    if (e.type === 'half-time') this.halfTimeAt = e.tick;
    if (e.type === 'kickoff' && e.half === 2) this.secondHalfKickoff = e.tick;
    this.hooks.event(e);
  }

  update(dt: number): void {
    const f = this.flow, s = this.state();
    switch (f.phase) {
      case 'manager': {
        if (!this.paused) this.timeline.advanceTo(managerStep(this.tick, dt, MANAGER_PACE, s));
        if (this.halfTimeAt !== null && !this.intervalShown) { this.intervalShown = true; f.halfTime(); this.hooks.interval(); return; }
        const m = this.sim.moment;
        if (m && readyForMoment(this.tick, s) && !f.open) {
          if (isSceneMoment(m)) this.beginScene(m);
          else { f.coachMoment(m); this.hooks.coach(m); }
          return;
        }
        if (s.done && this.tick >= s.produced) { f.fullTime(); this.hooks.final(); }
        return;
      }
      case 'interval': {
        // The simulation goes on to the second half's kick-off, where the team talk opens.
        this.timeline.advanceTo(managerStep(this.tick, dt, INTERVAL_PACE, s));
        const m = this.sim.moment;
        if (m && !f.open && readyForMoment(this.tick, s) && !isSceneMoment(m)) { f.coachMoment(m); this.hooks.coach(m); }
        return;
      }
      case 'build-up': {
        const m = this.sceneMoment!, at = this.sim.momentTick!;
        this.timeline.advanceTo(buildUpStep(this.tick, dt, at));
        if (this.tick >= at) { f.frozen(); this.hooks.frozen(m); }
        return;
      }
      case 'consequence': {
        this.timeline.advanceTo(consequenceStep(this.tick, dt, s.produced));
        const since = (this.tick - this.decidedAt) / HZ;
        if (this.settledAt === null && this.hooks.consequenceSettled()) this.settledAt = this.tick;
        const next = this.sim.moment;
        // The next moment follows within the consequence: straight into its build-up, without leaving the scene.
        if (next && isSceneMoment(next) && this.tick >= managerCap(s)) { this.beginScene(next); return; }
        const held = this.settledAt !== null && (this.tick - this.settledAt) / HZ >= CONSEQUENCE_HOLD;
        const end = (since >= CONSEQUENCE_MIN && held) || since >= CONSEQUENCE_MAX || this.halfTimeAt !== null && !this.intervalShown
          || (next !== null && !isSceneMoment(next) && this.tick >= managerCap(s)) || (s.done && this.tick >= s.produced);
        if (end) { this.sceneMoment = null; f.sceneEnds(); this.hooks.sceneEnds(); }
        return;
      }
      default:
    }
  }

  private beginScene(m: DecisionMoment): void {
    this.sceneMoment = m;
    this.settledAt = null;
    this.flow.sceneBegins(m);
    this.hooks.sceneBegins(m, Math.max(this.tick, this.sim.momentTick! - BUILD_UP * HZ));
  }

  /** The open moment is decided: once in the flow, once in the simulation. */
  decide(optionId: string, by: DecisionSource): void {
    const m = this.flow.open;
    if (!m) throw new Error('No moment is open');
    this.flow.decide(m.id);
    this.decidedAt = this.tick;
    this.sim.resolve(optionId, by);
  }

  /** May the half-time screen close? Once the team talk is decided, or when the second half started without one. */
  canStartSecondHalf(): boolean {
    if (this.flow.phase !== 'interval' || this.flow.open) return false;
    if (this.flow.log.some(l => l.phase === 'interval' && l.moment !== undefined)) return true;
    return this.secondHalfKickoff !== null && (this.sim.produced - this.secondHalfKickoff) / HZ >= NO_TALK_AFTER && !this.sim.moment;
  }

  secondHalf(): void {
    if (!this.canStartSecondHalf()) throw new Error('The second half cannot start yet');
    this.flow.secondHalf();
  }
}
