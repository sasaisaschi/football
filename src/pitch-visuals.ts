import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PITCH } from './pitch';

/** Grass, IFAB markings, goal frames and nets. Pure presentation; collision lives in pitch.ts. */
export function createPitchVisuals(scene: THREE.Scene): void {
  const { halfLength: hl, halfWidth: hw, runOff } = PITCH;
  const surround = new THREE.Mesh(
    new THREE.PlaneGeometry(PITCH.length + runOff * 2, PITCH.width + runOff * 2),
    new THREE.MeshStandardMaterial({ color: '#18673e', roughness: 1 }),
  );
  surround.rotation.x = -Math.PI / 2;
  surround.receiveShadow = true;
  scene.add(surround);
  const stripes = [0x1e7b46, 0x23864c];
  const stripeCount = 14;
  const stripeWidth = PITCH.length / stripeCount;
  for (let i = 0; i < stripeCount; i++) {
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(stripeWidth, PITCH.width),
      new THREE.MeshStandardMaterial({ color: stripes[i % 2], roughness: 1 }),
    );
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(-hl + stripeWidth * (i + 0.5), 0.004, 0);
    strip.receiveShadow = true;
    scene.add(strip);
  }

  // Markings as flat quads so they keep their true 12 cm width at any camera distance.
  // All markings are merged into one geometry: one draw call instead of several hundred.
  const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xeef8f0 });
  const w = PITCH.lineWidth;
  const pieces: THREE.BufferGeometry[] = [];
  const place = new THREE.Object3D();
  const segment = (x1: number, z1: number, x2: number, z2: number) => {
    const length = Math.hypot(x2 - x1, z2 - z1);
    place.rotation.set(-Math.PI / 2, 0, -Math.atan2(z2 - z1, x2 - x1));
    place.position.set((x1 + x2) / 2, 0.008, (z1 + z2) / 2);
    place.updateMatrix();
    pieces.push(new THREE.PlaneGeometry(length + w, w).applyMatrix4(place.matrix));
  };
  const polyline = (points: [number, number][]) => {
    for (let i = 1; i < points.length; i++) segment(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
  };
  const arc = (cx: number, cz: number, r: number, from: number, to: number, steps = 48) =>
    polyline(Array.from({ length: steps + 1 }, (_, i) => {
      const a = from + ((to - from) * i) / steps;
      return [cx + r * Math.cos(a), cz + r * Math.sin(a)] as [number, number];
    }));
  const inset = w / 2;
  polyline([[-hl + inset, -hw + inset], [hl - inset, -hw + inset], [hl - inset, hw - inset], [-hl + inset, hw - inset], [-hl + inset, -hw + inset]]);
  segment(0, -hw + inset, 0, hw - inset);
  arc(0, 0, PITCH.centerCircleRadius, 0, Math.PI * 2, 96);
  const spot = (x: number, z: number) => {
    place.rotation.set(-Math.PI / 2, 0, 0);
    place.position.set(x, 0.009, z);
    place.updateMatrix();
    pieces.push(new THREE.CircleGeometry(0.11, 16).applyMatrix4(place.matrix));
  };
  spot(0, 0);
  for (const s of [-1, 1]) {
    const line = s * (hl - inset);
    const pa = s * (hl - PITCH.penaltyAreaDepth);
    const ga = s * (hl - PITCH.goalAreaDepth);
    polyline([[line, -PITCH.penaltyAreaHalfWidth], [pa, -PITCH.penaltyAreaHalfWidth], [pa, PITCH.penaltyAreaHalfWidth], [line, PITCH.penaltyAreaHalfWidth]]);
    polyline([[line, -PITCH.goalAreaHalfWidth], [ga, -PITCH.goalAreaHalfWidth], [ga, PITCH.goalAreaHalfWidth], [line, PITCH.goalAreaHalfWidth]]);
    const spotX = s * (hl - PITCH.penaltySpot);
    spot(spotX, 0);
    // Penalty arc: the part of the 9.15 m circle around the spot that lies outside the area.
    const half = Math.acos((PITCH.penaltyAreaDepth - PITCH.penaltySpot) / PITCH.centerCircleRadius);
    const facing = s > 0 ? Math.PI : 0;
    arc(spotX, 0, PITCH.centerCircleRadius, facing - half, facing + half, 24);
    for (const c of [-1, 1]) {
      // Quarter circle between the inward goal-line and touch-line directions.
      const a1 = Math.atan2(0, -s);
      let a2 = Math.atan2(-c, 0);
      if (a2 - a1 > Math.PI) a2 -= Math.PI * 2;
      if (a1 - a2 > Math.PI) a2 += Math.PI * 2;
      arc(s * hl, c * hw, PITCH.cornerArcRadius, a1, a2, 12);
    }
    createGoalVisual(scene, s);
  }
  // Plane and circle geometries share position/normal/uv attributes, so they merge directly.
  scene.add(new THREE.Mesh(mergeGeometries(pieces), lineMaterial));
}

function createGoalVisual(scene: THREE.Scene, side: number): void {
  const r = PITCH.postRadius;
  const postX = side * (PITCH.halfLength - r);
  const postZ = PITCH.goalHalfWidth + r;
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.2, roughness: 0.4 });
  const height = PITCH.goalHeight + 2 * r;
  for (const z of [-postZ, postZ]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(r, r, height, 12), material);
    post.position.set(postX, height / 2, z);
    post.castShadow = true;
    scene.add(post);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, postZ * 2 + 2 * r, 12), material);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(postX, PITCH.goalHeight + r, 0);
  bar.castShadow = true;
  scene.add(bar);
  const netMaterial = new THREE.LineBasicMaterial({ color: 0xeaf4ff, transparent: true, opacity: 0.4 });
  const top = PITCH.goalHeight + r;
  const backX = side * (PITCH.halfLength + PITCH.goalDepth);
  const points: THREE.Vector3[] = [];
  for (let z = -postZ; z <= postZ + 1e-6; z += 0.5) {
    points.push(new THREE.Vector3(postX, top, z), new THREE.Vector3(backX, top, z));
    points.push(new THREE.Vector3(backX, top, z), new THREE.Vector3(backX, 0, z));
  }
  for (let y = 0; y <= top + 1e-6; y += 0.4) {
    points.push(new THREE.Vector3(backX, y, -postZ), new THREE.Vector3(backX, y, postZ));
    for (const z of [-postZ, postZ]) points.push(new THREE.Vector3(postX, y, z), new THREE.Vector3(backX, y, z));
  }
  scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), netMaterial));
}
