import './consequence.css';
import { TEAMS } from '../engine/rosters';
import type { DecisionMoment, DecisionSource, MatchEvent, PlayerProfile, TeamId } from '../engine/types';
import { tr } from '../i18n';
import { restartName } from './commentary';

const SWING = (action: string): string => ({
  pass: tr('plays the pass', 'spielt den Pass'), shot: tr('shoots', 'schließt ab'), dribble: tr('takes him on', 'geht ins Dribbling'), throw: tr('throws in', 'wirft ein'),
  header: tr('heads it', 'köpft'), tackle: tr('goes into the tackle', 'geht in den Zweikampf'), clear: tr('clears', 'klärt'), control: tr('controls the ball', 'nimmt den Ball an'),
} as Record<string, string>)[action] ?? tr('plays the ball', 'spielt den Ball');
const NO_RESULT = () => tr('Play went on without a clear result.', 'Danach ging es ohne klares Ergebnis weiter.');
/** How long after a decision its immediate consequences are followed (simulated seconds). */
const FOLLOW = 12;

/** One decision and what was observed right after it – shown live, kept for the final chronicle. */
export type ChronicleEntry = { clock: string; title: string; choice: string; by: DecisionSource; lines: string[]; result: string };

/**
 * Follows the events after a decision and tells them as they happen: who played the ball, who got it next, what the
 * referee gave. It only names observed events; when the follow-up window ends without a clear result it says so
 * neutrally instead of claiming that the decision caused whatever came later.
 */
export class ConsequenceCard {
  readonly el = document.createElement('section');
  readonly chronicle: ChronicleEntry[] = [];
  private current: (ChronicleEntry & { team: TeamId; since: number; lastHolder: TeamId | null; opponentTouches: number; defending: boolean; shot: boolean }) | null = null;
  private hideAt = 0;
  private readonly list: HTMLElement;
  private readonly head: HTMLElement;

  constructor(private readonly profiles: readonly PlayerProfile[]) {
    this.el.className = 'consequence';
    this.el.hidden = true;
    this.el.innerHTML = '<div class="consequence-kicker"></div><h3 data-head></h3><ol data-lines></ol>';
    this.el.querySelector('.consequence-kicker')!.textContent = tr('Your decision', 'Deine Entscheidung');
    this.head = this.el.querySelector('[data-head]')!;
    this.list = this.el.querySelector('[data-lines]')!;
  }

  /** `possession`: the team with the ball when the moment opened (a defensive moment is settled by winning it back). */
  start(m: DecisionMoment, optionId: string, by: DecisionSource, clock: string, time: number, possession: TeamId | null): void {
    this.finish(NO_RESULT());
    const option = m.options.find(o => o.id === optionId)!;
    const who = by === 'user' ? '' : by === 'delegated' ? tr(' (left to the players)', ' (den Spielern überlassen)') : tr(' (time ran out)', ' (Zeit abgelaufen)');
    const defending = possession !== null && possession !== m.team;
    this.current = { clock, title: m.title, choice: option.label, by, lines: [], result: '', team: m.team, since: time, lastHolder: possession, opponentTouches: 0, defending, shot: false };
    this.head.textContent = `${option.label}${who}`;
    this.list.replaceChildren();
    this.el.hidden = false;
    this.el.classList.remove('done');
    this.hideAt = Infinity;
    // A coach's instruction has no single ball event to follow: it shapes the rest of the half.
    const fx = option.effect;
    if (m.category === 'coach') this.finish(fx.type === 'substitution' ? tr(`${this.name(fx.on)} comes on at the halfway line for ${this.name(fx.off)}.`, `${this.name(fx.on)} kommt an der Mittellinie für ${this.name(fx.off)}.`) : fx.type === 'none' ? tr('The team carries on as before.', 'Die Mannschaft spielt weiter wie bisher.') : tr('The instruction now holds for the whole second half.', 'Die Vorgabe gilt ab jetzt für die ganze zweite Halbzeit.'));
  }

  /** Is a decision's consequence still being followed (no result yet)? */
  get following(): boolean {
    return this.current !== null;
  }

  private name(id: number): string {
    return `${this.profiles[id].name} (${this.profiles[id].number})`;
  }

  private line(text: string): void {
    const c = this.current;
    if (!c || c.lines[c.lines.length - 1] === text) return;
    c.lines.push(text);
    const li = document.createElement('li');
    li.textContent = text;
    this.list.append(li);
    while (this.list.children.length > 5) this.list.firstElementChild!.remove();
  }

  onEvent(e: MatchEvent): void {
    const c = this.current;
    if (!c) return;
    if (e.time - c.since > FOLLOW) { this.finish(NO_RESULT()); return; }
    const teamOf = (id: number) => this.profiles[id].team;
    const ours = (t: TeamId) => (t === c.team ? tr('us', 'uns') : tr('the opponents', 'den Gegner'));
    switch (e.type) {
      case 'swing':
        if (e.source === 'user' || (c.lines.length === 0 && teamOf(e.player) === c.team)) this.line(`${this.name(e.player)} ${SWING(e.action)}.`);
        if (teamOf(e.player) === c.team && e.action === 'shot') c.shot = true;
        else if (c.defending && e.action === 'shot') this.line(tr(`${this.name(e.player)} (opponent) shoots.`, `${this.name(e.player)} (Gegner) schießt.`));
        return;
      case 'touch': {
        const t = teamOf(e.player);
        if (c.defending) {
          // Defending: the opponents keep playing until one of us gets a touch on the ball.
          if (t === c.team) { this.line(tr(`${this.name(e.player)} gets to the ball.`, `${this.name(e.player)} kommt an den Ball.`)); this.finish(e.part === 'hands' ? tr('The keeper has the ball.', 'Der Torwart hat den Ball.') : tr('Ball won or cleared.', 'Ball erobert oder abgewehrt.')); }
          return;
        }
        // Our shot met by the opponents: the keeper's save or a defender's block, named as such.
        if (c.shot && t !== c.team) { this.finish(this.profiles[e.player].role === 'GK' ? tr(`${this.name(e.player)} saves the shot.`, `${this.name(e.player)} wehrt den Schuss ab.`) : tr(`Shot blocked by ${this.name(e.player)}.`, `Schuss geblockt von ${this.name(e.player)}.`)); return; }
        if (t !== c.team) c.opponentTouches++;
        if (t !== c.lastHolder) this.line(t === c.team ? tr(`Ball with ${this.name(e.player)}.`, `Ball bei ${this.name(e.player)}.`) : tr(`${this.name(e.player)} (opponent) has the ball.`, `${this.name(e.player)} (Gegner) ist am Ball.`));
        c.lastHolder = t;
        if (c.opponentTouches >= 2) this.finish(tr('The opponents have the ball.', 'Der Gegner hat den Ball.'));
        return;
      }
      case 'catch': this.line(tr(`${this.name(e.player)} catches the ball.`, `${this.name(e.player)} fängt den Ball.`)); this.finish(teamOf(e.player) === c.team ? tr('Ball secured.', 'Ball gesichert.') : tr('The keeper holds it.', 'Der Torwart hält.')); return;
      case 'goal': this.finish(e.team === c.team ? tr(`GOAL for ${TEAMS[e.team].name}!`, `TOR für ${TEAMS[e.team].name}!`) : tr(`Goal conceded – ${TEAMS[e.team].name} score.`, `Gegentor – ${TEAMS[e.team].name} trifft.`)); return;
      case 'out': this.finish(tr(`Out of play – ${restartName(e.restart)} to ${ours(e.team)}.`, `Ball im Aus – ${restartName(e.restart)} für ${ours(e.team)}.`)); return;
      case 'foul': this.finish(`${tr('Foul by', 'Foul von')} ${this.name(e.offender)}${e.penalty ? tr(' – penalty', ' – Elfmeter') : ''}${e.card !== 'none' ? (e.card === 'yellow' ? tr(', yellow card', ', Gelb') : tr(', red card', ', Rot')) : ''}.`); return;
      case 'offside': this.finish(tr(`Offside – ${this.name(e.player)}.`, `Abseits – ${this.name(e.player)}.`)); return;
      default:
    }
  }

  private finish(result: string): void {
    const c = this.current;
    if (!c) return;
    c.result = result;
    this.line(result);
    this.chronicle.push({ clock: c.clock, title: c.title, choice: c.choice, by: c.by, lines: [...c.lines], result });
    this.current = null;
    this.el.classList.add('done');
    this.hideAt = -1; // hide after a while of wall time, see tick()
  }

  /** Off screen at once (the scene is over); a consequence still being followed keeps being followed. */
  hide(): void {
    this.el.hidden = true;
  }

  /** Wall-clock housekeeping: the card stays a few seconds after its result. */
  tick(wall: number): void {
    if (this.hideAt === -1) this.hideAt = wall + 6;
    if (!this.el.hidden && wall > this.hideAt) this.el.hidden = true;
  }
}
