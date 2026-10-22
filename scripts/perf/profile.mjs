// CPU profile of the simulation: bundles profile-entry.ts and runs it with --cpu-prof, then prints the heaviest
// functions by self time. Usage: node scripts/perf/profile.mjs [seconds]   (output: perf-output/)
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const out = join(root, 'perf-output');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const bundle = join(out, 'profile-entry.mjs');
execFileSync(process.execPath, [join(root, 'node_modules/rolldown/bin/cli.mjs'), join(root, 'scripts/perf/profile-entry.ts'), '--format', 'esm', '--platform', 'node', '--file', bundle], { stdio: 'inherit' });
const run = spawnSync(process.execPath, ['--cpu-prof', `--cpu-prof-dir=${out}`, bundle], { env: { ...process.env, PROFILE_SECONDS: process.argv[2] ?? '120' }, encoding: 'utf8' });
process.stdout.write(run.stdout);
if (run.status !== 0) { console.error(run.stderr); process.exit(1); }
const prof = JSON.parse(readFileSync(join(out, readdirSync(out).find(f => f.endsWith('.cpuprofile'))), 'utf8'));
const dt = new Map();
for (let i = 0; i < prof.samples.length; i++) dt.set(prof.samples[i], (dt.get(prof.samples[i]) ?? 0) + (prof.timeDeltas[i] ?? 0));
const self = new Map();
let total = 0;
for (const n of prof.nodes) {
  const t = dt.get(n.id) ?? 0;
  total += t;
  const f = n.callFrame;
  const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + t);
}
const rows = [...self].sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.TOP ?? 40));
for (const [k, t] of rows) console.log(`${((100 * t) / total).toFixed(1).padStart(5)} %  ${k}`);

// Inclusive time of the subsystems: a sample counts for a function if it is anywhere on the stack (once per stack).
const parent = new Map();
for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const byId = new Map(prof.nodes.map(n => [n.id, n]));
const watch = (process.env.WATCH ?? 'step,think,decide,picture,evaluateOptions,interceptTime,believesBallIsMine,offBallCommand,supportSpot,observe,snapshot,encodeFrame,evaluate,handleContacts,checkBall,chooseAction,playBall,aerialIntercept,controlledApproach,steerAround,trySwing,approach,drive,stage,refine,truth,positions,restartReady,keeperThink').split(',');
const incl = new Map(watch.map(w => [w, 0]));
for (const [id, t] of dt) {
  const seen = new Set();
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
    const name = byId.get(cur).callFrame.functionName;
    if (incl.has(name) && !seen.has(name)) { seen.add(name); incl.set(name, incl.get(name) + t); }
  }
}
console.log('\ninclusive:');
for (const [k, t] of [...incl].sort((a, b) => b[1] - a[1])) console.log(`${((100 * t) / total).toFixed(1).padStart(5)} %  ${k}`);
