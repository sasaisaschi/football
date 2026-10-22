/**
 * The server-side core of the optional AI narration (Microsoft Foundry), free of any Azure or network dependency so it
 * can be tested: request validation, limits, the prompt, and the check of the model's answer. The Azure Function in
 * `api/` wires it to Foundry; the browser only ever talks to that function, never to Foundry, and holds no key.
 *
 * The model may only reword facts it is given. Its answer is rejected when it contains a number that is not in the
 * facts (an invented statistic), when it is too long, or when it is empty – the app then keeps its own words.
 */

/** Insight kinds the narration accepts (the same as intel/types.ts). */
export const NARRATION_KINDS = ['goal-story', 'big-chance', 'save', 'momentum', 'chaos', 'control', 'pressing', 'danger', 'speed', 'decision', 'half-summary', 'full-summary'] as const;

export type NarrationRequest = {
  kind: (typeof NARRATION_KINDS)[number];
  mode: 'fan' | 'analyst';
  lang: 'en' | 'de';
  /** The insight's own data with player and team names already resolved, nothing else. */
  facts: Record<string, string | number | boolean>;
};

export type NarrationLimits = { maxBodyBytes: number; maxFacts: number; maxAnswerChars: number; perClientPerWindow: number; windowSeconds: number; dailyTotal: number };
export const DEFAULT_LIMITS: NarrationLimits = { maxBodyBytes: 4096, maxFacts: 24, maxAnswerChars: 360, perClientPerWindow: 20, windowSeconds: 600, dailyTotal: 2000 };
/** Model call settings: short, factual, cheap. */
export const MODEL_SETTINGS = { maxTokens: 120, temperature: 0.4 } as const;

export type ChatMessage = { role: 'system' | 'user'; content: string };
export type Verdict = { ok: true; request: NarrationRequest } | { ok: false; status: number; error: string };

/** Checks an incoming body: size, shape, allowed kind, flat facts of simple values. */
export function parseRequest(body: string, limits: NarrationLimits = DEFAULT_LIMITS): Verdict {
  if (body.length > limits.maxBodyBytes) return { ok: false, status: 413, error: 'request too large' };
  let raw: unknown;
  try { raw = JSON.parse(body); } catch { return { ok: false, status: 400, error: 'not JSON' }; }
  const r = raw as Partial<NarrationRequest>;
  if (!r || typeof r !== 'object') return { ok: false, status: 400, error: 'not an object' };
  if (!NARRATION_KINDS.includes(r.kind as NarrationRequest['kind'])) return { ok: false, status: 400, error: 'unknown kind' };
  if (r.mode !== 'fan' && r.mode !== 'analyst') return { ok: false, status: 400, error: 'mode must be fan or analyst' };
  if (r.lang !== 'en' && r.lang !== 'de') return { ok: false, status: 400, error: 'lang must be en or de' };
  const facts = r.facts;
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) return { ok: false, status: 400, error: 'facts missing' };
  const entries = Object.entries(facts);
  if (entries.length > limits.maxFacts) return { ok: false, status: 400, error: 'too many facts' };
  for (const [k, v] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,31}$/.test(k)) return { ok: false, status: 400, error: `bad fact name ${k}` };
    if (!['string', 'number', 'boolean'].includes(typeof v) || (typeof v === 'string' && v.length > 80)) return { ok: false, status: 400, error: `bad fact ${k}` };
  }
  return { ok: true, request: { kind: r.kind!, mode: r.mode, lang: r.lang, facts: facts as NarrationRequest['facts'] } };
}

/** The messages for the model: rules first, then only the facts. */
export function buildMessages(r: NarrationRequest): ChatMessage[] {
  const audience = r.mode === 'fan'
    ? 'a casual fan: simple, vivid, no jargon, at most 2 short sentences'
    : 'a data-minded analyst: precise and tactical, keep the numbers, at most 2 sentences';
  return [
    {
      role: 'system',
      content: [
        'You narrate moments of a synthetic football match for a live overlay.',
        `Write for ${audience}, in ${r.lang === 'de' ? 'German' : 'English'}.`,
        'Use ONLY the facts given. Never add players, numbers, causes or events that are not in the facts.',
        'If a fact is missing, leave it out. Answer with the narration text only.',
      ].join(' '),
    },
    { role: 'user', content: JSON.stringify({ moment: r.kind, facts: r.facts }) },
  ];
}

/** Numbers written in a text (decimal point or comma), as they would be read. */
function numbersIn(text: string): number[] {
  return (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map(n => Number(n.replace(',', '.')));
}

/**
 * Accepts the model's answer only if it stays within the facts: every number in it occurs in the facts (or in the
 * score/clock strings among them), and it is not empty and not too long.
 */
export function checkAnswer(answer: string, r: NarrationRequest, limits: NarrationLimits = DEFAULT_LIMITS): { ok: true; text: string } | { ok: false; error: string } {
  const text = answer.trim();
  if (!text) return { ok: false, error: 'empty answer' };
  if (text.length > limits.maxAnswerChars) return { ok: false, error: 'answer too long' };
  const allowed = new Set<number>();
  for (const v of Object.values(r.facts)) {
    if (typeof v === 'number') allowed.add(v);
    if (typeof v === 'string') for (const n of numbersIn(v)) allowed.add(n);
  }
  const invented = numbersIn(text).filter(n => !allowed.has(n));
  if (invented.length) return { ok: false, error: `number(s) not in the facts: ${invented.join(', ')}` };
  return { ok: true, text };
}

/** Per-client sliding window and a daily total, kept in memory by one function instance. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private day = '';
  private total = 0;

  constructor(private readonly limits: NarrationLimits = DEFAULT_LIMITS) {}

  allow(client: string, nowMs: number): { ok: true } | { ok: false; status: number; error: string } {
    const day = new Date(nowMs).toISOString().slice(0, 10);
    if (day !== this.day) { this.day = day; this.total = 0; }
    if (this.total >= this.limits.dailyTotal) return { ok: false, status: 429, error: 'daily limit reached' };
    const recent = (this.hits.get(client) ?? []).filter(t => nowMs - t < this.limits.windowSeconds * 1000);
    if (recent.length >= this.limits.perClientPerWindow) return { ok: false, status: 429, error: 'too many requests' };
    recent.push(nowMs);
    this.hits.set(client, recent);
    this.total++;
    return { ok: true };
  }
}
