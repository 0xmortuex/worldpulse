/** Relation tiers as rendered on the globe. */
export type Tier = 'ally' | 'adversary' | 'strained' | 'neutral' | 'nodata';

/**
 * Every distinct kind of evidence the engine understands. Each maps to exactly
 * one adjustable weight, so the arithmetic shown in the traceability popover is
 * the arithmetic that actually ran.
 */
export type InputKind =
  | 'sharedDefenseBloc'
  | 'bilateralDefenseTreaty'
  | 'intelSharing'
  | 'sharedEconomicBloc'
  | 'historicalAlliance'
  | 'activeConflict'
  | 'severedRelations'
  | 'mutualSanctions'
  | 'oneWaySanctions'
  | 'territorialDispute'
  | 'recalledAmbassador';

export type Weights = Record<InputKind, number>;

export interface Thresholds {
  /** Score at or above which a pair is an ally. */
  ally: number;
  /** Score at or below which a pair is an adversary. */
  adversary: number;
  /** Score at or below which a pair is strained (evaluated after adversary). */
  strained: number;
}

/**
 * A fact about a country pair, before any weight is applied. Findings are
 * computed once from the fact tables; weights are applied on every slider move.
 * Keeping them separate is what makes live recolouring cheap.
 */
export interface Finding {
  kind: InputKind;
  label: string;
  source: string;
  sourceUrl: string;
  /** Year through which the underlying dataset is asserted to hold. */
  coverageEnd: number;
  /** Caveat shown in the popover — contested membership, frozen status, etc. */
  note?: string;
  /**
   * The source was asked about this pair and returned no value.
   *
   * Absent (the normal case) means the finding carries a value. Present and
   * true means it does not, and the difference must survive into `ScoredInput`
   * rather than being flattened by omitting the row.
   */
  empty?: true;
}

/**
 * A finding with its weight applied and its age resolved.
 *
 * ## `weight: null` means CONSULTED AND EMPTY — question 13's fix
 *
 * The engine used to have one representation for two different facts:
 *
 * | Fact about the world | How it was recorded |
 * | --- | --- |
 * | we never consulted this finding | not in the array |
 * | we consulted it and it had no value | **also not in the array** |
 *
 * That is rule 30 conflated by omission, in the app's own scoring engine — the
 * one place it did not enforce the distinction it enforces everywhere else.
 *
 * A null weight is an input that WAS consulted and returned nothing. It stays
 * in `inputs` so the count of what was consulted stays honest, contributes
 * nothing to the score, and makes `contributingShortfall` reachable: the
 * disclosure mechanism shipped in commit 5 had no caller that could trigger it.
 *
 * It does not bite on the seed table, where every entry has a weight by
 * construction. It bites the moment a live ingest answers "asked, nothing
 * there".
 */
export interface ScoredInput extends Finding {
  weight: number | null;
  ageYears: number;
  stale: boolean;
}

export interface RelationResult {
  subject: string;
  other: string;
  tier: Tier;
  score: number;
  inputs: ScoredInput[];
  /** Share of total absolute weight contributed by stale inputs, 0..1. */
  staleWeightShare: number;
  /**
   * True when a blue/red/amber classification rests mostly on stale evidence.
   * These render in a distinct muted treatment rather than a confident colour.
   */
  lowConfidence: boolean;
}
