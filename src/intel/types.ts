import type { TeamId } from '../engine/types';

/**
 * Match intelligence: one pipeline in five stages, each a separate module with its own job and its own output, all
 * working on one shared, versioned state (the IntelBoard):
 *   ingest (board.ts)      – match events in display order, each with the frame it happened in
 *   interpret (stats.ts)   – passes, shots, possession, pressure, set pieces, decisions as statistics
 *   explain (patterns.ts)  – patterns and moments that matter, each with the reason and the events it rests on
 *   render (narrator.ts)   – words for two audiences (fan, analyst) in two languages (en, de)
 *   personalize (ui)       – mode, language, favourite team and a focus player chosen by the viewer
 * Nothing in it changes the match: it only reads events and frames.
 */

export type Mode = 'fan' | 'analyst';

export type TeamStats = {
  /** Simulated seconds with the ball in play and this team in possession; and in the opponents' half. */
  possession: number;
  territory: number;
  passes: number;
  passesCompleted: number;
  /** Sum of distances of struck passes (m) and of their difficulty ratings (1–5), for averages. */
  passDistance: number;
  passDifficulty: number;
  /** Passes that gained at least 10 m towards the opponents' goal. */
  progressivePasses: number;
  shots: number;
  shotsOnTarget: number;
  /** Sum of the shots' expected-goals values from the simple distance/angle model (intel/shot-model.ts). */
  xg: number;
  goals: number;
  /** Times this team put a ball carrier under pressure (closest defender within PRESSURE_DISTANCE), and won the ball within PRESSURE_WIN seconds. */
  pressures: number;
  pressureWins: number;
  ballsWon: number;
  ballsLost: number;
  /** Ball lost in the own third: the risky kind. */
  lostOwnThird: number;
  fouls: number;
  corners: number;
  maxShotSpeed: number;
};

export type PlayerStats = {
  touches: number;
  passes: number;
  passesCompleted: number;
  shots: number;
  goals: number;
  xg: number;
  /** Metres covered while the ball was in play, top speed (m/s), sprints started (crossing SPRINT_SPEED). */
  distance: number;
  topSpeed: number;
  sprints: number;
  ballsWon: number;
};

/** What kind of insight; the narrator words each kind for both audiences. */
export type InsightKind =
  | 'goal-story' | 'big-chance' | 'save' | 'momentum' | 'chaos' | 'control' | 'pressing' | 'danger'
  | 'speed' | 'decision' | 'half-summary' | 'full-summary';

/**
 * One explained moment. `data` holds the numbers and names it rests on, `eventIds` the match events (MatchEvent.id)
 * it was derived from, so every statement can be checked against the event log.
 */
export type Insight = {
  id: number;
  tick: number;
  time: number;
  clock: string;
  kind: InsightKind;
  team: TeamId | null;
  player: number | null;
  /** 3: must be shown (goals, decisions), 2: notable, 1: background. */
  priority: 1 | 2 | 3;
  data: Record<string, number | string | boolean>;
  eventIds: number[];
};

/** A viewer's choice of how the intelligence reaches them. */
export type Personalization = { mode: Mode; favouriteTeam: TeamId; focusPlayer: number | null };
