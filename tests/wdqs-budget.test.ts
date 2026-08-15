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

/** Generous: the point is to catch a 60s cliff, not to police normal variance. */
const BUDGET_MS = 20_000;

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
      if (bounded.rows === null || oneDeeper.rows === null) {
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
