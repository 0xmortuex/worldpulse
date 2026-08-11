import quakesSpread from '../../tests/fixtures/layers/quakes-spread.json';
import quakesEdges from '../../tests/fixtures/layers/quakes-edges.json';
import quakesAftershocks from '../../tests/fixtures/layers/quakes-aftershocks.json';
import eonetMixed from '../../tests/fixtures/layers/eonet-mixed.json';
import { parse as parseQuakes, toGlobeEvents } from '../sources/usgs';
import { parseEvents as parseEonet } from '../sources/eonet';
import type { GlobeEvent } from './events';

/**
 * Fixture-backed globe layers.
 *
 * The three quake fixtures are merged rather than served one at a time, so the
 * antimeridian, polar and aftershock cases are all present on the running globe
 * at once — which is where their interactions (clustering across the dateline,
 * a polar marker under a spread one) would actually show up.
 */

export interface LayerDefinition {
  id: string;
  label: string;
  sourceId: string;
  /** Colour of a marker in this layer. */
  color: string;
  /** Off by default where the data is not live. */
  defaultOn: boolean;
}

export const LAYERS: readonly LayerDefinition[] = [
  { id: 'usgs:earthquakes', label: 'Earthquakes', sourceId: 'usgs-quakes', color: '#f0553d', defaultOn: true },
  { id: 'eonet:volcanoes', label: 'Volcanoes', sourceId: 'nasa-eonet', color: '#d99024', defaultOn: true },
  { id: 'eonet:wildfires', label: 'Wildfires', sourceId: 'nasa-eonet', color: '#e8b339', defaultOn: true },
  { id: 'eonet:severe-storms', label: 'Severe storms', sourceId: 'nasa-eonet', color: '#79c0ff', defaultOn: true },
];

const LAYER_IDS = new Set(LAYERS.map((layer) => layer.id));

export function loadEvents(now: Date): GlobeEvent[] {
  const quakes = [quakesSpread, quakesEdges, quakesAftershocks].flatMap((raw) =>
    toGlobeEvents(parseQuakes(raw), now),
  );
  const natural = parseEonet(eonetMixed, now);

  // An event whose category has no registered layer would be silently
  // unrenderable, which is indistinguishable from an event that does not exist.
  // Keep it, and let the caller surface the mismatch.
  return [...quakes, ...natural];
}

export function unregisteredLayers(events: readonly GlobeEvent[]): string[] {
  return [...new Set(events.map((event) => event.layer).filter((layer) => !LAYER_IDS.has(layer)))];
}

export function colorFor(layerId: string): string {
  return LAYERS.find((layer) => layer.id === layerId)?.color ?? '#8b949e';
}

export interface LayerFilter {
  enabled: ReadonlySet<string>;
  includeStale: boolean;
}

/**
 * Filter events for rendering.
 *
 * Stale events are excluded by default and reinstated by an explicit toggle —
 * an EONET volcano "open" since 2019 is a data-quality artifact, and rendering
 * it beside today's earthquakes claims it is happening now.
 */
export function filterEvents(events: readonly GlobeEvent[], filter: LayerFilter): GlobeEvent[] {
  return events.filter((event) => {
    if (!filter.enabled.has(event.layer)) return false;
    if (event.stale && !filter.includeStale) return false;
    return true;
  });
}
