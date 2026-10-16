import * as THREE from 'three';
import type { MatchEvent, MatchSnapshot } from '../engine/types';
import { PITCH } from '../physics/pitch-geometry';
import { STANDS } from '../physics/pitch-colliders';

export type Shot = 'main' | 'close' | 'behind-goal' | 'decision' | 'wide';

/**
 * TV direction. The main gantry camera follows play with some anticipation; real events trigger cuts
 * (a decision moment frames the focus player, a goal cuts behind the goal, then wide on the celebration).
 * The camera never shows something that did not happen; it only chooses how to look at it.
 */
export class CameraDirector {
  shot: Shot = 'main';
  manual: Shot | null = null;
  private holdUntil = 0;
  private readonly target = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly lookNow = new THREE.Vector3();
  private goalSide = 1;
  private celebrating = false;

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
      this.holdUntil = wallTime + 2.5;
    } else if (e.type === 'kickoff' || e.type === 'in-play') {
      this.celebrating = false;
    }
  }

  private cut(shot: Shot, wallTime: number, hold: number): void {
    this.shot = shot;
    this.holdUntil = wallTime + hold;
  }

  update(s: MatchSnapshot, wallTime: number, dt: number): void {
    if (wallTime > this.holdUntil && this.shot !== 'main') {
      this.shot = this.celebrating && this.shot === 'behind-goal' ? 'wide' : 'main';
      if (this.shot === 'wide') this.holdUntil = wallTime + 3;
    }
    const shot = this.manual ?? this.shot;
    const b = s.ball.position;
    const v = s.ball.velocity;
    let snap = false;
    switch (shot) {
      case 'main': {
        const lead = { x: b.x + v.x * 0.6, z: b.z + v.z * 0.4 };
        this.target.set(lead.x * 0.82, 21, STANDS.z + 4);
        this.look.set(lead.x, 0, lead.z * 0.55);
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
      case 'decision': {
        // Tactical overview of the situation: high behind the focus player, looking up the pitch,
        // so the user sees team-mates, opponents and space before deciding.
        const focus = s.moment ? s.players[s.moment.focusPlayer].position : b;
        const sign = s.moment ? (s.players[s.moment.focusPlayer].velocity.x >= 0 ? 1 : -1) : Math.sign(b.x) || 1;
        this.target.set(focus.x - sign * 20, 17, Math.max(-PITCH.halfWidth, Math.min(PITCH.halfWidth, focus.z * 0.6)) + 14);
        this.look.set(focus.x + sign * 12, 0, focus.z * 0.8);
        snap = true;
        break;
      }
    }
    const k = snap && this.camera.position.distanceTo(this.target) > 20 ? 1 : 1 - Math.exp(-dt * (shot === 'main' ? 1.8 : 2.6));
    this.camera.position.lerp(this.target, k);
    this.lookNow.lerp(this.look, k);
    this.camera.lookAt(this.lookNow);
  }
}
