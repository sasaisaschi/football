import RAPIER from '@dimforge/rapier3d-simd-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { PITCH } from '../physics/pitch-geometry';
import { STANDS } from '../physics/pitch-colliders';
import { MatchEngine } from './match-engine';
import { runFor, stageScenario } from './scenario-helper';
import type { MatchEvent, MatchPhase } from './types';

beforeAll(async () => {
  await RAPIER.init();
});

const VALID: Record<MatchPhase, MatchPhase[]> = {
  'pre-kickoff': ['stopped'],
  stopped: ['stopped', 'in-play', 'full-time'],
  'in-play': ['in-play', 'stopped', 'decision', 'full-time'],
  decision: ['in-play'],
  'half-time': ['stopped'],
  'full-time': ['full-time'],
};

describe('autonomous 11 v 11 match', () => {
  it('plays two halves to full time without user input, never entering an invalid state', () => {
    const e = new MatchEngine({ seed: 4, halfMinutes: 2 });
    const events: MatchEvent[] = [];
    e.onEvent(ev => events.push(ev));
    let phase = e.phase;
    let maxBallSpeed = 0;
    let inPlayTicks = 0;
    while (e.phase !== 'full-time' && e.time < 60 * 6) {
      e.step();
      expect(VALID[phase]).toContain(e.phase);
      phase = e.phase;
      if (e.phase === 'in-play') inPlayTicks++;
      const b = e.ballPos();
      expect(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.z)).toBe(true);
      // The ball can fly over the boards but never leaves the stadium.
      expect(Math.abs(b.x)).toBeLessThan(STANDS.x);
      expect(Math.abs(b.z)).toBeLessThan(STANDS.z);
      expect(b.y).toBeGreaterThan(0);
      const v = e.physics.ball.linvel();
      maxBallSpeed = Math.max(maxBallSpeed, Math.hypot(v.x, v.y, v.z));
      if (e.tick % 30 === 0) {
        for (const p of e.snapshot().players) {
          if (p.sentOff) continue;
          expect(Math.hypot(p.velocity.x, p.velocity.z)).toBeLessThan(11);
          // Bodies stay on the turf (a capsule may ride up a few cm over the ball, never fly).
          expect(Math.abs(p.position.y - e.bodies[p.id].height / 2)).toBeLessThan(0.3);
        }
      }
    }
    expect(e.phase).toBe('full-time');
    expect(events.filter(ev => ev.type === 'half-time')).toHaveLength(1);
    expect(events.filter(ev => ev.type === 'full-time')).toHaveLength(1);
    expect(maxBallSpeed).toBeLessThan(40);
    expect(inPlayTicks / e.tick).toBeGreaterThan(0.5);
    // Football actually happens: several players kick the ball, both teams get it.
    const kickers = new Set(events.filter(ev => ev.type === 'touch' && ev.part === 'boot').map(ev => (ev as { player: number }).player));
    expect(kickers.size).toBeGreaterThan(8);
    expect(new Set([...kickers].map(id => e.profiles[id].team)).size).toBe(2);
    // Every restart that was set up was taken, unless the half ended while the ball was dead.
    let open = false;
    for (const ev of events) {
      if (ev.type === 'restart') { expect(open).toBe(false); open = true; }
      if (ev.type === 'in-play' || ev.type === 'half-time' || ev.type === 'full-time') open = false;
    }
    // Fouls stay in a football range (a real match has roughly 20–30 in 90 minutes).
    expect(events.filter(ev => ev.type === 'foul').length).toBeLessThanOrEqual(8);
  }, 240_000);

  it('the same seed plays the same match; another seed plays a different one', () => {
    const play = (seed: number) => {
      const e = new MatchEngine({ seed, halfMinutes: 1 });
      runFor(e, 25);
      return e.events.filter(ev => ev.type === 'touch').map(ev => `${ev.tick}:${(ev as { player: number }).player}`).join(',');
    };
    expect(play(11)).toBe(play(11));
    expect(play(11)).not.toBe(play(12));
  }, 120_000);

  it('not everybody chases the ball: most players stay in their zones', () => {
    const e = new MatchEngine({ seed: 6, halfMinutes: 5 });
    let crowded = 0, samples = 0;
    runFor(e, 60);
    for (let i = 0; i < 600; i++) {
      e.step();
      if (i % 20 || e.phase !== 'in-play') continue;
      const b = e.ballPos();
      const near = e.snapshot().players.filter(p => Math.hypot(p.position.x - b.x, p.position.z - b.z) < 8).length;
      samples++;
      if (near > 8) crowded++;
    }
    expect(samples).toBeGreaterThan(5);
    expect(crowded / samples).toBeLessThan(0.2);
  }, 120_000);

  it('a shot at the goal is dealt with by the keeper through hands or body contact, or ends in the goal or out', () => {
    let saves = 0, goals = 0;
    for (const seed of [1, 2, 3, 4]) {
      const e = new MatchEngine({ seed, halfMinutes: 10 });
      const st = e.profiles.find(p => p.team === 0 && p.role === 'ST')!.id;
      const gk = e.profiles.find(p => p.team === 1 && p.role === 'GK')!.id;
      stageScenario(e, { [st]: { x: 34.6, z: 0.12 * (seed % 2 ? 1 : -1) }, [gk]: { x: 51.5, z: 0 } }, { x: 35, y: 0.11, z: 0 });
      e.bodies[st].heading = Math.PI / 2;
      const aimZ = seed % 2 ? 2.8 : 0.6;
      e.setUserIntent(st, { type: 'ball', action: { kind: 'shot', aim: { x: PITCH.halfLength, y: 1, z: aimZ }, speed: 26 }, source: 'user', decidedAt: e.time });
      const before = e.events.length;
      runFor(e, 3, () => e.phase !== 'in-play');
      const log = e.events.slice(before);
      expect(log.some(ev => ev.type === 'swing' && ev.player === st && ev.source === 'user')).toBe(true);
      if (log.some(ev => ev.type === 'goal')) goals++;
      if (log.some(ev => (ev.type === 'touch' || ev.type === 'catch') && ev.player === gk)) saves++;
    }
    expect(saves + goals).toBeGreaterThan(0);
    expect(saves).toBeGreaterThan(0);
  }, 120_000);
});
