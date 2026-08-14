import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { transportProblems } from '../scripts/transport-check.mjs';
import registry from '../data/sources.json';
import probeResults from '../data/probe-results.json';

/**
 * Planted cases for the transport check (rules 27 and 32).
 *
 * `transport` decides whether the browser calls an origin directly or goes
 * through the Worker. It is derived from the probe once and then lives in JSON,
 * which is the same shape as the `verifiedAgainst` cast that stayed wrong for
 * two whole steps: correct when written, silent when it stops being.
 */
const source = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'src',
  keyRequired: false,
  keyEnv: null,
  ...over,
});

const check = (
  sources: Array<Record<string, unknown>>,
  probe: Array<{ id: string; verdict: string }>,
): string[] => transportProblems({ sources }, probe);

describe('transport check', () => {
  it('passes when the declared transport matches the measured verdict', () => {
    assert.deepEqual(check([source({ transport: 'direct' })], [{ id: 'src', verdict: 'CLIENT-FETCH' }]), []);
    assert.deepEqual(check([source({ transport: 'worker' })], [{ id: 'src', verdict: 'WORKER-REQUIRED' }]), []);
  });

  it('catches direct declared where the probe measured the browser cannot read it', () => {
    // The dangerous direction: a panel that fails in the user's browser and
    // passes every test here.
    const problems = check([source({ transport: 'direct' })], [{ id: 'src', verdict: 'WORKER-REQUIRED' }]);
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /implies "worker"/);
  });

  it('catches worker declared where direct would work', () => {
    // Cheaper to be wrong this way, still wrong: an unnecessary hop through
    // infrastructure we pay for and rate-limit.
    assert.equal(check([source({ transport: 'worker' })], [{ id: 'src', verdict: 'CLIENT-FETCH' }]).length, 1);
  });

  it('catches a secret key on a direct transport before it looks at the verdict', () => {
    // The question is not "can the browser read this" but "may the browser hold
    // the key", so this outranks whatever the probe saw.
    const problems = check(
      [source({ transport: 'direct', keyRequired: true, keyEnv: 'SECRET' })],
      [{ id: 'src', verdict: 'CLIENT-FETCH' }],
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /would put the key in the browser/);
  });

  it('allows a public VITE_ key to follow the probe verdict', () => {
    assert.deepEqual(
      check(
        [source({ transport: 'direct', keyRequired: true, keyEnv: 'VITE_PUBLIC' })],
        [{ id: 'src', verdict: 'CLIENT-FETCH' }],
      ),
      [],
    );
  });

  it('refuses a transport declared for a source that was never probed', () => {
    const problems = check([source({ transport: 'direct' })], []);
    assert.match(problems[0] ?? '', /no probe verdict/);
  });

  it('refuses a transport inferred from an INCONCLUSIVE or UNREACHABLE verdict', () => {
    // Rule 30: the probe declined to answer about the success path, and that is
    // not an answer of "direct".
    for (const verdict of ['INCONCLUSIVE', 'UNREACHABLE']) {
      const problems = check([source({ transport: 'direct' })], [{ id: 'src', verdict }]);
      assert.equal(problems.length, 1, `${verdict} was treated as evidence`);
      assert.match(problems[0] ?? '', /says nothing about the success path/);
    }
  });

  it('notices a probed source with no transport declared', () => {
    const problems = check([source({})], [{ id: 'src', verdict: 'CLIENT-FETCH' }]);
    assert.match(problems[0] ?? '', /no transport is declared/);
  });

  it('refuses a registered, probeable source that has no probe row', () => {
    /**
     * INVERTED 2026-08-14, and the old case is quoted here rather than deleted.
     *
     * It read `leaves an unprobed, undeclared source alone`, reasoning that
     * "absent is the correct state for a source nobody has measured. Demanding a
     * value here would push someone to invent one."
     *
     * That reasoning is correct about the TRANSPORT and wrong about the SOURCE.
     * It encoded the gate's blindness as intended behaviour — and the blindness
     * was load-bearing: 15 `rss-*` feeds and `howtheyvote-data` were registered,
     * never re-probed, and therefore never checked. The gate read green over 16
     * of 54 sources for as long as the probe file stayed stale.
     *
     * Demanding a probe row does not push anyone to invent a value; it pushes
     * them to run the probe, which is the one action that produces a real one.
     */
    const problems = check([source({ probeUrl: 'https://example.test/feed.xml' })], []);
    assert.equal(problems.length, 1, 'a registered, probeable source with no row must be named');
    assert.match(problems[0] ?? '', /no probe row/);
  });

  it('leaves a source with nothing to probe alone', () => {
    // What survives from the inverted case above. A bundled dataset arrives
    // through npm and never crosses the network at runtime, so there is no
    // request to make and no verdict to want. Exempt on the absence of a
    // probeUrl — a principle — never by id.
    assert.deepEqual(check([source({})], []), []);
  });

  it('ignores excluded sources', () => {
    assert.deepEqual(check([source({ excluded: true, transport: 'direct' })], [{ id: 'src', verdict: 'WORKER-REQUIRED' }]), []);
  });

  it('the shipped registry agrees with the shipped probe results', () => {
    assert.deepEqual(transportProblems(registry, probeResults.results ?? []), []);
  });
});
