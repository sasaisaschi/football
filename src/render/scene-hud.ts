import './scene-hud.css';
import { TEAMS } from '../engine/rosters';
import type { DecisionMoment, MatchSnapshot, PlayerProfile, TeamId } from '../engine/types';
import { tr } from '../i18n';
import { attackSign, PITCH } from '../physics/pitch-geometry';
import { ICONS } from './hud-icons';
import { MARK_COLOUR, markKind } from './tactical-overlay';

/** What the toolbar's panels show: live match statistics and the acting player's form, from the app's own data. */
export type HudInfo = { stats(): [string, number | string, number | string][]; player(): { title: string; lines: string[] } | null };

/**
 * The scene's broadcast graphics, laid out as the client's reference picture: the score strip at the top left (clock,
 * home bar, clubs, score, away bar), the toolbar under it (markings on/off, live statistics, the acting player), and
 * the minimap at the top right with its toggle. Everything shown comes from the frame on screen.
 */
export class SceneHud {
  readonly el = document.createElement('div');
  private readonly map: HTMLCanvasElement;
  private readonly pop: HTMLElement;
  private moment: DecisionMoment | null = null;
  private tool: 'stats' | 'team' | null = null;
  private lastMap = -1;

  constructor(private readonly profiles: PlayerProfile[], private readonly userTeam: TeamId, private readonly info: HudInfo, private readonly onMarks: (on: boolean) => void) {
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud-score">
        <span class="hud-clock" data-clock>00:00</span>
        <span class="hud-team home"><i></i><span>${TEAMS[0].name.toUpperCase()}</span></span>
        <b class="hud-result" data-score>0 - 0</b>
        <span class="hud-team away"><span>${TEAMS[1].name.toUpperCase()}</span><i></i></span>
      </div>
      <nav class="hud-tools" aria-label="${tr('Scene tools', 'Szenenwerkzeuge')}">
        <button type="button" data-tool="marks" class="active" title="${tr('Markings on the pitch', 'Markierungen auf dem Feld')}">${ICONS.tactics}</button>
        <button type="button" data-tool="stats" title="${tr('Match statistics', 'Spielstatistik')}">${ICONS.stats}</button>
        <button type="button" data-tool="team" title="${tr('The player and the situation', 'Spieler und Situation')}">${ICONS.team}</button>
      </nav>
      <div class="hud-pop" data-pop hidden></div>
      <canvas class="hud-map" data-map></canvas>
      <button type="button" class="hud-map-toggle active" data-map-toggle title="${tr('Minimap', 'Minimap')}">${ICONS.target}</button>`;
    this.map = this.el.querySelector('[data-map]')!;
    this.pop = this.el.querySelector('[data-pop]')!;
    this.el.querySelector('[data-tool="marks"]')!.addEventListener('click', ev => {
      const b = ev.currentTarget as HTMLElement;
      b.classList.toggle('active');
      this.onMarks(b.classList.contains('active'));
    });
    for (const t of ['stats', 'team'] as const) this.el.querySelector(`[data-tool="${t}"]`)!.addEventListener('click', () => this.openTool(this.tool === t ? null : t));
    this.el.querySelector('[data-map-toggle]')!.addEventListener('click', ev => {
      const b = ev.currentTarget as HTMLElement;
      b.classList.toggle('active');
      this.map.hidden = !b.classList.contains('active');
    });
  }

  private openTool(t: 'stats' | 'team' | null): void {
    this.tool = t;
    this.el.querySelectorAll<HTMLElement>('[data-tool="stats"], [data-tool="team"]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
    this.pop.hidden = t === null;
    if (t === 'stats') {
      const rows = this.info.stats();
      this.pop.innerHTML = `<h3>${tr('Match statistics', 'Spielstatistik')}</h3><table><thead><tr><th></th><th class="home">${TEAMS[0].short}</th><th class="away">${TEAMS[1].short}</th></tr></thead><tbody></tbody></table>`;
      const body = this.pop.querySelector('tbody')!;
      for (const [label, a, b] of rows) {
        const tr_ = document.createElement('tr');
        for (const v of [label, a, b]) { const td = document.createElement('td'); td.textContent = String(v); tr_.append(td); }
        body.append(tr_);
      }
    } else if (t === 'team') {
      const p = this.info.player();
      this.pop.innerHTML = '<h3></h3><ul></ul>';
      this.pop.querySelector('h3')!.textContent = p?.title ?? tr('No player to show', 'Kein Spieler im Fokus');
      this.pop.querySelector('ul')!.replaceChildren(...(p?.lines ?? []).map(l => { const li = document.createElement('li'); li.textContent = l; return li; }));
    }
  }

  /** The decision on screen (its options are drawn on the minimap), or none. */
  setMoment(m: DecisionMoment | null): void {
    this.moment = m;
    this.lastMap = -1;
    if (!m && this.tool) this.openTool(null);
  }

  update(s: MatchSnapshot, clock: string): void {
    this.el.querySelector('[data-clock]')!.textContent = clock;
    this.el.querySelector('[data-score]')!.textContent = `${s.score[0]} - ${s.score[1]}`;
    // The minimap redraws at most every tick shown (and not at all while frozen).
    if (!this.map.hidden && s.tick !== this.lastMap) { this.lastMap = s.tick; this.drawMap(s); }
  }

  /** The whole pitch, the user's team attacking to the right; players as dots in the club colours, the options as arrows. */
  private drawMap(s: MatchSnapshot): void {
    const c = this.map, dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (!w || !h) return;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    const pad = 3 * dpr, sx = (w - 2 * pad) / PITCH.length, sz = (h - 2 * pad) / PITCH.width;
    const flip = attackSign(this.userTeam, s.half);
    const X = (x: number) => pad + (flip * x + PITCH.halfLength) * sx, Y = (z: number) => pad + (flip * z + PITCH.halfWidth) * sz;
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = Math.max(1, dpr);
    const rect = (x0: number, z0: number, x1: number, z1: number) => g.strokeRect(Math.min(X(x0), X(x1)), Math.min(Y(z0), Y(z1)), Math.abs(X(x1) - X(x0)), Math.abs(Y(z1) - Y(z0)));
    rect(-PITCH.halfLength, -PITCH.halfWidth, PITCH.halfLength, PITCH.halfWidth);
    g.beginPath(); g.moveTo(X(0), Y(-PITCH.halfWidth)); g.lineTo(X(0), Y(PITCH.halfWidth)); g.stroke();
    g.beginPath(); g.arc(X(0), Y(0), PITCH.centreCircleRadius * sx, 0, Math.PI * 2); g.stroke();
    for (const side of [-1, 1]) {
      const l = side * PITCH.halfLength;
      rect(l, -PITCH.penaltyAreaHalfWidth, l - side * PITCH.penaltyAreaDepth, PITCH.penaltyAreaHalfWidth);
      rect(l, -PITCH.goalAreaHalfWidth, l - side * PITCH.goalAreaDepth, PITCH.goalAreaHalfWidth);
      const mark = l - side * PITCH.penaltyMark;
      g.beginPath(); g.arc(X(mark), Y(0), 1.2 * dpr, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.85)'; g.fill();
    }
    const m = this.moment;
    if (m) {
      const from = s.ball.position;
      for (const o of m.options) {
        const to = o.visual?.ball?.to;
        if (!to) continue;
        g.strokeStyle = MARK_COLOUR[markKind(o)]; g.lineWidth = 1.6 * dpr; g.setLineDash([3 * dpr, 2 * dpr]);
        g.beginPath(); g.moveTo(X(from.x), Y(from.z)); g.lineTo(X(to.x), Y(to.z)); g.stroke();
        g.setLineDash([]);
      }
    }
    for (const p of s.players) {
      if (p.sentOff) continue;
      const team = this.profiles[p.id].team;
      const focus = m?.focusPlayer === p.id;
      g.beginPath(); g.arc(X(p.position.x), Y(p.position.z), (focus ? 3.6 : 3) * dpr, 0, Math.PI * 2);
      g.fillStyle = team === 0 ? '#2f7fe6' : '#d12a3c'; g.fill();
      g.lineWidth = dpr; g.strokeStyle = focus ? '#fce10d' : 'rgba(255,255,255,0.9)'; g.stroke();
    }
    g.beginPath(); g.arc(X(s.ball.position.x), Y(s.ball.position.z), 1.8 * dpr, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill();
  }
}
