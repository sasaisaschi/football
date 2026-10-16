import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-simd-compat';
import './style.css';
import { createStadium } from './stadium';
import { loadFootballer, updateFootballer } from './player-visuals';
import { createPlayerFigure, poseFigure, PlayerFigure } from './player-figure';
import { createPitchVisuals } from './pitch-visuals';
import { PITCH } from './pitch';
import { BALL } from './ball';
import { Match, MatchEvent } from './match';
import { createContactDiagnostics } from './diagnostics';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App element missing');
app.innerHTML = `
  <header><div><h1>THE 12TH MAN / MATCHDAY</h1><p>LIVE FROM THE ARENA · AUTONOMOUS FOOTBALL</p></div>
  <div class="actions"><button id="attack">HOHES PRESSING</button><button id="defend">TIEF STEHEN</button><button id="camera">TV-KAMERA</button><button id="diagnostics">KONTAKTE</button><button id="sound">STADIONTON AN</button><button id="pause">PAUSE</button><button id="reset">NEUSTART</button></div></header>
  <main id="viewport"><div class="broadcast"><span class="live-pill">● LIVE</span><span class="team-name home">ORANGE CITY</span><span id="score" class="broadcast-score">0 : 0</span><span class="team-name away">BLUE UNITED</span><span id="clock" class="match-clock">00:00</span></div><div class="match-info"><span>EXHIBITION · 11 VS 11</span><span id="speed">BALL 0.0 M/S</span><span id="contacts">TORSCHÜSSE 0 : 0</span></div><div class="goal-flash" id="goal-flash">GOOOAL!</div>
  <div class="events" id="events"><b>MATCH INTELLIGENCE · LIVE</b><div id="feed">Anpfiff folgt …</div></div><div class="status" id="status">Initialisiere Stadion …</div></main>`;

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const status = $<HTMLElement>('#status');
const viewport = $<HTMLElement>('#viewport');
const clockLabel = $<HTMLElement>('#clock');
const speedLabel = $<HTMLElement>('#speed');
const shotLabel = $<HTMLElement>('#contacts');
const scoreLabel = $<HTMLElement>('#score');
const feed = $<HTMLElement>('#feed');
const goalFlash = $<HTMLElement>('#goal-flash');
const pauseButton = $<HTMLButtonElement>('#pause');
const soundButton = $<HTMLButtonElement>('#sound');
const diagnosticsButton = $<HTMLButtonElement>('#diagnostics');

const TEAM_NAME = ['ORANGE', 'BLAU'] as const;
const KIND_LABEL: Record<string, string> = {
  pass: 'Pass', shot: 'Torschuss', dribble: 'Dribbling', clear: 'Befreiungsschlag', control: 'Ballannahme',
  'throw-in': 'Einwurf', corner: 'Eckstoß', 'goal-kick': 'Abstoß', 'free-kick': 'Freistoß', kickoff: 'Anstoß',
};

async function start(): Promise<void> {
  await RAPIER.init();
  const seed = Math.floor(Math.random() * 1e9);
  const match = new Match(seed);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#081322');
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 600);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  viewport.prepend(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x24402b, 2.2));
  const sunlight = new THREE.DirectionalLight(0xffffff, 2.4);
  sunlight.position.set(-30, 90, 40);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(4096, 4096);
  Object.assign(sunlight.shadow.camera, { left: -70, right: 70, top: 50, bottom: -50 });
  scene.add(sunlight);
  const stadium = createStadium(scene);
  createPitchVisuals(scene);

  const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL.radius, 24, 16), new THREE.MeshStandardMaterial({ color: '#f5f5ee', roughness: .5 }));
  ballMesh.castShadow = true;
  scene.add(ballMesh);

  const kits = [{ kit: '#ff913d', shorts: '#171e35' }, { kit: '#52caff', shorts: '#e6e9f2' }];
  const figures: (PlayerFigure & { glb?: Awaited<ReturnType<typeof loadFootballer>> })[] = match.players.map((p, i) => {
    const fig = createPlayerFigure(kits[p.team].kit, kits[p.team].shorts, i % 3 ? '#d7a47b' : '#9b6546', i % 4 ? '#2c2522' : '#21130c', p.number, p.role === 'GK');
    scene.add(fig.root);
    return fig;
  });
  // A rigged GLB replaces the placeholder only after it has loaded completely.
  void Promise.all(match.players.map(async (p, i) => {
    const glb = await loadFootballer(p.team, p.number);
    if (!glb) return;
    figures[i].glb = glb;
    figures[i].root.clear();
    figures[i].root.add(glb.root);
  }));
  const diagnostics = createContactDiagnostics(scene, match);

  // Opening sequence: establishing shot of the bowl, then down to the TV position for kickoff.
  const intro = document.createElement('div');
  intro.className = 'match-intro';
  intro.innerHTML = '<div class="intro-eyebrow">THE 12TH MAN · MATCHDAY</div><div class="intro-title">THIS IS OUR HOME.</div><div class="intro-subtitle">THE STADIUM IS ALIVE · KICKOFF APPROACHING</div><div class="intro-progress"><span></span></div>';
  viewport.append(intro);
  const introSkip = document.createElement('button');
  introSkip.className = 'intro-skip';
  introSkip.textContent = 'ZUM ANPFIFF →';
  intro.append(introSkip);
  const introDuration = 16;
  let introTime = 0, introFinished = false;
  introSkip.addEventListener('click', () => { introTime = introDuration; });
  const startCamera = new THREE.Vector3(-150, 60, 160), tvCamera = new THREE.Vector3(0, 20, 50);
  camera.position.copy(startCamera);
  camera.lookAt(0, 5, 0);

  let paused = false, accumulator = 0, previous = performance.now(), cameraMode = 0, flashUntil = 0;
  let statusText = 'Agenten wählen Aktionen – Fuß und Ball entscheiden über das Ergebnis.';
  const shots: [number, number] = [0, 0];
  const feedLines: string[] = [];
  const logLine = (text: string) => {
    feedLines.unshift(`${formatClock(match.time)} · ${text}`);
    if (feedLines.length > 7) feedLines.length = 7;
    feed.innerHTML = feedLines.map(l => `<div>${l}</div>`).join('');
  };

  let audio: AudioContext | null = null, crowdGain: GainNode | null = null, soundEnabled = false;
  const playGoalHorn = () => {
    if (!audio || !soundEnabled) return;
    for (const hz of [330, 440, 550]) {
      const osc = audio.createOscillator(), g = audio.createGain();
      osc.type = 'sawtooth'; osc.frequency.value = hz;
      g.gain.setValueAtTime(.0001, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(.045, audio.currentTime + .1);
      g.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + 1.6);
      osc.connect(g).connect(audio.destination); osc.start(); osc.stop(audio.currentTime + 1.7);
    }
  };
  soundButton.addEventListener('click', () => {
    if (!audio) {
      audio = new AudioContext();
      const buffer = audio.createBuffer(1, audio.sampleRate * 3, audio.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * .2;
      const noise = audio.createBufferSource();
      noise.buffer = buffer; noise.loop = true;
      const low = audio.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 420;
      crowdGain = audio.createGain(); crowdGain.gain.value = .06;
      noise.connect(low).connect(crowdGain).connect(audio.destination); noise.start();
    }
    soundEnabled = !soundEnabled;
    void audio.resume();
    if (crowdGain) crowdGain.gain.value = soundEnabled ? .11 : 0;
    soundButton.textContent = soundEnabled ? 'STADIONTON AUS' : 'STADIONTON AN';
  });

  match.onEvent((e: MatchEvent) => {
    const p = e.actors.length ? match.players[e.actors[0]] : null;
    const who = p ? `${TEAM_NAME[p.team]} #${p.number}` : '';
    const kind = String(e.payload?.kind ?? '');
    if (e.type === 'kick-attempt') {
      if (kind === 'shot') shots[p!.team]++;
      statusText = `${who}: ${KIND_LABEL[kind] ?? kind}${e.source === 'coach' ? ' (Trainerentscheidung)' : ''} · Schwung läuft`;
      if (kind === 'shot' || kind === 'clear') logLine(`${who}: ${KIND_LABEL[kind]}`);
    } else if (e.type === 'touch' && e.payload?.part === 'foot') {
      statusText = `${who}: Fußkontakt · Ball ${(e.payload.ballSpeed as number).toFixed(1)} m/s`;
    } else if (e.type === 'goal') {
      const team = e.payload!.team as 0 | 1;
      logLine(`TOR! ${TEAM_NAME[team]} · ${match.score[0]}:${match.score[1]}`);
      goalFlash.textContent = team === 0 ? 'ORANGE CITY SCORES!' : 'BLUE UNITED SCORES!';
      goalFlash.classList.add('active');
      flashUntil = match.time + 3.5;
      playGoalHorn();
      statusText = `Tor bestätigt (Regel 10) · Anstoß ${TEAM_NAME[1 - team]}`;
    } else if (e.type === 'offside') {
      logLine(`Abseits: ${who} · indirekter Freistoß`);
    } else if (e.type === 'out') {
      logLine(`Ball im Aus · ${KIND_LABEL[kind]} ${TEAM_NAME[e.payload!.team as number]}`);
    } else if (e.type === 'coach') {
      logLine(`Trainer ${TEAM_NAME[e.payload!.team as number]}: ${e.payload!.tactic === 'press' ? 'hohes Pressing' : 'tief stehen'}`);
    }
  });

  $<HTMLButtonElement>('#attack').addEventListener('click', () => match.setTactic(0, 'press'));
  $<HTMLButtonElement>('#defend').addEventListener('click', () => match.setTactic(0, 'deep'));
  $<HTMLButtonElement>('#camera').addEventListener('click', () => { cameraMode = (cameraMode + 1) % 3; });
  diagnosticsButton.addEventListener('click', () => {
    diagnostics.setVisible(!diagnostics.visible);
    diagnosticsButton.classList.toggle('active', diagnostics.visible);
  });
  pauseButton.addEventListener('click', () => { paused = !paused; pauseButton.textContent = paused ? 'FORTSETZEN' : 'PAUSE'; });
  $<HTMLButtonElement>('#reset').addEventListener('click', () => {
    match.reset();
    shots[0] = 0; shots[1] = 0; feedLines.length = 0;
    logLine('Neustart: Anstoß ORANGE');
  });

  const resize = () => {
    const w = viewport.clientWidth, h = viewport.clientHeight;
    if (w <= 0 || h <= 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(viewport);
  resize();

  const feetWorld: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
  const camTarget = new THREE.Vector3(), lookTarget = new THREE.Vector3();
  function frame(now: number): void {
    const elapsed = Math.min((now - previous) / 1000, .1);
    previous = now;
    if (!paused && !introFinished) {
      introTime = Math.min(introDuration, introTime + elapsed);
      const t = introTime / introDuration;
      intro.style.opacity = String(Math.min(1, Math.max(0, (1 - t) * 5)));
      const progress = intro.querySelector<HTMLElement>('.intro-progress span');
      if (progress) progress.style.width = `${t * 100}%`;
      if (t >= 1) { introFinished = true; intro.remove(); logLine('Anpfiff – das Spiel beginnt!'); }
    }
    if (!paused && introFinished) {
      accumulator += elapsed;
      let steps = 0;
      while (accumulator >= 1 / 60 && steps < 6) { match.step(); accumulator -= 1 / 60; steps++; }
      if (steps === 6) accumulator = 0;
    }
    const bp = match.ball.translation(), br = match.ball.rotation(), bv = match.ball.linvel();
    ballMesh.position.set(bp.x, bp.y, bp.z);
    ballMesh.quaternion.set(br.x, br.y, br.z, br.w);
    match.players.forEach((p, i) => {
      const t = p.motor.body.translation(), v = p.motor.body.linvel();
      const fig = figures[i];
      fig.root.position.set(t.x, 0, t.z);
      fig.root.rotation.y = p.motor.heading;
      const speed = Math.hypot(v.x, v.z);
      if (fig.glb) { updateFootballer(fig.glb, elapsed, speed, p.legs.swing !== null); return; }
      p.legs.feet.forEach((f, k) => { const ft = f.body.translation(); feetWorld[k].set(ft.x, ft.y, ft.z); });
      poseFigure(fig, paused ? 0 : elapsed, speed, feetWorld, p.legs.swing?.plan.side ?? 0);
    });
    diagnostics.update();
    if (flashUntil && match.time > flashUntil) { goalFlash.classList.remove('active'); flashUntil = 0; }
    clockLabel.textContent = formatClock(match.time);
    scoreLabel.textContent = `${match.score[0]} : ${match.score[1]}`;
    speedLabel.textContent = `BALL ${Math.hypot(bv.x, bv.y, bv.z).toFixed(1)} M/S`;
    shotLabel.textContent = `TORSCHÜSSE ${shots[0]} : ${shots[1]}`;
    status.textContent = statusText;
    if (crowdGain && soundEnabled) crowdGain.gain.value = .08 + Math.min(.16, Math.abs(bp.x) / PITCH.halfLength * .16);
    if (!introFinished) {
      const t = Math.min(1, introTime / introDuration), smooth = t * t * (3 - 2 * t);
      camera.position.copy(startCamera).lerp(tvCamera, smooth);
      camera.lookAt(0, 5 * (1 - smooth), 0);
    } else {
      // Main TV camera on the gantry above the lower tier of the main stand.
      if (cameraMode === 0) { camTarget.set(bp.x * .55, 20, 50); lookTarget.set(bp.x * .9, 0, bp.z * .35); }
      else if (cameraMode === 1) { camTarget.set(bp.x - 14, 9, bp.z + 18); lookTarget.set(bp.x, .5, bp.z); }
      else { camTarget.set(0, 110, .1); lookTarget.set(0, 0, 0); }
      // Time-based easing, so the camera behaves the same at 30 or 144 frames per second.
      camera.position.lerp(camTarget, 1 - Math.exp(-elapsed * 2.4));
      camera.lookAt(lookTarget);
    }
    stadium.update(match.time, Math.min(1, Math.abs(bp.x) / PITCH.halfLength));
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  status.textContent = `Seed ${seed} · bereit`;
  requestAnimationFrame(frame);
}

function formatClock(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

start().catch(error => { status.textContent = `Startfehler: ${String(error)}`; console.error(error); });
