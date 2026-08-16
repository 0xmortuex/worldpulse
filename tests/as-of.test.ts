import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { asOfCaveat, earliestYear, findingsAsOf } from '../src/relations/as-of';
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, score } from '../src/relations/score';
import type { Finding } from '../src/relations/types';

/**
 * Step 13's time scrub.
 *
 * The specced constraint is architectural: **score a pair as of a past date
 * without the scoring module knowing about time.** A scoring engine that takes
 * a date must be re-verified for every date; keeping time out of it means one
 * behaviour, already tested, with the time dimension in what is fed to it.
 *
 * The first test asserts that constraint against the source, because it is the
 * kind of design rule that erodes in a single well-meaning commit.
 */

function finding(kind: Finding['kind'], coverageEnd: number): Finding {
  return {
    kind,
    label: `${kind} ${coverageEnd}`,
    source: 'test',
    sourceUrl: 'https://example.invalid/',
    coverageEnd,
  };
}

describe('the scoring module still does not know about time', () => {
  it('score() takes no date parameter beyond the year it always took', () => {
    /**
     * THE CONSTRAINT, ASSERTED AGAINST THE SOURCE.
     *
     * `currentYear` was always a parameter — it resolves finding AGE, which is
     * a property of the evidence. What must never appear is an as-of date, a
     * cutoff, or a scrub position: those belong to what is fed in.
     */
    /**
     * ASSERTED ON CODE, NOT ON PROSE.
     *
     * The first version matched the raw file and failed immediately — because
     * `score.ts` EXPLAINS in a comment that `currentYear` is injected "so the
     * time-scrub feature in step 13 can score a pair as it would have been
     * scored on a past date". The guard was reading documentation as though it
     * were a signature, and would have forced the deletion of the very comment
     * that records this design.
     *
     * Comments are stripped first, so the check is about what the module DOES.
     */
    const raw = readFileSync(resolve(import.meta.dirname, '..', 'src', 'relations', 'score.ts'), 'utf8');
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

    assert.doesNotMatch(code, /\basOf\b|\bcutoff\b|\bscrub\b/i,
      'the scoring module has grown a time concept — the scrub belongs in what is fed to it');

    // And the arity it has always had. A seventh parameter is the concrete
    // shape this rule erodes into.
    assert.equal(score.length, 6, 'score() gained a parameter — check it is not a date');
  });

  it('scoring as-of is done by FILTERING, not by a different call', () => {
    // The whole mechanism, demonstrated: same function, same weights, fewer
    // inputs. If this ever needs a second scoring path, the design has broken.
    const findings = [finding('sharedDefenseBloc', 2010), finding('bilateralDefenseTreaty', 2024)];

    const now = score('AAA', 'BBB', findings, DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS, 2026);
    const then = score('AAA', 'BBB', findingsAsOf(findings, 2015), DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS, 2015);

    assert.equal(now.inputs.length, 2);
    assert.equal(then.inputs.length, 1, 'the 2024 finding was visible to a 2015 view');
    assert.notEqual(now.score, then.score);
  });
});

describe('as-of filtering', () => {
  it('excludes evidence that did not yet exist', () => {
    const findings = [finding('sharedDefenseBloc', 2012), finding('activeConflict', 2020)];
    assert.equal(findingsAsOf(findings, 2015).length, 1);
    assert.equal(findingsAsOf(findings, 2020).length, 2);
    assert.equal(findingsAsOf(findings, 2011).length, 0);
  });

  it('includes a finding in the exact year its coverage ends', () => {
    // An off-by-one here would silently drop a year's worth of evidence at
    // every scrub position.
    assert.equal(findingsAsOf([finding('sharedDefenseBloc', 2015)], 2015).length, 1);
  });

  it('an undefined finding list is empty, not a crash', () => {
    assert.deepEqual(findingsAsOf(undefined, 2015), []);
  });

  it('a pair with all evidence excluded scores as nodata, not as neutral', () => {
    /**
     * The distinction that makes a scrub honest. Scrubbing past the start of
     * our evidence must read as "we have nothing for this date", not as "these
     * countries were neutral" — which would be a claim about the past invented
     * by moving a slider.
     */
    const early = score('AAA', 'BBB', findingsAsOf([finding('sharedDefenseBloc', 2020)], 2000),
      DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS, 2000);
    assert.equal(early.tier, 'nodata');
  });
});

describe('the scrub bounds come from the data', () => {
  it('finds the earliest coverage year across all pairs', () => {
    const earliest = earliestYear([
      [finding('sharedDefenseBloc', 2012)],
      [finding('historicalAlliance', 1994), finding('activeConflict', 2020)],
    ]);
    assert.equal(earliest, 1994);
  });

  it('returns null when there is no evidence at all, rather than a hardcoded floor', () => {
    // A hardcoded floor would offer years where every pair reads nodata, and a
    // control that spends half its travel showing nothing teaches the reader
    // it is broken.
    assert.equal(earliestYear([]), null);
    assert.equal(earliestYear([[]]), null);
  });
});

describe('the caveat says what the scrub is and is not', () => {
  it('names all three things a reader would otherwise assume', () => {
    const text = asOfCaveat(2015, 3, 10);
    assert.match(text, /7 of 10 findings/, 'the exclusion count is not stated');
    assert.match(text, /PRESENT evidence/, 'it does not say whose evidence this is');
    assert.match(text, /not what was known in 2015/i, 'it does not disclaim hindsight');
    assert.match(text, /not a claim about what was true/i, 'it does not disclaim truth');
  });
});
