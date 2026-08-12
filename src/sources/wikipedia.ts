import { expectObject, expectString, type FetchContext } from './adapter';

export const SOURCE_ID = 'wikipedia-rest';

/**
 * Why a summary was not usable. Each is a distinct state the UI renders
 * differently — "no article exists" and "the title is ambiguous" are different
 * facts about the world and collapsing them loses the one a reader can act on.
 */
export type SummaryRefusal =
  | { kind: 'no-article'; reason: string }
  | { kind: 'ambiguous'; reason: string; pageType: string }
  | { kind: 'not-a-summary'; reason: string; pageType: string };

export interface Summary {
  /**
   * The title Wikipedia resolved to, which is NOT always the title requested.
   *
   * A redirect resolves silently: asking for "Macron" yields a different page.
   * Provenance records what was actually displayed, so the inspector can show
   * that we asked about one thing and are showing another.
   */
  resolvedTitle: string;
  requestedTitle: string;
  redirected: boolean;
  extract: string;
  url: string;
  thumbnailUrl: string | null;
}

/**
 * Page types that are a biography-shaped answer to a biography-shaped question.
 *
 * Everything else is refused. This is deliberately an allowlist: Wikipedia adds
 * page types, and a new one arriving should refuse rather than render.
 */
const RENDERABLE_TYPES = new Set(['standard']);

/**
 * Parse a Wikipedia REST summary, refusing anything that is not a real article.
 *
 * **A disambiguation page returns HTTP 200 with a plausible extract.** Measured
 * live: `Mercury` yields `type: "disambiguation"` and a 152-character extract
 * that reads like prose. The step-3 bio path had no type check, so a leader
 * whose name collides with a disambiguation page rendered a list of unrelated
 * meanings with a biography's confidence — a *wrong* value rather than a missing
 * one, which TESTING.md rule 7 ranks as the worse failure.
 *
 * The 404 body carries only `{status, type}` — no title, no extract — so the
 * absent-article path keys on the status code and never on missing fields.
 */
export function parseSummary(
  raw: unknown,
  requestedTitle: string,
  httpStatus: number,
): { ok: true; summary: Summary } | { ok: false; refusal: SummaryRefusal } {
  if (httpStatus === 404) {
    return {
      ok: false,
      refusal: {
        kind: 'no-article',
        reason: `Wikipedia has no article titled "${requestedTitle}"`,
      },
    };
  }

  const record = expectObject(SOURCE_ID, raw, 'summary');
  const pageType = typeof record['type'] === 'string' ? record['type'] : 'unknown';

  if (pageType === 'disambiguation') {
    return {
      ok: false,
      refusal: {
        kind: 'ambiguous',
        pageType,
        reason:
          `"${requestedTitle}" is a Wikipedia disambiguation page, not an article about a ` +
          'person. Its text lists unrelated meanings and is not a biography.',
      },
    };
  }

  if (!RENDERABLE_TYPES.has(pageType)) {
    return {
      ok: false,
      refusal: {
        kind: 'not-a-summary',
        pageType,
        reason: `Wikipedia returned a page of type "${pageType}", which is not an article summary.`,
      },
    };
  }

  const titles = record['titles'];
  const resolvedTitle =
    typeof titles === 'object' && titles !== null && typeof (titles as Record<string, unknown>)['normalized'] === 'string'
      ? ((titles as Record<string, unknown>)['normalized'] as string)
      : expectString(SOURCE_ID, record['title'], 'summary.title');

  const contentUrls = expectObject(SOURCE_ID, record['content_urls'], 'summary.content_urls');
  const desktop = expectObject(SOURCE_ID, contentUrls['desktop'], 'summary.content_urls.desktop');

  const thumbnail = record['thumbnail'];
  const thumbnailUrl =
    typeof thumbnail === 'object' && thumbnail !== null && typeof (thumbnail as Record<string, unknown>)['source'] === 'string'
      ? ((thumbnail as Record<string, unknown>)['source'] as string)
      : null;

  return {
    ok: true,
    summary: {
      resolvedTitle,
      requestedTitle,
      // Compared case-insensitively on underscores-as-spaces: a request is made
      // with underscores and the response normalises them, and calling that a
      // redirect would flag every ordinary lookup.
      redirected: normalise(resolvedTitle) !== normalise(requestedTitle),
      extract: expectString(SOURCE_ID, record['extract'], 'summary.extract'),
      url: expectString(SOURCE_ID, desktop['page'], 'summary.content_urls.desktop.page'),
      thumbnailUrl,
    },
  };
}

function normalise(title: string): string {
  return title.replace(/_/g, ' ').trim().toLowerCase();
}

/** The URL the app requests, recorded so provenance and fixtures cannot diverge. */
export function summaryUrl(title: string): string {
  return `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
}

export function summaryContext(title: string, httpStatus: number, fetchedAt: string): FetchContext {
  return { requestUrl: summaryUrl(title), httpStatus, fetchedAt, cache: 'miss' };
}
