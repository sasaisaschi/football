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
  | { kind: 'control' };

/** Off-ball behaviour a player commits to for a while. */
export type MovementAction =
  | { kind: 'hold-shape' }
  | { kind: 'press'; target: number }
  | { kind: 'mark'; target: number }
  | { kind: 'run-behind'; target: Vec2 }
  | { kind: 'recover'; target: Vec2 }
  | { kind: 'tactical-foul'; target: number };

export type IntentSource = 'ai' | 'user';

export type PlayerIntent =
  | { type: 'ball'; action: BallAction; source: IntentSource; decidedAt: number }
  | { type: 'move'; action: MovementAction; source: IntentSource; decidedAt: number; until: number };

export type MatchEventBase = { id: number; tick: number; time: number };
export type MatchEvent = MatchEventBase &
  (
    | { type: 'kickoff'; team: TeamId; half: 1 | 2 }
    | { type: 'swing'; player: number; action: BallAction['kind']; source: IntentSource }
    | { type: 'touch'; player: number; part: 'boot' | 'body' | 'hands'; ballSpeed: number; position: Vec3 }
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
    | { type: 'decision'; momentId: number; optionId: string; chosenBy: 'user' | 'timeout' }
    | { type: 'instruction'; team: TeamId; instruction: TeamInstruction; source: IntentSource }
  );
export type MatchEventType = MatchEvent['type'];

export type MomentKind = 'finish-or-pass' | 'take-on' | 'counter-attack' | 'counter-press' | 'breakaway-defence';

/** One executable alternative offered to the user. Executability is verified before it is offered. */
export type DecisionOption = {
  id: string;
  label: string;
  detail: string;
  /** What the choice hands to the players: an intent for one player, or a team instruction for a while. */
  effect:
    | { type: 'player'; player: number; intent: PlayerIntent }
    | { type: 'team'; team: TeamId; instruction: TeamInstruction; seconds: number }
    | { type: 'none' };
  /** Rough, honest outlook from the current state; never a promise of the outcome. */
  outlook: string;
};

export type DecisionMoment = {
  id: number;
  tick: number;
  team: TeamId;
  kind: MomentKind;
  title: string;
  situation: string;
  focusPlayer: number;
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
  restart: { kind: RestartKind; team: TeamId; position: Vec2 } | null;
  moment: DecisionMoment | null;
};
