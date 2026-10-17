import { describe, expect, it } from 'vitest';
import { createRoster } from './rosters';
import { matchStats } from './match-stats';
import type { MatchEvent } from './types';

const roster = createRoster(7);
const id = (team: 0 | 1, role: string) => roster.find(p => p.team === team && p.role === role)!.id;
let n = 0;
const at = (time: number, e: Record<string, unknown>) => ({ id: ++n, tick: Math.round(time * 60), time, ...e }) as MatchEvent;
const touch = (time: number, player: number, part: 'boot' | 'body' = 'boot') => at(time, { type: 'touch', player, part, ballSpeed: 5, position: { x: 0, y: 0.11, z: 0 } });
const swing = (time: number, player: number, action: string) => at(time, { type: 'swing', player, action, source: 'ai' });

describe('match statistics', () => {
  it('counts a completed pass and a turnover after a failed pass', () => {
    const cm = id(0, 'CM'), st = id(0, 'ST'), cb = id(1, 'RCB');
    const s = matchStats([
      swing(1, cm, 'pass'), touch(1.2, cm), touch(2.5, st),
      swing(3, st, 'pass'), touch(3.2, st), touch(4, cb),
    ], roster);
    expect(s.passes).toBe(2);
    expect(s.passesCompleted).toBe(1);
    expect(s.possessionChanges).toBe(1);
    expect(s.lossesAfter.pass).toBe(1);
  });

  it('a stoppage is no turnover, a ball off the body is classified, a quick return is ping-pong', () => {
    const cm = id(0, 'CM'), cb = id(1, 'RCB');
    const s = matchStats([
      touch(1, cm), at(2, { type: 'out', restart: 'throw-in', team: 1, position: { x: 0, z: 34 } }), at(4, { type: 'restart', restart: 'throw-in', team: 1, position: { x: 0, z: 34 } }),
      touch(5, cb), touch(6, cm, 'body'), touch(6.5, cb),
    ], roster);
    expect(s.throwIns).toBe(1);
    expect(s.possessionChanges).toBe(2);
    expect(s.lossesAfter.body).toBe(1);
    expect(s.lossesAfter.none).toBe(1);
    expect(s.pingPong).toBe(1);
  });
});
