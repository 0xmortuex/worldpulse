import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  BAND_FLOOR,
  DEFAULT_QUERY,
  FUTURE_TOLERANCE_MS,
  PAGE_SIZE,
  SEVERITY_CAVEAT,
  allItems,
  measurementsFor,
  parseSeenDate,
  queryFeed,
  relativeTime,
  renderIntelFeed,
  severityOf,
  type IntelItem,
} from '../src/ui/intel';
import { DEFAULT_SIGNIFICANCE_WEIGHTS, significanceOf } from '../src/news/significance';

const NOW = Date.UTC(2026, 7, 16, 12, 0, 0);

function item(over: Partial<IntelItem> = {}): IntelItem {
  return {
    id: 'x',
    title: 'A headline',
    url: 'https://example.test/a',
    outlet: 'example.test',
    country: 'United States',
    image: null,
    seendate: '20260816T110000Z',
    publishedMs: Date.UTC(2026, 7, 16, 11, 0, 0),
    ...over,
  };
}

test('GDELT stamps parse, and unreadable ones are null rather than guessed', () => {
  assert.equal(parseSeenDate('20260810T143000Z'), Date.UTC(2026, 7, 10, 14, 30, 0));
  assert.equal(parseSeenDate('2026-08-10T14:30:00Z'), Date.UTC(2026, 7, 10, 14, 30, 0));
  assert.equal(parseSeenDate('not a date'), null);
  assert.equal(parseSeenDate(''), null);
});

test('a future timestamp renders as unavailable, never as "in 2 hours"', () => {
  const future = NOW + 2 * 3_600_000;
  const shown = relativeTime(future, NOW);
  assert.equal(shown.kind, 'unavailable');
  assert.equal(shown.text, 'publication time unavailable');
  assert.ok(!/in \d/.test(shown.text), 'must never phrase a future stamp as a countdown');
});

test('clock skew inside the tolerance is still rendered as a time', () => {
  const barelyAhead = NOW + FUTURE_TOLERANCE_MS - 1;
  assert.equal(relativeTime(barelyAhead, NOW).kind, 'ago');

  // And one millisecond past it is not.
  assert.equal(relativeTime(NOW + FUTURE_TOLERANCE_MS + 1, NOW).kind, 'unavailable');
});

test('an unparseable stamp is unavailable, not epoch zero', () => {
  const shown = relativeTime(null, NOW);
  assert.equal(shown.kind, 'unavailable');
  assert.ok(!/\d+ d ago/.test(shown.text));
});

test('relative times step through the units', () => {
  assert.equal(relativeTime(NOW - 30_000, NOW).text, 'just now');
  assert.equal(relativeTime(NOW - 5 * 60_000, NOW).text, '5 min ago');
  assert.equal(relativeTime(NOW - 3 * 3_600_000, NOW).text, '3 h ago');
  assert.equal(relativeTime(NOW - 4 * 86_400_000, NOW).text, '4 d ago');
});

/**
 * THE BAND IS A SHARE OF WHAT ANSWERED.
 *
 * This is the assertion the design exists for. Two stories with identical
 * measured inputs, differing only in whether event linkage was consulted, must
 * land in the same band — because the app's failure to look is not evidence
 * about the story.
 */
test('an unconsulted input lowers confidence, never the band', () => {
  const measured = {
    outlets: 9,
    articles: 24,
    days: 9,
    countries: 5,
    linkedToTrackedEvent: null,
  };
  const consulted = { ...measured, linkedToTrackedEvent: true };

  const unlooked = severityOf(measured);
  const looked = severityOf(consulted);

  assert.equal(unlooked.band, looked.band, 'the band must not move because we did not look');
  assert.deepEqual(unlooked.unconsulted, ['eventLinkage']);
  assert.deepEqual(looked.unconsulted, []);
  assert.ok(unlooked.achievable < looked.achievable, 'the achievable total shrinks instead');
});

/**
 * PLANTED CASE (rule 27): band on an ABSOLUTE score and this fails.
 *
 * Recomputes the boundary the naive way — score against the fixed maximum over
 * all five inputs — and shows the unconsulted story falling out of the band the
 * fraction-based rule keeps it in. Without this, the correctness above could be
 * satisfied by any two rules that happen to agree on the fixtures.
 */
test('planted: a fixed-denominator band would demote the unlooked story', () => {
  const measured = {
    outlets: 9,
    articles: 24,
    days: 9,
    countries: 5,
    linkedToTrackedEvent: null,
  };

  const fixedMax = Object.values(DEFAULT_SIGNIFICANCE_WEIGHTS).reduce((a, b) => a + b, 0);
  const score = significanceOf(measured).score;

  const naiveFraction = score / fixedMax;
  const honestFraction = severityOf(measured).fraction;

  assert.ok(honestFraction !== null);
  assert.ok(naiveFraction < honestFraction, 'the naive denominator is larger, so the share is smaller');
  assert.ok(
    naiveFraction < BAND_FLOOR.high && honestFraction >= BAND_FLOOR.high,
    'and that difference is what moves it across a band boundary',
  );
});

test('nothing consulted is not "routine" as a finding', () => {
  const severity = severityOf({
    outlets: 0,
    articles: 0,
    days: 0,
    countries: 0,
    linkedToTrackedEvent: null,
  });
  // Every other input answers with zero, so this is a real measurement of zero.
  assert.equal(severity.band, 'routine');
  assert.equal(severity.fraction, 0);
});

test('the corpus loads and every item keeps its raw stamp', () => {
  const items = allItems();
  assert.ok(items.length > 10, `expected a corpus, got ${items.length}`);
  for (const entry of items) {
    assert.equal(typeof entry.seendate, 'string');
    assert.ok(entry.outlet.length > 0);
  }
});

test('search matches headline, outlet and country', () => {
  const corpus = [
    item({ id: 'a', title: 'Budget passes', outlet: 'alpha.test', country: 'France' }),
    item({ id: 'b', title: 'Storm warning', outlet: 'beta.test', country: 'Japan' }),
  ];
  const byTitle = queryFeed({ ...DEFAULT_QUERY, search: 'storm' }, NOW, corpus);
  assert.deepEqual(byTitle.items.map((i) => i.id), ['b']);

  const byOutlet = queryFeed({ ...DEFAULT_QUERY, search: 'alpha' }, NOW, corpus);
  assert.deepEqual(byOutlet.items.map((i) => i.id), ['a']);

  const byCountry = queryFeed({ ...DEFAULT_QUERY, search: 'japan' }, NOW, corpus);
  assert.deepEqual(byCountry.items.map((i) => i.id), ['b']);
});

test('the range filter counts what it excluded for being undatable', () => {
  const corpus = [
    item({ id: 'recent', publishedMs: NOW - 3_600_000 }),
    item({ id: 'old', publishedMs: NOW - 40 * 86_400_000 }),
    item({ id: 'undatable', publishedMs: null, seendate: 'garbage' }),
  ];

  const day = queryFeed({ ...DEFAULT_QUERY, range: '24h' }, NOW, corpus);
  assert.deepEqual(day.items.map((i) => i.id), ['recent']);
  assert.equal(day.undatable, 1, 'the undatable item is counted, not silently dropped');

  // "All time" excludes nothing, so nothing is counted as excluded.
  const all = queryFeed({ ...DEFAULT_QUERY, range: 'all' }, NOW, corpus);
  assert.equal(all.total, 3);
  assert.equal(all.undatable, 0);
});

test('undatable items sort last in BOTH directions', () => {
  const corpus = [
    item({ id: 'undatable', publishedMs: null }),
    item({ id: 'older', publishedMs: NOW - 10 * 86_400_000 }),
    item({ id: 'newer', publishedMs: NOW - 1 * 86_400_000 }),
  ];

  const recent = queryFeed({ ...DEFAULT_QUERY, sort: 'recent' }, NOW, corpus);
  assert.deepEqual(recent.items.map((i) => i.id), ['newer', 'older', 'undatable']);

  const oldest = queryFeed({ ...DEFAULT_QUERY, sort: 'oldest' }, NOW, corpus);
  assert.deepEqual(oldest.items.map((i) => i.id), ['older', 'newer', 'undatable']);
});

test('pagination states a real total and clamps out-of-range pages', () => {
  const corpus = Array.from({ length: PAGE_SIZE * 2 + 3 }, (_, index) =>
    item({ id: `i${index}`, publishedMs: NOW - index * 60_000 }),
  );

  const first = queryFeed({ ...DEFAULT_QUERY, page: 1 }, NOW, corpus);
  assert.equal(first.items.length, PAGE_SIZE);
  assert.equal(first.total, corpus.length);
  assert.equal(first.pages, 3);

  const beyond = queryFeed({ ...DEFAULT_QUERY, page: 99 }, NOW, corpus);
  assert.equal(beyond.page, 3, 'a page past the end clamps rather than emptying the feed');
  assert.equal(beyond.items.length, 3);

  const before = queryFeed({ ...DEFAULT_QUERY, page: -4 }, NOW, corpus);
  assert.equal(before.page, 1);
});

test('syndicated copies raise outlet breadth for the same headline', () => {
  const corpus = [
    item({ id: 'a', title: 'Same story', outlet: 'one.test', country: 'France' }),
    item({ id: 'b', title: 'Same story!', outlet: 'two.test', country: 'Japan' }),
    item({ id: 'c', title: 'Different story', outlet: 'three.test' }),
  ];

  const measured = measurementsFor(corpus[0]!, corpus);
  assert.equal(measured.outlets, 2, 'punctuation must not split one story into two');
  assert.equal(measured.articles, 2);
  assert.equal(measured.countries, 2);
  assert.equal(measured.linkedToTrackedEvent, null, 'no event index is wired, so it did not look');
});

test('the rendered feed states its caveats and its totals', () => {
  const html = renderIntelFeed(DEFAULT_QUERY, NOW);
  assert.ok(html.includes('not editorial importance'), 'the severity caveat must render');
  assert.ok(SEVERITY_CAVEAT.includes('COVERAGE VOLUME'));
  assert.ok(/Page 1 of \d+ · \d+ items/.test(html), 'pagination states the total');
  assert.ok(html.includes('intel-count--high'), 'per-band counters render');
});

test('an empty result blames the filters, not the world', () => {
  const html = renderIntelFeed({ ...DEFAULT_QUERY, search: 'zzzzz-no-such-headline' }, NOW);
  assert.ok(html.includes('intel-empty'));
  assert.ok(html.includes('not about the world'));
});
