// Reference match protocols in Node, in parallel: `node scripts/protocol.mjs --seeds 1-8 --half 5 [--policy second]
// [--instruction '{"press":"high","lineHeight":0.5,"risk":0.7}'] [--lineup '[{"off":10,"on":25}]'] [--out dir]`.
// Writes <out>/seed-N.json ({ protocol, moments }) and prints the moment kinds per seed. Compare a browser run's
// protocol.json (scripts/browser-check.mjs) with the file of the same seed: they must be identical.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const [from, to] = arg('seeds', '7').split('-').map(Number);
const seeds = Array.from({ length: (to ?? from) - from + 1 }, (_, i) => from + i);
const out = resolve(arg('out', 'protocol-output'));
mkdirSync(out, { recursive: true });
const parallel = Number(arg('parallel', '6'));
const run = seed => new Promise((done, fail) => {
  const env = { ...process.env, PROTOCOL_OUT: join(out, `seed-${seed}.json`), PROTOCOL_SEED: String(seed), PROTOCOL_HALF: arg('half', '5'), PROTOCOL_POLICY: arg('policy', 'second') };
  if (arg('instruction')) env.PROTOCOL_INSTRUCTION = arg('instruction');
  if (arg('lineup')) env.PROTOCOL_LINEUP = arg('lineup');
  const c = spawn(process.execPath, [join('node_modules', 'vitest', 'vitest.mjs'), 'run', 'src/session/protocol.test.ts'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  c.stderr.on('data', d => { err += d; });
  c.on('exit', code => (code === 0 ? done() : fail(new Error(`seed ${seed}: ${err.slice(-400)}`))));
});
const queue = [...seeds];
await Promise.all(Array.from({ length: parallel }, async () => { while (queue.length) await run(queue.shift()); }));
for (const s of seeds) {
  const r = JSON.parse(readFileSync(join(out, `seed-${s}.json`), 'utf8'));
  console.log(`seed ${s}: ${r.protocol.length} events, moments ${r.moments.join(', ')}`);
}
