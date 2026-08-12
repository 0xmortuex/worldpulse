import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ComposeError, compose, hostOf, redactUrl } from '../src/fetch/compose';
import { admit, backOff, newBucket, parseRetryAfter, refill, release } from '../src/fetch/limiter';
import { cacheStateFor, freshness, revalidationHeaders, type CacheEntry } from '../src/fetch/cache-policy';
import { MAX_ATTEMPTS, jitter, retryPlan } from '../src/fetch/retry';
import { SelectionTracker, disposition } from '../src/fetch/selection';
import type { FetchDefaults, SourceRecord } from '../src/facts/registry';

const DEFAULTS: FetchDefaults = {
  rateLimit: { perMinute: 60, burst: 10 },
  maxConcurrent: 4,
  globalMaxConcurrent: 6,
  timeoutMs: 15_000,
  staleMultiple: 5,
};

const source = (over: Partial<SourceRecord> = {}): SourceRecord =>
  ({
    id: 'worldbank',
    name: 'World Bank',
    panel: 'economy',
    homepage: 'https://data.worldbank.org',
    probeUrl: 'https://api.worldbank.org/v2/country/FRA',
    license: 'CC BY 4.0',
    licenseClass: 'open',
    attribution: 'World Bank',
    cadence: 'annual',
    ttlMs: 86_400_000,
    tier: 'OFFICIAL',
    keyRequired: false,
    keyEnv: null,
    verifiedAgainst: 'live',
    origin: 'https://api.worldbank.org',
    transport: 'direct',
    schemaVersion: 1,
    ...over,
  }) as SourceRecord;

describe('compose — registry owns policy, adapter owns the question', () => {
  it('joins origin, path and query', () => {
    const request = compose({ sourceId: 'worldbank', path: '/v2/country/FRA', query: { format: 'json' } }, source(), DEFAULTS);
    assert.equal(request.url, 'https://api.worldbank.org/v2/country/FRA?format=json');
    assert.equal(request.transport, 'direct');
  });

  it('REFUSES a source whose transport was never probed, rather than assuming direct', () => {
    // Rule 30 at the routing layer. Guessing the browser can read a response we
    // never measured ships a panel that fails in the user's browser and passes
    // every test.
    assert.throws(
      () => compose({ sourceId: 'worldbank', path: '/x' }, source({ transport: undefined }), DEFAULTS),
      /transport unknown/,
    );
  });

  it('refuses a source with no origin', () => {
    assert.throws(() => compose({ sourceId: 'x', path: '/x' }, source({ origin: undefined }), DEFAULTS), ComposeError);
  });

  it('refuses an unregistered source', () => {
    assert.throws(() => compose({ sourceId: 'nope', path: '/x' }, undefined, DEFAULTS), /no such source/);
  });

  it('refuses a path that is not rooted, rather than joining it ambiguously', () => {
    assert.throws(() => compose({ sourceId: 'worldbank', path: 'v2/x' }, source(), DEFAULTS), /must start with/);
  });

  it('routes a worker-transport source through the proxy, not the origin', () => {
    const request = compose({ sourceId: 'ucdp', path: '/ged' }, source({ id: 'ucdp', transport: 'worker' }), DEFAULTS);
    assert.match(request.url, /^\/api\/s\/ucdp\/ged/);
    assert.doesNotMatch(request.url, /api\.worldbank\.org/);
  });

  it('keeps the upstream URL as displayUrl so provenance stays traceable through the proxy', () => {
    const request = compose({ sourceId: 'ucdp', path: '/ged' }, source({ id: 'ucdp', transport: 'worker' }), DEFAULTS);
    assert.match(request.displayUrl, /^https:\/\/api\.worldbank\.org\/ged/);
  });

  it('REFUSES a secret key on a direct transport', () => {
    // A registry edit that flipped transport would otherwise put the key in the
    // browser. The probe encodes the same precedence; this is the second lock.
    assert.throws(
      () =>
        compose({ sourceId: 'k', path: '/x' }, source({ keyRequired: true, keyEnv: 'SECRET_KEY', transport: 'direct' }), DEFAULTS),
      /requires transport "worker"/,
    );
  });

  it('injects a public VITE_ key and refuses when it is missing', () => {
    const gated = source({ keyRequired: true, keyEnv: 'VITE_PUBLIC', transport: 'direct' });
    const request = compose({ sourceId: 'k', path: '/x' }, gated, DEFAULTS, { VITE_PUBLIC: 'abc123' });
    assert.match(request.url, /key=abc123/);
    assert.throws(() => compose({ sourceId: 'k', path: '/x' }, gated, DEFAULTS, {}), /is not configured/);
  });

  it('redacts a key from the URL the inspector shows the user', () => {
    const gated = source({ keyRequired: true, keyEnv: 'VITE_PUBLIC', transport: 'direct' });
    const request = compose({ sourceId: 'k', path: '/x' }, gated, DEFAULTS, { VITE_PUBLIC: 'abc123' });
    assert.doesNotMatch(request.displayUrl, /abc123/, 'a credential reached the provenance record');
    assert.match(request.displayUrl, /REDACTED/);
  });

  it('redacts a key in any position, not only the first parameter', () => {
    // A regex assuming `?key=` misses `&key=`. The inspector prints this string
    // verbatim, so a miss is a credential on screen.
    assert.match(redactUrl('https://h/x?a=1&token=secret&b=2'), /token=REDACTED/);
    assert.doesNotMatch(redactUrl('https://h/x?a=1&token=secret'), /secret/);
  });

  it('puts the schema version in the cache key, so a parser change cannot reuse old bytes', () => {
    const v1 = compose({ sourceId: 'worldbank', path: '/x' }, source({ schemaVersion: 1 }), DEFAULTS);
    const v2 = compose({ sourceId: 'worldbank', path: '/x' }, source({ schemaVersion: 2 }), DEFAULTS);
    assert.notEqual(v1.cacheKey, v2.cacheKey);
  });

  it('buckets by host, so two sources sharing an origin share a limit', () => {
    assert.equal(hostOf(source({ id: 'a' })), hostOf(source({ id: 'b' })));
  });
});

describe('limiter — per-host admission', () => {
  const limits = { perMinute: 60, burst: 2, maxConcurrent: 2 };

  it('admits within burst and refuses when tokens run out', () => {
    let state = newBucket(limits, 0);
    const first = admit(state, limits, 0);
    assert.equal(first.admitted, true);
    state = release(first.state);
    const second = admit(state, limits, 0);
    assert.equal(second.admitted, true);
    state = release(second.state);
    const third = admit(state, limits, 0);
    assert.equal(third.admitted, false);
    assert.equal(third.admitted === false && third.reason, 'no-tokens');
  });

  it('refills over time, capped at burst', () => {
    const drained = { tokens: 0, updatedAt: 0, active: 0, blockedUntil: null };
    assert.equal(refill(drained, limits, 1000).tokens, 1);
    assert.equal(refill(drained, limits, 600_000).tokens, limits.burst, 'refill exceeded burst');
  });

  it('refuses at the concurrency ceiling even with tokens available', () => {
    const busy = { tokens: 10, updatedAt: 0, active: 2, blockedUntil: null };
    const result = admit(busy, limits, 0);
    assert.equal(result.admitted, false);
    assert.equal(result.admitted === false && result.reason, 'at-concurrency');
  });

  it("lets the host's Retry-After outrank our own arithmetic", () => {
    // Checked before tokens: a limiter that keeps its own opinion after being
    // told a number is a limiter that gets us banned.
    const blocked = backOff(newBucket(limits, 0), 30, 0);
    const result = admit(blocked, limits, 1000);
    assert.equal(result.admitted, false);
    assert.equal(result.admitted === false && result.reason, 'backing-off');
    assert.equal(result.admitted === false && result.retryAfterMs, 29_000);
  });

  it('never shortens an existing back-off', () => {
    const long = backOff(newBucket(limits, 0), 60, 0);
    const short = backOff(long, 5, 0);
    assert.equal(short.blockedUntil, long.blockedUntil, 'a second 429 relaxed the first');
  });

  it('treats an unreadable Retry-After as no instruction, not as zero', () => {
    assert.equal(parseRetryAfter(null, 0), null);
    assert.equal(parseRetryAfter('later', 0), null);
    assert.equal(parseRetryAfter('120', 0), 120);
    assert.ok((parseRetryAfter(new Date(60_000).toUTCString(), 0) ?? 0) >= 59);
  });

  it('does not let a double release invent capacity', () => {
    const state = { tokens: 1, updatedAt: 0, active: 1, blockedUntil: null };
    assert.equal(release(release(state)).active, 0);
  });
});

describe('cache freshness — F2 and F3', () => {
  const entry = (fetchedAt: string): CacheEntry => ({
    cacheKey: 'k',
    raw: {},
    httpStatus: 200,
    fetchedAt,
    etag: null,
    lastModified: null,
  });
  const HOUR = 3_600_000;
  const now = Date.parse('2026-08-12T12:00:00.000Z');

  it('is fresh inside the TTL', () => {
    const result = freshness({ entry: entry('2026-08-12T11:30:00.000Z'), ttlMs: HOUR, staleMultiple: 5, now });
    assert.equal(result.verdict, 'fresh');
  });

  it('is stale past the TTL and CARRIES ITS AGE', () => {
    // F2's hard condition: a stale value never renders silently.
    const result = freshness({ entry: entry('2026-08-12T10:00:00.000Z'), ttlMs: HOUR, staleMultiple: 5, now });
    assert.equal(result.verdict, 'stale');
    assert.match(result.verdict === 'stale' ? result.note : '', /2h ago/);
  });

  it('EXPIRES past the bounded window rather than serving forever', () => {
    // F3. Without the bound, a dead origin serves last year's number with an
    // indicator that never escalates.
    const result = freshness({ entry: entry('2026-08-01T12:00:00.000Z'), ttlMs: HOUR, staleMultiple: 5, now });
    assert.equal(result.verdict, 'expired');
  });

  it('treats static data as never expiring', () => {
    const result = freshness({ entry: entry('2020-01-01T00:00:00.000Z'), ttlMs: null, staleMultiple: 5, now });
    assert.equal(result.verdict, 'fresh');
  });

  it('treats an undateable entry as a miss, not as fresh', () => {
    // We cannot state its age, and F2 requires the age to be stated, so it
    // cannot be served under the stale rule.
    const result = freshness({ entry: entry('not a date'), ttlMs: HOUR, staleMultiple: 5, now });
    assert.equal(result.verdict, 'miss');
  });

  it('maps each verdict to the cache state the inspector shows', () => {
    assert.equal(cacheStateFor('fresh'), 'hit');
    assert.equal(cacheStateFor('stale'), 'stale-revalidating');
    assert.equal(cacheStateFor('expired'), 'miss');
    assert.equal(cacheStateFor('miss'), 'miss');
  });

  it('sends validators only when the entry has them', () => {
    assert.deepEqual(revalidationHeaders(null), {});
    assert.deepEqual(revalidationHeaders({ ...entry('2026-08-12T11:00:00.000Z'), etag: 'W/"x"' }), {
      'If-None-Match': 'W/"x"',
    });
  });
});

describe('retry — the never-retry rows', () => {
  const attempt = (over: Partial<Parameters<typeof retryPlan>[0]> = {}): Parameters<typeof retryPlan>[0] => ({
    reason: 'network',
    httpStatus: null,
    attempt: 1,
    retryAfterMs: null,
    ...over,
  });

  it('never retries a shape error — that would hide schema drift', () => {
    const plan = retryPlan(attempt({ reason: 'shape' }));
    assert.equal(plan.retry, false);
    assert.match(plan.reason, /schema drift/);
  });

  it('never retries an abort — nobody is waiting for the answer', () => {
    assert.equal(retryPlan(attempt({ reason: 'aborted' })).retry, false);
  });

  it('never retries an ordinary 4xx', () => {
    assert.equal(retryPlan(attempt({ reason: 'http', httpStatus: 404 })).retry, false);
    assert.equal(retryPlan(attempt({ reason: 'http', httpStatus: 400 })).retry, false);
  });

  it('does retry the 4xx statuses that mean "later" rather than "wrong"', () => {
    for (const status of [408, 425, 429]) {
      assert.equal(retryPlan(attempt({ reason: 'http', httpStatus: status })).retry, true, `${status} was not retried`);
    }
  });

  it('retries 5xx and network failures', () => {
    assert.equal(retryPlan(attempt({ reason: 'http', httpStatus: 503 })).retry, true);
    assert.equal(retryPlan(attempt({ reason: 'network' })).retry, true);
  });

  it('gives a timeout ONE retry, not the full ladder', () => {
    // Three retries turn a query that structurally cannot finish — the WDQS
    // legislature query — into panel flicker instead of a diagnosable fault.
    assert.equal(retryPlan(attempt({ reason: 'timeout', attempt: 1 })).retry, true);
    const second = retryPlan(attempt({ reason: 'timeout', attempt: 2 }));
    assert.equal(second.retry, false);
    assert.match(second.reason, /design problem, not a slow source/);
  });

  it('stops at the attempt cap', () => {
    assert.equal(retryPlan(attempt({ attempt: MAX_ATTEMPTS })).retry, false);
  });

  it('floors a Retry-After at our own schedule, so Retry-After: 0 is not a hot loop', () => {
    const plan = retryPlan(attempt({ reason: 'http', httpStatus: 429, retryAfterMs: 0 }));
    assert.equal(plan.retry, true);
    assert.ok(plan.delayMs >= 400, `delay was ${plan.delayMs}ms`);
  });

  it('honours a Retry-After longer than our schedule', () => {
    assert.equal(retryPlan(attempt({ reason: 'http', httpStatus: 429, retryAfterMs: 30_000 })).delayMs, 30_000);
  });

  it('jitters within ±25% and stays deterministic for a given draw', () => {
    assert.equal(jitter(1000, 0), 750);
    assert.equal(jitter(1000, 1), 1250);
    assert.equal(jitter(1000, 0.5), 1000);
  });
});

describe('selection identity — F6', () => {
  it('discards a response whose subject is no longer selected', () => {
    const result = disposition({ subject: 'FRA', epoch: 1 }, { subject: 'JAM', epoch: 2 });
    assert.equal(result.render, false);
    assert.equal(result.render === false && result.why, 'subject-changed');
  });

  it('discards when nothing is selected at all', () => {
    const result = disposition({ subject: 'FRA', epoch: 1 }, null);
    assert.equal(result.render, false);
  });

  it('ACCEPTS a late response for a selection the user returned to', () => {
    // F6c. The rule is identity matching, not recency: this response answers the
    // question currently on screen, and discarding it costs a refetch against a
    // rate-limited origin for no gain in correctness.
    const result = disposition({ subject: 'FRA', epoch: 1 }, { subject: 'FRA', epoch: 3 });
    assert.equal(result.render, true, 'a valid answer to the question on screen was thrown away');
  });

  it('tracks selections and accepts only the current subject', () => {
    const tracker = new SelectionTracker();
    const france = tracker.select('FRA');
    tracker.select('JAM');
    assert.equal(tracker.accepts(france), false);
    tracker.select('FRA');
    assert.equal(tracker.accepts(france), true, 'the return-to-selection mirror case');
    tracker.clear();
    assert.equal(tracker.accepts(france), false);
  });
});
