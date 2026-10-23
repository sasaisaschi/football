// Browser check for THE 12TH MAN as a manager game: serves the app (dev server, or the production build with
// CHECK_PREVIEW=1), opens it in a local Chrome/Edge (headless, GPU via ANGLE) through the DevTools protocol and plays a
// whole session like a user: match preparation → manager view → decisive scenes in 3D (build-up, frozen decision,
// consequence) → back to the manager view → half-time screen with the team talk → … → full time and match report.
// It verifies: no console errors; no 3D picture in the manager view; every moment decided exactly once and recorded as
// the user's; every event handed on exactly once and in order; the panel leaves the scene's participants visible; no
// horizontal page scroll; the frames kept in memory stay bounded. It writes screenshots, a JSON report and the match
// protocol (tick:type of every event, plus the decisions) to the output folder.
// Usage: npm run test:browser   (env: CHROME_PATH, CHECK_PREVIEW=1, CHECK_BASE=/football/, CHECK_VIEWPORT=1600x900,
//        CHECK_SEED=7, CHECK_HALF=5, CHECK_QUERY='lang=de&mode=analyst', CHECK_POLICY=second|first|delegate,
//        CHECK_THINK=1-2 (seconds per decision), CHECK_SECONDS (time limit), CHECK_OUT (folder), CHECK_SHOTS=12)
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = join(root, process.env.CHECK_OUT ?? 'browser-check-output');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const policy = process.env.CHECK_POLICY ?? 'second';
const [thinkMin, thinkMax] = (process.env.CHECK_THINK ?? '1.5-3').split('-').map(Number);
const maxShots = Number(process.env.CHECK_SHOTS ?? 8);
let rngState = (Number(process.env.CHECK_SEED ?? 7) * 2654435761) >>> 0;
const rand = () => { rngState = (rngState + 0x6d2b79f5) >>> 0; let t = rngState; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const port = 5390 + Math.floor(Math.random() * 50);
const debugPort = 9400 + Math.floor(Math.random() * 50);
const maxSeconds = Number(process.env.CHECK_SECONDS ?? 1500);
const [vw, vh] = (process.env.CHECK_VIEWPORT ?? '1600x900').split('x').map(Number);
const browserPath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(p => existsSync(p));
if (!browserPath) { console.error('No Chrome/Edge found. Set CHROME_PATH to a Chromium-based browser.'); process.exit(2); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = { browser: browserPath, viewport: `${vw}x${vh}`, policy, checks: {}, scenes: [], coach: [], errors: [], warnings: [], notes: [] };
const fail = msg => { report.errors.push(msg); };

const base = process.env.CHECK_BASE ?? '/';
const viteArgs = process.env.CHECK_PREVIEW ? ['preview', '--port', String(port), '--strictPort', '--base', base] : ['--port', String(port), '--strictPort'];
const vite = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), ...viteArgs], { cwd: root, stdio: 'pipe' });
let viteReady = false;
vite.stdout.on('data', d => { if (String(d).includes('Local')) viteReady = true; });
for (let i = 0; i < 300 && !viteReady; i++) await sleep(200);
if (!viteReady) { console.error('Vite did not start'); vite.kill(); process.exit(2); }
const gl = process.env.CHECK_SOFTWARE_GL ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'];
const browser = spawn(browserPath, ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(out, 'profile')}`, `--window-size=${vw},${vh}`, '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info', ...gl, 'about:blank'], { stdio: 'ignore' });
let targets = null;
for (let i = 0; i < 160 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json(); } catch { await sleep(250); } }
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
const fps = () => evaluate("new Promise(r=>{let n=0;const t0=performance.now();const f=()=>{n++;if(performance.now()-t0<2000)requestAnimationFrame(f);else r(+(n/2).toFixed(1))};requestAnimationFrame(f)})");
const waitFor = async (expr, seconds) => { for (let i = 0; i < seconds * 4; i++) { const v = await evaluate(expr); if (v) return v; await sleep(250); } return null; };
const D = 'window.__match.debug';
/** The option a policy picks (1-based key); the same rule as the Node reference (scripts/protocol.mjs). */
const keyFor = n => policy === 'delegate' ? '0' : policy === 'first' || n < 2 ? '1' : '2';

/** Participants of the frozen moment projected through the real camera, against the decision panel's box. */
const layoutCheck = () => evaluate(`(()=>{
  const d=${D}, m=d.moment, s=d.snapshot, cam=d.camera; if(!m||!s) return null;
  const V=cam.position.constructor; const r=document.querySelector('.decision').getBoundingClientRect();
  const W=innerWidth, H=innerHeight; const pts=[]; const add=(x,y,z,what)=>{const v=new V(x,y,z).project(cam); pts.push({what,x:(v.x+1)/2*W,y:(1-v.y)/2*H});};
  add(s.ball.position.x,s.ball.position.y,s.ball.position.z,'ball');
  for(const id of m.participants){const p=s.players[id]; if(p.sentOff) continue; add(p.position.x,0,p.position.z,'feet '+id); add(p.position.x,1.9,p.position.z,'head '+id);}
  const inside=p=>p.x>=r.left&&p.x<=r.right&&p.y>=r.top&&p.y<=r.bottom; const off=p=>p.x<0||p.x>W||p.y<0||p.y>H;
  return { covered: pts.filter(inside).map(p=>p.what), offscreen: pts.filter(off).map(p=>p.what), points: pts.length, hScroll: document.documentElement.scrollWidth>innerWidth };
})()`);

const seconds = { manager: 0, scene: 0, decide: 0, coach: 0, interval: 0 };
/** Computing time of the worker and ticks it produced, split by what was on screen (3D scene or manager screens). */
const compute = { manager: { ms: 0, ticks: 0 }, scene: { ms: 0, ticks: 0 } };
let lastCompute = null;
let maxFrames = 0, maxHeapMb = 0, canvasInManager = 0;
try {
  await send('Runtime.enable');
  await send('Page.enable');
  const half = Number(process.env.CHECK_HALF ?? 5), seed = Number(process.env.CHECK_SEED ?? 7);
  const extra = process.env.CHECK_QUERY ? `&${process.env.CHECK_QUERY}` : '';
  await send('Page.navigate', { url: `http://localhost:${port}${base}?seed=${seed}&half=${half}&memory=0${extra}` });
  report.checks.renderer = await evaluate("(()=>{const g=document.createElement('canvas').getContext('webgl2');const d=g&&g.getExtension('WEBGL_debug_renderer_info');return d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):'unknown'})()");
  if (!await waitFor("!!document.querySelector('.prep [data-go]')", 30)) throw new Error('match preparation not shown');
  await sleep(800);
  await shot('01-preparation');
  report.checks.prepHorizontalScroll = await evaluate('document.documentElement.scrollWidth>innerWidth');
  report.checks.prep = await evaluate("({starters:document.querySelectorAll('[data-xi] .mgr-player').length,bench:document.querySelectorAll('[data-bench] .mgr-player').length,press:document.querySelector('[data-press] .selected')?.textContent,line:document.querySelector('[data-line]').value,risk:document.querySelector('[data-risk]').value})");
  if (process.env.CHECK_SWAP) {
    // A real team-sheet change through the UI: the first starter of the given role for the first bench player that fits.
    const [off, on] = process.env.CHECK_SWAP.split(':');
    await evaluate(`[...document.querySelectorAll('[data-xi] .mgr-player')].find(e=>e.querySelector('.mgr-role').textContent==='${off}').click()`);
    await evaluate(`[...document.querySelectorAll('[data-bench] .mgr-player')].find(e=>e.querySelector('.mgr-role').textContent==='${on}').click()`);
    await sleep(300);
    report.checks.swap = await evaluate("[...document.querySelectorAll('.mgr-player.swapped .mgr-name')].map(e=>e.textContent)");
    await shot('02-preparation-swap');
  }
  await evaluate("document.querySelector('.prep [data-go]').click()");
  await waitFor('!!window.__match && window.__match.debug.produced > 0', 60);
  const t0 = Date.now();
  let shots = 0, managerShot = false, scene = null, lastPhase = '', last = Date.now();
  while ((Date.now() - t0) / 1000 < maxSeconds) {
    const st = await evaluate(`(()=>{const d=${D};return {phase:d.phase,finished:d.finished,cpu:d.cpuMs,produced:d.produced,frames:d.keptFrames,canvas:getComputedStyle(document.querySelector('#app > canvas')).visibility,heap:performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):0}})()`);
    const now = Date.now(), dt = (now - last) / 1000;
    last = now;
    if (!st) { await sleep(250); continue; }
    maxFrames = Math.max(maxFrames, st.frames); maxHeapMb = Math.max(maxHeapMb, st.heap);
    if (lastCompute) { const k = ['build-up', 'decide', 'consequence'].includes(st.phase) ? 'scene' : 'manager'; compute[k].ms += st.cpu - lastCompute.cpu; compute[k].ticks += st.produced - lastCompute.produced; }
    lastCompute = { cpu: st.cpu, produced: st.produced };
    if (st.finished) break;
    const phase = st.phase;
    seconds[phase === 'build-up' || phase === 'consequence' ? 'scene' : phase] = (seconds[phase === 'build-up' || phase === 'consequence' ? 'scene' : phase] ?? 0) + dt;
    if (phase === 'manager' && st.canvas !== 'hidden') canvasInManager++;
    if (phase === 'manager' && !managerShot && report.scenes.length > 0 && lastPhase === 'manager') { managerShot = true; await sleep(1500); await shot('03-manager-view'); }
    if (phase === 'build-up' && lastPhase !== 'build-up') {
      const m = await evaluate(`(()=>{const m=window.__match.driver.moment;return m?{id:m.id,kind:m.kind,category:m.category,title:m.title,options:m.options.map(o=>o.label)}:null})()`);
      scene = { ...m, openedAt: Math.round((now - t0) / 1000) };
      report.scenes.push(scene);
      if (shots < maxShots) { await sleep(1800); await shot(`${String(10 + shots)}-${m.kind}-a-build-up`); }
      scene.fps = await fps();
    }
    if (phase === 'decide' && scene && !scene.decided) {
      const producedAtFreeze = await evaluate(`${D}.produced`);
      await sleep(1600); // the camera flies to the decision framing
      scene.frozen = producedAtFreeze === await evaluate(`${D}.produced`);
      if (!scene.frozen) fail(`simulation kept running during scene ${scene.id}`);
      scene.layout = await layoutCheck();
      if (scene.layout?.hScroll) fail(`horizontal scroll at scene ${scene.id}`);
      if (scene.layout?.covered?.length) report.notes.push(`scene ${scene.id} (${scene.kind}): panel covers ${scene.layout.covered.join(', ')}`);
      if (shots < maxShots) await shot(`${String(10 + shots)}-${scene.kind}-b-decide`);
      await sleep((thinkMin + rand() * (thinkMax - thinkMin)) * 1000);
      const key = keyFor(scene.options.length);
      const before = await evaluate(`${D}.events.length`);
      await press(key);
      scene.decided = true;
      scene.key = key;
      scene.decision = null;
      for (let k = 0; k < 40 && scene.decision === null; k++) { await sleep(100); scene.decision = await evaluate(`${D}.events.slice(${before}).find(e=>e.type==='decision')?.chosenBy ?? null`); }
      if (scene.decision !== (key === '0' ? 'delegated' : 'user')) fail(`scene ${scene.id}: decision recorded as ${scene.decision}`);
      if (shots < maxShots) { await sleep(3200); await shot(`${String(10 + shots)}-${scene.kind}-c-consequence`); shots++; }
    }
    if (phase === 'consequence' && scene && !scene.consequence) {
      scene.consequence = await evaluate("[...document.querySelectorAll('.consequence li')].map(e=>e.textContent)");
    }
    if (phase === 'coach' && lastPhase !== 'coach') {
      await sleep(600);
      const c = await evaluate("({title:document.querySelector('.coach-screen.dialog h2')?.textContent,options:[...document.querySelectorAll('.coach-screen.dialog .coach-label')].map(e=>e.textContent)})");
      if (report.coach.length === 0) await shot('30-coach-dialog');
      await press(keyFor(c.options.length) === '0' ? '1' : keyFor(c.options.length));
      report.coach.push(c);
    }
    if (phase === 'interval') {
      const talk = await evaluate("document.querySelectorAll('.coach-screen.interval .coach-option').length");
      if (talk && !report.checks.teamTalk) {
        await sleep(800);
        await shot('40-half-time');
        report.checks.teamTalk = await evaluate("[...document.querySelectorAll('.coach-screen.interval .coach-label')].map(e=>e.textContent)");
        await press(keyFor(talk) === '0' ? '1' : keyFor(talk));
      }
      if (await evaluate("!document.querySelector('.coach-screen.interval [data-continue]')?.disabled")) {
        await evaluate("document.querySelector('.coach-screen.interval [data-continue]').click()");
        report.checks.secondHalfStarted = true;
      }
    }
    lastPhase = phase;
    await sleep(250);
  }
  const done = await waitFor(`${D}.finished`, 5);
  if (!done) fail('the session did not reach full time');
  await sleep(1500);
  await shot('90-result');
  const wall = (Date.now() - t0) / 1000;
  // Invariants: every event handed on once and in order, every moment decided once, the same count in the session flow.
  const inv = await evaluate(`(()=>{const d=${D};const ev=d.events;const ids=ev.map(e=>e.id);
    const ordered=ids.every((x,i)=>i===0||x===ids[i-1]+1);
    const moments=ev.filter(e=>e.type==='moment').map(e=>e.momentId), decisions=ev.filter(e=>e.type==='decision').map(e=>e.momentId);
    return {events:ev.length,dispatched:d.dispatched,ordered,moments:moments.length,decisions:decisions.length,sameOrder:JSON.stringify(moments)===JSON.stringify(decisions),flowDecisions:d.decisions,
      byUser:ev.filter(e=>e.type==='decision'&&e.chosenBy==='user').length,timeouts:ev.filter(e=>e.type==='decision'&&e.chosenBy==='timeout').length}})()`);
  report.checks.invariants = inv;
  if (inv.events !== inv.dispatched) fail(`events produced ${inv.events} but handed on ${inv.dispatched}`);
  if (!inv.ordered) fail('event ids not in order');
  if (!inv.sameOrder || inv.flowDecisions !== inv.moments) fail(`moments ${inv.moments}, decisions ${inv.decisions}, flow ${inv.flowDecisions}`);
  if (canvasInManager > 0) fail(`3D canvas visible in the manager view (${canvasInManager} samples)`);
  report.checks.session = { wallSeconds: Math.round(wall), secondsIn: Object.fromEntries(Object.entries(seconds).map(([k, v]) => [k, Math.round(v)])), metrics: await evaluate(`${D}.metrics`), cpuSeconds: +((await evaluate(`${D}.cpuMs`)) / 1000).toFixed(1), maxKeptFrames: maxFrames, maxHeapMb,
    msPerTick: Object.fromEntries(Object.entries(compute).map(([k, v]) => [k, v.ticks ? +(v.ms / v.ticks).toFixed(2) : null])), ticksComputed: { manager: compute.manager.ticks, scene: compute.scene.ticks } };
  const sceneFps = report.scenes.map(x => x.fps).filter(Boolean);
  report.checks.fpsScenes = { mean: sceneFps.length ? +(sceneFps.reduce((a, b) => a + b, 0) / sceneFps.length).toFixed(1) : null, min: sceneFps.length ? Math.min(...sceneFps) : null, samples: sceneFps };
  report.checks.result = await evaluate("({score:document.querySelector('[data-score]')?.textContent,decisions:document.querySelectorAll('.result-list li').length,recap:document.querySelectorAll('.result-recap li').length,again:!!document.querySelector('[data-again]')})");
  report.checks.intel = await evaluate(`(()=>{const i=${D}.intel;return i?{mode:i.mode,insights:i.insights.length,kinds:[...new Set(i.insights.map(x=>x.kind))],ingested:i.ingested}:null})()`);
  // The match protocol, for comparison with the Node reference (scripts/protocol.mjs) and with other builds.
  const protocol = await evaluate(`${D}.events.map(e=>e.tick+':'+e.type+(e.type==='decision'?':'+e.optionId:''))`);
  writeFileSync(join(out, 'protocol.json'), JSON.stringify(protocol));
  report.checks.protocolEvents = protocol.length;
  if (process.env.CHECK_AGAIN) {
    await evaluate("document.querySelector('[data-again]').click()");
    report.checks.newMatch = !!await waitFor("!!document.querySelector('.prep [data-go]')", 30);
  }
} catch (err) {
  fail(`check aborted: ${err}`);
} finally {
  report.ok = report.errors.length === 0;
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, errors: report.errors, warnings: report.warnings.slice(0, 5), checks: report.checks, scenes: report.scenes.map(s => ({ kind: s.kind, decision: s.decision, covered: s.layout?.covered?.length, offscreen: s.layout?.offscreen?.length })), coach: report.coach.length, notes: report.notes }, null, 2));
  ws.close();
  browser.kill();
  vite.kill();
}
process.exit(report.ok ? 0 : 1);
