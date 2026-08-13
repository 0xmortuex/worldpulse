import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MINIMUM_TESTS, judgeTestRun, reportedTestCount } from '../scripts/test-count.mjs';

/**
 * Planted cases for the guard that protects every other test (rules 27 and 32).
 *
 * A test glob that matches nothing exits zero and reads as a green suite. This
 * is the only thing standing between that and a report of "all tests passed",
 * and until now it could be exercised only by running the entire suite it
 * protects — which is to say, never in the failing configuration.
 */
describe('test-count guard', () => {
  it('accepts a healthy run in either reporter format', () => {
    assert.equal(judgeTestRun('ℹ tests 394\nℹ pass 394').ok, true);
    assert.equal(judgeTestRun('# tests 394\n# pass 394').ok, true);
  });

  it('catches a glob that matched nothing', () => {
    const verdict = judgeTestRun('ℹ tests 0\nℹ pass 0');
    assert.equal(verdict.ok, false);
    assert.equal(verdict.ran, 0);
    assert.match(verdict.problem ?? '', /exits zero and reads as a pass/);
  });

  it('catches a suite that ran a handful of tests because the glob half-matched', () => {
    const verdict = judgeTestRun(`ℹ tests ${MINIMUM_TESTS - 1}`);
    assert.equal(verdict.ok, false);
  });

  it('distinguishes "no count reported" from "reported zero"', () => {
    // Rule 30 at the runner: a crash before the summary is not a report of zero
    // tests, and the two have different causes and different fixes.
    assert.equal(reportedTestCount('the runner exploded'), null);
    const verdict = judgeTestRun('the runner exploded');
    assert.equal(verdict.ok, false);
    assert.equal(verdict.ran, null);
    assert.match(verdict.problem ?? '', /NO TEST COUNT AT ALL/);
    assert.doesNotMatch(verdict.problem ?? '', /RAN 0 TEST/);
  });

  it('reads the count from a full report rather than the first number it sees', () => {
    const output = ['ℹ suites 80', 'ℹ tests 394', 'ℹ pass 394', 'ℹ fail 0'].join('\n');
    assert.equal(reportedTestCount(output), 394);
  });
});
