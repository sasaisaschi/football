import { evaluateOptions, threatAt, type EvaluatedOption } from '../ai/options';
import { toTeam } from '../ai/shape';
import type { MatchEngine } from '../engine/match-engine';
import type { DecisionMoment, DecisionOption, MomentKind, PlayerIntent, TeamId, TeamInstruction } from '../engine/types';
import { PITCH } from '../physics/pitch-geometry';

/** A pass or take-on the player could realistically pull off (estimated chance of success); a shot is offered whenever the player would consider it. */
const MIN_SUCCESS = 0.3;
/** Threat at stake for an attacking moment (≈ 27 m central): expected threat of the ball's position or the shot's chance. */
const STAKES = 0.02;
/** Options within this much expected threat (goal probability) of the best one make a real dilemma. */
const DILEMMA_GAP = 0.05;
/** How often the director looks at the match (s). */
const CHECK_INTERVAL = 0.1;
/**
 * Moments per half for each kind of situation, within the overall limit. Without them the most frequent kind
 * crowded out the rest: counter-press moments filled every half, attacking moments never came (4 matches).
 */
const GROUP_LIMIT = { attack: 3, transition: 1, defence: 2 } as const;
const GROUP: Record<MomentKind, keyof typeof GROUP_LIMIT> = {
  'finish-or-pass': 'attack', 'take-on': 'attack', 'counter-attack': 'transition', 'counter-press': 'transition', 'breakaway-defence': 'defence', 'box-defence': 'defence',
};
/** A ball lost after holding it at least this long (s) is a real loss of possession, not a ricochet. */
const SPELL_FOR_COUNTER_PRESS = 4;

export type DirectorConfig = {
  userTeam: TeamId;
  /** Minimum simulated seconds between two moments, so decisions stay rare and meaningful. */
  cooldown: number;
  maxPerHalf: number;
  timeoutSeconds: number;
};

export const DEFAULT_DIRECTOR: DirectorConfig = { userTeam: 0, cooldown: 75, maxPerHalf: 5, timeoutSeconds: 12 };

/**
 * Decisive Moment Director. Looks at the real match state a few times per second and asks: could a decision of
 * the user's team change what happens next in a way that matters? Only then it opens a moment with options that
 * the players can actually execute from the current state. It never sets an outcome.
 */
export class MomentDirector {
  private nextCheck = 0;
  private lastMomentAt = -Infinity;
  private momentsThisHalf = 0;
  private groupThisHalf: Record<keyof typeof GROUP_LIMIT, number> = { attack: 0, transition: 0, defence: 0 };
  private half: 1 | 2 = 1;
  private nextId = 1;
  private lastTouchTeam: TeamId | null = null;
  private possessionChangedAt = -Infinity;
  /** How long the team that just lost the ball had held it. */
  private lostSpell = 0;

  constructor(readonly config: DirectorConfig = DEFAULT_DIRECTOR) {}

  /** Plug into the engine: `engine.director = director.attach()`. */
  attach() {
    return (engine: MatchEngine) => this.evaluate(engine);
  }

  evaluate(e: MatchEngine): DecisionMoment | null {
    if (e.half !== this.half) { this.half = e.half; this.momentsThisHalf = 0; this.groupThisHalf = { attack: 0, transition: 0, defence: 0 }; }
    const touchTeam = e.referee.lastTouch?.team ?? null;
    if (touchTeam !== this.lastTouchTeam) { this.lostSpell = e.time - this.possessionChangedAt; this.lastTouchTeam = touchTeam; this.possessionChangedAt = e.time; }
    if (e.time < this.nextCheck) return null;
    // The carrier's window between controlling the ball and his next swing is short; checked every 0.25 s it was
    // mostly missed.
    this.nextCheck = e.time + CHECK_INTERVAL;
    if (e.time - this.lastMomentAt < this.config.cooldown || this.momentsThisHalf >= this.config.maxPerHalf) return null;
    const open = (g: keyof typeof GROUP_LIMIT) => this.groupThisHalf[g] < GROUP_LIMIT[g];
    const moment = (open('attack') ? this.attackingMoment(e) : null) ?? (open('transition') ? this.transitionMoment(e) : null)
      ?? (open('defence') ? this.breakawayMoment(e) ?? this.boxDefenceMoment(e) : null);
    if (!moment) return null;
    this.lastMomentAt = e.time;
    this.momentsThisHalf++;
    this.groupThisHalf[GROUP[moment.kind]]++;
    return moment;
  }

  private open(e: MatchEngine, kind: MomentKind, title: string, situation: string, focusPlayer: number, options: DecisionOption[], defaultOptionId: string): DecisionMoment {
    return { id: this.nextId++, tick: e.tick, team: this.config.userTeam, kind, title, situation, focusPlayer, options, defaultOptionId, timeoutSeconds: this.config.timeoutSeconds };
  }

  /** The user's player has the ball near the opponents' box and faces a real choice between alternatives. */
  private attackingMoment(e: MatchEngine): DecisionMoment | null {
    const team = this.config.userTeam;
    const carrier = this.carrier(e, team);
    if (carrier === null || e.legs[carrier].busy()) return null; // too late: the swing is already under way
    const sign = e.sign(team);
    const ball = e.ballPos();
    if (toTeam(sign, { x: ball.x, z: ball.z }).u < 0.42) return null;
    const brain = e.brains[carrier];
    const pic = brain.picture(this.brainContext(e, carrier));
    const options = evaluateOptions(pic).filter(o => o.kind !== 'clear');
    const shot = options.find(o => o.kind === 'shot');
    const passes = options.filter(o => o.kind === 'pass').slice(0, 2);
    const dribble = options.find(o => o.kind === 'dribble');
    // Only options a player could realistically pull off; their values may be negative (a risk of losing the ball),
    // so a dilemma is judged by how close they are, not by a ratio or a fixed floor that shifts with the AI's
    // value model.
    const candidates = [shot, ...passes, dribble].filter((o): o is EvaluatedOption => !!o && (o.kind === 'shot' || o.success >= MIN_SUCCESS));
    if (candidates.length < 2) return null;
    const best = Math.max(...candidates.map(o => o.value));
    // Relevant: there is real threat at stake and at least two options are close enough to be a dilemma.
    if (Math.max(threatAt(sign, { x: ball.x, z: ball.z }), shot?.success ?? 0) < STAKES) return null;
    const contenders = candidates.filter(o => o.value >= best - DILEMMA_GAP).slice(0, 4);
    if (contenders.length < 2) return null;
    const name = (id: number) => `${e.profiles[id].name} (${e.profiles[id].number})`;
    const decisionOptions: DecisionOption[] = contenders.map((o, i) => ({
      id: `${o.kind}-${i}`,
      label: o.kind === 'shot' ? 'Selbst abschließen' : o.kind === 'pass' ? `Pass auf ${name(o.target!)}` : 'Gegenspieler ausspielen',
      detail: o.note,
      effect: { type: 'player', player: carrier, intent: { type: 'ball', action: o.action, source: 'user', decidedAt: e.time } satisfies PlayerIntent },
      outlook: outlook(o),
    }));
    const aiChoice = brain.chooseAction(this.brainContext(e, carrier));
    const fallback = decisionOptions.find(d => d.effect.type === 'player' && d.effect.intent.type === 'ball' && d.effect.intent.action.kind === aiChoice.kind) ?? decisionOptions[0];
    const kind: MomentKind = shot ? 'finish-or-pass' : 'take-on';
    return this.open(e, kind, shot ? 'Abschluss oder Ablage?' : 'Durchsetzen oder abspielen?',
      `${name(carrier)} hat den Ball ${Math.round(Math.hypot(sign * PITCH.halfLength - ball.x, ball.z))} m vor dem Tor.`, carrier, decisionOptions, fallback.id);
  }

  /** Possession just changed in midfield: counter boldly / secure the ball, or counter-press / drop off. */
  private transitionMoment(e: MatchEngine): DecisionMoment | null {
    const team = this.config.userTeam;
    if (e.time - this.possessionChangedAt > 0.8) return null;
    const touch = e.referee.lastTouch;
    if (!touch) return null;
    const ball = e.ballPos();
    const sign = e.sign(team);
    const u = toTeam(sign, { x: ball.x, z: ball.z }).u;
    const snapshot = e.snapshot();
    const ahead = (t: TeamId) => snapshot.players.filter(p => !p.sentOff && e.profiles[p.id].team === t && sign * (p.position.x - ball.x) > 0).length;
    const base = e.instructions[team];
    const instr = (over: Partial<TeamInstruction>): TeamInstruction => ({ ...base, ...over });
    if (touch.team === team && u > -0.6 && u < 0.05 && e.time - e.halfStartedAt > 20) {
      // A real counter: won in our half, the ball carrier is moving forward and the opponents are outnumbered
      // or level ahead of the ball.
      const attackers = ahead(team), defenders = ahead((1 - team) as TeamId);
      const carrierV = e.bodies[touch.player].velocity();
      if (attackers < 2 || defenders > attackers + 1 || sign * carrierV.x < 1.5) return null;
      const options: DecisionOption[] = [
        { id: 'counter', label: 'Schnell kontern', detail: 'Risiko hoch, Stürmer laufen tief', effect: { type: 'team', team, instruction: instr({ risk: 0.95, lineHeight: 0.5, press: 'high' }), seconds: 15 }, outlook: `${attackers} gegen ${defenders} vor dem Ball` },
        { id: 'secure', label: 'Ball sichern', detail: 'Tempo raus, Mannschaft nachrücken lassen', effect: { type: 'team', team, instruction: instr({ risk: 0.15, lineHeight: 0 }), seconds: 15 }, outlook: 'weniger Ballverlustrisiko, Gegner formiert sich' },
      ];
      return this.open(e, 'counter-attack', 'Ballgewinn – Konter?', `Ballgewinn ${Math.round((u + 1) * 52.5)} m vor dem eigenen Tor.`, touch.player, options, base.risk > 0.6 ? 'counter' : 'secure');
    }
    // A real loss: we had the ball for a while and the opponent now has it under control, not a ricochet.
    if (touch.team !== team && u > 0.15 && e.time - e.halfStartedAt > 20 && this.lostSpell >= SPELL_FOR_COUNTER_PRESS && this.carrier(e, touch.team) !== null) {
      const options: DecisionOption[] = [
        { id: 'gegenpress', label: 'Sofort gegenpressen', detail: 'Hoch pressen, Linie rückt auf', effect: { type: 'team', team, instruction: instr({ press: 'high', lineHeight: 0.7 }), seconds: 10 }, outlook: 'schnelle Rückeroberung möglich, Raum hinter der Abwehr' },
        { id: 'drop', label: 'Fallen lassen', detail: 'Kompakt hinter den Ball', effect: { type: 'team', team, instruction: instr({ press: 'low', lineHeight: -0.6 }), seconds: 10 }, outlook: 'sicherer, Gegner baut ruhig auf' },
      ];
      return this.open(e, 'counter-press', 'Ballverlust in der gegnerischen Hälfte', 'Der Gegner hat den Ball gerade erobert.', touch.player, options, base.press === 'high' ? 'gegenpress' : 'drop');
    }
    return null;
  }

  /** An opponent is through on the user's goal with at most one defender left. */
  private breakawayMoment(e: MatchEngine): DecisionMoment | null {
    const team = this.config.userTeam;
    const opp = (1 - team) as TeamId;
    const carrier = this.carrier(e, opp);
    if (carrier === null) return null;
    const sign = e.sign(team);
    const c = e.bodies[carrier].position(), v = e.bodies[carrier].velocity();
    const u = toTeam(sign, c).u;
    if (u > -0.25 || sign * v.x > -2.5) return null; // must be in our half and running at our goal
    const defenders = e.profiles.filter(p => p.team === team && p.role !== 'GK' && !e.referee.sentOff.has(p.id));
    const goalSide = defenders.filter(p => sign * e.bodies[p.id].position().x < sign * c.x);
    if (goalSide.length > 1) return null;
    const chaser = defenders.map(p => ({ id: p.id, d: Math.hypot(e.bodies[p.id].position().x - c.x, e.bodies[p.id].position().z - c.z) })).sort((a, b) => a.d - b.d)[0];
    if (!chaser || chaser.d > 6) return null;
    const name = (id: number) => `${e.profiles[id].name} (${e.profiles[id].number})`;
    const options: DecisionOption[] = [
      { id: 'chase', label: 'Fair verfolgen', detail: `${name(chaser.id)} läuft mit, Torwart bleibt im Tor`, effect: { type: 'none' }, outlook: 'Torchance für den Gegner bleibt' },
      {
        id: 'tactical-foul', label: 'Taktisches Foul', detail: `${name(chaser.id)} stellt sich in den Laufweg`,
        effect: { type: 'player', player: chaser.id, intent: { type: 'move', action: { kind: 'tactical-foul', target: carrier }, source: 'user', decidedAt: e.time, until: e.time + 2.5 } },
        outlook: goalSide.length === 0 ? 'als Notbremse droht Rot' : 'Gelbe Karte wahrscheinlich, Erfolg nicht sicher',
      },
    ];
    return this.open(e, 'breakaway-defence', 'Gegner läuft allein aufs Tor', `${name(carrier)} ist durch, nur noch ${goalSide.length} Verteidiger dahinter.`, chaser.id, options, 'chase');
  }

  /**
   * An opponent has the ball close to the user's penalty area with defenders around him:
   * press the carrier, block the shooting lane, or let the defence organise itself.
   */
  private boxDefenceMoment(e: MatchEngine): DecisionMoment | null {
    const team = this.config.userTeam;
    const carrier = this.carrier(e, (1 - team) as TeamId);
    if (carrier === null) return null;
    const sign = e.sign(team);
    const c = e.bodies[carrier].position();
    const goalX = -sign * PITCH.halfLength;
    const toGoal = Math.hypot(goalX - c.x, c.z);
    if (toGoal > 30 || Math.abs(c.z) > 24) return null;
    const defenders = e.profiles
      .filter(p => p.team === team && p.role !== 'GK' && !e.referee.sentOff.has(p.id))
      .map(p => ({ id: p.id, pos: e.bodies[p.id].position() }))
      .map(d => ({ ...d, dist: Math.hypot(d.pos.x - c.x, d.pos.z - c.z) }))
      .sort((a, b) => a.dist - b.dist);
    const nearest = defenders[0];
    if (!nearest || nearest.dist > 7 || nearest.dist < 1.2) return null;
    const name = (id: number) => `${e.profiles[id].name} (${e.profiles[id].number})`;
    const order = (kind: 'press' | 'block-lane' | 'jockey'): DecisionOption['effect'] =>
      ({ type: 'player', player: nearest.id, intent: { type: 'move', action: { kind, target: carrier }, source: 'user', decidedAt: e.time, until: e.time + 3 } });
    const options: DecisionOption[] = [
      { id: 'press', label: 'Zustellen', detail: `${name(nearest.id)} läuft den Ballführenden an und geht in den Zweikampf`, effect: order('press'), outlook: 'kann den Ball erobern – oder wird überlaufen' },
      { id: 'block', label: 'Schussbahn blocken', detail: `${name(nearest.id)} stellt sich zwischen Ball und Tor`, effect: order('block-lane'), outlook: 'erschwert den Abschluss, lässt Zeit für einen Pass' },
      { id: 'hold', label: 'Ordnung halten', detail: `${name(nearest.id)} bleibt torseitig auf Abstand und verzögert`, effect: order('jockey'), outlook: 'schwer zu überlaufen, der Gegner hat aber Zeit zum Abschluss' },
    ];
    return this.open(e, 'box-defence', 'Gefahr vor dem eigenen Strafraum', `${name(carrier)} hat den Ball ${Math.round(toGoal)} m vor unserem Tor.`, nearest.id, options, 'hold');
  }

  /** Player of `team` who currently has the ball at his feet (last toucher, close to a slow ball). */
  private carrier(e: MatchEngine, team: TeamId): number | null {
    const t = e.referee.lastTouch;
    if (!t || t.team !== team || e.phase !== 'in-play') return null;
    const ball = e.ballPos(), v = e.physics.ball.linvel();
    const p = e.bodies[t.player].position();
    if (Math.hypot(ball.x - p.x, ball.z - p.z) > 1.6 || Math.hypot(v.x, v.z) > 9 || ball.y > 0.5) return null;
    return t.player;
  }

  private brainContext(e: MatchEngine, player: number) {
    const team = e.profiles[player].team;
    return {
      now: e.time, truth: e.truth(), sign: e.sign(team), instruction: e.instructions[team], possession: e.possession(),
      ball: e.physics.ball, profiles: e.profiles, restart: null, handsAllowed: false, ballHeldBy: e.snapshot().ball.heldBy,
    };
  }
}

function outlook(o: EvaluatedOption): string {
  if (o.kind === 'shot') return `Abschlusschance etwa ${Math.round(o.success * 100)} % – Torwart und Verteidiger können blocken`;
  if (o.kind === 'pass') return `Pass kommt nach Einschätzung zu ${Math.round(o.success * 100)} % an`;
  return `Durchkommen etwa ${Math.round(o.success * 100)} % – sonst Ballverlust`;
}

/** Expected threat currently in play for the user team; used by the UI to explain why a moment matters. */
export function stakeOf(e: MatchEngine, team: TeamId): number {
  const b = e.ballPos();
  return threatAt(e.sign(team), { x: b.x, z: b.z });
}
