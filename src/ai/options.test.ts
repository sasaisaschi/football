import { describe, expect, it } from 'vitest';
import { createRoster } from '../engine/rosters';
import type { Vec2 } from '../engine/types';
import { PITCH } from '../physics/pitch-geometry';
import { evaluateOptions, threatAt, type Picture } from './options';

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
    const keeper = at(0, 'GK', { x: -47, z: -8 });
    // An opponent stands in the ground lane; the lane over the top is free.
    const pic = { ...picture([at(1, 'ST', { x: -38, z: 5 })], [keeper]), pos: { x: -29.4, z: 18 }, ball: { pos: { x: -29, y: 0.11, z: 18 }, vel: { x: 0, y: 0, z: 0 } } };
    const pass = evaluateOptions(pic).find(o => o.kind === 'pass' && o.target === keeper.id);
    expect(pass).toBeDefined();
    expect(pass!.action.kind === 'pass' && pass!.action.lofted).toBe(false);
  });
});

describe('expected threat', () => {
  it('follows published expected-threat grids in front of the goal (team attacking +X, central)', () => {
    const at = (d: number) => threatAt(1, { x: PITCH.halfLength - d, z: 0 });
    expect(at(11)).toBeGreaterThan(0.1);
    expect(at(16)).toBeGreaterThan(0.04);
    expect(at(16)).toBeLessThan(0.08);
    expect(at(30)).toBeLessThan(0.03);
    expect(at(60)).toBeLessThan(0.012);
  });
});


describe('pass safety', () => {
  it('an opponent a few metres from a 20 m ground pass is not an interception: he needs to react and accelerate', () => {
    // Measured with the former model (top speed from the first step): passes predicted below 20 % arrived 54 % of the time.
    const pic = picture([at(1, 'RCM', { x: 10, z: 5 })], [at(0, 'ST', { x: 19.4, z: 0 })]);
    const pass = evaluateOptions(pic).find(o => o.kind === 'pass')!;
    expect(pass.action.kind === 'pass' && pass.action.lofted).toBe(false);
    // Lane, accuracy over 20 m and the receiver's room together.
    expect(pass.success).toBeGreaterThan(0.4);
  });
});

describe('passing near the own goal', () => {
  /** The CM has the ball 17 m in front of his own goal (team 0 defends x = −52.5). */
  function deep(keeper: Vec2): Picture {
    const p = picture([at(1, 'ST', { x: -20, z: 15 })], [at(0, 'GK', keeper)]);
    return { ...p, pos: { x: -34.4, z: 0 }, ball: { pos: { x: -35, y: 0.11, z: 0 }, vel: { x: 0, y: 0, z: 0 } } };
  }
  const toKeeper = (pic: Picture) => evaluateOptions(pic).some(o => o.kind === 'pass' && o.target === player(0, 'GK').id);

  it('no back-pass on a line that rolls into the goal if the keeper misses it', () => {
    expect(toKeeper(deep({ x: -49, z: 0.5 }))).toBe(false);
  });

  it('a back-pass to the keeper\'s side, wide of the posts, is still on', () => {
    expect(toKeeper(deep({ x: -47, z: -11 }))).toBe(true);
  });
});
