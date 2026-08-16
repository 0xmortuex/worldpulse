import { notAFact } from '../facts/discipline';
import type { Finding, InputKind, RelationResult, ScoredInput, Thresholds, Tier, Weights } from './types';

/**
 * Default weights. Documented in the README, adjustable at runtime.
 *
 * These encode an opinion, not a fact: reasonable people weight a shared
 * defence treaty against an active territorial dispute differently. The sliders
 * and the traceability popover exist so the opinion is visible and arguable
 * rather than baked in.
 */
export const DEFAULT_WEIGHTS: Weights = {
  sharedDefenseBloc: 3,
  bilateralDefenseTreaty: 3,
  intelSharing: 2,
  sharedEconomicBloc: 1,
  historicalAlliance: 2,
  activeConflict: -6,
  severedRelations: -4,
  mutualSanctions: -4,
  oneWaySanctions: -2,
  territorialDispute: -2,
  recalledAmbassador: -1,
};

export const DEFAULT_THRESHOLDS: Thresholds = {
  ally: 3,
  adversary: -4,
  strained: -1,
};

/** Evidence older than this many years is greyed and counts toward low confidence. */
export const STALE_AFTER_YEARS = 5;

export const INPUT_LABELS: Record<InputKind, string> = {
  sharedDefenseBloc: 'Shared defence bloc',
  bilateralDefenseTreaty: 'Bilateral defence treaty',
  intelSharing: 'Intelligence-sharing arrangement',
  sharedEconomicBloc: 'Shared economic bloc',
  historicalAlliance: 'Historical alliance (archival dataset)',
  activeConflict: 'Active state-based conflict',
  severedRelations: 'Severed or absent diplomatic relations',
  mutualSanctions: 'Mutual sanctions',
  oneWaySanctions: 'One-directional sanctions',
  territorialDispute: 'Territorial dispute',
  recalledAmbassador: 'Recalled ambassador',
};

/**
 * A relation weight, signed, for display.
 *
 * Weights come from the sliders — they are this app's editable opinion about
 * what counts, not a measurement of anything — so they render through
 * `notAFact` rather than as badged facts. It lives here, in one place, because
 * two copies of this formatter existed and both were quietly laundering a number
 * into a string on the way to the DOM: the discipline rule sees a `string` and
 * waves it through, so an unsanctioned wrapper is a hole in the rule.
 */
export function signedWeight(value: number | null): string {
  /**
   * A null weight is a question that was asked and not answered, and it must
   * not render as a number.
   *
   * Rendering it as "0" or "+0" would put an unanswered question into the
   * arithmetic as though it were evidence that weighed nothing — the exact
   * conflation question 13 removed from the model, reintroduced at the last
   * step before the DOM.
   */
  if (value === null) return 'no value';

  const text = notAFact(
    value,
    'relation weight set by the user with a slider — this app\'s editable opinion about what counts, not data from any source',
  );
  return value > 0 ? `+${text}` : text;
}

/** Order-independent key for a country pair. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Apply weights to a pair's findings and resolve a tier.
 *
 * `currentYear` is injected rather than read from the clock so the time-scrub
 * feature in step 13 can score a pair as it would have been scored on a past
 * date without this module needing to know that time travel exists.
 */
export function score(
  subject: string,
  other: string,
  findings: readonly Finding[] | undefined,
  weights: Weights,
  thresholds: Thresholds,
  currentYear: number,
): RelationResult {
  if (!findings || findings.length === 0) {
    return {
      subject,
      other,
      tier: 'nodata',
      score: 0,
      inputs: [],
      staleWeightShare: 0,
      lowConfidence: false,
    };
  }

  const inputs: ScoredInput[] = findings.map((finding) => {
    const ageYears = Math.max(0, currentYear - finding.coverageEnd);
    return {
      ...finding,
      /**
       * Question 13: a finding the source was asked for and did not supply
       * keeps its row and gets a null weight. It is not the same as a finding
       * nobody asked about, which is simply not here.
       */
      weight: finding.empty === true ? null : weights[finding.kind],
      ageYears,
      stale: ageYears > STALE_AFTER_YEARS,
    };
  });

  /**
   * Empty inputs contribute nothing to any total.
   *
   * Treating a null as 0 would be the quiet version of the bug this fix
   * exists to remove: it would make an unanswered question look like evidence
   * that netted out to nothing, which is precisely the confusion between "no
   * answer" and "an answer of none".
   */
  const answered = inputs.filter((input) => input.weight !== null);
  const total = answered.reduce((sum, input) => sum + (input.weight ?? 0), 0);

  // Share is computed over absolute weight so a stale +2 and a stale -2 both
  // count as evidence we are leaning on, regardless of which way they push.
  const absoluteTotal = answered.reduce((sum, input) => sum + Math.abs(input.weight ?? 0), 0);
  const staleAbsolute = answered
    .filter((input) => input.stale)
    .reduce((sum, input) => sum + Math.abs(input.weight ?? 0), 0);
  const staleWeightShare = absoluteTotal === 0 ? 0 : staleAbsolute / absoluteTotal;

  const tier = resolveTier(total, thresholds);

  // Applies to every tier that rests on actual evidence, neutral included: a
  // pair known only through a dataset that stopped in 2012 must not read the
  // same as one where current evidence genuinely nets out to nothing. Neutral's
  // muted palette entry is identical to its normal one, so the distinction
  // surfaces in the popover and the panel rather than as a misleading colour.
  // Only 'nodata' is exempt, having no evidence to be stale about.
  const lowConfidence = staleWeightShare > 0.5 && tier !== 'nodata';

  /**
   * Strongest evidence first, so the popover leads with what drove the call —
   * and consulted-but-empty inputs sort LAST rather than as zero-weight.
   *
   * Sorting them by |0| would scatter them among genuinely neutral findings,
   * where a reader would take them for evidence that weighed nothing rather
   * than for questions that went unanswered.
   */
  inputs.sort((a, b) => {
    if ((a.weight === null) !== (b.weight === null)) return a.weight === null ? 1 : -1;
    return Math.abs(b.weight ?? 0) - Math.abs(a.weight ?? 0);
  });

  return { subject, other, tier, score: total, inputs, staleWeightShare, lowConfidence };
}

function resolveTier(total: number, thresholds: Thresholds): Tier {
  if (total >= thresholds.ally) return 'ally';
  if (total <= thresholds.adversary) return 'adversary';
  if (total <= thresholds.strained) return 'strained';
  return 'neutral';
}

/** Score `subject` against every country that has findings. */
export function scoreAll(
  subject: string,
  index: ReadonlyMap<string, Finding[]>,
  allCountries: readonly string[],
  weights: Weights,
  thresholds: Thresholds,
  currentYear: number,
): Map<string, RelationResult> {
  const results = new Map<string, RelationResult>();
  for (const other of allCountries) {
    if (other === subject) continue;
    results.set(other, score(subject, other, index.get(pairKey(subject, other)), weights, thresholds, currentYear));
  }
  return results;
}
