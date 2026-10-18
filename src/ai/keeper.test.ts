import RAPIER from '@dimforge/rapier3d-simd-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/match-engine';
import { runFor, stageScenario } from '../engine/scenario-helper';
import { createRng } from '../engine/rng';
import type { MatchEvent } from '../engine/types';
import { BALL_PHYSICS } from '../physics/ball';
import { PITCH } from '../physics/pitch-geometry';
import { Perception } from './perception';
import { keeperShape } from './shape';

beforeAll(async () => {
  await RAPIER.init();
});

/** A struck ball from `d` m in front of the goal team 1 defends, aimed at (z, y) in the goal mouth. */
function shot(seed: number, d: number, tz: number, ty: number, speed = 26) {
  const e = new MatchEngine({ seed, halfMinutes: 45 });
  const gk = e.profiles.find(p => p.team === 1 && p.role === 'GK')!.id;
  const ball = { x: PITCH.halfLength - d, y: 0.11, z: 0 };
  const dx = d, flat = Math.hypot(dx, tz), t = flat / (speed * 0.92);
  const vy = (ty - ball.y + 0.5 * BALL_PHYSICS.gravity * t * t) / t, h = Math.sqrt(speed * speed - vy * vy);
  stageScenario(e, { [gk]: keeperShape(-1, ball) }, ball, { x: (h * dx) / flat, y: vy, z: (h * tz) / flat });
  const log: MatchEvent[] = [];
  e.onEvent(ev => log.push(ev));
  runFor(e, 2.5, () => log.some(ev => ev.type === 'goal' || ev.type === 'out'));
  return { goal: log.some(ev => ev.type === 'goal'), touched: log.some(ev => (ev.type === 'touch' || ev.type === 'catch') && ev.player === gk) };
}

describe('goalkeeper against shots from distance', () => {
  it('reaches most shots from 20 m towards the side of the goal instead of diving past them', () => {
    // Before the dive was dosed the keeper flew a metre past such shots: 13 % of shots from 20 m were saved.
    const rng = createRng(11);
    let saved = 0;
    for (let i = 0; i < 8; i++) {
      const side = i % 2 ? 1 : -1;
      if (!shot(2000 + i, 20, side * rng.range(1.5, 3.2), rng.range(0.3, 1.8)).goal) saved++;
    }
    expect(saved).toBeGreaterThanOrEqual(6);
  });

  it('does not dive past a ball that comes within arm\'s reach of his body', () => {
    const r = shot(3000, 20, 0.6, 2.0);
    expect(r.touched).toBe(true);
    expect(r.goal).toBe(false);
  });
});

describe('defender caught behind a carrier', () => {
  it('recovers alongside him instead of running into his back', () => {
    // Team 1's striker breaks towards team 0's goal (−X) with the ball; team 0's centre-back starts right behind him.
    let fouls = 0, alongside = 0;
    for (let i = 0; i < 6; i++) {
      const e = new MatchEngine({ seed: 6000 + i, halfMinutes: 45 });
      const st = e.profiles.find(p => p.team === 1 && p.role === 'ST')!.id;
      const cb = e.profiles.find(p => p.team === 0 && p.role === 'RCB')!.id;
      stageScenario(e, { [st]: { x: -20, z: i - 3 }, [cb]: { x: -18.6, z: i - 3 } }, { x: -20.6, y: 0.11, z: i - 3 });
      e.bodies[st].body.setLinvel({ x: -5, y: 0, z: 0 }, true);
      e.bodies[cb].body.setLinvel({ x: -6, y: 0, z: 0 }, true);
      e.bodies[st].heading = -Math.PI / 2;
      e.referee.lastTouch = { player: st, team: 1, part: 'boot', time: e.time, position: e.ballPos() };
      const log: MatchEvent[] = [];
      e.onEvent(ev => log.push(ev));
      let beside = false;
      runFor(e, 2.5, () => {
        const a = e.bodies[st].position(), b = e.bodies[cb].position();
        // Directly behind him the defender's line stays within a few centimetres of the carrier's; at his shoulder it
        // is offset to the side.
        if (Math.abs(a.z - b.z) > 0.7) beside = true;
        return log.some(ev => ev.type === 'foul' || ev.type === 'out' || ev.type === 'goal');
      });
      if (log.some(ev => ev.type === 'foul')) fouls++;
      if (beside) alongside++;
    }
    expect(fouls).toBeLessThanOrEqual(1);
    expect(alongside).toBeGreaterThanOrEqual(4);
  });
});

describe('perception of a ball in the air', () => {
  it('extrapolates the vertical pace with gravity, so a dropping ball is not believed to rise', () => {
    const roster = new MatchEngine({ seed: 1, halfMinutes: 1 }).profiles;
    const p = new Perception(roster[0], createRng(1));
    p.reset({ now: 0, ball: { pos: { x: 0, y: 1, z: 0 }, vel: { x: 20, y: 4, z: 0 }, spin: { x: 0, y: 0, z: 0 } }, players: [] });
    const later = p.ballNow(0.4);
    expect(later.vel.y).toBeCloseTo(4 - 9.81 * 0.4, 5);
    expect(later.pos.y).toBeCloseTo(1 + 4 * 0.4 - 4.9 * 0.16, 5);
  });
});
