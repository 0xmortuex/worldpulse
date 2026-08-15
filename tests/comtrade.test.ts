import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CMD_TOTAL,
  PARTNER_WORLD,
  buildAnnualTradeUrl,
  parse,
  partnersOnly,
  tradeValueFact,
} from '../src/sources/comtrade';
import { ShapeError, type FetchContext } from '../src/sources/adapter';
import { FIXTURES } from './fixtures';
import { factState } from '../src/facts/types';

const CTX: FetchContext = {
  requestUrl: FIXTURES['comtrade']!.requestUrl,
  httpStatus: 200,
  fetchedAt: '2026-08-15T13:00:00.000Z',
  cache: 'miss',
  fromFixture: true,
};

const LIVE = parse(FIXTURES['comtrade']!.body);

describe('Comtrade — the URL the app builds', () => {
  it('never contains a key', () => {
    const url = buildAnnualTradeUrl({ reporterCode: 842, year: 2023, flowCode: 'X' });
    assert.equal(url.includes('subscription-key'), false);
  });

  /**
   * THE QUERY IS THE FILTER, not a convenience.
   *
   * Without `cmdCode=TOTAL` the same request returns 100,000 rows mixing
   * individual HS commodity lines with the `999999` all-commodities row.
   * Summing that response double-counts a country's entire trade and produces a
   * number that looks plausible because it is roughly twice a plausible number.
   */
  it('always asks for TOTAL, because the unfiltered response double-counts', () => {
    const url = buildAnnualTradeUrl({ reporterCode: 842, year: 2023, flowCode: 'X' });
    assert.ok(url.includes(`cmdCode=${CMD_TOTAL}`), url);
  });
});

describe('Comtrade — the captured response', () => {
  it('parses every row', () => {
    assert.ok(LIVE.rows.length > 100, `only ${LIVE.rows.length} rows`);
    assert.equal(LIVE.count, LIVE.rows.length, 'the envelope count disagrees with the rows');
  });

  it('separates the World aggregate from real partners', () => {
    const world = LIVE.rows.filter((row) => row.partnerCode === PARTNER_WORLD);
    assert.equal(world.length, 1, 'expected exactly one World row');
    assert.equal(partnersOnly(LIVE.rows).length, LIVE.rows.length - 1);
    assert.equal(partnersOnly(LIVE.rows).some((r) => r.partnerCode === PARTNER_WORLD), false);
  });

  /**
   * THE EVIDENCE FOR OPEN-QUESTIONS 20, asserted so it cannot drift unnoticed.
   *
   * Every TOTAL row is flagged unreported and aggregated. If a future capture
   * shows reported rows, the question has changed and this fails — which is the
   * point.
   */
  it('every TOTAL row is flagged unreported and aggregated', () => {
    assert.equal(LIVE.rows.every((row) => row.isAggregate), true, 'a TOTAL row was not an aggregate');
    assert.equal(
      LIVE.rows.some((row) => row.isReported),
      false,
      'a TOTAL row is now reported — OPEN-QUESTIONS 20 must be revisited',
    );
  });

  it('an unreported figure renders ESTIMATE and says why', () => {
    const row = LIVE.rows[0]!;
    const fact = tradeValueFact(row, CTX);
    assert.equal(fact.tier, 'ESTIMATE');
    assert.match(fact.note ?? '', /did not submit|estimated/i);
    assert.equal(factState(fact), 'ok', 'the value is present; only the tier is qualified');
  });
});

describe('Comtrade — planted cases (rule 27)', () => {
  const row = (over: Partial<Record<string, unknown>> = {}) => ({
    reporterCode: 842,
    partnerCode: 124,
    refYear: 2023,
    flowCode: 'X',
    cmdCode: 'TOTAL',
    primaryValue: 1000,
    isReported: true,
    isAggregate: false,
    isQtyEstimated: false,
    isNetWgtEstimated: false,
    isGrossWgtEstimated: false,
    legacyEstimationFlag: 0,
    ...over,
  });

  const payload = (rows: unknown[], over: Record<string, unknown> = {}) => ({
    elapsedTime: '1 secs',
    count: rows.length,
    data: rows,
    error: '',
    ...over,
  });

  /**
   * RULE 37: SUCCESS IS IN THE BODY.
   *
   * Comtrade's envelope carries `error` as a string that is `""` on success. A
   * 200 with a populated `error` is a failed query, and parsing `data` anyway
   * would build facts out of an error response.
   */
  it('refuses an envelope carrying an error, whatever the status was', () => {
    assert.throws(() => parse(payload([row()], { error: 'Invalid reporterCode' })), ShapeError);
    assert.throws(() => parse(payload([row()], { error: 'Invalid reporterCode' })), /carries an error/);
    // The empty string is success and must not be mistaken for one.
    assert.doesNotThrow(() => parse(payload([row()], { error: '' })));
  });

  it('a reported, unestimated figure is OFFICIAL with no caveat', () => {
    const parsed = parse(payload([row()]));
    const fact = tradeValueFact(parsed.rows[0]!, CTX);
    assert.equal(fact.tier, 'OFFICIAL');
    assert.equal(fact.note, undefined, 'an unqualified figure must not carry a caveat');
  });

  it('any single estimation flag makes the row an estimate', () => {
    // Comtrade splits estimation across quantity, weight and a legacy marker.
    // For a VALUE fact they all mean the same thing, and missing one would let
    // an estimated figure render as official.
    for (const flagField of ['isQtyEstimated', 'isNetWgtEstimated', 'isGrossWgtEstimated']) {
      const parsed = parse(payload([row({ [flagField]: true })]));
      assert.equal(tradeValueFact(parsed.rows[0]!, CTX).tier, 'ESTIMATE', `${flagField} was ignored`);
    }
    const legacy = parse(payload([row({ legacyEstimationFlag: 1 })]));
    assert.equal(tradeValueFact(legacy.rows[0]!, CTX).tier, 'ESTIMATE', 'legacyEstimationFlag was ignored');
  });

  it('an absent value is absent, never zero', () => {
    const parsed = parse(payload([row({ primaryValue: null })]));
    assert.equal(parsed.rows[0]!.primaryValue, null);
    assert.equal(factState(tradeValueFact(parsed.rows[0]!, CTX)), 'nodata');

    const zero = parse(payload([row({ primaryValue: 0 })]));
    assert.equal(zero.rows[0]!.primaryValue, 0);
    assert.equal(factState(tradeValueFact(zero.rows[0]!, CTX)), 'ok', 'a reported zero is a value');
  });

  it('refuses a non-numeric value rather than coercing it', () => {
    assert.throws(() => parse(payload([row({ primaryValue: '1000' })])), ShapeError);
    assert.throws(() => parse(payload([row({ reporterCode: 'USA' })])), ShapeError);
  });

  it('refuses a flag that is neither boolean nor 0/1', () => {
    assert.throws(() => parse(payload([row({ isReported: 'yes' })])), ShapeError);
  });

  it('accepts 0/1 in place of booleans, which this API mixes', () => {
    const parsed = parse(payload([row({ isQtyEstimated: 1, isReported: 0 })]));
    assert.equal(parsed.rows[0]!.isEstimated, true);
    assert.equal(parsed.rows[0]!.isReported, false);
  });
});
