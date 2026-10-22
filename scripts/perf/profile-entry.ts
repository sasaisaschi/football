// Profiling entry (bundled by scripts/perf/profile.mjs): a fixed stretch of an autonomous match through the same runner
// the browser worker uses, so the CPU profile shows where a simulated tick really goes.
import RAPIER from '@dimforge/rapier3d-simd-compat';
import { SimRunner } from '../../src/sim/runner';

const seconds = Number(process.env.PROFILE_SECONDS ?? 120);
await RAPIER.init();
const r = new SimRunner({ seed: Number(process.env.PROFILE_SEED ?? 7), halfMinutes: 45, userTeam: 0, cooldown: 75, maxPerHalf: 5, timeoutSeconds: 15 });
const t0 = performance.now();
let ticks = 0;
while (ticks < seconds * 60) {
  const b = r.advance(30);
  ticks += b.count;
  if (b.moment) r.resolve(b.moment.defaultOptionId, 'timeout');
}
const ms = performance.now() - t0;
console.log(JSON.stringify({ ticks, msPerTick: +(ms / ticks).toFixed(3) }));
