import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fixture from './fixtures/cisa-kev.json' with { type: 'json' };
import { buildCatalogUrl, parse, readRansomwareUse } from '../src/sources/cisa-kev';
import { ShapeError } from '../src/sources/adapter';

/**
 * Contract test for the CISA Known Exploited Vulnerabilities catalogue.
 *
 * Rule 4: shape and range, never current values. The catalogue grows most weeks
 * and pinning its size would fail for the wrong reason — which is exactly why
 * the size assertion below compares CISA's own `count` against what arrived
 * rather than against a number written here.
 */
const ctx = {
  requestUrl: buildCatalogUrl(),
  httpStatus: 200,
  fetchedAt: '2026-08-14T00:00:00Z',
  cache: 'miss' as const,
  fromFixture: true,
};

const raw = fixture as { count: number; vulnerabilities: Array<Record<string, unknown>> };

describe('CISA KEV — contract', () => {
  it('returned vulnerabilities at all, so everything below measures something', () => {
    assert.ok(raw.vulnerabilities.length > 0, 'fixture has no vulnerabilities');
  });

  it('the catalogue agrees with its own declared count', () => {
    // CISA states its size; a mismatch means a truncated download or a
    // paginated response nobody noticed, not a data quirk.
    assert.equal(raw.count, raw.vulnerabilities.length);
  });

  it('refuses a catalogue whose count disagrees with its contents', () => {
    // Planted: the truncation this guard exists to catch.
    assert.throws(
      () => parse({ ...raw, count: raw.count + 1 }, ctx),
      (error: unknown) => error instanceof ShapeError && /count says/.test(String(error)),
    );
  });

  /**
   * PLANTED CASES for the three-state field. 1,316 of 1,665 entries are
   * `Unknown`, so getting this wrong would have the app assert, about the
   * majority of the catalogue, something CISA never said.
   */
  it('"Known" reads as known', () => {
    assert.equal(readRansomwareUse('Known'), 'known');
    assert.equal(readRansomwareUse('known'), 'known');
  });

  it('"Unknown" reads as unknown, and never as a negative', () => {
    // The false fact: `=== 'Known'` yields false for Unknown, which renders as
    // "not used by ransomware" — a claim CISA has not made.
    assert.equal(readRansomwareUse('Unknown'), 'unknown');
    assert.notEqual(readRansomwareUse('Unknown'), 'known');
  });

  it('an unrecognised value degrades to unknown, not to known', () => {
    // If CISA adds a value this parser has not seen, the safe reading is that we
    // do not know — never that we have evidence.
    for (const input of ['Suspected', '', null, undefined, 0, {}, 'KNOWN-ish']) {
      assert.equal(readRansomwareUse(input), 'unknown', `${JSON.stringify(input)} must not read as known`);
    }
  });

  it('parses entries with provenance, an as-of and the caveat attached', () => {
    const catalog = parse(fixture, ctx);
    assert.equal(catalog.entries.length, raw.count);

    for (const entry of catalog.entries.slice(0, 40)) {
      assert.match(entry.cveId, /^CVE-\d{4}-\d+$/, `not a CVE id: ${entry.cveId}`);
      assert.ok(entry.vendorProject.length > 0);
      assert.match(entry.dateAdded.value ?? '', /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(entry.dateAdded.tier, 'OFFICIAL');
      assert.ok(entry.dateAdded.provenance !== null, 'a fact without provenance renders BROKEN');

      // The caveat travels with the value, so "unknown" cannot render bare.
      assert.match(entry.ransomwareUse.note ?? '', /Unknown means CISA has no evidence/);
    }
  });

  it('both ransomware states are present in the captured catalogue', () => {
    // Positive control: if CISA ever publishes only one state, the planted cases
    // above are carrying this distinction alone and someone should know.
    const catalog = parse(fixture, ctx);
    const values = new Set(catalog.entries.map((entry) => entry.ransomwareUse.value));
    assert.ok(values.has('known'), 'no Known entries');
    assert.ok(values.has('unknown'), 'no Unknown entries');
  });

  it('carries a catalogue version and release date to date its facts', () => {
    const catalog = parse(fixture, ctx);
    assert.match(catalog.version, /^\d{4}\.\d{2}\.\d{2}$/);
    assert.ok(!Number.isNaN(Date.parse(catalog.released)));
    assert.equal(catalog.count.value, raw.count);
  });

  it('exposes no country dimension, because the catalogue has none', () => {
    // KEV lists vulnerabilities, not jurisdictions. Attributing an entry to a
    // country by vendor headquarters would be the app inventing a fact.
    const catalog = parse(fixture, ctx);
    for (const entry of catalog.entries.slice(0, 20)) {
      assert.ok(!('country' in entry), 'a country was attached to a KEV entry');
      assert.ok(!('iso3' in entry), 'an ISO3 was attached to a KEV entry');
    }
  });

  it('requests the cisagov mirror, never cisa.gov', () => {
    // Direct cisa.gov fetches have been rate-limited and IP-blocked; the mirror
    // is the registered origin and the one the probe verdict describes.
    const url = buildCatalogUrl();
    assert.match(url, /raw\.githubusercontent\.com\/cisagov\/kev-data/);
    assert.doesNotMatch(url, /(^|\/\/)(www\.)?cisa\.gov/);
  });
});
