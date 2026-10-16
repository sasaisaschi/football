import { PITCH, attackDirection } from './pitch';
import type { Legs } from './foot-contact';
import type { ActionIntent } from './kick-decision';
import type { Motor } from './player-motor';

export type Role = 'GK' | 'LB' | 'LCB' | 'RCB' | 'RB' | 'LCM' | 'CM' | 'RCM' | 'LW' | 'ST' | 'RW';
export type Tactic = 'press' | 'deep';

export type Player = {
  id: number;
  team: 0 | 1;
  number: number;
  role: Role;
  motor: Motor;
  legs: Legs;
  /** Current on-ball plan (AI or user); outcome is still decided by contact physics. */
  intent: ActionIntent | null;
  /** A coach/user choice waiting to be executed by this player. */
  userIntent: ActionIntent | null;
  decideAt: number;
  recoverUntil: number;
};

/**
 * 4-3-3 in team units: u from own goal line (−1) to opponent goal line (+1), v across the pitch (−1…1).
 * These are kickoff positions inside the own half.
 */
export const FORMATION: { role: Role; number: number; u: number; v: number }[] = [
  { role: 'GK', number: 1, u: -0.96, v: 0 },
  { role: 'LB', number: 3, u: -0.6, v: -0.62 },
  { role: 'LCB', number: 5, u: -0.68, v: -0.22 },
  { role: 'RCB', number: 4, u: -0.68, v: 0.22 },
  { role: 'RB', number: 2, u: -0.6, v: 0.62 },
  { role: 'LCM', number: 8, u: -0.32, v: -0.32 },
  { role: 'CM', number: 6, u: -0.42, v: 0 },
  { role: 'RCM', number: 10, u: -0.32, v: 0.32 },
  { role: 'LW', number: 11, u: -0.06, v: -0.66 },
  { role: 'ST', number: 9, u: -0.04, v: 0.1 },
  { role: 'RW', number: 7, u: -0.06, v: 0.66 },
];

const DEFENDERS = new Set<Role>(['LB', 'LCB', 'RCB', 'RB']);
const MIDFIELD = new Set<Role>(['LCM', 'CM', 'RCM']);
const FORWARDS = new Set<Role>(['LW', 'ST', 'RW']);

export function toWorld(team: number, u: number, v: number): { x: number; z: number } {
  const dir = attackDirection(team);
  return { x: dir * u * PITCH.halfLength, z: dir * v * PITCH.halfWidth };
}

export function toTeam(team: number, x: number, z: number): { u: number; v: number } {
  const dir = attackDirection(team);
  return { u: (dir * x) / PITCH.halfLength, v: (dir * z) / PITCH.halfWidth };
}

export function kickoffPosition(team: number, role: Role): { x: number; z: number } {
  const slot = FORMATION.find(f => f.role === role)!;
  return toWorld(team, slot.u, slot.v);
}

export type ShapeContext = {
  ballX: number;
  ballZ: number;
  inPossession: boolean;
  tactic: Tactic;
  /** Team-unit u of the opponents' second-last player: attackers stay level or behind it. */
  offsideLineU: number;
};

/**
 * Positional play: every player keeps a zone of a block that shifts with the ball, the team's phase and the
 * coach's tactic. Defenders and midfielders stay goal-side of the ball out of possession; forwards hold the
 * offside line in possession. Nobody chases the ball from here — that is the job of the ball winner.
 */
export function shapeTarget(team: number, role: Role, ctx: ShapeContext): { x: number; z: number } {
  const ball = toTeam(team, ctx.ballX, ctx.ballZ);
  if (role === 'GK') return keeperTarget(team, ctx.ballX, ctx.ballZ);
  const slot = FORMATION.find(f => f.role === role)!;
  const tacticShift = ctx.tactic === 'press' ? 0.14 : -0.16;
  const phaseShift = ctx.inPossession ? 0.16 : -0.06;
  const blockU = Math.max(-0.6, Math.min(0.5, ball.u * 0.5 + tacticShift + phaseShift));
  const stretch = ctx.inPossession ? 1.05 : 0.68;
  let u = blockU + (slot.u + 0.36) * stretch;
  const width = ctx.inPossession ? 1 : 0.72;
  let v = slot.v * width + ball.v * (ctx.inPossession ? 0.12 : 0.3);
  if (!ctx.inPossession && (DEFENDERS.has(role) || MIDFIELD.has(role))) {
    u = Math.min(u, ball.u - (DEFENDERS.has(role) ? 0.1 : 0.04));
  }
  if (DEFENDERS.has(role)) u = Math.max(u, -0.88);
  if (ctx.inPossession && FORWARDS.has(role)) u = Math.min(u, Math.max(ctx.offsideLineU - 0.015, ball.u));
  u = Math.max(-0.95, Math.min(0.95, u));
  v = Math.max(-0.94, Math.min(0.94, v));
  return toWorld(team, u, v);
}

/** Keeper stands on the line from goal centre to the ball, advancing as the ball approaches the box. */
function keeperTarget(team: number, ballX: number, ballZ: number): { x: number; z: number } {
  const goalX = -attackDirection(team) * PITCH.halfLength;
  const dx = ballX - goalX, dz = ballZ;
  const d = Math.hypot(dx, dz) || 1;
  const advance = Math.max(0.8, Math.min(5.5, d * 0.12));
  return { x: goalX + (dx / d) * advance, z: Math.max(-PITCH.goalHalfWidth + 0.4, Math.min(PITCH.goalHalfWidth - 0.4, (dz / d) * advance * 1.4)) };
}

/** Law 11 reference line: the second-last opponent (goalkeeper usually last), never behind halfway. */
export function offsideLineU(attackingTeam: number, opponents: Player[]): number {
  const us = opponents
    .map(p => { const t = p.motor.body.translation(); return toTeam(attackingTeam, t.x, t.z).u; })
    .sort((a, b) => b - a);
  return Math.max(0, us[1] ?? 0);
}

const BALL_DAMPING = 0.13;

/**
 * Earliest time and place a player can reach the moving ball, assuming straight-line running at top speed.
 * Used to pick each team's ball winner instead of sending everybody to the ball.
 */
export function interceptEstimate(player: Player, ball: { x: number; z: number; vx: number; vz: number }): { t: number; x: number; z: number } {
  const p = player.motor.body.translation();
  const vmax = player.motor.profile.maxSpeed;
  for (let t = 0; t <= 4; t += 0.1) {
    const travel = (1 - Math.exp(-BALL_DAMPING * t)) / BALL_DAMPING;
    const x = ball.x + ball.vx * travel, z = ball.z + ball.vz * travel;
    const run = Math.hypot(x - p.x, z - p.z) / vmax + 0.3;
    if (run <= t) return { t, x, z };
  }
  const travel = (1 - Math.exp(-BALL_DAMPING * 4)) / BALL_DAMPING;
  const x = ball.x + ball.vx * travel, z = ball.z + ball.vz * travel;
  return { t: 4 + Math.hypot(x - p.x, z - p.z) / vmax, x, z };
}
