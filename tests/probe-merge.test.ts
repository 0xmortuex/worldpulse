import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isCarried, mergeResults, mergeRow, refreshedIds } from '../scripts/probe-merge.mjs';
import { VERDICT } from '../scripts/probe-verdict.mjs';

/**
 * Planted cases for the carry-forward (rules 27 and 32).
 *
 * A carry-forward keeps a verdict measured on a network that could reach the
 * host, on a machine that provably cannot. It is the one place in the probe
 * where a displayed verdict did not come from the run that displayed it, so
 * both of its behaviours are exercised here rather than being observed once by
 * hand and trusted afterwards.
 */
const carried = (over: Record<string, unknown> = {}) => ({
  id: 'riksdagen',
  verdict: VERDICT.CLIENT,
  carriedForward: {
    measuredFrom: 'cloud sandbox (Linux container)',
    measuredAt: '2026-08-12',
    reason: 'TCP reset from the measuring network',
  },
  ...over,
});

const measured = (verdict: string, over: Record<string, unknown> = {}) => ({
  id: 'riksdagen',
  verdict,
  probedAt: '2026-08-14T12:00:00.000Z',
  ...over,
});

describe('probe carry-forward', () => {
  it('recognises an annotated carry and an ordinary row', () => {
    assert.equal(isCarried(carried()), true);
    assert.equal(isCarried(measured(VERDICT.CLIENT)), false);
    assert.equal(isCarried(undefined), false);
  });

  it('a carry SURVIVES a fresh network failure, recording what this run saw', () => {
    // The exact event the carry exists to survive. Letting UNREACHABLE win here
    // would strip a working source on the strength of a local network artifact
    // — the frankfurter mistake pointed the other way.
    const merged = mergeRow(carried(), measured(VERDICT.UNREACHABLE, { reason: 'ECONNRESET' }));

    assert.equal(merged?.verdict, VERDICT.CLIENT, 'the carried verdict must stand');
    assert.equal(merged?.carriedForward?.measuredFrom, 'cloud sandbox (Linux container)');
    assert.equal(merged?.carriedForward?.thisRun, VERDICT.UNREACHABLE);
    assert.equal(merged?.carriedForward?.thisRunReason, 'ECONNRESET');
  });

  it('a carry survives UNMEASURABLE too, since that is also not a measurement of the source', () => {
    const merged = mergeRow(carried(), measured(VERDICT.UNMEASURABLE));
    assert.equal(merged?.verdict, VERDICT.CLIENT);
    assert.equal(merged?.carriedForward?.thisRun, VERDICT.UNMEASURABLE);
  });

  it('a carry EXPIRES against a conclusive fresh verdict', () => {
    // A measurement always beats an annotation. This is how the carry ends: the
    // first run from a network that can reach the host replaces it outright.
    for (const verdict of [VERDICT.CLIENT, VERDICT.WORKER, VERDICT.KEY]) {
      const merged = mergeRow(carried(), measured(verdict));
      assert.equal(merged?.verdict, verdict, `${verdict} should have replaced the carry`);
      assert.equal(merged?.carriedForward, undefined, 'the annotation must not outlive the carry');
      assert.equal(merged?.probedAt, '2026-08-14T12:00:00.000Z');
    }
  });

  it('an INCONCLUSIVE response does not expire the carry', () => {
    // Rule 3: an error response is not evidence about the success path, so it
    // cannot replace a verdict about the success path either.
    const merged = mergeRow(carried(), measured(VERDICT.INCONCLUSIVE));
    assert.equal(merged?.verdict, VERDICT.CLIENT);
    assert.equal(merged?.carriedForward?.thisRun, VERDICT.INCONCLUSIVE);
  });

  it('an ordinary row is always replaced by a fresh one', () => {
    const merged = mergeRow(measured(VERDICT.CLIENT), measured(VERDICT.UNREACHABLE));
    assert.equal(merged?.verdict, VERDICT.UNREACHABLE);
  });

  it('keeps rows nobody re-probed, in registry order', () => {
    const previous = [{ id: 'a', verdict: VERDICT.CLIENT }, carried()];
    const fresh = [{ id: 'a', verdict: VERDICT.WORKER, probedAt: 'now' }];
    const merged = mergeResults(previous, fresh, ['a', 'riksdagen']);

    assert.deepEqual(merged.map((row) => row.id), ['a', 'riksdagen']);
    assert.equal(merged[0]?.verdict, VERDICT.WORKER);
    assert.equal(merged[1]?.verdict, VERDICT.CLIENT);
  });

  it('does not report a carried row as refreshed even when the run attempted it', () => {
    // The request was made; the verdict on display still did not come from it.
    // Counting it as refreshed is the same overstatement as a merged table with
    // no per-row dating.
    const results = [{ id: 'a', verdict: VERDICT.CLIENT }, carried()];
    assert.deepEqual(refreshedIds(results, ['a', 'riksdagen']), ['a']);
  });
});
