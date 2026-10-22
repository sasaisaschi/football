import RAPIER from '@dimforge/rapier3d-simd-compat';
import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MatchEngine } from './match-engine';
import { matchStats } from './match-stats';
import type { MatchEvent } from './types';
import { Orchestrator, DEFAULT_ORCHESTRATOR } from '../orchestrator/orchestrator';

/**
 * An autonomous match with statistics. Runs only via `npm run sim` (full match, several minutes) or as one
 * seed of `npm run probe` (scripts/probe.mjs). Optional: SIM_SEED, SIM_HALF_MINUTES, SIM_OUT (JSON file).
 * SIM_ORCHESTRATOR=1 adds the orchestrator with the app's settings for that half length (every moment settled by its
 * default after the countdown), to measure which moments a continuous match offers; team 1's coach then substitutes.
 * SIM_BENCH=1: both teams' substitutions by the computer's coach.
 */
const enabled = process.env.npm_lifecycle_event === 'sim' || !!process.env.SIM_OUT;

it.runIf(enabled)('full-match simulation', async () => {
  await RAPIER.init();
  const seed = Number(process.env.SIM_SEED ?? 2026);
  const halfMinutes = Number(process.env.SIM_HALF_MINUTES ?? 45);
  // With the orchestrator team 1's coach changes players as in the app; SIM_BENCH=1 lets both coaches do so.
  const benchCoach = process.env.SIM_BENCH ? [0, 1] as const : process.env.SIM_ORCHESTRATOR ? [1] as const : [];
  const e = new MatchEngine({ seed, halfMinutes, benchCoach: [...benchCoach] });
  const orchestrator = process.env.SIM_ORCHESTRATOR
    ? new Orchestrator({ ...DEFAULT_ORCHESTRATOR, cooldown: Math.max(20, Math.round((DEFAULT_ORCHESTRATOR.cooldown * halfMinutes) / 45)) })
    : null;
  if (orchestrator) e.director = orchestrator.attach();
  const events: MatchEvent[] = [];
  e.onEvent(ev => events.push(ev));
  const started = performance.now();
  let inPlay = 0;
  const possession = [0, 0];
  while (e.phase !== 'full-time' && e.time < halfMinutes * 120 + 600) {
    e.step();
    if (e.phase === 'decision') e.resolveMoment(e.moment!.defaultOptionId, 'timeout');
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
    moments: orchestrator?.log ?? [],
    // SIM_TRACE=1: the events of the 6 s before each goal, to see how goals come about.
    goalTraces: process.env.SIM_TRACE ? events.filter(ev => ev.type === 'goal').map(g => events.filter(ev => ev.time > g.time - 6 && ev.time <= g.time && ev.type !== 'player-contact').map(ev => {
      const who = 'player' in ev ? e.profiles[ev.player] : null;
      const pos = 'position' in ev ? ev.position : null;
      return `${ev.time.toFixed(1)} ${ev.type}${'action' in ev ? ':' + ev.action : ''}${'part' in ev ? ':' + ev.part : ''}${'restart' in ev ? ':' + ev.restart : ''}${who ? ` ${who.team}/${who.role}` : ''}${'ballSpeed' in ev ? ` v${ev.ballSpeed.toFixed(0)}` : ''}${pos ? ` @${pos.x.toFixed(0)},${pos.z.toFixed(0)}${'y' in pos ? ',' + (pos as { y: number }).y.toFixed(1) : ''}` : ''}${ev.type === 'goal' ? ` team${ev.team}${ev.ownGoal ? ' OWN' : ''}` : ''}`;
    })) : [],
    substitutions: events.filter(ev => ev.type === 'substitution').map(ev => ({ team: ev.team, reason: ev.reason ?? 'user', minute: Math.floor(ev.time / 60) })),
  };
  if (process.env.SIM_OUT) writeFileSync(process.env.SIM_OUT, JSON.stringify(report));
  else console.log(JSON.stringify(report, null, 1));
  expect(e.phase).toBe('full-time');
}, 3_600_000);
