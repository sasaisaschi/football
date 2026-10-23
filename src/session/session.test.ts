import RAPIER from '@dimforge/rapier3d-simd-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DecisionMoment, DecisionSource, MatchEvent } from '../engine/types';
import { SimRunner } from '../sim/runner';
import { SessionDriver, type SimSource } from './driver';
import { SessionFlow } from './flow';
import { BUILD_UP, HZ, LAG, managerCap, managerStep } from './pacing';

beforeAll(async () => {
  await RAPIER.init();
});

/** The simulation as the session sees it, from a runner in this thread (the worker does the same in the browser). */
class RunnerSource implements SimSource {
  produced = 0;
  momentTick: number | null = null;
  moment: DecisionMoment | null = null;
  done = false;
  readonly events: MatchEvent[] = [];
  constructor(readonly runner: SimRunner) {}
  pump(ticks: number): void {
    if (this.moment || this.done) return;
    const b = this.runner.advance(ticks);
    if (b.count) this.produced = b.firstTick + b.count - 1;
    this.events.push(...b.events);
    if (b.moment) { this.moment = b.moment; this.momentTick = this.produced; }
    this.done = b.done;
  }
  resolve(optionId: string, by: DecisionSource): void {
    this.moment = null; this.momentTick = null;
    this.runner.resolve(optionId, by);
  }
}

const config = { seed: 7, halfMinutes: 3, userTeam: 0 as const, cooldown: 20, maxPerHalf: 4, timeoutSeconds: 12 };
/** The user's choice in every moment: the second option where there is one. */
const choose = (m: DecisionMoment) => (m.options[1] ?? m.options[0]).id;

/** Plays a whole session headless: manager view, scenes, half-time screen, as the browser does. */
function playSession() {
  const src = new RunnerSource(new SimRunner(config));
  const seen: MatchEvent[] = [];
  const scenes: { moment: number; from: number; momentTick: number; seenBefore: number }[] = [];
  let finished = false;
  let driver!: SessionDriver;
  driver = new SessionDriver(src, {
    event: e => seen.push(e),
    observe: () => {},
    sceneBegins: (m, from) => scenes.push({ moment: m.id, from, momentTick: src.momentTick!, seenBefore: seen.length }),
    frozen: m => driver.decide(choose(m), 'user'),
    coach: m => driver.decide(choose(m), 'user'),
    interval: () => {},
    sceneEnds: () => {},
    final: () => { finished = true; },
    consequenceSettled: () => true,
  });
  driver.kickOff();
  for (let i = 0; i < 200000 && !finished; i++) {
    src.pump(30);
    driver.update(1 / 60);
    if (driver.flow.phase === 'interval' && driver.canStartSecondHalf()) driver.secondHalf();
  }
  return { src, seen, scenes, finished, driver };
}

describe('session flow', () => {
  it('refuses transitions that would lose or repeat a decision', () => {
    const f = new SessionFlow();
    const m = { id: 1, category: 'attack' } as DecisionMoment;
    expect(() => f.sceneBegins(m)).toThrow();
    f.kickOff();
    f.sceneBegins(m);
    expect(() => f.sceneBegins({ ...m, id: 2 })).toThrow(/not allowed/);
    f.frozen();
    f.decide(1);
    expect(() => f.decide(1)).toThrow();
    f.sceneEnds();
    expect(() => f.sceneBegins(m)).toThrow(/already decided/);
    expect(() => f.coachMoment({ id: 3, category: 'attack' } as DecisionMoment)).toThrow(/needs its scene/);
  });

  it('keeps the manager view behind the simulation so the build-up is still unseen', () => {
    const s = { produced: 6000, momentTick: null, sceneMoment: false, done: false };
    expect(managerCap(s)).toBe(6000 - LAG * HZ);
    expect(managerStep(100, 1, 1000, s)).toBe(6000 - LAG * HZ);
    expect(managerCap({ ...s, momentTick: 6000, sceneMoment: true })).toBe(6000 - BUILD_UP * HZ);
    expect(managerStep(5900, 1, 1000, { ...s, momentTick: 5800, sceneMoment: true })).toBe(5900);
  });
});

describe('a whole manager session', () => {
  let run!: ReturnType<typeof playSession>;
  beforeAll(() => { run = playSession(); }, 300000);

  it('reaches full time with every moment decided exactly once', () => {
    expect(run.finished).toBe(true);
    const moments = run.src.events.filter(e => e.type === 'moment').map(e => (e as { momentId: number }).momentId);
    const decisions = run.src.events.filter(e => e.type === 'decision').map(e => (e as { momentId: number }).momentId);
    expect(moments.length).toBeGreaterThan(2);
    expect(decisions).toEqual(moments);
    expect(run.driver.flow.decisions).toBe(moments.length);
  });

  it('hands on every event exactly once, in order', () => {
    expect(run.seen.map(e => e.id)).toEqual(run.src.events.map(e => e.id));
  });

  it('shows the real build-up of each scene for the first time', () => {
    expect(run.scenes.length).toBeGreaterThan(0);
    for (const sc of run.scenes) {
      expect(sc.momentTick - sc.from).toBeLessThanOrEqual(BUILD_UP * HZ + 1);
      // Nothing after the build-up's start had been handed on when the scene began.
      const last = run.seen[sc.seenBefore - 1];
      expect(last?.tick ?? 0).toBeLessThanOrEqual(sc.from);
    }
  });

  it('plays the same match as the runner on its own with the same decisions', () => {
    const r = new SimRunner(config);
    const events: MatchEvent[] = [];
    for (;;) {
      const b = r.advance(30);
      events.push(...b.events);
      if (b.moment) r.resolve(choose(b.moment), 'user');
      if (b.done) break;
    }
    expect(run.src.events.map(e => `${e.tick}:${e.type}`)).toEqual(events.map(e => `${e.tick}:${e.type}`));
  });
});
