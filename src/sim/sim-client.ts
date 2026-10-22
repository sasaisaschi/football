import type { DecisionMoment, DecisionSource, MatchEvent, MatchSnapshot, PlayerProfile } from '../engine/types';
import { decodeFrame } from './frame-codec';
import type { KeyTick } from './playback';
import type { Batch, RunnerConfig } from './runner';
import type { FromWorker, ToWorker } from './sim-worker';

type Chunk = { first: number; count: number; frames: Float32Array };
/** Frames older than this behind the picture are released (s). */
const KEEP_BEHIND = 10;

/**
 * Main-thread side of the simulation worker: keeps the computed frames and events in order, knows whether the
 * simulation is waiting at a moment, and forwards the user's decision. It never changes the match itself.
 */
export class SimClient {
  profiles: PlayerProfile[] = [];
  readonly events: MatchEvent[] = [];
  readonly keys: KeyTick[] = [];
  moment: DecisionMoment | null = null;
  momentTick: number | null = null;
  produced = -1;
  done = false;
  minds: MatchSnapshot['minds'] = [];
  /** Milliseconds the worker spent computing. */
  cpuMs = 0;
  error: string | null = null;
  private chunks: Chunk[] = [];
  private floats = 0;
  private readonly worker: Worker;
  private lastDisplayPost = -Infinity;
  private readyResolve: (() => void) | null = null;
  readonly ready: Promise<void>;
  private readonly listeners: ((e: MatchEvent) => void)[] = [];

  constructor(config: RunnerConfig) {
    this.worker = new Worker(new URL('./sim-worker.ts', import.meta.url), { type: 'module' });
    this.ready = new Promise(r => { this.readyResolve = r; });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.receive(ev.data);
    this.worker.onerror = ev => { this.error = ev.message; };
    this.send({ type: 'start', config });
  }

  /** Events arriving from the simulation, in order (as computed – the picture may still be behind them). */
  onEvent(listener: (e: MatchEvent) => void): void {
    this.listeners.push(listener);
  }

  private send(msg: ToWorker): void {
    this.worker.postMessage(msg);
  }

  private receive(msg: FromWorker): void {
    if (msg.type === 'error') { this.error = msg.message; console.error(`simulation: ${msg.message}`); return; }
    if (msg.type === 'ready') this.profiles = msg.profiles;
    this.take(msg.batch);
    if (msg.type === 'ready') this.readyResolve?.();
  }

  private take(b: Batch): void {
    if (this.floats === 0 && b.count > 0) this.floats = b.frames.length / b.count;
    if (b.count > 0) {
      this.chunks.push({ first: b.firstTick, count: b.count, frames: b.frames });
      this.produced = b.firstTick + b.count - 1;
    }
    this.cpuMs += b.cpuMs;
    this.minds = b.minds;
    for (const e of b.events) {
      this.events.push(e);
      if (e.type === 'goal') this.keys.push({ tick: e.tick, kind: 'goal' });
      if (e.type === 'swing' && e.action === 'shot') this.keys.push({ tick: e.tick, kind: 'shot' });
      if (e.type === 'moment') this.keys.push({ tick: e.tick, kind: 'moment' });
      if (e.type === 'decision') this.keys.push({ tick: e.tick, kind: 'decision' });
      for (const l of this.listeners) l(e);
    }
    if (b.moment) { this.moment = b.moment; this.momentTick = this.produced; }
    if (b.done) this.done = true;
  }

  /** The frame for a tick (clamped to what exists). */
  frame(tick: number): MatchSnapshot {
    const t = Math.max(this.chunks[0]?.first ?? 0, Math.min(this.produced, Math.round(tick)));
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      if (t >= c.first && t < c.first + c.count) {
        const s = decodeFrame(c.frames, (t - c.first) * this.floats, this.profiles.length);
        s.moment = this.moment && this.momentTick !== null && t >= this.momentTick ? this.moment : null;
        s.minds = this.minds;
        return s;
      }
    }
    throw new Error(`frame ${t} is not available (have ${this.chunks[0]?.first}–${this.produced})`);
  }

  /** The picture has moved on: lets the worker keep its distance and frees frames long gone. */
  displayed(tick: number, wall: number): void {
    if (wall - this.lastDisplayPost > 0.25) {
      this.lastDisplayPost = wall;
      this.send({ type: 'display', tick: Math.floor(tick) });
    }
    while (this.chunks.length > 1 && this.chunks[0].first + this.chunks[0].count < tick - KEEP_BEHIND * 60) this.chunks.shift();
  }

  resolve(optionId: string, by: DecisionSource): void {
    if (!this.moment) return;
    this.moment = null;
    this.momentTick = null;
    this.send({ type: 'resolve', optionId, by });
  }

  dispose(): void {
    this.worker.terminate();
  }
}
