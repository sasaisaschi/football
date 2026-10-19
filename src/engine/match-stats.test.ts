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
    expect(s.shotsAfterBuildUp).toBe(0);
  });

  it('a first-time pass completes the pass it was played from; an air swing is no pass', () => {
    const [a, b, c] = [id(0, 'CM'), id(0, 'LCM'), id(0, 'ST')];
    const s = matchStats([
      swing(1, a, 'pass'), touch(1.1, a),
      // b swings before the ball reaches him and plays it on with his first touch.
      swing(2, b, 'pass'), touch(2.2, b), touch(3, c),
      // c misses the ball with his swing and takes it on a moment later.
      swing(4, c, 'pass'), touch(5, c),
    ], roster);
    expect(s.passes).toBe(2);
    expect(s.passesCompleted).toBe(2);
  });

  it('a shot after three completed passes in the move counts as built up, a shot after a ball win does not', () => {
    const [a, b, c] = [id(0, 'CM'), id(0, 'LCM'), id(0, 'ST')], cb = id(1, 'RCB');
    const pass = (t: number, from: number, to: number) => [swing(t, from, 'pass'), touch(t + 0.1, from), touch(t + 1, to)];
    const s = matchStats([
      ...pass(1, a, b), ...pass(3, b, c), ...pass(5, c, a), swing(7, a, 'shot'), touch(7.1, a),
      touch(8, cb), swing(9, cb, 'shot'), touch(9.1, cb),
    ], roster);
    expect(s.shots).toEqual([1, 1]);
    expect(s.shotsAfterBuildUp).toBe(1);
  });

  it('a goal is credited to how it went in: a shot, a dribble, a ball off the body, an own goal', () => {
    const st = id(0, 'ST'), cb = id(1, 'RCB');
    const goal = (t: number, team: 0 | 1, ownGoal = false) => at(t, { type: 'goal', team, scorer: null, ownGoal, position: { x: 52.6, y: 0.5, z: 0 } });
    const s = matchStats([
      swing(1, st, 'shot'), touch(1.1, st), goal(1.5, 0),
      swing(10, st, 'dribble'), touch(10.1, st), goal(11, 0),
      touch(20, st, 'body'), goal(20.5, 0),
      touch(30, cb), goal(30.5, 0, true),
    ], roster);
    expect(s.goalsFrom).toMatchObject({ shot: 1, dribble: 1, body: 1, own: 1 });
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
