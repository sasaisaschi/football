import RAPIER from '@dimforge/rapier3d-simd-compat';
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { DEFAULT_ORCHESTRATOR } from '../orchestrator/orchestrator';
import { SimRunner } from '../sim/runner';

/**
 * Lists the decisive scenes of real matches (scripts/reference/find-scene.mjs): the same settings as the app, every
 * scene decided with its first option (as the capture script does before the scene it records). Used to find a real
 * scene that matches the client's reference picture; it runs only with SCAN_OUT.
 */
const out = process.env.SCAN_OUT;
describe.skipIf(!out)('scene scan', () => {
  it('lists the scenes of one seed', async () => {
    await RAPIER.init();
    const half = Number(process.env.SCAN_HALF ?? 5), seed = Number(process.env.SCAN_SEED ?? 1);
    const r = new SimRunner({
      seed, halfMinutes: half, userTeam: 0,
      cooldown: Math.max(20, Math.round((DEFAULT_ORCHESTRATOR.cooldown * half) / 45)), maxPerHalf: DEFAULT_ORCHESTRATOR.maxPerHalf, timeoutSeconds: DEFAULT_ORCHESTRATOR.timeoutSeconds,
    });
    const scenes: unknown[] = [];
    for (let n = 0; ; ) {
      const b = r.advance(600);
      if (b.moment) {
        const m = b.moment, s = r.engine.snapshot(), p = r.engine.profiles[m.focusPlayer];
        scenes.push({
          seed, index: n++, kind: m.kind, team: p.team, number: p.number, name: p.name, half: s.half, clock: Math.round(s.clockSeconds),
          ball: { x: +s.ball.position.x.toFixed(1), z: +s.ball.position.z.toFixed(1) }, sign: r.engine.sign(p.team),
          options: m.options.map(o => ({ label: o.label, kind: o.visual?.ball?.kind ?? null, receiver: o.visual?.ball?.receiver !== undefined ? r.engine.profiles[o.visual.ball.receiver].number : null })),
        });
        r.resolve(m.options[0].id, 'user');
      }
      if (b.done) break;
    }
    writeFileSync(out!, JSON.stringify(scenes));
  }, 900000);
});
