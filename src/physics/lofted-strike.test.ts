import RAPIER from '@dimforge/rapier3d-simd-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { createRoster } from '../engine/rosters';
import { PlayerBody } from './body';
import { Legs } from './legs';
import { BALL_SPEC } from './pitch-geometry';
import { PhysicsWorld } from './world';

beforeAll(async () => {
  await RAPIER.init();
});

function run(w: PhysicsWorld, seconds: number, each?: () => void) {
  for (let t = 0; t < seconds; t += 1 / 60) {
    each?.();
    w.step();
  }
}

/**
 * Launch of a lofted instep pass (planned 25 m/s at 0.42 rad along +X): the player runs at `pace` for a moment,
 * then the ball is put down in front of him rolling at `ballPace` (negative: towards him).
 */
function loft(pace: number, ballPace: number) {
  const w = new PhysicsWorld();
  const body = new PlayerBody(w.world, createRoster(1)[9], 0, 0, Math.PI / 2);
  const legs = new Legs(w.world, body);
  w.registerCollider(body.collider, 9, 'body');
  w.registerLegs(legs, 9);
  const tick = () => body.drive(pace > 0 ? { target: { x: body.position().x + 10, z: 0 }, speed: pace } : { target: body.position(), speed: 0 }, 1 / 60);
  w.ball.setTranslation({ x: 50, y: BALL_SPEC.radius, z: 0.12 }, true);
  run(w, 1.2, tick);
  const p = body.position();
  w.ball.setTranslation({ x: p.x + 0.42 + (pace - ballPace) * 0.25, y: BALL_SPEC.radius, z: 0.12 }, true);
  w.ball.setLinvel({ x: ballPace, y: 0, z: 0 }, true);
  w.ball.setAngvel({ x: 0, y: 0, z: -ballPace / BALL_SPEC.radius }, true);
  const plan = legs.plan(w.ball, { technique: 'instep', side: 1, dirX: 1, dirZ: 0, elevation: 0.42, ballSpeed: 25 });
  expect(plan).not.toBeNull();
  legs.start(plan!);
  let peak = { x: 0, y: 0, z: 0, s: 0 };
  run(w, 0.7, () => {
    tick();
    const v = w.ball.linvel(), s = Math.hypot(v.x, v.y, v.z);
    if (s > peak.s) peak = { x: v.x, y: v.y, z: v.z, s };
  });
  return { speed: peak.s, elevation: Math.atan2(peak.y, Math.hypot(peak.x, peak.z)) };
}

describe('lofted strike', () => {
  // Before the boot rose through the ball and followed the running body: 0.36–0.50 rad and as little as 20 m/s.
  const cases: [string, number, number][] = [
    ['standing, dead ball', 0, 0],
    ['running at 3 m/s', 3, 0],
    ['running at 5 m/s', 5, 0],
    ['ball rolling towards him', 0, -3],
    ['running onto a ball rolling away', 4, 2],
  ];
  for (const [name, pace, ballPace] of cases) {
    it(`leaves close to the planned angle and pace: ${name}`, () => {
      const r = loft(pace, ballPace);
      expect(Math.abs(r.elevation - 0.42)).toBeLessThan(0.05);
      expect(Math.abs(r.speed / 25 - 1)).toBeLessThan(0.12);
    });
  }
});
