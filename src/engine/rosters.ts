import type { Abilities, PlayerProfile, Role, TeamId, TeamProfile } from './types';
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

export function createRoster(seed = 1): PlayerProfile[] {
  const rng = createRng(seed);
  const players: PlayerProfile[] = [];
  for (const team of [0, 1] as TeamId[]) {
    SHAPE.forEach((slot, i) => {
      const base = TEMPLATE[slot.role];
      const abilities = {} as Abilities;
      for (const k of KEYS) {
        const centre = base[k] ?? (slot.role === 'GK' && k !== 'composure' ? 0.3 : 0.55);
        abilities[k] = Math.max(0.15, Math.min(0.95, centre + rng.gauss() * 0.07));
      }
      const heightM = slot.role === 'GK' ? 1.9 + rng.gauss() * 0.03 : 1.8 + rng.gauss() * 0.05;
      players.push({
        id: players.length,
        team,
        number: slot.number,
        name: NAMES[team][i],
        role: slot.role,
        foot: rng.next() < 0.22 ? 'left' : 'right',
        heightM,
        massKg: 24 * heightM * heightM,
        abilities,
      });
    });
  }
  return players;
}
