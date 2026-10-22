import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Geometry for the footballer figure, built procedurally (no external assets, so no licence question): turned
 * profiles for torso and shorts, tapered capsules for the limbs, a shaped boot. Each part carries its colours as vertex
 * colours, so every figure is drawn with one shared material and a handful of draw calls.
 */
export type FigureColours = { kit: THREE.Color; trim: THREE.Color; shorts: THREE.Color; socks: THREE.Color; skin: THREE.Color; hair: THREE.Color; boot: THREE.Color; glove: THREE.Color };

/** Paints every vertex of a geometry with a colour chosen from its position. */
function paint(g: THREE.BufferGeometry, colour: (p: THREE.Vector3) => THREE.Color): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const cols = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const c = colour(p);
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}

const solid = (g: THREE.BufferGeometry, c: THREE.Color) => paint(g, () => c);

/** A capsule from the origin down to −length, tapering from r1 to r2 (limb segment hanging from its joint). */
function limb(length: number, r1: number, r2: number): THREE.BufferGeometry {
  // Unit-radius capsule 8 long (y from −4 to 4): the rounded ends take an eighth each.
  const g = new THREE.CapsuleGeometry(1, 6, 4, 10, 6);
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Map to 0 … −length with the radius tapering along it.
    const t = (4 - v.y) / 8;
    const r = r1 + (r2 - r1) * Math.min(1, Math.max(0, t));
    pos.setXYZ(i, v.x * r, -t * length, v.z * r);
  }
  g.computeVertexNormals();
  return g;
}

/** Upper body above the hip: torso with collar and side panels, neck, head with hair. Origin at the ground. */
export function bodyGeometry(h: number, hip: number, c: FigureColours, keeper: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const top = h * 0.81, waist = hip + h * 0.05;
  const profile = [
    [0.15, waist], [0.165, waist + 0.08], [0.19, waist + 0.2], [0.205, top - 0.1], [0.2, top - 0.04], [0.16, top - 0.005], [0.07, top],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const torso = new THREE.LatheGeometry(profile, 20);
  torso.scale(1, 1, 0.72);
  parts.push(paint(torso, p => {
    if (p.y > top - 0.035) return c.trim;
    const side = Math.abs(p.x) / 0.2;
    return !keeper && side > 0.93 && p.y < top - 0.06 ? c.trim : c.kit;
  }));
  // Shoulders: rounded caps in the shirt colour.
  for (const s of [-1, 1]) {
    const cap = new THREE.SphereGeometry(0.085, 10, 8);
    cap.translate(s * 0.2, top - 0.07, 0);
    parts.push(solid(cap, c.kit));
  }
  const shorts = new THREE.LatheGeometry([[0.165, waist + 0.02], [0.175, hip], [0.17, hip - 0.06]].map(([r, y]) => new THREE.Vector2(r, y)), 18);
  shorts.scale(1, 1, 0.78);
  parts.push(solid(shorts, c.shorts));
  const neck = new THREE.CylinderGeometry(0.052, 0.06, 0.1, 10);
  neck.translate(0, top + 0.03, 0);
  parts.push(solid(neck, c.skin));
  const head = new THREE.SphereGeometry(0.1, 16, 14);
  head.scale(0.98, 1.18, 1.06);
  head.translate(0, h * 0.905, 0.008);
  parts.push(solid(head, c.skin));
  const hair = new THREE.SphereGeometry(0.106, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.52);
  hair.scale(0.98, 1.12, 1.08);
  hair.rotateX(-0.25);
  hair.translate(0, h * 0.915, -0.006);
  parts.push(solid(hair, c.hair));
  // Nose: a hint of a face, so the figure's facing reads at a glance.
  const nose = new THREE.ConeGeometry(0.018, 0.04, 6);
  nose.rotateX(Math.PI / 2);
  nose.translate(0, h * 0.9, 0.112);
  parts.push(solid(nose, c.skin));
  const merged = mergeGeometries(parts.map(g => g.toNonIndexed()))!;
  merged.computeVertexNormals();
  return merged;
}

/** Thigh with the shorts' leg opening; shin with the sock; both hang from their joint. */
export function thighGeometry(length: number, c: FigureColours): THREE.BufferGeometry {
  return paint(limb(length, 0.082, 0.058), p => (p.y > -length * 0.32 ? c.shorts : c.skin));
}

export function shinGeometry(length: number, c: FigureColours): THREE.BufferGeometry {
  return paint(limb(length, 0.058, 0.04), p => (p.y > -length * 0.2 ? c.skin : c.socks));
}

/** Upper arm with a short sleeve (long sleeve for keepers); forearm ending in the hand or glove. */
export function upperArmGeometry(length: number, c: FigureColours, keeper: boolean): THREE.BufferGeometry {
  return paint(limb(length, 0.055, 0.042), p => (keeper || p.y > -length * 0.5 ? c.kit : c.skin));
}

export function forearmGeometry(length: number, c: FigureColours, keeper: boolean): THREE.BufferGeometry {
  const arm = paint(limb(length, 0.042, 0.033), () => (keeper ? c.kit : c.skin));
  const hand = new THREE.SphereGeometry(keeper ? 0.062 : 0.045, 10, 8);
  hand.scale(0.8, 1.2, 0.6);
  hand.translate(0, -length - 0.04, 0);
  const merged = mergeGeometries([arm.toNonIndexed(), solid(hand, keeper ? c.glove : c.skin).toNonIndexed()])!;
  merged.computeVertexNormals();
  return merged;
}

/** Boot: a low, rounded last pointing along +Z (the foot's forward), with a coloured sole flash. */
export function bootGeometry(c: FigureColours): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(0.048, 0.17, 4, 10);
  g.rotateX(Math.PI / 2);
  g.scale(1, 0.72, 1);
  g.translate(0, 0.0, 0.035);
  return paint(g, p => (p.y < -0.02 ? c.trim : c.boot));
}
