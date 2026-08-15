import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DATA_FLAGS,
  TYPE_REGION,
  buildAnnualUrl,
  countriesOnly,
  parse,
  parseValue,
  valueFact,
  type EnergyRow,
} from '../src/sources/eia';
import { ShapeError, type FetchContext } from '../src/sources/adapter';
import { FIXTURES } from './fixtures';
import { factState } from '../src/facts/types';

const CTX: FetchContext = {
  requestUrl: FIXTURES['eia']!.requestUrl,
  httpStatus: 200,
  fetchedAt: '2026-08-15T13:00:00.000Z',
  cache: 'miss',
  fromFixture: true,
};

const LIVE = parse(FIXTURES['eia']!.body);

describe('EIA — the URL the app builds', () => {
  it('never contains a key', () => {
    assert.equal(
      buildAnnualUrl({ productId: '2', activityId: '2', startYear: 2023, endYear: 2023, length: 10 }).includes('api_key'),
      false,
    );
  });

  /**
   * Rule 37, the same trap as congress.gov's `%2B`. EIA's bracketed array
   * parameters must reach it as literal brackets: `URLSearchParams` encodes them
   * to `%5B%5D`, and an unrecognised parameter is IGNORED rather than rejected —
   * so the response would be a successful 200 for every product and activity
   * rather than the one asked for.
   */
  it('sends bracketed facet parameters unencoded, or the filter is silently dropped', () => {
    const url = buildAnnualUrl({ productId: '2', activityId: '2', startYear: 2023, endYear: 2023, length: 10 });
    assert.ok(url.includes('facets[productId][]=2'), url);
    assert.ok(url.includes('facets[activityId][]=2'), url);
    assert.equal(url.includes('%5B'), false, 'brackets were encoded and the facet filter is now inert');
  });
});

describe('EIA — the captured response', () => {
  it('parses every row', () => {
    assert.ok(LIVE.rows.length > 100, `only ${LIVE.rows.length} rows`);
  });

  /**
   * THE FIXTURE WAS CHOSEN FOR ITS FLAGS. If a re-capture loses them, this fails
   * rather than quietly testing nothing.
   */
  it('carries the flags the fixture exists to exercise', () => {
    const seen = new Set(LIVE.rows.map((row) => row.flag).filter((flag) => flag !== null));
    for (const expected of ['country-did-not-exist', 'included-elsewhere', 'rounds-to-zero'] as const) {
      assert.ok(seen.has(expected), `the capture no longer contains a "${expected}" row`);
    }
  });

  it('a country that did not exist yields no value, and says why', () => {
    const row = LIVE.rows.find((r) => r.flag === 'country-did-not-exist');
    assert.ok(row, 'expected a country-did-not-exist row');
    // Czechoslovakia has rows for 2023. The value is "--", which must not become 0.
    assert.equal(row.value, null, 'the sentinel "--" was parsed as a number');
    const fact = valueFact(row, CTX);
    assert.equal(factState(fact), 'nodata');
    assert.match(fact.note ?? '', /did not exist/i);
  });

  it('a value counted elsewhere is absent here, not zero', () => {
    const row = LIVE.rows.find((r) => r.flag === 'included-elsewhere');
    assert.ok(row);
    assert.equal(row.value, null, 'the sentinel "ie" was parsed as a number');
    assert.match(valueFact(row, CTX).note ?? '', /under another entity/i);
  });

  /**
   * The subtlest of the flags: a REAL value that the publisher rounds to zero.
   * It is neither absent nor exactly zero, and both of those renderings would be
   * false.
   */
  it('a rounds-to-zero row keeps its real value and says it is not exactly zero', () => {
    const row = LIVE.rows.find((r) => r.flag === 'rounds-to-zero');
    assert.ok(row);
    assert.notEqual(row.value, null, 'a rounds-to-zero row has a value; it is not an absence');
    assert.ok((row.value ?? 0) > 0, 'the non-rounded value should be positive');
    assert.match(valueFact(row, CTX).note ?? '', /not exactly zero/i);
  });

  it('regions are present and separable from countries', () => {
    const regions = LIVE.rows.filter((row) => row.countryRegionTypeId === TYPE_REGION);
    assert.ok(regions.length > 0, 'the capture should include regional aggregates');
    assert.equal(countriesOnly(LIVE.rows).some((row) => row.countryRegionTypeId === TYPE_REGION), false);
    assert.ok(countriesOnly(LIVE.rows).length < LIVE.rows.length, 'nothing was filtered');
  });

  it('the fixture carries no key, only the echo with its value replaced', () => {
    const body = FIXTURES['eia']!.body as { request?: { params?: Record<string, unknown> } };
    // The echo must still be VISIBLE — dropping the field would hide that EIA
    // reflects the key at all.
    assert.equal(body.request?.params?.['api_key'], 'REDACTED-AT-CAPTURE');
  });
});

describe('EIA — planted cases (rule 27)', () => {
  const row = (over: Partial<Record<string, unknown>> = {}) => ({
    period: '2023',
    productId: '2',
    productName: 'Electricity',
    activityId: '2',
    activityName: 'Consumption',
    countryRegionId: 'TST',
    countryRegionName: 'Testland',
    countryRegionTypeId: 'c',
    countryRegionTypeName: 'Country',
    dataFlagId: null,
    dataFlagDescription: null,
    unitName: 'billion kilowatthours',
    value: '1.5',
    unit: 'BKWH',
    ...over,
  });

  const payload = (rows: unknown[]) => ({ response: { total: rows.length, data: rows }, request: {} });

  it('every documented sentinel becomes null, never zero', () => {
    /**
     * The idiom this adapter exists to refuse is `Number(v) || 0`, which turns
     * each of these into a confident zero.
     */
    for (const sentinel of ['--', 'ie', 'w', 'NA', 'na', '(s)']) {
      assert.equal(parseValue(sentinel, 'planted'), null, `"${sentinel}" was not treated as absent`);
    }
    assert.equal(parseValue('', 'planted'), null);
    assert.equal(parseValue(null, 'planted'), null);
    assert.equal(parseValue('0', 'planted'), 0, 'a real zero must survive as zero');
    assert.equal(parseValue('.824035908', 'planted'), 0.824035908);
  });

  it('an UNRECOGNISED token throws rather than being guessed at', () => {
    // A new sentinel must not silently become absent or zero: that is schema
    // drift, and the whole point of the sentinel list is that it is closed.
    assert.throws(() => parseValue('sometimes', 'planted'), ShapeError);
    assert.throws(() => parseValue('1.2.3', 'planted'), ShapeError);
  });

  /**
   * WITHHELD and STEO-ESTIMATE do not occur in electricity consumption, so they
   * are planted — but they are confirmed live in other products: AUS 2025
   * petroleum returns "w" with flag 6, and ABW 2024 motor gasoline returns flag
   * 10. Stated so this is a gap in the CAPTURE, not in the evidence.
   */
  it('a withheld value is absent with a reason — planted, live-confirmed in petroleum', () => {
    const parsed = parse(payload([row({ value: 'w', dataFlagId: '6' })]));
    assert.equal(parsed.rows[0]!.value, null);
    assert.equal(parsed.rows[0]!.flag, 'withheld');
    assert.match(valueFact(parsed.rows[0]!, CTX).note ?? '', /cannot publish/i);
  });

  it('an estimated row is ESTIMATE because the SOURCE says so — planted, live-confirmed in motor gasoline', () => {
    /**
     * This is what OPEN-QUESTIONS 17 wanted and Ember could not give: a per-row
     * reported-versus-modelled distinction published by the source. The tier
     * follows EIA's flag, not our judgement.
     */
    const estimated = parse(payload([row({ dataFlagId: '10', value: '61.59536267' })]));
    const ordinary = parse(payload([row()]));
    assert.equal(valueFact(estimated.rows[0]!, CTX).tier, 'ESTIMATE');
    assert.equal(valueFact(ordinary.rows[0]!, CTX).tier, 'OFFICIAL');
    assert.match(valueFact(estimated.rows[0]!, CTX).note ?? '', /Short-Term Energy Outlook/i);
  });

  it('an unknown flag id throws rather than rendering as an ordinary value', () => {
    assert.throws(() => parse(payload([row({ dataFlagId: '99' })])), ShapeError);
    assert.throws(() => parse(payload([row({ dataFlagId: '99' })])), /does not know/);
  });

  it('an unknown country/region type throws, because the split prevents double-counting', () => {
    assert.throws(() => parse(payload([row({ countryRegionTypeId: 'x' })])), ShapeError);
  });

  it('refuses a period that is not a four-digit year', () => {
    assert.throws(() => parse(payload([row({ period: '2023-01' })])), ShapeError);
  });

  it('every documented flag id maps to a distinct meaning', () => {
    const meanings = Object.values(DATA_FLAGS);
    assert.equal(new Set(meanings).size, meanings.length, 'two flags share a meaning');
  });

  it('a reported zero and an absence are different facts', () => {
    // Rule 30, at this adapter's boundary.
    const parsed = parse(payload([row({ value: '0' }), row({ value: '--', dataFlagId: '3', countryRegionId: 'CSK' })]));
    const [zero, absent] = parsed.rows as [EnergyRow, EnergyRow];
    assert.equal(zero.value, 0);
    assert.equal(absent.value, null);
    assert.equal(factState(valueFact(zero, CTX)), 'ok');
    assert.equal(factState(valueFact(absent, CTX)), 'nodata');
  });
});
