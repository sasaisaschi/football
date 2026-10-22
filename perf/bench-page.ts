// Development tool (not part of the app): the simulation alone in the browser, in a worker, without any rendering,
// to tell the browser's own cost per tick from the competition with the 3D picture. Open /perf/?seconds=120&seed=1.
import type { FromWorker } from '../src/sim/sim-worker';

const params = new URLSearchParams(location.search);
const seconds = Number(params.get('seconds') ?? 120);
const worker = new Worker(new URL('../src/sim/sim-worker.ts', import.meta.url), { type: 'module' });
let ticks = 0, cpu = 0;
const started = performance.now();
const out = document.getElementById('out')!;
worker.onmessage = (ev: MessageEvent<FromWorker>) => {
  const m = ev.data;
  if (m.type === 'error') { out.textContent = m.message; return; }
  const b = m.batch;
  ticks += b.count;
  cpu += b.cpuMs;
  if (b.moment) worker.postMessage({ type: 'resolve', optionId: b.moment.defaultOptionId, by: 'timeout' });
  // Let the worker run on: tell it the picture is right behind it.
  worker.postMessage({ type: 'display', tick: b.firstTick + b.count });
  if (ticks >= seconds * 60 && !(window as unknown as { __perf?: unknown }).__perf) {
    const result = { ticks, cpuMsPerTick: +(cpu / ticks).toFixed(3), wallMsPerTick: +((performance.now() - started) / ticks).toFixed(3) };
    (window as unknown as { __perf?: unknown }).__perf = result;
    out.textContent = JSON.stringify(result);
    worker.terminate();
  }
};
worker.postMessage({ type: 'start', config: { seed: Number(params.get('seed') ?? 1), halfMinutes: 45, userTeam: 0, cooldown: 75, maxPerHalf: 5, timeoutSeconds: 15 } });
