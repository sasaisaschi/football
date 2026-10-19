import { PlayerBrain, type BrainContext, type BrainOutput } from '../ai/brain';
import { KeeperSkill } from '../ai/keeper';
import type { Truth } from '../ai/perception';
import { PlayerBody } from '../physics/body';
import { KeeperHands } from '../physics/hands';
import { Legs } from '../physics/legs';
import { Head } from '../physics/head';
import { PITCH, attackSign, BALL_SPEC } from '../physics/pitch-geometry';
import { PHYSICS_DT, PhysicsWorld, type Contact, type ContactPart } from '../physics/world';
import { Referee, penaltySpot, restartDistance, type Decision, type PlayerState } from '../rules/referee';
import { SLOTS, toWorld } from '../ai/shape';
import { createRng, type Rng } from './rng';
import { createRoster, TEAMS } from './rosters';
import { chooseTaker, PLACE_DELAY, restartReady, type RestartState } from './restarts';
import type {
  BallAction, DecisionMoment, DecisionSource, MatchEvent, MatchPhase, MatchSnapshot, PlayerIntent, PlayerProfile, PlayerView, RestartKind, TeamId, TeamInstruction, Vec2,
} from './types';

export type MatchConfig = { seed: number; halfMinutes: number; rosterSeed?: number };
export type Director = (engine: MatchEngine) => DecisionMoment | null;
type EventInput = MatchEvent extends infer E ? E extends MatchEvent ? Omit<E, 'id' | 'tick' | 'time'> : never : never;

export const DEFAULT_INSTRUCTION: TeamInstruction = { press: 'mid', lineHeight: 0, risk: 0.5 };

/**
 * Authoritative match engine: the only owner of time, phase, score, restarts and the physical world.
 * Brains, referee and director feed it intents and decisions; presentation only reads snapshots.
 */
export class MatchEngine {
  readonly physics = new PhysicsWorld();
  readonly profiles: PlayerProfile[];
  readonly bodies: PlayerBody[] = [];
  readonly legs: Legs[] = [];
  readonly heads: Head[] = [];
  readonly brains: PlayerBrain[] = [];
  readonly keepers = new Map<number, KeeperSkill>();
  readonly referee: Referee;
  readonly events: MatchEvent[] = [];
  readonly score: [number, number] = [0, 0];
  readonly rng: Rng;
  tick = 0;
  time = 0;
  half: 1 | 2 = 1;
  halfStartedAt = 0;
  phase: MatchPhase = 'pre-kickoff';
  restart: RestartState | null = null;
  moment: DecisionMoment | null = null;
  director: Director | null = null;
  readonly instructions: [TeamInstruction, TeamInstruction] = [{ ...DEFAULT_INSTRUCTION }, { ...DEFAULT_INSTRUCTION }];
  private readonly baseInstructions: [TeamInstruction, TeamInstruction] = [{ ...DEFAULT_INSTRUCTION }, { ...DEFAULT_INSTRUCTION }];
  private readonly instructionUntil: [number, number] = [0, 0];
  private listeners: ((e: MatchEvent) => void)[] = [];
  private eventId = 0;
  private heldBy: number | null = null;
  /** Each player's latest swing, to tell a deliberate kick from a block or deflection (Law 12 back-pass). */
  private readonly lastSwing = new Map<number, { kind: BallAction['kind']; time: number }>();

  constructor(readonly config: MatchConfig) {
    this.rng = createRng(config.seed);
    this.profiles = createRoster(config.rosterSeed ?? 7);
    for (const p of this.profiles) {
      // Created on their kick-off spots, so no collider ever sweeps across the pitch on the first step.
      const spot = toWorld(attackSign(p.team, 1), SLOTS[p.role].u, SLOTS[p.role].v);
      const body = new PlayerBody(this.physics.world, p, spot.x, spot.z, attackSign(p.team, 1) > 0 ? Math.PI / 2 : -Math.PI / 2);
      const legs = new Legs(this.physics.world, body);
      this.physics.registerCollider(body.collider, p.id, 'body');
      this.physics.registerLegs(legs, p.id);
      const head = new Head(this.physics.world, body);
      this.physics.registerCollider(head.collider, p.id, 'head');
      this.physics.registerKinematic(head);
      this.heads.push(head);
      const brain = new PlayerBrain(p, body, legs, createRng(config.seed * 131 + p.id), head);
      this.bodies.push(body);
      this.legs.push(legs);
      this.brains.push(brain);
      if (p.role === 'GK') {
        const hands = new KeeperHands(this.physics.world, body);
        this.physics.registerCollider(hands.collider, p.id, 'hands');
        this.physics.registerKinematic(hands);
        this.keepers.set(p.id, new KeeperSkill(brain, hands));
      }
    }
    this.referee = new Referee(this.profiles);
    this.setupKickoff(0);
  }

  onEvent(listener: (e: MatchEvent) => void): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }

  sign(team: TeamId): 1 | -1 {
    return attackSign(team, this.half);
  }

  clockSeconds(): number {
    return this.time - this.halfStartedAt;
  }

  /** Line both teams up for a kick-off. Allowed only while the ball is dead (start of a half). */
  private setupKickoff(team: TeamId): void {
    for (const p of this.profiles) {
      if (this.referee.sentOff.has(p.id)) continue;
      const slot = SLOTS[p.role];
      const sign = this.sign(p.team);
      const pos = toWorld(sign, slot.u, slot.v);
      this.bodies[p.id].place(pos.x, pos.z, sign > 0 ? Math.PI / 2 : -Math.PI / 2);
      this.legs[p.id].snap();
      this.heads[p.id].reset();
      this.keepers.get(p.id)?.hands.snap();
    }
    this.placeDeadBall(0, 0);
    this.beginRestart('kickoff', team, { x: 0, z: 0 }, 0);
    for (const b of this.brains) b.perception.reset(this.truth());
    this.emit({ type: 'kickoff', team, half: this.half });
  }

  private beginRestart(kind: RestartKind, team: TeamId, spot: Vec2, delay: number): void {
    this.phase = this.phase === 'full-time' ? 'full-time' : 'stopped';
    const taker = chooseTaker(kind, team, spot, this.profiles, this.positions(), this.referee.sentOff);
    this.restart = { kind, team, spot, placeAt: this.time + delay, placed: false, placedAt: 0, taker };
    for (const b of this.brains) { b.intent = null; b.userIntent = null; }
  }

  /** The referee's hand: a dead ball is put on the restart spot. Never used while the ball is in play. */
  private placeDeadBall(x: number, z: number): void {
    for (const k of this.keepers.values()) k.hands.release();
    this.heldBy = null;
    const ball = this.physics.ball;
    ball.resetForces(true);
    ball.setTranslation({ x, y: BALL_SPEC.radius, z }, true);
    ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  positions(): Map<number, Vec2> {
    const m = new Map<number, Vec2>();
    for (const p of this.profiles) m.set(p.id, this.bodies[p.id].position());
    return m;
  }

  truth(): Truth {
    const b = this.physics.ball.translation(), v = this.physics.ball.linvel(), w = this.physics.ball.angvel();
    return {
      now: this.time,
      ball: { pos: { x: b.x, y: b.y, z: b.z }, vel: { x: v.x, y: v.y, z: v.z }, spin: { x: w.x, y: w.y, z: w.z } },
      players: this.profiles.filter(p => !this.referee.sentOff.has(p.id)).map(p => ({ id: p.id, pos: this.bodies[p.id].position(), vel: this.bodies[p.id].velocity() })),
    };
  }

  possession(): TeamId | null {
    if (this.restart) return this.restart.team;
    return this.referee.lastTouch?.team ?? null;
  }

  /** Coach-level change for a while (director decision or UI); reverts to the base instruction afterwards. */
  setInstruction(team: TeamId, instruction: TeamInstruction, seconds: number, source: 'ai' | 'user'): void {
    this.instructions[team] = { ...instruction };
    this.instructionUntil[team] = seconds > 0 ? this.time + seconds : 0;
    if (seconds <= 0) this.baseInstructions[team] = { ...instruction };
    this.emit({ type: 'instruction', team, instruction, source });
  }

  setUserIntent(player: number, intent: PlayerIntent): void {
    this.brains[player].userIntent = intent;
  }

  resolveMoment(optionId: string, chosenBy: DecisionSource): void {
    const m = this.moment;
    if (!m || this.phase !== 'decision') throw new Error('No decision moment is open');
    const option = m.options.find(o => o.id === optionId);
    if (!option) throw new Error(`Unknown option ${optionId}`);
    if (option.effect.type === 'player') this.setUserIntent(option.effect.player, option.effect.intent);
    if (option.effect.type === 'team') this.setInstruction(option.effect.team, option.effect.instruction, option.effect.seconds, 'user');
    this.emit({ type: 'decision', momentId: m.id, optionId, chosenBy });
    this.moment = null;
    this.phase = 'in-play';
  }

  step(): void {
    if (this.phase === 'decision' || this.phase === 'full-time') return;
    if (this.consultDirector()) return;
    this.tick++;
    this.time += PHYSICS_DT;
    for (const t of [0, 1] as const) {
      if (this.instructionUntil[t] && this.time >= this.instructionUntil[t]) {
        this.instructionUntil[t] = 0;
        this.instructions[t] = { ...this.baseInstructions[t] };
      }
    }
    this.advanceRestart();
    const truth = this.truth();
    const states = new Map<number, PlayerState>();
    for (const p of this.profiles) {
      if (this.referee.sentOff.has(p.id)) continue;
      const out = this.think(p, truth);
      const body = this.bodies[p.id];
      body.drive(out.command, PHYSICS_DT, out.effort);
      if (out.swing) {
        this.lastSwing.set(p.id, { kind: out.swing.action.kind, time: this.time });
        this.emit({ type: 'swing', player: p.id, action: out.swing.action.kind, source: out.swing.source });
      }
      const move = this.brains[p.id].userIntent;
      states.set(p.id, { pos: body.position(), vel: body.velocity(), heading: body.heading, hasTacticalFoulIntent: move?.type === 'move' && move.action.kind === 'tactical-foul' });
    }
    const contacts = this.physics.step();
    this.handleContacts(contacts, states);
    if (this.phase === 'in-play') this.apply(this.referee.checkBall(this.ballPos(), this.half));
    this.checkClock();
  }

  /** The director looks at the state before players commit to this tick's actions, so a decision can still matter. */
  private consultDirector(): boolean {
    if (this.phase !== 'in-play' || !this.director) return false;
    const moment = this.director(this);
    if (!moment) return false;
    this.moment = moment;
    this.phase = 'decision';
    this.emit({ type: 'moment', momentId: moment.id, team: moment.team, kind: moment.kind });
    return true;
  }

  private think(p: PlayerProfile, truth: Truth): BrainOutput {
    const brain = this.brains[p.id];
    const r = this.restart;
    const ctx: BrainContext = {
      now: this.time,
      truth,
      sign: this.sign(p.team),
      instruction: this.instructions[p.team],
      possession: this.possession(),
      ball: this.physics.ball,
      profiles: this.profiles,
      restart: r ? {
        kind: r.kind, team: r.team, taker: r.taker, spot: r.spot, minDistance: restartDistance(r.kind), ownHalfOnly: r.kind === 'kickoff',
        ready: r.placed && restartReady(r, this.profiles, this.positions(), t => this.sign(t), this.time, this.referee.sentOff),
      } : null,
      handsAllowed: this.phase === 'in-play' && this.referee.keeperReleased !== p.id && !this.isBackPass(p.team),
      ballHeldBy: this.heldBy,
    };
    const keeper = this.keepers.get(p.id);
    if (keeper) return keeper.think(ctx, () => brain.think(ctx));
    return brain.think(ctx);
  }

  /** Law 12: a keeper may not handle a ball deliberately kicked to him by a team-mate. */
  private isBackPass(team: TeamId): boolean {
    const t = this.referee.lastTouch;
    return !!t && t.team === team && t.part === 'boot' && !!t.deliberate && this.profiles[t.player].role !== 'GK';
  }

  /** A boot touch within a pass, dribble or first-touch swing is played on purpose; a block, poke or miscued clearance is not. */
  private deliberate(player: number, part: ContactPart): boolean {
    const s = this.lastSwing.get(player);
    return part === 'boot' && !!s && this.time - s.time < 0.7 && (s.kind === 'pass' || s.kind === 'dribble' || s.kind === 'control');
  }

  private advanceRestart(): void {
    const r = this.restart;
    if (!r) return;
    if (!r.placed && this.time >= r.placeAt) {
      this.placeDeadBall(r.spot.x, r.spot.z);
      r.placed = true;
      r.placedAt = this.time;
      r.taker = chooseTaker(r.kind, r.team, r.spot, this.profiles, this.positions(), this.referee.sentOff);
      this.referee.awaitRestart(r.kind, r.team);
      this.emit({ type: 'restart', restart: r.kind, team: r.team, position: r.spot });
    } else if (r.placed) {
      const b = this.physics.ball.translation();
      // Knocked away before being played: the referee puts it back.
      if (Math.hypot(b.x - r.spot.x, b.z - r.spot.z) > 0.8 && this.referee.pendingRestart) this.placeDeadBall(r.spot.x, r.spot.z);
    }
  }

  private handleContacts(contacts: Contact[], states: Map<number, PlayerState>): void {
    const positions = this.positions();
    for (const c of contacts) {
      if (c.kind === 'ball') {
        if (this.restart && !this.restart.placed) continue;
        const b = this.ballPos(), v = this.physics.ball.linvel();
        const ballSpeed = Math.hypot(v.x, v.y, v.z);
        this.emit({ type: 'touch', player: c.player, part: c.part, ballSpeed, position: b });
        const keeper = c.part === 'hands' ? this.keepers.get(c.player) : undefined;
        const decisions = this.referee.onBallContact({ player: c.player, team: this.profiles[c.player].team, part: c.part, time: this.time, position: b, deliberate: this.deliberate(c.player, c.part) }, this.half, positions);
        if (keeper && decisions.length === 0 && this.heldBy === null) {
          const h = keeper.hands.body.linvel();
          if (keeper.catchable(Math.hypot(v.x - h.x, v.y - h.y, v.z - h.z))) {
            keeper.hands.catchBall(this.physics.ball, this.time);
            this.heldBy = c.player;
            this.emit({ type: 'catch', player: c.player, position: b });
          }
        }
        for (const d of decisions) this.apply(d);
      } else if (this.phase === 'in-play') {
        this.emit({ type: 'player-contact', a: c.a, b: c.b, closingSpeed: c.closingSpeed });
        const d = this.referee.onBodyContact(c.a, c.b, c.closingSpeed, this.time, this.half, this.ballPos(), states, this.heldBy);
        if (d) this.apply(d);
      }
    }
    if (this.heldBy !== null) {
      const k = this.keepers.get(this.heldBy)!;
      if (!k.hands.holding()) {
        this.emit({ type: 'release', player: this.heldBy });
        this.referee.keeperReleased = this.heldBy;
        this.heldBy = null;
      }
    }
  }

  private apply(d: Decision | null): void {
    if (!d) return;
    switch (d.type) {
      case 'in-play':
        this.restart = null;
        this.phase = 'in-play';
        this.emit({ type: 'in-play', restart: d.kind, taker: d.taker });
        return;
      case 'goal': {
        if (this.phase !== 'in-play') return;
        this.score[d.team]++;
        this.emit({ type: 'goal', team: d.team, scorer: d.scorer, ownGoal: d.ownGoal, position: this.ballPos() });
        this.beginRestart('kickoff', (1 - d.team) as TeamId, { x: 0, z: 0 }, 4);
        return;
      }
      case 'offside':
        this.emit({ type: 'offside', player: d.player, position: d.spot });
        this.beginRestart('free-kick', (1 - this.profiles[d.player].team) as TeamId, d.spot, PLACE_DELAY['free-kick']);
        return;
      case 'restart':
        if (d.reason === 'out') this.emit({ type: 'out', restart: d.kind, team: d.team, position: d.spot });
        this.beginRestart(d.kind, d.team, clampSpot(d.spot), PLACE_DELAY[d.kind]);
        return;
      case 'foul': {
        this.emit({ type: 'foul', offender: d.offender, victim: d.victim, position: d.spot, penalty: d.penalty, card: d.card, reason: d.reason });
        if (d.card === 'red') this.sendOff(d.offender);
        const victimTeam = this.profiles[d.victim].team;
        if (d.advantage) { this.emit({ type: 'advantage', team: victimTeam }); return; }
        const goalSide = (-this.sign((1 - victimTeam) as TeamId)) as 1 | -1;
        if (d.penalty) this.beginRestart('penalty', victimTeam, penaltySpot(goalSide), PLACE_DELAY.penalty);
        else this.beginRestart('free-kick', victimTeam, clampSpot(d.spot), PLACE_DELAY['free-kick']);
        return;
      }
    }
  }

  private sendOff(player: number): void {
    const body = this.bodies[player];
    body.collider.setEnabled(false);
    for (const b of this.legs[player].boots) b.collider.setEnabled(false);
    this.heads[player].reset();
    // He walks off: placed beside the pitch, outside the boards, where he no longer takes part.
    body.place(0, (PITCH.halfWidth + PITCH.runOff + 4) * (this.profiles[player].team === 0 ? 1 : -1), 0);
    body.body.setEnabled(false);
  }

  private checkClock(): void {
    if (this.clockSeconds() < this.config.halfMinutes * 60) return;
    // The half ends at the next moment the ball is not in a dangerous attack: simply when it is dead or in midfield.
    const b = this.ballPos();
    if (this.phase === 'in-play' && Math.abs(b.x) > PITCH.halfLength - 25 && this.clockSeconds() < this.config.halfMinutes * 60 + 30) return;
    if (this.half === 1) {
      this.emit({ type: 'half-time' });
      this.half = 2;
      this.halfStartedAt = this.time;
      this.referee.lastTouch = null;
      this.setupKickoff(1);
    } else {
      this.emit({ type: 'full-time' });
      this.phase = 'full-time';
      this.restart = null;
    }
  }

  ballPos() {
    const t = this.physics.ball.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  emit(e: EventInput): void {
    const event = { ...e, id: ++this.eventId, tick: this.tick, time: this.time } as MatchEvent;
    this.events.push(event);
    if (this.events.length > 5000) this.events.splice(0, 1000);
    for (const l of this.listeners) l(event);
  }

  snapshot(): MatchSnapshot {
    const ball = this.physics.ball;
    const t = ball.translation(), v = ball.linvel(), w = ball.angvel(), r = ball.rotation();
    return {
      tick: this.tick,
      time: this.time,
      half: this.half,
      clockSeconds: this.clockSeconds(),
      phase: this.phase,
      score: [this.score[0], this.score[1]],
      ball: { position: { x: t.x, y: t.y, z: t.z }, velocity: { x: v.x, y: v.y, z: v.z }, spin: { x: w.x, y: w.y, z: w.z }, rotation: { x: r.x, y: r.y, z: r.z, w: r.w }, heldBy: this.heldBy },
      players: this.profiles.map(p => {
        const body = this.bodies[p.id], legs = this.legs[p.id];
        const pos = body.body.translation(), vel = body.body.linvel();
        const keeper = this.keepers.get(p.id);
        return {
          id: p.id,
          position: { x: pos.x, y: pos.y, z: pos.z },
          velocity: { x: vel.x, y: vel.y, z: vel.z },
          heading: body.heading,
          boots: [legs.bootWorld(0), legs.bootWorld(1)],
          swingingBoot: legs.swing ? legs.swing.plan.side : -1,
          hands: keeper ? keeper.hands.world3() : null,
          upperBody: this.upperBodyView(p.id),
          booked: this.referee.sentOff.has(p.id) ? 'red' : this.referee.yellow.has(p.id) ? 'yellow' : 'none',
          sentOff: this.referee.sentOff.has(p.id),
        };
      }),
      possession: this.possession(),
      lastTouch: this.referee.lastTouch?.player ?? null,
      restart: this.restart ? { kind: this.restart.kind, team: this.restart.team, position: this.restart.spot } : null,
      moment: this.moment,
    };
  }

  private upperBodyView(id: number): PlayerView['upperBody'] {
    const head = this.heads[id].active();
    return head ? { part: 'head', position: head } : null;
  }

  teamName(team: TeamId): string {
    return TEAMS[team].name;
  }
}

function clampSpot(s: Vec2): Vec2 {
  return { x: Math.max(-PITCH.halfLength + 0.3, Math.min(PITCH.halfLength - 0.3, s.x)), z: Math.max(-PITCH.halfWidth + 0.3, Math.min(PITCH.halfWidth - 0.3, s.z)) };
}
