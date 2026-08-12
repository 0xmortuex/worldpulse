import articlesNormal from '../../tests/fixtures/news/articles-normal.json';
import articlesMultiscript from '../../tests/fixtures/news/articles-multiscript.json';
import articlesSparse from '../../tests/fixtures/news/articles-sparse.json';
import articlesDegraded from '../../tests/fixtures/news/articles-degraded.json';
import articlesSyndicated from '../../tests/fixtures/news/articles-syndicated.json';
import articlesExtremes from '../../tests/fixtures/news/articles-extremes.json';
import { parse as parseArticles, type ArticleList } from '../sources/gdelt';
import type { FetchContext } from '../sources/adapter';

/**
 * Fixture-backed news data.
 *
 *   USA  ordinary feed
 *   GBR  syndicated coverage of one story across twelve outlets
 *   IRN  non-Latin and RTL headlines and outlet names
 *   TUV  almost no indexed coverage
 *   MLI  degraded rows: no timestamp, no outlet, non-web link, empty headline
 *   DEU  deliberately extreme string lengths, for the text-fidelity checks
 *   XKX  sparse coverage
 */

const ARTICLES: Record<string, unknown> = {
  USA: articlesNormal,
  GBR: articlesSyndicated,
  IRN: articlesMultiscript,
  FJI: articlesSparse,
  MLI: articlesDegraded,
  DEU: articlesExtremes,
  XKX: articlesNormal,
};

/** Every country this provider can serve. Used by the rule-10 reachability test. */
export const NEWS_COUNTRIES = [...new Set(Object.keys(ARTICLES))];

function ctxFor(iso3: string, mode: string): FetchContext {
  return {
    requestUrl:
      `https://api.gdeltproject.org/api/v2/doc/doc?query=sourcecountry:${iso3}` +
      `&mode=${mode}&format=json&timespan=30d`,
    httpStatus: 200,
    fetchedAt: '1970-01-01T00:00:00.000Z',
    cache: 'miss',
    fromFixture: true,
  };
}

export interface NewsData {
  articles: { value: ArticleList; ctx: FetchContext } | null;
}

export function loadNews(iso3: string): NewsData {
  const rawArticles = ARTICLES[iso3];

  return {
    articles: rawArticles
      ? { value: parseArticles(rawArticles), ctx: ctxFor(iso3, 'artlist') }
      : null,
  };
}
