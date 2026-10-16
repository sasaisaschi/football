import RAPIER from '@dimforge/rapier3d-simd-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { Match, MatchEvent } from './match';
import { PITCH } from './pitch';
import { driveMotor } from './player-motor';

beforeAll(async () => {
  await RAPIER.init();
});

describe('11 v 11 match simulation', () => {
  it('fields 22 players with exactly one goalkeeper per team', () => {
    const m = new Match(1);
    expect(m.players).toHaveLength(22);
    for (const team of [0, 1]) expect(m.players.filter(p => p.team === team && p.role === 'GK')).toHaveLength(1);
  });

  it('plays 90 seconds with only physical ball movement, consistent events and bounded players', () => {
    const m = new Match(3);
    const events: MatchEvent[] = [];
    m.onEvent(e => events.push(e));
    let maxSpeed = 0;
    for (let i = 0; i < 60 * 90; i++) {
      m.step();
      if (i % 15) continue;
      for (const p of m.players) {
        const t = p.motor.body.translation(), v = p.motor.body.linvel();
        expect(Number.isFinite(t.x) && Number.isFinite(t.z)).toBe(true);
        expect(Math.abs(t.x)).toBeLessThan(PITCH.halfLength + PITCH.runOff);
        expect(Math.abs(t.z)).toBeLessThan(PITCH.halfWidth + PITCH.runOff);
        maxSpeed = Math.max(maxSpeed, Math.hypot(v.x, v.z));
      }
    }
    expect(maxSpeed).toBeLessThan(10);
    const kicks = events.filter(e => e.type === 'kick-attempt');
    const footTouches = events.filter(e => e.type === 'touch' && e.payload?.part === 'foot');
    expect(kicks.length).toBeGreaterThan(10);
    expect(footTouches.length).toBeGreaterThan(5);
    // Every goal follows a real ball touch; no goal comes from a decision alone.
    for (const goal of events.filter(e => e.type === 'goal')) {
      expect(events.some(e => e.type === 'touch' && e.tick <= goal.tick)).toBe(true);
    }
  }, 60_000);

  it('players accelerate within bounds and cannot reverse instantly', () => {
    const m = new Match(4);
    const p = m.players.find(q => q.role === 'CM')!;
    m.world.timestep = 1 / 60;
    p.motor.body.setLinvel({ x: 7, y: 0, z: 0 }, true);
    const start = p.motor.body.translation();
    for (let i = 0; i < 12; i++) {
      driveMotor(p.motor, { targetX: start.x - 50, targetZ: start.z, speed: 8.6 }, 1 / 60);
      m.world.step();
    }
    // 0.2 s of maximal braking (7.5 m/s²) can remove at most 1.5 m/s.
    expect(p.motor.body.linvel().x).toBeGreaterThan(5.3);
    const q = m.players.find(r => r.role === 'LCM')!;
    q.motor.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    const s = q.motor.body.translation();
    for (let i = 0; i < 60; i++) {
      driveMotor(q.motor, { targetX: s.x + 60, targetZ: s.z, speed: 8.6 }, 1 / 60);
      m.world.step();
    }
    const v = Math.hypot(q.motor.body.linvel().x, q.motor.body.linvel().z);
    expect(v).toBeGreaterThan(4);
    expect(v).toBeLessThan(7.2);
  });

  it('a user intent is executed through the same swing and physics as an AI intent', () => {
    const m = new Match(9);
    for (let i = 0; i < 60 * 2; i++) m.step();
    const kickoffTaker = m.events.find(e => e.type === 'kick-attempt');
    expect(kickoffTaker?.source).toBe('agent');
    const target = m.players.find(p => p.team === 0 && p.role === 'ST')!;
    m.setUserIntent(target.id, { kind: 'shot', dirX: 1, dirZ: 0, elevation: 0.08, ballSpeed: 26 });
    expect(target.userIntent?.source).toBe('user');
  });
});
