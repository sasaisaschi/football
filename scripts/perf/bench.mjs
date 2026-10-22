// Simulation benchmark without profiler: bundles profile-entry.ts and runs it in fresh processes, one per seed, and
// reports ms per tick per seed and the mean. Several seeds, because a single stretch of one match depends on what
// happens in it (rolling ball: four physics substeps). Usage: node scripts/perf/bench.mjs [seconds=120] [seeds=1,2,3,4]
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const out = join(root, 'perf-output');
mkdirSync(out, { recursive: true });
const bundle = join(out, 'bench-entry.mjs');
execFileSync(process.execPath, [join(root, 'node_modules/rolldown/bin/cli.mjs'), join(root, 'scripts/perf/profile-entry.ts'), '--format', 'esm', '--platform', 'node', '--file', bundle], { stdio: 'ignore' });
const seeds = (process.argv[3] ?? '1,2,3,4').split(',').map(Number);
const results = [];
for (const seed of seeds) {
  const r = spawnSync(process.execPath, [bundle], { env: { ...process.env, PROFILE_SECONDS: process.argv[2] ?? '120', PROFILE_SEED: String(seed) }, encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  results.push(JSON.parse(r.stdout.trim().split('\n').pop()).msPerTick);
}
console.log(JSON.stringify({ seeds, msPerTick: results, mean: +(results.reduce((a, b) => a + b, 0) / results.length).toFixed(3) }));
