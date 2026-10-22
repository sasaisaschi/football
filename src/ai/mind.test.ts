import RAPIER from '@dimforge/rapier3d-simd-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/match-engine';
import { createRoster } from '../engine/rosters';
import { runFor, stageScenario } from '../engine/scenario-helper';
import type { MatchEvent } from '../engine/types';
import { ExperienceTracker, PlayerMind } from './mind';

beforeAll(async () => {
  await RAPIER.init();
});

const role = (e: MatchEngine, team: 0 | 1, r: string) => e.profiles.find(p => p.team === team && p.role === r)!.id;

describe('agents: traits and experience', () => {
  it('judges a player\'s own actions from the event stream, deterministically', () => {
    const profiles = createRoster(7);
    const run = () => {
      const minds = profiles.map(p => new PlayerMind(p.traits));
      const t = new ExperienceTracker(profiles, minds);
      let id = 0;
      const ev = (e: Record<string, unknown>, time: number) => t.onEvent({ ...e, id: ++id, tick: 0, time } as MatchEvent);
      const pos = { x: 0, y: 0, z: 0 };
      // Player 9 passes, team-mate 10 receives: good. Player 10 dribbles, opponent 15 takes it: bad.
      ev({ type: 'swing', player: 9, action: 'pass', source: 'ai' }, 1);
      ev({ type: 'touch', player: 9, part: 'boot', ballSpeed: 12, position: pos }, 1.2);
      ev({ type: 'touch', player: 10, part: 'boot', ballSpeed: 4, position: pos }, 2);
      ev({ type: 'swing', player: 10, action: 'dribble', source: 'ai' }, 2.5);
      ev({ type: 'touch', player: 10, part: 'boot', ballSpeed: 4, position: pos }, 2.6);
      ev({ type: 'touch', player: 15, part: 'boot', ballSpeed: 4, position: pos }, 3);
      return minds;
    };
    const minds = run();
    expect(minds[9].recent).toEqual([{ action: 'pass', ok: true, time: 2 }]);
    expect(minds[9].confidence).toBeGreaterThan(profiles[9].traits.confidence);
    expect(minds[10].recent).toEqual([{ action: 'dribble', ok: false, time: 3 }]);
    expect(minds[10].confidence).toBeLessThan(profiles[10].traits.confidence);
    expect(run().map(m => m.confidence)).toEqual(minds.map(m => m.confidence));
  });

  it('an action left open too long is dropped, not judged – also when the same player plays on', () => {
    const profiles = createRoster(7);
    const minds = profiles.map(p => new PlayerMind(p.traits));
    const t = new ExperienceTracker(profiles, minds);
    const pos = { x: 0, y: 0, z: 0 };
    let id = 0;
    const ev = (e: Record<string, unknown>, time: number) => t.onEvent({ ...e, id: ++id, tick: 0, time } as MatchEvent);
    ev({ type: 'swing', player: 9, action: 'dribble', source: 'ai' }, 1);
    ev({ type: 'touch', player: 9, part: 'boot', ballSpeed: 3, position: pos }, 1.1);
    // Long after: the same player swings again. Before the fix this judged an expired action and crashed.
    ev({ type: 'swing', player: 9, action: 'dribble', source: 'ai' }, 9);
    expect(minds[9].recent).toEqual([]);
  });

  it('traits differ between players and leave the abilities of the roster untouched', () => {
    const roster = createRoster(7);
    expect(new Set(roster.map(p => p.traits.risk.toFixed(3))).size).toBeGreaterThan(15);
    // Same instruction, different uptake: discipline scales how much of the coach's risk setting a player takes on.
    const compliance = roster.map(p => new PlayerMind(p.traits).compliance());
    expect(Math.max(...compliance) - Math.min(...compliance)).toBeGreaterThan(0.3);
  });

  /**
   * A left winger on the ball 12 m into the opponents' half, a full-back 9 m ahead, his midfield partner free 10 m
   * behind with a marker 8 m from him: passing and taking on the full-back are close calls.
   */
  const winger = (form: 'low' | 'high', seed = 4) => {
    const e = new MatchEngine({ seed, halfMinutes: 45 });
    const w = role(e, 0, 'LW');
    stageScenario(e, {
      [w]: { x: 12, z: 20 }, [role(e, 0, 'LCM')]: { x: 2, z: 14 }, [role(e, 0, 'ST')]: { x: 20, z: 4 },
      [role(e, 1, 'RB')]: { x: 21, z: 19 }, [role(e, 1, 'RCB')]: { x: 24, z: 8 }, [role(e, 1, 'RCM')]: { x: 10, z: 14 }, [role(e, 1, 'CM')]: { x: 16, z: 6 },
    }, { x: 12.4, y: 0.11, z: 20 });
    e.bodies[w].heading = Math.PI / 2;
    e.referee.lastTouch = { player: w, team: 0, part: 'boot', time: e.time, position: e.ballPos() };
    // His recent experience in this match: six take-ons that worked, or six that did not.
    for (let i = 0; i < 6; i++) e.minds[w].record('dribble', form === 'high', 0);
    const from = e.events.length;
    runFor(e, 3, () => e.events.slice(from).some(ev => ev.type === 'swing' && ev.player === w));
    const swing = e.events.slice(from).find(ev => ev.type === 'swing' && ev.player === w);
    return swing?.type === 'swing' ? swing.action : null;
  };

  it('the same situation is played differently after good and bad experience – as a real, executed swing', () => {
    expect(winger('low')).toBe('pass');
    expect(winger('high')).toBe('dribble');
    // Reproducible: the same experience gives the same action.
    expect(winger('high')).toBe(winger('high'));
  }, 60_000);

  it('form comes from the match itself: real actions in an autonomous match move confidence, identically on replay', () => {
    const play = () => {
      const e = new MatchEngine({ seed: 4, halfMinutes: 45 });
      runFor(e, 90);
      return e;
    };
    const e = play();
    const judged = e.minds.flatMap(m => m.recent);
    expect(judged.length).toBeGreaterThan(10);
    expect(judged.some(r => r.ok) && judged.some(r => !r.ok)).toBe(true);
    const moved = e.minds.filter((m, i) => Math.abs(m.confidence - e.profiles[i].traits.confidence) > 0.02).length;
    expect(moved).toBeGreaterThan(5);
    expect(e.snapshot().minds.map(m => m.confidence)).toEqual(play().minds.map(m => m.confidence));
  }, 120_000);
});
