import type { Fact } from '../facts/types';
import { expectArray, expectObject, fetchProvenance, ShapeError, type FetchContext } from './adapter';

const SOURCE_ID = 'ooni';

const SERVICE = 'https://api.ooni.io/api/v1/aggregation';

/**
 * OONI — aggregated network measurement counts, per country and day.
 *
 * ## A MEASUREMENT IS NEVER A CLAIM ABOUT CAUSE
 *
 * OONI reports what a test observed from a vantage point. It does not report
 * that a government blocked anything, and neither may this app. The four counts
 * are four DIFFERENT claims, and flattening them into "blocked" destroys the
 * distinction OONI spent its methodology making:
 *
 *   ok         the test completed and looked normal
 *   anomaly    signs consistent with interference — POSSIBLE, NOT CONFIRMED
 *   confirmed  OONI identified a block page or equivalent positive evidence
 *   failure    the test did not complete — a network error, which says
 *              NOTHING about blocking either way
 *
 * `anomaly` is the one that gets misread. It is a signal worth surfacing and it
 * is not a finding of censorship: false positives arise from captive portals,
 * middleboxes, CDN behaviour and ordinary breakage. Rendering anomalies as
 * blocking would be this app asserting a cause the source declined to assert.
 *
 * `failure` misread as blocking is the same error with worse arithmetic: a
 * timeout is evidence about the measurement, not about the network's intent.
 *
 * ## Aggregation, not individual measurements
 *
 * Per-measurement data identifies vantage points, and a view of it carries more
 * about the person who ran the test than about the network. The aggregation
 * endpoint is the right granularity for a country panel and the safer one.
 */

export interface AggregationQuery {
  /** ISO 3166-1 alpha-2, OONI's `probe_cc`. */
  countryCode: string;
  /** Inclusive ISO date. */
  since: string;
  /** Exclusive ISO date. */
  until: string;
}

export function buildAggregationUrl(query: AggregationQuery): string {
  const params = new URLSearchParams({
    probe_cc: query.countryCode,
    since: query.since,
    until: query.until,
    axis_x: 'measurement_start_day',
  });
  return `${SERVICE}?${params.toString()}`;
}

export interface DayCounts {
  /**
   * Start of the bucket, as an ISO instant — **NOT a day.**
   *
   * OONI's field is called `measurement_start_day` and it delivers HOURLY
   * buckets: a seven-day window returns 168 rows, 24 per date. Measured, not
   * assumed.
   *
   * Keeping the full instant rather than truncating to a date is deliberate.
   * `slice(0, 10)` would have produced 24 rows sharing one "day" value, and a
   * chart keyed on it would draw 168 points labelled as seven days — the field
   * name's error propagated into the rendering. Callers that want days roll up
   * explicitly through `byDay`, so the aggregation is visible where it happens.
   */
  bucketStart: string;
  ok: number;
  /** Consistent with interference. NOT a finding of blocking. */
  anomaly: number;
  /** OONI identified positive evidence of blocking. */
  confirmed: number;
  /** The test did not complete. Evidence about the measurement, not the network. */
  failure: number;
  /** OONI's own total. Equals the four above — asserted, not assumed. */
  measurements: number;
}

function count(row: Record<string, unknown>, field: string, at: string): number {
  const value = row[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ShapeError(SOURCE_ID, `${at}.${field} is ${JSON.stringify(value)}, expected a non-negative integer`);
  }
  return value;
}

export function parse(payload: unknown): DayCounts[] {
  const root = expectObject(SOURCE_ID, payload, 'response');
  const rows = expectArray(SOURCE_ID, root['result'], 'result');

  return rows.map((entry, index): DayCounts => {
    const row = expectObject(SOURCE_ID, entry, `result[${index}]`);
    const at = `result[${index}]`;

    const day = row['measurement_start_day'];
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(day)) {
      throw new ShapeError(SOURCE_ID, `${at}.measurement_start_day is ${JSON.stringify(day)}`);
    }

    const counts: DayCounts = {
      bucketStart: day,
      ok: count(row, 'ok_count', at),
      anomaly: count(row, 'anomaly_count', at),
      confirmed: count(row, 'confirmed_count', at),
      failure: count(row, 'failure_count', at),
      measurements: count(row, 'measurement_count', at),
    };

    /**
     * RULE 38'S DISCRIMINATOR, and OONI does not flag it.
     *
     * `measurement_count` is the TOTAL and it arrives in the same object as its
     * four components. Nothing in the field names says which is which — a
     * consumer summing all five gets exactly twice the truth, and twice a
     * plausible number is still a plausible number.
     *
     * Asserted rather than trusted: if OONI ever adds a fifth category, this
     * fails loudly instead of silently under-counting the total's components.
     */
    const parts = counts.ok + counts.anomaly + counts.confirmed + counts.failure;
    if (parts !== counts.measurements) {
      throw new ShapeError(
        SOURCE_ID,
        `${at}: ok+anomaly+confirmed+failure = ${parts} but measurement_count = ${counts.measurements}. ` +
          'The categories no longer partition the total, so anything summing them is now wrong',
      );
    }

    return counts;
  });
}

/** Totals across the window. The components, never the total, are summed. */
export function totals(days: readonly DayCounts[]): Omit<DayCounts, 'bucketStart'> {
  return days.reduce(
    (sum, day) => ({
      ok: sum.ok + day.ok,
      anomaly: sum.anomaly + day.anomaly,
      confirmed: sum.confirmed + day.confirmed,
      failure: sum.failure + day.failure,
      measurements: sum.measurements + day.measurements,
    }),
    { ok: 0, anomaly: 0, confirmed: 0, failure: 0, measurements: 0 },
  );
}

/**
 * Roll hourly buckets up to calendar days, explicitly.
 *
 * This exists because the alternative — truncating `bucketStart` at the point of
 * use — is the same silent collapse the field name invites, moved somewhere
 * harder to see. Aggregation happens in a named function so a reader can tell
 * whether they are looking at 168 hours or 7 days.
 *
 * The returned `bucketStart` is the date at midnight UTC, so the field keeps one
 * meaning: the instant a bucket begins.
 */
export function byDay(buckets: readonly DayCounts[]): DayCounts[] {
  const days = new Map<string, DayCounts>();
  for (const bucket of buckets) {
    const date = bucket.bucketStart.slice(0, 10);
    const existing = days.get(date);
    if (existing === undefined) {
      days.set(date, { ...bucket, bucketStart: `${date}T00:00:00Z` });
      continue;
    }
    existing.ok += bucket.ok;
    existing.anomaly += bucket.anomaly;
    existing.confirmed += bucket.confirmed;
    existing.failure += bucket.failure;
    existing.measurements += bucket.measurements;
  }
  return [...days.values()].sort((a, b) => a.bucketStart.localeCompare(b.bucketStart));
}

/**
 * Terms this source's rendering must never apply to an anomaly or a failure.
 *
 * Exported so the contract test asserts it. `confirmed` may be described as
 * blocking, because that is OONI's own finding and reporting it is not
 * inference. Nothing else may.
 */
export const UNASSERTABLE_OF_ANOMALIES = ['blocked', 'censored', 'banned', 'shut down'] as const;

/**
 * The share of measurements OONI CONFIRMED as blocked.
 *
 * ## Tier: OFFICIAL, because this is OONI's own finding
 *
 * `confirmed` means OONI matched positive evidence — a block page or
 * equivalent. Reporting that is reporting the source, not inferring from it,
 * which is the same standard applied to EIA's estimation flag: the tier follows
 * what the source declares about the row.
 *
 * **The anomaly count deliberately does NOT feed this.** An anomaly is
 * unconfirmed by OONI's own definition, and rolling it in would manufacture
 * confidence the source withheld.
 */
export function confirmedShareFact(days: readonly DayCounts[], ctx: FetchContext): Fact<number> {
  const sum = totals(days);
  return {
    // No measurements is no answer, never a share of zero (rule 30).
    value: sum.measurements === 0 ? null : (sum.confirmed / sum.measurements) * 100,
    asOf: days.length === 0 ? ctx.fetchedAt.slice(0, 10) : (days[days.length - 1]?.bucketStart ?? '').slice(0, 10),
    tier: 'OFFICIAL',
    provenance: fetchProvenance(SOURCE_ID, ctx, { totals: sum }, 'confirmed_count / measurement_count'),
    note:
      `${sum.confirmed} of ${sum.measurements} measurements were confirmed blocked by OONI. ` +
      `A further ${sum.anomaly} showed anomalies, which are consistent with interference but ` +
      `not confirmed, and ${sum.failure} failed to complete, which says nothing either way.`,
    format: (value: number) => `${value.toFixed(1)}%`,
  };
}
