import './hud.css';
import { TEAMS } from '../engine/rosters';
import type { MatchSnapshot, TeamId } from '../engine/types';
import type { PlaybackMode } from '../sim/playback';
import { lengthLabel } from './match-length';
import { tr } from '../i18n';

/**
 * Broadcast overlay: score bug, clock, how the picture is running (live, condensed, decision), a match timeline with
 * goals and decision moments, the live ticker and the status line. Reads snapshots and events only.
 */
export class Hud {
  readonly el = document.createElement('div');
  private readonly score: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly ticker: HTMLElement;
  private readonly status: HTMLElement;
  private readonly mode: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly markers: HTMLElement;
  private readonly lines: string[] = [];
  /** Wall time until which the status line is shown. */
  private statusUntil = 0;

  constructor(private readonly halfMinutes: number) {
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud-bug">
        <span class="hud-team hud-home">${TEAMS[0].short}</span>
        <span class="hud-score" data-score>0 : 0</span>
        <span class="hud-team hud-away">${TEAMS[1].short}</span>
        <span class="hud-clock" data-clock>00:00</span>
        <span class="hud-length" data-length></span>
      </div>
      <div class="hud-mode" data-mode>LIVE</div>
      <div class="hud-timeline" aria-hidden="true"><span class="hud-progress" data-progress></span><span class="hud-half"></span><div data-markers></div></div>
      <div class="hud-ticker" data-ticker></div>
      <div class="hud-status" data-status></div>`;
    const q = (s: string) => this.el.querySelector<HTMLElement>(s)!;
    this.score = q('[data-score]'); this.clock = q('[data-clock]'); this.ticker = q('[data-ticker]'); this.status = q('[data-status]');
    this.mode = q('[data-mode]'); this.progress = q('[data-progress]'); this.markers = q('[data-markers]');
    // The playing time is always on screen: a shortened match is never shown as if it were the full 90 minutes.
    const length = lengthLabel(halfMinutes), tag = q('[data-length]');
    tag.textContent = length.short;
    tag.title = length.long;
    tag.dataset.full = String(length.full);
  }

  /** Match clock in minutes:seconds, counting on through the second half. */
  clockText(s: Pick<MatchSnapshot, 'clockSeconds' | 'half'>): string {
    const total = this.elapsed(s);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(Math.floor(total % 60)).padStart(2, '0')}`;
  }

  elapsed(s: Pick<MatchSnapshot, 'clockSeconds' | 'half'>): number {
    return Math.min(this.halfMinutes * 60, s.clockSeconds) + (s.half === 2 ? this.halfMinutes * 60 : 0);
  }

  update(s: MatchSnapshot, mode: PlaybackMode, speed: number, deciding: boolean, wall: number): void {
    if (this.statusUntil && wall > this.statusUntil) this.clearStatus();
    this.score.textContent = `${s.score[0]} : ${s.score[1]}`;
    this.clock.textContent = this.clockText(s);
    this.progress.style.width = `${(this.elapsed(s) / (this.halfMinutes * 120)) * 100}%`;
    const label = deciding ? tr('DECISION', 'ENTSCHEIDUNG') : mode === 'condensed' ? `${tr('CONDENSED', 'VERDICHTET')} ×${Math.round(speed)}` : speed > 1.5 ? `${tr('TIME-LAPSE', 'ZEITRAFFER')} ×${Math.round(speed)}` : 'LIVE';
    if (this.mode.textContent !== label) this.mode.textContent = label;
    this.mode.dataset.state = deciding ? 'decision' : speed > 1.5 ? 'fast' : 'live';
    this.el.classList.toggle('deciding', deciding);
  }

  /** A goal or a decision moment on the timeline, at the match second it happened. */
  mark(kind: 'goal' | 'moment', at: number, team: TeamId, title: string): void {
    const m = document.createElement('span');
    m.className = `hud-marker hud-marker-${kind} ${team === 0 ? 'home' : 'away'}`;
    m.style.left = `${(at / (this.halfMinutes * 120)) * 100}%`;
    m.title = title;
    this.markers.append(m);
  }

  /**
   * Shows a status line for `seconds` of wall time; a newer one replaces it. Without an end a line stayed for
   * minutes after the moment it described (measured in the browser test).
   */
  setStatus(text: string, wall: number, seconds: number): void {
    this.status.textContent = text;
    this.statusUntil = wall + seconds;
  }

  clearStatus(): void {
    this.status.textContent = '';
    this.statusUntil = 0;
  }

  log(text: string, clock: string): void {
    const line = document.createElement('div');
    const time = document.createElement('b');
    time.textContent = clock;
    line.append(time, document.createTextNode(text));
    this.lines.unshift(line.outerHTML);
    if (this.lines.length > 4) this.lines.length = 4;
    this.ticker.innerHTML = this.lines.join('');
  }
}
