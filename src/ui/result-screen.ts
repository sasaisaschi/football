import './result-screen.css';
import { TEAMS } from '../engine/rosters';
import type { ChronicleEntry } from './consequence';

/** Measured at the end: the user's wall-clock time, the worker's computing time, the simulated match time. */
export type SessionMetrics = { wallSeconds: number; cpuSeconds: number; simSeconds: number; moments: number };

const BY: Record<ChronicleEntry['by'], string> = { user: 'du', delegated: 'überlassen', timeout: 'Zeit abgelaufen' };
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Full time: the score, every decision with what was observed right after it, and how long the session took. */
export function showResult(host: HTMLElement, score: readonly [number, number], chronicle: readonly ChronicleEntry[], metrics: SessionMetrics): HTMLElement {
  const el = document.createElement('div');
  el.className = 'result';
  el.innerHTML = `
    <div class="result-card">
      <div class="result-kicker">Abpfiff</div>
      <div class="result-score"><span class="home"></span><b data-score></b><span class="away"></span></div>
      <dl class="result-metrics" data-metrics></dl>
      <h3>Deine Entscheidungen</h3>
      <ol class="result-list" data-list></ol>
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
  el.querySelector('[data-again]')!.addEventListener('click', () => location.reload());
  host.append(el);
  return el;
}
