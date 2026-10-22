import { cornerDefence, freeKickWall, WALL_RANGE } from '../ai/set-piece-defence';
import type { MatchEngine } from '../engine/match-engine';
import type { DecisionOption, OptionVisual, SetPiecePlan, TeamId, Vec2 } from '../engine/types';
import { PITCH } from '../physics/pitch-geometry';
import { dist, participantsFor, playerName, type MomentDraft } from './common';

const plan = (team: TeamId, p: SetPiecePlan): DecisionOption['effect'] => ({ type: 'set-piece', team, plan: p });
const runs = (spots: Map<number, Vec2>): OptionVisual['runs'] => [...spots].map(([player, to]) => ({ player, to }));

/**
 * Penalty against the user team: the keeper's reaction. Waiting reads the ball (his usual reaction time); an early dive
 * goes at the strike, to the chosen side, whatever the shooter does. Nothing decides the save but hands and ball.
 */
export function penaltySaveMoment(e: MatchEngine, team: TeamId): MomentDraft | null {
  const r = e.restart;
  if (!r || r.kind !== 'penalty' || r.team === team) return null;
  const keeper = e.profiles.find(p => p.team === team && p.role === 'GK' && !e.referee.sentOff.has(p.id));
  if (!keeper) return null;
  const sign = e.sign(team);
  const lineX = -sign * PITCH.halfLength;
  const guess = (side: -1 | 0 | 1): DecisionOption['effect'] => ({ type: 'player', player: keeper.id, intent: { type: 'move', action: { kind: 'guess', side }, source: 'user', decidedAt: e.time, until: e.time + 15 } });
  // He faces the pitch: his right is +Z when that is +X.
  const corner = (side: -1 | 1): Vec2 => ({ x: lineX, z: side * sign * (PITCH.goalHalfWidth - 0.9) });
  const options: DecisionOption[] = [
    { id: 'gk-wait', label: 'Abwarten und reagieren', detail: `${playerName(e, keeper.id)} bleibt stehen, bis er den Ball sieht`, effect: guess(0), outlook: 'hält gut platzierte Schüsse selten, Schüsse in die Mitte oft', visual: { actor: keeper.id, zone: { x: lineX, z: 0, r: 1.2 } } },
    { id: 'gk-left', label: 'Früh nach links springen', detail: 'Sprung mit dem Schuss in seine linke Ecke', effect: guess(-1), outlook: 'richtig geraten: deutlich bessere Chance – sonst ist die andere Ecke frei', visual: { actor: keeper.id, runs: [{ player: keeper.id, to: corner(-1) }], zone: { ...corner(-1), r: 1 } } },
    { id: 'gk-right', label: 'Früh nach rechts springen', detail: 'Sprung mit dem Schuss in seine rechte Ecke', effect: guess(1), outlook: 'richtig geraten: deutlich bessere Chance – sonst ist die andere Ecke frei', visual: { actor: keeper.id, runs: [{ player: keeper.id, to: corner(1) }], zone: { ...corner(1), r: 1 } } },
  ];
  return {
    kind: 'penalty-save', category: 'set-piece', title: 'Elfmeter gegen uns – wie reagiert der Torwart?', situation: `${playerName(e, r.taker)} tritt an, ${playerName(e, keeper.id)} steht auf der Linie.`,
    focusPlayer: keeper.id, options, defaultOptionId: 'gk-wait', participants: participantsFor(e, team, keeper.id, options, [r.taker]),
  };
}

/** Direct free kick against the user team within range: how many in the wall, or none (players in the box instead). */
export function freeKickWallMoment(e: MatchEngine, team: TeamId): MomentDraft | null {
  const r = e.restart;
  if (!r || r.kind !== 'free-kick' || r.team === team || !r.direct) return null;
  const goalX = -e.sign(team) * PITCH.halfLength;
  const range = dist(r.spot, { x: goalX, z: 0 });
  if (range > WALL_RANGE) return null;
  const truth = e.truth();
  const wall = (size: 0 | 2 | 3 | 4) => freeKickWall(e.profiles, truth, team, r.spot, goalX, true, { kind: 'wall', size });
  const option = (id: string, label: string, size: 0 | 2 | 3 | 4, outlook: string): DecisionOption => {
    const spots = wall(size);
    const keeper = e.profiles.find(p => p.team === team && p.role === 'GK' && !e.referee.sentOff.has(p.id));
    return {
      id, label, detail: size ? `${size} Spieler 9,15 m vor dem Ball, Linie zum kurzen Pfosten` : 'alle Feldspieler sichern den Strafraum', outlook,
      effect: plan(team, { kind: 'wall', size }),
      visual: { actor: keeper?.id ?? [...spots.keys()][0] ?? r.taker, runs: runs(spots) },
    };
  };
  const options: DecisionOption[] = [
    option('wall-3', 'Mauer mit drei', 3, 'übliche Mauer: kurze Ecke zu, Torwart deckt die lange'),
    option('wall-4', 'Mauer mit vier', 4, 'direkter Schuss schwerer – ein Spieler weniger gegen den Pass in den Strafraum'),
    option('wall-2', 'Mauer mit zwei', 2, 'mehr Spieler gegen den Pass – der Torwart sieht den Schuss früher, das Tor ist offener'),
    option('wall-0', 'Keine Mauer', 0, 'freie Schussbahn – der Torwart sieht alles, der Raum ist besetzt'),
  ];
  return {
    kind: 'free-kick-wall', category: 'set-piece', title: 'Freistoß gegen uns – die Mauer?', situation: `${playerName(e, r.taker)} am Ball, ${Math.round(range)} m vor unserem Tor.`,
    focusPlayer: [...wall(3).keys()][0] ?? r.taker, options, defaultOptionId: 'wall-3', participants: participantsFor(e, team, r.taker, options, [r.taker]),
  };
}

/** Corner against the user team: the marking scheme. The default is the players' usual marking from their positions. */
export function cornerDefenceMoment(e: MatchEngine, team: TeamId): MomentDraft | null {
  const r = e.restart;
  if (!r || r.kind !== 'corner' || r.team === team) return null;
  const goalX = -e.sign(team) * PITCH.halfLength;
  const truth = e.truth();
  const scheme = (s: 'man' | 'zone' | 'counter') => cornerDefence(e.profiles, truth, team, r.spot, goalX, s);
  const keeper = e.profiles.find(p => p.team === team && p.role === 'GK' && !e.referee.sentOff.has(p.id));
  const actor = keeper?.id ?? r.taker;
  const options: DecisionOption[] = [
    { id: 'cd-standard', label: 'Wie gewohnt', detail: 'jeder aus seiner Position, Gegenspieler in der Nähe übernehmen', effect: { type: 'none' }, outlook: 'die Spieler machen, was sie immer tun', visual: { actor } },
    { id: 'cd-man', label: 'Manndeckung', detail: 'jeder Angreifer im Strafraum bekommt einen Gegenspieler', effect: plan(team, { kind: 'corner-defence', scheme: 'man' }), outlook: 'kein Angreifer frei – Lücken, wenn einer seinen Mann verliert', visual: { actor, runs: runs(scheme('man')) } },
    { id: 'cd-zone', label: 'Raumdeckung', detail: 'beide Pfosten, Fünfmeterlinie, Elfmeterpunkt, Strafraumkante', effect: plan(team, { kind: 'corner-defence', scheme: 'zone' }), outlook: 'die gefährlichen Zonen sind besetzt – Anläufe in die Lücken sind schwer zu stoppen', visual: { actor, runs: runs(scheme('zone')) } },
    { id: 'cd-counter', label: 'Raum + zwei vorne', detail: 'Raumdeckung, die beiden vordersten Stürmer warten an der Mittellinie', effect: plan(team, { kind: 'corner-defence', scheme: 'counter' }), outlook: 'Konterchance nach einer Klärung – zwei Verteidiger weniger im Strafraum', visual: { actor, runs: runs(scheme('counter')) } },
  ];
  return {
    kind: 'corner-defence', category: 'set-piece', title: 'Ecke gegen uns – wie verteidigen?', situation: `${playerName(e, r.taker)} tritt die Ecke.`,
    focusPlayer: actor, options, defaultOptionId: 'cd-standard', participants: participantsFor(e, team, actor, options, [r.taker]),
  };
}
