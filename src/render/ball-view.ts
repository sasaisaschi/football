import * as THREE from 'three';
import { BALL_SPEC } from '../physics/pitch-geometry';

/** Match ball with a panel texture (so spin is visible) and a soft contact shadow that fades with height. */
export function createBallView(): { mesh: THREE.Group; update(p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number; w: number }): void } {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 128;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#f7f7f2'; c.fillRect(0, 0, 256, 128);
  c.fillStyle = '#1b2433';
  for (let i = 0; i < 8; i++) for (let j = 0; j < 3; j++) {
    c.beginPath();
    const x = i * 32 + (j % 2) * 16 + 8, y = j * 44 + 20;
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; c.lineTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9); }
    c.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_SPEC.radius, 24, 16), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 }));
  ball.castShadow = true;
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(BALL_SPEC.radius * 1.3, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  const group = new THREE.Group();
  group.add(ball, shadow);
  return {
    mesh: group,
    update(p, q) {
      ball.position.set(p.x, p.y, p.z);
      ball.quaternion.set(q.x, q.y, q.z, q.w);
      shadow.position.set(p.x, 0.015, p.z);
      const h = Math.max(0, p.y - BALL_SPEC.radius);
      (shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.08, 0.45 - h * 0.08);
      shadow.scale.setScalar(1 + h * 0.15);
    },
  };
}
