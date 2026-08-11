import { expectArray, expectObject, expectString, ShapeError, type FetchContext } from './adapter';
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

export interface ArticleList {
  articles: Article[];
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
  if (!('articles' in root)) return { articles: [] };

  const list = expectArray(sourceId, root['articles'], 'articles');

  const articles = list.map((entry, index) => {
    const at = `articles[${index}]`;
    const record = expectObject(sourceId, entry, at);
    return {
      url: expectString(sourceId, record['url'], `${at}.url`),
      title: expectString(sourceId, record['title'], `${at}.title`),
      domain: expectString(sourceId, record['domain'], `${at}.domain`),
      language: expectString(sourceId, record['language'], `${at}.language`),
      sourceCountry: expectString(sourceId, record['sourcecountry'], `${at}.sourcecountry`),
      seenAt: parseSeenDate(expectString(sourceId, record['seendate'], `${at}.seendate`), sourceId),
    };
  });

  return { articles };
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
