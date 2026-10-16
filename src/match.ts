import RAPIER from '@dimforge/rapier3d-simd-compat';
import { applyBallDrag, createBall, placeBall } from './ball';
import { NO_ERROR, createLegs, planSwing, startSwing, substepsFor, updateLegs } from './foot-contact';
import { ActionIntent, DecisionView, createRandom, decideAction, kickingSide, swingError, swingRequest, techniqueFor } from './kick-decision';
import { PITCH, attackDirection, createPitchPhysics } from './pitch';
import { KEEPER, OUTFIELD, createMotor, driveMotor, headingVector, placeMotor } from './player-motor';
import { RefDecision, Referee, RestartKind } from './referee';
import { FORMATION, Player, Tactic, interceptEstimate, kickoffPosition, offsideLineU, shapeTarget, toTeam } from './team';

export type MatchEvent = {
  id: string;
  tick: number;
  time: number;
  type: 'touch' | 'kick-attempt' | 'goal' | 'out' | 'offside' | 'restart' | 'in-play' | 'coach';
  actors: number[];
  position?: [number, number, number];
  source: 'physics' | 'rules' | 'coach' | 'agent';
  payload?: Record<string, unknown>;
};

const DT = 1 / 60;
/** Heading tolerance (rad) between body facing and kick direction before a swing may start. */
const FACING_TOLERANCE = { instep: 0.65, inside: 1.15, cushion: Math.PI } as const;

/**
 * Headless authoritative match: one Rapier world, 22 players, ball, rules. Rendering only reads it.
 * Everything here runs without DOM, Three.js or network, so it can be tested and replayed from a seed.
 */
export class Match {
  readonly world: RAPIER.World;
  readonly ball: RAPIER.RigidBody;
  readonly players: Player[] = [];
  readonly referee: Referee;
  readonly events: MatchEvent[] = [];
  readonly score: [number, number] = [0, 0];
  tactic: [Tactic, Tactic] = ['press', 'press'];
  tick = 0;
  time = 0;
  private readonly random: () => number;
  private readonly owners = new Map<number, { player: Player; part: 'foot' | 'body' }>();
  private readonly ballHandle: number;
  private readonly queue = new RAPIER.EventQueue(true);
  private listeners: ((e: MatchEvent) => void)[] = [];
  private eventCounter = 0;

  constructor(seed = 12) {
    this.random = createRandom(seed);
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = DT;
    createPitchPhysics(this.world);
    this.ball = createBall(this.world);
    this.ballHandle = this.ball.collider(0).handle;
    for (const team of [0, 1] as const) {
      for (const slot of FORMATION) {
        const p = kickoffPosition(team, slot.role);
        const motor = createMotor(this.world, p.x, p.z, attackDirection(team) > 0 ? Math.PI / 2 : -Math.PI / 2, slot.role === 'GK' ? KEEPER : OUTFIELD);
        motor.collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        const player: Player = {
          id: this.players.length, team, number: slot.number, role: slot.role, motor,
          legs: createLegs(this.world, motor), intent: null, userIntent: null, decideAt: 0, recoverUntil: 0,
        };
        this.players.push(player);
        this.owners.set(motor.collider.handle, { player, part: 'body' });
        for (const foot of player.legs.feet) this.owners.set(foot.collider.handle, { player, part: 'foot' });
      }
    }
    this.referee = new Referee(this.players);
    this.reset();
  }

  onEvent(listener: (e: MatchEvent) => void): void {
    this.listeners.push(listener);
  }

  /** Coach control: shifts the team block and pressing; never touches the ball. */
  setTactic(team: 0 | 1, tactic: Tactic): void {
    this.tactic[team] = tactic;
    this.emit('coach', [], 'coach', { team, tactic });
  }

  /** A user decision for one player; executed like an AI intent and still subject to physics. */
  setUserIntent(playerId: number, intent: Omit<ActionIntent, 'source'>): void {
    this.players[playerId].userIntent = { ...intent, source: 'user' };
  }

  reset(): void {
    this.score[0] = 0; this.score[1] = 0;
    this.time = 0; this.tick = 0;
    this.events.length = 0;
    for (const p of this.players) {
      const k = kickoffPosition(p.team, p.role);
      placeMotor(p.motor, k.x, k.z, attackDirection(p.team) > 0 ? Math.PI / 2 : -Math.PI / 2);
      p.legs.swing = null; p.intent = null; p.userIntent = null; p.recoverUntil = 0;
    }
    placeBall(this.ball, 0, 0);
    this.referee.lastTouch = null;
    this.referee.startRestart('kickoff', 0, 0, 0, 0, 0);
  }

  step(): void {
    this.tick++;
    this.time += DT;
    this.applyRestartPlacement();
    const b = this.ball.translation(), bv = this.ball.linvel();
    const ballState = { x: b.x, y: b.y, z: b.z, vx: bv.x, vy: bv.y, vz: bv.z };
    const winners = this.ballWinners(ballState);
    for (const p of this.players) {
      if (winners.has(p) && this.time >= p.recoverUntil) this.playBall(p, ballState);
      else this.holdShape(p, ballState);
    }
    applyBallDrag(this.ball);
    const substeps = substepsFor(this.players.map(p => p.legs), DT);
    this.world.timestep = DT / substeps;
    for (let k = 0; k < substeps; k++) {
      for (const p of this.players) updateLegs(p.legs, p.motor, DT / substeps);
      this.world.step(this.queue);
      this.queue.drainCollisionEvents((h1, h2, started) => {
        if (!started) return;
        const other = h1 === this.ballHandle ? h2 : h2 === this.ballHandle ? h1 : -1;
        const owner = this.owners.get(other);
        if (owner) this.onTouch(owner.player, owner.part);
      });
    }
    const after = this.ball.translation();
    this.apply(this.referee.checkBall(after));
  }

  private ballWinners(ball: { x: number; z: number; vx: number; vz: number }): Set<Player> {
    const winners = new Set<Player>();
    const state = this.referee.state;
    if (state.phase === 'restart') {
      if (!state.placed) return winners;
      const takers = this.players.filter(p => p.team === state.team && (state.kind === 'goal-kick' ? p.role === 'GK' : p.role !== 'GK'));
      winners.add(nearest(takers, state.x, state.z));
      return winners;
    }
    for (const team of [0, 1]) {
      let best: Player | null = null, bestT = Infinity;
      for (const p of this.players) {
        if (p.team !== team) continue;
        const t = interceptEstimate(p, ball).t;
        if (t < bestT) { bestT = t; best = p; }
      }
      if (best) winners.add(best);
    }
    return winners;
  }

  private view(p: Player, ball: DecisionView['ball']): DecisionView {
    return {
      self: p,
      teammates: this.players.filter(q => q.team === p.team),
      opponents: this.players.filter(q => q.team !== p.team),
      ball,
      tactic: this.tactic[p.team],
      restart: this.referee.state.phase === 'restart',
    };
  }

  /** Ball winner: run to the interception point, set the body up for the chosen action, then swing. */
  private playBall(p: Player, ball: DecisionView['ball']): void {
    const pos = p.motor.body.translation();
    if (p.legs.swing) {
      const v = p.motor.body.linvel();
      driveMotor(p.motor, { targetX: pos.x + v.x * 0.4, targetZ: pos.z + v.z * 0.4, speed: Math.hypot(v.x, v.z) * 0.85 }, DT);
      return;
    }
    const intercept = interceptEstimate(p, ball);
    const distance = Math.hypot(ball.x - pos.x, ball.z - pos.z);
    if (distance > 3.2) {
      p.intent = null;
      driveMotor(p.motor, { targetX: intercept.x, targetZ: intercept.z, speed: p.motor.profile.maxSpeed, faceX: ball.x, faceZ: ball.z }, DT);
      return;
    }
    const view = this.view(p, ball);
    if (p.userIntent) p.intent = p.userIntent;
    else if (!p.intent || this.time >= p.decideAt) {
      p.intent = decideAction(view);
      p.decideAt = this.time + 0.25;
    }
    const intent = p.intent;
    const restart = this.referee.state.phase === 'restart' ? this.referee.state : null;
    const lead = Math.min(0.35, distance / 8);
    const bx = ball.x + ball.vx * lead, bz = ball.z + ball.vz * lead;
    if (intent.kind === 'control') {
      driveMotor(p.motor, { targetX: intercept.x, targetZ: intercept.z, speed: p.motor.profile.maxSpeed * 0.8, faceX: ball.x, faceZ: ball.z }, DT);
    } else {
      // Stand behind the ball on the kicking foot's side, facing the intended direction.
      const side = kickingSide(p, bx, bz);
      const perpX = intent.dirZ, perpZ = -intent.dirX;
      driveMotor(p.motor, {
        targetX: bx - intent.dirX * 0.42 - perpX * side * 0.12,
        targetZ: bz - intent.dirZ * 0.42 - perpZ * side * 0.12,
        speed: Math.min(p.motor.profile.maxSpeed, 1.2 + distance * 2.2),
        faceX: pos.x + intent.dirX * 5,
        faceZ: pos.z + intent.dirZ * 5,
      }, DT);
    }
    if (distance > 1.5) return;
    if (restart && !this.restartReady(restart)) return;
    this.trySwing(p, intent, view);
  }

  private trySwing(p: Player, intent: ActionIntent, view: DecisionView): void {
    const technique = techniqueFor(intent.kind, intent.elevation);
    const f = headingVector(p.motor.heading);
    const facing = intent.kind === 'control' ? 0 : Math.acos(Math.max(-1, Math.min(1, f.x * intent.dirX + f.z * intent.dirZ)));
    if (facing > FACING_TOLERANCE[technique]) return;
    const b = this.ball.translation();
    const side = kickingSide(p, b.x, b.z);
    const request = swingRequest(intent, side);
    if (!planSwing(p.motor, this.ball, request, NO_ERROR)) return;
    const plan = planSwing(p.motor, this.ball, request, swingError(view, intent, this.random));
    if (!plan) return;
    startSwing(p.legs, plan);
    p.recoverUntil = this.time + plan.windupTime + 0.45;
    if (intent.source === 'user') p.userIntent = null;
    p.intent = null;
    const pos = p.motor.body.translation();
    this.emit('kick-attempt', [p.id], intent.source === 'user' ? 'coach' : 'agent', {
      kind: intent.kind, technique, team: p.team, number: p.number, ballSpeed: intent.ballSpeed, targetPlayer: intent.targetPlayer,
    }, [pos.x, 0, pos.z]);
  }

  private holdShape(p: Player, ball: { x: number; z: number }): void {
    const state = this.referee.state;
    const inPossession = (this.referee.lastTouch?.team ?? (state.phase === 'restart' ? state.team : -1)) === p.team;
    const opponents = this.players.filter(q => q.team !== p.team);
    let target = shapeTarget(p.team, p.role, {
      ballX: ball.x, ballZ: ball.z, inPossession, tactic: this.tactic[p.team], offsideLineU: offsideLineU(p.team, opponents),
    });
    if (state.phase === 'restart') target = restartConstraint(p, target, state);
    const v = p.motor.body.linvel();
    const pos = p.motor.body.translation();
    const urgency = Math.hypot(target.x - pos.x, target.z - pos.z) > 12 ? p.motor.profile.maxSpeed * 0.9 : 5;
    if (p.legs.swing) driveMotor(p.motor, { targetX: pos.x + v.x * 0.3, targetZ: pos.z + v.z * 0.3, speed: 2 }, DT);
    else driveMotor(p.motor, { targetX: target.x, targetZ: target.z, speed: urgency, faceX: ball.x, faceZ: ball.z }, DT);
  }

  private restartReady(state: Extract<Referee['state'], { phase: 'restart' }>): boolean {
    if (this.time - state.since > 9) return true;
    const minDistance = state.kind === 'throw-in' ? 2 : 9.15;
    for (const p of this.players) {
      const t = p.motor.body.translation();
      if (p.team !== state.team && Math.hypot(t.x - state.x, t.z - state.z) < minDistance - 0.3) return false;
      if (state.kind === 'kickoff' && toTeam(p.team, t.x, t.z).u > 0.01) return false;
    }
    return true;
  }

  private applyRestartPlacement(): void {
    const state = this.referee.state;
    if (state.phase !== 'restart') return;
    const b = this.ball.translation();
    // The referee places the ball for the restart and replaces it if it is knocked away before being played.
    if ((!state.placed && this.time >= state.placeAt) || (state.placed && Math.hypot(b.x - state.x, b.z - state.z) > 0.6)) {
      placeBall(this.ball, state.x, state.z);
      if (!state.placed) {
        state.placed = true;
        this.emit('restart', [], 'rules', { kind: state.kind, team: state.team }, [state.x, 0, state.z]);
      }
    }
  }

  private onTouch(player: Player, part: 'foot' | 'body'): void {
    const b = this.ball.translation();
    const v = this.ball.linvel();
    this.emit('touch', [player.id], 'physics', {
      part, team: player.team, number: player.number, ballSpeed: Math.hypot(v.x, v.y, v.z),
    }, [b.x, b.y, b.z]);
    this.apply(this.referee.observeTouch(player, b.x, b.z));
  }

  private apply(decision: RefDecision | null): void {
    if (!decision) return;
    if (decision.type === 'goal') {
      this.score[decision.scoringTeam]++;
      const b = this.ball.translation();
      this.emit('goal', this.referee.lastTouch ? [this.referee.lastTouch.id] : [], 'rules', {
        team: decision.scoringTeam, score: [...this.score],
      }, [b.x, b.y, b.z]);
      this.restart('kickoff', (1 - decision.scoringTeam) as 0 | 1, 0, 0, 4);
    } else if (decision.type === 'out') {
      this.emit('out', [], 'rules', { kind: decision.kind, team: decision.team }, [decision.x, 0, decision.z]);
      this.restart(decision.kind, decision.team, decision.x, decision.z, 1.5);
    } else if (decision.type === 'offside') {
      const team = (1 - decision.offender.team) as 0 | 1;
      this.emit('offside', [decision.offender.id], 'rules', { team: decision.offender.team, number: decision.offender.number }, [decision.x, 0, decision.z]);
      this.restart('free-kick', team, decision.x, decision.z, 1.2);
    } else {
      this.emit('in-play', [decision.taker.id], 'rules', { kind: decision.kind, team: decision.taker.team });
    }
  }

  private restart(kind: RestartKind, team: 0 | 1, x: number, z: number, delay: number): void {
    this.referee.startRestart(kind, team, x, z, this.time, delay);
    for (const p of this.players) { p.intent = null; p.userIntent = null; }
  }

  private emit(type: MatchEvent['type'], actors: number[], source: MatchEvent['source'], payload?: Record<string, unknown>, position?: [number, number, number]): void {
    const event: MatchEvent = { id: `e${++this.eventCounter}`, tick: this.tick, time: this.time, type, actors, source, payload, position };
    this.events.push(event);
    if (this.events.length > 2000) this.events.shift();
    for (const l of this.listeners) l(event);
  }
}

function nearest(players: Player[], x: number, z: number): Player {
  let best = players[0], bestD = Infinity;
  for (const p of players) {
    const t = p.motor.body.translation();
    const d = Math.hypot(t.x - x, t.z - z);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

/** Laws 8, 13, 15–17: kickoff halves, 9.15 m distance (2 m at throw-ins). */
function restartConstraint(p: Player, target: { x: number; z: number }, state: Extract<Referee['state'], { phase: 'restart' }>) {
  let { x, z } = target;
  if (state.kind === 'kickoff') {
    const t = toTeam(p.team, x, z);
    if (t.u > -0.02) x = -attackDirection(p.team) * 0.02 * PITCH.halfLength;
  }
  if (p.team !== state.team) {
    const min = state.kind === 'throw-in' ? 2.5 : 10;
    const dx = x - state.x, dz = z - state.z, d = Math.hypot(dx, dz);
    if (d < min) {
      const k = d > 0.01 ? min / d : 0;
      x = d > 0.01 ? state.x + dx * k : state.x - attackDirection(state.team) * min;
      z = d > 0.01 ? state.z + dz * k : z;
    }
  }
  return { x, z };
}
