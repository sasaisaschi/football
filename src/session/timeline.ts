import type { MatchEvent } from '../engine/types';

/** Frames are handed to the match intelligence every this many ticks (0.25 simulated seconds). */
export const OBSERVE_TICKS = 15;

/**
 * The shown match time and everything that follows from it, independent of how it is shown (manager view or 3D
 * scene) and of how fast it moves: every event is handed on exactly once, in order, when the shown time reaches its
 * tick, and frames are observed on a fixed grid of simulated time. So the timeline, the statistics and the insights
 * are the same whether a stretch was skimmed in the manager view or watched in a scene.
 */
export class Timeline {
  tick = 0;
  private cursor = 0;
  private nextObserve = 0;
  /** Events handed on so far (the browser check compares it with what the simulation produced). */
  dispatched = 0;

  constructor(
    private readonly events: readonly MatchEvent[],
    private readonly onEvent: (e: MatchEvent) => void,
    private readonly onObserve: (tick: number) => void,
  ) {}

  /** Moves the shown time forward to `tick` (never backwards). */
  advanceTo(tick: number): void {
    if (tick < this.tick) return;
    const whole = Math.floor(tick);
    // Events and observations in tick order, so an insight never sees a frame before the event that preceded it.
    while (true) {
      const e = this.events[this.cursor];
      const eventTick = e && e.tick <= whole ? e.tick : Infinity;
      const observeTick = this.nextObserve <= whole ? this.nextObserve : Infinity;
      if (eventTick === Infinity && observeTick === Infinity) break;
      if (eventTick <= observeTick) { this.cursor++; this.dispatched++; this.onEvent(e); }
      else { this.onObserve(observeTick); this.nextObserve += OBSERVE_TICKS; }
    }
    this.tick = tick;
  }
}
