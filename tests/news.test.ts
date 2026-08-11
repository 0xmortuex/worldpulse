import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, it } from 'node:test';
import { parse as parseArticles } from '../src/sources/gdelt';
import {
  groupSyndicated,
  isRtl,
  needsMeasuredWidth,
  normaliseTitle,
  parseToneTimeline,
  SPARSE_ARTICLE_THRESHOLD,
} from '../src/sources/gdelt-tone';
import { renderToneChart } from '../src/news/tone-chart';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(resolvePath(import.meta.dirname, 'fixtures/news', `${name}.json`), 'utf8'));
}

describe('hard case — non-Latin scripts and RTL', () => {
  it('parses headlines and outlet names in every script without loss', () => {
    const list = parseArticles(fixture('articles-multiscript'));
    assert.equal(list.articles.length, 6);
    assert.equal(list.unusable.length, 0);
    // Outlet names are themselves non-Latin here, which is the case a
    // Latin-only assumption quietly breaks.
    assert.ok(list.articles.some((article) => /[؀-ۿ]/.test(article.domain)));
    assert.ok(list.articles.some((article) => /[一-鿿]/.test(article.domain)));
  });

  it('detects RTL from the text, not the source country', () => {
    // GDELT indexes coverage of every country; a Hebrew headline can appear
    // under any of them, so direction has to come from the string.
    assert.equal(isRtl('הכנסת אישרה את התקציב'), true);
    assert.equal(isRtl('الحكومة تعلن'), true);
    assert.equal(isRtl('مجلس بودجه'), true);
    assert.equal(isRtl('国务院公布'), false);
    assert.equal(isRtl('Ordinary headline'), false);
  });

  it('flags scripts where a character budget is the wrong measure', () => {
    // CJK glyphs are roughly double-width; Arabic and Devanagari shape and
    // combine. String.length is a poor proxy for rendered width in all of them.
    assert.equal(needsMeasuredWidth('国务院公布新一轮经济改革措施'), true);
    assert.equal(needsMeasuredWidth('संसद ने बजट को मंजूरी दी'), true);
    assert.equal(needsMeasuredWidth('الحكومة تعلن'), true);
    assert.equal(needsMeasuredWidth('Ordinary Latin headline'), false);
  });

  it('groups by normalised title without merging different scripts', () => {
    const list = parseArticles(fixture('articles-multiscript'));
    const groups = groupSyndicated(list.articles);
    assert.equal(groups.length, 6, 'six distinct headlines must not collapse into fewer');
  });
});

describe('hard case — sparse coverage', () => {
  it('is sparse by the shared threshold', () => {
    const list = parseArticles(fixture('articles-sparse'));
    assert.ok(list.articles.length < SPARSE_ARTICLE_THRESHOLD);
  });

  it('still parses every row it has', () => {
    const list = parseArticles(fixture('articles-sparse'));
    assert.equal(list.articles.length, 2);
    assert.equal(list.unusable.length, 0);
  });
});

describe('hard case — degraded rows', () => {
  it('excludes unusable rows and states why, rather than throwing', () => {
    // One malformed row must not blank an entire country's news.
    const list = parseArticles(fixture('articles-degraded'));
    assert.equal(list.articles.length, 1);
    assert.equal(list.unusable.length, 4);
    const reasons = list.unusable.map((entry) => entry.reason).sort();
    assert.deepEqual(reasons, [
      'no headline',
      'no outlet recorded',
      'no usable timestamp',
      'no usable web link',
    ]);
  });

  it('rejects a non-web link rather than rendering an unopenable headline', () => {
    const list = parseArticles(fixture('articles-degraded'));
    assert.ok(list.articles.every((article) => article.url.startsWith('https://')));
  });
});

describe('hard case — syndicated coverage', () => {
  it('groups copies of one story and counts the outlets', () => {
    const list = parseArticles(fixture('articles-syndicated'));
    const groups = groupSyndicated(list.articles);
    const syndicated = groups.find((group) => group.outletCount > 1);
    assert.ok(syndicated);
    assert.equal(syndicated.outletCount, 12);
    assert.equal(syndicated.duplicates.length, 11);
  });

  it('does not merge genuinely different stories', () => {
    const groups = groupSyndicated(parseArticles(fixture('articles-syndicated')).articles);
    assert.ok(groups.some((group) => group.lead.title.includes('harbour redevelopment')));
    assert.equal(groups.length, 3, 'twelve syndicated + one unique + one punctuation-only');
  });

  it('leaves a headline that normalises to nothing ungrouped', () => {
    // "!!! ???" normalises to an empty string. Grouping on that would collapse
    // every such headline into one row.
    const groups = groupSyndicated(parseArticles(fixture('articles-syndicated')).articles);
    const punctuation = groups.filter((group) => normaliseTitle(group.lead.title) === '');
    assert.equal(punctuation.length, 1);
    assert.equal(punctuation[0]?.outletCount, 1);
  });

  it('normalises case and punctuation but nothing cleverer', () => {
    assert.equal(normaliseTitle('Bank Raises Rate!'), normaliseTitle('bank raises rate'));
    // Conservative on purpose: a wrongly merged pair is invisible to the reader
    // in a way a duplicate row is not.
    assert.notEqual(normaliseTitle('bank raises rates'), normaliseTitle('bank raises rate'));
  });
});

describe('hard case — tone timeline gaps', () => {
  it('keeps a day with no coverage as null, never zero', () => {
    const timeline = parseToneTimeline(fixture('tone-sparse'));
    assert.equal(timeline.missingDays, 8);
    const missing = timeline.points.filter((point) => point.value === null);
    assert.equal(missing.length, 8);
    assert.ok(missing.every((point) => point.value !== 0));
  });

  it('breaks the line across missing days', () => {
    const svg = renderToneChart(parseToneTimeline(fixture('tone-sparse')), { width: 320, height: 92 });
    assert.equal((svg.match(/<polyline/g) ?? []).length, 2, 'a bridged gap would draw one line');
    assert.match(svg, /chart-gap/);
    assert.match(svg, /Not interpolated/);
  });

  it('draws one continuous line when no days are missing', () => {
    const svg = renderToneChart(parseToneTimeline(fixture('tone-normal')), { width: 320, height: 92 });
    assert.equal((svg.match(/<polyline/g) ?? []).length, 1);
  });

  it('plots nothing at all when no coverage was indexed', () => {
    // A quiet window has no tone. A line at zero would report neutral coverage,
    // which is a claim about coverage that does not exist.
    const timeline = parseToneTimeline(fixture('tone-empty'));
    assert.equal(timeline.observedDays, 0);
    const svg = renderToneChart(timeline, { width: 320, height: 92 });
    assert.match(svg, /chart--empty/);
    assert.doesNotMatch(svg, /<polyline/);
    assert.match(svg, /would report neutral sentiment/);
  });
});

describe('tone is labelled as a measure of coverage, on the chart', () => {
  it('states the caveat in the visible caption, not a footnote', () => {
    const svg = renderToneChart(parseToneTimeline(fixture('tone-normal')), { width: 320, height: 92 });
    assert.match(svg, /Tone of coverage, not conditions/);
    assert.match(svg, /badge--derived/);
  });

  it('states the same caveat in the accessible label', () => {
    const svg = renderToneChart(parseToneTimeline(fixture('tone-normal')), { width: 320, height: 92 });
    const label = /aria-label="([^"]*)"/.exec(svg)?.[1] ?? '';
    assert.match(label, /Machine sentiment estimate/);
    assert.match(label, /Not a measure of conditions in this country/);
  });
});
