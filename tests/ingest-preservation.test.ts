import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NONE_RECORDED,
  assertArmedForcesDeclared,
  describeOverseasPresence,
  forcesSummary,
  type MilitaryProfile,
} from '../src/dossier/military';

/**
 * Item 4b of `CORE-GOAL.md` — the distinctions a naive ingest collapses.
 *
 * ## Why these tests exist BEFORE the pipeline does
 *
 * `UNEXERCISED-PATHS` §15 lists three distinctions step 10 must not lose, and
 * records them as prose. A requirement written in a findings file is a note
 * until something checks it — P12's whole point, and the reason the P3 caveat
 * went four days describing behaviour that had never been built.
 *
 * So the requirement is checked now, against the boundary an ingest actually
 * is: **serialisation**. Every pipeline writes values out and reads them back,
 * and that round trip is where `null` becomes `[]`, where `undefined` becomes
 * `false`, and where three states quietly become two.
 *
 * These tests do not need the pipeline to exist. They need the MODEL to survive
 * the thing a pipeline does to it, and they fail the moment it stops.
 */

/**
 * The transformation a careless ingest performs, written out honestly.
 *
 * This is not a strawman. "No rows came back, so use an empty array" is the
 * single most natural line to write in an ingest, and it converts *not
 * consulted* into *consulted and empty* — which the panel then renders as
 * "None recorded" about a question nobody asked.
 */
function naiveIngest(profile: MilitaryProfile): MilitaryProfile {
  return {
    ...profile,
    overseasPresence: profile.overseasPresence ?? [],
  };
}

/** A round trip through JSON, which is what any real ingest boundary is. */
function throughJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function profile(over: Partial<MilitaryProfile> = {}): MilitaryProfile {
  return {
    iso3: 'AAA',
    hasArmedForces: true,
    personnel: null,
    expenditure: null,
    nuclearStatus: 'npt-non-nuclear-weapon-state',
    warheads: null,
    command: null,
    overseasPresence: null,
    ...over,
  };
}

describe('4b: abolished, absent and present stay three things', () => {
  it('the three states are genuinely distinct before anything touches them', () => {
    // Rule 40: state the sample's states, or the collapse test below could pass
    // on a sample that only contained one of them.
    assert.equal(forcesSummary(profile({ hasArmedForces: false })), 'abolished');
    assert.equal(forcesSummary(profile({ hasArmedForces: true })), 'absent');
    assert.equal(
      forcesSummary(profile({ hasArmedForces: true, personnel: { value: 1, asOf: '2026', tier: 'OFFICIAL', provenance: null } })),
      'present',
    );
  });

  it('survives a JSON round trip', () => {
    /**
     * The specific failure: a country with no rows looks identical to a country
     * with no forces. `hasArmedForces` is the only thing keeping them apart,
     * and a boolean is exactly the field an ingest drops when the source does
     * not supply it — which, per OPEN-QUESTIONS 31, no source does.
     */
    for (const [label, input] of [
      ['abolished', profile({ hasArmedForces: false })],
      ['absent', profile({ hasArmedForces: true })],
    ] as const) {
      const before = forcesSummary(input);
      const after = forcesSummary(throughJson(input));
      assert.equal(after, before, `${label} did not survive serialisation`);
    }
  });

  it('an ingest row with no hasArmedForces is REFUSED, not defaulted', () => {
    /**
     * PLANTED, and this is the one that will actually happen.
     *
     * `forcesSummary` reads `!profile.hasArmedForces`, so a field nobody set is
     * indistinguishable from `false` — and `false` says the country abolished
     * its armed forces. An ingest that omits the field makes the app state that
     * about a country because a boolean went unwritten. Emergency 3.
     *
     * The first version of this test asserted the hazard and moved on, using a
     * cast to build the broken shape. That documents a landmine. The guard
     * removes it, and needs no cast because it takes the shape an ingest
     * actually produces: a row with optional fields.
     */
    assert.throws(() => assertArmedForcesDeclared({ iso3: 'CRI' }), /has no hasArmedForces value/);
    assert.throws(() => assertArmedForcesDeclared({ iso3: 'CRI', hasArmedForces: undefined }), /undefined/);
    assert.throws(() => assertArmedForcesDeclared({ iso3: 'CRI', hasArmedForces: null }), /null/);

    /**
     * A STRING IS THE SUBTLE ONE. `"false"` is truthy, so a CSV or JSON ingest
     * that never coerced its types would report a country with no army as
     * HAVING one — the opposite error, equally confident.
     */
    assert.throws(() => assertArmedForcesDeclared({ iso3: 'CRI', hasArmedForces: 'false' }), /"false"/);

    // positive control: both real booleans pass
    assert.doesNotThrow(() => assertArmedForcesDeclared({ iso3: 'CRI', hasArmedForces: false }));
    assert.doesNotThrow(() => assertArmedForcesDeclared({ iso3: 'FRA', hasArmedForces: true }));
  });

  it('the guard names the country and the reason, so a pipeline failure is actionable', () => {
    // A refusal that does not say which country stopped the ingest sends
    // someone to read 200 rows.
    assert.throws(() => assertArmedForcesDeclared({ iso3: 'PAN' }), /PAN/);
    assert.throws(() => assertArmedForcesDeclared({ iso3: 'PAN' }), /OPEN-QUESTIONS 31/);
  });
});

describe('4b: null overseas presence is not an empty one', () => {
  it('null and [] say different things', () => {
    assert.equal(describeOverseasPresence(null), 'Not recorded');
    assert.equal(describeOverseasPresence([]), NONE_RECORDED);
    assert.notEqual(describeOverseasPresence(null), describeOverseasPresence([]));
  });

  it('survives a JSON round trip in both states', () => {
    // JSON preserves null, so the model is safe across the boundary itself.
    // What is not safe is the code on either side of it.
    assert.equal(throughJson(profile({ overseasPresence: null })).overseasPresence, null);
    assert.deepEqual(throughJson(profile({ overseasPresence: [] })).overseasPresence, []);
  });

  it('THE NAIVE INGEST IS CAUGHT — `?? []` converts not-consulted into consulted-and-empty', () => {
    /**
     * The exact line §15 warns about, executed, with the damage measured.
     *
     * Before: "Not recorded" — we did not ask.
     * After:  "None recorded" — we asked and there was nothing.
     *
     * The second is a claim about the world. The first is a claim about us.
     */
    const notConsulted = profile({ overseasPresence: null });
    assert.equal(describeOverseasPresence(notConsulted.overseasPresence), 'Not recorded');

    const damaged = naiveIngest(notConsulted);
    assert.equal(
      describeOverseasPresence(damaged.overseasPresence),
      NONE_RECORDED,
      'if this ever stops being NONE_RECORDED the naive ingest has changed and this test needs rewriting',
    );

    // The assertion that matters: the two are not the same, and a pipeline that
    // makes them the same has destroyed information.
    assert.notEqual(
      describeOverseasPresence(damaged.overseasPresence),
      describeOverseasPresence(notConsulted.overseasPresence),
      'the naive ingest is now lossless, which would mean the distinction is gone',
    );
  });

  it('the bare word "none" never escapes, in any state', () => {
    // Rule 30's register. "None" alone is an answer of no; every string this
    // function returns must qualify what kind of nothing it is.
    for (const input of [null, [], [{ host: 'X', personnel: { value: 1, asOf: '2026', tier: 'OFFICIAL' as const, provenance: null } }]]) {
      const text = describeOverseasPresence(input as never);
      assert.doesNotMatch(text, /^none$/i, `"${text}" is a bare "none"`);
    }
  });
});

describe('4b: tier follows the source, per row', () => {
  it('a profile can hold facts at different tiers at once', () => {
    /**
     * §15's fourth item. FAS warhead figures are ESTIMATE because FAS says so,
     * while personnel from a ministry is OFFICIAL. An ingest that tiers the
     * whole tab would flatten them, and the flattening is invisible: every
     * number still renders, with a badge that is now wrong.
     */
    const mixed = profile({
      hasArmedForces: true,
      personnel: { value: 100, asOf: '2026', tier: 'OFFICIAL', provenance: null },
      warheads: { value: 90, asOf: '2026', tier: 'ESTIMATE', provenance: null },
    });
    const after = throughJson(mixed);
    assert.equal(after.personnel?.tier, 'OFFICIAL');
    assert.equal(after.warheads?.tier, 'ESTIMATE');
    assert.notEqual(after.personnel?.tier, after.warheads?.tier, 'the tiers were flattened to one');
  });
});
