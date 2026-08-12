import { escapeHtml, factHtml } from '../facts/badge';
import { notAFact } from '../facts/discipline';
import type { Fact } from '../facts/types';
import { loadNews } from '../dossier/news-provider';
import type { Article, ArticleList } from '../sources/gdelt';
import {
  groupSyndicated,
  isRtl,
  SPARSE_ARTICLE_THRESHOLD,
  type ArticleGroup,
} from '../sources/news-text';
import type { FetchContext } from '../sources/adapter';

/**
 * News tab.
 *
 * The framing rule for this whole panel: GDELT indexes English-language online
 * news that it crawls. Sparse coverage is a fact about the INDEX, never about
 * the country. "Two articles" must read as "two articles indexed", not as
 * "a quiet week here" — that is this step's version of the empty-cabinet bug.
 */


const TOPICS: Array<{ id: string; label: string; match: RegExp }> = [
  { id: 'politics', label: 'Politics', match: /\b(parliament|legislature|election|minister|court|constitution|budget|vote)\b/i },
  { id: 'conflict', label: 'Conflict', match: /\b(strike|attack|clash|troops|military|ceasefire|offensive)\b/i },
  { id: 'economy', label: 'Economy', match: /\b(inflation|bank|rate|trade|energy|pricing|budget|economic|economy)\b/i },
  { id: 'disaster', label: 'Disaster', match: /\b(flood|quake|storm|wildfire|drought|bleaching|eruption)\b/i },
];

let activeTopic: string | null = null;

export function resetNewsFilters(): void {
  activeTopic = null;
}

function n(value: number, reason: string): string {
  return notAFact(value, reason);
}

export function renderNewsTab(iso3: string, countryName: string): string {
  const news = loadNews(iso3);

  if (!news.articles) {
    return `<div class="news">
      <p class="gov-pending"><strong>No news data for ${escapeHtml(countryName)}.</strong>
      The GDELT ingest is not connected yet and only a few countries have fixtures.</p>
    </div>`;
  }

  const list = news.articles.value;
  const groups = groupSyndicated(list.articles);
  const filtered = activeTopic
    ? groups.filter((group) => TOPICS.find((topic) => topic.id === activeTopic)?.match.test(group.lead.title))
    : groups;

  return `<div class="news">
    ${coverageNote(list, countryName, news.articles.ctx)}
    ${topicFilters(groups)}
    ${unusableNote(list)}
    ${
      filtered.length === 0
        ? `<p class="news-empty">No indexed articles match this filter. That is a
           statement about what GDELT indexed, not about what happened.</p>`
        : `<ul class="news-list">${filtered.map(articleRow).join('')}</ul>`
    }
  </div>`;
}

/**
 * Coverage volume, always framed as a property of the index.
 *
 * The count is a DERIVED fact — GDELT counts what it crawled — so it carries a
 * badge like any other value.
 */
function coverageNote(list: ArticleList, countryName: string, ctx: FetchContext): string {
  const count = list.articles.length;
  const sparse = count < SPARSE_ARTICLE_THRESHOLD;

  const fact: Fact<number> = {
    value: count,
    unit: 'articles',
    asOf: 'last 30 days',
    tier: 'DERIVED',
    provenance: {
      kind: 'fetch',
      sourceId: 'gdelt-doc',
      requestUrl: ctx.requestUrl,
      httpStatus: ctx.httpStatus,
      fetchedAt: ctx.fetchedAt,
      cache: ctx.cache,
      raw: list,
      extractedBy: 'articles.length after excluding unusable rows',
      ...(ctx.fromFixture === undefined ? {} : { fromFixture: ctx.fromFixture }),
    },
    note: 'Counts English-language articles GDELT indexed, not events.',
  };

  return `<section class="news-coverage${sparse ? ' news-coverage--sparse' : ''}">
    <div class="news-coverage-head">
      <span class="news-coverage-label">Indexed coverage</span>
      ${factHtml(fact, { hideAsOf: true })}
    </div>
    <p class="news-coverage-note">
      ${
        sparse
          ? `<strong>Little English-language coverage of ${escapeHtml(countryName)} is indexed.</strong>
             This describes GDELT's index, not events. GDELT crawls a subset of online news,
             weighted heavily toward English-language and internationally-oriented outlets, so a
             low count here is a limitation of the source and says nothing about how much is
             happening.`
          : `GDELT indexes English-language online news that it crawls. Volume reflects what is
             indexed and how internationally covered a country is, not how much is happening.`
      }
    </p>
  </section>`;
}

function unusableNote(list: ArticleList): string {
  if (list.unusable.length === 0) return '';
  const reasons = [...new Set(list.unusable.map((entry) => entry.reason))].join(', ');
  return `<p class="news-caveat">${n(
    list.unusable.length,
    'count of feed rows excluded from the list below, each for a stated structural reason',
  )} item(s) in the feed could not be shown (${escapeHtml(reasons)}). They are counted here
  rather than dropped silently, because a shorter list with no explanation reads as less news.</p>`;
}

function topicFilters(groups: readonly ArticleGroup[]): string {
  const buttons = TOPICS.map((topic) => {
    const count = groups.filter((group) => topic.match.test(group.lead.title)).length;
    return `<button type="button" class="news-topic${activeTopic === topic.id ? ' news-topic--active' : ''}"
      data-topic="${topic.id}" ${count === 0 ? 'disabled' : ''}
      >${escapeHtml(topic.label)} <span class="news-topic-count">${n(
        count,
        'count of stories whose headline matches this filter, a property of the rendered list',
      )}</span></button>`;
  }).join('');

  return `<div class="news-topics">
    <button type="button" class="news-topic${activeTopic === null ? ' news-topic--active' : ''}"
      data-topic="">All</button>
    ${buttons}
    <p class="news-topics-note">Filters match headline keywords. They are a convenience,
    not a classification — a story with no matching keyword is simply not surfaced by them.</p>
  </div>`;
}

function articleRow(group: ArticleGroup): string {
  const article = group.lead;
  const rtl = isRtl(article.title);
  const outletRtl = isRtl(article.domain);

  return `<li class="news-item">
    <a class="news-title" href="${escapeHtml(article.url)}" target="_blank" rel="noreferrer noopener"
      ${rtl ? 'dir="rtl"' : 'dir="auto"'} lang="${escapeHtml(languageTag(article))}"
      >${escapeHtml(article.title)}</a>
    <div class="news-meta">
      <span class="news-outlet" ${outletRtl ? 'dir="rtl"' : 'dir="auto"'}>${escapeHtml(article.domain)}</span>
      <time class="news-time" datetime="${escapeHtml(article.seenAt)}"
        >${escapeHtml(article.seenAt.slice(0, 16).replace('T', ' '))}Z</time>
      ${
        article.language !== 'English'
          ? `<span class="news-lang">${escapeHtml(article.language)}</span>`
          : ''
      }
      ${
        group.outletCount > 1
          ? `<span class="news-syndicated" title="Grouped by normalised headline. The other outlets carry what appears to be the same story."
             >+${n(
               group.outletCount - 1,
               'count of additional outlets carrying the same normalised headline, a property of the grouping rather than a measured value',
             )} more outlets</span>`
          : ''
      }
    </div>
  </li>`;
}

function languageTag(article: Article): string {
  const map: Record<string, string> = {
    Arabic: 'ar',
    Hebrew: 'he',
    Persian: 'fa',
    Chinese: 'zh',
    Hindi: 'hi',
    English: 'en',
  };
  return map[article.language] ?? 'und';
}

export function mountNewsTab(root: HTMLElement, rerender: () => void): void {
  root.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-topic]');
    if (!button) return;
    event.stopPropagation();
    const topic = button.dataset['topic'] ?? '';
    activeTopic = topic === '' ? null : topic;
    rerender();
  });
}
