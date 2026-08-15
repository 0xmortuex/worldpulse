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

  it('CATCHES a class that expresses one obligation and drops the other', () => {
    /**
     * The planted case for the NC+SA split. WHO's CC BY-NC-SA sat in
     *  for a whole source registration: the copyleft term was
     * carried, the non-commercial term existed only in prose, and the registry
     * looked consistent because nothing compared the class against the licence
     * text.
     */
    const problems = check([
      source({ id: 'who', license: 'CC BY-NC-SA 3.0 IGO', licenseClass: 'share-alike', transport: 'direct' }),
    ]);
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /non-commercial term/);
    assert.match(problems[0] ?? '', /share-alike-nc/);
  });

  it('accepts share-alike-nc for a licence carrying both', () => {
    assert.deepEqual(
      check([source({ license: 'CC BY-NC-SA 3.0 IGO', licenseClass: 'share-alike-nc', transport: 'direct' })]),
      [],
    );
  });

  it('catches an NC licence filed as open, the least restrictive mistake', () => {
    const problems = check([source({ license: 'CC BY-NC 4.0', licenseClass: 'open', transport: 'direct' })]);
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /non-commercial/);
  });

  it('does NOT force a weaker class onto a stricter one', () => {
    /**
     * A fortiori. A BBC feed whose terms say personal, non-commercial use sits
     * in  — no general grant, headline and link only —
     * which is stricter than NC requires. Demanding an exact class here would
     * push four RSS feeds into a WEAKER classification to satisfy a guard: the
     * guard bending the data rather than describing it.
     */
    assert.deepEqual(
      check([source({ license: 'BBC Terms — personal, non-commercial use', licenseClass: 'restricted-minimal', transport: 'worker' })]),
      [],
    );
  });

  it('the shipped registry has a consistent licence posture', () => {
    assert.deepEqual(licenceProblems(registry), []);
  });
});
