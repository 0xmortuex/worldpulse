import type { Tier } from './relations/types';

/**
 * Tier colours, from the Okabe–Ito colourblind-safe categorical palette.
 *
 * Chosen by measurement, not by eye — `scripts/cvd.mjs` simulates the three
 * dichromacies and reports pairs that collapse, and `tests/cvd-palette.test.ts`
 * fails the build if any pair does. The previous palette had two collisions,
 * and neither was the one the spec predicted:
 *
 *   adversary #f0553d vs strained #d99024 — ΔE 13.2 under deuteranopia. The two
 *     tiers a reader most needs to tell apart, indistinguishable to roughly one
 *     man in twelve.
 *   neutral #3d444d vs nodata #20242a — ΔE ~14.7 under ALL THREE, and near
 *     identical to normal vision too. That pair is this project's own central
 *     distinction wearing one colour: `neutral` means evidence exists and nets
 *     out, `nodata` means there is no evidence at all. Rendering them alike says
 *     "we looked and found balance" and "we did not look" in the same breath.
 *
 * `strained` is yellow rather than the more obvious orange because orange
 * measured ΔE 18.4 against vermillion under deuteranopia — under the bar. Yellow
 * measures 33.4.
 *
 * COLOUR IS NEVER THE ONLY CHANNEL. Every tier also carries a glyph
 * (`TIER_GLYPH`) and its label in text. The globe's polygon fill is necessarily
 * colour alone, which is why nothing is knowable only from the globe: the
 * popover names the tier, and the relations list carries glyph and label.
 */
export const TIER_COLORS: Record<Tier, string> = {
  ally: '#0072B2',
  adversary: '#D55E00',
  strained: '#F0E442',
  neutral: '#999999',
  nodata: '#3d444d',
};

/**
 * Low-confidence variants: same hue, visibly dimmer.
 *
 * Deliberately NOT distinguished from their base by hue, because they are the
 * same classification — what differs is how much evidence stands behind it. The
 * non-colour channel for this distinction is the `low conf.` tag in the list,
 * not the swatch, so a reader who cannot see the dimming still gets told.
 */
export const TIER_COLORS_LOW_CONFIDENCE: Record<Tier, string> = {
  ally: '#00446b',
  adversary: '#6a2f00',
  strained: '#8f8a1f',
  neutral: '#5b5b5b',
  nodata: '#15181b',
};

/**
 * The shape channel. Direction carries meaning where it can: a relation that
 * helps points up, one that harms points down.
 */
export const TIER_GLYPH: Record<Tier, string> = {
  ally: '▲',
  adversary: '▼',
  strained: '◆',
  neutral: '●',
  nodata: '○',
};

export const TIER_LABELS: Record<Tier, string> = {
  ally: 'Ally',
  adversary: 'Adversary',
  strained: 'Strained',
  neutral: 'Neutral',
  nodata: 'No data',
};

export const TIER_DESCRIPTIONS: Record<Tier, string> = {
  ally: 'Formal defence treaty or shared defence bloc.',
  adversary: 'Active state-based conflict, severed relations, or heavy mutual sanctions.',
  strained: 'One-directional sanctions, recalled ambassadors, or an active territorial dispute.',
  neutral: 'Evidence exists but nets out to no significant relation.',
  nodata: 'No evidence in the fact tables. Not a claim that no relation exists.',
};

/**
 * The subject deliberately sits outside the tier palette. An earlier amber
 * selection was near-indistinguishable from the amber "strained" tier, so
 * sanctioned countries read as though they were also selected.
 */
export const SELECTION_COLOR = '#e6edf3';
export const SELECTION_STROKE = '#ffffff';
export const BASE_STROKE = '#12161b';
export const GLOBE_COLOR = '#0d1117';
