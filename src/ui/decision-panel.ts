import './decision-panel.css';
import type { DecisionMoment } from '../engine/types';

/**
 * The twelfth man's moment: situation, executable options with an honest outlook, a countdown.
 * Keys 1–4 choose. If time runs out, the players do what they would have done anyway.
 */
export class DecisionPanel {
  readonly el = document.createElement('div');
  private moment: DecisionMoment | null = null;
  private deadline = 0;
  private readonly bar: HTMLElement;
  private readonly title: HTMLElement;
  private readonly situation: HTMLElement;
  private readonly options: HTMLElement;

  constructor(private readonly resolve: (optionId: string, by: 'user' | 'timeout') => void) {
    this.el.className = 'decision';
    this.el.hidden = true;
    this.el.innerHTML = '<div class="decision-card"><div class="decision-kicker">DEIN MOMENT &middot; DER ZWÖLFTE MANN</div><h2 data-title></h2><p data-situation></p><div class="decision-options" data-options></div><div class="decision-timer"><span data-bar></span></div></div>';
    this.bar = this.el.querySelector('[data-bar]')!;
    this.title = this.el.querySelector('[data-title]')!;
    this.situation = this.el.querySelector('[data-situation]')!;
    this.options = this.el.querySelector('[data-options]')!;
    window.addEventListener('keydown', ev => {
      const i = Number(ev.key) - 1;
      if (this.moment && Number.isInteger(i) && i >= 0 && i < this.moment.options.length) this.choose(this.moment.options[i].id, 'user');
    });
  }

  get open(): boolean {
    return this.moment !== null;
  }

  show(m: DecisionMoment, now: number): void {
    this.moment = m;
    this.deadline = now + m.timeoutSeconds;
    this.title.textContent = m.title;
    this.situation.textContent = m.situation;
    this.options.replaceChildren(...m.options.map((o, i) => {
      const b = document.createElement('button');
      b.className = 'decision-option';
      b.dataset.option = o.id;
      const part = (cls: string, text: string) => { const s = document.createElement('span'); s.className = cls; s.textContent = text; return s; };
      b.append(part('decision-key', String(i + 1)), part('decision-label', o.label), part('decision-detail', o.detail), part('decision-outlook', o.outlook));
      b.addEventListener('click', () => this.choose(o.id, 'user'));
      return b;
    }));
    this.el.hidden = false;
  }

  /** Called every frame with wall-clock seconds; the countdown runs in real time while the match is frozen. */
  tick(now: number): void {
    if (!this.moment) return;
    const left = Math.max(0, this.deadline - now);
    this.bar.style.width = `${(left / this.moment.timeoutSeconds) * 100}%`;
    if (left <= 0) this.choose(this.moment.defaultOptionId, 'timeout');
  }

  private choose(id: string, by: 'user' | 'timeout'): void {
    if (!this.moment) return;
    this.moment = null;
    this.el.hidden = true;
    this.resolve(id, by);
  }
}
