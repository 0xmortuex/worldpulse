import { expectArray, expectObject, expectString, ShapeError } from './adapter';
import {
  markStaleness,
  normaliseLongitude,
  ringCentroid,
  type GlobeEvent,
  type PositionKind,
} from '../layers/events';

const SOURCE_ID = 'nasa-eonet';

/**
 * NASA EONET v3.
 *
 * Two properties of this source shape the adapter:
 *
 *   - Geometries are Point OR Polygon. A polygon perimeter reduced to a marker
 *     is a DERIVED position, and that has to reach the tooltip — the centroid of
 *     a wildfire perimeter is not where the fire is.
 *   - Events stay "open" until explicitly closed, and many never are. Staleness
 *     is computed rather than trusted.
 */

export function buildEventsUrl(options: { limit?: number; status?: 'open' | 'closed' | 'all' } = {}): string {
  const status = options.status ?? 'open';
  const limit = options.limit ?? 200;
  return `https://eonet.gsfc.nasa.gov/api/v3/events?status=${status}&limit=${limit}`;
}

type Coordinates = readonly [number, number];

function readPoint(sourceId: string, coordinates: unknown, at: string): Coordinates {
  const pair = expectArray(sourceId, coordinates, at);
  const lng = pair[0];
  const lat = pair[1];
  if (typeof lng !== 'number' || typeof lat !== 'number') {
    throw new ShapeError(sourceId, `${at} is not a [lng, lat] pair`);
  }
  if (lat < -90 || lat > 90) throw new ShapeError(sourceId, `${at} latitude ${lat} is out of range`);
  return [normaliseLongitude(lng), lat];
}

function readRing(sourceId: string, coordinates: unknown, at: string): Coordinates[] {
  // Polygon coordinates nest one level: [[ [lng,lat], ... ]]
  const outer = expectArray(sourceId, coordinates, at);
  const ring = expectArray(sourceId, outer[0], `${at}[0]`);
  return ring.map((vertex, index) => readPoint(sourceId, vertex, `${at}[0][${index}]`));
}

export function parseEvents(raw: unknown, now: Date, sourceId = SOURCE_ID): GlobeEvent[] {
  const root = expectObject(sourceId, raw, 'root');
  const events = expectArray(sourceId, root['events'], 'events');
  const out: GlobeEvent[] = [];

  events.forEach((entry, index) => {
    const at = `events[${index}]`;
    const record = expectObject(sourceId, entry, at);
    const id = expectString(sourceId, record['id'], `${at}.id`);
    const title = expectString(sourceId, record['title'], `${at}.title`);

    const categories = Array.isArray(record['categories']) ? record['categories'] : [];
    const firstCategory = categories[0];
    const category =
      typeof firstCategory === 'object' && firstCategory !== null && typeof (firstCategory as Record<string, unknown>)['title'] === 'string'
        ? ((firstCategory as Record<string, unknown>)['title'] as string)
        : 'uncategorised';

    const geometries = expectArray(sourceId, record['geometry'], `${at}.geometry`);
    // Most recent geometry wins: EONET appends as an event moves.
    const latest = geometries[geometries.length - 1];
    if (latest === undefined) return;

    const geometry = expectObject(sourceId, latest, `${at}.geometry[last]`);
    const type = expectString(sourceId, geometry['type'], `${at}.geometry[last].type`);
    const date = expectString(sourceId, geometry['date'], `${at}.geometry[last].date`);

    let lng: number;
    let lat: number;
    let positionKind: PositionKind;
    let perimeterVertices: number | undefined;

    if (type === 'Point') {
      [lng, lat] = readPoint(sourceId, geometry['coordinates'], `${at}.geometry[last].coordinates`);
      positionKind = 'measured';
    } else if (type === 'Polygon') {
      const ring = readRing(sourceId, geometry['coordinates'], `${at}.geometry[last].coordinates`);
      const centre = ringCentroid(ring.map(([ringLng, ringLat]) => [ringLng, ringLat] as const));
      lng = centre.lng;
      lat = centre.lat;
      positionKind = 'derived-centroid';
      perimeterVertices = ring.length;
    } else {
      throw new ShapeError(sourceId, `${at}.geometry[last].type is ${JSON.stringify(type)}, expected Point or Polygon`);
    }

    out.push(
      markStaleness(
        {
          id,
          layer: `eonet:${category.toLowerCase().replace(/\s+/g, '-')}`,
          title,
          lat,
          lng,
          time: date,
          magnitude: null,
          positionKind,
          ...(perimeterVertices === undefined ? {} : { perimeterVertices }),
          // A derived centroid is this app's inference, not NASA's report.
          tier: positionKind === 'derived-centroid' ? 'DERIVED' : 'OFFICIAL',
          sourceId: SOURCE_ID,
          ...(typeof record['link'] === 'string' ? { url: record['link'] } : {}),
        },
        now,
      ),
    );
  });

  return out;
}
