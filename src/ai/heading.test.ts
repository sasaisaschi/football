import { describe, expect, it } from 'vitest';
import { createRoster } from '../engine/rosters';
import type { Vec2 } from '../engine/types';
import { PITCH } from '../physics/pitch-geometry';
import { chooseHeader } from './heading';
import type { Picture } from './options';

const roster = createRoster(7);
const player = (team: 0 | 1, role: string) => roster.find(p => p.team === team && p.role === role)!;
const at = (team: 0 | 1, role: string, pos: Vec2) => ({ id: player(team, role).id, profile: player(team, role), pos, vel: { x: 0, z: 0 } });

/** Team 0 attacks +X; the ball is met at head height at `ball`. */
function picture(ball: Vec2, mates: ReturnType<typeof at>[] = [], opponents: ReturnType<typeof at>[] = []): Picture {
  return {
    now: 0, self: player(0, 'RCB'), pos: { x: ball.x - 0.4, z: ball.z }, vel: { x: 0, z: 0 }, sign: 1,
    ball: { pos: { x: ball.x, y: 1.8, z: ball.z }, vel: { x: -10, y: -3, z: 0 } },
    mates, opponents, instruction: { press: 'mid', lineHeight: 0, risk: 0.5 }, offsideLineU: 0.6,
  };
}

describe('choosing a header', () => {
  it('clears a ball the opponents played into our half: up and away from our goal', () => {
    const h = chooseHeader(picture({ x: -40, z: 5 }), false, 1.7);
    expect(h.purpose).toBe('clear');
    expect(h.velocity.x).toBeGreaterThan(5);
    expect(h.velocity.y).toBeGreaterThan(3);
  });

  it('goes for goal in the opponents\' area, aimed low under the bar', () => {
    const h = chooseHeader(picture({ x: PITCH.halfLength - 9, z: 1 }, [], [at(1, 'GK', { x: PITCH.halfLength - 1, z: 0 })]), true, 1.8);
    expect(h.purpose).toBe('shot');
    expect(h.velocity.x).toBeGreaterThan(8);
    // Height at the goal line on its arc (gravity only): about half a metre.
    const t = 9 / h.velocity.x, y = 1.8 + h.velocity.y * t - 4.905 * t * t;
    expect(y).toBeGreaterThan(0.2);
    expect(y).toBeLessThan(0.9);
  });

  it('lays it off to a free team-mate nearby, otherwise heads it down to the own feet', () => {
    const free = chooseHeader(picture({ x: 5, z: 0 }, [at(0, 'CM', { x: -3, z: 6 })]), true, 1.7);
    expect(free.purpose).toBe('lay-off');
    const marked = chooseHeader(picture({ x: 5, z: 0 }, [at(0, 'CM', { x: -3, z: 6 })], [at(1, 'LCM', { x: -3, z: 5 })]), true, 1.7);
    expect(marked.purpose).toBe('down');
  });
});
