import RAPIER from '@dimforge/rapier3d-simd-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/match-engine';
import { matchStats } from '../engine/match-stats';
import type { MatchEvent } from '../engine/types';
import { setLang } from '../i18n';
import { Orchestrator } from '../orchestrator/orchestrator';
import { IntelBoard, INTEL_SCHEMA } from './board';
import { narrate } from './narrator';
import { passDifficulty } from './stats';
import { briefMoment } from './moment-brief';
import type { DecisionMoment, MatchSnapshot } from '../engine/types';

beforeAll(async () => {
  await RAPIER.init();
});

/** A real match with the orchestrator (every moment settled by its default), fed to the board as the app does. */
function play(seed: number, halfMinutes: number) {
  const e = new MatchEngine({ seed, halfMinutes, benchCoach: [1] });
  e.director = new Orchestrator({ userTeam: 0, cooldown: 25, maxPerHalf: 5, timeoutSeconds: 15 }).attach();
  const board = new IntelBoard(e.profiles, halfMinutes);
  const events: MatchEvent[] = [];
  const moments: { m: DecisionMoment; frame: MatchSnapshot; briefs: [ReturnType<typeof briefMoment>, ReturnType<typeof briefMoment>] }[] = [];
  let pending: MatchEvent[] = [];
  e.onEvent(ev => { events.push(ev); pending.push(ev); });
  while (e.phase !== 'full-time' && e.time < halfMinutes * 120 + 300) {
    e.step();
    if (e.phase === 'decision') {
      const frame = e.snapshot();
      moments.push({ m: e.moment!, frame, briefs: [briefMoment(e.moment!, frame, e.profiles, board.stats, 'fan'), briefMoment(e.moment!, frame, e.profiles, board.stats, 'analyst')] });
      board.noteMoment(e.moment!);
      e.resolveMoment(e.moment!.defaultOptionId, 'timeout');
    }
    const frame = e.snapshot();
    for (const ev of pending) board.ingest(ev, frame);
    pending = [];
    board.observe(frame);
  }
  return { e, board, events, moments };
}

describe('match intelligence pipeline', () => {
  const run = (() => { let r: ReturnType<typeof play> | null = null; return () => (r ??= play(21, 4)); })();

  it('every insight rests on real events, and its numbers agree with the independent match statistics', () => {
    const { e, board, events } = run();
    expect(e.phase).toBe('full-time');
    const ids = new Set(events.map(ev => ev.id));
    expect(board.insights.length).toBeGreaterThan(3);
    for (const i of board.insights) for (const id of i.eventIds) expect(ids.has(id), `${i.kind} cites event ${id}`).toBe(true);
    const reference = matchStats(events, e.profiles);
    expect(board.stats.teams.map(t => t.goals)).toEqual([...e.score]);
    expect(board.stats.teams.map(t => t.shots)).toEqual(reference.shots);
    expect(board.stats.possessionChanges).toBe(reference.possessionChanges);
    const goals = board.insights.filter(i => i.kind === 'goal-story');
    expect(goals.length).toBe(e.score[0] + e.score[1]);
    expect(board.insights.some(i => i.kind === 'full-summary')).toBe(true);
    // Decisions of the user team are followed to an outcome.
    const decided = events.filter(ev => ev.type === 'decision').length;
    expect(board.insights.filter(i => i.kind === 'decision').length).toBeGreaterThanOrEqual(Math.min(1, decided));
  }, 600_000);

  it('two audiences, two languages: complete words, different for fan and analyst, nothing undefined', () => {
    const { e, board } = run();
    for (const lang of ['en', 'de'] as const) {
      setLang(lang);
      for (const i of board.insights) {
        const fan = narrate(i, 'fan', { profiles: e.profiles, favouriteTeam: 0 }), analyst = narrate(i, 'analyst', { profiles: e.profiles, favouriteTeam: 0 });
        for (const n of [fan, analyst]) {
          expect(n.title.length, `${i.kind} title`).toBeGreaterThan(2);
          expect(n.text, `${i.kind} ${lang}`).not.toMatch(/undefined|NaN|\[object/);
        }
        expect(analyst.text, i.kind).not.toBe(fan.text);
      }
    }
    setLang('en');
  }, 600_000);

  it('a machine-readable, versioned feed that is the same for the same match', () => {
    const a = run().board.export({ seed: 21, userTeam: 0, score: run().e.score });
    const b = play(21, 4).board.export({ seed: 21, userTeam: 0, score: run().e.score });
    expect(a.schema).toBe(INTEL_SCHEMA);
    expect(JSON.parse(JSON.stringify(a))).toEqual(JSON.parse(JSON.stringify(b)));
    expect(a.insights.every(i => i.text.fan.en.text && i.text.fan.de.text && i.text.analyst.en.text && i.text.analyst.de.text)).toBe(true);
    expect(a.teams[0].possessionPct + a.teams[1].possessionPct).toBeGreaterThanOrEqual(99);
  }, 900_000);

  it('every decision moment is explained from its frozen frame, the estimates are the players\' own', () => {
    const { moments } = run();
    expect(moments.length).toBeGreaterThan(2);
    for (const { m, briefs } of moments) {
      for (const b of briefs) {
        if (m.category !== 'coach') expect(b.lines.length, m.kind).toBeGreaterThan(0);
        for (const l of [...b.lines, ...b.options.map(o => o.note)]) expect(l, m.kind).not.toMatch(/undefined|NaN|Infinity/);
        for (const o of m.options) {
          const note = b.options.find(x => x.id === o.id)!;
          if (o.estimate !== undefined) expect(note.note).toContain(`${Math.round(o.estimate * 100)} %`);
        }
      }
      // The analyst gets at least as much as the fan, with the numbers.
      expect(briefs[1].lines.length).toBeGreaterThanOrEqual(briefs[0].lines.length - 1);
    }
  }, 600_000);

  it('a goal from the penalty spot: origin penalty, and no "last pass" from before the penalty', () => {
    const e = new MatchEngine({ seed: 1, halfMinutes: 45 });
    const frame = e.snapshot();
    const board = new IntelBoard(e.profiles, 45);
    const st = e.profiles.find(p => p.team === 0 && p.role === 'ST' && p.squad === 'starter')!.id;
    const cm = e.profiles.find(p => p.team === 0 && p.role === 'CM' && p.squad === 'starter')!.id;
    let id = 0;
    const at = (time: number, ev: Record<string, unknown>) => board.ingest({ id: ++id, tick: Math.round(time * 60), time, ...ev } as MatchEvent, frame);
    const pos = { x: 30, y: 0.11, z: 0 };
    at(10, { type: 'swing', player: cm, action: 'pass', source: 'ai', receiver: st });
    at(10.1, { type: 'touch', player: cm, part: 'boot', ballSpeed: 12, position: pos });
    at(11, { type: 'touch', player: st, part: 'boot', ballSpeed: 3, position: pos });
    at(30, { type: 'restart', restart: 'penalty', team: 0, position: { x: 41.5, z: 0 } });
    at(33, { type: 'swing', player: st, action: 'shot', source: 'ai' });
    at(33.1, { type: 'in-play', restart: 'penalty', taker: st });
    at(33.1, { type: 'touch', player: st, part: 'boot', ballSpeed: 26, position: { x: 41.5, y: 0.11, z: 0 } });
    // The keeper gets a hand to it and it still goes in: the last touch is his, the move is no longer ours.
    const gk = e.profiles.find(p => p.team === 1 && p.role === 'GK' && p.squad === 'starter')!.id;
    at(33.4, { type: 'touch', player: gk, part: 'hands', ballSpeed: 20, position: { x: 51, y: 0.6, z: 2 } });
    at(33.6, { type: 'goal', team: 0, scorer: st, ownGoal: false, position: { x: 52.6, y: 0.5, z: 2 } });
    const goal = board.insights.find(i => i.kind === 'goal-story')!;
    expect(goal.data.origin).toBe('penalty');
    expect(goal.data.assist).toBeUndefined();
  });

  it('pass difficulty follows its parts: longer, pressed and forward passes are harder', () => {
    expect(passDifficulty(8, 9, 0)).toBe(2);
    expect(passDifficulty(8, 1.5, 0)).toBeGreaterThan(passDifficulty(8, 9, 0));
    expect(passDifficulty(40, 9, 0)).toBeGreaterThan(passDifficulty(10, 9, 0));
    expect(passDifficulty(20, 9, 15)).toBeGreaterThan(passDifficulty(20, 9, 0));
    expect(passDifficulty(80, 0.5, 40)).toBe(5);
  });
});
