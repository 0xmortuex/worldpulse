import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolutionClaim, type Resolution } from '../src/facts/types';

/**
 * Planted cases for coordinate precision (B4, rules 27 and 32).
 *
 * The failure this prevents is specific: a 6-decimal coordinate carrying a
 * country-level source's figure. That is not merely overconfident presentation —
 * it tells the reader the source knew something it never knew, in the one
 * notation where readers count the digits.
 */
describe('resolution claims', () => {
  it('a declared point is claimed as published, with no centroid', () => {
    const claim = resolutionClaim('point');
    assert.match(claim.label, /as published/);
    assert.equal(claim.centroid, false);
    assert.equal(claim.assumed, false);
  });

  it('admin-1 and country are both centroids, and say so', () => {
    for (const resolution of ['admin1', 'country'] as const) {
      const claim = resolutionClaim(resolution);
      assert.equal(claim.centroid, true, `${resolution} must be marked a centroid`);
      assert.match(claim.label, /centroid/, `${resolution} must say centroid in its own words`);
      assert.equal(claim.assumed, false);
    }
  });

  it('admin-1 and country are distinguishable from each other', () => {
    // Both are centroids, but of different things, and a reader deserves to know
    // whether the dot means "somewhere in this province" or "somewhere in this
    // country". Identical wording would collapse two claims into one.
    assert.notEqual(resolutionClaim('admin1').label, resolutionClaim('country').label);
  });

  /**
   * THE PLANTED CASE THIS FIELD EXISTS FOR.
   *
   * An undeclared resolution must fail closed to the coarsest claim. Defaulting
   * to `point` would manufacture false precision silently, for every source
   * nobody had annotated yet — which is most of them the day this lands.
   */
  it('an undeclared resolution fails CLOSED to country-level, never to point', () => {
    const claim = resolutionClaim(undefined);
    assert.equal(claim.assumed, true, 'the assumption must be visible, not silent');
    assert.equal(claim.centroid, true, 'an undeclared coordinate must not be plotted as measured');
    assert.match(claim.label, /not declared/, 'the reader must be told nothing was declared');
    assert.notDeepEqual(claim, resolutionClaim('point'), 'undeclared must never read as a point location');
  });

  it('every declared resolution produces a distinct, non-empty claim', () => {
    // Guards the dispatch: a member added to Resolution without an arm would
    // fail assertNever at compile time, and an arm returning a placeholder
    // would fail here.
    const all: Resolution[] = ['country', 'admin1', 'point'];
    const labels = all.map((resolution) => resolutionClaim(resolution).label);
    for (const label of labels) assert.ok(label.trim().length > 0);
    assert.equal(new Set(labels).size, all.length, 'two resolutions share wording');
  });

  it('only a point escapes being marked a centroid', () => {
    // The invariant, stated as such rather than as three separate facts: if it
    // was not published as a point, whatever we plot is something we computed.
    const all: Array<Resolution | undefined> = ['country', 'admin1', 'point', undefined];
    const notCentroid = all.filter((resolution) => !resolutionClaim(resolution).centroid);
    assert.deepEqual(notCentroid, ['point']);
  });
});
