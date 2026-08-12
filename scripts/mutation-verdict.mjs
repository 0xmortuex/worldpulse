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
  return !label.startsWith('self-test') && !label.startsWith('harness');
}

export function failingLabels(out) {
  return [...out.matchAll(/^ {2}FAIL (.+?)(?: \{|$)/gm)].map((match) => match[1].trim());
}

/**
 * @param {{exit: number, out: string, expect: RegExp}} outcome
 * @returns {{verdict: string, evidence: string[], matched: string[], assertions: number|null}}
 */
export function classifyMutation({ exit, out, expect }) {
  const assertions = assertionsRun(out);
  const evidence = failingLabels(out).filter(isEvidence);
  const matched = evidence.filter((label) => expect.test(label));

  // Checked before everything, including `exit === 0`. A run that executed no
  // assertions is not a run in which the mutation survived — it is a run that
  // never looked. Ordering this after the exit check would restore the original
  // bug for any future abort that happens to exit clean.
  const verdict =
    assertions === null || assertions === 0
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
export const INCONCLUSIVE = ['SURVIVED', 'STALE', 'BUILD-FAILED', 'TIMEOUT', 'UNPARSED', 'NOT-EXERCISED'];
