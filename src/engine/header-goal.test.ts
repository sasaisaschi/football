import RAPIER from '@dimforge/rapier3d-simd-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { MatchEngine } from './match-engine';
import { matchStats } from './match-stats';
import { runFor, stageScenario } from './scenario-helper';
import type { MatchEvent } from './types';

beforeAll(async () => {
  await RAPIER.init();
});

describe('headed goal', () => {
  it('a cross met by the striker\'s head can go in, and the goal is credited to the header', () => {
    const e = new MatchEngine({ seed: 3, halfMinutes: 45 });
    const striker = e.profiles.find(p => p.team === 0 && p.role === 'ST')!.id;
    const events: MatchEvent[] = [];
    e.onEvent(ev => events.push(ev));
    // Team 0 attacks +X. The striker stands near the penalty spot; everybody else (the keeper too) is parked away.
    stageScenario(e, { [striker]: { x: 41.5, z: 0.5 } }, { x: 43, y: 1, z: -20 }, { x: -1.5, y: 6.8, z: 19 });
    runFor(e, 4, () => events.some(ev => ev.type === 'goal'));
    const headTouch = events.find(ev => ev.type === 'touch' && ev.part === 'head');
    expect(headTouch && headTouch.type === 'touch' && headTouch.player).toBe(striker);
    const goal = events.find(ev => ev.type === 'goal');
    expect(goal).toMatchObject({ type: 'goal', team: 0, scorer: striker, ownGoal: false });
    expect(matchStats(events, e.profiles).goalsFrom.head).toBe(1);
  });
});
