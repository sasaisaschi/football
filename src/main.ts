import './main.css';
import * as THREE from 'three';
import { MatchApp } from './app';
import { CrowdAudio } from './audio/crowd-audio';
import { DEFAULT_ORCHESTRATOR } from './orchestrator/orchestrator';
import { createPitchView } from './render/pitch-view';
import { createStadiumView } from './render/stadium-view';
import { showPrepScreen, type MatchChoice, type StoredChoice } from './manager/prep-screen';
import { DEFAULT_INSTRUCTION } from './engine/match-config';
import type { TeamInstruction } from './engine/types';
import { MEMORY_STORAGE_KEY, parseMemory, type AgentMemory } from './ai/agent-memory';
import { LANG_STORAGE_KEY, parseLang, setLang } from './i18n';

/**
 * Optional URL parameters for development and verification (documented in PROJECT_REPORT.md):
 *   ?seed=123            reproduce a match
 *   ?half=5              preselect the half length in minutes
 *   ?cooldown=20         simulated seconds between decision moments (default 75)
 *   ?moments=5           decision moments per half at most (default 5)
 *   ?timeout=15          seconds the user has for a decision (default 15)
 *   ?memory=0            players start without (and do not store) memory of earlier matches
 *   ?autostart=1         skip the match preparation (used by the browser check)
 *   ?press=high&line=0.5&risk=0.7   tactics for the autostart (browser check)
 *   ?lang=de             German interface (default English; the start screen remembers the choice)
 *   ?mode=analyst        match intelligence in analyst mode (default fan); ?team=1 coach the away side; ?focus=9 focus player id
 */
const params = new URLSearchParams(location.search);
const storedLang = (() => { try { return localStorage.getItem(LANG_STORAGE_KEY); } catch { return null; } })();
setLang(parseLang(params.get('lang') ?? storedLang));
document.documentElement.lang = params.get('lang') ?? storedLang ?? 'en';
const num = (key: string, fallback: number) => (params.has(key) && Number.isFinite(Number(params.get(key))) ? Number(params.get(key)) : fallback);

const host = document.querySelector<HTMLDivElement>('#app');
if (!host) throw new Error('#app element missing in index.html');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
host.append(renderer.domElement);
const overlay = document.createElement('div');
overlay.className = 'overlay';
host.append(overlay);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#050a14');
scene.fog = new THREE.Fog('#050a14', 160, 360);
scene.add(new THREE.HemisphereLight(0xc9d8ff, 0x1a3020, 0.85));
// Key light standing in for the floodlight banks; it casts the player and ball shadows.
const key = new THREE.DirectionalLight(0xffffff, 2.6);
key.position.set(-40, 80, 50);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -70, right: 70, top: 50, bottom: -50, near: 10, far: 220 });
key.shadow.bias = -0.0004;
scene.add(key);
// A second floodlight bank from the opposite corner, without shadows: it lifts the figures off the turf (rim light).
const rim = new THREE.DirectionalLight(0xbfd4ff, 0.9);
rim.position.set(55, 60, -60);
scene.add(rim);
scene.add(createPitchView());
const stadium = createStadiumView();
scene.add(stadium.group);

const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 900);
camera.position.set(-70, 45, 90);
camera.lookAt(0, 0, 0);
const resize = () => {
  const w = host.clientWidth, h = host.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
};
new ResizeObserver(resize).observe(host);
resize();

const audio = new CrowdAudio();
let app: MatchApp | null = null;
let starting = false;
let last = performance.now();

function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (app) app.frame(dt);
  // The 3D picture exists only in a decisive scene; the manager screens need no rendering at all.
  const draw = app?.rendering ?? false;
  renderer.domElement.style.visibility = draw ? 'visible' : 'hidden';
  if (draw) renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

/** The players' memory from earlier matches in this browser (none in the browser check, which must be reproducible). */
function loadMemory(): AgentMemory | null {
  if (params.get('memory') === '0') return null;
  return parseMemory(localStorage.getItem(MEMORY_STORAGE_KEY), 7);
}

/** The viewer's remembered choices (club, intelligence mode, focus player); the URL overrides them (browser check). */
const PREFS_STORAGE_KEY = 'the12thman.prefs';
function storedChoice(): StoredChoice {
  let saved: Partial<StoredChoice> = {};
  try { saved = JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY) ?? '{}') as Partial<StoredChoice>; } catch { saved = {}; }
  const team = params.get('team') ?? String(saved.userTeam ?? 0);
  const focus = params.get('focus') ?? (saved.focusPlayer === null || saved.focusPlayer === undefined ? '' : String(saved.focusPlayer));
  const ins = { ...DEFAULT_INSTRUCTION, ...(saved.instruction ?? {}) } as TeamInstruction;
  const press = params.get('press');
  if (press === 'high' || press === 'mid' || press === 'low') ins.press = press;
  if (params.has('line')) ins.lineHeight = Math.max(-1, Math.min(1, num('line', 0)));
  if (params.has('risk')) ins.risk = Math.max(0, Math.min(1, num('risk', 0.5)));
  return {
    userTeam: team === '1' ? 1 : 0,
    mode: (params.get('mode') ?? saved.mode) === 'analyst' ? 'analyst' : 'fan',
    focusPlayer: focus === '' || !Number.isFinite(Number(focus)) ? null : Number(focus),
    instruction: ins,
  };
}
function storeChoice(c: StoredChoice): void {
  try { localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ userTeam: c.userTeam, mode: c.mode, focusPlayer: c.focusPlayer, instruction: c.instruction })); } catch { /* private window: the choice holds for this visit */ }
}

async function startMatch(choice: MatchChoice): Promise<void> {
  if (starting) return;
  starting = true;
  audio.start();
  const { halfMinutes } = choice;
  app = await MatchApp.create(scene, camera, stadium, overlay, audio, {
    seed: num('seed', Math.floor(Math.random() * 1e9)),
    halfMinutes,
    // The app's spacing was set for 2 × 45 minutes; shorter halves get proportionally shorter spacing (at least 20 s).
    cooldown: num('cooldown', Math.max(20, Math.round((DEFAULT_ORCHESTRATOR.cooldown * halfMinutes) / 45))),
    maxPerHalf: num('moments', DEFAULT_ORCHESTRATOR.maxPerHalf),
    timeoutSeconds: num('timeout', DEFAULT_ORCHESTRATOR.timeoutSeconds),
    userTeam: choice.userTeam,
    instruction: choice.instruction,
    lineup: choice.lineup,
    prefs: { mode: choice.mode, favouriteTeam: choice.userTeam, focusPlayer: choice.focusPlayer },
    savePrefs: p => storeChoice({ userTeam: choice.userTeam, mode: p.mode, focusPlayer: p.focusPlayer, instruction: choice.instruction }),
    memory: loadMemory(),
    saveMemory: m => { if (params.get('memory') !== '0') localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(m)); },
  });
  // Read-only handle for the browser check script.
  (window as unknown as { __match?: MatchApp }).__match = app;
}

window.addEventListener('keydown', ev => {
  if (ev.key === 'm' || ev.key === 'M') { if (audio.enabled) audio.stop(); else audio.start(); }
});

requestAnimationFrame(loop);
const half = num('half', 15);
if (params.get('autostart') === '1') void startMatch({ halfMinutes: half, resetMemory: false, lineup: [], ...storedChoice() });
else showPrepScreen(overlay, half, loadMemory()?.matches ?? 0, storedChoice(), choice => {
  if (choice.resetMemory) localStorage.removeItem(MEMORY_STORAGE_KEY);
  storeChoice(choice);
  void startMatch(choice);
});
