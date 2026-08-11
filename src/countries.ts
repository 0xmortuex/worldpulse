import { feature } from 'topojson-client';
import topology from 'world-atlas/countries-110m.json';
import isoCountries from 'i18n-iso-countries';
import enLocale from 'i18n-iso-countries/langs/en.json';
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';

isoCountries.registerLocale(enLocale);

export type CodeStatus = 'iso-3166-1' | 'user-assigned';

export interface Country {
  /** ISO 3166-1 alpha-3, or a user-assigned code for entities ISO does not list. */
  code: string;
  codeStatus: CodeStatus;
  name: string;
  feature: Feature<Polygon | MultiPolygon>;
}

/**
 * Natural Earth carries three entities that ISO 3166-1 does not assign codes
 * to. Dropping them would silently erase them from the globe, so they get
 * user-assigned codes and are marked as such — the UI says the code is not ISO
 * rather than implying a recognition status the data does not support.
 */
const USER_ASSIGNED: Record<string, string> = {
  Kosovo: 'XKX',
  'N. Cyprus': 'XNC',
  Somaliland: 'XSO',
};

/**
 * Countries whose territory crosses the 180th meridian (Russia's Chukotka, Fiji)
 * arrive with rings spanning nearly 360° of longitude. Triangulated as-is they
 * render as a band smeared across the globe rather than as land.
 *
 * Making the ring's longitudes contiguous past 180° fixes it: the renderer maps
 * longitude to an angle, so 190° and -170° are the same place.
 *
 * Pole-capping polygons — Antarctica — legitimately span the full range and
 * must be left alone; shifting them would tear the continent in half.
 */
function normalizeRing(ring: Position[]): Position[] {
  let min = Infinity;
  let max = -Infinity;
  for (const point of ring) {
    const lon = point[0] ?? 0;
    if (lon < min) min = lon;
    if (lon > max) max = lon;
  }
  if (max - min <= 180) return ring;
  if (ring.some((point) => Math.abs(point[1] ?? 0) >= 85)) return ring;

  return ring.map((point) => {
    const lon = point[0] ?? 0;
    return lon < 0 ? [lon + 360, point[1] ?? 0, ...point.slice(2)] : point;
  });
}

function normalizeGeometry(geometry: Polygon | MultiPolygon): Polygon | MultiPolygon {
  if (geometry.type === 'Polygon') {
    return { ...geometry, coordinates: geometry.coordinates.map(normalizeRing) };
  }
  return {
    ...geometry,
    coordinates: geometry.coordinates.map((polygon) => polygon.map(normalizeRing)),
  };
}

let cache: Country[] | null = null;

export function loadCountries(): Country[] {
  if (cache) return cache;

  const collection = feature(topology, topology.objects.countries);
  const countries: Country[] = [];

  for (const geoFeature of collection.features) {
    const naturalEarthName = geoFeature.properties?.name ?? 'Unknown';
    const numeric = geoFeature.id === undefined ? null : String(geoFeature.id);
    const alpha3 = numeric ? isoCountries.numericToAlpha3(numeric) : undefined;

    const code = alpha3 ?? USER_ASSIGNED[naturalEarthName];
    if (!code) continue;

    const typedFeature = geoFeature as Feature<Polygon | MultiPolygon>;
    typedFeature.geometry = normalizeGeometry(typedFeature.geometry);

    countries.push({
      code,
      codeStatus: alpha3 ? 'iso-3166-1' : 'user-assigned',
      // Prefer the ISO English short name; fall back to the Natural Earth
      // label, which uses cartographic abbreviations like "Dem. Rep. Congo".
      name: (alpha3 && isoCountries.getName(alpha3, 'en')) || naturalEarthName,
      feature: typedFeature,
    });
  }

  countries.sort((a, b) => a.name.localeCompare(b.name));
  cache = countries;
  return countries;
}

export function countryByCode(countries: readonly Country[]): Map<string, Country> {
  return new Map(countries.map((country) => [country.code, country]));
}
