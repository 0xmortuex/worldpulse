import type { RequestingFetcher } from '../fetch/scenario';
import type { FailedFetchProvenance } from '../facts/types';
import { ShapeError, type FetchContext } from '../sources/adapter';
import { buildCountryQuery, parseCountryDossier, type CountryDossierRecord } from '../sources/wikidata-dossier';

/**
 * Live dossier-header loading — the second panel through the generalised
 * scenario harness.
 *
 * Same shape as `legislature-live.ts`, deliberately: the third conversion
 * should be a copy of the second rather than a new invention, and the places
 * where it CANNOT be a copy are the interesting ones. Here there is only one,
 * noted below.
 */

export interface DossierLoad {
  iso3: string;
  record: CountryDossierRecord | null;
  ctx: FetchContext | null;
  failure: FailedFetchProvenance | null;
}

export async function loadDossierLive(
  fetcher: RequestingFetcher,
  iso3: string,
  options: { signal?: AbortSignal } = {},
): Promise<DossierLoad> {
  const outcome = await fetcher.request(
    { sourceId: 'wikidata-sparql', path: buildCountryQuery(iso3) },
    { signal: options.signal },
  );

  if (!outcome.ok) return { iso3, record: null, ctx: null, failure: outcome.failure };

  try {
    /**
     * THE ONE PLACE THIS DIFFERS FROM THE LEGISLATURE LOADER.
     *
     * `parseCountryDossier` returns a record for a country that exists and
     * throws for a response it cannot read — there is no "empty" middle case,
     * because a country either has a Wikidata entity or the query returned
     * nothing to parse. So a thrown parse here is always a failed request,
     * never a country with no data, and the header must not offer the second
     * reading.
     */
    return { iso3, record: parseCountryDossier(outcome.raw), ctx: outcome.ctx, failure: null };
  } catch (error) {
    return {
      iso3,
      record: null,
      ctx: null,
      failure: {
        kind: 'fetch-failed',
        sourceId: 'wikidata-sparql',
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
}
