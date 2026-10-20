import type { MatchEngine } from '../engine/match-engine';
import type { DecisionOption, TeamId, TeamInstruction } from '../engine/types';
import { participantsFor, type MomentDraft } from './common';
import { lineUnder } from './open-play';

/**
 * Half-time team talk before the second half's kick-off: a team instruction for the rest of the match, through the
 * existing TeamInstruction mechanism (press height, line, risk). Substitutions are not offered: there is no bench yet.
 */
export function teamTalkMoment(e: MatchEngine, team: TeamId): MomentDraft | null {
  const r = e.restart;
  if (!r || r.kind !== 'kickoff' || e.half !== 2) return null;
  const base = e.instructions[team];
  const talk = (over: Partial<TeamInstruction>): TeamInstruction => ({ ...base, ...over });
  const captain = e.profiles.find(p => p.team === team && p.role === 'CM' && !e.referee.sentOff.has(p.id))
    ?? e.profiles.find(p => p.team === team && p.role !== 'GK' && !e.referee.sentOff.has(p.id))!;
  const line = (i: TeamInstruction) => ({ team, from: lineUnder(e, team, base, false), to: lineUnder(e, team, i, false) });
  const choices: { id: string; label: string; detail: string; instruction: TeamInstruction | null; outlook: string }[] = [
    { id: 'keep', label: 'Weiter so', detail: 'Keine Änderung der Vorgaben', instruction: null, outlook: 'die Mannschaft spielt wie in der ersten Halbzeit' },
    { id: 'press', label: 'Hoch pressen, mutig spielen', detail: 'Pressing hoch, Linie rückt auf, mehr Risiko nach vorn', instruction: talk({ press: 'high', lineHeight: 0.5, risk: 0.7 }), outlook: 'mehr Ballgewinne vorn, Raum hinter der Abwehr' },
    { id: 'compact', label: 'Kompakt stehen, kontern', detail: 'Tiefer Block, Pressing tief, schnell umschalten', instruction: talk({ press: 'low', lineHeight: -0.5, risk: 0.6 }), outlook: 'schwer zu bespielen, weniger eigener Ballbesitz' },
    { id: 'possession', label: 'Ball laufen lassen', detail: 'Sichere Pässe, geduldiger Aufbau', instruction: talk({ press: 'mid', lineHeight: 0, risk: 0.25 }), outlook: 'weniger Ballverluste, langsamere Angriffe' },
  ];
  const options: DecisionOption[] = choices.map(c => ({
    id: c.id, label: c.label, detail: c.detail, outlook: c.outlook,
    effect: c.instruction ? { type: 'team', team, instruction: c.instruction, seconds: 0 } : { type: 'none' },
    visual: { actor: captain.id, ...(c.instruction ? { line: line(c.instruction) } : {}) },
  }));
  const [a, b] = e.score;
  const ours = team === 0 ? a : b, theirs = team === 0 ? b : a;
  const state = ours > theirs ? `Führung ${ours}:${theirs}` : ours < theirs ? `Rückstand ${ours}:${theirs}` : `Unentschieden ${ours}:${theirs}`;
  return {
    kind: 'team-talk', category: 'coach', title: 'Halbzeit – deine Ansprache', situation: `${state}. Die Vorgabe gilt für die ganze zweite Halbzeit.`,
    focusPlayer: captain.id, options, defaultOptionId: 'keep', participants: participantsFor(e, team, captain.id, options),
  };
}
