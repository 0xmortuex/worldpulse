/**
 * Step 12 — how much this app actually knows about each country.
 *
 * ## The one surface where a missing value is the point
 *
 * Every other panel treats absence as something to disclose apologetically.
 * Here absence IS the subject, which makes two things load-bearing that are
 * merely important elsewhere.
 *
 * **First, "no coverage" and "zero coverage" are different.** A country we
 * never look at and a country we look at and find nothing about are different
 * facts, and a choropleth that paints them the same colour has answered its own
 * question wrongly. Rule 30, at map scale.
 *
 * **Second, the figure is DERIVED and must say so.** It is a count of this
 * app's own panels, not a property of the country. A reader who mistakes the
 * coverage map for a development index has been badly misled, and the number
 * offers no clue by itself — 3 of 7 looks like data about a place.
 */

export type CoverageBand = 'none' | 'sparse' | 'partial' | 'good';

export interface CountryCoverage {
  iso3: string;
  /** Panels that can say something specific about this country. */
  present: string[];
  /** Panels that were checked and had nothing for it. */
  absent: string[];
  band: CoverageBand;
  /** `present.length / (present.length + absent.length)`, or null when nothing was checked. */
  share: number | null;
}

/**
 * The panels a coverage figure is computed over, named explicitly.
 *
 * A hardcoded denominator is how a coverage percentage silently changes meaning
 * when a panel is added — the number moves for every country at once and
 * nothing says why. Listing them makes the denominator a fact about a specific
 * build.
 */
export const COVERED_PANELS = ['dossier', 'government', 'legislature', 'military', 'economy', 'news', 'tv'] as const;

export type CoveredPanel = (typeof COVERED_PANELS)[number];

/**
 * Bands rather than a continuous scale.
 *
 * A continuous colour ramp over seven panels implies a precision the input does
 * not have: the difference between 3/7 and 4/7 is one panel having a fixture,
 * not a meaningful difference in how well-known a country is. Four bands say
 * roughly-how-much without inviting a comparison the data cannot support.
 */
export function bandFor(present: number, checked: number): CoverageBand {
  if (checked === 0) return 'none';
  if (present === 0) return 'none';
  const share = present / checked;
  if (share >= 0.75) return 'good';
  if (share >= 0.4) return 'partial';
  return 'sparse';
}

export interface CoverageInput {
  iso3: string;
  /** Which panels have something specific for this country. */
  panelsWithData: ReadonlySet<string>;
}

export function coverageFor(input: CoverageInput): CountryCoverage {
  const present: string[] = [];
  const absent: string[] = [];

  for (const panel of COVERED_PANELS) {
    if (input.panelsWithData.has(panel)) present.push(panel);
    else absent.push(panel);
  }

  const checked = present.length + absent.length;
  return {
    iso3: input.iso3,
    present,
    absent,
    band: bandFor(present.length, checked),
    share: checked === 0 ? null : present.length / checked,
  };
}

/**
 * ## Dual encoding, required by Phase B1 and not decorative
 *
 * A choropleth that encodes coverage in hue alone is unreadable to a material
 * fraction of readers — and "unreadable" for a surface whose entire job is to
 * communicate absence means it communicates nothing to them.
 *
 * So every band carries **three** independent signals: a hue, a lightness that
 * is monotonic with the band, and a word. The word is the one that survives
 * everything, including a greyscale printout and a screen reader.
 */
export interface BandEncoding {
  fill: string;
  /** Monotonic 0..1. Distinguishable without hue, in band order. */
  lightness: number;
  label: string;
  /** What the band means, in a sentence a reader can act on. */
  meaning: string;
}

export const BAND_ENCODING: Record<CoverageBand, BandEncoding> = {
  none: {
    fill: '#2b2b33',
    lightness: 0.17,
    label: 'Nothing',
    meaning: 'No panel has anything specific for this country.',
  },
  sparse: {
    fill: '#4a4560',
    lightness: 0.34,
    label: 'Sparse',
    meaning: 'Fewer than two panels in five have anything.',
  },
  partial: {
    fill: '#6f6699',
    lightness: 0.55,
    label: 'Partial',
    meaning: 'Between two and three panels in four have something.',
  },
  good: {
    fill: '#a99ede',
    lightness: 0.78,
    label: 'Most panels',
    meaning: 'Three panels in four or more have something.',
  },
};

/**
 * The sentence a country's coverage gets — and why it never says the country
 * has no data.
 *
 * "No data for Chad" is a claim a reader will hear as a fact about Chad. What
 * is true is that THIS APP has nothing, which is a fact about this app, and the
 * wording keeps the subject where it belongs.
 */
export function coverageSentence(coverage: CountryCoverage): string {
  if (coverage.band === 'none') {
    return 'This app has nothing specific for this country on any panel. That is a gap in what ' +
      'has been connected here, not a finding about the country.';
  }
  return `${coverage.present.length} of ${coverage.present.length + coverage.absent.length} panels ` +
    'have something specific for this country. The rest have nothing connected yet.';
}

/**
 * Countries that are not in the coverage set at all.
 *
 * NOT the same as a country with zero panels, and this function exists so the
 * caller cannot accidentally treat them alike: a country absent from the input
 * was never assessed, and painting it as "Nothing" would assert a measurement
 * nobody took.
 */
export function unassessed(all: readonly string[], assessed: ReadonlyMap<string, CountryCoverage>): string[] {
  return all.filter((iso3) => !assessed.has(iso3));
}

/**
 * Which panels have something for a country.
 *
 * **The caller supplies every panel's answer, including news.** The first draft
 * derived news coverage from the globe's event set by matching `event.iso3` —
 * a field `GlobeEvent` does not have, and deliberately: events carry a
 * coordinate and a `positionFact`, not a country key, because assigning a point
 * to a country is a spatial join this app does not perform.
 *
 * Inventing that join here would have produced a coverage figure whose news
 * column was quietly wrong for every country whose events sit near a border —
 * and wrong in a way no test would notice, since the number would still look
 * plausible.
 */
export function panelsWithDataFor(has: Record<CoveredPanel, boolean>): Set<string> {
  const panels = new Set<string>();
  for (const panel of COVERED_PANELS) {
    if (has[panel]) panels.add(panel);
  }
  return panels;
}
