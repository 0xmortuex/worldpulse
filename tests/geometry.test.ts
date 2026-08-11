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
