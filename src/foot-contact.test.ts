import RAPIER from '@dimforge/rapier3d-simd-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyBallDrag, createBall } from './ball';
import { GROUPS } from './collision-groups';
import { Legs, NO_ERROR, SwingError, SwingRequest, createLegs, planSwing, startSwing, substepsFor, updateLegs } from './foot-contact';
import { OUTFIELD, createMotor, driveMotor } from './player-motor';

beforeAll(async () => {
  await RAPIER.init();
});

/** One player facing +X with the ball 0.42 m ahead, 0.12 m towards the right foot (side +1 is −Z when facing +X). */
function scene(ballOffset = { x: 0.42, z: -0.12 }) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.1, 50).setFriction(0.8).setCollisionGroups(GROUPS.world), ground);
  const motor = createMotor(world, 0, 0, Math.PI / 2, OUTFIELD);
  const legs = createLegs(world, motor);
  const ball = createBall(world, ballOffset.x, ballOffset.z);
  const queue = new RAPIER.EventQueue(true);
  const footTouches: number[] = [];
  const handles = new Set(legs.feet.map(f => f.collider.handle));
  const ballHandle = ball.collider(0).handle;
  const step = () => {
    driveMotor(motor, { targetX: motor.body.translation().x, targetZ: motor.body.translation().z, speed: 0 }, 1 / 60);
    applyBallDrag(ball);
    const n = substepsFor([legs], 1 / 60);
    world.timestep = 1 / 60 / n;
    for (let k = 0; k < n; k++) {
      updateLegs(legs, motor, 1 / 60 / n);
      world.step(queue);
      queue.drainCollisionEvents((a, b, started) => {
        if (started && (a === ballHandle || b === ballHandle) && (handles.has(a) || handles.has(b))) footTouches.push(k);
      });
    }
  };
  // Let everything settle on the ground.
  for (let i = 0; i < 20; i++) step();
  return { world, motor, legs, ball, step, footTouches };
}

function kick(req: Partial<SwingRequest>, err: SwingError = NO_ERROR, ballOffset?: { x: number; z: number }) {
  const s = scene(ballOffset);
  const plan = planSwing(s.motor, s.ball, { technique: 'inside', side: 1, dirX: 1, dirZ: 0, elevation: 0, ballSpeed: 10, ...req }, err);
  expect(plan).not.toBeNull();
  startSwing(s.legs, plan!);
  let peak = { x: 0, y: 0, z: 0, speed: 0 };
  for (let i = 0; i < 40; i++) {
    s.step();
    const v = s.ball.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed > peak.speed) peak = { x: v.x, y: v.y, z: v.z, speed };
  }
  return { ...s, peak, legs: s.legs as Legs };
}

describe('physical boot/ball contact', () => {
  it('standing next to the ball does not move it (no proximity kick)', () => {
    const s = scene();
    for (let i = 0; i < 180; i++) s.step();
    const v = s.ball.linvel();
    expect(Math.hypot(v.x, v.y, v.z)).toBeLessThan(0.05);
    expect(s.footTouches.length).toBe(0);
  });

  it('a swing that reaches the ball sends it roughly where and how fast it was aimed', () => {
    const r = kick({ ballSpeed: 10 });
    expect(r.footTouches.length).toBeGreaterThan(0);
    expect(r.peak.speed).toBeGreaterThan(8);
    expect(r.peak.speed).toBeLessThan(12.5);
    expect(Math.abs(Math.atan2(r.peak.z, r.peak.x))).toBeLessThan(0.12);
  });

  it('a hard instep strike produces a shot-speed ball', () => {
    const r = kick({ technique: 'instep', ballSpeed: 26, elevation: 0.08 });
    expect(r.peak.speed).toBeGreaterThan(21);
    expect(r.peak.speed).toBeLessThan(32);
    expect(r.peak.y).toBeGreaterThan(0);
  });

  it('different contact directions give different ball directions', () => {
    const angles = [-0.5, 0, 0.5].map(a => {
      const r = kick({ dirX: Math.cos(a), dirZ: Math.sin(a) });
      return Math.atan2(r.peak.z, r.peak.x);
    });
    expect(angles[0]).toBeLessThan(angles[1] - 0.25);
    expect(angles[2]).toBeGreaterThan(angles[1] + 0.25);
  });

  it('an off-centre contact deflects the ball and adds spin', () => {
    const clean = kick({ technique: 'instep', ballSpeed: 20 });
    const mishit = kick({ technique: 'instep', ballSpeed: 20 }, { ...NO_ERROR, lateral: 0.06 });
    const dClean = Math.atan2(clean.peak.z, clean.peak.x);
    const dMishit = Math.atan2(mishit.peak.z, mishit.peak.x);
    expect(Math.abs(dMishit - dClean)).toBeGreaterThan(0.15);
    const w = mishit.ball.angvel();
    expect(Math.hypot(w.x, w.y, w.z)).toBeGreaterThan(1);
  });

  it('if the ball is gone when the boot arrives, the swing misses and the ball stays put', () => {
    const s = scene();
    const plan = planSwing(s.motor, s.ball, { technique: 'instep', side: 1, dirX: 1, dirZ: 0, elevation: 0, ballSpeed: 20 });
    expect(plan).not.toBeNull();
    startSwing(s.legs, plan!);
    // An opponent's action moved the ball 0.6 m sideways during the wind-up.
    s.ball.setTranslation({ x: 0.42, y: 0.11, z: 0.6 }, true);
    for (let i = 0; i < 40; i++) s.step();
    const v = s.ball.linvel();
    expect(s.footTouches.length).toBe(0);
    expect(Math.hypot(v.x, v.z)).toBeLessThan(0.05);
  });

  it('a ball out of reach cannot be planned for', () => {
    const s = scene({ x: 1.6, z: 0 });
    expect(planSwing(s.motor, s.ball, { technique: 'instep', side: 1, dirX: 1, dirZ: 0, elevation: 0, ballSpeed: 20 })).toBeNull();
  });

  it('cushion control takes most of the pace off an arriving ball', () => {
    const s = scene({ x: 6, z: -0.12 });
    s.ball.setLinvel({ x: -12, y: 0, z: 0 }, true);
    let plan = null;
    for (let i = 0; i < 60 && !plan; i++) {
      plan = planSwing(s.motor, s.ball, { technique: 'cushion', side: 1, dirX: -1, dirZ: 0, elevation: 0, ballSpeed: 0 });
      if (!plan) s.step();
    }
    expect(plan).not.toBeNull();
    startSwing(s.legs, plan!);
    for (let i = 0; i < 30; i++) s.step();
    expect(s.footTouches.length).toBeGreaterThan(0);
    expect(Math.hypot(s.ball.linvel().x, s.ball.linvel().z)).toBeLessThan(4);
  });
});
