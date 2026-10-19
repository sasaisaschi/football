import RAPIER from '@dimforge/rapier3d-simd-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { PITCH } from '../physics/pitch-geometry';
import { MatchEngine } from './match-engine';
import { runFor, stageScenario } from './scenario-helper';
import type { MatchEvent } from './types';

beforeAll(async () => {
  await RAPIER.init();
});

describe('throw-in (Law 15)', () => {
  it('is taken with both hands from behind and over the head; the ball is in play once it leaves them', () => {
    const e = new MatchEngine({ seed: 5, halfMinutes: 45 });
    const events: MatchEvent[] = [];
    e.onEvent(ev => events.push(ev));
    // A loose ball rolls out over the touchline near the halfway line.
    stageScenario(e, {}, { x: 2, y: 0.11, z: PITCH.halfWidth - 1 }, { x: 0, y: 0, z: 3 }, false);
    let maxHeld = 0, taker = -1, thrown: { ballY: number; bodyZ: number } | null = null;
    runFor(e, 25, () => {
      if (e.restart?.kind === 'throw-in') taker = e.restart.taker;
      if (taker >= 0 && e.throwHands.ready()) maxHeld = Math.max(maxHeld, e.ballPos().y - e.bodies[taker].height);
      const inPlay = events.find(ev => ev.type === 'in-play' && ev.restart === 'throw-in');
      if (inPlay && !thrown) thrown = { ballY: e.ballPos().y, bodyZ: e.bodies[taker].position().z };
      return !!inPlay && e.time > 0;
    });
    expect(events.some(ev => ev.type === 'out' && ev.restart === 'throw-in')).toBe(true);
    const inPlay = events.find(ev => ev.type === 'in-play' && ev.restart === 'throw-in');
    expect(inPlay).toBeDefined();
    // Held above his head before the throw.
    expect(maxHeld).toBeGreaterThan(0);
    // The touch that put the ball in play was the taker's hands, never a boot.
    const restartAt = events.findIndex(ev => ev.type === 'restart' && ev.restart === 'throw-in');
    const touches = events.slice(restartAt).filter(ev => ev.type === 'touch');
    expect(touches[0]).toMatchObject({ type: 'touch', player: taker, part: 'hands' });
    // Released above head height, with the thrower's body still behind the touchline.
    expect(thrown!.ballY).toBeGreaterThan(e.bodies[taker].height);
    expect(Math.abs(thrown!.bodyZ)).toBeGreaterThan(PITCH.halfWidth - 0.05);
    // And the ball flies into the pitch.
    runFor(e, 0.5);
    expect(Math.abs(e.ballPos().z)).toBeLessThan(PITCH.halfWidth - 1);
  });
});
