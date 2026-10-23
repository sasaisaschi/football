// Development tool (not part of the app): draws one recorded match state (lab/scenes.json, from
// src/engine/record-scenes.test.ts) with the renderer of the checked-out version, from the scene's fixed camera.
// /lab/?scene=2  – used by scripts/lab/compare.mjs to make before/after pictures of identical situations.
import * as THREE from 'three';
import { TEAMS } from '../src/engine/rosters';
import type { MatchSnapshot, PlayerProfile } from '../src/engine/types';
import { createBallView } from '../src/render/ball-view';
import { createPitchView } from '../src/render/pitch-view';
import { Footballer, loadFootballer } from '../src/render/footballer';
import { createStadiumView } from '../src/render/stadium-view';
import data from './scenes.json';

type Scene = { name: string; actor: number; snapshot: MatchSnapshot; camera: { position: [number, number, number]; target: [number, number, number] } };
const scenes = (data as unknown as { profiles: PlayerProfile[]; scenes: Scene[] });
const scene = scenes.scenes[Number(new URLSearchParams(location.search).get('scene') ?? 0)];

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.append(renderer.domElement);
const world = new THREE.Scene();
world.background = new THREE.Color('#050a14');
world.fog = new THREE.Fog('#050a14', 160, 360);
world.add(new THREE.HemisphereLight(0xc9d8ff, 0x1a3020, 0.85));
const key = new THREE.DirectionalLight(0xffffff, 2.6);
key.position.set(-40, 80, 50);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -70, right: 70, top: 50, bottom: -50, near: 10, far: 220 });
key.shadow.bias = -0.0004;
world.add(key, createPitchView(), createStadiumView().group);
const ball = createBallView();
world.add(ball.mesh);
const s = scene.snapshot;
ball.update(s.ball.position, s.ball.rotation);
const model = await loadFootballer('/models/footballer.glb');
for (const p of scenes.profiles) {
  const f = new Footballer(p, TEAMS[p.team], model);
  world.add(f.root);
  // The pose of a single frame; the decorative stride takes its phase from the frame number, so it is the same each time.
  (f as unknown as { gait: number }).gait = (s.tick + p.id) * 0.37;
  (f.update as (v: unknown, dt: number, look?: unknown) => void).call(f, s.players[p.id], 0, s.ball.position);
}
const cam = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.1, 600);
cam.position.set(...scene.camera.position);
cam.lookAt(new THREE.Vector3(...scene.camera.target));
renderer.render(world, cam);
(window as unknown as { __labReady?: string }).__labReady = scene.name;
