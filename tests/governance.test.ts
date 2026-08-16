import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GOVERNANCE_SOURCES,
  PRESS_FREEDOM_ND_RULE,
  blockedGovernanceSources,
  calendarDropped,
  calendarGeneratedOn,
  electionsFor,
} from '../src/dossier/governance';

/**
 * Phase C.4 — governance layers.
 *
 * One of four sources works. The tests are about the election calendar being
 * real, and about the other three staying distinguishable rather than merging
 * into one unusable "unavailable".
 */

describe('the election calendar is real data', () => {
  it('holds elections, or the calendar proves nothing', () => {
    const swedish = electionsFor('SWE');
    assert.ok(swedish.length > 0, 'no Swedish election found in the generated calendar');
  });

  it('is sorted soonest first, per country', () => {
    for (const iso of ['SWE', 'PER', 'AUS']) {
      const dates = electionsFor(iso).map((election) => election.date);
      assert.deepEqual(dates, [...dates].sort(), `${iso} is not in date order`);
    }
  });

  it('discloses what it dropped rather than hiding it', () => {
    /**
     * Ten entities in the window had no English label, so Wikidata returned
     * their own Q-ids. Rendering "Q139270875" would put a database identifier
     * on a public surface as though it were an election name — so they are
     * dropped, and the count says the window held more than the list shows.
     */
    assert.ok(calendarDropped() > 0, 'nothing was dropped — the disclosure is untested');
    assert.match(calendarGeneratedOn(), /^\d{4}-\d{2}-\d{2}$/);
  });

  it('no election name is a bare Q-id', () => {
    for (const iso of ['SWE', 'RUS', 'PER', 'SVK', 'AUS']) {
      for (const election of electionsFor(iso)) {
        assert.doesNotMatch(election.name, /^Q\d+$/, `${iso} has an unlabelled election in the list`);
      }
    }
  });

  it('a country with no scheduled election returns empty, not a guess', () => {
    assert.deepEqual(electionsFor('__NONE__'), []);
  });
});

describe('three blocked sources stay three different facts', () => {
  it('each blocked source quotes what was observed and names a remedy', () => {
    const blocked = blockedGovernanceSources();
    assert.equal(blocked.length, 3, `expected 3 blocked sources, got ${blocked.length}`);
    for (const source of blocked) {
      assert.ok(source.observed.trim().length > 20, `${source.id} does not say what was observed`);
      assert.ok((source.remedy ?? '').trim().length > 20, `${source.id} has no remedy`);
    }
  });

  it('names the ones that are OUR guesses rather than their gates', () => {
    /**
     * UN voting and CIVICUS both failed on URLs this app inferred. Recorded as
     * ours, because a 404 on a guessed endpoint is a fact about the guess — and
     * filed among someone else's access controls it would look like a locked
     * door instead of a wrong address.
     */
    const un = GOVERNANCE_SOURCES.find((source) => source.id === 'un-voting');
    assert.match(un?.remedy ?? '', /THIS ONE IS OURS/);
    const civicus = GOVERNANCE_SOURCES.find((source) => source.id === 'civicus');
    assert.match(civicus?.remedy ?? '', /about our guess/);
  });

  it('the available source is not filed as blocked', () => {
    // Positive control: a list where everything is blocked would satisfy every
    // assertion above while proving the calendar does not work.
    const available = GOVERNANCE_SOURCES.filter((source) => source.state === 'available');
    assert.equal(available.length, 1);
    assert.equal(available[0]?.id, 'wikidata-elections');
  });
});

describe('press freedom is display-only, and that is a licence term', () => {
  it('the rule forbids every form of derivation, not just some', () => {
    /**
     * An ND licence permits display and forbids derivative works. A score
     * rescaled to this app's palette, averaged across years, or folded into a
     * composite is a derivative — and the no-composite-scores prohibition
     * forbids the same thing for an unrelated reason, which is a useful
     * coincidence rather than a substitute.
     */
    for (const forbidden of ['rescaled', 'averaged', 'recombined', 'input to any']) {
      assert.match(PRESS_FREEDOM_ND_RULE, new RegExp(forbidden, 'i'), `the rule does not forbid "${forbidden}"`);
    }
    assert.match(PRESS_FREEDOM_ND_RULE, /licence forbids derivative works/i);
  });

  it('the source entry says the licence must be read FIRST', () => {
    const rsf = GOVERNANCE_SOURCES.find((source) => source.id === 'rsf');
    assert.match(rsf?.remedy ?? '', /licence before anything else/i);
    assert.match(rsf?.remedy ?? '', /DISPLAYED AS-IS/);
  });
});
