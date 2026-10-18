import { describe, expect, it } from 'vitest';
import { createRoster } from '../engine/rosters';
import type { Vec2 } from '../engine/types';
import { evaluateOptions, type Picture } from './options';

const roster = createRoster(7);
const player = (team: 0 | 1, role: string) => roster.find(p => p.team === team && p.role === role)!;
const self = player(0, 'CM');
const at = (team: 0 | 1, role: string, pos: Vec2) => ({ id: player(team, role).id, profile: player(team, role), pos, vel: { x: 0, z: 0 } });

/** Team 0 attacks +X; the CM has the ball in midfield. */
function picture(opponents: ReturnType<typeof at>[], mates: ReturnType<typeof at>[] = []): Picture {
  return {
    now: 0, self, pos: { x: -0.6, z: 0 }, vel: { x: 0, z: 0 }, sign: 1,
    ball: { pos: { x: 0, y: 0.11, z: 0 }, vel: { x: 0, y: 0, z: 0 } },
    mates, opponents, instruction: { press: 'mid', lineHeight: 0, risk: 0.5 }, offsideLineU: 0.6,
  };
}

describe('holding the ball', () => {
  it('under close pressure the player can shield the ball away from the opponent', () => {
    const marker = { x: 1.4, z: 0.3 };
    const shield = evaluateOptions(picture([at(1, 'RCM', marker)])).find(o => o.kind === 'shield');
    expect(shield).toBeDefined();
    expect(shield!.action.kind).toBe('dribble');
    const dir = shield!.action.kind === 'dribble' ? shield!.action.direction : { x: 0, z: 0 };
    // The touch goes away from the marker, not past him.
    expect(dir.x * marker.x + dir.z * marker.z).toBeLessThan(0);
  });

  it('with nobody close there is nothing to shield the ball from', () => {
    expect(evaluateOptions(picture([at(1, 'RCM', { x: 12, z: 6 })])).some(o => o.kind === 'shield')).toBe(false);
  });

  it('a free team-mate for a short pass is worth more than holding on', () => {
    const options = evaluateOptions(picture([at(1, 'RCM', { x: 1.4, z: 0.3 })], [at(0, 'LCM', { x: -4, z: 9 })]));
    const pass = options.find(o => o.kind === 'pass')!, shield = options.find(o => o.kind === 'shield')!;
    expect(pass.value).toBeGreaterThan(shield.value);
  });
});


describe('back-pass to the own keeper', () => {
  it('is never lofted, even where a ball over the top would look safer', () => {
    const keeper = at(0, 'GK', { x: -48, z: 4 });
    // An opponent stands in the ground lane; the lane over the top is free.
    const pic = { ...picture([at(1, 'ST', { x: -38, z: 11 })], [keeper]), pos: { x: -29.4, z: 18 }, ball: { pos: { x: -29, y: 0.11, z: 18 }, vel: { x: 0, y: 0, z: 0 } } };
    const pass = evaluateOptions(pic).find(o => o.kind === 'pass' && o.target === keeper.id);
    expect(pass).toBeDefined();
    expect(pass!.action.kind === 'pass' && pass!.action.lofted).toBe(false);
  });
});