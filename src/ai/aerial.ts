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
  let x = pos.x, y = pos.y, z = pos.z, vx = vel.x, vy = vel.y, vz = vel.z;
  let rolling = false, descended = false;
  let last: Vec2 = { x, z };
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
    last = { x, z };
    if (descended && y <= CONTROL_HEIGHT && Math.hypot(x - p.x, z - p.z) / vmax + START <= t) return { t, at: last };
  }
  return { t: HORIZON + Math.hypot(last.x - p.x, last.z - p.z) / vmax, at: last };
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