import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  contributingShortfall,
  factState,
  isRequired,
  type AnyFact,
  type DerivedInput,
  type DerivedProvenance,
  type Provenance,
} from '../src/facts/types';

/**
 * Planted cases for P3 — missing data propagates through required inputs
 * (rules 27 and 32).
 *
 * P3 was unimplementable for as long as `DerivedProvenance.inputs` held
 * provenances: a provenance records how a value was obtained, and "no data" is a
 * property of the value. This is the behaviour that became possible once inputs
 * became Facts.
 */
const fetched = (): Provenance => ({
  kind: 'fetch',
  sourceId: 'worldbank',
  requestUrl: 'https://example.test/x',
  httpStatus: 200,
  fetchedAt: '2026-01-01T00:00:00Z',
  cache: 'miss',
  raw: '1',
  extractedBy: 'test',
});

const failedFetch = (): Provenance => ({
  kind: 'fetch-failed',
  sourceId: 'worldbank',
  requestUrl: 'https://example.test/x',
  httpStatus: 500,
  reason: 'http',
  detail: 'boom',
  attemptedAt: '2026-01-01T00:00:00Z',
  attempts: 1,
  retryableAt: null,
});

const unconfigured = (): Provenance => ({ kind: 'unconfigured', sourceId: 'eia', keyEnv: 'EIA_KEY' });

const value = (v: number | null): AnyFact => ({
  value: v,
  asOf: '2026',
  tier: 'OFFICIAL',
  provenance: fetched(),
});

const withProvenance = (p: Provenance): AnyFact => ({ value: 1, asOf: '2026', tier: 'OFFICIAL', provenance: p });

const derived = (inputs: DerivedInput[]): DerivedProvenance => ({
  kind: 'derived',
  computedBy: 'test.ts',
  formula: 'sum',
  computedAt: '2026-01-01',
  inputs,
});

const fact = (provenance: Provenance): AnyFact => ({ value: 5, asOf: '2026', tier: 'DERIVED', provenance });

describe('P3 — requiredness', () => {
  it('UNDECLARED IS REQUIRED — fail closed', () => {
    /**
     * The polarity this whole rule turns on. Forgetting the declaration must
     * make a derivation more cautious, never less; the opposite default would
     * let every un-migrated derivation silently absorb missing data, which is
     * P3's own failure reintroduced by the migration meant to end it.
     */
    assert.equal(isRequired({ fact: value(1) }), true, 'an undeclared input must be treated as required');
    assert.equal(isRequired({ fact: value(1), required: true }), true);
    assert.equal(isRequired({ fact: value(1), required: false }), false, 'only an explicit false opts out');
  });
});

describe('P3 — nodata propagates through required inputs', () => {
  it('a required input with no value makes the derivation nodata', () => {
    assert.equal(factState(fact(derived([{ fact: value(null), required: true }]))), 'nodata');
  });

  it('an UNDECLARED empty input does the same, because undeclared is required', () => {
    assert.equal(factState(fact(derived([{ fact: value(null) }]))), 'nodata');
  });

  it('a CONTRIBUTING empty input does NOT make the derivation nodata', () => {
    // The result is still computable from the rest. Calling it "no data" would
    // be a bigger lie than the shortfall, which is disclosed as a caveat instead.
    assert.equal(
      factState(fact(derived([{ fact: value(null), required: false }, { fact: value(3), required: false }]))),
      'ok',
    );
  });
});

describe('P3 — the merged precedence ladder', () => {
  /**
   * broken > unavailable > unconfigured > nodata > ok.
   *
   * `nodata` is last because it is the quietest failure: the pipeline ran, the
   * source answered, and the answer was nothing. Everything above it means
   * something did not run at all, or ran wrong.
   */
  it('nodata loses to unconfigured', () => {
    const state = factState(
      fact(derived([{ fact: value(null) }, { fact: withProvenance(unconfigured()) }])),
    );
    assert.equal(state, 'unconfigured');
  });

  it('nodata loses to unavailable', () => {
    const state = factState(fact(derived([{ fact: value(null) }, { fact: withProvenance(failedFetch()) }])));
    assert.equal(state, 'unavailable');
  });

  it('nodata loses to broken', () => {
    const broken: AnyFact = { value: 1, asOf: '2026', tier: 'OFFICIAL', provenance: null };
    assert.equal(factState(fact(derived([{ fact: value(null) }, { fact: broken }]))), 'broken');
  });

  it('nodata beats ok, which is the whole point', () => {
    assert.equal(factState(fact(derived([{ fact: value(null) }, { fact: value(2) }]))), 'nodata');
  });
});

describe('P3 — a contributing shortfall is disclosed, never absorbed', () => {
  it('counts the contributing inputs that came back empty', () => {
    const shortfall = contributingShortfall(
      derived([
        { fact: value(null), required: false },
        { fact: value(2), required: false },
        { fact: value(3), required: false },
      ]),
    );
    assert.deepEqual(shortfall, { missing: 1, contributing: 3 });
  });

  it('says nothing when every contributing input answered', () => {
    assert.equal(
      contributingShortfall(derived([{ fact: value(1), required: false }, { fact: value(2), required: false }])),
      null,
    );
  });

  it('says nothing when there are no contributing inputs at all', () => {
    // A derivation of only required inputs cannot have a shortfall — a missing
    // one changes its state instead.
    assert.equal(contributingShortfall(derived([{ fact: value(null), required: true }])), null);
  });

  it('does not count required inputs toward the shortfall', () => {
    // A missing REQUIRED input is not a shortfall, it is a failure, and it is
    // already reported by the state. Counting it twice would tell the reader the
    // value is both unusable and merely incomplete.
    const shortfall = contributingShortfall(
      derived([{ fact: value(null), required: true }, { fact: value(4), required: false }]),
    );
    assert.equal(shortfall, null);
  });
});
