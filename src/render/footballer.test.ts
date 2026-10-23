import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createRoster, TEAMS } from '../engine/rosters';
import type { PlayerView } from '../engine/types';
import { Footballer } from './footballer';

// The shirt numbers are drawn on a canvas; in Node a canvas that draws nothing is enough.
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: () => () => {} }) }) };

let model: { scene: THREE.Group; mesh: THREE.SkinnedMesh; clips: THREE.AnimationClip[] };
beforeAll(async () => {
  const buf = readFileSync('public/models/footballer.glb');
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  let mesh: THREE.SkinnedMesh | null = null;
  gltf.scene.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh; });
  model = { scene: gltf.scene, mesh: mesh!, clips: gltf.animations };
});

const profile = createRoster(7)[9];
/** A player standing at (x, z) facing +z (heading 0), boots under the hips. */
function standing(x = 0, z = 0, over: Partial<PlayerView> = {}): PlayerView {
  return {
    id: profile.id, position: { x, y: profile.heightM / 2, z }, velocity: { x: 0, y: 0, z: 0 }, heading: 0,
    boots: [{ x: x + 0.12, y: 0.05, z }, { x: x - 0.12, y: 0.05, z }], swingingBoot: -1, hands: null, upperBody: null, lying: 0, booked: 'none', sentOff: false, ...over,
  };
}
const bone = (f: Footballer, name: string) => {
  let b: THREE.Object3D | undefined;
  f.root.traverse(o => { if (o.name === name) b = o; });
  return b!.getWorldPosition(new THREE.Vector3());
};

describe('footballer figure', () => {
  it('stands on its boots with the hands below the shoulders', () => {
    const f = new Footballer(profile, TEAMS[0], model);
    for (let i = 0; i < 30; i++) f.update(standing(), 1 / 60);
    for (const s of ['L', 'R']) {
      expect(bone(f, `hand${s}`).y).toBeLessThan(bone(f, `upperarm${s}`).y - 0.3);
      expect(bone(f, `foot${s}`).y).toBeLessThan(0.2);
    }
    // Height of the head as the player's height.
    expect(bone(f, 'head').y).toBeGreaterThan(profile.heightM * 0.85);
    expect(bone(f, 'head').y).toBeLessThan(profile.heightM);
  });

  it('puts the ankles onto the physics boots, also for a kicking leg', () => {
    const f = new Footballer(profile, TEAMS[0], model);
    const v = standing(3, -2, { swingingBoot: 0, boots: [{ x: 3.15, y: 0.35, z: -1.6 }, { x: 2.88, y: 0.05, z: -2 }] });
    for (let i = 0; i < 30; i++) f.update(v, 1 / 60); // the strike layer fades in
    const ankle = bone(f, 'footL');
    expect(Math.hypot(ankle.x - 3.15, ankle.z - (-1.6 - 0.04))).toBeLessThan(0.08);
    expect(Math.abs(ankle.y - 0.35 - 0.075)).toBeLessThan(0.08);
  });

  it('puts a keeper\'s hands where the physics hands are', () => {
    const keeper = createRoster(7)[0];
    const f = new Footballer(keeper, TEAMS[0], model);
    const v = { ...standing(), id: keeper.id, position: { x: 0, y: keeper.heightM / 2, z: 0 }, hands: { x: 0, y: 2.1, z: 0.3 } };
    for (let i = 0; i < 30; i++) f.update(v, 1 / 60);
    const reach = Math.min(bone(f, 'handL').distanceTo(new THREE.Vector3(0.08, 2.1, 0.3)), bone(f, 'handR').distanceTo(new THREE.Vector3(-0.08, 2.1, 0.3)));
    expect(reach).toBeLessThan(0.12);
  });

  it('keeps exactly its pose in a frozen frame (no layer is applied again on top of itself)', () => {
    const f = new Footballer(profile, TEAMS[0], model);
    // Side-stepping (hips into the run, trunk to the heading), turning, with the head on the ball: every layer active.
    const run = (h: number) => standing(0, 0, { heading: h, velocity: { x: 3.2, y: 0, z: 0.4 } });
    for (let i = 0; i < 40; i++) f.update(run(0.4 + i * 0.01), 1 / 60, { x: 6, y: 0.11, z: 5 });
    const pose = () => { const out: number[] = []; f.root.traverse(o => { if ((o as THREE.Bone).isBone) out.push(...o.quaternion.toArray()); }); return out; };
    f.update(run(0.8), 0, { x: 6, y: 0.11, z: 5 });
    const frozen = pose();
    for (let i = 0; i < 200; i++) f.update(run(0.8), 0, { x: 6, y: 0.11, z: 5 });
    pose().forEach((v, i) => expect(v).toBeCloseTo(frozen[i], 6));
    expect(bone(f, 'head').y).toBeGreaterThan(profile.heightM * 0.85);
  });

  it('turns on the spot in steps: a foot lifts off the turf while the body turns', () => {
    const f = new Footballer(profile, TEAMS[0], model);
    for (let i = 0; i < 60; i++) f.update(standing(), 1 / 60);
    const rest = Math.max(bone(f, 'footL').y, bone(f, 'footR').y);
    let lift = 0;
    for (let i = 0; i < 30; i++) { f.update(standing(0, 0, { heading: i * 0.1 }), 1 / 60); lift = Math.max(lift, bone(f, 'footL').y - rest, bone(f, 'footR').y - rest); }
    expect(lift).toBeGreaterThan(0.03);
  });
});
