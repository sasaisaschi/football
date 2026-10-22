// Figure lab pictures: draws every recorded scene (lab/scenes.json) with the renderer of the given source tree and
// saves one screenshot per scene. Run it for two trees (before/after a change) to compare identical situations.
// Usage: node scripts/lab/compare.mjs <tree> <outDir> [label]   (tree: a checkout containing lab/ and node_modules)
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [tree, outDir, label = 'shot'] = process.argv.slice(2).map((a, i) => (i < 2 ? resolve(a) : a));
mkdirSync(outDir, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const port = 5500 + Math.floor(Math.random() * 40), debugPort = 9500 + Math.floor(Math.random() * 40);
const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].filter(Boolean).find(p => existsSync(p));
const vite = spawn(process.execPath, [join(tree, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'], { cwd: tree, stdio: 'pipe' });
let ready = false;
vite.stdout.on('data', d => { if (String(d).includes('Local')) ready = true; });
for (let i = 0; i < 300 && !ready; i++) await sleep(200);
const browser = spawn(chrome, ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'lab-'))}`, '--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', 'about:blank'], { stdio: 'ignore' });
let targets = null;
for (let i = 0; i < 60 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json(); } catch { await sleep(250); } }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
const problems = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') problems.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(m.params.args.map(a => a.value ?? a.description).join(' '));
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;
await send('Runtime.enable');
const scenes = JSON.parse(readFileSync(join(tree, 'lab/scenes.json'), 'utf8')).scenes;
const names = [];
for (let i = 0; i < scenes.length; i++) {
  await send('Page.navigate', { url: `http://localhost:${port}/lab/?scene=${i}` });
  let name = null;
  for (let k = 0; k < 120 && !name; k++) { await sleep(250); name = await evaluate('window.__labReady'); }
  await sleep(400);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, `${String(i + 1).padStart(2, '0')}-${name}-${label}.png`), Buffer.from(r.result.data, 'base64'));
  names.push(name);
}
console.log(JSON.stringify({ tree, scenes: names, problems: problems.slice(0, 3) }));
ws.close(); browser.kill(); vite.kill();
process.exit(0);
