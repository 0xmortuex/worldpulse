import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Position } from 'geojson';
import { loadCountries } from '../src/countries';

const countries = loadCountries();

function ringsOf(code: string): Position[][] {
  const country = countries.find((candidate) => candidate.code === code);
  assert.ok(country, `${code} missing from the topology`);
  const geometry = country.feature.geometry;
  return geometry.type === 'MultiPolygon' ? geometry.coordinates.flat() : geometry.coordinates;
}

function longitudeSpan(ring: Position[]): number {
  const lons = ring.map((point) => point[0] ?? 0);
  return Math.max(...lons) - Math.min(...lons);
}

describe('country geometry', () => {
  it('loads every mappable country', () => {
    assert.equal(countries.length, 177);
  });

  it('has no antimeridian-spanning rings outside the polar caps', () => {
    // A ring spanning more than 180° of longitude triangulates into a band
    // smeared across the globe. Russia and Fiji both arrive this way.
    const offenders: string[] = [];
    for (const country of countries) {
      const geometry = country.feature.geometry;
      const rings = geometry.type === 'MultiPolygon' ? geometry.coordinates.flat() : geometry.coordinates;
      for (const ring of rings) {
        const polar = ring.some((point) => Math.abs(point[1] ?? 0) >= 85);
        if (!polar && longitudeSpan(ring) > 180) offenders.push(country.code);
      }
    }
    assert.deepEqual([...new Set(offenders)], []);
  });

  it('keeps Russia and Fiji contiguous past 180 rather than wrapping', () => {
    const wide = ringsOf('RUS').concat(ringsOf('FJI')).filter((ring) => longitudeSpan(ring) > 60);
    assert.equal(wide.length > 0, true, 'expected at least one wide ring to still exist');
    for (const ring of wide) assert.ok(longitudeSpan(ring) <= 180);
  });

  it('leaves Antarctica spanning the full range', () => {
    // The pole cap genuinely wraps; normalising it would tear the continent.
    assert.ok(ringsOf('ATA').some((ring) => longitudeSpan(ring) > 180));
  });

  it('marks non-ISO entities as user-assigned', () => {
    const kosovo = countries.find((country) => country.code === 'XKX');
    assert.ok(kosovo);
    assert.equal(kosovo.codeStatus, 'user-assigned');
    assert.equal(countries.filter((c) => c.codeStatus === 'user-assigned').length, 3);
  });
});

/**
 * Byte-level assertions on the bundled ISO-3166 name table.
 *
 * `i18n-iso-countries` ships as part of the app rather than being fetched, so
 * nothing at runtime would notice it changing. It is registered as source
 * `iso-3166-names` with `verifiedAgainst: "bundled"`, and A6a requires that
 * claim to rest on a test reading the real shipped data — otherwise "bundled"
 * is just an exemption nobody checks.
 *
 * Shape and stable membership only, never the full table: names are revised
 * legitimately (Türkiye, Czechia), and a test pinned to every string would fail
 * on an ordinary upstream correction and train people to ignore it.
 */
describe('bundled ISO-3166 name table', () => {
  const countries = loadCountries();

  it('resolves a stable set of well-known alpha-3 codes to names', () => {
    const expected = ['USA', 'FRA', 'JPN', 'BRA', 'ZAF', 'IND'];
    for (const code of expected) {
      const country = countries.find((candidate) => candidate.code === code);
      assert.ok(country, `${code} is absent from the bundled country list`);
      assert.ok(
        (country?.name.length ?? 0) > 1,
        `${code} resolved to an empty or single-character name`,
      );
    }
  });

  it('every code is three uppercase letters', () => {
    assert.ok(countries.length > 100, `only ${countries.length} countries loaded`);
    for (const country of countries) {
      assert.match(country.code, /^[A-Z]{3}$/, `${country.code} is not an alpha-3 code`);
    }
  });

  it('assigns no duplicate codes', () => {
    const seen = new Set<string>();
    for (const country of countries) {
      assert.equal(seen.has(country.code), false, `${country.code} appears twice`);
      seen.add(country.code);
    }
  });
});
