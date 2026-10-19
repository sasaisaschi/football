import './hud.css';
import { TEAMS } from '../engine/rosters';
import type { MatchSnapshot } from '../engine/types';

/** Broadcast overlay: score bug, clock, live ticker and status line. Reads snapshots only. */
export class Hud {
  readonly el = document.createElement('div');
  private readonly score: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly ticker: HTMLElement;
  private readonly status: HTMLElement;
  private readonly speed: HTMLElement;
  private readonly lines: string[] = [];
  /** Wall time until which the status line is shown. */
  private statusUntil = 0;

  constructor(private readonly halfMinutes: number) {
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud-bug">
        <span class="hud-live">LIVE</span>
        <span class="hud-team hud-home">${TEAMS[0].short}</span>
        <span class="hud-score" data-score>0 : 0</span>
        <span class="hud-team hud-away">${TEAMS[1].short}</span>
        <span class="hud-clock" data-clock>00:00</span>
      </div>
      <div class="hud-speed" data-speed hidden></div>
      <div class="hud-ticker" data-ticker></div>
      <div class="hud-status" data-status></div>`;
    this.score = this.el.querySelector('[data-score]')!;
    this.clock = this.el.querySelector('[data-clock]')!;
    this.ticker = this.el.querySelector('[data-ticker]')!;
    this.status = this.el.querySelector('[data-status]')!;
    this.speed = this.el.querySelector('[data-speed]')!;
  }

  clockText(s: Pick<MatchSnapshot, 'clockSeconds' | 'half'>): string {
    const total = s.clockSeconds + (s.half === 2 ? this.halfMinutes * 60 : 0);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(Math.floor(total % 60)).padStart(2, '0')}`;
  }

  update(s: MatchSnapshot, timeScale: number, wall: number): void {
    if (this.statusUntil && wall > this.statusUntil) this.clearStatus();
    this.score.textContent = `${s.score[0]} : ${s.score[1]}`;
    this.clock.textContent = this.clockText(s);
    this.speed.hidden = timeScale <= 1;
    this.speed.textContent = `Zeitraffer x${timeScale}`;
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
    if (this.lines.length > 5) this.lines.length = 5;
    this.ticker.innerHTML = this.lines.join('');
  }
}
