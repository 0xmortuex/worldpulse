import { buildSeries, INDICATORS, type Series } from '../economy/series';
import type { RequestingFetcher } from '../fetch/scenario';
import type { SelectionIdentity } from '../fetch/selection';
import { parse as parseWorldBank, buildRequest, type IndicatorSeries } from '../sources/worldbank';
import { ShapeError, type FetchContext } from '../sources/adapter';
import type { FailedFetchProvenance } from '../facts/types';

/**
 * Live World Bank loading for the economy panel.
 *
 * The first surface in this app to make a runtime request. It exists alongside
 * the fixture provider rather than replacing it wholesale, because migration is
 * one source at a time through the deploy gate — and because the fixtures are
 * still what the contract tests read.
 */

export interface LiveRow {
  id: string;
  /** Present when the request produced a usable series. */
  loaded: { series: Series; raw: IndicatorSeries; ctx: FetchContext } | null;
  /** Present when it did not. Never both. */
  failure: FailedFetchProvenance | null;
}

export interface EconomyWindow {
  fromYear: number;
  toYear: number;
  referenceYear: number;
}

export interface LoadOptions {
  signal?: AbortSignal;
  /** Identity this load was issued under, echoed back so the caller can check it. */
  identity?: SelectionIdentity;
}

export interface EconomyLoad {
  iso3: string;
  identity: SelectionIdentity | undefined;
  rows: LiveRow[];
}

/**
 * Every registered indicator, fetched in parallel.
 *
 * Parallel rather than sequential because the limiter — not this function —
 * owns pacing. Serialising here would hide a rate limit behind latency and make
 * the panel slower for no protection the bucket does not already provide.
 */
export async function loadEconomyLive(
  fetcher: RequestingFetcher,
  iso3: string,
  window: EconomyWindow,
  options: LoadOptions = {},
): Promise<EconomyLoad> {
  const rows = await Promise.all(
    INDICATORS.map(async (spec): Promise<LiveRow> => {
      const outcome = await fetcher.request(buildRequest(iso3, spec.code), { signal: options.signal });

      if (!outcome.ok) return { id: spec.id, loaded: null, failure: outcome.failure };

      try {
        const parsed = parseWorldBank(outcome.raw);
        return {
          id: spec.id,
          loaded: { series: buildSeries(spec, parsed, window), raw: parsed, ctx: outcome.ctx },
          failure: null,
        };
      } catch (error) {
        /**
         * A response that will not parse is a failed request, not an empty one.
         *
         * The alternative — returning an empty series — would render "no data"
         * for a country whose data we received and could not read, which is the
         * conflation the fifth state exists to prevent, arriving by a different
         * route than a transport failure.
         */
        return {
          id: spec.id,
          loaded: null,
          failure: {
            kind: 'fetch-failed',
            sourceId: 'worldbank',
            requestUrl: outcome.ctx.requestUrl,
            httpStatus: outcome.ctx.httpStatus,
            attemptedAt: outcome.ctx.fetchedAt,
            attempts: 1,
            reason: 'shape',
            detail: error instanceof ShapeError ? error.message : String(error),
            retryableAt: null,
          },
        };
      }
    }),
  );

  return { iso3, identity: options.identity, rows };
}
