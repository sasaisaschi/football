import './controls.css';
import './prep-screen.css';
import { applyLineup, createRoster, TEAMS, type LineupSwap } from '../engine/rosters';
import type { PlayerProfile, TeamId, TeamInstruction } from '../engine/types';
import { lang, LANG_STORAGE_KEY, tr, type Lang } from '../i18n';
import type { Mode } from '../intel/types';
import { HALF_MINUTES } from '../session/pacing';
import { choices, playerRow } from './controls';

/** Everything the coach prepares before kick-off. */
export type MatchChoice = {
  halfMinutes: number; resetMemory: boolean; userTeam: TeamId; mode: Mode; focusPlayer: number | null;
  /** Tactics from kick-off, for the user's team (the existing TeamInstruction the agents read). */
  instruction: TeamInstruction;
  /** Team sheet: bench players who start instead of a starter. */
  lineup: LineupSwap[];
};
/** Remembered for the next visit (the length comes from the URL or the default). */
export type StoredChoice = Pick<MatchChoice, 'userTeam' | 'mode' | 'focusPlayer' | 'instruction'>;

/** What each setting does to the players, in the terms the agents actually use (ai/off-ball.ts, ai/shape.ts, ai/brain.ts). */
const PRESS_NOTE = (p: TeamInstruction['press']) => ({
  high: tr('A midfielder steps in to close the passing lane when the ball is within 16 m.', 'Ein Mittelfeldspieler stellt den Passweg zu, sobald der Ball 16 m nah ist.'),
  mid: tr('A midfielder closes the lane only when the ball is within 10 m.', 'Ein Mittelfeldspieler stellt erst bei 10 m Ballnähe zu.'),
  low: tr('Nobody presses as a second man; the team holds its zones.', 'Niemand presst als zweiter Mann; die Mannschaft hält ihre Zonen.'),
})[p];
const lineNote = (h: number) => {
  const m = Math.round(Math.abs(h) * 0.16 * 52.5);
  return h === 0 ? tr('The back four hold their normal height.', 'Die Viererkette steht auf normaler Höhe.')
    : h > 0 ? tr(`The back four push up about ${m} m – space behind them.`, `Die Viererkette rückt etwa ${m} m auf – Raum dahinter.`)
      : tr(`The back four drop about ${m} m – deeper, harder to get behind.`, `Die Viererkette lässt sich etwa ${m} m fallen – tiefer, schwerer zu überlaufen.`);
};
const riskNote = (r: number) => r >= 0.65 ? tr('Forwards stay high, the shape stretches, players lean towards forward passes and shots.', 'Stürmer bleiben hoch, die Formation zieht sich auseinander, Spieler neigen zu Pässen nach vorn und Abschlüssen.')
  : r <= 0.35 ? tr('Compact in possession, players lean towards the safe pass.', 'Kompakt in Ballbesitz, Spieler neigen zum sicheren Pass.')
    : tr('Balanced: neither extra caution nor extra risk.', 'Ausgewogen: weder zusätzliche Vorsicht noch zusätzliches Risiko.');

/**
 * Match preparation: club, team sheet (starting eleven and bench with positions, ratings and character), tactics,
 * intelligence mode, focus player and length. Every control acts on the match: the sheet goes through
 * `applyLineup` (the same rules as in the engine), the tactics are the TeamInstruction the players read from kick-off.
 */
export function showPrepScreen(host: HTMLElement, memoryMatches: number, stored: StoredChoice, onStart: (c: MatchChoice) => void): void {
  const el = document.createElement('div');
  el.className = 'prep';
  el.innerHTML = `
    <header class="prep-head">
      <div><div class="prep-kicker">${tr('Matchday · Manager', 'Spieltag · Manager')}</div><h1>THE 12TH MAN</h1></div>
      <div class="prep-fixture"><span class="home"></span><span class="vs">${tr('vs', 'gegen')}</span><span class="away"></span></div>
      <div class="mgr-seg prep-lang" role="radiogroup" aria-label="Language"></div>
    </header>
    <div class="prep-grid">
      <section class="mgr-card prep-match">
        <h2>${tr('Match', 'Partie')}</h2>
        <label>${tr('Your club', 'Dein Verein')}</label><div class="mgr-seg" data-club role="radiogroup"></div>
        <p class="mgr-note">${tr('Full match · 2 × 45 min, each half in 7 minutes. The match stands still while you decide.', 'Volle Spielzeit · 2 × 45 min, jede Halbzeit in 7 Minuten. Während deiner Entscheidungen steht das Spiel still.')}</p>
        <label>${tr('Match intelligence', 'Match Intelligence')}</label><div class="mgr-seg" data-mode role="radiogroup"></div>
        <label>${tr('Focus player', 'Fokusspieler')}</label><select class="mgr-select" data-focus></select>
        <p class="mgr-note" data-memory></p>
      </section>
      <section class="mgr-card prep-squad">
        <h2>${tr('Team sheet', 'Aufstellung')} <small data-formation>4-3-3</small></h2>
        <p class="mgr-note">${tr('Click a starter, then a bench player to swap them (keepers only for keepers). The substitute takes over the position.', 'Klicke einen Spieler der Startelf, dann einen Ersatzspieler, um sie zu tauschen (Torwart nur gegen Torwart). Der Ersatzspieler übernimmt die Position.')}</p>
        <div class="prep-xi" data-xi></div>
        <h3>${tr('Bench', 'Ersatzbank')}</h3>
        <div class="prep-bench" data-bench></div>
        <button type="button" class="mgr-link" data-reset-sheet hidden>${tr('Reset team sheet', 'Aufstellung zurücksetzen')}</button>
      </section>
      <section class="mgr-card prep-tactics">
        <h2>${tr('Tactics', 'Taktik')}</h2>
        <label>${tr('Pressing', 'Pressing')}</label><div class="mgr-seg" data-press role="radiogroup"></div>
        <p class="mgr-note" data-press-note></p>
        <label for="prep-line">${tr('Defensive line', 'Abwehrlinie')} <output data-line-out></output></label>
        <input id="prep-line" type="range" min="-1" max="1" step="0.1" data-line />
        <p class="mgr-note" data-line-note></p>
        <label for="prep-risk">${tr('Risk in possession', 'Risiko in Ballbesitz')} <output data-risk-out></output></label>
        <input id="prep-risk" type="range" min="0" max="1" step="0.05" data-risk />
        <p class="mgr-note" data-risk-note></p>
        <p class="mgr-note prep-honest">${tr('Instructions shape what the players choose; feet, ball, opponents and the referee decide what happens.', 'Vorgaben prägen, was die Spieler wählen; was passiert, entscheiden Füße, Ball, Gegner und Schiedsrichter.')}</p>
      </section>
    </div>
    <footer class="prep-foot">
      <ol class="prep-flow">
        <li>${tr('The match runs in the background – you follow it in the manager view.', 'Die Partie läuft im Hintergrund – du verfolgst sie in der Manageransicht.')}</li>
        <li>${tr('At real decisive moments the match stops and the scene plays in 3D.', 'In echten entscheidenden Momenten hält die Partie an, die Szene läuft in 3D.')}</li>
        <li>${tr('You decide – the players carry it out, and the match goes on from there.', 'Du entscheidest – die Spieler setzen um, und die Partie geht von dort weiter.')}</li>
      </ol>
      <button class="mgr-go" data-go type="button">${tr('Kick-off', 'Anpfiff')}</button>
    </footer>`;
  el.querySelector('.home')!.textContent = TEAMS[0].name;
  el.querySelector('.away')!.textContent = TEAMS[1].name;
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const choice: MatchChoice = { halfMinutes: HALF_MINUTES, resetMemory: false, userTeam: stored.userTeam, mode: stored.mode, focusPlayer: stored.focusPlayer, instruction: { ...stored.instruction }, lineup: [] };

  choices(q('.prep-lang'), [['EN', 'en'], ['DE', 'de']] as const, lang(), (l: Lang) => {
    if (l === lang()) return;
    try { localStorage.setItem(LANG_STORAGE_KEY, l); } catch { /* the URL carries it anyway */ }
    const url = new URL(location.href);
    url.searchParams.set('lang', l);
    location.assign(url.toString());
  });

  // Team sheet: always derived from the original roster plus the swaps, through the engine's own rules.
  let selected: number | null = null;
  const roster = (): PlayerProfile[] => { const r = createRoster(7); applyLineup(r, choice.lineup); return r; };
  const focus = q<HTMLSelectElement>('[data-focus]');
  const renderSheet = () => {
    const r = roster(), team = choice.userTeam;
    const row = (p: PlayerProfile) => {
      const e = playerRow(p);
      e.tabIndex = 0;
      e.classList.toggle('selected', p.id === selected);
      e.classList.toggle('swapped', choice.lineup.some(s => s.on === p.id || s.off === p.id));
      const pick = () => click(p, r);
      e.addEventListener('click', pick);
      e.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); } });
      return e;
    };
    q('[data-xi]').replaceChildren(...r.filter(p => p.team === team && p.squad === 'starter').map(row));
    q('[data-bench]').replaceChildren(...r.filter(p => p.team === team && p.squad === 'bench').map(row));
    q('[data-reset-sheet]').hidden = choice.lineup.length === 0;
    const starters = r.filter(p => p.team === team && p.squad === 'starter');
    focus.replaceChildren(new Option(tr('none', 'keiner'), ''), ...starters.map(p => new Option(`${p.number} · ${p.name} (${p.role})`, String(p.id))));
    if (choice.focusPlayer !== null && !starters.some(p => p.id === choice.focusPlayer)) choice.focusPlayer = null;
    focus.value = choice.focusPlayer === null ? '' : String(choice.focusPlayer);
  };
  const click = (p: PlayerProfile, r: PlayerProfile[]) => {
    if (p.squad === 'starter') { selected = selected === p.id ? null : p.id; renderSheet(); return; }
    if (selected === null) return;
    const starter = r[selected];
    if ((starter.role === 'GK') !== (p.role === 'GK')) return;
    // A starter who came in by an earlier swap: that swap is replaced (or undone when the original starter returns).
    const earlier = choice.lineup.find(s => s.on === starter.id);
    if (earlier) {
      choice.lineup = choice.lineup.filter(s => s !== earlier);
      if (earlier.off !== p.id) choice.lineup.push({ off: earlier.off, on: p.id });
    } else {
      // A dropped starter only returns for the player who replaced him (handled above): a sheet names each player once.
      if (choice.lineup.some(s => s.off === p.id)) return;
      choice.lineup.push({ off: starter.id, on: p.id });
    }
    selected = null;
    renderSheet();
  };
  q('[data-reset-sheet]').addEventListener('click', () => { choice.lineup = []; selected = null; renderSheet(); });
  focus.addEventListener('change', () => { choice.focusPlayer = focus.value === '' ? null : Number(focus.value); });

  choices(q('[data-club]'), [[TEAMS[0].name, 0], [TEAMS[1].name, 1]] as const, stored.userTeam, (t: TeamId) => {
    if (t !== choice.userTeam) { choice.lineup = []; choice.focusPlayer = null; }
    choice.userTeam = t; selected = null; renderSheet();
  });
  choices(q('[data-mode]'), [[tr('Fan', 'Fan'), 'fan'], [tr('Analyst', 'Analyst'), 'analyst']] as const, stored.mode, (m: Mode) => { choice.mode = m; });

  choices(q('[data-press]'), [[tr('Low', 'Tief'), 'low'], [tr('Medium', 'Mittel'), 'mid'], [tr('High', 'Hoch'), 'high']] as const, choice.instruction.press, (p: TeamInstruction['press']) => {
    choice.instruction.press = p;
    q('[data-press-note]').textContent = PRESS_NOTE(p);
  });
  const line = q<HTMLInputElement>('[data-line]'), risk = q<HTMLInputElement>('[data-risk]');
  const sync = () => {
    choice.instruction.lineHeight = Number(line.value);
    choice.instruction.risk = Number(risk.value);
    q('[data-line-out]').textContent = choice.instruction.lineHeight > 0 ? `+${choice.instruction.lineHeight.toFixed(1)}` : choice.instruction.lineHeight.toFixed(1);
    q('[data-risk-out]').textContent = `${Math.round(choice.instruction.risk * 100)} %`;
    q('[data-line-note]').textContent = lineNote(choice.instruction.lineHeight);
    q('[data-risk-note]').textContent = riskNote(choice.instruction.risk);
  };
  line.value = String(choice.instruction.lineHeight);
  risk.value = String(choice.instruction.risk);
  line.addEventListener('input', sync);
  risk.addEventListener('input', sync);
  sync();

  const memory = q('[data-memory]');
  if (memoryMatches > 0) {
    memory.innerHTML = `<span></span> <button type="button" class="mgr-link">${tr('Reset', 'Zurücksetzen')}</button>`;
    memory.querySelector('span')!.textContent = tr(`The players remember ${memoryMatches} ${memoryMatches === 1 ? 'match' : 'matches'}: confidence and trust in each other.`, `Die Spieler erinnern sich an ${memoryMatches} ${memoryMatches === 1 ? 'Partie' : 'Partien'}: Selbstvertrauen und Vertrauen untereinander.`);
    memory.querySelector('button')!.addEventListener('click', () => { choice.resetMemory = true; memory.textContent = tr('Memory is cleared at kick-off – everyone starts fresh.', 'Gedächtnis wird beim Anpfiff gelöscht – alle starten frisch.'); });
  } else memory.textContent = tr('First match: the players start from their character and take what they experience into the next match.', 'Erste Partie: Die Spieler beginnen mit ihrem Grundcharakter und nehmen ihre Erfahrungen in die nächste Partie mit.');

  q('[data-go]').addEventListener('click', () => { el.remove(); onStart(choice); });
  host.append(el);
}

