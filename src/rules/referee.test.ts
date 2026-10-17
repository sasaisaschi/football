import { describe, expect, it } from 'vitest';
import { createRoster } from '../engine/rosters';
import type { Vec2 } from '../engine/types';
import { BALL_SPEC, PITCH } from '../physics/pitch-geometry';
import { Referee, type PlayerState } from './referee';

const roster = createRoster(7);
const id = (team: 0 | 1, role: string) => roster.find(p => p.team === team && p.role === role)!.id;
/** Team 0 attacks +X in the first half. */
function positions(over: Record<number, Vec2> = {}): Map<number, Vec2> {
  const m = new Map<number, Vec2>();
  for (const p of roster) m.set(p.id, over[p.id] ?? (p.team === 0 ? { x: -10 - p.number, z: p.number } : p.role === 'GK' ? { x: 51, z: 0 } : { x: 20, z: p.number - 6 }));
  return m;
}
const touch = (player: number, x: number, z: number, part: 'boot' | 'body' | 'hands' = 'boot', time = 1) =>
  ({ player, team: roster[player].team, part, time, position: { x, y: BALL_SPEC.radius, z } });

describe('Law 11 – offside', () => {
  it('a player beyond the second-last defender when a team-mate plays the ball is penalised when he plays it', () => {
    const ref = new Referee(roster);
    ref.pendingRestart = null;
    const pos = positions({ [id(0, 'CM')]: { x: 5, z: 0 }, [id(0, 'ST')]: { x: 30, z: 2 } });
    expect(ref.onBallContact(touch(id(0, 'CM'), 5, 0), 1, pos)).toEqual([]);
    const d = ref.onBallContact(touch(id(0, 'ST'), 30, 2, 'boot', 2), 1, pos);
    expect(d[0]).toMatchObject({ type: 'offside', player: id(0, 'ST') });
  });
  it('level with the second-last defender is onside, and so is anyone in his own half', () => {
    const ref = new Referee(roster);
    ref.pendingRestart = null;
    const pos = positions({ [id(0, 'CM')]: { x: -20, z: 0 }, [id(0, 'ST')]: { x: 20, z: 2 }, [id(0, 'RW')]: { x: -1, z: 9 } });
    ref.onBallContact(touch(id(0, 'CM'), -20, 0), 1, pos);
    expect(ref.onBallContact(touch(id(0, 'ST'), 20, 2, 'boot', 2), 1, pos)).toEqual([]);
  });
  it('there is no offside directly from a throw-in, and the restart is reported as taken', () => {
    const ref = new Referee(roster);
    ref.awaitRestart('throw-in', 0);
    const pos = positions({ [id(0, 'LB')]: { x: 5, z: 33.4 }, [id(0, 'ST')]: { x: 30, z: 2 } });
    expect(ref.onBallContact(touch(id(0, 'LB'), 5, 33.4), 1, pos)[0]).toMatchObject({ type: 'in-play', kind: 'throw-in' });
    expect(ref.onBallContact(touch(id(0, 'ST'), 30, 2, 'boot', 2), 1, pos)).toEqual([]);
  });
  it('switches the attacking direction in the second half', () => {
    const ref = new Referee(roster);
    ref.pendingRestart = null;
    // In the second half team 0 attacks −X: being at x = −30 beyond defenders is offside there.
    const pos = positions({ [id(0, 'CM')]: { x: -5, z: 0 }, [id(0, 'ST')]: { x: -30, z: 0 } });
    for (const p of roster) if (p.team === 1) pos.set(p.id, p.role === 'GK' ? { x: -51, z: 0 } : { x: -20, z: p.number - 6 });
    ref.onBallContact(touch(id(0, 'CM'), -5, 0), 2, pos);
    expect(ref.onBallContact(touch(id(0, 'ST'), -30, 0, 'boot', 2), 2, pos)[0]?.type).toBe('offside');
  });
});

describe('Laws 9, 10, 16, 17 – ball out and goals', () => {
  const r = BALL_SPEC.radius;
  it('awards goal, corner, goal kick and throw-in to the right team', () => {
    const ref = new Referee(roster);
    ref.lastTouch = touch(id(0, 'ST'), 50, 0);
    expect(ref.checkBall({ x: PITCH.halfLength + r + 0.05, y: 1, z: 0 }, 1)).toMatchObject({ type: 'goal', team: 0, ownGoal: false });
    expect(ref.checkBall({ x: PITCH.halfLength + r + 0.05, y: r, z: 12 }, 1)).toMatchObject({ kind: 'goal-kick', team: 1 });
    ref.lastTouch = touch(id(1, 'RCB'), 50, 0);
    expect(ref.checkBall({ x: PITCH.halfLength + r + 0.05, y: r, z: 12 }, 1)).toMatchObject({ kind: 'corner', team: 0 });
    expect(ref.checkBall({ x: PITCH.halfLength + r + 0.05, y: 1, z: 0 }, 1)).toMatchObject({ type: 'goal', team: 0, ownGoal: true });
    expect(ref.checkBall({ x: 0, y: r, z: -(PITCH.halfWidth + r + 0.05) }, 1)).toMatchObject({ kind: 'throw-in', team: 0 });
  });
});

describe('Law 12 – fouls and misconduct', () => {
  const state = (pos: Vec2, vel: Vec2, heading: number, tactical = false): PlayerState => ({ pos, vel, heading, hasTacticalFoulIntent: tactical });
  const att = id(0, 'ST'), def = id(1, 'RCB');
  it('a late challenge from behind on the ball carrier is a foul with a free kick spot', () => {
    const ref = new Referee(roster);
    ref.lastTouch = touch(att, -10, 0, 'boot', 9.5);
    const states = new Map([[att, state({ x: -10, z: 0 }, { x: 3, z: 0 }, Math.PI / 2)], [def, state({ x: -10.6, z: 0 }, { x: 6, z: 0 }, Math.PI / 2)]]);
    const d = ref.onBodyContact(def, att, 3, 10, 1, { x: -9.6, y: 0.11, z: 0 }, states, null);
    expect(d).toMatchObject({ type: 'foul', offender: def, victim: att, penalty: false });
  });
  it('two players contesting a loose ball at moderate speed is not a foul', () => {
    const ref = new Referee(roster);
    const states = new Map([[att, state({ x: 0, z: 0 }, { x: 2, z: 0 }, Math.PI / 2)], [def, state({ x: 0.6, z: 0 }, { x: -2, z: 0 }, -Math.PI / 2)]]);
    expect(ref.onBodyContact(def, att, 3.2, 10, 1, { x: 0.3, y: 0.11, z: 0 }, states, null)).toBeNull();
  });
  it('fouling an attacker clean through on goal is a red card; in the area it is a penalty', () => {
    const ref = new Referee(roster);
    ref.lastTouch = touch(att, 40, 0, 'boot', 9.8);
    // Team 0 attacks +X. All defenders except the offender are behind the attacker.
    const states = new Map<number, PlayerState>();
    for (const p of roster) states.set(p.id, state(p.team === 1 && p.role !== 'GK' ? { x: 0, z: p.number } : { x: -40, z: 0 }, { x: 0, z: 0 }, 0));
    states.set(att, state({ x: 42, z: 1 }, { x: 7, z: 0 }, Math.PI / 2));
    states.set(def, state({ x: 41.4, z: 1 }, { x: 8, z: 0 }, Math.PI / 2));
    const d = ref.onBodyContact(def, att, 3.5, 10, 1, { x: 42.8, y: 0.11, z: 1 }, states, null);
    expect(d).toMatchObject({ type: 'foul', card: 'red', penalty: true });
    expect(ref.sentOff.has(def)).toBe(true);
  });
  it('a deliberate tactical foul is booked; a second booking sends the player off', () => {
    const ref = new Referee(roster);
    const states = new Map([[att, state({ x: -5, z: 3 }, { x: 1, z: 0 }, Math.PI / 2)], [def, state({ x: -5.6, z: 3 }, { x: 2, z: 0 }, Math.PI / 2, true)]]);
    expect(ref.onBodyContact(def, att, 1.8, 10, 1, { x: -20, y: 0.11, z: 3 }, states, null)).toMatchObject({ card: 'yellow', reason: 'taktisches Foul' });
    expect(ref.onBodyContact(def, att, 1.8, 20, 1, { x: -20, y: 0.11, z: 3 }, states, null)).toMatchObject({ card: 'red' });
  });
  it('team-mates bumping into each other is never a foul', () => {
    const ref = new Referee(roster);
    const a = id(0, 'CM'), b = id(0, 'RCM');
    const states = new Map([[a, state({ x: 0, z: 0 }, { x: 8, z: 0 }, 0)], [b, state({ x: 0.5, z: 0 }, { x: 0, z: 0 }, 0)]]);
    expect(ref.onBodyContact(a, b, 8, 1, 1, { x: 0.2, y: 0.11, z: 0 }, states, null)).toBeNull();
  });
  it('a keeper may not handle outside his area nor catch a deliberate back-pass', () => {
    const ref = new Referee(roster);
    ref.pendingRestart = null;
    const gk = id(1, 'GK');
    expect(ref.onBallContact(touch(gk, 30, 0, 'hands'), 1, positions())[0]).toMatchObject({ type: 'restart', reason: 'handball', team: 0 });
    ref.lastTouch = { ...touch(id(1, 'RCB'), 45, 0, 'boot'), deliberate: true };
    expect(ref.onBallContact(touch(gk, 50, 0, 'hands', 2), 1, positions())[0]).toMatchObject({ type: 'restart', reason: 'back-pass', team: 0 });
    // A shot blocked by a defender's boot is no back-pass: the keeper may catch the deflection.
    ref.lastTouch = touch(id(1, 'RCB'), 45, 0, 'boot');
    expect(ref.onBallContact(touch(gk, 50, 0, 'hands', 3), 1, positions())).toEqual([]);
  });
});
