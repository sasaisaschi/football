// Multi-seed probe: runs short autonomous matches in parallel and reports the statistics per 90 minutes.
// Usage: npm run probe -- [--seeds 1-6] [--minutes 10] [--parallel 6]
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const [from, to] = arg('seeds', '1-6').split('-').map(Number);
const seeds = Array.from({ length: (to ?? from) - from + 1 }, (_, i) => from + i);
const minutes = Number(arg('minutes', '10'));
const parallel = Number(arg('parallel', String(Math.min(6, seeds.length))));
const dir = mkdtempSync(join(tmpdir(), 'probe-'));
const vitest = join('node_modules', 'vitest', 'vitest.mjs');

function run(seed) {
  const out = join(dir, `seed-${seed}.json`);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [vitest, 'run', 'src/engine/full-match.test.ts'], {
      env: { ...process.env, SIM_SEED: String(seed), SIM_HALF_MINUTES: String(minutes), SIM_OUT: out },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', d => { err += d; });
    child.on('exit', code => {
      if (code !== 0) return reject(new Error(`seed ${seed} failed (exit ${code})\n${err}`));
      resolve(JSON.parse(readFileSync(out, 'utf8')));
    });
  });
}

const started = Date.now();
const results = [];
const queue = [...seeds];
await Promise.all(Array.from({ length: parallel }, async () => {
  while (queue.length) {
    const seed = queue.shift();
    const r = await run(seed);
    results.push(r);
    console.log(`seed ${seed}: ${r.score.join(':')}  changes ${r.possessionChanges}  passes ${r.passes} (${Math.round(r.passCompletion * 100)} %)`);
  }
}));
rmSync(dir, { recursive: true, force: true });

const per90 = 90 / (2 * minutes * results.length);
const sum = f => results.reduce((a, r) => a + f(r), 0);
const p = f => +(sum(f) * per90).toFixed(1);
const losses = Object.keys(results[0].lossesAfter);
const report = {
  seeds: `${from}-${to ?? from}`, minutesPerHalf: minutes,
  goals: p(r => r.score[0] + r.score[1]), ownGoals: p(r => r.ownGoals),
  shots: p(r => r.shots[0] + r.shots[1]), shotsAfterBuildUp: p(r => r.shotsAfterBuildUp),
  passes: p(r => r.passes), passCompletion: +(sum(r => r.passesCompleted) / Math.max(1, sum(r => r.passes))).toFixed(2),
  possessionChanges: p(r => r.possessionChanges), pingPong: p(r => r.pingPong),
  lossesAfter: Object.fromEntries(losses.map(k => [k, p(r => r.lossesAfter[k])])),
  meanSpellSeconds: +(sum(r => r.meanSpell * r.possessionChanges) / Math.max(1, sum(r => r.possessionChanges))).toFixed(1),
  fouls: p(r => r.fouls), penalties: p(r => r.penalties), offsides: p(r => r.offsides),
  corners: p(r => r.corners), throwIns: p(r => r.throwIns), goalKicks: p(r => r.goalKicks), keeperCatches: p(r => r.keeperCatches),
  ballInPlay: +(sum(r => r.ballInPlay) / results.length).toFixed(2),
  msPerStep: +(sum(r => r.msPerStep) / results.length).toFixed(2), wallSeconds: Math.round((Date.now() - started) / 1000),
};
console.log(JSON.stringify(report, null, 1));
