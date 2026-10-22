import type { Vec2, Vec3 } from '../engine/types';
import { BALL_PHYSICS, airAcceleration } from '../physics/ball';
import { TURF } from '../physics/pitch-colliders';
import { BALL_SPEC } from '../physics/pitch-geometry';

/** Highest a ball may be for a player to bring it down with the foot (m); volleys and headers are not modelled. */
export const CONTROL_HEIGHT = 0.5;
/** A ball this high, or rising this fast, is in the air. */
const AIRBORNE_HEIGHT = 0.3, AIRBORNE_VY = 1;
const DT = 0.05;
const NO_SPIN: Vec3 = { x: 0, y: 0, z: 0 };
const HORIZON = 4;
/** Bounce on turf: Rapier averages ball and turf restitution; friction takes some of the pace along the ground. */
const BOUNCE = (BALL_PHYSICS.restitution + TURF.restitution) / 2;
const BOUNCE_GRIP = 0.8;
/** Deceleration of a ball rolling out after its bounces (m/s²). */
const ROLL_DECEL = 0.7;
/** A player needs a moment before he starts for a ball (s). */
const START = 0.3;

export function isAirborne(pos: Vec3, vel: Vec3): boolean {
  return pos.y > AIRBORNE_HEIGHT || vel.y > AIRBORNE_VY;
}

/**
 * Where a player can first meet a ball in the air at a playable height: the first point of its flight (with drag,
 * bounces and the roll afterwards) that is at most CONTROL_HEIGHT high and that he can reach in time. Players used
 * to aim at the ball's path as if it were rolling and stood 5–10 m from where it came down (measured). Null for a
 * ball on the ground.
 */
export function aerialIntercept(p: Vec2, vmax: number, pos: Vec3, vel: Vec3, spin: Vec3 = NO_SPIN): { t: number; at: Vec2 } | null {
  if (!isAirborne(pos, vel)) return null;
  const f = flight(pos, vel, spin);
  for (let i = 0; i < f.n; i++) {
    if (f.ok[i] && Math.hypot(f.x[i] - p.x, f.z[i] - p.z) / vmax + START <= f.t[i]) return { t: f.t[i], at: { x: f.x[i], z: f.z[i] } };
  }
  const last = f.n > 0 ? { x: f.x[f.n - 1], z: f.z[f.n - 1] } : { x: pos.x, z: pos.z };
  return { t: HORIZON + Math.hypot(last.x - p.x, last.z - p.z) / vmax, at: last };
}

/** Would aerialIntercept(...).t be below `limit`? The same answer, but the search stops at `limit`. */
export function aerialBefore(p: Vec2, vmax: number, pos: Vec3, vel: Vec3, spin: Vec3, limit: number): boolean {
  const f = flight(pos, vel, spin);
  for (let i = 0; i < f.n; i++) {
    if (f.t[i] >= limit) return false;
    if (f.ok[i] && Math.hypot(f.x[i] - p.x, f.z[i] - p.z) / vmax + START <= f.t[i]) return true;
  }
  const last = f.n > 0 ? { x: f.x[f.n - 1], z: f.z[f.n - 1] } : { x: pos.x, z: pos.z };
  return HORIZON + Math.hypot(last.x - p.x, last.z - p.z) / vmax < limit;
}

/**
 * The predicted flight of one ball, sampled every DT: the same for every player asked about it, so it is computed once
 * per ball state (a brain asks for itself and each team-mate in turn; profiled at ≈ 4 % of a tick before).
 */
type Flight = { key: number[]; n: number; t: Float64Array; x: Float64Array; z: Float64Array; ok: Uint8Array };
const SAMPLES = Math.ceil(HORIZON / DT) + 1;
const cached: Flight = { key: [], n: 0, t: new Float64Array(SAMPLES), x: new Float64Array(SAMPLES), z: new Float64Array(SAMPLES), ok: new Uint8Array(SAMPLES) };

function flight(pos: Vec3, vel: Vec3, spin: Vec3): Flight {
  const key = [pos.x, pos.y, pos.z, vel.x, vel.y, vel.z, spin.x, spin.y, spin.z];
  if (cached.key.length === 9 && cached.key.every((k, i) => k === key[i])) return cached;
  cached.key = key;
  cached.n = 0;
  let x = pos.x, y = pos.y, z = pos.z, vx = vel.x, vy = vel.y, vz = vel.z;
  let rolling = false, descended = false;
  for (let t = DT; t <= HORIZON; t += DT) {
    const h = Math.hypot(vx, vz);
    if (rolling) {
      const s = Math.max(0, h - ROLL_DECEL * DT);
      if (h > 1e-6) { vx *= s / h; vz *= s / h; }
    } else {
      const a = airAcceleration({ x: vx, y: vy, z: vz }, spin);
      vx += a.x * DT; vz += a.z * DT;
      vy += (a.y - BALL_PHYSICS.gravity) * DT;
    }
    x += vx * DT; z += vz * DT;
    if (!rolling) {
      y += vy * DT;
      if (vy < 0) descended = true;
      if (y <= BALL_SPEC.radius) {
        y = BALL_SPEC.radius;
        vy = -vy * BOUNCE;
        vx *= BOUNCE_GRIP; vz *= BOUNCE_GRIP;
        if (vy < AIRBORNE_VY) rolling = true;
      }
    }
    const i = cached.n++;
    cached.t[i] = t; cached.x[i] = x; cached.z[i] = z; cached.ok[i] = descended && y <= CONTROL_HEIGHT ? 1 : 0;
  }
  return cached;
}

/**
 * Where a player can meet a ball in the air with his head: the first point of its flight (gravity and drag) at
 * forehead height (from a little below it up to a jump above it) that he can reach in time. Null if there is none
 * before the ball comes down.
 */
export function headerIntercept(p: Vec2, vmax: number, pos: Vec3, vel: Vec3, forehead: number, spin: Vec3 = NO_SPIN): { t: number; at: Vec2 } | null {
  if (!isAirborne(pos, vel)) return null;
  let x = pos.x, y = pos.y, z = pos.z, vx = vel.x, vy = vel.y, vz = vel.z;
  for (let t = DT; t <= HORIZON; t += DT) {
    const a = airAcceleration({ x: vx, y: vy, z: vz }, spin);
    vx += a.x * DT; vz += a.z * DT;
    vy += (a.y - BALL_PHYSICS.gravity) * DT;
    x += vx * DT; y += vy * DT; z += vz * DT;
    if (y <= BALL_SPEC.radius) return null;
    if (y >= forehead - 0.25 && y <= forehead + 0.3 && Math.hypot(x - p.x, z - p.z) / vmax + START <= t) return { t, at: { x, z } };
  }
  return null;
}