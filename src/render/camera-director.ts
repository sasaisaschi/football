import * as THREE from 'three';
import type { MatchEvent, MatchSnapshot } from '../engine/types';
import { PITCH } from '../physics/pitch-geometry';
import { STANDS } from '../physics/pitch-colliders';
import type { Framing } from './framing';

export type Shot = 'main' | 'close' | 'behind-goal' | 'decision' | 'wide' | 'overview' | 'follow';

/**
 * Vertical field of view (degrees). The live broadcast shot is tighter, like a TV main camera, so the players are large
 * enough to recognise (at 36° a player was ≈ 40 px tall on a 1600 × 900 screen); every other shot, and the decision
 * framing that is computed for it, uses the wider angle.
 */
export const BROADCAST_FOV = 27, WIDE_FOV = 36;
/** The scene's following shot: low and close on the near side, a long lens, so the players fill the picture. */
export const FOLLOW_FOV = 24;

/**
 * TV direction. The main gantry camera follows play with some anticipation; real events trigger cuts
 * (a decision moment frames the focus player, a goal cuts behind the goal, then wide on the celebration).
 * The camera never shows something that did not happen; it only chooses how to look at it.
 */
/**
 * How far the main camera's look point follows the ball across the pitch. The gantry stands behind the near
 * touchline (z = +34) and looks down on it at a steep angle: following with 0.55 everywhere, play at the near line
 * (throw-ins, corners) lay 24° below the image centre, outside the 18° half field of view. Towards the near line the
 * look point follows more, up to 1.0 (with the tighter broadcast angle the touchline stays clear of the status line).
 */
export function nearSideFollow(z: number): number {
  return 0.55 + 0.45 * Math.max(0, Math.min(1, (z - 10) / 24));
}

export class CameraDirector {
  shot: Shot = 'main';
  manual: Shot | null = null;
  private holdUntil = 0;
  private readonly target = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly lookNow = new THREE.Vector3();
  private goalSide = 1;
  private celebrating = false;
  /** Set by the app for an open moment: the framing that shows every relevant player beside the interface. */
  decisionFrame: Framing | null = null;
  /** While play is condensed the picture is a high overview of the whole half instead of the broadcast shot. */
  condensed = false;
  /** In a decisive scene the main shot is the close following shot. */
  scene = false;
  /** Smoothed direction of play along the pitch, for the following shot to trail it. */
  private flow = 1;

  constructor(readonly camera: THREE.PerspectiveCamera) {
    camera.position.set(0, 22, STANDS.z + 6);
    this.lookNow.set(0, 0, 0);
  }

  onEvent(e: MatchEvent, wallTime: number): void {
    if (e.type === 'goal') {
      this.goalSide = Math.sign(e.position.x) || 1;
      this.cut('behind-goal', wallTime, 3.2);
      this.celebrating = true;
    } else if (e.type === 'moment') {
      this.cut('decision', wallTime, 600);
    } else if (e.type === 'decision') {
      this.decisionFrame = null;
      this.holdUntil = wallTime + 1.2;
    } else if (e.type === 'kickoff' || e.type === 'in-play') {
      this.celebrating = false;
    }
  }

  /** Hard cut to a shot (a scene starts, freezes or resumes); `s` places the camera at once. */
  cutTo(shot: Shot, s: MatchSnapshot | null): void {
    this.shot = shot === 'follow' ? 'main' : shot;
    this.holdUntil = shot === 'decision' ? Infinity : 0;
    this.celebrating = false;
    if (s && shot === 'follow') { this.flow = Math.sign(s.ball.velocity.x) || this.flow; this.snapNext = true; }
  }

  private snapNext = false;

  private cut(shot: Shot, wallTime: number, hold: number): void {
    this.shot = shot;
    this.holdUntil = wallTime + hold;
  }

  update(s: MatchSnapshot, wallTime: number, dt: number): void {
    if (wallTime > this.holdUntil && this.shot !== 'main') {
      this.shot = this.celebrating && this.shot === 'behind-goal' ? 'wide' : 'main';
      if (this.shot === 'wide') this.holdUntil = wallTime + 3;
    }
    const shot = this.manual ?? (this.shot === 'main' ? (this.scene ? 'follow' : this.condensed ? 'overview' : 'main') : this.shot);
    const b = s.ball.position;
    const v = s.ball.velocity;
    let snap = false;
    switch (shot) {
      case 'main': {
        const lead = { x: b.x + v.x * 0.6, z: b.z + v.z * 0.4 };
        this.target.set(lead.x * 0.82, 18, STANDS.z + 2);
        this.look.set(lead.x, 0, lead.z * nearSideFollow(lead.z));
        break;
      }
      case 'follow': {
        // Trails play from the near side, low, with a long lens; the direction of play turns slowly, not with every touch.
        if (Math.abs(v.x) > 2) this.flow += (Math.sign(v.x) - this.flow) * Math.min(1, dt * 0.8);
        const lead = { x: b.x + v.x * 0.35, z: b.z + v.z * 0.25 };
        this.target.set(lead.x - this.flow * 9, 7.5, Math.min(STANDS.z - 1, lead.z + 21));
        this.look.set(lead.x + this.flow * 2, 0.9, lead.z);
        if (this.snapNext) { snap = true; this.snapNext = false; }
        break;
      }
      case 'close': {
        this.target.set(b.x - 11, 7, b.z + 15);
        this.look.set(b.x, 0.6, b.z);
        break;
      }
      case 'behind-goal': {
        this.target.set(this.goalSide * (PITCH.halfLength + 9), 3.2, 0);
        this.look.set(this.goalSide * (PITCH.halfLength - 16), 1, b.z * 0.3);
        snap = true;
        break;
      }
      case 'wide': {
        this.target.set(0, 45, STANDS.z + 12);
        this.look.set(this.goalSide * 25, 0, 0);
        break;
      }
      case 'overview': {
        // Condensed play: high above the broadcast side, the whole half in view, so fast-forwarded play stays readable.
        this.target.set(b.x * 0.55, 46, STANDS.z + 10);
        this.look.set(b.x * 0.75, 0, b.z * 0.25);
        break;
      }
      case 'decision': {
        if (this.decisionFrame) {
          this.target.copy(this.decisionFrame.position);
          this.look.copy(this.decisionFrame.target);
          break;
        }
        // Without a framing yet: high behind the focus player, looking up the pitch.
        const focus = s.moment ? s.players[s.moment.focusPlayer].position : b;
        const sign = s.moment ? (s.players[s.moment.focusPlayer].velocity.x >= 0 ? 1 : -1) : Math.sign(b.x) || 1;
        this.target.set(focus.x - sign * 20, 17, Math.max(-PITCH.halfWidth, Math.min(PITCH.halfWidth, focus.z * 0.6)) + 14);
        this.look.set(focus.x + sign * 12, 0, focus.z * 0.8);
        snap = true;
        break;
      }
    }
    // A decision moment flies to its framing quickly (it must be readable at once); other cuts are hard.
    const rate = shot === 'main' || shot === 'overview' ? 1.8 : shot === 'decision' ? 2.2 : shot === 'follow' ? 2.4 : 2.6;
    const k = snap && shot !== 'decision' && (shot === 'follow' || this.camera.position.distanceTo(this.target) > 20) ? 1 : 1 - Math.exp(-dt * rate);
    this.camera.position.lerp(this.target, k);
    this.lookNow.lerp(this.look, k);
    const fov = shot === 'main' ? BROADCAST_FOV : shot === 'follow' ? FOLLOW_FOV : WIDE_FOV;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * (k === 1 ? 1 : shot === 'decision' ? Math.min(1, k * 1.2) : k);
      this.camera.updateProjectionMatrix();
    }
    this.camera.lookAt(this.lookNow);
  }
}
