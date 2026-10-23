import RAPIER from '@dimforge/rapier3d-simd-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { wallSpots } from '../ai/set-piece-defence';
import { MatchEngine } from '../engine/match-engine';
import { runFor, stageScenario } from '../engine/scenario-helper';
import type { MatchEvent, Vec2 } from '../engine/types';
import { PITCH } from '../physics/pitch-geometry';
import type { Decision } from '../rules/referee';
import { Orchestrator } from './orchestrator';

beforeAll(async () => {
  await RAPIER.init();
});

const role = (e: MatchEngine, team: 0 | 1, r: string) => e.profiles.find(p => p.team === team && p.role === r && p.squad === 'starter')!.id;
const open = () => new Orchestrator({ userTeam: 0, cooldown: 0, maxPerHalf: 99, timeoutSeconds: 12 }).attach();
const whistle = (e: MatchEngine, d: Decision) => (e as unknown as { apply(d: Decision): void }).apply(d);
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

/** A real throw-in in the second half: the ball rolled over the touchline after team 1's touch. */
function secondHalfStoppage(seed = 5): MatchEngine {
  const e = new MatchEngine({ seed, halfMinutes: 2 });
  runFor(e, 200, () => e.half === 2 && e.clockSeconds() > 50);
  stageScenario(e, {}, { x: 10, y: 0.11, z: 33 }, { x: 0, y: 0, z: 5 }, false);
  e.referee.lastTouch = { player: role(e, 1, 'LB'), team: 1, part: 'boot', time: e.time, position: e.ballPos() };
  runFor(e, 6, () => !!e.restart?.placed);
  return e;
}

describe('substitutions (Law 3)', () => {
  it('a substitute comes on at the halfway line, takes the position, and the replaced player cannot return', () => {
    const e = secondHalfStoppage();
    expect(e.phase).toBe('stopped');
    const off = role(e, 0, 'ST');
    const on = e.benchOf(0).find(p => p.role === 'ST')!.id;
    e.substitute(off, on);
    expect(e.events.at(-1)).toMatchObject({ type: 'substitution', team: 0, off, on, role: 'ST' });
    expect(e.referee.sentOff.has(off)).toBe(true);
    expect(e.referee.sentOff.has(on)).toBe(false);
    expect(e.profiles[on].role).toBe('ST');
    const p = e.bodies[on].position();
    expect(Math.abs(p.x)).toBeLessThan(0.5);
    expect(Math.abs(Math.abs(p.z) - PITCH.halfWidth)).toBeLessThan(1);
    expect(e.benchOf(0).some(b => b.id === off)).toBe(false);
    // He plays: runs into the pitch towards his position, and the match goes on to the throw-in.
    runFor(e, 8);
    expect(Math.abs(e.bodies[on].position().z)).toBeLessThan(PITCH.halfWidth - 3);
    expect(e.snapshot().players[on].sentOff).toBe(false);
    expect(e.snapshot().players[off].sentOff).toBe(true);
  }, 120_000);

  it('only with the ball out of play, at most five changes on three occasions', () => {
    const e = secondHalfStoppage();
    const bench = e.benchOf(0).filter(p => p.role !== 'GK');
    const field = ['ST', 'RW', 'CM', 'RCB'].map(r => role(e, 0, r));
    e.substitute(field[0], bench[0].id);
    e.substitute(field[1], bench[1].id); // same stoppage: same occasion
    expect(e.substitutions[0]).toBe(2);
    // In play: not allowed.
    runFor(e, 15, () => e.phase === 'in-play');
    expect(e.phase).toBe('in-play');
    expect(e.canSubstitute(0)).toBe(false);
    expect(() => e.substitute(field[2], bench[2].id)).toThrow();
  }, 120_000);

  it('the orchestrator offers changes at a stoppage in the second half, "Keinen Wechsel" by default', () => {
    const e = secondHalfStoppage(7);
    const o = new Orchestrator({ userTeam: 0, cooldown: 0, maxPerHalf: 99, timeoutSeconds: 12 });
    // Re-consult this placed restart with an orchestrator that has not opened anything yet.
    e.restart!.consulted = false;
    e.director = o.attach();
    runFor(e, 1);
    expect(e.moment?.kind).toBe('substitution');
    expect(e.moment!.defaultOptionId).toBe('no-sub');
    const change = e.moment!.options.find(op => op.effect.type === 'substitution')!;
    e.director = null;
    const from = e.events.length;
    e.resolveMoment(change.id, 'user');
    expect(e.phase).toBe('stopped');
    expect(e.events.slice(from).some(ev => ev.type === 'substitution')).toBe(true);
  }, 120_000);
});

describe('keeper at a penalty against us', () => {
  /** Team 1's penalty against team 0 (team 0 defends −X in the first half). */
  const penalty = (seed: number, side?: -1 | 0 | 1) => {
    const e = new MatchEngine({ seed, halfMinutes: 45 });
    stageScenario(e, { [role(e, 0, 'GK')]: { x: -50, z: 2 } }, { x: -30, y: 0.11, z: 0 });
    whistle(e, { type: 'foul', offender: role(e, 0, 'RCB'), victim: role(e, 1, 'ST'), spot: { x: -45, z: 0 }, penalty: true, card: 'none', reason: 'foul', advantage: false });
    if (side !== undefined) {
      e.director = open();
      runFor(e, 10);
      expect(e.moment?.kind).toBe('penalty-save');
      e.director = null;
      e.resolveMoment(side === 0 ? 'gk-wait' : side < 0 ? 'gk-left' : 'gk-right', 'user');
    }
    return e;
  };

  it('stands on the goal line before the kick (Law 14)', () => {
    const e = penalty(3, 0);
    const gk = role(e, 0, 'GK');
    runFor(e, 20, () => e.events.some(ev => ev.type === 'swing' && ev.action === 'shot'));
    expect(Math.abs(e.bodies[gk].position().x + PITCH.halfLength)).toBeLessThan(0.7);
  }, 60_000);

  it('an early dive goes to the chosen side at the strike; waiting does not move him first', () => {
    const lateral = (side: -1 | 0 | 1) => {
      const e = penalty(4, side);
      const gk = role(e, 0, 'GK');
      runFor(e, 20, () => e.events.some(ev => ev.type === 'touch' && ev.player !== gk));
      const z0 = e.bodies[gk].position().z;
      runFor(e, 0.35);
      return e.bodies[gk].position().z - z0;
    };
    // Team 0 faces +X: his left is −Z, his right +Z.
    expect(lateral(-1)).toBeLessThan(-0.5);
    expect(lateral(1)).toBeGreaterThan(0.5);
  }, 120_000);

  it('the same kick ends differently with a right and a wrong guess (no save is decided in advance)', () => {
    let rightSaves = 0, wrongSaves = 0, rightGoals = 0, wrongGoals = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      // The kick does not depend on the keeper's plan: learn its side once, then guess right and wrong.
      const probe = penalty(seed, 0);
      runFor(probe, 20, () => probe.events.some(ev => ev.type === 'goal' || ev.type === 'catch' || ev.type === 'out' || (ev.type === 'touch' && ev.part === 'hands')));
      const shotZ = probe.ballPos().z;
      if (Math.abs(shotZ) < 0.8) continue;
      const kickSide = (shotZ < 0 ? -1 : 1) as -1 | 1; // −Z is his left
      for (const [side, right] of [[kickSide, true], [(-kickSide) as -1 | 1, false]] as const) {
        const e = penalty(seed, side);
        const from = e.events.length;
        runFor(e, 20, () => e.events.slice(from).some(ev => ev.type === 'goal' || ev.type === 'out' || ev.type === 'catch' || (ev.type === 'touch' && ev.part === 'hands')));
        const log: MatchEvent[] = e.events.slice(from);
        const saved = log.some(ev => ev.type === 'catch' || (ev.type === 'touch' && ev.part === 'hands')) && !log.some(ev => ev.type === 'goal');
        const goal = log.some(ev => ev.type === 'goal');
        if (right) { rightSaves += +saved; rightGoals += +goal; } else { wrongSaves += +saved; wrongGoals += +goal; }
      }
    }
    expect(rightSaves).toBeGreaterThan(wrongSaves);
    expect(wrongGoals).toBeGreaterThanOrEqual(rightGoals);
  }, 300_000);
});

describe('free-kick wall (Law 13)', () => {
  /** Direct free kick for team 1, 21 m in front of team 0's goal (−X). */
  const freeKick = (choose?: string) => {
    const e = new MatchEngine({ seed: 6, halfMinutes: 45 });
    stageScenario(e, {
      [role(e, 0, 'RCB')]: { x: -38, z: 3 }, [role(e, 0, 'LCB')]: { x: -40, z: -2 }, [role(e, 0, 'CM')]: { x: -34, z: 6 }, [role(e, 0, 'LB')]: { x: -42, z: 8 }, [role(e, 0, 'RB')]: { x: -42, z: -9 },
      [role(e, 1, 'ST')]: { x: -30, z: 4 }, [role(e, 1, 'LW')]: { x: -40, z: 10 },
    }, { x: -31, y: 0.11, z: 4 });
    whistle(e, { type: 'foul', offender: role(e, 0, 'CM'), victim: role(e, 1, 'ST'), spot: { x: -31.5, z: 4 }, penalty: false, card: 'none', reason: 'foul', advantage: false });
    if (choose) {
      e.director = open();
      runFor(e, 10);
      expect(e.moment?.kind).toBe('free-kick-wall');
      e.director = null;
      e.resolveMoment(choose, 'user');
    }
    // Up to the moment the taker strikes the ball: that is where the wall has to stand.
    const from = e.events.length;
    runFor(e, 12, () => e.events.slice(from).some(ev => ev.type === 'swing'));
    return e;
  };
  const inWall = (e: MatchEngine, size: number) => {
    const spots = wallSpots({ x: -31.5, z: 4 }, -PITCH.halfLength, size);
    return spots.filter(s => e.profiles.some(p => p.team === 0 && !e.referee.sentOff.has(p.id) && dist(e.bodies[p.id].position(), s) < 1.2)).length;
  };

  it('defenders form a wall of three by default, all of them at least 9.15 m from the ball', () => {
    const e = freeKick();
    expect(e.events.some(ev => ev.type === 'restart' && ev.restart === 'free-kick')).toBe(true);
    expect(inWall(e, 3)).toBe(3);
    for (const p of e.profiles) if (p.team === 0 && !e.referee.sentOff.has(p.id)) expect(dist(e.bodies[p.id].position(), { x: -31.5, z: 4 })).toBeGreaterThan(9.0);
  }, 60_000);

  it('the chosen wall is formed: four, or none at all', () => {
    expect(inWall(freeKick('wall-4'), 4)).toBe(4);
    expect(inWall(freeKick('wall-0'), 3)).toBe(0);
  }, 60_000);
});

describe('corner defence', () => {
  /** Corner for team 1 at the flag of team 0's goal (−X). */
  const corner = (choose: string) => {
    const e = new MatchEngine({ seed: 4, halfMinutes: 45 });
    stageScenario(e, {
      [role(e, 1, 'ST')]: { x: -44, z: 3 }, [role(e, 1, 'RCB')]: { x: -40, z: -4 }, [role(e, 1, 'LCB')]: { x: -42, z: 6 },
      [role(e, 0, 'RCB')]: { x: -45, z: 2 }, [role(e, 0, 'LCB')]: { x: -45, z: -3 }, [role(e, 0, 'GK')]: { x: -51.5, z: 0 },
    }, { x: -50.5, y: 0.11, z: 20 }, { x: -6, y: 0, z: 0 }, false);
    e.referee.lastTouch = { player: role(e, 0, 'RB'), team: 0, part: 'boot', time: e.time, position: e.ballPos() };
    e.director = open();
    runFor(e, 8);
    expect(e.moment?.kind).toBe('corner-defence');
    e.director = null;
    e.resolveMoment(choose, 'user');
    runFor(e, 15, () => e.phase === 'in-play');
    return e;
  };
  const ours = (e: MatchEngine) => e.profiles.filter(p => p.team === 0 && p.role !== 'GK' && !e.referee.sentOff.has(p.id)).map(p => e.bodies[p.id].position());

  it('zone, man and counter schemes put the defenders in different places, legally away from the corner', () => {
    const zone = corner('cd-zone'), man = corner('cd-man'), counter = corner('cd-counter');
    const atPost = (e: MatchEngine) => ours(e).filter(p => Math.abs(p.x + PITCH.halfLength) < 2.5 && Math.abs(p.z) < PITCH.goalHalfWidth + 1).length;
    expect(atPost(zone)).toBeGreaterThanOrEqual(2);
    // Counter: two forwards wait near the halfway line.
    expect(ours(counter).filter(p => Math.abs(p.x) < 8).length).toBeGreaterThanOrEqual(2);
    expect(ours(zone).filter(p => Math.abs(p.x) < 8).length).toBeLessThan(2);
    // Man marking: more attackers in the box have a defender at their side than with zones.
    const marked = (e: MatchEngine) => {
      const attackers = e.profiles.filter(p => p.team === 1 && p.role !== 'GK' && !e.referee.sentOff.has(p.id)).map(p => e.bodies[p.id].position()).filter(a => a.x < -36 && Math.abs(a.z) < 20);
      return attackers.filter(a => Math.min(...ours(e).map(d => dist(d, a))) < 2).length / Math.max(1, attackers.length);
    };
    expect(marked(man)).toBeGreaterThanOrEqual(0.6);
    // The same defenders stand in clearly different places under the two schemes (mean shift over 2 m).
    const shift = ours(man).reduce((sum, p, i) => sum + dist(p, ours(zone)[i]), 0) / ours(man).length;
    expect(shift).toBeGreaterThan(2);
    for (const e of [zone, man, counter]) {
      const spot = { x: -PITCH.halfLength + 0.5, z: PITCH.halfWidth - 0.5 };
      for (const p of ours(e)) expect(dist(p, spot)).toBeGreaterThan(8.5);
    }
  }, 180_000);
});
