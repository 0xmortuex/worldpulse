import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { factState, type AnyFact, type FailedFetchProvenance, type Provenance } from '../src/facts/types';
import { factHtml } from '../src/facts/badge';

/**
 * The fifth fact state and P9.
 *
 * The point of every test here is one distinction: a failed fetch is a fact
 * about OUR REQUEST, and `nodata` is a fact about THE SUBJECT. Collapsing them
 * renders "no GDP data for this country" when what happened is that we could not
 * reach the World Bank.
 */
const failed = (over: Partial<FailedFetchProvenance> = {}): FailedFetchProvenance => ({
  kind: 'fetch-failed',
  sourceId: 'worldbank',
  requestUrl: 'https://api.worldbank.org/v2/country/FRA/indicator/NY.GDP.MKTP.CD',
  httpStatus: 503,
  attemptedAt: '2026-08-12T20:00:00.000Z',
  attempts: 3,
  reason: 'http',
  detail: 'upstream returned 503 three times',
  retryableAt: '2026-08-12T20:05:00.000Z',
  ...over,
});

const ok = (): Provenance => ({
  kind: 'fetch',
  sourceId: 'worldbank',
  requestUrl: 'https://api.worldbank.org/v2/x',
  httpStatus: 200,
  fetchedAt: '2026-08-12T20:00:00.000Z',
  cache: 'miss',
  raw: {},
  extractedBy: 'test',
});

const fact = (provenance: Provenance | null, value: unknown = null): AnyFact => ({
  value,
  asOf: '2024',
  tier: 'OFFICIAL',
  provenance,
});

describe('the unavailable fact state', () => {
  it('is unavailable, not nodata, when the fetch failed', () => {
    assert.equal(
      factState(fact(failed())),
      'unavailable',
      'a failed request was reported as the subject having no data',
    );
  });

  it('is unavailable, not broken — a source being down is not a defect in this app', () => {
    assert.notEqual(factState(fact(failed())), 'broken');
  });

  it('stays unavailable even for a transport failure with no status at all', () => {
    assert.equal(factState(fact(failed({ httpStatus: null, reason: 'network' }))), 'unavailable');
  });

  it('keeps nodata meaning what it meant — the source answered and had nothing', () => {
    assert.equal(factState(fact(ok(), null)), 'nodata');
  });
});

describe('P9 — unavailable propagates through derivations', () => {
  const derived = (inputs: Provenance[]): Provenance => ({
    kind: 'derived',
    computedBy: 'test.ts',
    formula: 'a + b',
    computedAt: '2026-08-12T20:00:00.000Z',
    // Facts, not provenances, with non-null values so these cases keep testing
    // P9 rather than accidentally testing P3's nodata path.
    inputs: inputs.map((provenance) => ({
      fact: { value: 1, asOf: '2026-08-12', tier: 'OFFICIAL' as const, provenance },
      required: true,
    })),
  });

  it('makes a derivation unavailable when any input failed to fetch', () => {
    assert.equal(factState(fact(derived([ok(), failed()]), 5)), 'unavailable');
  });

  it('does not fire when every input resolved', () => {
    assert.equal(factState(fact(derived([ok(), ok()]), 5)), 'ok');
  });

  it('lets broken outrank unavailable — a defect here outranks a defect elsewhere', () => {
    // An untraceable fetch: no requestUrl, so nobody could re-run it.
    const broken: Provenance = {
      kind: 'fetch',
      sourceId: 'worldbank',
      requestUrl: '',
      httpStatus: 200,
      fetchedAt: '2026-08-12T20:00:00.000Z',
      cache: 'miss',
      raw: {},
      extractedBy: 'test',
    };
    assert.equal(factState(fact(derived([broken, failed()]), 5)), 'broken');
  });

  it('lets unavailable outrank unconfigured — the actionable one wins', () => {
    const unconfigured: Provenance = { kind: 'unconfigured', sourceId: 'comtrade', keyEnv: 'COMTRADE_KEY' };
    assert.equal(factState(fact(derived([unconfigured, failed()]), 5)), 'unavailable');
  });

  it('propagates through nested derivations', () => {
    assert.equal(factState(fact(derived([derived([failed()]), ok()]), 5)), 'unavailable');
  });
});

describe('rendering an unavailable fact', () => {
  it('does not put a tier badge over a value that was never received', () => {
    const html = factHtml(fact(failed()));
    assert.doesNotMatch(html, /badge--official/, 'an OFFICIAL badge was rendered over a failed request');
    assert.match(html, /badge--unavailable/);
  });

  it('does not word it as "no data"', () => {
    const html = factHtml(fact(failed()));
    assert.doesNotMatch(
      html,
      />no data</,
      'a failed request was worded as the subject having no data — the conflation this state exists to prevent',
    );
    assert.match(html, /source unavailable/);
  });

  it('does not date an absence', () => {
    // asOf dates the DATA. Nothing was received, so there is nothing to date,
    // and a confident date over an absence is a timestamp that lies.
    assert.doesNotMatch(factHtml(fact(failed())), /as of/);
  });

  it('still carries the state in the DOM so panels can aggregate it', () => {
    assert.match(factHtml(fact(failed())), /data-state="unavailable"/);
  });
});
