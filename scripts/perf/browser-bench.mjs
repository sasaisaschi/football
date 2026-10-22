// The simulation alone in headless Chrome (perf/index.html): ms per tick in the browser's worker without rendering.
// Usage: node scripts/perf/browser-bench.mjs [seconds=120] [seeds=1,2,3,4]
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const port = 5450 + Math.floor(Math.random() * 40), debugPort = 9460 + Math.floor(Math.random() * 40);
const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].filter(Boolean).find(p => existsSync(p));
const vite = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'], { cwd: root, stdio: 'pipe' });
let ready = false;
vite.stdout.on('data', d => { if (String(d).includes('Local')) ready = true; });
for (let i = 0; i < 300 && !ready; i++) await sleep(200);
const browser = spawn(chrome, ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'bench-'))}`, 'about:blank'], { stdio: 'ignore' });
let targets = null;
for (let i = 0; i < 60 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json(); } catch { await sleep(250); } }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;
const results = [];
for (const seed of (process.argv[3] ?? '1,2,3,4').split(',')) {
  await send('Page.navigate', { url: `http://localhost:${port}/perf/?seconds=${process.argv[2] ?? 120}&seed=${seed}` });
  let r = null;
  for (let i = 0; i < 2400 && !r; i++) { await sleep(500); r = await evaluate('window.__perf'); }
  results.push({ seed: Number(seed), ...r });
}
console.log(JSON.stringify({ results, meanCpuMsPerTick: +(results.reduce((a, r) => a + r.cpuMsPerTick, 0) / results.length).toFixed(3) }));
ws.close(); browser.kill(); vite.kill();
process.exit(0);
