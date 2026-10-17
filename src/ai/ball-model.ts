import { BALL_PHYSICS, dragCoefficient } from '../physics/ball';
import { BALL_SPEC } from '../physics/pitch-geometry';
import { TURF } from '../physics/pitch-colliders';

/**
 * A player's intuition about how a ball travels, derived from the same coefficients the physics uses.
 * Used for planning only (how hard to pass, when a ball arrives); the real flight is always Rapier's.
 */
const AREA = Math.PI * BALL_SPEC.radius * BALL_SPEC.radius;
const DT = 0.02;

/** Sliding friction between ball and turf (Rapier averages the two coefficients). */
const SLIDE_DECEL = ((BALL_PHYSICS.friction + TURF.friction) / 2) * BALL_PHYSICS.gravity;
/** While it skids, friction spins a solid ball up at r·α = (5/2)·μg until the surface matches the pace. */
const SPIN_UP = 2.5 * SLIDE_DECEL;

/**
 * Once rolling, the spin carries the ball through the contact, so the centre forces (drag, rolling
 * resistance) slow it less than a sliding ball: measured in the physics world ≈ 0.86 of the naive value
 * (a perfectly gripping solid sphere would give 1/1.4).
 */
const ROLLING_SHARE_OF_DECEL = 0.86;

/** A freshly struck ground ball: it leaves without spin, skids until it rolls, then rolls out. */
type GroundBall = { v: number; surface: number };

function stepGround(b: GroundBall): void {
  const drag = (0.5 * BALL_PHYSICS.airDensity * dragCoefficient(b.v) * AREA * b.v * b.v) / BALL_SPEC.mass;
  const sliding = b.surface < b.v;
  const centre = drag + BALL_PHYSICS.rollingResistance * BALL_PHYSICS.gravity;
  b.v -= (sliding ? centre + SLIDE_DECEL : centre * ROLLING_SHARE_OF_DECEL) * DT;
  b.surface = sliding ? Math.min(b.v, b.surface + SPIN_UP * DT) : b.v;
}

/** Distance a freshly struck ground ball covers from speed v0 until it slows to `until` m/s. */
export function rollDistance(v0: number, until = 0.3): number {
  const b = { v: v0, surface: 0 };
  let d = 0;
  while (b.v > until) { d += b.v * DT; stepGround(b); }
  return d;
}

/** Time for a freshly struck ground ball starting at v0 to cover `distance`; Infinity if it stops short. */
export function rollTime(v0: number, distance: number): number {
  const b = { v: v0, surface: 0 };
  let d = 0, t = 0;
  while (d < distance) {
    if (b.v <= 0.15 || t > 12) return Infinity;
    d += b.v * DT; stepGround(b); t += DT;
  }
  return t;
}

/** Launch speed for a ground pass that arrives `distance` away with roughly `arrive` m/s. */
export function groundPassSpeed(distance: number, arrive: number): number {
  let lo = arrive, hi = 35;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const b = { v: mid, surface: 0 };
    let d = 0;
    while (d < distance && b.v > arrive) { d += b.v * DT; stepGround(b); }
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
