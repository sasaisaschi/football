import RAPIER from '@dimforge/rapier3d-simd-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { createRoster } from '../engine/rosters';
import { PlayerBody } from './body';
import { CHEST_PART, Head } from './head';
import { PhysicsWorld } from './world';

beforeAll(async () => {
  await RAPIER.init();
});

/** A player at the origin facing +X; a ball arrives from +X and drops towards his chest. */
function chestScene(withChest: boolean) {
  const w = new PhysicsWorld();
  const body = new PlayerBody(w.world, createRoster(3)[9], 0, 0, Math.PI / 2);
  const chest = new Head(w.world, body, CHEST_PART);
  w.registerCollider(body.collider, 9, 'body');
  // Registered under another id so the test can tell chest and torso apart.
  w.registerCollider(chest.collider, 99, 'body');
  w.registerKinematic(chest);
  w.ball.setTranslation({ x: 6, y: 1.6, z: 0.1 }, true);
  w.ball.setLinvel({ x: -12, y: 2, z: 0 }, true);
  const target = { x: 1, y: 0.5, z: 0 };
  if (withChest) {
    const plan = chest.plan(w.ball, target);
    expect(plan).not.toBeNull();
    chest.start(plan!, target);
  }
  let first: string | null = null, landed: { x: number; speed: number } | null = null, touched = false;
  for (let i = 0; i < 150 && !landed; i++) {
    body.drive({ target: body.position(), speed: 0 }, 1 / 60);
    if (withChest) chest.refine(w.ball, target);
    for (const c of w.step()) if (c.kind === 'ball' && !first) first = c.player === 99 ? 'chest' : 'torso';
    touched ||= first !== null;
    const b = w.ball.translation(), v = w.ball.linvel();
    if (touched && b.y < 0.2) landed = { x: b.x, speed: Math.hypot(v.x, v.z) };
  }
  return { first, landed };
}

describe('chest control', () => {
  it('takes the pace off a ball arriving at chest height and drops it a stride in front of the feet (horizontal pace at landing)', () => {
    const r = chestScene(true);
    expect(r.first).toBe('chest');
    expect(r.landed).not.toBeNull();
    expect(r.landed!.x).toBeGreaterThan(0.2);
    expect(r.landed!.x).toBeLessThan(1.5);
    expect(r.landed!.speed).toBeLessThan(2.5);
  });

  it('without it the same ball bounces off the torso, away from him', () => {
    const r = chestScene(false);
    expect(r.first).toBe('torso');
    expect(r.landed === null || r.landed.x > 1.5 || r.landed.speed > 2.5).toBe(true);
  });
});
