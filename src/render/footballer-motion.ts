import * as THREE from 'three';
import CLIPS from './footballer-clips.json';

/**
 * Motion capture on the footballer (clips from the CMU database, retargeted by scripts/figure/cmu_clips.py).
 *
 * Locomotion: walk, jog, run and sprint play together, weighted by the body's real speed, all at one shared stride
 * phase. The phase advances with the distance the body actually covers (distance / stride length of the blend), not
 * with the clock, so a foot on the ground stays where it is – the figure runs instead of gliding. Running backwards
 * plays the cycle backwards. Standing plays the idle clip (an actor waiting calmly).
 *
 * Strike: when a boot starts a swing the strike clip runs, timed so that its contact frame falls where the physics
 * contact will be; it moves the trunk, hips and arms. The legs themselves are then posed onto the physics boots by the
 * figure (footballer.ts), because the boots decide what the ball does.
 */
type ClipInfo = { name: string; duration: number; speed: number; cycle: number; contact?: number };
const INFO = new Map((CLIPS.clips as ClipInfo[]).map(c => [c.name, c]));
const GAITS = ['walk', 'jog', 'run', 'sprint'] as const;
/** Time from the start of a swing to the boot's contact with the ball, typical of the physics swings (legs.ts: wind-up 0.1–0.2 s plus the strike). */
const SWING_TO_CONTACT = 0.24;
/** How fast a strike fades in and out (1/s). */
const STRIKE_FADE = 12;
/** Below this speed (m/s) the idle clip takes over from the walk. */
const IDLE_UNTIL = 0.9;

export class Motion {
  private readonly mixer: THREE.AnimationMixer;
  private readonly gaits: { action: THREE.AnimationAction; info: ClipInfo }[];
  private readonly strikes: [THREE.AnimationAction, THREE.AnimationAction];
  private readonly idle: THREE.AnimationAction;
  private idleTime = Math.random() * 2;
  private readonly strikeContact: number;
  /** Shared stride phase 0…1 of all gaits. */
  private phase = Math.random();
  private strike = { side: -1 as -1 | 0 | 1, since: 0, weight: 0 };
  /** Weight of the strike clip now (0…1), for the figure to blend its leg IK the same way. */
  strikeWeight = 0;

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(root);
    const clip = (name: string) => {
      const c = clips.find(x => x.name === name);
      if (!c) throw new Error(`footballer model: motion clip "${name}" missing`);
      return c;
    };
    const play = (c: THREE.AnimationClip) => {
      const a = this.mixer.clipAction(c);
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.play();
      a.paused = true; // time is set from the stride phase, not from the clock
      a.setEffectiveWeight(0);
      return a;
    };
    this.gaits = GAITS.map(n => ({ action: play(clip(n)), info: INFO.get(n)! }));
    this.idle = play(clip('idle'));
    // Side 0 is the figure's left (+x), the side of physics boot 0.
    this.strikes = [play(clip('kickL')), play(clip('kickR'))];
    this.strikeContact = INFO.get('kickR')!.contact ?? 0.3;
  }

  /**
   * Poses the skeleton for this frame. `forward`/`lateral`: the body's velocity in its own frame (m/s);
   * `swingingBoot`: the boot in a swing (−1 none); `dt`: shown time since the last frame (s, already slowed in slow motion).
   */
  update(forward: number, lateral: number, swingingBoot: -1 | 0 | 1, dt: number): void {
    const speed = Math.hypot(forward, lateral);
    // Blend weights over the four gaits by speed; below the walk the walk fades towards its standing moment.
    const speeds = this.gaits.map(g => g.info.speed);
    const w = speeds.map(() => 0);
    if (speed <= speeds[0]) w[0] = 1;
    else if (speed >= speeds[speeds.length - 1]) w[w.length - 1] = 1;
    else for (let i = 0; i < speeds.length - 1; i++) if (speed >= speeds[i] && speed < speeds[i + 1]) { const k = (speed - speeds[i]) / (speeds[i + 1] - speeds[i]); w[i] = 1 - k; w[i + 1] = k; }
    // Stride phase from the distance covered: the blend's stride length is the weighted stride of the gaits.
    const stride = this.gaits.reduce((s, g, i) => s + w[i] * g.info.cycle, 0);
    const backwards = forward < -0.3 && Math.abs(forward) > Math.abs(lateral) * 0.5;
    if (speed > 0.15) this.phase = (this.phase + (backwards ? -1 : 1) * (speed * dt) / stride + 1) % 1;
    else this.phase = this.phase + (Math.round(this.phase * 2) / 2 - this.phase) * Math.min(1, dt * 4); // settle into double support
    // Strike timing.
    const s = this.strike;
    if (swingingBoot !== -1 && s.side !== swingingBoot) { s.side = swingingBoot; s.since = 0; }
    if (s.side !== -1) s.since += dt; // the clip runs on through its follow-through while it fades out
    const target = swingingBoot !== -1 ? 1 : 0;
    s.weight += (target - s.weight) * Math.min(1, dt * STRIKE_FADE);
    if (swingingBoot === -1 && s.weight < 0.02) s.side = -1;
    this.strikeWeight = s.side === -1 ? 0 : s.weight;
    // Standing still: the idle clip (played back and forth), crossing over into the walk up to walking pace.
    const idle = Math.max(0, 1 - speed / IDLE_UNTIL) * (1 - this.strikeWeight);
    this.idleTime += dt;
    const d = this.idle.getClip().duration, k = this.idleTime % (2 * d);
    this.idle.time = k < d ? k : 2 * d - k;
    this.idle.setEffectiveWeight(idle);
    const gaitShare = 1 - this.strikeWeight - idle;
    this.gaits.forEach((g, i) => {
      g.action.setEffectiveWeight(w[i] * gaitShare);
      g.action.time = this.phase * g.action.getClip().duration;
    });
    this.strikes.forEach((a, side) => {
      const on = side === s.side;
      a.setEffectiveWeight(on ? this.strikeWeight : 0);
      if (on) a.time = Math.max(0, Math.min(a.getClip().duration - 1e-3, this.strikeContact - SWING_TO_CONTACT + s.since));
    });
    this.mixer.update(0);
  }
}
