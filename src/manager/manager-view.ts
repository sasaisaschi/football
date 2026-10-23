import './controls.css';
import './manager-view.css';
import { TEAMS } from '../engine/rosters';
import type { MatchEvent, MatchSnapshot, PlayerProfile, TeamId, TeamInstruction } from '../engine/types';
import { tr } from '../i18n';
import type { IntelBoard } from '../intel/board';
import type { ManagerPace } from '../session/pacing';
import { lengthLabel } from '../ui/match-length';
import { choices, rating } from './controls';

/** State of the background simulation as the manager sees it. */
export type SimStatus = { paused: boolean; waiting: boolean; done: boolean; aheadSeconds: number; cpuSeconds: number };
type EntryKind = 'goal' | 'card' | 'decision' | 'sub' | 'half' | 'info';

const PRESS = (p: TeamInstruction['press']) => ({ high: tr('high', 'hoch'), mid: tr('medium', 'mittel'), low: tr('low', 'tief') })[p];

/**
 * The manager's match screen: score and match minute, the state of the background simulation (pace, pause), the
 * current tactics, the team with form and cards, the event timeline, key developments (decisions and what came of
 * them, goals) and the match intelligence. No pitch with running players: the match is shown in 3D only in its
 * decisive scenes. Reads events and frames only.
 */
export class ManagerView {
  readonly el = document.createElement('div');
  private readonly q = <T extends HTMLElement>(s: string) => this.el.querySelector<T>(s)!;
  private instruction: TeamInstruction;
  private lastUpdate = -Infinity;
  private readonly cameOn = new Set<number>();
  private readonly wentOff = new Set<number>();

  constructor(private readonly o: {
    halfMinutes: number; userTeam: TeamId; profiles: PlayerProfile[]; instruction: TeamInstruction; intel: IntelBoard; intelPanel: HTMLElement;
    pace: ManagerPace; onPace: (p: ManagerPace) => void; onPause: (paused: boolean) => void;
  }) {
    this.instruction = { ...o.instruction };
    const t = TEAMS[o.userTeam];
    this.el.className = 'mgr';
    this.el.innerHTML = `
      <header class="mgr-top">
        <div class="mgr-board">
          <span class="mgr-team home">${TEAMS[0].name}</span>
          <b class="mgr-score" data-score>0 : 0</b>
          <span class="mgr-team away">${TEAMS[1].name}</span>
          <span class="mgr-clock" data-clock>00:00</span>
          <span class="mgr-len" data-len></span>
        </div>
        <div class="mgr-sim">
          <span class="mgr-sim-state" data-state></span>
          <div class="mgr-seg mgr-pace" data-pace role="radiogroup" aria-label="${tr('Pace', 'Tempo')}"></div>
          <button type="button" class="mgr-pause" data-pause>${tr('Pause', 'Pause')}</button>
        </div>
      </header>
      <div class="mgr-progress" aria-hidden="true"><span data-progress></span><i class="mgr-half"></i><div data-markers></div></div>
      <div class="mgr-cols">
        <section class="mgr-card mgr-team-card">
          <h2>${t.name}</h2>
          <div class="mgr-tactic" data-tactic></div>
          <h3>${tr('On the pitch', 'Auf dem Platz')} <small>${tr('form from real actions', 'Form aus echten Aktionen')}</small></h3>
          <div class="mgr-lineup" data-lineup></div>
          <h3>${tr('Bench', 'Ersatzbank')}</h3>
          <div class="mgr-lineup bench" data-bench></div>
        </section>
        <section class="mgr-centre">
          <div class="mgr-card mgr-stats" data-stats></div>
          <div class="mgr-card mgr-dev-card"><h2>${tr('Key developments', 'Wichtige Entwicklungen')}</h2><ol class="mgr-dev" data-dev><li class="mgr-empty">${tr('Nothing decisive yet.', 'Noch nichts Entscheidendes.')}</li></ol></div>
          <div class="mgr-card mgr-feed-card"><h2>${tr('Match events', 'Spielereignisse')}</h2><ol class="mgr-feed" data-feed></ol></div>
        </section>
        <section class="mgr-intel" data-intel></section>
      </div>`;
    this.q('[data-len]').textContent = lengthLabel(o.halfMinutes).short;
    this.q('[data-intel]').append(o.intelPanel);
    o.intelPanel.classList.add('intel-docked');
    choices(this.q('[data-pace]'), [[tr('Normal', 'Normal'), 'normal'], [tr('Fast', 'Schnell'), 'fast']] as const, o.pace, (p: ManagerPace) => o.onPace(p));
    const pause = this.q<HTMLButtonElement>('[data-pause]');
    pause.addEventListener('click', () => {
      const paused = pause.dataset.paused !== '1';
      pause.dataset.paused = paused ? '1' : '0';
      pause.textContent = paused ? tr('Resume', 'Weiter') : tr('Pause', 'Pause');
      o.onPause(paused);
    });
    this.renderTactic();
  }

  show(on: boolean): void {
    this.el.hidden = !on;
    if (on) this.lastUpdate = -Infinity;
  }

  private clock(s: Pick<MatchSnapshot, 'clockSeconds' | 'half'>): number {
    return Math.min(this.o.halfMinutes * 60, s.clockSeconds) + (s.half === 2 ? this.o.halfMinutes * 60 : 0);
  }

  /** A match event as it is reached by the shown time: the timeline line (from commentary.ts) and what changes the screen. */
  event(e: MatchEvent, clock: string, line: string | null, s: MatchSnapshot | null): void {
    if (e.type === 'instruction' && e.team === this.o.userTeam) { this.instruction = { ...e.instruction }; this.renderTactic(); }
    if (e.type === 'substitution') { this.cameOn.add(e.on); this.wentOff.add(e.off); }
    const kind: EntryKind = e.type === 'goal' ? 'goal' : e.type === 'foul' && e.card !== 'none' ? 'card' : e.type === 'substitution' ? 'sub' : e.type === 'half-time' || e.type === 'full-time' || e.type === 'kickoff' ? 'half' : 'info';
    if (line) this.feed(clock, line, kind);
    if (e.type === 'goal') {
      this.development(clock, line ?? tr('Goal', 'Tor'), 'goal');
      if (s) this.mark('goal', this.clock(s), e.team);
    }
    if (e.type === 'moment' && s) this.mark('moment', this.clock(s), e.team);
  }

  private feed(clock: string, text: string, kind: EntryKind): void {
    const li = document.createElement('li');
    li.dataset.kind = kind;
    li.innerHTML = '<b></b><span></span>';
    li.querySelector('b')!.textContent = clock;
    li.querySelector('span')!.textContent = text;
    const list = this.q('[data-feed]');
    list.prepend(li);
    while (list.children.length > 60) list.lastElementChild!.remove();
  }

  /** A key development: a goal, or a decision with what was observed after it. */
  development(clock: string, text: string, kind: EntryKind, detail?: string): void {
    const list = this.q('[data-dev]');
    list.querySelector('.mgr-empty')?.remove();
    const li = document.createElement('li');
    li.dataset.kind = kind;
    li.innerHTML = '<b></b><span></span><small></small>';
    li.querySelector('b')!.textContent = clock;
    li.querySelector('span')!.textContent = text;
    li.querySelector('small')!.textContent = detail ?? '';
    list.prepend(li);
  }

  private mark(kind: 'goal' | 'moment', at: number, team: TeamId): void {
    const m = document.createElement('span');
    m.className = `mgr-marker ${kind} ${team === 0 ? 'home' : 'away'}`;
    m.style.left = `${(at / (this.o.halfMinutes * 120)) * 100}%`;
    this.q('[data-markers]').append(m);
  }

  private renderTactic(): void {
    const i = this.instruction;
    const line = i.lineHeight === 0 ? tr('normal', 'normal') : `${i.lineHeight > 0 ? '+' : ''}${i.lineHeight.toFixed(1)}`;
    this.q('[data-tactic]').innerHTML = `<span>${tr('Pressing', 'Pressing')}<b></b></span><span>${tr('Line', 'Linie')}<b></b></span><span>${tr('Risk', 'Risiko')}<b></b></span>`;
    const b = this.q('[data-tactic]').querySelectorAll('b');
    b[0].textContent = PRESS(i.press); b[1].textContent = line; b[2].textContent = `${Math.round(i.risk * 100)} %`;
  }

  /** Refreshes score, clock, simulation state, team and statistics (a few times per second). */
  update(s: MatchSnapshot, status: SimStatus, clock: string, wall: number): void {
    this.q('[data-score]').textContent = `${s.score[0]} : ${s.score[1]}`;
    this.q('[data-clock]').textContent = clock;
    this.q<HTMLElement>('[data-progress]').style.width = `${(this.clock(s) / (this.o.halfMinutes * 120)) * 100}%`;
    const state = this.q('[data-state]');
    const label = status.done ? tr('Full time computed', 'Partie fertig berechnet') : status.paused ? tr('Paused', 'Pausiert')
      : status.waiting ? tr('Stopped at a decisive moment', 'Angehalten an einem entscheidenden Moment') : tr(`Simulating · ${Math.round(status.aheadSeconds)} s ahead`, `Simuliert · ${Math.round(status.aheadSeconds)} s voraus`);
    state.textContent = label;
    state.dataset.state = status.paused ? 'paused' : status.waiting ? 'waiting' : status.done ? 'done' : 'running';
    if (wall - this.lastUpdate < 0.5) return;
    this.lastUpdate = wall;
    this.renderTeam(s);
    this.renderStats();
  }

  private renderTeam(s: MatchSnapshot): void {
    const team = this.o.userTeam;
    const row = (p: PlayerProfile) => {
      const v = s.players[p.id], conf = s.minds[p.id]?.confidence ?? p.traits.confidence;
      const r = document.createElement('div');
      r.className = 'mgr-lu';
      r.innerHTML = '<span class="mgr-num"></span><span class="mgr-name"></span><span class="mgr-role"></span><span class="mgr-form"><i></i></span><span class="mgr-flag"></span>';
      r.querySelector('.mgr-num')!.textContent = String(p.number);
      r.querySelector('.mgr-name')!.textContent = p.name;
      r.querySelector('.mgr-role')!.textContent = p.role;
      const form = r.querySelector<HTMLElement>('.mgr-form i')!;
      form.style.width = `${rating(conf)}%`;
      form.dataset.level = conf > 0.66 ? 'good' : conf < 0.45 ? 'low' : 'ok';
      r.querySelector('.mgr-form')!.setAttribute('title', `${tr('Confidence', 'Selbstvertrauen')} ${rating(conf)}`);
      const flag = r.querySelector('.mgr-flag')!;
      flag.textContent = v?.booked === 'red' || (v?.sentOff && !this.wentOff.has(p.id) && p.squad === 'starter') ? tr('red', 'Rot') : v?.booked === 'yellow' ? tr('yellow', 'Gelb') : this.cameOn.has(p.id) ? tr('on', 'eingew.') : '';
      flag.setAttribute('data-flag', v?.booked ?? 'none');
      return r;
    };
    const ours = this.o.profiles.filter(p => p.team === team);
    const onPitch = ours.filter(p => !s.players[p.id]?.sentOff);
    const bench = ours.filter(p => p.squad === 'bench' && !this.cameOn.has(p.id));
    this.q('[data-lineup]').replaceChildren(...onPitch.map(row));
    this.q('[data-bench]').replaceChildren(...bench.map(row));
  }

  private renderStats(): void {
    const t = this.o.intel.stats.teams;
    const total = t[0].possession + t[1].possession || 1;
    const rows: [string, string, string][] = [
      [tr('Possession', 'Ballbesitz'), `${Math.round((t[0].possession / total) * 100)} %`, `${Math.round((t[1].possession / total) * 100)} %`],
      [tr('Shots (on target)', 'Schüsse (aufs Tor)'), `${t[0].shots} (${t[0].shotsOnTarget})`, `${t[1].shots} (${t[1].shotsOnTarget})`],
      [tr('Model xG', 'Modell-xG'), t[0].xg.toFixed(2), t[1].xg.toFixed(2)],
      [tr('Passes completed', 'Pässe angekommen'), `${t[0].passesCompleted}/${t[0].passes}`, `${t[1].passesCompleted}/${t[1].passes}`],
      [tr('Pressing wins', 'Ballgewinne im Pressing'), `${t[0].pressureWins}/${t[0].pressures}`, `${t[1].pressureWins}/${t[1].pressures}`],
      [tr('Fouls · corners', 'Fouls · Ecken'), `${t[0].fouls} · ${t[0].corners}`, `${t[1].fouls} · ${t[1].corners}`],
    ];
    this.q('[data-stats]').innerHTML = `<table class="mgr-stat-table"><thead><tr><th></th><th class="home">${TEAMS[0].short}</th><th class="away">${TEAMS[1].short}</th></tr></thead><tbody></tbody></table>`;
    const body = this.q('[data-stats]').querySelector('tbody')!;
    for (const [label, a, b] of rows) {
      const tr_ = document.createElement('tr');
      tr_.innerHTML = '<td></td><td></td><td></td>';
      tr_.children[0].textContent = label; tr_.children[1].textContent = a; tr_.children[2].textContent = b;
      body.append(tr_);
    }
  }
}
