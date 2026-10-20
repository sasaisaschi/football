import RAPIER from '@dimforge/rapier3d-simd-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/match-engine';
import { runFor, stageScenario } from '../engine/scenario-helper';
import type { DecisionMoment, MatchEvent } from '../engine/types';
import { Orchestrator } from './orchestrator';

beforeAll(async () => {
  await RAPIER.init();
});

const role = (e: MatchEngine, team: 0 | 1, r: string) => e.profiles.find(p => p.team === team && p.role === r)!.id;

/** User team 0 (attacking +X): striker on the ball 19 m out, two team-mates in support, a few defenders. */
function attackingSetup(seed: number) {
  const e = new MatchEngine({ seed, halfMinutes: 45 });
  const director = new Orchestrator({ userTeam: 0, cooldown: 0, maxPerHalf: 99, timeoutSeconds: 12 });
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

describe('orchestrator: open play', () => {
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
    // A shot from 19 m is mostly caught; over a dozen executions some go wide or are parried.
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
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
    const director = new Orchestrator({ userTeam: 0, cooldown: 60, maxPerHalf: 3, timeoutSeconds: 12 });
    e.director = director.attach();
    const times: number[] = [];
    const kinds: { kind: string; half: number }[] = [];
    while (e.phase !== 'full-time' && e.time < 600) {
      e.step();
      if (e.phase === 'decision' && e.moment) {
        // The half-time talk and a penalty are outside the spacing (the talk also outside the half's quota).
        if (e.moment.kind !== 'team-talk' && e.moment.kind !== 'penalty') times.push(e.time);
        kinds.push({ kind: e.moment.kind, half: e.half });
        e.resolveMoment(e.moment.defaultOptionId, 'timeout');
      }
    }
    expect(e.phase).toBe('full-time');
    expect(times.length).toBeLessThanOrEqual(6);
    expect(kinds.filter(k => k.kind === 'team-talk')).toEqual([{ kind: 'team-talk', half: 2 }]);
    // No kind of situation crowds out the others: at most one transition moment (counter, counter-press) per half.
    for (const half of [1, 2]) expect(kinds.filter(k => k.half === half && (k.kind === 'counter-press' || k.kind === 'counter-attack')).length).toBeLessThanOrEqual(1);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(60 - 0.5);
  }, 300_000);

  it('danger in front of our box: pressing is carried out by the defender, delegating is recorded as such', () => {
    const setup = () => {
      const e = new MatchEngine({ seed: 9, halfMinutes: 45 });
      const carrier = role(e, 1, 'ST');
      const defender = role(e, 0, 'RCB');
      // Team 0 defends the goal at -X in the first half.
      stageScenario(e, { [carrier]: { x: -31, z: 2 }, [defender]: { x: -35, z: 1 }, [role(e, 0, 'GK')]: { x: -51, z: 0 } }, { x: -30.6, y: 0.11, z: 2 });
      e.bodies[carrier].heading = -Math.PI / 2;
      e.referee.lastTouch = { player: carrier, team: 1, part: 'boot', time: e.time, position: e.ballPos() };
      e.director = new Orchestrator({ userTeam: 0, cooldown: 0, maxPerHalf: 99, timeoutSeconds: 12 }).attach();
      runFor(e, 0.5);
      const moment = e.moment;
      e.director = null;
      return { e, moment, carrier, defender };
    };
    const { e, moment, carrier, defender } = setup();
    expect(moment?.kind).toBe('box-defence');
    expect(moment!.focusPlayer).toBe(defender);
    expect(moment!.options.map(o => o.id)).toEqual(['press', 'block', 'hold']);
    // The defender's own run towards the carrier (the carrier may shoot from there, so the gap alone would not
    // show who closed it).
    const target = e.bodies[carrier].position();
    const toTarget = () => Math.hypot(e.bodies[defender].position().x - target.x, e.bodies[defender].position().z - target.z);
    const before = toTarget();
    e.resolveMoment('press', 'user');
    runFor(e, 0.6);
    expect(toTarget()).toBeLessThan(before - 0.8);

    const second = setup();
    second.e.resolveMoment(second.moment!.defaultOptionId, 'delegated');
    const decision = second.e.events.find(ev => ev.type === 'decision');
    expect(decision).toMatchObject({ optionId: 'hold', chosenBy: 'delegated' });
  });

  /** Seed 9: the carrier winds up for a shot 21 m out; the RCB stands 4 m goal-side of him. */
  const boxDefence = (option: string) => {
    const e = new MatchEngine({ seed: 9, halfMinutes: 45 });
    const carrier = role(e, 1, 'ST'), defender = role(e, 0, 'RCB');
    stageScenario(e, { [carrier]: { x: -31, z: 2 }, [defender]: { x: -35, z: 1 }, [role(e, 0, 'GK')]: { x: -51, z: 0 } }, { x: -30.6, y: 0.11, z: 2 });
    e.bodies[carrier].heading = -Math.PI / 2;
    e.referee.lastTouch = { player: carrier, team: 1, part: 'boot', time: e.time, position: e.ballPos() };
    e.director = new Orchestrator({ userTeam: 0, cooldown: 0, maxPerHalf: 99, timeoutSeconds: 12 }).attach();
    runFor(e, 0.5);
    e.director = null;
    const target = e.bodies[carrier].position();
    const gap = () => Math.hypot(e.bodies[defender].position().x - target.x, e.bodies[defender].position().z - target.z);
    const before = gap();
    const from = e.events.length;
    e.resolveMoment(option, 'user');
    return { e, defender, closed: () => before - gap(), events: () => e.events.slice(from) };
  };

  it('box defence: pressing closes in faster than holding (jockeying keeps its distance)', () => {
    const closing = (option: string) => { const s = boxDefence(option); runFor(s.e, 0.6); return s.closed(); };
    expect(closing('press')).toBeGreaterThan(closing('hold') + 0.3);
  });

  it('box defence: only a defender who steps into the shooting lane gets his body to the shot', () => {
    const shotTouchedBy = (option: string) => {
      const s = boxDefence(option);
      runFor(s.e, 1.5);
      return s.events().some(ev => ev.type === 'touch' && ev.player === s.defender);
    };
    expect(shotTouchedBy('block')).toBe(true);
    expect(shotTouchedBy('hold')).toBe(false);
  });
});
