import RAPIER from '@dimforge/rapier3d-simd-compat';
import { BALL } from './ball';
import { GROUPS } from './collision-groups';
import { Motor, headingVector } from './player-motor';

/**
 * Kinematic boot colliders driven by a bounded leg swing. Rapier resolves the actual boot/ball contact,
 * so the ball only moves if the boot really reaches it; direction and spin follow from where it is hit.
 * Approximation: the boot has unbounded mass (kinematic), so the ball leaves at ≈ (1 + e) × boot speed.
 */
export const LEG = {
  footRadius: 0.055,
  footHalfLength: 0.1,
  hipHeight: 0.92,
  hipOffset: 0.11,
  length: 0.95,
  /** Highest boot speed relative to the hip a footballer reaches (instep shots ≈ 20–25 m/s). */
  maxFootSpeed: 24,
  restitution: 0.5,
} as const;

/** Highest launch angle reachable by striking under the ball without the boot going into the turf. */
export const MAX_ELEVATION = 0.45;

/** Effective restitution measured for boot/ball contacts in Rapier (ball ≈ 1.45 × boot speed). */
export const CONTACT_RESTITUTION = 0.45;

export type Technique = 'instep' | 'inside' | 'cushion';
export type Side = -1 | 1;
type V3 = { x: number; y: number; z: number };

/** Execution error of one swing; it moves the boot, never the ball. */
export type SwingError = { lateral: number; vertical: number; angle: number; speedFactor: number; timing: number };
export const NO_ERROR: SwingError = { lateral: 0, vertical: 0, angle: 0, speedFactor: 1, timing: 0 };

export type SwingRequest = {
  technique: Technique;
  side: Side;
  /** Unit direction the ball should leave in (kick) or arrives from (cushion uses the ball velocity). */
  dirX: number;
  dirZ: number;
  elevation: number;
  ballSpeed: number;
};

type Phase = 'windup' | 'strike' | 'follow' | 'recover';
export type SwingPlan = {
  technique: Technique;
  side: Side;
  windupEnd: V3;
  contact: V3;
  /** The boot keeps strike speed through the ball until here, so the contact sees the full boot speed. */
  strikeEnd: V3;
  followEnd: V3;
  footDir: V3;
  windupTime: number;
  strikeSpeed: number;
  followTime: number;
  recoverTime: number;
  axis: V3;
};

export type Foot = { body: RAPIER.RigidBody; collider: RAPIER.Collider; side: Side; rel: V3 };
export type Legs = {
  feet: [Foot, Foot];
  swing: { plan: SwingPlan; phase: Phase; t: number; from: V3; foot: Foot } | null;
};

const TECHNIQUE = {
  instep: { windup: 0.2, back: 0.5, follow: 0.35, followTime: 0.12, recover: 0.25 },
  inside: { windup: 0.14, back: 0.32, follow: 0.25, followTime: 0.1, recover: 0.2 },
  cushion: { windup: 0.1, back: 0.04, follow: 0.25, followTime: 0.18, recover: 0.2 },
} as const;

export function createLegs(world: RAPIER.World, motor: Motor): Legs {
  const make = (side: Side): Foot => {
    const rel = restPosition(motor, side);
    const p = motor.body.translation();
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x + rel.x, rel.y, p.z + rel.z));
    const collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(LEG.footHalfLength, LEG.footRadius)
        .setRestitution(LEG.restitution)
        .setFriction(0.7)
        .setCollisionGroups(GROUPS.foot)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    return { body, collider, side, rel };
  };
  return { feet: [make(-1), make(1)], swing: null };
}

/** Feet rest under the hips, inside the body capsule's footprint. */
export function restPosition(motor: Motor, side: Side): V3 {
  const f = headingVector(motor.heading);
  return { x: f.z * side * LEG.hipOffset, y: LEG.footRadius, z: -f.x * side * LEG.hipOffset };
}

export function hipPosition(motor: Motor, side: Side): V3 {
  const r = restPosition(motor, side);
  return { x: r.x, y: LEG.hipHeight, z: r.z };
}

const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: V3, b: V3, s = 1): V3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
const len = (a: V3) => Math.hypot(a.x, a.y, a.z);
const lerp = (a: V3, b: V3, t: number): V3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

/**
 * Plans a swing in the frame that travels with the body. Returns null when the leg cannot reach the
 * predicted contact point — the caller must then keep approaching instead of kicking.
 */
export function planSwing(motor: Motor, ball: RAPIER.RigidBody, req: SwingRequest, err: SwingError = NO_ERROR): SwingPlan | null {
  const tech = TECHNIQUE[req.technique];
  const bodyP = motor.body.translation(), bodyV = motor.body.linvel();
  const ballP = ball.translation(), ballV = ball.linvel();
  const ballSpeed = Math.hypot(ballV.x, ballV.y, ballV.z);

  // Direction the boot travels and the contact normal (boot → ball centre).
  let footDir: V3;
  let normal: V3;
  let worldFootSpeed: number;
  if (req.technique === 'cushion') {
    if (ballSpeed < 0.5) return null;
    footDir = { x: ballV.x / ballSpeed, y: 0, z: ballV.z / ballSpeed };
    const h = Math.hypot(footDir.x, footDir.z) || 1;
    footDir = { x: footDir.x / h, y: 0, z: footDir.z / h };
    normal = { x: -footDir.x, y: 0, z: -footDir.z };
    // Moving with the ball at e/(1+e) of its speed leaves it almost dead after the touch.
    worldFootSpeed = (ballSpeed * CONTACT_RESTITUTION) / (1 + CONTACT_RESTITUTION);
  } else {
    // The boot travels horizontally; lift comes only from striking below the ball centre (≤ ~25°).
    const a = Math.atan2(req.dirX, req.dirZ) + err.angle;
    const el = Math.min(req.elevation, MAX_ELEVATION);
    footDir = { x: Math.sin(a), y: 0, z: Math.cos(a) };
    normal = { x: Math.sin(a) * Math.cos(el), y: Math.sin(el), z: Math.cos(a) * Math.cos(el) };
    const ballAlong = ballV.x * normal.x + ballV.y * normal.y + ballV.z * normal.z;
    worldFootSpeed = (req.ballSpeed * err.speedFactor + CONTACT_RESTITUTION * ballAlong) / ((1 + CONTACT_RESTITUTION) * Math.cos(el));
  }
  const bodyAlong = bodyV.x * footDir.x + bodyV.z * footDir.z;
  const strikeSpeed = Math.min(LEG.maxFootSpeed, Math.max(0.6, worldFootSpeed - bodyAlong));

  // Predict where the ball will be, relative to the body, at the moment of contact.
  const reach = LEG.footRadius + BALL.radius;
  const contactTime = tech.windup + tech.back / strikeSpeed + err.timing;

  const relBall: V3 = {
    x: ballP.x + ballV.x * contactTime - (bodyP.x + bodyV.x * contactTime),
    y: Math.max(BALL.radius, ballP.y + ballV.y * contactTime),
    z: ballP.z + ballV.z * contactTime - (bodyP.z + bodyV.z * contactTime),
  };
  const lateral = { x: normal.z, y: 0, z: -normal.x };
  const hl = Math.hypot(lateral.x, lateral.z) || 1;
  let contact = add(relBall, normal, -reach);
  contact = add(contact, { x: lateral.x / hl, y: 0, z: lateral.z / hl }, err.lateral);
  contact.y = Math.max(LEG.footRadius * 0.7, contact.y + err.vertical);

  // Straight, level strike path through the contact point; the follow-through then rises.
  const windupEnd = add(contact, footDir, -tech.back);
  const strikeEnd = add(contact, footDir, 0.25);
  const followEnd = add(strikeEnd, footDir, tech.follow * 0.5);
  followEnd.y += 0.15;

  const hip = hipPosition(motor, req.side);
  if (len(sub(contact, hip)) > LEG.length || len(sub(windupEnd, hip)) > LEG.length * 1.08) return null;
  const facing = headingVector(motor.heading);
  if (contact.x * facing.x + contact.z * facing.z < -0.1) return null;

  const h = Math.hypot(footDir.x, footDir.z) || 1;
  const axis = req.technique === 'instep'
    ? { x: footDir.x / h, y: 0, z: footDir.z / h }
    : { x: footDir.z / h, y: 0, z: -footDir.x / h };
  return {
    technique: req.technique,
    side: req.side,
    windupEnd,
    contact,
    strikeEnd,
    followEnd,
    footDir,
    windupTime: tech.windup + Math.max(0, err.timing),
    strikeSpeed,
    followTime: tech.followTime,
    recoverTime: tech.recover,
    axis,
  };
}

export function startSwing(legs: Legs, plan: SwingPlan): void {
  const foot = legs.feet[plan.side < 0 ? 0 : 1];
  legs.swing = { plan, phase: 'windup', t: 0, from: { ...foot.rel }, foot };
}

/** Advances the swing and stages the next kinematic boot poses. Call once per physics tick before world.step(). */
export function updateLegs(legs: Legs, motor: Motor, dt: number): void {
  const swing = legs.swing;
  for (const foot of legs.feet) {
    if (swing && swing.foot === foot) continue;
    foot.rel = restPosition(motor, foot.side);
    stageFoot(foot, motor, foot.rel, headingAxis(motor));
  }
  if (!swing) return;
  const { plan } = swing;
  swing.t += dt;
  let rel: V3;
  if (swing.phase === 'windup') {
    const k = Math.min(1, swing.t / plan.windupTime);
    const s = k * k * (3 - 2 * k);
    rel = lerp(swing.from, plan.windupEnd, s);
    rel.y += Math.sin(Math.PI * k) * 0.12;
    if (k >= 1) next(swing, 'strike', plan.windupEnd);
  } else if (swing.phase === 'strike') {
    const path = sub(plan.strikeEnd, plan.windupEnd);
    const distance = len(path);
    const k = Math.min(1, (swing.t * plan.strikeSpeed) / distance);
    rel = lerp(plan.windupEnd, plan.strikeEnd, k);
    if (k >= 1) next(swing, 'follow', plan.strikeEnd);
  } else if (swing.phase === 'follow') {
    const k = Math.min(1, swing.t / plan.followTime);
    // Decelerating follow-through after the ball has left the boot.
    rel = lerp(plan.strikeEnd, plan.followEnd, 1 - (1 - k) * (1 - k));
    if (k >= 1) next(swing, 'recover', plan.followEnd);
  } else {
    const k = Math.min(1, swing.t / plan.recoverTime);
    rel = lerp(swing.from, restPosition(motor, plan.side), k * k * (3 - 2 * k));
    if (k >= 1) legs.swing = null;
  }
  swing.foot.rel = rel;
  stageFoot(swing.foot, motor, rel, plan.axis);
}

function next(swing: NonNullable<Legs['swing']>, phase: Phase, from: V3): void {
  swing.phase = phase;
  swing.t = 0;
  swing.from = { ...from };
}

function headingAxis(motor: Motor): V3 {
  const f = headingVector(motor.heading);
  return { x: f.x, y: 0, z: f.z };
}

function stageFoot(foot: Foot, motor: Motor, rel: V3, axis: V3): void {
  const p = motor.body.translation();
  foot.body.setNextKinematicTranslation({ x: p.x + rel.x, y: rel.y, z: p.z + rel.z });
  foot.body.setNextKinematicRotation(rotationFromYTo(axis));
}

/** Quaternion that turns the capsule's local Y axis onto `axis`. */
function rotationFromYTo(axis: V3): RAPIER.Rotation {
  const n = len(axis) || 1;
  const ax = axis.x / n, ay = axis.y / n, az = axis.z / n;
  const w = 1 + ay;
  if (w < 1e-6) return { x: 1, y: 0, z: 0, w: 0 };
  const qx = az, qz = -ax;
  const m = Math.hypot(qx, w, qz);
  return { x: qx / m, y: 0, z: qz / m, w: w / m };
}

export function isSwinging(legs: Legs): boolean {
  return legs.swing !== null;
}

/** Largest boot travel per physics substep; keeps fast strikes from jumping into the ball. */
const MAX_BOOT_TRAVEL = 0.07;

/**
 * Rapier's CCD does not sweep kinematic bodies, so a 20 m/s boot would move 0.33 m per 1/60 s tick and land
 * inside the ball. While any boot is winding up or striking, the tick is split into substeps instead.
 */
export function substepsFor(allLegs: Legs[], dt: number): number {
  let n = 1;
  for (const legs of allLegs) {
    const s = legs.swing;
    if (s && (s.phase === 'windup' || s.phase === 'strike')) n = Math.max(n, Math.ceil((s.plan.strikeSpeed * dt) / MAX_BOOT_TRAVEL));
  }
  return Math.min(n, 8);
}
