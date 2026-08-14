import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { licenceProblems } from '../scripts/licence-posture.mjs';
import registry from '../data/sources.json';

/**
 * Planted cases for the licence-posture guard (rules 27 and 32).
 *
 * The split it enforces was made because one name, `restricted`, was covering
 * two postures: "we do not touch this" and "we render minimal attributed
 * elements from this". Documenting the difference would not have stopped the
 * next source drifting between them, so the difference is enforced here.
 */
const source = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'src',
  attribution: 'Source credit.',
  ...over,
});

const check = (sources: Array<Record<string, unknown>>): string[] => licenceProblems({ sources });

describe('licence posture', () => {
  it('catches a strict restricted source that the app actually fetches', () => {
    // The planted case the split exists for: the licence says not ingested, the
    // transport says how we ingest it. One of the two is a lie about the app.
    const problems = check([source({ licenseClass: 'restricted', transport: 'worker' })]);
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /not ingested, link-out only/);
    assert.match(problems[0] ?? '', /restricted-minimal/);
  });

  it('allows a strict restricted source with no transport', () => {
    // Link-out only is a real, wanted posture. Keeping it strict is the point of
    // splitting rather than rewording.
    assert.deepEqual(check([source({ licenseClass: 'restricted' })]), []);
  });

  it('allows restricted-minimal to declare a transport', () => {
    assert.deepEqual(check([source({ licenseClass: 'restricted-minimal', transport: 'worker' })]), []);
  });

  it('catches restricted-minimal with nothing to attribute', () => {
    // The licence grants nothing; attribution is the entire basis for rendering
    // anything, so a minimal-ingest posture without it is not a posture.
    const problems = check([source({ licenseClass: 'restricted-minimal', attribution: '  ' })]);
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /no attribution text/);
  });

  it('ignores excluded sources', () => {
    assert.deepEqual(
      check([source({ excluded: true, licenseClass: 'restricted', transport: 'direct' })]),
      [],
    );
  });

  it('the shipped registry has a consistent licence posture', () => {
    assert.deepEqual(licenceProblems(registry), []);
  });
});
