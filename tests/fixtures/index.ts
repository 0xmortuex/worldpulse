import worldbankIndicator from './worldbank-indicator.json';
import wikidataSparql from './wikidata-sparql.json';
import usgsQuakes from './usgs-quakes.json';
import gdeltDoc from './gdelt-doc.json';
import eonetEvents from './eonet-events.json';
import wikipediaSummaryLive from './wikipedia-summary-live.json';
import commonsImageinfoLive from './commons-imageinfo-live.json';
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

/**
 * The live source could not be read. **Not a contract failure.**
 *
 * A contract test answers one question: has the response SHAPE drifted? A
 * timeout, a connection reset or a 5xx answers a different question — whether
 * the network worked — and letting that fail the contract makes the deploy gate
 * oscillate on network weather while a real schema drift looks identical to a
 * bad afternoon.
 *
 * This is the rule `probe-sources.mjs` already follows for 4xx/5xx (A2, rule 3),
 * applied to the contract path. Only a shape mismatch fails a contract.
 */
export class InconclusiveLiveFetch extends Error {
  override readonly name = 'InconclusiveLiveFetch';
}

/**
 * Run `body` against a live sample, treating unreachability as inconclusive.
 *
 * Contract tests wrap their live assertions in this so an unreachable source
 * reports "could not check" rather than "the contract broke".
 */
export const INCONCLUSIVE_LIVE: string[] = [];

export async function liveOrInconclusive(
  sourceId: string,
): Promise<{ body: unknown; ctx: FetchContext } | null> {
  try {
    return await loadSample(sourceId);
  } catch (error) {
    if (error instanceof InconclusiveLiveFetch || isNetworkFailure(error)) {
      const detail = `${sourceId}: ${(error as Error).message}`;
      INCONCLUSIVE_LIVE.push(detail);
      // Recorded and printed, never silent. Rule 17's principle: a check that
      // did not run must not look like one that passed.
      process.stderr.write(`INCONCLUSIVE ${detail} — shape not checked this run\n`);
      return null;
    }
    throw error;
  }
}

/** A fetch that never got an answer, as distinct from one that answered badly. */
function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return true;
  return error.message === 'fetch failed';
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
    /**
     * Carries `SERVICE wikibase:label`, because the body carries `*Label`
     * bindings and **Wikidata only populates those when the label service is
     * invoked**.
     *
     * The previous URL omitted it while the body contained `itemLabel` and
     * `capitalLabel` — a request that cannot produce this response. Harmless
     * only for as long as nobody re-captured from it: doing so yields a
     * label-free body, which looks like a corrected fixture and would empty the
     * government tab's label-driven classification (decision D3) with nothing
     * going red. Every app query does invoke the service, in six places across
     * wikidata-dossier.ts and wikidata-government.ts.
     */
    requestUrl:
      'https://query.wikidata.org/sparql?format=json&query=' +
      encodeURIComponent(
        'SELECT ?item ?itemLabel ?capital ?capitalLabel WHERE { ' +
          '?item wdt:P36 ?capital . ' +
          'SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . } } LIMIT 5',
      ),
    body: wikidataSparql,
  },
  'usgs-quakes': {
    sourceId: 'usgs-quakes',
    requestUrl: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
    body: usgsQuakes,
  },
  'nasa-eonet': {
    sourceId: 'nasa-eonet',
    requestUrl: 'https://eonet.gsfc.nasa.gov/api/v3/events?status=all&limit=40',
    body: eonetEvents,
  },
  'wikipedia-rest': {
    sourceId: 'wikipedia-rest',
    requestUrl: 'https://en.wikipedia.org/api/rest_v1/page/summary/Emmanuel_Macron',
    body: wikipediaSummaryLive,
  },
  'wikimedia-commons': {
    sourceId: 'wikimedia-commons',
    /**
     * Carries `origin=*`. MediaWiki emits Access-Control-Allow-Origin only when
     * a request asks for it, and a contract test written against a URL without
     * it would be measuring a different request than the app makes — the
     * Wikidata label-service trap in a second place (decision A1a).
     */
    requestUrl:
      'https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo' +
      '&iiprop=url%7Cextmetadata&origin=*&titles=File%3AEmmanuel%20Macron%20in%202019.jpg',
    body: commonsImageinfoLive,
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
    throw new InconclusiveLiveFetch(
      `live fetch of ${sourceId} returned HTTP ${response.status} — inconclusive, not a contract failure`,
    );
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
