import RAPIER from '@dimforge/rapier3d-simd-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { MatchEngine } from './match-engine';
import { applyLineup, createRoster } from './rosters';
import type { TeamInstruction } from './types';

beforeAll(async () => {
  await RAPIER.init();
});

const id = (team: 0 | 1, role: string, squad: 'starter' | 'bench') => createRoster(7).find(p => p.team === team && p.role === role && p.squad === squad)!.id;
const run = (e: MatchEngine, ticks: number) => { for (let i = 0; i < ticks; i++) e.step(); };

describe('team sheet before kick-off', () => {
  it('rejects sheets the laws do not allow', () => {
    const p = createRoster(7);
    expect(() => applyLineup(p, [{ off: id(0, 'GK', 'starter'), on: id(0, 'ST', 'bench') }])).toThrow(/keeper/);
    expect(() => applyLineup(createRoster(7), [{ off: id(0, 'ST', 'starter'), on: id(1, 'ST', 'bench') }])).toThrow(/different teams/);
    expect(() => applyLineup(createRoster(7), [{ off: id(0, 'ST', 'bench'), on: id(0, 'ST', 'starter') }])).toThrow(/bench/);
  });

  it('starts the bench player in the starter\'s position; the starter waits off the pitch', () => {
    const off = id(0, 'LW', 'starter'), on = id(0, 'RW', 'bench');
    const e = new MatchEngine({ seed: 3, halfMinutes: 2, lineup: [{ off, on }] });
    expect(e.profiles[on]).toMatchObject({ squad: 'starter', role: 'LW' });
    expect(e.profiles[off]).toMatchObject({ squad: 'bench', role: 'RW' });
    expect(e.referee.sentOff.has(on)).toBe(false);
    expect(e.referee.sentOff.has(off)).toBe(true);
    run(e, 600);
    // He plays: he moved on the pitch, the replaced starter stayed outside it.
    expect(Math.abs(e.bodies[on].position().z)).toBeLessThan(34);
    expect(Math.abs(e.bodies[off].position().z)).toBeGreaterThan(34);
    expect(e.benchOf(0).some(p => p.id === off)).toBe(true);
  });

  it('without changes the match is exactly the default one', () => {
    const a = new MatchEngine({ seed: 9, halfMinutes: 2 });
    const b = new MatchEngine({ seed: 9, halfMinutes: 2, lineup: [], instructions: [undefined, undefined] });
    run(a, 900); run(b, 900);
    expect(b.ballPos()).toEqual(a.ballPos());
    expect(b.events.map(x => x.type)).toEqual(a.events.map(x => x.type));
  });
});

describe('tactics before kick-off', () => {
  const high: TeamInstruction = { press: 'high', lineHeight: 0.8, risk: 0.8 };
  const low: TeamInstruction = { press: 'low', lineHeight: -0.8, risk: 0.2 };

  it('holds from the first tick and moves the real players', () => {
    const a = new MatchEngine({ seed: 4, halfMinutes: 2, instructions: [high, undefined] });
    const b = new MatchEngine({ seed: 4, halfMinutes: 2, instructions: [low, undefined] });
    expect(a.instructions[0]).toEqual(high);
    expect(b.instructions[1]).toEqual({ press: 'mid', lineHeight: 0, risk: 0.5 });
    run(a, 1200); run(b, 1200);
    // Average distance of team 0's back four from their own goal line: higher with the high line.
    const line = (e: MatchEngine) => {
      const backs = e.profiles.filter(p => p.team === 0 && ['RB', 'RCB', 'LCB', 'LB'].includes(p.role) && p.squad === 'starter');
      return backs.reduce((s, p) => s + e.sign(0) * e.bodies[p.id].position().x, 0) / backs.length;
    };
    expect(line(a)).toBeGreaterThan(line(b) + 2);
  });
});
