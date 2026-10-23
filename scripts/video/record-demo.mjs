// Records a real demo session of the production build (run `npm run build` first) with Chrome's screencast: every
// frame with its timestamp, plus markers for the moments the edit uses (start screen, kick-off, each decision, analyst
// mode, the first goal story, full time). Output: video-output/frames/*.jpg, video-output/markers.json.
// Usage: node scripts/video/record-demo.mjs [--seed 11] [--half 5] [--focus 9]   (env CHROME_PATH)
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const root = resolve(import.meta.dirname, '..', '..');
const out = join(root, 'video-output');
const framesDir = join(out, 'frames');
rmSync(out, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });
const seed = arg('seed', '11'), half = arg('half', '5'), focus = arg('focus', '9');
const port = 5450 + Math.floor(Math.random() * 40), debugPort = 9460 + Math.floor(Math.random() * 40);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browserPath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].filter(Boolean).find(p => existsSync(p));
if (!browserPath) { console.error('No Chrome/Edge found (CHROME_PATH).'); process.exit(2); }

const vite = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'pipe' });
let ready = false;
vite.stdout.on('data', d => { if (String(d).includes('Local')) ready = true; });
for (let i = 0; i < 150 && !ready; i++) await sleep(200);
if (!ready) { console.error('vite preview did not start'); vite.kill(); process.exit(2); }
const browser = spawn(browserPath, ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(out, 'profile')}`, '--window-size=1600,900', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
let targets = null;
for (let i = 0; i < 60 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json(); } catch { await sleep(250); } }
const page = targets?.find(t => t.type === 'page');
if (!page) { console.error('no page target'); browser.kill(); vite.kill(); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
const frames = [];
const errors = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Page.screencastFrame') {
    const n = frames.length;
    const file = `${String(n).padStart(6, '0')}.jpg`;
    writeFileSync(join(framesDir, file), Buffer.from(m.params.data, 'base64'));
    frames.push({ file, t: m.params.metadata.timestamp });
    ws.send(JSON.stringify({ id: ++id, method: 'Page.screencastFrameAck', params: { sessionId: m.params.sessionId } }));
  }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
const press = async key => {
  const code = /\d/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`;
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
};
const markers = [];
const mark = name => { markers.push({ name, t: Date.now() / 1000 }); console.log(`${new Date().toISOString().slice(11, 19)} ${name}`); };
const D = 'window.__match.debug';

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: `http://localhost:${port}/?seed=${seed}&half=${half}&memory=0&lang=en` });
  for (let i = 0; i < 120 && !(await evaluate("!!document.querySelector('.start-go')")); i++) await sleep(250);
  await send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1600, maxHeight: 900, everyNthFrame: 1 });
  await sleep(1500);
  mark('start');
  // The viewer's choices, made on the start screen as a user would.
  await evaluate("document.querySelector('[data-mode] button')?.click()");
  await sleep(1200);
  await evaluate(`(()=>{const s=document.querySelector('[data-focus]');s.value='${focus}';s.dispatchEvent(new Event('change'))})()`);
  await sleep(1200);
  await evaluate(`[...document.querySelectorAll('[data-length] button')].find(b=>b.textContent.includes('${half} min'))?.click()`);
  await sleep(2000);
  mark('kickoff');
  await evaluate("document.querySelector('.start-go').click()");
  let decisions = 0, opened = -1, goal = false;
  for (;;) {
    const s = await evaluate(`(()=>{const d=${D};return {deciding:d.deciding,finished:d.finished,moment:d.moment?.id??-1,goal:(d.intel?.insights??[]).some(i=>i.kind==='goal-story')}})()`).catch(() => null);
    if (!s) { await sleep(300); continue; }
    if (s.goal && !goal) { goal = true; mark('insight-goal'); }
    if (s.finished) break;
    if (s.deciding && s.moment !== opened) {
      opened = s.moment;
      decisions++;
      mark(`moment-${decisions}`);
      await sleep(7000); // camera flies in; the viewer reads "why it matters"
      await press('ArrowDown');
      await sleep(900);
      await press(decisions % 2 ? '1' : '2');
      mark(`decision-${decisions}`);
      if (decisions === 2) { await sleep(9000); await press('i'); mark('analyst'); }
    }
    await sleep(250);
  }
  mark('result');
  await sleep(9000);
  await evaluate("document.querySelector('.result-card')?.scrollTo({top:400,behavior:'smooth'})");
  await sleep(4000);
  mark('end');
  await send('Page.stopScreencast');
} catch (err) {
  errors.push(String(err));
} finally {
  writeFileSync(join(out, 'markers.json'), JSON.stringify({ seed, half, focus, markers, frames, errors }, null, 1));
  console.log(`${frames.length} frames, ${markers.length} markers, ${errors.length} errors`);
  ws.close();
  browser.kill();
  vite.kill();
}
