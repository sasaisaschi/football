import type { BallAction, PlayerProfile, TeamInstruction, Vec2, Vec3 } from '../engine/types';
import { PITCH } from '../physics/pitch-geometry';
import { MAX_ELEVATION } from '../physics/legs';
import { groundPassSpeed, loftedPassSpeed, loftedTime, rollTime } from './ball-model';
import { toTeam } from './shape';

/** A player's picture of the moment, built from his own perception. */
export type Picture = {
  now: number;
  self: PlayerProfile;
  pos: Vec2;
  vel: Vec2;
  sign: 1 | -1;
  ball: { pos: Vec3; vel: Vec3 };
  mates: { id: number; profile: PlayerProfile; pos: Vec2; vel: Vec2 }[];
  opponents: { id: number; profile: PlayerProfile; pos: Vec2; vel: Vec2 }[];
  instruction: TeamInstruction;
  offsideLineU: number;
};

export type OptionKind = 'shot' | 'pass' | 'dribble' | 'clear';
/** One evaluated ball action. `value` is expected goal threat gained minus threat conceded on failure. */
export type EvaluatedOption = {
  kind: OptionKind;
  action: BallAction;
  success: number;
  value: number;
  target?: number;
  note: string;
};

/** Expected threat of having the ball at p (team frame), a smooth stand-in for an xT grid. */
export function threatAt(sign: 1 | -1, p: Vec2): number {
  const goalX = sign * PITCH.halfLength;
  const d = Math.hypot(goalX - p.x, p.z);
  const central = Math.exp(-((p.z / 22) ** 2));
  return 0.006 + 0.32 * Math.exp(-d / 13) * (0.4 + 0.6 * central);
}

/** Opening angle of the goal mouth from p, in radians. */
export function goalAngle(sign: 1 | -1, p: Vec2): number {
  const gx = sign * PITCH.halfLength;
  const a1 = Math.atan2(PITCH.goalHalfWidth - p.z, sign * (gx - p.x));
  const a2 = Math.atan2(-PITCH.goalHalfWidth - p.z, sign * (gx - p.x));
  return Math.abs(a1 - a2);
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): { d: number; t: number } {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return { d: Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z), t };
}

export function pressureOn(pic: Picture): number {
  let pressure = 0;
  for (const o of pic.opponents) {
    const d = Math.hypot(o.pos.x - pic.pos.x, o.pos.z - pic.pos.z);
    pressure = Math.max(pressure, Math.max(0, Math.min(1, (4 - d) / 3.2)));
  }
  return pressure;
}

/** Simple xG from distance, opening angle, defenders in the shooting lane and pressure. */
export function shotXg(pic: Picture, from: Vec2, aim: Vec2): number {
  const gx = pic.sign * PITCH.halfLength;
  const dist = Math.hypot(gx - from.x, from.z);
  const angle = goalAngle(pic.sign, from);
  let blockers = 0;
  for (const o of pic.opponents) {
    if (o.profile.role === 'GK') continue;
    if (segmentDistance(o.pos, from, aim).d < 0.8) blockers++;
  }
  const base = Math.min(0.75, 0.02 + 0.95 * Math.pow(angle / 1.3, 1.25) * Math.exp(-dist / 28));
  return base * Math.pow(0.55, blockers) * (1 - 0.35 * pressureOn(pic)) * (0.75 + 0.5 * pic.self.abilities.shooting);
}

/** Probability that nobody intercepts a ground pass from a to b launched at v0. */
function laneSafety(pic: Picture, a: Vec2, b: Vec2, v0: number, lofted: boolean, flight: number): number {
  let safe = 1;
  for (const o of pic.opponents) {
    const { d, t } = segmentDistance(o.pos, a, b);
    const along = Math.hypot(b.x - a.x, b.z - a.z) * t;
    const ballTime = lofted ? (t > 0.85 ? flight * t : Infinity) : rollTime(v0, along);
    const reach = Math.max(0, d - 0.9) / (6.5 * (0.6 + 0.4 * o.profile.abilities.pace)) + 0.25;
    if (ballTime === Infinity) continue;
    const margin = ballTime - reach;
    safe *= 1 - 1 / (1 + Math.exp(-margin * 6));
  }
  return safe;
}

export function evaluateOptions(pic: Picture): EvaluatedOption[] {
  const out: EvaluatedOption[] = [];
  const from = { x: pic.ball.pos.x, z: pic.ball.pos.z };
  const sign = pic.sign;
  const lossCost = (p: Vec2) => threatAt((-sign) as 1 | -1, p) * 0.8;
  const pressure = pressureOn(pic);

  // Shot at the corner the keeper covers least.
  const gx = sign * PITCH.halfLength;
  if (Math.hypot(gx - from.x, from.z) < 32) {
    const keeper = pic.opponents.find(o => o.profile.role === 'GK');
    const side = keeper && keeper.pos.z > from.z * 0.25 ? -1 : 1;
    const aimZ = side * (PITCH.goalHalfWidth - 0.65);
    const xg = shotXg(pic, from, { x: gx, z: aimZ });
    const dist = Math.hypot(gx - from.x, aimZ - from.z);
    // Only a real chance is worth a shot; speculative efforts mostly give the ball away.
    if (xg >= 0.06) out.push({
      kind: 'shot',
      action: { kind: 'shot', aim: { x: gx, y: Math.min(1.6, 0.35 + dist / 40), z: aimZ }, speed: 24 + 4 * pic.self.abilities.shooting },
      success: xg,
      value: xg - (1 - xg) * 0.02,
      note: `xG ${xg.toFixed(2)}`,
    });
  }

  for (const m of pic.mates) {
    const dist = Math.hypot(m.pos.x - from.x, m.pos.z - from.z);
    if (dist < 5 || dist > 50) continue;
    const lead = Math.min(1.2, dist / 15);
    const target = { x: m.pos.x + m.vel.x * lead, z: m.pos.z + m.vel.z * lead };
    if (Math.abs(target.x) > PITCH.halfLength - 2 || Math.abs(target.z) > PITCH.halfWidth - 3) continue;
    const u = toTeam(sign, target).u;
    if (u > pic.offsideLineU - 0.01 && u > toTeam(sign, from).u) continue; // receiver would be offside
    const td = Math.hypot(target.x - from.x, target.z - from.z);
    const ground = groundPassSpeed(td, 3.5);
    const groundSafe = laneSafety(pic, from, target, ground, false, 0);
    const loftSpeed = loftedPassSpeed(td, Math.min(MAX_ELEVATION, 0.42));
    const loftSafe = td > 16 ? laneSafety(pic, from, target, loftSpeed, true, loftedTime(loftSpeed, 0.42)) * 0.8 : 0;
    const lofted = loftSafe > groundSafe;
    const accuracy = Math.exp(-td / (35 + 45 * pic.self.abilities.passing)) * (1 - 0.25 * pressure);
    let space = 9;
    for (const o of pic.opponents) space = Math.min(space, Math.hypot(o.pos.x - target.x, o.pos.z - target.z));
    const success = (lofted ? loftSafe : groundSafe) * accuracy * (0.55 + 0.45 * Math.min(1, space / 5));
    const value = success * threatAt(sign, target) - (1 - success) * lossCost(from);
    out.push({
      kind: 'pass',
      target: m.id,
      action: { kind: 'pass', receiver: m.id, aim: target, speed: lofted ? loftSpeed : ground, lofted },
      success,
      value,
      note: `${lofted ? 'hoher' : 'flacher'} Pass, ${Math.round(td)} m`,
    });
  }

  // Dribble: carry the ball into the most open direction towards goal.
  let best: { dir: Vec2; score: number } | null = null;
  for (const a of [-0.9, -0.45, 0, 0.45, 0.9]) {
    const base = Math.atan2(0, sign) + a;
    const dir = { x: Math.cos(base), z: Math.sin(base) };
    const ahead = { x: from.x + dir.x * 6, z: from.z + dir.z * 6 };
    if (Math.abs(ahead.z) > PITCH.halfWidth - 4 || Math.abs(ahead.x) > PITCH.halfLength - 2) continue;
    let gap = 9;
    for (const o of pic.opponents) gap = Math.min(gap, segmentDistance(o.pos, from, ahead).d);
    const score = gap + threatAt(sign, ahead) * 20;
    if (!best || score > best.score) best = { dir, score };
  }
  if (best) {
    const ahead = { x: from.x + best.dir.x * 6, z: from.z + best.dir.z * 6 };
    let gap = 9;
    for (const o of pic.opponents) gap = Math.min(gap, segmentDistance(o.pos, from, ahead).d);
    const success = Math.min(0.92, 0.25 + gap / 6) * (0.7 + 0.3 * pic.self.abilities.technique);
    const run = Math.hypot(pic.vel.x, pic.vel.z);
    out.push({
      kind: 'dribble',
      action: { kind: 'dribble', direction: best.dir, speed: Math.max(3, Math.min(6, run + 1.3)) },
      success,
      value: success * threatAt(sign, ahead) - (1 - success) * lossCost(from) * 1.2,
      note: 'Ball am Fuß',
    });
  }

  const away = { x: sign, z: from.z > 0 ? 0.5 : -0.5 };
  const n = Math.hypot(away.x, away.z);
  out.push({
    kind: 'clear',
    action: { kind: 'clear', direction: { x: away.x / n, z: away.z / n }, speed: 25 },
    success: 0.5,
    value: -lossCost(from) * 0.35 - 0.01,
    note: 'klären',
  });
  return out.sort((a, b) => b.value - a.value);
}
