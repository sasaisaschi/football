import * as THREE from 'three';
import type { DecisionMoment, DecisionOption, MatchSnapshot, TeamId, Vec2 } from '../engine/types';
import { PITCH } from '../physics/pitch-geometry';
import { dashedArc, glowRing, targetFan } from './marking-shapes';

/**
 * Markings on the 3D pitch for an open decision, in the style of the client's reference picture, drawn only from the
 * options' own visual data (the frozen state they were offered in): a glowing ring under the acting player, the same
 * ring under a receiver, thin rings under team-mates involved, a dashed curved arrow for each option's ball (blue for a
 * pass, yellow for a shot, rising to the goal and ending in a yellow fan at the goal mouth), dashes for ordered runs,
 * target zones and line shifts. The focused option is bright, the others step back.
 */
export type MarkKind = 'pass' | 'shot' | 'carry' | 'other';
/** Colours of the reference picture: the pass arrow and rings, the shot arrow, a carry, other instructions. */
export const MARK_COLOUR: Record<MarkKind, string> = { pass: '#3ab2ec', shot: '#fce10d', carry: '#7edfd6', other: '#f3f6fb' };
const RING = '#55c7f5', MATE_RING = '#7fd0f0', LINE = '#3ab2ec';
const GROUND = 0.03;

/** What kind of marking an option gets (its colour on the pitch and in the panel). */
export function markKind(o: DecisionOption): MarkKind {
  const b = o.visual?.ball;
  if (!b) return 'other';
  return b.kind === 'shot' ? 'shot' : b.kind === 'dribble' ? 'carry' : 'pass';
}

type OptionMarks = { group: THREE.Group; materials: THREE.Material[] };

export class TacticalOverlay {
  readonly group = new THREE.Group();
  private marks: OptionMarks[] = [];
  private pulse: THREE.Object3D | null = null;
  private focused = -1;
  /** The markings can be switched off from the scene's toolbar (the reference's first button). */
  enabled = true;

  /** `eye`: where the camera will stand, so the rising shot arrow faces it. */
  show(m: DecisionMoment, s: MatchSnapshot, team: (id: number) => TeamId, eye: THREE.Vector3): void {
    this.hide();
    const actor = s.players[m.focusPlayer].position;
    const ball = new THREE.Vector3(s.ball.position.x, s.ball.position.y, s.ball.position.z);
    const base = new THREE.Group();
    this.pulse = glowRing({ x: actor.x, z: actor.z }, 1.05, RING, 1);
    base.add(this.pulse);
    // Team-mates involved (not receivers of a ball option, who get the full ring): a thin ring, as the reference's #11.
    const receivers = new Set(m.options.map(o => o.visual?.ball?.receiver).filter((r): r is number => r !== undefined));
    for (const id of m.participants) {
      if (id === m.focusPlayer || receivers.has(id) || team(id) !== m.team) continue;
      const p = s.players[id];
      if (!p.sentOff) base.add(glowRing({ x: p.position.x, z: p.position.z }, 0.8, MATE_RING, 0.55, true));
    }
    this.group.add(base);
    m.options.forEach(o => {
      const g = new THREE.Group();
      const kind = markKind(o);
      const colour = MARK_COLOUR[kind];
      const v = o.visual;
      if (v?.ball) {
        const to = v.ball.to;
        if (v.ball.kind === 'shot') {
          // Rises from the ball to the goal: a dashed arc facing the camera, a yellow fan where it ends.
          const end = new THREE.Vector3(to.x, 0.75, to.z);
          g.add(dashedArc(ball.clone().setY(0.15), end, { colour, lift: 1.4, bend: 0.06, eye, width: 0.15 }));
          g.add(targetFan(end, to.x >= 0 ? 1 : -1, colour));
        } else {
          const receiver = v.ball.receiver !== undefined ? s.players[v.ball.receiver].position : null;
          // A pass ends at the edge of the receiver's ring (the ring shows where he is, the arrow where the ball goes).
          const aim = new THREE.Vector3(to.x, GROUND, to.z);
          const from = ball.clone().setY(GROUND);
          const len = from.distanceTo(aim);
          const end = receiver && aim.distanceTo(new THREE.Vector3(receiver.x, GROUND, receiver.z)) < 1.6 ? from.clone().lerp(aim, Math.max(0, (len - 1.1) / len)) : aim;
          g.add(dashedArc(from, end, { colour, lift: v.ball.kind === 'lofted' ? Math.min(6, len * 0.18) : 0, bend: 0.1, eye, width: v.ball.kind === 'dribble' ? 0.18 : 0.22 }));
          if (receiver) g.add(glowRing({ x: receiver.x, z: receiver.z }, 0.95, RING, 0.95));
        }
      }
      for (const r of v?.runs ?? []) {
        const p = s.players[r.player].position;
        g.add(dashedArc(new THREE.Vector3(p.x, GROUND, p.z), new THREE.Vector3(r.to.x, GROUND, r.to.z), { colour: MATE_RING, lift: 0, bend: 0, eye, width: 0.16 }));
        g.add(glowRing(r.to, 0.6, MATE_RING, 0.7, true));
      }
      if (v?.zone) g.add(glowRing(v.zone, v.zone.r, colour, 0.85, false, 0.16));
      if (v?.line && Math.abs(v.line.to - v.line.from) > 0.3) g.add(lineShift(v.line.from, v.line.to, actor));
      this.group.add(g);
      const materials: THREE.Material[] = [];
      g.traverse(x => { if ((x as THREE.Mesh).material) materials.push((x as THREE.Mesh).material as THREE.Material); });
      this.marks.push({ group: g, materials });
    });
    this.group.visible = this.enabled;
    this.focus(m.options.findIndex(o => o.id === m.defaultOptionId));
  }

  /** Highlights one option's marks; the others step back (−1: all equal). */
  focus(index: number): void {
    this.focused = index;
    this.marks.forEach((mk, i) => {
      const on = index < 0 || i === index;
      for (const m of mk.materials) {
        const base = (m.userData.opacity as number | undefined) ?? (m as THREE.MeshBasicMaterial).opacity;
        m.userData.opacity = base;
        (m as THREE.MeshBasicMaterial).opacity = on ? base : base * 0.55;
      }
      mk.group.renderOrder = on ? 4 : 1;
    });
  }

  get focusedIndex(): number {
    return this.focused;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.group.visible = on;
  }

  update(time: number): void {
    // The acting player's ring breathes gently.
    if (this.pulse) this.pulse.scale.setScalar(1 + 0.05 * Math.sin(time * 4));
  }

  hide(): void {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.traverse(o => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const m = o.material as THREE.Material & { map?: THREE.Texture | null };
          if (!m.userData.sharedMap) m.map?.dispose();
          m.dispose();
        }
      });
    }
    this.marks = [];
    this.pulse = null;
    this.focused = -1;
  }
}

/** The defensive line: where it stands now (thin) and where the instruction moves it (bold), across the pitch. */
function lineShift(from: number, to: number, actor: Vec2): THREE.Group {
  const g = new THREE.Group();
  const across = (x: number, w: number, op: number) => {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(w, PITCH.width - 4), new THREE.MeshBasicMaterial({ color: LINE, transparent: true, opacity: op, depthWrite: false }));
    l.rotation.x = -Math.PI / 2; l.position.set(x, GROUND, 0); l.renderOrder = 2;
    return l;
  };
  g.add(across(from, 0.12, 0.5), across(to, 0.3, 0.9));
  const z0 = actor.z > 0 ? actor.z - 6 : actor.z + 6;
  g.add(dashedArc(new THREE.Vector3(from, GROUND, z0), new THREE.Vector3(to, GROUND, z0), { colour: LINE, lift: 0, bend: 0, eye: new THREE.Vector3(0, 50, 0), width: 0.22 }));
  return g;
}
