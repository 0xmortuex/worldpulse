import type { Fact } from '../facts/types';
import type { RequestSpec } from '../fetch/compose';
import {
  expectArray,
  expectObject,
  expectString,
  fetchProvenance,
  ShapeError,
  type FetchContext,
} from './adapter';

const SOURCE_ID = 'worldbank';

export interface Observation {
  year: number;
  /** null is normal: the World Bank publishes the year before the figure exists. */
  value: number | null;
}

export interface IndicatorSeries {
  indicatorId: string;
  indicatorName: string;
  countryIso3: string;
  countryName: string;
  lastUpdated: string;
  observations: Observation[];
}

/**
 * The question this adapter asks, as data (decision F4).
 *
 * The adapter owns path and query; `compose` supplies origin, routing and key
 * from the registry. `buildUrl` below is kept and now derives from this, so the
 * two cannot drift: a contract test calling `buildUrl` and an app calling
 * `buildRequest` must produce the same request, and the only way to guarantee
 * that is for one to be built from the other.
 */
export function buildRequest(iso3: string, indicator: string, perPage = 60): RequestSpec {
  return {
    sourceId: SOURCE_ID,
    path: `/v2/country/${encodeURIComponent(iso3)}/indicator/${encodeURIComponent(indicator)}`,
    query: { format: 'json', per_page: String(perPage) },
  };
}

export function buildUrl(iso3: string, indicator: string, perPage = 60): string {
  // Derived from buildRequest so the two cannot disagree. The origin is still
  // written here because this is the pre-fetch-layer entry point the existing
  // contract test calls; compose() takes it from the registry instead.
  const spec = buildRequest(iso3, indicator, perPage);
  const query = new URLSearchParams(spec.query).toString();
  return `https://api.worldbank.org${spec.path}?${query}`;
}

/**
 * The v2 response is a two-element array: pagination metadata, then the rows.
 * An error response is a one-element array containing a message object, which is
 * why the length is checked rather than assumed.
 */
export function parse(raw: unknown, sourceId = SOURCE_ID): IndicatorSeries {
  const envelope = expectArray(sourceId, raw, 'root');
  if (envelope.length < 2) {
    throw new ShapeError(sourceId, `root array has ${envelope.length} elements, expected 2 (the API returns 1 on error)`);
  }

  const meta = expectObject(sourceId, envelope[0], 'root[0]');
  const rows = expectArray(sourceId, envelope[1], 'root[1]');
  if (rows.length === 0) throw new ShapeError(sourceId, 'no observations returned');

  const first = expectObject(sourceId, rows[0], 'root[1][0]');
  const indicator = expectObject(sourceId, first['indicator'], 'root[1][0].indicator');
  const country = expectObject(sourceId, first['country'], 'root[1][0].country');

  const observations: Observation[] = rows.map((row, index) => {
    const record = expectObject(sourceId, row, `root[1][${index}]`);
    const year = Number.parseInt(expectString(sourceId, record['date'], `root[1][${index}].date`), 10);
    if (!Number.isInteger(year)) {
      throw new ShapeError(sourceId, `root[1][${index}].date is not a year`);
    }
    const value = record['value'];
    if (value !== null && typeof value !== 'number') {
      throw new ShapeError(sourceId, `root[1][${index}].value is ${typeof value}, expected number or null`);
    }
    return { year, value: value as number | null };
  });

  return {
    indicatorId: expectString(sourceId, indicator['id'], 'indicator.id'),
    indicatorName: expectString(sourceId, indicator['value'], 'indicator.value'),
    countryIso3: expectString(sourceId, first['countryiso3code'], 'countryiso3code'),
    countryName: expectString(sourceId, country['value'], 'country.value'),
    lastUpdated: expectString(sourceId, meta['lastupdated'], 'root[0].lastupdated'),
    observations,
  };
}

/**
 * The most recent observation that actually has a value.
 *
 * Taking observations[0] would frequently yield null, because the current year
 * is published before the figure exists — and a null rendered as "no data" when
 * last year's figure is right there is a worse answer than the figure.
 */
export function latestFact(
  series: IndicatorSeries,
  ctx: FetchContext,
  options: { unit?: string; sourceId?: string } = {},
): Fact<number> {
  const sourceId = options.sourceId ?? SOURCE_ID;
  const latest = series.observations.find((observation) => observation.value !== null);

  const provenance = fetchProvenance(
    sourceId,
    ctx,
    series,
    latest
      ? `first observation with a non-null value (${series.indicatorId}, ${latest.year})`
      : `no non-null observation among ${series.observations.length} rows`,
  );

  const skipped = series.observations.findIndex((observation) => observation.value !== null);

  return {
    value: latest?.value ?? null,
    asOf: latest ? String(latest.year) : `no data through ${series.observations[0]?.year ?? '?'}`,
    tier: 'OFFICIAL',
    provenance,
    ...(options.unit === undefined ? {} : { unit: options.unit }),
    ...(skipped > 0
      ? { note: `${skipped} more recent year(s) are published but not yet populated.` }
      : {}),
    format: (value: number) => value.toLocaleString('en'),
  };
}
