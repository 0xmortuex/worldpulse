/**
 * Classify one mutation's outcome from the browser suite's output.
 *
 * Extracted from `mutation-check.mjs` so a planted case can drive the real
 * classifier (rule 27). It was inline, and inline is why the bug below survived:
 * the only way to exercise it was to run the whole mutation suite, which takes
 * an hour, so nobody ever fed it the input that breaks it.
 *
 * ## The bug this exists to fix
 *
 * `verify-render.mjs` aborts before running any assertion when it cannot launch
 * a browser — an unset `PLAYWRIGHT_CHROMIUM_PATH` in an environment that ships
 * Chromium out of band is enough. It reports that abort honestly: every step
 * skipped, `0 assertions across 9 steps`, and a non-zero exit.
 *
 * The old classifier read that as CAUGHT-ELSEWHERE. Because CAUGHT-ELSEWHERE is
 * not an inconclusive verdict, a full run in such a shell printed
 * `9 caught elsewhere, 0 SURVIVED, 0 inconclusive` and exited 0 — a clean
 * mutation gate over zero executed assertions. That is the exact failure the
 * mutation suite was built to detect in the app, occurring in the suite itself.
 *
 * The guard against it was already written — "a non-zero exit with nothing
 * parsed is not a catch" — and was defeated because the abort prints its own
 * `FAIL harness aborted: ...` line, so something *was* parsed. The old check
 * keyed on whether a FAIL line existed; those two questions come apart at
 * exactly the moment the harness dies, which is the moment it matters.
 *
 * So the discriminator here is the outcome, not the wording: how many
 * assertions actually ran. A run that exercised none of them cannot be evidence
 * about any of them, whatever it printed on the way out (rule 21).
 */

/**
 * The suite's own tally, as emitted by `verify-render.mjs`:
 *
 *     42 assertions across 9 steps, 0 skipped
 *
 * `null` when the line is absent, which means the process died before it could
 * report — also not evidence. Absent and zero are treated alike here, and that
 * is rule 30 applied to the instrument rather than to a source: a suite that
 * gave no answer did not answer "none failed".
 */
export function assertionsRun(out) {
  const match = /^\s*(\d+) assertions across \d+ steps/m.exec(out);
  return match ? Number(match[1]) : null;
}

/**
 * Labels that are not evidence about the mutation, for two different reasons.
 *
 * `self-test` fails by design on every run — it is the suite proving it can
 * fail — so counting it would mark every mutation caught.
 *
 * `harness` is the abort above. It reports the instrument breaking, not the app
 * behaving, and the two must never be scored the same.
 */
function isEvidence(label) {
  // `includes`, not `startsWith`. The suite has two self-tests and the second is
  // labelled "collapse self-test (expected to fail)" — which does not start with
  // "self-test", so it was being counted as evidence about the mutation. It
  // fails on EVERY run by design, so any mutation whose expect pattern happened
  // to match it would have been scored CAUGHT for a failure that was going to
  // happen anyway. Rule 34's question 3, in the classifier itself.
  return !label.includes('self-test') && !label.startsWith('harness');
}

export function failingLabels(out) {
  return [...out.matchAll(/^ {2}FAIL (.+?)(?: \{|$)/gm)].map((match) => match[1].trim());
}

/**
 * Did the mutation's OWN step actually execute?
 *
 * `assertionsRun` asks a global question — did ANY assertion run — and that is
 * the wrong question one level down. A step can abort and take later steps with
 * it while a hundred assertions from earlier steps run perfectly:
 *
 *     7 — globe event layers                      23  19  4   -
 *     7b — economy fetch states                    0   0  0   1
 *     cross-cutting — layout geometry (rule 8)     0   0  0   1
 *
 *     141 assertions across 10 steps, 3 skipped
 *
 * That is a real recorded run. Step 7's marker-click flake escalated into a 90s
 * `locator.click` timeout which aborted the step and the three after it. Two
 * mutations targeting those steps were scored CAUGHT-ELSEWHERE off step 7's
 * failing labels, having never been exercised at all.
 *
 * Same shape as the bug this module was extracted to fix, one level finer: the
 * check asked a question about the RUN when the principle is about the
 * MUTATION, and the two agree on every healthy run.
 *
 * @returns true if exercised, false if the step ran nothing, null if the table
 *          does not mention the step (an older or truncated output — no answer,
 *          which rule 30 says is not an answer of "no").
 */
export function stepWasExercised(out, step) {
  if (!step) return null;
  const table = out.slice(out.indexOf('per-step results'));
  if (table.length === 0) return null;

  for (const line of table.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(step)) continue;
    // Trailing columns: assert pass fail skipped, where skipped may be "-".
    const numbers = trimmed.slice(step.length).trim().split(/\s+/);
    const asserted = Number(numbers[0]);
    if (!Number.isFinite(asserted)) return null;
    return asserted > 0;
  }
  return null;
}

/**
 * @param {{exit: number, out: string, expect: RegExp, step?: string}} outcome
 * @returns {{verdict: string, evidence: string[], matched: string[], assertions: number|null}}
 */
export function classifyMutation({ exit, out, expect, step }) {
  const assertions = assertionsRun(out);
  const exercised = stepWasExercised(out, step);
  const evidence = failingLabels(out).filter(isEvidence);
  const matched = evidence.filter((label) => expect.test(label));

  // Checked before everything, including `exit === 0`. A run that executed no
  // assertions is not a run in which the mutation survived — it is a run that
  // never looked. Ordering this after the exit check would restore the original
  // bug for any future abort that happens to exit clean.
  const verdict =
    assertions === null || assertions === 0 || exercised === false
      ? 'NOT-EXERCISED'
      : exit === 0
        ? 'SURVIVED'
        : evidence.length === 0
          ? 'UNPARSED'
          : matched.length > 0
            ? 'CAUGHT'
            : 'CAUGHT-ELSEWHERE';

  return { verdict, evidence, matched, assertions };
}

/**
 * Verdicts that are not proof the suite can see the mutated behaviour.
 *
 * Exported rather than repeated at each use site: the original listed these
 * inline in three places — the `inconclusive` filter, the summary counter, and
 * the exit code — and a fourth verdict added later would have had to be
 * remembered in all three.
 */
export const INCONCLUSIVE = [
  'SURVIVED',
  'STALE',
  'BUILD-FAILED',
  'TIMEOUT',
  'UNPARSED',
  'NOT-EXERCISED',
  // A mutation whose anchor matches more than once did not necessarily edit the
  // code its named assertion covers, so its verdict is not evidence either way.
  'AMBIGUOUS-ANCHOR',
];

/**
 * Whether a mutation's anchor names exactly one place to edit, on any platform.
 *
 * Extracted from `mutation-check.mjs` for the same reason the classifier was:
 * inline, its only exercise path was an hour-long run, and rule 32 says a guard
 * reachable only by running the thing it guards has not been tested. Both of
 * this function's failure modes have already occurred in this repository —
 * a duplicated anchor, and a CRLF checkout silently failing every multi-line
 * anchor — and neither was found by reading the code.
 *
 * Line endings are normalised here rather than by the caller so that the check
 * and the edit cannot disagree about what "matches" means: a caller that
 * normalised for one and not the other would reintroduce the CRLF bug in the
 * gap between them.
 *
 * @returns null when the anchor is usable, otherwise the reason it is not.
 */
export function anchorProblem(source, from) {
  const normalisedSource = source.replace(/\r\n/g, '\n');
  const normalisedFrom = from.replace(/\r\n/g, '\n');
  const occurrences = normalisedSource.split(normalisedFrom).length - 1;

  if (occurrences === 0) {
    return { kind: 'STALE', detail: `anchor not found: ${normalisedFrom.slice(0, 60)}` };
  }
  if (occurrences > 1) {
    return {
      kind: 'AMBIGUOUS-ANCHOR',
      detail: `${occurrences} occurrences of the anchor; first-occurrence replace would pick one arbitrarily`,
    };
  }
  return null;
}
