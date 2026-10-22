import RAPIER from '@dimforge/rapier3d-simd-compat';
import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MatchEngine } from './match-engine';
import type { MatchSnapshot, PlayerView } from './types';

/**
 * Records real match states for the figure lab (lab/): a sprint, a sharp turn, a shot in mid-swing, a sliding tackle
 * and a header, each with a close camera on the player. The lab draws the same states with any version of the
 * renderer, so pictures before and after a change show exactly the same situation. Runs only with RECORD_SCENES=1.
 */
const enabled = !!process.env.RECORD_SCENES;
type Scene = { name: string; actor: number; snapshot: MatchSnapshot; camera: { position: [number, number, number]; target: [number, number, number] } };

it.runIf(enabled)('record lab scenes', async () => {
  await RAPIER.init();
  const e = new MatchEngine({ seed: 7, halfMinutes: 45 });
  const scenes: Scene[] = [];
  const want = new Set(['sprint', 'turn', 'shot', 'slide', 'header']);
  // From the player's side, a little ahead of him, at eye height of a touchline camera.
  const camOn = (p: PlayerView): Scene['camera'] => {
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
    return { position: [p.position.x + fz * 6 + fx * 1.5, 2.0, p.position.z - fx * 6 + fz * 1.5], target: [p.position.x, 0.9, p.position.z] };
  };
  let lastHeading = new Map<number, number>();
  while (want.size && e.time < 60 * 40) {
    e.step();
    if (e.phase !== 'in-play') continue;
    const s = e.snapshot();
    for (const p of s.players) {
      if (p.sentOff) continue;
      const speed = Math.hypot(p.velocity.x, p.velocity.z);
      const turn = Math.abs(Math.atan2(Math.sin(p.heading - (lastHeading.get(p.id) ?? p.heading)), Math.cos(p.heading - (lastHeading.get(p.id) ?? p.heading)))) * 60;
      const take = (name: string) => { if (want.delete(name)) scenes.push({ name, actor: p.id, snapshot: s, camera: camOn(p) }); };
      if (speed > 7 && p.swingingBoot === -1 && !p.upperBody) take('sprint');
      if (speed > 4 && turn > 2.2) take('turn');
      if (p.swingingBoot !== -1 && e.legs[p.id].swing?.phase === 'strike' && e.legs[p.id].swing!.plan.strikeSpeed > 15) take('shot');
      if (p.lying > 0.8) take('slide');
      if (p.upperBody?.part === 'head' && p.position.y > e.profiles[p.id].heightM / 2 + 0.05) take('header');
    }
    lastHeading = new Map(s.players.map(p => [p.id, p.heading]));
  }
  expect(scenes.length).toBeGreaterThanOrEqual(4);
  writeFileSync('lab/scenes.json', JSON.stringify({ seed: 7, profiles: e.profiles, scenes }));
  console.log(`recorded: ${scenes.map(s => `${s.name}@${s.snapshot.tick}`).join(', ')}`);
}, 600_000);
