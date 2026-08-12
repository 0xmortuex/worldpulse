import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Fetcher } from '../src/fetch/transport';
import { MemoryCacheStore } from '../src/fetch/cache-store';
import { SelectionTracker } from '../src/fetch/selection';
import { factState } from '../src/facts/types';
import type { FetchDefaults, SourceRecord } from '../src/facts/registry';

/**
 * The transport, driven against a stub `fetch`.
 *
 * No network, no timers, no browser: the clock, the sleeper and the randomness
 * are injected, so the retry ladder and the backoff are exercised in
 * milliseconds and deterministically. A test that waits out a real 3.6s backoff
 * is a test nobody runs.
 */
const DEFAULTS: FetchDefaults = {
  rateLimit: { perMinute: 6000, burst: 100 },
  maxConcurrent: 8,
  globalMaxConcurrent: 8,
  timeoutMs: 5_000,
  staleMultiple: 5,
};

const SOURCE = {
  id: 'worldbank',
  name: 'World Bank',
  panel: 'economy',
  homepage: 'https://data.worldbank.org',
  probeUrl: 'https://api.worldbank.org/v2/x',
  license: 'CC BY 4.0',
  licenseClass: 'open',
  attribution: 'World Bank',
  cadence: 'annual',
  ttlMs: 3_600_000,
  tier: 'OFFICIAL',
  keyRequired: false,
  keyEnv: null,
  verifiedAgainst: 'live',
  origin: 'https://api.worldbank.org',
  transport: 'direct',
  schemaVersion: 1,
} as SourceRecord;

interface StubOptions {
  responses: Array<Response | Error>;
}

function stub({ responses }: StubOptions): { impl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  let index = 0;
  const impl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    // An empty `responses` array is a test that stubs nothing, which would
    // otherwise surface as a confusing failure deep inside the transport.
    if (next === undefined) throw new Error('stub fetch: no responses configured');
    if (next instanceof Error) throw next;
    // Cloned per call: a Response body can only be read once, and re-serving one
    // would make the second attempt fail for a reason the test did not intend.
    return next.clone();
  }) as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

function makeFetcher(responses: Array<Response | Error>, over: Partial<ConstructorParameters<typeof Fetcher>[0]> = {}) {
  const { impl, calls } = stub({ responses });
  const slept: number[] = [];
  const fetcher = new Fetcher({
    fetchImpl: impl,
    now: () => Date.parse('2026-08-12T12:00:00.000Z'),
    random: () => 0.5,
    sleep: async (ms) => {
      slept.push(ms);
    },
    store: new MemoryCacheStore(),
    lookupSource: () => SOURCE,
    defaults: DEFAULTS,
    keys: {},
    ...over,
  });
  return { fetcher, calls, slept };
}

describe('transport — success and cache', () => {
  it('returns the body and a traceable context', async () => {
    const { fetcher } = makeFetcher([json({ gdp: 1 })]);
    const result = await fetcher.request({ sourceId: 'worldbank', path: '/v2/x' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.raw, { gdp: 1 });
    assert.equal(result.ctx.cache, 'miss');
    assert.match(result.ctx.requestUrl, /api\.worldbank\.org/);
  });

  it('serves a second identical request from cache without calling fetch again', async () => {
    const { fetcher, calls } = makeFetcher([json({ gdp: 1 })]);
    await fetcher.request({ sourceId: 'worldbank', path: '/v2/x' });
    const second = await fetcher.request({ sourceId: 'worldbank', path: '/v2/x' });
    assert.equal(calls.length, 1, 'the cache was not consulted');
    assert.equal(second.ok && second.ctx.cache, 'hit');
  });

  it('coalesces two concurrent identical requests into one call', async () => {
    const { fetcher, calls } = makeFetcher([json({ gdp: 1 })]);
    const [a, b] = await Promise.all([
      fetcher.request({ sourceId: 'worldbank', path: '/v2/x' }),
      fetcher.request({ sourceId: 'worldbank', path: '/v2/x' }),
    ]);
    assert.equal(calls.length, 1, 'two panels asking the same question made two requests');
    assert.equal(a.ok && b.ok, true);
  });
});

describe('transport — failure becomes a fact state, not an exception', () => {
  it('reports a 503 as unavailable after exhausting retries', async () => {
    const { fetcher, calls } = makeFetcher([new Response('', { status: 503 })]);
    const result = await fetcher.request({ sourceId: 'worldbank', path: '/v2/x' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.reason, 'http');
    assert.equal(result.failure.httpStatus, 503);
    assert.equal(calls.length, 3, 'a 5xx should be retried to the attempt cap');
    assert.equal(factState({ value: null, asOf: '', tier: 'OFFICIAL', provenance: result.failure }), 'unavailable');
  });

  it('does NOT retry a 404, and still reports it as unavailable rather than nodata', async () => {
    const { fetcher, calls } = makeFetcher([new Response('', { status: 404 })]);
    const result = await fetcher.request({ sourceId: 'worldbank', path: '/v2/x' });
    assert.equal(calls.length, 1, 'a 404 was retried — the same wrong question, asked louder');
    assert.equal(result.ok, false);
    assert.equal(
      factState({ value: null, asOf: '', tier: 'OFFICIAL', provenance: result.ok ? null : result.failure }),
      'unavailable',
    );
  });

  it('does not retry a body that will not parse, so schema drift stays visible', async () => {
    const { fetcher, calls } = makeFetcher([
      new Response('<html>not json</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    ]);
    const result = await fetcher.request({ sourceId: 'worldbank', path: '/v2/x' });
    assert.equal(calls.length, 1, 'a shape failure was retried, which would hide schema drift');
    assert.equal(result.ok === false && result.failure.reason, 'shape');
  });

  it('reports a composition refusal as unavailable rather than throwing', async () => {
    // An unprobed transport must reach the panel as a state, not as an
    // exception that blanks it.
    const { fetcher } = makeFetcher([json({})], {
      lookupSource: () => ({ ...SOURCE, transport: undefined }) as SourceRecord,
    });
    const result = await fetcher.request({ sourceId: 'worldbank', path: '/v2/x' });
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.failure.detail : '', /transport unknown/);
  });

  it('records how many attempts were made, so the inspector can show it', async () => {
    const { fetcher } = makeFetcher([new Response('', { status: 500 })]);
    const result = await fetcher.request({ sourceId: 'worldbank', path: '/v2/x' });
    assert.equal(result.ok === false && result.failure.attempts, 3);
  });
});

describe('transport — stale rescue and its bound (F2, F3)', () => {
  const HOUR = 3_600_000;

  async function primeThenFail(ageMs: number) {
    const store = new MemoryCacheStore();
    let clock = Date.parse('2026-08-12T12:00:00.000Z');
    const { impl } = stub({ responses: [json({ gdp: 1 })] });
    const primed = new Fetcher({
      fetchImpl: impl,
      now: () => clock,
      random: () => 0.5,
      sleep: async () => {},
      store,
      lookupSource: () => SOURCE,
      defaults: DEFAULTS,
      keys: {},
    });
    await primed.request({ sourceId: 'worldbank', path: '/v2/x' });

    clock += ageMs;
    const failing = new Fetcher({
      fetchImpl: stub({ responses: [new Response('', { status: 503 })] }).impl,
      now: () => clock,
      random: () => 0.5,
      sleep: async () => {},
      store,
      lookupSource: () => SOURCE,
      defaults: DEFAULTS,
      keys: {},
    });
    return failing.request({ sourceId: 'worldbank', path: '/v2/x' });
  }

  it('serves a stale value when the refresh fails, marked as revalidating', async () => {
    const result = await primeThenFail(HOUR * 2);
    assert.equal(result.ok, true, 'a usable cached value was thrown away on a transient failure');
    assert.equal(result.ok && result.ctx.cache, 'stale-revalidating');
  });

  it('REFUSES to serve past the bounded window, however dead the origin is', async () => {
    // F3. Without the bound a dead origin serves its last response forever,
    // with an indicator that never escalates.
    const result = await primeThenFail(HOUR * 24);
    assert.equal(result.ok, false, 'a value past the stale limit was served anyway');
  });
});

describe('F6 — a late response for a deselected country reaches no panel', () => {
  /** Minimal stand-in for a panel: records whatever it is told to render. */
  class Panel {
    rendered: Array<{ subject: string; value: unknown }> = [];
    receive(issued: { subject: string; epoch: number }, tracker: SelectionTracker, value: unknown): void {
      if (!tracker.accepts(issued)) return;
      this.rendered.push({ subject: issued.subject, value });
    }
  }

  it('discards France when Jamaica is on screen', async () => {
    const tracker = new SelectionTracker();
    const panel = new Panel();

    // France is selected and its request is issued...
    const france = tracker.select('FRA');
    const { fetcher } = makeFetcher([json({ country: 'FRA', gdp: 3_000 })]);
    const inFlight = fetcher.request({ sourceId: 'worldbank', path: '/v2/country/FRA' });

    // ...the user switches to Jamaica before it resolves...
    tracker.select('JAM');

    // ...and France's response lands late.
    const result = await inFlight;
    assert.equal(result.ok, true, 'the stub should have resolved successfully');
    panel.receive(france, tracker, result.ok ? result.raw : null);

    assert.deepEqual(panel.rendered, [], "France's response reached a panel showing Jamaica");
  });

  it('accepts France when the user has returned to France (the mirror case)', async () => {
    const tracker = new SelectionTracker();
    const panel = new Panel();

    const france = tracker.select('FRA');
    const { fetcher } = makeFetcher([json({ country: 'FRA', gdp: 3_000 })]);
    const inFlight = fetcher.request({ sourceId: 'worldbank', path: '/v2/country/FRA' });

    tracker.select('JAM');
    tracker.select('FRA');

    const result = await inFlight;
    panel.receive(france, tracker, result.ok ? result.raw : null);

    assert.equal(panel.rendered.length, 1, 'a valid answer to the question on screen was discarded');
    assert.equal(panel.rendered[0]?.subject, 'FRA');
  });

  it('discards when the user has cleared the selection entirely', async () => {
    const tracker = new SelectionTracker();
    const panel = new Panel();
    const france = tracker.select('FRA');
    const { fetcher } = makeFetcher([json({ gdp: 1 })]);
    const inFlight = fetcher.request({ sourceId: 'worldbank', path: '/v2/country/FRA' });
    tracker.clear();
    const result = await inFlight;
    panel.receive(france, tracker, result.ok ? result.raw : null);
    assert.deepEqual(panel.rendered, []);
  });

  it('reports an aborted request as aborted, not as a source failure', async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetcher } = makeFetcher([json({ gdp: 1 })]);
    const result = await fetcher.request({ sourceId: 'worldbank', path: '/v2/x' }, { signal: controller.signal });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.failure.reason, 'aborted');
    assert.equal(result.ok === false && result.failure.retryableAt, null, 'an abandoned request was scheduled for retry');
  });
});
