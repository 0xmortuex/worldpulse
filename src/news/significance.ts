/**
 * Step 7's significance ranking — `[DERIVED]`, and the whole surface says so.
 *
 * "Biggest story of the month" is an editorial judgement, and this project has
 * spent nine steps refusing to make unexplained ones. So the ranking is
 * computed from stated inputs using exactly the relations-score pattern:
 * weighted inputs, visible arithmetic, adjustable weights.
 *
 * ## Normalisation is part of the definition, not an implementation detail
 *
 * The score sums inputs measured in **different things** — outlet counts, days,
 * country counts, a boolean. Rule 22 forbids aggregating across units, and
 * `12 outlets + 9 days + 4 countries` is exactly the incoherent arithmetic it
 * names.
 *
 * The sum is legitimate **only because** each input is normalised to a unitless
 * [0, 1] contribution before weighting. Every normaliser below states its bound
 * and what saturates it, and `contributionsOf` returns the raw measurement
 * beside the normalised value so a reader can see that 15 outlets became 1.0
 * and why.
 *
 * ## What the score is NOT
 *
 * It ranks **coverage volume, not importance**, and it ranks the coverage of
 * **fifteen named English-language feeds**. Two of the five inputs are hard-
 * capped by that corpus: a story in 400 outlets worldwide and a story in all 15
 * of ours score identically on breadth. A reader who assumes a global corpus
 * reads that ceiling as a finding about the world.
 */

export type SignificanceInput =
  | 'outletBreadth'
  | 'syndicationVolume'
  | 'coverageDuration'
  | 'geographicSpread'
  | 'eventLinkage';

export interface StoryMeasurements {
  /** Distinct outlets carrying the story. Capped by the curated feed count. */
  outlets: number;
  /** Total article count across those outlets. */
  articles: number;
  /** Days the story has been covered. */
  days: number;
  /** Distinct countries whose feeds carry it. */
  countries: number;
  /**
   * Whether the story maps to a tracked event.
   *
   * `null` means NOT CONSULTED — the event index was unavailable — which is a
   * different fact from `false` (checked, no linkage). Question 13's
   * distinction, applied here from the start rather than retrofitted.
   */
  linkedToTrackedEvent: boolean | null;
}

/**
 * The corpus ceiling, named as a constant because it is a property of OUR feed
 * list rather than of the world, and because the surface has to state it.
 */
export const CURATED_FEED_COUNT = 15;

/** Saturation points, each stated with the reason it sits where it does. */
export const SATURATION = {
  /** Every curated feed carrying it is the maximum observable breadth. */
  outlets: CURATED_FEED_COUNT,
  /** Beyond ~40 copies the feeds are recycling wire text, not adding coverage. */
  articles: 40,
  /** A fortnight of continuous coverage is sustained by any measure available here. */
  days: 14,
  /** Half the curated feeds' countries carrying it is the practical ceiling. */
  countries: 8,
} as const;

export const DEFAULT_SIGNIFICANCE_WEIGHTS: Record<SignificanceInput, number> = {
  outletBreadth: 3,
  syndicationVolume: 1,
  coverageDuration: 2,
  geographicSpread: 3,
  eventLinkage: 2,
};

export interface Contribution {
  input: SignificanceInput;
  /** What was measured, in its own units, for the popover's left column. */
  raw: number | boolean | null;
  rawUnit: string;
  /** Unitless [0, 1], or null when the input was not consulted. */
  normalised: number | null;
  weight: number;
  /** `normalised * weight`, or null when unconsulted. */
  contribution: number | null;
}

/** Linear ramp to a stated saturation point. Never exceeds 1. */
function ramp(value: number, saturation: number): number {
  if (saturation <= 0) return 0;
  return Math.min(1, Math.max(0, value / saturation));
}

export function contributionsOf(
  story: StoryMeasurements,
  weights: Record<SignificanceInput, number> = DEFAULT_SIGNIFICANCE_WEIGHTS,
): Contribution[] {
  const linkage = story.linkedToTrackedEvent;

  return [
    {
      input: 'outletBreadth',
      raw: story.outlets,
      rawUnit: `of ${CURATED_FEED_COUNT} curated outlets`,
      normalised: ramp(story.outlets, SATURATION.outlets),
      weight: weights.outletBreadth,
      contribution: ramp(story.outlets, SATURATION.outlets) * weights.outletBreadth,
    },
    {
      input: 'syndicationVolume',
      raw: story.articles,
      rawUnit: 'articles',
      normalised: ramp(story.articles, SATURATION.articles),
      weight: weights.syndicationVolume,
      contribution: ramp(story.articles, SATURATION.articles) * weights.syndicationVolume,
    },
    {
      input: 'coverageDuration',
      raw: story.days,
      rawUnit: 'days',
      normalised: ramp(story.days, SATURATION.days),
      weight: weights.coverageDuration,
      contribution: ramp(story.days, SATURATION.days) * weights.coverageDuration,
    },
    {
      input: 'geographicSpread',
      raw: story.countries,
      rawUnit: 'countries',
      normalised: ramp(story.countries, SATURATION.countries),
      weight: weights.geographicSpread,
      contribution: ramp(story.countries, SATURATION.countries) * weights.geographicSpread,
    },
    {
      input: 'eventLinkage',
      raw: linkage,
      rawUnit: 'tracked event',
      /**
       * NOT CONSULTED stays null all the way through rather than collapsing to
       * 0. A zero contribution says "we checked and there is no linkage"; null
       * says "we did not check". Scoring them alike is the conflation
       * question 13 removed from the relations engine, and there is no reason
       * to reintroduce it in a new surface.
       */
      normalised: linkage === null ? null : linkage ? 1 : 0,
      weight: weights.eventLinkage,
      contribution: linkage === null ? null : (linkage ? 1 : 0) * weights.eventLinkage,
    },
  ];
}

export interface SignificanceScore {
  score: number;
  contributions: Contribution[];
  /** Inputs that were not consulted. Disclosed, never absorbed. */
  unconsulted: SignificanceInput[];
}

export function significanceOf(
  story: StoryMeasurements,
  weights: Record<SignificanceInput, number> = DEFAULT_SIGNIFICANCE_WEIGHTS,
): SignificanceScore {
  const contributions = contributionsOf(story, weights);
  const answered = contributions.filter((entry) => entry.contribution !== null);

  return {
    score: answered.reduce((sum, entry) => sum + (entry.contribution ?? 0), 0),
    contributions,
    unconsulted: contributions
      .filter((entry) => entry.contribution === null)
      .map((entry) => entry.input),
  };
}

/**
 * Scores within this distance are a TIED BAND, not an ordering.
 *
 * The spec is explicit: ties must not present as ranks 4, 5, 6. A hundredth of
 * a point between two stories is noise in the inputs, and rendering it as an
 * ordering asserts a precision the measurement does not have.
 */
export const TIE_EPSILON = 0.25;

export interface RankedStory<T> {
  story: T;
  score: SignificanceScore;
  /** Shared by every story in a tied band. 1-based. */
  rank: number;
  /** True when more than one story holds this rank. */
  tied: boolean;
}

export function rank<T>(
  stories: readonly T[],
  measure: (story: T) => StoryMeasurements,
  weights: Record<SignificanceInput, number> = DEFAULT_SIGNIFICANCE_WEIGHTS,
): Array<RankedStory<T>> {
  const scored = stories
    .map((story) => ({ story, score: significanceOf(measure(story), weights) }))
    .sort((a, b) => b.score.score - a.score.score);

  const ranked: Array<RankedStory<T>> = [];
  let currentRank = 0;
  let bandLeader: number | null = null;

  for (const entry of scored) {
    if (bandLeader === null || bandLeader - entry.score.score > TIE_EPSILON) {
      currentRank = ranked.length + 1;
      bandLeader = entry.score.score;
    }
    ranked.push({ ...entry, rank: currentRank, tied: false });
  }

  // A rank held by more than one story is a band, and both members must know.
  const counts = new Map<number, number>();
  for (const entry of ranked) counts.set(entry.rank, (counts.get(entry.rank) ?? 0) + 1);
  return ranked.map((entry) => ({ ...entry, tied: (counts.get(entry.rank) ?? 0) > 1 }));
}

/**
 * THE CAVEAT IS THE HEADLINE, NOT A FOOTNOTE.
 *
 * It has to say three things, and the third is the one most surfaces omit:
 * what is ranked, that it is not importance, and **whose** coverage — because a
 * reader assuming a global corpus reads our fifteen-feed ceiling as a finding
 * about the world.
 */
export const SIGNIFICANCE_CAVEAT =
  'This ranks COVERAGE VOLUME, not importance. A story covered by many outlets is not ' +
  `thereby more important, and a story the press ignores scores zero. It measures ${CURATED_FEED_COUNT} ` +
  'curated English-language feeds — so coverage of the places those outlets cover least is ' +
  'systematically thinner here, which the score reads as less significant rather than as ' +
  'less covered by us.';
