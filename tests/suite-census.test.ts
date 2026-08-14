import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { censusProblems, declaredSuites, parseSuiteCounts } from '../scripts/suite-census.mjs';

/**
 * Planted cases for the per-suite census (rules 27 and 32).
 *
 * The event this exists for: adding one enum value made nine test files crash at
 * import. The runner reported 381 tests where 496 existed and 9 failures — and
 * 115 assertions that never ran looked exactly like a normal bad afternoon.
 */
const TAP = `TAP version 13
# Subtest: alpha
    # Subtest: one
    ok 1 - one
      ---
      duration_ms: 1
      ...
    # Subtest: two
    not ok 2 - two
      ---
      duration_ms: 1
      ...
ok 1 - alpha
# Subtest: beta
    # Subtest: only
    ok 1 - only
      ---
      duration_ms: 1
      ...
ok 2 - beta
# tests 3
# pass 2
# fail 1
`;

describe('suite census', () => {
  it('counts tests per suite, including failing ones', () => {
    // A failing test RAN. This guard is about tests that did not, so a failure
    // must not be counted as an absence.
    assert.deepEqual(parseSuiteCounts(TAP), { alpha: 2, beta: 1 });
  });

  it('is silent when every suite ran what it was meant to', () => {
    const { problems, drifted } = censusProblems(
      { alpha: 2, beta: 1 },
      { alpha: 2, beta: 1 },
      new Set(['alpha', 'beta']),
    );
    assert.deepEqual(problems, []);
    assert.deepEqual(drifted, []);
  });

  it('FAILS when a still-declared suite contributes nothing — the crashed import', () => {
    // The planted case for the real event: the file is present and declares the
    // suite, so it was meant to run; it contributed zero, so its assertions were
    // skipped wholesale.
    const { problems } = censusProblems({ alpha: 2, beta: 1 }, { alpha: 2 }, new Set(['alpha', 'beta']));
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /"beta" contributed 0 tests but is still declared/);
    assert.match(problems[0] ?? '', /meant to run 1/);
  });

  it('does NOT fail when the suite is gone from the tree — the deliberate deletion', () => {
    // Different event, different fix. Reported as drift so the baseline gets
    // updated, not as a defect.
    const { problems, drifted } = censusProblems({ alpha: 2, beta: 1 }, { alpha: 2 }, new Set(['alpha']));
    assert.deepEqual(problems, []);
    assert.equal(drifted.length, 1);
    assert.match(drifted[0] ?? '', /gone from the tree/);
  });

  it('reports a suite that shrank without vanishing', () => {
    // The slow version of the same failure: assertions disappearing one at a
    // time never trips a floor.
    const { problems, drifted } = censusProblems({ alpha: 5 }, { alpha: 3 }, new Set(['alpha']));
    assert.deepEqual(problems, []);
    assert.match(drifted[0] ?? '', /ran 3 tests, baseline says 5/);
  });

  it('a suite whose baseline is zero contributes zero correctly', () => {
    /**
     * Found by planting the crash this guard exists for and watching it report
     * TWO suites when one had crashed. `describe(..., { skip })` suites — the
     * PROBE_LIVE-gated live checks — run nothing by design on every healthy
     * run, so flagging them would make the guard cry wolf constantly, and a
     * guard that fires on normal runs is one people learn to scroll past.
     */
    const { problems, drifted } = censusProblems(
      { alpha: 2, 'World Bank, live': 0 },
      { alpha: 2 },
      new Set(['alpha', 'World Bank, live']),
    );
    assert.deepEqual(problems, []);
    assert.deepEqual(drifted, []);
  });

  it('a suite that grew is not a problem', () => {
    const { problems, drifted } = censusProblems({ alpha: 2 }, { alpha: 9 }, new Set(['alpha']));
    assert.deepEqual(problems, []);
    assert.deepEqual(drifted, []);
  });

  it('reads declared suite names out of source', () => {
    const source = `
      describe('licence posture', () => {});
      describe("probe carry-forward", () => {});
      describe(\`backticked\`, () => {});
    `;
    assert.deepEqual(declaredSuites(source), ['licence posture', 'probe carry-forward', 'backticked']);
  });
});
