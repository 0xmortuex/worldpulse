import type { Fact } from '../facts/types';
import { formatPosition, markStaleness, normaliseLongitude, type GlobeEvent } from '../layers/events';
import {
  expectArray,
  expectInRange,
  expectNumber,
  expectObject,
  expectString,
  fetchProvenance,
  ShapeError,
  type FetchContext,
} from './adapter';

const SOURCE_ID = 'usgs-quakes';

export interface Quake {
  id: string;
  magnitude: number;
  magType: string;
  place: string;
  time: string;
  longitude: number;
  latitude: number;
  depthKm: number;
  status: string;
  tsunami: boolean;
  url: string;
}

export interface QuakeFeed {
  generated: string;
  title: string;
  count: number;
  quakes: Quake[];
}

/**
 * The summary feed the app reads. Exported so fixtures derive their request URL
 * from the app's own construction rather than repeating it — a hand-written
 * fixture URL diverged from the app's request in three of six fixtures before
 * this was done.
 */
export function buildFeedUrl(window: 'all_day' | 'all_week' | 'all_month' = 'all_day'): string {
  return `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${window}.geojson`;
}

export function parse(raw: unknown, sourceId = SOURCE_ID): QuakeFeed {
  const root = expectObject(sourceId, raw, 'root');
  if (root['type'] !== 'FeatureCollection') {
    throw new ShapeError(sourceId, `root.type is ${JSON.stringify(root['type'])}, expected "FeatureCollection"`);
  }

  const meta = expectObject(sourceId, root['metadata'], 'metadata');
  const features = expectArray(sourceId, root['features'], 'features');

  const quakes = features.map((feature, index) => {
    const at = `features[${index}]`;
    const record = expectObject(sourceId, feature, at);
    const properties = expectObject(sourceId, record['properties'], `${at}.properties`);
    const geometry = expectObject(sourceId, record['geometry'], `${at}.geometry`);
    const coordinates = expectArray(sourceId, geometry['coordinates'], `${at}.geometry.coordinates`);

    if (coordinates.length < 3) {
      throw new ShapeError(sourceId, `${at}.geometry.coordinates has ${coordinates.length} elements, expected 3`);
    }

    // Magnitude may legitimately be null for very recent automatic solutions.
    const rawMagnitude = properties['mag'];
    if (rawMagnitude !== null && typeof rawMagnitude !== 'number') {
      throw new ShapeError(sourceId, `${at}.properties.mag is ${typeof rawMagnitude}, expected number or null`);
    }

    const longitude = expectInRange(sourceId, expectNumber(sourceId, coordinates[0], `${at}.lon`), -180, 180, `${at}.lon`);
    const latitude = expectInRange(sourceId, expectNumber(sourceId, coordinates[1], `${at}.lat`), -90, 90, `${at}.lat`);
    // Negative depths are real (events above sea level datum); 1000 km is below
    // the deepest recorded earthquake.
    const depthKm = expectInRange(sourceId, expectNumber(sourceId, coordinates[2], `${at}.depth`), -10, 1000, `${at}.depth`);

    const magnitude = rawMagnitude === null ? Number.NaN : expectInRange(sourceId, rawMagnitude, -2, 10.5, `${at}.mag`);

    return {
      id: expectString(sourceId, record['id'], `${at}.id`),
      magnitude,
      magType: typeof properties['magType'] === 'string' ? properties['magType'] : 'unknown',
      place: typeof properties['place'] === 'string' ? properties['place'] : 'location not given',
      time: new Date(expectNumber(sourceId, properties['time'], `${at}.properties.time`)).toISOString(),
      longitude,
      latitude,
      depthKm,
      status: expectString(sourceId, properties['status'], `${at}.properties.status`),
      tsunami: properties['tsunami'] === 1,
      url: expectString(sourceId, properties['url'], `${at}.properties.url`),
    };
  });

  return {
    generated: new Date(expectNumber(sourceId, meta['generated'], 'metadata.generated')).toISOString(),
    title: expectString(sourceId, meta['title'], 'metadata.title'),
    count: expectNumber(sourceId, meta['count'], 'metadata.count'),
    quakes,
  };
}

export function magnitudeFact(quake: Quake, feed: QuakeFeed, ctx: FetchContext): Fact<number> {
  return {
    value: Number.isNaN(quake.magnitude) ? null : quake.magnitude,
    unit: quake.magType,
    asOf: quake.time,
    // An automatic solution has not been reviewed by an analyst and is revised
    // often, so it does not carry the same weight as a reviewed one.
    tier: quake.status === 'reviewed' ? 'OFFICIAL' : 'ESTIMATE',
    provenance: fetchProvenance(SOURCE_ID, ctx, feed, `features[id=${quake.id}].properties.mag`),
    ...(quake.status === 'reviewed'
      ? {}
      : { note: 'Automatic solution, not yet reviewed by an analyst. Subject to revision.' }),
    format: (value: number) => value.toFixed(1),
  };
}

/**
 * The epicentre, badged.
 *
 * Measured, so it carries the fetch provenance directly. The tier follows review
 * status for the same reason the magnitude's does: an automatic solution's
 * location is revised along with its magnitude.
 */
export function epicentreFact(quake: Quake, feed: QuakeFeed, ctx: FetchContext): Fact<string> {
  return {
    value: formatPosition(quake.latitude, normaliseLongitude(quake.longitude)),
    asOf: quake.time,
    tier: quake.status === 'reviewed' ? 'OFFICIAL' : 'ESTIMATE',
    provenance: fetchProvenance(SOURCE_ID, ctx, feed, `features[id=${quake.id}].geometry.coordinates`),
  };
}

/**
 * Quakes as globe events.
 *
 * Epicentres are measured coordinates, so `positionKind` is 'measured'. The
 * OFFICIAL/ESTIMATE split follows the review status, exactly as `magnitudeFact`
 * does — the tier is a property of the record, not of the source.
 *
 * The event carries the magnitude BOTH as a bare number (for sizing and
 * clustering, which are geometry) and as the Fact the tooltip renders. Building
 * both here, from the same field, is what stops the rendered value from drifting
 * away from the one the marker was sized by.
 */
export function toGlobeEvents(feed: QuakeFeed, now: Date, ctx: FetchContext): GlobeEvent[] {
  return feed.quakes.map((quake) =>
    markStaleness(
      {
        id: quake.id,
        layer: 'usgs:earthquakes',
        title: quake.place,
        lat: quake.latitude,
        lng: normaliseLongitude(quake.longitude),
        time: quake.time,
        magnitude: Number.isNaN(quake.magnitude) ? null : quake.magnitude,
        magnitudeFact: magnitudeFact(quake, feed, ctx),
        positionFact: epicentreFact(quake, feed, ctx),
        positionKind: 'measured',
        tier: quake.status === 'reviewed' ? 'OFFICIAL' : 'ESTIMATE',
        sourceId: SOURCE_ID,
        url: quake.url,
      },
      now,
    ),
  );
}
