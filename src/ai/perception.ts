import type { PlayerProfile, Vec2, Vec3 } from '../engine/types';
import type { Rng } from '../engine/rng';

/** What one player believes about another, or about the ball, at the time he last looked. */
export type Sighting = { pos: Vec2; vel: Vec2; seenAt: number };
export type BallSighting = { pos: Vec3; vel: Vec3; spin: Vec3; seenAt: number };

export type TruthPlayer = { id: number; pos: Vec2; vel: Vec2 };
export type Truth = { now: number; ball: { pos: Vec3; vel: Vec3; spin: Vec3 }; players: TruthPlayer[] };

/**
 * Limited perception. A player refreshes his picture a few times per second, but only what lies inside his
 * field of view; behind him he only updates during a shoulder check. Position estimates get noisier with
 * distance and poorer vision. Decisions are made from this picture, never from the true state.
 */
export class Perception {
  ball: BallSighting = { pos: { x: 0, y: 0.11, z: 0 }, vel: { x: 0, y: 0, z: 0 }, spin: { x: 0, y: 0, z: 0 }, seenAt: -1 };
  readonly others = new Map<number, Sighting>();
  private nextLook = 0;
  private nextShoulderCheck = 0;
  private readonly interval: number;
  private readonly shoulderInterval: number;
  private readonly noise: number;
  private readonly halfFov = (110 * Math.PI) / 180;

  constructor(private readonly self: PlayerProfile, private readonly rng: Rng) {
    const vision = self.abilities.vision;
    this.interval = 0.22 - 0.1 * vision;
    this.shoulderInterval = 2.4 - 1.2 * vision;
    this.noise = 0.035 * (1.25 - vision);
    this.nextLook = rng.range(0, this.interval);
    this.nextShoulderCheck = rng.range(0, this.shoulderInterval);
  }

  /** Called every tick; only refreshes when the player actually looks. Returns true on a refresh. */
  observe(truth: Truth, selfPos: Vec2, heading: number): boolean {
    if (truth.now < this.nextLook) return false;
    this.nextLook = truth.now + this.interval;
    const all = truth.now >= this.nextShoulderCheck;
    if (all) this.nextShoulderCheck = truth.now + this.shoulderInterval;
    const fx = Math.sin(heading), fz = Math.cos(heading);
    const visible = (x: number, z: number) => {
      if (all) return true;
      const dx = x - selfPos.x, dz = z - selfPos.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.5) return true; // felt rather than seen
      return Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d))) <= this.halfFov;
    };
    const blur = (x: number, z: number) => this.noise * Math.hypot(x - selfPos.x, z - selfPos.z);
    const b = truth.ball;
    if (visible(b.pos.x, b.pos.z)) {
      const e = blur(b.pos.x, b.pos.z) * 0.5;
      this.ball = {
        pos: { x: b.pos.x + this.rng.gauss() * e, y: b.pos.y, z: b.pos.z + this.rng.gauss() * e },
        vel: { x: b.vel.x * (1 + this.rng.gauss() * 0.05), y: b.vel.y, z: b.vel.z * (1 + this.rng.gauss() * 0.05) },
        // The curve of a spinning ball in flight is read from its path; the spin itself is taken as seen.
        spin: { ...b.spin },
        seenAt: truth.now,
      };
    }
    for (const p of truth.players) {
      if (p.id === this.self.id || !visible(p.pos.x, p.pos.z)) continue;
      const e = blur(p.pos.x, p.pos.z);
      this.others.set(p.id, {
        pos: { x: p.pos.x + this.rng.gauss() * e, z: p.pos.z + this.rng.gauss() * e },
        vel: { x: p.vel.x, z: p.vel.z },
        seenAt: truth.now,
      });
    }
    return true;
  }

  /** Believed current ball position: last sighting extrapolated, with air-time gravity. */
  ballNow(now: number): BallSighting {
    const age = Math.min(1.5, Math.max(0, now - this.ball.seenAt));
    const { pos, vel } = this.ball;
    const y = pos.y + vel.y * age - 4.9 * age * age;
    // In the air gravity changes the vertical pace too; the old pace would put a dropping ball far too high.
    const airborne = y > 0.11;
    return { pos: { x: pos.x + vel.x * age, y: Math.max(0.11, y), z: pos.z + vel.z * age }, vel: airborne ? { ...vel, y: vel.y - 9.81 * age } : vel, spin: this.ball.spin, seenAt: this.ball.seenAt };
  }

  /** Believed current position of another player (extrapolated for at most one second). */
  playerNow(id: number, now: number): Vec2 | null {
    const s = this.others.get(id);
    if (!s) return null;
    const age = Math.min(1, now - s.seenAt);
    return { x: s.pos.x + s.vel.x * age, z: s.pos.z + s.vel.z * age };
  }

  /** A player who left the pitch is no longer in the picture (without this he lingered as a moving ghost). */
  forget(id: number): void {
    this.others.delete(id);
  }

  /** Synchronises the whole picture at kick-off or a restart, when everybody sees the set-up. */
  reset(truth: Truth): void {
    this.ball = { pos: { ...truth.ball.pos }, vel: { ...truth.ball.vel }, spin: { ...truth.ball.spin }, seenAt: truth.now };
    for (const p of truth.players) if (p.id !== this.self.id) this.others.set(p.id, { pos: { ...p.pos }, vel: { ...p.vel }, seenAt: truth.now });
  }
}
