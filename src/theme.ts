import type { Tier } from './relations/types';

/**
 * Tier colours. The low-confidence variants are deliberately desaturated and
 * darker: a classification resting on stale evidence must not read as a
 * confident blue or red at a glance.
 */
export const TIER_COLORS: Record<Tier, string> = {
  ally: '#2f81f7',
  adversary: '#f0553d',
  strained: '#d99024',
  neutral: '#3d444d',
  nodata: '#20242a',
};

export const TIER_COLORS_LOW_CONFIDENCE: Record<Tier, string> = {
  ally: '#2c4a6e',
  adversary: '#6b3a33',
  strained: '#63502a',
  neutral: '#3d444d',
  nodata: '#20242a',
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
