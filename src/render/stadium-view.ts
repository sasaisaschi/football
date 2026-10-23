import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TEAMS } from '../engine/rosters';
import { BOARDS, STANDS } from '../physics/pitch-colliders';
import { PITCH } from '../physics/pitch-geometry';
import { advertTexture, bannerTexture, carpetTexture } from './stadium-signs';

/**
 * The stadium of the client's reference picture, by day: a two-tier bowl of light concrete and blue seats under a pale
 * roof, a dense home crowd in the club's blue (some away fans in one corner), "RIVERDALE" banners on the stand fronts,
 * navy LED boards and slanted "THE 12TH MAN" carpets beside the goals. Pure presentation; its only input is a crowd
 * excitement level.
 */
export type StadiumView = { group: THREE.Group; update(time: number, excitement: number, celebrate: 0 | 1 | -1): void };

const ROWS = 30, ROW_DEPTH = 0.8, ROW_RISE = 0.42;

export function createStadiumView(): StadiumView {
  const group = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0x6a7079, roughness: 0.95 });
  const seats = new THREE.MeshStandardMaterial({ color: 0x12285a, roughness: 0.8 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xd4d9df, roughness: 0.6, metalness: 0.2 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3b4553, roughness: 0.9 });
  // Static architecture is collected per material and merged into a few draw calls.
  const pieces = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const list = pieces.get(m) ?? [];
    list.push(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
    pieces.set(m, list);
  };
  const SX = STANDS.x, SZ = STANDS.z;
  for (let r = 0; r <= ROWS; r++) {
    const off = r * ROW_DEPTH, y = 1 + r * ROW_RISE;
    const m = r % 10 === 0 ? concrete : seats;
    for (const s of [-1, 1]) {
      box(2 * (SX + off), 0.35, ROW_DEPTH, 0, y, s * (SZ + off + ROW_DEPTH / 2), m);
      box(ROW_DEPTH, 0.35, 2 * (SZ + off), s * (SX + off + ROW_DEPTH / 2), y, 0, m);
    }
  }
  const depth = ROWS * ROW_DEPTH, height = 1 + ROWS * ROW_RISE;
  for (const s of [-1, 1]) {
    // Front walls under the first row (the banners hang there), back walls, roof.
    box(2 * SX, 1.2, 0.3, 0, 0.6, s * (SZ - 0.15), wallMat);
    box(0.3, 1.2, 2 * SZ, s * (SX - 0.15), 0.6, 0, wallMat);
    box(2 * (SX + depth) + 2, height + 9, 1, 0, (height + 9) / 2, s * (SZ + depth + 1), concrete);
    box(1, height + 9, 2 * (SZ + depth) + 2, s * (SX + depth + 1), (height + 9) / 2, 0, concrete);
    box(2 * (SX + depth) + 8, 0.6, depth + 8, 0, height + 9, s * (SZ + depth / 2), roofMat);
    box(depth + 8, 0.6, 2 * (SZ + depth) + 8, s * (SX + depth / 2), height + 9, 0, roofMat);
  }
  for (const [material, list] of pieces) {
    const mesh = new THREE.Mesh(mergeGeometries(list), material);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const crowd = createCrowd(SX, SZ);
  group.add(crowd.group);
  group.add(createBanners(SX, SZ));
  const boards = createBoards();
  group.add(boards.group);
  group.add(createCarpets());
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) group.add(floodlightMast(sx * (SX + depth - 4), sz * (SZ + depth - 4), height + 9));
  return {
    group,
    update(time, excitement, celebrate) {
      crowd.update(time, excitement, celebrate);
      boards.update(time);
    },
  };
}

/** Fans: a body and a head per seat (two instanced meshes sharing the same matrices), bobbing in the vertex shader. */
function createCrowd(SX: number, SZ: number) {
  const seat = 0.55;
  const long = Math.floor((2 * SX) / seat), end = Math.floor((2 * SZ) / seat);
  const count = ROWS * 2 * (long + end);
  const bodyGeo = new THREE.CapsuleGeometry(0.19, 0.42, 2, 6).translate(0, 0, 0);
  const headGeo = new THREE.SphereGeometry(0.12, 8, 6).translate(0, 0.46, 0.02);
  const phase = new Float32Array(count), side = new Float32Array(count);
  // Amplitude follows the tension; on a goal the scoring club's fans jump while the others sink.
  const uniforms = { uTime: { value: 0 }, uExcite: { value: 0 }, uCelebrate: { value: 0 } };
  const bob = (m: THREE.MeshStandardMaterial) => {
    m.onBeforeCompile = shader => {
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
    return m;
  };
  const bodies = new THREE.InstancedMesh(bodyGeo, bob(new THREE.MeshStandardMaterial({ roughness: 0.9 })), count);
  const heads = new THREE.InstancedMesh(headGeo, bob(new THREE.MeshStandardMaterial({ roughness: 0.8 })), count);
  const home = [TEAMS[0].kit, '#2b63c9', '#163c86', TEAMS[0].kit, '#5d8fd6', '#f1f3f6'].map(c => new THREE.Color(c));
  const away = [TEAMS[1].kit, '#7c1220', '#f1f3f6'].map(c => new THREE.Color(c));
  const neutral = ['#2a2f38', '#5b6270', '#c9ced6', '#3d4d63'].map(c => new THREE.Color(c));
  const skins = ['#e8bfa0', '#c79574', '#8d5b3c', '#f1d3bc', '#5e3b26'].map(c => new THREE.Color(c));
  const dummy = new THREE.Object3D();
  const colour = new THREE.Color();
  let n = 0;
  for (let s = 0; s < 4; s++) {
    const isLong = s < 2, cols = isLong ? long : end;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < cols; c++) {
      const off = r * ROW_DEPTH + ROW_DEPTH / 2;
      const along = (c / (cols - 1) - 0.5) * (isLong ? 2 * (SX + off) - 1 : 2 * (SZ + off) - 1);
      const x = isLong ? along : (s === 2 ? -1 : 1) * (SX + off);
      const z = isLong ? (s === 0 ? -1 : 1) * (SZ + off) : along;
      // The away fans fill one corner of a long stand; everywhere else the home club's blue dominates.
      const team = isLong && s === 0 && x < -SX * 0.55 ? 1 : 0;
      const hash = (c * 73 + r * 151 + s * 17 + ((c * r) % 7) * 29) % 100;
      const pal = team === 0 ? home : away;
      colour.copy(hash < 72 ? pal[hash % pal.length] : neutral[hash % neutral.length]);
      // The stands face away from the sun (it stands behind them, as in the reference): the crowd is in shade, the
      // upper rows under the roof darker still.
      colour.multiplyScalar(r > ROWS * 0.62 ? 0.15 : 0.27 - r * 0.003);
      dummy.position.set(x + ((hash % 5) - 2) * 0.03, 1.62 + r * ROW_RISE, z);
      dummy.rotation.set(0, isLong ? (s === 0 ? 0 : Math.PI) : s === 2 ? Math.PI / 2 : -Math.PI / 2, 0);
      dummy.scale.setScalar(0.92 + (hash % 9) * 0.02);
      dummy.updateMatrix();
      bodies.setMatrixAt(n, dummy.matrix);
      heads.setMatrixAt(n, dummy.matrix);
      bodies.setColorAt(n, colour);
      heads.setColorAt(n, skins[hash % skins.length].clone().multiplyScalar(r > ROWS * 0.62 ? 0.18 : 0.32));
      phase[n] = (hash / 100) * Math.PI * 2;
      side[n] = team;
      n++;
    }
  }
  for (const g of [bodyGeo, headGeo]) {
    g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    g.setAttribute('aTeam', new THREE.InstancedBufferAttribute(side, 1));
  }
  const group = new THREE.Group();
  group.add(bodies, heads);
  return {
    group,
    update(time: number, excitement: number, celebrate: 0 | 1 | -1) {
      uniforms.uTime.value = time;
      uniforms.uExcite.value = excitement;
      uniforms.uCelebrate.value = celebrate;
    },
  };
}

/** Club banners on the stand fronts, flags of the home club between them. */
function createBanners(SX: number, SZ: number): THREE.Group {
  const g = new THREE.Group();
  const club = new THREE.MeshStandardMaterial({ map: bannerTexture(TEAMS[0].name.replace(/ FC$/, '').toUpperCase()), roughness: 0.85, side: THREE.DoubleSide });
  const flag = new THREE.MeshStandardMaterial({ map: bannerTexture('', true), roughness: 0.85, side: THREE.DoubleSide });
  const hang = (x: number, z: number, ry: number, w: number, mat: THREE.Material, y = 2.4) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.32), mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    g.add(m);
  };
  // Long stands (facing the pitch) and the ends.
  for (const s of [-1, 1]) {
    for (let i = 0, x = -SX + 8; x < SX - 6; i++, x += 11) hang(x, s * (SZ + 0.9), s > 0 ? Math.PI : 0, i % 3 === 0 ? 5.2 : 4.2, i % 2 ? flag : club, 2.2 + (i % 2) * 0.4);
    for (let i = 0, z = -SZ + 6; z < SZ - 4; i++, z += 9) hang(s * (SX + 0.9), z, s > 0 ? -Math.PI / 2 : Math.PI / 2, 4.4, i % 2 ? club : flag, 2.3);
  }
  return g;
}

/** LED boards along the perimeter: navy, white and light blue lettering, the messages slowly passing. */
function createBoards() {
  const group = new THREE.Group();
  const { texture, draw } = advertTexture([`THE 12TH MAN`, TEAMS[0].name.replace(/ FC$/, '').toUpperCase(), 'MATCHDAY', TEAMS[1].name.toUpperCase(), 'YOUR CALL'] );
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
      draw((time * 25) % 900);
      texture.needsUpdate = true;
    },
  };
}

/** Slanted "carpet" signs on the grass behind the goal line, either side of each goal, facing the field of play. */
function createCarpets(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ map: carpetTexture('THE 12TH MAN'), side: THREE.DoubleSide });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.6), mat);
    // Behind the goal line, between the goal and the corner, tilted up towards the pitch.
    m.position.set(sx * (PITCH.halfLength + 2.6), 0.55, sz * (PITCH.goalHalfWidth + 9));
    m.rotation.set(0, sx > 0 ? -Math.PI / 2 : Math.PI / 2, 0);
    m.rotateX(-0.75);
    g.add(m);
  }
  return g;
}

function floodlightMast(x: number, z: number, roof: number): THREE.Group {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xc3c9d0, metalness: 0.5, roughness: 0.45 });
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, roof + 14, 8), steel);
  mast.position.set(x, (roof + 14) / 2, z);
  g.add(mast);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(7, 3.2, 0.5), new THREE.MeshStandardMaterial({ color: 0xe6ebf0, roughness: 0.5 }));
  panel.position.set(x, roof + 14, z);
  panel.lookAt(0, 0, 0);
  g.add(panel);
  return g;
}
