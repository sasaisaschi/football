import type { MatchEngine } from '../engine/match-engine';
import type { DecisionOption, PlayerProfile, Role, TeamId, TeamInstruction } from '../engine/types';
import { DEFENDERS, FORWARDS, MIDFIELDERS } from '../ai/shape';
import { participantsFor, type MomentDraft } from './common';
import { lineUnder } from './open-play';

/**
 * Half-time team talk before the second half's kick-off: a team instruction for the rest of the match, through the
 * existing TeamInstruction mechanism (press height, line, risk). Substitutions are their own moment (below).
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

const lineOf = (r: Role) => (DEFENDERS.has(r) ? 'def' : MIDFIELDERS.has(r) ? 'mid' : FORWARDS.has(r) ? 'fwd' : 'gk');
const LINE_NAME = { def: 'Abwehr', mid: 'Mittelfeld', fwd: 'Angriff', gk: 'Tor' } as const;

/**
 * A substitution in the second half, at a stoppage (Law 3, `MatchEngine.substitute`). There is no fatigue model, so
 * the reasons offered are the real ones: a player's form in this match, a yellow card, or a change of profile between
 * defence and attack. The substitute takes over the replaced player's position. "Keinen Wechsel" is the default.
 */
export function substitutionMoment(e: MatchEngine, team: TeamId): MomentDraft | null {
  if (e.half !== 2 || !e.canSubstitute(team)) return null;
  const bench = e.benchOf(team).filter(p => p.role !== 'GK');
  const field = e.profiles.filter(p => p.team === team && !e.referee.sentOff.has(p.id) && p.role !== 'GK');
  if (!bench.length || !field.length) return null;
  const form = (id: number) => e.minds[id].confidence;
  const judged = (id: number) => e.minds[id].recent.length;
  const [ours, theirs] = team === 0 ? e.score : [e.score[1], e.score[0]];
  const picks: { id: string; label: string; off: PlayerProfile; on: PlayerProfile; why: string }[] = [];
  const add = (id: string, label: string, off: PlayerProfile | undefined, on: PlayerProfile | undefined, why: string) => {
    if (off && on && !picks.some(p => p.off.id === off.id || p.on.id === on.id)) picks.push({ id, label, off, on, why });
  };
  const sameLine = (off: PlayerProfile) => bench.find(b => lineOf(b.role) === lineOf(off.role)) ?? bench[0];
  const weakest = [...field].filter(p => judged(p.id) >= 2).sort((a, b) => form(a.id) - form(b.id))[0];
  if (weakest) {
    const ok = e.minds[weakest.id].recent.filter(r => r.ok).length;
    add('sub-form', 'Formschwächsten wechseln', weakest, sameLine(weakest), `${weakest.name}: ${ok} von ${judged(weakest.id)} Aktionen gelungen`);
  }
  const booked = field.find(p => e.referee.yellow.has(p.id));
  if (booked) add('sub-card', 'Gelbgefährdeten schützen', booked, sameLine(booked), `${booked.name} hat Gelb – ein weiteres Foul wäre Rot`);
  if (ours <= theirs) {
    const mid = [...field].filter(p => lineOf(p.role) === 'mid').sort((a, b) => form(a.id) - form(b.id))[0];
    const striker = [...bench].filter(b => lineOf(b.role) === 'fwd').sort((a, b) => b.abilities.shooting - a.abilities.shooting)[0];
    if (mid && striker) add('sub-attack', 'Offensiver Wechsel', mid, striker, `Abschluss ${striker.abilities.shooting.toFixed(2)} statt ${mid.abilities.shooting.toFixed(2)}, Risikofreude ${striker.traits.risk.toFixed(2)}`);
  } else {
    const fwd = [...field].filter(p => lineOf(p.role) === 'fwd').sort((a, b) => form(a.id) - form(b.id))[0];
    const stopper = [...bench].filter(b => lineOf(b.role) !== 'fwd').sort((a, b) => b.abilities.tackling - a.abilities.tackling)[0];
    if (fwd && stopper) add('sub-defend', 'Defensiver Wechsel', fwd, stopper, `Zweikampf ${stopper.abilities.tackling.toFixed(2)} statt ${fwd.abilities.tackling.toFixed(2)}, vorsichtiger`);
  }
  if (!picks.length) return null;
  const options: DecisionOption[] = [
    { id: 'no-sub', label: 'Keinen Wechsel', detail: `${e.substitutions[team]} von 5 Wechseln genutzt`, effect: { type: 'none' }, outlook: 'die Elf bleibt zusammen', visual: { actor: picks[0].off.id } },
    ...picks.slice(0, 3).map(p => ({
      id: p.id, label: `${p.label}: ${p.on.name} für ${p.off.name}`, detail: `${p.on.name} (${p.on.number}) übernimmt die Position ${p.off.role} (${LINE_NAME[lineOf(p.off.role)]})`,
      effect: { type: 'substitution' as const, team, off: p.off.id, on: p.on.id }, outlook: p.why,
      visual: { actor: p.off.id, zone: { ...e.bodies[p.off.id].position(), r: 1.6 } },
    })),
  ];
  return {
    kind: 'substitution', category: 'coach', title: 'Wechsel?', situation: `Spielunterbrechung, ${ours}:${theirs}. Ersatzbank: ${bench.map(b => `${b.name} (${b.role})`).join(', ')}.`,
    focusPlayer: picks[0].off.id, options, defaultOptionId: 'no-sub', participants: participantsFor(e, team, picks[0].off.id, options),
  };
}
