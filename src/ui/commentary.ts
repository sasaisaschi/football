import type { MatchEngine } from '../engine/match-engine';
import type { MatchEvent } from '../engine/types';

const RESTART: Record<string, string> = {
  'throw-in': 'Einwurf', corner: 'Ecke', 'goal-kick': 'Abstoß', 'free-kick': 'Freistoß', penalty: 'Elfmeter', kickoff: 'Anstoß', 'drop-ball': 'Schiedsrichterball',
};

/**
 * Commentary strictly from recorded events: every line names only what the engine logged.
 * Returns null for events that are not worth a line.
 */
export function commentaryFor(e: MatchEvent, engine: MatchEngine): string | null {
  const name = (id: number) => engine.profiles[id].name;
  const team = (t: number) => engine.teamName(t as 0 | 1);
  switch (e.type) {
    case 'kickoff': return e.half === 1 ? `Anpfiff! ${team(e.team)} stößt an.` : `Die zweite Halbzeit läuft – Anstoß ${team(e.team)}.`;
    case 'goal': return e.ownGoal ? `Eigentor! ${e.scorer !== null ? name(e.scorer) : 'Ein Verteidiger'} lenkt den Ball ins eigene Netz – ${team(e.team)} jubelt.` : `TOR für ${team(e.team)}! ${e.scorer !== null ? name(e.scorer) : ''} trifft.`;
    case 'swing': return e.action === 'shot' ? `${name(e.player)} zieht ab!` : null;
    case 'catch': return `${name(e.player)} hält den Ball fest.`;
    case 'foul': return `Foul von ${name(e.offender)} an ${name(e.victim)}${e.card === 'yellow' ? ' – Gelbe Karte' : e.card === 'red' ? ' – Rote Karte!' : ''}${e.penalty ? '. Elfmeter!' : '.'} (${e.reason})`;
    case 'advantage': return `Der Schiedsrichter lässt Vorteil laufen.`;
    case 'offside': return `Abseits – ${name(e.player)} stand zu weit vorne.`;
    case 'out': return `${RESTART[e.restart]} für ${team(e.team)}.`;
    case 'half-time': return 'Halbzeit.';
    case 'full-time': return `Abpfiff! Endstand ${engine.score[0]}:${engine.score[1]}.`;
    case 'decision': return e.chosenBy === 'timeout' ? 'Keine Vorgabe – die Spieler entscheiden selbst.' : 'Die Entscheidung ist gefallen – jetzt müssen die Spieler sie umsetzen.';
    default: return null;
  }
}
