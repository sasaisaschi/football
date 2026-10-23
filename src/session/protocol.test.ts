import RAPIER from '@dimforge/rapier3d-simd-compat';
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { DEFAULT_ORCHESTRATOR } from '../orchestrator/orchestrator';
import { SimRunner } from '../sim/runner';

/**
 * Reference match protocol in Node (run through scripts/protocol.mjs): the same seed and settings as the app, every
 * moment decided by the same rule as the browser check (the second option where there is one, CHECK_POLICY=second).
 * The browser's protocol.json must be identical: the presentation (manager view, scenes) cannot change the match.
 */
const out = process.env.PROTOCOL_OUT;
describe.skipIf(!out)('reference protocol', () => {
  it('plays the match with the fixed decisions', async () => {
    await RAPIER.init();
    const half = Number(process.env.PROTOCOL_HALF ?? 5);
    const policy = process.env.PROTOCOL_POLICY ?? 'second';
    const r = new SimRunner({
      seed: Number(process.env.PROTOCOL_SEED ?? 7), halfMinutes: half, userTeam: 0,
      cooldown: Math.max(20, Math.round((DEFAULT_ORCHESTRATOR.cooldown * half) / 45)), maxPerHalf: DEFAULT_ORCHESTRATOR.maxPerHalf, timeoutSeconds: DEFAULT_ORCHESTRATOR.timeoutSeconds,
      ...(process.env.PROTOCOL_INSTRUCTION ? { instruction: JSON.parse(process.env.PROTOCOL_INSTRUCTION) } : {}),
      ...(process.env.PROTOCOL_LINEUP ? { lineup: JSON.parse(process.env.PROTOCOL_LINEUP) } : {}),
    });
    const choose = Object.fromEntries((process.env.PROTOCOL_CHOOSE ?? '').split(',').filter(Boolean).map(x => x.split(':')));
    const protocol: string[] = [], moments: string[] = [];
    for (;;) {
      const b = r.advance(600);
      for (const e of b.events) protocol.push(`${e.tick}:${e.type}${e.type === 'decision' ? `:${e.optionId}` : ''}`);
      if (b.moment) {
        moments.push(b.moment.kind);
        const fixed = choose[b.moment.kind];
        const o = fixed ? b.moment.options[Number(fixed) - 1] : policy === 'first' || b.moment.options.length < 2 ? b.moment.options[0] : b.moment.options[1];
        r.resolve(o.id, 'user');
      }
      if (b.done) break;
    }
    writeFileSync(out!, JSON.stringify({ protocol, moments }));
  }, 900000);
});
