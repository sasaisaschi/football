import RAPIER from '@dimforge/rapier3d-simd-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { createRoster } from '../engine/rosters';
import { BALL_PHYSICS, applyBallForces, dragCoefficient } from './ball';
import { PlayerBody } from './body';
import { Legs, NO_ERROR, type StrikeError, type StrikeRequest } from './legs';
import { BALL_SPEC, PITCH, goalCrossed } from './pitch-geometry';
import { PhysicsWorld } from './world';

beforeAll(async () => {
  await RAPIER.init();
});

const roster = () => createRoster(3);

function run(w: PhysicsWorld, seconds: number, each?: () => void) {
  const contacts = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    each?.();
    contacts.push(...w.step());
  }
  return contacts;
}

describe('ball physics', () => {
  it('bounces with turf restitution (2 m drop rebounds 0.5–0.9 m) and never sinks into the ground', () => {
    const w = new PhysicsWorld();
    w.ball.setTranslation({ x: 0, y: 2, z: 0 }, true);
    let minY = 9, peak = 0, fell = false;
    run(w, 2.5, () => {
      const y = w.ball.translation().y;
      minY = Math.min(minY, y);
      if (w.ball.linvel().y < -0.5) fell = true;
      if (fell && w.ball.linvel().y > 0) peak = Math.max(peak, y);
    });
    expect(minY).toBeGreaterThan(BALL_SPEC.radius - 0.02);
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThan(0.9);
  });

  it('a rolling ball decelerates like on turf and stops instead of rolling forever', () => {
    const w = new PhysicsWorld();
    w.ball.setLinvel({ x: 8, y: 0, z: 0 }, true);
    w.ball.setAngvel({ x: 0, y: 0, z: -8 / BALL_SPEC.radius }, true);
    let travelled = 0;
    let previous = 8;
    run(w, 25, () => {
      const v = w.ball.linvel().x;
      expect(v).toBeLessThanOrEqual(previous + 0.05);
      previous = v;
      travelled = w.ball.translation().x;
    });
    expect(Math.abs(w.ball.linvel().x)).toBeLessThan(0.1);
    // Rolling resistance (≈0.64 m/s²) plus subcritical drag (Cd 0.45: ≈1.6 m/s² at 8 m/s, falling with v²)
    // integrate to ≈ 25 m for a sliding ball; a rolling ball keeps its spin through the contact and is slowed
    // less (≈ 35 m for perfect grip). Measured ≈ 29 m; turf values for an 8 m/s pass are 20–40 m.
    expect(travelled).toBeGreaterThan(24);
    expect(travelled).toBeLessThan(35);
  });

  it('drag falls through the drag crisis and forces never accumulate between ticks', () => {
    expect(dragCoefficient(5)).toBeCloseTo(BALL_PHYSICS.cdSlow);
    expect(dragCoefficient(20)).toBeCloseTo(BALL_PHYSICS.cdFast);
    const w = new PhysicsWorld();
    w.world.gravity = { x: 0, y: 0, z: 0 };
    w.ball.setTranslation({ x: 0, y: 5, z: 0 }, true);
    w.ball.setLinvel({ x: 25, y: 0, z: 0 }, true);
    run(w, 3);
    const v = w.ball.linvel().x;
    expect(v).toBeGreaterThan(5);
    expect(v).toBeLessThan(25);
    // The stored force is the drag of the current speed only, not a sum over 180 ticks.
    const speed = Math.hypot(w.ball.linvel().x, w.ball.linvel().y, w.ball.linvel().z);
    const expected = 0.5 * BALL_PHYSICS.airDensity * dragCoefficient(speed) * Math.PI * BALL_SPEC.radius ** 2 * speed * speed;
    applyBallForces(w.ball);
    expect(Math.hypot(w.ball.userForce().x, w.ball.userForce().y, w.ball.userForce().z)).toBeCloseTo(expected, 3);
  });

  it('side spin curves a flighted ball (Magnus) in the direction of ω × v', () => {
    const curve = (spinY: number) => {
      const w = new PhysicsWorld();
      w.ball.setTranslation({ x: 0, y: 1, z: 0 }, true);
      w.ball.setLinvel({ x: 25, y: 6, z: 0 }, true);
      w.ball.setAngvel({ x: 0, y: spinY, z: 0 }, true);
      run(w, 0.9);
      return w.ball.translation().z;
    };
    // ω = +Y, v = +X → ω × v points to −Z.
    expect(curve(60)).toBeLessThan(-0.6);
    expect(curve(-60)).toBeGreaterThan(0.6);
    expect(Math.abs(curve(0))).toBeLessThan(0.05);
  });
});

describe('goal frame', () => {
  const shot = (from: { x: number; y: number; z: number }, v: { x: number; y: number; z: number }, seconds: number) => {
    const w = new PhysicsWorld();
    w.ball.setTranslation(from, true);
    w.ball.setLinvel(v, true);
    let goal = 0;
    run(w, seconds, () => { goal ||= goalCrossed(w.ball.translation()); });
    return { w, goal };
  };
  it('the net catches a shot that crossed the line', () => {
    const { w, goal } = shot({ x: 40, y: 0.6, z: 1 }, { x: 26, y: 1.5, z: 0 }, 2);
    expect(goal).toBe(1);
    expect(w.ball.translation().x).toBeLessThan(PITCH.halfLength + PITCH.goalDepth + 0.2);
  });
  it('the post and the crossbar send the ball back', () => {
    const post = shot({ x: 46, y: 1, z: PITCH.goalHalfWidth + PITCH.postRadius }, { x: 28, y: 0, z: 0 }, 0.5);
    expect(post.goal).toBe(0);
    expect(post.w.ball.linvel().x).toBeLessThan(0);
    const bar = shot({ x: 46, y: PITCH.goalHeight + PITCH.postRadius, z: 0 }, { x: 28, y: 0, z: 0 }, 0.4);
    expect(bar.w.ball.linvel().x).toBeLessThan(0);
  });
});

describe('player bodies', () => {
  it('accelerate within their limits and cannot turn around instantly', () => {
    const w = new PhysicsWorld();
    const profile = roster()[9];
    const body = new PlayerBody(w.world, profile, 0, 0, Math.PI / 2);
    run(w, 1, () => body.drive({ target: { x: 60, z: 0 }, speed: 99 }, 1 / 60));
    const after1s = body.speed();
    expect(after1s).toBeGreaterThan(3.5);
    expect(after1s).toBeLessThan(body.limits.maxSpeed);
    run(w, 4, () => body.drive({ target: { x: 200, z: 0 }, speed: 99 }, 1 / 60));
    expect(body.speed()).toBeGreaterThan(body.limits.maxSpeed * 0.85);
    const vBefore = body.velocity().x;
    run(w, 0.25, () => body.drive({ target: { x: -200, z: 0 }, speed: 99 }, 1 / 60));
    expect(body.velocity().x).toBeGreaterThan(vBefore - body.limits.maxBrake * 0.25 - 0.3);
  });

  it('22 bodies colliding for 30 s stay finite, upright and on the ground', () => {
    const w = new PhysicsWorld();
    const bodies = roster().map((p, i) => {
      const b = new PlayerBody(w.world, p, (i % 6) * 0.7 - 2, Math.floor(i / 6) * 0.7 - 1.5, 0);
      w.registerCollider(b.collider, p.id, 'body');
      return b;
    });
    const contacts = run(w, 30, () => bodies.forEach((b, i) => b.drive({ target: { x: Math.sin(i) * 3, z: Math.cos(i) * 3 }, speed: 6 }, 1 / 60)));
    for (const b of bodies) {
      const t = b.body.translation();
      expect(Number.isFinite(t.x) && Number.isFinite(t.z)).toBe(true);
      expect(Math.abs(t.y - b.height / 2)).toBeLessThan(0.05);
    }
    expect(contacts.some(c => c.kind === 'bodies')).toBe(true);
  });

  it('the same inputs reproduce the same world exactly', () => {
    const simulate = () => {
      const w = new PhysicsWorld();
      const bodies = roster().slice(0, 6).map((p, i) => new PlayerBody(w.world, p, i - 3, 0.3 * i, 0));
      w.ball.setLinvel({ x: 3, y: 2, z: 1 }, true);
      run(w, 5, () => bodies.forEach((b, i) => b.drive({ target: { x: 0, z: i - 3 }, speed: 7 }, 1 / 60)));
      return [w.ball.translation(), ...bodies.map(b => b.body.translation())];
    };
    expect(simulate()).toEqual(simulate());
  });
});

describe('boot / ball contact', () => {
  /** Player facing +X, ball 0.42 m ahead beside the right boot (right of +X facing is +Z). */
  function scene(ball = { x: 0.42, z: 0.12 }) {
    const w = new PhysicsWorld();
    const body = new PlayerBody(w.world, roster()[9], 0, 0, Math.PI / 2);
    const legs = new Legs(w.world, body);
    w.registerCollider(body.collider, 9, 'body');
    w.registerLegs(legs, 9);
    w.ball.setTranslation({ x: ball.x, y: BALL_SPEC.radius, z: ball.z }, true);
    const tick = () => body.drive({ target: body.position(), speed: 0 }, 1 / 60);
    run(w, 0.3, tick);
    return { w, body, legs, tick };
  }
  function kick(req: Partial<StrikeRequest>, err: StrikeError = NO_ERROR, ball?: { x: number; z: number }) {
    const s = scene(ball);
    const plan = s.legs.plan(s.w.ball, { technique: 'inside', side: 1, dirX: 1, dirZ: 0, elevation: 0, ballSpeed: 10, ...req }, err);
    expect(plan).not.toBeNull();
    s.legs.start(plan!);
    let peak = { x: 0, y: 0, z: 0, s: 0 };
    const contacts = run(s.w, 0.7, () => {
      s.tick();
      const v = s.w.ball.linvel();
      const sp = Math.hypot(v.x, v.y, v.z);
      if (sp > peak.s) peak = { x: v.x, y: v.y, z: v.z, s: sp };
    });
    return { ...s, peak, contacts };
  }

  it('standing next to the ball does not move it: proximity alone never kicks', () => {
    const s = scene();
    const contacts = run(s.w, 3, s.tick);
    expect(Math.hypot(s.w.ball.linvel().x, s.w.ball.linvel().z)).toBeLessThan(0.02);
    expect(contacts.filter(c => c.kind === 'ball' && c.part === 'boot')).toHaveLength(0);
  });

  it('a pass swing that meets the ball sends it close to the intended pace and direction', () => {
    const r = kick({ ballSpeed: 10 });
    expect(r.contacts.some(c => c.kind === 'ball' && c.part === 'boot')).toBe(true);
    expect(r.peak.s).toBeGreaterThan(8);
    expect(r.peak.s).toBeLessThan(12.5);
    expect(Math.abs(Math.atan2(r.peak.z, r.peak.x))).toBeLessThan(0.1);
  });

  it('an instep strike reaches shot pace and lifts the ball when struck below its centre', () => {
    const r = kick({ technique: 'instep', ballSpeed: 27, elevation: 0.12 });
    expect(r.peak.s).toBeGreaterThan(22);
    expect(r.peak.y).toBeGreaterThan(1);
  });

  it('different swing directions give different ball directions', () => {
    const angles = [-0.5, 0, 0.5].map(a => {
      const r = kick({ dirX: Math.cos(a), dirZ: Math.sin(a) });
      return Math.atan2(r.peak.z, r.peak.x);
    });
    expect(angles[0]).toBeLessThan(angles[1] - 0.3);
    expect(angles[2]).toBeGreaterThan(angles[1] + 0.3);
  });

  it('an off-centre strike is deflected and spins the ball', () => {
    const clean = kick({ technique: 'instep', ballSpeed: 20 });
    const mishit = kick({ technique: 'instep', ballSpeed: 20 }, { ...NO_ERROR, lateral: 0.06 });
    expect(Math.abs(Math.atan2(mishit.peak.z, mishit.peak.x) - Math.atan2(clean.peak.z, clean.peak.x))).toBeGreaterThan(0.15);
    const spin = mishit.w.ball.angvel();
    expect(Math.hypot(spin.x, spin.y, spin.z)).toBeGreaterThan(2);
  });

  it('when the ball is gone by the time the boot arrives, the swing is an air shot', () => {
    const s = scene();
    const plan = s.legs.plan(s.w.ball, { technique: 'instep', side: 1, dirX: 1, dirZ: 0, elevation: 0, ballSpeed: 20 });
    s.legs.start(plan!);
    s.w.ball.setTranslation({ x: 0.42, y: BALL_SPEC.radius, z: -0.8 }, true);
    const contacts = run(s.w, 0.7, s.tick);
    expect(contacts.filter(c => c.kind === 'ball' && c.part === 'boot')).toHaveLength(0);
    expect(Math.hypot(s.w.ball.linvel().x, s.w.ball.linvel().z)).toBeLessThan(0.02);
  });

  it('a ball out of reach cannot be planned for', () => {
    const s = scene({ x: 1.7, z: 0 });
    expect(s.legs.plan(s.w.ball, { technique: 'instep', side: 1, dirX: 1, dirZ: 0, elevation: 0, ballSpeed: 20 })).toBeNull();
  });

  it('a cushioned first touch takes most of the pace off an arriving ball', () => {
    const s = scene({ x: 7, z: 0.12 });
    s.w.ball.setLinvel({ x: -12, y: 0, z: 0 }, true);
    let plan = null;
    for (let i = 0; i < 60 && !plan; i++) {
      plan = s.legs.plan(s.w.ball, { technique: 'cushion', side: 1, dirX: -1, dirZ: 0, elevation: 0, ballSpeed: 0 });
      if (!plan) { s.tick(); s.w.step(); }
    }
    expect(plan).not.toBeNull();
    s.legs.start(plan!);
    const contacts = run(s.w, 0.5, s.tick);
    expect(contacts.some(c => c.kind === 'ball' && c.part === 'boot')).toBe(true);
    expect(Math.hypot(s.w.ball.linvel().x, s.w.ball.linvel().z)).toBeLessThan(4);
  });
});
