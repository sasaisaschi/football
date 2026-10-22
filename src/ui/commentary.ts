import { TEAMS } from '../engine/rosters';
import type { FoulReason, MatchEvent, PlayerProfile, RestartKind, SubReason } from '../engine/types';
import { tr } from '../i18n';

/** What commentary needs to know: who is who, and the score at the time of the event. */
export type CommentaryContext = { profiles: readonly PlayerProfile[]; score: readonly [number, number] };

/** A restart's name in the current language. */
export function restartName(kind: RestartKind): string {
  return {
    'throw-in': tr('throw-in', 'Einwurf'), corner: tr('corner', 'Ecke'), 'goal-kick': tr('goal kick', 'Abstoß'), 'free-kick': tr('free kick', 'Freistoß'),
    penalty: tr('penalty', 'Elfmeter'), kickoff: tr('kick-off', 'Anstoß'), 'drop-ball': tr('dropped ball', 'Schiedsrichterball'),
  }[kind];
}

/** The referee's reason for a foul (a code from referee.ts) in words. */
export function foulReason(reason: FoulReason): string {
  return {
    foul: tr('foul', 'Foulspiel'), reckless: tr('reckless challenge', 'rücksichtsloses Einsteigen'), 'reckless-slide': tr('reckless sliding tackle', 'rücksichtslose Grätsche'),
    'excessive-slide': tr('sliding tackle from behind with excessive force', 'Grätsche von hinten mit übermäßiger Härte'),
    dogso: tr('denying an obvious goal-scoring opportunity', 'Verhinderung einer offensichtlichen Torchance'), tactical: tr('tactical foul', 'taktisches Foul'),
    'stopping-attack': tr('stopping a promising attack', 'Unterbinden eines aussichtsreichen Angriffs'),
  }[reason];
}

/** The computer coach's reason, as the commentator would see it. */
function subReason(reason: SubReason): string {
  return {
    keeper: tr('the substitute keeper goes in goal', 'der Ersatztorwart geht ins Tor'), form: tr('an unlucky afternoon', 'glückloser Auftritt'),
    card: tr('the defender is on a yellow card', 'der Verteidiger ist gelbbelastet'), chase: tr('more attack while trailing', 'mehr Offensive im Rückstand'),
    protect: tr('protecting the lead', 'die Führung soll halten'),
  }[reason];
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Commentary strictly from recorded events: every line names only what the engine logged.
 * Returns null for events that are not worth a line.
 */
export function commentaryFor(e: MatchEvent, ctx: CommentaryContext): string | null {
  const name = (id: number) => ctx.profiles[id].name;
  const team = (t: number) => TEAMS[t as 0 | 1].name;
  switch (e.type) {
    case 'kickoff': return e.half === 1 ? tr(`Kick-off! ${team(e.team)} get us started.`, `Anpfiff! ${team(e.team)} stößt an.`) : tr(`The second half is under way – ${team(e.team)} kick off.`, `Die zweite Halbzeit läuft – Anstoß ${team(e.team)}.`);
    case 'goal': return e.ownGoal
      ? tr(`Own goal! ${e.scorer !== null ? name(e.scorer) : 'A defender'} turns it into his own net – ${team(e.team)} celebrate.`, `Eigentor! ${e.scorer !== null ? name(e.scorer) : 'Ein Verteidiger'} lenkt den Ball ins eigene Netz – ${team(e.team)} jubelt.`)
      : tr(`GOAL for ${team(e.team)}! ${e.scorer !== null ? name(e.scorer) : ''} scores.`, `TOR für ${team(e.team)}! ${e.scorer !== null ? name(e.scorer) : ''} trifft.`);
    case 'swing': return e.action === 'shot' ? tr(`${name(e.player)} shoots!`, `${name(e.player)} zieht ab!`) : null;
    case 'catch': return tr(`${name(e.player)} holds on to it.`, `${name(e.player)} hält den Ball fest.`);
    case 'foul': return `${tr(`Foul by ${name(e.offender)} on ${name(e.victim)}`, `Foul von ${name(e.offender)} an ${name(e.victim)}`)}${e.card === 'yellow' ? tr(' – yellow card', ' – Gelbe Karte') : e.card === 'red' ? tr(' – red card!', ' – Rote Karte!') : ''}${e.penalty ? tr('. Penalty!', '. Elfmeter!') : '.'} (${foulReason(e.reason)})`;
    case 'advantage': return tr('The referee plays advantage.', 'Der Schiedsrichter lässt Vorteil laufen.');
    case 'offside': return tr(`Offside – ${name(e.player)} was too far forward.`, `Abseits – ${name(e.player)} stand zu weit vorne.`);
    case 'out': return tr(`${capital(restartName(e.restart))} to ${team(e.team)}.`, `${restartName(e.restart)} für ${team(e.team)}.`);
    case 'half-time': return tr('Half-time.', 'Halbzeit.');
    case 'full-time': return tr(`Full time! Final score ${ctx.score[0]}:${ctx.score[1]}.`, `Abpfiff! Endstand ${ctx.score[0]}:${ctx.score[1]}.`);
    case 'substitution': return `${tr(`Substitution for ${team(e.team)}: ${name(e.on)} replaces ${name(e.off)}`, `Wechsel bei ${team(e.team)}: ${name(e.on)} kommt für ${name(e.off)}`)}${e.reason ? ` – ${subReason(e.reason)}` : ''}.`;
    case 'decision': return e.chosenBy === 'timeout' ? tr('No call – the players decide for themselves.', 'Keine Vorgabe – die Spieler entscheiden selbst.') : e.chosenBy === 'delegated' ? tr('The coach leaves it to the players.', 'Der Trainer überlässt es den Spielern.') : tr('The call is made – now the players have to carry it out.', 'Die Entscheidung ist gefallen – jetzt müssen die Spieler sie umsetzen.');
    default: return null;
  }
}
