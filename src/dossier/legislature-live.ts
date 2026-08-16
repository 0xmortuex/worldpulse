import type { RequestingFetcher } from '../fetch/scenario';
import type { FailedFetchProvenance } from '../facts/types';
import { ShapeError, type FetchContext } from '../sources/adapter';
import { buildLegislatureQuery, parseLegislature, type Chamber } from '../sources/wikidata-government';

/**
 * Live legislature loading — the first panel converted through the generalised
 * scenario harness.
 *
 * ## Why this exists beside the fixture provider rather than replacing it
 *
 * 20b: the panel's hard cases come from specific subjects' real histories, and
 * live data will not reproduce them on demand. Pointed at the live path, those
 * assertions quietly stop testing the branch they were written for and start
 * testing whatever Wikidata returned that morning — **and they keep passing**,
 * which is what makes it dangerous.
 *
 * So the fixtures stay as the contract test's input and the browser suite's
 * deterministic input. They stop being the app's data source, and nothing else.
 *
 * ## The failure this loader must not commit
 *
 * A response that will not parse is a FAILED request, not an empty one.
 * Returning an empty chamber list for a country whose data we received and
 * could not read would render "no chambers recorded" — a statement about our
 * source's coverage — when the truth is that we got something and could not
 * understand it. Those are different facts and the panel says different things
 * about them.
 */

export interface LegislatureLoad {
  iso3: string;
  chambers: Chamber[] | null;
  ctx: FetchContext | null;
  failure: FailedFetchProvenance | null;
}

export async function loadLegislatureLive(
  fetcher: RequestingFetcher,
  iso3: string,
  options: { signal?: AbortSignal } = {},
): Promise<LegislatureLoad> {
  /**
   * The query IS the request body for SPARQL, and it is passed as `path` so the
   * scenario handler can read the ISO code out of it. That is deliberate: a
   * POST-with-a-body source has no country in its URL, and pretending otherwise
   * is what made the old harness World-Bank-shaped.
   */
  const outcome = await fetcher.request(
    { sourceId: 'wikidata-sparql', path: buildLegislatureQuery(iso3) },
    { signal: options.signal },
  );

  if (!outcome.ok) {
    return { iso3, chambers: null, ctx: null, failure: outcome.failure };
  }

  try {
    return { iso3, chambers: parseLegislature(outcome.raw), ctx: outcome.ctx, failure: null };
  } catch (error) {
    return {
      iso3,
      chambers: null,
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
