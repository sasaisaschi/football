import type { Vec2, Vec3 } from '../engine/types';
import type { KeeperHands } from '../physics/hands';
import { PITCH, inPenaltyArea } from '../physics/pitch-geometry';
import type { BrainContext, BrainOutput, PlayerBrain } from './brain';
import { keeperShape } from './shape';

/**
 * Goalkeeping on top of the normal brain: read shots towards the goal, move across, reach and dive, claim
 * loose balls in the area and distribute after a catch. Whether a shot is saved is decided by the contact
 * between hands and ball.
 */
export class KeeperSkill {
  private shotSeenAt = -1;
  private dived = false;
  private releaseAt = 0;

  constructor(private readonly brain: PlayerBrain, readonly hands: KeeperHands) {}

  /** Where a ball on its current flight crosses the plane x = planeX, if it gets there. */
  static crossing(pos: Vec3, vel: Vec3, planeX: number): { t: number; z: number; y: number } | null {
    if (Math.abs(vel.x) < 0.5) return null;
    const t = (planeX - pos.x) / vel.x;
    if (t <= 0 || t > 2.5) return null;
    const y = pos.y + vel.y * t - 4.9 * t * t;
    return { t, z: pos.z + vel.z * t, y: Math.max(0.11, y) };
  }

  think(ctx: BrainContext, normal: () => BrainOutput): BrainOutput {
    const body = this.brain.body;
    const self = body.position();
    // The keeper looks like everybody else: his picture of the ball is his own perception.
    this.brain.perception.observe(ctx.truth, self, body.heading);
    const goalSide = (-ctx.sign) as 1 | -1;
    this.hands.setActive(ctx.handsAllowed && inPenaltyArea(self.x, self.z, goalSide));

    if (this.hands.holding()) {
      // Law 12: release within six seconds. Roll the ball out in front and play it with the feet.
      if (this.releaseAt === 0) this.releaseAt = ctx.now + 1.6 + this.brain.profile.abilities.composure;
      if (ctx.now >= this.releaseAt) {
        const f = body.facing();
        this.hands.reachFor({ x: self.x + f.x * 0.6, y: 0.25, z: self.z + f.z * 0.6 });
        if (this.hands.rel.y < 0.45) { this.hands.release(); this.releaseAt = 0; }
      }
      return { command: { target: self, speed: 0, face: { x: 0, z: self.z * 0.5 } }, effort: 1, swing: null };
    }
    this.releaseAt = 0;

    const truthBall = ctx.truth.ball;
    const believed = this.brain.perception.ballNow(ctx.now);
    const crossing = KeeperSkill.crossing(believed.pos, believed.vel, self.x);
    const towardsGoal = believed.vel.x * goalSide > 3;
    const onTarget = crossing && Math.abs(crossing.z) < PITCH.goalHalfWidth + 1.2 && crossing.y < PITCH.goalHeight + 0.6;

    if (ctx.now < this.hands.recoverUntil) {
      // On the ground after a dive: only the hands can still move.
      if (crossing) this.hands.reachFor({ x: self.x, y: crossing.y, z: crossing.z });
      return { command: { target: self, speed: 0 }, effort: ctx.now < this.hands.diveUntil ? 0 : 0.15, swing: null };
    }
    this.dived = false;

    if (towardsGoal && onTarget && this.hands.active()) {
      if (this.shotSeenAt < 0) this.shotSeenAt = ctx.now;
      const reaction = 0.2 - 0.1 * this.brain.profile.abilities.reflexes;
      const point: Vec3 = { x: self.x, y: crossing.y, z: crossing.z };
      if (ctx.now - this.shotSeenAt >= reaction) {
        this.hands.reachFor(point);
        const lateral = Math.abs(crossing.z - self.z);
        if (!this.dived && lateral > 0.9 && crossing.t < 0.7) {
          this.hands.dive({ x: self.x, z: crossing.z }, ctx.now, this.brain.profile.abilities.reflexes);
          this.dived = true;
        }
      }
      return { command: { target: { x: self.x, z: crossing.z }, speed: body.limits.maxSpeed, face: { x: truthBall.pos.x, z: truthBall.pos.z } }, effort: 1, swing: null };
    }
    this.shotSeenAt = -1;

    // Loose ball in the area that the keeper reaches first: claim it with the hands.
    const ballPos: Vec2 = { x: believed.pos.x, z: believed.pos.z };
    if (this.hands.active() && inPenaltyArea(ballPos.x, ballPos.z, goalSide) && Math.abs(believed.vel.x) + Math.abs(believed.vel.z) < 14 && this.firstToBall(ctx, ballPos)) {
      const d = Math.hypot(ballPos.x - self.x, ballPos.z - self.z);
      if (d < 1.4) this.hands.reachFor(believed.pos);
      else this.hands.relax();
      return { command: { target: ballPos, speed: body.limits.maxSpeed, face: ballPos }, effort: 1, swing: null };
    }

    this.hands.relax();
    // With the ball at his feet (after a back-pass or a release) the keeper plays like an outfield player.
    const dBall = Math.hypot(ballPos.x - self.x, ballPos.z - self.z);
    // A ball he may not handle (back-pass) or his team's ball close by: he plays it with his feet.
    if (dBall < 12 && inPenaltyArea(ballPos.x, ballPos.z, goalSide) && (ctx.possession === this.brain.profile.team || !this.hands.active())) return normal();
    const spot = keeperShape(ctx.sign, ballPos);
    return { command: { target: spot, speed: 6, face: { x: ballPos.x, z: ballPos.z } }, effort: 1, swing: null };
  }

  private firstToBall(ctx: BrainContext, ball: Vec2): boolean {
    const self = this.brain.body.position();
    const mine = Math.hypot(ball.x - self.x, ball.z - self.z) / this.brain.body.limits.maxSpeed;
    for (const p of ctx.truth.players) {
      if (p.id === this.brain.profile.id) continue;
      const seen = this.brain.perception.playerNow(p.id, ctx.now);
      if (seen && Math.hypot(ball.x - seen.x, ball.z - seen.z) / 8.5 < mine - 0.2) return false;
    }
    return true;
  }

  /** Catch only what the hands can hold: limited by the keeper's handling and the ball's speed. */
  catchable(ballSpeedRelative: number): boolean {
    return ballSpeedRelative < 8 + 14 * this.brain.profile.abilities.handling;
  }
}
