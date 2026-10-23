import type { AgentMemory } from '../ai/agent-memory';
import type { LineupSwap } from './rosters';
import type { TeamId, TeamInstruction } from './types';

/**
 * `memory`: what the players remember from earlier matches (agent-memory.ts); without it they start from their traits.
 * `benchCoach`: teams whose substitutions the computer's coach makes (bench-manager.ts); the user's team changes only by
 * the user's decision.
 */
export type MatchConfig = {
  seed: number; halfMinutes: number; rosterSeed?: number; memory?: AgentMemory; benchCoach?: TeamId[];
  /** Team instructions from kick-off (pressing, line, risk), per team; without one the default. */
  instructions?: [TeamInstruction | undefined, TeamInstruction | undefined];
  /** Changes to the starting elevens before kick-off (rosters.ts `applyLineup`). */
  lineup?: LineupSwap[];
};

export const DEFAULT_INSTRUCTION: TeamInstruction = { press: 'mid', lineHeight: 0, risk: 0.5 };
