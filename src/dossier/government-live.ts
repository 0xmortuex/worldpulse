import type { RequestingFetcher } from '../fetch/scenario';
import type { FailedFetchProvenance } from '../facts/types';
import { ShapeError, type FetchContext } from '../sources/adapter';
import {
  buildCabinetQuery,
  buildJudiciaryQuery,
  buildLeadershipTimelineQuery,
  buildLegislatureQuery,
  parseCabinet,
  parseJudiciary,
  parseLeadershipTimeline,
  parseLegislature,
} from '../sources/wikidata-government';

/**
 * Live government loading — the third and last panel through the harness.
 *
 * ## What makes this one different from the first two
 *
 * The legislature and dossier panels each issue ONE query. This panel issues
 * four — cabinet, legislature, judiciary and leadership timeline — and the
 * property that matters is that they fail **independently**.
 *
 * A single `Promise.all` that rejects on the first failure would turn "the
 * judiciary query timed out" into "the government tab is unavailable", hiding
 * three sections that answered perfectly well. That is the degraded state
 * collapsing into the unavailable one, which is the distinction the fetch layer
 * exists to keep — and the economy panel already learned it the same way, per
 * indicator rather than per panel.
 *
 * So each section carries its own outcome, and the panel renders whatever
 * answered beside a stated absence for whatever did not.
 */

export interface SectionLoad<T> {
  value: T | null;
  ctx: FetchContext | null;
  failure: FailedFetchProvenance | null;
}

export interface GovernmentLoad {
  iso3: string;
  cabinet: SectionLoad<ReturnType<typeof parseCabinet>>;
  chambers: SectionLoad<ReturnType<typeof parseLegislature>>;
  judiciary: SectionLoad<ReturnType<typeof parseJudiciary>>;
  timeline: SectionLoad<ReturnType<typeof parseLeadershipTimeline>>;
}

async function section<T>(
  fetcher: RequestingFetcher,
  query: string,
  parse: (raw: unknown) => T,
  signal: AbortSignal | undefined,
): Promise<SectionLoad<T>> {
  const outcome = await fetcher.request({ sourceId: 'wikidata-sparql', path: query }, { signal });
  if (!outcome.ok) return { value: null, ctx: null, failure: outcome.failure };

  try {
    return { value: parse(outcome.raw), ctx: outcome.ctx, failure: null };
  } catch (error) {
    /**
     * A response that will not parse is a failed request, not an empty section.
     * An empty cabinet renders "no ministries recorded", which is a claim about
     * the country's government; a shape failure is a claim about our reading of
     * a response.
     */
    return {
      value: null,
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

export async function loadGovernmentLive(
  fetcher: RequestingFetcher,
  iso3: string,
  options: { signal?: AbortSignal } = {},
): Promise<GovernmentLoad> {
  /**
   * Parallel, and `Promise.all` is safe here ONLY because every `section` call
   * resolves — it catches its own failure rather than rejecting. If that ever
   * changes, one slow judiciary query takes the whole tab with it.
   */
  const [cabinet, chambers, judiciary, timeline] = await Promise.all([
    section(fetcher, buildCabinetQuery(iso3), parseCabinet, options.signal),
    section(fetcher, buildLegislatureQuery(iso3), parseLegislature, options.signal),
    section(fetcher, buildJudiciaryQuery(iso3), parseJudiciary, options.signal),
    section(fetcher, buildLeadershipTimelineQuery(iso3), parseLeadershipTimeline, options.signal),
  ]);

  return { iso3, cabinet, chambers, judiciary, timeline };
}

/** How many of the four sections answered. For the panel's degraded disclosure. */
export function answeredSections(load: GovernmentLoad): number {
  return [load.cabinet, load.chambers, load.judiciary, load.timeline].filter(
    (entry) => entry.failure === null,
  ).length;
}
