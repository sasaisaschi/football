import type { PlayerProfile } from '../engine/types';
import { neutralConfidence, type PlayerMind } from './mind';

/**
 * What the players carry from one match to the next: a baseline confidence that grows or shrinks with how their
 * matches went, and their trust in team-mates. Versioned plain JSON (the browser keeps it in localStorage; no remote
 * service). It only changes how players weigh their options, through PlayerMind; never a ball or a result.
 */
export const MEMORY_VERSION = 1;
export const MEMORY_STORAGE_KEY = 'the12thman.agents.v1';

export type PlayerMemory = { baseline: number; bonds: Record<string, number>; matches: number };
export type AgentMemory = { version: typeof MEMORY_VERSION; rosterSeed: number; matches: number; players: Record<string, PlayerMemory> };

/** How far a match's final form moves the baseline, and how far the baseline may drift from the trait (±). */
const BASELINE_LEARNING = 0.25, BASELINE_DRIFT = 0.15;
/** Trust carried into the next match (the rest fades). */
const BOND_KEPT = 0.8;
/** Bonds weaker than this are not kept. */
const BOND_FLOOR = 0.01;

/** Stable key of a player across matches (same roster seed): team, shirt number and name. */
export const playerKey = (p: PlayerProfile) => `${p.team}-${p.number}-${p.name}`;

export function emptyMemory(rosterSeed: number): AgentMemory {
  return { version: MEMORY_VERSION, rosterSeed, matches: 0, players: {} };
}

/** A stored memory, if it is one this version understands and belongs to this roster; otherwise null (start fresh). */
export function parseMemory(json: string | null, rosterSeed: number): AgentMemory | null {
  if (!json) return null;
  try {
    const m = JSON.parse(json) as Partial<AgentMemory>;
    if (m.version !== MEMORY_VERSION || m.rosterSeed !== rosterSeed || typeof m.players !== 'object' || !m.players) return null;
    return m as AgentMemory;
  } catch {
    return null;
  }
}

/** Gives the players of a new match what they remember. */
export function applyMemory(memory: AgentMemory, minds: readonly PlayerMind[], profiles: readonly PlayerProfile[]): void {
  const byKey = new Map(profiles.map(p => [playerKey(p), p.id]));
  for (const p of profiles) {
    const m = memory.players[playerKey(p)];
    if (!m) continue;
    minds[p.id].setBaseline(m.baseline);
    for (const [k, b] of Object.entries(m.bonds)) {
      const mate = byKey.get(k);
      if (mate !== undefined) minds[p.id].bonds.set(mate, b);
    }
  }
}

/**
 * After a match: each player's baseline moves a quarter of the way towards where his form ended (relative to the
 * neutral level), within ±0.15 of his trait; trust is kept at 80 %. Deterministic: same match, same memory.
 */
export function updateMemory(previous: AgentMemory, minds: readonly PlayerMind[], profiles: readonly PlayerProfile[]): AgentMemory {
  const next: AgentMemory = { version: MEMORY_VERSION, rosterSeed: previous.rosterSeed, matches: previous.matches + 1, players: { ...previous.players } };
  for (const p of profiles) {
    const mind = minds[p.id];
    const key = playerKey(p);
    const old = previous.players[key];
    if (mind.recent.length === 0 && !old) continue; // never played and nothing to keep
    const form = mind.confidence - neutralConfidence(mind.baseline);
    const baseline = Math.max(p.traits.confidence - BASELINE_DRIFT, Math.min(p.traits.confidence + BASELINE_DRIFT, mind.baseline + BASELINE_LEARNING * form));
    const bonds: Record<string, number> = {};
    for (const [mate, b] of mind.bonds) {
      const kept = +(b * BOND_KEPT).toFixed(4);
      if (Math.abs(kept) >= BOND_FLOOR) bonds[playerKey(profiles[mate])] = kept;
    }
    next.players[key] = { baseline: +baseline.toFixed(4), bonds, matches: (old?.matches ?? 0) + (mind.recent.length ? 1 : 0) };
  }
  return next;
}
