import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSummary } from '../src/sources/wikipedia';

/**
 * Shapes captured from the live API, not imagined. See
 * docs/SOURCE-CONTRADICTIONS.md for the measurements these encode.
 */
const standard = {
  type: 'standard',
  title: 'Emmanuel Macron',
  titles: { normalized: 'Emmanuel Macron' },
  extract: 'French politician who has served as President of France since 2017.',
  content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Emmanuel_Macron' } },
  thumbnail: { source: 'https://upload.wikimedia.org/thumb.jpg' },
};

const disambiguation = {
  type: 'disambiguation',
  title: 'Mercury',
  titles: { normalized: 'Mercury' },
  extract: 'Mercury usually refers to Mercury (planet), Mercury (element), Mercury (mythology).',
  content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Mercury' } },
};

describe('Wikipedia summary refuses anything that is not an article', () => {
  it('renders an ordinary article', () => {
    const result = parseSummary(standard, 'Emmanuel Macron', 200);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.summary.resolvedTitle, 'Emmanuel Macron');
    assert.equal(result.summary.redirected, false);
    assert.ok(result.summary.thumbnailUrl);
  });

  /**
   * The defect this module exists for. A disambiguation page is HTTP 200 with a
   * plausible extract, so without a type check it renders as a biography — a
   * wrong value, which rule 7 ranks above a missing one.
   */
  it('refuses a disambiguation page rather than rendering it as a biography', () => {
    const result = parseSummary(disambiguation, 'Mercury', 200);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.refusal.kind, 'ambiguous');
    assert.match(result.refusal.reason, /disambiguation/i);
  });

  it('refuses an unknown page type rather than guessing it is renderable', () => {
    const result = parseSummary({ ...standard, type: 'no-extract' }, 'Something', 200);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.refusal.kind, 'not-a-summary');
  });

  it('reports a 404 as no-article without reading the error body', () => {
    // The live 404 body is {status, type} — no title, no extract. A parser
    // reading fields off it gets undefined; this keys on the status code.
    const result = parseSummary({ status: 404, type: 'Internal error' }, 'Zzzz Not Real', 404);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.refusal.kind, 'no-article');
  });

  it('records the resolved title when a redirect changed it', () => {
    const redirected = { ...standard, titles: { normalized: 'Fumio Kishida' }, title: 'Fumio Kishida' };
    const result = parseSummary(redirected, '岸田文雄', 200);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.summary.resolvedTitle, 'Fumio Kishida');
    assert.equal(result.summary.requestedTitle, '岸田文雄');
    assert.equal(result.summary.redirected, true, 'a redirect must be visible in provenance');
  });

  it('does not call an underscore-for-space normalisation a redirect', () => {
    const result = parseSummary(standard, 'Emmanuel_Macron', 200);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.summary.redirected, false);
  });

  it('treats a missing thumbnail as absent rather than throwing', () => {
    const { thumbnail: _drop, ...noThumb } = standard;
    const result = parseSummary(noThumb, 'Emmanuel Macron', 200);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.summary.thumbnailUrl, null);
  });
});
