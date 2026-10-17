import type RAPIER from '@dimforge/rapier3d-simd-compat';
import type { BallAction, PlayerProfile, Vec2 } from '../engine/types';
import type { Rng } from '../engine/rng';
import type { BodyCommand, PlayerBody } from '../physics/body';
import { MAX_ELEVATION, type Legs, type StrikeError, type StrikePlan, type StrikeRequest, type Technique } from '../physics/legs';
import { BALL_PHYSICS } from '../physics/ball';

/** Turning a chosen ball action into body movement and a swing. Success is still decided by the contact. */

export function techniqueFor(action: BallAction): Technique {
  switch (action.kind) {
    case 'control': return 'cushion';
    case 'shot': case 'clear': return 'instep';
    case 'pass': return action.lofted || action.speed > 18 ? 'instep' : 'inside';
    case 'dribble': return 'inside';
  }
}

const FACING_TOLERANCE: Record<Technique, number> = { instep: 0.6, inside: 1.1, cushion: Math.PI };
/** Body centre to ball centre when setting up a kick: body radius + ball radius + room for the swing. */
const STRIKE_STANDOFF = 0.55;

/** Horizontal direction and launch elevation an action asks for, seen from the ball. */
export function actionVector(action: BallAction, ball: Vec2): { dir: Vec2; elevation: number; speed: number } {
  const towards = (t: Vec2) => {
    const dx = t.x - ball.x, dz = t.z - ball.z, d = Math.hypot(dx, dz) || 1;
    return { dir: { x: dx / d, z: dz / d }, d };
  };
  switch (action.kind) {
    case 'pass': {
      const { dir } = towards(action.aim);
      return { dir, elevation: action.lofted ? 0.42 : 0, speed: action.speed };
    }
    case 'shot': {
      const { dir, d } = towards(action.aim);
      const t = d / action.speed;
      const rise = action.aim.y - 0.11 + 0.5 * BALL_PHYSICS.gravity * t * t;
      return { dir, elevation: Math.min(MAX_ELEVATION, Math.max(0, Math.atan2(rise, d))), speed: action.speed };
    }
    case 'dribble': return { dir: action.direction, elevation: 0, speed: action.speed };
    case 'clear': return { dir: action.direction, elevation: MAX_ELEVATION, speed: action.speed };
    case 'control': return { dir: { x: 0, z: 0 }, elevation: 0, speed: 0 };
  }
}

/** Where the body should be and face to strike the ball with the chosen foot. */
export function approach(body: PlayerBody, legs: Legs, action: BallAction, ball: { pos: Vec2; vel: Vec2 }, intercept: Vec2): BodyCommand {
  const p = body.position();
  if (action.kind === 'control') {
    return { target: intercept, speed: body.limits.maxSpeed * 0.85, face: ball.pos };
  }
  // Aim for the striking spot a moment ahead and arrive there in that time: the run matches the ball's pace
  // instead of braking onto a point the ball has already left (or running into it).
  const horizon = 0.4;
  const bx = ball.pos.x + ball.vel.x * horizon, bz = ball.pos.z + ball.vel.z * horizon;
  const { dir } = actionVector(action, ball.pos);
  const side = legs.sideTowards(bx, bz) === 1 ? 1 : -1;
  // Right of the kick direction is (−dir.z, dir.x); the ball should end up in front of the kicking boot,
  // a stride ahead of the body so the leg can swing through without the body touching the ball first.
  const rx = -dir.z, rz = dir.x;
  const spot = { x: bx - dir.x * STRIKE_STANDOFF - rx * side * 0.11, z: bz - dir.z * STRIKE_STANDOFF - rz * side * 0.11 };
  return {
    target: spot,
    speed: Math.min(body.limits.maxSpeed, Math.hypot(spot.x - p.x, spot.z - p.z) / horizon),
    face: { x: p.x + dir.x * 5, z: p.z + dir.z * 5 },
  };
}

export type ExecutionContext = { pressure: number; profile: PlayerProfile; rng: Rng };

/** Motor noise for one swing. Grows with pressure, relative ball speed, poor body shape and power. */
export function strikeError(ctx: ExecutionContext, body: PlayerBody, ballVel: Vec2, action: BallAction, bodyAngle: number): StrikeError {
  const a = ctx.profile.abilities;
  const skill = action.kind === 'shot' ? a.shooting : action.kind === 'pass' ? a.passing : a.technique;
  const v = body.velocity();
  const rel = Math.hypot(ballVel.x - v.x, ballVel.z - v.z);
  const power = action.kind === 'shot' || action.kind === 'clear' ? 0.7 : 'speed' in action ? action.speed / 30 : 0.2;
  const factor = (1.45 - skill) * (1 + 1.4 * ctx.pressure * (1.3 - a.composure) + rel / 6 + bodyAngle * 1.1 + power);
  const tech = techniqueFor(action);
  const base = tech === 'inside' ? 0.006 : tech === 'instep' ? 0.011 : 0.016;
  const g = () => ctx.rng.gauss();
  return {
    lateral: g() * base * factor,
    vertical: g() * base * 0.8 * factor,
    angle: g() * 0.011 * factor,
    speed: 1 + g() * 0.04 * factor,
    timing: Math.abs(g()) * 0.005 * factor,
  };
}

/**
 * Starts a swing if body and ball allow it this tick. The noise-free plan checks feasibility first, so an
 * error can make the kick worse but never makes the player try an impossible one.
 */
export function trySwing(body: PlayerBody, legs: Legs, ball: RAPIER.RigidBody, action: BallAction, ctx: ExecutionContext): StrikePlan | null {
  if (legs.busy()) return null;
  const bp = ball.translation(), bv = ball.linvel();
  const p = body.position();
  if (Math.hypot(bp.x - p.x, bp.z - p.z) > 1.5) return null;
  const tech = techniqueFor(action);
  const { dir, elevation, speed } = actionVector(action, { x: bp.x, z: bp.z });
  const f = body.facing();
  const angle = action.kind === 'control' ? 0 : Math.acos(Math.max(-1, Math.min(1, f.x * dir.x + f.z * dir.z)));
  if (angle > FACING_TOLERANCE[tech]) return null;
  const side = legs.sideTowards(bp.x, bp.z);
  const request: StrikeRequest = { technique: tech, side, dirX: dir.x, dirZ: dir.z, elevation, ballSpeed: speed };
  if (!legs.plan(ball, request)) return null;
  const plan = legs.plan(ball, request, strikeError(ctx, body, { x: bv.x, z: bv.z }, action, angle));
  if (plan) legs.start(plan);
  return plan;
}
