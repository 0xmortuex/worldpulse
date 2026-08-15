import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NONE_RECORDED,
  describeCommand,
  describeOverseasPresence,
  describeWarheads,
  forcesSummary,
  type Command,
  type Deployment,
  type MilitaryProfile,
} from '../src/dossier/military';
import type { Fact } from '../src/facts/types';

/**
 * Step 8's fixture hard cases, written BEFORE the panel renders anything.
 *
 * `BUILD-ORDER.md` lists six, and each is here because a plausible panel would
 * otherwise state something false. These are not edge cases in the sense of
 * being rare — a country with no armed forces and a head of government who is
 * also commander-in-chief are both ordinary. They are hard because the naive
 * rendering of each is a lie.
 */

const fact = (value: number | null): Fact<number> => ({
  value,
  asOf: '2026',
  tier: 'OFFICIAL',
  provenance: {
    kind: 'seed',
    file: 'tests/military.test.ts',
    source: 'planted',
    sourceUrl: 'https://example.invalid/',
    coverageEnd: 2026,
    compiledAt: '2026-08-15T00:00:00Z',
  },
});

const profile = (over: Partial<MilitaryProfile> = {}): MilitaryProfile => ({
  iso3: 'TST',
  hasArmedForces: true,
  personnel: fact(10_000),
  expenditure: fact(1_000_000_000),
  nuclearStatus: 'npt-non-nuclear-weapon-state',
  warheads: null,
  command: null,
  overseasPresence: null,
  ...over,
});

describe('hard case — zero recorded overseas presence', () => {
  /**
   * THE ACCEPTANCE CRITERION FOR THE WHOLE STEP.
   *
   * "None recorded" and "none" are different claims about the world. Overseas
   * military presence is the domain where absence of records is weakest as
   * evidence of absence, because the deployments most likely to go unrecorded
   * are exactly the ones a state chooses not to record.
   */
  it('an empty list says none RECORDED, never none', () => {
    const described = describeOverseasPresence([]);
    assert.equal(described, NONE_RECORDED);
    assert.match(described, /recorded/i, 'the qualifier was dropped');
  });

  it('the bare word "none" never escapes as a standalone claim', () => {
    for (const presence of [null, [] as Deployment[]]) {
      const described = describeOverseasPresence(presence);
      const bare = /\bnone\b(?!\s+recorded)/i.test(described);
      assert.equal(bare, false, `"${described}" asserts absence rather than absence of records`);
    }
  });

  it('not-consulted and consulted-but-empty are different sentences', () => {
    // Both decline to assert absence; they differ in what they say about why,
    // and collapsing them would lose the reason.
    assert.notEqual(describeOverseasPresence(null), describeOverseasPresence([]));
  });

  it('a real deployment reports personnel and host count', () => {
    const deployments: Deployment[] = [
      { hostIso3: 'MLI', hostName: 'Mali', personnel: fact(1200), kind: 'UN peacekeeping' },
      { hostIso3: 'DJI', hostName: 'Djibouti', personnel: fact(800), kind: 'bilateral basing' },
    ];
    const described = describeOverseasPresence(deployments);
    assert.match(described, /2,000/);
    assert.match(described, /2 host countries/);
  });
});

describe('hard case — a country with no armed forces', () => {
  /**
   * Costa Rica abolished its military in 1949. That is a fact about Costa Rica.
   * Rendering the panel as a wall of "no data" would report OUR ignorance and
   * attribute it to them.
   */
  it('is abolished, not absent', () => {
    const costaRica = profile({ hasArmedForces: false, personnel: null, expenditure: null });
    assert.equal(forcesSummary(costaRica), 'abolished');
  });

  it('is distinguished from a country whose figures are merely missing', () => {
    const unknown = profile({ hasArmedForces: true, personnel: null, expenditure: null });
    assert.equal(forcesSummary(unknown), 'absent');
    assert.notEqual(forcesSummary(unknown), forcesSummary(profile({ hasArmedForces: false })));
  });
});

describe('hard case — expenditure without personnel, and the reverse', () => {
  /**
   * Either can be absent independently. A panel that renders only when both
   * exist hides half the data it has; one that treats a missing half as zero
   * states a falsehood.
   */
  it('reports present when only expenditure is known', () => {
    assert.equal(forcesSummary(profile({ personnel: null })), 'present');
  });

  it('reports present when only personnel is known', () => {
    assert.equal(forcesSummary(profile({ expenditure: null })), 'present');
  });

  it('absent means BOTH are missing, not either', () => {
    assert.equal(forcesSummary(profile({ personnel: null, expenditure: null })), 'absent');
  });
});

describe('hard case — ceremonial versus operational command', () => {
  const holder = (over: Partial<Command> = {}): Command => ({
    title: 'Commander-in-Chief',
    holderName: 'A. Person',
    ceremonial: true,
    alsoHeadOfGovernment: false,
    ...over,
  });

  it('says so when the office is ceremonial', () => {
    const described = describeCommand(holder({ ceremonial: true }));
    assert.match(described ?? '', /ceremonial/i);
  });

  it('does not add the qualifier when command is operational', () => {
    const described = describeCommand(holder({ ceremonial: false }));
    assert.equal(/ceremonial/i.test(described ?? ''), false);
  });

  it('renders nothing rather than a placeholder when the holder is unknown', () => {
    // An empty command line is honest. An invented one is not.
    assert.equal(describeCommand(holder({ holderName: null })), null);
    assert.equal(describeCommand(null), null);
  });
});

describe('hard case — C-in-C is the same person as the head of government', () => {
  it('says one person holds both, rather than listing them twice', () => {
    const described = describeCommand({
      title: 'Commander-in-Chief',
      holderName: 'B. Person',
      ceremonial: false,
      alsoHeadOfGovernment: true,
    });
    assert.match(described ?? '', /also head of government/i);
    // The name must appear exactly once: twice would read as two people.
    assert.equal((described ?? '').split('B. Person').length - 1, 1);
  });
});

describe('hard case — non-NPT and undeclared nuclear states', () => {
  /**
   * FAS publishes estimates for states that have never declared an arsenal. For
   * those states the estimate is the ENTIRE claim, and rendering it with the
   * confidence of a declaration asserts something no state has said.
   */
  it('an undeclared state’s figure is named as an outside estimate', () => {
    const described = describeWarheads(
      profile({ nuclearStatus: 'non-npt-undeclared', warheads: fact(90) }),
    );
    assert.match(described ?? '', /outside estimate/i);
    assert.match(described ?? '', /never declared/i);
  });

  it('a declared non-NPT state is described differently from an undeclared one', () => {
    const declared = describeWarheads(
      profile({ nuclearStatus: 'non-npt-declared', warheads: fact(170) }),
    );
    const undeclared = describeWarheads(
      profile({ nuclearStatus: 'non-npt-undeclared', warheads: fact(90) }),
    );
    assert.notEqual(declared, undeclared);
    assert.match(declared ?? '', /declared arsenal/i);
  });

  it('every status yields a sentence that calls the figure estimated', () => {
    for (const status of [
      'npt-nuclear-weapon-state',
      'npt-non-nuclear-weapon-state',
      'non-npt-declared',
      'non-npt-undeclared',
      'unknown',
    ] as const) {
      const described = describeWarheads(profile({ nuclearStatus: status, warheads: fact(10) }));
      assert.match(described ?? '', /estimat/i, `${status} did not mark the figure as an estimate`);
    }
  });

  it('no warheads recorded renders nothing rather than zero', () => {
    // Rule 30: a state with no published estimate is not a state with none.
    assert.equal(describeWarheads(profile({ warheads: null })), null);
    assert.equal(describeWarheads(profile({ warheads: fact(null) })), null);
  });
});
