import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildYearlyUrl,
  findSeries,
  generationOnly,
  isFlowSeries,
  leafSeries,
  parse,
  seriesFact,
  type GenerationRow,
} from '../src/sources/ember';
import { ShapeError, type FetchContext } from '../src/sources/adapter';
import { FIXTURES } from './fixtures';

/**
 * Ember's contract, checked against a REAL CAPTURE and against planted cases.
 *
 * The capture is Austria 2022–2023, chosen because it carries three hazards at
 * once rather than because it is representative. The planted cases carry the two
 * the API would not produce on demand — noted as such, not quietly omitted.
 */

const CTX: FetchContext = {
  requestUrl: FIXTURES['ember-electricity']!.requestUrl,
  httpStatus: 200,
  fetchedAt: '2026-08-15T13:00:00.000Z',
  cache: 'miss',
  fromFixture: true,
};

const LIVE = parse(FIXTURES['ember-electricity']!.body);

describe('Ember — the URL the app builds', () => {
  it('never contains a key, because Ember takes its key in the query string', () => {
    /**
     * The load-bearing security property of this adapter. Ember rejects
     * `Authorization: Bearer` and `X-API-Key` (both measured, both 403) and
     * accepts only `?api_key=`. A query-string key cannot go in the bundle, so
     * the builder emits none and the Worker appends it.
     */
    const url = buildYearlyUrl({ iso3: 'AUT', startYear: 2022, endYear: 2023 });
    assert.equal(url.includes('api_key'), false, 'the builder leaked a key parameter');
    assert.match(url, /entity_code=AUT/);
    assert.match(url, /start_date=2022/);
    assert.match(url, /end_date=2023/);
  });

  it('the committed fixture contains no key material', () => {
    const text = JSON.stringify(FIXTURES['ember-electricity']!.body);
    assert.equal(/api_key/i.test(text), false, 'the capture echoed a key back into the fixture');
  });
});

describe('Ember — the captured response', () => {
  it('parses, and reports the record count the API claimed', () => {
    assert.ok(LIVE.rows.length > 0);
    assert.equal(LIVE.recordCount, LIVE.rows.length, 'stats disagrees with the rows delivered');
  });

  /**
   * THE DOUBLE-COUNT HAZARD, on real data.
   *
   * A single response mixes leaf fuels with sums over them. Summing `series` as
   * it arrives roughly doubles the total and produces a chart that looks
   * entirely plausible — which is why this is asserted on the capture rather
   * than described in a comment.
   */
  it('summing every series double-counts, and leafSeries is what prevents it', () => {
    const year = 2022;
    const all = LIVE.rows.filter((row) => row.year === year);
    const leaves = leafSeries(all);

    const total = findSeries(all, 'Total generation', year);
    assert.ok(total, 'the capture should contain Total generation');
    assert.ok(total.isAggregateSeries, 'Total generation must be flagged as an aggregate');

    const sumAll = all.reduce((n, r) => n + (r.generationTwh ?? 0), 0);
    const sumLeaves = generationOnly(all).reduce((n, r) => n + (r.generationTwh ?? 0), 0);
    const reported = total.generationTwh ?? 0;

    assert.ok(
      sumAll > reported * 1.8,
      `summing everything gave ${sumAll.toFixed(1)} against a reported total of ${reported.toFixed(1)} — ` +
        'the hazard this filter exists for should be large and obvious',
    );
    // The leaves reconstruct the reported total. Tolerance is Ember's own
    // rounding to two decimals across ~10 series, not a fudge factor.
    assert.ok(
      Math.abs(sumLeaves - reported) < 0.5,
      `generation-only sum ${sumLeaves.toFixed(2)} should reconstruct Total generation ${reported.toFixed(2)}`,
    );
    assert.ok(leaves.length < all.length, 'nothing was filtered');
  });

  /**
   * THE CAPTURED NEGATIVE. Austria exported more than it imported in 2023.
   */
  it('carries a negative generation value, and it is a flow rather than a source', () => {
    const negatives = LIVE.rows.filter((row) => (row.generationTwh ?? 0) < 0);
    assert.ok(negatives.length > 0, 'the fixture was chosen to contain one');
    for (const row of negatives) {
      assert.ok(
        isFlowSeries(row.series),
        `${row.series} is negative but is not declared a flow — a generation source went negative, ` +
          'which would break the mix and needs a decision, not a filter',
      );
    }
    assert.equal(generationOnly(LIVE.rows).some((r) => (r.generationTwh ?? 0) < 0), false);
  });

  /**
   * THE CAPTURED SHARE ABOVE 100. Not rounding: a share OF GENERATION, on a
   * country that imports. Never clamped — excluded from the mix instead.
   */
  it('carries a share above 100%, only on flows, and never in the mix', () => {
    const over = LIVE.rows.filter((row) => (row.shareOfGenerationPct ?? 0) > 100);
    assert.ok(over.length > 0, 'the fixture was chosen to contain one');
    for (const row of over) {
      assert.ok(
        isFlowSeries(row.series),
        `${row.series} exceeds 100% of generation and is not a flow — that would be a real anomaly`,
      );
    }

    for (const row of generationOnly(LIVE.rows)) {
      assert.ok(
        (row.shareOfGenerationPct ?? 0) <= 100,
        `${row.series} in the mix reports ${row.shareOfGenerationPct}% — the mix must not exceed 100`,
      );
    }
  });

  /**
   * RULE 30 ON REAL DATA. Austria reports 0 TWh of several fuels. That is a
   * measured zero, not an absence, and it must survive as `0`.
   */
  it('keeps a reported zero as zero, distinct from a series that is absent', () => {
    const zeros = LIVE.rows.filter((row) => row.generationTwh === 0);
    assert.ok(zeros.length > 0, 'the capture should contain genuinely reported zeros');
    for (const row of zeros) {
      assert.equal(row.generationTwh, 0, 'a reported zero must not be nulled');
      assert.notEqual(row.generationTwh, null);
    }

    // A series Ember does not report for this country is absent, not zero.
    assert.equal(findSeries(LIVE.rows, 'Geothermal unicorn', 2022), undefined);

    const zero = zeros[0]!;
    const fact = seriesFact(zero, CTX, 'generation_twh for a reported-zero series');
    assert.equal(fact.value, 0, 'a reported zero must reach the Fact as 0, never as null');
  });
});

describe('Ember — planted cases (rule 27)', () => {
  const row = (over: Partial<Record<string, unknown>>) => ({
    entity: 'Testland',
    entity_code: 'TST',
    is_aggregate_entity: false,
    date: '2023',
    series: 'Solar',
    is_aggregate_series: false,
    generation_twh: 1,
    share_of_generation_pct: 10,
    ...over,
  });

  const payload = (rows: unknown[]) => ({ stats: { number_of_records: rows.length }, data: rows });

  /**
   * NOT CAPTURED LIVE — live confirmation pending.
   *
   * `entity_code` would not return a region: EUR, Europe, WORLD and G7 each
   * returned zero rows. Ember publishes regional aggregates in the CSV
   * distribution, so the flag exists and this endpoint appears not to serve
   * them. Planted so the handling exists before it is met.
   */
  it('excludes an aggregate ENTITY from the mix — planted, live confirmation pending', () => {
    const parsed = parse(
      payload([row({ entity: 'Europe', entity_code: 'EUR', is_aggregate_entity: true })]),
    );
    assert.equal(parsed.rows[0]!.isAggregateEntity, true);
    assert.deepEqual(generationOnly(parsed.rows), [], 'a region must not be summed with countries');
  });

  /**
   * NOT CAPTURED LIVE — live confirmation pending. No sampled country-year
   * produced a null `generation_twh`; every absence was a missing row instead.
   */
  it('keeps a null generation distinct from zero — planted, live confirmation pending', () => {
    const parsed = parse(
      payload([
        row({ series: 'Solar', generation_twh: null, share_of_generation_pct: null }),
        row({ series: 'Coal', generation_twh: 0, share_of_generation_pct: 0 }),
      ]),
    );
    const solar = findSeries(parsed.rows, 'Solar', 2023)!;
    const coal = findSeries(parsed.rows, 'Coal', 2023)!;

    assert.equal(solar.generationTwh, null, 'no figure must stay null');
    assert.equal(coal.generationTwh, 0, 'a reported zero must stay 0');
    assert.notEqual(solar.generationTwh, coal.generationTwh, 'rule 30: these are different facts');

    assert.equal(seriesFact(solar, CTX, 'planted').value, null);
    assert.equal(seriesFact(coal, CTX, 'planted').value, 0);
  });

  it('refuses a response missing the aggregate flags rather than defaulting them', () => {
    /**
     * Defaulting a missing flag to `false` would reclassify every aggregate as a
     * leaf and produce a plausible chart that double-counts — the failure nobody
     * notices. Fail closed and loudly.
     */
    const { is_aggregate_series, ...noFlag } = row({});
    void is_aggregate_series;
    assert.throws(() => parse(payload([noFlag])), ShapeError);

    const { is_aggregate_entity, ...noEntityFlag } = row({});
    void is_aggregate_entity;
    assert.throws(() => parse(payload([noEntityFlag])), ShapeError);
  });

  it('refuses a date that is not a four-digit year rather than coercing it', () => {
    assert.throws(() => parse(payload([row({ date: '2023-01-01' })])), ShapeError);
    assert.throws(() => parse(payload([row({ date: 2023 })])), ShapeError);
  });

  it('refuses a non-numeric generation value rather than treating it as absent', () => {
    assert.throws(() => parse(payload([row({ generation_twh: 'n/a' })])), ShapeError);
    assert.throws(() => parse(payload([row({ generation_twh: Number.NaN })])), ShapeError);
  });

  it('declares Demand a flow even though Ember flags it an aggregate', () => {
    /**
     * The reason the flow list is hand-written. `is_aggregate_series` splits
     * these two the wrong way round for our purpose, so `leafSeries` drops
     * Demand by accident and keeps Net imports.
     */
    const parsed = parse(
      payload([
        row({ series: 'Demand', is_aggregate_series: true, generation_twh: 50 }),
        row({ series: 'Net imports', is_aggregate_series: false, generation_twh: -3 }),
        row({ series: 'Solar', is_aggregate_series: false, generation_twh: 7 }),
      ]),
    );

    assert.equal(isFlowSeries('Demand'), true);
    assert.equal(isFlowSeries('Net imports'), true);
    assert.equal(isFlowSeries('Solar'), false);

    // leafSeries keeps Net imports — it is not an aggregate. Only the declared
    // flow list removes it.
    assert.ok(leafSeries(parsed.rows).some((r: GenerationRow) => r.series === 'Net imports'));
    assert.deepEqual(
      generationOnly(parsed.rows).map((r: GenerationRow) => r.series),
      ['Solar'],
    );
  });
});
