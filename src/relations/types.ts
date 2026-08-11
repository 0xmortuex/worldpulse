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
}

/** A finding with its weight applied and its age resolved. */
export interface ScoredInput extends Finding {
  weight: number;
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
