import { BALL_PHYSICS, dragCoefficient } from '../physics/ball';
import { BALL_SPEC } from '../physics/pitch-geometry';

/**
 * A player's intuition about how a ball travels, derived from the same coefficients the physics uses.
 * Used for planning only (how hard to pass, when a ball arrives); the real flight is always Rapier's.
 */
const AREA = Math.PI * BALL_SPEC.radius * BALL_SPEC.radius;
const DT = 0.02;

function groundDecel(v: number): number {
  const drag = (0.5 * BALL_PHYSICS.airDensity * dragCoefficient(v) * AREA * v * v) / BALL_SPEC.mass;
  return drag + BALL_PHYSICS.rollingResistance * BALL_PHYSICS.gravity;
}

/** Distance a rolling ball covers from speed v0 until it slows to `until` m/s. */
export function rollDistance(v0: number, until = 0.3): number {
  let v = v0, d = 0;
  while (v > until) { d += v * DT; v -= groundDecel(v) * DT; }
  return d;
}

/** Time for a rolling ball starting at v0 to cover `distance`; Infinity if it stops short. */
export function rollTime(v0: number, distance: number): number {
  let v = v0, d = 0, t = 0;
  while (d < distance) {
    if (v <= 0.15 || t > 12) return Infinity;
    d += v * DT; v -= groundDecel(v) * DT; t += DT;
  }
  return t;
}

/** Launch speed for a ground pass that arrives `distance` away with roughly `arrive` m/s. */
export function groundPassSpeed(distance: number, arrive: number): number {
  let lo = arrive, hi = 35;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    let v = mid, d = 0;
    while (d < distance && v > arrive) { d += v * DT; v -= groundDecel(v) * DT; }
    if (d >= distance) hi = mid; else lo = mid;
  }
  return hi;
}

/** Launch speed for a lofted ball at `elevation` that lands about `distance` away (drag-corrected). */
export function loftedPassSpeed(distance: number, elevation: number): number {
  const vacuum = Math.sqrt((BALL_PHYSICS.gravity * distance) / Math.sin(2 * elevation));
  return vacuum * (1.06 + distance / 400);
}

/** Flight time of a lofted ball of that speed and elevation (vacuum estimate). */
export function loftedTime(speed: number, elevation: number): number {
  return (2 * speed * Math.sin(elevation)) / BALL_PHYSICS.gravity;
}
