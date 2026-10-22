import RAPIER from '@dimforge/rapier3d-simd-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/match-engine';
import { runFor, stageScenario } from '../engine/scenario-helper';
import type { MatchEvent, MatchPhase, TeamId } from '../engine/types';
import type { Decision } from '../rules/referee';
import { DEFENDERS, FORWARDS, MIDFIELDERS } from './shape';

beforeAll(async () => {
  await RAPIER.init();
});

const role = (e: MatchEngine, team: TeamId, r: string) => e.profiles.find(p => p.team === team && p.role === r && p.squad === 'starter')!.id;
const whistle = (e: MatchEngine, d: Decision) => (e as unknown as { apply(d: Decision): void }).apply(d);
type Sub = Extract<MatchEvent, { type: 'substitution' }>;
const subsOf = (e: MatchEngine, from = 0) => e.events.slice(from).filter((ev): ev is Sub => ev.type === 'substitution');
/** Changes made at the staged stoppage only (earlier stoppages saw the real score). */
const staged = new WeakMap<MatchEngine, number>();
const stagedSubs = (e: MatchEngine) => subsOf(e, staged.get(e) ?? 0);

/** Team 1 coached by the computer; play runs to `share` of the second half, then the ball goes over the touchline. */
function lateStoppage(share: number, score: [number, number], seed = 5): MatchEngine {
  const e = new MatchEngine({ seed, halfMinutes: 2, benchCoach: [1] });
  runFor(e, 400, () => e.half === 2 && e.clockSeconds() > share * 120 && e.phase === 'in-play');
  staged.set(e, e.events.length);
  e.score[0] = score[0];
  e.score[1] = score[1];
  stageScenario(e, {}, { x: 10, y: 0.11, z: 33 }, { x: 0, y: 0, z: 5 }, false);
  e.referee.lastTouch = { player: role(e, 0, 'LB'), team: 0, part: 'boot', time: e.time, position: e.ballPos() };
  runFor(e, 6, () => !!e.restart?.placed && e.restart.benchSeen);
  return e;
}

describe('the computer coach (bench-manager.ts)', () => {
  it('trailing late on, he brings a forward on for a midfielder at a stoppage, and the forward plays', () => {
    const e = lateStoppage(0.6, [1, 0]);
    const chase = stagedSubs(e).find(s => s.reason === 'chase');
    expect(chase, JSON.stringify(subsOf(e))).toBeDefined();
    expect(chase!.team).toBe(1);
    expect(MIDFIELDERS.has(chase!.role)).toBe(true);
    expect(e.profiles[chase!.on].abilities.shooting).toBeGreaterThan(e.profiles[chase!.off].abilities.shooting);
    expect(e.referee.sentOff.has(chase!.off)).toBe(true);
    expect(e.referee.sentOff.has(chase!.on)).toBe(false);
    runFor(e, 8);
    expect(e.snapshot().players[chase!.on].sentOff).toBe(false);
  }, 300_000);

  it('leading late on, he takes a forward off for a defensive player; level, he does not chase or protect', () => {
    const lead = lateStoppage(0.75, [0, 1]);
    const protect = stagedSubs(lead).find(s => s.reason === 'protect');
    expect(protect, JSON.stringify(subsOf(lead))).toBeDefined();
    expect(FORWARDS.has(protect!.role)).toBe(true);
    expect(lead.profiles[protect!.on].abilities.tackling).toBeGreaterThan(lead.profiles[protect!.off].abilities.tackling);
    const level = lateStoppage(0.75, [1, 1]);
    expect(stagedSubs(level).some(s => s.reason === 'chase' || s.reason === 'protect')).toBe(false);
  }, 400_000);

  it('a keeper sent off: the substitute keeper goes in goal for a forward, even in the first half', () => {
    const e = new MatchEngine({ seed: 3, halfMinutes: 45, benchCoach: [1] });
    runFor(e, 5);
    const keeper = role(e, 1, 'GK');
    // The referee books a red card in his own lists before the engine applies the decision (referee.ts).
    e.referee.sentOff.add(keeper);
    e.referee.redCards.add(keeper);
    whistle(e, { type: 'foul', offender: keeper, victim: role(e, 0, 'ST'), spot: { x: 30, z: 5 }, penalty: false, card: 'red', reason: 'dogso', advantage: false });
    runFor(e, 6, () => !!e.restart?.placed && e.restart.benchSeen);
    const sub = subsOf(e).find(s => s.reason === 'keeper')!;
    expect(sub).toBeDefined();
    expect(sub.role).toBe('GK');
    expect(e.profiles[sub.on].role).toBe('GK');
    expect(FORWARDS.has(e.profiles[sub.off].role)).toBe(true);
    expect(e.referee.sentOff.has(sub.off)).toBe(true);
    // He keeps goal: from the halfway line to his own goal (team 1 defends +X in the first half).
    runFor(e, 12);
    expect(e.bodies[sub.on].position().x).toBeGreaterThan(40);
  }, 300_000);

  it('in a whole match: only at stoppages, only for its own team, within Law 3, and the same every time', () => {
    const play = () => {
      const e = new MatchEngine({ seed: 11, halfMinutes: 3, benchCoach: [1] });
      const phases: MatchPhase[] = [];
      e.onEvent(ev => { if (ev.type === 'substitution') phases.push(e.phase); });
      runFor(e, 600);
      return { e, phases };
    };
    const a = play(), b = play();
    const subs = subsOf(a.e);
    expect(a.e.phase).toBe('full-time');
    expect(subs.every(s => s.team === 1)).toBe(true);
    expect(a.phases.every(p => p === 'stopped')).toBe(true);
    expect(subs.length).toBeLessThanOrEqual(5);
    expect(new Set(subs.map(s => s.on)).size).toBe(subs.length);
    expect(subs.map(s => [s.off, s.on, s.reason])).toEqual(subsOf(b.e).map(s => [s.off, s.on, s.reason]));
    // Occasions at least a tenth of a half apart (3 min halves: 18 s).
    const times = [...new Set(subs.filter(s => s.reason !== 'keeper').map(s => s.time))];
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(18 - 1e-6);
    expect(subs.every(s => DEFENDERS.has(s.role) || MIDFIELDERS.has(s.role) || FORWARDS.has(s.role) || s.role === 'GK')).toBe(true);
  }, 300_000);
});
