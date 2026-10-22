import './consequence.css';
import { TEAMS } from '../engine/rosters';
import type { DecisionMoment, DecisionSource, MatchEvent, PlayerProfile, TeamId } from '../engine/types';

const RESTART: Record<string, string> = { 'throw-in': 'Einwurf', corner: 'Ecke', 'goal-kick': 'Abstoß', 'free-kick': 'Freistoß', penalty: 'Elfmeter', kickoff: 'Anstoß', 'drop-ball': 'Schiedsrichterball' };
const SWING: Record<string, string> = { pass: 'spielt den Pass', shot: 'schließt ab', dribble: 'geht ins Dribbling', throw: 'wirft ein', header: 'köpft', tackle: 'geht in den Zweikampf', clear: 'klärt', control: 'nimmt den Ball an' };
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
    this.el.innerHTML = '<div class="consequence-kicker">Deine Entscheidung</div><h3 data-head></h3><ol data-lines></ol>';
    this.head = this.el.querySelector('[data-head]')!;
    this.list = this.el.querySelector('[data-lines]')!;
  }

  /** `possession`: the team with the ball when the moment opened (a defensive moment is settled by winning it back). */
  start(m: DecisionMoment, optionId: string, by: DecisionSource, clock: string, time: number, possession: TeamId | null): void {
    this.finish('Danach ging es ohne klares Ergebnis weiter.');
    const option = m.options.find(o => o.id === optionId)!;
    const who = by === 'user' ? '' : by === 'delegated' ? ' (den Spielern überlassen)' : ' (Zeit abgelaufen)';
    const defending = possession !== null && possession !== m.team;
    this.current = { clock, title: m.title, choice: option.label, by, lines: [], result: '', team: m.team, since: time, lastHolder: possession, opponentTouches: 0, defending, shot: false };
    this.head.textContent = `${option.label}${who}`;
    this.list.replaceChildren();
    this.el.hidden = false;
    this.el.classList.remove('done');
    this.hideAt = Infinity;
    // A coach's instruction has no single ball event to follow: it shapes the rest of the half.
    const fx = option.effect;
    if (m.category === 'coach') this.finish(fx.type === 'substitution' ? `${this.name(fx.on)} kommt an der Mittellinie für ${this.name(fx.off)}.` : fx.type === 'none' ? 'Die Mannschaft spielt weiter wie bisher.' : 'Die Vorgabe gilt ab jetzt für die ganze zweite Halbzeit.');
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
    if (e.time - c.since > FOLLOW) { this.finish('Danach ging es ohne klares Ergebnis weiter.'); return; }
    const teamOf = (id: number) => this.profiles[id].team;
    const ours = (t: TeamId) => (t === c.team ? 'uns' : 'den Gegner');
    switch (e.type) {
      case 'swing':
        if (e.source === 'user' || (c.lines.length === 0 && teamOf(e.player) === c.team)) this.line(`${this.name(e.player)} ${SWING[e.action] ?? 'spielt den Ball'}.`);
        if (teamOf(e.player) === c.team && e.action === 'shot') c.shot = true;
        else if (c.defending && e.action === 'shot') this.line(`${this.name(e.player)} (Gegner) schießt.`);
        return;
      case 'touch': {
        const t = teamOf(e.player);
        if (c.defending) {
          // Defending: the opponents keep playing until one of us gets a touch on the ball.
          if (t === c.team) { this.line(`${this.name(e.player)} kommt an den Ball.`); this.finish(e.part === 'hands' ? 'Der Torwart hat den Ball.' : 'Ball erobert oder abgewehrt.'); }
          return;
        }
        // Our shot met by the opponents: the keeper's save or a defender's block, named as such.
        if (c.shot && t !== c.team) { this.finish(this.profiles[e.player].role === 'GK' ? `${this.name(e.player)} wehrt den Schuss ab.` : `Schuss geblockt von ${this.name(e.player)}.`); return; }
        if (t !== c.team) c.opponentTouches++;
        if (t !== c.lastHolder) this.line(t === c.team ? `Ball bei ${this.name(e.player)}.` : `${this.name(e.player)} (Gegner) ist am Ball.`);
        c.lastHolder = t;
        if (c.opponentTouches >= 2) this.finish('Der Gegner hat den Ball.');
        return;
      }
      case 'catch': this.line(`${this.name(e.player)} fängt den Ball.`); this.finish(teamOf(e.player) === c.team ? 'Ball gesichert.' : 'Der Torwart hält.'); return;
      case 'goal': this.finish(e.team === c.team ? `TOR für ${TEAMS[e.team].name}!` : `Gegentor – ${TEAMS[e.team].name} trifft.`); return;
      case 'out': this.finish(`Ball im Aus – ${RESTART[e.restart]} für ${ours(e.team)}.`); return;
      case 'foul': this.finish(`Foul von ${this.name(e.offender)}${e.penalty ? ' – Elfmeter' : ''}${e.card !== 'none' ? (e.card === 'yellow' ? ', Gelb' : ', Rot') : ''}.`); return;
      case 'offside': this.finish(`Abseits – ${this.name(e.player)}.`); return;
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

  /** Wall-clock housekeeping: the card stays a few seconds after its result. */
  tick(wall: number): void {
    if (this.hideAt === -1) this.hideAt = wall + 6;
    if (!this.el.hidden && wall > this.hideAt) this.el.hidden = true;
  }
}
