import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { ShapeError } from '../src/sources/adapter';
import { groupIntoStories, parseFeed } from '../src/sources/rss';

/**
 * The curated RSS fallback — item 7's blocking dependency.
 *
 * GDELT failed six of six attempts and is recorded UNREACHABLE, so the spec
 * fixes the order: feeds first, then the board wires to them. The fixture is a
 * REAL capture from NPR, not a hand-written sample, because the parser's whole
 * risk is real-world XML rather than the shape one would invent.
 */

const NPR = readFileSync(resolve(import.meta.dirname, 'fixtures/news/rss-npr.xml'), 'utf8');

describe('the RSS parser, against a real captured feed', () => {
  it('the fixture is a real feed with real items, or this file proves nothing', () => {
    // The seventh guard this session to assert its own denominator.
    assert.ok(NPR.length > 5000, `fixture is only ${NPR.length} bytes`);
    assert.match(NPR, /<rss|<feed/i);
  });

  it('parses items with titles and links', () => {
    const items = parseFeed(NPR, 'rss-npr');
    assert.ok(items.length > 0, 'no items parsed from a feed that has them');
    for (const item of items) {
      assert.ok(item.title.trim().length > 0, 'an item parsed with an empty title');
    }
  });

  it('decodes entities and CDATA rather than shipping them to the DOM', () => {
    const items = parseFeed(NPR, 'rss-npr');
    const joined = items.map((item) => item.title).join(' ');
    assert.doesNotMatch(joined, /&amp;|&lt;|CDATA/, 'raw markup survived into a headline');
  });

  it('an unparseable date is null, never "now"', () => {
    /**
     * Defaulting to now would make every malformed item look freshly
     * published, and that value feeds straight into the coverage-duration
     * input of the significance score — a wrong date becomes a wrong rank.
     */
    const items = parseFeed(
      '<rss><channel><item><title>T</title><pubDate>not a date</pubDate></item></channel></rss>',
      'rss-test',
    );
    assert.equal(items[0]?.published, null);
  });

  it('a body that is not a feed is a SHAPE failure, not an empty feed', () => {
    /**
     * An HTML error page is the common case. Treating it as "this outlet
     * published nothing today" would quietly reduce every story's measured
     * breadth — the same under-count the parser tolerates elsewhere, but from a
     * cause the caller should be told about.
     */
    assert.throws(() => parseFeed('<html><body>502 Bad Gateway</body></html>', 'rss-test'), ShapeError);
    assert.throws(() => parseFeed(42, 'rss-test'), ShapeError);
  });

  it('a feed with no items parses to empty rather than throwing', () => {
    // An outlet that published nothing is a real state, distinct from a broken
    // body — and the parser must keep them apart in both directions.
    assert.deepEqual(parseFeed('<rss><channel></channel></rss>', 'rss-test'), []);
  });
});

describe('grouping items into stories', () => {
  it('the same headline from two outlets is one story with two outlets', () => {
    const grouped = groupIntoStories(
      new Map([
        ['rss-npr', [{ title: 'Summit ends', link: 'a', published: '2026-08-16T00:00:00.000Z' }]],
        ['rss-bbc', [{ title: 'Summit ends', link: 'b', published: '2026-08-15T00:00:00.000Z' }]],
      ]),
    );
    assert.equal(grouped.length, 1);
    assert.deepEqual(grouped[0]?.outlets, ['rss-bbc', 'rss-npr']);
    assert.equal(grouped[0]?.articles, 2);
    assert.equal(grouped[0]?.earliest, '2026-08-15T00:00:00.000Z', 'the earliest publication was not kept');
  });

  it('UNDER-COUNTS breadth rather than over-counting it, by design', () => {
    /**
     * Grouping is normalised title equality, which is crude: two outlets
     * running one story under different headlines count as two stories. That
     * bounds the outlet-breadth input DOWNWARD, and the direction is the point
     * — the score claims less than the world, never more, which is the same
     * direction as the curated-corpus ceiling it already discloses.
     */
    const grouped = groupIntoStories(
      new Map([
        ['rss-npr', [{ title: 'Summit ends without agreement', link: 'a', published: null }]],
        ['rss-bbc', [{ title: 'Talks collapse at summit', link: 'b', published: null }]],
      ]),
    );
    assert.equal(grouped.length, 2, 'differently-headlined coverage merged — breadth is now over-counted');
  });

  it('punctuation and case do not split a story', () => {
    const grouped = groupIntoStories(
      new Map([
        ['rss-npr', [{ title: 'Summit Ends.', link: 'a', published: null }]],
        ['rss-bbc', [{ title: 'summit ends', link: 'b', published: null }]],
      ]),
    );
    assert.equal(grouped.length, 1);
  });

  it('the real feed groups into as many stories as it has distinct headlines', () => {
    const items = parseFeed(NPR, 'rss-npr');
    const grouped = groupIntoStories(new Map([['rss-npr', items]]));
    assert.equal(grouped.length, new Set(items.map((i) => i.title.toLowerCase())).size);
    for (const story of grouped) assert.deepEqual(story.outlets, ['rss-npr']);
  });
});
