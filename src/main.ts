import './main.css';
import * as THREE from 'three';
import { MatchApp } from './app';
import { CrowdAudio } from './audio/crowd-audio';
import { DEFAULT_ORCHESTRATOR } from './orchestrator/orchestrator';
import { createPitchView } from './render/pitch-view';
import { createStadiumView } from './render/stadium-view';
import { showStartScreen } from './ui/start-screen';
import { MEMORY_STORAGE_KEY, parseMemory, type AgentMemory } from './ai/agent-memory';

/**
 * Optional URL parameters for development and verification (documented in PROJECT_REPORT.md):
 *   ?seed=123            reproduce a match
 *   ?half=5              preselect the half length in minutes
 *   ?cooldown=20         simulated seconds between decision moments (default 75)
 *   ?moments=5           decision moments per half at most (default 5)
 *   ?timeout=15          seconds the user has for a decision (default 15)
 *   ?condense=0          show everything live instead of condensing quiet play
 *   ?memory=0            players start without (and do not store) memory of earlier matches
 *   ?autostart=1         skip the start screen (used by the browser check)
 */
const params = new URLSearchParams(location.search);
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
let orbit = 0;
let frameCount = 0;

function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  frameCount++;
  const relaxed = app?.relaxedRendering() ?? false;
  const draw = !relaxed || frameCount % 2 === 0;
  if (app) app.frame(dt, draw);
  else {
    // Establishing shot of the bowl behind the start screen, from inside the stadium under the roofs.
    orbit += dt * 0.04;
    camera.position.set(Math.cos(orbit) * 62, 19, Math.sin(orbit) * 44);
    camera.lookAt(Math.cos(orbit) * -8, 0, Math.sin(orbit) * -6);
    stadium.update(now / 1000, 0.15, 0);
  }
  // While condensed play waits for the simulation, the picture runs at half rate and shadows are redrawn every third
  // frame: the worker shares the machine's power budget with the 3D picture (measured: 1.64 ms per tick without
  // rendering, 2.31 ms with it, §10.10). Live play and decisions keep the full rate.
  renderer.shadowMap.autoUpdate = !relaxed;
  if (relaxed && frameCount % 6 === 0) renderer.shadowMap.needsUpdate = true;
  if (draw) renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

/** The players' memory from earlier matches in this browser (none in the browser check, which must be reproducible). */
function loadMemory(): AgentMemory | null {
  if (params.get('memory') === '0') return null;
  return parseMemory(localStorage.getItem(MEMORY_STORAGE_KEY), 7);
}

async function startMatch(halfMinutes: number, condense: boolean): Promise<void> {
  if (starting) return;
  starting = true;
  audio.start();
  app = await MatchApp.create(scene, camera, stadium, overlay, audio, {
    seed: num('seed', Math.floor(Math.random() * 1e9)),
    halfMinutes,
    // The app's spacing was set for 2 × 45 minutes; shorter halves get proportionally shorter spacing (at least 20 s).
    cooldown: num('cooldown', Math.max(20, Math.round((DEFAULT_ORCHESTRATOR.cooldown * halfMinutes) / 45))),
    maxPerHalf: num('moments', DEFAULT_ORCHESTRATOR.maxPerHalf),
    timeoutSeconds: num('timeout', DEFAULT_ORCHESTRATOR.timeoutSeconds),
    userTeam: 0,
    condense,
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
if (params.get('autostart') === '1') void startMatch(half, params.get('condense') !== '0');
else showStartScreen(overlay, half, loadMemory()?.matches ?? 0, choice => {
  if (choice.resetMemory) localStorage.removeItem(MEMORY_STORAGE_KEY);
  void startMatch(choice.halfMinutes, choice.condense);
});
