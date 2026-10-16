import RAPIER from '@dimforge/rapier3d-simd-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/match-engine';
import { runFor, stageScenario } from '../engine/scenario-helper';
import type { DecisionMoment, MatchEvent } from '../engine/types';
import { MomentDirector } from './moment-director';

beforeAll(async () => {
  await RAPIER.init();
});

const role = (e: MatchEngine, team: 0 | 1, r: string) => e.profiles.find(p => p.team === team && p.role === r)!.id;

/** User team 0 (attacking +X): striker on the ball 19 m out, two team-mates in support, a few defenders. */
function attackingSetup(seed: number) {
  const e = new MatchEngine({ seed, halfMinutes: 45 });
  const director = new MomentDirector({ userTeam: 0, cooldown: 0, maxPerHalf: 99, timeoutSeconds: 12 });
  const st = role(e, 0, 'ST');
  stageScenario(e, {
    [st]: { x: 33.2, z: -0.12 },
    [role(e, 0, 'RW')]: { x: 38, z: -14 },
    [role(e, 0, 'LW')]: { x: 37, z: 13 },
    [role(e, 0, 'CM')]: { x: 24, z: 4 },
    [role(e, 1, 'RCB')]: { x: 40, z: -4 },
    [role(e, 1, 'LCB')]: { x: 41, z: 5 },
    [role(e, 1, 'CM')]: { x: 30, z: 6 },
    [role(e, 1, 'GK')]: { x: 51.5, z: 0 },
  }, { x: 33.6, y: 0.11, z: 0 });
  e.bodies[st].heading = Math.PI / 2;
  e.referee.lastTouch = { player: st, team: 0, part: 'boot', time: e.time, position: e.ballPos() };
  e.director = director.attach();
  runFor(e, 1);
  const moment: DecisionMoment | null = e.moment;
  // One moment per scenario: afterwards the players play on without further interruptions.
  e.director = null;
  return { e, moment, st };
}

describe('decisive moment director', () => {
  it('opens a moment for the user team when its striker faces a genuine finishing choice', () => {
    const { e, moment, st } = attackingSetup(3);
    expect(moment).not.toBeNull();
    expect(e.phase).toBe('decision');
    expect(moment!.focusPlayer).toBe(st);
    expect(moment!.options.length).toBeGreaterThanOrEqual(2);
    expect(moment!.options.map(o => o.id)).toContain(moment!.defaultOptionId);
    // The engine is frozen while the user thinks.
    const tick = e.tick;
    e.step();
    expect(e.tick).toBe(tick);
  });

  it('every offered player option is executed by the player as a real swing', () => {
    const { moment } = attackingSetup(3);
    for (const option of moment!.options) {
      const { e } = attackingSetup(3);
      const before = e.events.length;
      e.resolveMoment(option.id, 'user');
      runFor(e, 4);
      const log = e.events.slice(before);
      const expected = option.effect.type === 'player' && option.effect.intent.type === 'ball' ? option.effect.intent.action.kind : null;
      expect(log.some(ev => ev.type === 'swing' && ev.action === expected && ev.source === 'user')).toBe(true);
    }
  });

  it('the same state with different decisions leads to different plausible continuations', () => {
    const { moment } = attackingSetup(5);
    const continuations = moment!.options.slice(0, 2).map(option => {
      const { e } = attackingSetup(5);
      const before = e.events.length;
      e.resolveMoment(option.id, 'user');
      runFor(e, 6);
      const b = e.ballPos();
      return { log: e.events.slice(before).filter((ev: MatchEvent) => ev.type === 'touch' || ev.type === 'goal' || ev.type === 'out').map(ev => `${ev.type}:${'player' in ev ? ev.player : ''}`).join(','), ball: b };
    });
    expect(continuations[0].log).not.toBe(continuations[1].log);
    expect(Math.hypot(continuations[0].ball.x - continuations[1].ball.x, continuations[0].ball.z - continuations[1].ball.z)).toBeGreaterThan(1);
  });

  it('the same decision does not guarantee the same success: outcomes of a chosen shot vary with execution', () => {
    const outcomes = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { e, moment } = attackingSetup(seed);
      const shot = moment?.options.find(o => o.id.startsWith('shot'));
      if (!shot) continue;
      const before = e.events.length;
      e.resolveMoment(shot.id, 'user');
      runFor(e, 4, () => e.phase !== 'in-play');
      const log = e.events.slice(before);
      outcomes.add(log.some(ev => ev.type === 'goal') ? 'goal' : log.some(ev => ev.type === 'catch') ? 'caught' : log.some(ev => ev.type === 'out') ? 'out' : 'in-play');
    }
    expect(outcomes.size).toBeGreaterThan(1);
  });

  it('in an autonomous match moments stay rare and spaced', () => {
    const e = new MatchEngine({ seed: 8, halfMinutes: 4 });
    const director = new MomentDirector({ userTeam: 0, cooldown: 60, maxPerHalf: 3, timeoutSeconds: 12 });
    e.director = director.attach();
    const times: number[] = [];
    while (e.phase !== 'full-time' && e.time < 600) {
      e.step();
      if (e.phase === 'decision' && e.moment) {
        times.push(e.time);
        e.resolveMoment(e.moment.defaultOptionId, 'timeout');
      }
    }
    expect(e.phase).toBe('full-time');
    expect(times.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(60 - 0.5);
  }, 300_000);
});
