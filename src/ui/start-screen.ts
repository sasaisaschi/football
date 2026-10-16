import './start-screen.css';
import { TEAMS } from '../engine/rosters';

export type MatchChoice = { halfMinutes: number };

/** Opening card: the fixture, the user's role and the match length. Starting it is also the audio gesture. */
export function showStartScreen(host: HTMLElement, defaultHalf: number, onStart: (c: MatchChoice) => void): void {
  const el = document.createElement('div');
  el.className = 'start';
  const card = document.createElement('div');
  card.className = 'start-card';
  card.innerHTML = `
    <div class="start-kicker">MATCHDAY &middot; FLUTLICHT &middot; AUSVERKAUFT</div>
    <h1>THE 12TH MAN</h1>
    <div class="start-fixture"><span class="home"></span><span class="vs">vs</span><span class="away"></span></div>
    <p data-intro></p>
    <div class="start-lengths" role="radiogroup" aria-label="Spieldauer"></div>
    <button class="start-go" data-go>Anpfiff</button>
    <small>Gespielt wird in Echtzeit; ruhige Phasen im Mittelfeld laufen im Zeitraffer.</small>`;
  card.querySelector('.home')!.textContent = TEAMS[0].name;
  card.querySelector('.away')!.textContent = TEAMS[1].name;
  card.querySelector('[data-intro]')!.textContent = `Die Mannschaften spielen selbst. Wenn es darauf ankommt, entscheidest du für ${TEAMS[0].name}. Ob es klappt, entscheiden Füße, Ball und Schiedsrichter.`;
  let halfMinutes = defaultHalf;
  const lengths = card.querySelector('.start-lengths')!;
  for (const [label, minutes] of [['Kurz · 2 × 5 min', 5], ['Mittel · 2 × 15 min', 15], ['Voll · 2 × 45 min', 45]] as const) {
    const b = document.createElement('button');
    b.textContent = label;
    b.setAttribute('role', 'radio');
    const select = () => {
      lengths.querySelectorAll('button').forEach(x => { x.classList.remove('selected'); x.setAttribute('aria-checked', 'false'); });
      b.classList.add('selected');
      b.setAttribute('aria-checked', 'true');
      halfMinutes = minutes;
    };
    b.addEventListener('click', select);
    lengths.append(b);
    if (minutes === defaultHalf) select();
  }
  card.querySelector<HTMLButtonElement>('[data-go]')!.addEventListener('click', () => {
    el.remove();
    onStart({ halfMinutes });
  });
  el.append(card);
  host.append(el);
}
