import RAPIER from '@dimforge/rapier3d-simd-compat';
import { expect, it } from 'vitest';
import { MatchEngine } from './match-engine';
import type { MatchEvent } from './types';

/**
 * A full 2 × 45 minute autonomous match with statistics. Runs only via `npm run sim` (several minutes).
 * Optional: SIM_SEED, SIM_HALF_MINUTES.
 */
const enabled = process.env.npm_lifecycle_event === 'sim';

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
  const count = (type: MatchEvent['type'], f: (ev: MatchEvent) => boolean = () => true) => events.filter(ev => ev.type === type && f(ev)).length;
  const passes = events.filter(ev => ev.type === 'swing' && ev.action === 'pass') as Extract<MatchEvent, { type: 'swing' }>[];
  let completed = 0;
  for (const pass of passes) {
    const i = events.indexOf(pass);
    const next = events.slice(i + 1).find(ev => (ev.type === 'touch' && ev.player !== pass.player) || ev.type === 'out' || ev.type === 'goal' || ev.type === 'offside');
    if (next?.type === 'touch' && e.profiles[next.player].team === e.profiles[pass.player].team) completed++;
  }
  const team = (ev: MatchEvent) => ('player' in ev ? e.profiles[ev.player].team : 'team' in ev ? ev.team : -1);
  const report = {
    seed, halfMinutes, phase: e.phase, score: e.score,
    shots: [0, 1].map(t => count('swing', ev => ev.type === 'swing' && ev.action === 'shot' && team(ev) === t)),
    passes: passes.length, passCompletion: +(completed / Math.max(1, passes.length)).toFixed(2),
    possession: possession.map(p => +(p / Math.max(1, possession[0] + possession[1])).toFixed(2)),
    ballInPlay: +(inPlay / e.tick).toFixed(2),
    fouls: count('foul'), yellow: count('foul', ev => ev.type === 'foul' && ev.card === 'yellow'), red: count('foul', ev => ev.type === 'foul' && ev.card === 'red'),
    penalties: count('foul', ev => ev.type === 'foul' && ev.penalty), offsides: count('offside'), corners: count('out', ev => ev.type === 'out' && ev.restart === 'corner'),
    throwIns: count('out', ev => ev.type === 'out' && ev.restart === 'throw-in'), goalKicks: count('out', ev => ev.type === 'out' && ev.restart === 'goal-kick'),
    keeperCatches: count('catch'), msPerStep: +(ms / e.tick).toFixed(3), wallSeconds: Math.round(ms / 1000),
  };
  console.log(JSON.stringify(report, null, 1));
  expect(e.phase).toBe('full-time');
}, 3_600_000);
