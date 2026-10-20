import * as THREE from 'three';
import type { DecisionMoment, MatchSnapshot, OptionVisual, TeamId, Vec2 } from '../engine/types';
import { PITCH } from '../physics/pitch-geometry';

/**
 * Tactical markings on the 3D pitch for an open decision moment, drawn only from the options' own visual data (the
 * frozen state they were offered in): the acting player's ring, rings for team-mates and opponents involved, the ball
 * path of each option (ground, lofted, shot, throw, carry), ordered runs, target zones and line shifts. Each option's
 * marks carry its key number; the focused option is bright, the others step back.
 */
const ACCENT = new THREE.Color('#ff8a2a'), MATE = new THREE.Color('#f3f6fb'), OPP = new THREE.Color('#ff5470'), LINE = new THREE.Color('#4cc3ff');
const GROUND = 0.04;

type OptionMarks = { group: THREE.Group; materials: THREE.Material[] };

function material(colour: THREE.Color, opacity = 0.95): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
}

/** A flat ring on the turf. */
function ring(at: Vec2, radius: number, width: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.RingGeometry(radius - width, radius, 40), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(at.x, GROUND, at.z);
  m.renderOrder = 2;
  return m;
}

/** A tube along a path with an arrow head at its end. */
function arrow(points: THREE.Vector3[], radius: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3(points);
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, points.length * 6), radius, 6, false), mat);
  tube.renderOrder = 3;
  g.add(tube);
  const end = points[points.length - 1], before = curve.getPointAt(0.97);
  const head = new THREE.Mesh(new THREE.ConeGeometry(radius * 3.2, radius * 8, 10), mat);
  head.position.copy(end);
  head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(before).normalize());
  head.renderOrder = 3;
  g.add(head);
  return g;
}

/** Dashes on the turf from a to b (a run). */
function dashes(a: Vec2, b: Vec2, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(2, Math.floor(d / 1.1));
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 0.55) / n;
    const s = new THREE.Mesh(new THREE.PlaneGeometry(d * (t1 - t0), 0.16), mat);
    s.rotation.set(-Math.PI / 2, 0, -Math.atan2(b.z - a.z, b.x - a.x));
    s.position.set(a.x + (b.x - a.x) * (t0 + t1) / 2, GROUND, a.z + (b.z - a.z) * (t0 + t1) / 2);
    s.renderOrder = 2;
    g.add(s);
  }
  g.add(ring(b, 0.55, 0.14, mat));
  return g;
}

/** The option's key number floating above the end of its path. */
function label(n: number, at: THREE.Vector3, colour: THREE.Color): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = `#${colour.getHexString()}`;
  x.beginPath(); x.arc(64, 64, 54, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#060b16'; x.font = '900 72px Bahnschrift, Segoe UI, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(String(n), 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.setScalar(1.5);
  s.position.copy(at).add(new THREE.Vector3(0, 1.6, 0));
  s.renderOrder = 5;
  return s;
}

/** The ball's path for one option, from where the ball lies now. */
function ballPath(from: THREE.Vector3, b: NonNullable<OptionVisual['ball']>): THREE.Vector3[] {
  const to = new THREE.Vector3(b.to.x, GROUND + 0.06, b.to.z);
  const start = new THREE.Vector3(from.x, b.kind === 'throw' ? 2.3 : 0.12, from.z);
  const d = start.distanceTo(to);
  const arc = (height: number) => Array.from({ length: 13 }, (_, i) => {
    const t = i / 12;
    return new THREE.Vector3(start.x + (to.x - start.x) * t, start.y + (to.y - start.y) * t + 4 * height * t * (1 - t), start.z + (to.z - start.z) * t);
  });
  if (b.kind === 'lofted') return arc(Math.min(9, 0.2 * d));
  if (b.kind === 'throw') return arc(Math.min(3, 0.12 * d));
  if (b.kind === 'shot') return arc(0.6).map((p, i) => (i === 12 ? new THREE.Vector3(to.x, 1.0, to.z) : p));
  return [start, to];
}

export class TacticalOverlay {
  readonly group = new THREE.Group();
  private marks: OptionMarks[] = [];
  private pulse: THREE.Mesh | null = null;
  private focused = -1;

  show(m: DecisionMoment, s: MatchSnapshot, team: (id: number) => TeamId): void {
    this.hide();
    const actor = s.players[m.focusPlayer].position;
    const ball = new THREE.Vector3(s.ball.position.x, s.ball.position.y, s.ball.position.z);
    // Who is who: the actor in the accent colour, other involved players by side.
    const base = new THREE.Group();
    this.pulse = ring(actor, 1.05, 0.18, material(ACCENT));
    base.add(this.pulse);
    // The ball itself: a white ring on the turf and a marker above it, so it is found at a glance.
    base.add(ring({ x: ball.x, z: ball.z }, 0.5, 0.09, material(MATE)));
    const pin = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 12), material(MATE));
    pin.rotation.x = Math.PI;
    pin.position.set(ball.x, ball.y + 1.1, ball.z);
    pin.renderOrder = 4;
    base.add(pin);
    for (const id of m.participants) {
      if (id === m.focusPlayer) continue;
      const p = s.players[id];
      if (p.sentOff) continue;
      base.add(ring(p.position, 0.75, 0.1, material(team(id) === m.team ? MATE : OPP, 0.75)));
    }
    this.group.add(base);
    m.options.forEach((o, i) => {
      const g = new THREE.Group();
      const colour = ACCENT;
      const mats: THREE.Material[] = [];
      const mat = (c: THREE.Color, op = 0.95) => { const x = material(c, op); mats.push(x); return x; };
      const v = o.visual;
      let end = new THREE.Vector3(actor.x, 0, actor.z);
      if (v?.ball) {
        const path = ballPath(ball, v.ball);
        g.add(arrow(path, v.ball.kind === 'dribble' ? 0.07 : 0.09, mat(colour)));
        end = path[path.length - 1];
        if (v.ball.receiver !== undefined) g.add(ring(s.players[v.ball.receiver].position, 0.95, 0.16, mat(colour)));
      }
      for (const r of v?.runs ?? []) {
        g.add(dashes(s.players[r.player].position, r.to, mat(MATE, 0.9)));
        if (!v?.ball) end = new THREE.Vector3(r.to.x, 0, r.to.z);
      }
      if (v?.zone) {
        const z = new THREE.Mesh(new THREE.CircleGeometry(v.zone.r, 40), mat(colour, 0.18));
        z.rotation.x = -Math.PI / 2; z.position.set(v.zone.x, GROUND - 0.005, v.zone.z); z.renderOrder = 1;
        g.add(z, ring(v.zone, v.zone.r, 0.12, mat(colour, 0.8)));
        if (!v.ball && !v.runs) end = new THREE.Vector3(v.zone.x, 0, v.zone.z);
      }
      if (v?.line && Math.abs(v.line.to - v.line.from) > 0.3) {
        // The defensive line: where it stands now (thin) and where this instruction moves it (bold), across the pitch.
        const across = (x: number, w: number, c: THREE.Color, op: number) => {
          const l = new THREE.Mesh(new THREE.PlaneGeometry(w, PITCH.width - 4), mat(c, op));
          l.rotation.x = -Math.PI / 2; l.position.set(x, GROUND, 0); l.renderOrder = 2;
          return l;
        };
        g.add(across(v.line.from, 0.12, LINE, 0.5), across(v.line.to, 0.3, LINE, 0.9));
        const z0 = actor.z > 0 ? actor.z - 6 : actor.z + 6;
        g.add(arrow([new THREE.Vector3(v.line.from, GROUND + 0.05, z0), new THREE.Vector3(v.line.to, GROUND + 0.05, z0)], 0.08, mat(LINE)));
        if (!v.ball && !v.runs && !v.zone) end = new THREE.Vector3(v.line.to, 0, z0);
      }
      const tag = label(i + 1, end, colour);
      mats.push(tag.material);
      g.add(tag);
      this.group.add(g);
      this.marks.push({ group: g, materials: mats });
    });
    this.focus(m.options.findIndex(o => o.id === m.defaultOptionId));
  }

  /** Highlights one option's marks; the others fade back (−1: all equal). */
  focus(index: number): void {
    this.focused = index;
    this.marks.forEach((mk, i) => {
      const on = index < 0 || i === index;
      for (const m of mk.materials) {
        const base = (m.userData.opacity as number | undefined) ?? (m as THREE.MeshBasicMaterial).opacity;
        m.userData.opacity = base;
        (m as THREE.MeshBasicMaterial).opacity = on ? base : base * 0.22;
      }
      mk.group.renderOrder = on ? 4 : 1;
    });
  }

  get focusedIndex(): number {
    return this.focused;
  }

  update(time: number): void {
    if (this.pulse) this.pulse.scale.setScalar(1 + 0.12 * Math.sin(time * 5));
  }

  hide(): void {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.traverse(o => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
          o.geometry.dispose();
          const m = o.material as THREE.Material & { map?: THREE.Texture | null };
          m.map?.dispose();
          m.dispose();
        }
      });
    }
    this.marks = [];
    this.pulse = null;
    this.focused = -1;
  }
}
