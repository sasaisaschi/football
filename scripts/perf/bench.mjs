// Simulation benchmark without profiler: bundles profile-entry.ts and runs it several times in fresh processes,
// reporting the median ms per tick. Usage: node scripts/perf/bench.mjs [seconds=120] [runs=3]
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const out = join(root, 'perf-output');
mkdirSync(out, { recursive: true });
const bundle = join(out, 'bench-entry.mjs');
execFileSync(process.execPath, [join(root, 'node_modules/rolldown/bin/cli.mjs'), join(root, 'scripts/perf/profile-entry.ts'), '--format', 'esm', '--platform', 'node', '--file', bundle], { stdio: 'ignore' });
const runs = Number(process.argv[3] ?? 3);
const results = [];
for (let i = 0; i < runs; i++) {
  const r = spawnSync(process.execPath, [bundle], { env: { ...process.env, PROFILE_SECONDS: process.argv[2] ?? '120' }, encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  results.push(JSON.parse(r.stdout.trim().split('\n').pop()).msPerTick);
}
results.sort((a, b) => a - b);
console.log(JSON.stringify({ runs: results, median: results[Math.floor(results.length / 2)] }));
