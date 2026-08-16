import { distanceKm, type GlobeEvent } from './events';

/**
 * Population-exposed significance — Phase C.2.
 *
 * ## The arithmetic is here; the data is blocked
 *
 * The spec asks for HDX/WorldPop intersected with event footprints. **Probed
 * 2026-08-16, three blockers:** WorldPop's API root answers but sends no CORS
 * header, its stats service — the one that could answer an area query — timed
 * out at 30s, and its licence page returns 404 while HDX records the dataset as
 * `"isopen": false` with `license_id: "hdx-other"` pointing at that same 404.
 *
 * A licence this project cannot read is emergency 2: it is not ingested. So the
 * source parks with its blocker recorded (OPEN-QUESTIONS 32), per the riksdagen
 * and Ember precedents.
 *
 * **What is built anyway is the mechanism**, because it is pure geometry and
 * fully testable without the data: the footprint intersection, the
 * decomposition the inspector needs, and — most importantly — the honest
 * reporting of an input that was **not consulted** rather than one that came
 * back zero.
 *
 * That is question 13's distinction applied before the data exists rather than
 * retrofitted after, which is the whole reason it was worth naming as a rule.
 */

export interface PopulationCell {
  lat: number;
  lng: number;
  /** People in this cell. A gridded source supplies these; nothing does yet. */
  people: number;
}

export interface ExposureResult {
  /** People inside the footprint, or NULL when no population source answered. */
  exposed: number | null;
  /** Cells that contributed, for the inspector's decomposition. */
  contributing: Array<{ lat: number; lng: number; people: number; distanceKm: number }>;
  /** Why `exposed` is null, when it is. Never null-and-silent. */
  unavailableReason: string | null;
  footprintKm: number;
}

/**
 * The footprint radius an event is treated as covering.
 *
 * **Not a physical claim.** An earthquake's felt area depends on depth,
 * geology and construction; this is a stated convention so the arithmetic is
 * reproducible, and the surface must say so rather than implying the app knows
 * how far the shaking reached.
 */
export function footprintKm(event: GlobeEvent): number {
  const magnitude = event.magnitude;
  if (magnitude === null) return 25;
  // Roughly an order of magnitude per two points of magnitude, floored so a
  // small event still has a footprint and capped so a large one is not global.
  return Math.min(500, Math.max(10, 10 ** (magnitude / 2.5)));
}

/**
 * People inside the footprint.
 *
 * `cells` being null means **no population source was consulted** — a different
 * fact from an empty grid, which would mean a source answered and found nobody.
 * The first is a gap in this app; the second would be a claim about the place.
 */
export function exposureFor(
  event: GlobeEvent,
  cells: readonly PopulationCell[] | null,
  unavailableReason: string | null,
): ExposureResult {
  const radius = footprintKm(event);

  if (cells === null) {
    return {
      exposed: null,
      contributing: [],
      unavailableReason:
        unavailableReason ??
        'No population source is connected, so exposure was not computed. That is a gap in ' +
          'this app, not a finding that nobody lives there.',
      footprintKm: radius,
    };
  }

  const contributing = cells
    .map((cell) => ({ ...cell, distanceKm: distanceKm(event, cell) }))
    .filter((cell) => cell.distanceKm <= radius)
    .sort((a, b) => b.people - a.people);

  return {
    exposed: contributing.reduce((sum, cell) => sum + cell.people, 0),
    contributing,
    unavailableReason: null,
    footprintKm: radius,
  };
}

/**
 * The decomposition the inspector renders.
 *
 * Rule 22 and the no-composite-scores prohibition: a population-exposed figure
 * is a SUM over cells, and a reader must be able to see the cells. A number
 * that cannot be taken apart is a number nobody can check.
 */
export function decompose(result: ExposureResult): Array<{ label: string; people: number }> {
  return result.contributing
    .slice(0, 8)
    .map((cell) => ({
      label: `${cell.lat.toFixed(2)}, ${cell.lng.toFixed(2)} — ${Math.round(cell.distanceKm)}km away`,
      people: cell.people,
    }));
}
