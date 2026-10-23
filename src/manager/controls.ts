import type { Abilities, PlayerProfile } from '../engine/types';
import { tr } from '../i18n';

/** A row of mutually exclusive buttons; `pick` is called with the chosen value (also for the initial one). */
export function choices<T>(host: Element, items: readonly (readonly [string, T])[], initial: T, pick: (v: T) => void): void {
  host.replaceChildren();
  for (const [label, value] of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('role', 'radio');
    const select = () => {
      host.querySelectorAll('button').forEach(x => { x.classList.remove('selected'); x.setAttribute('aria-checked', 'false'); });
      b.classList.add('selected');
      b.setAttribute('aria-checked', 'true');
      pick(value);
    };
    b.addEventListener('click', select);
    host.append(b);
    if (value === initial) select();
  }
}

/** The four numbers a coach reads first; keepers by their own craft. */
export function keyAbilities(p: PlayerProfile): [string, number][] {
  const a: Abilities = p.abilities;
  return p.role === 'GK'
    ? [[tr('REF', 'REF'), a.reflexes], [tr('HAN', 'HAN'), a.handling], [tr('POS', 'POS'), a.positioning], [tr('PAS', 'PAS'), a.passing]]
    : [[tr('PAC', 'TEM'), a.pace], [tr('PAS', 'PAS'), a.passing], [tr('SHO', 'SCH'), a.shooting], [tr('DEF', 'ZWK'), a.tackling]];
}

/** Ratings 0…1 shown as 0…99, the way squad screens do. */
export const rating = (v: number) => Math.round(v * 99);

/** Character traits worth naming (only clear ones, from the real trait values). */
export function traitTags(p: PlayerProfile): string[] {
  const t = p.traits, tags: string[] = [];
  if (t.risk > 0.65) tags.push(tr('risk-taker', 'risikofreudig'));
  if (t.risk < 0.3) tags.push(tr('safe', 'sicher'));
  if (t.discipline > 0.7) tags.push(tr('disciplined', 'diszipliniert'));
  if (t.teamplay > 0.7) tags.push(tr('team player', 'Teamspieler'));
  if (t.confidence > 0.7) tags.push(tr('confident', 'selbstbewusst'));
  return tags;
}

/** One squad row: number, name, position, the key ratings as bars, character tags. */
export function playerRow(p: PlayerProfile, extra = ''): HTMLElement {
  const row = document.createElement('div');
  row.className = 'mgr-player';
  row.dataset.player = String(p.id);
  row.innerHTML = `<span class="mgr-num"></span><span class="mgr-name"></span><span class="mgr-role"></span><span class="mgr-bars"></span><span class="mgr-tags"></span>${extra}`;
  row.querySelector('.mgr-num')!.textContent = String(p.number);
  row.querySelector('.mgr-name')!.textContent = p.name;
  row.querySelector('.mgr-role')!.textContent = p.role;
  const bars = row.querySelector('.mgr-bars')!;
  for (const [label, v] of keyAbilities(p)) {
    const b = document.createElement('span');
    b.className = 'mgr-bar';
    b.title = `${label} ${rating(v)}`;
    b.innerHTML = '<i></i><em></em>';
    b.querySelector('em')!.textContent = `${label} ${rating(v)}`;
    (b.querySelector('i') as HTMLElement).style.width = `${rating(v)}%`;
    bars.append(b);
  }
  row.querySelector('.mgr-tags')!.textContent = traitTags(p).join(' · ');
  return row;
}
