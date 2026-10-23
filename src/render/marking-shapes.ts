import * as THREE from 'three';
import { PITCH } from '../physics/pitch-geometry';

/**
 * Shapes of the reference picture's pitch markings: glowing rings under players, dashed curved arrows with a head, the
 * yellow fan and glow at the goal mouth for a shot. Flat transparent meshes drawn over the turf (no depth writes).
 */
const GROUND = 0.03;
const ringTextures = new Map<string, THREE.CanvasTexture>();

/** A soft glowing ring texture (cached per colour and style). */
function ringTexture(colour: string, thin: boolean, fill: number): THREE.CanvasTexture {
  const key = `${colour}-${thin}-${fill}`;
  const cached = ringTextures.get(key);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const r = 100;
  const inner = g.createRadialGradient(128, 128, 0, 128, 128, r);
  inner.addColorStop(0, `rgba(80,190,255,${fill * 0.5})`);
  inner.addColorStop(1, `rgba(80,190,255,${fill})`);
  g.fillStyle = inner;
  g.beginPath(); g.arc(128, 128, r, 0, Math.PI * 2); g.fill();
  g.shadowColor = colour; g.shadowBlur = thin ? 10 : 22;
  g.strokeStyle = colour; g.lineWidth = thin ? 4 : 9;
  for (let i = 0; i < 2; i++) { g.beginPath(); g.arc(128, 128, r, 0, Math.PI * 2); g.stroke(); }
  g.shadowBlur = 0; g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = thin ? 1.5 : 3;
  g.beginPath(); g.arc(128, 128, r, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  ringTextures.set(key, t);
  return t;
}

/** A glowing ring on the turf around a point (`radius` m to the ring's line). */
export function glowRing(at: { x: number; z: number }, radius: number, colour: string, opacity: number, thin = false, fill = 0.22): THREE.Mesh {
  const size = radius * 2 * (128 / 100);
  // The texture is shared; the material is the ring's own (its opacity is focused and disposed with it).
  const mat = new THREE.MeshBasicMaterial({ map: ringTexture(colour, thin, thin ? 0.04 : fill), transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
  mat.userData.sharedMap = true;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(at.x, GROUND, at.z);
  m.renderOrder = 2;
  return m;
}

type ArcStyle = { colour: string; lift: number; bend: number; eye: THREE.Vector3; width: number };

/**
 * A dashed curved arrow from `from` to `to`: the curve bows sideways by `bend` × its length (towards the middle of the
 * pitch) and rises by `lift` metres at its middle. On the turf the dashes lie flat; a rising arrow turns its dashes to
 * face the camera at `eye`. A faint wider copy underneath gives the reference's glow.
 */
export function dashedArc(from: THREE.Vector3, to: THREE.Vector3, s: ArcStyle): THREE.Group {
  const len = Math.hypot(to.x - from.x, to.z - from.z) || 1e-3;
  let px = -(to.z - from.z) / len, pz = (to.x - from.x) / len;
  const mid = { x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 };
  if (pz * mid.z > 0) { px = -px; pz = -pz; }
  const at = (t: number) => new THREE.Vector3(
    from.x + (to.x - from.x) * t + px * s.bend * len * 4 * t * (1 - t),
    from.y + (to.y - from.y) * t + 4 * s.lift * t * (1 - t),
    from.z + (to.z - from.z) * t + pz * s.bend * len * 4 * t * (1 - t),
  );
  const flat = s.lift === 0 && from.y < 0.2 && to.y < 0.2;
  const samples = 120;
  const pts = Array.from({ length: samples + 1 }, (_, i) => at(i / samples));
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = acc[acc.length - 1];
  const head = Math.min(1.0, total * 0.25);
  const side = (i: number, w: number) => {
    const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
    const tangent = q.clone().sub(o).normalize();
    const across = flat ? new THREE.Vector3(-tangent.z, 0, tangent.x) : tangent.clone().cross(s.eye.clone().sub(p)).normalize();
    return across.multiplyScalar(w / 2);
  };
  const build = (w: number, opacity: number) => {
    const pos: number[] = [];
    const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
    const dash = 0.75, gap = 0.34;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = acc[i];
      if (d > total - head) break;
      if (d % (dash + gap) > dash) continue;
      const a = side(i, w), b = side(i + 1, w);
      quad(pts[i].clone().add(a), pts[i].clone().sub(a), pts[i + 1].clone().sub(b), pts[i + 1].clone().add(b));
    }
    // Arrow head: a triangle over the last stretch, three dash widths wide at its base.
    const k = acc.findIndex(d => d >= total - head);
    const base = pts[k], tip = pts[pts.length - 1], wide = side(k, w * 3.6);
    const b1 = base.clone().add(wide), b2 = base.clone().sub(wide);
    pos.push(b1.x, b1.y, b1.z, b2.x, b2.y, b2.z, tip.x, tip.y, tip.z);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: s.colour, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
    mesh.renderOrder = 3;
    return mesh;
  };
  const g = new THREE.Group();
  g.add(build(s.width * 2.2, 0.16), build(s.width, 0.96));
  return g;
}

/**
 * Where a shot is aimed: a yellow fan on the turf narrowing from the goal mouth towards the striker, and a glow in the
 * goal around the aim point, as in the reference picture.
 */
export function targetFan(aim: THREE.Vector3, side: 1 | -1, colour: string): THREE.Group {
  const g = new THREE.Group();
  const lineX = side * PITCH.halfLength;
  const z0 = Math.max(-PITCH.goalHalfWidth, aim.z - 1.7), z1 = Math.min(PITCH.goalHalfWidth, aim.z + 1.7);
  const apex = new THREE.Vector3(lineX - side * 6, GROUND, aim.z * 0.7);
  const c = new THREE.Color(colour);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([apex.x, GROUND, apex.z, lineX, GROUND, z0, lineX, GROUND, z1], 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute([c.r, c.g, c.b, 0.02, c.r, c.g, c.b, 0.5, c.r, c.g, c.b, 0.5], 4));
  const fan = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  fan.renderOrder = 2;
  g.add(fan);
  // The glow in the goal mouth: a soft yellow patch on the goal plane around the aim.
  const tex = document.createElement('canvas');
  tex.width = tex.height = 128;
  const x = tex.getContext('2d')!;
  const grad = x.createRadialGradient(64, 90, 4, 64, 90, 64);
  grad.addColorStop(0, 'rgba(255,230,40,0.75)');
  grad.addColorStop(1, 'rgba(255,230,40,0)');
  x.fillStyle = grad; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(tex);
  t.colorSpace = THREE.SRGBColorSpace;
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.2), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  glow.position.set(lineX + side * 0.05, 1.0, aim.z);
  glow.rotation.y = Math.PI / 2;
  glow.renderOrder = 2;
  g.add(glow);
  return g;
}
