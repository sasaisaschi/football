import './result-screen.css';
import { TEAMS } from '../engine/rosters';
import type { ChronicleEntry } from './consequence';
import { playerKey, type AgentMemory } from '../ai/agent-memory';
import type { PlayerProfile, TeamId } from '../engine/types';

/** The players' memory before and after this match, for the "development" lines. */
export type Development = { before: AgentMemory | null; after: AgentMemory | null; profiles: readonly PlayerProfile[]; team: TeamId; error: string | null };

/** Measured at the end: the user's wall-clock time, the worker's computing time, the simulated match time. */
export type SessionMetrics = { wallSeconds: number; cpuSeconds: number; simSeconds: number; moments: number };

const BY: Record<ChronicleEntry['by'], string> = { user: 'du', delegated: 'überlassen', timeout: 'Zeit abgelaufen' };
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Full time: the score, every decision with what was observed right after it, and how long the session took. */
export function showResult(host: HTMLElement, score: readonly [number, number], chronicle: readonly ChronicleEntry[], metrics: SessionMetrics, dev: Development): HTMLElement {
  const el = document.createElement('div');
  el.className = 'result';
  el.innerHTML = `
    <div class="result-card">
      <div class="result-kicker">Abpfiff</div>
      <div class="result-score"><span class="home"></span><b data-score></b><span class="away"></span></div>
      <dl class="result-metrics" data-metrics></dl>
      <h3>Deine Entscheidungen</h3>
      <ol class="result-list" data-list></ol>
      <h3>Was die Spieler mitnehmen</h3>
      <ul class="result-development" data-dev></ul>
      <button type="button" data-again>Neues Spiel</button>
    </div>`;
  el.querySelector('.home')!.textContent = TEAMS[0].name;
  el.querySelector('.away')!.textContent = TEAMS[1].name;
  el.querySelector('[data-score]')!.textContent = `${score[0]} : ${score[1]}`;
  const list = el.querySelector('[data-list]')!;
  if (chronicle.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'In dieser Partie gab es keinen Entscheidungsmoment.';
    list.append(li);
  }
  for (const c of chronicle) {
    const li = document.createElement('li');
    const head = document.createElement('div');
    head.className = 'result-head';
    head.innerHTML = '<span class="result-clock"></span><b></b><span class="result-by"></span>';
    head.querySelector('.result-clock')!.textContent = c.clock;
    head.querySelector('b')!.textContent = `${c.title} – ${c.choice}`;
    head.querySelector('.result-by')!.textContent = BY[c.by];
    const result = document.createElement('div');
    result.className = 'result-outcome';
    result.textContent = c.result;
    li.append(head, result);
    list.append(li);
  }
  const dl = el.querySelector('[data-metrics]')!;
  for (const [k, v] of [['Deine Zeit', mmss(metrics.wallSeconds)], ['Simulierte Spielzeit', mmss(metrics.simSeconds)], ['Rechenzeit', mmss(metrics.cpuSeconds)], ['Momente', String(metrics.moments)]]) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.append(dt, dd);
  }
  const devList = el.querySelector('[data-dev]')!;
  for (const line of developmentLines(dev)) {
    const li = document.createElement('li');
    li.textContent = line;
    devList.append(li);
  }
  el.querySelector('[data-again]')!.addEventListener('click', () => location.reload());
  host.append(el);
  return el;
}

/** The biggest changes in baseline confidence and the strongest new trust within the user's team, from the memory. */
function developmentLines(d: Development): string[] {
  if (d.error) return [d.error];
  if (!d.after) return ['Kein Spielergedächtnis in dieser Partie.'];
  const ours = d.profiles.filter(p => p.team === d.team);
  const changes = ours.map(p => {
    const key = playerKey(p);
    const before = d.before?.players[key]?.baseline ?? p.traits.confidence;
    const after = d.after!.players[key]?.baseline ?? before;
    return { p, delta: after - before };
  }).filter(c => Math.abs(c.delta) >= 0.005).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3);
  const lines = changes.map(c => `${c.p.name}: Grund-Selbstvertrauen ${c.delta > 0 ? 'steigt' : 'sinkt'} um ${Math.abs(c.delta * 100).toFixed(1)} Punkte`);
  let bond: { a: PlayerProfile; b: PlayerProfile; v: number } | null = null;
  for (const p of ours) {
    for (const [k, v] of Object.entries(d.after.players[playerKey(p)]?.bonds ?? {})) {
      const mate = ours.find(m => playerKey(m) === k);
      if (mate && (!bond || v > bond.v)) bond = { a: p, b: mate, v };
    }
  }
  if (bond && bond.v > 0.05) lines.push(`${bond.a.name} vertraut ${bond.b.name} am meisten (gelungene Zuspiele)`);
  return lines.length ? lines : ['Kaum Veränderung – zu wenige bewertete Aktionen.'];
}
