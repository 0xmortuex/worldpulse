import { expectArray, expectObject, ShapeError, type FetchContext } from './adapter';
import { fetchProvenance } from './adapter';
import type { Fact } from '../facts/types';

const SOURCE_ID = 'gdelt-doc';

export interface Article {
  url: string;
  title: string;
  domain: string;
  language: string;
  sourceCountry: string;
  /** GDELT stamps are YYYYMMDDTHHMMSSZ, not ISO. */
  seenAt: string;
}

export interface UnusableArticle {
  index: number;
  reason: string;
}

export interface ArticleList {
  articles: Article[];
  /**
   * Rows that could not be rendered — no outlet, no timestamp, or a URL that is
   * not a web link. Counted rather than thrown, because one malformed row
   * should not blank an entire country's news, and counted rather than dropped
   * silently, because a shorter list with no explanation reads as less news.
   */
  unusable: UnusableArticle[];
}

/** GDELT's compact stamp: 20260810T143000Z -> 2026-08-10T14:30:00.000Z */
export function parseSeenDate(stamp: string, sourceId = SOURCE_ID): string {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp);
  if (!match) throw new ShapeError(sourceId, `seendate ${JSON.stringify(stamp)} is not YYYYMMDDTHHMMSSZ`);
  const [, y, mo, d, h, mi, s] = match;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) throw new ShapeError(sourceId, `seendate ${stamp} parses to an invalid date`);
  return new Date(parsed).toISOString();
}

export function parse(raw: unknown, sourceId = SOURCE_ID): ArticleList {
  const root = expectObject(sourceId, raw, 'root');

  // A query matching nothing returns an object with no `articles` key at all,
  // which is an empty result rather than a broken response.
  if (!('articles' in root)) return { articles: [], unusable: [] };

  const list = expectArray(sourceId, root['articles'], 'articles');

  const articles: Article[] = [];
  const unusable: UnusableArticle[] = [];

  list.forEach((entry, index) => {
    const at = `articles[${index}]`;
    const record = expectObject(sourceId, entry, at);

    const url = typeof record['url'] === 'string' ? record['url'] : '';
    const title = typeof record['title'] === 'string' ? record['title'].trim() : '';
    const domain = typeof record['domain'] === 'string' ? record['domain'].trim() : '';
    const seendate = typeof record['seendate'] === 'string' ? record['seendate'] : '';

    // A headline with no link cannot be opened; one with no outlet cannot be
    // attributed; one with no timestamp cannot be placed in the feed. Each is
    // a reason to exclude the row, and to say so.
    if (!/^https?:\/\//.test(url)) {
      unusable.push({ index, reason: 'no usable web link' });
      return;
    }
    if (title.length === 0) {
      unusable.push({ index, reason: 'no headline' });
      return;
    }
    if (domain.length === 0) {
      unusable.push({ index, reason: 'no outlet recorded' });
      return;
    }

    let seenAt: string;
    try {
      seenAt = parseSeenDate(seendate, sourceId);
    } catch {
      unusable.push({ index, reason: 'no usable timestamp' });
      return;
    }

    articles.push({
      url,
      title,
      domain,
      language: typeof record['language'] === 'string' ? record['language'] : 'unknown',
      sourceCountry: typeof record['sourcecountry'] === 'string' ? record['sourcecountry'] : 'unknown',
      seenAt,
    });
  });

  return { articles, unusable };
}

/**
 * Article count as a fact. Tagged DERIVED, not OFFICIAL: GDELT indexes what it
 * crawls, so a count measures coverage of the news, never the number of events.
 */
export function articleCountFact(list: ArticleList, ctx: FetchContext, window: string): Fact<number> {
  return {
    value: list.articles.length,
    unit: 'articles',
    asOf: window,
    tier: 'DERIVED',
    provenance: fetchProvenance(SOURCE_ID, ctx, list, 'articles.length'),
    note: 'Counts indexed coverage, not events. GDELT indexes what it crawls.',
  };
}
