import RAPIER from '@dimforge/rapier3d-simd-compat';
import { expect, it } from 'vitest';
import { keeperShape } from '../ai/shape';
import { BALL_PHYSICS } from '../physics/ball';
import { PITCH } from '../physics/pitch-geometry';
import { createRng } from './rng';
import { MatchEngine } from './match-engine';
import { runFor, stageScenario } from './scenario-helper';
import type { MatchEvent } from './types';

/**
 * Shot lab: shots on target from fixed distances against the keeper alone, launched straight from the ball so
 * only the goalkeeping is measured (no shooter error). Runs only via `npm run lab` (about a minute).
 * Reference (on-target shots, professional football): keepers save ≈ 75–80 % from outside the area, ≈ 60–65 % from
 * 11–16 m, much less from close range.
 */
const enabled = process.env.npm_lifecycle_event === 'lab';
const SHOTS_PER_DISTANCE = Number(process.env.LAB_SHOTS ?? 60);
const DISTANCES = [8, 12, 16, 20, 25];
const SPEED = 26;

it.runIf(enabled)('shot lab', async () => {
  await RAPIER.init();
  const rng = createRng(7);
  const report: Record<string, unknown> = {};
  for (const d of DISTANCES) {
    let goals = 0, saves = 0, other = 0;
    const byZone: Record<string, [number, number]> = { centre: [0, 0], side: [0, 0], corner: [0, 0] };
    for (let i = 0; i < SHOTS_PER_DISTANCE; i++) {
      const e = new MatchEngine({ seed: 1000 + i, halfMinutes: 45 });
      const gk = e.profiles.find(p => p.team === 1 && p.role === 'GK')!.id;
      // Team 1 defends +X in the first half. Shots from a spread of angles within the area's width.
      const angle = rng.range(-0.5, 0.5);
      const ball = { x: PITCH.halfLength - d * Math.cos(angle), y: 0.11, z: d * Math.sin(angle) };
      // Uniform target over the goal mouth, a ball's width inside the frame.
      const tz = rng.range(-PITCH.goalHalfWidth + 0.15, PITCH.goalHalfWidth - 0.15), ty = rng.range(0.15, PITCH.goalHeight - 0.15);
      const dx = PITCH.halfLength - ball.x, dz = tz - ball.z, flat = Math.hypot(dx, dz);
      // Drag slows a struck ball by ≈ 10 % over these distances; the flight time is estimated with that.
      const t = flat / (SPEED * 0.92);
      const vy = (ty - ball.y + 0.5 * BALL_PHYSICS.gravity * t * t) / t;
      const h = Math.sqrt(Math.max(1, SPEED * SPEED - vy * vy));
      stageScenario(e, { [gk]: keeperShape(-1, ball) }, ball, { x: (dx / flat) * h, y: vy, z: (dz / flat) * h });
      const log: MatchEvent[] = [];
      e.onEvent(ev => log.push(ev));
      runFor(e, 3, () => log.some(ev => ev.type === 'goal' || ev.type === 'out'));
      const zone = Math.abs(tz) < 1.2 ? 'centre' : Math.abs(tz) < 2.6 ? 'side' : 'corner';
      byZone[zone][1]++;
      if (log.some(ev => ev.type === 'goal')) goals++;
      else if (log.some(ev => (ev.type === 'touch' || ev.type === 'catch') && ev.player === gk)) { saves++; byZone[zone][0]++; }
      else other++;
    }
    const decided = Math.max(1, goals + saves);
    report[`${d} m`] = {
      saveRate: +(saves / decided).toFixed(2), goals, saves, wideOrShort: other,
      zones: Object.fromEntries(Object.entries(byZone).map(([k, [s, n]]) => [k, `${s}/${n}`])),
    };
  }
  console.log(JSON.stringify(report, null, 1));
  expect(Object.keys(report)).toHaveLength(DISTANCES.length);
}, 3_600_000);
