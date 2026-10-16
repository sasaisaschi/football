import RAPIER from '@dimforge/rapier3d-simd-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { BALL } from './ball';
import { Match } from './match';
import { PITCH } from './pitch';
import { placeMotor } from './player-motor';
import { Player } from './team';

beforeAll(async () => {
  await RAPIER.init();
});

function inPlayMatch() {
  const m = new Match(5);
  m.referee.state = { phase: 'play' };
  return m;
}

const byRole = (m: Match, team: number, role: Player['role']) => m.players.find(p => p.team === team && p.role === role)!;

describe('referee (Laws 9, 10, 11, 17)', () => {
  it('flags offside when a player who was beyond the second-last defender at the pass plays the ball', () => {
    const m = inPlayMatch();
    const passer = byRole(m, 0, 'CM');
    const striker = byRole(m, 0, 'ST');
    placeMotor(passer.motor, 10, 0, Math.PI / 2);
    // Team 1 defends +X: keeper on the line, every outfield defender at x ≤ 30.
    for (const p of m.players.filter(q => q.team === 1)) placeMotor(p.motor, p.role === 'GK' ? 51 : 25 + (p.number % 5), p.number, -Math.PI / 2);
    placeMotor(striker.motor, 40, 0, Math.PI / 2);
    expect(m.referee.observeTouch(passer, 10.3, 0)).toBeNull();
    const decision = m.referee.observeTouch(striker, 40, 0);
    expect(decision?.type).toBe('offside');
  });

  it('does not flag a player who was level with or behind the second-last defender', () => {
    const m = inPlayMatch();
    const passer = byRole(m, 0, 'CM');
    const striker = byRole(m, 0, 'ST');
    placeMotor(passer.motor, 10, 0, Math.PI / 2);
    for (const p of m.players.filter(q => q.team === 1)) placeMotor(p.motor, p.role === 'GK' ? 51 : 35, p.number, -Math.PI / 2);
    placeMotor(striker.motor, 34, 0, Math.PI / 2);
    m.referee.observeTouch(passer, 10.3, 0);
    expect(m.referee.observeTouch(striker, 34, 0)).toBeNull();
  });

  it('no offside directly from a throw-in', () => {
    const m = new Match(5);
    const taker = byRole(m, 0, 'LB');
    const striker = byRole(m, 0, 'ST');
    for (const p of m.players.filter(q => q.team === 1)) placeMotor(p.motor, p.role === 'GK' ? 51 : 25, p.number, -Math.PI / 2);
    placeMotor(striker.motor, 40, 0, Math.PI / 2);
    m.referee.startRestart('throw-in', 0, 20, PITCH.halfWidth - 0.8, 0, 0);
    if (m.referee.state.phase === 'restart') m.referee.state.placed = true;
    expect(m.referee.observeTouch(taker, 20, PITCH.halfWidth - 0.8)?.type).toBe('in-play');
    expect(m.referee.observeTouch(striker, 40, 0)).toBeNull();
  });

  it('awards a corner when the defending team last touched it over its own goal line, otherwise a goal kick', () => {
    const m = inPlayMatch();
    const ball = { x: PITCH.halfLength + BALL.radius + 0.05, y: BALL.radius, z: 10 };
    m.referee.lastTouch = byRole(m, 1, 'RCB');
    expect(m.referee.checkBall(ball)).toMatchObject({ type: 'out', kind: 'corner', team: 0 });
    m.referee.lastTouch = byRole(m, 0, 'ST');
    expect(m.referee.checkBall(ball)).toMatchObject({ type: 'out', kind: 'goal-kick', team: 1 });
  });

  it('gives the throw-in to the opponents of the last player to touch the ball', () => {
    const m = inPlayMatch();
    m.referee.lastTouch = byRole(m, 0, 'LW');
    expect(m.referee.checkBall({ x: 5, y: BALL.radius, z: -(PITCH.halfWidth + BALL.radius + 0.05) })).toMatchObject({ type: 'out', kind: 'throw-in', team: 1 });
  });

  it('a goal is scored by the attacking team and restarts with the other team kicking off', () => {
    const m = inPlayMatch();
    m.ball.setTranslation({ x: PITCH.halfLength + 0.5, y: 0.5, z: 0 }, true);
    m.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    m.step();
    expect(m.score).toEqual([1, 0]);
    expect(m.referee.state).toMatchObject({ phase: 'restart', kind: 'kickoff', team: 1 });
  });
});
