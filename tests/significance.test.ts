import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CURATED_FEED_COUNT,
  DEFAULT_SIGNIFICANCE_WEIGHTS,
  SATURATION,
  SIGNIFICANCE_CAVEAT,
  TIE_EPSILON,
  contributionsOf,
  rank,
  significanceOf,
  type StoryMeasurements,
} from '../src/news/significance';

/**
 * The breaking-news significance ranking.
 *
 * Built against fixtures, per the spec's blocking dependency: GDELT failed six
 * of six attempts across a full session and is recorded UNREACHABLE, so the
 * ranking engine must be provable without it. These tests are that proof.
 */

function story(over: Partial<StoryMeasurements> = {}): StoryMeasurements {
  return { outlets: 1, articles: 1, days: 1, countries: 1, linkedToTrackedEvent: false, ...over };
}

describe('rule 22: the sum is only legitimate because the inputs are normalised', () => {
  it('every contribution is unitless and bounded to [0, 1] before weighting', () => {
    /**
     * The score adds outlet counts, days, country counts and a boolean. A raw
     * sum of `12 outlets + 9 days + 4 countries` is the incoherent arithmetic
     * rule 22 names — the normalisation is what makes the addition mean
     * anything.
     */
    const huge = story({ outlets: 900, articles: 9000, days: 900, countries: 900, linkedToTrackedEvent: true });
    for (const entry of contributionsOf(huge)) {
      assert.ok(entry.normalised !== null && entry.normalised >= 0 && entry.normalised <= 1,
        `${entry.input} normalised to ${entry.normalised}`);
    }
  });

  it('keeps the raw measurement beside the normalised one, for the popover', () => {
    // A reader must be able to see that 15 outlets became 1.0 and why.
    const entry = contributionsOf(story({ outlets: 15 })).find((c) => c.input === 'outletBreadth');
    assert.equal(entry?.raw, 15);
    assert.equal(entry?.normalised, 1);
    assert.match(entry?.rawUnit ?? '', /curated outlets/);
  });

  it('saturates at a STATED point rather than growing without bound', () => {
    const atCap = significanceOf(story({ outlets: SATURATION.outlets }));
    const wayOver = significanceOf(story({ outlets: SATURATION.outlets * 10 }));
    assert.equal(atCap.score, wayOver.score, 'breadth kept growing past its stated saturation');
  });
});

describe('the corpus ceiling is a property of us, not of the world', () => {
  it('outlet breadth cannot exceed the curated feed count', () => {
    /**
     * A story in 400 outlets worldwide and a story in all 15 of ours score
     * identically on breadth. That is a hard ceiling on one of five inputs, and
     * it is why the caveat has to say WHOSE coverage is being measured.
     */
    const ours = contributionsOf(story({ outlets: CURATED_FEED_COUNT }));
    const global = contributionsOf(story({ outlets: 400 }));
    assert.equal(
      ours.find((c) => c.input === 'outletBreadth')?.normalised,
      global.find((c) => c.input === 'outletBreadth')?.normalised,
    );
  });

  it('the caveat names all three things, including whose coverage', () => {
    assert.match(SIGNIFICANCE_CAVEAT, /COVERAGE VOLUME, not importance/);
    assert.match(SIGNIFICANCE_CAVEAT, /scores zero/, 'it does not say an ignored story scores zero');
    assert.match(SIGNIFICANCE_CAVEAT, new RegExp(`${CURATED_FEED_COUNT} curated`),
      'it does not say whose coverage is measured — the omission a reader reads as a finding about the world');
  });
});

describe('not consulted is not a zero', () => {
  it('an unconsulted event linkage contributes null, not 0', () => {
    /**
     * Question 13's distinction, applied from the start rather than
     * retrofitted. A zero says "we checked and there is no linkage"; null says
     * "we did not check". Scoring them alike is the conflation that took a
     * whole commit to remove from the relations engine.
     */
    const unchecked = significanceOf(story({ linkedToTrackedEvent: null }));
    const checkedNo = significanceOf(story({ linkedToTrackedEvent: false }));

    assert.deepEqual(unchecked.unconsulted, ['eventLinkage']);
    assert.deepEqual(checkedNo.unconsulted, []);
    // Both score the same NUMBER — the difference is disclosed, not scored.
    assert.equal(unchecked.score, checkedNo.score);
  });

  it('a positive linkage does raise the score', () => {
    // Positive control: without this the test above passes on a dead input.
    assert.ok(
      significanceOf(story({ linkedToTrackedEvent: true })).score >
        significanceOf(story({ linkedToTrackedEvent: false })).score,
    );
  });
});

describe('ties do not present as a confident ordering', () => {
  it('scores within epsilon share a rank and know they are tied', () => {
    /**
     * The spec is explicit: ties must not render as ranks 4, 5, 6. A hundredth
     * of a point between two stories is noise in the inputs, and an ordering
     * asserts precision the measurement does not have.
     */
    const a = story({ outlets: 10, days: 7, countries: 4 });
    const b = story({ outlets: 10, days: 7, countries: 4 });
    const ranked = rank([a, b], (s) => s);

    assert.equal(ranked[0]?.rank, ranked[1]?.rank);
    assert.equal(ranked[0]?.tied, true);
    assert.equal(ranked[1]?.tied, true);
  });

  it('a clear leader is not marked tied', () => {
    const big = story({ outlets: 15, articles: 40, days: 14, countries: 8, linkedToTrackedEvent: true });
    const small = story({ outlets: 1, articles: 1, days: 1, countries: 1 });
    const ranked = rank([small, big], (s) => s);

    assert.equal(ranked[0]?.rank, 1);
    assert.equal(ranked[0]?.tied, false);
    assert.equal(ranked[1]?.rank, 2);
    assert.ok(ranked[0]!.score.score - ranked[1]!.score.score > TIE_EPSILON);
  });

  it('ranks descending by score', () => {
    const ranked = rank(
      [story({ outlets: 2 }), story({ outlets: 15 }), story({ outlets: 8 })],
      (s) => s,
    );
    assert.ok(ranked[0]!.score.score >= ranked[1]!.score.score);
    assert.ok(ranked[1]!.score.score >= ranked[2]!.score.score);
  });
});

describe('the weights are an opinion, and adjustable', () => {
  it('changing a weight changes the ranking', () => {
    // The relations-panel pattern: the opinion is visible and arguable rather
    // than baked in.
    /**
     * The first version of this used two stories that scored within
     * TIE_EPSILON of each other, so they were a tied band and no reweighting
     * could reorder them — the test failed for a reason that was the ranking
     * working correctly. Chosen now to be clearly separated by default.
     */
    const spread = story({ outlets: 0, articles: 0, days: 0, countries: 8 });
    const breadth = story({ outlets: 15, articles: 40, days: 0, countries: 0 });

    const byDefault = rank([spread, breadth], (s) => s);
    const spreadHeavy = rank([spread, breadth], (s) => s, {
      ...DEFAULT_SIGNIFICANCE_WEIGHTS,
      geographicSpread: 20,
    });

    assert.notDeepEqual(
      byDefault.map((entry) => entry.story),
      spreadHeavy.map((entry) => entry.story),
      'the weights do not affect the ordering, so they are not weights',
    );
  });

  it('a story nobody covered scores zero', () => {
    const ignored = significanceOf({
      outlets: 0, articles: 0, days: 0, countries: 0, linkedToTrackedEvent: false,
    });
    assert.equal(ignored.score, 0);
  });
});
