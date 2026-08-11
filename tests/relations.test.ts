import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFindings, loadFacts } from '../src/relations/facts';
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, pairKey, score } from '../src/relations/score';

const facts = loadFacts();
const findings = buildFindings(facts);

/** Score a pair with the default weights, as of a fixed year so tests do not drift. */
const YEAR = 2026;
function rate(a: string, b: string) {
  return score(a, b, findings.get(pairKey(a, b)), DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS, YEAR);
}

describe('relation scoring', () => {
  it('classifies a NATO partner as an ally with visible arithmetic', () => {
    const result = rate('USA', 'GBR');
    assert.equal(result.tier, 'ally');
    // NATO defence bloc (+3) and Five Eyes intel sharing (+2).
    assert.equal(result.score, 5);
    assert.deepEqual(
      result.inputs.map((input) => input.kind).sort(),
      ['intelSharing', 'sharedDefenseBloc'],
    );
    assert.equal(result.lowConfidence, false);
  });

  it('classifies an active state-based conflict as an adversary', () => {
    const result = rate('RUS', 'UKR');
    assert.equal(result.tier, 'adversary');
    assert.ok(result.inputs.some((input) => input.kind === 'activeConflict'));
  });

  it('refuses to escalate one-way sanctions into adversary', () => {
    // The US and Russia have not severed relations and are not in a state-based
    // armed conflict with each other. On the seeded evidence that is a strained
    // relation, and calling it adversary would be the app asserting more than
    // its inputs support.
    const result = rate('USA', 'RUS');
    assert.equal(result.tier, 'strained');
    assert.deepEqual(
      result.inputs.map((input) => input.kind),
      ['oneWaySanctions'],
    );
  });

  it('collapses reciprocal sanctions into a single mutual finding', () => {
    const result = rate('FRA', 'RUS');
    const sanctionInputs = result.inputs.filter((input) => input.kind.endsWith('Sanctions'));
    assert.equal(sanctionInputs.length, 1, 'reciprocal sanctions must not be counted twice');
    assert.equal(sanctionInputs[0]?.kind, 'mutualSanctions');
  });

  it('reports no data rather than neutral when nothing is known', () => {
    const result = rate('USA', 'MNG');
    assert.equal(result.tier, 'nodata');
    assert.equal(result.inputs.length, 0);
    assert.equal(result.score, 0);
  });

  it('flags a classification resting on a dataset that ended in 2012', () => {
    const result = rate('USA', 'THA');
    // Evidence exists but is 14 years old. It must not read the same as a pair
    // where current evidence genuinely nets out to neutral.
    assert.equal(result.tier, 'neutral');
    assert.equal(result.lowConfidence, true, 'stale-only evidence must be flagged, at every tier');
    assert.equal(result.staleWeightShare, 1);
    assert.equal(result.inputs[0]?.coverageEnd, 2012);
    assert.equal(result.inputs[0]?.ageYears, YEAR - 2012);
    assert.equal(result.inputs[0]?.stale, true);
  });

  it('does not mark current evidence as stale', () => {
    const result = rate('USA', 'JPN');
    assert.equal(result.staleWeightShare, 0);
    assert.equal(result.lowConfidence, false);
  });

  it('recolours when weights change, without rebuilding findings', () => {
    const pacifist = { ...DEFAULT_WEIGHTS, sharedDefenseBloc: 0, intelSharing: 0 };
    const result = score('USA', 'GBR', findings.get(pairKey('USA', 'GBR')), pacifist, DEFAULT_THRESHOLDS, YEAR);
    assert.equal(result.score, 0);
    assert.equal(result.tier, 'neutral');
  });

  it('keeps every input traceable to a named source', () => {
    for (const [key, list] of findings) {
      for (const finding of list) {
        assert.ok(finding.source.length > 0, `${key}: ${finding.kind} has no source`);
        assert.ok(finding.sourceUrl.startsWith('http'), `${key}: ${finding.kind} has no source URL`);
        assert.ok(Number.isInteger(finding.coverageEnd), `${key}: ${finding.kind} has no coverage year`);
      }
    }
  });

  it('is symmetric', () => {
    assert.equal(rate('USA', 'IRN').score, rate('IRN', 'USA').score);
    assert.equal(rate('RUS', 'UKR').tier, rate('UKR', 'RUS').tier);
  });
});
