/**
 * Contracts between the layers of THE 12TH MAN.
 *
 *   physics  ──contacts──▶ engine ◀──intents── ai (autonomous players)
 *                            │  ▲                ▲
 *                     events │  └─ decisions ── director ◀── user (ui)
 *                            ▼
 *                     rules (referee) ──▶ engine (legal state)
 *                            │
 *                     snapshots ──▶ render / audio / commentary (read-only)
 *
 * Coordinates: metres, X along the pitch (goals at ±52.5), Y up, Z across (touch lines at ±34).
 * Team 0 attacks +X in the first half.
 */

export type TeamId = 0 | 1;
export type Vec2 = { x: number; z: number };
export type Vec3 = { x: number; y: number; z: number };

export type Role = 'GK' | 'RB' | 'RCB' | 'LCB' | 'LB' | 'RCM' | 'CM' | 'LCM' | 'RW' | 'ST' | 'LW';

/** 0…1 ratings. They bound what a body can do (speed, accuracy, reaction), never the result of an action. */
export type Abilities = {
  pace: number;
  acceleration: number;
  agility: number;
  technique: number;
  passing: number;
  shooting: number;
  vision: number;
  composure: number;
  tackling: number;
  positioning: number;
  reflexes: number;
  handling: number;
};

/**
 * Stable character traits, 0…1. They shift how a player weighs his options (and how much of the coach's risk setting he
 * takes on), never how well he executes or what happens to the ball.
 */
export type Traits = {
  /** Appetite for individual risk: shots and take-ons over safe options. */
  risk: number;
  /** How closely he follows the coach's instructions. */
  discipline: number;
  /** Team orientation: the pass over the solo action. */
  teamplay: number;
  /** Baseline self-confidence his form returns to. */
  confidence: number;
};

export type PlayerProfile = {
  id: number;
  team: TeamId;
  number: number;
  name: string;
  role: Role;
  foot: 'left' | 'right';
  heightM: number;
  massKg: number;
  abilities: Abilities;
  traits: Traits;
  /** In the starting eleven or on the bench at kick-off (a substitute keeps 'bench' after coming on). */
  squad: 'starter' | 'bench';
};

export type TeamProfile = { id: TeamId; name: string; short: string; kit: string; shorts: string; keeperKit: string };

/** Coach-level instruction for a whole team. The director may offer changes; players still decide individually. */
export type TeamInstruction = {
  press: 'high' | 'mid' | 'low';
  /** −1 deep block … +1 high line */
  lineHeight: number;
  /** 0 safe … 1 adventurous passing and runs */
  risk: number;
};

export type MatchPhase = 'pre-kickoff' | 'in-play' | 'stopped' | 'decision' | 'half-time' | 'full-time';
export type RestartKind = 'kickoff' | 'throw-in' | 'corner' | 'goal-kick' | 'free-kick' | 'penalty' | 'drop-ball';

/**
 * A ball action a player tries to perform. It is executed by the player's body and boots;
 * the physical contact decides what the ball actually does.
 */
export type BallAction =
  | { kind: 'pass'; receiver: number; aim: Vec2; speed: number; lofted: boolean }
  | { kind: 'shot'; aim: Vec3; speed: number }
  | { kind: 'dribble'; direction: Vec2; speed: number }
  | { kind: 'clear'; direction: Vec2; speed: number }
  /** A defender's poke at a ball still at an opponent's feet. */
  | { kind: 'tackle'; direction: Vec2; speed: number }
  /** Without `touch` the ball is cushioned dead; with it, taken into a direction (directional first touch). */
  | { kind: 'control'; touch?: { direction: Vec2; speed: number } }
  /** A header that sends the ball off with this velocity (clearance, lay-off, header at goal, or down to the feet). */
  | { kind: 'header'; velocity: Vec3 }
  /**
   * Throw-in with both hands from behind and over the head (Law 15): the velocity the ball should leave with. With a
   * `receiver` (a decision) the velocity is worked out from where he is at the moment of the throw.
   */
  | { kind: 'throw'; velocity: Vec3; receiver?: number };

/** Off-ball behaviour a player commits to for a while. */
export type MovementAction =
  | { kind: 'hold-shape' }
  | { kind: 'press'; target: number }
  /** Stay goal-side of the carrier at a jockeying distance and delay. */
  | { kind: 'jockey'; target: number }
  /** Stand in the ball's line to the own goal while the carrier has it. */
  | { kind: 'block-lane'; target: number }
  | { kind: 'mark'; target: number }
  | { kind: 'run-behind'; target: Vec2 }
  | { kind: 'recover'; target: Vec2 }
  | { kind: 'tactical-foul'; target: number }
  /** Keeper at a penalty: dive early to one side (−1 his left, +1 his right) or wait and react (0). */
  | { kind: 'guess'; side: -1 | 0 | 1 };

export type IntentSource = 'ai' | 'user';

/**
 * How a team defends a set piece, chosen in a decision moment; without one the players use their default (a wall of
 * three at a direct free kick within range, their usual marking at a corner). Read by every player of that team.
 */
export type SetPiecePlan =
  | { kind: 'wall'; size: 0 | 2 | 3 | 4 }
  | { kind: 'corner-defence'; scheme: 'man' | 'zone' | 'counter' };

export type PlayerIntent =
  | { type: 'ball'; action: BallAction; source: IntentSource; decidedAt: number }
  | { type: 'move'; action: MovementAction; source: IntentSource; decidedAt: number; until: number };

export type MatchEventBase = { id: number; tick: number; time: number };
export type MatchEvent = MatchEventBase &
  (
    | { type: 'kickoff'; team: TeamId; half: 1 | 2 }
    | { type: 'swing'; player: number; action: BallAction['kind']; source: IntentSource; receiver?: number }
    | { type: 'touch'; player: number; part: 'boot' | 'head' | 'body' | 'hands'; ballSpeed: number; position: Vec3 }
    | { type: 'catch'; player: number; position: Vec3 }
    | { type: 'release'; player: number }
    | { type: 'player-contact'; a: number; b: number; closingSpeed: number }
    | { type: 'goal'; team: TeamId; scorer: number | null; ownGoal: boolean; position: Vec3 }
    | { type: 'out'; restart: RestartKind; team: TeamId; position: Vec2 }
    | { type: 'offside'; player: number; position: Vec2 }
    | { type: 'foul'; offender: number; victim: number; position: Vec2; penalty: boolean; card: 'none' | 'yellow' | 'red'; reason: string }
    | { type: 'advantage'; team: TeamId }
    | { type: 'restart'; restart: RestartKind; team: TeamId; position: Vec2 }
    | { type: 'in-play'; restart: RestartKind; taker: number }
    | { type: 'half-time' }
    | { type: 'full-time' }
    | { type: 'moment'; momentId: number; team: TeamId; kind: MomentKind }
    | { type: 'decision'; momentId: number; optionId: string; chosenBy: DecisionSource }
    | { type: 'instruction'; team: TeamId; instruction: TeamInstruction; source: IntentSource }
    /** Law 3: `on` replaces `off` and takes over his position (`role`); `reason` when the computer's coach made the change. */
    | { type: 'substitution'; team: TeamId; off: number; on: number; role: Role; reason?: SubReason }
  );
export type MatchEventType = MatchEvent['type'];
/** Why a coach changes a player: only what is known in the match (there is no fatigue model, so none is claimed). */
export type SubReason = 'keeper' | 'form' | 'card' | 'chase' | 'protect';

export type MomentKind =
  | 'finish-or-pass' | 'take-on' | 'counter-attack' | 'counter-press' | 'breakaway-defence' | 'box-defence'
  | 'throw-in' | 'corner' | 'free-kick' | 'penalty' | 'team-talk' | 'substitution'
  | 'penalty-save' | 'free-kick-wall' | 'corner-defence';
/** What kind of situation a moment is, for quotas, variety and presentation. */
export type MomentCategory = 'attack' | 'transition' | 'defence' | 'set-piece' | 'coach';
/** Who settled a decision: the user picking an option, the user handing it to the players, or the countdown. */
export type DecisionSource = 'user' | 'delegated' | 'timeout';

/**
 * Where an option points on the pitch, taken from the frozen state it was offered in: the overlay draws exactly
 * this, so a marker always belongs to the option and never to a guess about the future.
 */
export type OptionVisual = {
  /** The player who carries the option out. */
  actor: number;
  /** Intended ball path from the ball's position. */
  ball?: { to: Vec2; kind: 'ground' | 'lofted' | 'shot' | 'dribble' | 'throw'; receiver?: number };
  /** Off-ball runs the option orders. */
  runs?: { player: number; to: Vec2 }[];
  /** Target area (corner zones, a pressing area). */
  zone?: { x: number; z: number; r: number };
  /** A team instruction moves the defensive line from x to x (from the real shape model). */
  line?: { team: TeamId; from: number; to: number };
};

/** One executable alternative offered to the user. Executability is verified before it is offered. */
export type DecisionOption = {
  id: string;
  label: string;
  detail: string;
  /** What the choice hands to the players: intents for one or several players, or a team instruction for a while (0 s: for the rest of the match). */
  effect:
    | { type: 'player'; player: number; intent: PlayerIntent }
    | { type: 'players'; orders: { player: number; intent: PlayerIntent }[] }
    | { type: 'team'; team: TeamId; instruction: TeamInstruction; seconds: number }
    | { type: 'substitution'; team: TeamId; off: number; on: number }
    | { type: 'set-piece'; team: TeamId; plan: SetPiecePlan }
    | { type: 'none' };
  /** Rough, honest outlook from the current state; never a promise of the outcome. */
  outlook: string;
  visual?: OptionVisual;
};

export type DecisionMoment = {
  id: number;
  tick: number;
  team: TeamId;
  kind: MomentKind;
  category: MomentCategory;
  title: string;
  situation: string;
  focusPlayer: number;
  /** Players the user must see to judge the options (actor, receivers, nearest opponents, keeper). */
  participants: number[];
  options: DecisionOption[];
  /** Option the players fall back to if the user does not decide in time: what the AI would have done. */
  defaultOptionId: string;
  timeoutSeconds: number;
};

export type PlayerView = {
  id: number;
  position: Vec3;
  velocity: Vec3;
  heading: number;
  boots: [Vec3, Vec3];
  swingingBoot: -1 | 0 | 1;
  hands: Vec3 | null;
  /** Forehead (header) or chest (chest control) while the player is playing the ball with it. */
  upperBody: { part: 'head' | 'chest'; position: Vec3 } | null;
  /** Sliding tackle: 0 standing … 1 down on the turf. */
  lying: number;
  booked: 'none' | 'yellow' | 'red';
  sentOff: boolean;
};

/** Read-only view of the authoritative state for presentation, director and tests. */
export type MatchSnapshot = {
  tick: number;
  time: number;
  half: 1 | 2;
  clockSeconds: number;
  phase: MatchPhase;
  score: [number, number];
  ball: { position: Vec3; velocity: Vec3; spin: Vec3; rotation: { x: number; y: number; z: number; w: number }; heldBy: number | null };
  players: PlayerView[];
  possession: TeamId | null;
  lastTouch: number | null;
  restart: { kind: RestartKind; team: TeamId; position: Vec2; taker: number; placed: boolean } | null;
  moment: DecisionMoment | null;
  /** Each player's character and current form (confidence from his real actions in this match). */
  minds: { confidence: number; recent: { action: 'pass' | 'dribble' | 'shot'; ok: boolean }[] }[];
};
