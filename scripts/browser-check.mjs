// Browser check for THE 12TH MAN: starts the Vite dev server, opens the app in a locally installed Chrome or Edge
// (headless, GPU via ANGLE) through the DevTools protocol and verifies real behaviour: no console errors, the match
// runs in the simulation worker, real decision moments of several kinds appear and freeze the simulation, the panel
// leaves the relevant players visible, there is no horizontal page scroll, a choice by key is executed and its
// consequence shown. Screenshots (before the decision, with a focused option, after the consequence) and a JSON report
// go to browser-check-output/.
// Usage: npm run test:browser   (env: CHROME_PATH, CHECK_SECONDS, CHECK_MOMENTS, CHECK_SOFTWARE_GL=1, CHECK_FULL=1,
//        CHECK_VIEWPORT=1600x900, CHECK_SEED=7, CHECK_HALF=5, CHECK_COOLDOWN=25, CHECK_PREVIEW=1, CHECK_QUERY=mode=analyst&focus=9)
//   CHECK_FULL=1 plays a full match (2 × 45 min) and hands every moment to the players after 2 s, to measure the
//   session's wall-clock time, the worker's computing time and the simulated time.
//   CHECK_SESSION=1 plays a whole session like a user (CHECK_HALF minutes per half): every decision after a think time
//   of CHECK_THINK seconds (default 5-10, drawn per moment from CHECK_SEED), mostly a chosen option, sometimes handed
//   to the players. Measures wall-clock, computing and simulated time, time in live / condensed / decision, waits (the
//   picture stands still without a decision), FPS samples, and records every panel and consequence text.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const session = !!process.env.CHECK_SESSION;
const full = !!process.env.CHECK_FULL || session;
const out = join(root, process.env.CHECK_OUT ?? (session ? 'browser-check-session' : full ? 'browser-check-full' : 'browser-check-output'));
const [thinkMin, thinkMax] = (process.env.CHECK_THINK ?? '5-10').split('-').map(Number);
// Reproducible "user": a small seeded generator for think times and choices.
let rngState = (Number(process.env.CHECK_SEED ?? 7) * 2654435761) >>> 0;
const rand = () => { rngState = (rngState + 0x6d2b79f5) >>> 0; let t = rngState; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const port = 5390 + Math.floor(Math.random() * 50);
const debugPort = 9400 + Math.floor(Math.random() * 50);
const maxSeconds = Number(process.env.CHECK_SECONDS ?? (full ? 1500 : 420));
const time = { live: 0, condensed: 0, decision: 0, held: 0, stalled: 0 };
const fpsSamples = { live: [], condensed: [] };
const texts = { consequences: [] };
const wantMoments = Number(process.env.CHECK_MOMENTS ?? 5);
const [vw, vh] = (process.env.CHECK_VIEWPORT ?? '1600x900').split('x').map(Number);

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
const report = { browser: browserPath, viewport: `${vw}x${vh}`, checks: {}, moments: [], errors: [], warnings: [], notes: [] };
const fail = msg => { report.errors.push(msg); };

// CHECK_PREVIEW=1 serves the production build (run `npm run build` first) instead of the dev server.
const viteArgs = process.env.CHECK_PREVIEW ? ['preview', '--port', String(port), '--strictPort'] : ['--port', String(port), '--strictPort'];
const vite = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), ...viteArgs], { cwd: root, stdio: 'pipe' });
let viteReady = false;
vite.stdout.on('data', d => { if (String(d).includes('Local')) viteReady = true; });
for (let i = 0; i < 300 && !viteReady; i++) await sleep(200); // first start may pre-bundle dependencies
if (!viteReady) { console.error('Vite dev server did not start'); vite.kill(); process.exit(2); }

const gl = process.env.CHECK_SOFTWARE_GL ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'];
const browser = spawn(browserPath, ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(out, 'profile')}`, `--window-size=${vw},${vh}`, '--autoplay-policy=no-user-gesture-required', ...gl, 'about:blank'], { stdio: 'ignore' });

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
const press = async key => {
  const code = key.length === 1 ? (/\d/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`) : key;
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: key === 'ArrowDown' ? 40 : key === 'Enter' ? 13 : key.charCodeAt(0) });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
};
const fps = () => evaluate("new Promise(r=>{let n=0;const t0=performance.now();const f=()=>{n++;if(performance.now()-t0<3000)requestAnimationFrame(f);else r(+(n/3).toFixed(1))};requestAnimationFrame(f)})");
const D = 'window.__match.debug';

/** Screen layout check: participants of the open moment projected through the real camera against the panel's box. */
const layoutCheck = () => evaluate(`(()=>{
  const d=${D}, m=d.moment, s=d.snapshot, cam=d.camera; if(!m||!s) return null;
  const V=cam.position.constructor; const r=document.querySelector('.decision').getBoundingClientRect();
  const W=innerWidth, H=innerHeight; const pts=[]; const add=(x,y,z,what)=>{const v=new V(x,y,z).project(cam); pts.push({what,x:(v.x+1)/2*W,y:(1-v.y)/2*H});};
  add(s.ball.position.x,s.ball.position.y,s.ball.position.z,'ball');
  for(const id of m.participants){const p=s.players[id]; if(p.sentOff) continue; add(p.position.x,0,p.position.z,'feet '+id); add(p.position.x,1.9,p.position.z,'head '+id);}
  const inside=p=>p.x>=r.left&&p.x<=r.right&&p.y>=r.top&&p.y<=r.bottom; const off=p=>p.x<0||p.x>W||p.y<0||p.y>H;
  return { covered: pts.filter(inside).map(p=>p.what), offscreen: pts.filter(off).map(p=>p.what), points: pts.length,
    hScroll: document.documentElement.scrollWidth>innerWidth, panel:{left:Math.round(r.left),top:Math.round(r.top),width:Math.round(r.width),height:Math.round(r.height)} };
})()`);

try {
  await send('Runtime.enable');
  await send('Page.enable');
  const half = Number(process.env.CHECK_HALF ?? (full ? 45 : 5));
  const seed = Number(process.env.CHECK_SEED ?? 7);
  // Without an explicit spacing the app scales it with the half length, as for a user.
  const cooldown = process.env.CHECK_COOLDOWN ? `&cooldown=${process.env.CHECK_COOLDOWN}` : full ? '' : '&cooldown=25';
  // A session uses the app's own settings for its length (spacing, moments, countdown), as a user would get them.
  const settings = session ? '' : `${cooldown}&moments=${full ? 5 : 6}&timeout=${full ? 30 : 90}`;
  const memory = process.env.CHECK_MEMORY ? '' : '&memory=0';
  // CHECK_QUERY: extra URL parameters, e.g. 'mode=analyst&focus=9&lang=de'.
  const extra = process.env.CHECK_QUERY ? `&${process.env.CHECK_QUERY}` : '';
  await send('Page.navigate', { url: `http://localhost:${port}/?seed=${seed}&half=${half}${settings}${memory}${extra}` });
  const waitFor = async (expr, seconds) => { for (let i = 0; i < seconds * 4; i++) { const v = await evaluate(expr); if (v) return v; await sleep(250); } return null; };
  report.checks.renderer = await evaluate("(()=>{const g=document.createElement('canvas').getContext('webgl2');const d=g&&g.getExtension('WEBGL_debug_renderer_info');return d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):'unknown'})()");
  const startVisible = await waitFor("!!document.querySelector('.start-go')", 30);
  report.checks.startScreen = !!startVisible;
  if (!startVisible) throw new Error('start screen not shown');
  await sleep(1500);
  await shot('01-start-screen');
  report.checks.startHorizontalScroll = await evaluate('document.documentElement.scrollWidth>innerWidth');
  await evaluate("document.querySelector('.start-go').click()");
  await waitFor('!!window.__match && window.__match.debug.produced > 0', 60);
  const t0 = Date.now();
  await sleep(3500);
  await shot('02-kickoff');
  const sample = () => evaluate(`[${D}.snapshot?.time ?? 0, ${D}.produced, document.querySelector('[data-clock]')?.textContent]`);
  const [s0, p0, c0] = await sample();
  await sleep(4000);
  const [s1, p1, c1] = await sample();
  report.checks.clockRuns = { before: c0, after: c1, shownSimSeconds: +(s1 - s0).toFixed(1), workerTicks: p1 - p0 };
  if (!(s1 > s0)) fail(`match clock does not advance (${c0} -> ${c1})`);
  report.checks.fpsLive = await fps();
  await shot('03-match');

  const kinds = new Set();
  let n = 0;
  while ((Date.now() - t0) / 1000 < maxSeconds) {
    const state = await evaluate(`(()=>{const d=${D};return {deciding:d.deciding,finished:d.finished,mode:d.mode,speed:d.speed}})()`);
    if (state?.finished) break;
    if (state?.mode === 'condensed' && !report.checks.fpsCondensed) { report.checks.fpsCondensed = await fps(); await shot('04-condensed'); }
    if (session && !state?.deciding) {
      // Sample the session: where the wall-clock time goes, whether the picture stands still, FPS now and then.
      const a = await evaluate(`${D}.shownTick`);
      const t1 = Date.now();
      await sleep(400);
      const b = await evaluate(`[${D}.shownTick, ${D}.mode, ${D}.deciding, [...document.querySelectorAll('.consequence li')].map(e=>e.textContent).join(' | ')]`);
      const dt = (Date.now() - t1) / 1000;
      if (b[2]) continue;
      if (b[0] === a && b[1] !== 'held') time.stalled += dt; else time[b[1]] += dt;
      if (b[3] && texts.consequences.at(-1) !== b[3]) texts.consequences.push(b[3]);
      if (rand() < 0.03) { const f = await fps(); if (state.mode === 'live' || state.mode === 'condensed') fpsSamples[state.mode].push(f); }
      continue;
    }
    if (!state?.deciding) { await sleep(400); continue; }
    n++;
    const m = await evaluate(`(()=>{const m=${D}.moment;return {kind:m.kind,category:m.category,title:m.title,options:m.options.map(o=>o.label),default:m.defaultOptionId}})()`);
    const entry = { n, ...m };
    if (full) {
      if (session) {
        entry.panel = await evaluate("document.querySelector('.decision')?.innerText");
        const think = thinkMin + rand() * (thinkMax - thinkMin);
        const opened = Date.now();
        if (n <= 6) { await sleep(1400); await shot(`${String(10 + n)}-${m.kind}-a-before`); }
        await sleep(Math.max(0, think * 1000 - (Date.now() - opened)));
        const delegate = rand() < 0.2;
        const key = delegate ? '0' : String(1 + Math.floor(rand() * m.options.length));
        const before = await evaluate(`${D}.events.length`);
        await press(key);
        entry.thinkSeconds = +((Date.now() - opened) / 1000).toFixed(1);
        entry.chosen = delegate ? 'delegated' : m.options[Number(key) - 1];
        await sleep(300);
        entry.decision = await evaluate(`${D}.events.slice(${before}).find(e=>e.type==='decision')?.chosenBy ?? null`);
        if (entry.decision !== (delegate ? 'delegated' : 'user')) fail(`moment ${n}: decision recorded as ${entry.decision}`);
        time.decision += (Date.now() - opened) / 1000;
        if (n <= 6) { await sleep(3500); await shot(`${String(10 + n)}-${m.kind}-c-after`); }
        report.moments.push(entry);
        continue;
      }
      await sleep(2000);
      await press('0');
      entry.chosen = 'delegated';
      report.moments.push(entry);
      continue;
    }
    const produced = await evaluate(`${D}.produced`);
    await sleep(1400); // the camera flies to the decision framing
    entry.frozen = produced === await evaluate(`${D}.produced`);
    if (!entry.frozen) fail(`simulation kept running during moment ${n}`);
    entry.layout = await layoutCheck();
    if (entry.layout?.hScroll) fail(`horizontal page scroll during moment ${n}`);
    if (entry.layout?.covered?.length) report.notes.push(`moment ${n} (${m.kind}): panel covers ${entry.layout.covered.join(', ')}`);
    const tag = `${String(10 + n)}-${m.kind}`;
    await shot(`${tag}-a-before`);
    await press('ArrowDown');
    await sleep(500);
    entry.focused = await evaluate("document.querySelector('.decision-option.focused .decision-label')?.textContent");
    await shot(`${tag}-b-focus`);
    const key = m.options.length > 1 ? '2' : '1';
    const before = await evaluate(`${D}.events.length`);
    await press(key);
    await sleep(600);
    entry.decision = await evaluate(`${D}.events.slice(${before}).find(e=>e.type==='decision')?.chosenBy ?? null`);
    if (entry.decision !== 'user') fail(`key ${key} at moment ${n} was not recorded as a user decision (${entry.decision})`);
    entry.chosen = m.options[Number(key) - 1];
    await sleep(3500);
    await shot(`${tag}-c-after`);
    await sleep(5000);
    entry.consequence = await evaluate("[...document.querySelectorAll('.consequence li')].map(e=>e.textContent)");
    entry.userActions = await evaluate(`${D}.events.slice(${before}).filter(e=>(e.type==='swing'&&e.source==='user')||(e.type==='instruction'&&e.source==='user')).length`);
    if (n === 1) {
      // A close-up of the figures in play (the broadcast director's close shot), for the figure quality record.
      await evaluate(`${D}.director.manual='close'`);
      await sleep(1800);
      await shot('05-figures-close');
      await evaluate(`${D}.director.manual=null`);
    }
    report.moments.push(entry);
    kinds.add(m.kind);
    if (n >= wantMoments && kinds.size >= Math.min(3, wantMoments)) break;
  }
  report.checks.momentKinds = [...kinds];
  if (!full && report.moments.length === 0) fail('no decision moment appeared');
  if (full) {
    const done = await waitFor(`${D}.finished`, Math.max(10, maxSeconds - (Date.now() - t0) / 1000));
    report.checks.fullMatch = { finished: !!done, metrics: await evaluate(`${D}.metrics`), wallSecondsMeasuredByScript: Math.round((Date.now() - t0) / 1000) };
    if (session) {
      const avg = a => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null;
      report.checks.session = { secondsIn: Object.fromEntries(Object.entries(time).map(([k, v]) => [k, Math.round(v)])), fps: { live: avg(fpsSamples.live), condensed: avg(fpsSamples.condensed), samples: fpsSamples }, consequences: texts.consequences, substitutions: await evaluate(`${D}.events.filter(e=>e.type==='substitution').map(e=>({team:e.team,reason:e.reason??'user',minute:Math.floor(e.time/60)}))`) };
    }
    if (!done) fail('the full match did not reach full time in the allotted time');
    await shot('99-result');
  }
  report.checks.events = await evaluate(`(()=>{const c={};for(const e of ${D}.events)c[e.type]=(c[e.type]||0)+1;return c})()`);
  report.checks.workerCpuSeconds = +((await evaluate(`${D}.cpuMs`)) / 1000).toFixed(1);
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
