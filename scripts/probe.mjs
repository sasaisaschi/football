// Multi-seed probe: runs short autonomous matches in parallel and reports the statistics per 90 minutes.
// Usage: npm run probe -- [--seeds 1-6] [--minutes 10] [--parallel 6] [--orchestrator] [--bench]
//   --bench: both teams' substitutions are made by the computer's coach (bench-manager.ts).
//   --orchestrator: the orchestrator runs with the app's settings and every moment is settled by its default; the report
//   then also lists the moments per kind and half (the decisions change play, so the statistics are not comparable).
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
      env: { ...process.env, SIM_SEED: String(seed), SIM_HALF_MINUTES: String(minutes), SIM_OUT: out, ...(process.argv.includes('--orchestrator') ? { SIM_ORCHESTRATOR: '1' } : {}), ...(process.argv.includes('--bench') ? { SIM_BENCH: '1' } : {}) },
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
  goalsFrom: Object.fromEntries(Object.keys(results[0].goalsFrom).map(k => [k, p(r => r.goalsFrom[k])])),
  shots: p(r => r.shots[0] + r.shots[1]), shotsAfterBuildUp: p(r => r.shotsAfterBuildUp),
  passes: p(r => r.passes), passCompletion: +(sum(r => r.passesCompleted) / Math.max(1, sum(r => r.passes))).toFixed(2),
  possessionChanges: p(r => r.possessionChanges), pingPong: p(r => r.pingPong),
  lossesAfter: Object.fromEntries(losses.map(k => [k, p(r => r.lossesAfter[k])])),
  meanSpellSeconds: +(sum(r => r.meanSpell * r.possessionChanges) / Math.max(1, sum(r => r.possessionChanges))).toFixed(1),
  fouls: p(r => r.fouls), penalties: p(r => r.penalties), offsides: p(r => r.offsides),
  corners: p(r => r.corners), throwIns: p(r => r.throwIns), goalKicks: p(r => r.goalKicks), keeperCatches: p(r => r.keeperCatches),
  goalOrigin: Object.fromEntries(Object.keys(results[0].goalOrigin).map(k => [k, p(r => r.goalOrigin[k])])),
  goalDistance: Object.fromEntries(Object.keys(results[0].goalDistance).map(k => [k, p(r => r.goalDistance[k])])),
  shotOutcome: Object.fromEntries(Object.keys(results[0].shotOutcome).map(k => [k, p(r => r.shotOutcome[k])])),
  turnovers: Object.fromEntries(Object.keys(results[0].turnovers).map(k => [k, { n: p(r => r.turnovers[k].n), conceded: p(r => r.turnovers[k].conceded), rate: +(sum(r => r.turnovers[k].conceded) / Math.max(1, sum(r => r.turnovers[k].n))).toFixed(3) }])),
  throwInsAfter: Object.fromEntries(Object.keys(results[0].throwInsAfter).map(k => [k, p(r => r.throwInsAfter[k])])),
  throwInsBy: { attacking: p(r => r.throwInsBy.attacking), defending: p(r => r.throwInsBy.defending) },
  goalsSd: +Math.sqrt(results.reduce((a, r) => a + ((r.score[0] + r.score[1]) * 90 / (2 * minutes) - sum(x => x.score[0] + x.score[1]) * per90) ** 2, 0) / Math.max(1, results.length - 1)).toFixed(2),
  ballInPlay: +(sum(r => r.ballInPlay) / results.length).toFixed(2),
  msPerStep: +(sum(r => r.msPerStep) / results.length).toFixed(2), wallSeconds: Math.round((Date.now() - started) / 1000),
};
const subs = results.flatMap(r => r.substitutions ?? []);
if (subs.length) report.substitutions = { perMatch: +(subs.length / results.length).toFixed(1), byReason: Object.fromEntries([...new Set(subs.map(s => s.reason))].map(k => [k, subs.filter(s => s.reason === k).length])) };
if (process.argv.includes('--orchestrator')) {
  const all = results.flatMap(r => r.moments);
  const count = key => Object.fromEntries([...new Set(all.map(key))].sort().map(k => [k, all.filter(m => key(m) === k).length]));
  report.moments = { total: all.length, perMatch: +(all.length / results.length).toFixed(1), byKind: count(m => m.kind), byCategory: count(m => m.category), byHalf: count(m => `half ${m.half}`), perSeed: results.map(r => `${r.seed}: ${r.moments.map(m => m.kind).join(', ')}`) };
}
console.log(JSON.stringify(report, null, 1));
