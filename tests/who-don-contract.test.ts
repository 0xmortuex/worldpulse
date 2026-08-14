import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fixture from './fixtures/who-don.json' with { type: 'json' };
import { buildDonQueryUrl, parse } from '../src/sources/who-don';

/**
 * Contract test for WHO Disease Outbreak News.
 *
 * Rule 4: shape and range, never current values. The newest outbreak changes by
 * the day and pinning one would fail for the wrong reason.
 *
 * The fixture is a real capture taken through `buildDonQueryUrl`. Unlike the
 * PortWatch fixture it is NOT reproducible by re-running: this query means "the
 * ten most recent", so a fresh capture returns different reports. That is
 * correct for a news source — the app asks for the latest — and the assertions
 * below are written to survive it, which is what rule 4 asks for anyway.
 */
const ctx = {
  requestUrl: buildDonQueryUrl({ count: 10 }),
  httpStatus: 200,
  fetchedAt: '2026-08-14T00:00:00Z',
  cache: 'miss' as const,
  fromFixture: true,
};
const rows = (fixture as { value: Array<Record<string, unknown>> }).value;

describe('WHO Disease Outbreak News — contract', () => {
  it('returned reports at all, so everything below measures something', () => {
    assert.ok(rows.length > 0, 'fixture has no reports');
  });

  it('every report carries the five fields the app requests, and no more', () => {
    /**
     * The upper bound is deliberate and is a LICENCE assertion as much as a
     * shape one. `$select` keeps WHO's full report text off the wire; if the
     * response starts carrying `Overview` or `Assessment` again, the select has
     * stopped working and we are pulling CC BY-NC-SA body text we do not render.
     */
    const expected = new Set(['Id', 'DonId', 'Title', 'PublicationDateAndTime', 'ItemDefaultUrl']);
    for (const row of rows) {
      for (const field of expected) {
        assert.ok(field in row, `missing ${field}`);
      }
      const extra = Object.keys(row).filter((key) => !expected.has(key));
      assert.deepEqual(extra, [], `$select stopped narrowing the response — unexpected fields: ${extra.join(', ')}`);
    }
  });

  it('publication dates parse and are ordered newest first', () => {
    // The ordering is asserted because the unordered default returned an
    // 18-month-stale page while today's report existed. A "latest outbreaks"
    // panel built on that would have been silently wrong.
    const times = rows.map((row) => Date.parse(String(row['PublicationDateAndTime'])));
    for (const [index, time] of times.entries()) {
      assert.ok(!Number.isNaN(time), `unparseable date at ${index}`);
    }
    const sorted = [...times].sort((a, b) => b - a);
    assert.deepEqual(times, sorted, 'reports are not newest-first');
  });

  it('titles are non-empty strings', () => {
    for (const row of rows) {
      assert.equal(typeof row['Title'], 'string');
      assert.ok(String(row['Title']).trim().length > 0, 'empty title');
    }
  });

  it('parses into facts carrying WHO wording, an as-of date and a link back', () => {
    const reports = parse(fixture, ctx);
    assert.equal(reports.length, rows.length);

    for (const report of reports) {
      assert.equal(report.title.tier, 'OFFICIAL');
      assert.equal(report.published.tier, 'OFFICIAL');
      assert.ok(report.title.provenance !== null, 'a fact without provenance renders as BROKEN');
      assert.match(report.title.asOf, /^\d{4}-\d{2}-\d{2}$/, 'as-of is not a plain date');
      // The licence requires a link back, so a report without one is a licence
      // problem before it is a rendering one.
      assert.match(report.url, /^https:\/\/www\.who\.int\/emergencies\/disease-outbreak-news\//);
    }
  });

  it('the title fact carries WHO text verbatim', () => {
    // No summarising, no rewriting, no truncation in the adapter. Rule: no
    // authored content — the headline is theirs or it is not rendered.
    const reports = parse(fixture, ctx);
    for (const [index, report] of reports.entries()) {
      assert.equal(report.title.value, rows[index]?.['Title']);
    }
  });

  it('exposes no country, because WHO publishes none', () => {
    /**
     * The planted expectation behind the adapter's refusal to parse countries
     * out of titles. If a `country` field ever appears here, someone has added
     * a regular expression over prose like "Hantavirus outbreak linked to cruise
     * ship travel, Multi-locations" and rendered its output as a fact.
     */
    const reports = parse(fixture, ctx);
    for (const report of reports) {
      assert.ok(!('country' in report), 'a country was attached to a report WHO did not attribute to one');
    }
  });

  it('builds an ordered, narrowed request', () => {
    const url = buildDonQueryUrl({ count: 10 });
    assert.match(url, /%24orderby=PublicationDateAndTime\+desc/);
    assert.match(url, /%24top=10/);
    assert.match(url, /%24select=/);
  });
});
