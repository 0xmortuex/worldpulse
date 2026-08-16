import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import table from '../data/armed-forces.json';

/**
 * The `hasArmedForces` table — OPEN-QUESTIONS 31, answered.
 *
 * The decision was option A **with option C's discipline where it matters**:
 * the query generates the table, a human reviews what it cannot settle,
 * reviewed entries carry a citation, the table is committed rather than
 * fetched, and a status flip on re-run is a finding rather than an update.
 *
 * These tests hold the parts of that a file can hold. What they cannot check
 * is whether a reviewer actually reviewed — so the one thing they insist on is
 * that an override without a citation is not allowed to exist.
 */

interface Entry {
  country: string;
  hasArmedForces: boolean;
  queryConcluded: boolean;
  liveForces: string[];
  dissolvedForces: string[];
  needsReview: boolean;
  reviewReasons: string[];
  reviewedOn: string | null;
  citation: string | null;
}

const ENTRIES = (table as { entries: Record<string, Entry> }).entries;
const ROWS = Object.entries(ENTRIES);

/**
 * Ground truth, hand-checked. Deliberately small and deliberately hard:
 * three abolitions the query gets wrong, one disband-and-remobilise it gets
 * right, and four ordinary militaries as the positive control.
 */
const GROUND_TRUTH: Record<string, boolean> = {
  CRI: false,
  PAN: false,
  ISL: false,
  HTI: true,
  FRA: true,
  USA: true,
  NZL: true,
  JPN: true,
};

describe('the armed-forces table matches what was hand-checked', () => {
  it('every ground-truth country is present and correct', () => {
    for (const [iso, expected] of Object.entries(GROUND_TRUTH)) {
      const entry = ENTRIES[iso];
      assert.ok(entry, `${iso} is missing from the table`);
      assert.equal(entry.hasArmedForces, expected, `${iso}: table says ${entry.hasArmedForces}`);
    }
  });

  it('records where the query DISAGREED, rather than hiding it behind the answer', () => {
    /**
     * The three abolitions are the whole reason human review is in this design.
     * Wikidata types each country's police or defence agency as armed forces —
     * not a data error, a definitional boundary.
     *
     * `queryConcluded` keeps the raw verdict beside the reviewed one, so a
     * future re-run that finally agrees can retire the override instead of
     * carrying it forever.
     */
    for (const iso of ['CRI', 'PAN', 'ISL']) {
      const entry = ENTRIES[iso]!;
      assert.equal(entry.queryConcluded, true, `${iso}: the query no longer disagrees — recheck the override`);
      assert.equal(entry.hasArmedForces, false);
      assert.notEqual(entry.hasArmedForces, entry.queryConcluded);
    }
  });

  it('Haiti is right WITHOUT an override — the dissolution filter earns its keep', () => {
    /**
     * The disband-and-remobilise case, and the strongest evidence for the
     * query-generated approach: disbanded 1995, remobilised 2017, and the
     * live-force filter resolves it with no special-casing at all.
     */
    const haiti = ENTRIES['HTI']!;
    assert.equal(haiti.hasArmedForces, true);
    assert.equal(haiti.queryConcluded, true, 'the query no longer gets Haiti right on its own');
    assert.ok(
      haiti.dissolvedForces.some((force) => /1995/.test(force)),
      'the 1995 dissolution is no longer recorded, so the filter is passing for a different reason',
    );
  });
});

describe('an override without a citation cannot exist', () => {
  it('every entry that contradicts the query carries a citation and a date', () => {
    /**
     * THE ONE RULE A FILE CAN ACTUALLY ENFORCE.
     *
     * Nothing here can check that a human thought about an entry. It can insist
     * that a value contradicting the evidence says who decided and on what
     * basis — the leader-override precedent, and the same principle as the
     * entity table's "a recorded doubt with no expiry is a comment".
     */
    for (const [iso, entry] of ROWS) {
      if (entry.hasArmedForces === entry.queryConcluded) continue;
      assert.ok(
        (entry.citation ?? '').trim().length > 20,
        `${iso} overrides the query with no citation`,
      );
      assert.match(entry.reviewedOn ?? '', /^\d{4}-\d{2}-\d{2}$/, `${iso} overrides the query undated`);
    }
  });

  it('a flagged entry says WHY it is flagged', () => {
    for (const [iso, entry] of ROWS) {
      if (!entry.needsReview) continue;
      assert.ok(entry.reviewReasons.length > 0, `${iso} is flagged with no reason given`);
    }
  });
});

describe('the review queue is small enough to be read', () => {
  it('flags a minority of countries, not most of them', () => {
    /**
     * An earlier version flagged any country with both dissolved and live
     * forces, which fired for France and the United States — every long-lived
     * military has historical units with end dates. **A rule that flags the G7
     * flags nothing**: 24 entries is a queue, 190 is a wall, and a wall gets
     * skimmed.
     */
    const flagged = ROWS.filter(([, entry]) => entry.needsReview).length;
    assert.ok(flagged > 0, 'nothing is flagged, so the review path is unexercised');
    assert.ok(flagged < ROWS.length / 4, `${flagged} of ${ROWS.length} flagged — the queue is a wall`);
  });

  it('ordinary militaries are not flagged', () => {
    // The specific false-positive class that made the first rule useless.
    for (const iso of ['FRA', 'USA', 'NZL', 'JPN']) {
      assert.equal(ENTRIES[iso]?.needsReview, false, `${iso} is flagged, which means the noise is back`);
    }
  });
});

describe('the table describes itself', () => {
  it('every entry carries the fields a reviewer needs', () => {
    for (const [iso, entry] of ROWS) {
      assert.equal(typeof entry.hasArmedForces, 'boolean', `${iso} has no boolean verdict`);
      assert.equal(typeof entry.queryConcluded, 'boolean', `${iso} does not record what the query said`);
      assert.ok(Array.isArray(entry.liveForces), `${iso} does not record what the query saw`);
    }
  });

  it('is dated, so a stale table is visible as one', () => {
    assert.match((table as { generatedOn: string }).generatedOn, /^\d{4}-\d{2}-\d{2}$/);
  });
});
