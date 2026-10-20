/**
 * Presentation pacing over the frames the simulation has already computed. It never shows anything that was not
 * simulated tick by tick and never runs ahead of the simulation; it only chooses how fast the picture moves:
 *
 *  - live (real time): the last seconds before a decision moment, the consequence after a decision, shots and goals;
 *  - condensed: everything in between, as fast as the simulation allows (a clearly labelled fast-forward);
 *  - held: the picture has reached an open moment and waits for the user.
 *
 * Because the simulation runs ahead of the picture, the build-up to a moment can be shown in real time without
 * computing anything beyond the moment itself.
 */
export type KeyTick = { tick: number; kind: 'moment' | 'decision' | 'shot' | 'goal' };
export type PlaybackMode = 'live' | 'condensed' | 'held';

const HZ = 60;
/** Real-time windows around key events, in simulated seconds before and after. */
const WINDOW: Record<KeyTick['kind'], [number, number]> = { moment: [5, 0], decision: [0, 8], shot: [1.5, 3.5], goal: [3, 6] };
/** Fast-forward pace range (× real time). */
export const MIN_FAST = 4, MAX_FAST = 24;
/** While condensing, the picture keeps at least this much simulated time behind the simulation (s), so that a moment found next still has its build-up to show. */
const MIN_LAG = 6;

export type PlaybackInput = {
  /** Last tick the simulation has produced. */
  produced: number;
  /** Tick at which an open moment froze the simulation, if any. */
  momentTick: number | null;
  /** The simulation has reached full time. */
  done: boolean;
  keys: readonly KeyTick[];
  /** Condense quiet play (default) or show everything at the classic pace. */
  condense: boolean;
  /** Classic pace when not condensing: 1, or a mild time-lapse in quiet play (Phase A guards). */
  classicPace: number;
};

export class Playback {
  tick = 0;
  speed = 1;
  mode: PlaybackMode = 'live';

  update(dt: number, input: PlaybackInput): void {
    const limit = input.momentTick ?? input.produced;
    if (input.momentTick !== null && this.tick >= input.momentTick) {
      this.tick = input.momentTick;
      this.mode = 'held';
      this.speed = 1;
      return;
    }
    const live = !input.condense || this.inWindow(input.keys, this.tick, this.speed);
    const target = !input.condense ? input.classicPace : live ? 1 : this.fastPace(input, limit);
    // Ease towards the target pace; slowing down is quick so a window is not overshot.
    const k = 1 - Math.exp(-dt * (target < this.speed ? 10 : 2.5));
    this.speed += (target - this.speed) * k;
    if (Math.abs(this.speed - target) < 0.02) this.speed = target;
    this.mode = this.speed > 1.5 ? 'condensed' : 'live';
    // Never beyond what exists; while condensing, keep the lag that a later moment's build-up needs.
    const cap = input.momentTick !== null || input.done || !input.condense || live ? limit : Math.max(this.tick, limit - MIN_LAG * HZ);
    this.tick = Math.min(cap, this.tick + dt * HZ * this.speed);
  }

  /** In a real-time window now, or about to enter one at the current pace? */
  private inWindow(keys: readonly KeyTick[], tick: number, speed: number): boolean {
    const ahead = tick + Math.max(0, speed - 1) * HZ * 0.6;
    for (const k of keys) {
      const [before, after] = WINDOW[k.kind];
      const start = k.tick - before * HZ, end = k.tick + after * HZ;
      if (ahead >= start && tick <= end) return true;
    }
    return false;
  }

  /** As fast as there is material for: more simulated time waiting means a faster picture. */
  private fastPace(input: PlaybackInput, limit: number): number {
    const waiting = (limit - this.tick) / HZ - (input.momentTick !== null || input.done ? 0 : MIN_LAG);
    return Math.max(MIN_FAST, Math.min(MAX_FAST, waiting * 1.2));
  }
}
