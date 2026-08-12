import { expectArray, expectObject, expectString, fetchProvenance, ShapeError, type FetchContext } from './adapter';
import type { Fact } from '../facts/types';
import {
  formatPosition,
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

/**
 * Where the marker sits, and how that position came to exist.
 *
 * A reported Point carries the fetch directly. A centroid does NOT: it is a
 * value this app manufactured by averaging a polygon's vertices, so its
 * provenance is a derivation whose formula names the reduction and whose input
 * is the fetch the shape came from. Someone walking the inspector has to be able
 * to see that a point was made out of a shape — pointing at the fetch alone
 * would present our arithmetic as NASA's report.
 */
/**
 * NASA's published measurement for this event, with its unit.
 *
 * Decision L8 originally read "EONET does not measure magnitude", and every
 * event was given `magnitude: null` on that basis. Live data disproves it —
 * every geometry carries `magnitudeValue` and `magnitudeUnit`, e.g. 9673
 * `hectare` for a wildfire's burned area and 35 `kts` for a storm's winds — so
 * the app was discarding a figure NASA publishes because we had assumed it did
 * not exist.
 *
 * Both fields must be present and well-formed, or nothing is emitted. A value
 * with no unit is not a measurement, it is a number: "9673" tells a reader
 * nothing and inviting them to compare it with another unitless 35 is worse than
 * showing neither. OFFICIAL, because this is NASA's figure and not ours.
 */
function measurementOf(
  geometry: Record<string, unknown>,
  date: string,
  raw: unknown,
  ctx: FetchContext,
  at: string,
): { measurement?: { fact: Fact<number>; unit: string } } {
  const value = geometry['magnitudeValue'];
  const unit = geometry['magnitudeUnit'];
  if (typeof value !== 'number' || !Number.isFinite(value)) return {};
  if (typeof unit !== 'string' || unit.trim() === '') return {};

  return {
    measurement: {
      unit,
      fact: {
        value,
        asOf: date,
        tier: 'OFFICIAL',
        provenance: fetchProvenance(SOURCE_ID, ctx, raw, `${at}.geometry[last].magnitudeValue`),
      },
    },
  };
}

function positionFact(
  lat: number,
  lng: number,
  kind: PositionKind,
  vertices: number | undefined,
  date: string,
  raw: unknown,
  ctx: FetchContext,
  at: string,
): Fact<string> {
  const fetched = fetchProvenance(SOURCE_ID, ctx, raw, `${at}.geometry[last].coordinates`);
  const value = formatPosition(lat, lng);

  if (kind === 'measured') {
    return { value, asOf: date, tier: 'OFFICIAL', provenance: fetched };
  }

  return {
    value,
    asOf: date,
    tier: 'DERIVED',
    provenance: {
      kind: 'derived',
      computedBy: 'src/layers/events.ts ringCentroid',
      formula: `centroid of a ${vertices ?? 0}-vertex polygon perimeter — the mean of its vertices`,
      computedAt: ctx.fetchedAt,
      inputs: [fetched],
    },
    note: 'Manufactured from a shape. The event covers an area; this point is only its centre.',
  };
}

export function parseEvents(raw: unknown, now: Date, ctx: FetchContext, sourceId = SOURCE_ID): GlobeEvent[] {
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
          // Stays null on purpose. `magnitude` is the comparative scale that
          // drives marker radius and cluster ranking, and EONET's figures are
          // unit-bearing — see `measurement` below and decision L8.
          magnitude: null,
          ...measurementOf(geometry, date, raw, ctx, at),
          positionFact: positionFact(lat, lng, positionKind, perimeterVertices, date, raw, ctx, at),
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
