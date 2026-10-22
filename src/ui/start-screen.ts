import './start-screen.css';
import { createRoster, TEAMS } from '../engine/rosters';
import type { TeamId } from '../engine/types';
import { lang, LANG_STORAGE_KEY, tr, type Lang } from '../i18n';
import type { Mode } from '../intel/types';
import { lengthLabel } from './match-length';

/** What the viewer chose: length and pacing, and how the match is made theirs (club, intelligence mode, focus player). */
export type MatchChoice = { halfMinutes: number; condense: boolean; resetMemory: boolean; userTeam: TeamId; mode: Mode; focusPlayer: number | null };
/** The choices that are remembered for the next visit (not the length, which the URL may preset). */
export type StoredChoice = Pick<MatchChoice, 'userTeam' | 'mode' | 'focusPlayer'>;

/** What each length means for the session (user time measured in the production build, PROJECT_REPORT.md §11). */
const LENGTH_NOTE = (minutes: 5 | 15 | 45) => ({
  5: tr('A quick try, about 4 minutes.', 'Zum Ausprobieren, etwa 4 Minuten.'),
  15: tr('Every second of the 30 match minutes is simulated, about 7 minutes.', 'Jede Sekunde der 30 Spielminuten wird simuliert, etwa 7 Minuten.'),
  45: tr('The whole match, every second simulated, about 15 minutes.', 'Die ganze Partie, jede Sekunde simuliert, etwa 15 Minuten.'),
})[minutes];

/** A row of mutually exclusive buttons; `pick` is called with the chosen value (also for the initial one). */
function choices<T>(host: Element, items: readonly (readonly [string, T])[], initial: T, pick: (v: T) => void): void {
  for (const [label, value] of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('role', 'radio');
    const select = () => {
      host.querySelectorAll('button').forEach(x => { x.classList.remove('selected'); x.setAttribute('aria-checked', 'false'); });
      b.classList.add('selected');
      b.setAttribute('aria-checked', 'true');
      pick(value);
    };
    b.addEventListener('click', select);
    host.append(b);
    if (value === initial) select();
  }
}

/** Opening card: the fixture, what the user plays, how the match is made theirs, length and pacing. Starting it is also the audio gesture. */
export function showStartScreen(host: HTMLElement, defaultHalf: number, memoryMatches: number, stored: StoredChoice, onStart: (c: MatchChoice) => void): void {
  const el = document.createElement('div');
  el.className = 'start';
  el.innerHTML = `
    <div class="start-card">
      <div class="start-top"><div class="start-kicker">${tr('Matchday · Floodlights · Sold out', 'Matchday · Flutlicht · Ausverkauft')}</div><div class="start-lang" role="radiogroup" aria-label="Language"></div></div>
      <h1>THE 12TH MAN</h1>
      <div class="start-fixture"><span class="home"></span><span class="vs">${tr('vs', 'gegen')}</span><span class="away"></span></div>
      <ol class="start-steps">
        <li><b>${tr('The match plays itself.', 'Die Partie läuft selbst.')}</b><span>${tr('22 autonomous players, real ball physics, an independent referee – all synthetic.', '22 eigenständige Spieler, echte Ballphysik, ein unabhängiger Schiedsrichter – alles synthetisch.')}</span></li>
        <li><b>${tr('The orchestrator stops at real choices,', 'Der Orchestrator hält an,')}</b><span>${tr('in open play, before a throw-in, corner, free kick or penalty, at half-time.', 'wenn es eine echte Wahl gibt – im Spiel, vor Einwurf, Ecke, Freistoß oder in der Halbzeit.')}</span></li>
        <li><b>${tr('You decide, the players carry it out.', 'Du entscheidest, die Spieler setzen um.')}</b><span>${tr('Feet, ball and opponents decide whether it works. Match intelligence explains every moment.', 'Ob es klappt, entscheiden Füße, Ball und Gegner. Die Match Intelligence erklärt jeden Moment.')}</span></li>
      </ol>
      <div class="start-grid">
        <span>${tr('Your club', 'Dein Verein')}</span><div class="start-lengths" data-club role="radiogroup"></div>
        <span>${tr('Intelligence', 'Intelligence')}</span><div class="start-lengths" data-mode role="radiogroup"></div>
        <span>${tr('Focus player', 'Fokusspieler')}</span><select class="start-select" data-focus></select>
        <span>${tr('Length', 'Spieldauer')}</span><div class="start-lengths" data-length role="radiogroup"></div>
      </div>
      <div class="start-length-note" data-length-note></div>
      <label class="start-condense"><input type="checkbox" data-condense checked /> ${tr('Condense quiet phases', 'Ruhige Phasen verdichten')}</label>
      <div class="start-memory" data-memory></div>
      <button class="start-go" data-go type="button">${tr('Kick-off', 'Anpfiff')}</button>
      <small>${tr('Condensed means: every second is computed, quiet play is only shown faster. Keys: 1–4 choose · 0 leave it to the players · I fan/analyst.', 'Verdichtet heißt: jede Sekunde wird berechnet, ruhiges Spiel aber schneller gezeigt. Tasten: 1–4 wählen · 0 den Spielern überlassen · I Fan/Analyst.')}</small>
    </div>`;
  el.querySelector('.home')!.textContent = TEAMS[0].name;
  el.querySelector('.away')!.textContent = TEAMS[1].name;
  const choice: MatchChoice = { halfMinutes: defaultHalf, condense: true, resetMemory: false, userTeam: stored.userTeam, mode: stored.mode, focusPlayer: stored.focusPlayer };

  choices(el.querySelector('.start-lang')!, [['EN', 'en'], ['DE', 'de']] as const, lang(), (l: Lang) => {
    if (l === lang()) return;
    try { localStorage.setItem(LANG_STORAGE_KEY, l); } catch { /* the URL carries it anyway */ }
    const url = new URL(location.href);
    url.searchParams.set('lang', l);
    location.assign(url.toString());
  });
  const roster = createRoster(7).filter(p => p.squad === 'starter');
  const focus = el.querySelector<HTMLSelectElement>('[data-focus]')!;
  const fillFocus = (team: TeamId) => {
    focus.replaceChildren(new Option(tr('none', 'keiner'), ''), ...roster.filter(p => p.team === team).map(p => new Option(`${p.number} · ${p.name} (${p.role})`, String(p.id))));
    const keep = choice.focusPlayer !== null && roster.find(p => p.id === choice.focusPlayer)?.team === team;
    focus.value = keep ? String(choice.focusPlayer) : '';
    if (!keep) choice.focusPlayer = null;
  };
  focus.addEventListener('change', () => { choice.focusPlayer = focus.value === '' ? null : Number(focus.value); });
  choices(el.querySelector('[data-club]')!, [[TEAMS[0].name, 0], [TEAMS[1].name, 1]] as const, stored.userTeam, (t: TeamId) => { choice.userTeam = t; fillFocus(t); });
  choices(el.querySelector('[data-mode]')!, [[tr('Fan', 'Fan'), 'fan'], [tr('Analyst', 'Analyst'), 'analyst']] as const, stored.mode, (m: Mode) => { choice.mode = m; });
  const note = el.querySelector<HTMLElement>('[data-length-note]')!;
  choices(el.querySelector('[data-length]')!, [['2 × 5 min', 5], ['2 × 15 min', 15], ['2 × 45 min', 45]] as const, defaultHalf as 5 | 15 | 45, (minutes: 5 | 15 | 45) => {
    choice.halfMinutes = minutes;
    note.textContent = `${lengthLabel(minutes).long}. ${LENGTH_NOTE(minutes)}`;
  });

  const memory = el.querySelector<HTMLElement>('[data-memory]')!;
  if (memoryMatches > 0) {
    memory.innerHTML = `<span></span><button type="button">${tr('Reset', 'Zurücksetzen')}</button>`;
    memory.querySelector('span')!.textContent = tr(`The players remember ${memoryMatches} ${memoryMatches === 1 ? 'match' : 'matches'}: confidence and trust in each other.`, `Die Spieler erinnern sich an ${memoryMatches} ${memoryMatches === 1 ? 'Partie' : 'Partien'}: Selbstvertrauen und Vertrauen untereinander.`);
    memory.querySelector('button')!.addEventListener('click', () => { choice.resetMemory = true; memory.textContent = tr('Memory is cleared at kick-off – everyone starts fresh.', 'Gedächtnis wird beim Anpfiff gelöscht – alle starten frisch.'); });
  } else memory.textContent = tr('First match: the players start from their character. What they experience, they take into the next match.', 'Erste Partie: Die Spieler beginnen mit ihrem Grundcharakter. Was sie erleben, nehmen sie in die nächste Partie mit.');

  el.querySelector<HTMLButtonElement>('[data-go]')!.addEventListener('click', () => {
    choice.condense = el.querySelector<HTMLInputElement>('[data-condense]')!.checked;
    el.remove();
    onStart(choice);
  });
  host.append(el);
}
