// Exports one synthetic match (event log) and its match intelligence (insights, statistics) as JSON.
// Usage: npm run intel -- [--seed 7] [--half 15] [--out intel-output]
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const root = resolve(import.meta.dirname, '..');
const out = resolve(root, arg('out', 'intel-output'));
const r = spawnSync(process.execPath, [join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run', 'src/intel/intel-export.test.ts', '--silent=false'], {
  cwd: root, stdio: 'inherit',
  env: { ...process.env, INTEL_OUT: out, INTEL_SEED: arg('seed', '7'), INTEL_HALF: arg('half', '15') },
});
process.exit(r.status ?? 1);
