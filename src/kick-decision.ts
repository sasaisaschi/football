import { PITCH, attackDirection } from './pitch';
import type { Side, SwingError, SwingRequest, Technique } from './foot-contact';
import { headingVector } from './player-motor';
import { Player, Tactic, offsideLineU, toTeam } from './team';

export type ActionKind = 'pass' | 'shot' | 'dribble' | 'clear' | 'control';

/**
 * What a player wants to do with the ball. Produced by the AI or chosen by the user at a decisive moment;
 * both are executed the same way — as a swing whose result only physics decides.
 */
export type ActionIntent = {
  kind: ActionKind;
  source: 'ai' | 'user';
  dirX: number;
  dirZ: number;
  elevation: number;
  ballSpeed: number;
  targetPlayer?: number;
  /** Aim point, kept for logging and analysis only — never fed back into the ball. */
  aimX?: number;
  aimZ?: number;
};

export type DecisionView = {
  self: Player;
  teammates: Player[];
  opponents: Player[];
  ball: { x: number; y: number; z: number; vx: number; vy: number; vz: number };
  tactic: Tactic;
  /** Set-piece restart: the ball must be played away, not dribbled or trapped. */
  restart?: boolean;
};

const GRAVITY = 9.81;

const pos = (p: Player) => p.motor.body.translation();
const vel = (p: Player) => p.motor.body.linvel();

export function techniqueFor(kind: ActionKind, elevation: number): Technique {
  if (kind === 'control') return 'cushion';
  if (kind === 'shot' || kind === 'clear' || elevation > 0.2) return 'instep';
  return 'inside';
}

/** Kick with the foot on the side the ball lies, relative to the player's facing. */
export function kickingSide(self: Player, ballX: number, ballZ: number): Side {
  const p = pos(self);
  const f = headingVector(self.motor.heading);
  const lateral = (ballX - p.x) * f.z - (ballZ - p.z) * f.x;
  return lateral >= 0 ? 1 : -1;
}

export function swingRequest(intent: ActionIntent, side: Side): SwingRequest {
  return {
    technique: techniqueFor(intent.kind, intent.elevation),
    side,
    dirX: intent.dirX,
    dirZ: intent.dirZ,
    elevation: intent.elevation,
    ballSpeed: intent.ballSpeed,
  };
}

/** Distance from point to segment a→b in the ground plane, plus where along the segment (0…1) it is closest. */
function segmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return { d: Math.hypot(ax + dx * t - px, az + dz * t - pz), t };
}

function pressureOn(self: Player, opponents: Player[]): number {
  const p = pos(self);
  let pressure = 0;
  for (const o of opponents) {
    const q = pos(o);
    pressure = Math.max(pressure, Math.max(0, Math.min(1, (3.5 - Math.hypot(q.x - p.x, q.z - p.z)) / 3)));
  }
  return pressure;
}

function towards(fromX: number, fromZ: number, x: number, z: number) {
  const dx = x - fromX, dz = z - fromZ;
  const d = Math.hypot(dx, dz) || 1;
  return { dirX: dx / d, dirZ: dz / d, distance: d };
}

/** Utility-based on-ball decision from the player's own view of nearby players and goal. */
export function decideAction(view: DecisionView): ActionIntent {
  const { self, teammates, opponents, ball } = view;
  const dir = attackDirection(self.team);
  const incoming = Math.hypot(ball.vx, ball.vz);
  const pressure = pressureOn(self, opponents);
  const own = toTeam(self.team, ball.x, ball.z);

  // A hard, arriving ball is first brought under control unless a clearance is urgent.
  if (!view.restart && incoming > 7.5 && !(own.u < -0.6 && pressure > 0.5)) {
    return { kind: 'control', source: 'ai', dirX: ball.vx / incoming, dirZ: ball.vz / incoming, elevation: 0, ballSpeed: 0 };
  }

  const goalX = dir * PITCH.halfLength;
  const shot = shotOption(view, goalX);
  const passes = passOptions(view);
  const best = passes[0];

  if (view.restart) {
    if (best) return best.intent;
    const away = towards(ball.x, ball.z, ball.x + dir * 30, ball.z * 0.5);
    return { kind: 'clear', source: 'ai', dirX: away.dirX, dirZ: away.dirZ, elevation: 0.45, ballSpeed: 22 };
  }
  if (shot && shot.score > 0.36 && (!best || shot.score >= best.score * 0.7)) return shot.intent;
  if (own.u < -0.55 && pressure > 0.45 && (!best || best.score < 0.6)) {
    const away = towards(ball.x, ball.z, ball.x + dir * 30, ball.z * 1.3);
    return { kind: 'clear', source: 'ai', dirX: away.dirX, dirZ: away.dirZ, elevation: 0.5, ballSpeed: 24 };
  }
  if (best && (pressure > 0.35 || best.score > 0.75)) return best.intent;

  // Carry the ball into space: towards goal, bending away from the nearest opponent.
  const p = pos(self);
  let dx = dir, dz = -Math.sign(p.z) * 0.15;
  for (const o of opponents) {
    const q = pos(o);
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < 6) { dx -= ((q.x - p.x) / d) * (6 - d) * 0.12; dz -= ((q.z - p.z) / d) * (6 - d) * 0.25; }
  }
  const n = Math.hypot(dx, dz) || 1;
  const runSpeed = Math.hypot(vel(self).x, vel(self).z);
  return { kind: 'dribble', source: 'ai', dirX: dx / n, dirZ: dz / n, elevation: 0, ballSpeed: Math.max(3.5, Math.min(7.5, runSpeed + 2.2)) };
}

function shotOption(view: DecisionView, goalX: number): { score: number; intent: ActionIntent } | null {
  const { ball, opponents, self } = view;
  const distance = Math.hypot(goalX - ball.x, ball.z);
  if (distance > 28) return null;
  // Aim inside the post the keeper covers least.
  const keeper = opponents.find(o => o.role === 'GK');
  const keeperZ = keeper ? pos(keeper).z : 0;
  const aimZ = (keeperZ > ball.z * 0.2 ? -1 : 1) * (PITCH.goalHalfWidth - 0.7);
  const aim = towards(ball.x, ball.z, goalX, aimZ);
  const opening = Math.abs(Math.atan2(PITCH.goalHalfWidth, distance)) * 2;
  let blockers = 0;
  for (const o of opponents) {
    if (o.role === 'GK') continue;
    const q = pos(o);
    if (segmentDistance(q.x, q.z, ball.x, ball.z, goalX, aimZ).d < 0.9) blockers++;
  }
  const score = Math.min(1, opening * 2.5) * (1 - distance / 40) * Math.pow(0.6, blockers) * (1 + pressureOn(self, opponents) * 0.3);
  const elevation = 0.05 + Math.min(0.12, distance / 220);
  return { score, intent: { kind: 'shot', source: 'ai', dirX: aim.dirX, dirZ: aim.dirZ, elevation, ballSpeed: 26, aimX: goalX, aimZ } };
}

function passOptions(view: DecisionView): { score: number; intent: ActionIntent }[] {
  const { self, teammates, opponents, ball } = view;
  const dir = attackDirection(self.team);
  const line = offsideLineU(self.team, opponents);
  const options: { score: number; intent: ActionIntent }[] = [];
  for (const mate of teammates) {
    if (mate === self) continue;
    const m = pos(mate), mv = vel(mate);
    const rough = Math.hypot(m.x - ball.x, m.z - ball.z);
    if (rough < 4 || rough > 45) continue;
    const lead = Math.min(1.2, rough / 14);
    const tx = m.x + mv.x * lead, tz = m.z + mv.z * lead;
    const target = towards(ball.x, ball.z, tx, tz);
    const mateU = toTeam(self.team, m.x, m.z).u;
    if (mateU > line - 0.012 && mateU > toTeam(self.team, ball.x, ball.z).u) continue; // receiver (nearly) offside
    // Lane safety: how far opponents stand from the ball's path, weighted by how early they could reach it.
    let lane = 99;
    for (const o of opponents) {
      const q = pos(o);
      const s = segmentDistance(q.x, q.z, ball.x, ball.z, tx, tz);
      lane = Math.min(lane, s.d / (0.35 + s.t));
    }
    let space = 99;
    for (const o of opponents) { const q = pos(o); space = Math.min(space, Math.hypot(q.x - tx, q.z - tz)); }
    const lofted = lane < 2.2 && target.distance > 16;
    const advance = ((tx - ball.x) * dir) / 30;
    const score =
      Math.min(1, (lofted ? 2.2 : lane) / 4) * 0.45 + Math.min(1, space / 8) * 0.3 + Math.max(-0.3, Math.min(0.35, advance)) - target.distance / 140;
    const elevation = lofted ? 0.42 : 0;
    const ballSpeed = lofted
      ? Math.sqrt((GRAVITY * target.distance) / Math.sin(2 * elevation)) * 1.12
      : Math.max(7, Math.min(21, 4.8 + target.distance * 0.42));
    options.push({
      score,
      intent: { kind: 'pass', source: 'ai', dirX: target.dirX, dirZ: target.dirZ, elevation, ballSpeed, targetPlayer: mate.id, aimX: tx, aimZ: tz },
    });
  }
  return options.sort((a, b) => b.score - a.score);
}

/**
 * Motor noise for one swing. It grows with opponent pressure, ball speed relative to the body, how far the body
 * is turned away from the intended direction and the requested power. Applied to the boot path only.
 */
export function swingError(view: DecisionView, intent: ActionIntent, random: () => number): SwingError {
  const { self, opponents, ball } = view;
  const v = vel(self);
  const relSpeed = Math.hypot(ball.vx - v.x, ball.vz - v.z);
  const f = headingVector(self.motor.heading);
  const bodyAngle = intent.kind === 'control' ? 0 : Math.acos(Math.max(-1, Math.min(1, f.x * intent.dirX + f.z * intent.dirZ)));
  const technique = techniqueFor(intent.kind, intent.elevation);
  const base = technique === 'inside' ? 0.007 : technique === 'instep' ? 0.013 : 0.018;
  const power = intent.kind === 'shot' || intent.kind === 'clear' ? 0.6 : intent.ballSpeed / 30;
  const factor = 1 + 1.6 * pressureOn(self, opponents) + relSpeed / 5 + bodyAngle * 1.2 + power;
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, random()))) * Math.cos(2 * Math.PI * random());
  return {
    lateral: gauss() * base * factor,
    vertical: gauss() * base * 0.8 * factor,
    angle: gauss() * 0.012 * factor,
    speedFactor: 1 + gauss() * 0.04 * factor,
    timing: Math.abs(gauss()) * 0.006 * factor,
  };
}

/** Deterministic PRNG so a match can be replayed from its seed (mulberry32). */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
