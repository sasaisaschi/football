import './controls.css';
import './coach-screens.css';
import { TEAMS } from '../engine/rosters';
import type { DecisionMoment, DecisionSource, MatchSnapshot, TeamId } from '../engine/types';
import { tr } from '../i18n';
import type { IntelBoard } from '../intel/board';
import { narrate } from '../intel/narrator';
import type { Personalization } from '../intel/types';

/** The coach's options of a moment as buttons; the players' tendency (the default) is marked. */
function optionList(m: DecisionMoment, decide: (optionId: string, by: DecisionSource) => void): HTMLElement {
  const list = document.createElement('div');
  list.className = 'coach-options';
  m.options.forEach((o, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'coach-option';
    b.dataset.option = o.id;
    b.innerHTML = '<span class="coach-key"></span><span class="coach-label"></span><span class="coach-detail"></span><span class="coach-outlook"></span>';
    b.querySelector('.coach-key')!.textContent = String(i + 1);
    b.querySelector('.coach-label')!.textContent = o.label + (o.id === m.defaultOptionId ? tr(' · as before', ' · wie bisher') : '');
    b.querySelector('.coach-detail')!.textContent = o.detail;
    b.querySelector('.coach-outlook')!.textContent = o.outlook;
    b.addEventListener('click', () => decide(o.id, 'user'));
    list.append(b);
  });
  return list;
}

/** Number keys 1–n choose an option while a coach screen is open. */
function keys(m: DecisionMoment, decide: (optionId: string, by: DecisionSource) => void): (ev: KeyboardEvent) => void {
  return ev => {
    const n = Number(ev.key);
    if (Number.isInteger(n) && n >= 1 && n <= m.options.length) decide(m.options[n - 1].id, 'user');
  };
}

/**
 * Half-time: the first half in numbers and the match intelligence's summary, then the team talk – the coach's
 * instruction for the second half (the orchestrator's real options from the existing TeamInstruction) – and the
 * button for the second half, which unlocks once the talk is decided.
 */
export class IntervalScreen {
  readonly el = document.createElement('div');
  private onKey: ((ev: KeyboardEvent) => void) | null = null;

  constructor(s: MatchSnapshot, team: TeamId, intel: IntelBoard, prefs: Personalization, private readonly onContinue: () => void) {
    this.el.className = 'coach-screen interval';
    const t = intel.stats.teams, total = t[0].possession + t[1].possession || 1;
    this.el.innerHTML = `
      <div class="coach-card">
        <div class="coach-kicker">${tr('Half-time', 'Halbzeit')}</div>
        <div class="coach-score"><span class="home">${TEAMS[0].name}</span><b>${s.score[0]} : ${s.score[1]}</b><span class="away">${TEAMS[1].name}</span></div>
        <div class="coach-grid">
          <table class="coach-stats"><tbody></tbody></table>
          <div class="coach-summary" data-summary></div>
        </div>
        <h2>${tr('Team talk', 'Kabinenansprache')}</h2>
        <p class="mgr-note" data-talk-note>${tr('Waiting for the second half to be set up …', 'Die zweite Halbzeit wird vorbereitet …')}</p>
        <div data-talk></div>
        <button type="button" class="mgr-go" data-continue disabled>${tr('Start second half', 'Zweite Halbzeit starten')}</button>
      </div>`;
    const rows: [string, string, string][] = [
      [tr('Possession', 'Ballbesitz'), `${Math.round((t[0].possession / total) * 100)} %`, `${Math.round((t[1].possession / total) * 100)} %`],
      [tr('Shots (on target)', 'Schüsse (aufs Tor)'), `${t[0].shots} (${t[0].shotsOnTarget})`, `${t[1].shots} (${t[1].shotsOnTarget})`],
      [tr('Model xG', 'Modell-xG'), t[0].xg.toFixed(2), t[1].xg.toFixed(2)],
      [tr('Passes completed', 'Pässe angekommen'), `${t[0].passesCompleted}/${t[0].passes}`, `${t[1].passesCompleted}/${t[1].passes}`],
    ];
    const body = this.el.querySelector('tbody')!;
    body.innerHTML = `<tr><th></th><th class="home">${TEAMS[0].short}</th><th class="away">${TEAMS[1].short}</th></tr>`;
    for (const [label, a, b] of rows) {
      const r = document.createElement('tr');
      r.innerHTML = '<td></td><td></td><td></td>';
      r.children[0].textContent = label; r.children[1].textContent = a; r.children[2].textContent = b;
      body.append(r);
    }
    // The intelligence's own half summary, in the viewer's mode (no new analysis here).
    const summary = [...intel.insights].reverse().find(i => i.kind === 'half-summary');
    const box = this.el.querySelector('[data-summary]')!;
    if (summary) {
      const w = narrate(summary, prefs.mode, { profiles: intel.profiles, favouriteTeam: team });
      box.innerHTML = '<h3></h3><p></p>';
      box.querySelector('h3')!.textContent = w.title;
      box.querySelector('p')!.textContent = w.text;
    } else box.textContent = tr('No half summary from the match intelligence yet.', 'Noch keine Halbzeitbilanz der Match Intelligence.');
    const go = this.el.querySelector<HTMLButtonElement>('[data-continue]')!;
    go.addEventListener('click', () => this.onContinue());
  }

  /** The team talk opened (the simulation stands at the second half's kick-off). */
  talk(m: DecisionMoment, decide: (optionId: string, by: DecisionSource) => void): void {
    this.el.querySelector('[data-talk-note]')!.textContent = m.situation;
    const done = (id: string, by: DecisionSource) => {
      if (this.onKey) window.removeEventListener('keydown', this.onKey);
      this.onKey = null;
      decide(id, by);
      const chosen = m.options.find(o => o.id === id)!;
      this.el.querySelector('[data-talk]')!.replaceChildren();
      this.el.querySelector('[data-talk-note]')!.textContent = tr(`Decided: ${chosen.label}. ${chosen.outlook}.`, `Entschieden: ${chosen.label}. ${chosen.outlook}.`);
    };
    this.el.querySelector('[data-talk]')!.replaceChildren(optionList(m, done));
    this.onKey = keys(m, done);
    window.addEventListener('keydown', this.onKey);
  }

  /** The second half may start (talk decided, or the half began without one). */
  ready(yes: boolean): void {
    this.el.querySelector<HTMLButtonElement>('[data-continue]')!.disabled = !yes;
  }

  close(): void {
    if (this.onKey) window.removeEventListener('keydown', this.onKey);
    this.el.remove();
  }
}

/** A coach decision during the match (substitution) over the manager view: the real options, no 3D scene. */
export class CoachDialog {
  readonly el = document.createElement('div');
  private readonly onKey: (ev: KeyboardEvent) => void;

  constructor(m: DecisionMoment, decide: (optionId: string, by: DecisionSource) => void) {
    this.el.className = 'coach-screen dialog';
    this.el.innerHTML = '<div class="coach-card"><div class="coach-kicker"></div><h2></h2><p class="mgr-note"></p></div>';
    this.el.querySelector('.coach-kicker')!.textContent = tr('Your call from the bench', 'Deine Entscheidung an der Seitenlinie');
    this.el.querySelector('h2')!.textContent = m.title;
    this.el.querySelector('.mgr-note')!.textContent = m.situation;
    const done = (id: string, by: DecisionSource) => { this.close(); decide(id, by); };
    this.el.querySelector('.coach-card')!.append(optionList(m, done));
    this.onKey = keys(m, done);
    window.addEventListener('keydown', this.onKey);
  }

  close(): void {
    window.removeEventListener('keydown', this.onKey);
    this.el.remove();
  }
}
