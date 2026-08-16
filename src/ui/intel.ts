import normal from '../../tests/fixtures/news/articles-normal.json';
import extremes from '../../tests/fixtures/news/articles-extremes.json';
import multiscript from '../../tests/fixtures/news/articles-multiscript.json';
import syndicated from '../../tests/fixtures/news/articles-syndicated.json';
import sparse from '../../tests/fixtures/news/articles-sparse.json';
import {
  DEFAULT_SIGNIFICANCE_WEIGHTS,
  SIGNIFICANCE_CAVEAT,
  significanceOf,
  type SignificanceInput,
  type StoryMeasurements,
} from '../news/significance';
import { escapeHtml } from '../facts/badge';
import { notAFact as n } from '../facts/discipline';

/**
 * The intel feed — SPEC-WARWATCH §3.
 *
 * A chronological feed across every captured source, separate from the
 * per-country news tab.
 *
 * ## It reuses the news board's engine, entire
 *
 * §3 requires this and gives the reason: *"a second ranking mechanism would
 * drift from the first, and two surfaces disagreeing about which story matters
 * is worse than either being wrong alone."* So there is no scoring code in this
 * file. `significanceOf` does the arithmetic, `DEFAULT_SIGNIFICANCE_WEIGHTS`
 * supplies the weights, and severity is a **band drawn across that one score**
 * rather than a second opinion about it.
 *
 * ## Severity is banded against what was CONSULTED, not against a fixed total
 *
 * This is the subtle one, and getting it wrong would have been invisible.
 *
 * The score is a sum of `normalised × weight` over five inputs. An input that
 * was not consulted contributes `null`, not zero — question 13's distinction,
 * which `significanceOf` already honours by reporting `unconsulted` separately.
 * But a band boundary expressed as an absolute score quietly undoes that: a
 * story whose event linkage was never checked can reach at most 9 of 11, so a
 * fixed "high ≥ 7" would rank it lower **for the app's own failure to look**.
 *
 * So bands are computed as a fraction of the maximum the story could have
 * scored **given which inputs answered at all**, and the surface says how many
 * were unconsulted. Rule 30's register: no answer is not an answer of no.
 */

/** A GDELT-shaped article record, as the captures store them. */
interface RawArticle {
  url: string;
  title: string;
  seendate: string;
  socialimage?: string;
  domain: string;
  language?: string;
  sourcecountry?: string;
}

export interface IntelItem {
  id: string;
  title: string;
  url: string;
  /** The publishing domain, as reported. Never prettified into a brand name. */
  outlet: string;
  country: string | null;
  image: string | null;
  /** The raw timestamp exactly as the source gave it. */
  seendate: string;
  /** Parsed epoch milliseconds, or null when the stamp cannot be interpreted. */
  publishedMs: number | null;
}

/**
 * Every captured corpus, each tagged with the capture it came from.
 *
 * `articles-degraded.json` is deliberately excluded: it is the fixture for a
 * source answering badly, and it belongs to the tests that assert degraded
 * rendering, not to a feed claiming to show what we have.
 */
const CAPTURES: Array<{ id: string; rows: readonly RawArticle[] }> = [
  { id: 'normal', rows: normal.articles },
  { id: 'extremes', rows: extremes.articles },
  { id: 'multiscript', rows: multiscript.articles },
  { id: 'syndicated', rows: syndicated.articles },
  { id: 'sparse', rows: sparse.articles },
];

/**
 * GDELT stamps look like `20260810T143000Z`, which `Date.parse` rejects.
 *
 * Returns null for anything it cannot read rather than a guess. A timestamp
 * this app cannot interpret is not a timestamp it may approximate — the item
 * still renders, and it renders saying the time is unavailable.
 */
export function parseSeenDate(raw: string): number | null {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(raw.trim());
  if (!match) {
    const direct = Date.parse(raw);
    return Number.isNaN(direct) ? null : direct;
  }
  const [, y, mo, d, h, mi, s] = match;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return Number.isNaN(ms) ? null : ms;
}

export type RelativeTime =
  | { kind: 'ago'; text: string }
  | { kind: 'unavailable'; text: string };

/**
 * Relative time from the item's OWN publication stamp.
 *
 * §3: *"A future timestamp is a data error. It renders as 'publication time
 * unavailable' — never as 'in 2 hours'. The reference implementation gets this
 * wrong; do not copy it."*
 *
 * A small tolerance absorbs clock skew between us and the publisher, because
 * treating a stamp four seconds ahead as corrupt would be its own wrong answer.
 * Beyond that the stamp is not a time we can place, and saying so is the only
 * honest rendering — the same register as an unparseable one.
 */
export const FUTURE_TOLERANCE_MS = 60_000;

export function relativeTime(publishedMs: number | null, nowMs: number): RelativeTime {
  if (publishedMs === null) {
    return { kind: 'unavailable', text: 'publication time unavailable' };
  }
  const delta = nowMs - publishedMs;
  if (delta < -FUTURE_TOLERANCE_MS) {
    return { kind: 'unavailable', text: 'publication time unavailable' };
  }

  const seconds = Math.max(0, Math.floor(delta / 1000));
  if (seconds < 60) return { kind: 'ago', text: 'just now' };

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { kind: 'ago', text: `${minutes} min ago` };

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { kind: 'ago', text: `${hours} h ago` };

  const days = Math.floor(hours / 24);
  return { kind: 'ago', text: `${days} d ago` };
}

export function allItems(): IntelItem[] {
  const items: IntelItem[] = [];
  for (const capture of CAPTURES) {
    capture.rows.forEach((row, index) => {
      const image = (row.socialimage ?? '').trim();
      const country = (row.sourcecountry ?? '').trim();
      items.push({
        id: `${capture.id}-${index}`,
        title: row.title,
        url: row.url,
        outlet: row.domain,
        country: country === '' ? null : country,
        image: image === '' ? null : image,
        seendate: row.seendate,
        publishedMs: parseSeenDate(row.seendate),
      });
    });
  }
  return items;
}

export type Band = 'high' | 'elevated' | 'routine';
export const BANDS: Band[] = ['high', 'elevated', 'routine'];

/**
 * Band boundaries as fractions of the ACHIEVABLE score. See the header: an
 * absolute threshold would penalise a story for an input we failed to consult.
 */
export const BAND_FLOOR: Record<Exclude<Band, 'routine'>, number> = {
  high: 0.6,
  elevated: 0.3,
};

export interface Severity {
  band: Band;
  /** The weighted sum, as `significanceOf` computed it. */
  score: number;
  /** The most this story could have scored, given the inputs that answered. */
  achievable: number;
  /** `score / achievable`, or null when nothing was consulted at all. */
  fraction: number | null;
  unconsulted: SignificanceInput[];
}

export function severityOf(
  story: StoryMeasurements,
  weights: Record<SignificanceInput, number> = DEFAULT_SIGNIFICANCE_WEIGHTS,
): Severity {
  const scored = significanceOf(story, weights);

  const achievable = scored.contributions
    .filter((entry) => entry.contribution !== null)
    .reduce((sum, entry) => sum + entry.weight, 0);

  /**
   * Nothing answered. Not "routine" — routine is a finding, and this is the
   * absence of one. The band still has to be a value, so it is the lowest, and
   * `fraction: null` is what the surface renders instead of a number.
   */
  if (achievable === 0) {
    return { band: 'routine', score: 0, achievable: 0, fraction: null, unconsulted: scored.unconsulted };
  }

  const fraction = scored.score / achievable;
  const band: Band =
    fraction >= BAND_FLOOR.high ? 'high' : fraction >= BAND_FLOOR.elevated ? 'elevated' : 'routine';

  return { band, score: scored.score, achievable, fraction, unconsulted: scored.unconsulted };
}

export type Range = '24h' | '7d' | '30d' | 'all';
export type Sort = 'recent' | 'oldest';

export const RANGE_MS: Record<Exclude<Range, 'all'>, number> = {
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};

export interface FeedQuery {
  search: string;
  sort: Sort;
  range: Range;
  page: number;
}

export const PAGE_SIZE = 12;

export const DEFAULT_QUERY: FeedQuery = { search: '', sort: 'recent', range: 'all', page: 1 };

/**
 * Items an undatable stamp excludes from a RANGE filter, counted rather than
 * dropped silently.
 *
 * A reader narrowing to 24h and seeing the total fall has been told something
 * true. A reader who is not told that some items have no usable timestamp would
 * read their absence as "nothing else was published", which is rule 30 again.
 */
export interface FeedResult {
  items: IntelItem[];
  /** Matching the search and range, before pagination. */
  total: number;
  /** Excluded by the range filter for having no readable timestamp. */
  undatable: number;
  page: number;
  pages: number;
}

export function queryFeed(query: FeedQuery, nowMs: number, source: IntelItem[] = allItems()): FeedResult {
  const needle = query.search.trim().toLowerCase();

  let undatable = 0;
  const matched = source.filter((item) => {
    if (needle !== '') {
      const hay = `${item.title} ${item.outlet} ${item.country ?? ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (query.range === 'all') return true;
    if (item.publishedMs === null) {
      undatable += 1;
      return false;
    }
    return nowMs - item.publishedMs <= RANGE_MS[query.range];
  });

  /**
   * Undatable items sort LAST in both directions rather than being treated as
   * epoch zero or as now. Neither end is where they belong, and putting them at
   * one would assert a position the stamp does not support.
   */
  const sorted = [...matched].sort((a, b) => {
    if (a.publishedMs === null && b.publishedMs === null) return 0;
    if (a.publishedMs === null) return 1;
    if (b.publishedMs === null) return -1;
    return query.sort === 'recent' ? b.publishedMs - a.publishedMs : a.publishedMs - b.publishedMs;
  });

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, query.page), pages);
  const start = (page - 1) * PAGE_SIZE;

  return { items: sorted.slice(start, start + PAGE_SIZE), total: sorted.length, undatable, page, pages };
}

/**
 * What the severity band means, stated on the surface and not in a tooltip.
 *
 * §3 requires the sentence about coverage volume; the rest is this app's own
 * disclosure about how the band is drawn, which a reader cannot infer from a
 * coloured word.
 */
export const SEVERITY_CAVEAT =
  'Severity reflects COVERAGE VOLUME and event linkage, not editorial importance. ' +
  'It is banded as a share of the most a story could have scored given the inputs that ' +
  'answered — so an input this app could not consult lowers the confidence, never the band.';

export const INTEL_CAVEAT = SIGNIFICANCE_CAVEAT;

function bandLabel(band: Band): string {
  return band === 'high' ? 'High' : band === 'elevated' ? 'Elevated' : 'Routine';
}

/**
 * Severity for a feed item.
 *
 * A single article is, on its own, a story carried by one outlet — and that is
 * what gets measured. `linkedToTrackedEvent` is **null, not false**: no event
 * index is wired to this feed, and the score must record that it did not look
 * rather than record a miss.
 */
export function measurementsFor(item: IntelItem, corpus: readonly IntelItem[]): StoryMeasurements {
  const key = item.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const copies = corpus.filter(
    (other) => other.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim() === key,
  );

  const outlets = new Set(copies.map((copy) => copy.outlet));
  const countries = new Set(copies.map((copy) => copy.country).filter((c): c is string => c !== null));

  const stamps = copies.map((copy) => copy.publishedMs).filter((ms): ms is number => ms !== null);
  const days =
    stamps.length === 0 ? 0 : Math.floor((Math.max(...stamps) - Math.min(...stamps)) / 86_400_000);

  return {
    outlets: outlets.size,
    articles: copies.length,
    days,
    countries: countries.size,
    linkedToTrackedEvent: null,
  };
}

/**
 * The "why this severity" inspector — the arithmetic, not a summary of it.
 *
 * Every contribution renders as `raw → normalised × weight = contribution`, so
 * a reader can add the column up and get the score. An unconsulted input keeps
 * its row and says it was not consulted, because a row quietly omitted is the
 * difference between "this scored nothing" and "we never asked".
 */
export function renderWhy(item: IntelItem, corpus: readonly IntelItem[]): string {
  const measured = measurementsFor(item, corpus);
  const severity = severityOf(measured);
  const scored = significanceOf(measured);

  const rows = scored.contributions
    .map((entry) => {
      const raw = entry.raw === null ? 'not consulted' : `${String(entry.raw)} ${entry.rawUnit}`;
      const arithmetic =
        entry.contribution === null
          ? '<td class="why-unconsulted" colspan="3">not consulted — excluded from both sides of the share</td>'
          : `<td>${entry.normalised?.toFixed(3)}</td><td>× ${n(entry.weight, 'a weight this app chose for the ranking, not a measurement of anything')}</td><td>= ${entry.contribution.toFixed(3)}</td>`;
      return `<tr><th scope="row">${escapeHtml(entry.input)}</th><td>${escapeHtml(raw)}</td>${arithmetic}</tr>`;
    })
    .join('');

  const copies = corpus.filter(
    (other) =>
      other.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim() ===
      item.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim(),
  );

  return `<div class="why-panel" role="dialog" aria-modal="true" aria-label="Why this severity">
    <header class="why-header">
      <h3>Why this severity: ${escapeHtml(bandLabel(severity.band))}</h3>
      <button type="button" class="why-close" data-why-close aria-label="Close">Close</button>
    </header>
    <table class="why-table">
      <caption>Each input normalised to a unitless share, then weighted.</caption>
      <tbody>${rows}</tbody>
    </table>
    <p class="why-total">
      Score ${severity.score.toFixed(3)} of ${n(severity.achievable, 'the sum of this app\'s own weights over the inputs that answered')} achievable
      = ${severity.fraction === null ? 'not computable' : `${(severity.fraction * 100).toFixed(1)}%`}.
      Bands: High at ${n(BAND_FLOOR.high * 100, 'a band boundary this app chose')}%, Elevated at ${n(BAND_FLOOR.elevated * 100, 'a band boundary this app chose')}%.
    </p>
    ${
      severity.unconsulted.length > 0
        ? `<p class="why-unconsulted-note">${n(severity.unconsulted.length, 'a count of this app\'s own unanswered inputs')} input(s) not consulted:
           ${escapeHtml(severity.unconsulted.join(', '))}. These are excluded from the achievable
           total as well as from the score, so failing to look cannot lower the band.</p>`
        : ''
    }
    <h4 class="why-articles-heading">The ${n(copies.length, 'a count of rows in this app\'s captured corpus')} article${copies.length === 1 ? '' : 's'} this is measured from</h4>
    <ul class="why-articles">
      ${copies
        .map(
          (copy) =>
            `<li><a href="${escapeHtml(copy.url)}" rel="noopener noreferrer" target="_blank">${escapeHtml(copy.outlet)}</a>
             — ${escapeHtml(copy.seendate)}</li>`,
        )
        .join('')}
    </ul>
  </div>`;
}

export function renderIntelFeed(query: FeedQuery, nowMs: number): string {
  const corpus = allItems();
  const result = queryFeed(query, nowMs, corpus);

  const counts: Record<Band, number> = { high: 0, elevated: 0, routine: 0 };
  for (const item of corpus) counts[severityOf(measurementsFor(item, corpus)).band] += 1;

  const cards = result.items
    .map((item) => {
      const severity = severityOf(measurementsFor(item, corpus));
      const when = relativeTime(item.publishedMs, nowMs);
      return `<li class="intel-card" data-intel-item="${escapeHtml(item.id)}">
        ${
          item.image === null
            ? ''
            : `<img class="intel-image" src="${escapeHtml(item.image)}" alt="" loading="lazy">`
        }
        <div class="intel-body">
          <h3 class="intel-title"><a href="${escapeHtml(item.url)}" rel="noopener noreferrer" target="_blank">${escapeHtml(item.title)}</a></h3>
          <p class="intel-meta">
            <span class="intel-outlet">${escapeHtml(item.outlet)}</span>
            ${item.country === null ? '' : `<span class="intel-country">${escapeHtml(item.country)}</span>`}
            <span class="intel-time intel-time--${when.kind}">${escapeHtml(when.text)}</span>
          </p>
          <button type="button" class="intel-band intel-band--${severity.band}"
            data-intel-why="${escapeHtml(item.id)}"
            aria-label="Why this severity: ${escapeHtml(bandLabel(severity.band))}">
            ${escapeHtml(bandLabel(severity.band))}
            <span class="intel-band-why">why</span>
          </button>
        </div>
      </li>`;
    })
    .join('');

  return `<div class="intel-panel" role="dialog" aria-modal="true" aria-label="Intel feed">
    <header class="intel-header">
      <h2>Intel feed</h2>
      <button type="button" class="intel-close" data-intel-close aria-label="Close the intel feed">Close</button>
    </header>

    <p class="intel-caveat">${escapeHtml(SEVERITY_CAVEAT)}</p>
    <p class="intel-caveat intel-caveat--corpus">${escapeHtml(INTEL_CAVEAT)}</p>

    <div class="intel-counters">
      <span class="intel-total">${n(result.total, 'a count of rows matching the filters in this app\'s corpus')} of ${n(corpus.length, 'the size of this app\'s captured corpus, not of the news')} items</span>
      ${BANDS.map((band) => `<span class="intel-count intel-count--${band}">${bandLabel(band)}: ${n(counts[band] ?? 0, 'a count of this app\'s own banding over its own corpus')}</span>`).join('')}
    </div>

    <div class="intel-controls">
      <label class="intel-control">Search
        <input type="search" data-intel-search value="${escapeHtml(query.search)}" placeholder="Headline, outlet or country">
      </label>
      <label class="intel-control">Sort
        <select data-intel-sort>
          <option value="recent"${query.sort === 'recent' ? ' selected' : ''}>Most recent</option>
          <option value="oldest"${query.sort === 'oldest' ? ' selected' : ''}>Oldest</option>
        </select>
      </label>
      <label class="intel-control">Range
        <select data-intel-range>
          ${(['24h', '7d', '30d', 'all'] as Range[])
            .map((range) => `<option value="${range}"${query.range === range ? ' selected' : ''}>${range === 'all' ? 'All time' : range}</option>`)
            .join('')}
        </select>
      </label>
    </div>

    ${
      result.undatable > 0
        ? `<p class="intel-undatable">${n(result.undatable, 'a count of this app\'s rows whose stamp it could not read')} item${result.undatable === 1 ? '' : 's'} excluded from this range:
           the source's publication stamp could not be read. That is a gap in what we can date,
           not a statement that nothing else was published.</p>`
        : ''
    }

    ${
      result.items.length === 0
        ? '<p class="intel-empty">Nothing matches these filters. That is a fact about the filters and about this app\'s corpus, not about the world.</p>'
        : `<ul class="intel-list">${cards}</ul>`
    }

    <nav class="intel-pager" aria-label="Feed pages">
      <button type="button" data-intel-page="${n(result.page - 1, 'a page index in this app\'s own pagination')}" ${result.page <= 1 ? 'disabled' : ''}>Previous</button>
      <span class="intel-page-state">Page ${n(result.page, 'a page index in this app\'s own pagination')} of ${n(result.pages, 'a page count in this app\'s own pagination')} · ${n(result.total, 'a count of rows matching the filters in this app\'s corpus')} items</span>
      <button type="button" data-intel-page="${n(result.page + 1, 'a page index in this app\'s own pagination')}" ${result.page >= result.pages ? 'disabled' : ''}>Next</button>
    </nav>
  </div>`;
}

export function mountIntel(root: HTMLElement, launcher: HTMLElement, now: () => number): void {
  let open = false;
  let why: string | null = null;
  let query: FeedQuery = { ...DEFAULT_QUERY };
  // Declared ABOVE `draw`, which reads it. The flat map's temporal dead zone
  // was exactly this shape and cost a full verify run to find.
  let restoreSearchFocus = false;

  const draw = () => {
    if (!open) {
      root.hidden = true;
      root.innerHTML = '';
      return;
    }
    root.hidden = false;
    const corpus = allItems();
    const inspected = why === null ? null : corpus.find((entry) => entry.id === why) ?? null;
    root.innerHTML =
      renderIntelFeed(query, now()) + (inspected === null ? '' : renderWhy(inspected, corpus));

    /**
     * Restore focus to the search box after a redraw that came FROM the search
     * box. `innerHTML` replaces the input, so without this every keystroke
     * moves focus to the top of the document and the reader types one letter
     * per click. Same class as the rail's wholesale rebuild.
     */
    if (restoreSearchFocus) {
      const input = root.querySelector<HTMLInputElement>('[data-intel-search]');
      input?.focus();
      input?.setSelectionRange(query.search.length, query.search.length);
      restoreSearchFocus = false;
    }
  };

  launcher.addEventListener('click', () => {
    open = !open;
    why = null;
    draw();
  });

  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    if (target.closest('[data-intel-close]')) {
      open = false;
      why = null;
      draw();
      return;
    }
    if (target.closest('[data-why-close]')) {
      why = null;
      draw();
      return;
    }

    const whyButton = target.closest<HTMLElement>('[data-intel-why]');
    if (whyButton) {
      why = whyButton.dataset['intelWhy'] ?? null;
      draw();
      return;
    }

    const pager = target.closest<HTMLElement>('[data-intel-page]');
    if (pager) {
      query = { ...query, page: Number(pager.dataset['intelPage'] ?? '1') };
      draw();
    }
  });

  root.addEventListener('input', (event) => {
    const search = (event.target as HTMLElement).closest<HTMLInputElement>('[data-intel-search]');
    if (!search) return;
    // A new search invalidates the page number: page 4 of the old result set is
    // not a place in the new one.
    query = { ...query, search: search.value, page: 1 };
    restoreSearchFocus = true;
    draw();
  });

  root.addEventListener('change', (event) => {
    const target = event.target as HTMLElement;
    const sort = target.closest<HTMLSelectElement>('[data-intel-sort]');
    if (sort) {
      query = { ...query, sort: sort.value as Sort, page: 1 };
      draw();
      return;
    }
    const range = target.closest<HTMLSelectElement>('[data-intel-range]');
    if (range) {
      query = { ...query, range: range.value as Range, page: 1 };
      draw();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (!open || event.key !== 'Escape') return;
    if (why !== null) why = null;
    else open = false;
    draw();
  });

  draw();
}
