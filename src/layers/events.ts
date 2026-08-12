import type { Fact, Tier } from '../facts/types';

/**
 * A point rendered on the globe.
 *
 * `positionKind` is load-bearing. A USGS epicentre is a measured coordinate; the
 * marker for an EONET wildfire perimeter is the centroid of a polygon and is not
 * the fire's location in any meaningful sense. Both render as dots, so the
 * distinction has to travel with the data and reach the tooltip.
 */
export type PositionKind = 'measured' | 'derived-centroid';

export interface GlobeEvent {
  id: string;
  layer: string;
  title: string;
  lat: number;
  lng: number;
  /** ISO timestamp of the event, or of its most recent geometry. */
  time: string;
  /**
   * Earthquake magnitude, or null for layers with no magnitude.
   *
   * Present for sizing, sorting and clustering, which are geometry and have no
   * business unpacking a Fact. It is NOT what the tooltip renders — see
   * `magnitudeFact`. Both are built from the same field in one place so they
   * cannot disagree.
   */
  magnitude: number | null;
  /**
   * The same magnitude with its provenance, for rendering.
   *
   * A bare number in a tooltip is a fact with its badge stripped off: an
   * unreviewed automatic solution and an analyst-reviewed one print identically,
   * and nothing says which source or which revision it came from. Layers with no
   * magnitude concept (every EONET category) leave this undefined, which is
   * different from a quake whose magnitude is genuinely null.
   */
  magnitudeFact?: Fact<number>;
  /**
   * A unit-bearing measurement the source publishes, kept SEPARATE from
   * `magnitude` and never fed into sizing, sorting or clustering.
   *
   * EONET publishes `magnitudeValue` with a `magnitudeUnit` — 9673 hectares for
   * a wildfire's burned area, 35 kts for a storm's winds. Decision L8 originally
   * said EONET does not measure magnitude at all, which live data disproved; the
   * app was discarding a published measurement on a false premise.
   *
   * It is a distinct field because **there is no honest comparison between 9673
   * hectares and 35 knots**, nor between either and an earthquake's moment
   * magnitude. `magnitude` is comparative — it drives marker radius, cluster
   * ranking and "strongest member". A unit-bearing figure that entered that
   * scale would size a wildfire against a quake. Rendered as value + unit,
   * badged with the source's own tier, and never aggregated across units.
   */
  measurement?: { fact: Fact<number>; unit: string };
  /**
   * Where the marker sits, with its provenance.
   *
   * A coordinate printed as `lat.toFixed(3), lng.toFixed(3)` is a measured value
   * from a source with its confidence stripped off — and a method call has no
   * name for the discipline rule to catch, so it slipped past a rule written to
   * stop exactly this. A USGS epicentre and a centroid this app manufactured
   * from a polygon are not the same kind of claim and must not print alike.
   */
  positionFact: Fact<string>;
  positionKind: PositionKind;
  /** Vertices behind a derived centroid, so the tooltip can say how coarse it is. */
  perimeterVertices?: number;
  tier: Tier;
  sourceId: string;
  /** True when an "open" event has not been updated for a long time. */
  stale: boolean;
  staleDays?: number;
  url?: string;
}

/**
 * EONET marks events open until they are explicitly closed, and many never are.
 * A volcano flagged "open" whose last geometry is from 2019 is a data-quality
 * artifact, not a live event.
 *
 * Policy: an open event with no geometry newer than this is STALE. Stale events
 * are still available — deleting them would hide real history — but they are
 * excluded from the default "active" view and labelled wherever they appear.
 */
export const STALE_AFTER_DAYS = 180;

export function daysBetween(from: string, to: Date): number {
  const parsed = Date.parse(from);
  if (Number.isNaN(parsed)) return Number.POSITIVE_INFINITY;
  return Math.floor((to.getTime() - parsed) / 86_400_000);
}

export function markStaleness(event: Omit<GlobeEvent, 'stale' | 'staleDays'>, now: Date): GlobeEvent {
  const age = daysBetween(event.time, now);
  return {
    ...event,
    stale: age > STALE_AFTER_DAYS,
    ...(age > STALE_AFTER_DAYS ? { staleDays: age } : {}),
  };
}

/* ------------------------------------------------------------- geometry */

/**
 * Centroid of a polygon ring, for EONET perimeter geometries.
 *
 * Deliberately a plain vertex mean rather than an area-weighted centroid: the
 * marker is already an admission that we cannot draw the real shape, and a more
 * sophisticated centre would imply a precision the marker does not have.
 * Rings crossing the antimeridian are unwrapped first, or the mean lands on the
 * opposite side of the planet.
 */
export function ringCentroid(ring: ReadonlyArray<readonly [number, number]>): { lat: number; lng: number } {
  if (ring.length === 0) return { lat: 0, lng: 0 };

  const lngs = ring.map(([lng]) => lng);
  const spans = Math.max(...lngs) - Math.min(...lngs);
  const unwrapped = spans > 180 ? lngs.map((lng) => (lng < 0 ? lng + 360 : lng)) : lngs;

  const lngMean = unwrapped.reduce((sum, lng) => sum + lng, 0) / unwrapped.length;
  const latMean = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;

  return { lat: latMean, lng: normaliseLongitude(lngMean) };
}

/**
 * The rendered form of a position.
 *
 * Three decimal places is about 100m, which is finer than any of these sources
 * claims and coarse enough not to imply a survey. It lives here so the epicentre
 * and the manufactured centroid are formatted identically — the difference
 * between them belongs in the badge and the provenance, not in the precision.
 */
export function formatPosition(lat: number, lng: number): string {
  return `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
}

/** Fold any longitude back into [-180, 180). */
export function normaliseLongitude(lng: number): number {
  let value = ((lng + 180) % 360 + 360) % 360 - 180;
  // -180 and 180 are the same meridian; pick one so equality checks behave.
  if (value === -180) value = 180;
  return value;
}

/** Great-circle distance in kilometres. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* ------------------------------------------------------------- clustering */

export interface EventCluster {
  id: string;
  lat: number;
  lng: number;
  members: GlobeEvent[];
  /** The member whose position the marker uses. */
  representative: GlobeEvent;
}

/** Below this separation, two markers overlap enough that the lower one is unreachable. */
export const CLUSTER_RADIUS_KM = 25;

/**
 * Group events that would render on top of each other.
 *
 * An aftershock sequence puts a dozen epicentres inside a few kilometres. Drawn
 * as individual points they stack, and only the topmost is ever pickable — the
 * globe's version of a UI element that maps to the wrong record. Clustering with
 * a visible count keeps every member reachable through the tooltip.
 *
 * The marker sits on the STRONGEST member's real coordinate, not on the mean of
 * the group. An averaged position is a place where nothing happened.
 */
export function clusterEvents(events: readonly GlobeEvent[], radiusKm = CLUSTER_RADIUS_KM): EventCluster[] {
  const clusters: EventCluster[] = [];

  for (const event of events) {
    const existing = clusters.find((cluster) => distanceKm(cluster, event) <= radiusKm);
    if (existing) {
      existing.members.push(event);
      continue;
    }
    clusters.push({ id: event.id, lat: event.lat, lng: event.lng, members: [event], representative: event });
  }

  for (const cluster of clusters) {
    // Strongest first so the representative is the most significant event, and
    // so the tooltip lists members in a useful order.
    cluster.members.sort((a, b) => (b.magnitude ?? -Infinity) - (a.magnitude ?? -Infinity));
    const strongest = cluster.members[0] as GlobeEvent;
    cluster.representative = strongest;
    cluster.lat = strongest.lat;
    cluster.lng = strongest.lng;
    cluster.id = strongest.id;
  }

  return clusters;
}

/* ---------------------------------------------------------------- scaling */

export interface MagnitudeScale {
  minMagnitude: number;
  maxMagnitude: number;
  minRadius: number;
  maxRadius: number;
}

export const QUAKE_SCALE: MagnitudeScale = {
  minMagnitude: 1,
  maxMagnitude: 8,
  // minRadius is a POINTER-TARGET floor, not an aesthetic one. At 0.16 the
  // smallest markers — anything with no magnitude, which is every EONET event —
  // were not reliably hit-testable, so a user could see a marker and be unable
  // to click it. A marker you cannot open is a marker you cannot check.
  minRadius: 0.28,
  maxRadius: 0.75,
};

/**
 * Marker radius for a magnitude.
 *
 * Bounded and linear in magnitude — which is already a log scale, so an M8 is
 * roughly four times an M4 on screen rather than ten thousand times. Area-
 * proportional sizing would make every moderate quake a sub-pixel dot next to
 * one large one, and the small ones are most of the data.
 *
 * The bounds matter as much as the curve: below `minRadius` a point is
 * invisible, and a point the user cannot see is a point they cannot check.
 */
export function radiusForMagnitude(magnitude: number | null, scale = QUAKE_SCALE): number {
  if (magnitude === null || Number.isNaN(magnitude)) return scale.minRadius;
  const clamped = Math.min(scale.maxMagnitude, Math.max(scale.minMagnitude, magnitude));
  const t = (clamped - scale.minMagnitude) / (scale.maxMagnitude - scale.minMagnitude);
  return scale.minRadius + t * (scale.maxRadius - scale.minRadius);
}

/**
 * Legend steps, so the size ramp is readable rather than inferred.
 *
 * Size encodes magnitude on a bounded scale. It is not proportional to energy,
 * area or damage, and the legend says so — otherwise a reader will estimate
 * values from dot sizes, which is a precision the encoding does not carry.
 */
export function magnitudeLegend(scale = QUAKE_SCALE): Array<{ magnitude: number; radius: number }> {
  return [2, 4, 6, 8].map((magnitude) => ({ magnitude, radius: radiusForMagnitude(magnitude, scale) }));
}
