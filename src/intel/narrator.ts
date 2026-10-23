import { TEAMS } from '../engine/rosters';
import type { PlayerProfile, TeamId } from '../engine/types';
import { tr } from '../i18n';
import type { Insight, Mode } from './types';

/** Who the words are for: names, and the viewer's own team ("your team"). */
export type NarrationContext = { profiles: readonly PlayerProfile[]; favouriteTeam: TeamId };
export type Narration = { title: string; text: string };

const pct = (v: unknown) => `${v} %`;

/** Stage 4 – render: an insight in words for a fan or an analyst, in the current language. Only the insight's own data is used. */
export function narrate(i: Insight, mode: Mode, ctx: NarrationContext): Narration {
  const d = i.data;
  const name = (id: unknown) => (typeof id === 'number' ? ctx.profiles[id].name : '');
  const team = (t: TeamId | null) => (t === null ? '' : t === ctx.favouriteTeam ? tr('your team', 'dein Team') : TEAMS[t].name);
  const Team = (t: TeamId | null) => (t === null ? '' : t === ctx.favouriteTeam ? tr('Your team', 'Dein Team') : TEAMS[t].name);
  const fan = mode === 'fan';
  switch (i.kind) {
    case 'goal-story': {
      if (d.ownGoal) return { title: tr('Own goal', 'Eigentor'), text: fan ? tr(`Ouch – it goes in off ${name(i.player) || 'a defender'}. ${d.score}.`, `Bitter – ${name(i.player) || 'ein Verteidiger'} lenkt ihn ins eigene Tor. ${d.score}.`) : tr(`Own goal (${d.score}). Last touch by the defending side.`, `Eigentor (${d.score}). Letzte Berührung durch die verteidigende Mannschaft.`) };
      const origin = originWords(String(d.origin), String(d.zone));
      if (fan) {
        const build = Number(d.passes) >= 3 ? tr(`after ${d.passes} passes`, `nach ${d.passes} Pässen`) : Number(d.seconds) <= 2 && d.origin === 'turnover' ? tr('pouncing on a loose ball', 'nach einem Abpraller') : origin;
        const assist = d.assist !== undefined ? tr(`, set up by ${name(d.assist)}`, `, vorbereitet von ${name(d.assist)}`) : '';
        return { title: tr(`GOAL – ${name(i.player)}`, `TOR – ${name(i.player)}`), text: tr(`${name(i.player)} scores ${build}${assist}. ${d.score}.`, `${name(i.player)} trifft ${build}${assist}. ${d.score}.`) };
      }
      const shot = d.xg !== undefined ? tr(`Shot from ${d.distance} m at ${d.kmh} km/h, model xG ${d.xg}.`, `Schuss aus ${d.distance} m mit ${d.kmh} km/h, Modell-xG ${d.xg}.`) : '';
      return {
        title: tr(`Goal ${d.score} – how it happened`, `Tor ${d.score} – wie es entstand`),
        text: (Number(d.seconds) > 0 ? tr(`Move began ${origin}, ${d.passes} completed passes in ${d.seconds} s.`, `Angriff begann ${origin}, ${d.passes} angekommene Pässe in ${d.seconds} s.`) : tr(`Scored ${origin}.`, `Erzielt ${origin}.`)) + ` ${shot}`
          + (d.assist !== undefined ? tr(` Last pass: ${name(d.assist)}.`, ` Letzter Pass: ${name(d.assist)}.`) : ''),
      };
    }
    case 'save': return fan
      ? { title: tr('What a save!', 'Was für eine Parade!'), text: tr(`${name(i.player)} keeps out ${name(d.shooter)}'s ${d.kmh} km/h shot.`, `${name(i.player)} hält den Schuss von ${name(d.shooter)} mit ${d.kmh} km/h.`) }
      : { title: tr(`Save – xG ${d.xg}`, `Parade – xG ${d.xg}`), text: tr(`${name(i.player)} ${d.caught ? 'catches' : 'parries'} a ${d.distance} m shot (${d.kmh} km/h, model xG ${d.xg}) by ${name(d.shooter)}.`, `${name(i.player)} ${d.caught ? 'fängt' : 'wehrt ab'}: Schuss aus ${d.distance} m (${d.kmh} km/h, Modell-xG ${d.xg}) von ${name(d.shooter)}.`) };
    case 'big-chance': return fan
      ? { title: tr('So close!', 'So knapp!'), text: tr(`${name(i.player)} had a great chance from ${d.distance} m – ${d.outcome === 'blocked' ? 'blocked' : 'wide'}.`, `${name(i.player)} hatte die große Chance aus ${d.distance} m – ${d.outcome === 'blocked' ? 'geblockt' : 'daneben'}.`) }
      : { title: tr(`Big chance missed – xG ${d.xg}`, `Großchance vergeben – xG ${d.xg}`), text: tr(`${name(i.player)} from ${d.distance} m (${d.kmh} km/h): ${d.outcome === 'blocked' ? 'blocked by a defender' : 'off target'}.`, `${name(i.player)} aus ${d.distance} m (${d.kmh} km/h): ${d.outcome === 'blocked' ? 'von einem Verteidiger geblockt' : 'am Tor vorbei'}.`) };
    case 'speed': return fan
      ? { title: tr(`${d.kmh} km/h!`, `${d.kmh} km/h!`), text: tr(`The hardest shot of the match so far, by ${name(i.player)}.`, `Der härteste Schuss des Spiels bisher – von ${name(i.player)}.`) }
      : { title: tr(`Fastest shot: ${d.kmh} km/h`, `Härtester Schuss: ${d.kmh} km/h`), text: Number(d.previousKmh) > 0 ? tr(`${name(i.player)} from ${d.distance} m; previous best ${d.previousKmh} km/h (ball speed after the kick).`, `${name(i.player)} aus ${d.distance} m; bisher ${d.previousKmh} km/h (Ballgeschwindigkeit nach dem Schuss).`) : tr(`${name(i.player)} from ${d.distance} m – the first shot over 90 km/h (ball speed after the kick).`, `${name(i.player)} aus ${d.distance} m – der erste Schuss über 90 km/h (Ballgeschwindigkeit nach dem Schuss).`) };
    case 'momentum': return fan
      ? { title: tr(`${Team(i.team)} on top`, `${Team(i.team)} drückt`), text: tr(`${Team(i.team)} have been playing in the opponents' half most of the last ${Math.round(Number(d.minutes))} minutes.`, `${Team(i.team)} spielt seit ${Math.round(Number(d.minutes))} Minuten fast nur in der gegnerischen Hälfte.`) }
      : { title: tr(`Territory shift: ${team(i.team)} ${pct(d.share)}`, `Feldverschiebung: ${team(i.team)} ${pct(d.share)}`), text: tr(`${pct(d.share)} of attacking time in the last ${d.minutes} min; shots ${d.shots}:${d.otherShots}, xG ${d.xg}.`, `${pct(d.share)} der Angriffszeit in den letzten ${d.minutes} min; Schüsse ${d.shots}:${d.otherShots}, xG ${d.xg}.`) };
    case 'pressing': return fan
      ? { title: tr('The press is working', 'Das Pressing greift'), text: tr(`${Team(i.team)} keep winning the ball back in the opponents' half – ${d.wins} times in ${Math.round(Number(d.minutes))} minutes.`, `${Team(i.team)} erobert den Ball immer wieder in der gegnerischen Hälfte – ${d.wins}-mal in ${Math.round(Number(d.minutes))} Minuten.`) }
      : { title: tr(`High press: ${pct(d.rate)} success`, `Hohes Pressing: ${pct(d.rate)} Erfolg`), text: tr(`${team(i.team)}: ${d.wins} of ${d.presses} pressures in the opponents' half won the ball within 3 s (other side ${pct(d.otherRate)}; last ${d.minutes} min; pressure = defender within 2 m of the carrier).`, `${team(i.team)}: ${d.wins} von ${d.presses} Druckaktionen in der gegnerischen Hälfte gewannen den Ball binnen 3 s (Gegner ${pct(d.otherRate)}; letzte ${d.minutes} min; Druck = Verteidiger höchstens 2 m am Ballführer).`) };
    case 'danger': return fan
      ? { title: tr('Pressure on goal', 'Es brennt vor dem Tor'), text: tr(`${Team(i.team)} ${d.shots} shots in ${Math.round(Number(d.minutes))} minutes – a goal is in the air.`, `${Team(i.team)}: ${d.shots} Schüsse in ${Math.round(Number(d.minutes))} Minuten – ein Tor liegt in der Luft.`) }
      : { title: tr(`Threat: ${d.shots} shots, xG ${d.xg}`, `Gefahr: ${d.shots} Schüsse, xG ${d.xg}`), text: tr(`${team(i.team)} in the last ${d.minutes} min (model xG).`, `${team(i.team)} in den letzten ${d.minutes} min (Modell-xG).`) };
    case 'control': return fan
      ? { title: tr('Keep-ball', 'Ballstafette'), text: tr(`${Team(i.team)} string ${d.passes} passes together – the opponents can only chase.`, `${Team(i.team)} spielt ${d.passes} Pässe in Folge – der Gegner läuft nur hinterher.`) }
      : { title: tr(`Control: ${d.passes}-pass move`, `Kontrolle: ${d.passes} Pässe in Folge`), text: tr(`${team(i.team)} kept the ball for ${d.seconds} s (move began ${originWords(String(d.origin), 'none')}).`, `${team(i.team)} hielt den Ball ${d.seconds} s (Angriff begann ${originWords(String(d.origin), 'none')}).`) };
    case 'chaos': return fan
      ? { title: tr('End-to-end!', 'Hin und her!'), text: tr('Nobody can keep the ball right now – it is changing hands constantly.', 'Gerade kann niemand den Ball halten – er wechselt ständig die Seiten.') }
      : { title: tr(`Chaos: ${d.changes} turnovers/min`, `Chaos: ${d.changes} Ballwechsel/min`), text: tr(`Possession changed ${d.changes} times in the last minute (match average ${d.average}/min).`, `Ballbesitz wechselte ${d.changes}-mal in der letzten Minute (Schnitt ${d.average}/min).`) };
    case 'decision': return decisionWords(i, fan, name);
    case 'half-summary': case 'full-summary': {
      const half = i.kind === 'half-summary';
      const head = half ? tr(`Half-time ${d.score}`, `Halbzeit ${d.score}`) : tr(`Full time ${d.score}`, `Abpfiff ${d.score}`);
      if (fan) {
        const leader = Number(d.possession0) >= Number(d.possession1) ? 0 : 1;
        return { title: head, text: tr(`${TEAMS[leader].name} had more of the ball (${pct(d[`possession${leader}`])}); shots ${d.shots0}:${d.shots1}.`, `${TEAMS[leader].name} hatte mehr vom Ball (${pct(d[`possession${leader}`])}); Schüsse ${d.shots0}:${d.shots1}.`) };
      }
      return { title: head, text: tr(`Possession ${d.possession0}:${d.possession1} %, shots ${d.shots0}:${d.shots1}, xG ${d.xg0}:${d.xg1}, pass accuracy ${d.passAcc0}:${d.passAcc1} %, pressures won ${d.pressureWins0}:${d.pressureWins1}.`, `Ballbesitz ${d.possession0}:${d.possession1} %, Schüsse ${d.shots0}:${d.shots1}, xG ${d.xg0}:${d.xg1}, Passquote ${d.passAcc0}:${d.passAcc1} %, gewonnene Druckaktionen ${d.pressureWins0}:${d.pressureWins1}.`) };
    }
  }
}

/** `zone` is where the other side lost the ball, seen from their goal: their own third is high up for the team that won it. */
function originWords(origin: string, zone: string): string {
  if (origin === 'turnover') return zone === 'own-third' ? tr('from a ball won high up the pitch', 'aus einem Ballgewinn weit vorn') : zone === 'middle' ? tr('from a ball won in midfield', 'aus einem Ballgewinn im Mittelfeld') : tr('from a ball won deep in their own half', 'aus einem Ballgewinn tief in der eigenen Hälfte');
  const r: Record<string, string> = { corner: tr('from a corner', 'nach einer Ecke'), 'free-kick': tr('from a free kick', 'nach einem Freistoß'), 'throw-in': tr('from a throw-in', 'nach einem Einwurf'), penalty: tr('from the penalty spot', 'vom Elfmeterpunkt'), 'goal-kick': tr('from a goal kick', 'nach einem Abstoß'), kickoff: tr('from the kick-off', 'nach dem Anstoß') };
  return r[origin] ?? tr('in open play', 'im offenen Spiel');
}

function decisionWords(i: Insight, fan: boolean, name: (id: unknown) => string): Narration {
  const d = i.data;
  const outcome: Record<string, [string, string]> = {
    goal: ['and it ended in a goal!', 'und es fiel ein Tor!'], conceded: ['but the opponents scored.', 'aber der Gegner traf.'],
    'pass-arrived': ['the pass arrived.', 'der Pass kam an.'], lost: ['the ball was lost.', 'der Ball ging verloren.'],
    'won-back': ['the ball was won back.', 'der Ball wurde zurückerobert.'], foul: ['it ended in a foul.', 'es endete mit einem Foul.'],
    'out-ours': ['the ball went out – our restart.', 'Ball im Aus – Spielfortsetzung für uns.'], 'out-theirs': ['the ball went out – their restart.', 'Ball im Aus – Spielfortsetzung für den Gegner.'],
    'shot-saved': ['it led to a shot – saved.', 'es gab einen Schuss – gehalten.'], 'shot-blocked': ['it led to a shot – blocked.', 'es gab einen Schuss – geblockt.'],
    'shot-off-target': ['it led to a shot – wide.', 'es gab einen Schuss – daneben.'], 'shot-goal': ['it led to a goal!', 'es führte zum Tor!'], 'shot-deflected': ['it led to a shot – deflected.', 'es gab einen Schuss – abgefälscht.'],
    instruction: ['the instruction now shapes the team.', 'die Vorgabe prägt jetzt die Mannschaft.'], substitution: ['the substitute is on.', 'der Einwechselspieler ist auf dem Platz.'],
    'no-change': ['the team stays as it is.', 'die Mannschaft bleibt, wie sie ist.'], 'no-clear-result': ['no clear result followed.', 'es folgte kein klares Ergebnis.'],
  };
  const [en, de] = outcome[String(d.outcome)] ?? ['–', '–'];
  const who = d.by === 'user' ? tr('You chose', 'Du hast gewählt') : d.by === 'delegated' ? tr('Left to the players', 'Den Spielern überlassen') : tr('Time ran out', 'Zeit abgelaufen');
  if (fan) return { title: tr('Your call', 'Deine Entscheidung'), text: `${who}: ${d.choice} – ${tr(en, de)}` };
  const est = d.estimate !== undefined ? tr(` Players' estimate beforehand: ${d.estimate} %.`, ` Einschätzung der Spieler vorher: ${d.estimate} %.`) : '';
  return { title: `${d.title}`, text: `${who}: ${d.choice}. ${tr('Outcome after', 'Ergebnis nach')} ${d.seconds} s: ${tr(en, de)}${est}${i.player !== null ? ` (${name(i.player)})` : ''}` };
}
