import type RAPIER from '@dimforge/rapier3d-simd-compat';
import type { BallAction, PlayerProfile, Vec2 } from '../engine/types';
import type { Rng } from '../engine/rng';
import type { BodyCommand, PlayerBody } from '../physics/body';
import { MAX_ELEVATION, type Legs, type StrikeError, type StrikePlan, type StrikeRequest, type Technique } from '../physics/legs';
import { BALL_PHYSICS } from '../physics/ball';

/** Turning a chosen ball action into body movement and a swing. Success is still decided by the contact. */

export function techniqueFor(action: BallAction): Technique {
  switch (action.kind) {
    case 'control': return action.touch ? 'inside' : 'cushion';
    case 'shot': case 'clear': return 'instep';
    case 'pass': return action.lofted || action.speed > 18 ? 'instep' : 'inside';
    case 'dribble': case 'tackle': return 'inside';
    case 'header': throw new Error('A header is played with the head, not with a boot technique');
    case 'throw': throw new Error('A throw-in is taken with the hands, not with a boot technique');
  }
}

const FACING_TOLERANCE: Record<Technique, number> = { instep: 0.6, inside: 1.1, cushion: Math.PI };
/** Body centre to ball centre when setting up a kick: body radius + ball radius + room for the swing. */
const STRIKE_STANDOFF = 0.55;
/** Body centre beside the line of an arriving ball for a directional touch (body + ball radius + clearance). */
const TOUCH_OFFSET = 0.5;
/** Ball beside the body when shielding it: outside the far foot, still inside the leg's reach. */
const SHIELD_OFFSET = 0.24;
/** Closest a running body passes the ball centre without touching it: body radius + ball radius + margin. */
const BALL_CLEARANCE = 0.5;

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
    case 'dribble': case 'tackle': return { dir: action.direction, elevation: 0, speed: action.speed };
    case 'clear': return { dir: action.direction, elevation: MAX_ELEVATION, speed: action.speed };
    case 'control': return action.touch ? { dir: action.touch.direction, elevation: 0, speed: action.touch.speed } : { dir: { x: 0, z: 0 }, elevation: 0, speed: 0 };
    case 'header': case 'throw': {
      const v = action.velocity, h = Math.hypot(v.x, v.z) || 1;
      return { dir: { x: v.x / h, z: v.z / h }, elevation: Math.atan2(v.y, h), speed: Math.hypot(v.x, v.y, v.z) };
    }
  }
}

/** Where the body should be and face to strike the ball with the chosen foot. */
export function approach(body: PlayerBody, legs: Legs, action: BallAction, ball: { pos: Vec2; vel: Vec2 }, intercept: Vec2, shieldFrom: Vec2 | null = null): BodyCommand {
  const p = body.position();
  if (action.kind === 'control' && !action.touch) {
    return { target: intercept, speed: body.limits.maxSpeed * 0.85, face: ball.pos };
  }
  const ballSpeed = Math.hypot(ball.vel.x, ball.vel.z);
  if (action.kind === 'control' && action.touch && ballSpeed > 2.5) return touchApproach(body, action.touch.direction, ball.vel, ballSpeed, intercept);
  // Aim for the striking spot a moment ahead and arrive there in that time: the run matches the ball's pace
  // instead of braking onto a point the ball has already left (or running into it).
  const horizon = 0.4;
  const bx = ball.pos.x + ball.vel.x * horizon, bz = ball.pos.z + ball.vel.z * horizon;
  const { dir } = actionVector(action, ball.pos);
  // Right of the kick direction is (−dir.z, dir.x); the ball should end up in front of the kicking boot,
  // a stride ahead of the body so the leg can swing through without the body touching the ball first.
  const rx = -dir.z, rz = dir.x;
  let side = legs.sideTowards(bx, bz) === 1 ? 1 : -1;
  let offset = 0.11;
  if (shieldFrom && action.kind === 'dribble') {
    // Shielding: the ball goes on the foot away from the opponent, the body stays between him and the ball.
    side = (shieldFrom.x - p.x) * rx + (shieldFrom.z - p.z) * rz > 0 ? -1 : 1;
    offset = SHIELD_OFFSET;
  }
  const spot = { x: bx - dir.x * STRIKE_STANDOFF - rx * side * offset, z: bz - dir.z * STRIKE_STANDOFF - rz * side * offset };
  return {
    target: roundTheBall(p, spot, ball.pos),
    speed: Math.min(body.limits.maxSpeed, Math.hypot(spot.x - p.x, spot.z - p.z) / horizon),
    face: { x: p.x + dir.x * 5, z: p.z + dir.z * 5 },
  };
}

/**
 * A player getting to the far side of the ball goes round it instead of running through it (his body would
 * knock it on first): when the straight run passes the ball closer than body and ball allow, he first heads
 * for a point beside the ball.
 */
function roundTheBall(p: Vec2, spot: Vec2, ball: Vec2): Vec2 {
  const dx = spot.x - p.x, dz = spot.z - p.z, l2 = dx * dx + dz * dz;
  if (l2 < 1e-6) return spot;
  const t = ((ball.x - p.x) * dx + (ball.z - p.z) * dz) / l2;
  if (t <= 0 || t >= 1) return spot;
  const cx = p.x + dx * t - ball.x, cz = p.z + dz * t - ball.z;
  const d = Math.hypot(cx, cz);
  if (d >= BALL_CLEARANCE) return spot;
  // Pass on the side the run already leans to (or the right of the run when it heads straight at the ball).
  const l = Math.sqrt(l2);
  const nx = d > 0.01 ? cx / d : -dz / l, nz = d > 0.01 ? cz / d : dx / l;
  return { x: ball.x + nx * (BALL_CLEARANCE + 0.2), z: ball.z + nz * (BALL_CLEARANCE + 0.2) };
}

/**
 * Receiving with a directional touch: the body waits beside the ball's line, on the side opposite to where the
 * ball is to go, so the ball runs past the body onto the inside of the foot instead of into the body.
 */
function touchApproach(body: PlayerBody, dir: Vec2, vel: Vec2, speed: number, intercept: Vec2): BodyCommand {
  const p = body.position();
  const tx = vel.x / speed, tz = vel.z / speed;
  const along = dir.x * tx + dir.z * tz;
  const px = dir.x - along * tx, pz = dir.z - along * tz, pl = Math.hypot(px, pz);
  let nx: number, nz: number;
  if (pl > 0.2) { nx = -px / pl; nz = -pz / pl; } else {
    // Touch along the line: stay on the side the body is already on.
    const side = (p.x - intercept.x) * -tz + (p.z - intercept.z) * tx >= 0 ? 1 : -1;
    nx = -tz * side; nz = tx * side;
  }
  return { target: { x: intercept.x + nx * TOUCH_OFFSET, z: intercept.z + nz * TOUCH_OFFSET }, speed: body.limits.maxSpeed * 0.85, face: { x: p.x + dir.x * 5, z: p.z + dir.z * 5 } };
}

export type ExecutionContext = { pressure: number; profile: PlayerProfile; rng: Rng };

/**
 * Running pace (m/s) that adds as much motor noise as the base: striking on the run is less precise than from a
 * stand. Until the boots followed the body exactly, a lagging boot did this by accident (2 cm at 5 m/s).
 */
const PACE_NOISE = 8;

/** Motor noise for one swing. Grows with pressure, relative ball speed, own pace, poor body shape and power. */
export function strikeError(ctx: ExecutionContext, body: PlayerBody, ballVel: Vec2, action: BallAction, bodyAngle: number): StrikeError {
  const a = ctx.profile.abilities;
  const skill = action.kind === 'shot' ? a.shooting : action.kind === 'pass' ? a.passing : a.technique;
  const v = body.velocity();
  const rel = Math.hypot(ballVel.x - v.x, ballVel.z - v.z);
  const power = action.kind === 'shot' || action.kind === 'clear' ? 0.7 : 'speed' in action ? action.speed / 30 : 0.2;
  const factor = (1.45 - skill) * (1 + 1.4 * ctx.pressure * (1.3 - a.composure) + rel / 6 + Math.hypot(v.x, v.z) / PACE_NOISE + bodyAngle * 1.1 + power);
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
  const angle = tech === 'cushion' ? 0 : Math.acos(Math.max(-1, Math.min(1, f.x * dir.x + f.z * dir.z)));
  if (angle > FACING_TOLERANCE[tech]) return null;
  const side = legs.sideTowards(bp.x, bp.z);
  const request: StrikeRequest = { technique: tech, side, dirX: dir.x, dirZ: dir.z, elevation, ballSpeed: speed };
  if (!legs.plan(ball, request)) return null;
  const plan = legs.plan(ball, request, strikeError(ctx, body, { x: bv.x, z: bv.z }, action, angle));
  if (plan) legs.start(plan);
  return plan;
}
