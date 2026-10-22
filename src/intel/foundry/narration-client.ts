import { TEAMS } from '../../engine/rosters';
import type { PlayerProfile } from '../../engine/types';
import type { Lang } from '../../i18n';
import type { Insight, Mode } from '../types';
import type { NarrationRequest } from './narrate-core';

/** What the viewer is told about the AI narration: not configured, working, or failing (and why). */
export type NarrationStatus = { state: 'off' } | { state: 'ready'; answered: number } | { state: 'error'; message: string; answered: number };

export type NarrationClientOptions = { minIntervalMs: number; maxPerSession: number; timeoutMs: number };
export const DEFAULT_CLIENT_OPTIONS: NarrationClientOptions = { minIntervalMs: 8000, maxPerSession: 30, timeoutMs: 6000 };

/** Data keys that hold a player id or team id; they are sent as names, so the model never sees bare ids. */
const PLAYER_KEYS = new Set(['shooter', 'assist']);

/** An insight's facts for the narration service: its data with names resolved, plus who and when. */
export function factsOf(i: Insight, profiles: readonly PlayerProfile[]): NarrationRequest['facts'] {
  const facts: NarrationRequest['facts'] = { clock: i.clock };
  if (i.team !== null) facts.team = TEAMS[i.team].name;
  if (i.player !== null) facts.player = profiles[i.player].name;
  for (const [k, v] of Object.entries(i.data)) facts[k] = PLAYER_KEYS.has(k) && typeof v === 'number' ? profiles[v].name : v;
  return facts;
}

/**
 * Browser side of the optional AI narration through Microsoft Foundry: sends an insight's facts to the project's own
 * narration endpoint (an Azure Function that holds the credentials) and returns the reworded text, or null. Without a
 * configured endpoint it is off and never sends anything. Requests are spaced and capped per session; a failure is
 * kept in `status` and shown, and the app's own words stay on screen.
 */
export class NarrationClient {
  status: NarrationStatus;
  private last = -Infinity;
  private sent = 0;

  constructor(private readonly url: string | undefined, private readonly fetchImpl: typeof fetch = fetch.bind(globalThis), private readonly options = DEFAULT_CLIENT_OPTIONS, private readonly now = () => Date.now()) {
    this.status = url ? { state: 'ready', answered: 0 } : { state: 'off' };
  }

  /** Would a request be sent now (configured, spaced, under the session cap)? */
  canAsk(): boolean {
    return !!this.url && this.sent < this.options.maxPerSession && this.now() - this.last >= this.options.minIntervalMs;
  }

  async narrate(i: Insight, mode: Mode, lang: Lang, profiles: readonly PlayerProfile[]): Promise<string | null> {
    if (!this.canAsk()) return null;
    this.last = this.now();
    this.sent++;
    const answered = this.status.state === 'off' ? 0 : this.status.answered;
    const body: NarrationRequest = { kind: i.kind, mode, lang, facts: factsOf(i, profiles) };
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.options.timeoutMs);
    try {
      const res = await this.fetchImpl(this.url!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: abort.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
      const json = (await res.json()) as { text?: unknown };
      if (typeof json.text !== 'string' || !json.text.trim()) throw new Error('no text in the answer');
      this.status = { state: 'ready', answered: answered + 1 };
      return json.text.trim();
    } catch (err) {
      const message = err instanceof Error ? (err.name === 'AbortError' ? `timeout after ${this.options.timeoutMs} ms` : err.message) : String(err);
      this.status = { state: 'error', message, answered };
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
