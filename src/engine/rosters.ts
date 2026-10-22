import type { Abilities, PlayerProfile, Role, TeamId, TeamProfile, Traits } from './types';
import { createRng } from './rng';

/** Two fictional clubs. No real players, clubs or likenesses are used. */
export const TEAMS: [TeamProfile, TeamProfile] = [
  { id: 0, name: 'Harbourside Athletic', short: 'HAR', kit: '#ff8a2a', shorts: '#14213d', keeperKit: '#d6f04a' },
  { id: 1, name: 'Northgate Rovers', short: 'NOR', kit: '#4cc3ff', shorts: '#eef2f8', keeperKit: '#c04ae8' },
];

/** 4-3-3 shirt numbers. */
const SHAPE: { role: Role; number: number }[] = [
  { role: 'GK', number: 1 }, { role: 'RB', number: 2 }, { role: 'RCB', number: 5 }, { role: 'LCB', number: 6 },
  { role: 'LB', number: 3 }, { role: 'RCM', number: 8 }, { role: 'CM', number: 4 }, { role: 'LCM', number: 10 },
  { role: 'RW', number: 7 }, { role: 'ST', number: 9 }, { role: 'LW', number: 11 },
];

const NAMES = [
  ['Okafor', 'Reyes', 'Lindqvist', 'Brandt', 'Mensah', 'Hale', 'Costa', 'Nakamura', 'Doyle', 'Ferreira', 'Kowal'],
  ['Ashworth', 'Diallo', 'Varga', 'Moreau', 'Quinn', 'Sato', 'Petrov', 'Adeyemi', 'Holm', 'Navarro', 'Byrne'],
];

/** Role tendencies; individual ratings scatter around them from the seed. */
const TEMPLATE: Record<Role, Partial<Abilities>> = {
  GK: { reflexes: 0.8, handling: 0.78, positioning: 0.75, pace: 0.3, passing: 0.45 },
  RB: { pace: 0.72, tackling: 0.68, positioning: 0.62, passing: 0.58 },
  LB: { pace: 0.72, tackling: 0.68, positioning: 0.62, passing: 0.58 },
  RCB: { tackling: 0.78, positioning: 0.75, pace: 0.55, passing: 0.55 },
  LCB: { tackling: 0.78, positioning: 0.75, pace: 0.55, passing: 0.55 },
  CM: { passing: 0.75, vision: 0.72, tackling: 0.62, technique: 0.68 },
  RCM: { passing: 0.72, vision: 0.7, technique: 0.7, shooting: 0.55 },
  LCM: { passing: 0.72, vision: 0.7, technique: 0.7, shooting: 0.55 },
  RW: { pace: 0.82, technique: 0.74, shooting: 0.65, agility: 0.78 },
  LW: { pace: 0.82, technique: 0.74, shooting: 0.65, agility: 0.78 },
  ST: { shooting: 0.8, composure: 0.72, technique: 0.7, pace: 0.72 },
};

const KEYS: (keyof Abilities)[] = ['pace', 'acceleration', 'agility', 'technique', 'passing', 'shooting', 'vision', 'composure', 'tackling', 'positioning', 'reflexes', 'handling'];

/**
 * Character tendencies by role (defenders disciplined, wide forwards adventurous); individual traits scatter around them
 * from their own random stream, so the abilities of every roster stay exactly as before traits existed.
 */
const TRAIT_TEMPLATE: Partial<Record<Role, Partial<Traits>>> = {
  RCB: { risk: 0.3, discipline: 0.7 }, LCB: { risk: 0.3, discipline: 0.7 }, GK: { risk: 0.25, discipline: 0.7 },
  CM: { teamplay: 0.7 }, RCM: { teamplay: 0.65 }, LCM: { teamplay: 0.65 },
  RW: { risk: 0.68, teamplay: 0.42 }, LW: { risk: 0.68, teamplay: 0.42 }, ST: { risk: 0.62, confidence: 0.6 },
};

/** Five substitutes per club (Law 3 allows five changes): keeper, centre-back, two midfielders, a forward. */
const BENCH: { role: Role; number: number }[] = [
  { role: 'GK', number: 12 }, { role: 'RCB', number: 15 }, { role: 'CM', number: 14 }, { role: 'RW', number: 17 }, { role: 'ST', number: 19 },
];
const BENCH_NAMES = [
  ['Achterberg', 'Sule', 'Pereira', 'Lindgren', 'Odum'],
  ['Kerr', 'Baptiste', 'Novak', 'Fofana', 'Iwata'],
];

type Rng = ReturnType<typeof createRng>;

function makePlayer(id: number, team: TeamId, role: Role, number: number, name: string, squad: PlayerProfile['squad'], rng: Rng, character: Rng): PlayerProfile {
  const base = TEMPLATE[role];
  const abilities = {} as Abilities;
  for (const k of KEYS) {
    const centre = base[k] ?? (role === 'GK' && k !== 'composure' ? 0.3 : 0.55);
    abilities[k] = Math.max(0.15, Math.min(0.95, centre + rng.gauss() * 0.07));
  }
  const heightM = role === 'GK' ? 1.9 + rng.gauss() * 0.03 : 1.8 + rng.gauss() * 0.05;
  const foot = rng.next() < 0.22 ? 'left' : 'right';
  const trait = (centre: number) => Math.max(0.05, Math.min(0.95, centre + character.gauss() * 0.15));
  const t = TRAIT_TEMPLATE[role] ?? {};
  const traits = { risk: trait(t.risk ?? 0.5), discipline: trait(t.discipline ?? 0.5), teamplay: trait(t.teamplay ?? 0.5), confidence: trait(t.confidence ?? 0.55) };
  return { id, team, number, name, role, foot, heightM, massKg: 24 * heightM * heightM, abilities, traits, squad };
}

/**
 * Starting elevens (ids 0–21, team 0 first) and the benches (ids 22–31). Benches come from their own random streams,
 * so every starting player keeps exactly the ratings and traits he had before benches existed.
 */
export function createRoster(seed = 1): PlayerProfile[] {
  const rng = createRng(seed);
  const character = createRng(seed * 7919 + 13);
  const players: PlayerProfile[] = [];
  for (const team of [0, 1] as TeamId[]) {
    SHAPE.forEach((slot, i) => players.push(makePlayer(players.length, team, slot.role, slot.number, NAMES[team][i], 'starter', rng, character)));
  }
  const benchRng = createRng(seed * 104729 + 7), benchCharacter = createRng(seed * 15485863 + 3);
  for (const team of [0, 1] as TeamId[]) {
    BENCH.forEach((slot, i) => players.push(makePlayer(players.length, team, slot.role, slot.number, BENCH_NAMES[team][i], 'bench', benchRng, benchCharacter)));
  }
  return players;
}
