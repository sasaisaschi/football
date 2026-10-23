import type { MatchEngine } from '../engine/match-engine';
import type { DecisionOption, PlayerProfile, Role, TeamId, TeamInstruction } from '../engine/types';
import { DEFENDERS, FORWARDS, MIDFIELDERS } from '../ai/shape';
import { participantsFor, type MomentDraft } from './common';
import { lineUnder } from './open-play';
import { tr } from '../i18n';

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
    { id: 'keep', label: tr('Carry on', 'Weiter so'), detail: tr('No change to the instructions', 'Keine Änderung der Vorgaben'), instruction: null, outlook: tr('the team plays as in the first half', 'die Mannschaft spielt wie in der ersten Halbzeit') },
    { id: 'press', label: tr('Press high, be brave', 'Hoch pressen, mutig spielen'), detail: tr('High press, the line steps up, more risk going forward', 'Pressing hoch, Linie rückt auf, mehr Risiko nach vorn'), instruction: talk({ press: 'high', lineHeight: 0.5, risk: 0.7 }), outlook: tr('more balls won high up, space behind the defence', 'mehr Ballgewinne vorn, Raum hinter der Abwehr') },
    { id: 'compact', label: tr('Stay compact, counter', 'Kompakt stehen, kontern'), detail: tr('Deep block, low press, quick transitions', 'Tiefer Block, Pressing tief, schnell umschalten'), instruction: talk({ press: 'low', lineHeight: -0.5, risk: 0.6 }), outlook: tr('hard to play through, less possession of our own', 'schwer zu bespielen, weniger eigener Ballbesitz') },
    { id: 'possession', label: tr('Keep the ball moving', 'Ball laufen lassen'), detail: tr('Safe passes, patient build-up', 'Sichere Pässe, geduldiger Aufbau'), instruction: talk({ press: 'mid', lineHeight: 0, risk: 0.25 }), outlook: tr('fewer turnovers, slower attacks', 'weniger Ballverluste, langsamere Angriffe') },
  ];
  const options: DecisionOption[] = choices.map(c => ({
    id: c.id, label: c.label, detail: c.detail, outlook: c.outlook,
    effect: c.instruction ? { type: 'team', team, instruction: c.instruction, seconds: 0 } : { type: 'none' },
    visual: { actor: captain.id, ...(c.instruction ? { line: line(c.instruction) } : {}) },
  }));
  const [a, b] = e.score;
  const ours = team === 0 ? a : b, theirs = team === 0 ? b : a;
  const state = ours > theirs ? tr(`Leading ${ours}:${theirs}`, `Führung ${ours}:${theirs}`) : ours < theirs ? tr(`Trailing ${ours}:${theirs}`, `Rückstand ${ours}:${theirs}`) : tr(`Level at ${ours}:${theirs}`, `Unentschieden ${ours}:${theirs}`);
  return {
    kind: 'team-talk', category: 'coach', title: tr('Half-time – your team talk', 'Halbzeit – deine Ansprache'), situation: tr(`${state}. The instruction holds for the whole second half.`, `${state}. Die Vorgabe gilt für die ganze zweite Halbzeit.`),
    focusPlayer: captain.id, options, defaultOptionId: 'keep', participants: participantsFor(e, team, captain.id, options),
  };
}

const lineOf = (r: Role) => (DEFENDERS.has(r) ? 'def' : MIDFIELDERS.has(r) ? 'mid' : FORWARDS.has(r) ? 'fwd' : 'gk');
const LINE_NAME = (line: 'def' | 'mid' | 'fwd' | 'gk') => ({ def: tr('defence', 'Abwehr'), mid: tr('midfield', 'Mittelfeld'), fwd: tr('attack', 'Angriff'), gk: tr('goal', 'Tor') })[line];

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
    add('sub-form', tr('Take off the player out of form', 'Formschwächsten wechseln'), weakest, sameLine(weakest), tr(`${weakest.name}: ${ok} of ${judged(weakest.id)} actions succeeded`, `${weakest.name}: ${ok} von ${judged(weakest.id)} Aktionen gelungen`));
  }
  const booked = field.find(p => e.referee.yellow.has(p.id));
  if (booked) add('sub-card', tr('Protect the booked player', 'Gelbgefährdeten schützen'), booked, sameLine(booked), tr(`${booked.name} is on a yellow – another foul would be red`, `${booked.name} hat Gelb – ein weiteres Foul wäre Rot`));
  if (ours <= theirs) {
    const mid = [...field].filter(p => lineOf(p.role) === 'mid').sort((a, b) => form(a.id) - form(b.id))[0];
    const striker = [...bench].filter(b => lineOf(b.role) === 'fwd').sort((a, b) => b.abilities.shooting - a.abilities.shooting)[0];
    if (mid && striker) add('sub-attack', tr('Attacking change', 'Offensiver Wechsel'), mid, striker, tr(`finishing ${striker.abilities.shooting.toFixed(2)} instead of ${mid.abilities.shooting.toFixed(2)}, appetite for risk ${striker.traits.risk.toFixed(2)}`, `Abschluss ${striker.abilities.shooting.toFixed(2)} statt ${mid.abilities.shooting.toFixed(2)}, Risikofreude ${striker.traits.risk.toFixed(2)}`));
  } else {
    const fwd = [...field].filter(p => lineOf(p.role) === 'fwd').sort((a, b) => form(a.id) - form(b.id))[0];
    const stopper = [...bench].filter(b => lineOf(b.role) !== 'fwd').sort((a, b) => b.abilities.tackling - a.abilities.tackling)[0];
    if (fwd && stopper) add('sub-defend', tr('Defensive change', 'Defensiver Wechsel'), fwd, stopper, tr(`tackling ${stopper.abilities.tackling.toFixed(2)} instead of ${fwd.abilities.tackling.toFixed(2)}, more cautious`, `Zweikampf ${stopper.abilities.tackling.toFixed(2)} statt ${fwd.abilities.tackling.toFixed(2)}, vorsichtiger`));
  }
  if (!picks.length) return null;
  const options: DecisionOption[] = [
    { id: 'no-sub', label: tr('No change', 'Keinen Wechsel'), detail: tr(`${e.substitutions[team]} of 5 substitutions used`, `${e.substitutions[team]} von 5 Wechseln genutzt`), effect: { type: 'none' }, outlook: tr('the eleven stay together', 'die Elf bleibt zusammen'), visual: { actor: picks[0].off.id } },
    ...picks.slice(0, 3).map(p => ({
      id: p.id, label: tr(`${p.label}: ${p.on.name} for ${p.off.name}`, `${p.label}: ${p.on.name} für ${p.off.name}`), detail: tr(`${p.on.name} (${p.on.number}) takes over ${p.off.role} (${LINE_NAME(lineOf(p.off.role))})`, `${p.on.name} (${p.on.number}) übernimmt die Position ${p.off.role} (${LINE_NAME(lineOf(p.off.role))})`),
      effect: { type: 'substitution' as const, team, off: p.off.id, on: p.on.id }, outlook: p.why,
      visual: { actor: p.off.id, zone: { ...e.bodies[p.off.id].position(), r: 1.6 } },
    })),
  ];
  return {
    kind: 'substitution', category: 'coach', title: tr('Substitution?', 'Wechsel?'), situation: tr(`Stoppage, ${ours}:${theirs}. Bench: ${bench.map(b => `${b.name} (${b.role})`).join(', ')}.`, `Spielunterbrechung, ${ours}:${theirs}. Ersatzbank: ${bench.map(b => `${b.name} (${b.role})`).join(', ')}.`),
    focusPlayer: picks[0].off.id, options, defaultOptionId: 'no-sub', participants: participantsFor(e, team, picks[0].off.id, options),
  };
}
