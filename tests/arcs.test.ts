import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { arcsFor, drawnTiers, largestRing } from '../src/relations/arcs';
import type { RelationResult, Tier } from '../src/relations/types';

/**
 * Step 12's arcs — the relation edges drawn on the globe.
 *
 * An arc is a CLAIM. A line between two countries reads as a fact about those
 * countries, and it is not: it is this app's classification, computed from
 * weights a reader can move with a slider. So the tests here are mostly about
 * what is NOT drawn, and about the arc agreeing with the row beside it.
 */

function result(tier: Tier, over: Partial<RelationResult> = {}): RelationResult {
  return {
    subject: 'AAA',
    other: 'BBB',
    tier,
    score: tier === 'ally' ? 6 : tier === 'adversary' ? -6 : 0,
    inputs: [],
    staleWeightShare: 0,
    lowConfidence: false,
    ...over,
  };
}

const OPTIONS = { subjectName: 'Aland', nameOf: (iso3: string) => `Country ${iso3}` };

describe('an absent arc is a claim too', () => {
  it('draws nothing for a nodata pair', () => {
    /**
     * The one that matters most. A faint line for "we have nothing" would put a
     * claim on the globe where the app has none — the exact failure the nodata
     * tier exists to prevent.
     */
    assert.deepEqual(arcsFor([result('nodata')], OPTIONS), []);
  });

  it('draws nothing for a neutral pair, deliberately', () => {
    /**
     * A judgement rather than an oversight, so it is asserted rather than left
     * to be rediscovered: neutral IS a finding, but an arc per neutral pair
     * draws a line from the subject to most of the world, and a surface where
     * everything is connected shows nothing. The finding stays in the relations
     * list, where it can be read rather than merely seen.
     */
    assert.deepEqual(arcsFor([result('neutral')], OPTIONS), []);
  });

  it('draws the three tiers that are genuine classifications', () => {
    const drawn = arcsFor(
      [result('ally'), result('adversary'), result('strained'), result('neutral'), result('nodata')],
      OPTIONS,
    );
    assert.deepEqual(drawn.map((arc) => arc.tier).sort(), ['adversary', 'ally', 'strained']);
    assert.deepEqual([...drawnTiers()].sort(), ['adversary', 'ally', 'strained']);
  });
});

describe('an arc says what it is, on more than one channel', () => {
  it('carries colour, stroke AND a dash state', () => {
    // Phase B1 again: an arc map read by someone who cannot separate the hues
    // would otherwise be a tangle of identical lines.
    const [arc] = arcsFor([result('ally')], OPTIONS);
    assert.ok(arc);
    assert.match(arc.color, /^#|rgb/i);
    assert.ok(arc.stroke > 0);
    assert.equal(typeof arc.dashed, 'boolean');
  });

  it('a stronger classification draws a thicker line', () => {
    const strong = arcsFor([result('ally', { score: 8 })], OPTIONS)[0];
    const weak = arcsFor([result('strained', { score: -2 })], OPTIONS)[0];
    assert.ok(strong && weak);
    assert.ok(strong.stroke > weak.stroke, 'stroke does not vary, so colour is the only channel');
  });

  it('a low-confidence arc is dashed as well as muted', () => {
    /**
     * The channel that survives a greyscale screenshot. It marks the same state
     * the relations row marks with its muted palette, so the two renderings of
     * one claim stay consistent.
     */
    const [confident] = arcsFor([result('ally')], OPTIONS);
    const [shaky] = arcsFor([result('ally', { lowConfidence: true })], OPTIONS);
    assert.equal(confident?.dashed, false);
    assert.equal(shaky?.dashed, true);
    assert.notEqual(confident?.color, shaky?.color, 'low confidence is not distinguished by colour at all');
  });

  it('the label says the classification is ours, not a source\'s', () => {
    const [arc] = arcsFor([result('adversary')], OPTIONS);
    assert.match(arc?.label ?? '', /Classified by this app/);
    assert.match(arc?.label ?? '', /not reported by any source/);
  });

  it('and names both endpoints, so a hovered line is identifiable', () => {
    const [arc] = arcsFor([result('ally')], OPTIONS);
    assert.match(arc?.label ?? '', /Aland/);
    assert.match(arc?.label ?? '', /Country BBB/);
  });
});

describe('an arc lands on the mainland', () => {
  it('picks the largest ring, not the first one', () => {
    /**
     * The naive choice puts France's endpoint in French Guiana and the United
     * States' somewhere in the Aleutians, because a MultiPolygon's ring order
     * is a property of the source file rather than of the country.
     */
    const tiny: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const big: Array<[number, number]> = [
      [10, 10],
      [30, 10],
      [30, 30],
      [10, 30],
    ];
    assert.equal(largestRing([tiny, big]), big);
    assert.equal(largestRing([big, tiny]), big, 'the answer depends on input order, which is the bug');
  });

  it('returns null for no rings rather than a default coordinate', () => {
    // (0,0) is in the Gulf of Guinea, which is where every bad coordinate in
    // every mapping application ends up. A null cannot be drawn by accident.
    assert.equal(largestRing([]), null);
  });
});
