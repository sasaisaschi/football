import './main.css';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-simd-compat';
import { MatchApp } from './app';
import { CrowdAudio } from './audio/crowd-audio';
import { DEFAULT_ORCHESTRATOR } from './orchestrator/orchestrator';
import { createPitchView } from './render/pitch-view';
import { createStadiumView } from './render/stadium-view';
import { showStartScreen } from './ui/start-screen';

/**
 * Optional URL parameters for development and verification (documented in PROJECT_REPORT.md):
 *   ?seed=123            reproduce a match
 *   ?half=5              preselect the half length in minutes
 *   ?cooldown=20         seconds between decision moments (default 75)
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
renderer.toneMappingExposure = 1.05;
host.append(renderer.domElement);
const overlay = document.createElement('div');
overlay.className = 'overlay';
host.append(overlay);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#050a14');
scene.fog = new THREE.Fog('#050a14', 140, 320);
scene.add(new THREE.HemisphereLight(0xc9d8ff, 0x1a3020, 0.9));
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
let last = performance.now();
let orbit = 0;

function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (app) app.frame(dt);
  else {
    // Establishing shot of the bowl behind the start screen.
    orbit += dt * 0.05;
    camera.position.set(Math.cos(orbit) * 95, 42, Math.sin(orbit) * 75);
    camera.lookAt(0, 0, 0);
    stadium.update(now / 1000, 0.15, 0);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

async function startMatch(halfMinutes: number): Promise<void> {
  audio.start();
  await RAPIER.init();
  app = new MatchApp(scene, camera, stadium, overlay, audio, {
    seed: num('seed', Math.floor(Math.random() * 1e9)),
    halfMinutes,
    directorCooldown: num('cooldown', DEFAULT_ORCHESTRATOR.cooldown),
    userTeam: 0,
  });
  // Read-only handle for the browser check script.
  (window as unknown as { __match?: MatchApp }).__match = app;
}

window.addEventListener('keydown', ev => {
  if (ev.key === 'm' || ev.key === 'M') { if (audio.enabled) audio.stop(); else audio.start(); }
});

requestAnimationFrame(loop);
const half = num('half', 15);
if (params.get('autostart') === '1') void startMatch(half);
else showStartScreen(overlay, half, choice => void startMatch(choice.halfMinutes));
