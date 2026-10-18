import type RAPIER from '@dimforge/rapier3d-simd-compat';
import type { BallAction, PlayerIntent, PlayerProfile, RestartKind, TeamInstruction, Vec2, Vec3 } from '../engine/types';
import type { Rng } from '../engine/rng';
import type { BodyCommand, PlayerBody } from '../physics/body';
import type { Legs } from '../physics/legs';
import type { Head } from '../physics/head';
import { PITCH, inPenaltyArea } from '../physics/pitch-geometry';
import { approach, trySwing } from './execution';
import { blockLane, bodyInLine, carrierHasBall, jockey, pressCarrier } from './box-orders';
import { tackle, tackleApproach } from './challenge';
import { firstTouch } from './first-touch';
import { aerialIntercept, headerIntercept, isAirborne } from './aerial';
import { chooseHeader, CONTESTED } from './heading';
import { evaluateOptions, pressureOn, type EvaluatedOption, type Picture } from './options';
import { offBallCommand } from './off-ball';
import { Perception, type Truth } from './perception';
import { offsideLineU, toTeam } from './shape';

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
/** Ball within this distance of an opponent whose team played it last: he has it, I jockey instead of charging in (m); otherwise 1.1 m. */
const CARRIER_REACH = 1.6;
/** How far beyond the meeting point on the ball's line a header is set up (m). */
const HEADER_SET = 0.35;
/** Within this distance of the carrier a jockeying defender no longer closes in (m). */
const JOCKEY_CLOSE = 1.5;
/** Sideways distance from the carrier at which a recovering defender runs alongside him (m). */
const SHOULDER_GAP = 1.1;

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

  constructor(readonly profile: PlayerProfile, readonly body: PlayerBody, readonly legs: Legs, private readonly rng: Rng, readonly head: Head) {
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
  static interceptTime(p: Vec2, vmax: number, ball: { pos: Vec2 | Vec3; vel: Vec2 | Vec3; spin?: Vec3 }): { t: number; at: Vec2 } {
    // A ball in the air is met where it first comes down to a playable height, not along its shadow on the turf.
    if ('y' in ball.pos && 'y' in ball.vel) {
      const aerial = aerialIntercept(p, vmax, ball.pos, ball.vel, ball.spin);
      if (aerial) return aerial;
    }
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
    // Until the contact the body is committed to the run the kick was planned for.
    if (this.legs.committed() || this.head.committed()) return out;
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
    // Kept in 3D: whether the ball is in the air decides where it can be met.
    const ball = { pos: { ...believed.pos }, vel: { ...believed.vel }, spin: { ...believed.spin } };
    const aim = this.head.aim();
    if (aim) this.head.refine(ctx.ball, aim);
    if (this.legs.committed() || this.head.committed()) {
      // Up to the contact the body keeps the pace the leg (or the header) was planned for.
      const v = this.body.velocity();
      return { command: { target: { x: self.x + v.x * 2, z: self.z + v.z * 2 }, speed: this.body.speed() }, effort: 1, swing: null };
    }
    const order = this.userIntent;
    if (order?.type === 'move') {
      const out = ctx.now < order.until && !ctx.restart ? this.followOrder(order.action, ctx, ball) : null;
      if (out) return out;
      this.userIntent = null;
    }
    this.committedToBall = ctx.ballHeldBy === null && this.believesBallIsMine(ctx, ball);
    if (this.committedToBall) return this.playAerial(ctx, ball) ?? this.playBall(ctx, ball);
    this.intent = null;
    return { command: this.steerAround(offBallCommand(this, ctx, ball), ctx), effort: 1, swing: null };
  }

  /** A movement order from the coach (via a decision moment). The body still has to make it happen; null: it is over. */
  private followOrder(action: Extract<PlayerIntent, { type: 'move' }>['action'], ctx: BrainContext, ball: { pos: Vec2; vel: Vec2 }): BrainOutput | null {
    const max = this.body.limits.maxSpeed;
    if (action.kind === 'jockey' || action.kind === 'block-lane' || action.kind === 'press') {
      // Box-defence orders are about a carrier with the ball at his feet; once it is gone, the player reads the game again.
      const carrier = this.perception.playerNow(action.target, ctx.now);
      if (!carrier || !carrierHasBall(carrier, ball)) return null;
      if (action.kind === 'jockey') return jockey(this.body.position(), carrier, this.perception.others.get(action.target)?.vel ?? { x: 0, z: 0 }, ball, ctx.sign, max);
      if (action.kind === 'block-lane') return blockLane(ball, ctx.sign, max);
      return pressCarrier({ body: this.body, legs: this.legs, ballBody: ctx.ball, profile: this.profile, rng: this.rng, sign: ctx.sign, picture: () => this.picture(ctx) }, { ...carrier, id: action.target }, ball);
    }
    switch (action.kind) {
      case 'tactical-foul': case 'mark': {
        const target = this.perception.playerNow(action.target, ctx.now) ?? ball.pos;
        // A tactical foul means running into the opponent's path; whether it becomes a foul is the referee's call.
        const lead = action.kind === 'tactical-foul' ? 0.35 : 0;
        const v = this.perception.others.get(action.target)?.vel ?? { x: 0, z: 0 };
        return { command: { target: { x: target.x + v.x * lead, z: target.z + v.z * lead }, speed: max, face: target }, effort: 1, swing: null };
      }
      case 'run-behind': case 'recover':
        return { command: { target: action.target, speed: max, face: ball.pos }, effort: 1, swing: null };
      case 'hold-shape':
        return { command: this.steerAround(offBallCommand(this, ctx, ball), ctx), effort: 1, swing: null };
    }
  }

  /**
   * A ball in the air that I am going for: head it if the opponents played it, if it is contested or if I am in
   * their area; otherwise (my team's ball, nobody near) let it come down and take it with the foot. Null: not a
   * header, play on as usual.
   */
  private playAerial(ctx: BrainContext, ball: { pos: Vec3; vel: Vec3; spin: Vec3 }): BrainOutput | null {
    if (this.profile.role === 'GK' || ctx.restart || !isAirborne(ball.pos, ball.vel)) return null;
    const self = this.body.position();
    const ownBall = ctx.possession === this.profile.team;
    const pic = this.picture(ctx);
    const contested = pic.opponents.some(o => Math.hypot(o.pos.x - self.x, o.pos.z - self.z) < CONTESTED);
    const goalX = ctx.sign * PITCH.halfLength;
    const atGoal = Math.hypot(goalX - self.x, self.z) < 16;
    if (ownBall && !contested && !atGoal) return null;
    const forehead = this.body.height - 0.12;
    const meet = headerIntercept(self, this.body.limits.maxSpeed, ball.pos, ball.vel, forehead, ball.spin);
    if (!meet) return null;
    if (!this.head.busy()) {
      const choice = chooseHeader(pic, ownBall, forehead);
      const plan = this.head.plan(ctx.ball, choice.velocity);
      if (plan) {
        this.head.start(plan, choice.velocity);
        this.intent = null;
        return { command: { target: self, speed: this.body.speed(), face: ball.pos }, effort: 1, swing: { action: { kind: 'header', velocity: choice.velocity }, source: 'ai' } };
      }
    }
    // Stand just beyond the point on the ball's line, facing it, so it meets the forehead in front of the body.
    const h = Math.hypot(ball.vel.x, ball.vel.z) || 1;
    const stand = { x: meet.at.x + (ball.vel.x / h) * HEADER_SET, z: meet.at.z + (ball.vel.z / h) * HEADER_SET };
    return { command: { target: stand, speed: this.body.limits.maxSpeed, face: ball.pos }, effort: 1, swing: null };
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
    // A receiver whose team played the ball last still controls it a stride ahead of him: jockey, do not charge in.
    const carrier = this.opponentInControl(ctx, ball, ctx.possession !== null && ctx.possession !== this.profile.team ? CARRIER_REACH : 1.1);
    if (carrier && !ctx.restart) {
      // Jockey: stay goal-side of the carrier at arm's length. Step in when his touch exposes the ball (it is
      // off his foot and about as near to me as to him), or close in front of the own goal where delaying no
      // longer helps.
      const carrierGap = Math.hypot(ball.pos.x - carrier.x, ball.pos.z - carrier.z);
      const ownGoalDistance = Math.hypot(-ctx.sign * PITCH.halfLength - ball.pos.x, ball.pos.z);
      // Never through the man: with the carrier between me and the ball, a poke or a run at the ball goes through
      // his legs from behind (measured: most fouls).
      const blocked = bodyInLine(self, ball.pos, carrier);
      const stepIn = !blocked && ((carrierGap > 0.6 && distance < carrierGap + 0.35) || (ownGoalDistance < 26 && distance < 1.9));
      if (stepIn && distance <= 2.2 && carrierGap < 1.1) {
        // The ball is still at his feet: a poke, not a pass or a dribble that needs the ball to myself.
        this.intent = null;
        const pic = this.picture(ctx);
        const action = tackle(self, ball.pos, carrier, ctx.sign, pic.mates.map(m => m.pos), pic.opponents.filter(o => o.id !== carrier.id).map(o => o.pos));
        const command = tackleApproach(self, ball.pos, this.body.limits.maxSpeed);
        const plan = distance < 1.3 && trySwing(this.body, this.legs, ctx.ball, action, { pressure: pressureOn(this.picture(ctx)), profile: this.profile, rng: this.rng });
        return { command, effort: 1, swing: plan ? { action, source: 'ai' } : null };
      }
      if (!stepIn || distance > 2.2) {
        this.intent = null;
        const goalX = -ctx.sign * PITCH.halfLength;
        const gx = goalX - carrier.x, gz = -carrier.z, gd = Math.hypot(gx, gz) || 1;
        // The spot moves with the carrier: aim a little ahead of it and match his pace plus the gap to close.
        const cv = this.perception.others.get(carrier.id)?.vel ?? { x: 0, z: 0 };
        const hold = { x: carrier.x + (gx / gd) * 1.4 + cv.x * 0.3, z: carrier.z + (gz / gd) * 1.4 + cv.z * 0.3 };
        const gap = Math.hypot(hold.x - self.x, hold.z - self.z);
        const close = Math.hypot(carrier.x - self.x, carrier.z - self.z) < JOCKEY_CLOSE;
        // At arm's length he matches the carrier's pace instead of closing further: running on into a player who
        // shields the ball is a foul, not a challenge.
        const pace = Math.min(this.body.limits.maxSpeed, Math.hypot(cv.x, cv.z) + (close ? 0.5 : 1 + gap * 1.5));
        if (bodyInLine(self, hold, carrier)) {
          // Caught on the wrong side: recover at his shoulder instead of running through his back (measured: 85 of
          // 107 fouls came from behind, most by a defender heading for the goal-side spot).
          const side = (self.x - carrier.x) * gz - (self.z - carrier.z) * gx >= 0 ? 1 : -1;
          const shoulder = { x: carrier.x + cv.x * 0.3 + (gz / gd) * side * SHOULDER_GAP, z: carrier.z + cv.z * 0.3 - (gx / gd) * side * SHOULDER_GAP };
          return { command: { target: shoulder, speed: Math.min(this.body.limits.maxSpeed, Math.hypot(cv.x, cv.z) + 1.5), face: ball.pos }, effort: 1, swing: null };
        }
        return { command: { target: hold, speed: pace, face: ball.pos }, effort: 1, swing: null };
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
    const command = approach(this.body, this.legs, action, ball, intercept.at, this.nearestOpponent(ctx, 2.5));
    const ready = !ctx.restart || ctx.restart.ready;
    let swing: BrainOutput['swing'] = null;
    if (ready && distance < 1.5) {
      const exec = { pressure: pressureOn(this.picture(ctx)), profile: this.profile, rng: this.rng };
      let played = action;
      let plan = trySwing(this.body, this.legs, ctx.ball, action, exec);
      if (!plan && action.kind === 'control' && action.touch && this.arrivesWithin(ball, 0.45)) {
        // The touch into space does not fit the ball's arrival: the receiver cushions it instead.
        played = { kind: 'control' };
        plan = trySwing(this.body, this.legs, ctx.ball, played, exec);
      }
      if (plan) {
        swing = { action: played, source: this.intent.source };
        if (this.intent.source === 'user') this.userIntent = null;
        this.intent = null;
      }
    }
    return { command, effort: 1, swing };
  }


  /** Closest opponent I can see within `range`, if any. */
  private nearestOpponent(ctx: BrainContext, range: number): Vec2 | null {
    const self = this.body.position();
    let best: Vec2 | null = null, bd = range;
    for (const p of ctx.profiles) {
      if (p.team === this.profile.team) continue;
      const pos = this.perception.playerNow(p.id, ctx.now);
      const d = pos ? Math.hypot(pos.x - self.x, pos.z - self.z) : Infinity;
      if (pos && d < bd) { bd = d; best = pos; }
    }
    return best;
  }

  /** Will the ball reach my body within `seconds` (closing along the line between us)? */
  private arrivesWithin(ball: { pos: Vec2; vel: Vec2 }, seconds: number): boolean {
    const self = this.body.position(), v = this.body.velocity();
    const dx = self.x - ball.pos.x, dz = self.z - ball.pos.z, d = Math.hypot(dx, dz) || 1;
    const closing = ((ball.vel.x - v.x) * dx + (ball.vel.z - v.z) * dz) / d;
    return d < 0.9 || (closing > 0.3 && (d - 0.4) / closing < seconds);
  }

  /** An opponent who (as far as I can see) has the ball at his feet and is closer to it than I am. */
  private opponentInControl(ctx: BrainContext, ball: { pos: Vec2; vel: Vec2 }, reach: number): (Vec2 & { id: number }) | null {
    const self = this.body.position();
    const mine = Math.hypot(ball.pos.x - self.x, ball.pos.z - self.z);
    let carrier: (Vec2 & { id: number }) | null = null, best = reach;
    for (const p of ctx.profiles) {
      if (p.team === this.profile.team) continue;
      const pos = this.perception.playerNow(p.id, ctx.now);
      if (!pos) continue;
      const d = Math.hypot(ball.pos.x - pos.x, ball.pos.z - pos.z);
      if (d < best && d < mine) { best = d; carrier = { ...pos, id: p.id }; }
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
        // A keeper secures the ball with a cushion; a missed touch in front of his goal is too costly.
        if (this.profile.role === 'GK') return { kind: 'control' };
        const at = PlayerBrain.interceptTime(self, this.body.limits.maxSpeed, pic.ball).at;
        return firstTouch(pic, at);
      }
    }
    // Restarts are played, not carried; a keeper with the ball at his feet distributes it instead of dribbling.
    if (ctx.restart || this.profile.role === 'GK') options = options.filter(o => o.kind === 'pass' || o.kind === 'clear');
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

}