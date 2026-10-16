// Browser check for THE 12TH MAN: starts the Vite dev server, opens the app in a locally installed
// Chrome or Edge (headless, GPU via ANGLE) through the DevTools protocol and verifies real behaviour:
// no console errors, the match clock runs, frames render, a decision moment appears, a click on an option
// is executed and followed up. Screenshots and a JSON report go to browser-check-output/.
// Usage: npm run test:browser   (optional env: CHROME_PATH, CHECK_SECONDS, CHECK_SOFTWARE_GL=1)
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'browser-check-output');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const port = 5390 + Math.floor(Math.random() * 50);
const debugPort = 9400 + Math.floor(Math.random() * 50);
const maxSeconds = Number(process.env.CHECK_SECONDS ?? 240);

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const browserPath = candidates.find(p => existsSync(p));
if (!browserPath) {
  console.error('No Chrome/Edge found. Set CHROME_PATH to a Chromium-based browser.');
  process.exit(2);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = { browser: browserPath, port, checks: {}, errors: [], warnings: [], notes: [] };
const fail = msg => { report.errors.push(msg); };

const vite = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'], { cwd: root, stdio: 'pipe' });
let viteReady = false;
vite.stdout.on('data', d => { if (String(d).includes('Local')) viteReady = true; });
for (let i = 0; i < 100 && !viteReady; i++) await sleep(200);
if (!viteReady) { console.error('Vite dev server did not start'); vite.kill(); process.exit(2); }

const gl = process.env.CHECK_SOFTWARE_GL ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'];
const browser = spawn(browserPath, ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(out, 'profile')}`, '--window-size=1600,900', '--autoplay-policy=no-user-gesture-required', ...gl, 'about:blank'], { stdio: 'ignore' });

let targets = null;
for (let i = 0; i < 60 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json(); } catch { await sleep(250); } }
const page = targets?.find(t => t.type === 'page');
if (!page) { console.error('Browser did not expose a page target'); browser.kill(); vite.kill(); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
    const text = m.params.args.map(a => a.value ?? a.description).join(' ');
    (m.params.type === 'error' ? report.errors : report.warnings).push(`console: ${text}`);
  }
  if (m.method === 'Runtime.exceptionThrown') report.errors.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r.result) writeFileSync(join(out, `${name}.png`), Buffer.from(r.result.data, 'base64')); };

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: `http://localhost:${port}/?seed=7&half=5&cooldown=12` });
  const waitFor = async (expr, seconds) => { for (let i = 0; i < seconds * 4; i++) { const v = await evaluate(expr); if (v) return v; await sleep(250); } return null; };
  report.checks.renderer = await evaluate("(()=>{const g=document.createElement('canvas').getContext('webgl2');const d=g&&g.getExtension('WEBGL_debug_renderer_info');return d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):'unknown'})()");
  const startVisible = await waitFor("!!document.querySelector('.start-go')", 30);
  report.checks.startScreen = !!startVisible;
  if (!startVisible) throw new Error('start screen not shown');
  await sleep(1500);
  await shot('01-start-screen');
  await evaluate("document.querySelector('.start-go').click()");
  await waitFor('!!window.__match', 30);
  await sleep(3000);
  await shot('02-kickoff');
  // Clock check outside decisions (the match is frozen while a decision is open).
  const clockSample = async () => { await waitFor("document.querySelector('.decision')?.hidden !== false", 30); return evaluate("[window.__match.engine.time, document.querySelector('[data-clock]')?.textContent]"); };
  const [t0, c0] = await clockSample();
  await sleep(4000);
  const [t1, c1] = await clockSample();
  report.checks.clockRuns = { before: c0, after: c1, simSeconds: +(t1 - t0).toFixed(1) };
  if (!(t1 > t0)) fail(`match clock does not advance (${c0} -> ${c1})`);
  report.checks.fps = await evaluate("new Promise(r=>{let n=0;const t0=performance.now();const f=()=>{n++;if(performance.now()-t0<3000)requestAnimationFrame(f);else r(+(n/3).toFixed(1))};requestAnimationFrame(f)})");
  await shot('03-match-tv-camera');

  // Wait for a real decision moment produced by the director, then act on it immediately.
  const moment = await waitFor("(()=>{const p=document.querySelector('.decision');if(!p||p.hidden)return null;return {title:p.querySelector('[data-title]').textContent,options:[...p.querySelectorAll('.decision-option .decision-label')].map(e=>e.textContent)}})()", maxSeconds);
  report.checks.moment = moment;
  if (!moment) report.notes.push(`no decision moment within ${maxSeconds}s (moments are rare by design)`);
  else {
    const tickA = await evaluate('window.__match.engine.tick');
    await sleep(400);
    const tickB = await evaluate('window.__match.engine.tick');
    report.checks.frozenDuringDecision = tickA === tickB;
    if (tickA !== tickB) fail('simulation kept running during the decision');
    await sleep(1200);
    await shot('04-decision-moment');
    await evaluate("document.querySelector('.decision-option').click()");
    await sleep(300);
    const decided = await evaluate("window.__match.engine.events.filter(e=>e.type==='decision').map(e=>e.chosenBy)");
    report.checks.decisionRecorded = decided;
    if (!decided?.includes('user')) fail('click on an option was not recorded as a user decision');
    await sleep(2500);
    await shot('05-after-decision');
    await sleep(6000);
    report.checks.statusAfterDecision = await evaluate("document.querySelector('[data-status]')?.textContent");
    report.checks.userSwings = await evaluate("window.__match.engine.events.filter(e=>e.type==='swing'&&e.source==='user').length");
    report.checks.userInstructions = await evaluate("window.__match.engine.events.filter(e=>e.type==='instruction'&&e.source==='user').length");
    await shot('06-outcome');
  }
  report.checks.ticker = await evaluate("[...document.querySelectorAll('[data-ticker] > div')].map(e=>e.textContent)");
  report.checks.events = await evaluate("(()=>{const c={};for(const e of window.__match.engine.events)c[e.type]=(c[e.type]||0)+1;return c})()");
} catch (err) {
  fail(`check aborted: ${err}`);
} finally {
  report.ok = report.errors.length === 0;
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  ws.close();
  browser.kill();
  vite.kill();
}
process.exit(report.ok ? 0 : 1);
