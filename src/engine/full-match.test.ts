import RAPIER from '@dimforge/rapier3d-simd-compat';
import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MatchEngine } from './match-engine';
import { matchStats } from './match-stats';
import type { MatchEvent } from './types';

/**
 * An autonomous match with statistics. Runs only via `npm run sim` (full match, several minutes) or as one
 * seed of `npm run probe` (scripts/probe.mjs). Optional: SIM_SEED, SIM_HALF_MINUTES, SIM_OUT (JSON file).
 */
const enabled = process.env.npm_lifecycle_event === 'sim' || !!process.env.SIM_OUT;

it.runIf(enabled)('full-match simulation', async () => {
  await RAPIER.init();
  const seed = Number(process.env.SIM_SEED ?? 2026);
  const halfMinutes = Number(process.env.SIM_HALF_MINUTES ?? 45);
  const e = new MatchEngine({ seed, halfMinutes });
  const events: MatchEvent[] = [];
  e.onEvent(ev => events.push(ev));
  const started = performance.now();
  let inPlay = 0;
  const possession = [0, 0];
  while (e.phase !== 'full-time' && e.time < halfMinutes * 120 + 600) {
    e.step();
    if (e.phase === 'in-play') {
      inPlay++;
      const p = e.possession();
      if (p !== null) possession[p]++;
    }
  }
  const ms = performance.now() - started;
  const stats = matchStats(events, e.profiles);
  const report = {
    seed, halfMinutes, phase: e.phase, ...stats,
    passCompletion: +(stats.passesCompleted / Math.max(1, stats.passes)).toFixed(2),
    possession: possession.map(p => +(p / Math.max(1, possession[0] + possession[1])).toFixed(2)),
    ballInPlay: +(inPlay / e.tick).toFixed(2),
    msPerStep: +(ms / e.tick).toFixed(3), wallSeconds: Math.round(ms / 1000),
  };
  if (process.env.SIM_OUT) writeFileSync(process.env.SIM_OUT, JSON.stringify(report));
  else console.log(JSON.stringify(report, null, 1));
  expect(e.phase).toBe('full-time');
}, 3_600_000);
