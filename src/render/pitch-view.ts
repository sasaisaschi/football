import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PITCH } from '../physics/pitch-geometry';

/** Turf with mowing stripes, IFAB markings (one merged mesh) and goals with nets, at physics scale. */
export function createPitchView(): THREE.Group {
  const group = new THREE.Group();
  group.add(turf());
  group.add(markings());
  for (const side of [-1, 1] as const) group.add(goal(side));
  return group;
}

function turf(): THREE.Mesh {
  const size = 2048;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size / 2;
  const c = canvas.getContext('2d')!;
  const stripes = 18;
  for (let i = 0; i < stripes; i++) {
    c.fillStyle = i % 2 ? '#25773f' : '#1f6c38';
    c.fillRect((i * size) / stripes, 0, size / stripes + 1, size / 2);
  }
  // Fine grain so the grass does not look like plastic up close.
  const img = c.getImageData(0, 0, size, size / 2);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 9;
    img.data[i] += n; img.data[i + 1] += n * 1.2; img.data[i + 2] += n * 0.6;
  }
  c.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const w = PITCH.length + PITCH.runOff * 2 + 6, h = PITCH.width + PITCH.runOff * 2 + 6;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 }));
  texture.repeat.set(1, 1);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

function markings(): THREE.Mesh {
  const hl = PITCH.halfLength, hw = PITCH.halfWidth, w = PITCH.lineWidth;
  const parts: THREE.BufferGeometry[] = [];
  const o = new THREE.Object3D();
  const seg = (x1: number, z1: number, x2: number, z2: number) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    o.position.set((x1 + x2) / 2, 0.01, (z1 + z2) / 2);
    o.rotation.set(-Math.PI / 2, 0, -Math.atan2(z2 - z1, x2 - x1));
    o.updateMatrix();
    parts.push(new THREE.PlaneGeometry(len + w, w).applyMatrix4(o.matrix));
  };
  const poly = (pts: [number, number][]) => { for (let i = 1; i < pts.length; i++) seg(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]); };
  const arc = (cx: number, cz: number, r: number, a0: number, a1: number, n = 48) =>
    poly(Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + r * Math.cos(a), cz + r * Math.sin(a)] as [number, number]; }));
  const spot = (x: number, z: number) => {
    o.position.set(x, 0.011, z); o.rotation.set(-Math.PI / 2, 0, 0); o.updateMatrix();
    parts.push(new THREE.CircleGeometry(0.11, 16).applyMatrix4(o.matrix));
  };
  const e = w / 2;
  poly([[-hl + e, -hw + e], [hl - e, -hw + e], [hl - e, hw - e], [-hl + e, hw - e], [-hl + e, -hw + e]]);
  seg(0, -hw + e, 0, hw - e);
  arc(0, 0, PITCH.centreCircleRadius, 0, Math.PI * 2, 96);
  spot(0, 0);
  for (const s of [-1, 1]) {
    const line = s * (hl - e);
    const pa = s * (hl - PITCH.penaltyAreaDepth), ga = s * (hl - PITCH.goalAreaDepth);
    poly([[line, -PITCH.penaltyAreaHalfWidth], [pa, -PITCH.penaltyAreaHalfWidth], [pa, PITCH.penaltyAreaHalfWidth], [line, PITCH.penaltyAreaHalfWidth]]);
    poly([[line, -PITCH.goalAreaHalfWidth], [ga, -PITCH.goalAreaHalfWidth], [ga, PITCH.goalAreaHalfWidth], [line, PITCH.goalAreaHalfWidth]]);
    const mark = s * (hl - PITCH.penaltyMark);
    spot(mark, 0);
    const half = Math.acos((PITCH.penaltyAreaDepth - PITCH.penaltyMark) / PITCH.centreCircleRadius);
    const facing = s > 0 ? Math.PI : 0;
    arc(mark, 0, PITCH.centreCircleRadius, facing - half, facing + half, 24);
    for (const c of [-1, 1]) {
      const a1 = Math.atan2(0, -s);
      let a2 = Math.atan2(-c, 0);
      if (a2 - a1 > Math.PI) a2 -= Math.PI * 2;
      if (a1 - a2 > Math.PI) a2 += Math.PI * 2;
      arc(s * hl, c * hw, PITCH.cornerArcRadius, a1, a2, 12);
    }
  }
  return new THREE.Mesh(mergeGeometries(parts), new THREE.MeshBasicMaterial({ color: 0xf2f7f2 }));
}

function goal(side: -1 | 1): THREE.Group {
  const g = new THREE.Group();
  const r = PITCH.postRadius;
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.1 });
  const x = side * (PITCH.halfLength - r), z = PITCH.goalHalfWidth + r, h = PITCH.goalHeight + 2 * r;
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 16), white);
    post.position.set(x, h / 2, s * z); post.castShadow = true; g.add(post);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 2 * (z + r), 16), white);
  bar.rotation.x = Math.PI / 2; bar.position.set(x, PITCH.goalHeight + r, 0); bar.castShadow = true; g.add(bar);
  // Net as a fine line mesh: back, sides and roof.
  const pts: THREE.Vector3[] = [];
  const back = side * (PITCH.halfLength + PITCH.goalDepth);
  const top = PITCH.goalHeight + r;
  const step = 0.25;
  for (let zz = -z; zz <= z + 1e-6; zz += step) {
    pts.push(new THREE.Vector3(back, 0, zz), new THREE.Vector3(back, top, zz));
    pts.push(new THREE.Vector3(x, top, zz), new THREE.Vector3(back, top, zz));
  }
  for (let yy = 0; yy <= top + 1e-6; yy += step) {
    pts.push(new THREE.Vector3(back, yy, -z), new THREE.Vector3(back, yy, z));
    for (const s of [-1, 1]) pts.push(new THREE.Vector3(x, yy, s * z), new THREE.Vector3(back, yy, s * z));
  }
  for (let xx = 0; xx <= PITCH.goalDepth + 1e-6; xx += step) {
    const px = x + side * xx;
    for (const s of [-1, 1]) pts.push(new THREE.Vector3(px, 0, s * z), new THREE.Vector3(px, top, s * z));
    pts.push(new THREE.Vector3(px, top, -z), new THREE.Vector3(px, top, z));
  }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xe8eef5, transparent: true, opacity: 0.45 })));
  return g;
}
