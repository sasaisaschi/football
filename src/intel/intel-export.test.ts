import RAPIER from '@dimforge/rapier3d-simd-compat';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, it } from 'vitest';
import { MatchEngine } from '../engine/match-engine';
import type { MatchEvent } from '../engine/types';
import { Orchestrator } from '../orchestrator/orchestrator';
import { IntelBoard } from './board';

/**
 * Headless export of one synthetic match: the complete event log and the match intelligence derived from it, as two
 * JSON files (a synthetic football dataset plus its explained intelligence feed). Runs only via `npm run intel`
 * (scripts/intel.mjs): INTEL_OUT=<directory>, INTEL_SEED, INTEL_HALF (minutes per half).
 */
const out = process.env.INTEL_OUT;

it.runIf(!!out)('export a synthetic match and its intelligence', async () => {
  await RAPIER.init();
  const seed = Number(process.env.INTEL_SEED ?? 7), halfMinutes = Number(process.env.INTEL_HALF ?? 15);
  const e = new MatchEngine({ seed, halfMinutes, benchCoach: [1] });
  e.director = new Orchestrator({ userTeam: 0, cooldown: Math.max(20, Math.round((75 * halfMinutes) / 45)), maxPerHalf: 5, timeoutSeconds: 15 }).attach();
  const board = new IntelBoard(e.profiles, halfMinutes);
  const events: MatchEvent[] = [];
  let pending: MatchEvent[] = [];
  e.onEvent(ev => { events.push(ev); pending.push(ev); });
  while (e.phase !== 'full-time' && e.time < halfMinutes * 120 + 600) {
    e.step();
    if (e.phase === 'decision') { board.noteMoment(e.moment!); e.resolveMoment(e.moment!.defaultOptionId, 'timeout'); }
    const frame = e.snapshot();
    for (const ev of pending) board.ingest(ev, frame);
    pending = [];
    board.observe(frame);
  }
  const dir = out!;
  mkdirSync(dir, { recursive: true });
  const intel = board.export({ seed, userTeam: 0, score: e.score });
  writeFileSync(`${dir}/match-${seed}-events.json`, JSON.stringify({ schema: 'the12thman.events/v1', seed, halfMinutes, roster: e.profiles.map(p => ({ id: p.id, name: p.name, number: p.number, team: p.team, role: p.role, squad: p.squad })), events }, null, 1));
  writeFileSync(`${dir}/match-${seed}-intel.json`, JSON.stringify(intel, null, 1));
  console.log(`${events.length} events, ${intel.insights.length} insights → ${dirname(`${dir}/x`)}`);
  for (const i of intel.insights) console.log(`${i.clock} [${i.kind}] FAN: ${i.text.fan.en.title} – ${i.text.fan.en.text}\n        ANALYST: ${i.text.analyst.en.title} – ${i.text.analyst.en.text}`);
  expect(e.phase).toBe('full-time');
}, 3_600_000);
