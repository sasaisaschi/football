import RAPIER from '@dimforge/rapier3d-simd-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/match-engine';
import { runFor, stageScenario } from '../engine/scenario-helper';
import type { Decision } from '../rules/referee';
import type { MatchEvent, Vec2 } from '../engine/types';
import { Orchestrator } from './orchestrator';

beforeAll(async () => {
  await RAPIER.init();
});

const role = (e: MatchEngine, team: 0 | 1, r: string) => e.profiles.find(p => p.team === team && p.role === r)!.id;
const open = () => new Orchestrator({ userTeam: 0, cooldown: 0, maxPerHalf: 99, timeoutSeconds: 12 }).attach();

/**
 * A real ball out of play: the ball rolls over a line after a touch by team 1, the referee awards the restart to
 * team 0 (user team, attacking +X in the first half), and the orchestrator is asked before it is taken.
 */
function outOfPlay(seed: number, ball: { x: number; z: number }, velocity: { x: number; z: number }, players: (e: MatchEngine) => Record<number, Vec2>) {
  const e = new MatchEngine({ seed, halfMinutes: 45 });
  stageScenario(e, players(e), { x: ball.x, y: 0.11, z: ball.z }, { x: velocity.x, y: 0, z: velocity.z }, false);
  const toucher = role(e, 1, 'LB');
  e.referee.lastTouch = { player: toucher, team: 1, part: 'boot', time: e.time, position: e.ballPos() };
  e.director = open();
  runFor(e, 8);
  return e;
}

/** The referee's own decision fed in as if he had just whistled (fouls cannot be staged reliably from bodies). */
function whistle(e: MatchEngine, d: Decision): void {
  (e as unknown as { apply(d: Decision): void }).apply(d);
}

/** Team-mates within throwing range of a throw-in at the left touchline (+Z), some opponents marking. */
const throwIn = (seed = 4) => outOfPlay(seed, { x: 14, z: 32.5 }, { x: 0, z: 5 }, e => ({
  [role(e, 0, 'LB')]: { x: 13, z: 31 }, [role(e, 0, 'LW')]: { x: 24, z: 27 }, [role(e, 0, 'LCM')]: { x: 9, z: 24 }, [role(e, 0, 'ST')]: { x: 26, z: 18 },
  [role(e, 0, 'CM')]: { x: 2, z: 26 }, [role(e, 1, 'RB')]: { x: 22, z: 25 }, [role(e, 1, 'RCM')]: { x: 12, z: 22 },
}));
/** Attackers around the box for a corner at the left flag of the goal at +X. */
const corner = (seed = 4) => outOfPlay(seed, { x: 50.5, z: 18 }, { x: 6, z: 0 }, e => ({
  [role(e, 0, 'ST')]: { x: 42, z: 4 }, [role(e, 0, 'RCB')]: { x: 38, z: -6 }, [role(e, 0, 'LCB')]: { x: 38, z: 8 }, [role(e, 0, 'CM')]: { x: 32, z: 0 },
  [role(e, 0, 'LW')]: { x: 44, z: 22 }, [role(e, 1, 'GK')]: { x: 51.5, z: 0 }, [role(e, 1, 'RCB')]: { x: 47, z: 2 }, [role(e, 1, 'LCB')]: { x: 47, z: -3 },
}));

/** Resolves the open moment with `optionId` and plays on; returns the events from the decision on. */
function choose(e: MatchEngine, optionId: string, seconds: number): MatchEvent[] {
  const from = e.events.length;
  e.director = null;
  e.resolveMoment(optionId, 'user');
  runFor(e, seconds);
  return e.events.slice(from);
}

/** Resolves the moment, waits until the restart is taken (or a swing starts), then plays `after` seconds more. */
function chooseAndTake(e: MatchEngine, optionId: string, after: number, until: (ev: MatchEvent) => boolean = ev => ev.type === 'in-play'): MatchEvent[] {
  const from = e.events.length;
  e.director = null;
  e.resolveMoment(optionId, 'user');
  runFor(e, 15, () => e.events.slice(from).some(until));
  runFor(e, after);
  return e.events.slice(from);
}

describe('orchestrator: set pieces stop play before they are taken', () => {
  it('a throw-in stops before the throw and returns to the same restart afterwards', () => {
    const e = throwIn();
    expect(e.phase).toBe('decision');
    expect(e.moment?.kind).toBe('throw-in');
    const restart = { ...e.restart! };
    expect(restart.placed).toBe(true);
    expect(restart.consulted).toBe(true);
    const receivers = e.moment!.options.map(o => o.visual?.ball?.receiver);
    expect(new Set(receivers).size).toBe(receivers.length);
    expect(receivers.length).toBeGreaterThanOrEqual(2);
    expect(e.moment!.options.map(o => o.id)).toContain(e.moment!.defaultOptionId);
    // Frozen while the user decides.
    const tick = e.tick;
    e.step();
    expect(e.tick).toBe(tick);
    e.director = null;
    e.resolveMoment(e.moment!.options[0].id, 'user');
    expect(e.phase).toBe('stopped');
    expect(e.restart).toMatchObject({ kind: 'throw-in', taker: restart.taker, spot: restart.spot, placed: true });
  });

  it('every throw-in option is thrown with both hands to its receiver, exactly once', () => {
    const { moment } = throwIn();
    for (const option of moment!.options) {
      const e = throwIn();
      const taker = moment!.focusPlayer;
      const log = choose(e, option.id, 6);
      // Exactly one restart of play for this throw-in (up to whatever stoppage open play brings next).
      const nextStop = log.findIndex(ev => ev.type === 'restart');
      const untilNext = nextStop < 0 ? log : log.slice(0, nextStop);
      expect(untilNext.filter(ev => ev.type === 'in-play')).toEqual([expect.objectContaining({ restart: 'throw-in', taker })]);
      // Never the same throw-in again (Law 15 retake loop); a later, different restart may follow from open play.
      const spot = e.events.find(ev => ev.type === 'restart')!;
      expect(log.filter(ev => ev.type === 'restart' && spot.type === 'restart' && ev.restart === 'throw-in' && ev.team === spot.team && Math.hypot(ev.position.x - spot.position.x, ev.position.z - spot.position.z) < 1)).toHaveLength(0);
      expect(log.find(ev => ev.type === 'swing')).toMatchObject({ player: taker, action: 'throw', source: 'user' });
      expect(log.find(ev => ev.type === 'touch')).toMatchObject({ player: taker, part: 'hands' });
    }
  }, 60_000);

  it('different throw-in choices lead to different continuations; the same choice repeats exactly', () => {
    const run = (optionId: string) => {
      const e = throwIn();
      const log = choose(e, optionId, 3);
      const b = e.ballPos();
      return { touches: log.filter(ev => ev.type === 'touch').map(ev => ev.type === 'touch' ? `${ev.player}:${ev.part}` : '').join(','), ball: b };
    };
    const [a, b] = throwIn().moment!.options.map(o => o.id);
    const ra = run(a), rb = run(b), again = run(a);
    expect(ra.touches).not.toBe(rb.touches);
    expect(Math.hypot(ra.ball.x - rb.ball.x, ra.ball.z - rb.ball.z)).toBeGreaterThan(2);
    expect(again).toEqual(ra);
  }, 60_000);

  it('a corner offers only occupied zones; each variant is a real strike, and they end up in different places', () => {
    const e = corner();
    expect(e.moment?.kind).toBe('corner');
    expect(e.restart?.kind).toBe('corner');
    const options = e.moment!.options;
    expect(options.length).toBeGreaterThanOrEqual(2);
    const landing = new Map<string, { x: number; z: number }>();
    for (const option of options) {
      const s = corner();
      const log = chooseAndTake(s, option.id, 2);
      expect(log.filter(ev => ev.type === 'in-play')).toHaveLength(1);
      expect(log.find(ev => ev.type === 'swing')).toMatchObject({ player: e.moment!.focusPlayer, action: 'pass', source: 'user' });
      landing.set(option.id, s.ballPos());
    }
    const spots = [...landing.values()];
    let spread = 0;
    for (const p of spots) for (const q of spots) spread = Math.max(spread, Math.hypot(p.x - q.x, p.z - q.z));
    expect(spread).toBeGreaterThan(5);
  }, 120_000);

  it('the orchestrator looks at each placed restart exactly once', () => {
    const e = new MatchEngine({ seed: 4, halfMinutes: 45 });
    stageScenario(e, {}, { x: 14, y: 0.11, z: 32.5 }, { x: 0, y: 0, z: 5 });
    e.referee.lastTouch = { player: role(e, 1, 'LB'), team: 1, part: 'boot', time: e.time, position: e.ballPos() };
    let stoppedCalls = 0;
    e.director = engine => { if (engine.phase === 'stopped') stoppedCalls++; return null; };
    runFor(e, 8);
    expect(e.events.filter(ev => ev.type === 'restart')).toHaveLength(1);
    expect(stoppedCalls).toBe(1);
  });

  it('a direct free kick offers a shot when the lane is open; not behind a wall, and never when indirect', () => {
    const fk = (direct: boolean, defendersNear: boolean) => {
      const e = new MatchEngine({ seed: 6, halfMinutes: 45 });
      const back = defendersNear ? { rcb: { x: 44, z: -3 }, lcb: { x: 44, z: 5 } } : { rcb: { x: 12, z: -20 }, lcb: { x: 12, z: 20 } };
      stageScenario(e, {
        [role(e, 0, 'ST')]: { x: 31, z: 2 }, [role(e, 0, 'LW')]: { x: 43, z: 12 }, [role(e, 0, 'RW')]: { x: 41, z: -12 }, [role(e, 0, 'CM')]: { x: 22, z: 0 }, [role(e, 0, 'LCM')]: { x: 25, z: 12 },
        [role(e, 1, 'GK')]: { x: 51, z: 0 }, [role(e, 1, 'RCB')]: back.rcb, [role(e, 1, 'LCB')]: back.lcb,
      }, { x: 30.5, y: 0.11, z: 3 });
      const spot = { x: 30, z: 3 };
      if (direct) whistle(e, { type: 'foul', offender: role(e, 1, 'CM'), victim: role(e, 0, 'ST'), spot, penalty: false, card: 'none', reason: 'Foulspiel', advantage: false });
      else whistle(e, { type: 'offside', player: role(e, 1, 'ST'), spot });
      e.director = open();
      runFor(e, 8);
      return e;
    };
    // Defenders far away when the ball is placed: the lane is open.
    const direct = fk(true, true);
    const open_ = fk(true, false);
    expect(open_.moment?.kind).toBe('free-kick');
    expect(open_.moment!.options.map(o => o.id)).toContain('fk-shot');
    const log = chooseAndTake(open_, 'fk-shot', 0.5, ev => ev.type === 'swing');
    expect(log.find(ev => ev.type === 'swing')).toMatchObject({ action: 'shot', source: 'user' });
    // Defenders already lining up in front of the ball: a direct shot is too poor to be offered.
    if (direct.moment) expect(direct.moment.options.map(o => o.id)).not.toContain('fk-shot');
    // Offside is an indirect free kick: no shot, whatever the lane.
    const indirect = fk(false, false);
    if (indirect.moment) expect(indirect.moment.options.map(o => o.id)).not.toContain('fk-shot');
  }, 60_000);

  it('penalties are shot – by the AI, and towards the corner the user picks', () => {
    const penalty = (seed: number, orchestrated: boolean) => {
      const e = new MatchEngine({ seed, halfMinutes: 45 });
      stageScenario(e, { [role(e, 1, 'GK')]: { x: 51.5, z: 0 } }, { x: 40, y: 0.11, z: 0 });
      whistle(e, { type: 'foul', offender: role(e, 1, 'RCB'), victim: role(e, 0, 'ST'), spot: { x: 45, z: 2 }, penalty: true, card: 'none', reason: 'Foulspiel', advantage: false });
      if (orchestrated) e.director = open();
      runFor(e, 20, () => e.events.some(ev => ev.type === 'swing'));
      return e;
    };
    expect(penalty(3, false).events.find(ev => ev.type === 'swing')).toMatchObject({ action: 'shot', source: 'ai' });
    // The strike has its own execution error; over several takers the chosen side shows, a single kick may stray.
    const sideOf = (seed: number, optionId: string) => {
      const e = penalty(seed, true);
      expect(e.moment?.kind).toBe('penalty');
      const log = chooseAndTake(e, optionId, 0, ev => ev.type === 'touch');
      expect(log.find(ev => ev.type === 'swing')).toMatchObject({ action: 'shot', source: 'user' });
      runFor(e, 0.5, () => e.ballPos().x > 50);
      return e.ballPos().z;
    };
    const seeds = [1, 2, 3, 4, 5, 6];
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    // Team 0 attacks +X: the shooter's left is −Z.
    expect(mean(seeds.map(s => sideOf(s, 'pen-left')))).toBeLessThan(mean(seeds.map(s => sideOf(s, 'pen-right'))) - 1.5);
  }, 120_000);

  it('the half-time talk sets the instruction for the whole second half', () => {
    const e = new MatchEngine({ seed: 2, halfMinutes: 0.25 });
    e.director = open();
    runFor(e, 60, () => e.moment?.kind === 'team-talk');
    while (e.phase === 'decision' && e.moment?.kind !== 'team-talk') { e.resolveMoment(e.moment!.defaultOptionId, 'timeout'); runFor(e, 60, () => e.moment?.kind === 'team-talk'); }
    expect(e.moment?.kind).toBe('team-talk');
    expect(e.half).toBe(2);
    expect(e.restart?.kind).toBe('kickoff');
    e.director = null;
    e.resolveMoment('press', 'user');
    expect(e.phase).toBe('stopped');
    runFor(e, 10);
    expect(e.instructions[0]).toMatchObject({ press: 'high', lineHeight: 0.5, risk: 0.7 });
    expect(e.events.filter(ev => ev.type === 'kickoff' && ev.half === 2)).toHaveLength(1);
  }, 60_000);
});
