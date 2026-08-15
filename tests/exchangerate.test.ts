import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ExchangeRateApiError,
  MISSING_KEY,
  QUOTA_EXCEEDED,
  buildQuotesUrl,
  parse,
  rateFact,
} from '../src/sources/exchangerate';
import { ShapeError, type FetchContext } from '../src/sources/adapter';
import { FIXTURES } from './fixtures';
import { factState } from '../src/facts/types';

const CTX: FetchContext = {
  requestUrl: FIXTURES['exchangerate-host']!.requestUrl,
  httpStatus: 200,
  fetchedAt: '2026-08-15T14:44:04.000Z',
  cache: 'miss',
  fromFixture: true,
};

const LIVE = parse(FIXTURES['exchangerate-host']!.body);

describe('exchangerate.host — the URL the app builds', () => {
  it('never contains a key', () => {
    assert.equal(buildQuotesUrl({ source: 'USD', currencies: ['EUR'] }).includes('access_key'), false);
  });
});

describe('exchangerate.host — the captured response', () => {
  it('parses quotes with the base stripped from each pair', () => {
    assert.equal(LIVE.source, 'USD');
    assert.ok(LIVE.rates.size > 0);
    for (const [currency, rate] of LIVE.rates) {
      assert.equal(currency.length, 3, `"${currency}" still carries the base`);
      assert.ok(Number.isFinite(rate) && rate > 0);
    }
  });

  it('turns the unix timestamp into an instant', () => {
    assert.match(LIVE.asOf, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(Number.isFinite(Date.parse(LIVE.asOf)));
  });

  it('a quoted rate is OFFICIAL and names the vendor', () => {
    const fact = rateFact(LIVE, 'EUR', CTX);
    assert.equal(factState(fact), 'ok');
    assert.equal(fact.tier, 'OFFICIAL');
    // The app's primary currency source is the ECB via Frankfurter; a reader
    // comparing the two must know which they are looking at.
    assert.match(fact.note ?? '', /not a central bank reference rate/i);
  });

  it('an unquoted currency is absent, never a rate of zero', () => {
    const fact = rateFact(LIVE, 'ZWL', CTX);
    assert.equal(fact.value, null);
    assert.equal(factState(fact), 'nodata');
  });
});

describe('exchangerate.host — planted cases (rule 27)', () => {
  const ok = (over: Record<string, unknown> = {}) => ({
    success: true,
    terms: 'https://currencylayer.com/terms',
    privacy: 'https://currencylayer.com/privacy',
    timestamp: 1786804986,
    source: 'USD',
    quotes: { USDEUR: 0.864504 },
    ...over,
  });

  /**
   * THE CASE THIS ADAPTER EXISTS FOR — rule 37, measured on this very source.
   *
   * Unauthenticated returns **HTTP 200** with `success:false`. Any check scoring
   * on the status line reads a broken key as a working one, which is exactly
   * what happened to the auth sweep that first measured this API.
   */
  it('refuses a 200 that carries success:false, and says which error it was', () => {
    const missingKey = {
      success: false,
      error: { code: 101, type: 'missing_access_key', info: 'You have not supplied an API Access Key.' },
    };
    assert.throws(() => parse(missingKey), ExchangeRateApiError);
    try {
      parse(missingKey);
      assert.fail('expected a throw');
    } catch (error) {
      assert.ok(error instanceof ExchangeRateApiError);
      assert.equal(error.code, MISSING_KEY);
      assert.equal(error.type, 'missing_access_key');
    }
  });

  /**
   * An API refusal is NOT schema drift, and the types keep them apart.
   *
   * `ShapeError` means the contract moved and someone must read the adapter.
   * `ExchangeRateApiError` means the request was understood and refused — a key
   * or a quota, needing no code change at all. Collapsing them would send every
   * expired key to whoever maintains the parser.
   */
  it('distinguishes a refused request from a drifted contract', () => {
    const quota = { success: false, error: { code: QUOTA_EXCEEDED, type: 'usage_limit_reached', info: 'quota' } };
    assert.throws(() => parse(quota), ExchangeRateApiError);
    assert.throws(() => parse(quota), (e: Error) => !(e instanceof ShapeError));

    // success:false with NO error object is genuinely a shape problem: the
    // vendor documents an error object on every failure.
    assert.throws(() => parse({ success: false }), ShapeError);
  });

  it('refuses a quotes key that does not start with the declared base', () => {
    /**
     * Stripping the first three characters is only correct while every key
     * carries the declared base. A mixed-base response would silently mislabel
     * every rate — EURGBP read as a USD→GBP rate.
     */
    assert.throws(() => parse(ok({ quotes: { EURGBP: 0.85 } })), ShapeError);
    assert.throws(() => parse(ok({ quotes: { EURGBP: 0.85 } })), /mixes bases/);
  });

  it('refuses a malformed pair key rather than slicing it blindly', () => {
    assert.throws(() => parse(ok({ quotes: { USD: 1 } })), ShapeError);
    assert.throws(() => parse(ok({ quotes: { USDEURX: 1 } })), ShapeError);
  });

  it('refuses a non-numeric rate', () => {
    assert.throws(() => parse(ok({ quotes: { USDEUR: '0.86' } })), ShapeError);
    assert.throws(() => parse(ok({ quotes: { USDEUR: null } })), ShapeError);
  });

  it('refuses a missing or malformed timestamp rather than stamping now', () => {
    // Stamping the current time would make a stale quote look fresh, which is
    // the failure the asOf field exists to prevent.
    assert.throws(() => parse(ok({ timestamp: undefined })), ShapeError);
    assert.throws(() => parse(ok({ timestamp: '1786804986' })), ShapeError);
  });

  it('refuses a source that is not a three-letter code', () => {
    assert.throws(() => parse(ok({ source: 'DOLLAR' })), ShapeError);
  });
});
