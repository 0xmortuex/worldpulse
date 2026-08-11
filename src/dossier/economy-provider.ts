import gdpNormal from '../../tests/fixtures/economy/gdp-normal.json';
import gdpMidgap from '../../tests/fixtures/economy/gdp-midgap.json';
import gdpStale from '../../tests/fixtures/economy/gdp-stale.json';
import gdpRedenominated from '../../tests/fixtures/economy/gdp-redenominated.json';
import gdpSinglePoint from '../../tests/fixtures/economy/gdp-single-point.json';
import giniNoData from '../../tests/fixtures/economy/gini-no-data.json';
import inflationHyper from '../../tests/fixtures/economy/inflation-hyper.json';
import { parse as parseWorldBank, type IndicatorSeries } from '../sources/worldbank';
import { buildSeries, INDICATORS, type Series } from '../economy/series';
import type { FetchContext } from '../sources/adapter';

/**
 * Fixture-backed economy data.
 *
 * Countries map to whichever fixture exercises an interesting branch, so every
 * hard case is reachable in the running app and not only in tests:
 *
 *   USA  healthy series, with the published-but-empty current year
 *   XKX  a four-year gap in the middle of the series
 *   ERI  latest observation eight years old
 *   ZWE  redenomination: five orders of magnitude, log scale useful
 *   VEN  hyperinflation, but log unavailable because inflation can go negative
 *   SOM  an indicator with no data at all
 *   FJI  a single lone observation
 */

const GDP_BY_COUNTRY: Record<string, unknown> = {
  USA: gdpNormal,
  GBR: gdpNormal,
  DEU: gdpNormal,
  XKX: gdpMidgap,
  ERI: gdpStale,
  ZWE: gdpRedenominated,
  FJI: gdpSinglePoint,
};

const INFLATION_BY_COUNTRY: Record<string, unknown> = {
  VEN: inflationHyper,
  USA: inflationHyper,
};

const GINI_BY_COUNTRY: Record<string, unknown> = {
  SOM: giniNoData,
  USA: giniNoData,
  GBR: giniNoData,
};

const BY_INDICATOR: Record<string, Record<string, unknown>> = {
  gdp: GDP_BY_COUNTRY,
  inflation: INFLATION_BY_COUNTRY,
  gini: GINI_BY_COUNTRY,
};

export const ECONOMY_COUNTRIES = [
  ...new Set([...Object.keys(GDP_BY_COUNTRY), ...Object.keys(INFLATION_BY_COUNTRY), ...Object.keys(GINI_BY_COUNTRY)]),
];

export interface LoadedSeries {
  series: Series;
  raw: IndicatorSeries;
  ctx: FetchContext;
}

function ctxFor(iso3: string, code: string): FetchContext {
  return {
    requestUrl: `https://api.worldbank.org/v2/country/${iso3}/indicator/${code}?format=json&per_page=60`,
    httpStatus: 200,
    fetchedAt: '1970-01-01T00:00:00.000Z',
    cache: 'miss',
    fromFixture: true,
  };
}

/**
 * Every registered indicator for a country.
 *
 * Indicators with no fixture are returned as `null` rather than omitted, so the
 * tab renders a "not fetched" row instead of quietly shortening the list — an
 * indicator missing from the panel is indistinguishable from one that does not
 * exist.
 */
export function loadEconomy(
  iso3: string,
  window: { fromYear: number; toYear: number; referenceYear: number },
): Array<{ id: string; loaded: LoadedSeries | null }> {
  return INDICATORS.map((spec) => {
    const raw = BY_INDICATOR[spec.id]?.[iso3];
    if (!raw) return { id: spec.id, loaded: null };
    const parsed = parseWorldBank(raw);
    return {
      id: spec.id,
      loaded: {
        series: buildSeries(spec, parsed, window),
        raw: parsed,
        ctx: ctxFor(iso3, spec.code),
      },
    };
  });
}
