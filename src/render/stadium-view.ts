import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TEAMS } from '../engine/rosters';
import { BOARDS, STANDS } from '../physics/pitch-colliders';

/**
 * Night stadium around the physical stand walls: two-tier bowl, instanced crowd in both club colours,
 * LED boards, roof and four floodlight masts. Pure presentation; its only input is a crowd excitement level.
 */
export type StadiumView = { group: THREE.Group; update(time: number, excitement: number, celebrate: 0 | 1 | -1): void };

const ROWS = 30, ROW_DEPTH = 0.8, ROW_RISE = 0.42;

export function createStadiumView(): StadiumView {
  const group = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0x2b3446, roughness: 0.95 });
  const seatDark = new THREE.MeshStandardMaterial({ color: 0x141c2b, roughness: 0.9 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x1a2232, roughness: 0.5, metalness: 0.6 });
  // Static architecture is collected per material and merged into a few draw calls.
  const pieces = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const list = pieces.get(m) ?? [];
    list.push(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
    pieces.set(m, list);
  };
  const SX = STANDS.x, SZ = STANDS.z;
  // Terraces as stepped slabs on all four sides.
  for (let r = 0; r <= ROWS; r++) {
    const off = r * ROW_DEPTH, y = 1 + r * ROW_RISE;
    const m = r % 6 === 0 ? concrete : seatDark;
    for (const s of [-1, 1]) {
      box(2 * (SX + off), 0.35, ROW_DEPTH, 0, y, s * (SZ + off + ROW_DEPTH / 2), m);
      box(ROW_DEPTH, 0.35, 2 * (SZ + off), s * (SX + off + ROW_DEPTH / 2), y, 0, m);
    }
  }
  const depth = ROWS * ROW_DEPTH, height = 1 + ROWS * ROW_RISE;
  // Back walls, roof and fascia.
  for (const s of [-1, 1]) {
    box(2 * (SX + depth) + 2, height + 9, 1, 0, (height + 9) / 2, s * (SZ + depth + 1), concrete);
    box(1, height + 9, 2 * (SZ + depth) + 2, s * (SX + depth + 1), (height + 9) / 2, 0, concrete);
    box(2 * (SX + depth) + 8, 0.6, depth + 8, 0, height + 9, s * (SZ + depth / 2), steel);
    box(depth + 8, 0.6, 2 * (SZ + depth) + 8, s * (SX + depth / 2), height + 9, 0, steel);
  }
  for (const [material, list] of pieces) group.add(new THREE.Mesh(mergeGeometries(list), material));
  const crowd = createCrowd(SX, SZ);
  group.add(crowd.mesh);
  const boards = createBoards();
  group.add(boards.group);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) group.add(floodlight(sx * (SX + depth - 4), sz * (SZ + depth - 4)));
  return {
    group,
    update(time, excitement, celebrate) {
      crowd.update(time, excitement, celebrate);
      boards.update(time);
    },
  };
}

function createCrowd(SX: number, SZ: number) {
  const seat = 0.55;
  const long = Math.floor((2 * SX) / seat), end = Math.floor((2 * SZ) / seat);
  const count = ROWS * 2 * (long + end);
  const geo = new THREE.CapsuleGeometry(0.2, 0.42, 2, 6);
  const phase = new Float32Array(count), side = new Float32Array(count);
  const material = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  // Fans bob in the vertex shader (no per-frame CPU work): amplitude follows the tension; on a goal the
  // scoring end jumps while the other end sinks.
  const uniforms = { uTime: { value: 0 }, uExcite: { value: 0 }, uCelebrate: { value: 0 } };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aPhase;
        attribute float aTeam;
        uniform float uTime;
        uniform float uExcite;
        uniform float uCelebrate;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float cheering = uCelebrate * (aTeam > 0.5 ? -1.0 : 1.0);
        float amp = cheering > 0.5 ? 0.35 : 0.02 + uExcite * 0.06;
        float freq = cheering > 0.5 ? 7.0 : 1.6 + uExcite * 2.0;
        transformed.y += max(0.0, sin(uTime * freq + aPhase)) * amp;`);
  };
  const mesh = new THREE.InstancedMesh(geo, material, count);
  const home = new THREE.Color(TEAMS[0].kit), away = new THREE.Color(TEAMS[1].kit);
  const neutral = [new THREE.Color('#d9dee6'), new THREE.Color('#2b3240'), new THREE.Color('#7a8394'), new THREE.Color('#e9c46a')];
  const dummy = new THREE.Object3D();
  let n = 0;
  for (let s = 0; s < 4; s++) {
    const isLong = s < 2, cols = isLong ? long : end;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < cols; c++) {
      const off = r * ROW_DEPTH + ROW_DEPTH / 2;
      const along = (c / (cols - 1) - 0.5) * (isLong ? 2 * (SX + off) - 1 : 2 * (SZ + off) - 1);
      const x = isLong ? along : (s === 2 ? -1 : 1) * (SX + off);
      const z = isLong ? (s === 0 ? -1 : 1) * (SZ + off) : along;
      // Home fans behind the goal at -X and along the near side; the away end is at +X.
      const team = (!isLong && s === 3) || (isLong && x > 30 && s === 0) ? 1 : 0;
      const hash = (c * 73 + r * 151 + s * 17) % 100;
      const color = hash < 55 ? (team === 0 ? home : away) : neutral[hash % neutral.length];
      dummy.position.set(x, 1.55 + r * ROW_RISE, z);
      dummy.rotation.set(0, isLong ? (s === 0 ? 0 : Math.PI) : s === 2 ? Math.PI / 2 : -Math.PI / 2, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(n, dummy.matrix);
      mesh.setColorAt(n, color);
      phase[n] = (hash / 100) * Math.PI * 2;
      side[n] = team;
      n++;
    }
  }
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  geo.setAttribute('aTeam', new THREE.InstancedBufferAttribute(side, 1));
  return {
    mesh,
    update(time: number, excitement: number, celebrate: 0 | 1 | -1) {
      uniforms.uTime.value = time;
      uniforms.uExcite.value = excitement;
      uniforms.uCelebrate.value = celebrate;
    },
  };
}

function createBoards() {
  const group = new THREE.Group();
  const canvas = document.createElement('canvas');
  canvas.width = 2048; canvas.height = 64;
  const c = canvas.getContext('2d')!;
  const messages = ['THE 12TH MAN', 'HARBOURSIDE ATHLETIC', 'MATCHDAY LIVE', 'NORTHGATE ROVERS', 'YOUR CALL. THEIR GAME.'];
  const draw = (offset: number) => {
    c.fillStyle = '#05080f'; c.fillRect(0, 0, 2048, 64);
    c.font = '800 40px Bahnschrift, Segoe UI, sans-serif'; c.textBaseline = 'middle';
    let x = -offset;
    while (x < 2048) {
      for (const [i, m] of messages.entries()) {
        c.fillStyle = i % 2 ? '#4cc3ff' : '#ff8a2a';
        c.fillText(m, x, 33);
        x += c.measureText(m).width + 90;
      }
    }
  };
  draw(0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: texture });
  const h = BOARDS.height;
  for (const s of [-1, 1]) {
    const longBoard = new THREE.Mesh(new THREE.BoxGeometry(2 * BOARDS.x, h, 0.15), mat);
    longBoard.position.set(0, h / 2, s * BOARDS.z); group.add(longBoard);
    const endBoard = new THREE.Mesh(new THREE.BoxGeometry(0.15, h, 2 * BOARDS.z), mat);
    endBoard.position.set(s * BOARDS.x, h / 2, 0); group.add(endBoard);
  }
  let last = 0;
  return {
    group,
    update(time: number) {
      if (time - last < 0.1) return;
      last = time;
      draw((time * 60) % 600);
      texture.needsUpdate = true;
    },
  };
}

function floodlight(x: number, z: number): THREE.Group {
  const g = new THREE.Group();
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 40, 8), new THREE.MeshStandardMaterial({ color: 0x1a2232, metalness: 0.6, roughness: 0.5 }));
  mast.position.set(x, 20, z);
  g.add(mast);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(7, 3.2, 0.5), new THREE.MeshBasicMaterial({ color: 0xf4f8ff }));
  panel.position.set(x, 40, z);
  panel.lookAt(0, 0, 0);
  g.add(panel);
  const glow = new THREE.PointLight(0xdfe9ff, 900, 160, 2);
  glow.position.set(x * 0.92, 38, z * 0.92);
  g.add(glow);
  return g;
}
