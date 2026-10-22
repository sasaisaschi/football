import type { Vec2, Vec3 } from '../engine/types';
import { aerialBefore, aerialIntercept, isAirborne } from './aerial';

/** Effective deceleration (m/s²) a player assumes for a moving ball when guessing where to meet it. */
const BALL_DAMPING = 1.1;

/**
 * A rolling ball's believed path, sampled every 0.1 s for 4 s: the same for every player a brain asks about, so it is
 * worked out once per ball state (asked for oneself and each team-mate in turn, it was ≈ 10 % of a tick, profiled).
 */
const GROUND_SAMPLES = 41;
const ground = { key: [NaN, NaN, NaN, NaN], n: 0, t: new Float64Array(GROUND_SAMPLES + 1), x: new Float64Array(GROUND_SAMPLES + 1), z: new Float64Array(GROUND_SAMPLES + 1) };

function groundPath(pos: Vec2 | Vec3, vel: Vec2 | Vec3): typeof ground {
  const k0 = ground.key;
  if (k0[0] === pos.x && k0[1] === pos.z && k0[2] === vel.x && k0[3] === vel.z) return ground;
  ground.key = [pos.x, pos.z, vel.x, vel.z];
  ground.n = 0;
  const speed = Math.max(0.01, Math.hypot(vel.x, vel.z));
  const stop = speed / BALL_DAMPING;
  for (let t = 0; t <= 4; t += 0.1) {
    // Position along the ball's path after t seconds of uniform deceleration (it does not roll backwards).
    const tt = Math.min(t, stop);
    const k = tt - (0.5 * BALL_DAMPING * tt * tt) / speed;
    const i = ground.n++;
    ground.t[i] = t; ground.x[i] = pos.x + vel.x * k; ground.z[i] = pos.z + vel.z * k;
  }
  return ground;
}

/** Estimated time for a player at p with top speed v to reach the (believed) moving ball. */
export function interceptTime(p: Vec2, vmax: number, ball: { pos: Vec2 | Vec3; vel: Vec2 | Vec3; spin?: Vec3 }): { t: number; at: Vec2 } {
  // A ball in the air is met where it first comes down to a playable height, not along its shadow on the turf.
  if ('y' in ball.pos && 'y' in ball.vel) {
    const aerial = aerialIntercept(p, vmax, ball.pos, ball.vel, ball.spin);
    if (aerial) return aerial;
  }
  const path = groundPath(ball.pos, ball.vel);
  for (let i = 0; i < path.n; i++) {
    if (Math.hypot(path.x[i] - p.x, path.z[i] - p.z) / vmax + 0.3 <= path.t[i]) return { t: path.t[i], at: { x: path.x[i], z: path.z[i] } };
  }
  return { t: 4 + Math.hypot(ball.pos.x - p.x, ball.pos.z - p.z) / vmax, at: ball.pos };
}

/**
 * Is interceptTime(p, vmax, ball).t below `limit`? Exactly the same answer, but the search stops at `limit`: asked
 * for every team-mate of every player in every tick, the full search was ≈ 10 % of a tick (profiled).
 */
export function arrivesBefore(p: Vec2, vmax: number, ball: { pos: Vec2 | Vec3; vel: Vec2 | Vec3; spin?: Vec3 }, limit: number): boolean {
  if ('y' in ball.pos && 'y' in ball.vel && isAirborne(ball.pos, ball.vel)) return aerialBefore(p, vmax, ball.pos, ball.vel, ball.spin ?? { x: 0, y: 0, z: 0 }, limit);
  const path = groundPath(ball.pos, ball.vel);
  for (let i = 0; i < path.n; i++) {
    if (path.t[i] >= limit) return false;
    if (Math.hypot(path.x[i] - p.x, path.z[i] - p.z) / vmax + 0.3 <= path.t[i]) return true;
  }
  return 4 + Math.hypot(ball.pos.x - p.x, ball.pos.z - p.z) / vmax < limit;
}

