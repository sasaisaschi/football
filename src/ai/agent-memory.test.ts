import RAPIER from '@dimforge/rapier3d-simd-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/match-engine';
import { createRoster } from '../engine/rosters';
import { runFor, stageScenario } from '../engine/scenario-helper';
import type { MatchEvent } from '../engine/types';
import { emptyMemory, MEMORY_VERSION, parseMemory, playerKey, updateMemory, type AgentMemory } from './agent-memory';
import { ExperienceTracker, PlayerMind } from './mind';

beforeAll(async () => {
  await RAPIER.init();
});

const role = (e: MatchEngine, team: 0 | 1, r: string) => e.profiles.find(p => p.team === team && p.role === r && p.squad === 'starter')!.id;

describe('agents: relationships and memory across matches', () => {
  it('passes build trust both ways; a pass gone astray costs trust in its target', () => {
    const profiles = createRoster(7);
    const minds = profiles.map(p => new PlayerMind(p.traits));
    const t = new ExperienceTracker(profiles, minds);
    let id = 0;
    const ev = (e: Record<string, unknown>, time: number) => t.onEvent({ ...e, id: ++id, tick: 0, time } as MatchEvent);
    const pos = { x: 0, y: 0, z: 0 };
    ev({ type: 'swing', player: 6, action: 'pass', source: 'ai', receiver: 7 }, 1);
    ev({ type: 'touch', player: 6, part: 'boot', ballSpeed: 10, position: pos }, 1.1);
    ev({ type: 'touch', player: 7, part: 'boot', ballSpeed: 4, position: pos }, 2);
    ev({ type: 'swing', player: 6, action: 'pass', source: 'ai', receiver: 9 }, 3);
    ev({ type: 'touch', player: 6, part: 'boot', ballSpeed: 10, position: pos }, 3.1);
    ev({ type: 'touch', player: 15, part: 'boot', ballSpeed: 4, position: pos }, 3.6);
    expect(minds[6].bond(7)).toBeGreaterThan(0);
    expect(minds[7].bond(6)).toBeGreaterThan(0);
    expect(minds[6].bond(7)).toBeGreaterThan(minds[7].bond(6));
    expect(minds[6].bond(9)).toBeLessThan(0);
  });

  /** Central midfielder on the ball with two team-mates offering, almost equally good: who gets the pass? */
  const choice = (setup: (e: MatchEngine, a: number, b: number, cm: number) => void, memory?: AgentMemory) => {
    const e = new MatchEngine({ seed: 4, halfMinutes: 45, memory });
    const cm = role(e, 0, 'CM'), a = role(e, 0, 'LCM'), b = role(e, 0, 'RCM');
    stageScenario(e, { [cm]: { x: -5, z: 0 }, [a]: { x: 3, z: 11 }, [b]: { x: 3, z: -10.4 }, [role(e, 1, 'ST')]: { x: 3, z: 1 }, [role(e, 1, 'CM')]: { x: 10, z: 0 } }, { x: -4.6, y: 0.11, z: 0 });
    e.bodies[cm].heading = Math.PI / 2;
    e.referee.lastTouch = { player: cm, team: 0, part: 'boot', time: e.time, position: e.ballPos() };
    setup(e, a, b, cm);
    const from = e.events.length;
    runFor(e, 3, () => e.events.slice(from).some(ev => ev.type === 'swing' && ev.player === cm));
    const swing = e.events.slice(from).find(ev => ev.type === 'swing' && ev.player === cm);
    return swing?.type === 'swing' ? (swing.receiver === a ? 'A' : swing.receiver === b ? 'B' : String(swing.receiver)) : null;
  };

  it('trust decides between two close passes – as a real, executed pass', () => {
    expect(choice((e, a, _b, cm) => e.minds[cm].bonds.set(a, 0.9))).toBe('A');
    expect(choice((e, _a, b, cm) => e.minds[cm].bonds.set(b, 0.9))).toBe('B');
  }, 60_000);

  it('memory: versioned, deterministic, bounded, and carried into the next match where it changes a real choice', () => {
    const profiles = createRoster(7);
    const play = () => {
      const e = new MatchEngine({ seed: 5, halfMinutes: 45 });
      runFor(e, 120);
      return updateMemory(emptyMemory(7), e.minds, e.profiles);
    };
    const m1 = play();
    expect(m1.version).toBe(MEMORY_VERSION);
    expect(m1.matches).toBe(1);
    expect(play()).toEqual(m1);
    for (const p of profiles) {
      const m = m1.players[playerKey(p)];
      if (m) expect(Math.abs(m.baseline - p.traits.confidence)).toBeLessThanOrEqual(0.15 + 1e-9);
    }
    // Stored and read back; an older version or another roster starts fresh.
    expect(parseMemory(JSON.stringify(m1), 7)).toEqual(m1);
    expect(parseMemory(JSON.stringify({ ...m1, version: 0 }), 7)).toBeNull();
    expect(parseMemory(JSON.stringify(m1), 8)).toBeNull();
    // Trust remembered from an earlier match picks the receiver in the next one.
    const withTrust = (target: 'LCM' | 'RCM'): AgentMemory => {
      const cm = profiles.find(p => p.team === 0 && p.role === 'CM')!;
      const mate = profiles.find(p => p.team === 0 && p.role === target && p.squad === 'starter')!;
      return { ...emptyMemory(7), matches: 1, players: { [playerKey(cm)]: { baseline: cm.traits.confidence, bonds: { [playerKey(mate)]: 0.9 }, matches: 1 } } };
    };
    expect(choice(() => {}, withTrust('LCM'))).toBe('A');
    expect(choice(() => {}, withTrust('RCM'))).toBe('B');
  }, 120_000);
});
