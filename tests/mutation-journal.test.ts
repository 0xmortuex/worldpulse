import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { alreadyDecided, isResumable, planFrom, usableEntries, type JournalEntry } from '../scripts/mutation-journal.mjs';

/**
 * Planted cases for resume (rules 27 and 32).
 *
 * Written because a container reboot at mutation 1 of 11 destroyed every
 * finished verdict, in an environment that restarts about as often as a full
 * run takes.
 */
const entry = (over: Partial<JournalEntry> = {}): JournalEntry => ({
  commit: 'c473569',
  step: '1 — globe',
  what: 'relations go neutral',
  verdict: 'CAUGHT',
  detail: 'classification changed',
  ms: 300_000,
  ...over,
});

const MUTATIONS = [
  { step: '1 — globe', what: 'relations go neutral' },
  { step: '7b — economy fetch states', what: 'a partially-answered panel reports itself complete' },
  { step: '7b — economy fetch states', what: 'a failed request is worded as no data' },
];

describe('mutation journal', () => {
  it('reuses a verdict recorded for this commit', () => {
    const { pending, resumed } = planFrom([entry()], MUTATIONS, 'c473569');
    assert.equal(resumed.length, 1);
    assert.equal(pending.length, 2);
  });

  it('DISCARDS verdicts recorded against a different commit', () => {
    // A verdict is evidence about the tree it was measured on. Reusing one
    // across commits assembles a table from several trees and prints it as one.
    const { usable, discarded } = usableEntries([entry({ commit: 'deadbee' })], 'c473569');
    assert.deepEqual(usable, []);
    assert.equal(discarded, 1);
    assert.equal(planFrom([entry({ commit: 'deadbee' })], MUTATIONS, 'c473569').pending.length, 3);
  });

  it('distinguishes two mutations that share a step', () => {
    // 7b carries two. Keying on step alone would let the first one's verdict
    // stand in for the second, and the second would never run again.
    const recorded = entry({ step: '7b — economy fetch states', what: 'a partially-answered panel reports itself complete' });
    assert.ok(alreadyDecided([recorded], MUTATIONS[1]!));
    assert.equal(alreadyDecided([recorded], MUTATIONS[2]!), null);
  });

  it('runs everything when the journal is empty', () => {
    assert.equal(planFrom([], MUTATIONS, 'c473569').pending.length, 3);
  });

  it('preserves mutation order in the pending list', () => {
    const { pending } = planFrom([entry()], MUTATIONS, 'c473569');
    assert.deepEqual(pending.map((m) => m.what), [MUTATIONS[1]!.what, MUTATIONS[2]!.what]);
  });
});

describe('an inconclusive verdict is not a decision', () => {
  it('does not resume a NOT-EXERCISED entry', () => {
    // Reusing one would "resume" a row that was never measured and print a
    // complete-looking table containing it — the same vacuity the classifier
    // fix removed, arriving through the cache instead.
    const notRun = entry({ verdict: 'NOT-EXERCISED' });
    assert.equal(isResumable(notRun), false);
    assert.equal(alreadyDecided([notRun], MUTATIONS[0]!), null);
    assert.equal(planFrom([notRun], MUTATIONS, 'c473569').pending.length, 3);
  });

  it('does not resume SURVIVED or AMBIGUOUS-ANCHOR either', () => {
    for (const verdict of ['SURVIVED', 'AMBIGUOUS-ANCHOR', 'TIMEOUT', 'BUILD-FAILED']) {
      assert.equal(isResumable(entry({ verdict })), false, `${verdict} was treated as decided`);
    }
  });

  it('still resumes a genuine CAUGHT', () => {
    assert.equal(isResumable(entry({ verdict: 'CAUGHT' })), true);
    assert.equal(isResumable(entry({ verdict: 'CAUGHT-ELSEWHERE' })), true);
  });
});
