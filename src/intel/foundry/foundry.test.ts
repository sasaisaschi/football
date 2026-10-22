import { describe, expect, it } from 'vitest';
import { createRoster } from '../../engine/rosters';
import type { Insight } from '../types';
import { buildMessages, checkAnswer, parseRequest, RateLimiter, type NarrationRequest } from './narrate-core';
import { factsOf, NarrationClient } from './narration-client';

/**
 * Unit tests of the project's own narration logic (validation, limits, answer check, client behaviour) with a stand-in
 * for fetch. They do not talk to Azure and are no proof of a working cloud integration (PROJECT_REPORT.md §12).
 */
const roster = createRoster(7);
const insight: Insight = { id: 1, tick: 600, time: 10, clock: '12:34', kind: 'save', team: 1, player: 11, priority: 2, data: { xg: 0.31, distance: 14, kmh: 88, shooter: 9, caught: true }, eventIds: [3, 4, 5] };
const request: NarrationRequest = { kind: 'save', mode: 'fan', lang: 'en', facts: factsOf(insight, roster) };

describe('narration core (server side)', () => {
  it('accepts only small, flat, known requests', () => {
    expect(parseRequest(JSON.stringify(request)).ok).toBe(true);
    expect(parseRequest('nope')).toMatchObject({ ok: false, status: 400 });
    expect(parseRequest(JSON.stringify({ ...request, kind: 'free-text' }))).toMatchObject({ ok: false, status: 400 });
    expect(parseRequest(JSON.stringify({ ...request, facts: { nested: { a: 1 } } }))).toMatchObject({ ok: false, status: 400 });
    expect(parseRequest(JSON.stringify({ ...request, facts: { a: 'x'.repeat(5000) } }))).toMatchObject({ ok: false, status: 413 });
  });

  it('the prompt carries the rules and only the facts, in the asked language', () => {
    const [system, user] = buildMessages({ ...request, lang: 'de', mode: 'analyst' });
    expect(system.content).toMatch(/ONLY the facts/);
    expect(system.content).toMatch(/German/);
    expect(JSON.parse(user.content)).toEqual({ moment: 'save', facts: request.facts });
  });

  it('rejects an answer with a number that is not in the facts (an invented statistic)', () => {
    expect(checkAnswer('What a save! An 88 km/h strike from 14 m kept out.', request)).toMatchObject({ ok: true });
    expect(checkAnswer('Saved at 12:34 – xG 0.31.', request)).toMatchObject({ ok: true });
    expect(checkAnswer('His 5th save of the day!', request)).toMatchObject({ ok: false });
    expect(checkAnswer('', request)).toMatchObject({ ok: false });
  });

  it('limits requests per client and per day', () => {
    const limiter = new RateLimiter({ maxBodyBytes: 4096, maxFacts: 24, maxAnswerChars: 360, perClientPerWindow: 2, windowSeconds: 60, dailyTotal: 3 });
    expect(limiter.allow('a', 0).ok).toBe(true);
    expect(limiter.allow('a', 1000).ok).toBe(true);
    expect(limiter.allow('a', 2000)).toMatchObject({ ok: false, status: 429 });
    expect(limiter.allow('a', 61_500).ok).toBe(true);
    expect(limiter.allow('b', 62_000)).toMatchObject({ ok: false, error: 'daily limit reached' });
  });
});

describe('narration client (browser side)', () => {
  const ok = (text: string) => (async () => new Response(JSON.stringify({ text }), { status: 200 })) as unknown as typeof fetch;

  it('is off without a configured endpoint and never sends', async () => {
    let calls = 0;
    const c = new NarrationClient(undefined, (async () => { calls++; return new Response('{}'); }) as unknown as typeof fetch);
    expect(c.status.state).toBe('off');
    expect(await c.narrate(insight, 'fan', 'en', roster)).toBeNull();
    expect(calls).toBe(0);
  });

  it('sends names, not ids, spaces its requests and returns the answer', async () => {
    let body: NarrationRequest | null = null;
    let t = 0;
    const c = new NarrationClient('https://example.invalid/api/narrate', (async (_u: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return new Response(JSON.stringify({ text: 'Great save!' })); }) as unknown as typeof fetch, { minIntervalMs: 8000, maxPerSession: 2, timeoutMs: 1000 }, () => t);
    expect(await c.narrate(insight, 'fan', 'en', roster)).toBe('Great save!');
    expect(body!.facts.shooter).toBe(roster[9].name);
    expect(body!.facts.player).toBe(roster[11].name);
    t = 1000;
    expect(await c.narrate(insight, 'fan', 'en', roster)).toBeNull();
    t = 9000;
    expect(await c.narrate(insight, 'fan', 'en', roster)).toBe('Great save!');
    t = 20_000;
    expect(await c.narrate(insight, 'fan', 'en', roster)).toBeNull(); // session cap of 2
    expect(c.status).toMatchObject({ state: 'ready', answered: 2 });
  });

  it('a failing or slow endpoint is reported in the status, and nothing is made up', async () => {
    const failing = new NarrationClient('https://example.invalid/api/narrate', (async () => new Response('limit', { status: 429, statusText: 'Too Many Requests' })) as unknown as typeof fetch);
    expect(await failing.narrate(insight, 'fan', 'en', roster)).toBeNull();
    expect(failing.status).toMatchObject({ state: 'error', message: 'HTTP 429 Too Many Requests' });
    const slow = new NarrationClient('https://example.invalid/api/narrate', ((_u: string, init: RequestInit) => new Promise((_r, reject) => init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as unknown as typeof fetch, { minIntervalMs: 0, maxPerSession: 5, timeoutMs: 50 });
    expect(await slow.narrate(insight, 'fan', 'en', roster)).toBeNull();
    expect(slow.status).toMatchObject({ state: 'error', message: 'timeout after 50 ms' });
    expect(await new NarrationClient('https://example.invalid', ok('')).narrate(insight, 'fan', 'en', roster)).toBeNull();
  });
});
