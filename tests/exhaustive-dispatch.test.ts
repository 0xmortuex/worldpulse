import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { absentValueWording, factHtml, stateCarriesAsOf } from '../src/facts/badge';
import type { AnyFact, FactState, Provenance } from '../src/facts/types';

/**
 * Exhaustiveness over the two unions.
 *
 * The compile-time half — `assertNever` in every `default` arm — cannot be
 * asserted from a test, because a test that fails to compile is not a failing
 * test, it is a broken build. So this covers the two halves it can:
 *
 *   1. every declared state is handled by every dispatch, at runtime
 *   2. the `default` arms exist in the source, so the compile-time guard is
 *      actually present rather than assumed
 *
 * The second is deliberately a source-level check. It is the weakest test here
 * and it is the one guarding the mechanism that would otherwise be invisible:
 * an `assertNever` deleted during a refactor removes the protection silently and
 * every runtime test still passes.
 */
const ALL_STATES: FactState[] = ['ok', 'nodata', 'broken', 'unconfigured', 'unavailable'];

/** One provenance that produces each state, so every branch is reachable. */
const PROVENANCE_FOR: Record<FactState, Provenance | null> = {
  ok: {
    kind: 'fetch',
    sourceId: 'worldbank',
    requestUrl: 'https://api.worldbank.org/v2/x',
    httpStatus: 200,
    fetchedAt: '2026-08-12T20:00:00.000Z',
    cache: 'hit',
    raw: {},
    extractedBy: 'test',
  },
  nodata: {
    kind: 'fetch',
    sourceId: 'worldbank',
    requestUrl: 'https://api.worldbank.org/v2/x',
    httpStatus: 200,
    fetchedAt: '2026-08-12T20:00:00.000Z',
    cache: 'hit',
    raw: {},
    extractedBy: 'test',
  },
  broken: null,
  unconfigured: { kind: 'unconfigured', sourceId: 'comtrade', keyEnv: 'COMTRADE_KEY' },
  unavailable: {
    kind: 'fetch-failed',
    sourceId: 'worldbank',
    requestUrl: 'https://api.worldbank.org/v2/x',
    httpStatus: 503,
    attemptedAt: '2026-08-12T20:00:00.000Z',
    attempts: 3,
    reason: 'http',
    detail: 'upstream 503',
    retryableAt: null,
  },
};

const factFor = (state: FactState): AnyFact => ({
  value: state === 'ok' || state === 'broken' ? 42 : null,
  asOf: '2024',
  tier: 'OFFICIAL',
  provenance: PROVENANCE_FOR[state],
});

describe('every fact state is handled by every dispatch', () => {
  for (const state of ALL_STATES) {
    it(`renders "${state}" without falling through`, () => {
      assert.doesNotThrow(() => stateCarriesAsOf(state));
      assert.doesNotThrow(() => absentValueWording(state));
      const html = factHtml(factFor(state));
      assert.match(html, /class="fact"/);
    });
  }

  it('gives the two non-answer states different wording from each other', () => {
    // The distinction the fifth state exists for. If these ever collapse to the
    // same string, the app is telling a reader that a failed request means the
    // subject has no data.
    const wordings = ALL_STATES.map(absentValueWording).filter((w): w is string => w !== null);
    assert.equal(new Set(wordings).size, wordings.length, `wording collided: ${wordings.join(', ')}`);
  });

  it('never puts a tier badge on a state that has no value to describe', () => {
    for (const state of ['unconfigured', 'unavailable'] as FactState[]) {
      const html = factHtml(factFor(state));
      assert.doesNotMatch(
        html,
        /badge--official|badge--estimate|badge--derived/,
        `${state} rendered a tier badge — the fall-through defect`,
      );
    }
  });

  it('dates only the states that have data for a date to describe', () => {
    assert.equal(stateCarriesAsOf('ok'), true);
    for (const state of ['broken', 'unconfigured', 'unavailable'] as FactState[]) {
      assert.equal(stateCarriesAsOf(state), false, `${state} carried a date over an absent or untrusted value`);
    }
  });
});

describe('the compile-time guard is present in the source', () => {
  const DISPATCHES: Array<[string, string[]]> = [
    ['src/facts/badge.ts', ['sourceName', 'badgeMarkup', 'valueMarkup', 'stateCarriesAsOf', 'absentValueWording']],
    ['src/facts/inspector.ts', ['renderProvenance']],
    ['src/facts/types.ts', ['provenanceState', 'resolutionClaim']],
  ];

  for (const [file, dispatches] of DISPATCHES) {
    it(`${file} guards each of its union dispatches with assertNever`, () => {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      for (const name of dispatches) {
        assert.match(
          source,
          new RegExp(`assertNever\\([\\s\\S]{0,40}'${name}'\\)`),
          `${file}: ${name} has no assertNever guard — a new union member would fall through it silently`,
        );
      }
    });
  }
});
