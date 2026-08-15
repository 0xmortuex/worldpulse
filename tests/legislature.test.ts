import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  APPOINTED_CONSULTATIVE,
  LEGISLATURE_CONTESTED,
  LEGISLATURE_DISSOLVED,
  LEGISLATURE_SUSPENDED,
  NO_ELECTED_LEGISLATURE,
  cameralDescription,
  seatTotal,
  statusSentence,
  type LegislatureProfile,
} from '../src/dossier/legislature';
import { legislatureFor, readStatus } from '../src/dossier/legislature-provider';

/**
 * Step 9 — the legislature model.
 *
 * Every case here is planted, because the states that matter most are the ones
 * no capture contains: a dissolved legislature, a suspended one, a chamber list
 * cut off by a row cap. Rule 27 — a scanner ships with its planted case — and
 * rule 33 — the plant must describe a state the real system can reach.
 *
 * The one it CANNOT reach is called out where it appears.
 */

function profile(over: Partial<LegislatureProfile> = {}): LegislatureProfile {
  return {
    status: 'sitting',
    statusSource: { name: 'test', url: 'https://example.invalid/' },
    statusAsOf: '2026-08',
    statusNote: null,
    upperChamberSelection: null,
    chambers: [],
    chambersCtx: null,
    truncated: false,
    ...over,
  };
}

function chamber(label: string, seats: number | null) {
  return { qid: `Q${label.length}`, label, seats, parties: [] };
}

/** Every status that produces a sentence — the ones with a forward-reference risk. */
const STATUSES_WITH_SENTENCES = [
  'dissolved',
  'suspended',
  'contested',
  'appointed-consultative',
  'no-elected-legislature',
] as const;

describe('legislature: no answer is not an answer of no', () => {
  it('an empty chamber list is not "unicameral"', () => {
    /**
     * The specific confusion this returns null to avoid. One chamber and no
     * chambers are one apart as counts and unrelated as facts, and a panel that
     * renders "Unicameral" over an empty list has invented a legislature.
     */
    assert.equal(cameralDescription(profile({ chambers: [] })), null);
    assert.equal(cameralDescription(profile({ chambers: [chamber('Althing', 63)] })), 'Unicameral');
  });

  it('distinguishes the four reasons a chamber list can be empty', () => {
    // Each renders a different sentence, and none of them says "no legislature"
    // unless that is the recorded fact.
    assert.equal(statusSentence(profile({ status: 'dissolved' })), LEGISLATURE_DISSOLVED);
    assert.equal(statusSentence(profile({ status: 'suspended' })), LEGISLATURE_SUSPENDED);
    assert.equal(statusSentence(profile({ status: 'contested' })), LEGISLATURE_CONTESTED);
    assert.equal(statusSentence(profile({ status: 'no-elected-legislature' })), NO_ELECTED_LEGISLATURE);

    // Sitting and unrecorded both render nothing — but for opposite reasons,
    // which is why the panel says elsewhere that the status is unrecorded.
    assert.equal(statusSentence(profile({ status: 'sitting' })), null);
    assert.equal(statusSentence(profile({ status: 'unrecorded' })), null);
  });

  it('an unknown status in the seed file throws rather than rendering as sitting', () => {
    /**
     * PLANTED, and the first version of this test was worthless.
     *
     * It asserted a throw from an expression that could not throw, passed
     * nothing meaningful, and would have shipped as coverage. The guard was not
     * reachable from a test because it was module-private — rule 32's exact
     * condition, met by exporting it rather than by asserting around it.
     *
     * The failure being prevented is silent: an unknown status falls through
     * `statusSentence`'s switch to `null`, so a suspended legislature renders
     * identically to a sitting one.
     */
    assert.throws(() => readStatus('sittign', 'GBR'), /unknown status "sittign"/);
    assert.throws(() => readStatus('', 'GBR'), /unknown status/);

    // positive control: every status the model declares is accepted
    for (const status of ['sitting', 'dissolved', 'suspended', 'contested', 'unrecorded']) {
      assert.equal(readStatus(status, 'GBR'), status);
    }
  });
});

describe('legislature: a partial total is not a total', () => {
  it('withholds the combined total when any chamber has no seat count', () => {
    /**
     * The party bar's mistake, one level up. A sum over two of three chambers
     * reads as the size of the legislature and is not, and an asterisk does not
     * repair it — the number has already been read.
     */
    const partial = profile({
      chambers: [chamber('Lower', 400), chamber('Upper', null)],
    });
    const total = seatTotal(partial);
    assert.equal(total.total, null);
    assert.equal(total.chambersWithoutSeats, 1);
    assert.equal(total.complete, false);
  });

  it('gives a total when every chamber has one', () => {
    const full = profile({ chambers: [chamber('Commons', 650), chamber('Lords', 808)] });
    assert.deepEqual(seatTotal(full), { total: 1458, chambersWithoutSeats: 0, complete: true });
  });

  it('a truncated list is never complete, even when every chamber it HAS has seats', () => {
    /**
     * The distinction the cabinet truncation taught. Every row present can be
     * fully populated and the set still be a floor — completeness of the rows
     * says nothing about completeness of the list.
     */
    const cut = profile({ chambers: [chamber('First', 100), chamber('Second', 50)], truncated: true });
    const total = seatTotal(cut);
    assert.equal(total.total, 150, 'the sum of what IS present is still worth reporting');
    assert.equal(total.complete, false, 'a truncated list reported as complete is the silent-truncation bug');
  });

  it('describes a truncated chamber list as a floor', () => {
    const cut = profile({ chambers: [chamber('A', 1), chamber('B', 2)], truncated: true });
    assert.equal(cameralDescription(cut), 'at least 2 chambers');
    // and NOT "Bicameral", which would be a claim the data cannot support
    assert.notEqual(cameralDescription(cut), 'Bicameral');
  });
});

describe('legislature: the seeded profiles', () => {
  it('the United Kingdom is bicameral with an appointed upper chamber', () => {
    const gbr = legislatureFor('GBR');
    assert.equal(gbr.status, 'sitting');
    assert.equal(gbr.upperChamberSelection, 'appointed');
    assert.equal(cameralDescription(gbr), 'Bicameral');
  });

  it('Iceland is unicameral', () => {
    const isl = legislatureFor('ISL');
    assert.equal(cameralDescription(isl), 'Unicameral');
  });

  it('Saudi Arabia records WHY it has no chambers, rather than reporting none', () => {
    /**
     * The measured upstream gap: SAU's P194 points at "Government of Saudi
     * Arabia", which reaches no chamber type at any depth — including an
     * unbounded walk, tried specifically to rule the bounding work in or out.
     * The Consultative Assembly exists as Q818708 with 150 seats and nothing
     * links it to the country.
     *
     * So zero chambers here is a fact about our source, and the seed says so.
     */
    const sau = legislatureFor('SAU');
    assert.equal(sau.chambers.length, 0);
    assert.equal(sau.status, 'appointed-consultative');
    assert.match(sau.statusNote ?? '', /Q818708/, 'the note does not name what the source is missing');
    assert.equal(statusSentence(sau), APPOINTED_CONSULTATIVE);
  });

  it('no status sentence promises a body that may not be rendered', () => {
    /**
     * Found by a browser assertion, not by this file.
     *
     * The appointed and no-elected-legislature cases shared one string ending
     * "…The body listed below exercises delegated or advisory authority."
     * Saudi Arabia renders it with ZERO chambers below, so the sentence
     * referred to nothing. A forward reference is only safe if the thing it
     * points at is guaranteed to exist, and here it was not.
     */
    for (const status of STATUSES_WITH_SENTENCES) {
      const sentence = statusSentence(profile({ status })) ?? '';
      assert.doesNotMatch(
        sentence,
        /below|above|following/i,
        `the "${status}" sentence points at other content, which may not render`,
      );
    }
  });

  it('a country with no seed entry is unrecorded, not "no legislature"', () => {
    const unknown = legislatureFor('TUV');
    assert.equal(unknown.status, 'unrecorded');
    assert.equal(unknown.statusSource, null, 'an unrecorded status must not cite a source for itself');
    assert.equal(cameralDescription(unknown), null);
  });

  it('every seeded profile cites a source that exists, with a date', () => {
    for (const iso of ['GBR', 'ISL', 'SAU', 'LBY', 'VAT']) {
      const entry = legislatureFor(iso);
      assert.ok(entry.statusSource, `${iso} has no status source`);
      assert.match(entry.statusSource.url, /^https:\/\//, `${iso} cites a source with no usable url`);
      assert.match(entry.statusAsOf ?? '', /^\d{4}-\d{2}$/, `${iso} has no as-of date`);
    }
  });
});
