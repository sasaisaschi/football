import { MatchEngine } from '../engine/match-engine';
import type { DecisionMoment, DecisionSource, MatchEvent, PlayerProfile, TeamId } from '../engine/types';
import { Orchestrator } from '../orchestrator/orchestrator';
import { encodeFrame, frameSize } from './frame-codec';

export type RunnerConfig = { seed: number; halfMinutes: number; userTeam: TeamId; cooldown: number; maxPerHalf: number; timeoutSeconds: number };

/** Ticks simulated since the last batch: frames (one per tick, in order), the events they produced and where the match stands. */
export type Batch = {
  /** Tick of the first frame in `frames`. */
  firstTick: number;
  count: number;
  frames: Float32Array;
  events: MatchEvent[];
  /** Set when the simulation stopped at an open moment: nothing after it exists yet. */
  moment: DecisionMoment | null;
  minds: { confidence: number; recent: { action: 'pass' | 'dribble' | 'shot'; ok: boolean }[] }[];
  done: boolean;
  /** Milliseconds of computing for this batch. */
  cpuMs: number;
};

/**
 * Drives the one authoritative engine strictly in order, tick by tick. It stops as soon as the orchestrator opens a
 * moment and never computes past it; after the decision it carries on from exactly that state. Used by the web
 * worker and directly by tests.
 */
export class SimRunner {
  readonly engine: MatchEngine;
  readonly orchestrator: Orchestrator;
  readonly frameFloats: number;
  private events: MatchEvent[] = [];

  constructor(readonly config: RunnerConfig) {
    this.engine = new MatchEngine({ seed: config.seed, halfMinutes: config.halfMinutes });
    this.orchestrator = new Orchestrator({ userTeam: config.userTeam, cooldown: config.cooldown, maxPerHalf: config.maxPerHalf, timeoutSeconds: config.timeoutSeconds });
    this.engine.director = this.orchestrator.attach();
    this.engine.onEvent(e => this.events.push(e));
    this.frameFloats = frameSize(this.engine.profiles.length);
  }

  get profiles(): PlayerProfile[] {
    return this.engine.profiles;
  }

  /** The current state as a single frame (start of the match). */
  current(): Batch {
    const frames = new Float32Array(this.frameFloats);
    encodeFrame(this.engine.snapshot(), frames);
    return this.batch(this.engine.tick, 1, frames, 0);
  }

  /** Steps up to `maxTicks` ticks; stops early at an open moment or at full time. */
  advance(maxTicks: number): Batch {
    const t0 = performance.now();
    const e = this.engine;
    const frames = new Float32Array(this.frameFloats * maxTicks);
    const first = e.tick + 1;
    let n = 0;
    while (n < maxTicks && e.phase !== 'decision' && e.phase !== 'full-time') {
      const before = e.tick;
      e.step();
      // A step that opens a moment stops before time moves on: there is no new frame.
      if (e.tick === before) continue;
      encodeFrame(e.snapshot(), frames, n * this.frameFloats);
      n++;
    }
    return this.batch(first, n, n === maxTicks ? frames : frames.slice(0, n * this.frameFloats), performance.now() - t0);
  }

  resolve(optionId: string, by: DecisionSource): void {
    this.engine.resolveMoment(optionId, by);
  }

  private batch(firstTick: number, count: number, frames: Float32Array, cpuMs: number): Batch {
    const e = this.engine;
    const events = this.events;
    this.events = [];
    return {
      firstTick, count, frames, events, cpuMs,
      moment: e.phase === 'decision' ? e.moment : null,
      minds: e.minds.map(m => ({ confidence: m.confidence, recent: m.recent.map(r => ({ action: r.action, ok: r.ok })) })),
      done: e.phase === 'full-time',
    };
  }
}
