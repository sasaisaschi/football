/// <reference lib="webworker" />
import RAPIER from '@dimforge/rapier3d-simd-compat';
import type { DecisionSource } from '../engine/types';
import { SimRunner, type Batch, type RunnerConfig } from './runner';

/**
 * The simulation thread. It computes the match chronologically as fast as the CPU allows, but never further ahead of
 * what is on screen than AHEAD_SECONDS, and never past an open decision moment: it then waits for the user's choice.
 */
export type ToWorker =
  | { type: 'start'; config: RunnerConfig }
  | { type: 'resolve'; optionId: string; by: DecisionSource }
  | { type: 'display'; tick: number };
export type FromWorker =
  | { type: 'ready'; profiles: SimRunner['profiles']; batch: Batch }
  | { type: 'batch'; batch: Batch }
  | { type: 'error'; message: string };

/** Ticks per batch: about half a simulated second. */
const CHUNK = 30;
/** How far the simulation may run ahead of the picture (simulated seconds). */
const AHEAD_SECONDS = 90;

const scope = self as unknown as DedicatedWorkerGlobalScope;
let runner: SimRunner | null = null;
let displayTick = 0;
let pumping = false;
// Yield to incoming messages without the 4 ms clamp of nested timers.
const channel = new MessageChannel();
let resume: (() => void) | null = null;
channel.port1.onmessage = () => { const r = resume; resume = null; r?.(); };
const yieldNow = () => new Promise<void>(r => { resume = r; channel.port2.postMessage(0); });

function post(msg: FromWorker, batch?: Batch): void {
  scope.postMessage(msg, batch ? [batch.frames.buffer] : []);
}

async function pump(): Promise<void> {
  if (pumping || !runner) return;
  pumping = true;
  try {
    const r = runner;
    while (r.engine.phase !== 'decision' && r.engine.phase !== 'full-time' && r.engine.tick - displayTick < AHEAD_SECONDS * 60) {
      const batch = r.advance(CHUNK);
      post({ type: 'batch', batch }, batch);
      await yieldNow();
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) });
  } finally {
    pumping = false;
  }
}

scope.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'start') {
      await RAPIER.init();
      runner = new SimRunner(msg.config);
      const batch = runner.current();
      post({ type: 'ready', profiles: runner.profiles, batch }, batch);
      void pump();
    } else if (msg.type === 'resolve') {
      runner?.resolve(msg.optionId, msg.by);
      void pump();
    } else if (msg.type === 'display') {
      displayTick = msg.tick;
      void pump();
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) });
  }
};
