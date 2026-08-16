import { contributingShortfall, type Fact, type DerivedProvenance, type SeedProvenance } from '../facts/types';
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
  /**
   * The arithmetic shows only inputs that HAVE a value, and says how many did
   * not.
   *
   * Writing "+2 null -1 = 1" would be arithmetic nobody can check. Omitting the
   * empty ones without saying so would restate the bug question 13 fixed — the
   * formula would look complete while resting on fewer inputs than were
   * consulted. So they are excluded from the sum and counted in words.
   */
  const answered = result.inputs.filter((input) => input.weight !== null);
  const unanswered = result.inputs.length - answered.length;
  const sum =
    answered.length === 0
      ? 'no inputs'
      : `${answered.map((input) => ((input.weight ?? 0) > 0 ? `+${input.weight}` : String(input.weight))).join(' ')} = ${result.score}`;
  const formula = unanswered === 0 ? sum : `${sum} (${unanswered} consulted, no value)`;

  const provenance: DerivedProvenance = {
    kind: 'derived',
    computedBy: 'src/relations/score.ts',
    formula,
    // Deterministic given the inputs, so it is stamped with the seed's compile
    // date rather than the wall clock — otherwise every render would look like
    // a fresh computation with new information behind it.
    computedAt: compiledAt,
    /**
     * Each input is a Fact, so the derivation can see what the input WAS, not
     * only where it came from. The value is the weight the finding contributed,
     * which is exactly the quantity the formula above sums.
     *
     * **CONTRIBUTING, not required** — the semantic judgement P3 asks for. A
     * relation score is a sum: losing one finding leaves the others summable, so
     * the score is still a real number. Marking these required would make a
     * single empty finding render the whole classification as "no data", which
     * would be a bigger lie than the shortfall it was meant to disclose.
     *
     * What a shortfall earns instead is a caveat, attached below. Compare the
     * centroid and age derivations, where the single input genuinely IS the
     * computation and is therefore required.
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
      required: false,
    })),
  };

  /**
   * P3's caveat: a shortfall among contributing inputs is disclosed, never
   * silently absorbed.
   *
   * Both notes can apply at once — evidence can be stale AND incomplete — so
   * they are joined rather than one winning. A reader told only the more
   * dramatic of two problems has been told something incomplete about
   * completeness, which is a poor joke to play in this particular panel.
   */
  const shortfall = contributingShortfall(provenance);
  const notes = [
    result.lowConfidence
      ? `${Math.round(result.staleWeightShare * 100)}% of the evidence weight is over five years old. Treat as provisional.`
      : null,
    shortfall
      ? `${shortfall.missing} of ${shortfall.contributing} contributing findings returned no value, so this score rests on fewer inputs than were consulted.`
      : null,
  ].filter((note): note is string => note !== null);

  return {
    // No inputs means no classification, not a score of zero.
    value: result.inputs.length === 0 ? null : result.score,
    asOf: compiledAt,
    tier: 'DERIVED',
    provenance,
    ...(notes.length === 0 ? {} : { note: notes.join(' ') }),
    format: (value: number) => (value > 0 ? `+${value}` : String(value)),
  };
}
