import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fixture from './fixtures/unhcr-population.json' with { type: 'json' };
import { buildPopulationUrl, findCountry, parse, readFigure, POPULATION_FIELDS } from '../src/sources/unhcr';
import { factState } from '../src/facts/types';

/**
 * Contract test for the UNHCR Refugee Data Finder.
 *
 * Rule 4: shape and range, never current values — displacement figures move
 * every year and pinning one would fail for the wrong reason.
 *
 * The acceptance criterion for this source is rule 30's distinction: a reported
 * zero and an absence must render differently, and a country that never reported
 * must render as the absence. UNHCR encodes both in one row, so both are proven
 * here against real captured data AND against planted cases (rule 27) that pin
 * the behaviour independently of what this year's response happens to contain.
 */
const ctx = {
  requestUrl: buildPopulationUrl({ year: 2023, breakdown: 'asylum' as const, limit: 500 }),
  httpStatus: 200,
  fetchedAt: '2026-08-14T00:00:00Z',
  cache: 'miss' as const,
  fromFixture: true,
};

const rows = (fixture as { items: Array<Record<string, unknown>> }).items;

describe('UNHCR population — contract', () => {
  it('returned rows at all, so everything below measures something', () => {
    assert.ok(rows.length > 0, 'fixture has no rows');
  });

  it('every row carries all nine population fields', () => {
    for (const row of rows) {
      for (const field of POPULATION_FIELDS) {
        assert.ok(field in row, `${row['coa_iso']} is missing ${field}`);
      }
    }
  });

  /**
   * PLANTED CASES — the distinction, pinned independently of live data.
   *
   * These do not depend on this year's response carrying a dash or a zero. If
   * UNHCR ever publishes a year in which every field is populated, the captured
   * fixture would stop exercising the distinction and these would still hold it.
   */
  it('a reported zero parses as zero, not as absence', () => {
    assert.equal(readFigure('0'), 0, 'the string "0" is a counted zero');
    assert.equal(readFigure(0), 0);
  });

  it('a dash parses as absence, NEVER as zero', () => {
    // The false fact this whole test exists for. Number('-') is NaN, and
    // `Number(v) || 0` would make this 0 — telling a reader UNHCR counted none
    // where UNHCR counted nothing at all.
    assert.equal(readFigure('-'), null);
    assert.notEqual(readFigure('-'), 0);
  });

  it('null, empty and unrecognised values are absence, not zero', () => {
    for (const input of [null, undefined, '', '   ', 'n/a', 'unknown', {}, []]) {
      assert.equal(readFigure(input), null, `${JSON.stringify(input)} must not become a figure`);
    }
  });

  it('a real number survives unchanged, including a legitimate zero', () => {
    assert.equal(readFigure(5079), 5079);
    assert.equal(readFigure('5079'), 5079);
    assert.equal(readFigure(0), 0);
  });

  it('the captured response really does contain both states', () => {
    // Positive control: if this fails, the fixture stopped exercising the
    // distinction and the planted cases above are carrying the test alone.
    const dashes = rows.filter((row) => POPULATION_FIELDS.some((field) => row[field] === '-'));
    const zeros = rows.filter((row) => POPULATION_FIELDS.some((field) => String(row[field]) === '0'));
    assert.ok(dashes.length > 0, 'no no-data dashes in the fixture');
    assert.ok(zeros.length > 0, 'no reported zeros in the fixture');
  });

  it('a country carrying both renders them as different fact states', () => {
    const parsed = parse(fixture, ctx);
    const albania = findCountry(parsed, 'ALB');
    assert.ok(albania, 'Albania is missing from the fixture');

    // idps is a reported zero; oip is a dash. Same row, same country, two
    // different claims — and two different badges.
    assert.equal(albania.figures.idps.value, 0);
    assert.equal(factState(albania.figures.idps), 'ok', 'a counted zero is a value, not an absence');

    assert.equal(albania.figures.oip.value, null);
    assert.equal(factState(albania.figures.oip), 'nodata', 'a dash must render as no data');
  });

  it('a country that never reported has no row, and renders as absence', () => {
    // The criterion's sharpest clause: never the first state. 73 ISO3 codes have
    // no row at all, and returning zeros for them would invent figures for 73
    // countries.
    const parsed = parse(fixture, ctx);
    for (const iso3 of ['AND', 'ATA', 'BMU', 'BTN']) {
      assert.equal(findCountry(parsed, iso3), null, `${iso3} must not resolve to a row`);
    }
  });

  it('drops the world-aggregate row rather than filing it under a country', () => {
    // Without coa_all/coo_all the API returns a single row whose codes are both
    // "-" carrying global totals. Parsed naively it becomes a country.
    const parsed = parse({ items: [{ ...rows[0], coa_iso: '-', coo_iso: '-', coa_name: '-', coo_name: '-' }] }, ctx);
    assert.deepEqual(parsed, [], 'the aggregate row was treated as a country');
  });

  it('every parsed figure carries provenance and an as-of year', () => {
    const parsed = parse(fixture, ctx);
    for (const country of parsed.slice(0, 20)) {
      for (const field of POPULATION_FIELDS) {
        const fact = country.figures[field];
        assert.ok(fact.provenance !== null, `${country.iso3}.${field} has no provenance`);
        assert.equal(fact.tier, 'OFFICIAL');
        assert.match(fact.asOf, /^\d{4}$/);
      }
    }
  });

  it('builds a request with a breakdown, because the default is a world total', () => {
    assert.match(buildPopulationUrl({ year: 2023, breakdown: 'asylum', limit: 500 }), /coa_all=true/);
    assert.match(buildPopulationUrl({ year: 2023, breakdown: 'origin', limit: 500 }), /coo_all=true/);
  });
});
