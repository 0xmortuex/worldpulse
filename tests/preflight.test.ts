import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// @ts-expect-error — .mjs script without a .d.mts sibling; this file is its only consumer.
import { versionProblem } from '../scripts/preflight.mjs';

/**
 * The Node version floor.
 *
 * Reported from a fresh clone on Node 18.20.4: `npm run dev` died inside
 * rolldown with "does not provide an export named 'styleText'", which tells a
 * reader nothing about what to do.
 *
 * The version this machine runs cannot exercise the failure — it is well above
 * the floor — so the comparison is planted at the boundary instead. A guard
 * whose firing path has never run is a guard nobody has tested (rule 32), and
 * an off-by-one in a version comparison is exactly the defect that hides in one
 * that is only ever seen passing.
 */

describe('the Node floor is enforced with a sentence, not a stack trace', () => {
  it('fires on the version that was actually reported', () => {
    const problem = versionProblem('18.20.4');
    assert.ok(problem, 'Node 18.20.4 was accepted — the reported failure would recur');
    assert.equal(problem.actual, '18.20.4');
    assert.equal(problem.required, '20.18.0');
  });

  it('fires just below the floor and passes AT it', () => {
    /**
     * The boundary in both directions. A comparison that is wrong by one
     * either blocks a working install or admits a broken one, and only the
     * pair catches which.
     */
    assert.ok(versionProblem('20.17.9'), '20.17.9 was accepted');
    assert.equal(versionProblem('20.18.0'), null, 'the floor itself was rejected');
    assert.equal(versionProblem('20.18.1'), null);
  });

  it('compares numerically, not as strings', () => {
    // '20.9.0' > '20.18.0' as strings. This is the classic way a version gate
    // rejects a perfectly good install.
    assert.ok(versionProblem('20.9.0'), '20.9.0 was accepted — string comparison is back');
    assert.equal(versionProblem('20.100.0'), null, '20.100.0 was rejected — string comparison is back');
  });

  it('accepts every version above the floor, including major bumps', () => {
    for (const version of ['21.0.0', '22.11.0', 'v24.18.0', '30.0.0']) {
      assert.equal(versionProblem(version), null, `${version} was rejected`);
    }
  });

  it('an unparseable version is INCONCLUSIVE, not a failure', () => {
    /**
     * Rule 3 applied to the guard's own instrument. A version string this
     * cannot read is not evidence of an old Node, and blocking a working
     * install on it would make the guard worse than the problem it solves.
     */
    assert.equal(versionProblem('not-a-version'), null);
    assert.equal(versionProblem(''), null);
  });

  it('the floor matches what package.json promises', async () => {
    /**
     * `engines` and the preflight must not drift. Two places stating one
     * requirement is exactly where a doc-versus-tree gap opens — which is the
     * class this whole fix belongs to.
     */
    const pkg = JSON.parse(
      await (await import('node:fs/promises')).readFile(
        new URL('../package.json', import.meta.url),
        'utf8',
      ),
    ) as { engines?: { node?: string } };

    const declared = pkg.engines?.node ?? '';
    assert.match(declared, /^>=\s*20\.18\.0$/, `package.json engines says "${declared}"`);
  });
});
