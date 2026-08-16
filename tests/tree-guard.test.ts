import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// @ts-expect-error — .mjs script without a .d.mts sibling; the rule under test
// is plain JavaScript and this file is its only consumer.
import { guardDecision } from '../scripts/tree-guard.mjs';

/**
 * The lock protects the measurement's TREE, not just its CPU.
 *
 * ## Why this guard exists rather than another note
 *
 * Two mutation runs were voided in one session by writes to the tracked tree
 * while they measured. The second happened AFTER the first was recorded in
 * `FOUND.md`, promoted to a lesson, and restated aloud — in the same breath as
 * "I am leaving the tree untouched".
 *
 * That is the project's own recurring proof that **a recorded lesson without a
 * mechanism does not hold**: the shell tally needed rule 41, reading a green
 * summary over a red failure line needed rule 44. This is the third.
 *
 * ## What the old check could not do
 *
 * `requireCleanCheckout` runs at exactly two points. It is a FRESHNESS check —
 * it proves afterwards whether a result can be trusted, and delivers that
 * verdict twenty minutes late, when the only remaining option is to throw the
 * run away. This closes the window to one second.
 *
 * The decision function is pure and exported precisely so these cases can be
 * driven without a twenty-minute harness (rule 32).
 */

const LOCK = { pid: 1234, kind: 'mutate', commit: '54798b2', startedAt: '2026-08-16T12:00:00.000Z' };

describe('the tree guard stops a run the moment its tree changes', () => {
  it('fires on a dirty tracked tree, and says what changed', () => {
    const decision = guardDecision({ lock: LOCK, dirt: ' M docs/NEXT-GOAL.md', alive: true });
    assert.equal(decision.stop, true);
    assert.equal(decision.violation, true);
    assert.match(decision.reason, /docs\/NEXT-GOAL\.md/, 'the guard does not name the offending file');
    assert.match(decision.reason, /54798b2/, 'it does not name the commit being measured');
  });

  it('says why killing now is cheaper than discovering later', () => {
    // The message has to carry the reasoning, because the person reading it is
    // deciding whether to be annoyed at a killed run.
    const decision = guardDecision({ lock: LOCK, dirt: ' M src/main.ts', alive: true });
    assert.match(decision.reason, /costs seconds/i);
    assert.match(decision.reason, /verified-clean/i, 'it does not say what to do next');
  });

  it('does NOT fire on a clean tree — the case that must stay quiet', () => {
    /**
     * Rule 42's shape. A guard that fired regardless would be indistinguishable
     * from a broken run, and would train everyone to ignore it.
     */
    const decision = guardDecision({ lock: LOCK, dirt: '', alive: true });
    assert.equal(decision.stop, false);
    assert.equal(decision.violation, undefined);
  });

  it('stops quietly when the run has finished', () => {
    const decision = guardDecision({ lock: LOCK, dirt: '', alive: false });
    assert.equal(decision.stop, true);
    assert.equal(decision.violation, undefined);
    assert.match(decision.reason, /no longer alive/);
  });

  it('stops quietly when no lock is held', () => {
    const decision = guardDecision({ lock: null, dirt: '', alive: false });
    assert.equal(decision.stop, true);
    assert.equal(decision.violation, undefined);
  });

  it('a git failure is INCONCLUSIVE — it does not kill the run', () => {
    /**
     * Rule 3, applied to the guard's own instrument. `git` failing is not
     * evidence the tree is dirty, and killing a valid twenty-minute run on a
     * transient git error would make the guard worse than the problem.
     */
    const decision = guardDecision({ lock: LOCK, dirt: null, alive: true });
    assert.equal(decision.stop, false);
    assert.equal(decision.violation, undefined);
  });
});
