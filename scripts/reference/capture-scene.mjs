// Captures one real decisive scene from the running app, for comparison with the client's reference picture: serves
// the app, opens it in a local Chrome/Edge (headless, GPU) at the reference picture's size (1672 × 941), plays the
// session (every earlier scene, coach dialog and team talk decided with its first option, as find-scene.mjs assumes),
// and at the chosen scene takes a screenshot of the frozen decision and records the scene as a video – the build-up
// running, the freeze, the options, and what happens after the chosen option – at real pace.
// Usage: node scripts/reference/capture-scene.mjs --seed 7 --half 5 --scene 2 --choose 1 [--out docs/reference-scene]
//        [--name nachher] [--think 4] [--viewport 1672x941] [--video-width 1280] [--lang de] [--preview]
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const root = resolve(import.meta.dirname, '..', '..');
const seed = Number(arg('seed', '7')), half = Number(arg('half', '5')), target = Number(arg('scene', '1')), key = arg('choose', '1');
const name = arg('name', `seed${seed}-scene${target}`), think = Number(arg('think', '4')), lang = arg('lang', 'de');
const [vw, vh] = arg('viewport', '1672x941').split('x').map(Number);
const videoWidth = Number(arg('video-width', '1280'));
const out = resolve(root, arg('out', 'reference-capture'));
const frames = join(out, `${name}-frames`);
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });
const port = 5440 + Math.floor(Math.random() * 50), debugPort = 9460 + Math.floor(Math.random() * 50);
const browserPath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].filter(Boolean).find(p => existsSync(p));
if (!browserPath) { console.error('No Chrome/Edge found (CHROME_PATH).'); process.exit(2); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const preview = process.argv.includes('--preview');
if (preview) execFileSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: root, stdio: 'ignore' });
const vite = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), ...(preview ? ['preview'] : []), '--port', String(port), '--strictPort'], { cwd: root, stdio: 'pipe' });
let ready = false;
vite.stdout.on('data', d => { if (String(d).includes('Local')) ready = true; });
for (let i = 0; i < 300 && !ready; i++) await sleep(200);
const browser = spawn(browserPath, ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(out, `${name}-profile`)}`, `--window-size=${vw},${vh}`, '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
let targets = null;
for (let i = 0; i < 160 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json(); } catch { await sleep(250); } }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0, recording = null;
const pending = new Map(), errors = [], shotFrames = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  if (m.method === 'Page.screencastFrame') {
    if (recording) { const f = join(frames, `${String(shotFrames.length).padStart(5, '0')}.jpg`); writeFileSync(f, Buffer.from(m.params.data, 'base64')); shotFrames.push({ f, t: m.params.metadata.timestamp }); }
    ws.send(JSON.stringify({ id: ++id, method: 'Page.screencastFrameAck', params: { sessionId: m.params.sessionId } }));
  }
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
const press = async k => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: `Digit${k}`, windowsVirtualKeyCode: k.charCodeAt(0) }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: `Digit${k}` }); };
const screenshot = async file => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, file), Buffer.from(r.result.data, 'base64')); };
const D = 'window.__match.debug';
const result = { seed, half, scene: target, key, viewport: `${vw}x${vh}`, errors };
try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://localhost:${port}/?seed=${seed}&half=${half}&memory=0&autostart=1&lang=${lang}` });
  for (let i = 0; i < 240 && !await evaluate('!!window.__match && window.__match.debug.produced > 0'); i++) await sleep(250);
  let seen = 0, last = '', inTarget = false, talked = false;
  for (let guard = 0; guard < 20000; guard++) {
    const phase = await evaluate(`${D}.phase`);
    if (await evaluate(`${D}.finished`)) break;
    if (phase === 'build-up' && last !== 'build-up') {
      seen++;
      inTarget = seen === target;
      if (inTarget) {
        result.moment = await evaluate(`(()=>{const m=window.__match.driver.moment;return {kind:m.kind,title:m.title,options:m.options.map(o=>o.label)}})()`);
        recording = true;
        await send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: videoWidth, maxHeight: Math.round((videoWidth * vh) / vw), everyNthFrame: 1 });
      }
    }
    if (phase === 'decide' && last !== 'decide') {
      if (inTarget) {
        await sleep(2400); // the camera reaches the decision framing, the live renders are in
        await screenshot(`${name}-decision.png`);
        result.decision = await evaluate(`(()=>{const d=${D};const s=d.snapshot,m=d.moment,c=d.camera;return {clock:document.querySelector('[data-clock]')?.textContent,score:document.querySelector('[data-score]')?.textContent,question:document.querySelector('.decision-question')?.textContent,options:[...document.querySelectorAll('.decision-option .decision-label')].map(e=>e.textContent),camera:{x:+c.position.x.toFixed(1),y:+c.position.y.toFixed(1),z:+c.position.z.toFixed(1),fov:c.fov}}})()`);
        await sleep(Math.max(0, think * 1000 - 2400));
      } else await sleep(300);
      await press(inTarget ? key : '1');
    }
    if (phase === 'coach' && last !== 'coach') { await sleep(500); await press('1'); }
    if (phase === 'interval') {
      if (!talked && await evaluate("document.querySelectorAll('.coach-screen.interval .coach-option').length")) { await sleep(500); await press('1'); talked = true; }
      if (await evaluate("!document.querySelector('.coach-screen.interval [data-continue]')?.disabled")) await evaluate("document.querySelector('.coach-screen.interval [data-continue]').click()");
    }
    if (inTarget && last !== 'manager' && phase === 'manager') {
      await sleep(400);
      await send('Page.stopScreencast');
      recording = null;
      result.consequence = await evaluate("[...document.querySelectorAll('.consequence li')].map(e=>e.textContent)");
      break;
    }
    last = phase;
    await sleep(phase === 'manager' ? 200 : 100);
  }
  if (shotFrames.length) {
    const NL = String.fromCharCode(10);
    const list = shotFrames.map((fr, i) => `file '${fr.f.replaceAll(String.fromCharCode(92), '/')}'${NL}duration ${Math.max(0.001, Math.min(0.5, (shotFrames[i + 1]?.t ?? fr.t + 0.04) - fr.t)).toFixed(3)}`).join(NL);
    writeFileSync(join(frames, 'list.txt'), list);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(frames, 'list.txt'), '-vf', `fps=30,scale=${videoWidth}:-2`, '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', join(out, `${name}.mp4`)]);
    result.video = { frames: shotFrames.length, seconds: +(shotFrames.at(-1).t - shotFrames[0].t).toFixed(1) };
  }
} catch (err) {
  errors.push(String(err));
} finally {
  writeFileSync(join(out, `${name}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  ws.close();
  browser.kill();
  vite.kill();
  rmSync(frames, { recursive: true, force: true });
}
process.exit(errors.length ? 1 : 0);
