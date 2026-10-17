import type RAPIER from '@dimforge/rapier3d-simd-compat';
import type { BallAction, PlayerIntent, PlayerProfile, RestartKind, TeamInstruction, Vec2 } from '../engine/types';
import type { Rng } from '../engine/rng';
import type { BodyCommand, PlayerBody } from '../physics/body';
import type { Legs } from '../physics/legs';
import { PITCH, inPenaltyArea } from '../physics/pitch-geometry';
import { approach, trySwing } from './execution';
import { evaluateOptions, pressureOn, type EvaluatedOption, type Picture } from './options';
import { Perception, type Truth } from './perception';
import { DEFENDERS, MIDFIELDERS, keeperShape, offsideLineU, shapeTarget, toTeam } from './shape';

/** What the engine tells a brain each tick: things every player can see or knows from the rules. */
export type BrainContext = {
  now: number;
  truth: Truth;
  sign: 1 | -1;
  instruction: TeamInstruction;
  possession: 0 | 1 | null;
  ball: RAPIER.RigidBody;
  profiles: PlayerProfile[];
  /** Set while the ball is dead: who takes the restart and where everybody must stay away from. */
  restart: { kind: RestartKind; team: 0 | 1; taker: number; spot: Vec2; minDistance: number; ownHalfOnly: boolean; ready: boolean } | null;
  /** May the player use his hands? (keeper in own area, ball in play, not a back-pass) */
  handsAllowed: boolean;
  /** Keeper holding the ball in his hands, if any. Nobody may challenge him (Law 12). */
  ballHeldBy: number | null;
};

export type BrainOutput = { command: BodyCommand; effort: number; swing: { action: BallAction; source: 'ai' | 'user' } | null };

/** Effective deceleration (m/s²) a player assumes for a moving ball when guessing where to meet it. */
const BALL_DAMPING = 1.1;

/**
 * One autonomous footballer. Decides from its own perception a few times per second: win the ball, play it,
 * support, press, mark or hold its zone. User decisions arrive as `userIntent` and replace the next choice.
 */
export class PlayerBrain {
  readonly perception: Perception;
  intent: PlayerIntent | null = null;
  userIntent: PlayerIntent | null = null;
  committedToBall = false;
  private nextDecision = 0;
  lastOptions: EvaluatedOption[] = [];

  constructor(readonly profile: PlayerProfile, readonly body: PlayerBody, readonly legs: Legs, private readonly rng: Rng) {
    this.perception = new Perception(profile, rng);
  }

  picture(ctx: BrainContext): Picture {
    const per = this.perception;
    const ball = per.ballNow(ctx.now);
    const others = ctx.profiles.filter(p => p.id !== this.profile.id).map(p => {
      const s = per.others.get(p.id);
      return { id: p.id, profile: p, pos: per.playerNow(p.id, ctx.now) ?? { x: 0, z: 0 }, vel: s?.vel ?? { x: 0, z: 0 }, known: !!s };
    }).filter(o => o.known);
    const opponents = others.filter(o => o.profile.team !== this.profile.team);
    return {
      now: ctx.now,
      self: this.profile,
      pos: this.body.position(),
      vel: this.body.velocity(),
      sign: ctx.sign,
      ball: { pos: ball.pos, vel: ball.vel },
      // The keeper is only a passing option when the ball is in the own third.
      mates: others.filter(o => o.profile.team === this.profile.team && (o.profile.role !== 'GK' || toTeam(ctx.sign, { x: ball.pos.x, z: ball.pos.z }).u < -0.3)),
      opponents,
      instruction: ctx.instruction,
      offsideLineU: offsideLineU(ctx.sign, opponents.map(o => o.pos)),
    };
  }

  /** Estimated time for a player at p with top speed v to reach the (believed) moving ball. */
  static interceptTime(p: Vec2, vmax: number, ball: { pos: Vec2; vel: Vec2 }): { t: number; at: Vec2 } {
    const speed = Math.max(0.01, Math.hypot(ball.vel.x, ball.vel.z));
    const stop = speed / BALL_DAMPING;
    for (let t = 0; t <= 4; t += 0.1) {
      // Position along the ball's path after t seconds of uniform deceleration (it does not roll backwards).
      const tt = Math.min(t, stop);
      const k = tt - (0.5 * BALL_DAMPING * tt * tt) / speed;
      const at = { x: ball.pos.x + ball.vel.x * k, z: ball.pos.z + ball.vel.z * k };
      if (Math.hypot(at.x - p.x, at.z - p.z) / vmax + 0.3 <= t) return { t, at };
    }
    return { t: 4 + Math.hypot(ball.pos.x - p.x, ball.pos.z - p.z) / vmax, at: ball.pos };
  }

  /** Do I believe I am my team's quickest player to the ball? Decentralised, so two may go, or none. */
  private believesBallIsMine(ctx: BrainContext, ball: { pos: Vec2; vel: Vec2 }): boolean {
    if (ctx.restart) return ctx.restart.taker === this.profile.id;
    // The keeper only plays the ball with his feet inside his own area (back-passes, loose balls).
    if (this.profile.role === 'GK' && !inPenaltyArea(ball.pos.x, ball.pos.z, (-ctx.sign) as 1 | -1)) return false;
    // A ball played towards me is mine to receive (the passer looked at me; the receiver knows it).
    if (this.ballComingToMe(ball)) return true;
    const mine = PlayerBrain.interceptTime(this.body.position(), this.body.limits.maxSpeed, ball).t - (this.committedToBall ? 0.25 : 0);
    for (const p of ctx.profiles) {
      if (p.team !== this.profile.team || p.id === this.profile.id) continue;
      const pos = this.perception.playerNow(p.id, ctx.now);
      if (!pos) continue;
      if (PlayerBrain.interceptTime(pos, 8.4, ball).t < mine - 0.05) return false;
    }
    return true;
  }

  /** Is the moving ball's path passing within reach of me, ahead of it, and no further than a pass length? */
  private ballComingToMe(ball: { pos: Vec2; vel: Vec2 }): boolean {
    const speed = Math.hypot(ball.vel.x, ball.vel.z);
    if (speed < 3) return false;
    const self = this.body.position();
    const dx = self.x - ball.pos.x, dz = self.z - ball.pos.z;
    const along = (dx * ball.vel.x + dz * ball.vel.z) / speed;
    if (along < 1 || along > 40) return false;
    const lateral = Math.abs(dx * ball.vel.z - dz * ball.vel.x) / speed;
    return lateral < 2.2;
  }

  think(ctx: BrainContext): BrainOutput {
    const out = this.decide(ctx);
    const order = this.userIntent;
    if (order?.type === 'move' && order.action.kind === 'tactical-foul') return out;
    // Mid-swing the body is committed to the run the kick was planned for.
    if (this.legs.busy()) return out;
    return { ...out, command: this.controlledApproach(out.command, ctx) };
  }

  /**
   * Footballers do not sprint into each other: when a body is close ahead on the running line, the player
   * slows to a controllable challenging speed. A tactical foul order skips this on purpose.
   */
  private controlledApproach(cmd: BodyCommand, ctx: BrainContext): BodyCommand {
    const self = this.body.position();
    const v = this.body.velocity();
    const speed = Math.hypot(v.x, v.z);
    if (speed < 2.5) return cmd;
    const ux = v.x / speed, uz = v.z / speed;
    let limit = cmd.speed;
    for (const [id] of this.perception.others) {
      const p = this.perception.playerNow(id, ctx.now);
      if (!p) continue;
      const dx = p.x - self.x, dz = p.z - self.z;
      const d = Math.hypot(dx, dz);
      if (d > 3 || d < 0.01) continue;
      const ahead = (dx * ux + dz * uz) / d;
      if (ahead < 0.6) continue;
      limit = Math.min(limit, 1.8 + (d - 0.6) * 1.4);
    }
    return limit < cmd.speed ? { ...cmd, speed: Math.max(1.5, limit) } : cmd;
  }

  private decide(ctx: BrainContext): BrainOutput {
    const self = this.body.position();
    this.perception.observe(ctx.truth, self, this.body.heading);
    const believed = this.perception.ballNow(ctx.now);
    const ball = { pos: { x: believed.pos.x, z: believed.pos.z }, vel: { x: believed.vel.x, z: believed.vel.z } };
    if (this.legs.busy()) {
      // Mid-swing the body keeps the pace the leg was planned for: the planted foot carries it through the kick.
      const v = this.body.velocity();
      return { command: { target: { x: self.x + v.x * 2, z: self.z + v.z * 2 }, speed: this.body.speed() }, effort: 1, swing: null };
    }
    const order = this.userIntent;
    if (order?.type === 'move') {
      if (ctx.now < order.until && !ctx.restart) return this.followOrder(order.action, ctx, ball);
      this.userIntent = null;
    }
    this.committedToBall = ctx.ballHeldBy === null && this.believesBallIsMine(ctx, ball);
    if (this.committedToBall) return this.playBall(ctx, ball);
    this.intent = null;
    return { command: this.steerAround(this.offBall(ctx, ball), ctx), effort: 1, swing: null };
  }

  /** A movement order from the coach (via a decision moment). The body still has to make it happen. */
  private followOrder(action: Extract<PlayerIntent, { type: 'move' }>['action'], ctx: BrainContext, ball: { pos: Vec2; vel: Vec2 }): BrainOutput {
    const max = this.body.limits.maxSpeed;
    switch (action.kind) {
      case 'press': case 'tactical-foul': case 'mark': {
        const target = this.perception.playerNow(action.target, ctx.now) ?? ball.pos;
        // A tactical foul means running into the opponent's path; whether it becomes a foul is the referee's call.
        const lead = action.kind === 'tactical-foul' ? 0.35 : 0;
        const v = this.perception.others.get(action.target)?.vel ?? { x: 0, z: 0 };
        return { command: { target: { x: target.x + v.x * lead, z: target.z + v.z * lead }, speed: max, face: target }, effort: 1, swing: null };
      }
      case 'run-behind': case 'recover':
        return { command: { target: action.target, speed: max, face: ball.pos }, effort: 1, swing: null };
      case 'hold-shape':
        return { command: this.steerAround(this.offBall(ctx, ball), ctx), effort: 1, swing: null };
    }
  }

  /** Off the ball, players run around each other instead of through each other. */
  private steerAround(cmd: BodyCommand, ctx: BrainContext): BodyCommand {
    const self = this.body.position();
    const dx = cmd.target.x - self.x, dz = cmd.target.z - self.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) return cmd;
    const ux = dx / d, uz = dz / d;
    let side = 0;
    for (const [id] of this.perception.others) {
      const p = this.perception.playerNow(id, ctx.now);
      if (!p) continue;
      const ox = p.x - self.x, oz = p.z - self.z;
      const ahead = ox * ux + oz * uz;
      if (ahead <= 0 || ahead > Math.min(d, 2.5)) continue;
      const lateral = -ox * uz + oz * ux;
      if (Math.abs(lateral) > 1.1) continue;
      side += (lateral >= 0 ? -1 : 1) * (1.1 - Math.abs(lateral));
    }
    if (side === 0) return cmd;
    // Sidestep to the right of the running direction is (−uz, ux).
    return { ...cmd, target: { x: cmd.target.x - uz * side * 1.5, z: cmd.target.z + ux * side * 1.5 } };
  }

  private playBall(ctx: BrainContext, ball: { pos: Vec2; vel: Vec2 }): BrainOutput {
    const self = this.body.position();
    const distance = Math.hypot(ball.pos.x - self.x, ball.pos.z - self.z);
    const intercept = PlayerBrain.interceptTime(self, this.body.limits.maxSpeed, ball);
    const carrier = this.opponentInControl(ctx, ball);
    if (carrier && !ctx.restart) {
      // Jockey: stay goal-side of the carrier at arm's length and only step in when the ball runs loose.
      const looseBall = Math.hypot(ball.pos.x - carrier.x, ball.pos.z - carrier.z) > 0.75;
      if (!looseBall || distance > 2.2) {
        this.intent = null;
        const goalX = -ctx.sign * PITCH.halfLength;
        const gx = goalX - carrier.x, gz = -carrier.z, gd = Math.hypot(gx, gz) || 1;
        const hold = { x: carrier.x + (gx / gd) * 1.4, z: carrier.z + (gz / gd) * 1.4 };
        const gap = Math.hypot(hold.x - self.x, hold.z - self.z);
        return { command: { target: hold, speed: gap > 4 ? this.body.limits.maxSpeed : 2.5 + gap, face: ball.pos }, effort: 1, swing: null };
      }
    }
    if (distance > 3.5) {
      this.intent = null;
      // On the way to the ball, run around bodies instead of through them; challenges happen at the ball.
      return { command: this.steerAround({ target: intercept.at, speed: this.body.limits.maxSpeed, face: ball.pos }, ctx), effort: 1, swing: null };
    }
    if (this.userIntent?.type === 'ball') {
      this.intent = this.userIntent;
    } else if (!this.intent || this.intent.type !== 'ball' || ctx.now >= this.nextDecision) {
      this.intent = { type: 'ball', action: this.chooseAction(ctx), source: 'ai', decidedAt: ctx.now };
      this.nextDecision = ctx.now + 0.3;
    }
    const action = this.intent.action;
    const command = approach(this.body, this.legs, action, ball, intercept.at);
    const ready = !ctx.restart || ctx.restart.ready;
    let swing: BrainOutput['swing'] = null;
    if (ready && distance < 1.5) {
      const plan = trySwing(this.body, this.legs, ctx.ball, action, { pressure: pressureOn(this.picture(ctx)), profile: this.profile, rng: this.rng });
      if (plan) {
        swing = { action, source: this.intent.source };
        if (this.intent.source === 'user') this.userIntent = null;
        this.intent = null;
      }
    }
    return { command, effort: 1, swing };
  }

  /** An opponent who (as far as I can see) has the ball at his feet and is closer to it than I am. */
  private opponentInControl(ctx: BrainContext, ball: { pos: Vec2; vel: Vec2 }): Vec2 | null {
    const self = this.body.position();
    const mine = Math.hypot(ball.pos.x - self.x, ball.pos.z - self.z);
    let carrier: Vec2 | null = null, best = 1.1;
    for (const p of ctx.profiles) {
      if (p.team === this.profile.team) continue;
      const pos = this.perception.playerNow(p.id, ctx.now);
      if (!pos) continue;
      const d = Math.hypot(ball.pos.x - pos.x, ball.pos.z - pos.z);
      if (d < best && d < mine) { best = d; carrier = pos; }
    }
    return carrier;
  }

  /** AI choice: best evaluated option, blurred by vision and shifted by the coach's risk setting. */
  chooseAction(ctx: BrainContext): BallAction {
    const pic = this.picture(ctx);
    const speed = Math.hypot(pic.ball.vel.x, pic.ball.vel.z);
    const self = this.body.position();
    const relDir = (pic.ball.vel.x * (self.x - pic.ball.pos.x) + pic.ball.vel.z * (self.z - pic.ball.pos.z));
    let options = evaluateOptions(pic);
    // A ball played towards me is first brought under control, unless a safe first-time pass or a real
    // chance is on: a first-time kick has to meet the ball before it reaches the body.
    if (!ctx.restart && speed > 2.5 && relDir > 0) {
      const first = options[0];
      if (!first || !((first.kind === 'pass' && first.success > 0.65) || (first.kind === 'shot' && first.success > 0.15))) {
        this.lastOptions = options;
        return { kind: 'control' };
      }
    }
    if (ctx.restart) options = options.filter(o => o.kind === 'pass' || o.kind === 'clear');
    this.lastOptions = options;
    // Option values are expected-threat differences of a few thousandths in midfield; misjudgement has to be
    // on that scale, or it would swamp the evaluation and turn every choice into a coin toss.
    const noise = 0.004 * (1.2 - this.profile.abilities.vision);
    let best = options[0], bestScore = -Infinity;
    for (const o of options) {
      // The coach's risk setting trades safety for threat: bold teams value forward threat, cautious ones possession.
      const forward = o.kind === 'shot' || (o.kind === 'pass' && 'aim' in o.action && ctx.sign * (o.action.aim.x - pic.ball.pos.x) > 8) || o.kind === 'dribble';
      const riskBonus = (ctx.instruction.risk - 0.5) * (forward ? 0.01 : -0.005);
      const score = o.value + riskBonus + this.rng.gauss() * noise;
      if (score > bestScore) { bestScore = score; best = o; }
    }
    return best.action;
  }

  private offBall(ctx: BrainContext, ball: { pos: Vec2; vel: Vec2 }): BodyCommand {
    const role = this.profile.role;
    const self = this.body.position();
    const own = ctx.possession === this.profile.team;
    const opponents = ctx.profiles.filter(p => p.team !== this.profile.team).map(p => ({ p, pos: this.perception.playerNow(p.id, ctx.now) })).filter(o => o.pos) as { p: PlayerProfile; pos: Vec2 }[];
    if (role === 'GK') return { target: keeperShape(ctx.sign, ball.pos), speed: 6, face: ball.pos };
    let target = shapeTarget(role, {
      sign: ctx.sign, ball: ball.pos, inPossession: own, instruction: ctx.instruction,
      offsideLineU: offsideLineU(ctx.sign, opponents.map(o => o.pos)),
    });
    if (!own && ctx.possession !== null) {
      // Second player presses when the coach asks for it; defenders mark attackers in their zone goal-side.
      const ballU = toTeam(ctx.sign, ball.pos).u;
      const nearBall = Math.hypot(ball.pos.x - self.x, ball.pos.z - self.z);
      if (ctx.instruction.press !== 'low' && nearBall < (ctx.instruction.press === 'high' ? 16 : 10) && MIDFIELDERS.has(role) && ballU > -0.2) {
        // Second presser: close the passing lane goal-side of the ball, not the ball itself.
        const goalX = -ctx.sign * PITCH.halfLength;
        const gx = goalX - ball.pos.x, gz = -ball.pos.z, gd = Math.hypot(gx, gz) || 1;
        target = { x: ball.pos.x + (gx / gd) * 4 + (target.x - ball.pos.x) * 0.2, z: ball.pos.z + (gz / gd) * 4 + (target.z - ball.pos.z) * 0.2 };
      } else if (DEFENDERS.has(role) || MIDFIELDERS.has(role)) {
        let mark: Vec2 | null = null, best = 9;
        for (const o of opponents) {
          const d = Math.hypot(o.pos.x - target.x, o.pos.z - target.z);
          if (d < best) { best = d; mark = o.pos; }
        }
        if (mark) {
          const goalX = -ctx.sign * PITCH.halfLength;
          const gx = goalX - mark.x, gz = -mark.z, gd = Math.hypot(gx, gz) || 1;
          target = { x: mark.x + (gx / gd) * 1.6, z: mark.z + (gz / gd) * 1.6 };
        }
      }
    }
    if (ctx.restart) target = keepRestartDistance(target, this.profile, ctx);
    const gap = Math.hypot(target.x - self.x, target.z - self.z);
    const speed = gap > 10 ? this.body.limits.maxSpeed * 0.92 : gap > 3 ? 5.5 : 3;
    return { target, speed, face: ball.pos };
  }
}

/** Laws 8, 13, 15–17: kick-off halves, 9.15 m (2 m at throw-ins) from the ball at restarts. */
export function keepRestartDistance(target: Vec2, profile: PlayerProfile, ctx: BrainContext): Vec2 {
  const r = ctx.restart!;
  let { x, z } = target;
  if (r.ownHalfOnly && ctx.sign * x > -0.3) x = -ctx.sign * 0.3;
  if (r.kind === 'penalty' && profile.id !== r.taker && profile.role !== 'GK') {
    // Everybody else outside the penalty area (Law 14).
    const edge = PITCH.halfLength - PITCH.penaltyAreaDepth - 1;
    if (Math.sign(r.spot.x) * x > edge && Math.abs(z) < PITCH.penaltyAreaHalfWidth + 1) x = Math.sign(r.spot.x) * edge;
  }
  if (profile.team !== r.team) {
    const dx = x - r.spot.x, dz = z - r.spot.z, d = Math.hypot(dx, dz);
    const min = r.minDistance + 0.6;
    if (d < min) {
      if (d > 0.01) { x = r.spot.x + (dx / d) * min; z = r.spot.z + (dz / d) * min; }
      else x = r.spot.x - ctx.sign * min;
    }
  }
  return { x, z };
}
