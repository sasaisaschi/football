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

/** A player running along +X at 6 m/s; then he slides. Optionally an opponent stands in the way. */
function slideScene(opponentAt: number | null) {
  const w = new PhysicsWorld();
  const roster = createRoster(3);
  const body = new PlayerBody(w.world, roster[9], 0, 0, Math.PI / 2);
  const legs = new Legs(w.world, body);
  w.registerCollider(body.collider, 9, 'body');
  w.registerLegs(legs, 9);
  const other = opponentAt === null ? null : new PlayerBody(w.world, roster[13], 0, 0, -Math.PI / 2);
  if (other) w.registerCollider(other.collider, 13, 'body');
  w.ball.setTranslation({ x: 60, y: BALL_SPEC.radius, z: 20 }, true);
  for (let i = 0; i < 60; i++) {
    body.drive({ target: { x: body.position().x + 20, z: 0 }, speed: 6 }, 1 / 60);
    w.step();
  }
  const x0 = body.position().x;
  if (other) other.place(x0 + opponentAt!, 0, -Math.PI / 2);
  return { w, body, legs, other, x0 };
}

describe('sliding tackle', () => {
  it('the stretched leg meets a ball ahead of the slide, then he lies on the turf and gets up again', () => {
    const s = slideScene(null);
    s.w.ball.setTranslation({ x: s.x0 + 1.8, y: BALL_SPEC.radius, z: 0.05 }, true);
    s.w.ball.setLinvel({ x: 1.5, y: 0, z: 0 }, true);
    s.body.startSlide({ x: 1, z: 0 }, 6.5);
    s.legs.startSlide(1);
    let bootTouch = false, bodyTouch = false, lowest = Infinity, maxBall = 0;
    for (let i = 0; i < 150; i++) {
      s.body.drive({ target: s.body.position(), speed: 0 }, 1 / 60);
      for (const c of s.w.step()) {
        if (c.kind === 'ball' && c.part === 'boot') bootTouch = true;
        if (c.kind === 'ball' && c.part === 'body' && !bootTouch) bodyTouch = true;
      }
      if (s.body.down()) lowest = Math.min(lowest, s.body.collider.translation().y);
      maxBall = Math.max(maxBall, s.w.ball.linvel().x);
    }
    expect(bootTouch).toBe(true);
    expect(bodyTouch).toBe(false);
    // The ball is knocked on ahead of the slide, faster than it rolled.
    expect(maxBall).toBeGreaterThan(4);
    // While down the body collider lies at ground height: its centre at the hips, not the chest.
    expect(lowest).toBeLessThan(0.25);
    // After about 1.5 s he is up again: upright capsule back, standing on the turf, able to act.
    expect(s.body.sliding()).toBe(false);
    expect(s.body.collider.translation().y).toBeCloseTo(s.body.height / 2, 1);
  });

  it('sliding into an opponent is a body contact with the speed of the slide', () => {
    const s = slideScene(1.6);
    s.body.startSlide({ x: 1, z: 0 }, 6.5);
    s.legs.startSlide(1);
    let closing = 0;
    for (let i = 0; i < 60; i++) {
      s.body.drive({ target: s.body.position(), speed: 0 }, 1 / 60);
      s.other!.drive({ target: s.other!.position(), speed: 0 }, 1 / 60);
      for (const c of s.w.step()) if (c.kind === 'bodies') closing = Math.max(closing, c.closingSpeed);
    }
    expect(closing).toBeGreaterThan(4);
  });
});
