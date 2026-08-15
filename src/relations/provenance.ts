import type { Fact, DerivedProvenance, SeedProvenance } from '../facts/types';
import type { RelationResult, ScoredInput } from './types';

/**
 * Bridges a relation result into a Fact, so the score is rendered by the same
 * badge component as everything else rather than as a bare number.
 *
 * The score is genuinely DERIVED: no source reports it. Its provenance carries
 * the arithmetic and the seed provenance of every input, so the inspector can
 * walk from the number to each hand-checked citation behind it.
 */

const SEED_FILE = 'data/relations-seed.json';

function seedProvenance(input: ScoredInput, compiledAt: string): SeedProvenance {
  return {
    kind: 'seed',
    file: SEED_FILE,
    source: input.source,
    sourceUrl: input.sourceUrl,
    coverageEnd: input.coverageEnd,
    compiledAt,
    ...(input.note === undefined ? {} : { note: input.note }),
  };
}

export function scoreFact(result: RelationResult, compiledAt: string): Fact<number> {
  const formula =
    result.inputs.length === 0
      ? 'no inputs'
      : `${result.inputs.map((input) => (input.weight > 0 ? `+${input.weight}` : String(input.weight))).join(' ')} = ${result.score}`;

  const provenance: DerivedProvenance = {
    kind: 'derived',
    computedBy: 'src/relations/score.ts',
    formula,
    // Deterministic given the inputs, so it is stamped with the seed's compile
    // date rather than the wall clock — otherwise every render would look like
    // a fresh computation with new information behind it.
    computedAt: compiledAt,
    /**
     * Each input is now a Fact, so the derivation can see what the input WAS,
     * not only where it came from. The value is the weight the finding
     * contributed, which is exactly the quantity the formula above sums.
     *
     * `required: true` everywhere for now — fail closed. Which of these merely
     * contribute rather than being load-bearing is a semantic judgement, and it
     * lands with the semantics in the next commit rather than being guessed at
     * here where it would change nothing and be forgotten.
     */
    inputs: result.inputs.map((input) => ({
      fact: {
        value: input.weight,
        // coverageEnd is a year; asOf is a date string. The seed's compile date
        // stands in when a finding records no coverage end of its own.
        asOf: input.coverageEnd === undefined ? compiledAt : String(input.coverageEnd),
        tier: 'OFFICIAL' as const,
        provenance: seedProvenance(input, compiledAt),
      },
      required: true,
    })),
  };

  return {
    // No inputs means no classification, not a score of zero.
    value: result.inputs.length === 0 ? null : result.score,
    asOf: compiledAt,
    tier: 'DERIVED',
    provenance,
    ...(result.lowConfidence
      ? {
          note: `${Math.round(result.staleWeightShare * 100)}% of the evidence weight is over five years old. Treat as provisional.`,
        }
      : {}),
    format: (value: number) => (value > 0 ? `+${value}` : String(value)),
  };
}
