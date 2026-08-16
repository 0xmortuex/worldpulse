import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contributingShortfall } from '../src/facts/types';
import { scoreFact } from '../src/relations/provenance';
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, score, signedWeight } from '../src/relations/score';
import type { Finding } from '../src/relations/types';

/**
 * OPEN-QUESTIONS 13 — "consulted and came back empty", now representable.
 *
 * The engine had ONE representation for TWO facts:
 *
 *   we never consulted this finding   -> not in the array
 *   we consulted it and it was empty  -> also not in the array
 *
 * That is rule 30 conflated by omission, inside the scoring engine of an app
 * built to refuse exactly that conflation everywhere else. These tests hold the
 * two apart at every layer it has to survive: the score, the arithmetic, the
 * provenance, and the string that reaches the DOM.
 *
 * **What these tests do NOT prove** is that any production path produces the
 * state. Relations run on a seed table where every entry has a value by
 * construction; the first real one arrives with a live ingest. That is recorded
 * in `p3-reachability.test.ts`, which is the file that will fail when it
 * changes.
 */

const COMPILED_AT = '2026-01-01';

function finding(kind: Finding['kind'], over: Partial<Finding> = {}): Finding {
  return {
    kind,
    label: `${kind} finding`,
    source: 'test',
    sourceUrl: 'https://example.invalid/',
    coverageEnd: 2026,
    ...over,
  };
}

function scoreWith(findings: Finding[]) {
  return score('AAA', 'BBB', findings, DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS, 2026);
}

describe('a consulted-and-empty input is not an absent one', () => {
  it('stays in the input list rather than vanishing', () => {
    /**
     * The whole point. Dropping the row is what made the two facts identical,
     * so the row survives and carries a null weight.
     */
    const result = scoreWith([finding('bloc'), finding('treaty', { empty: true })]);
    assert.equal(result.inputs.length, 2, 'the empty input was dropped, which is the original bug');
    assert.equal(result.inputs.filter((input) => input.weight === null).length, 1);
  });

  it('contributes nothing to the score — and is not counted as zero', () => {
    /**
     * Treating null as 0 is the quiet version of the same bug: an unanswered
     * question would look like evidence that netted out to nothing.
     *
     * Proven by comparison rather than by asserting a magic number: the score
     * with an extra EMPTY input must equal the score without it.
     */
    const withoutIt = scoreWith([finding('bloc')]);
    const withIt = scoreWith([finding('bloc'), finding('treaty', { empty: true })]);
    assert.equal(withIt.score, withoutIt.score);
    assert.equal(withIt.tier, withoutIt.tier);
  });

  it('does not drag the stale share toward zero', () => {
    // staleWeightShare divides by total absolute weight. Including empties in
    // that denominator would silently dilute the staleness warning.
    const stale = finding('historical-alliance', { coverageEnd: 2012 });
    const withoutIt = scoreWith([stale]);
    const withIt = scoreWith([stale, finding('treaty', { empty: true })]);
    assert.equal(withIt.staleWeightShare, withoutIt.staleWeightShare);
    assert.equal(withIt.lowConfidence, withoutIt.lowConfidence);
  });

  it('sorts last, so it is not mistaken for weightless evidence', () => {
    const result = scoreWith([
      finding('treaty', { empty: true }),
      finding('bloc'),
      finding('conflict'),
    ]);
    assert.equal(result.inputs[result.inputs.length - 1]?.weight, null);
  });

  it('an entirely empty input set still scores as evidence, not as nodata', () => {
    /**
     * A genuinely important distinction, and the one most likely to be got
     * wrong later. `nodata` means WE HAVE NOTHING. A pair where every source
     * was asked and every one came back empty is a different fact: it was
     * investigated. The tier is whatever an empty sum resolves to — neutral —
     * and the shortfall caveat is what says the inputs were unanswered.
     */
    const result = scoreWith([finding('bloc', { empty: true }), finding('treaty', { empty: true })]);
    assert.notEqual(result.tier, 'nodata', 'asked-and-empty was collapsed back into never-asked');
    assert.equal(result.score, 0);
    assert.equal(result.inputs.length, 2);
  });

  it('a pair with NO findings is still nodata — the other side of that pair', () => {
    // Rule 42's shape applied to a state rather than a disclosure: the
    // distinction above only means something if the opposite case still works.
    const result = scoreWith([]);
    assert.equal(result.tier, 'nodata');
    assert.equal(result.inputs.length, 0);
  });
});

describe('the disclosure it makes reachable', () => {
  it('contributingShortfall now fires on a real score', () => {
    /**
     * THE MECHANISM THAT HAD NO CALLER.
     *
     * `contributingShortfall` and the caveat in provenance.ts shipped with 12
     * planted unit tests and no construction site able to produce the state —
     * UNEXERCISED-PATHS §14, the "built, tested, uncalled" class. This is the
     * first time the engine itself can hand it one.
     */
    const result = scoreWith([finding('bloc'), finding('treaty', { empty: true })]);
    const fact = scoreFact(result, COMPILED_AT);
    const shortfall = contributingShortfall(fact.provenance);

    assert.ok(shortfall, 'the shortfall did not fire, so the mechanism still has no caller');
    assert.equal(shortfall.missing, 1);
    assert.equal(shortfall.contributing, 2);
  });

  it('and does NOT fire when every input answered', () => {
    // Rule 42: a disclosure that fires unconditionally discloses nothing.
    const result = scoreWith([finding('bloc'), finding('treaty')]);
    assert.equal(contributingShortfall(scoreFact(result, COMPILED_AT).provenance), null);
  });

  it('the arithmetic excludes empties and says how many there were', () => {
    /**
     * "+2 null -1 = 1" is arithmetic nobody can check. Silently omitting them
     * restates the bug — a formula that looks complete while resting on fewer
     * inputs than were consulted. So: excluded from the sum, counted in words.
     */
    const result = scoreWith([finding('bloc'), finding('treaty', { empty: true })]);
    const formula = String((scoreFact(result, COMPILED_AT).provenance as { formula: string }).formula);
    assert.match(formula, /1 consulted, no value/);
    assert.doesNotMatch(formula, /null/);
  });

  it('a fully-answered score carries no such parenthetical', () => {
    const result = scoreWith([finding('bloc')]);
    const formula = String((scoreFact(result, COMPILED_AT).provenance as { formula: string }).formula);
    assert.doesNotMatch(formula, /consulted, no value/);
  });
});

describe('it never reaches the DOM as a number', () => {
  it('renders as words, not as zero', () => {
    /**
     * The last place the conflation could come back. `signedWeight` is the one
     * formatter every weight goes through on its way to the DOM, and rendering
     * null as "0" or "+0" would put an unanswered question into the arithmetic
     * as evidence weighing nothing.
     */
    assert.equal(signedWeight(null), 'no value');
    assert.notEqual(signedWeight(null), '0');
    assert.notEqual(signedWeight(null), '+0');
  });

  it('positive control: real weights still render signed', () => {
    assert.match(signedWeight(2), /^\+/);
    assert.match(signedWeight(-2), /^-/);
  });
});
