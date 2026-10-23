// Searches real matches for decisive scenes like the client's reference picture: the home side's number 10 near the
// box with exactly two options, a through ball to number 9 and a shot. Every earlier scene of a seed is decided with
// its first option (as scripts/reference/capture-scene.mjs does), so a found scene is reached the same way in the app.
// Usage: node scripts/reference/find-scene.mjs [--seeds 1-40] [--half 5] [--parallel 6] [--all]
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const [from, to] = arg('seeds', '1-24').split('-').map(Number);
const half = arg('half', '5');
const parallel = Number(arg('parallel', '6'));
const dir = mkdtempSync(join(tmpdir(), 'scan-'));
const vitest = join('node_modules', 'vitest', 'vitest.mjs');
const queue = Array.from({ length: (to ?? from) - from + 1 }, (_, i) => from + i);
const all = [];
const run = seed => new Promise((resolve, reject) => {
  const outFile = join(dir, `s${seed}.json`);
  const child = spawn(process.execPath, [vitest, 'run', 'src/session/scene-scan.test.ts'], { env: { ...process.env, SCAN_OUT: outFile, SCAN_SEED: String(seed), SCAN_HALF: half }, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', d => { err += d; });
  child.on('exit', code => code === 0 ? resolve(JSON.parse(readFileSync(outFile, 'utf8'))) : reject(new Error(`seed ${seed}: ${err}`)));
});
await Promise.all(Array.from({ length: parallel }, async () => { while (queue.length) all.push(...await run(queue.shift())); }));
rmSync(dir, { recursive: true, force: true });
const like = s => s.team === 0 && s.number === 10 && s.options.length === 2 && s.options.some(o => o.kind === 'shot') && s.options.some(o => o.receiver === 9);
const close = s => s.team === 0 && s.options.some(o => o.kind === 'shot') && s.kind === 'finish-or-pass';
const show = s => console.log(`seed ${s.seed} scene ${s.index + 1}: ${s.name} (${s.number}) half ${s.half} ${s.clock}s ball ${s.ball.x},${s.ball.z} (attack ${s.sign > 0 ? '+x' : '-x'}, near side ${s.ball.z * s.sign > 0}) — ${s.options.map(o => o.label).join(' | ')}`);
console.log('== like the reference');
all.filter(like).forEach(show);
console.log('== two options, pass along the ground and shot, home side');
all.filter(s => close(s) && !like(s)).forEach(show);
if (process.argv.includes('--all')) { console.log('== all'); all.forEach(show); }
