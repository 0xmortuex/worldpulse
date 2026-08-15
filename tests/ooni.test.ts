import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  UNASSERTABLE_OF_ANOMALIES,
  buildAggregationUrl,
  byDay,
  confirmedShareFact,
  parse,
  totals,
} from '../src/sources/ooni';
import { ShapeError, type FetchContext } from '../src/sources/adapter';
import { factState } from '../src/facts/types';

const BODY = JSON.parse(readFileSync(new URL('./fixtures/risk/ooni-ir.json', import.meta.url), 'utf8'));
const LIVE = parse(BODY);

const CTX: FetchContext = {
  requestUrl: buildAggregationUrl({ countryCode: 'IR', since: '2026-08-08', until: '2026-08-15' }),
  httpStatus: 200,
  fetchedAt: '2026-08-15T15:00:00.000Z',
  cache: 'miss',
  fromFixture: true,
};

describe('OONI — the field name says day and means hour', () => {
  /**
   * MEASURED, NOT ASSUMED. A seven-day window returns 168 rows: 24 per date.
   * `measurement_start_day` is hourly.
   */
  it('keeps the full instant rather than truncating to a date', () => {
    assert.ok(LIVE.length > 24, `only ${LIVE.length} buckets — hourly granularity may be gone`);
    for (const bucket of LIVE) {
      assert.match(bucket.bucketStart, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    }
    const dates = new Set(LIVE.map((b) => b.bucketStart.slice(0, 10)));
    assert.ok(
      LIVE.length > dates.size,
      'there is one bucket per date, so this capture no longer exercises the hourly case',
    );
  });

  it('rolls up to days only when asked, and conserves every count', () => {
    const days = byDay(LIVE);
    const dates = new Set(LIVE.map((b) => b.bucketStart.slice(0, 10)));
    assert.equal(days.length, dates.size, 'the roll-up lost or invented a day');

    // Aggregation must not change the totals — the classic roll-up bug.
    const before = totals(LIVE);
    const after = totals(days);
    assert.deepEqual(after, before, 'rolling up to days changed the totals');

    for (const day of days) {
      assert.match(day.bucketStart, /T00:00:00Z$/, 'a rolled-up bucket does not start at midnight');
    }
  });
});

describe('OONI — the partition is the discriminator (rule 38)', () => {
  it('the four categories sum to the total, on live data', () => {
    for (const bucket of LIVE) {
      assert.equal(
        bucket.ok + bucket.anomaly + bucket.confirmed + bucket.failure,
        bucket.measurements,
        `${bucket.bucketStart} does not partition`,
      );
    }
  });

  it('summing all five would double the truth', () => {
    // The hazard stated as arithmetic: measurement_count sits in the same object
    // as its own components, and nothing in the field names says so.
    const sum = totals(LIVE);
    const naive = sum.ok + sum.anomaly + sum.confirmed + sum.failure + sum.measurements;
    assert.equal(naive, sum.measurements * 2, 'the naive sum is not exactly double — check the model');
  });

  it('refuses a response whose categories stop partitioning', () => {
    const broken = {
      result: [
        {
          measurement_start_day: '2026-08-08T00:00:00Z',
          ok_count: 1,
          anomaly_count: 1,
          confirmed_count: 1,
          failure_count: 1,
          measurement_count: 99,
        },
      ],
    };
    assert.throws(() => parse(broken), ShapeError);
    assert.throws(() => parse(broken), /no longer partition/);
  });
});

describe('OONI — a measurement is never a claim about cause', () => {
  it('reports confirmed separately from anomalies, and says what each means', () => {
    const fact = confirmedShareFact(LIVE, CTX);
    assert.equal(factState(fact), 'ok');
    assert.equal(fact.tier, 'OFFICIAL');
    // The note must name all three states, or a reader sees one number and
    // assumes it covers everything OONI observed.
    assert.match(fact.note ?? '', /confirmed blocked/i);
    assert.match(fact.note ?? '', /not confirmed/i);
    assert.match(fact.note ?? '', /says nothing either way/i);
  });

  it('the anomaly count never feeds the confirmed share', () => {
    /**
     * Rolling anomalies into "confirmed" would manufacture confidence OONI
     * explicitly withheld. Asserted by construction: a bucket with anomalies and
     * no confirmations must report zero.
     */
    const anomaliesOnly = [
      {
        bucketStart: '2026-08-08T00:00:00Z',
        ok: 10,
        anomaly: 90,
        confirmed: 0,
        failure: 0,
        measurements: 100,
      },
    ];
    assert.equal(confirmedShareFact(anomaliesOnly, CTX).value, 0);
  });

  it('never applies blocking language to anomalies or failures', () => {
    const note = (confirmedShareFact(LIVE, CTX).note ?? '').toLowerCase();
    for (const term of UNASSERTABLE_OF_ANOMALIES) {
      // "blocked" may appear only attached to OONI's own confirmed finding.
      const index = note.indexOf(term);
      if (index === -1) continue;
      const context = note.slice(Math.max(0, index - 40), index + term.length);
      assert.match(
        context,
        /confirmed/,
        `"${term}" appears without "confirmed" nearby: …${context}…`,
      );
    }
  });

  it('no measurements is no answer, never a share of zero', () => {
    // Rule 30 at the arithmetic boundary: 0/0 must not render as 0%.
    assert.equal(confirmedShareFact([], CTX).value, null);
    assert.equal(factState(confirmedShareFact([], CTX)), 'nodata');
  });
});

describe('OONI — planted cases (rule 27)', () => {
  const bucket = (over: Record<string, unknown> = {}) => ({
    measurement_start_day: '2026-08-08T00:00:00Z',
    ok_count: 2,
    anomaly_count: 1,
    confirmed_count: 1,
    failure_count: 1,
    measurement_count: 5,
    ...over,
  });

  it('refuses a negative or fractional count rather than rendering it', () => {
    assert.throws(() => parse({ result: [bucket({ ok_count: -1, measurement_count: 2 })] }), ShapeError);
    assert.throws(() => parse({ result: [bucket({ ok_count: 1.5, measurement_count: 4.5 })] }), ShapeError);
  });

  it('refuses a missing count rather than treating it as zero', () => {
    const { ok_count, ...missing } = bucket();
    void ok_count;
    assert.throws(() => parse({ result: [missing] }), ShapeError);
  });

  it('refuses a malformed bucket start', () => {
    assert.throws(() => parse({ result: [bucket({ measurement_start_day: 'yesterday' })] }), ShapeError);
  });

  it('an empty result is no buckets, not an error', () => {
    assert.deepEqual(parse({ result: [] }), []);
  });
});
