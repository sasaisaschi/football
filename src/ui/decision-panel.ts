import './decision-panel.css';
import type { DecisionMoment, DecisionSource, MatchSnapshot, PlayerProfile } from '../engine/types';
import { tr } from '../i18n';
import type { MomentBrief } from '../intel/moment-brief';
import { ICONS } from '../render/hud-icons';
import { markKind } from '../render/tactical-overlay';

/**
 * The twelfth man's moment as the bottom bar of the client's reference picture: on the left the acting player's card
 * (a live render of him from the frozen scene, number, name, and under it the time left to decide), in the middle the
 * question, then one card per executable option: its key in a circle, its words, its symbol and a live render of what
 * it aims at (the receiver, the goal). Colours follow the option's marking on the pitch: blue for a pass, yellow for a
 * shot. Keys 1–n choose, ←/→ (or ↑/↓) move the focus, Enter takes it, 0 leaves the moment to the players. If the time
 * runs out the players do what they would have done anyway.
 */
export class DecisionPanel {
  readonly el = document.createElement('aside');
  private moment: DecisionMoment | null = null;
  private deadline = 0;
  private focusIndex = 0;
  private readonly bar: HTMLElement;
  private readonly question: HTMLElement;
  private readonly options: HTMLElement;
  private readonly portrait: HTMLElement;
  private readonly number: HTMLElement;
  private readonly name: HTMLElement;
  /** The match intelligence's explanation of the moment and the player's form, for the toolbar's player panel. */
  brief: { title: string; lines: string[] } | null = null;

  constructor(private readonly resolve: (optionId: string, by: DecisionSource) => void, private readonly onFocus: (index: number) => void) {
    this.el.className = 'decision';
    this.el.hidden = true;
    this.el.setAttribute('aria-label', tr('Decision', 'Entscheidung'));
    this.el.innerHTML = `
      <div class="decision-card">
        <span class="decision-portrait" data-portrait></span>
        <span class="decision-who"><b data-number></b><strong data-name></strong><span class="decision-time" title="${tr('Time left to decide', 'Zeit für die Entscheidung')}"><i data-bar></i></span></span>
      </div>
      <h2 class="decision-question" data-question></h2>
      <div class="decision-options" role="listbox" data-options></div>`;
    const q = (s: string) => this.el.querySelector<HTMLElement>(s)!;
    this.bar = q('[data-bar]'); this.question = q('[data-question]'); this.options = q('[data-options]');
    this.portrait = q('[data-portrait]'); this.number = q('[data-number]'); this.name = q('[data-name]');
    window.addEventListener('keydown', ev => this.key(ev));
  }

  get open(): boolean {
    return this.moment !== null;
  }

  /** Space the bar takes from the bottom of the picture (CSS pixels); nothing on the right. */
  footprint(): { right: number; bottom: number } {
    if (this.el.hidden) return { right: 0, bottom: 0 };
    const host = this.el.offsetParent as HTMLElement | null;
    const h = host?.clientHeight ?? window.innerHeight;
    return { right: 0, bottom: h - this.el.offsetTop };
  }

  /** `brief`: the match intelligence's explanation of the moment (intel/moment-brief.ts), measured in the frozen frame. */
  show(m: DecisionMoment, now: number, s: MatchSnapshot, profiles: PlayerProfile[], brief?: MomentBrief): void {
    this.moment = m;
    this.deadline = now + m.timeoutSeconds;
    const p = profiles[m.focusPlayer];
    this.number.textContent = String(p.number);
    this.name.textContent = p.name.toUpperCase();
    this.portrait.replaceChildren();
    // Every option a ball action of the acting player: the reference's question; otherwise the moment's own title.
    const ballOnly = m.options.every(o => o.effect.type === 'player' && o.effect.intent.type === 'ball');
    this.question.textContent = ballOnly ? tr('How do you play the ball?', 'Wie spielst du den Ball?') : m.title;
    this.brief = this.playerBrief(m, s, p, brief);
    this.options.style.setProperty('--n', String(m.options.length));
    this.options.replaceChildren(...m.options.map((o, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'decision-option';
      const kind = markKind(o);
      b.dataset.kind = kind;
      b.dataset.option = o.id;
      b.setAttribute('role', 'option');
      // The detail and the outlook stay available on hover; the card itself shows what the reference shows.
      b.title = [o.detail, o.outlook, o.id === m.defaultOptionId ? tr('What the players would do', 'Tendenz der Spieler') : ''].filter(Boolean).join(' · ');
      const part = (cls: string, text: string) => { const e = document.createElement('span'); e.className = cls; e.textContent = text; return e; };
      const icon = document.createElement('span');
      icon.className = 'decision-icon';
      icon.innerHTML = kind === 'shot' ? ICONS.shot : kind === 'carry' ? ICONS.carry : kind === 'pass' ? ICONS.pass : '';
      const thumb = document.createElement('span');
      thumb.className = 'decision-thumb';
      b.append(part('decision-key', String(i + 1)), part('decision-label', o.label), icon, thumb);
      b.addEventListener('click', () => this.choose(o.id, 'user'));
      b.addEventListener('mouseenter', () => this.setFocus(i));
      b.addEventListener('focus', () => this.setFocus(i));
      return b;
    }));
    this.el.hidden = false;
    this.setFocus(Math.max(0, m.options.findIndex(o => o.id === m.defaultOptionId)));
  }

  /** The live renders from the frozen scene: the acting player, and per option what it aims at. */
  setPictures(portrait: HTMLCanvasElement | null, thumbs: Map<string, HTMLCanvasElement>): void {
    if (portrait) this.portrait.replaceChildren(portrait);
    this.options.querySelectorAll<HTMLElement>('.decision-option').forEach(b => {
      const c = thumbs.get(b.dataset.option!);
      if (c) b.querySelector('.decision-thumb')!.replaceChildren(c);
    });
  }

  private playerBrief(m: DecisionMoment, s: MatchSnapshot, p: PlayerProfile, brief?: MomentBrief): { title: string; lines: string[] } {
    const mind = s.minds[p.id];
    const conf = mind?.confidence ?? p.traits.confidence;
    const level = conf > 0.62 ? tr('high', 'hoch') : conf < 0.4 ? tr('low', 'niedrig') : tr('normal', 'normal');
    const recent = mind?.recent ?? [];
    const ok = recent.filter(r => r.ok).length;
    const lines = [m.situation,
      recent.length ? tr(`Confidence ${level} · ${ok} of ${recent.length} actions succeeded`, `Selbstvertrauen ${level} · ${ok} von ${recent.length} Aktionen gelungen`) : tr(`Confidence ${level} · no judged action yet`, `Selbstvertrauen ${level} · noch keine bewertete Aktion`),
      ...(brief?.lines ?? []),
      ...m.options.map((o, i) => `${i + 1}: ${o.outlook}`)];
    return { title: `${p.number} · ${p.name} (${p.role})`, lines };
  }

  private setFocus(i: number): void {
    if (!this.moment) return;
    this.focusIndex = i;
    this.options.querySelectorAll('.decision-option').forEach((b, j) => b.classList.toggle('focused', j === i));
    this.onFocus(i);
  }

  private key(ev: KeyboardEvent): void {
    const m = this.moment;
    if (!m) return;
    if (ev.key === '0') { this.choose(m.defaultOptionId, 'delegated'); return; }
    const n = m.options.length;
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(ev.key)) {
      ev.preventDefault();
      this.setFocus((this.focusIndex + (ev.key === 'ArrowDown' || ev.key === 'ArrowRight' ? 1 : n - 1)) % n);
      return;
    }
    if (ev.key === 'Enter') { ev.preventDefault(); this.choose(m.options[this.focusIndex].id, 'user'); return; }
    const i = Number(ev.key) - 1;
    if (Number.isInteger(i) && i >= 0 && i < n) this.choose(m.options[i].id, 'user');
  }

  /** Called every frame with wall-clock seconds; the time runs in real time while the match is frozen. */
  tick(now: number): void {
    if (!this.moment) return;
    const left = Math.max(0, this.deadline - now);
    this.bar.style.width = `${(left / this.moment.timeoutSeconds) * 100}%`;
    if (left <= 0) this.choose(this.moment.defaultOptionId, 'timeout');
  }

  private choose(id: string, by: DecisionSource): void {
    if (!this.moment) return;
    this.moment = null;
    this.el.hidden = true;
    this.brief = null;
    this.resolve(id, by);
  }
}
