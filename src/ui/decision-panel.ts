import './decision-panel.css';
import type { DecisionMoment, DecisionSource, MatchSnapshot, MomentCategory, PlayerProfile } from '../engine/types';
import { tr } from '../i18n';
import type { MomentBrief } from '../intel/moment-brief';

const CATEGORY = (c: MomentCategory): string => ({ attack: tr('Attack', 'Angriff'), transition: tr('Transition', 'Umschalten'), defence: tr('Defence', 'Abwehr'), 'set-piece': tr('Set piece', 'Standard'), coach: tr('Coach', 'Trainer') })[c];
const ACTION = (a: string): string => ({ pass: tr('Pass', 'Pass'), dribble: tr('Dribble', 'Dribbling'), shot: tr('Shot', 'Schuss') } as Record<string, string>)[a];

/** Words for a trait value, only for the clear ends of the scale. */
function traitWords(p: PlayerProfile): string[] {
  const t = p.traits, out: string[] = [];
  if (t.risk > 0.62) out.push(tr('risk-taker', 'risikofreudig')); else if (t.risk < 0.38) out.push(tr('cautious', 'vorsichtig'));
  if (t.teamplay > 0.62) out.push(tr('team player', 'mannschaftsdienlich')); else if (t.teamplay < 0.38) out.push(tr('selfish', 'eigensinnig'));
  if (t.discipline > 0.62) out.push(tr('disciplined', 'diszipliniert')); else if (t.discipline < 0.38) out.push(tr('unpredictable', 'unberechenbar'));
  return out;
}

/**
 * The twelfth man's moment, as a slim side panel (bottom sheet on narrow screens) that leaves the scene free: what the
 * situation is, who acts (with his form from this match's real actions), and the executable options with an honest
 * outlook. Keys 1–4 choose, ↑/↓ move the focus (the 3D markings follow), Enter takes the focused one, 0 hands the
 * moment to the players. If the countdown runs out, the players do what they would have done anyway.
 */
export class DecisionPanel {
  readonly el = document.createElement('aside');
  private moment: DecisionMoment | null = null;
  private deadline = 0;
  private focusIndex = 0;
  private readonly bar: HTMLElement;
  private readonly seconds: HTMLElement;
  private readonly kicker: HTMLElement;
  private readonly title: HTMLElement;
  private readonly lastKey: HTMLElement;
  private readonly situation: HTMLElement;
  private readonly why: HTMLElement;
  private readonly actor: HTMLElement;
  private readonly options: HTMLElement;

  constructor(private readonly resolve: (optionId: string, by: DecisionSource) => void, private readonly onFocus: (index: number) => void) {
    this.el.className = 'decision';
    this.el.hidden = true;
    this.el.setAttribute('aria-label', tr('Decision', 'Entscheidung'));
    this.el.innerHTML = `
      <header class="decision-head"><span class="decision-kicker" data-kicker></span><span class="decision-seconds" data-seconds></span></header>
      <div class="decision-timer"><span data-bar></span></div>
      <h2 data-title></h2>
      <p class="decision-situation" data-situation></p>
      <section class="decision-why" data-why hidden><h3></h3><ul></ul></section>
      <div class="decision-actor" data-actor></div>
      <div class="decision-options" role="listbox" data-options></div>
      <footer class="decision-foot">
        <button class="decision-delegate" data-delegate type="button">${tr('Leave it to the players', 'Den Spielern überlassen')} <kbd>0</kbd></button>
        <span class="decision-keys"><kbd>1</kbd>–<kbd data-last-key>4</kbd> ${tr('choose', 'wählen')} · <kbd>↑</kbd><kbd>↓</kbd> + <kbd>Enter</kbd></span>
      </footer>`;
    const q = (s: string) => this.el.querySelector<HTMLElement>(s)!;
    this.bar = q('[data-bar]'); this.seconds = q('[data-seconds]'); this.kicker = q('[data-kicker]');
    this.lastKey = q('[data-last-key]');
    this.why = q('[data-why]');
    this.title = q('[data-title]'); this.situation = q('[data-situation]'); this.actor = q('[data-actor]'); this.options = q('[data-options]');
    q('[data-delegate]').addEventListener('click', () => this.delegate());
    window.addEventListener('keydown', ev => this.key(ev));
  }

  get open(): boolean {
    return this.moment !== null;
  }

  /** Width the panel takes from the right edge (desktop) or height from the bottom (narrow), in CSS pixels. */
  footprint(): { right: number; bottom: number } {
    if (this.el.hidden) return { right: 0, bottom: 0 };
    // Layout box, not the animated one: while sliding in, the panel is still offset by its entry animation.
    const host = this.el.offsetParent as HTMLElement | null;
    const w = host?.clientWidth ?? window.innerWidth, h = host?.clientHeight ?? window.innerHeight;
    const narrow = this.el.offsetWidth > w * 0.8;
    return narrow ? { right: 0, bottom: h - this.el.offsetTop } : { right: w - this.el.offsetLeft, bottom: 0 };
  }

  /** `brief`: the match intelligence's explanation of the moment (intel/moment-brief.ts), measured in the frozen frame. */
  show(m: DecisionMoment, now: number, s: MatchSnapshot, profiles: PlayerProfile[], brief?: MomentBrief): void {
    this.moment = m;
    this.deadline = now + m.timeoutSeconds;
    this.kicker.textContent = `${CATEGORY(m.category)} · ${tr('Your moment', 'Dein Moment')}`;
    this.title.textContent = m.title;
    this.lastKey.textContent = String(m.options.length);
    this.situation.textContent = m.situation;
    this.renderActor(profiles[m.focusPlayer], s.minds[m.focusPlayer]);
    this.why.hidden = !brief?.lines.length;
    this.why.querySelector('h3')!.textContent = tr('Why it matters', 'Warum es zählt');
    this.why.querySelector('ul')!.replaceChildren(...(brief?.lines ?? []).map(l => { const li = document.createElement('li'); li.textContent = l; return li; }));
    this.options.replaceChildren(...m.options.map((o, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'decision-option';
      b.dataset.option = o.id;
      b.setAttribute('role', 'option');
      const part = (cls: string, text: string) => { const e = document.createElement('span'); e.className = cls; e.textContent = text; return e; };
      b.append(part('decision-key', String(i + 1)), part('decision-label', o.label), part('decision-detail', o.detail), part('decision-outlook', o.outlook));
      const facts = brief?.options.find(x => x.id === o.id);
      if (facts?.note) {
        const f = part('decision-facts', facts.note);
        if (facts.risk) f.dataset.risk = facts.risk;
        b.append(f);
      }
      if (o.id === m.defaultOptionId) b.append(part('decision-ai', tr('What the players would do', 'Tendenz der Spieler')));
      b.addEventListener('click', () => this.choose(o.id, 'user'));
      b.addEventListener('mouseenter', () => this.setFocus(i));
      b.addEventListener('focus', () => this.setFocus(i));
      return b;
    }));
    this.el.hidden = false;
    this.setFocus(Math.max(0, m.options.findIndex(o => o.id === m.defaultOptionId)));
  }

  private renderActor(p: PlayerProfile, mind: MatchSnapshot['minds'][number] | undefined): void {
    const conf = mind?.confidence ?? p.traits.confidence;
    const level = conf > 0.62 ? tr('high', 'hoch') : conf < 0.4 ? tr('low', 'niedrig') : tr('normal', 'normal');
    const recent = mind?.recent ?? [];
    const ok = recent.filter(r => r.ok).length;
    this.actor.replaceChildren();
    const name = document.createElement('div');
    name.className = 'decision-actor-name';
    name.innerHTML = `<b></b><span></span>`;
    name.querySelector('b')!.textContent = `${p.number} · ${p.name}`;
    name.querySelector('span')!.textContent = p.role;
    const form = document.createElement('div');
    form.className = 'decision-form';
    const meter = document.createElement('span');
    meter.className = 'decision-meter';
    meter.style.setProperty('--level', `${Math.round(conf * 100)}%`);
    const text = document.createElement('span');
    // The form line names only what happened: his judged actions in this match.
    text.textContent = recent.length ? tr(`Confidence ${level} · ${ok} of ${recent.length} actions succeeded`, `Selbstvertrauen ${level} · ${ok} von ${recent.length} Aktionen gelungen`) : tr(`Confidence ${level} · no judged action yet`, `Selbstvertrauen ${level} · noch keine bewertete Aktion`);
    form.append(meter, text);
    const marks = document.createElement('div');
    marks.className = 'decision-recent';
    for (const r of recent) {
      const s = document.createElement('span');
      s.className = r.ok ? 'ok' : 'miss';
      s.title = `${ACTION(r.action)} ${r.ok ? tr('succeeded', 'gelungen') : tr('failed', 'misslungen')}`;
      s.textContent = ACTION(r.action)[0];
      marks.append(s);
    }
    const traits = document.createElement('div');
    traits.className = 'decision-traits';
    for (const w of traitWords(p)) { const t = document.createElement('span'); t.textContent = w; traits.append(t); }
    this.actor.append(name, form, marks, traits);
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
    if (ev.key === '0') { this.delegate(); return; }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const n = m.options.length;
      this.setFocus((this.focusIndex + (ev.key === 'ArrowDown' ? 1 : n - 1)) % n);
      return;
    }
    if (ev.key === 'Enter') { ev.preventDefault(); this.choose(m.options[this.focusIndex].id, 'user'); return; }
    const i = Number(ev.key) - 1;
    if (Number.isInteger(i) && i >= 0 && i < m.options.length) this.choose(m.options[i].id, 'user');
  }

  /** Called every frame with wall-clock seconds; the countdown runs in real time while the match is frozen. */
  tick(now: number): void {
    if (!this.moment) return;
    const left = Math.max(0, this.deadline - now);
    this.bar.style.width = `${(left / this.moment.timeoutSeconds) * 100}%`;
    this.seconds.textContent = `${Math.ceil(left)} s`;
    if (left <= 0) this.choose(this.moment.defaultOptionId, 'timeout');
  }

  /** The user hands the moment back to the players: they do what they would have done anyway. */
  private delegate(): void {
    if (this.moment) this.choose(this.moment.defaultOptionId, 'delegated');
  }

  private choose(id: string, by: DecisionSource): void {
    if (!this.moment) return;
    this.moment = null;
    this.el.hidden = true;
    this.resolve(id, by);
  }
}
