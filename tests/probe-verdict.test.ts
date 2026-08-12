import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { VERDICT, originIsAllowed, verdictForResponse } from '../scripts/probe-verdict.mjs';

/**
 * Planted cases for the CORS verdict ladder (rules 27 and 32).
 *
 * Three defects have been found in this logic and every one was found by
 * re-probing a live host and noticing an inconsistent answer — network, an hour
 * of rate-limited waiting, and someone paying attention. Each is a status code
 * and a header map. The first three tests below are those defects, turned from
 * anecdotes in a comment into regression tests that cannot come back.
 */
const ORIGIN = 'https://worldpulse.pages.dev';

const observe = (
  over: Partial<Parameters<typeof verdictForResponse>[0]> = {},
): Parameters<typeof verdictForResponse>[0] => ({
  status: 200,
  ok: true,
  cors: { 'access-control-allow-origin': '*' },
  origin: ORIGIN,
  source: {},
  ...over,
});

describe('regression — the three defects this ladder has actually had', () => {
  it('does not draw a conclusive verdict from an error response carrying ACAO: *', () => {
    // wikidata-sparql scored WORKER-REQUIRED twice off a 403 carrying `*`, and
    // INCONCLUSIVE once off a 429 that did not. Same source, same question,
    // verdict decided by a header on a failed request. Its true posture,
    // measured directly, is a 200 with `ACAO: *`.
    const { verdict } = verdictForResponse(
      observe({ status: 403, ok: false, cors: { 'access-control-allow-origin': '*' } }),
    );
    assert.equal(
      verdict,
      VERDICT.INCONCLUSIVE,
      'an error response was treated as evidence about the success path',
    );
  });

  it('scores an error with no ACAO the same way as an error carrying one', () => {
    // The two must agree: the defect was that they did not, so the same source
    // got different verdicts depending on which error it happened to return.
    const withAcao = verdictForResponse(observe({ status: 403, ok: false, cors: { 'access-control-allow-origin': '*' } }));
    const without = verdictForResponse(observe({ status: 429, ok: false, cors: {} }));
    assert.equal(withAcao.verdict, without.verdict, 'verdict still depends on a header on an error path');
  });

  it('does not send a readable source to the Worker just for wanting a User-Agent', () => {
    // query.wikidata.org and api.openparliament.ca both answer 200 with ACAO `*`
    // when the client identifies itself. Both were scored WORKER-REQUIRED under
    // the old rule, which read the flag as "needs a proxy" — backwards, since a
    // browser sends its own real UA and never needs to set one.
    const { verdict } = verdictForResponse(observe({ source: { requiresCustomUserAgent: true } }));
    assert.equal(verdict, VERDICT.CLIENT, 'a directly-readable source was routed through the proxy');
  });

  it('still routes to the Worker when the UA policy comes WITH an unreadable response', () => {
    // The flag is not meaningless — it decides the verdict only when the
    // response is also unreadable. Without this case the fix above would be
    // indistinguishable from deleting the branch.
    const { verdict } = verdictForResponse(
      observe({ cors: {}, source: { requiresCustomUserAgent: true } }),
    );
    assert.equal(verdict, VERDICT.WORKER);
  });
});

describe('CORS verdict ladder', () => {
  it('scores a permissive wildcard as directly fetchable', () => {
    assert.equal(verdictForResponse(observe()).verdict, VERDICT.CLIENT);
  });

  it('scores an ACAO naming our exact origin as directly fetchable', () => {
    const { verdict } = verdictForResponse(observe({ cors: { 'access-control-allow-origin': ORIGIN } }));
    assert.equal(verdict, VERDICT.CLIENT);
  });

  it('scores an ACAO naming someone else as needing the Worker', () => {
    const { verdict, reason } = verdictForResponse(
      observe({ cors: { 'access-control-allow-origin': 'https://example.org' } }),
    );
    assert.equal(verdict, VERDICT.WORKER);
    assert.match(reason, /does not match our origin/);
  });

  it('scores a missing ACAO as needing the Worker', () => {
    assert.equal(verdictForResponse(observe({ cors: {} })).verdict, VERDICT.WORKER);
  });

  it('puts a secret key ahead of a permissive ACAO', () => {
    // Ordering guard. Even when the browser COULD read the response, a
    // server-side key must not be put in front of the user.
    const { verdict, reason } = verdictForResponse(
      observe({ source: { keyRequired: true, keyEnv: 'COMTRADE_KEY' } }),
    );
    assert.equal(verdict, VERDICT.KEY);
    assert.match(reason, /server-side/);
  });

  it('distinguishes a public VITE_ key from a secret one', () => {
    const { reason } = verdictForResponse(
      observe({ source: { keyRequired: true, keyEnv: 'VITE_PUBLIC_KEY' } }),
    );
    assert.match(reason, /Public key/);
    assert.doesNotMatch(reason, /server-side/);
  });

  it('checks the key requirement before the error path', () => {
    // A declared key requirement is a property of the source, not something
    // inferred from a response, so a 403 must not turn it INCONCLUSIVE.
    const { verdict } = verdictForResponse(
      observe({ status: 403, ok: false, cors: {}, source: { keyRequired: true, keyEnv: 'K' } }),
    );
    assert.equal(verdict, VERDICT.KEY);
  });
});

describe('parity with the recorded probe run', () => {
  /**
   * Replays every observation in `data/probe-results.json` through the ladder
   * and asserts the verdict recorded at probe time comes back.
   *
   * Synthetic cases prove the rule does what I think it does; this proves it
   * does what the live run did. The extraction was behaviour-preserving when it
   * landed — 30 of 30 decidable rows identical — and this keeps it that way, so
   * any future change to the ladder has to account for every source whose
   * classification it moves.
   */
  it('reproduces every verdict from the recorded observations', async () => {
    const results = (await import('../data/probe-results.json')).default as {
      origin?: string;
      results?: unknown[];
    };
    const registry = (await import('../data/sources.json')).default;
    const byId = new Map(registry.sources.map((source) => [source.id, source]));

    const rows = (results.results ?? []) as Array<{
      id: string;
      verdict: string;
      get?: { status?: number; cors?: Record<string, string>; error?: string } | null;
    }>;
    assert.ok(rows.length > 0, 'no recorded probe observations to replay');

    const divergences: string[] = [];
    let decidable = 0;

    for (const row of rows) {
      // A transport failure is UNREACHABLE, decided before the ladder is
      // reached, so it is not this function's to reproduce.
      if (!row.get || row.get.error !== undefined || row.get.status === undefined) continue;
      decidable += 1;

      const status = row.get.status;
      const { verdict } = verdictForResponse({
        status,
        ok: status >= 200 && status < 300,
        cors: row.get.cors ?? {},
        origin: results.origin ?? ORIGIN,
        source: byId.get(row.id) ?? {},
      });
      if (verdict !== row.verdict) {
        divergences.push(`${row.id}: recorded ${row.verdict}, recomputed ${verdict}`);
      }
    }

    assert.deepEqual(divergences, [], 'the ladder now classifies a recorded response differently');
    assert.ok(decidable > 0, 'every recorded row was skipped — the replay asserted nothing');
  });
});

describe('origin matching', () => {
  it('accepts a wildcard and an exact match, case-insensitively', () => {
    assert.ok(originIsAllowed('*', ORIGIN));
    assert.ok(originIsAllowed(ORIGIN, ORIGIN));
    assert.ok(originIsAllowed(ORIGIN.toUpperCase(), ORIGIN));
  });

  it('rejects absence and a different origin', () => {
    assert.equal(originIsAllowed(undefined, ORIGIN), false);
    assert.equal(originIsAllowed('', ORIGIN), false);
    assert.equal(originIsAllowed('https://elsewhere.example', ORIGIN), false);
  });
});
