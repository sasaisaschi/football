import './intel-panel.css';
import { TEAMS } from '../engine/rosters';
import type { MatchSnapshot, PlayerProfile } from '../engine/types';
import { tr } from '../i18n';
import type { IntelBoard } from '../intel/board';
import { narrate } from '../intel/narrator';
import type { Insight, Mode, Personalization } from '../intel/types';

/** Wall seconds a fan card stays before the next one may replace it (a goal or decision replaces it at once). */
const CARD_SECONDS = 7;
/** Window of the "who is on top" bar (simulated s). */
const BAR_WINDOW = 300;

/**
 * Stage 5 – personalize, and the on-screen part of stage 4: the match intelligence beside the match, in the viewer's
 * mode. Fan: one story at a time, who is on top, the viewer's player. Analyst: the statistics table, the insight feed
 * with the events each rests on, the focus player's numbers. `I` switches the mode. Hidden while a decision is open
 * (the decision panel then carries the explanation of the moment).
 */
export class IntelPanel {
  readonly el = document.createElement('aside');
  private card: { insight: Insight; until: number } | null = null;
  private readonly queue: Insight[] = [];
  private readonly series: { time: number; t0: number; t1: number }[] = [];
  private lastRefresh = -Infinity;

  constructor(private readonly board: IntelBoard, private readonly profiles: readonly PlayerProfile[], readonly prefs: Personalization, private readonly onPrefs: (p: Personalization) => void) {
    this.el.className = 'intel';
    this.el.setAttribute('aria-label', tr('Match intelligence', 'Match Intelligence'));
    this.el.innerHTML = `
      <header class="intel-head">
        <span class="intel-kicker">${tr('Match intelligence', 'Match Intelligence')}</span>
        <span class="intel-modes" role="radiogroup">
          <button type="button" data-mode="fan">${tr('Fan', 'Fan')}</button><button type="button" data-mode="analyst">${tr('Analyst', 'Analyst')}</button>
        </span>
      </header>
      <div class="intel-body" data-body></div>`;
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-mode]')) b.addEventListener('click', () => this.setMode(b.dataset.mode as Mode));
    window.addEventListener('keydown', ev => { if ((ev.key === 'i' || ev.key === 'I') && !this.el.hidden) this.setMode(this.prefs.mode === 'fan' ? 'analyst' : 'fan'); });
    this.markMode();
  }

  setMode(mode: Mode): void {
    this.prefs.mode = mode;
    this.onPrefs(this.prefs);
    this.markMode();
    this.lastRefresh = -Infinity;
  }

  private markMode(): void {
    this.el.dataset.mode = this.prefs.mode;
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-mode]')) b.setAttribute('aria-checked', String(b.dataset.mode === this.prefs.mode));
  }

  /** A new insight from the board. */
  push(i: Insight): void {
    this.queue.push(i);
    this.lastRefresh = -Infinity;
  }

  setDeciding(deciding: boolean): void {
    this.el.classList.toggle('deciding', deciding);
  }

  private words(i: Insight) {
    return narrate(i, this.prefs.mode, { profiles: this.profiles, favouriteTeam: this.prefs.favouriteTeam });
  }

  /** Every frame: the fan card's turn, and a redraw at most twice a second. */
  update(frame: MatchSnapshot | null, wall: number): void {
    if (frame) {
      const t = this.board.stats.teams;
      const last = this.series[this.series.length - 1];
      if (!last || frame.time - last.time >= 5) this.series.push({ time: frame.time, t0: t[0].territory, t1: t[1].territory });
    }
    // The fan card: the most important waiting insight once the current one has had its time (priority 3 at once).
    const urgent = this.queue.findIndex(i => i.priority === 3);
    if (this.queue.length && (!this.card || wall > this.card.until || urgent >= 0)) {
      const k = urgent >= 0 ? urgent : this.queue.reduce((b, i, n) => (i.priority > this.queue[b].priority ? n : b), 0);
      this.card = { insight: this.queue.splice(k, 1)[0], until: wall + CARD_SECONDS };
      // Background insights that waited too long are dropped from the fan stream (they stay in the analyst feed).
      for (let n = this.queue.length - 1; n >= 0; n--) if (this.queue[n].priority === 1 && this.queue.length > 3) this.queue.splice(n, 1);
      this.lastRefresh = -Infinity;
    }
    if (wall - this.lastRefresh < 0.5) return;
    this.lastRefresh = wall;
    const body = this.el.querySelector<HTMLElement>('[data-body]')!;
    body.replaceChildren(...(this.prefs.mode === 'fan' ? this.fanView(frame) : this.analystView()));
  }

  private onTop(frame: MatchSnapshot | null): [number, number] | null {
    if (!frame || this.series.length < 2) return null;
    const now = this.series[this.series.length - 1];
    const old = [...this.series].reverse().find(p => now.time - p.time >= BAR_WINDOW) ?? this.series[0];
    const a = now.t0 - old.t0, b = now.t1 - old.t1;
    return a + b > 20 ? [a / (a + b), b / (a + b)] : null;
  }

  private fanView(frame: MatchSnapshot | null): HTMLElement[] {
    const out: HTMLElement[] = [];
    const share = this.onTop(frame);
    if (share) {
      const bar = el('div', 'intel-bar');
      bar.append(el('span', 'intel-bar-label', tr('Who is on top (last 5 min)', 'Wer drückt (letzte 5 min)')));
      const track = el('div', 'intel-bar-track');
      const home = el('span', 'home'), away = el('span', 'away');
      home.style.width = `${Math.round(share[0] * 100)}%`;
      away.style.width = `${Math.round(share[1] * 100)}%`;
      track.append(home, away);
      bar.append(track, el('span', 'intel-bar-teams', `${TEAMS[0].short} ${Math.round(share[0] * 100)}% · ${Math.round(share[1] * 100)}% ${TEAMS[1].short}`));
      out.push(bar);
    }
    if (this.card) {
      const w = this.words(this.card.insight);
      const c = el('article', 'intel-card');
      c.dataset.kind = this.card.insight.kind;
      c.append(el('span', 'intel-clock', this.card.insight.clock), el('h3', '', w.title), el('p', '', w.text));
      out.push(c);
    } else out.push(el('p', 'intel-empty', tr('The story of the match appears here as it happens.', 'Die Geschichte des Spiels erscheint hier, sobald sie passiert.')));
    const focus = this.focusLine();
    if (focus) out.push(focus);
    return out;
  }

  private focusLine(): HTMLElement | null {
    const id = this.prefs.focusPlayer;
    if (id === null) return null;
    const p = this.board.stats.players[id], pr = this.profiles[id];
    const line = el('div', 'intel-focus');
    line.append(el('b', '', `${pr.number} · ${pr.name}`), el('span', '', tr(
      `${p.touches} touches · ${p.passesCompleted}/${p.passes} passes · ${p.shots} shots · top speed ${(p.topSpeed * 3.6).toFixed(1)} km/h`,
      `${p.touches} Ballkontakte · ${p.passesCompleted}/${p.passes} Pässe · ${p.shots} Schüsse · Spitze ${(p.topSpeed * 3.6).toFixed(1)} km/h`)));
    return line;
  }

  private analystView(): HTMLElement[] {
    const t = this.board.stats.teams, total = t[0].possession + t[1].possession || 1;
    const avg = (a: number, n: number, d = 1) => (n ? (a / n).toFixed(d) : '–');
    const rows: [string, string, string][] = [
      [tr('Possession', 'Ballbesitz'), `${Math.round((t[0].possession / total) * 100)} %`, `${Math.round((t[1].possession / total) * 100)} %`],
      [tr('Passes (completed)', 'Pässe (angekommen)'), `${t[0].passes} (${t[0].passes ? Math.round((t[0].passesCompleted / t[0].passes) * 100) : 0} %)`, `${t[1].passes} (${t[1].passes ? Math.round((t[1].passesCompleted / t[1].passes) * 100) : 0} %)`],
      [tr('Avg pass · difficulty 1–5', 'Ø Pass · Schwierigkeit 1–5'), `${avg(t[0].passDistance, t[0].passes, 0)} m · ${avg(t[0].passDifficulty, t[0].passes)}`, `${avg(t[1].passDistance, t[1].passes, 0)} m · ${avg(t[1].passDifficulty, t[1].passes)}`],
      [tr('Progressive passes', 'Raumgewinn-Pässe'), String(t[0].progressivePasses), String(t[1].progressivePasses)],
      [tr('Shots (on target)', 'Schüsse (aufs Tor)'), `${t[0].shots} (${t[0].shotsOnTarget})`, `${t[1].shots} (${t[1].shotsOnTarget})`],
      [tr('xG (model)', 'xG (Modell)'), t[0].xg.toFixed(2), t[1].xg.toFixed(2)],
      [tr('Pressures won', 'Druck gewonnen'), `${t[0].pressureWins}/${t[0].pressures}`, `${t[1].pressureWins}/${t[1].pressures}`],
      [tr('Fastest shot', 'Härtester Schuss'), `${Math.round(t[0].maxShotSpeed * 3.6)} km/h`, `${Math.round(t[1].maxShotSpeed * 3.6)} km/h`],
    ];
    const table = el('table', 'intel-table');
    const head = el('tr');
    head.append(el('th', '', ''), el('th', 'home', TEAMS[0].short), el('th', 'away', TEAMS[1].short));
    table.append(head);
    for (const [k, a, b] of rows) { const r = el('tr'); r.append(el('td', '', k), el('td', '', a), el('td', '', b)); table.append(r); }
    const feed = el('ol', 'intel-feed');
    for (const i of [...this.board.insights].reverse().slice(0, 5)) {
      const w = this.words(i);
      const li = el('li');
      li.dataset.kind = i.kind;
      const ev = i.eventIds.length ? tr(`events #${i.eventIds.slice(0, 3).join(', #')}${i.eventIds.length > 3 ? ` +${i.eventIds.length - 3}` : ''}`, `Ereignisse #${i.eventIds.slice(0, 3).join(', #')}${i.eventIds.length > 3 ? ` +${i.eventIds.length - 3}` : ''}`) : tr('rolling statistics', 'laufende Statistik');
      li.append(el('span', 'intel-clock', i.clock), el('b', '', w.title), el('p', '', w.text), el('small', 'intel-evidence', ev));
      feed.append(li);
    }
    const out: HTMLElement[] = [table];
    const focus = this.focusCard();
    if (focus) out.push(focus);
    out.push(feed);
    return out;
  }

  private focusCard(): HTMLElement | null {
    const id = this.prefs.focusPlayer;
    if (id === null) return null;
    const p = this.board.stats.players[id], pr = this.profiles[id];
    const card = el('div', 'intel-focus analyst');
    card.append(el('b', '', `${tr('Focus', 'Fokus')}: ${pr.number} · ${pr.name} (${pr.role})`), el('span', '', tr(
      `${p.touches} touches · passes ${p.passesCompleted}/${p.passes} · shots ${p.shots}, xG ${p.xg.toFixed(2)} · ${(p.distance / 1000).toFixed(2)} km · top ${(p.topSpeed * 3.6).toFixed(1)} km/h · ${p.sprints} sprints · ${p.ballsWon} balls won`,
      `${p.touches} Ballkontakte · Pässe ${p.passesCompleted}/${p.passes} · Schüsse ${p.shots}, xG ${p.xg.toFixed(2)} · ${(p.distance / 1000).toFixed(2)} km · Spitze ${(p.topSpeed * 3.6).toFixed(1)} km/h · ${p.sprints} Sprints · ${p.ballsWon} Ballgewinne`)));
    return card;
  }
}

function el(tag: string, cls = '', text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
