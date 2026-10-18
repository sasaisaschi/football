import RAPIER from '@dimforge/rapier3d-simd-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { createRoster } from '../engine/rosters';
import type { Vec3 } from '../engine/types';
import { PlayerBody } from './body';
import { Head } from './head';
import { PhysicsWorld } from './world';

beforeAll(async () => {
  await RAPIER.init();
});

/** A player at the origin facing +X; a ball arrives from +X at head height. */
function scene(ballFrom: Vec3, ballVel: Vec3) {
  const w = new PhysicsWorld();
  const body = new PlayerBody(w.world, createRoster(3)[9], 0, 0, Math.PI / 2);
  const head = new Head(w.world, body);
  w.registerCollider(body.collider, 9, 'body');
  w.registerCollider(head.collider, 9, 'head');
  w.registerKinematic(head);
  w.ball.setTranslation(ballFrom, true);
  w.ball.setLinvel(ballVel, true);
  return { w, body, head };
}

function headIt(target: Vec3) {
  const s = scene({ x: 9, y: 2.1, z: 0.2 }, { x: -13, y: 3, z: 0 });
  const plan = s.head.plan(s.w.ball, target);
  expect(plan).not.toBeNull();
  s.head.start(plan!, target);
  const contacts = [];
  let after: Vec3 | null = null;
  for (let i = 0; i < 60 && !after; i++) {
    s.body.drive({ target: s.body.position(), speed: 0 }, 1 / 60);
    s.head.refine(s.w.ball, target);
    for (const c of s.w.step()) {
      if (c.kind === 'ball' && c.part === 'head') contacts.push(c);
      if (c.kind === 'ball' && c.part === 'body') throw new Error('the ball hit the torso first');
    }
    if (contacts.length && !after) { s.w.step(); const v = s.w.ball.linvel(); after = { x: v.x, y: v.y, z: v.z }; }
  }
  return { contacts, after };
}

describe('heading', () => {
  it('sends an arriving ball off close to the wanted direction and pace', () => {
    for (const target of [{ x: 6, y: 4, z: 5 }, { x: 4, y: 1, z: -6 }, { x: 10, y: 3, z: 0 }]) {
      const r = headIt(target);
      expect(r.contacts.length).toBeGreaterThan(0);
      const v = r.after!;
      const cos = (v.x * target.x + v.y * target.y + v.z * target.z) / (Math.hypot(v.x, v.y, v.z) * Math.hypot(target.x, target.y, target.z));
      expect(Math.acos(Math.min(1, cos))).toBeLessThan(0.25);
      expect(Math.hypot(v.x, v.y, v.z)).toBeGreaterThan(0.7 * Math.hypot(target.x, target.y, target.z));
      expect(Math.hypot(v.x, v.y, v.z)).toBeLessThan(1.3 * Math.hypot(target.x, target.y, target.z));
    }
  });

  it('cannot reach a ball that passes far above or beside the head', () => {
    const high = scene({ x: 9, y: 4, z: 0 }, { x: -13, y: 4, z: 0 });
    expect(high.head.plan(high.w.ball, { x: 5, y: 2, z: 0 })).toBeNull();
    const wide = scene({ x: 9, y: 2.1, z: 2 }, { x: -13, y: 3, z: 0 });
    expect(wide.head.plan(wide.w.ball, { x: 5, y: 2, z: 0 })).toBeNull();
  });

  it('leaves no collider in play outside a header', () => {
    const s = scene({ x: 2, y: 1.7, z: 0 }, { x: -6, y: 0, z: 0 });
    expect(s.head.collider.isEnabled()).toBe(false);
  });
});
