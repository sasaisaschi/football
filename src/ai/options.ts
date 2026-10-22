import type { BallAction, PlayerProfile, TeamInstruction, Vec2, Vec3 } from '../engine/types';
import { PITCH } from '../physics/pitch-geometry';
import { MAX_ELEVATION } from '../physics/legs';
import { groundPassSpeed, loftedPassSpeed, loftedTime, rollDistance, rollTime } from './ball-model';
import { toTeam } from './shape';
import { tr } from '../i18n';

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

/** Pace a ground pass should still have on arrival: firm enough not to give defenders time (m/s). */
const PASS_ARRIVAL = 3.5;
/** Longer ground passes are struck harder and still carry pace at the receiver: added per metre beyond 10 m, capped (m/s). */
const PASS_ARRIVAL_PER_M = 0.15;
const PASS_ARRIVAL_MAX = 7;
/** Chance that a receiver with an opponent at his heels loses the ball again (scaled by how close he is). */
const RECEIVER_RISK = 0.4;
/** How fast an opponent effectively closes on a receiver while the pass is on its way (m/s). */
const CLOSING_SPEED = 2;
/** How much safer a lofted pass must look than the ground pass to the same team-mate before it is chosen. */
const LOFT_MARGIN = 0.3;
/**
 * Worth of having the ball at all, beyond the threat from where it is: a possession produces chances later
 * (≈ 0.02 xG per possession in professional football). Losing the ball costs it; a clearance mostly gives it away.
 * Measured 0.01–0.04: 0.02 gave the fewest turnovers and the most shots after a passing move.
 */
const POSSESSION_VALUE = 0.02;
/** Room beside each post a pass towards the own goal must keep, so that a miss goes out for a corner (m). */
const POST_MARGIN = 1.5;
/** Lowest expected-goals value a player still shoots from. */
const MIN_SHOT_XG = 0.04;
/** Pressure (0…1, see pressureOn) from which holding the ball is an option. */
const SHIELD_PRESSURE = 0.5;
/** Chance of keeping the ball with a shielding touch: base plus room away from the opponents, capped. */
const SHIELD_BASE = 0.35;
const SHIELD_MAX = 0.75;
/** What one holding touch costs in expected threat: the defence regroups meanwhile. */
const SHIELD_TIME_COST = 0.003;

export type OptionKind = 'shot' | 'pass' | 'dribble' | 'shield' | 'clear';
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
  // Shaped after published expected-threat grids: ≈ 0.13 at the penalty spot, 0.05 at the edge of the area,
  // 0.02 from 30 m. The former, flatter curve (0.10 at 16 m) made holding the ball in front of the area worth more
  // than a shot from there (measured: 14 shots/90 once possession got calmer).
  return 0.006 + 0.5 * Math.exp(-d / 8) * (0.4 + 0.6 * central);
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
  // Calibrated to common open-play xG values: ≈ 0.26 at 11 m, 0.12 at 16 m, 0.065 at 20 m, 0.03 at 25 m (central).
  const base = Math.min(0.75, 1.1 * angle * Math.exp(-dist / 11));
  return base * Math.pow(0.55, blockers) * (1 - 0.35 * pressureOn(pic)) * (0.75 + 0.5 * pic.self.abilities.shooting);
}

/** Reaction before an opponent starts for a pass (s). */
const INTERCEPT_REACTION = 0.25;
/** Acceleration of a player starting for a ball (m/s²); elite starts reach 5.5–8. */
const INTERCEPT_ACCEL = 6;

/**
 * Time to cover s metres from a standstill, accelerating to max. Assuming top speed from the first step made
 * every nearby opponent look like an interception: ground passes predicted at < 20 % arrived 54 % of the time.
 */
function runTime(s: number, vmax: number): number {
  const sAccel = (vmax * vmax) / (2 * INTERCEPT_ACCEL);
  return s <= sAccel ? Math.sqrt((2 * s) / INTERCEPT_ACCEL) : vmax / INTERCEPT_ACCEL + (s - sAccel) / vmax;
}

/** Probability that nobody intercepts a ground pass from a to b launched at v0. */
function laneSafety(pic: Picture, a: Vec2, b: Vec2, v0: number, lofted: boolean, flight: number): number {
  let safe = 1;
  for (const o of pic.opponents) {
    const { d, t } = segmentDistance(o.pos, a, b);
    const along = Math.hypot(b.x - a.x, b.z - a.z) * t;
    const ballTime = lofted ? (t > 0.85 ? flight * t : Infinity) : rollTime(v0, along);
    const reach = INTERCEPT_REACTION + runTime(Math.max(0, d - 0.9), 6.5 * (0.6 + 0.4 * o.profile.abilities.pace));
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
  // Losing the ball hands the opponents their threat from that spot and gives up the threat we had there.
  const lossCost = (p: Vec2) => threatAt((-sign) as 1 | -1, p) * 0.8 + threatAt(sign, p) + POSSESSION_VALUE;
  const pressure = pressureOn(pic);

  // Shot at the corner the keeper covers least.
  const gx = sign * PITCH.halfLength;
  if (Math.hypot(gx - from.x, from.z) < 32) {
    const keeper = pic.opponents.find(o => o.profile.role === 'GK');
    const side = keeper && keeper.pos.z > from.z * 0.25 ? -1 : 1;
    const aimZ = side * (PITCH.goalHalfWidth - 0.65);
    const xg = shotXg(pic, from, { x: gx, z: aimZ });
    const dist = Math.hypot(gx - from.x, aimZ - from.z);
    // Only a real chance is worth a shot; speculative efforts mostly give the ball away. From ≈ 20 m central
    // (xG ≈ 0.04) players do try it, as in professional football (measured: 20 shots/90, 12 % scored).
    if (xg >= MIN_SHOT_XG) out.push({
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
    const ground = groundPassSpeed(td, Math.min(PASS_ARRIVAL_MAX, PASS_ARRIVAL + PASS_ARRIVAL_PER_M * Math.max(0, td - 10)));
    // A back-pass to the keeper never goes on a line that rolls on into the goal if he misses it (traced: three of
    // five own goals). Applied to every pass towards the own goal it also took away safe back-passes in midfield,
    // where the keeper collects a missed ball: shots fell from 21 to 17 per 90.
    if (m.profile.role === 'GK' && rollsIntoOwnGoal(sign, from, target, ground)) continue;
    const groundSafe = laneSafety(pic, from, target, ground, false, 0);
    const loftSpeed = loftedPassSpeed(td, Math.min(MAX_ELEVATION, 0.42));
    // A dropping ball is much harder to bring down than a rolling one (measured: about half are kept).
    const loftSafe = td > 16 ? laneSafety(pic, from, target, loftSpeed, true, loftedTime(loftSpeed, 0.42)) * 0.5 : 0;
    // A rolling pass is preferred unless the ball over the top is clearly safer: chosen on any margin, long balls made up 41 %
    // of all passes and only 47 % of them reached a team-mate (17 % went straight out of play).
    // Never a ball over the top to the own keeper: he may not handle a deliberate back-pass, and a dropping ball
    // he has to play with his feet bounced off him into the goal (traced own goals).
    const lofted = m.profile.role !== 'GK' && loftSafe > groundSafe + LOFT_MARGIN;
    // Calibrated against measured completion (6 seeds): with accurate strikes the receiver keeps most balls
    // even with a marker two metres away; distance and pressure still cost accuracy.
    const accuracy = Math.exp(-td / (60 + 60 * pic.self.abilities.passing)) * (1 - 0.15 * pressure);
    let space = 9;
    for (const o of pic.opponents) space = Math.min(space, Math.hypot(o.pos.x - target.x, o.pos.z - target.z));
    const success = (lofted ? loftSafe : groundSafe) * accuracy * (0.75 + 0.25 * Math.min(1, space / 4));
    // Arriving is not keeping: a receiver closed down by an opponent may lose it again, where he stands. The
    // opponents keep running while the ball travels, so a slow ball arrives with less room around him.
    const travel = Math.min(4, lofted ? loftedTime(loftSpeed, 0.42) : rollTime(ground, td));
    const keep = 1 - RECEIVER_RISK * Math.max(0, 1 - (space - CLOSING_SPEED * travel) / 5);
    const value = success * (keep * threatAt(sign, target) - (1 - keep) * lossCost(target)) - (1 - success) * lossCost(from);
    out.push({
      kind: 'pass',
      target: m.id,
      action: { kind: 'pass', receiver: m.id, aim: target, speed: lofted ? loftSpeed : ground, lofted },
      success,
      value,
      note: lofted ? tr(`high pass, ${Math.round(td)} m`, `hoher Pass, ${Math.round(td)} m`) : tr(`ground pass, ${Math.round(td)} m`, `flacher Pass, ${Math.round(td)} m`),
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
    // Calibrated against measured outcomes (6 seeds): share of carries still in the team's possession 1.5 s
    // after the touch rises from ≈ 0.3 with an opponent in the way to ≈ 0.6 in open space.
    const success = Math.min(0.72, 0.22 + gap / 9) * (0.7 + 0.3 * pic.self.abilities.technique);
    const run = Math.hypot(pic.vel.x, pic.vel.z);
    // With an opponent close the ball is kept within a stride; in space it is pushed ahead to run onto.
    const speed = pressure > 0.4 ? Math.max(2.2, Math.min(4.5, run + 0.4)) : Math.max(3, Math.min(6, run + 1.3));
    out.push({
      kind: 'dribble',
      action: { kind: 'dribble', direction: best.dir, speed },
      success,
      value: success * threatAt(sign, ahead) - (1 - success) * lossCost(from) * 1.2,
      note: tr('ball at feet', 'Ball am Fuß'),
    });
  }

  const shield = shieldOption(pic, from, pressure, lossCost);
  if (shield) out.push(shield);

  const away = { x: sign, z: from.z > 0 ? 0.5 : -0.5 };
  const n = Math.hypot(away.x, away.z);
  out.push({
    kind: 'clear',
    action: { kind: 'clear', direction: { x: away.x / n, z: away.z / n }, speed: 25 },
    success: 0.5,
    value: -lossCost(from) * 0.35 - 0.6 * POSSESSION_VALUE - 0.01,
    note: tr('clear', 'klären'),
  });
  return out.sort((a, b) => b.value - a.value);
}

/** Would a ground pass from `a` towards `b` at v0, missed by its receiver, still roll over the own goal line between the posts? */
function rollsIntoOwnGoal(sign: 1 | -1, a: Vec2, b: Vec2, v0: number): boolean {
  const lineX = -sign * PITCH.halfLength;
  const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
  if (d < 1e-6 || dx * -sign <= 0) return false;
  const s = ((lineX - a.x) / dx) * d;
  if (Math.abs(a.z + (dz / d) * s) > PITCH.goalHalfWidth + POST_MARGIN) return false;
  return rollDistance(v0) > s;
}

/**
 * Holding the ball under pressure: a short touch away from the nearest opponent with the body between him and
 * the ball (the execution puts the ball on the far foot), buying time until a team-mate is free for a pass. Not
 * progress, only keeping the ball where it is worth what it is worth.
 */
function shieldOption(pic: Picture, from: Vec2, pressure: number, lossCost: (p: Vec2) => number): EvaluatedOption | null {
  if (pressure < SHIELD_PRESSURE) return null;
  let near: Vec2 | null = null, nd = Infinity;
  for (const o of pic.opponents) {
    const d = Math.hypot(o.pos.x - from.x, o.pos.z - from.z);
    if (d < nd) { nd = d; near = o.pos; }
  }
  if (!near) return null;
  const base = Math.atan2(from.z - near.z, from.x - near.x);
  let best: { dir: Vec2; gap: number } | null = null;
  for (const turn of [0, -0.6, 0.6]) {
    const dir = { x: Math.cos(base + turn), z: Math.sin(base + turn) };
    const ahead = { x: from.x + dir.x * 3, z: from.z + dir.z * 3 };
    if (Math.abs(ahead.z) > PITCH.halfWidth - 1.5 || Math.abs(ahead.x) > PITCH.halfLength - 1.5) continue;
    let gap = 6;
    for (const o of pic.opponents) gap = Math.min(gap, segmentDistance(o.pos, from, ahead).d);
    if (!best || gap > best.gap) best = { dir, gap };
  }
  if (!best) return null;
  const success = Math.min(SHIELD_MAX, SHIELD_BASE + best.gap / 8) * (0.7 + 0.3 * pic.self.abilities.technique);
  const run = Math.hypot(pic.vel.x, pic.vel.z);
  return {
    kind: 'shield',
    action: { kind: 'dribble', direction: best.dir, speed: Math.max(1.4, Math.min(2.4, run + 0.3)) },
    success,
    // Holding is not free: while the ball is kept, the defence gets back into shape.
    value: success * threatAt(pic.sign, from) - (1 - success) * lossCost(from) * 1.2 - SHIELD_TIME_COST,
    note: tr('shield the ball', 'Ball abschirmen'),
  };
}
