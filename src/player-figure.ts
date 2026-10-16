import * as THREE from 'three';
import { LEG } from './foot-contact';

export type PlayerFigure = {
  root: THREE.Group;
  /** Hip pivots, local +X is the right side (Side +1), local +Z is the facing direction. */
  legs: [THREE.Group, THREE.Group];
  arms: [THREE.Group, THREE.Group];
  gait: number;
};

const DOWN = new THREE.Vector3(0, -1, 0);
const hipLocal = (side: number) => new THREE.Vector3(side * LEG.hipOffset, LEG.hipHeight, 0);
const foot = new THREE.Vector3();
const dir = new THREE.Vector3();

/**
 * Placeholder footballer built from boxes, in the 1.80 m physics scale. The legs are pivots so the
 * kicking leg can be pointed at the real, physics-driven boot position.
 */
export function createPlayerFigure(kit: string, shortsColor: string, skinColor: string, hairColor: string, number: number, keeper: boolean): PlayerFigure {
  const root = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ color: keeper ? '#d9f24a' : kit, roughness: .75 });
  const skin = new THREE.MeshStandardMaterial({ color: skinColor, roughness: .85 });
  const shorts = new THREE.MeshStandardMaterial({ color: shortsColor, roughness: .8 });
  const boots = new THREE.MeshStandardMaterial({ color: '#0c1220', roughness: .55 });
  const part = (parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh;
  };
  part(root, .58, .66, .3, 0, 1.3, 0, shirt);
  part(root, .5, .2, .3, 0, .9, 0, shorts);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.13, 14, 10), skin);
  head.position.y = 1.72; head.castShadow = true; root.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(.135, 14, 8, 0, Math.PI * 2, 0, Math.PI * .42), new THREE.MeshStandardMaterial({ color: hairColor }));
  hair.position.y = 1.75; root.add(hair);
  const legs = [-1, 1].map(side => {
    const pivot = new THREE.Group();
    pivot.position.copy(hipLocal(side));
    part(pivot, .15, .44, .17, 0, -.2, 0, skin);
    part(pivot, .13, .42, .14, 0, -.62, 0, new THREE.MeshStandardMaterial({ color: keeper ? '#222' : kit, roughness: .8 }));
    part(pivot, .1, .1, .27, 0, -LEG.hipHeight + LEG.footRadius, .06, boots);
    root.add(pivot);
    return pivot;
  }) as [THREE.Group, THREE.Group];
  const arms = [-1, 1].map(side => {
    const pivot = new THREE.Group();
    pivot.position.set(side * .36, 1.58, 0);
    part(pivot, .13, .6, .14, 0, -.3, 0, keeper ? shirt : skin);
    root.add(pivot);
    return pivot;
  }) as [THREE.Group, THREE.Group];
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'white'; ctx.font = 'bold 42px Arial'; ctx.textAlign = 'center'; ctx.fillText(String(number), 32, 47);
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(.28, .28), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  decal.position.set(0, 1.36, -.16); root.add(decal);
  return { root, legs, arms, gait: 0 };
}

/**
 * Pose update. A swinging leg points exactly at its physics boot; other legs and arms get a speed-driven
 * running cycle that is purely visual (the resting boot colliders stay under the hips).
 */
export function poseFigure(fig: PlayerFigure, dt: number, speed: number, feetWorld: [THREE.Vector3, THREE.Vector3], swingingSide: number): void {
  fig.gait += dt * (2.2 + speed * 1.05);
  const amp = Math.min(.55, speed * .075);
  fig.root.updateMatrixWorld();
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const leg = fig.legs[i];
    if (side === swingingSide) {
      foot.copy(feetWorld[i]);
      fig.root.worldToLocal(foot);
      dir.copy(foot).sub(hipLocal(side));
      const length = dir.length();
      leg.quaternion.setFromUnitVectors(DOWN, dir.normalize());
      leg.scale.set(1, Math.max(.8, Math.min(1.08, length / (LEG.hipHeight - LEG.footRadius))), 1);
    } else {
      leg.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.sin(fig.gait + (i ? Math.PI : 0)) * amp);
      leg.scale.set(1, 1, 1);
    }
    fig.arms[i].rotation.x = Math.sin(fig.gait + (i ? 0 : Math.PI)) * amp * .8;
  }
}
