import worldbankIndicator from './worldbank-indicator.json';
import wikidataSparql from './wikidata-sparql.json';
import usgsQuakes from './usgs-quakes.json';
import gdeltDoc from './gdelt-doc.json';
import { getSource } from '../../src/facts/registry';
import type { FetchContext } from '../../src/sources/adapter';

/**
 * Fixture manifest.
 *
 * HAND-AUTHORED FROM PUBLISHED API DOCUMENTATION — NOT CAPTURED RESPONSES.
 * See README.md in this directory. Replace with real captures once egress opens
 * and flip the source's `verifiedAgainst` to "live".
 */

export interface Fixture {
  sourceId: string;
  /** The URL this body would have come from. */
  requestUrl: string;
  body: unknown;
}

export const FIXTURES: Record<string, Fixture> = {
  worldbank: {
    sourceId: 'worldbank',
    requestUrl:
      'https://api.worldbank.org/v2/country/USA/indicator/NY.GDP.MKTP.CD?format=json&per_page=3',
    body: worldbankIndicator,
  },
  'wikidata-sparql': {
    sourceId: 'wikidata-sparql',
    requestUrl:
      'https://query.wikidata.org/sparql?format=json&query=SELECT%20%3Fitem%20%3FitemLabel%20%3Fcapital%20%3FcapitalLabel%20WHERE%7B%3Fitem%20wdt%3AP36%20%3Fcapital%7D',
    body: wikidataSparql,
  },
  'usgs-quakes': {
    sourceId: 'usgs-quakes',
    requestUrl: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
    body: usgsQuakes,
  },
  'gdelt-doc': {
    sourceId: 'gdelt-doc',
    requestUrl:
      'https://api.gdeltproject.org/api/v2/doc/doc?query=sourcecountry%3AUS&mode=artlist&format=json&maxrecords=5',
    body: gdeltDoc,
  },
};

/**
 * Yield a sample for a source: the fixture by default, or a live response when
 * PROBE_LIVE=1. Contract tests call this so the same assertions run against both.
 */
export async function loadSample(sourceId: string): Promise<{ body: unknown; ctx: FetchContext }> {
  const fixture = FIXTURES[sourceId];
  if (!fixture) throw new Error(`no fixture registered for source "${sourceId}"`);

  if (process.env['PROBE_LIVE'] !== '1') {
    return {
      body: fixture.body,
      ctx: {
        requestUrl: fixture.requestUrl,
        httpStatus: 200,
        fetchedAt: '1970-01-01T00:00:00.000Z',
        cache: 'miss',
        fromFixture: true,
      },
    };
  }

  /**
   * Fetch the FIXTURE's request URL, not the source's `probeUrl`.
   *
   * These are different requests for different purposes: `probeUrl` is the
   * cheapest thing that proves a host is reachable, while `requestUrl` is the
   * request whose response shape this fixture claims to represent. Preferring
   * `probeUrl` meant the live contract test asked a different question than the
   * fixture answers.
   *
   * For `wikidata-sparql` those diverged completely — the fixture is a
   * `?item ?itemLabel ?capital ?capitalLabel` query and the probe asks
   * `SELECT ?cap`. The live test passed anyway, because it asserts on whatever
   * variables come back. The same assertions were running against two different
   * contracts, and only one of them was the app's.
   */
  const url = fixture.requestUrl;
  void getSource;
  // Rule 20: identify the client. Node's default User-Agent is rejected by
  // Wikimedia's UA policy, so without this the live contract test would fail
  // with a 403 that describes our own anonymity rather than the source. The
  // probe learned this the expensive way; the same trap was sitting here.
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: {
      'User-Agent':
        'worldpulse/0.0 (https://github.com/0xmortuex/worldpulse) contract-test',
    },
  });
  if (!response.ok) {
    // Matches the probe's rule: a 4xx tells us nothing about the success path.
    throw new Error(`live fetch of ${sourceId} returned HTTP ${response.status} — inconclusive, not a contract failure`);
  }
  return {
    body: await response.json(),
    ctx: {
      requestUrl: url,
      httpStatus: response.status,
      fetchedAt: new Date().toISOString(),
      cache: 'miss',
    },
  };
}
