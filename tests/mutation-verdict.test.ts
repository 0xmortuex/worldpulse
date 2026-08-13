import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { INCONCLUSIVE, anchorProblem, assertionsRun, classifyMutation } from '../scripts/mutation-verdict.mjs';

/**
 * Planted cases for the mutation classifier (rule 27).
 *
 * The first case is not synthetic. It is the output of a real run whose browser
 * failed to launch, which the classifier scored CAUGHT-ELSEWHERE — a verdict
 * that is not inconclusive, so the suite exited 0 having executed no assertions
 * at all. A recorded failure makes the better planted case than an invented one:
 * an invented input tests the rule I wrote, while this one tests the rule
 * against the thing that actually happened.
 */
const ABORTED = `
  FAIL harness aborted: browserType.launch: Executable doesn't exist at /opt/pw-browsers/chromium_headless_shell-1234/chrome-headless-shell-linu

per-step results
  step                                         assert  pass  fail  skipped
  1 — globe, selection, relations                   0     0     0  1
  cross-cutting — layout geometry (rule 8)          0     0     0  1

checks that did NOT run:
  - [1 — globe, selection, relations] entire step — the run aborted before reaching it

  0 assertions across 9 steps, 9 skipped

1 FAILED: [harness] harness aborted: browserType.launch: Executable doesn't exist
`;

/** A healthy run in which the mutation's own assertion fired. */
const CAUGHT_OUT = `
  FAIL party legend rows have non-zero height {"rows":3,"height":0}

  262 assertions across 9 steps, 0 skipped

1 FAILED: [cross-cutting] party legend rows have non-zero height
`;

/** A healthy run in which something else fired, but not the named assertion. */
const ELSEWHERE_OUT = `
  FAIL dossier header renders a portrait

  262 assertions across 9 steps, 0 skipped
`;

/** A healthy run in which nothing failed: the mutation went unnoticed. */
const SURVIVED_OUT = `
  262 assertions across 9 steps, 0 skipped

all checks passed
`;

const expect = /party legend/i;

describe('mutation verdict classification', () => {
  it('scores a harness abort as NOT-EXERCISED, not as a catch', () => {
    const { verdict, assertions, evidence } = classifyMutation({ exit: 1, out: ABORTED, expect });
    assert.equal(
      verdict,
      'NOT-EXERCISED',
      'a run that executed zero assertions was scored as evidence about the mutation',
    );
    assert.equal(assertions, 0);
    assert.deepEqual(evidence, [], 'the harness abort was counted as a failing app assertion');
  });

  it('keeps NOT-EXERCISED out of the passing set, so the gate cannot exit clean on it', () => {
    assert.ok(
      INCONCLUSIVE.includes('NOT-EXERCISED'),
      'NOT-EXERCISED must be inconclusive: this is the whole defect — CAUGHT-ELSEWHERE was not, ' +
        'so a run with no executed assertions exited 0',
    );
  });

  it('scores a genuine catch by the named assertion as CAUGHT', () => {
    const { verdict, matched } = classifyMutation({ exit: 1, out: CAUGHT_OUT, expect });
    assert.equal(verdict, 'CAUGHT');
    assert.equal(matched.length, 1);
  });

  it('scores a failure by some other assertion as CAUGHT-ELSEWHERE', () => {
    const { verdict } = classifyMutation({ exit: 1, out: ELSEWHERE_OUT, expect });
    assert.equal(verdict, 'CAUGHT-ELSEWHERE');
  });

  it('scores a clean exit with assertions run as SURVIVED', () => {
    const { verdict } = classifyMutation({ exit: 0, out: SURVIVED_OUT, expect });
    assert.equal(verdict, 'SURVIVED');
  });

  it('does not score a clean exit as SURVIVED when no assertion ran', () => {
    // Ordering guard. SURVIVED means "the suite looked and saw nothing wrong";
    // it must not be reachable by a run that never looked, however it exited.
    const { verdict } = classifyMutation({ exit: 0, out: ABORTED, expect });
    assert.equal(verdict, 'NOT-EXERCISED');
  });

  it('treats a missing tally as no answer rather than as an answer of none', () => {
    assert.equal(assertionsRun('the process died before printing anything'), null);
    const { verdict } = classifyMutation({ exit: 1, out: 'crashed', expect });
    assert.equal(verdict, 'NOT-EXERCISED');
  });

  it('ignores the self-test, which fails by design on every healthy run', () => {
    const out = `
  FAIL self-test (expected to fail) {"rows":1}

  262 assertions across 9 steps, 0 skipped
`;
    const { verdict, evidence } = classifyMutation({ exit: 1, out, expect });
    assert.deepEqual(evidence, []);
    assert.equal(verdict, 'UNPARSED', 'the self-test alone would otherwise mark every mutation caught');
  });
});

describe('regression — self-tests are never evidence, whatever they are called', () => {
  it('ignores a self-test whose label does not START with "self-test"', () => {
    // The suite has two. The second is "collapse self-test (expected to fail)",
    // which startsWith('self-test') does not match, so it was being counted as
    // evidence about the mutation. It fails on EVERY run by design.
    const out = `
  FAIL collapse self-test (expected to fail): no overlap or overflow LI clips its content vertically

  262 assertions across 9 steps, 0 skipped
`;
    const { verdict, evidence } = classifyMutation({ exit: 1, out, expect: /party legend/i });
    assert.deepEqual(evidence, [], 'a by-design failure was counted as evidence about the mutation');
    assert.equal(verdict, 'UNPARSED');
  });

  it('still counts a real failure that merely mentions a self-test in passing', () => {
    // The filter must not swallow genuine evidence. A check named after the
    // recovery from a self-test is a real assertion about the app.
    const out = `
  FAIL party legend recovers after collapse self-test

  262 assertions across 9 steps, 0 skipped
`;
    const { evidence } = classifyMutation({ exit: 1, out, expect: /party legend/i });
    // Documented: this label DOES contain "self-test" and is therefore filtered.
    // That is a deliberate trade — a by-design failure scored as evidence is a
    // false CAUGHT, while a real failure filtered out is a false inconclusive,
    // and only the first can certify a mutation that tests nothing.
    assert.deepEqual(evidence, []);
  });
});

describe('mutation anchors name exactly one place, on any platform', () => {
  it('accepts an anchor that appears once', () => {
    assert.equal(anchorProblem('a\nTARGET\nb', 'TARGET'), null);
  });

  it('rejects an anchor that appears nowhere', () => {
    assert.equal(anchorProblem('a\nb', 'TARGET')?.kind, 'STALE');
  });

  it('rejects a duplicated anchor rather than editing the first hit arbitrarily', () => {
    // The real case: adding a fetch-failed branch to the inspector put a second
    // `escapeHtml(provenance.requestUrl)` above the successful-fetch block, so
    // the request-URL mutation began blanking a URL in a block the browser suite
    // never inspects — and step 2 passed 19/19 WITH the mutation applied.
    const problem = anchorProblem('x\nTARGET\ny\nTARGET\nz', 'TARGET');
    assert.equal(problem?.kind, 'AMBIGUOUS-ANCHOR');
    assert.match(problem?.detail ?? '', /2 occurrences/);
  });

  it('matches a multi-line anchor against a CRLF checkout', () => {
    // The second real case: anchors are written with \n, the working tree was
    // CRLF, and every MULTI-LINE anchor silently reported STALE while every
    // single-line anchor kept working — losing precisely the anchors that had
    // been narrowed to be unambiguous.
    assert.equal(anchorProblem('pre\r\nONE\r\nTWO\r\npost', 'ONE\nTWO'), null);
  });

  it('normalises the anchor as well as the source, so a CRLF anchor also matches', () => {
    // Both sides, deliberately: normalising one and not the other would leave
    // the same bug in the gap between them.
    assert.equal(anchorProblem('pre\nONE\nTWO\npost', 'ONE\r\nTWO'), null);
  });

  it('keeps AMBIGUOUS-ANCHOR out of the passing set', () => {
    assert.ok(
      INCONCLUSIVE.includes('AMBIGUOUS-ANCHOR'),
      'an ambiguous anchor would otherwise let a mutation testing the wrong code path pass the gate',
    );
  });
});
