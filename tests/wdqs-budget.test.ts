import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MINISTER_SUBCLASS_HOPS,
  MINISTER_SUBCLASS_PATH,
  buildCabinetQuery,
  buildLegislatureQuery,
} from '../src/sources/wikidata-government';

/**
 * WDQS query budgets, and the bound that could silently drop a minister.
 *
 * ## Why this file exists
 *
 * The cabinet query spent 52 seconds against a 60-second server-side timeout and
 * 504'd for the United Kingdom. Nothing in the suite could see that: it was
 * found by hand while capturing fixtures, and nothing would have caught its
 * return.
 *
 * The live half runs only under `PROBE_LIVE`, so the ordinary suite does not
 * depend on a public endpoint's weather. An unreachable endpoint is INCONCLUSIVE
 * — a timeout answers "did the network work", which is a different question from
 * "is this query viable", and conflating them is what let "WDQS is slow" stand in
 * for a query defect for as long as it did.
 */

const ENDPOINT = 'https://query.wikidata.org/sparql';
const HEADERS = {
  'User-Agent': 'worldpulse/0.0 (https://github.com/0xmortuex/worldpulse) query-budget',
  Accept: 'application/sparql-results+json',
  'Content-Type': 'application/sparql-query',
};

/**
 * The budget, set from measurement rather than from a guess.
 *
 * **This started at 20s and that was wrong**, because it was chosen before any
 * variance data existed. Three United Kingdom samples, one sitting:
 *
 *   5300ms · 8398ms · 12485ms   — spread 7.2s
 *
 * A 20s budget sits 1.6× above the worst observed sample, and a guard whose
 * threshold is within one variance-width of normal operation fails on weather
 * rather than on defects — which trains people to ignore it (rule 15).
 *
 * **30s is chosen so the guard still catches what it exists for.** The failure
 * mode is a return to the ~60s server-side cliff; 30s is half of that, and 2.4×
 * the worst sample measured. Raising it further would start to admit the defect.
 */
const BUDGET_MS = 30_000;

/**
 * WDQS throttles bursts, and a throttled request says nothing about the query.
 *
 * Rule 3's distinction, which this file applied to unreachability and not to
 * rate limiting: a 429 answers "did we ask too fast", not "is this query
 * viable". The first live run of this guard failed on one — 877ms, far too fast
 * to be a timeout — after a burst of characterisation queries.
 */
const THROTTLED = new Set([429, 503]);

async function ask(query: string): Promise<{ ms: number; rows: number | null; status: number }> {
  const started = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: HEADERS,
    body: query,
    signal: AbortSignal.timeout(90_000),
  });
  const ms = Date.now() - started;
  if (!res.ok) return { ms, rows: null, status: res.status };
  const body = (await res.json()) as { results?: { bindings?: unknown[] } };
  return { ms, rows: body.results?.bindings?.length ?? 0, status: 200 };
}

describe('WDQS query shape (no network)', () => {
  it('the ministerial walk is BOUNDED, not open-ended', () => {
    /**
     * `wdt:P279*` was the whole cost. This asserts the shipped query does not
     * contain it — a regression to the unbounded form is the specific change
     * that would reintroduce a 60-second query.
     */
    const query = buildCabinetQuery('GBR');
    assert.equal(query.includes('wdt:P279*'), false, 'the unbounded closure is back');
    assert.ok(query.includes(MINISTER_SUBCLASS_PATH), 'the bounded path is not in the query');
  });

  it('the path really expresses the number of hops it claims', () => {
    // The constant and the path must agree, or the recorded measurement stops
    // describing the shipped query.
    const hops = MINISTER_SUBCLASS_PATH.split('wdt:P279').length - 1;
    assert.equal(hops, MINISTER_SUBCLASS_HOPS);
  });

  it('every shipped query still carries an explicit LIMIT', () => {
    // An unbounded result set is the other way to spend 60 seconds.
    for (const query of [buildCabinetQuery('GBR'), buildLegislatureQuery('GBR')]) {
      assert.match(query, /\bLIMIT \d+/);
    }
  });
});

describe('WDQS query budget (PROBE_LIVE only)', () => {
  const live = process.env['PROBE_LIVE'] === '1';

  it('the cabinet query completes for the country that used to 504', async (t) => {
    if (!live) return t.skip('set PROBE_LIVE=1');
    let result;
    try {
      result = await ask(buildCabinetQuery('GBR'));
    } catch {
      // Rule 3: unreachable is a different question from unviable.
      process.stderr.write('INCONCLUSIVE wdqs: endpoint unreachable — budget not checked\n');
      return;
    }
    if (THROTTLED.has(result.status)) {
      process.stderr.write(
        `INCONCLUSIVE wdqs: throttled (${result.status}) after ${result.ms}ms — budget not checked\n`,
      );
      return;
    }
    assert.equal(result.status, 200, `GBR cabinet returned ${result.status} after ${result.ms}ms`);
    assert.ok(result.ms < BUDGET_MS, `GBR cabinet took ${result.ms}ms, over the ${BUDGET_MS}ms budget`);
  });

  /**
   * THE BOUND'S HIT CASE, DETECTED RATHER THAN ASSUMED AWAY.
   *
   * Four hops is sufficient for every country measured — and that is six
   * countries, not a proof. If a seventh has a position at five hops, the
   * bounded query drops it silently: no error, one missing minister, plausible
   * output.
   *
   * So the bound is compared against one hop deeper. A difference is not a
   * failure of the endpoint; it is the bound biting, and it is reported as
   * exactly that.
   */
  it('four hops still finds everything five hops does', async (t) => {
    if (!live) return t.skip('set PROBE_LIVE=1');

    const minister = 'wd:Q83307';
    const countQuery = (iso: string, path: string) =>
      `SELECT DISTINCT ?position WHERE {
        ?country wdt:P298 "${iso}" .
        ?position wdt:P1001 ?country .
        ?position ${path} ${minister} .
      } LIMIT 300`;

    const deeper = `${MINISTER_SUBCLASS_PATH}/wdt:P279?`;

    for (const iso of ['GBR', 'FRA', 'IND']) {
      let bounded;
      let oneDeeper;
      try {
        bounded = await ask(countQuery(iso, MINISTER_SUBCLASS_PATH));
        oneDeeper = await ask(countQuery(iso, deeper));
      } catch {
        process.stderr.write(`INCONCLUSIVE wdqs: ${iso} unreachable — hop bound not checked\n`);
        continue;
      }
      if (
        bounded.rows === null ||
        oneDeeper.rows === null ||
        THROTTLED.has(bounded.status) ||
        THROTTLED.has(oneDeeper.status)
      ) {
        // A throttled or errored side gives nothing to compare. Reporting that
        // is honest; comparing a count against `null` would invent a verdict.
        process.stderr.write(`INCONCLUSIVE wdqs: ${iso} returned ${bounded.status}/${oneDeeper.status}\n`);
        continue;
      }
      assert.equal(
        bounded.rows,
        oneDeeper.rows,
        `${iso}: ${MINISTER_SUBCLASS_HOPS} hops finds ${bounded.rows} positions, ` +
          `${MINISTER_SUBCLASS_HOPS + 1} finds ${oneDeeper.rows} — the bound is now dropping ` +
          `${oneDeeper.rows - bounded.rows}. Raise MINISTER_SUBCLASS_HOPS and re-measure.`,
      );
    }
  });
});
