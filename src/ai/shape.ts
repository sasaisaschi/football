import type { Role, TeamInstruction, Vec2 } from '../engine/types';
import { PITCH } from '../physics/pitch-geometry';

/**
 * Team frame: u runs from the own goal line (−1) to the opponents' goal line (+1), v from the team's right
 * (−1) to its left (+1) touch line as seen when attacking. `sign` is the attack direction along world X.
 */
export function toTeam(sign: 1 | -1, p: Vec2): { u: number; v: number } {
  return { u: (sign * p.x) / PITCH.halfLength, v: (sign * p.z) / PITCH.halfWidth };
}

export function toWorld(sign: 1 | -1, u: number, v: number): Vec2 {
  return { x: sign * u * PITCH.halfLength, z: sign * v * PITCH.halfWidth };
}

/** 4-3-3 reference slots (kick-off positions in the own half). */
export const SLOTS: Record<Role, { u: number; v: number }> = {
  GK: { u: -0.96, v: 0 },
  RB: { u: -0.58, v: -0.62 },
  RCB: { u: -0.68, v: -0.2 },
  LCB: { u: -0.68, v: 0.2 },
  LB: { u: -0.58, v: 0.62 },
  RCM: { u: -0.32, v: -0.3 },
  CM: { u: -0.42, v: 0 },
  LCM: { u: -0.32, v: 0.3 },
  RW: { u: -0.06, v: -0.66 },
  ST: { u: -0.04, v: 0.08 },
  LW: { u: -0.06, v: 0.66 },
};

export const DEFENDERS: ReadonlySet<Role> = new Set(['RB', 'RCB', 'LCB', 'LB']);
export const MIDFIELDERS: ReadonlySet<Role> = new Set(['RCM', 'CM', 'LCM']);
export const FORWARDS: ReadonlySet<Role> = new Set(['RW', 'ST', 'LW']);

export type ShapeContext = {
  sign: 1 | -1;
  ball: Vec2;
  inPossession: boolean;
  instruction: TeamInstruction;
  /** u of the opponents' second-last player: forwards hold this line while in possession. */
  offsideLineU: number;
};

/**
 * Positional play. The team keeps a block that moves with the ball, stretches when it has the ball and
 * compacts without it; the coach's line height shifts the whole block. This yields zones to occupy,
 * not orders to chase the ball.
 */
export function shapeTarget(role: Role, ctx: ShapeContext): Vec2 {
  const ball = toTeam(ctx.sign, ctx.ball);
  if (role === 'GK') return keeperShape(ctx.sign, ctx.ball);
  const slot = SLOTS[role];
  const line = ctx.instruction.lineHeight * 0.16;
  const phase = ctx.inPossession ? 0.16 : -0.05;
  const block = Math.max(-0.62, Math.min(0.5, ball.u * 0.5 + line + phase));
  const stretch = ctx.inPossession ? 1 + ctx.instruction.risk * 0.15 : 0.66;
  let u = block + (slot.u + 0.36) * stretch;
  let v = slot.v * (ctx.inPossession ? 1 : 0.72) + ball.v * (ctx.inPossession ? 0.12 : 0.3);
  if (!ctx.inPossession && !FORWARDS.has(role)) u = Math.min(u, ball.u - (DEFENDERS.has(role) ? 0.1 : 0.04));
  if (DEFENDERS.has(role)) u = Math.max(u, -0.9);
  // Forwards attack the space behind as far as the offside line allows; bold teams push them further up.
  if (ctx.inPossession && FORWARDS.has(role)) u = Math.min(Math.max(u, ball.u + 0.1 + ctx.instruction.risk * 0.15), Math.max(ctx.offsideLineU - 0.012, ball.u));
  u = Math.max(-0.95, Math.min(0.95, u));
  v = Math.max(-0.93, Math.min(0.93, v));
  return toWorld(ctx.sign, u, v);
}

/** Keeper on the line between goal centre and ball, stepping off the line as the ball approaches. */
export function keeperShape(sign: 1 | -1, ball: Vec2): Vec2 {
  const goalX = -sign * PITCH.halfLength;
  const dx = ball.x - goalX, dz = ball.z;
  const d = Math.hypot(dx, dz) || 1;
  const advance = Math.max(0.8, Math.min(6, d * 0.12));
  const x = goalX + (dx / d) * advance;
  const z = Math.max(-PITCH.goalHalfWidth + 0.3, Math.min(PITCH.goalHalfWidth - 0.3, (dz / d) * advance * 1.3));
  return { x, z };
}

/** u of the second-last opponent, never behind the halfway line (Law 11). */
export function offsideLineU(sign: 1 | -1, opponents: Vec2[]): number {
  const us = opponents.map(p => toTeam(sign, p).u).sort((a, b) => b - a);
  return Math.max(0, us[1] ?? 0);
}
