import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { liveOrInconclusive } from './fixtures/index';
import { parseSummary } from '../src/sources/wikipedia';
import { ShapeError } from '../src/sources/adapter';
import * as worldbank from '../src/sources/worldbank';
import * as wikidata from '../src/sources/wikidata';
import * as usgs from '../src/sources/usgs';
import * as gdelt from '../src/sources/gdelt';
import { factState } from '../src/facts/types';

/**
 * Contract tests. These assert SHAPE and SANITY RANGES, never current values —
 * a test pinned to a live figure fails every time the world changes, which
 * trains people to ignore it.
 *
 * Identical assertions run against fixtures (default) and against live sources
 * (PROBE_LIVE=1). Only the input is swapped.
 */

describe('World Bank indicator contract', () => {
  it('parses the two-element envelope into a series', async () => {
    const sample = await liveOrInconclusive('worldbank');
    if (!sample) return;
    const { body, ctx } = sample;
    const series = worldbank.parse(body);

    assert.match(series.indicatorId, /^[A-Z]{2}\.[A-Z0-9.]+$/);
    assert.ok(series.indicatorName.length > 0);
    assert.match(series.countryIso3, /^[A-Z]{3}$/);
    assert.ok(series.observations.length > 0);

    for (const observation of series.observations) {
      assert.ok(Number.isInteger(observation.year));
      assert.ok(observation.year >= 1960 && observation.year <= new Date().getFullYear() + 1);
      assert.ok(observation.value === null || Number.isFinite(observation.value));
    }

    const fact = worldbank.latestFact(series, ctx, { unit: 'USD' });
    assert.equal(factState(fact), 'ok');
    assert.equal(fact.tier, 'OFFICIAL');
    assert.ok(fact.provenance);
    assert.equal(fact.provenance?.kind, 'fetch');
  });

  it('skips the published-but-empty current year rather than reporting no data', async () => {
    const sample = await liveOrInconclusive('worldbank');
    if (!sample) return;
    const { body, ctx } = sample;
    const series = worldbank.parse(body);
    const fact = worldbank.latestFact(series, ctx);

    assert.notEqual(fact.value, null);
    // The fixture's first row is deliberately null-valued, as the API returns.
    if (series.observations[0]?.value === null) {
      assert.ok(fact.note?.includes('not yet populated'));
    }
  });

  it('rejects the one-element error envelope instead of guessing', () => {
    assert.throws(() => worldbank.parse([{ message: [{ id: '120', value: 'bad indicator' }] }]), ShapeError);
  });

  it('rejects a value that is neither number nor null', () => {
    assert.throws(
      () =>
        worldbank.parse([
          { lastupdated: '2025-07-01' },
          [{ indicator: { id: 'X.Y', value: 'x' }, country: { value: 'c' }, countryiso3code: 'USA', date: '2024', value: 'oops' }],
        ]),
      ShapeError,
    );
  });
});

describe('USGS earthquake feed contract', () => {
  it('parses features and range-checks coordinates and magnitude', async () => {
    const sample = await liveOrInconclusive('usgs-quakes');
    if (!sample) return;
    const { body, ctx } = sample;
    const feed = usgs.parse(body);

    assert.ok(feed.quakes.length > 0);
    assert.ok(Date.parse(feed.generated) > 0);

    for (const quake of feed.quakes) {
      assert.ok(quake.id.length > 0);
      assert.ok(quake.latitude >= -90 && quake.latitude <= 90);
      assert.ok(quake.longitude >= -180 && quake.longitude <= 180);
      assert.ok(quake.depthKm >= -10 && quake.depthKm <= 1000);
      assert.ok(Date.parse(quake.time) > 0);
      if (!Number.isNaN(quake.magnitude)) {
        assert.ok(quake.magnitude >= -2 && quake.magnitude <= 10.5);
      }
    }

    const first = feed.quakes[0];
    assert.ok(first);
    const fact = usgs.magnitudeFact(first, feed, ctx);
    assert.equal(factState(fact), 'ok');
  });

  it('downgrades an unreviewed solution to ESTIMATE', async () => {
    const sample = await liveOrInconclusive('usgs-quakes');
    if (!sample) return;
    const { body, ctx } = sample;
    const feed = usgs.parse(body);
    const automatic = feed.quakes.find((quake) => quake.status !== 'reviewed');
    if (!automatic) return; // a live feed may legitimately contain only reviewed events
    const fact = usgs.magnitudeFact(automatic, feed, ctx);
    assert.equal(fact.tier, 'ESTIMATE');
    assert.ok(fact.note?.includes('not yet reviewed'));
  });

  it('rejects an out-of-range latitude rather than plotting it', () => {
    assert.throws(
      () =>
        usgs.parse({
          type: 'FeatureCollection',
          metadata: { generated: 1, title: 't', count: 1 },
          features: [
            {
              id: 'x',
              properties: { mag: 1, time: 1, status: 'reviewed', url: 'u', magType: 'ml', place: 'p', tsunami: 0 },
              geometry: { type: 'Point', coordinates: [0, 991, 0] },
            },
          ],
        }),
      ShapeError,
    );
  });

  it('rejects a non-FeatureCollection root', () => {
    assert.throws(() => usgs.parse({ type: 'Feature', metadata: {}, features: [] }), ShapeError);
  });
});

describe('Wikidata SPARQL contract', () => {
  it('flattens bindings to plain rows', async () => {
    const sample = await liveOrInconclusive('wikidata-sparql');
    if (!sample) return;
    const { body, ctx } = sample;
    const result = wikidata.parse(body);

    assert.ok(result.vars.length > 0);
    for (const row of result.rows) {
      for (const key of Object.keys(row)) {
        assert.ok(result.vars.includes(key), `row key "${key}" is not declared in head.vars`);
        assert.equal(typeof row[key], 'string');
      }
    }

    const variable = result.vars[0];
    assert.ok(variable);
    const fact = wikidata.singleValueFact(result, variable, ctx, { asOf: '2026' });
    assert.ok(fact.provenance);
  });

  it('returns no data for an empty result set instead of throwing', async () => {
    const sample = await liveOrInconclusive('wikidata-sparql');
    if (!sample) return;
    const { ctx } = sample;
    const empty = wikidata.parse({ head: { vars: ['x'] }, results: { bindings: [] } });
    const fact = wikidata.singleValueFact(empty, 'x', ctx, { asOf: '2026' });
    assert.equal(factState(fact), 'nodata');
    assert.equal(fact.value, null);
  });

  it('throws when the requested variable is not in the query', async () => {
    const sample = await liveOrInconclusive('wikidata-sparql');
    if (!sample) return;
    const { body, ctx } = sample;
    const result = wikidata.parse(body);
    assert.throws(() => wikidata.singleValueFact(result, 'nosuchvar', ctx, { asOf: '2026' }), ShapeError);
  });
});

describe('GDELT DOC contract', () => {
  it('parses articles and normalises the compact timestamp', async () => {
    const sample = await liveOrInconclusive('gdelt-doc');
    if (!sample) return;
    const { body, ctx } = sample;
    const list = gdelt.parse(body);

    for (const article of list.articles) {
      assert.match(article.url, /^https?:\/\//);
      assert.ok(article.title.length > 0);
      assert.ok(article.domain.length > 0);
      assert.ok(Date.parse(article.seenAt) > 0);
    }

    const fact = gdelt.articleCountFact(list, ctx, 'last 24h');
    // Never OFFICIAL: a count of indexed coverage is not a count of events.
    assert.equal(fact.tier, 'DERIVED');
  });

  it('treats a missing articles key as an empty result, not a broken response', () => {
    assert.deepEqual(gdelt.parse({}).articles, []);
  });

  it('rejects a malformed timestamp', () => {
    assert.throws(() => gdelt.parseSeenDate('2026-08-10T14:30:00Z'), ShapeError);
    assert.throws(() => gdelt.parseSeenDate('20260899T143000Z'), ShapeError);
  });
});

/**
 * EONET, Wikipedia REST and Commons.
 *
 * These three backed shipped panels — step 7's event layers, step 3 and 4's bios,
 * step 3's portrait credit — with no fixture, no contract test and no recorded
 * shape at all. The assertions below encode what live actually returns, measured
 * before they were written (docs/SOURCE-CONTRADICTIONS.md), not what the code
 * assumed.
 */
describe('NASA EONET contract', () => {
  it('parses events and carries the shapes the layer path depends on', async () => {
    const sample = await liveOrInconclusive('nasa-eonet');
    if (!sample) return;
    const body = sample.body as { events?: Array<Record<string, unknown>> };

    assert.ok(Array.isArray(body.events), 'events is not an array');
    assert.ok((body.events?.length ?? 0) > 0, 'no events returned');

    for (const event of body.events ?? []) {
      assert.equal(typeof event['id'], 'string');
      assert.equal(typeof event['title'], 'string');
      const geometry = event['geometry'] as Array<Record<string, unknown>>;
      assert.ok(Array.isArray(geometry) && geometry.length > 0, 'event has no geometry');

      for (const shape of geometry) {
        const type = shape['type'];
        assert.ok(type === 'Point' || type === 'Polygon', `unexpected geometry type ${String(type)}`);
        assert.equal(typeof shape['date'], 'string');
      }

      const categories = event['categories'] as Array<Record<string, unknown>>;
      assert.ok(Array.isArray(categories) && categories.length > 0, 'event has no categories');
      // The parser derives the layer id from `title`, NOT `id`. Asserted because
      // reading the other field would silently mis-map every category, and the
      // two differ: id "severeStorms" versus title "Severe Storms".
      assert.equal(typeof categories[0]?.['title'], 'string');
    }
  });

  /**
   * Decision L8 originally asserted EONET publishes no magnitude. It does. This
   * asserts the fields exist and that a value never arrives without its unit —
   * rule 22, at the source boundary.
   */
  it('publishes magnitudeValue with magnitudeUnit, or neither', async () => {
    const sample = await liveOrInconclusive('nasa-eonet');
    if (!sample) return;
    const body = sample.body as { events?: Array<Record<string, unknown>> };

    let measured = 0;
    for (const event of body.events ?? []) {
      for (const shape of (event['geometry'] as Array<Record<string, unknown>>) ?? []) {
        const value = shape['magnitudeValue'];
        const unit = shape['magnitudeUnit'];
        if (value === null || value === undefined) continue;
        assert.equal(typeof value, 'number', 'magnitudeValue is present but not a number');
        assert.equal(typeof unit, 'string', 'magnitudeValue present without magnitudeUnit — a number with no unit');
        measured += 1;
      }
    }
    // Positive control (rule 10): an absence-tolerant loop must prove it saw the
    // thing it tolerates, or "no violations" and "no data" are the same result.
    assert.ok(measured > 0, 'no magnitude-bearing geometry in the sample — the check examined nothing');
  });

  it('closed is either null or a date string, never absent', async () => {
    const sample = await liveOrInconclusive('nasa-eonet');
    if (!sample) return;
    const body = sample.body as { events?: Array<Record<string, unknown>> };
    for (const event of body.events ?? []) {
      const closed = event['closed'];
      assert.ok(closed === null || typeof closed === 'string', `closed is ${typeof closed}`);
    }
  });
});

describe('Wikipedia REST summary contract', () => {
  it('parses a standard article into a renderable summary', async () => {
    const sample = await liveOrInconclusive('wikipedia-rest');
    if (!sample) return;
    const result = parseSummary(sample.body, 'Emmanuel_Macron', sample.ctx.httpStatus);
    assert.equal(result.ok, true, 'a known-good article did not parse');
    if (!result.ok) return;
    assert.ok(result.summary.extract.length > 0);
    assert.match(result.summary.url, /^https:\/\/en\.wikipedia\.org\/wiki\//);
    assert.equal(result.summary.resolvedTitle.length > 0, true);
  });

  it('carries titles.normalized, which provenance records instead of the requested title', async () => {
    const sample = await liveOrInconclusive('wikipedia-rest');
    if (!sample) return;
    const body = sample.body as { titles?: Record<string, unknown>; type?: unknown };
    assert.equal(typeof body.titles?.['normalized'], 'string', 'titles.normalized is missing');
    assert.equal(body.type, 'standard');
  });
});

describe('Wikimedia Commons imageinfo contract', () => {
  it('returns the licence and credit fields the portrait credit renders', async () => {
    const sample = await liveOrInconclusive('wikimedia-commons');
    if (!sample) return;
    const body = sample.body as { query?: { pages?: Record<string, Record<string, unknown>> } };
    const pages = body.query?.pages;
    assert.ok(pages && Object.keys(pages).length > 0, 'no pages in the response');

    const page = Object.values(pages ?? {})[0] as Record<string, unknown>;
    assert.equal('missing' in page, false, 'the reference file has gone missing from Commons');
    const info = (page['imageinfo'] as Array<Record<string, unknown>>)[0];
    assert.ok(info, 'no imageinfo on a file that exists');
    assert.equal(typeof info['url'], 'string');

    const extmetadata = info['extmetadata'] as Record<string, Record<string, unknown>>;
    assert.ok(extmetadata, 'no extmetadata — the credit line has nothing to render');
    assert.equal(typeof extmetadata['LicenseShortName']?.['value'], 'string');
    assert.equal(typeof extmetadata['Artist']?.['value'], 'string');
  });

  /**
   * A file that does not exist is HTTP 200 with a `missing` key on the page —
   * NOT a 404. Asserted explicitly rather than reached by accident: the
   * credit path fails closed with creditRequired: true (D5), and it has to get
   * there via this key, because the status code it might otherwise wait for
   * never arrives.
   */
  it('reports an absent file as a missing key on a 200, not as an error status', async () => {
    if (process.env['PROBE_LIVE'] !== '1') return;
    const url =
      'https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo' +
      '&iiprop=url%7Cextmetadata&origin=*&titles=File%3AZzzz%20Not%20A%20Real%20File%2012345.jpg';
    const response = await fetch(url, {
      headers: { 'User-Agent': 'worldpulse/0.0 (https://github.com/0xmortuex/worldpulse) contract-test' },
      signal: AbortSignal.timeout(20_000),
    });
    assert.equal(response.status, 200, 'Commons answered an absent file with a status code');
    const body = (await response.json()) as { query?: { pages?: Record<string, Record<string, unknown>> } };
    const page = Object.values(body.query?.pages ?? {})[0] as Record<string, unknown>;
    assert.equal('missing' in page, true, 'an absent file did not carry the missing key');
    assert.equal('imageinfo' in page, false, 'an absent file carried imageinfo');
  });
});
