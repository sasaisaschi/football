import './start-screen.css';
import { TEAMS } from '../engine/rosters';
import { lengthLabel } from './match-length';

export type MatchChoice = { halfMinutes: number; condense: boolean; resetMemory: boolean };

/** What each length means for the session (user time measured in the production build, PROJECT_REPORT.md §11). */
const LENGTH_NOTE: Record<5 | 15 | 45, string> = {
  5: 'Zum Ausprobieren: wenige Entscheidungen.',
  15: 'Jede Sekunde der 30 Spielminuten wird simuliert.',
  45: 'Die ganze Partie, jede Sekunde simuliert.',
};

/** Opening card: the fixture, what the user plays, the match length and pacing. Starting it is also the audio gesture. */
export function showStartScreen(host: HTMLElement, defaultHalf: number, memoryMatches: number, onStart: (c: MatchChoice) => void): void {
  const el = document.createElement('div');
  el.className = 'start';
  el.innerHTML = `
    <div class="start-card">
      <div class="start-kicker">Matchday · Flutlicht · Ausverkauft</div>
      <h1>THE 12TH MAN</h1>
      <div class="start-fixture"><span class="home"></span><span class="vs">gegen</span><span class="away"></span></div>
      <ol class="start-steps">
        <li><b>Die Partie läuft selbst.</b><span>22 Spieler, echte Ballphysik, ein unabhängiger Schiedsrichter.</span></li>
        <li><b>Der Orchestrator hält an,</b><span>wenn es eine echte Wahl gibt – im Spiel, vor Einwurf, Ecke, Freistoß oder in der Halbzeit.</span></li>
        <li><b>Du entscheidest, die Spieler setzen um.</b><span>Ob es klappt, entscheiden Füße, Ball und Gegner.</span></li>
      </ol>
      <div class="start-row">
        <div class="start-lengths" role="radiogroup" aria-label="Spieldauer"></div>
        <label class="start-condense"><input type="checkbox" data-condense checked /> Ruhige Phasen verdichten</label>
      </div>
      <div class="start-length-note" data-length-note></div>
      <div class="start-memory" data-memory></div>
      <button class="start-go" data-go type="button">Anpfiff</button>
      <small>Verdichtet heißt: jede Sekunde wird berechnet, ruhiges Spiel aber schneller gezeigt. Ohne Verdichtung läuft alles live.</small>
    </div>`;
  el.querySelector('.home')!.textContent = TEAMS[0].name;
  el.querySelector('.away')!.textContent = TEAMS[1].name;
  let halfMinutes = defaultHalf;
  let resetMemory = false;
  const memory = el.querySelector<HTMLElement>('[data-memory]')!;
  if (memoryMatches > 0) {
    memory.innerHTML = '<span></span><button type="button">Zurücksetzen</button>';
    memory.querySelector('span')!.textContent = `Die Spieler erinnern sich an ${memoryMatches} ${memoryMatches === 1 ? 'Partie' : 'Partien'}: Selbstvertrauen und Vertrauen untereinander.`;
    memory.querySelector('button')!.addEventListener('click', () => { resetMemory = true; memory.textContent = 'Gedächtnis wird beim Anpfiff gelöscht – alle starten frisch.'; });
  } else memory.textContent = 'Erste Partie: Die Spieler beginnen mit ihrem Grundcharakter. Was sie erleben, nehmen sie in die nächste Partie mit.';
  const lengths = el.querySelector('.start-lengths')!;
  const note = el.querySelector<HTMLElement>('[data-length-note]')!;
  for (const [label, minutes] of [['2 × 5 min', 5], ['2 × 15 min', 15], ['2 × 45 min', 45]] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('role', 'radio');
    const select = () => {
      lengths.querySelectorAll('button').forEach(x => { x.classList.remove('selected'); x.setAttribute('aria-checked', 'false'); });
      b.classList.add('selected');
      b.setAttribute('aria-checked', 'true');
      halfMinutes = minutes;
      note.textContent = `${lengthLabel(minutes).long}. ${LENGTH_NOTE[minutes]}`;
    };
    b.addEventListener('click', select);
    lengths.append(b);
    if (minutes === defaultHalf) select();
  }
  el.querySelector<HTMLButtonElement>('[data-go]')!.addEventListener('click', () => {
    const condense = el.querySelector<HTMLInputElement>('[data-condense]')!.checked;
    el.remove();
    onStart({ halfMinutes, condense, resetMemory });
  });
  host.append(el);
}
