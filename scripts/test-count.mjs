/**
 * How many tests a runner reported, and whether that is enough to believe.
 *
 * Extracted from `run-tests.mjs` per rule 32. This is the guard that stops every
 * OTHER test from passing vacuously — a glob matching nothing exits zero and
 * reads as a green suite — and it was the one guard in the repository that
 * could only be exercised by running the whole suite it protects.
 *
 * Low stakes individually, and it is named in the rule 32 audit precisely
 * because "low stakes" was the reason it stayed unreachable while everything
 * around it was extracted.
 */

/**
 * A deliberately low bar. The point is to catch "the glob matched nothing", not
 * to pin an exact number that has to be edited every time a test is added — a
 * count that must be maintained by hand is a count that gets bumped without
 * being read.
 */
export const MINIMUM_TESTS = 100;

/**
 * Both reporters are accepted: `ℹ tests 181` (spec) and `# tests 181` (tap).
 *
 * Returns null when no count could be read, which is NOT zero — it means the
 * runner said nothing about how many tests ran, and rule 30 applies: no answer
 * is not an answer of none. The caller treats it as a failure either way, but
 * the distinction is in the message, because "reported no count" and "reported
 * zero" have different causes and different fixes.
 */
export function reportedTestCount(output) {
  const match = output.match(/^[ℹ#]\s*tests\s+(\d+)/m);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/**
 * @returns {{ ok: boolean, ran: number | null, problem: string | null }}
 */
export function judgeTestRun(output, minimum = MINIMUM_TESTS) {
  const ran = reportedTestCount(output);

  if (ran === null) {
    return {
      ok: false,
      ran: null,
      problem:
        'THE RUNNER REPORTED NO TEST COUNT AT ALL.\n' +
        'That is not the same as reporting zero: the suite may have crashed before summarising,\n' +
        'or the reporter may have changed its format. Either way nothing above can be trusted.',
    };
  }

  if (ran < minimum) {
    return {
      ok: false,
      ran,
      problem:
        `RAN ${ran} TEST(S), EXPECTED AT LEAST ${minimum}.\n` +
        'The suite did not run — a pattern that matches nothing exits zero and reads as a pass.\n' +
        'Check the test glob and the tests/ directory before trusting any green result above.',
    };
  }

  return { ok: true, ran, problem: null };
}
