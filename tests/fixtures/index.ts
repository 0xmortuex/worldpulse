import worldbankIndicator from './worldbank-indicator.json';
import wikidataSparql from './wikidata-sparql.json';
import usgsQuakes from './usgs-quakes.json';
import gdeltDoc from './gdelt-doc.json';
import eonetEvents from './eonet-events.json';
import wikipediaSummaryLive from './wikipedia-summary-live.json';
import commonsImageinfoLive from './commons-imageinfo-live.json';
import portwatchChokepoints from './portwatch-chokepoints.json';
import whoDon from './who-don.json';
import unhcrPopulation from './unhcr-population.json';
import cisaKev from './cisa-kev.json';
import emberYearlyAut from './economy/ember-yearly-aut.json';
import congressBills from './congress-bills.json';
import eiaElectricity from './economy/eia-electricity-2023.json';
import comtradeUsa from './economy/comtrade-usa-2023-exports.json';
import exchangerateUsd from './economy/exchangerate-usd.json';
import ooniIr from './risk/ooni-ir.json';
import feodoC2 from './risk/feodo-c2.json';
import { readFileSync as readFixture } from 'node:fs';
import { buildUrl as worldbankUrl } from '../../src/sources/worldbank';
import { buildFeedUrl as usgsFeedUrl } from '../../src/sources/usgs';
import { buildEventsUrl as eonetEventsUrl } from '../../src/sources/eonet';
import { summaryUrl as wikipediaSummaryUrl } from '../../src/sources/wikipedia';
import { commonsImageinfoUrl } from '../../src/dossier/portrait';
import { buildCountryQueryUrl } from '../../src/sources/wikidata-dossier';
import { buildChokepointQueryUrl } from '../../src/sources/portwatch';
import { buildDonQueryUrl } from '../../src/sources/who-don';
import { buildPopulationUrl } from '../../src/sources/unhcr';
import { buildCatalogUrl } from '../../src/sources/cisa-kev';
import { buildYearlyUrl as emberYearlyUrl } from '../../src/sources/ember';
import { buildRecentBillsUrl } from '../../src/sources/congress';
import { buildAnnualUrl as eiaAnnualUrl } from '../../src/sources/eia';
import { buildAnnualTradeUrl } from '../../src/sources/comtrade';
import { buildQuotesUrl } from '../../src/sources/exchangerate';
import { buildAreaUrl as firmsAreaUrl } from '../../src/sources/firms';
import { buildAggregationUrl as ooniUrl } from '../../src/sources/ooni';
import { buildBlocklistUrl } from '../../src/sources/feodo';
import type { FetchContext } from '../../src/sources/adapter';
import registry from '../../data/sources.json';
import { keyedProbeUrl } from '../../scripts/probe-auth.mjs';

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
  /**
   * The response is TEXT, not JSON — CSV, TSV, a feed.
   *
   * Declared rather than sniffed. Guessing from a content-type or from whether
   * `JSON.parse` happens to succeed would make the live path and the fixture
   * path disagree the first time a source returned something ambiguous, and a
   * contract test whose input differs from the app's is testing the wrong thing.
   */
  bodyIsText?: boolean;
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
  /**
   * THE FIRST REAL CAPTURE IN THIS DIRECTORY.
   *
   * Every other fixture here was hand-authored from published documentation,
   * because the container this project was built in could not reach a live
   * origin. This machine can, so this body is the bytes the service actually
   * returned — fetched from `buildChokepointQueryUrl` itself, not from a URL
   * written out by hand beside it.
   *
   * The query is pinned to one chokepoint and a closed date window so re-running
   * it returns the same rows. A fixture whose query means "the last seven days"
   * is a fixture that silently changes what it proves.
   */
  'portwatch-chokepoints': {
    sourceId: 'portwatch-chokepoints',
    requestUrl: buildChokepointQueryUrl({ chokepointId: 'chokepoint1', year: 2026, month: 8, throughDay: 7 }),
    body: portwatchChokepoints,
  },
  /**
   * A real capture, like PortWatch's — but deliberately NOT reproducible.
   *
   * This query means "the ten most recent reports", so re-capturing returns
   * different ones. That is correct for a news source: pinning it would make the
   * fixture describe a request the app never makes. The contract test is written
   * to survive the drift, which rule 4 requires of it regardless.
   */
  'who-don': {
    sourceId: 'who-don',
    requestUrl: buildDonQueryUrl({ count: 10 }),
    body: whoDon,
  },
  /**
   * Carries BOTH of rule 30's states in real captured data: reported zeros as
   * the string `"0"` and no-data as the string `"-"`, in the same rows. The
   * contract test asserts they parse differently, and plants the cases too so
   * the distinction survives a year in which UNHCR publishes no dashes.
   */
  /**
   * The whole catalogue, 1.5MB, because that is what the app fetches — the
   * mirror serves one file and offers no narrowing. Trimming it would make the
   * fixture describe a request nobody makes.
   */
  /**
   * Austria, captured live 2026-08-15 through `buildYearlyUrl` (rule 26).
   *
   * CHOSEN FOR ITS HAZARDS, not for being typical. Of the countries sampled it
   * is the one carrying three at once: a negative `generation_twh`
   * (`Net imports` −0.07), a `share_of_generation_pct` above 100 (`Demand`
   * 113.5%), and six genuinely reported zeros. A tidy country would have made a
   * fixture that proved nothing.
   *
   * The URL carries no key. Ember authenticates by query parameter, so the
   * builder emits the keyless URL and the Worker appends the key — which is why
   * a captured fixture can be committed at all.
   */
  'ember-electricity': {
    sourceId: 'ember-electricity',
    requestUrl: emberYearlyUrl({ iso3: 'AUT', startYear: 2022, endYear: 2023 }),
    body: emberYearlyAut,
  },

  /**
   * Twenty most-recently-updated bills, captured live 2026-08-15 through
   * `buildRecentBillsUrl` (rule 26).
   *
   * The capture was run through `parse` BEFORE being written. A fixture that
   * violated the adapter's own descending-order invariant would make the
   * contract test pass against data the adapter would reject live — which is the
   * fixture proving the test rather than the app.
   */
  'congress-gov': {
    sourceId: 'congress-gov',
    requestUrl: buildRecentBillsUrl({ limit: 20 }),
    body: congressBills,
  },

  /**
   * Electricity consumption, every country and region, 2023 — captured live
   * 2026-08-15 through `buildAnnualUrl` (rule 26), then run through `parse`
   * before being written.
   *
   * CARRIES THE FLAGS, which is why it is 260 rows rather than a handful: 7
   * `country-did-not-exist` (Czechoslovakia still has rows in 2023), 4
   * `included-elsewhere`, 13 `rounds-to-zero`, and 35 regional aggregates beside
   * 225 countries. A ten-row sample would have contained none of them.
   *
   * **ONE FIELD IS REDACTED AND THE SHAPE IS NOT.** EIA echoes the API key back
   * at `request.params.api_key`, so the value — and only the value — is replaced
   * with `REDACTED-AT-CAPTURE`. Dropping the field would have hidden the echo
   * from anyone reading the fixture, and the echo is the thing worth knowing.
   */
  eia: {
    sourceId: 'eia',
    requestUrl: eiaAnnualUrl({ productId: '2', activityId: '2', startYear: 2023, endYear: 2023, length: 300 }),
    body: eiaElectricity,
  },

  /**
   * US exports 2023, every partner, captured live 2026-08-15 through
   * `buildAnnualTradeUrl` (rule 26) and run through `parse` before writing.
   *
   * ONE CALL. Comtrade allows 500 a day and answered 429 to a second request
   * during development, which is also why this source is Worker-cached and never
   * fetched per visitor.
   *
   * `cmdCode=TOTAL` is the query rather than an optimisation: without it the same
   * request returns 100,000 rows mixing individual HS lines with the `999999`
   * all-commodities row, and summing that double-counts a country's entire trade
   * while looking plausible.
   *
   * Every row here is `isReported: false` and `isAggregate: true`, which is the
   * subject of `OPEN-QUESTIONS` 20 — the fixture is the evidence for that
   * question, not a workaround for it.
   */
  comtrade: {
    sourceId: 'comtrade',
    requestUrl: buildAnnualTradeUrl({ reporterCode: 842, year: 2023, flowCode: 'X' }),
    body: comtradeUsa,
  },

  /**
   * USD against five currencies, captured live 2026-08-15 through
   * `buildQuotesUrl` (rule 26).
   *
   * Small on purpose: this source's hazard is not volume, it is that **failure
   * arrives as HTTP 200**. The planted cases carry the `success:false`
   * envelopes, because a captured success can never demonstrate them.
   */
  'exchangerate-host': {
    sourceId: 'exchangerate-host',
    requestUrl: buildQuotesUrl({ source: 'USD', currencies: ['EUR', 'GBP', 'JPY', 'CHF', 'CNY'] }),
    body: exchangerateUsd,
  },

  /**
   * Mediterranean basin, one day of VIIRS NOAA-20 detections — captured live
   * 2026-08-15 through `buildAreaUrl` (rule 26) and run through `parse` first.
   *
   * CSV, so `bodyIsText`. Imported with `readFileSync` rather than a JSON import
   * because the bytes are the contract: a CSV round-tripped through a JSON
   * string would test a shape the source never sends.
   *
   * The window is busy on purpose. It carries all three VIIRS confidence
   * categories, 39 distinct pixel footprints, and — the case a quiet capture
   * would have missed — detections at 00:35, which is where `acq_time`'s missing
   * leading zeros bite.
   *
   * The URL holds `{MAP_KEY}`, not a key. FIRMS puts its key in the PATH, so the
   * placeholder is what gets recorded and only the fetch substitutes.
   */
  'nasa-firms': {
    sourceId: 'nasa-firms',
    requestUrl: firmsAreaUrl({ source: 'VIIRS_NOAA20_NRT', bbox: [-10, 30, 40, 46], dayRange: 1 }),
    body: readFixture(new URL('./layers/firms-med.csv', import.meta.url), 'utf8'),
    bodyIsText: true,
  },

  /**
   * Iran, seven days of HOURLY buckets — captured live 2026-08-15 through
   * `buildAggregationUrl` (rule 26) and run through `parse` first.
   *
   * A high-volume country on purpose. The capture carries confirmed blocks,
   * anomalies AND failures in every one of its 168 buckets, so the three-way
   * distinction the adapter exists to preserve is exercised rather than assumed.
   * A quiet country would have produced 168 rows of zeros and proved nothing.
   *
   * It is also what showed that `measurement_start_day` is hourly: 168 rows for
   * a seven-day window, 24 per date.
   */
  ooni: {
    sourceId: 'ooni',
    requestUrl: ooniUrl({ countryCode: 'IR', since: '2026-08-08', until: '2026-08-15' }),
    body: ooniIr,
  },

  /**
   * The whole blocklist — captured live 2026-08-15 through `buildBlocklistUrl`
   * (rule 26) and run through `parse` first. abuse.ch serves one document and
   * offers no narrowing, so this IS the request the app makes.
   *
   * Small (5 entries) and still carries what matters: **one online and four
   * offline**, two malware families, three countries, and two null hostnames.
   * The online/offline split is the distinction the adapter exists to preserve,
   * and a capture with only one status would not have exercised it.
   */
  'feodo-tracker': {
    sourceId: 'feodo-tracker',
    requestUrl: buildBlocklistUrl(),
    body: feodoC2,
  },

  'cisa-kev': {
    sourceId: 'cisa-kev',
    requestUrl: buildCatalogUrl(),
    body: cisaKev,
  },
  'unhcr-population': {
    sourceId: 'unhcr-population',
    requestUrl: buildPopulationUrl({ year: 2023, breakdown: 'asylum', limit: 500 }),
    body: unhcrPopulation,
  },
  worldbank: {
    sourceId: 'worldbank',
    requestUrl: worldbankUrl('USA', 'NY.GDP.MKTP.CD', 3),
    body: worldbankIndicator,
  },
  'wikidata-sparql': {
    sourceId: 'wikidata-sparql',
    /**
     * The REAL dossier query, derived from the app's own builder.
     *
     * It used to be a hand-written capital-city query whose recorded URL could
     * not have produced its recorded body — it omitted `SERVICE wikibase:label`
     * while the body carried `*Label` bindings. Deriving the URL removes the
     * possibility of that divergence rather than guarding against it: three of
     * six fixtures were found recording a request the app does not make, which
     * makes hand-written fixture URLs the failure mode rather than the exception.
     */
    requestUrl: buildCountryQueryUrl('FRA'),
    body: wikidataSparql,
  },
  'usgs-quakes': {
    sourceId: 'usgs-quakes',
    requestUrl: usgsFeedUrl('all_day'),
    body: usgsQuakes,
  },
  'nasa-eonet': {
    sourceId: 'nasa-eonet',
    requestUrl: eonetEventsUrl({ status: 'all', limit: 40 }),
    body: eonetEvents,
  },
  'wikipedia-rest': {
    sourceId: 'wikipedia-rest',
    requestUrl: wikipediaSummaryUrl('Emmanuel_Macron'),
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
    requestUrl: commonsImageinfoUrl('File:Emmanuel Macron in 2019.jpg'),
    body: commonsImageinfoLive,
  },
  'gdelt-doc': {
    sourceId: 'gdelt-doc',
    /**
     * Carries `timespan`, which the app sends and this fixture did not — the
     * third fixture found recording a request the app does not make, after the
     * Wikidata label service and the Commons `origin`. Found by the parameter
     * parity guard once its URL scanner could see concatenated fragments.
     */
    requestUrl:
      'https://api.gdeltproject.org/api/v2/doc/doc?query=sourcecountry%3AUS' +
      '&mode=artlist&format=json&timespan=30d&maxrecords=5',
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
  /**
   * A KEY-GATED SOURCE NEEDS ITS KEY HERE, exactly as the Worker supplies it.
   *
   * The fixture's `requestUrl` comes from the app's own builder, and for a
   * source like Ember that builder deliberately emits NO key — the key is a
   * query parameter, so putting it in a browser-built URL would ship it to every
   * visitor. This test process stands in for the Worker: it applies the key from
   * the registry's declared `keyParam`, using the same pure function the prober
   * uses, so there is one place that knows how a key reaches a request.
   *
   * A missing key is INCONCLUSIVE, never a contract failure. It answers "could
   * we ask" rather than "has the shape drifted" — the same distinction the
   * 4xx branch below already makes, and the reason `verifiedAgainst: live` does
   * not silently decay into "passed because nothing ran".
   */
  const record = (registry as { sources: Array<Record<string, unknown>> }).sources.find(
    (source) => source['id'] === sourceId,
  );
  const auth = record ? keyedProbeUrl({ ...record, probeUrl: fixture.requestUrl }, process.env) : null;
  if (auth && auth.reason !== null) {
    throw new InconclusiveLiveFetch(
      `live fetch of ${sourceId} needs a key: ${auth.reason} — inconclusive, not a contract failure`,
    );
  }
  const url = auth ? auth.url : fixture.requestUrl;

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
    body: fixture.bodyIsText ? await response.text() : await response.json(),
    ctx: {
      /**
       * THE UNKEYED URL, deliberately — `url` above may carry a key.
       *
       * `requestUrl` flows into `FetchProvenance` and is rendered in the
       * inspector, so recording the keyed form would put a secret on screen and
       * into any provenance a test writes out. The keyed URL exists only for the
       * duration of the fetch call above.
       */
      requestUrl: fixture.requestUrl,
      httpStatus: response.status,
      fetchedAt: new Date().toISOString(),
      cache: 'miss',
    },
  };
}
